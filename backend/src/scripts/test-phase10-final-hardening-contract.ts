import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`[phase10] ${message}`);
};

const app = read("src/app.ts");
const env = read("src/config/env.validation.ts");
const onboarding = read("src/modules/artist/artist-onboarding.routes.ts");
const artistRoutes = read("src/routes/artist.ts");
const packageJson = JSON.parse(read("package.json"));

assert(app.includes('.split("?", 1)[0]'), "global error logging must strip request query strings");
assert(!artistRoutes.includes("safeRows"), "canonical artist routes must not use fail-open DB helpers");
assert(!artistRoutes.includes("safeScalarNumber"), "canonical artist routes must not fabricate zero metrics on DB failure");
assert(!artistRoutes.includes("SIGNATURE_ENCRYPTION_KEY"), "legacy signature crypto must not remain in the compatibility router");
assert(!artistRoutes.includes("jwt.sign"), "legacy artist onboarding token issuance must not remain in the compatibility router");
assert(artistRoutes.includes('WHERE is_active = TRUE'), "public commission/terms metadata must query active canonical records");

assert(env.includes('envStr("SIGNATURE_ENCRYPTION_KEY")'), "signature encryption key must be required by canonical runtime validation");
assert(onboarding.includes('process.env.SIGNATURE_ENCRYPTION_KEY || ""'), "authoritative onboarding must require configured signature encryption");
assert(!onboarding.includes("return signature"), "authoritative onboarding must never fall back to plaintext signatures");

const unit = String(packageJson?.scripts?.["test:unit"] || "");
for (const required of [
  "test:payment-integrity",
  "test:auth-hardening",
  "test:content-media-governance",
  "test:phase07-web-contract",
  "test:phase08-operational",
  "test:phase09-distribution-domain",
  "test:phase09a-adaptive-media",
  "test:phase09b-privacy-recovery",
]) {
  assert(unit.includes(required), `test:unit must retain ${required}`);
}

console.log("Phase 10 final hardening source contract: PASS");
