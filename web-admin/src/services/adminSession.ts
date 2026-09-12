export type PrivilegedRole = "ADMIN" | "MODERATOR" | "FINANCE";

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * UX helper only. Authorization always remains server-side; this decoded JWT
 * role is used solely to choose portal navigation/landing pages.
 */
export function getPrivilegedRole(): PrivilegedRole | null {
  const token = localStorage.getItem("adminToken");
  if (!token) return null;
  const role = String(decodePayload(token)?.role || "").toUpperCase();
  return role === "ADMIN" || role === "MODERATOR" || role === "FINANCE"
    ? role
    : null;
}
