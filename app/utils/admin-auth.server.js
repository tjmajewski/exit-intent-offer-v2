// Super admin console auth.
//
// The /admin/* routes are NOT embedded in Shopify — they're a standalone,
// password-protected console for the app operator. Auth is a signed,
// HTTP-only cookie minted after a correct ADMIN_PASSWORD. Fails closed:
// if ADMIN_PASSWORD or ADMIN_SESSION_SECRET is unset, every request is
// rejected (same philosophy as cron-auth.server.js).
//
// See SUPER_ADMIN_CONSOLE_SPEC.md and SUPER_ADMIN_GUIDE.md.

import crypto from "node:crypto";
import { redirect } from "react-router";

const COOKIE_NAME = "resparq_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function secrets() {
  return {
    password: process.env.ADMIN_PASSWORD || null,
    sessionSecret: process.env.ADMIN_SESSION_SECRET || null,
  };
}

export function isAdminConfigured() {
  const { password, sessionSecret } = secrets();
  return Boolean(password && sessionSecret);
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing flat, then fail.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check a submitted password against ADMIN_PASSWORD (constant-time).
 * Returns false when auth is unconfigured — never a bypass.
 */
export function verifyAdminPassword(submitted) {
  const { password } = secrets();
  if (!password || !submitted) return false;
  return timingSafeEqualStr(submitted, password);
}

/**
 * Build the Set-Cookie header value for a fresh admin session.
 * Cookie payload: `${expiresAtMs}.${hmac(expiresAtMs)}`.
 */
export function createAdminSessionCookie() {
  const { sessionSecret } = secrets();
  const exp = String(Date.now() + SESSION_TTL_MS);
  const value = `${exp}.${sign(exp, sessionSecret)}`;
  return [
    `${COOKIE_NAME}=${value}`,
    "Path=/admin",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join("; ");
}

export function clearAdminSessionCookie() {
  return `${COOKIE_NAME}=; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

/**
 * True when the request carries a valid, unexpired admin session cookie.
 */
export function hasValidAdminSession(request) {
  const { sessionSecret } = secrets();
  if (!sessionSecret) return false;
  const raw = readCookie(request);
  if (!raw) return false;
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return false;
  const exp = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (!timingSafeEqualStr(sig, sign(exp, sessionSecret))) return false;
  return Number(exp) > Date.now();
}

/**
 * Gate for every /admin/* loader and action (except the login route).
 * Throws a redirect to the login page when the session is missing/expired.
 */
export function requireSuperAdmin(request) {
  if (!isAdminConfigured() || !hasValidAdminSession(request)) {
    throw redirect("/admin/login");
  }
}

/**
 * Headers every /admin response should carry — keep the console out of
 * search indexes and caches.
 */
export const ADMIN_RESPONSE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};
