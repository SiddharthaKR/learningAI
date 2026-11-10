import { withOfficeUser } from "@/src/server";
import { officeAuthHandlers } from "@/src/server";

async function POSTImpl(): Promise<Response> {
  return officeAuthHandlers().logout();
}

export const POST = withOfficeUser(POSTImpl);
