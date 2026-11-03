import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatedAccount } from "./session-auth.ts";
import { runAsUser } from "./user-scope.ts";

/** Server-component counterpart of withOfficeUser. */
export async function withOfficePageUser<T>(work: () => T | Promise<T>): Promise<T> {
  const incoming = await headers();
  const request = new Request("http://office.local/", { headers: incoming });
  const account = await authenticatedAccount(request);
  if (!account) redirect("/login");
  return runAsUser(account.id, work);
}
