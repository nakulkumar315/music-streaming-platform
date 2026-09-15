# 08 — Admin Governance, Moderation & Privileged Operations

## Scope

Covers Admin, Moderator and Finance privileged actions, server-side RBAC, destructive-action UX, artist/user/content/pricing/refund governance, duplicate-submit protection, admin session safety and audit requirements.

## Role matrix to prove

| Action | ADMIN | MODERATOR | FINANCE | ARTIST/FAN |
|---|---:|---:|---:|---:|
| artist create/manage/verify | yes | no unless explicitly implemented | no | no |
| content review/approve/takedown | yes | yes where approved | no | no |
| platform/artist governance pricing | yes | no | no unless explicitly approved | no |
| payment view | yes | no | yes | own/private scoped only elsewhere |
| refund | yes | no | yes | no |
| audit logs | admin-authorized only | no unless explicitly approved | no unless explicitly approved | no |
| admin analytics | yes | role policy only | role policy only | no |

Test actual server behavior; do not infer from hidden menu items.

## Build gates

```bash
cd backend
npm run test:admin-artist-validation
npm run test:phase07-web-contract
npm run test:phase08-operational
npm run verify
```

```bash
cd web-admin
npm ci
npm run verify
```

## Admin positive journeys

- login and dashboard KPIs load;
- create/manage artist where current implementation supports it;
- approve/reject artist;
- verify artist indicator;
- upload content;
- approve/reject/takedown content;
- view users and suspend/restore where supported;
- manage pricing through approved controls;
- inspect subscriptions/payments;
- initiate refund;
- view analytics;
- query audit logs.

For every sensitive operation verify the business state and corresponding audit event.

## Negative RBAC cases

Send direct requests as each wrong role for every privileged endpoint. Expected 403/404 with no mutation. Specifically prove:

- Moderator cannot refund/change pricing/manage users;
- Finance cannot approve/takedown content or verify artists;
- Artist cannot call any admin governance endpoint;
- Fan cannot call any admin governance endpoint;
- unauthenticated requests are 401, not 403 success-like fallbacks.

## Destructive/financial action safety

For takedown, suspension, rejection, refund and other destructive actions:

- confirmation dialog appears;
- reason is required where UI/contract specifies it;
- cancel closes without API mutation;
- double-click/rapid taps do not duplicate the action;
- browser refresh during request produces deterministic state;
- stale page trying to reverse a newer admin action is rejected or reconciled safely;
- result is auditable.

## Concurrent administrator cases

- Admin A approves while Admin B rejects same artist/content;
- Admin A changes pricing while Admin B has stale form;
- Moderator takedowns while Admin approves;
- two refund clicks from two privileged sessions;
- user suspended while another admin edits profile;
- audit viewer queries while writes occur.

Expected: no impossible/contradictory final state; authoritative transition/version/current-state checks win.

## Input safety

Enter HTML/script-like data in:

- admin notes/reasons;
- artist name/bio;
- content title/description;
- search/filter fields.

Verify safe rendering and no stored/reflected XSS. Attempt SQL-like strings; they must remain data, not alter query logic.

## Admin session/security

- direct protected URL without session;
- expired token while form open;
- revoked session while dashboard open;
- browser back after logout;
- two tabs with logout in one;
- suspended/deleted admin identity if current user management supports it;
- localStorage/sessionStorage inspection according to approved auth design;
- no production localhost API fallback;
- no debug/admin bypass route.

## Data visibility

Admin may see operational information required by scope, but screens/logs must not expose secrets. Verify no:

- JWT/session token;
- webhook secrets;
- media signing secret/signed query string;
- password hashes;
- signature encryption key;
- unnecessary raw provider credentials.

## Governance consistency

For each operation compare:

1. UI result;
2. API response;
3. authoritative DB row(s);
4. dependent behavior, e.g. Fan discovery/playback;
5. audit log.

Examples:

- artist suspension must affect artist privilege/public state;
- content takedown must block stream access;
- price update must affect new server-created orders, not existing captured transactions;
- refund must reconcile entitlement according to payment policy.

## UX states

Every admin list/detail must cover loading, empty, error and success. For mutations, show pending/disabled state to reduce double submit. Errors must include a supportable correlation reference without raw stack/provider secrets.

## Exit criteria

All privileged actions are server-role-gated, destructive and money operations are safe under duplicate/concurrent use, every required sensitive action is auditable, and direct API testing confirms no UI-only security assumption.
