# Contract diff template

Copy and fill one block per changed endpoint.

```markdown
## [METHOD] [path]

- **Service:** auth-service | app-service | streaming-service
- **Change type:** added | removed | modified
- **Breaking:** yes | no

### Before (development)
- Path params: ...
- Query: ...
- Request body: ...
- Response: ...
- Status codes: ...
- Auth: ...

### After (current)
- Path params: ...
- Query: ...
- Request body: ...
- Response: ...
- Status codes: ...
- Auth: ...

### Client impact
- **Mobile:** [files + what to change]
- **Partner:** [files + what to change | N/A]
```

## Example

```markdown
## POST /auth/login

- **Service:** auth-service
- **Change type:** modified
- **Breaking:** yes

### Before (development)
- Request body: `{ email, password, device?: { deviceId, deviceName, platform } }`
- Response: `{ accessToken, refreshToken, user }`
- Auth: public

### After (current)
- Request body: `{ email, password, device: { deviceId, deviceName, platform } }` — **device required**
- Response: unchanged
- Auth: public

### Client impact
- **Mobile:** `services/auth.ts` — ensure `login()` always sends `device`; update tests in `tests/services/authProvider.test.ts`
- **Partner:** `src/utils/api.ts` — `login()` already sends device; verify required shape in `src/types/auth.ts`
```
