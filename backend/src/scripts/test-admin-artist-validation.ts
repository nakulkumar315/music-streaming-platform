import assert from "node:assert/strict";
import { adminArtistValidation } from "../modules/admin/admin-artist.validation";

function main() {
  assert.equal(
    adminArtistValidation.parsePositiveMoney(49.99, "subscriptionPrice"),
    49.99
  );
  assert.throws(
    () => adminArtistValidation.parsePositiveMoney(0, "subscriptionPrice"),
    /positive INR amount/
  );
  assert.throws(
    () => adminArtistValidation.parsePositiveMoney(10.001, "subscriptionPrice"),
    /two decimal places/
  );

  assert.equal(
    adminArtistValidation.parseOptionalPercentage(55, "revenueSharePercentage"),
    55
  );
  assert.throws(
    () =>
      adminArtistValidation.parseOptionalPercentage(
        101,
        "revenueSharePercentage"
      ),
    /between 0 and 100/
  );

  assert.deepEqual(
    adminArtistValidation.normalizeSocialLinks({
      spotify: "https://open.spotify.com/artist/example",
      website: "http://example.test/profile",
    }),
    {
      spotify: "https://open.spotify.com/artist/example",
      website: "http://example.test/profile",
    }
  );
  assert.throws(
    () =>
      adminArtistValidation.normalizeSocialLinks({
        website: "javascript:alert(1)",
      }),
    /valid http\(s\) URL/
  );
  assert.throws(
    () =>
      adminArtistValidation.normalizeSocialLinks({
        website: "https://user:secret@example.test/profile",
      }),
    /without embedded credentials/
  );

  assert.equal(
    adminArtistValidation.normalizeReason("Policy violation", "reason"),
    "Policy violation"
  );
  assert.throws(
    () => adminArtistValidation.normalizeReason("x", "reason"),
    /between 3 and 500/
  );
  assert.throws(
    () => adminArtistValidation.normalizeReason("x".repeat(501), "reason"),
    /between 3 and 500/
  );

  assert.deepEqual(adminArtistValidation.normalizeSharePair(55, 45), {
    artistShare: 55,
    platformShare: 45,
  });
  assert.throws(
    () => adminArtistValidation.normalizeSharePair(55.5, 44.5),
    /whole percentages/
  );
  assert.throws(
    () => adminArtistValidation.normalizeSharePair(70, 40),
    /total 100/
  );

  console.log("Admin artist validation checks passed.");
}

main();
