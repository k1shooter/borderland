# BORDERLAND WebApp

Realtime multiplayer death-game webapp inspired by Borderland-style game loops.

## What changed in this refactor

- Account death lock is now account-only (`ACCOUNT_DEAD` by `userId/username`), no IP/device/wallet lock keys.
- Death records are still persisted and can be written on-chain asynchronously.
- Storage layer supports PostgreSQL/Redis with JSON fallback.
- SIWE (EIP-4361) wallet signature authentication added.
- Socket submit protocol now uses envelope validation:
  - `phaseId`, `phaseToken`, `seq`, `payload`
- Physical-game anti-cheat improved:
  - `game:input` frame stream tracking
  - metrics sanitized against server-side input stats
- Room state versioning and resync endpoint added:
  - `GET /api/rooms/:id/state?sinceVersion=<n>`

## Tech stack

- Backend: Node.js, Express, Socket.IO
- Frontend: Vanilla JS, HTML/CSS, Canvas
- Data: PostgreSQL + Redis (optional JSON fallback)
- Queue: BullMQ
- Wallet auth: SIWE + Ethers

## Quick start

```bash
npm install
npm start
```

Open: `http://localhost:3100`

Default admin:
- ID: `admin`
- PW: `borderland-admin-2026!`

## Environment variables

Required for production-style deployment:

- `JWT_SECRET`
- `DATABASE_URL`
- `REDIS_URL`
- `RPC_URL`
- `DEATH_REGISTRY_ADDRESS`
- `CHAIN_ID`
- `SIWE_ALLOWED_CHAIN_IDS`

Optional flags:

- `READ_DB=true|false` (default: auto true when `DATABASE_URL` exists)
- `WRITE_JSON=true|false` (default: true)

## DB migration and JSON import

```bash
npm run migrate
npm run import-json
```

## Chain worker

Run worker separately:

```bash
npm run worker
```

For chain writes set:
- `CHAIN_PRIVATE_KEY`

## Main API endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/siwe/nonce`
- `POST /api/auth/siwe/verify`
- `POST /api/auth/wallet/link/nonce`
- `POST /api/auth/wallet/link/verify`
- `GET /api/rooms/:id/state?sinceVersion=<n>`
- `GET /api/leaderboard`

Legacy compatibility:
- `POST /api/register`
- `POST /api/login`

## Socket events

Client -> Server:
- `game:submit` `{ phaseId, phaseToken, seq, payload }`
- `game:input` `{ phaseId, phaseToken, seq, frames }`

Server -> Client:
- `room:update`
- `room:delta`
- `sync:clock`
- `auth:dead`

## Notes

- `puzzle-codebreak` allows multi-submit per phase.
- Other engines are one-submit-per-phase.
- D8 and D9 timeout paths are handled without forced immediate session termination.
