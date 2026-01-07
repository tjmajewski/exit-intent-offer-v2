import { authenticate } from "../shopify.server.js";
import { json } from "@remix-run/node";

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    
    // Import brand detection utility
    const { detectBrandColors } = await import('../utils/brand-detection.js');
    
    // Detect brand colors
    const brandColors = await detectBrandColors(admin);
    
    if (!brandColors) {
      return json({ 
        success: false, 
        error: "Could not detect brand colors" 
      });
    }
    
    return json({ 
      success: true, 
      colors: brandColors 
    });
    
  } catch (error) {
    console.error('[Detect Brand API] Error:', error);
    return json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
