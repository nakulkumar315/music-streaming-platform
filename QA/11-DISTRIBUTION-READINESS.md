# 11 — Phase-2 Distribution-Ready Domain (Phase-1 Inactive)

## Scope

Covers the provider-neutral release/track/contributor/external-link/submission/platform-status/outbox domain added for future music distribution, while proving that **no live DSP distribution is enabled in Phase 1** and that Phase-1 playback/content behavior is not regressed.

## Boundary

Phase 1 must remain an early-access streaming platform. It must not:

- submit releases to Spotify/Apple Music/YouTube Music or any distributor;
- calculate/collect DSP royalties;
- present live distribution as a delivered Phase-1 capability;
- call provider/distributor networks from a Phase-1 submission worker.

QA must fail any accidental live integration or misleading UI as scope/security risk.

## Automated gate

```bash
cd backend
npm run test:phase09-distribution-domain
npm run verify
```

## Schema/domain tests

Validate the current canonical migration/domain supports:

- releases;
- release tracks;
- contributors/roles;
- external platform links;
- distribution submissions;
- per-platform statuses;
- outbox/event state needed for future integration;
- content-to-release relation where implemented;
- identifiers such as UPC/EAN/ISRC with server validation.

Confirm these structures are additive and do not replace Phase-1 content/playback identity.

## Backfill tests

On representative pre-distribution data:

- existing AUDIO content is mapped only according to approved migration logic;
- SINGLE backfill does not invent album/EP groupings;
- existing VIDEO is not incorrectly mapped when design says unmapped;
- artist/content ownership remains unchanged;
- existing content IDs/playback URLs/entitlement checks continue to work;
- migration rerun/status tooling does not duplicate releases/tracks.

## Identifier validation

Test valid and invalid:

- UPC/EAN length/check/format rules implemented by current service;
- ISRC case/format;
- duplicate identifier constraints;
- whitespace/case normalization;
- identifier belonging to another release/track;
- malformed Unicode/control characters.

Invalid identifiers must fail before any future submission state is created.

## Contributor integrity

- valid contributor role;
- multiple contributors;
- duplicate contributor assignment;
- unknown role;
- contributor referencing missing release/track;
- cross-artist unauthorized modification;
- deletion/update that would orphan required relationships.

Expected: relational constraints/service rules preserve coherent metadata.

## Release lifecycle vs distribution lifecycle

Prove the two lifecycles are independent:

- Phase-1 content/release availability does not automatically mean distributed;
- `distribution_status` or provider status cannot unlock/lock protected Phase-1 playback;
- content takedown/access rules remain owned by Phase-1 governance/entitlement;
- future distribution metadata can be inactive without breaking playback.

## Submission/provider boundary tests

Inspect/test provider abstraction:

- creating domain submission metadata does not perform network call in Phase 1;
- no configured DSP credentials are required for Phase-1 startup;
- no worker silently sends submissions;
- unavailable provider implementation fails explicitly if directly invoked in QA, rather than pretending success;
- outbox/state remains safe for future processing.

## Admin/Artist visibility

Where release metadata is exposed:

- Artist A cannot alter Artist B release metadata;
- unsupported EP/ALBUM behavior is rejected if current Phase-1 upload path only supports SINGLE mapping;
- external links must use safe HTTP(S) URLs without credential/javascript schemes;
- no UI offers an active "Distribute now" action unless separately approved for Phase 2.

## Regression matrix

After distribution migration/domain changes rerun:

1. Fan browse/content detail;
2. protected audio/video playback;
3. Artist own content list;
4. Admin moderation/takedown;
5. analytics counts;
6. payment/subscription access.

All must behave exactly as Phase 1 requires.

## Exit criteria

Distribution-ready schema is coherent and provider-neutral, migrations preserve existing Phase-1 data, ownership/identifier validation is enforced, distribution lifecycle cannot override playback entitlement, and no live DSP integration or royalty behavior is reachable in Phase 1.
