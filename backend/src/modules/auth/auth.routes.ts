import { Router } from "express";
import { AuthController } from "./auth.controller";
import { requireAuth } from "../../common/auth/requireAuth";
import { authLimiter } from "../../common/security/rateLimit";

const router = Router();
const authController = new AuthController();

router.post("/register", authLimiter, (req, res) =>
  authController.register(req, res)
);

router.post("/login", authLimiter, (req, res) =>
  authController.login(req, res)
);

router.get("/session", requireAuth, (req, res) =>
  authController.session(req, res)
);

router.get("/sessions", requireAuth, (req, res) =>
  authController.sessions(req, res)
);

router.delete("/sessions/:sessionId", requireAuth, (req, res) =>
  authController.revokeSession(req, res)
);

router.post("/logout", requireAuth, (req, res) =>
  authController.logout(req, res)
);

router.post("/logout-all", requireAuth, (req, res) =>
  authController.logoutAll(req, res)
);

export default router;
