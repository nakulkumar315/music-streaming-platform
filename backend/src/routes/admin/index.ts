import { Router } from "express";
import adminAuthRoutes from "./auth";
import adminAccountSecurityRoutes from "./account-security";
import adminAnalyticsRoutes from "./analytics";
import adminArtistApprovalsRoutes from "./artist-approvals";
import adminArtistsRoutes from "./artists";
import adminContentRoutes from "./content";
import adminMediaRoutes from "./media";
import adminFeaturedArtistsRoutes from "./featured-artists";
import adminRefundRoutes from "./refunds";
import adminSubscriptionRoutes from "./subscriptions";
import adminAuditRoutes from "./audit";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { adminArtistValidationRouter } from "../../modules/admin/admin-artist.validation";
import adminGovernanceConfigRoutes from "../../modules/admin/admin-governance-config.routes";
import adminArtistGovernanceRoutes from "../../modules/admin/admin-artist-governance.routes";
import adminArtistAgreementRoutes from "../../modules/admin/admin-artist-agreement.routes";

const router = Router();

router.use("/", adminAuthRoutes);
router.use("/", adminAccountSecurityRoutes);

router.use("/", requireAuth, requireRoles("ADMIN"), adminArtistApprovalsRoutes);
router.use("/analytics", requireAuth, requireRoles("ADMIN"), adminAnalyticsRoutes);

// Preserve the Phase 07 validation boundary before every Phase 08 artist/config
// command. The strict governance routers then persist mutation + audit in one
// transaction, and the historical router remains only as a compatibility tail.
router.use(
  "/artists",
  requireAuth,
  requireRoles("ADMIN"),
  adminArtistValidationRouter,
  adminGovernanceConfigRoutes,
  adminArtistAgreementRoutes,
  adminArtistGovernanceRoutes,
  adminArtistsRoutes
);
router.use(
  "/content",
  requireAuth,
  requireRoles("ADMIN", "MODERATOR"),
  adminContentRoutes
);
router.use("/media", requireAuth, requireRoles("ADMIN"), adminMediaRoutes);
router.use(
  "/featured-artists",
  requireAuth,
  requireRoles("ADMIN"),
  adminFeaturedArtistsRoutes
);
router.use(
  "/refunds",
  requireAuth,
  requireRoles("ADMIN", "FINANCE"),
  adminRefundRoutes
);
router.use(
  "/subscriptions",
  requireAuth,
  requireRoles("ADMIN"),
  adminSubscriptionRoutes
);
router.use("/audit", requireAuth, requireRoles("ADMIN"), adminAuditRoutes);

export default router;