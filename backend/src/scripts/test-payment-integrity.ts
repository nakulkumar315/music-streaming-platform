import assert from "assert";
import crypto from "crypto";
import { rupeesToPaise } from "../modules/payment/payment.service";
import {
  deriveWebhookEventId,
  parseVerifiedWebhookPayload,
  safeEqualHex,
  verifyWebhookSignature,
} from "../modules/payment/payment.security";

function expectThrows(fn: () => unknown, label: string) {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  assert.strictEqual(thrown, true, label);
}

function run() {
  // Canonical money representation: configured INR rupees -> integer paise.
  assert.strictEqual(rupeesToPaise(99), 9900);
  assert.strictEqual(rupeesToPaise("49.50"), 4950);
  assert.strictEqual(rupeesToPaise("1.01"), 101);
  expectThrows(
    () => rupeesToPaise(0),
    "Phase-1 subscription price must not silently become a free plan"
  );
  expectThrows(
    () => rupeesToPaise(-1),
    "negative subscription price must be rejected"
  );
  expectThrows(
    () => rupeesToPaise("not-a-price"),
    "non-numeric subscription price must be rejected"
  );

  assert.strictEqual(safeEqualHex("aa", "aa"), true);
  assert.strictEqual(safeEqualHex("aa", "ab"), false);
  assert.strictEqual(safeEqualHex("not-hex", "not-hex"), false);
  assert.strictEqual(safeEqualHex("aa", "aaaa"), false);

  const webhookSecret = "test-webhook-secret";
  const raw = Buffer.from(
    JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_test_456",
            order_id: "order_test_123",
            amount: 9900,
            currency: "INR",
          },
        },
      },
    }),
    "utf8"
  );
  const signature = crypto
    .createHmac("sha256", webhookSecret)
    .update(raw)
    .digest("hex");

  assert.strictEqual(verifyWebhookSignature(raw, signature, webhookSecret), true);
  assert.strictEqual(
    verifyWebhookSignature(
      Buffer.from(`${raw.toString("utf8")} `, "utf8"),
      signature,
      webhookSecret
    ),
    false,
    "signature verification must use the exact original raw bytes"
  );
  assert.strictEqual(
    verifyWebhookSignature(raw, "00".repeat(32), webhookSecret),
    false,
    "invalid signature must fail"
  );
  expectThrows(
    () => verifyWebhookSignature(raw, signature, ""),
    "missing webhook secret must fail closed"
  );

  const payload = parseVerifiedWebhookPayload(raw);
  assert.strictEqual(payload.event, "payment.captured");

  const eventId1 = deriveWebhookEventId(raw, payload);
  const eventId2 = deriveWebhookEventId(raw, payload);
  assert.strictEqual(eventId1, eventId2);
  assert.strictEqual(eventId1.length, 64);

  const rawWithExplicitId = Buffer.from(
    JSON.stringify({ id: "evt_123", event: "payment.captured" }),
    "utf8"
  );
  assert.strictEqual(
    deriveWebhookEventId(
      rawWithExplicitId,
      parseVerifiedWebhookPayload(rawWithExplicitId)
    ),
    "evt_123"
  );

  expectThrows(
    () => parseVerifiedWebhookPayload(Buffer.from("not-json")),
    "malformed webhook JSON must be rejected"
  );
  expectThrows(
    () => parseVerifiedWebhookPayload(Buffer.from(JSON.stringify({ foo: "bar" }))),
    "webhook without event must be rejected"
  );

  console.log("Payment integrity tests passed");
}

run();
