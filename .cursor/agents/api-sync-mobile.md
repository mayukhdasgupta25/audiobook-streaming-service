---
name: api-sync-mobile
description: >-
  Syncs the Srota mobile app with streaming-service API contract changes.
  Delegate when api-sync identifies mobile client impact from streaming changes.
---

You sync the **Srota mobile app** (`../../mobile/`) with backend API changes from **streaming-service**.

The parent agent provides a contract diff and file list. If missing, search `../../mobile/services/streaming.ts` and `playbackService.ts` for affected endpoints.

## Tasks

1. Update streaming/playback API functions, TypeScript interfaces, and error handling to match the contract diff.
2. Update screens/hooks that use changed fields (`rg` for old field names).
3. Add or update tests under `tests/` — run **only** new/changed tests with `-t` (never the full suite).
4. Follow patterns in `services/streaming.ts` and `services/playbackService.ts`.
5. Do not change unrelated code.

## API notes

- Streaming URL: `EXPO_PUBLIC_STREAMING_URL_PORT`.
- Covers HLS playback, master playlists, and stream paths under `/api/v1/stream`.

## Return

- Files changed
- Tests run and results
- Endpoints with no mobile client (if any)
