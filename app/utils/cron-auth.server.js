/**
 * Shared auth guard for cron/maintenance endpoints.
 *
 * These routes are destructive (bulk deletes) and must never be callable by
 * the public. Same Bearer CRON_SECRET pattern as api.cron.social-proof.
 *
 * Returns a Response (401/503) to short-circuit with, or null if authorized.
 * Fails closed: if CRON_SECRET is unset, every request is rejected.
 */
const CRON_SECRET = process.env.CRON_SECRET;

export function requireCronSecret(request) {
  if (!CRON_SECRET || CRON_SECRET === "change-me-in-production") {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Read the secret from the Authorization header so it doesn't end up in
  // access logs / referer headers the way a query string would.
  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!provided || provided !== CRON_SECRET) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return null;
}
