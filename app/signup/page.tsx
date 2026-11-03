import { headers } from "next/headers";
import { AuthForm } from "@/components/auth-form";

export default async function SignupPage() {
  const accept = (await headers()).get("accept-language")?.split(",")[0]?.trim().toLowerCase() ?? "";
  return <AuthForm mode="signup" initialLanguage={accept.startsWith("ja") ? "ja" : "en"} />;
}
