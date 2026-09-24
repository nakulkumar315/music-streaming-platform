import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { authLimiter } from "../../common/security/rateLimit";
import { UserController } from "./user.controller";
import { updatePasswordAndRotateSession } from "./password.controller";

import multer from "multer";

const router = Router();
const userController = new UserController();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 10 } // 10MB limit
});

export const publicUserRouter = Router();
publicUserRouter.get("/avatar/:id", (req, res) => userController.getAvatar(req as any, res));

router.get("/avatar/:id", (req, res) => userController.getAvatar(req as any, res));
router.get("/profile", requireAuth, (req, res) => userController.profile(req as any, res));
router.get("/transactions", requireAuth, (req, res) => userController.transactions(req as any, res));
router.put("/update", requireAuth, (req, res) => userController.update(req as any, res));
router.put("/update-password", authLimiter, requireAuth, updatePasswordAndRotateSession);
router.put("/settings", requireAuth, (req, res) => userController.updateSettings(req as any, res));
router.get("/transactions/:id/invoice", requireAuth, (req, res) => userController.invoice(req as any, res));
router.post("/profile-image", requireAuth, upload.single("image"), (req, res) => userController.updateProfileImage(req as any, res));
router.get("/listen-time", requireAuth, (req, res) => userController.getListenTime(req as any, res));

export default router;
