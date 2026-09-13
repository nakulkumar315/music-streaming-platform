import { Router } from "express";
import { getContentForAccess, checkMediaEntitlement, type VisibilityType } from "../../shared/security/media-authz.service";
import {
  isContentEligibleForPlayback,
  normalizeVisibilityForPlayback,
} from "../media/media-policy.service";
import {
  getPlaybackProgress,
  savePlaybackProgress,
} from "./playback-progress.service";

const router = Router();

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function authorizeResume(userId: number, contentId: number) {
  const content = await getContentForAccess(contentId);
  if (!content) {
    return { ok: false as const, status: 404, code: "CONTENT_NOT_FOUND", message: "Content not found" };
  }

  if (
    !isContentEligibleForPlayback({
      technicalStatus: String(content.status || ""),
      lifecycleState: String(content.lifecycle_state || ""),
      isApproved: Boolean(content.is_approved),
      isTakenDown: Boolean(content.is_taken_down),
    })
  ) {
    return { ok: false as const, status: 409, code: "CONTENT_NOT_READY", message: "Content is not available for playback" };
  }

  const visibility = normalizeVisibilityForPlayback(content.visibility || "PROTECTED");
  if (!visibility) {
    return { ok: false as const, status: 403, code: "INVALID_VISIBILITY", message: "Content is not available for playback" };
  }

  const entitlement = await checkMediaEntitlement(
    userId,
    Number(content.artist_id),
    visibility as VisibilityType,
    Boolean(content.subscription_required)
  );
  if (!entitlement.allowed) {
    return {
      ok: false as const,
      status: 403,
      code: entitlement.code || "ACCESS_DENIED",
      message: entitlement.reason || "Playback access denied",
    };
  }

  return { ok: true as const };
}

router.get("/:contentId", async (req: any, res: any) => {
  const userId = positiveInteger(req.user?.id);
  const contentId = positiveInteger(req.params?.contentId);
  if (!userId) return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Unauthorized" });
  if (!contentId) return res.status(400).json({ success: false, code: "INVALID_CONTENT_ID", message: "Invalid content id" });

  const authorized = await authorizeResume(userId, contentId);
  if (!authorized.ok) return res.status(authorized.status).json({ success: false, code: authorized.code, message: authorized.message });

  const progress = await getPlaybackProgress(userId, contentId);
  return res.json({
    success: true,
    progress: progress
      ? {
          contentId: progress.contentId,
          positionMs: progress.positionMs,
          durationMs: progress.durationMs,
          completed: progress.completed,
          updatedAt: progress.updatedAt.toISOString(),
        }
      : null,
  });
});

router.put("/", async (req: any, res: any) => {
  const userId = positiveInteger(req.user?.id);
  const contentId = positiveInteger(req.body?.contentId);
  if (!userId) return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Unauthorized" });
  if (!contentId) return res.status(400).json({ success: false, code: "INVALID_CONTENT_ID", message: "Invalid content id" });

  // Resume progress is authenticated UX state, not a playback authorization
  // credential or trusted analytics signal. Do not couple final pause/switch/
  // background saves to a short-lived stream lease. Current content eligibility
  // and entitlement are still revalidated on every read and write.
  const authorized = await authorizeResume(userId, contentId);
  if (!authorized.ok) return res.status(authorized.status).json({ success: false, code: authorized.code, message: authorized.message });

  const progress = await savePlaybackProgress({
    userId,
    contentId,
    positionMs: req.body?.positionMs,
    durationMs: req.body?.durationMs,
  });

  return res.json({
    success: true,
    progress: {
      contentId: progress.contentId,
      positionMs: progress.positionMs,
      durationMs: progress.durationMs,
      completed: progress.completed,
      updatedAt: progress.updatedAt.toISOString(),
    },
  });
});

export default router;
