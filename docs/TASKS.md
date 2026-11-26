# Build plan

Work top to bottom. Each task is done when its code, its tests and a manual check all pass.
See `ARCHITECTURE.md` for details.

## 0. Setup
- [x] Create `/server` (Express + TS) and `/web` (Vite + React + TS), with ESLint and Prettier
- [x] `docker-compose.yml` with Postgres and Redis; `.env` from `.env.example`
- [x] Prisma set up with the schema from ARCHITECTURE §4; first migration
- [x] `lib/redis.ts`, `lib/prisma.ts`, health endpoint `GET /api/health` (checks DB + Redis)

## 1. Sign-in
- [x] Google sign-in (`/auth/google`, callback), user upsert by `googleSub`
- [x] Sessions in Redis (`connect-redis`), logout, `GET /api/me`
- [x] Web: Login page, protected routes, header showing the user

## 2. Text sharing
- [x] `services/pin.ts`: generate PIN, `SET NX EX`, collision retry, `share-pin` key
- [ ] `POST /api/shares` for text (zod validation, ttl 5–15, mode TEMP/HISTORY)
- [x] `GET /api/receive/:pin` for text, with the per-IP rate limit
- [ ] Web: Send page (text box, mode toggle, TTL picker, PIN + countdown), Receive page

## 3. Connect Google Drive
- [ ] `services/crypto.ts`: AES-256-GCM encrypt/decrypt (with tests)
- [ ] `/auth/google/drive` + callback: store the token, set expiry, create/verify the app folder
- [ ] `services/tokens.ts`: get access token (cached in Redis); `invalid_grant` → mark disconnected
- [ ] `GET /api/drive/token`, `POST /api/drive/disconnect`
- [ ] `/api/me` returns drive status + `reconnectSoon`

## 4. Send files
- [ ] Web: file picker, size check, resumable upload to Drive with a progress bar
- [ ] `POST /api/shares` for files: verify with `files.get` (folder, size), save metadata
- [ ] Errors: Drive not connected → connect flow; quota exceeded message

## 5. Receive files
- [ ] `GET /api/receive/:pin` for files (metadata)
- [ ] `GET /api/receive/:pin/download`: stream from Drive with the owner's token; export native Google types; handle 404
- [ ] Web: file card with a Download button on the Receive page

## 6. History
- [ ] `GET /api/shares` (paginated, HISTORY only, not deleted)
- [ ] `DELETE /api/shares/:id` (Drive delete, PIN keys removed, status DELETED)
- [ ] Web: History page with a list, "PIN active / expired" badge and a Delete button with confirm

## 7. Cleanup worker
- [ ] `worker.ts` with node-cron every minute and the Redis lock
- [ ] Delete expired TEMP text and files; DELETE_FAILED handling
- [ ] Retry DELETE_FAILED shares in the Drive-reconnect callback
- [ ] Tests for success, 404, `invalid_grant`, and the lock being held

## 8. Reconnect reminder
- [ ] Web: banner "Your Google Drive connection expires tomorrow. Reconnect now." when `reconnectSoon`
- [ ] Web: "Reconnect Google Drive" prompt when `drive.connected` is false but the user has file shares
- [ ] Manual test: set `DRIVE_REFRESH_TOKEN_TTL_DAYS` small to check the banner

## 9. Hardening and release
- [ ] helmet, CORS, CSRF header check, text and file size limits
- [ ] Friendly error states on every page; loading states
- [ ] README with setup steps (Google Cloud, env, run commands)
- [ ] Deploy (e.g. web on Vercel/Netlify, server + worker + Postgres + Redis on Render/Railway)
- [ ] Add evaluators as OAuth test users, or publish the consent screen to production
