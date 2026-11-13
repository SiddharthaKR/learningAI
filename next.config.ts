import type { NextConfig } from "next";
import { MAX_KNOWLEDGE_MULTIPART_BYTES } from "./src/knowledge/upload.ts";

const nextConfig: NextConfig = {
	experimental: {
		// Avoid the Next.js 16.4 persisted-cache HMR reload loop after restart.
		// https://github.com/vercel/next.js/issues/100267
		turbopackFileSystemCacheForDev: false,
		// Proxy clones the request body before the route can enforce file size.
		proxyClientMaxBodySize: MAX_KNOWLEDGE_MULTIPART_BYTES,
	},
	// Runtime-loaded provider catalogs and native bindings need their own
	// Node module resolution instead of route bundling.
	serverExternalPackages: [
		"@earendil-works/pi-ai",
		"@earendil-works/pi-agent-core",
		"pdfjs-dist",
		"@napi-rs/canvas",
		"@resvg/resvg-js",
	],
	// Personal and shared corpora are runtime data and must never be traced
	// into route bundles or a standalone deployment.
	outputFileTracingExcludes: {
		"/*": [
			"./data/**/*",
			"./knowledge/**/*",
			"./index/**/*",
			"./indexes/**/*",
			"./**/*.jsonl",
		],
	},
};

export default nextConfig;
