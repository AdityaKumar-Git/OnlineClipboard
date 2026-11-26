# Online Clipboard — Architecture & Spec

## 1. What it does

- Signed-in users share **text** or **files** and get a **PIN** that is valid for 5–15 minutes.
- Anyone with the PIN can open the text or download the file on another device.
- Two share modes:
  - **Temporary:** the PIN expires and the content (DB text or Drive file) is deleted automatically.
  - **History:** the PIN still expires, but the share is kept and listed on the History page
    until the user deletes it.
- Files live in the **sender's own Google Drive**, in an app folder (`Online Clipboard`).
- Text sharing needs only sign-in. **Drive is connected only when the user first shares a file**
  (incremental authorization).

> **Decision to confirm:** receiving with a PIN does **not** need an account (default).
> To require login for receiving, add the auth middleware to `/api/receive/*`.

## 2. Components

| Component | Responsibility |
|---|---|
| Web app (React) | Sign-in, Send, Receive, History pages, reconnect banner. Uploads files straight to Drive. |
| API server (Express) | Auth, Drive connection, PIN creation and lookup, download proxy, token refresh. |
| PostgreSQL | Users, encrypted refresh tokens, shares and history. |
| Redis | Active PINs (TTL), rate limits, sessions, cleanup-worker lock. |
| Cleanup worker | Runs every minute and deletes expired temporary shares (Drive file + DB). |
| Google Drive | Stores files in each user's app folder. |

## 3. Google OAuth

Google Cloud project with the **Drive API** enabled and an OAuth client of type *Web application*.

**Sign-in** (`GET /auth/google`)
- Scopes: `openid email profile`
- Callback: find or create the user by `google_sub`, then start the session.

**Connect / reconnect Drive** (`GET /auth/google/drive`)
- Scope: `https://www.googleapis.com/auth/drive.file`
- Parameters: `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`
  (`prompt=consent` makes Google return a new refresh token on every reconnect)
- Callback:
  1. Encrypt the refresh token and save it.
  2. Set `drive_connected = true`, `drive_connected_at = now()`.
  3. Set `drive_token_expires_at = now() + DRIVE_REFRESH_TOKEN_TTL_DAYS` (left NULL when the
     variable is empty, i.e. in production mode).
  4. On first connect, create the `Online Clipboard` folder and save `drive_folder_id`.
     On later connects, check the folder still exists (`files.get`). If it's gone, create it again.
  5. Retry any shares with `status = 'delete_failed'` for this user.

**Access tokens:** the server gets them from the refresh token when needed and caches each one
in Redis (`gtoken:{userId}`, TTL = expires_in − 60s).

**`invalid_grant` from Google** (token expired or revoked): set `drive_connected = false`.
The UI then shows "Reconnect Google Drive".

### Reconnect reminder (Testing mode)

In Testing mode Google refresh tokens die **7 days after they are issued**, and they cannot be
renewed without the user. So:

- `GET /api/me` returns `drive.reconnectSoon = true` when
  `drive_token_expires_at - now() < 24h`.
- The web app shows a banner: **"Your Google Drive connection expires tomorrow. Reconnect now."**
  The button links to `/auth/google/drive`.
- After the app is published to production, leave `DRIVE_REFRESH_TOKEN_TTL_DAYS` empty and the
  banner never shows.

## 4. Data model (Prisma / PostgreSQL)

```prisma
model User {
  id                    String    @id @default(uuid())
  googleSub             String    @unique
  email                 String
  name                  String?
  driveConnected        Boolean   @default(false)
  driveRefreshTokenEnc  String?   // AES-256-GCM: iv:authTag:ciphertext (base64)
  driveFolderId         String?
  driveConnectedAt      DateTime?
  driveTokenExpiresAt   DateTime? // null = no known expiry (production mode)
  createdAt             DateTime  @default(now())
  shares                Share[]
}

enum ShareKind   { TEXT FILE }
enum ShareMode   { TEMP HISTORY }
enum ShareStatus { ACTIVE DELETED DELETE_FAILED }

model Share {
  id            String      @id @default(uuid())
  ownerId       String
  owner         User        @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  kind          ShareKind
  textContent   String?     // TEXT only
  driveFileId   String?     // FILE only
  fileName      String?
  mimeType      String?
  sizeBytes     BigInt?
  pin           String      // kept for display in History; uniqueness is enforced in Redis
  mode          ShareMode
  pinExpiresAt  DateTime
  deleteAfter   DateTime?   // TEMP: = pinExpiresAt; HISTORY: null
  status        ShareStatus @default(ACTIVE)
  createdAt     DateTime    @default(now())
  deletedAt     DateTime?

  @@index([ownerId, createdAt])
  @@index([status, deleteAfter])
}
```

## 5. Redis keys

| Key | Value | TTL | Purpose |
|---|---|---|---|
| `pin:{PIN}` | shareId | 5–15 min | Active PIN → share. Created with `SET NX EX` so active PINs are unique. |
| `share-pin:{shareId}` | PIN | same | Lets a delete kill the PIN early. |
| `rl:pin:{ip}` | counter | 10 min | Receive attempts per IP (max `PIN_RATE_LIMIT`, default 10). |
| `gtoken:{userId}` | access token | ~59 min | Cached Google access token. |
| `sess:{id}` | session | 7 days | Express sessions (`connect-redis`). |
| `lock:cleanup` | worker id | 55 s | Only one cleanup worker runs at a time. |

**PIN format:** 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0, 1).
That's about 1 billion combinations. Generate it, try `SET NX`, and on a collision generate
again (max 5 tries).

## 6. API

All `/api/*` routes need a session except `/api/receive/*`.

### Auth & account
| Method | Path | Notes |
|---|---|---|
| GET | `/auth/google` | Start sign-in |
| GET | `/auth/google/callback` | |
| GET | `/auth/google/drive` | Connect / reconnect Drive |
| GET | `/auth/google/drive/callback` | |
| POST | `/auth/logout` | |
| GET | `/api/me` | `{ id, email, name, drive: { connected, expiresAt, reconnectSoon } }` |
| POST | `/api/drive/disconnect` | Revoke the token at Google, clear the stored token |
| GET | `/api/drive/token` | `{ accessToken, folderId }` used by the browser for a direct upload. Only for the signed-in user's own Drive. |

### Shares
| Method | Path | Notes |
|---|---|---|
| POST | `/api/shares` | Body: `{ kind: 'text', text, mode, ttlMinutes }` or `{ kind: 'file', driveFileId, mode, ttlMinutes }`. `ttlMinutes` 5–15. For files, the server calls `files.get` to check that the file exists, is in the user's app folder and is under `MAX_FILE_SIZE_MB`, and saves name/mime/size from Drive, not from the client. Returns `{ id, pin, pinExpiresAt }`. |
| GET | `/api/shares?cursor=` | History: the user's `HISTORY` shares that aren't deleted, newest first, 20 per page |
| DELETE | `/api/shares/:id` | Owner only. Deletes the Drive file (404 = fine), deletes the PIN keys, sets `status = DELETED`. |

### Receive (no login, rate-limited)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/receive/:pin` | Text → `{ kind: 'text', text }`. File → `{ kind: 'file', fileName, mimeType, sizeBytes }`. 404 if the PIN is expired or unknown, 429 when rate-limited. |
| GET | `/api/receive/:pin/download` | Streams `files.get(alt=media)` with the owner's token. Sets `Content-Disposition: attachment` and `Content-Type`. Native Google Docs/Sheets/Slides types are exported (`files.export`) as PDF. |

## 7. Flows

**Send text:** Send page → `POST /api/shares` → PIN shown with a countdown.

**Send file**
1. Drive not connected → send the user to `/auth/google/drive`.
2. Browser calls `GET /api/drive/token`.
3. Browser starts a Drive **resumable upload** into `folderId`, with name `{uuid}-{originalName}`,
   and shows upload progress.
4. Drive returns the file ID → `POST /api/shares` with `driveFileId` → PIN shown.

**Receive:** Receive page → enter PIN → `GET /api/receive/:pin` → show the text with a copy
button, or file details with a Download button that opens `/api/receive/:pin/download`.

**Delete (History page):** Delete button → confirm → `DELETE /api/shares/:id`.

## 8. Cleanup worker

Runs every 60 s (`node-cron`):
1. `SET lock:cleanup {workerId} NX EX 55`. If the lock isn't taken, skip this run.
2. Pick up to 100 shares with `mode = TEMP`, `status = ACTIVE`, `deleteAfter <= now()`.
3. TEXT: set `textContent = null`, `status = DELETED`, `deletedAt = now()`.
4. FILE: `drive.files.delete` with the owner's token.
   - Success or 404 → `status = DELETED`.
   - `invalid_grant` / no token → `status = DELETE_FAILED`. Retried after the owner reconnects.
   - Other errors → leave as `ACTIVE` and retry next run. Log it.
5. Release the lock.

## 9. Security

- Session cookie: `httpOnly`, `secure` in production, `sameSite=lax`.
- CSRF: needs the `X-Requested-With` header on state-changing `/api/*` requests, plus `sameSite`.
- `helmet`, CORS limited to `WEB_ORIGIN`.
- Refresh tokens are encrypted with AES-256-GCM. The key is 32 random bytes in `TOKEN_ENC_KEY`.
- Never log tokens, PINs with their share contents, or file contents.
- File size limit `MAX_FILE_SIZE_MB` (default 100), checked in the browser **and** on the server
  using the size Drive reports.
- Text limit 100 KB.

## 10. Edge cases

| Case | Handling |
|---|---|
| Refresh token expires (Testing mode, 7 days) | Banner 24h before. After it expires, `invalid_grant` → `drive_connected = false` → "Reconnect" prompt. |
| User deleted the file in Drive | Receive/download gets 404 → reply "File no longer available" and mark the share `DELETED`. |
| User deleted the app folder | Recreated on the next connect, or when an upload finds it missing. |
| Drive is full | Upload fails with `storageQuotaExceeded` → "Your Google Drive is full." |
| PIN guessing | 6-character PIN, per-IP rate limit, generic 404 for wrong and expired PINs alike. |
| Upload interrupted | Resumable upload resumes. A file uploaded without a share is orphaned in the user's folder and harmless. |
| Sender's Drive disconnected while a PIN is active | Download fails with "Sender's Drive is disconnected". |

## 11. Environment variables

See `.env.example`.
