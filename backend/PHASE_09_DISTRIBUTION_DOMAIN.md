# Phase 09 — Distribution-Ready Domain Mapping

This note documents the implemented Phase-09 compatibility mapping. Confluence remains the requirements/source of truth.

## Phase-1 identity remains unchanged

`content_items.id` remains the public/browse/playback/moderation identity used by current Phase-1 APIs. Phase 09 does not replace fan-facing IDs or require a frontend rewrite.

For an AUDIO content item that can be mapped safely:

`content_items.id -> content_items.release_track_id -> release_tracks.id -> releases.id`

The release/track aggregate is additive. Existing media storage keys/provider asset references remain on the canonical Phase-1 content/media record and are not duplicated.

## Existing-content backfill

Migration `20260914_0011_distribution_ready_domain.sql` maps existing AUDIO rows only. Each mapped row becomes one `SINGLE` Release with one ReleaseTrack because the existing Phase-1 upload model is one audio item per content row.

The backfill:

- preserves the existing content ID and artist ownership;
- leaves video rows unmapped because there is no approved music-video-to-release rule;
- sets distribution status to `NOT_SUBMITTED`;
- leaves UPC/EAN and ISRC null unless supplied later;
- creates a known primary-artist credit from existing ownership;
- is conflict-safe for release/content mapping so rerunning the backfill section does not create duplicate release/track rows.

No album grouping, UPC, ISRC, provider reference, or distributed state is inferred.

## New Phase-1 AUDIO uploads

The existing Admin media upload endpoint remains the binary-upload path. It may accept optional distribution-ready metadata for AUDIO content, validates it server-side, and transactionally creates the Release/ReleaseTrack mapping after storage succeeds.

The current single-file endpoint only creates `SINGLE`. `EP` and `ALBUM` are represented by the schema for Phase 2 but require a future explicit multi-track release workflow.

Phase-1 content governance synchronizes only the linked release business phase:

- rejected/unapproved content -> `DRAFT`
- approved content -> `EARLY_ACCESS`
- taken-down content -> `TAKEDOWN`

This synchronization never changes `distribution_status`.

## Distribution boundary

`DistributorProvider` is an interface only. Phase 09 contains no provider implementation, credentials, provider SDK, HTTP client, submission worker, retry worker, or scheduled external status poller.

Future Phase 2 can implement the provider seam against the durable entities introduced here:

- `distribution_submissions`
- `distribution_platform_statuses`
- `distribution_outbox`
- `external_platform_links`

Provider submission/status state is intentionally separate from streaming entitlement, media technical status, and Phase-1 release lifecycle.

## Identifiers and credits

- UPC/EAN and ISRC are optional until legitimately assigned/supplied.
- Supplied identifiers are normalized and shape-validated; the platform does not fabricate them.
- Contributor roles are structured and constrained.
- Track-scoped contributors/platform links are relationally constrained to the same release as the referenced track.
- Distribution idempotency keys and provider references have database uniqueness boundaries for future submission logic.

## Operational gate

Startup schema readiness requires migration `20260914_0011_distribution_ready_domain` plus the release/distribution tables, constraints and critical indexes. A Phase-08-only database must not report READY against Phase-09 application code.

Actual migration execution, database backfill inspection and end-to-end upload/playback regression remain runtime acceptance evidence and must be executed in a runnable environment before claiming full production verification.
