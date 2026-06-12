---
name: code-check
description: >-
  Runs a full code quality check on current changes: security vulnerabilities,
  logic flaws, cross-service consistency, and test coverage. Compares all
  findings against the development branch baseline. Invoke only when the user
  types /code-check in Agent chat.
disable-model-invocation: true
---

# Code Check

## Invocation

This skill is triggered **only** when the user types `/code-check` in Agent chat. Do not run this workflow for general code review requests — wait for explicit `/code-check` invocation.

Run a structured review of the user's current changes against the `development` branch. Execute every step — do not skip to reporting.

## Scope

This monorepo has three independent git repos:

| Service | Path |
|---------|------|
| auth-service | `auth-service/` |
| app-service | `app-service/` |
| streaming-service | `streaming-service/` |

Determine which service(s) have changes, then run checks per affected service.

## Workflow

Copy this checklist and track progress:

```
Code Check Progress:
- [ ] Step 1: Collect changes vs development
- [ ] Step 2: Security vulnerability scan
- [ ] Step 3: Logic flaw analysis
- [ ] Step 4: Code consistency check
- [ ] Step 5: Test coverage report
- [ ] Step 6: Produce final report
```

---

### Step 1: Collect changes vs development

For each affected service, run from that service directory:

```bash
git fetch origin development
git diff origin/development...HEAD --name-only
git diff origin/development...HEAD
```

If already on `development`, compare working tree:

```bash
git diff origin/development --name-only
git diff origin/development
```

Also capture:

```bash
git log origin/development..HEAD --oneline
git status
```

Record: changed files, diff hunks, commits ahead of development. Read the full diff before analyzing — never review from filenames alone.

**Baseline rule:** Every finding in Steps 2–4 must reference how the changed code differs from or deviates from patterns on `development`.

---

### Step 2: Security vulnerability scan

#### 2a. Dependency audit

Per affected service:

```bash
npm audit --audit-level=moderate
```

Flag new or upgraded packages in the diff. Compare `package.json` / `package-lock.json` changes against `origin/development`.

#### 2b. Code-level security review

Inspect changed files for (see [CHECKLIST.md](CHECKLIST.md) for full list):

- Injection (SQL/NoSQL, command, path traversal)
- Broken auth / missing middleware (`authenticateToken`, role checks)
- Sensitive data exposure (PII in logs, unfiltered responses, secrets in code)
- CSRF / cookie / JWT handling regressions
- File upload validation (type, size, path)
- Rate limiting on auth endpoints
- Prisma raw queries without parameterization
- Mass assignment / missing input validation
- IDOR (accessing resources by ID without ownership check)

For each finding, cite the file and compare with the equivalent pattern on `development` (e.g. "Other controllers use `handleDomainError`; this one leaks stack traces — not present on development").

---

### Step 3: Logic flaw analysis

Review changed business logic against `development` baseline:

1. **Correctness** — off-by-one, race conditions, async/await gaps, unhandled promise rejections, missing transactions
2. **Edge cases** — null/undefined inputs, empty arrays, duplicate records, concurrent updates, soft-delete vs hard-delete
3. **State consistency** — DB + cache (Redis) + queue (RabbitMQ) alignment
4. **Error paths** — every `try/catch` and early return; errors must use `handleDomainError` / domain error types
5. **Breaking changes** — API response shape, status codes, required fields vs what `development` exposes
6. **Side effects** — missed cleanup, orphaned records, incorrect cascade behavior

Read surrounding code on `development` for the same module before flagging a logic issue:

```bash
git show origin/development:path/to/file.ts
```

---

### Step 4: Code consistency check

Verify changed code matches project conventions on `development`:

| Area | Convention |
|------|------------|
| Structure | `controllers/`, `routes/`, `services/`, `middleware/`, `utils/`, `tests/` |
| Routes | Factory functions (`createXRoutes(prisma)`), controller delegation |
| Errors | `DomainError`, `handleDomainError`, `domainMessages` |
| Types | No `any`; explicit interfaces/types |
| API changes | Swagger updated in `src/config/swagger.ts` |
| Cross-service | Naming and patterns aligned across auth-service, app-service, streaming-service |
| Constants | Magic strings extracted to constants |
| Logging | `appLogger` / pino — no `console.log` |

Flag inconsistencies where the change introduces a pattern not used on `development` or diverges from sibling services.

---

### Step 5: Test coverage report

#### 5a. Identify test gaps

From the diff, list changed source files under `src/` and map each to its test file(s) under `src/tests/` or `tests/`.

Check whether new/changed logic has corresponding test changes:

```bash
git diff origin/development...HEAD -- '**/tests/**' '**/*.test.ts' '**/*.spec.ts'
```

#### 5b. Run coverage on changed files

Per affected service, run coverage scoped to changed source files:

```bash
npm run test:coverage -- --collectCoverageFrom="src/path/to/changed/**/*.ts" --testPathPattern="RelevantTest|AnotherTest"
```

Use `--testPathPattern` with test names/files related to the changed code. Run only relevant tests — never the full suite.

If no tests exist for changed logic, report as **uncovered** with severity based on risk (auth/payments = critical).

#### 5c. Report metrics

For each changed source file, report:

| File | Lines changed | Covered by tests? | Coverage % (if run) | Notes |
|------|---------------|-------------------|---------------------|-------|

Compare against coverage patterns on `development` — flag if similar files on development have tests but the change does not.

---

### Step 6: Produce final report

Use this template:

```markdown
# Code Check Report

**Branch:** [current branch]
**Base:** development
**Services checked:** [auth-service, ...]
**Commits ahead of development:** [count]

## Summary
[1–2 sentences: overall risk level and top concerns]

## Critical findings
[Must fix before merge — security holes, logic bugs, missing auth]

## Warnings
[Should fix — consistency issues, missing edge-case handling, test gaps]

## Suggestions
[Optional improvements]

## Security scan
| Severity | Finding | File | vs development |
|----------|---------|------|----------------|

## Logic analysis
| Severity | Finding | File | vs development |
|----------|---------|------|----------------|

## Consistency
| Area | Finding | Recommendation |
|------|---------|----------------|

## Test coverage
| File | Changed lines | Test status | Coverage |
|------|---------------|-------------|----------|

## Dependency audit
[Affected packages and npm audit results per service]

## Verdict
- [ ] Ready to merge
- [ ] Merge after fixes
- [ ] Needs significant rework
```

### Severity levels

- **Critical** — security vulnerability, data loss, broken auth, logic bug affecting production
- **Warning** — missing tests for important logic, inconsistency, unhandled edge case
- **Suggestion** — style, minor refactor, nice-to-have test

---

## Important rules

1. **Always compare with `development`** — use `git diff origin/development` and `git show origin/development:...` as the baseline.
2. **Read before judging** — open changed files and their `development` counterparts.
3. **Run commands** — do not simulate audit or coverage output.
4. **Per-service git** — each service has its own repo; run git commands inside the correct directory.
5. **Do not run full test suites** — scope tests to changes only (`-t` / `--testPathPattern`).
6. **Do not modify code** unless the user asks — this skill is read-only analysis.

## Additional resources

- Full security and consistency checklist: [CHECKLIST.md](CHECKLIST.md)
