import { PATHS } from "../../config.ts";
import { accountExistsSync } from "./accounts.ts";
import { storesForUser } from "./stores.ts";
import { runAsBackgroundOwner } from "./user-scope.ts";

/** The only entry point for a resumed or newly spawned office job. */
export async function runOwnedJob(ownerId: string, jobId: string, work: (jobId: string) => Promise<void>): Promise<void> {
  if (!accountExistsSync(PATHS.data, ownerId)) throw new Error("Owner account no longer exists");
  const job = storesForUser(ownerId).jobStore.getJob(jobId);
  if (!job || job.ownerId !== ownerId) throw new Error("Job does not belong to this owner");
  return runAsBackgroundOwner(ownerId, () => work(jobId));
}
