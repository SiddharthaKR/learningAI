import type { Metadata } from "next";
import { headers } from "next/headers";
import { authenticatedAccount } from "@/src/server/session-auth";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";

export const metadata: Metadata = {
	title: "Learning Harness",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	const incoming = await headers();
	const account = await authenticatedAccount(new Request("http://office.local/", { headers: incoming }));
	const accepted = incoming.get("accept-language")?.split(",")[0]?.trim().toLowerCase() ?? "";
	const language = account?.uiLanguage ?? (accepted.startsWith("ja") ? "ja" : "en");
	return (
		<html lang={language} className="dark">
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
							<AppShell>{children}</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
			</ServerEventsProvider>
		</body>
		</html>
	);
}
