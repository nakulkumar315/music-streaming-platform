import { Router } from "express";
import { requireRoles } from "../../common/auth/requireRoles";
import {
  getRefund,
  initiateRefund,
  listRefundablePayments,
  reconcileRefund,
} from "../../controllers/admin/adminRefundController";

const router = Router();

// Parent /admin/refunds mount enforces authenticated ADMIN or FINANCE.
router.get("/payments", listRefundablePayments);

// Phase 1 accepts no client-supplied refund amount: the payment id identifies
// the one authoritative full refund for that captured payment.
router.post("/payments/:paymentId", initiateRefund);
router.get("/:requestId", getRefund);

// Reconciliation is an operational repair action, not a routine finance action.
router.post("/:requestId/reconcile", requireRoles("ADMIN"), reconcileRefund);

export default router;
