export type AuthGate = "allow" | "api-deny" | "page-redirect";

/** Exact public paths; every other application route requires an account. */
export function authGate(path: string, authenticated: boolean): AuthGate {
  if (path === "/login" || path === "/signup" || path === "/source" || path === "/api/auth/login" || path === "/api/auth/signup") return "allow";
  if (authenticated) return "allow";
  return path.startsWith("/api/") ? "api-deny" : "page-redirect";
}
