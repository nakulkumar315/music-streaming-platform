import Razorpay from "razorpay";
import { PaymentDomainError } from "./payment.service";

export type GatewayRefund = {
  id: string;
  paymentId: string;
  amountPaise: number;
  currency: string;
  status: string;
  notes: Record<string, unknown>;
  createdAt?: number;
};

export type GatewayPaymentRefundState = {
  paymentId: string;
  amountPaise: number;
  amountRefundedPaise: number;
  currency: string;
  status: string;
  refundStatus: string | null;
};

export interface RefundGateway {
  createFullRefund(input: {
    paymentId: string;
    amountPaise: number;
    refundRequestId: string;
    idempotencyKey: string;
  }): Promise<GatewayRefund>;
  listRefunds(paymentId: string): Promise<GatewayRefund[]>;
  fetchPayment(paymentId: string): Promise<GatewayPaymentRefundState>;
}

function client() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keyId || !keySecret) {
    throw new PaymentDomainError(
      500,
      "PAYMENT_CONFIGURATION_ERROR",
      "Payment gateway is not configured"
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function normalizeRefund(entity: any): GatewayRefund {
  const amountPaise = Number(entity?.amount);
  if (!entity?.id || !entity?.payment_id || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new PaymentDomainError(
      502,
      "INVALID_GATEWAY_REFUND_RESPONSE",
      "Payment gateway returned an invalid refund response"
    );
  }

  return {
    id: String(entity.id),
    paymentId: String(entity.payment_id),
    amountPaise,
    currency: String(entity.currency || "INR").toUpperCase(),
    status: String(entity.status || "unknown").toLowerCase(),
    notes:
      entity.notes && typeof entity.notes === "object" && !Array.isArray(entity.notes)
        ? entity.notes
        : {},
    createdAt: Number.isFinite(Number(entity.created_at)) ? Number(entity.created_at) : undefined,
  };
}

export const razorpayRefundGateway: RefundGateway = {
  async createFullRefund(input) {
    const razorpay = client();
    const refund = await razorpay.payments.refund(input.paymentId, {
      amount: input.amountPaise,
      notes: {
        refund_request_id: input.refundRequestId,
        idempotency_key: input.idempotencyKey,
        refund_scope: "phase1_full_refund",
      },
    });
    return normalizeRefund(refund);
  },

  async listRefunds(paymentId) {
    const razorpay = client();
    const collection = await razorpay.payments.fetchMultipleRefund(paymentId, {
      count: 100,
      skip: 0,
    });
    const items = Array.isArray((collection as any)?.items) ? (collection as any).items : [];
    return items.map(normalizeRefund);
  },

  async fetchPayment(paymentId) {
    const razorpay = client();
    const payment = await razorpay.payments.fetch(paymentId);
    const amountPaise = Number((payment as any)?.amount);
    const amountRefundedPaise = Number((payment as any)?.amount_refunded ?? 0);
    if (
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0 ||
      !Number.isSafeInteger(amountRefundedPaise) ||
      amountRefundedPaise < 0
    ) {
      throw new PaymentDomainError(
        502,
        "INVALID_GATEWAY_PAYMENT_RESPONSE",
        "Payment gateway returned an invalid payment state"
      );
    }

    return {
      paymentId: String((payment as any).id || paymentId),
      amountPaise,
      amountRefundedPaise,
      currency: String((payment as any)?.currency || "INR").toUpperCase(),
      status: String((payment as any)?.status || "unknown").toLowerCase(),
      refundStatus: (payment as any)?.refund_status
        ? String((payment as any).refund_status).toLowerCase()
        : null,
    };
  },
};
