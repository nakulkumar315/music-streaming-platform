/**
 * Canonical media technical lifecycle and visibility constants.
 * Business publication state lives in content_items.lifecycle_state.
 */

export const MEDIA_STATUS = {
  UPLOADING: "UPLOADING",
  PROCESSING: "PROCESSING",
  READY: "READY",
  FAILED: "FAILED",
} as const;

export const PLAYABLE_STATUSES: ReadonlySet<string> = new Set([MEDIA_STATUS.READY]);

export const VISIBILITY = {
  PUBLIC: "PUBLIC",
  PROTECTED: "PROTECTED",
  PRIVATE_INTERNAL: "PRIVATE_INTERNAL",
} as const;

export type MediaStatus = (typeof MEDIA_STATUS)[keyof typeof MEDIA_STATUS];
export type Visibility = (typeof VISIBILITY)[keyof typeof VISIBILITY];
