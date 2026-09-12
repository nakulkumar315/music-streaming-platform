import { Response } from "express";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";
import {
  getRefundRequest,
  initiateFullRefund,
  reconcileRefundRequest,
} from "../../modules/payment/payment.refund.service";
import { listPaymentsForRefundReview } from "../../modules/payment/payment.refund.query";
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

function auditRole(role: string): "admin" | "finance" | "system" {
  if (role === "ADMIN") return "admin";
  if (role === "FINANCE") return "finance";
  return "system";
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

export const listRefundablePayments = async (req: any, res: Response) => {
  try {
    const items = await listPaymentsForRefundReview(Number(req.query?.limit || 50));
    return res.json({
      success: true,
      items,
      correlationId: req?.correlationId || "-",
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch payment refund review data");
  }
};

export const initiateRefund = async (req: any, res: Response) => {
  const correlationId = req?.correlationId || "-";
  const actorId = Number(req.user?.id);
  const role = String(req.user?.role || "").toUpperCase();

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
    const failed = result.request.status === "FAILED";
    AuditService.log({
      action: completed
        ? "REFUND_COMPLETED"
        : failed
          ? "REFUND_FAILED"
          : "REFUND_INITIATED",
      entity: "refund_request",
      entityId: result.request.id,
      performedBy: actorId,
      role: auditRole(role),
      status: completed ? "success" : failed ? "failed" : "pending",
      correlationId,
      metadata: {
        payment_id: result.request.paymentId,
        subscription_id: result.request.subscriptionId,
        provider_refund_id: result.request.providerRefundId,
        refund_status: result.request.status,
        idempotent: result.idempotent,
      },
    });

    if (failed) {
      return res.status(409).json({
        success: false,
        code: result.request.failureCode || "REFUND_FAILED",
        message: "The existing refund request is in a failed state and was not sent again",
        refund: serialize(result.request),
        idempotent: true,
        correlationId,
      });
    }

    return res.status(completed ? 200 : 202).json({
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
      role: auditRole(role),
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
      status:
        request.status === "COMPLETED"
          ? "success"
          : request.status === "FAILED"
            ? "failed"
            : "pending",
      correlationId,
      metadata: {
        refund_status: request.status,
        provider_refund_id: request.providerRefundId,
      },
    });

    if (request.status === "FAILED") {
      return res.status(409).json({
        success: false,
        code: request.failureCode || "REFUND_FAILED",
        message: "Provider reconciliation confirms that the refund failed",
        refund: serialize(request),
        correlationId,
      });
    }

    return res.status(request.status === "COMPLETED" ? 200 : 202).json({
      success: true,
      refund: serialize(request),
      correlationId,
    });
  } catch (error) {
    return sendError(res, error, "Failed to reconcile refund");
  }
};
