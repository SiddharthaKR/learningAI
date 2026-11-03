import { withOfficePageUser } from "@/src/server/page-scope";
import { currentUserId } from "@/src/server/user-scope";
import { createAccountStore } from "@/src/server/accounts";
import { PreferencesForm } from "@/components/preferences-form";
import { PATHS } from "@/config";

export const dynamic = "force-dynamic";
export default async function PreferencesPage() {
  return withOfficePageUser(async () => {
    const account = await createAccountStore(PATHS.data).byId(currentUserId());
    if (!account) return null;
    return <PreferencesForm initial={{ uiLanguage: account.uiLanguage, teachingLanguage: account.teachingLanguage, background: account.background ?? "" }} />;
  });
}
