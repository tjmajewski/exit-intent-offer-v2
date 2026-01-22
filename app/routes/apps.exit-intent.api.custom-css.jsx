import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Sanitize CSS to prevent XSS attacks
function sanitizeCSS(css) {
  if (!css) return "";
  
  // Remove any script tags or javascript
  let sanitized = css
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, ''); // Remove inline event handlers
  
  // Limit size to 100KB
  if (sanitized.length > 102400) {
    throw new Error("CSS exceeds maximum size of 100KB");
  }
  
  return sanitized;
}

// Validate that CSS is reasonably safe
function validateCSS(css) {
  const dangerous = [
    'expression(',
    'behavior:',
    '-moz-binding',
    'import',
    '@import'
  ];
  
  const lowerCSS = css.toLowerCase();
  for (const pattern of dangerous) {
    if (lowerCSS.includes(pattern)) {
      throw new Error(`Dangerous CSS pattern detected: ${pattern}`);
    }
  }
  
  return true;
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
    
    // Sanitize and validate CSS
    const sanitized = sanitizeCSS(customCSS);
    validateCSS(sanitized);
    
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
    return json({ 
      error: error.message || "Failed to save custom CSS" 
    }, { status: 500 });
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
