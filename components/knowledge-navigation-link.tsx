"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";

export function KnowledgeNavigationLink() {
  const copy = useI18n();
  return <Link href="/knowledge" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground">{copy.knowledge.title}</Link>;
}
