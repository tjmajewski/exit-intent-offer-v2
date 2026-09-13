import nodemailer from "nodemailer";

// Zoho SMTP notifier for founder alerts (installs / uninstalls).
// Set on Fly: ZOHO_SMTP_USER, ZOHO_SMTP_PASS (app-specific password),
// optional NOTIFY_TO (defaults to taylor.majewski@resparq.ai).
const SMTP_USER = process.env.ZOHO_SMTP_USER;
const SMTP_PASS = process.env.ZOHO_SMTP_PASS;
const NOTIFY_TO = process.env.NOTIFY_TO || "taylor.majewski@resparq.ai";

let transporter = null;
function getTransporter() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.zoho.com",
      port: 465,
      secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

// Fire-and-forget: never let a notification failure break the request.
export async function sendNotify(subject, text) {
  const t = getTransporter();
  if (!t) {
    console.warn("[notify] SMTP not configured, skipping:", subject);
    return;
  }
  try {
    await t.sendMail({ from: SMTP_USER, to: NOTIFY_TO, subject, text });
    console.log("[notify] sent:", subject);
  } catch (err) {
    console.error("[notify] failed:", err?.message || err);
  }
}
