import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { authLimiter } from "../../common/security/rateLimit";
import { updatePasswordAndRotateSession } from "../user/password.controller";

const router = Router();

router.patch(
  "/",
  authLimiter,
  requireAuth,
  requireRoles("ARTIST"),
  (req: any, res) => {
    req.body = {
      ...req.body,
      oldPassword: req.body?.oldPassword ?? req.body?.currentPassword,
    };
    return updatePasswordAndRotateSession(req, res);
  }
);

export default router;
