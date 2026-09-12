import "dotenv/config";
import { pool } from "../common/db";
import { reconcilePendingRefunds } from "../modules/payment/payment.refund.service";

async function main() {
  const limitArg = Number(process.argv[2] || 50);
  const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(200, Math.floor(limitArg))) : 50;

  const outcomes = await reconcilePendingRefunds(undefined, limit);
  const completed = outcomes.filter((item) => item.status === "COMPLETED").length;
  const unresolved = outcomes.filter((item) => item.status !== "COMPLETED").length;

  console.log(
    JSON.stringify(
      {
        scanned: outcomes.length,
        completed,
        unresolved,
        outcomes,
      },
      null,
      2
    )
  );

  if (outcomes.some((item) => item.status === "RECONCILIATION_ERROR")) {
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
