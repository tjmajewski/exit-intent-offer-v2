import { json } from "@remix-run/node";
import db from "../db.server.js";

export async function action({ request }) {
  try {
    const { impressionId, buttonType } = await request.json();
    
    if (!impressionId) {
      return json({ error: "Missing impressionId" }, { status: 400 });
    }
    
    // Import the recordClick function
    const { recordClick } = await import('../utils/variant-engine.js');
    
    // Record the click
    await recordClick(impressionId, buttonType);
    
    console.log(`[Click Tracking] Recorded ${buttonType} click for impression ${impressionId}`);
    
    return json({ success: true });
    
  } catch (error) {
    console.error("[Click Tracking] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
