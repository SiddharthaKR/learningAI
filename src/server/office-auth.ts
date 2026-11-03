import { PATHS } from "../../config.ts";
import { createAccountStore } from "./accounts.ts";
import { createAuthHandlers } from "./auth-handlers.ts";
import { officeConfig } from "./office-config.ts";

let cached: ReturnType<typeof createAuthHandlers> | undefined;
export function officeAuthHandlers(): ReturnType<typeof createAuthHandlers> {
  return cached ??= createAuthHandlers(createAccountStore(PATHS.data), officeConfig().sessionSecret);
}
