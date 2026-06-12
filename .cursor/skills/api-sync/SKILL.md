---
name: api-sync
description: >-
  Detects backend API contract changes (routes, path/query params, request body,
  response shape, status codes, swagger) in auth-service, app-service, or
  streaming-service and launches sub-agents to sync the mobile app and partner-app
  clients. Use automatically when editing controllers, routes, swagger.ts,
  validators, request/response types, or middleware that affect HTTP APIs.
---

# API Sync

Keep mobile and partner-app clients aligned with backend API changes. Run this workflow **automatically** whenever backend HTTP API contracts change — do not wait for the user to ask.

## Monorepo layout

| Repo | Path (from backend workspace) | Role |
|------|-------------------------------|------|
| auth-service | `auth-service/` | Auth, orgs, authors, subscriptions, catalog |
| app-service | `app-service/` | Audiobooks, user content, playlists, reviews |
| streaming-service | `streaming-service/` | Playback, HLS, streaming |
| mobile app | `../mobile/` | React Native / Expo consumer app |
| partner app | `../partner-app/` | Partner portal (authors / orgs) |

Each backend service is its own git repo. Compare changes against `origin/development` inside the affected service directory.

## When to run

**Run** when any changed file matches:

- `src/routes/**`, `src/controllers/**`
- `src/config/swagger.ts`
- `src/types/**`, `src/validators/**`, `src/schemas/**`
- Route registration in `src/app.ts`, `src/server.ts`, or `src/routes/ApiRouter.ts`
- Middleware that changes auth requirements, client type, or response filtering

**Skip** (report "no API contract change") when changes are limited to:

- Internal service logic with identical HTTP contract
- Tests-only, docs-only (except swagger), migrations, env/config
- Logging, formatting, or refactors that do not alter request/response contracts

When unsure, read the diff and swagger — if the public contract changed, run the full workflow.

---

## Workflow

Copy this checklist and track progress:

```
API Sync Progress:
- [ ] Step 1: Detect API-affecting changes
- [ ] Step 2: Build contract diff
- [ ] Step 3: Map changes to client files
- [ ] Step 4: Launch mobile + partner sub-agents (parallel)
- [ ] Step 5: Summarize for the user
```

---

### Step 1: Detect API-affecting changes

For each affected backend service:

```bash
git fetch origin development
git diff origin/development...HEAD --name-only
git diff origin/development...HEAD
```

If on `development`, use working-tree diff:

```bash
git diff origin/development --name-only
git diff origin/development
```

Filter to API-relevant paths (see "When to run"). Read the full diff — never infer contracts from filenames alone.

Also read the updated swagger in `src/config/swagger.ts` and any route JSDoc that documents the changed endpoints.

**Backend rule:** If you changed an API and swagger is not updated yet, update swagger first, then continue this workflow.

---

### Step 2: Build contract diff

Document every changed endpoint in a structured diff. Use [CONTRACT_TEMPLATE.md](CONTRACT_TEMPLATE.md).

For each affected endpoint capture:

| Dimension | What to record |
|-----------|----------------|
| Method + path | e.g. `GET /api/v1/audiobooks/:id` |
| Service | auth-service / app-service / streaming-service |
| Change type | added / removed / modified |
| Path params | added, removed, renamed, type change |
| Query params | added, removed, required ↔ optional |
| Request body | field add/remove/rename, type change, validation change |
| Response body | field add/remove/rename, nested shape, wrapper (`success`, `data`, etc.) |
| Status codes | new errors, changed codes |
| Auth | public ↔ JWT, role changes, CSRF (browser) vs body token (mobile) |
| Breaking? | yes / no — breaking = existing clients may fail without updates |

Compare against `origin/development` for the same route/controller/swagger entry before marking something as changed.

---

### Step 3: Map changes to client files

Use [API_MAP.md](API_MAP.md) for known mappings, then search each client repo for the endpoint path or handler name:

```bash
# From ../mobile/ or ../partner-app/
rg "audiobooks|/auth/login" --glob "*.{ts,tsx}"
```

**Mobile app** (`../mobile/`):

| Area | Typical files |
|------|---------------|
| HTTP client | `services/api.ts` |
| Auth | `services/auth.ts`, `utils/authApiErrors.ts` |
| Domain APIs | `services/*.ts` (audiobooks, playlists, devices, streaming, etc.) |
| Types | inline in service files; update interfaces there |
| Tests | `tests/services/*.test.ts`, `tests/utils/*.test.ts` |

**Partner app** (`../partner-app/`):

| Area | Typical files |
|------|---------------|
| Auth | `src/utils/api.ts`, `src/types/auth.ts` |
| Content | `src/utils/audiobookApi.ts`, `src/types/audiobook.ts` |
| Partner | `src/utils/partnerApi.ts`, `src/types/partner.ts` |
| Config | `src/utils/config.ts` |
| Tests | `tests/*.test.ts` |

List every client file that must change per app before launching sub-agents.

---

### Step 4: Launch sub-agents (parallel)

**Do not** manually edit mobile or partner-app in the parent agent when this skill runs — delegate to custom sub-agents in **one message** so they run in parallel.

Invoke **api-sync-mobile** and **api-sync-partner** (`.cursor/agents/`). Attach the full contract diff from Step 2 and the file list from Step 3 to each.

```
Use the api-sync-mobile subagent to sync ../../mobile/ with these API changes:
[paste Step 2 contract diff]
Files to update: [paste mobile file list]

Use the api-sync-partner subagent to sync ../../partner-app/ with these API changes:
[paste Step 2 contract diff]
Files to update: [paste partner file list]
```

Streaming is usually mobile-only — launch **api-sync-partner** only when partner has a client. Wait for sub-agents to finish before Step 5.

---

### Step 5: Summarize for the user

Report using this template:

```markdown
# API Sync Report

**Backend services changed:** [auth-service, ...]
**Endpoints affected:** [count]
**Breaking changes:** [yes/no — list]

## Contract changes
[compact table or bullet list from Step 2]

## Mobile app
- Sub-agent status: [completed / failed / skipped — no client]
- Files updated: [...]
- Tests: [...]

## Partner app
- Sub-agent status: [completed / failed / skipped — no client]
- Files updated: [...]
- Tests: [...]

## Follow-up
[Any endpoints only used by one client, swagger gaps, or manual QA needed]
```

---

## Important rules

1. **Auto-run** — apply this skill when backend API contracts change; do not require `/api-sync`.
2. **Swagger first** — backend swagger must reflect the change before syncing clients.
3. **Parallel sub-agents** — always launch mobile and partner sub-agents together when both have clients for the changed endpoints.
4. **Skip gracefully** — if no contract change, say so briefly; do not launch sub-agents.
5. **One-sided clients** — some endpoints are mobile-only or partner-only; launch only the relevant sub-agent and note the other as N/A.
6. **Cross-service consistency** — auth/app/streaming naming and response wrappers should stay aligned across backend services before syncing clients.
7. **Scoped tests only** — sub-agents must not run full test suites.

## Additional resources

- Endpoint → client mapping: [API_MAP.md](API_MAP.md)
- Contract diff template: [CONTRACT_TEMPLATE.md](CONTRACT_TEMPLATE.md)
