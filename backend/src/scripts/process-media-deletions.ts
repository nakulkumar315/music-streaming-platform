import { processMediaDeletionQueue } from "../modules/privacy/media-deletion.service";

function batchArg(): number | undefined {
  const raw = process.argv.find((arg) => arg.startsWith("--batch="));
  if (!raw) return undefined;
  const parsed = Number(raw.slice("--batch=".length));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const result = await processMediaDeletionQueue(batchArg());
  console.log(JSON.stringify({ operation: "phase09b-media-deletion", ...result }, null, 2));
  if (result.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error("Phase 09B media deletion worker failed", error);
  process.exit(1);
});
