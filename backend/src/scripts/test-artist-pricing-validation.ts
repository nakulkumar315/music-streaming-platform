import assert from "node:assert/strict";
import {
  ArtistPricingValidationError,
  normalizeArtistPricingInput,
} from "../modules/artist/artist-pricing.validation";

function expectInvalid(input: Record<string, unknown>, messagePart: string) {
  assert.throws(
    () => normalizeArtistPricingInput(input),
    (error: unknown) =>
      error instanceof ArtistPricingValidationError &&
      error.message.includes(messagePart),
    `Expected invalid pricing input containing: ${messagePart}`
  );
}

function main() {
  assert.deepEqual(normalizeArtistPricingInput({ subscriptionPrice: 9.99 }), {
    subscriptionPrice: 9.99,
  });

  assert.deepEqual(
    normalizeArtistPricingInput({
      subscriptionPrice: "49.50",
      yearlySubscriptionPrice: "499.00",
      subscriptionFeatures: ["Early access", "Support the artist"],
    }),
    {
      subscriptionPrice: 49.5,
      yearlySubscriptionPrice: 499,
      subscriptionFeatures: ["Early access", "Support the artist"],
    }
  );

  expectInvalid({ subscriptionPrice: 0 }, "positive INR amount");
  expectInvalid({ subscriptionPrice: -1 }, "positive INR amount");
  expectInvalid({ subscriptionPrice: Number.NaN }, "positive INR amount");
  expectInvalid({ subscriptionPrice: 1.001 }, "at most two decimal places");
  expectInvalid(
    { subscriptionPrice: 10, earlyAccessDays: 14 },
    "not an editable Phase-1 artist pricing field"
  );
  expectInvalid(
    { subscriptionPrice: 10, discountPercent: 20 },
    "not an editable Phase-1 artist pricing field"
  );
  expectInvalid(
    { subscriptionPrice: 10, contentAccess: "free" },
    "not an editable Phase-1 artist pricing field"
  );
  expectInvalid(
    { subscriptionPrice: 10, subscriptionFeatures: "not-an-array" },
    "must be an array"
  );
  expectInvalid(
    {
      subscriptionPrice: 10,
      subscriptionFeatures: Array.from({ length: 9 }, (_, index) => `Feature ${index}`),
    },
    "at most 8 items"
  );

  console.log("Artist pricing validation checks passed.");
}

main();
