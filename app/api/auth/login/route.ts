import { officeAuthHandlers } from "@/src/server/office-auth";

export async function POST(request: Request): Promise<Response> {
  return officeAuthHandlers().login(request);
}
