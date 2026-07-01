import { readFileSync } from "node:fs";
import { join } from "node:path";

// Public resource route that serves the storefront modal renderer
// (extensions/exit-intent-modal/assets/modal-templates.js) so the in-admin
// Pop-up QA preview can render the EXACT same templates shoppers see, inside a
// sized same-origin iframe. Single source of truth — no copy, no drift.
//
// Must stay unauthenticated: it's loaded via a <script> tag from a srcdoc
// iframe, which can't carry the Shopify session token. The file is just our
// render code (no secrets).

let cached = null;

export async function loader() {
  try {
    if (cached == null) {
      cached = readFileSync(
        join(process.cwd(), "extensions/exit-intent-modal/assets/modal-templates.js"),
        "utf8",
      );
    }
    return new Response(cached, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("[QA] Failed to read modal-templates.js:", error);
    return new Response("/* Resparq: modal templates unavailable */", {
      status: 500,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }
}
