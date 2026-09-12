import { Response } from "express";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";
import {
  getRefundRequest,
  initiateFullRefund,
  reconcileRefundRequest,
} from "../../modules/payment/payment.refund.service";
import { PaymentDomainError } from "../../modules/payment/payment.service";

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof PaymentDomainError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
  logger.error({ error }, fallback);
  return res.status(500).json({
    success: false,
    code: "REFUND_OPERATION_FAILED",
    message: fallback,
  });
}

function serialize(request: any) {
  return {
    id: request.id,
    paymentId: request.paymentId,
    subscriptionId: request.subscriptionId,
    userId: request.userId,
    amount: request.amountPaise,
    currency: request.currency,
    status: request.status,
    providerRefundId: request.providerRefundId,
    providerStatus: request.providerStatus,
    failureCode: request.failureCode,
    completedAt: request.completedAt,
  };
}

export const initiateRefund = async (req: any, res: Response) => {
  const correlationId = req?.correlationId || "-";
  const actorId = Number(req.user?.id);
  const role = String(req.user?.role || "").toUpperCase();

  // Phase 1 is full-refund only. Do not accept an amount that could override
  // the authoritative captured payment amount.
  if (
    req.body?.amount !== undefined ||
    req.body?.refundAmount !== undefined ||
    req.body?.refund_amount !== undefined
  ) {
    return res.status(400).json({
      success: false,
      code: "REFUND_AMOUNT_NOT_ACCEPTED",
      message: "Refund amount is derived from the captured payment",
      correlationId,
    });
  }

  try {
    const result = await initiateFullRefund(String(req.params.paymentId || ""), {
      userId: actorId,
      role: role as "ADMIN" | "FINANCE",
    });

    const completed = result.request.status === "COMPLETED";
    AuditService.log({
      action: completed ? "REFUND_COMPLETED" : "REFUND_INITIATED",
      entity: "refund_request",
      entityId: result.request.id,
      performedBy: actorId,
      role: role.toLowerCase() as any,
      status: completed ? "success" : "pending",
      correlationId,
      metadata: {
        payment_id: result.request.paymentId,
        subscription_id: result.request.subscriptionId,
        provider_refund_id: result.request.providerRefundId,
        refund_status: result.request.status,
        idempotent: result.idempotent,
      },
    });

    const httpStatus = completed ? 200 : 202;
    return res.status(httpStatus).json({
      success: true,
      refund: serialize(result.request),
      idempotent: result.idempotent,
      reconciliationRequired:
        result.request.status === "GATEWAY_REQUESTED" ||
        result.request.status === "PROVIDER_PENDING" ||
        result.request.status === "RECONCILIATION_REQUIRED",
      correlationId,
    });
  } catch (error) {
    AuditService.log({
      action: "REFUND_FAILED",
      entity: "payment",
      entityId: String(req.params.paymentId || "unknown"),
      performedBy: Number.isSafeInteger(actorId) ? actorId : undefined,
      role: role.toLowerCase() as any,
      status: "failed",
      correlationId,
      metadata: {
        error_code:
          error instanceof PaymentDomainError ? error.code : "REFUND_OPERATION_FAILED",
      },
    });
    return sendError(res, error, "Failed to initiate refund");
  }
};

export const getRefund = async (req: any, res: Response) => {
  try {
    const request = await getRefundRequest(String(req.params.requestId || ""));
    return res.json({
      success: true,
      refund: serialize(request),
      correlationId: req?.correlationId || "-",
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch refund state");
  }
};

export const reconcileRefund = async (req: any, res: Response) => {
  const correlationId = req?.correlationId || "-";
  try {
    const request = await reconcileRefundRequest(String(req.params.requestId || ""));
    AuditService.log({
      action: "REFUND_RECONCILED",
      entity: "refund_request",
      entityId: request.id,
      performedBy: req.user?.id,
      role: "admin",
      status: request.status === "COMPLETED" ? "success" : "pending",
      correlationId,
      metadata: {
        refund_status: request.status,
        provider_refund_id: request.providerRefundId,
      },
    });
    return res.status(request.status === "COMPLETED" ? 200 : 202).json({
      success: true,
      refund: serialize(request),
      correlationId,
    });
  } catch (error) {
    return sendError(res, error, "Failed to reconcile refund");
  }
};
