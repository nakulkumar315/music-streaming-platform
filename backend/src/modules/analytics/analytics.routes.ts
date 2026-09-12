import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";

const router = Router();
const requireFan = requireRoles("FAN");

// Phase-1 fan analytics ingestion is authenticated and must never expose admin
// metrics through the fan namespace. Event durability/aggregation is hardened
// separately in the analytics phase.
router.post("/event", requireAuth, requireFan, (req, res) => {
  res.json({ success: true });
});

export default router;
