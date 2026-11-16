import { readSharedKnowledgeAudit, sharedKnowledgeStore, withOfficeAdminPage } from "@/src/server";
import { computeKnowledgeStats } from "@/src/core";
import { AdminKnowledge } from "@/components/admin-knowledge";

export const dynamic = "force-dynamic";
export default async function Page() {
  return withOfficeAdminPage(async () => {
    const [snapshot, events] = await Promise.all([sharedKnowledgeStore.readSnapshot(), readSharedKnowledgeAudit()]);
    return <AdminKnowledge stats={computeKnowledgeStats(snapshot, events)} />;
  });
}
