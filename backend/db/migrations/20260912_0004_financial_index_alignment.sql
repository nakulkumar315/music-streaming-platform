-- Normalize financial uniqueness so the SQL schema and Prisma model describe
-- the same constraints. PostgreSQL UNIQUE indexes permit multiple NULL values,
-- so partial predicates are unnecessary for nullable gateway identifiers.

DROP INDEX IF EXISTS idx_transactions_razorpay_order;
CREATE UNIQUE INDEX idx_transactions_razorpay_order
  ON transactions(razorpay_order_id);

DROP INDEX IF EXISTS idx_transactions_razorpay_payment;
CREATE UNIQUE INDEX idx_transactions_razorpay_payment
  ON transactions(razorpay_payment_id);

DROP INDEX IF EXISTS idx_payments_razorpay_payment;
CREATE UNIQUE INDEX idx_payments_razorpay_payment
  ON payments(razorpay_payment_id);
