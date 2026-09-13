export type PrivilegedRole = "ADMIN" | "MODERATOR" | "FINANCE";

const TOKEN_KEY = "adminToken";
const ROLE_KEY = "adminCanonicalRole";

function isPrivilegedRole(value: unknown): value is PrivilegedRole {
  const role = String(value || "").toUpperCase();
  return role === "ADMIN" || role === "MODERATOR" || role === "FINANCE";
}

/**
 * Privileged bearer tokens are tab-scoped. Legacy localStorage tokens are
 * migrated once and removed so a browser restart does not retain admin access.
 */
export function getAdminToken(): string | null {
  const current = sessionStorage.getItem(TOKEN_KEY);
  if (current) {
    localStorage.removeItem(TOKEN_KEY);
    return current;
  }

  const legacy = localStorage.getItem(TOKEN_KEY);
  if (!legacy) return null;
  sessionStorage.setItem(TOKEN_KEY, legacy);
  localStorage.removeItem(TOKEN_KEY);
  return legacy;
}

export function setAdminToken(token: string) {
  const normalized = String(token || "").trim();
  if (!normalized) throw new Error("Admin session token is required");
  sessionStorage.setItem(TOKEN_KEY, normalized);
  sessionStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function clearAdminSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function setPrivilegedRole(value: unknown): PrivilegedRole | null {
  if (!isPrivilegedRole(value)) {
    sessionStorage.removeItem(ROLE_KEY);
    return null;
  }
  const role = String(value).toUpperCase() as PrivilegedRole;
  sessionStorage.setItem(ROLE_KEY, role);
  return role;
}

/** UX/navigation helper only. Server-side RBAC remains authoritative. */
export function getPrivilegedRole(): PrivilegedRole | null {
  if (!getAdminToken()) return null;
  const role = sessionStorage.getItem(ROLE_KEY);
  return isPrivilegedRole(role) ? role : null;
}
