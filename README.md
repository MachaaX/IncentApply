# IncentApply

Frontend-first React webapp for gamified job applications with group goals, weekly stake rules, leaderboard progress, Gmail sync simulation, and wallet settlement flows.

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- React Router
- TanStack Query
- Vitest + Testing Library

## Run

```bash
npm install
# shared frontend+backend env
cp .env.example .env
npm run dev
```

## Scripts

- `npm run dev` - start frontend + backend together
- `npm run dev:frontend` - start frontend only
- `npm run dev:all` - alias for `npm run dev`
- `npm run backend:dev` - start backend auth server
- `npm run backend:dev:watch` - start backend auth server with auto-reload
- `npm run backend:start` - start backend auth server
- `npm run build` - typecheck and production build
- `npm run preview` - preview production build
- `npm run test` - run test suite once
- `npm run test:watch` - run tests in watch mode

## Implemented Pages

Public routes:
- `/welcome`
- `/auth/login`
- `/auth/register`

Protected routes:
- `/group/setup`
- `/dashboard`
- `/wallet`
- `/settings`
- `/members`
- `/settlements`

## Domain and Services

Typed contracts and models are defined in `src/domain/types.ts` and `src/services/contracts.ts`.

Mock adapters with localStorage persistence are implemented in `src/services/mock/mockServices.ts`.

## Product Rules Implemented

- Friday-to-Friday weekly cycle in group timezone
- Shared group threshold for all members
- Platform-controlled stake split (`$7` base + `$7` goal-locked default)
- Settlement: base returned to all; goal-locked returned only if goal met; lost goal-locked pool redistributed equally to all members
- Personal wallet withdrawals only
- Gmail keyword/rule-based matching + manual log entries

## Backend Auth

Backend auth server files are in `backend/` with:

- Google OAuth signup/login support
- Microsoft Entra External ID OAuth signup/login support
- Email/password signup/login support
- Postgres-backed user storage
- Argon2id password hashing

Frontend is wired to backend auth through:

- `VITE_AUTH_BACKEND_URL`
- `VITE_AUTH_STRATEGY` (`backend`, `hybrid`, or `mock`)

See `backend/README.md`, `backend/.env.example`, and `.env.example` for setup.
