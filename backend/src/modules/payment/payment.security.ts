import crypto from "crypto";
import { PaymentDomainError } from "./payment.service";

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

export function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  const expected = String(expectedHex || "").trim();
  const received = String(receivedHex || "").trim();

  if (
    expected.length !== received.length ||
    !isHex(expected) ||
    !isHex(received)
  ) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): boolean {
  const key = String(secret || "").trim();
  if (!key) {
    throw new PaymentDomainError(
      500,
      "PAYMENT_CONFIGURATION_ERROR",
      "Payment verification is not configured"
    );
  }

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${orderId}|${paymentId}`, "utf8")
    .digest("hex");
  return safeEqualHex(expected, signature);
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  const key = String(secret || "").trim();
  if (!key) {
    throw new PaymentDomainError(
      500,
      "WEBHOOK_CONFIGURATION_ERROR",
      "Payment webhook verification is not configured"
    );
  }
  if (!Buffer.isBuffer(rawBody)) return false;

  const expected = crypto
    .createHmac("sha256", key)
    .update(rawBody)
    .digest("hex");
  return safeEqualHex(expected, signature);
}

export function parseVerifiedWebhookPayload(rawBody: Buffer): any {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Webhook payload must be an object");
    }
    if (typeof parsed.event !== "string" || !parsed.event.trim()) {
      throw new Error("Webhook event is missing");
    }
    return parsed;
  } catch (error: any) {
    throw new PaymentDomainError(
      400,
      "INVALID_WEBHOOK_PAYLOAD",
      error?.message || "Webhook payload is invalid"
    );
  }
}

export function deriveWebhookEventId(rawBody: Buffer, payload: any): string {
  const explicitId = String(payload?.id ?? "").trim();
  if (explicitId) return explicitId.slice(0, 100);

  // Razorpay webhook envelopes do not consistently expose a top-level event id.
  // Hashing the exact verified raw payload gives deterministic replay protection
  // without trusting mutable parsed fields.
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}
