import { validateEnv } from "../../config/env.validation";

function baseUrl(): string {
  return validateEnv().appBaseUrl.replace(/\/+$/, "");
}

/**
 * Build an application-owned public URL from the validated external base URL.
 * Request Host / forwarded Host headers are never authoritative.
 */
export function publicAppUrl(pathname: string): string {
  const path = String(pathname || "").trim();
  if (!path.startsWith("/")) {
    throw new Error("Public application paths must be absolute paths");
  }
  return `${baseUrl()}${path}`;
}

/** Preserve provider/external absolute URLs, but canonicalize application paths. */
export function canonicalPublicUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^http:\/\//i.test(raw)) {
    if (validateEnv().nodeEnv === "production") return null;
    return raw;
  }
  return publicAppUrl(raw.startsWith("/") ? raw : `/${raw}`);
}
