import { withOfficePageUser } from "@/src/server";
import { currentUserId } from "@/src/server";
import { createAccountStore } from "@/src/server";
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
