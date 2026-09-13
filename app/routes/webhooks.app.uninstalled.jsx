import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendNotify } from "../utils/notify.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  // Only notify on the first delivery (when a session still exists) to avoid duplicate emails.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
    await sendNotify(
      `❌ Resparq uninstalled: ${shop}`,
      `${shop} uninstalled Resparq at ${new Date().toISOString()}.`
    );
  }

  return new Response();
};
