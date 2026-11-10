import { sourceArchiveResponse } from "@/src/server/source-archive";

export const dynamic = "force-dynamic";

export async function GET() {
  return sourceArchiveResponse();
}
