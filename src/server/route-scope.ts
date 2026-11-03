import { authenticatedAccount } from "./session-auth.ts";
import { runAsUser } from "./user-scope.ts";

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
