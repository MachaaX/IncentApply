# IncentApply Auth Backend

This backend provides:

- Email/password signup (`/api/auth/signup`)
- Email/password login (`/api/auth/login`)
- Google OAuth URL + code exchange signup/login
  - `/api/auth/google/start` (browser redirect to Google)
  - `/api/auth/google/url`
  - `/api/auth/google/exchange`
  - `/api/auth/google/callback`
- Current user endpoint (`/api/auth/me`)

## 1) Environment

Copy `backend/.env.example` (or root `.env.example`) to `.env` in project root and set values:

- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `FRONTEND_URL`

## 2) Run

```bash
npm install
npm run backend:dev
```

Server runs at `http://localhost:4000` by default.

## 3) Database

The server auto-creates a `users` table on startup if it does not exist.

- `mysql://...` `DATABASE_URL` -> uses MySQL (recommended for Azure Database for MySQL).
- `postgresql://...` `DATABASE_URL` -> uses Postgres.
- missing `DATABASE_URL` -> falls back to in-memory storage (dev only, data resets on restart).

## 4) Notes

- Passwords are hashed using Argon2id.
- JWT is returned in JSON response (for production prefer secure `httpOnly` cookies).
- When `dist/` exists, backend serves the built React app and supports SPA routing.
- In production, OAuth callbacks auto-detect public host if `FRONTEND_URL` is still localhost.
