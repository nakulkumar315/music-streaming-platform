/**
 * Media lifecycle and visibility constants.
 */

export const MEDIA_STATUS = {
  DRAFT: "DRAFT",
  UPLOADING: "UPLOADING",
  PROCESSING: "PROCESSING",
  READY: "READY",
  FAILED: "FAILED",
  REJECTED: "REJECTED",
  TAKEDOWN: "TAKEDOWN",
  DELETED: "DELETED",
  BLOCKED: "BLOCKED",
} as const;

/**
 * Transitional production-playable states while content lifecycle naming is
 * consolidated. PROCESSING is intentionally excluded.
 */
export const PLAYABLE_STATUSES = new Set([
  MEDIA_STATUS.READY,
  "PUBLISHED",
  "APPROVED",
]);

export const VISIBILITY = {
  PUBLIC: "PUBLIC",
  PROTECTED: "PROTECTED",
  PRIVATE_INTERNAL: "PRIVATE_INTERNAL",
} as const;

export type MediaStatus = (typeof MEDIA_STATUS)[keyof typeof MEDIA_STATUS];
export type Visibility = (typeof VISIBILITY)[keyof typeof VISIBILITY];
