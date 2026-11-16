/** The admin is the account whose username equals LH_ADMIN_USERNAME (trimmed). Unset or empty means no admin. */
export function adminUsername(): string | null {
  return (process.env.LH_ADMIN_USERNAME ?? "").trim() || null;
}

export function isAdminUsername(username: string): boolean {
  const admin = adminUsername();
  return admin !== null && username === admin;
}
