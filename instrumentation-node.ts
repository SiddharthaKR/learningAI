/** Server-start work for the Node.js runtime (imported by instrumentation.ts). */
import { PATHS } from "./config.ts";
import { clearStaleAccountLock } from "./src/server/accounts.ts";

await clearStaleAccountLock(PATHS.data);
