# 05 — Streaming Access, Playback & Adaptive Delivery

## Scope

Covers canonical entitlement checks, signed/protected playback access, playback sessions/leases, progressive audio, protected adaptive HLS video, URL/token expiry, replay resistance, source-aware quality variants, takedown/subscription/session revocation, background/resume behavior, network transitions and direct-media bypass testing.

## Authority rule

Final QA follows the PRD requirement for graceful poor-network video degradation and the later approved Phase 09A protected adaptive implementation. The older DLD statement that Phase 1 has no ABR is superseded for this final validation point.

## Automated/source gates

```bash
cd backend
npm run test:playback-url-guard
npm run test:stream-access-errors
npm run test:playback-session-lease-contract
npm run test:phase09a-adaptive-media
npm run verify
```

```bash
cd mobile
npm run verify
```

## Eligibility matrix

For both AUDIO and VIDEO, execute direct API and client tests for:

| User/content state | Expected |
|---|---|
| active eligible fan + approved accessible content | access granted |
| free fan + protected early-access content | denied with subscribe/locked UX |
| expired entitlement | denied |
| refunded/revoked entitlement | denied |
| suspended/deleted fan | denied |
| approved content taken down | denied |
| content pending/rejected/failed | denied |
| artist suspended/ineligible where publication policy requires active artist | denied |
| forged content ID | denied/not found |
| wrong user's playback/session token | denied |

Subscription/access DB truth must override cached UI, analytics data and client flags.

## Playback-access positive cases

1. Request access for eligible audio.
2. Verify returned descriptor/URL expiry is short and server-authorized.
3. Play audio to first audible sample.
4. Pause/resume/seek.
5. Continue across navigation/mini-player.
6. Repeat with video.
7. Verify playback session/lease identity and trusted analytics linkage.

Evidence should include correlation ID, content ID, session ID if safe, expiry timestamp, and device/player result. Do not paste signed URLs/tokens into reports.

## Direct access / replay security

| ID | Attack | Expected |
|---|---|---|
| STREAM-SEC-001 | use raw provider URL found from DB/provider console | client/public request cannot bypass application policy |
| STREAM-SEC-002 | copy expired signed/protected URL | denied |
| STREAM-SEC-003 | copy manifest/resource URL to another user/device/session | denied according to session binding |
| STREAM-SEC-004 | modify media/content/session identifiers in tokenized route | signature/binding rejection |
| STREAM-SEC-005 | remove token/resource parameter | denied |
| STREAM-SEC-006 | replay same protected URL after logout/session revoke | denied |
| STREAM-SEC-007 | replay after subscription expiry/refund | denied |
| STREAM-SEC-008 | replay after content takedown | denied |
| STREAM-SEC-009 | signed URL query appears in log/Sentry | FAIL — query/token must be redacted |
| STREAM-SEC-010 | mobile falls back to catalog `mediaUrl`/`videoUrl`/`fileUrl` | FAIL — canonical access endpoint must be used |

## HLS adaptive video matrix

Use at least low-, medium- and high-resolution source videos.

### Auto quality

- Start on good Wi-Fi.
- Throttle bandwidth sufficiently to require downgrade.
- Observe playback continue with lower variant rather than fatal failure where provider/player supports adaptation.
- Restore bandwidth and observe recovery/upshift where appropriate.
- Switch Wi-Fi → cellular and cellular → Wi-Fi.
- Introduce packet loss/latency.

Expected: Auto uses real available variants; no fake/upscaled quality; no raw Cloudinary manifest URL visible to app; backend proxy/resource path remains protected.

### Manual quality

For each descriptor-provided quality:

- select it;
- verify playback continues at approximately same position/play state;
- seek after switch;
- pause/resume after switch.

Attempt qualities not present in descriptor, e.g. 1080p on 360p source. Expected: clear `INVALID_PLAYBACK_QUALITY`-style failure/safe UX; server never silently invents/upscales.

### HLS manifest/resource security

- inspect master/variant manifests through a safe debugging proxy/device network inspector;
- provider upstream URLs must not be directly exposed to client if current backend-proxy architecture is used;
- manifest/segment/key URIs must resolve through protected backend path;
- redirects to arbitrary hosts must not be followed;
- only approved provider origin accepted;
- range requests for media segments behave correctly;
- oversized/malformed manifest fails safely.

## Expiry and refresh

Set/observe normal short TTL.

Test:

- URL expires before playback begins;
- URL expires during long playback;
- app resumes after being backgrounded beyond TTL;
- seek after expiry;
- duplicate refresh requests;
- refresh after entitlement revoked.

Expected: eligible user refreshes gracefully; revoked user does not obtain a new lease; UI shows reconnect/access-lost state rather than endless spinner/crash.

## Mid-play revocation matrix

While content is playing, trigger separately:

- fan session revoke/logout;
- fan suspension;
- subscription expiry;
- refund/revocation;
- content takedown;
- artist suspension where policy applies.

Then request the next protected resource/refresh. Expected: access stops according to the current protected resource/session design, no new authorization is issued, and client shows a meaningful state.

## Playback concurrency

- start content on allowed number of simultaneous sessions;
- exceed configured simultaneous stream limit where implemented;
- race two access requests;
- reuse one playback session from another user;
- duplicate heartbeat from concurrent devices;
- end session twice;
- refresh token/lease concurrently.

Expected: deterministic session limit, no cross-user takeover, no duplicate trusted play credit.

## Audio device/mobile behavior

On Android and iOS physical devices:

- background audio;
- lock-screen controls;
- headset/Bluetooth play/pause;
- headphone disconnect behavior;
- phone call/audio-focus interruption;
- app background/foreground;
- screen rotation for video;
- app warm/cold restart and resume from last supported position;
- navigation between tabs/screens without resetting audio;
- mini player persistence.

Record device/OS/build IDs.

## Network/failure cases

- no network before access request;
- network loss while buffering;
- network loss during playback;
- DNS/provider timeout;
- backend 5xx during access refresh;
- provider 5xx/timeout;
- DB unavailable during entitlement check;
- Redis unavailable;
- malformed playback descriptor;
- zero available video qualities when HLS mode claims readiness.

Expected: no crash, no access fail-open, retry path understandable, state remains recoverable after reconnect.

## Resume position

Where resume is implemented:

- play > meaningful duration, pause/exit, return;
- kill and reopen app;
- resume after login/session refresh;
- resume after content becomes inaccessible;
- resume record belongs to same fan only;
- absurd forged resume positions are clamped/ignored safely.

## Analytics isolation

Make analytics ingestion fail intentionally while playback is authorized. Playback must remain functional. Conversely, forged analytics events must never unlock playback or create entitlement.

## UX acceptance

Required player states:

- loading/fetching access;
- buffering;
- playing;
- paused;
- reconnecting;
- fatal error + retry;
- access lost/subscription expired;
- content removed;
- session expired.

No player screen should display a raw provider error/token/URL.

## Exit criteria

Protected content cannot be played without current authoritative entitlement and session state; direct/replayed media paths fail closed; expiry refresh is graceful; takedown/revocation works; adaptive video uses only real source-supported variants; and Android/iOS physical-device playback survives realistic network/background interruptions without crashes or policy bypass.
