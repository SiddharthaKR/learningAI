import type { createAccountStore } from "./accounts.ts";
import { createAuthRateLimiter } from "./auth-rate-limit.ts";
import { clearSessionCookie, createSessionToken, sessionCookie } from "./session-auth.ts";

type Accounts = ReturnType<typeof createAccountStore>;

/** Request handlers with injected account storage for direct behavioral tests. */
export function createAuthHandlers(accounts: Accounts, secret: string, limits: { signupLimit?: number; loginLimit?: number } = {}) {
  const signupLimiter = createAuthRateLimiter(limits.signupLimit ?? 10, 15 * 60_000);
  const loginLimiter = createAuthRateLimiter(limits.loginLimit ?? 20, 15 * 60_000);
  return {
    async signup(request: Request): Promise<Response> {
      if (!signupLimiter.allow("signup")) return Response.json({ error: "Too many signup attempts" }, { status: 429 });
      let body: { username?: unknown; password?: unknown; language?: unknown };
      try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
      if (typeof body.username !== "string" || typeof body.password !== "string") return Response.json({ error: "Username and password are required" }, { status: 400 });
      const preferred = request.headers.get("accept-language")?.split(",")[0]?.trim().toLowerCase().startsWith("ja") ? "ja" : "en";
      const language = body.language === undefined ? preferred : body.language;
      if (language !== "en" && language !== "ja") return Response.json({ error: "Unsupported language" }, { status: 400 });
      try {
        const account = await accounts.create(body.username, body.password, language);
        return Response.json({ account }, { status: 201, headers: { "set-cookie": sessionCookie(createSessionToken(account.id, secret)) } });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Signup failed" }, { status: 400 });
      }
    },
    async login(request: Request): Promise<Response> {
      if (!loginLimiter.allow("login")) return Response.json({ error: "Too many login attempts" }, { status: 429 });
      let body: { username?: unknown; password?: unknown };
      try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
      if (typeof body.username !== "string" || typeof body.password !== "string") return Response.json({ error: "Invalid credentials" }, { status: 401 });
      const account = await accounts.verify(body.username, body.password);
      if (!account) return Response.json({ error: "Invalid credentials" }, { status: 401 });
      return Response.json({ account }, { headers: { "set-cookie": sessionCookie(createSessionToken(account.id, secret)) } });
    },
    async logout(): Promise<Response> {
      return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
    },
  };
}
