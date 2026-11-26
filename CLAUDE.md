# Online Clipboard — project guide for Claude

A web app for sharing **text and files across devices** using a short-lived PIN.
Text is stored in our database. Files are stored in the **user's own Google Drive**
(in an app folder), so we never pay for file storage.

Full spec: `docs/ARCHITECTURE.md`. Build order: `docs/TASKS.md`. Work through the
tasks in order, tick each box when it's done and tested, and don't skip ahead.

## Stack

- **Language:** TypeScript everywhere (strict mode)
- **Backend:** Node.js 20+, Express, `googleapis` npm package
- **Database:** PostgreSQL via Prisma
- **Redis:** `ioredis`. Used for active PINs (TTL), rate limits, sessions and the cleanup lock
- **Frontend:** React + Vite, React Router
- **Worker:** separate Node process (`server/src/worker.ts`) that runs the cleanup job every minute
- **Tests:** Vitest + Supertest. Mock all Google API calls
- **Local services:** `docker compose up -d` starts Postgres and Redis

## Repo layout

```
/server        Express API + worker
  src/routes   auth, drive, shares, receive
  src/services pin, drive, crypto, tokens, cleanup
  src/lib      prisma, redis, google clients
  prisma/      schema.prisma + migrations
/web           React app (pages: Login, Send, Receive, History)
/docs          ARCHITECTURE.md, TASKS.md
```

## Commands (fill in as they are created)

- `docker compose up -d`: start Postgres + Redis
- `npm install` (in /server and /web): install deps (server runs `prisma generate` on install)
- `npm run dev` (in /server and /web): dev servers (API :4000, web :5173 proxies `/api` + `/auth`)
- `npm run worker` (in /server): cleanup worker _(Phase 7, not created yet)_
- `npm test` (in /server): run tests
- `npm run lint`, `npm run typecheck`, `npm run format` (in /server and /web)
- `npm run db:migrate` (in /server): `prisma migrate dev` using the repo-root `.env`
- `npm run prisma -- <args>` (in /server): any Prisma CLI command with the root `.env` loaded
- The single `.env` lives at the repo root; the server loads it from there

## Rules that must never be broken

1. **Drive scope is `drive.file` only.** Never request full `drive` access.
2. **Identify files by Drive file ID**, never by name. The name is display-only.
3. **Refresh tokens are encrypted at rest** (AES-256-GCM, key from `TOKEN_ENC_KEY`).
   They are never sent to the browser or written to logs.
4. **A PIN is valid only while its Redis key exists.** Expiry is enforced by Redis TTL,
   not by the cleanup worker. Deleting the Drive file is a separate, later step.
5. **Receivers never get a Drive link.** File downloads are streamed through
   `GET /api/receive/:pin/download` using the owner's token.
6. **Uploads go directly from the browser to Drive** (resumable upload). The server
   only gets metadata and then verifies the file ID.
7. **PIN lookups are rate-limited per IP** (Redis counter) on every receive endpoint.
8. **The cleanup worker must be idempotent.** A Drive 404 counts as already deleted.
   It holds a Redis lock so only one instance runs at a time.
9. All secrets come from environment variables (see `.env.example`). Never hard-code them.

## Conventions

- Validate every request body with `zod`.
- Errors have the shape `{ error: { code, message } }` with correct HTTP status codes.
- Small functions in services; route handlers stay thin.
- Write tests alongside each feature (happy path + the main failure case).
- Commit after each completed task with a clear message.
