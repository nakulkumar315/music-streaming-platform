-- Phase 01A: durable full-refund intent and reconciliation ledger.
-- Greenfield contract: one logical full refund per captured payment.

CREATE TABLE refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL,
  subscription_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  razorpay_payment_id VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(40) NOT NULL,
  provider_refund_id VARCHAR(255),
  provider_status VARCHAR(40),
  requested_by INTEGER,
  requested_by_role VARCHAR(20) NOT NULL,
  failure_code VARCHAR(100),
  failure_message TEXT,
  provider_snapshot JSONB,
  last_reconciled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_refund_requests_payment
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_subscription
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT refund_requests_payment_unique UNIQUE (payment_id),
  CONSTRAINT refund_requests_gateway_payment_unique UNIQUE (razorpay_payment_id),
  CONSTRAINT refund_requests_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT refund_requests_provider_refund_unique UNIQUE (provider_refund_id),
  CONSTRAINT refund_requests_amount_positive CHECK (amount > 0),
  CONSTRAINT refund_requests_status_valid CHECK (
    status IN (
      'REQUESTED',
      'GATEWAY_REQUESTED',
      'PROVIDER_PENDING',
      'COMPLETED',
      'FAILED',
      'RECONCILIATION_REQUIRED'
    )
  ),
  CONSTRAINT refund_requests_requested_by_role_valid CHECK (
    requested_by_role IN ('ADMIN', 'FINANCE', 'SYSTEM')
  )
);

CREATE INDEX idx_refund_requests_reconciliation
  ON refund_requests (status, updated_at)
  WHERE status IN ('GATEWAY_REQUESTED', 'PROVIDER_PENDING', 'RECONCILIATION_REQUIRED');

CREATE INDEX idx_refund_requests_subscription
  ON refund_requests (subscription_id, created_at DESC);
