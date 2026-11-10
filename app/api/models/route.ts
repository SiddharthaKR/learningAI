import { withOfficeUser } from "@/src/server";
import { modelCatalog, refreshLocalProviders } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * The model picker's data (model-control wave): pi-ai's configured-provider
 * catalog as client-safe DTOs — id/name/cost/context/modality plus each
 * model's SUPPORTED thinking levels (per its thinkingLevelMap). Static
 * catalog: no network, stable within a pi-ai version.
 */
async function GETImpl() {
	await refreshLocalProviders();
	return Response.json(modelCatalog());
}

export const GET = withOfficeUser(GETImpl);
