import { headers } from "next/headers";
import { AuthForm } from "@/components/auth-form";

export default async function LoginPage() {
  const accept = (await headers()).get("accept-language")?.split(",")[0]?.trim().toLowerCase() ?? "";
  return <AuthForm mode="login" initialLanguage={accept.startsWith("ja") ? "ja" : "en"} />;
}
