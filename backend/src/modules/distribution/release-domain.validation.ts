import { UploadValidationError } from "../content/media-upload-validation";

export const RELEASE_TYPES = ["SINGLE", "EP", "ALBUM"] as const;
export type ReleaseType = (typeof RELEASE_TYPES)[number];

export const CONTRIBUTOR_ROLES = [
  "PRIMARY_ARTIST",
  "FEATURED_ARTIST",
  "COMPOSER",
  "LYRICIST",
  "PRODUCER",
  "REMIXER",
] as const;
export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number];

export type ReleaseContributorInput = {
  displayName: string;
  role: ContributorRole;
};

export type Phase1ReleaseMetadata = {
  releaseType: "SINGLE";
  language: string | null;
  explicit: boolean;
  labelName: string | null;
  earlyAccessStartAt: Date | null;
  publicReleaseAt: Date | null;
  exclusivityEndAt: Date | null;
  upcEan: string | null;
  isrc: string | null;
  contributors: ReleaseContributorInput[];
};

const RELEASE_TYPE_SET = new Set<string>(RELEASE_TYPES);
const CONTRIBUTOR_ROLE_SET = new Set<string>(CONTRIBUTOR_ROLES);
const UPC_EAN_SHAPE = /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/;
const ISRC_SHAPE = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;
const RELEASE_FIELD_NAMES = [
  "releaseType",
  "language",
  "explicit",
  "labelName",
  "earlyAccessStartAt",
  "publicReleaseAt",
  "exclusivityEndAt",
  "upcEan",
  "isrc",
  "contributors",
  "distributionStatus",
  "providerCode",
  "providerReference",
] as const;

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) {
    throw new UploadValidationError("INVALID_RELEASE_METADATA", `${field} is invalid`);
  }
  return normalized;
}

function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new UploadValidationError("INVALID_RELEASE_METADATA", `${field} must be a valid date`);
  }
  return parsed;
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (value === false || String(value).toLowerCase() === "false") return false;
  throw new UploadValidationError("INVALID_RELEASE_METADATA", `${field} must be boolean`);
}

function parseContributors(value: unknown): ReleaseContributorInput[] {
  if (value === undefined || value === null || value === "") return [];

  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      throw new UploadValidationError(
        "INVALID_RELEASE_METADATA",
        "contributors must be a valid JSON array"
      );
    }
  }

  if (!Array.isArray(raw) || raw.length > 50) {
    throw new UploadValidationError(
      "INVALID_RELEASE_METADATA",
      "contributors must be an array with at most 50 entries"
    );
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UploadValidationError(
        "INVALID_RELEASE_METADATA",
        `contributors[${index}] is invalid`
      );
    }
    const record = item as Record<string, unknown>;
    const displayName = String(record.displayName || "").trim();
    const role = String(record.role || "").trim().toUpperCase();
    if (!displayName || displayName.length > 255) {
      throw new UploadValidationError(
        "INVALID_RELEASE_METADATA",
        `contributors[${index}].displayName is invalid`
      );
    }
    if (!CONTRIBUTOR_ROLE_SET.has(role)) {
      throw new UploadValidationError(
        "INVALID_RELEASE_METADATA",
        `contributors[${index}].role is invalid`
      );
    }
    return { displayName, role: role as ContributorRole };
  });
}

export function hasReleaseMetadata(input: Record<string, unknown>): boolean {
  return RELEASE_FIELD_NAMES.some(
    (field) => input[field] !== undefined && input[field] !== null && input[field] !== ""
  );
}

/**
 * Parse optional distribution-ready metadata accepted by the existing single-file
 * Admin upload flow. The current endpoint can only create one recording, so it
 * must not pretend to create an EP/ALBUM aggregate. Multi-track creation belongs
 * to a future explicit release API.
 */
export function validatePhase1ReleaseMetadata(
  input: Record<string, unknown>,
  contentType: "AUDIO" | "VIDEO"
): Phase1ReleaseMetadata | null {
  if (!hasReleaseMetadata(input)) return contentType === "AUDIO" ? {
    releaseType: "SINGLE",
    language: null,
    explicit: false,
    labelName: null,
    earlyAccessStartAt: null,
    publicReleaseAt: null,
    exclusivityEndAt: null,
    upcEan: null,
    isrc: null,
    contributors: [],
  } : null;

  if (contentType !== "AUDIO") {
    throw new UploadValidationError(
      "RELEASE_METADATA_AUDIO_ONLY",
      "Distribution-ready release metadata is supported only for AUDIO uploads in Phase 1"
    );
  }

  if (
    input.distributionStatus !== undefined ||
    input.providerCode !== undefined ||
    input.providerReference !== undefined
  ) {
    throw new UploadValidationError(
      "DISTRIBUTION_WORKFLOW_NOT_AVAILABLE",
      "Distribution workflow fields cannot be set by the Phase-1 upload endpoint"
    );
  }

  const requestedType = String(input.releaseType || "SINGLE").trim().toUpperCase();
  if (!RELEASE_TYPE_SET.has(requestedType)) {
    throw new UploadValidationError("INVALID_RELEASE_TYPE", "releaseType is invalid");
  }
  if (requestedType !== "SINGLE") {
    throw new UploadValidationError(
      "MULTI_TRACK_RELEASE_REQUIRES_RELEASE_API",
      "EP and ALBUM require an explicit multi-track release workflow"
    );
  }

  const language = optionalString(input.language, "language", 50);
  const labelName = optionalString(input.labelName, "labelName", 255);
  const explicit = optionalBoolean(input.explicit, "explicit", false);
  const earlyAccessStartAt = optionalDate(input.earlyAccessStartAt, "earlyAccessStartAt");
  const publicReleaseAt = optionalDate(input.publicReleaseAt, "publicReleaseAt");
  const exclusivityEndAt = optionalDate(input.exclusivityEndAt, "exclusivityEndAt");
  const upcEanRaw = optionalString(input.upcEan, "upcEan", 14);
  const isrcRaw = optionalString(input.isrc, "isrc", 12);

  const upcEan = upcEanRaw ? upcEanRaw.replace(/\s+/g, "") : null;
  if (upcEan && !UPC_EAN_SHAPE.test(upcEan)) {
    throw new UploadValidationError(
      "INVALID_UPC_EAN",
      "upcEan must contain 8, 12, 13 or 14 digits"
    );
  }

  const isrc = isrcRaw ? isrcRaw.replace(/[\s-]+/g, "").toUpperCase() : null;
  if (isrc && !ISRC_SHAPE.test(isrc)) {
    throw new UploadValidationError(
      "INVALID_ISRC",
      "isrc must match the 12-character ISRC shape"
    );
  }

  if (earlyAccessStartAt && publicReleaseAt && publicReleaseAt < earlyAccessStartAt) {
    throw new UploadValidationError(
      "INVALID_RELEASE_DATES",
      "publicReleaseAt cannot be before earlyAccessStartAt"
    );
  }
  if (earlyAccessStartAt && exclusivityEndAt && exclusivityEndAt < earlyAccessStartAt) {
    throw new UploadValidationError(
      "INVALID_RELEASE_DATES",
      "exclusivityEndAt cannot be before earlyAccessStartAt"
    );
  }

  return {
    releaseType: "SINGLE",
    language,
    explicit,
    labelName,
    earlyAccessStartAt,
    publicReleaseAt,
    exclusivityEndAt,
    upcEan,
    isrc,
    contributors: parseContributors(input.contributors),
  };
}
