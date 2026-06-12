---
name: env-sync
description: >-
  Syncs missing environment variables from .env.example into .env.development
  without overwriting existing values. Use only when the user types /env-sync
  in Agent chat for streaming-service.
disable-model-invocation: true
---

# Env Sync (streaming-service)

## Invocation

Run **only** when the user types `/env-sync` in Agent chat. Do not run for general env questions — wait for explicit invocation.

## Scope

This skill applies to **streaming-service** only:

| File | Path |
|------|------|
| Template | `.env.example` |
| Target | `.env.development` |

Both files live at the streaming-service repo root.

## Critical rule

**NEVER overwrite values in `.env.development`.**

- If a key already exists in `.env.development` (any value, including empty), **leave it unchanged**.
- Only **append** keys that are completely absent from `.env.development`.
- Do not remove keys that exist only in `.env.development`.
- Do not reorder or rewrite existing lines.

---

## Workflow

```
Env Sync Progress:
- [ ] Step 1: Parse both files
- [ ] Step 2: Find missing keys
- [ ] Step 3: Append missing entries from .env.example
- [ ] Step 4: Report results
```

### Step 1: Parse both files

Read `.env.example` and `.env.development` in full.

Parsing rules:

1. **Comments** (`# ...`) and blank lines are not keys — preserve them when copying blocks from `.env.example`.
2. **Key** = text before the first `=` on a non-comment line.
3. **Multi-line values** — if a value starts with `"` and does not close on the same line, the entry continues until the closing `"` line. Treat the whole block as one key.
4. **Duplicate keys in `.env.example`** — use the **last** occurrence as the canonical template value.
5. Trim whitespace around key names only for comparison; preserve original formatting when appending.

### Step 2: Find missing keys

Build two sets of keys (case-sensitive):

- `exampleKeys` — all keys from `.env.example`
- `developmentKeys` — all keys from `.env.development`

```
missingKeys = exampleKeys − developmentKeys
```

If `missingKeys` is empty, report success and stop — no file changes.

### Step 3: Append missing entries

For each key in `missingKeys`, copy from `.env.example`:

1. Include the **section comment block** immediately above the key (if any).
2. Copy the full key line(s), including multi-line quoted values, **exactly as in `.env.example`**.
3. Append to `.env.development` — add a blank line before the new block if the file does not end with one.
4. Preserve `.env.example` key order when adding multiple missing keys.

**Do not:**

- Replace or update existing keys
- Fill in empty values for keys that already exist
- Copy secrets from `.env.example` over non-empty dev values

### Step 4: Report results

```markdown
# Env Sync Report — streaming-service

**Missing keys added:** [count] or none
**Keys added:** [KEY1, KEY2, ...] or —
**Existing keys preserved:** all unchanged
**Keys in .env.development not in .env.example:** [list if any, informational only]

## Verdict
- [ ] .env.development is in sync with .env.example
- [ ] N keys were appended — review and set values if needed
```

List any appended keys that have empty placeholder values in `.env.example` so the user knows what to fill in manually.

---

## Examples

**Key exists in both — no change:**

```
# .env.example          # .env.development
PORT=8083               PORT=8082        → skip (dev value kept)
TRUST_PROXY=0           TRUST_PROXY=0    → skip
SESSION_SECRET=…        SESSION_SECRET=your_session_secret_here  → skip (key exists)
```

**Key missing — append from example:**

```
# .env.example has BULL_BACKOFF_DELAY=30000
# .env.development has no BULL_BACKOFF_DELAY line
→ append line from .env.example
```

---

## Important rules

1. **Read both files fully** before editing — multi-line values require it.
2. **Append only** — never rewrite `.env.development`.
3. **No git commits** unless the user explicitly asks.
4. **Do not commit** `.env.development` if it contains secrets — warn if asked to commit env files.
