/**
 * Production playback policy.
 */

import { PLAYABLE_STATUSES, VISIBILITY, type Visibility } from "./media.constants";

export function isStatusPlayable(status: string): boolean {
  const normalized = String(status || "").trim().toUpperCase();
  return (PLAYABLE_STATUSES as Set<string>).has(normalized);
}

export function isContentEligibleForPlayback(input: {
  technicalStatus: string;
  lifecycleState: string;
  isApproved: boolean;
  isTakenDown: boolean;
}): boolean {
  return (
    !input.isTakenDown &&
    Boolean(input.isApproved) &&
    String(input.lifecycleState || "").trim().toUpperCase() === "EARLY_ACCESS" &&
    isStatusPlayable(input.technicalStatus)
  );
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
