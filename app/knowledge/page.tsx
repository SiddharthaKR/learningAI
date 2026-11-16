import { withOfficePageUser } from "@/src/server";
import { currentUserId } from "@/src/server";
import { checkedStoresForUser, isAdminUser, sharedKnowledgeStore } from "@/src/server";
import { KnowledgePage } from "@/components/knowledge-page";

export const dynamic = "force-dynamic";
export default async function Page() {
  return withOfficePageUser(async () => {
    const userId = currentUserId();
    const [snapshot, shared, isAdmin] = await Promise.all([
      checkedStoresForUser(userId).knowledgeStore.readSnapshot(),
      sharedKnowledgeStore.readSnapshot(),
      isAdminUser(userId),
    ]);
    const publicDocuments = (source: typeof snapshot) => source.documents.map(({ id, fileName, format, status, hasPictures, picturesRead }) => ({ id, fileName, format, status, ...(hasPictures ? { hasPictures } : {}), ...(picturesRead ? { picturesRead } : {}) }));
    return <KnowledgePage initialDocuments={publicDocuments(snapshot)} sharedDocuments={publicDocuments(shared)} isAdmin={isAdmin} />;
  });
}
