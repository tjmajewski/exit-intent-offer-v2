import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const MAX_CSS_BYTES = 102_400; // 100 KB

/**
 * Strict CSS sanitizer.
 *
 * The previous implementation used a simple regex blocklist that was trivially
 * bypassable via CSS hex escapes (`\6a avascript:`), HTML-entity-style
 * encodings, comments used to split keywords, and url() arguments. This
 * rewrite normalizes the input before applying the blocklist so those
 * bypasses can't hide from the check:
 *
 *   1. Enforce a hard size cap first (cheap DoS guard).
 *   2. Strip CSS block comments (`/_* ... *_/`) so `java/_*x*_/script:` can't
 *      split a keyword across the block-list check.
 *   3. Decode CSS hex escape sequences (`\XX` or `\XXXXXX [ws]`) into their
 *      literal characters.
 *   4. Drop any HTML tags outright — they have no business in CSS.
 *   5. Collapse all whitespace so tokens like `expression (` can't hide a
 *      space inside a blocked keyword.
 *   6. Reject the input if the normalized form contains any disallowed token
 *      OR if any `url(...)` argument references a scheme other than http/https
 *      or a `data:image/...` payload.
 *
 * If anything suspicious is detected we throw — custom CSS is an advanced
 * Enterprise-only feature, so a false positive is strongly preferable to a
 * stored XSS vector.
 */
function sanitizeCSS(rawCss) {
  if (!rawCss) return "";
  if (typeof rawCss !== "string") {
    throw new Error("Custom CSS must be a string");
  }
  if (rawCss.length > MAX_CSS_BYTES) {
    throw new Error("CSS exceeds maximum size of 100KB");
  }

  // 1. Strip /* ... */ comments (non-greedy, multiline).
  let css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

  // 2. Decode CSS hex escapes: `\h{1,6}` optionally followed by a single
  //    whitespace character. Non-hex single-char escapes (`\"`, `\(`) become
  //    the literal character.
  css = css.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex) => {
    const cp = parseInt(hex, 16);
    if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff) return "";
    try {
      return String.fromCodePoint(cp);
    } catch {
      return "";
    }
  });
  css = css.replace(/\\([^\n\r\f0-9a-fA-F])/g, "$1");

  // 3. Drop anything that looks like an HTML tag.
  css = css.replace(/<[^>]*>/g, "");

  // 4. Produce a normalized copy for blocklist checks (whitespace collapsed,
  //    lowercased). We do NOT return this — we return the comment-stripped
  //    original so valid formatting survives.
  const normalized = css.replace(/\s+/g, "").toLowerCase();

  const blocked = [
    "javascript:",
    "vbscript:",
    "data:text/html",
    "data:application",
    "expression(",
    "behavior:",
    "-moz-binding",
    "@import",
    "@charset",
    "@namespace",
    "</style",
    "<script",
    "<iframe",
  ];
  for (const token of blocked) {
    if (normalized.includes(token)) {
      throw new Error("CSS contains disallowed content");
    }
  }

  // 5. Inspect every url(...) argument. Allow only http(s) URLs, data:image/*,
  //    and scheme-relative / same-origin paths.
  const urlRe = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
  let match;
  while ((match = urlRe.exec(css)) !== null) {
    const arg = match[2].trim().toLowerCase();
    if (!arg) continue;
    const isAllowed =
      arg.startsWith("http://") ||
      arg.startsWith("https://") ||
      arg.startsWith("//") ||
      arg.startsWith("/") ||
      arg.startsWith("./") ||
      arg.startsWith("../") ||
      arg.startsWith("#") ||
      arg.startsWith("data:image/");
    if (!isAllowed) {
      throw new Error("CSS contains disallowed url() reference");
    }
  }

  return css;
}

export async function action({ request }) {
  const { default: db } = await import("../db.server.js");
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Get shop from database
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop }
    });
    
    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }
    
    // Check if Enterprise tier
    if (shop.plan !== 'enterprise') {
      return json({ 
        error: "Custom CSS is only available on Enterprise plan" 
      }, { status: 403 });
    }
    
    const formData = await request.formData();
    const customCSS = formData.get('customCSS');
    
    // Sanitize CSS (throws on disallowed content).
    let sanitized;
    try {
      sanitized = sanitizeCSS(customCSS);
    } catch (err) {
      return json({ error: err.message }, { status: 400 });
    }
    
    // Update shop with custom CSS
    const updatedShop = await db.shop.update({
      where: { shopifyDomain: session.shop },
      data: { 
        customCSS: sanitized,
        updatedAt: new Date()
      }
    });

    return json({ 
      success: true,
      message: "Custom CSS saved successfully" 
    });
    
  } catch (error) {
    console.error("[Custom CSS] Error:", error);
    return json({ error: "Failed to save custom CSS" }, { status: 500 });
  }
}

export async function loader({ request }) {
  const { default: db } = await import("../db.server.js");
  const { admin, session } = await authenticate.admin(request);
  
  try {
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: {
        customCSS: true,
        plan: true
      }
    });
    
    if (!shop) {
      return json({ customCSS: '', plan: 'starter' });
    }
    
    return json({ 
      customCSS: shop.customCSS || '',
      plan: shop.plan || 'starter'
    });
    
  } catch (error) {
    console.error("[Custom CSS] Loader error:", error);
    return json({ customCSS: '', plan: 'starter' });
  }
}
