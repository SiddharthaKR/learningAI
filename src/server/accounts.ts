import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export type Language = "en" | "ja";
export interface Account { id: string; username: string; uiLanguage: Language; teachingLanguage: Language; background?: string; createdAt: string }
interface StoredAccount extends Account { passwordSalt: string; passwordHash: string }
interface AccountFile { version: 1; accounts: StoredAccount[] }

/** Atomic account-file swaps make this safe to recheck immediately before a synchronous store operation. */
export function accountExistsSync(root: string, userId: string): boolean {
  try {
    const data = JSON.parse(readFileSync(path.join(root, "accounts.json"), "utf8")) as AccountFile;
    return Array.isArray(data.accounts) && data.accounts.some((account) => account.id === userId);
  } catch { return false; }
}

function validatePassword(password: string): void {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters");
}

function publicAccount(account: StoredAccount): Account {
  const { passwordSalt: _salt, passwordHash: _hash, ...publicFields } = account;
  return publicFields;
}

export function createAccountStore(root: string) {
  const file = path.join(root, "accounts.json");
  const lockFile = path.join(root, ".accounts.lock");
  async function read(): Promise<AccountFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as AccountFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) throw new Error("Unsupported account file");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, accounts: [] };
      throw error;
    }
  }
  async function write(value: AccountFile): Promise<void> {
    const temp = path.join(root, `.accounts-${randomUUID()}.tmp`);
    await fs.writeFile(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    try { await fs.rename(temp, file); } finally { await fs.rm(temp, { force: true }); }
  }
  async function locked<T>(operation: () => Promise<T>): Promise<T> {
    await fs.mkdir(root, { recursive: true });
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { handle = await fs.open(lockFile, "wx", 0o600); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (!handle) throw new Error("Account file is locked");
    try { return await operation(); }
    finally { await handle.close(); await fs.rm(lockFile, { force: true }); }
  }
  return {
    async create(username: string, password: string, language: Language): Promise<Account> {
      const normalized = username.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/u.test(normalized)) throw new Error("Username must be 3–32 letters, numbers, underscores, or hyphens");
      validatePassword(password);
      if (language !== "en" && language !== "ja") throw new Error("Unsupported language");
      return locked(async () => {
        const data = await read();
        if (data.accounts.some((item) => item.username === normalized)) throw new Error("Username already exists");
        const salt = randomBytes(16);
        const hash = await scrypt(password, salt, 64) as Buffer;
        const stored: StoredAccount = { id: randomUUID(), username: normalized, uiLanguage: language, teachingLanguage: language, createdAt: new Date().toISOString(), passwordSalt: salt.toString("hex"), passwordHash: hash.toString("hex") };
        data.accounts.push(stored);
        await write(data);
        return publicAccount(stored);
      });
    },
    async verify(username: string, password: string): Promise<Account | null> {
      const data = await read();
      const found = data.accounts.find((item) => item.username === username.trim().toLowerCase());
      if (!found) return null;
      const candidate = await scrypt(password, Buffer.from(found.passwordSalt, "hex"), 64) as Buffer;
      const stored = Buffer.from(found.passwordHash, "hex");
      return stored.length === candidate.length && timingSafeEqual(stored, candidate) ? publicAccount(found) : null;
    },
    async byId(id: string): Promise<Account | null> {
      const found = (await read()).accounts.find((item) => item.id === id);
      return found ? publicAccount(found) : null;
    },
    async byUsername(username: string): Promise<Account | null> {
      const found = (await read()).accounts.find((item) => item.username === username.trim().toLowerCase());
      return found ? publicAccount(found) : null;
    },
    async list(): Promise<Account[]> {
      return (await read()).accounts.map(publicAccount);
    },
    async resetPassword(username: string, newPassword: string): Promise<Account> {
      validatePassword(newPassword);
      return locked(async () => {
        const data = await read();
        const found = data.accounts.find((item) => item.username === username.trim().toLowerCase());
        if (!found) throw new Error("Account not found");
        const salt = randomBytes(16);
        found.passwordSalt = salt.toString("hex");
        found.passwordHash = (await scrypt(newPassword, salt, 64) as Buffer).toString("hex");
        await write(data);
        return publicAccount(found);
      });
    },
    async updatePreferences(id: string, changes: { uiLanguage?: Language; teachingLanguage?: Language; background?: string }): Promise<Account> {
      for (const language of [changes.uiLanguage, changes.teachingLanguage]) {
        if (language !== undefined && language !== "en" && language !== "ja") throw new Error("Unsupported language");
      }
      if (changes.background !== undefined && (typeof changes.background !== "string" || changes.background.length > 2000)) {
        throw new Error("Background must be at most 2000 characters");
      }
      return locked(async () => {
        const data = await read();
        const account = data.accounts.find((item) => item.id === id);
        if (!account) throw new Error("Account not found");
        if (changes.uiLanguage !== undefined) account.uiLanguage = changes.uiLanguage;
        if (changes.teachingLanguage !== undefined) account.teachingLanguage = changes.teachingLanguage;
        if (changes.background !== undefined) account.background = changes.background.trim() || undefined;
        await write(data);
        return publicAccount(account);
      });
    },
    async delete(username: string): Promise<Account | null> {
      return locked(async () => {
        const data = await read();
        const found = data.accounts.find((item) => item.username === username.trim().toLowerCase());
        if (!found) return null;
        data.accounts = data.accounts.filter((item) => item.id !== found.id);
        await write(data);
        return publicAccount(found);
      });
    },
  };
}
