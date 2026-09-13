import type { NextFunction, Request, Response } from "express";

const MAX_FEATURES = 8;
const MAX_FEATURE_LENGTH = 100;

export type NormalizedArtistPricingInput = {
  subscriptionPrice: number;
  yearlySubscriptionPrice?: number;
  subscriptionFeatures?: string[];
};

export class ArtistPricingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtistPricingValidationError";
  }
}

function parsePositiveRupees(value: unknown, field: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ArtistPricingValidationError(`${field} must be a positive INR amount`);
  }

  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || Math.abs(amount * 100 - paise) > 1e-7) {
    throw new ArtistPricingValidationError(`${field} must use at most two decimal places`);
  }

  return paise / 100;
}

function normalizeFeatures(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ArtistPricingValidationError("subscriptionFeatures must be an array");
  }
  if (value.length > MAX_FEATURES) {
    throw new ArtistPricingValidationError(
      `subscriptionFeatures must contain at most ${MAX_FEATURES} items`
    );
  }

  return value.map((item, index) => {
    const feature = String(item ?? "").trim();
    if (!feature) {
      throw new ArtistPricingValidationError(
        `subscriptionFeatures[${index}] must not be empty`
      );
    }
    if (feature.length > MAX_FEATURE_LENGTH) {
      throw new ArtistPricingValidationError(
        `subscriptionFeatures[${index}] must be at most ${MAX_FEATURE_LENGTH} characters`
      );
    }
    return feature;
  });
}

export function normalizeArtistPricingInput(
  body: Record<string, unknown> | null | undefined
): NormalizedArtistPricingInput {
  const input = body ?? {};

  for (const unsupported of ["discountPercent", "earlyAccessDays", "contentAccess"]) {
    if (input[unsupported] !== undefined) {
      throw new ArtistPricingValidationError(
        `${unsupported} is not an editable Phase-1 artist pricing field`
      );
    }
  }

  const normalized: NormalizedArtistPricingInput = {
    subscriptionPrice: parsePositiveRupees(
      input.subscriptionPrice,
      "subscriptionPrice"
    ),
  };

  if (
    input.yearlySubscriptionPrice !== undefined &&
    input.yearlySubscriptionPrice !== null &&
    input.yearlySubscriptionPrice !== ""
  ) {
    normalized.yearlySubscriptionPrice = parsePositiveRupees(
      input.yearlySubscriptionPrice,
      "yearlySubscriptionPrice"
    );
  }

  const features = normalizeFeatures(input.subscriptionFeatures);
  if (features !== undefined) normalized.subscriptionFeatures = features;

  return normalized;
}

export function validateArtistPricingRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    req.body = normalizeArtistPricingInput(req.body as Record<string, unknown>);
    return next();
  } catch (error) {
    if (error instanceof ArtistPricingValidationError) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ARTIST_PRICING",
        message: error.message,
        correlationId: (req as any)?.correlationId || "-",
      });
    }
    return next(error);
  }
}
