import { Router, type NextFunction, type Request, type Response } from "express";

class AdminArtistValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AdminArtistValidationError";
    this.code = code;
  }
}

function parseOptionalPercentage(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new AdminArtistValidationError(
      "INVALID_PERCENTAGE",
      `${field} must be between 0 and 100`
    );
  }
  return parsed;
}

function parsePositiveMoney(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AdminArtistValidationError(
      "INVALID_MONEY",
      `${field} must be a positive INR amount`
    );
  }

  const paise = Math.round(parsed * 100);
  if (!Number.isSafeInteger(paise) || Math.abs(parsed * 100 - paise) > 1e-7) {
    throw new AdminArtistValidationError(
      "INVALID_MONEY",
      `${field} must use at most two decimal places`
    );
  }

  return paise / 100;
}

function normalizeHttpUrl(value: unknown, field: string) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new AdminArtistValidationError(
      "INVALID_SOCIAL_LINK",
      `${field} must be a non-empty http(s) URL`
    );
  }

  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("unsupported URL");
    }
    return parsed.toString();
  } catch {
    throw new AdminArtistValidationError(
      "INVALID_SOCIAL_LINK",
      `${field} must be a valid http(s) URL without embedded credentials`
    );
  }
}

function normalizeSocialLinks(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new AdminArtistValidationError(
      "INVALID_SOCIAL_LINKS",
      "socialLinks must be an object of http(s) URLs"
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) {
    throw new AdminArtistValidationError(
      "INVALID_SOCIAL_LINKS",
      "socialLinks must contain at most 20 entries"
    );
  }

  const output: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!/^[a-z0-9_-]{1,40}$/i.test(key)) {
      throw new AdminArtistValidationError(
        "INVALID_SOCIAL_LINKS",
        "socialLinks contains an invalid key"
      );
    }
    output[key] = normalizeHttpUrl(rawValue, `socialLinks.${key}`);
  }
  return output;
}

function normalizeReason(value: unknown, field = "reason") {
  const reason = String(value ?? "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AdminArtistValidationError(
      "INVALID_REASON",
      `${field} must be between 3 and 500 characters`
    );
  }
  return reason;
}

function normalizeSharePair(artistShare: unknown, platformShare: unknown) {
  const artist = Number(artistShare);
  const platform = Number(platformShare);
  if (
    !Number.isInteger(artist) ||
    !Number.isInteger(platform) ||
    artist < 0 ||
    artist > 100 ||
    platform < 0 ||
    platform > 100 ||
    artist + platform !== 100
  ) {
    throw new AdminArtistValidationError(
      "INVALID_REVENUE_SHARE",
      "artistShare and platformShare must be whole percentages between 0 and 100 that total 100"
    );
  }
  return { artistShare: artist, platformShare: platform };
}

function validationFailure(res: Response, req: Request, error: unknown) {
  if (error instanceof AdminArtistValidationError) {
    return res.status(400).json({
      success: false,
      code: error.code,
      message: error.message,
      correlationId: (req as any)?.correlationId || "-",
    });
  }
  throw error;
}

function validateArtistUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const normalized = { ...body };

    const revenueSharePercentage = parseOptionalPercentage(
      body.revenueSharePercentage,
      "revenueSharePercentage"
    );
    if (revenueSharePercentage !== undefined) {
      normalized.revenueSharePercentage = revenueSharePercentage;
    }

    const subscriptionPrice = parsePositiveMoney(
      body.subscriptionPrice,
      "subscriptionPrice"
    );
    if (subscriptionPrice !== undefined) {
      normalized.subscriptionPrice = subscriptionPrice;
    }

    const socialLinks = normalizeSocialLinks(body.socialLinks);
    if (socialLinks !== undefined) normalized.socialLinks = socialLinks;

    req.body = normalized;
    return next();
  } catch (error) {
    return validationFailure(res, req, error);
  }
}

function validateSoftDelete(req: Request, res: Response, next: NextFunction) {
  try {
    req.body = {
      ...(req.body ?? {}),
      reason: normalizeReason(req.body?.reason ?? req.body?.deletionReason),
    };
    return next();
  } catch (error) {
    return validationFailure(res, req, error);
  }
}

function validateRevenueShare(req: Request, res: Response, next: NextFunction) {
  try {
    const pair = normalizeSharePair(
      req.body?.artistShare,
      req.body?.platformShare
    );
    req.body = { ...(req.body ?? {}), ...pair };
    return next();
  } catch (error) {
    return validationFailure(res, req, error);
  }
}

function validateOptionalRevenueShare(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const artistProvided = req.body?.artistShare !== undefined;
  const platformProvided = req.body?.platformShare !== undefined;
  if (!artistProvided && !platformProvided) return next();
  if (artistProvided !== platformProvided) {
    return res.status(400).json({
      success: false,
      code: "INVALID_REVENUE_SHARE",
      message: "artistShare and platformShare must be updated together",
      correlationId: (req as any)?.correlationId || "-",
    });
  }
  return validateRevenueShare(req, res, next);
}

export const adminArtistValidationRouter = Router();

// Put specific control-plane paths before /:id so "revenue-share-config" is
// never interpreted as an artist identifier by this validation layer.
adminArtistValidationRouter.post("/revenue-share-config", validateRevenueShare);
adminArtistValidationRouter.patch("/revenue-share-config", validateRevenueShare);
adminArtistValidationRouter.put(
  "/revenue-share-config/:id",
  validateOptionalRevenueShare
);
adminArtistValidationRouter.patch("/:id/soft-delete", validateSoftDelete);
adminArtistValidationRouter.patch("/:id", validateArtistUpdate);

export const adminArtistValidation = {
  parseOptionalPercentage,
  parsePositiveMoney,
  normalizeSocialLinks,
  normalizeReason,
  normalizeSharePair,
};
