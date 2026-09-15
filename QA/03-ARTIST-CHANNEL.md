# 03 — Artist Onboarding, Approval, Channel & Pricing

## Scope

Covers Artist application/onboarding, admin approval/rejection, verified/active gating, channel identity/branding, profile assets, read-only content visibility, subscription pricing, channel preview, basic subscriber/earnings visibility and cross-artist ownership.

Important Phase-1 rule: artists do **not** own the binary media-upload workflow. Admin controls content binaries. Artist content view is read-only unless a later approved requirement explicitly changes this.

## Preconditions

Prepare Pending, Approved A, Approved B, Rejected and Suspended artist accounts, plus Admin. Use separate email/device/session data.

## Source/build gates

```bash
cd backend
npm run test:artist-ownership-contract
npm run test:artist-approval-contract
npm run test:artist-pricing-validation
npm run test:admin-artist-validation
npm run test:phase07-web-contract
npm run verify
```

```bash
cd web-artist
npm ci
npm run verify
```

## Onboarding positive cases

| ID | Test | Expected |
|---|---|---|
| ART-POS-001 | submit valid artist application with required identity/profile data | account/application created as pending, not approved/public |
| ART-POS-002 | accept valid current terms and agreement | exact accepted version/signature metadata stored according to current contract |
| ART-POS-003 | admin approves pending artist | artist becomes verified/approved through authoritative backend action; audit emitted |
| ART-POS-004 | approved artist logs in | routed to active dashboard |
| ART-POS-005 | rejected artist resubmits allowed profile/application data | returns to supported review state without overwriting immutable agreement/history incorrectly |
| ART-POS-006 | update display name/bio/accent/social links | changes scoped to own artist and rendered safely |
| ART-POS-007 | upload profile/banner via canonical artist asset route | file validated, provider-backed, stable app URL returned, previous asset cleanup attempted |
| ART-POS-008 | update monthly/yearly pricing where approved | normalized server-side pricing saved; audit created |
| ART-POS-009 | view own content list/history | only own content shown; lifecycle/status correct |
| ART-POS-010 | view subscriber/gross earnings summary | values match authoritative analytics/payment sources |
| ART-POS-011 | channel preview | own current branding/content snapshot shown without becoming a fan-app clone |

## Approval/state negative cases

| ID | Test | Expected |
|---|---|---|
| ART-NEG-001 | Pending artist opens verified-only API/page | denied/server-state route |
| ART-NEG-002 | Rejected artist opens verified-only API/page | denied |
| ART-NEG-003 | Suspended artist uses previously valid session | protected operations denied |
| ART-NEG-004 | client changes `isVerified`, `artistStatus`, `role` in payload | ignored/rejected; state unchanged |
| ART-NEG-005 | artist marks self approved via direct API guessing | 403/404 |
| ART-NEG-006 | artist attempts admin artist-verification route | 403 |
| ART-NEG-007 | duplicate approval/rejection click | idempotent/deterministic; no contradictory state/audit corruption |
| ART-NEG-008 | database failure during approval | action fails; no partially approved user without corresponding state/audit requirements |

## Agreement/signature security

- missing required agreement version/terms/signature when agreement is being accepted;
- inactive/unknown terms version;
- malformed commission-plan IDs;
- duplicate/previously accepted agreement mutation attempt;
- missing `SIGNATURE_ENCRYPTION_KEY` in production-like configuration;
- intentionally invalid encryption configuration;
- inspect DB/logs to verify signature is not stored/logged as plaintext by fallback;
- verify encryption failure fails the operation rather than returning raw signature;
- PDF generation failure behavior must be documented and must not silently change acceptance/legal state incorrectly;
- verify agreement PDF access is not publicly guessable if it contains personal/signature data.

## Profile/branding validation

Test name/bio/accent/social fields with:

- valid boundaries;
- empty required value;
- max length and max+1;
- invalid accent color;
- invalid URL protocol;
- URL with embedded username/password;
- `<script>`, event-handler HTML and SVG payload strings;
- Unicode/emoji;
- duplicate rapid saves.

Expected: validation errors are deterministic; displayed content cannot execute script; profile cannot update privileged fields.

## Asset upload matrix

For profile and banner:

- JPEG/PNG/WebP valid file;
- wrong extension but valid bytes;
- allowed MIME with invalid magic bytes;
- executable/polyglot-like invalid content;
- oversized file;
- zero-byte/corrupt file;
- upload provider failure;
- DB transaction failure after provider upload;
- previous provider asset deletion failure;
- artist suspended between upload and persistence;
- Artist A tries to replace Artist B asset.

Expected: only valid image persists; DB/provider state reconciles; no orphan new asset on failed persistence where cleanup is possible; previous cleanup failure is observable; public asset route serves only active approved artist assets.

## Pricing tests

- valid monthly price;
- valid yearly price if current product supports it;
- zero only when explicitly supported by current approved config;
- negative value;
- fractional/precision boundaries;
- NaN/string/object/array payloads;
- extremely large amount;
- stale web form after admin pricing override;
- Artist A pricing endpoint with Artist B ID;
- concurrent artist/admin pricing change.

Expected: canonical server validation wins; payment order later uses server-stored current price, not client display value.

## Ownership/IDOR matrix

Artist A must not read or mutate Artist B:

- profile/private account data;
- pricing;
- private analytics/earnings;
- content management metadata not public to artists;
- release/distribution metadata;
- profile/banner upload target;
- sessions/account settings.

Use direct HTTP requests, not only UI tests.

## Public channel behavior

For each artist state verify Fan discovery/channel behavior:

- approved + active → visible;
- pending/rejected/suspended/deleted → not publicly discoverable;
- branding change → reflected after expected cache boundary;
- malformed/missing optional branding → stable default UI;
- no private email, agreement, phone, admin notes or financial data leaks to Fan/public responses.

## Artist Web UX states

Validate Login, Under Review, Rejected, Suspended/Inactive and Active dashboard routes. Every major page must cover loading, empty, error, success, session-expired and retry states. No stale approved dashboard may remain functional after suspension.

## Exit criteria

Artist lifecycle is fully server-authoritative, only approved active artists receive verified privileges/public visibility, branding/pricing are ownership-scoped and validated, agreement signature handling is fail-closed, and Artist Web correctly represents every account state without exposing admin-only capabilities.
