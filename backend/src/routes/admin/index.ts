import { Router } from "express";
import adminAuthRoutes from "./auth";
import adminAnalyticsRoutes from "./analytics";
import adminArtistApprovalsRoutes from "./artist-approvals";
import adminArtistsRoutes from "./artists";
import adminContentRoutes from "./content";
import adminFeaturedArtistsRoutes from "./featured-artists";
import adminImageUploadRoutes from "./image-upload";
import adminSubscriptionRoutes from "./subscriptions";
import adminAuditRoutes from "./audit";
import { requireAuth } from "../../common/auth/requireAuth";

const router = Router();

// Authentication endpoints are the only public routes under /admin.
router.use("/", adminAuthRoutes);

// Everything mounted after this point requires a valid server-backed session.
router.use(requireAuth);
router.use("/", adminArtistApprovalsRoutes);
router.use("/analytics", adminAnalyticsRoutes);
router.use("/artists", adminArtistsRoutes);
router.use("/content", adminContentRoutes);
router.use("/featured-artists", adminFeaturedArtistsRoutes);
router.use("/upload-image", adminImageUploadRoutes);
router.use("/subscriptions", adminSubscriptionRoutes);
router.use("/audit", adminAuditRoutes);

export default router;
