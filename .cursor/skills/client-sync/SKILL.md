---
name: client-sync
description: >-
  Cross-repo API contract sync: compares streaming-service development with
  mobile and partner-app development, finds drift, and delegates fixes to
  sub-agents. Use only when the user types /client-sync in Agent chat for
  streaming-service.
disable-model-invocation: true
---

# Client Sync (streaming-service)

## Invocation

Run **only** when the user types `/client-sync` in Agent chat. Do not run automatically after API edits — wait for explicit invocation.

## Goal

**Actively find API contract drift** — not only uncommitted streaming-service changes. Compare:

| Side | Repo | Branch | Role |
|------|------|--------|------|
| **Backend (source of truth)** | `.` (streaming-service) | `development` | Routes, controllers, swagger |
| **Mobile client** | `../../mobile/` | `development` | `services/*.ts`, related tests |
| **Partner / admin client** | `../../partner-app/` | `development` | Usually N/A for streaming |

Report every mismatch where a client’s paths, methods, request bodies, response shapes, or auth patterns **do not match** what streaming-service `development` exposes.

Also check **app-service streaming proxy** (`/api/v1/stream/*`) if mobile routes through app-service instead of calling streaming-service directly.

## Workflow

```
Client Sync Progress:
- [ ] Step 1: Fetch development on all three repos
- [ ] Step 2: Extract backend contract (streaming-service development)
- [ ] Step 3: Extract client contracts (mobile + partner development)
- [ ] Step 4: Diff backend vs each client — list drift
- [ ] Step 5: Build contract diff (drift items only)
- [ ] Step 6: Map drift to client files
- [ ] Step 7: Launch api-sync-mobile + api-sync-partner (parallel)
- [ ] Step 8: Summarize for the user
```

---

### Step 1: Fetch development on all three repos

Run from streaming-service workspace:

```bash
git fetch origin development
git checkout development
git pull origin development

git -C ../../mobile fetch origin development
git -C ../../mobile checkout development
git -C ../../mobile pull origin development

git -C ../../partner-app fetch origin development
git -C ../../partner-app checkout development
git -C ../../partner-app pull origin development
```

If a client repo is missing or not on `development`, note it in the report and skip that client.

Optional: also note recent streaming-service commits not yet reflected in clients:

```bash
git log origin/development --oneline -20 -- src/routes src/controllers src/config/swagger.ts src/docs src/types
```

---

### Step 2: Extract backend contract (streaming-service development)

Build the **authoritative** contract from `development` (not from local uncommitted edits unless the user is explicitly off-branch).

**Read:**

- `src/config/swagger.ts`
- `src/docs/swagger-*.ts`
- `src/routes/**`
- `src/controllers/**` (request/response shapes, status codes)
- `src/types/**`, validators/schemas if they define API payloads

**Enumerate** every public HTTP endpoint streaming-service exposes:

| Field | Record |
|-------|--------|
| Method + path | e.g. `GET /api/v1/stream/chapters/{chapterId}/master.m3u8` |
| Path/query params | names, required vs optional |
| Request body | fields and types |
| Response body | fields and wrapper shape (JSON vs HLS binary) |
| Status codes | success + common errors |
| Auth | Bearer JWT |

Use swagger as the primary index; **verify against route/controller code** (swagger can be stale — flag gaps in the report).

If mobile uses app-service as a proxy, also read app-service `src/routes/streamingRoutes.ts` on `development` and note any proxy-specific auth (Bearer vs `user` query param).

---

### Step 3: Extract client contracts (mobile + partner development)

On each client’s **`development`** branch, inventory how streaming-service is called.

**Mobile** (`../../mobile/`):

```bash
rg "'/api/v1/stream|\"/api/v1/stream|/stream/chapters" ../../mobile/services ../../mobile/tests --glob "*.ts"
rg "post<|get<|put<|patch<|delete<" ../../mobile/services/streaming.ts ../../mobile/services/playbackService.ts
```

Key files: `services/streaming.ts`, `services/playbackService.ts`, `services/api.ts`, related `tests/`.

**Partner / admin** (`../../partner-app/`):

```bash
rg "/stream/" ../../partner-app/src ../../partner-app/tests --glob "*.ts"
```

Streaming is typically **mobile-only**; if partner has no streaming client, note partner as N/A in the report.

For each client call, record: method, path, body fields sent, response type/interface expected, auth mode (Bearer), and whether calls go direct to streaming-service or via app-service proxy.

---

### Step 4: Diff backend vs each client — find drift

Compare **backend development contract** (Step 2) to **each client development contract** (Step 3).

Flag as drift when:

| Drift type | Example |
|------------|---------|
| **Stale path** | Client calls old playlist path; backend renamed segment route |
| **Missing client** | Backend added preload endpoint; no client usage (note as N/A or follow-up) |
| **Ghost client** | Client calls endpoint removed or never existed on backend |
| **Method mismatch** | Client `GET`, backend `POST` (e.g. preload) |
| **Body mismatch** | Client omits optional `bitrate` on preload; wrong field name |
| **Response mismatch** | Client expects flat status object; backend returns `{ success, data }` wrapper |
| **Auth mismatch** | Client missing Bearer token where backend requires auth |
| **Proxy mismatch** | Mobile hits app-service proxy but proxy docs/behavior differ from streaming-service direct |

Classify each item:

- **Breaking for mobile** / **breaking for partner** / **both** / **neither** (backend-only or unused)
- **Fix direction:** update client → match backend (default), unless user says otherwise

If **no drift** in either client, report briefly and **stop** (do not launch sub-agents).

---

### Step 5: Build contract diff

Document **only drift items** using [CONTRACT_TEMPLATE.md](../api-sync/CONTRACT_TEMPLATE.md).

For each item:

- **Before** = what the client does today (development branch)
- **After** = what streaming-service development requires
- **Breaking:** yes/no
- **Affected app:** mobile | partner | both

Group by endpoint. Include swagger staleness notes if backend code and swagger disagree.

---

### Step 6: Map drift to client files

Use [API_MAP.md](../api-sync/API_MAP.md), then confirm with search:

```bash
rg "endpoint-fragment" ../../mobile/services ../../mobile/tests --glob "*.ts"
rg "endpoint-fragment" ../../partner-app/src ../../partner-app/tests --glob "*.ts"
```

List every file that must change per app before launching sub-agents.

---

### Step 7: Launch sub-agents (parallel)

**Do not** edit client repos yourself. Invoke **api-sync-mobile** and **api-sync-partner** from `.cursor/agents/` in **one message** (parallel). Pass the contract diff and per-app file lists.

```
Use the api-sync-mobile subagent to sync ../../mobile/ (development) with streaming-service development:
[paste contract diff — mobile items only]
Files to update: [mobile file list]
Direction: align client to backend contract.

Use the api-sync-partner subagent to sync ../../partner-app/ (development) with streaming-service development:
[paste contract diff — partner items only]
Files to update: [partner file list]
Direction: align client to backend contract.
```

Launch only sub-agents that have drift to fix. Partner is usually skipped (no streaming client). Wait for sub-agents to finish.

---

### Step 8: Summarize

```markdown
# Client Sync Report

**Backend:** streaming-service @ `development`
**Mobile:** ../../mobile @ `development`
**Partner:** ../../partner-app @ `development` (usually N/A)
**Drift items found:** [count]
**Breaking drift:** [yes/no — list]

## Backend contract source
- Swagger: [up to date | stale — notes]
- Routes scanned: [count]
- App-service proxy checked: [yes/no — notes]

## Drift summary
| Endpoint | Mobile | Partner | Fix |
|----------|--------|---------|-----|
| ... | drift/none | drift/none | client update |

## Contract changes (detail)
[compact list from Step 5]

## Mobile app
- Status: [completed / failed / skipped — no drift]
- Files updated: [...]
- Tests: [...]

## Partner app
- Status: [completed / failed / skipped — no drift / N/A]
- Files updated: [...]
- Tests: [...]

## Follow-up
[Swagger gaps, backend-only endpoints, manual QA]
```

---

## Rules

- User-invoked only — never auto-run.
- **Always compare three `development` branches** — do not stop at “streaming-service has no local git diff”.
- Backend contract on **streaming-service `development`** is source of truth; default fix is **update clients**.
- Sub-agents run scoped tests only (never full suites).
- If swagger is stale vs routes, note it in the report; do not update backend unless the user asks.
- Partner app and admin portal are the same repo: `../../partner-app/` (streaming usually N/A).

## Additional resources

- Endpoint → client mapping: [API_MAP.md](../api-sync/API_MAP.md)
- Contract diff template: [CONTRACT_TEMPLATE.md](../api-sync/CONTRACT_TEMPLATE.md)
