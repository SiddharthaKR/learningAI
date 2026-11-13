import { withOfficePageUser } from "@/src/server";
import { currentUserId } from "@/src/server";
import { checkedStoresForUser, sharedKnowledgeStore } from "@/src/server";
import { KnowledgePage } from "@/components/knowledge-page";

export const dynamic = "force-dynamic";
export default async function Page() {
  return withOfficePageUser(async () => {
    const [snapshot, shared] = await Promise.all([
      checkedStoresForUser(currentUserId()).knowledgeStore.readSnapshot(),
      sharedKnowledgeStore.readSnapshot(),
    ]);
    const publicDocuments = (source: typeof snapshot) => source.documents.map(({ id, fileName, format, status }) => ({ id, fileName, format, status }));
    return <KnowledgePage initialDocuments={publicDocuments(snapshot)} sharedDocuments={publicDocuments(shared)} />;
  });
}
