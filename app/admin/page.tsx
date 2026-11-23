import { adminUsername, createAccountStore, withOfficeAdminPage } from "@/src/server";
import { AdminUsers } from "@/components/admin-users";
import { PATHS } from "@/config";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  return withOfficeAdminPage(async () => {
    const accounts = await createAccountStore(PATHS.data).list();
    return <AdminUsers initialUsers={accounts.map(({ id, username, createdAt }) => ({ id, username, createdAt }))} adminUsername={adminUsername() ?? ""} />;
  });
}
