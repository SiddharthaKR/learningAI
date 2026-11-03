import { withOfficeUser } from "@/src/server/route-scope";
import { officeAuthHandlers } from "@/src/server/office-auth";

async function POSTImpl(): Promise<Response> {
  return officeAuthHandlers().logout();
}

export const POST = withOfficeUser(POSTImpl);
