# 02 — Fan User Account, Profile, Transactions & Library

## Scope

Covers Fan lifecycle beyond authentication: own profile, settings, account state, transaction/invoice ownership, subscription library, recent plays/history surfaces that are actually implemented, and the Phase-1 rule that unsupported social/offline features must not be accidentally exposed.

## Preconditions

Prepare `FAN_FREE`, `FAN_ACTIVE_A`, `FAN_EXPIRED`, `FAN_REFUNDED`, `FAN_SUSPENDED` plus Fan B for ownership/IDOR checks.

## Positive cases

| ID | Test | Expected |
|---|---|---|
| FAN-POS-001 | Get own profile | only authenticated user's data returned |
| FAN-POS-002 | Update allowed profile fields | persisted and visible after fresh login |
| FAN-POS-003 | Update settings such as notification/audio preference where supported | server persists supported values; unsupported fields ignored/rejected safely |
| FAN-POS-004 | Change password through Fan account flow | succeeds only with valid rules; old credentials fail |
| FAN-POS-005 | View own transaction list | only own captured/recorded transactions shown |
| FAN-POS-006 | Download/view own invoice when implemented | invoice belongs to current fan and reflects authoritative transaction values |
| FAN-POS-007 | Library shows active artist subscriptions | artists/statuses match backend subscription truth |
| FAN-POS-008 | Recent plays/history where implemented | only trusted playback-derived records shown |
| FAN-POS-009 | Empty new account | premium empty states with clear next action; no mock data |
| FAN-POS-010 | Profile image flow if enabled for Fan | validated file, provider-backed storage, stable URL, previous asset cleanup behavior verified |

## Negative and ownership cases

| ID | Test | Expected |
|---|---|---|
| FAN-NEG-001 | Request Fan B profile/private endpoint by ID | denied/no data leak |
| FAN-NEG-002 | Request Fan B invoice/transaction ID | denied even if numeric ID guessed |
| FAN-NEG-003 | Request Fan B subscription/library/session | denied |
| FAN-NEG-004 | Alter response-side ownership parameter in client/devtools | server still uses authenticated identity |
| FAN-NEG-005 | Update role/status/isVerified via profile payload | rejected/ignored; no privilege change |
| FAN-NEG-006 | Update unknown/forbidden fields | safe validation response; no mass assignment |
| FAN-NEG-007 | Suspended Fan reads private account APIs | denied according to account-state policy |
| FAN-NEG-008 | Deleted/anonymized Fan token reused | denied |
| FAN-NEG-009 | Invoice for missing or non-owned transaction | 404/403 without enumeration leak |
| FAN-NEG-010 | Attempt offline download endpoint/UI | no downloadable protected media; out-of-scope feature not silently available |

## Profile input validation

Test:

- empty values where required;
- maximum supported lengths and max+1;
- leading/trailing whitespace;
- Unicode names;
- HTML/script-like text;
- URL fields with `javascript:`, embedded credentials and malformed URLs where applicable;
- oversized image;
- image MIME mismatch/magic-byte mismatch;
- duplicate rapid save taps.

Expected: data is normalized safely, rendered as text where applicable, and no XSS/mass-assignment/provider bypass occurs.

## Transaction/invoice integrity

For each transaction state (pending/success/failed/refunded):

1. compare list API to DB/payment ledger;
2. verify amount/currency/artist/billing cycle are server values;
3. verify failed/pending records are not presented as paid success;
4. verify refund state is represented consistently;
5. verify invoice cannot be generated with client-overridden amount/name;
6. ensure invoice URL/API is authorization-protected and not a predictable public asset.

## Library/subscription state synchronization

With app already open, externally transition subscription through:

- ACTIVE → expired;
- ACTIVE → refunded/revoked as current policy dictates;
- pending payment → ACTIVE via webhook;
- Artist/content suspension/takedown.

Refresh/resume app and verify library/lock state converges to backend truth. Cached UI must not preserve access.

## Recent play/history abuse checks

Where recent-played functionality is exposed:

- forged content ID;
- another user's playback/session ID;
- event without authorized playback;
- duplicate events;
- takedown after prior play;
- deleted/anonymized user behavior.

Expected: no cross-user history access and no untrusted client event can create privileged playback entitlement.

## UX state coverage

Every account/library/transaction screen must be exercised in:

- loading;
- success;
- empty;
- network error;
- 401/session expired;
- suspended/inactive account;
- retry success after transient failure.

No raw exception, JSON dump, blank page or infinite spinner is acceptable on a critical path.

## Exit criteria

Fan-private data is ownership-scoped, account state is enforced on the server, financial history matches authoritative records, library state converges after payment/expiry/refund, and unsupported Phase-1 features do not create protected-media bypasses.
