import "dotenv/config";
import { pool } from "../common/db";
import { reconcilePendingRefunds } from "../modules/payment/payment.refund.service";
import { reconcileProviderRefundDrift } from "../modules/payment/payment.refund.reconciliation";

async function main() {
  const limitArg = Number(process.argv[2] || 50);
  const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(100, Math.floor(limitArg))) : 50;

  const pending = await reconcilePendingRefunds(undefined, limit);
  const providerDrift = await reconcileProviderRefundDrift(undefined, limit);

  const completed = pending.filter((item) => item.status === "COMPLETED").length;
  const correctedProviderDrift = providerDrift.filter(
    (item) => item.status === "CORRECTED_FULL_REFUND"
  ).length;
  const anomalies = providerDrift.filter((item) =>
    [
      "PARTIAL_REFUND_DETECTED",
      "FULL_REFUND_REFERENCE_UNRESOLVED",
      "RECONCILIATION_ERROR",
    ].includes(item.status)
  );
  const errors = [
    ...pending.filter((item) => item.status === "RECONCILIATION_ERROR"),
    ...providerDrift.filter((item) => item.status === "RECONCILIATION_ERROR"),
  ];

  console.log(
    JSON.stringify(
      {
        pending: {
          scanned: pending.length,
          completed,
          unresolved: pending.filter((item) => item.status !== "COMPLETED").length,
          outcomes: pending,
        },
        providerDrift: {
          scanned: providerDrift.length,
          corrected: correctedProviderDrift,
          anomalies: anomalies.length,
          outcomes: providerDrift,
        },
      },
      null,
      2
    )
  );

  if (errors.length > 0 || anomalies.length > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
