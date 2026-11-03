import { NextResponse, type NextRequest } from "next/server";
import { authenticatedAccount } from "./src/server/session-auth.ts";
import { authGate } from "./src/server/auth-gate.ts";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (authGate(path, false) === "allow") return NextResponse.next();
  const account = await authenticatedAccount(request);
  const decision = authGate(path, account !== null);
  if (decision === "allow") return NextResponse.next();
  if (decision === "api-deny") return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
