# IncentApply Auth Backend

This backend provides:

- Email/password signup (`/api/auth/signup`)
- Email/password login (`/api/auth/login`)
- Google OAuth URL + code exchange signup/login
  - `/api/auth/google/start` (browser redirect to Google)
  - `/api/auth/google/url`
  - `/api/auth/google/exchange`
  - `/api/auth/google/callback`
- Microsoft Entra External ID OAuth signup/login
  - `/api/auth/entra/start` (browser redirect to Entra)
  - `/api/auth/entra/url`
  - `/api/auth/entra/exchange`
  - `/api/auth/entra/callback`
- Current user endpoint (`/api/auth/me`)

## 1) Environment

Copy `backend/.env.example` (or root `.env.example`) to `.env` in project root and set values:

- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_REDIRECT_URI`
- `ENTRA_DISCOVERY_URL`
- `ENTRA_SCOPES` (optional, defaults to `openid profile email`)
- `FRONTEND_URL`

## 2) Run

```bash
npm install
npm run backend:dev
```

Server runs at `http://localhost:4000` by default.

## 3) Database

The server auto-creates a `users` table on startup if it does not exist.

## 4) Notes

- Passwords are hashed using Argon2id.
- JWT is returned in JSON response (for production prefer secure `httpOnly` cookies).
