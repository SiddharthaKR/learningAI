import { withOfficePageUser } from "@/src/server/page-scope";
import { currentUserId } from "@/src/server/user-scope";
import { checkedStoresForUser } from "@/src/server/stores";
import { KnowledgePage } from "@/components/knowledge-page";

export const dynamic = "force-dynamic";
export default async function Page() {
  return withOfficePageUser(async () => {
    const snapshot = await checkedStoresForUser(currentUserId()).knowledgeStore.readSnapshot();
    return <KnowledgePage initialDocuments={snapshot.documents.map(({ id, fileName, format, status }) => ({ id, fileName, format, status }))} />;
  });
}
