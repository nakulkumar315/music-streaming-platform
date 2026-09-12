import { Router } from "express";
import { authLimiter } from "../common/security/rateLimit";
import { AuthController } from "../modules/auth/auth.controller";

const router = Router();
const authController = new AuthController();

router.post("/register", authLimiter, (req, res) =>
  authController.register(req, res)
);

router.post("/login", authLimiter, (req, res) =>
  authController.login(req, res)
);

router.post("/artist/register", authLimiter, (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";

  return res.status(410).json({
    success: false,
    message: "Artist self-registration is available only through the artist onboarding flow.",
    correlationId
  });
});

export default router;
