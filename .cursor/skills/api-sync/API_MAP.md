# API → Client mapping reference

Use this as a starting point. Always `rg` the endpoint path in `../mobile/` and `../partner-app/` to confirm all usages.

## Service base URLs

| Backend service | Default port | Mobile env | Partner config |
|-----------------|-------------|------------|----------------|
| auth-service | 8080 | `EXPO_PUBLIC_AUTH_API_PORT` | `getAuthApiBaseUrl()` in `src/utils/config.ts` |
| app-service | 8082 | `EXPO_PUBLIC_API_PORT` | `getContentApiBaseUrl()` in `src/utils/config.ts` |
| streaming-service | (streaming port) | `EXPO_PUBLIC_STREAMING_URL_PORT` | usually N/A for partner |

Path prefix: `/api/v1` (mobile: `EXPO_PUBLIC_API_V1_PATH`).

---

## auth-service

| Endpoint area | Backend paths | Mobile | Partner |
|---------------|---------------|--------|---------|
| Login / register | `/auth/login`, `/auth/login/mobile`, `/auth/register`, OTP flows | `services/auth.ts` | `src/utils/api.ts`, `src/types/auth.ts` |
| Refresh / logout | `/auth/refresh`, `/auth/logout` | `services/auth.ts` | `src/utils/api.ts` |
| Google OAuth | `/auth/google` | `services/auth.ts` | `src/utils/api.ts` |
| Devices | `/auth/devices`, `/auth/devices/*` | `services/devices.ts` | rarely used |
| Subscriptions | `/subscriptions/*` | `services/subscriptions.ts` | `src/utils/audiobookApi.ts` (`getSubscriptionPlans`) |
| Organizations | `/organizations/*` | `services/organizations.ts` | `src/utils/partnerApi.ts`, `src/types/partner.ts` |
| Authors | `/authors/*` | via org/user services | `src/utils/partnerApi.ts` |
| Catalog | `/catalog/organizations/:id`, `/catalog/authors/:id` | search `catalog` in services | search `catalog` in utils |
| User profile | `/users/*`, profile routes | `services/user.ts` | `src/utils/partnerApi.ts`, `tests/userProfileApi.test.ts` |

---

## app-service

| Endpoint area | Backend paths | Mobile | Partner |
|---------------|---------------|--------|---------|
| Audiobooks CRUD | `/audiobooks`, `/audiobooks/:id` | `services/audiobooks.ts`, `services/userAudiobooks.ts` | `src/utils/audiobookApi.ts`, `src/types/audiobook.ts` |
| Chapters | `/audiobooks/:id/chapters`, chapter routes | search in `services/` | `src/utils/audiobookApi.ts` |
| Genres / tags / moods | `/genres`, `/tags`, `/moods` | `services/moods.ts`, audiobook services | `src/utils/audiobookApi.ts` |
| Playlists | `/playlists/*` | `services/playlists.ts` | N/A |
| Favorites | `/favorites/*` | `services/favorites.ts` | N/A |
| Bookmarks / notes | `/bookmarks/*`, `/notes/*` | `services/bookmarks.ts`, `services/notes.ts` | N/A |
| Reviews / comments | `/reviews/*`, `/comments/*` | `services/reviews.ts`, `services/comments.ts` | N/A |
| Listening history | `/listening-history/*` | `services/listeningHistory.ts` | N/A |
| Location | location routes | `services/location.ts` | N/A |

---

## streaming-service

| Endpoint area | Backend paths | Mobile | Partner |
|---------------|---------------|--------|---------|
| Playback / HLS | stream paths under `/api/v1/stream` | `services/streaming.ts`, `services/playbackService.ts` | N/A |
| Master playlist | playlist endpoints | `services/streaming.ts` | N/A |

---

## Response wrapper convention

Backend services typically return:

```json
{
  "success": true,
  "data": { },
  "message": "...",
  "statusCode": 200,
  "timestamp": "...",
  "path": "..."
}
```

Auth login responses may use a flatter shape (`accessToken`, `user`, etc.). Match the **actual** swagger schema for the changed endpoint — do not assume all endpoints use the wrapper.

---

## Search commands

From `backend/` workspace:

```bash
# Find mobile usages of an endpoint fragment
rg "/audiobooks" ../mobile/services ../mobile/tests --glob "*.ts"

# Find partner usages
rg "/audiobooks" ../partner-app/src ../partner-app/tests --glob "*.ts"

# Find backend route definition
rg "router\.(get|post|put|patch|delete)" auth-service/src app-service/src streaming-service/src --glob "*.ts"
```
