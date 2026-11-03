import { createHmac, timingSafeEqual } from "node:crypto";
import { PATHS } from "../../config.ts";
import { createAccountStore, type Account } from "./accounts.ts";
import { officeConfig } from "./office-config.ts";

export const SESSION_COOKIE = "lh_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(userId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = SESSION_SECONDS): string {
  const payload = Buffer.from(JSON.stringify({ userId, expires: nowSeconds + ttlSeconds })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(signature(parts[0], secret));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { userId?: unknown; expires?: unknown };
    return typeof data.userId === "string" && data.userId.length > 0 && typeof data.expires === "number" && nowSeconds < data.expires ? data.userId : null;
  } catch { return null; }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function resolveSessionAccount(token: string, secret: string, byId: (id: string) => Promise<Account | null>, nowSeconds = Math.floor(Date.now() / 1000)): Promise<Account | null> {
  const userId = verifySessionToken(token, secret, nowSeconds);
  return userId ? byId(userId) : null;
}

export async function authenticatedAccount(request: Request): Promise<Account | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  return resolveSessionAccount(token, officeConfig().sessionSecret, (id) => createAccountStore(PATHS.data).byId(id));
}
