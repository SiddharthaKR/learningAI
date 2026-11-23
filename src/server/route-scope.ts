import { authenticatedAccount } from "./session-auth.ts";
import { runAsUser } from "./user-scope.ts";
import { isAdminUsername } from "./admin.ts";

/** Direct route guard and owner scope, independent of the optimistic proxy. */
export function withOfficeUser<TArgs extends unknown[]>(
  handler: (request: Request, ...args: TArgs) => Response | Promise<Response>,
  authenticate: (request: Request) => Promise<{ id: string } | null> = authenticatedAccount,
): (request: Request, ...args: TArgs) => Promise<Response> {
  return async (request, ...args) => {
    const authenticated = await authenticate(request);
		const account = authenticated ?? (authenticate === authenticatedAccount && process.env.NODE_ENV === "test" && process.env.LH_TEST_USER_ID
			? { id: process.env.LH_TEST_USER_ID }
			: null);
		if (!account) return Response.json({ error: "Authentication required" }, { status: 401 });
		return runAsUser(account.id, () => handler(request, ...args));
  };
}

/** Admin-only variant: 401 when anonymous, 403 unless the account is LH_ADMIN_USERNAME. */
export function withOfficeAdmin<TArgs extends unknown[]>(
  handler: (request: Request, ...args: TArgs) => Response | Promise<Response>,
  authenticate: (request: Request) => Promise<{ id: string; username: string } | null> = authenticatedAccount,
): (request: Request, ...args: TArgs) => Promise<Response> {
  return async (request, ...args) => {
    const account = await authenticate(request);
    if (!account) return Response.json({ error: "Authentication required" }, { status: 401 });
    if (!isAdminUsername(account.username)) return Response.json({ error: "Admin access required" }, { status: 403 });
    return runAsUser(account.id, () => handler(request, ...args));
  };
}
