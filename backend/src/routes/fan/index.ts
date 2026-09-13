import { Router } from "express";

import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import authRoutes from "../../modules/auth/auth.routes";
import userRoutes from "../../modules/user/user.routes";
import trustedListenTimeRoutes from "../../modules/user/listen-time.routes";
import artistRoutes from "../../modules/artist/public-artist.routes";
import contentRoutes from "../../modules/content/content.routes";
import streamRoutes from "../../modules/streaming/stream.routes";
import subRoutes from "../../modules/subscription/sub.routes";
import analyticsRoutes from "../../modules/analytics/analytics.routes";
import libraryRoutes from "../../modules/library/library.routes";
import playbackProgressRoutes from "../../modules/library/playback-progress.routes";

const router = Router();
const requireFan = requireRoles("FAN");

router.use("/auth", authRoutes);

// Private fan account domains are mounted behind an explicit FAN boundary.
// Trusted listening-time shadows the legacy user handler so raw sessions/play
// counts can never be used as a fallback analytics source.
router.use("/user", requireAuth, requireFan, trustedListenTimeRoutes);
router.use("/user", requireAuth, requireFan, userRoutes);
router.use("/subscriptions", requireAuth, requireFan, subRoutes);
router.use("/subs", requireAuth, requireFan, subRoutes);
router.use("/library", requireAuth, requireFan, libraryRoutes);
router.use("/playback-progress", requireAuth, requireFan, playbackProgressRoutes);

router.use("/artists", artistRoutes);
router.use("/content", contentRoutes);
router.use("/stream", streamRoutes);
router.use("/analytics", analyticsRoutes);

export default router;
