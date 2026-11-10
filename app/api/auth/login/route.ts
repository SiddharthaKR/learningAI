import { officeAuthHandlers } from "@/src/server";

export async function POST(request: Request): Promise<Response> {
  return officeAuthHandlers().login(request);
}
