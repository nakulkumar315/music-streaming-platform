/**
 * Production playback policy.
 */

import { PLAYABLE_STATUSES, VISIBILITY, type Visibility } from "./media.constants";

export function isStatusPlayable(status: string): boolean {
  const normalized = String(status || "").trim().toUpperCase();
  return PLAYABLE_STATUSES.has(normalized);
}

export function isContentEligibleForPlayback(
  status: string,
  isApproved: boolean
): boolean {
  return Boolean(isApproved) && isStatusPlayable(status);
}

/**
 * Returns null for unknown visibility so callers fail closed. PROTECTED is
 * never rewritten to PUBLIC.
 */
export function normalizeVisibilityForPlayback(
  visibility: string
): Visibility | null {
  const normalized = String(visibility || "").trim().toUpperCase();
  if (normalized === VISIBILITY.PUBLIC) return VISIBILITY.PUBLIC;
  if (normalized === VISIBILITY.PROTECTED) return VISIBILITY.PROTECTED;
  if (normalized === VISIBILITY.PRIVATE_INTERNAL) return VISIBILITY.PRIVATE_INTERNAL;
  return null;
}
