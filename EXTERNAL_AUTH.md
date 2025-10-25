# External Service Authentication

This document describes how external services should authenticate when accessing the `/api/v1/stream` APIs.

## Overview

All streaming APIs under `/api/v1/stream` now require external service authentication using a `user_id` header. This replaces the previous session-based authentication for these endpoints.

## Authentication Method

### Required Header

- **Header Name**: `user_id`
- **Header Value**: A valid user identifier (string)
- **Required**: Yes, for all streaming endpoints except health checks

### Example Request

```bash
curl -H "user_id: user123" \
     http://localhost:3000/api/v1/stream/chapters/chapter-456/status
```

### JavaScript/TypeScript Example

```javascript
const response = await fetch(
  "http://localhost:3000/api/v1/stream/chapters/chapter-456/status",
  {
    headers: {
      user_id: "user123",
      "Content-Type": "application/json",
    },
  }
);
```

## Protected Endpoints

The following endpoints require the `user_id` header:

- `GET /api/v1/stream/chapters/{chapterId}/master.m3u8`
- `GET /api/v1/stream/chapters/{chapterId}/{bitrate}/playlist.m3u8`
- `GET /api/v1/stream/chapters/{chapterId}/{bitrate}/segments/{segmentId}`
- `GET /api/v1/stream/chapters/{chapterId}/status`
- `POST /api/v1/stream/chapters/{chapterId}/preload`
- `GET /api/v1/stream/analytics`

## Unprotected Endpoints

The following endpoints do not require authentication:

- `GET /api/v1/stream/health` - Health check endpoint
- `GET /health` - Global health check endpoint
- `GET /` - Service info endpoint

## Error Responses

### Missing Header

```json
{
  "error": "Unauthorized",
  "message": "user_id header is required for external service authentication",
  "code": "MISSING_USER_ID_HEADER"
}
```

### Invalid Header Format

```json
{
  "error": "Unauthorized",
  "message": "Invalid user_id format in header",
  "code": "INVALID_USER_ID_FORMAT"
}
```

## Implementation Details

- The `user_id` header value is automatically trimmed of whitespace
- Empty strings or whitespace-only values are rejected
- The user ID is made available to controllers via `req.externalUserId` and `req.user.id`
- External service users are assigned the role `external_service`

## Migration Notes

- **Breaking Change**: External services must now include the `user_id` header
- **Backward Compatibility**: Session-based authentication is no longer supported for streaming endpoints
- **Health Checks**: Health endpoints remain accessible without authentication

## Testing

You can test the authentication using curl:

```bash
# This should fail with 401
curl http://localhost:3000/api/v1/stream/chapters/test/status

# This should succeed (assuming the chapter exists)
curl -H "user_id: testuser" http://localhost:3000/api/v1/stream/chapters/test/status
```
