import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import { authenticatedAccount } from "@/src/server";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import { I18nProvider } from "@/components/i18n-provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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
		<html lang={language} className={inter.variable} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}}())` }} />
			</head>
			<body className="min-h-dvh antialiased">
			<I18nProvider language={language}>
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
			</I18nProvider>
		</body>
		</html>
	);
}
