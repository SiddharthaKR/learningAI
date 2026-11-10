import { withOfficeUser } from "@/src/server";
import { handleChatRequest } from "@/src/server";

async function POSTImpl(req: Request) {
	return handleChatRequest(req);
}

export const POST = withOfficeUser(POSTImpl);
