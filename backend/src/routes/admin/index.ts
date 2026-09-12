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
import { requireRoles } from "../../common/auth/requireRoles";

const router = Router();

// Authentication endpoints are the only public routes under /admin.
router.use("/", adminAuthRoutes);

// Every privileged route requires both a valid server-backed session and an
// explicit role boundary. Child routers may keep narrower guards for endpoint-
// specific permissions, but they must never broaden these mount-level rules.
router.use("/", requireAuth, requireRoles("ADMIN"), adminArtistApprovalsRoutes);
router.use("/analytics", requireAuth, requireRoles("ADMIN"), adminAnalyticsRoutes);
router.use("/artists", requireAuth, requireRoles("ADMIN"), adminArtistsRoutes);
router.use(
  "/content",
  requireAuth,
  requireRoles("ADMIN", "MODERATOR"),
  adminContentRoutes
);
router.use(
  "/featured-artists",
  requireAuth,
  requireRoles("ADMIN"),
  adminFeaturedArtistsRoutes
);
router.use(
  "/upload-image",
  requireAuth,
  requireRoles("ADMIN"),
  adminImageUploadRoutes
);
router.use(
  "/subscriptions",
  requireAuth,
  requireRoles("ADMIN"),
  adminSubscriptionRoutes
);
router.use("/audit", requireAuth, requireRoles("ADMIN"), adminAuditRoutes);

export default router;
