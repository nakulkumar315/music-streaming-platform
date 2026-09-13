import { Router } from "express";
import { requireAuth } from "../common/auth/requireAuth";
import { generatePlaybackUrl } from "../controllers/media/PlaybackController";

const router = Router();

// Media upload is an ADMIN-governed operation under /api/v1/admin/media.
// Provider webhooks are mounted as raw-body routes in app.ts before JSON parsing.
router.get("/:id/playback", requireAuth, generatePlaybackUrl);

export default router;
