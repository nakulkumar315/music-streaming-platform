import { queueContentPhysicalDeletion } from "../modules/privacy/media-deletion.service";

function value(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const contentId = Number(value("content-id"));
  const requestedByRaw = value("requested-by");
  const requestedBy = requestedByRaw ? Number(requestedByRaw) : undefined;
  const confirmation = String(value("confirm") || "");

  if (!Number.isSafeInteger(contentId) || contentId <= 0) {
    throw new Error("--content-id must be a positive integer");
  }
  if (requestedBy !== undefined && (!Number.isSafeInteger(requestedBy) || requestedBy <= 0)) {
    throw new Error("--requested-by must be a positive integer when supplied");
  }
  if (confirmation !== `DELETE-CONTENT-${contentId}`) {
    throw new Error(`Destructive confirmation required: --confirm=DELETE-CONTENT-${contentId}`);
  }

  const result = await queueContentPhysicalDeletion(contentId, requestedBy);
  console.log(JSON.stringify({ operation: "phase09b-content-physical-deletion", ...result }, null, 2));
}

main().catch((error) => {
  console.error("Phase 09B content physical-deletion request failed", error);
  process.exit(1);
});
