const TOKEN_KEY = "artistToken";

/**
 * Artist bearer tokens are tab-scoped. Legacy localStorage tokens are migrated
 * once and removed to avoid durable browser persistence of privileged tokens.
 */
export function getArtistToken(): string | null {
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

export function setArtistToken(token: string) {
  const normalized = String(token || "").trim();
  if (!normalized) throw new Error("Artist session token is required");
  sessionStorage.setItem(TOKEN_KEY, normalized);
  localStorage.removeItem(TOKEN_KEY);
}

export function clearArtistSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
