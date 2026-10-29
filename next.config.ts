import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Runtime-loaded provider catalogs and native bindings need their own
	// Node module resolution instead of route bundling.
	serverExternalPackages: [
		"@earendil-works/pi-ai",
		"@earendil-works/pi-agent-core",
		"pdfjs-dist",
		"@napi-rs/canvas",
		"@resvg/resvg-js",
	],
};

export default nextConfig;
