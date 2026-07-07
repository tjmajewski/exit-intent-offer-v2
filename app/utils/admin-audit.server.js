// Audit trail for the super admin console. Every admin write (and every
// login attempt) is recorded so there's a permanent answer to "who changed
// this merchant's settings and when" — admin edits bypass the merchant's
// own session, so the app must keep its own record.

import db from "../db.server.js";
import { getClientIp } from "./rate-limit.server.js";

/**
 * Record an admin action. Never throws — an audit failure must not block
 * the underlying operation, but it is loudly logged.
 *
 * @param {Request} request  incoming request (for IP)
 * @param {string} action    e.g. "login", "login_failed", "settings_update"
 * @param {object} [opts]
 * @param {string} [opts.shopId]   Shop.id the action targeted
 * @param {object} [opts.payload]  context, e.g. { before, after }
 */
export async function logAdminAction(request, action, { shopId = null, payload = {} } = {}) {
  try {
    await db.adminAuditLog.create({
      data: {
        action,
        shopId,
        payload: JSON.stringify(payload),
        ip: getClientIp(request),
      },
    });
  } catch (error) {
    console.error(`[Admin Audit] FAILED to record ${action}:`, error);
  }
}

/**
 * Diff two flat objects → { field: { before, after } } for changed keys only.
 * Used to keep settings_update payloads small and readable.
 */
export function diffFields(before, after) {
  const changed = {};
  for (const key of Object.keys(after)) {
    if (before?.[key] !== after[key]) {
      changed[key] = { before: before?.[key] ?? null, after: after[key] };
    }
  }
  return changed;
}
