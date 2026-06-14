# Code Check — Detailed Checklist

Reference for Steps 2–4 of the code-check skill. Compare each item against patterns on the `development` branch.

## Security

### Authentication & authorization
- [ ] Protected routes use `authenticateToken` or equivalent middleware
- [ ] Role/permission checks present where `development` has them for similar routes
- [ ] JWT validation uses JWKS; no hardcoded secrets
- [ ] Token expiration and refresh logic unchanged or intentionally updated
- [ ] Health endpoints use `requireHealthSupportAuth` (not public)

### Input validation
- [ ] Request body, params, and query validated before use
- [ ] File uploads restricted by MIME type and size
- [ ] UUIDs/IDs validated before DB lookup
- [ ] No direct use of user input in raw SQL or shell commands

### Data exposure
- [ ] Responses exclude sensitive fields (passwords, tokens, internal IDs)
- [ ] Error responses do not leak stack traces in production paths
- [ ] Logs do not contain PII or credentials
- [ ] Swagger docs do not expose internal endpoints unintentionally

### Infrastructure
- [ ] `helmet`, CORS, rate limiting still applied
- [ ] Cookie flags: `httpOnly`, `secure`, `sameSite` consistent with development
- [ ] CSRF protection intact on state-changing routes
- [ ] `TRUST_PROXY` respected for rate limiting behind reverse proxy

### Dependencies
- [ ] No new packages with known CVEs (npm audit)
- [ ] Lockfile committed alongside package.json changes
- [ ] No unnecessary dependencies added

## Logic

### Database (Prisma)
- [ ] Transactions used for multi-step writes
- [ ] Unique constraint violations handled
- [ ] Soft delete respected in queries (if used on development)
- [ ] Cascades and foreign keys behave correctly
- [ ] No N+1 queries introduced

### Async & concurrency
- [ ] All async functions awaited or returned
- [ ] Error handling in async route handlers
- [ ] Redis/RabbitMQ failures handled gracefully
- [ ] Idempotency for retry-prone operations

### Business rules
- [ ] Authorization checked before mutation (not just authentication)
- [ ] Ownership verified (user can only modify their resources)
- [ ] Subscription/plan gates enforced where applicable
- [ ] Date/time handling timezone-safe

### API contract
- [ ] HTTP status codes match development conventions (200/201/400/401/403/404/409/500)
- [ ] Response shape `{ message, data }` consistent with sibling endpoints
- [ ] Breaking changes documented

## Consistency

### File & naming patterns
- [ ] Controller: `*Controller.ts`, class with methods bound as arrow functions or `.bind`
- [ ] Routes: `create*Routes(prisma)` factory exporting `Router`
- [ ] Service: `*Service.ts` with business logic, injected `PrismaClient`
- [ ] Tests: `src/tests/` mirroring source structure, `*.test.ts` suffix

### Cross-service alignment
When a pattern exists in one service, new code in another should match:

| Pattern | auth-service | app-service | streaming-service |
|---------|-------------|-------------|-------------------|
| Error handling | `handleDomainError` | same | same |
| Swagger location | `src/config/swagger.ts` | same | same |
| Health endpoint | `/api/auth/health` | service-specific | service-specific |
| Logger | `appLogger` (pino) | same | same |

### Swagger
- [ ] New/changed endpoints documented in `src/config/swagger.ts`
- [ ] Request/response schemas defined
- [ ] Auth requirements noted (Bearer, cookies)

## Test coverage expectations

| Change type | Expected test |
|-------------|---------------|
| New API endpoint | Controller + integration test |
| New service method | Unit test with mocked Prisma |
| Bug fix | Regression test proving fix |
| Auth/permission change | Tests for allowed and denied cases |
| Validation change | Tests for valid and invalid inputs |

Uncovered critical paths (auth, payments, data mutation) = **Warning** minimum.
