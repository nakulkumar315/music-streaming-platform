# 04 — Content, Media Upload, Processing & Moderation

## Scope

Covers Admin-owned binary upload, audio/video/artwork validation, provider storage identity, technical processing, metadata, approval/rejection, early-access tagging, publication visibility, provider webhook integrity, takedown, provider failure, legacy-media mapping and physical deletion handoff.

## Core rules

- Binary content upload is Admin-controlled in Phase 1.
- New content is not fan-visible until the approved lifecycle allows it.
- Client filenames/storage keys are never trusted as authorization.
- Storage/provider assets must not become public bypasses.
- Takedown must stop new playback access immediately.
- Provider callbacks must be signature-verified, idempotent and transition-safe.
- Content governance changes must be audited.

## Automated/source gates

```bash
cd backend
npm run test:content-media-governance
npm run test:cloudinary-identity
npm run test:cloudinary-delivery
npm run test:phase09a-adaptive-media
npm run report:cloudinary-mapping
npm run verify
```

Use `npm run test:storage` only with a QA provider namespace/account.

## Content creation/upload positive cases

| ID | Test | Expected |
|---|---|---|
| MEDIA-POS-001 | Admin uploads valid audio | validated provider asset + content record created in non-public review/processing state |
| MEDIA-POS-002 | Admin uploads valid video | validated protected master; adaptive processing scheduled where provider supports it |
| MEDIA-POS-003 | upload valid artwork/thumbnail | asset stored safely and attached to intended content |
| MEDIA-POS-004 | processing callback completes successfully | technical state transitions deterministically |
| MEDIA-POS-005 | Admin approves valid ready content | content enters approved/early-access state as configured; audit emitted |
| MEDIA-POS-006 | Fan catalog after approval | only approved eligible metadata shown; raw media URL not exposed |
| MEDIA-POS-007 | Admin rejects pending content | fan cannot discover/play; artist history shows correct status where applicable |
| MEDIA-POS-008 | Admin takes down approved content | immediately unavailable for new access; audit with reason |
| MEDIA-POS-009 | migrated legacy Cloudinary content mapping | provider identity resolved correctly without changing ownership/playback contract |

## Upload input validation matrix

Run for audio, video and artwork as relevant:

- supported file type and exact boundary size;
- size = max + 1 byte;
- zero-byte file;
- invalid/corrupt file;
- filename with path traversal (`../`, encoded traversal, Windows separators);
- multiple extensions (`file.mp4.exe`);
- MIME header says video while bytes are image/text/executable;
- valid MIME but unsupported codec/container where validation can detect it;
- extremely long filename/metadata;
- control characters/Unicode filename;
- more files/fields than allowed by multipart policy;
- interrupted upload;
- repeated upload intent/retry;
- stale upload intent/storage identity;
- forged storage key/provider asset ID.

Expected: invalid input is rejected before publication; temporary spool files are cleaned; process memory remains bounded; no arbitrary filesystem/provider object can be registered.

## Authorization matrix

- Fan upload attempt → denied.
- Artist direct binary upload to Admin route → denied.
- Moderator upload if not explicitly allowed → denied.
- Finance upload/moderation → denied.
- Admin valid upload → allowed.
- Moderator approve/takedown according to approved RBAC → allowed only those operations.
- Artist A attempts to associate content with Artist B through tampered payload → denied/validated by admin governance rules.

## Lifecycle transition matrix

For each content state test allowed and illegal transitions.

Expected examples:

- DRAFT/PENDING → approved only through authorized governance;
- pending → taken down/rejected only through allowed command;
- TAKEN_DOWN cannot silently return to playable via provider callback;
- FAILED processing cannot become playable because client says it is ready;
- duplicate approve/reject/takedown requests are deterministic;
- provider technical READY cannot equal business approval unless explicit governance state also permits publication.

Attempt direct DB-state-like values in request bodies (`lifecycleState=EARLY_ACCESS`, `isApproved=true`, `isTakenDown=false`) and verify the server does not mass-assign privileged state.

## Provider webhook security

### Valid

- correctly signed callback;
- valid current timestamp;
- known provider asset;
- legal transition;
- duplicate exact event.

Expected: first legal event applies once; duplicate is idempotent.

### Negative

| ID | Scenario | Expected |
|---|---|---|
| WH-MEDIA-NEG-001 | missing signature | denied, no mutation |
| WH-MEDIA-NEG-002 | invalid signature | denied |
| WH-MEDIA-NEG-003 | valid-looking payload changed after signing | denied |
| WH-MEDIA-NEG-004 | stale timestamp outside allowed age | denied |
| WH-MEDIA-NEG-005 | unknown asset/provider identity | deterministic non-success/retry behavior; no arbitrary row mutation |
| WH-MEDIA-NEG-006 | illegal state transition | rejected/no rollback of more authoritative state |
| WH-MEDIA-NEG-007 | DB unavailable after verified callback | provider receives retryable response where designed; state not falsely acknowledged |
| WH-MEDIA-NEG-008 | callback for taken-down content | technical state cannot re-publish content |

## Adaptive video processing

For Cloudinary protected video:

- 1080p source: verify supported source-safe ladder and Auto master;
- 720p source: no 1080p manual variant;
- 360p source: no higher fake qualities;
- source below minimum supported ladder: safe FAILED/not playable, never upscale;
- eager processing partial failure: adaptive state remains non-ready/fails;
- Auto master missing while manual variants exist: do not mark READY;
- duplicate completion callback: idempotent;
- provider scheduling failure after master upload: newly uploaded asset cleanup attempted and content not falsely ready.

Run backfill only in controlled QA:

```bash
npm run backfill:adaptive-video -- --dry-run
```

Review selected rows before any non-dry execution.

## Takedown tests

1. Start playback of approved content.
2. Admin/Moderator takedowns with mandatory reason.
3. Request new stream access → denied immediately.
4. Request existing protected HLS segment/resource after revocation according to current session/resource enforcement → must no longer grant continued unauthorized access.
5. Refresh Fan catalog → content hidden/removed state.
6. Verify audit entry.
7. Verify analytics does not re-publish or alter content state.

Repeat while provider webhook is concurrently arriving.

## Failure and consistency cases

- provider upload succeeds but DB transaction fails;
- DB row created but provider upload/scheduling fails;
- thumbnail generation fails independently;
- storage delete of superseded asset fails;
- duplicate upload confirmation;
- service restart during processing;
- two admins approve/takedown same item concurrently;
- content owner artist suspended while processing;
- database becomes unavailable during moderation.

Expected: no public orphan content, no contradictory lifecycle, failures observable and retryable/reconcilable.

## Public metadata/data leakage checks

Inspect Fan and Artist read responses for:

- raw `storage_key`;
- provider asset ID where not needed;
- provider signed URL;
- local filesystem path;
- internal moderation notes;
- webhook payload/secrets;
- admin-only state.

Protected media information must be delivered only through the canonical playback/access mechanism.

## UX acceptance

### Admin

Upload screen: Idle → Validating → Uploading → Processing/Confirming → Draft/Pending → Success/Error. Retry must be clear. Destructive moderation needs confirmation/reason.

### Artist

My Content is read-only for binaries and clearly shows processing/review/approved/rejected/taken-down states.

### Fan

Pending/rejected/taken-down items are not accidentally playable. Processing failures never appear as blank/broken playable cards.

## Exit criteria

All supported files pass validation and governance; invalid or forged assets cannot be registered; callbacks are verified/idempotent; lifecycle transitions are authoritative and auditable; takedown is near-immediate for new access; and no raw storage/provider path creates a media bypass.
