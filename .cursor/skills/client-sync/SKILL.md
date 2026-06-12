---
name: client-sync
description: >-
  Manually syncs the mobile app and partner-app with streaming-service API
  changes. Use only when the user types /client-sync in Agent chat for
  streaming-service.
disable-model-invocation: true
---

# Client Sync (streaming-service)

## Invocation

Run **only** when the user types `/client-sync` in Agent chat. Do not run automatically after API edits — wait for explicit invocation.

## Scope

| Repo | Path (from streaming-service workspace) |
|------|----------------------------------------|
| This service | `.` (streaming-service) |
| Mobile app | `../../mobile/` |
| Partner app | `../../partner-app/` (usually N/A) |

Compare API changes against `origin/development` in this repo.

## Workflow

```
Client Sync Progress:
- [ ] Step 1: Detect API-affecting changes
- [ ] Step 2: Build contract diff
- [ ] Step 3: Map changes to client files
- [ ] Step 4: Launch api-sync-mobile + api-sync-partner (parallel)
- [ ] Step 5: Summarize for the user
```

### Step 1: Detect API-affecting changes

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

Filter to API-relevant paths: `src/routes/**`, `src/controllers/**`, `src/config/swagger.ts`, `src/types/**`, `src/validators/**`, `src/schemas/**`, route registration, auth middleware.

Read `src/config/swagger.ts` for changed endpoints. If no API contract change, report briefly and stop.

### Step 2: Build contract diff

Document every changed endpoint using [CONTRACT_TEMPLATE.md](../api-sync/CONTRACT_TEMPLATE.md).

### Step 3: Map changes to client files

Use [API_MAP.md](../api-sync/API_MAP.md), then search clients:

```bash
rg "endpoint-fragment" ../../mobile/services ../../mobile/tests --glob "*.ts"
rg "endpoint-fragment" ../../partner-app/src ../../partner-app/tests --glob "*.ts"
```

Streaming is typically mobile-only (`services/streaming.ts`, `services/playbackService.ts`).

### Step 4: Launch sub-agents (parallel)

**Do not** edit client repos yourself. Invoke **api-sync-mobile** and **api-sync-partner** from `.cursor/agents/` in **one message** (parallel). Pass the contract diff and per-app file lists.

```
Use the api-sync-mobile subagent to sync ../../mobile/ with these API changes:
[paste contract diff]
Files to update: [mobile file list]

Use the api-sync-partner subagent to sync ../../partner-app/ with these API changes:
[paste contract diff]
Files to update: [partner file list]
```

Launch **api-sync-partner** only when partner has a client for the changed endpoints. Wait for sub-agents to finish.

### Step 5: Summarize

```markdown
# Client Sync Report

**Service:** streaming-service
**Endpoints affected:** [count]
**Breaking changes:** [yes/no — list]

## Contract changes
[compact list from Step 2]

## Mobile app
- Status: [completed / failed / skipped]
- Files updated: [...]
- Tests: [...]

## Partner app
- Status: [completed / failed / skipped]
- Files updated: [...]
- Tests: [...]
```

## Rules

- User-invoked only — never auto-run.
- Sub-agents run scoped tests only (never full suites).
- If swagger is stale, note it in the report; do not update backend unless the user asks.
