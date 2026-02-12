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
- `npm run deploy:azure` - deploy/update a public Azure Container App
- `npm run test` - run test suite once
- `npm run test:watch` - run tests in watch mode

## Deploy To Azure (Web Service)

Recommended for your student credits: Azure Container Apps with `min-replicas=0` and `max-replicas=1` for low idle cost.

### Prerequisites

- Azure CLI installed
- Logged in with a subscription that has your student credits:
  - `az login`
  - `az account set --subscription "<your-subscription-id-or-name>"`

### One-time setup

Pick globally unique names and export:

```bash
export AZURE_RESOURCE_GROUP=rg-incentapply
export AZURE_LOCATION=eastus
export AZURE_ACR_NAME=incentapplyacr123
export AZURE_CONTAINERAPP_ENV=cae-incentapply
export AZURE_CONTAINERAPP_NAME=incentapply-web
```

Optional auth/data envs (recommended for persistence/auth):

```bash
export DATABASE_URL="<your-mysql-connection-string>"
export JWT_SECRET="<strong-random-secret>"
export GOOGLE_CLIENT_ID="<google-client-id>"
export GOOGLE_CLIENT_SECRET="<google-client-secret>"
export GOOGLE_REDIRECT_URI="https://<your-public-domain>/api/auth/google/callback"
```

### Deploy

```bash
npm run deploy:azure
```

This builds and pushes a Docker image to ACR, creates/updates Container App resources, and prints your public URL.

### Optional GitHub Auto-Deploy

After the first deploy, you can generate a GitHub Actions workflow from Azure CLI:

```bash
az containerapp github-action add \
  --name "$AZURE_CONTAINERAPP_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --repo-url "https://github.com/<owner>/<repo>" \
  --branch "main" \
  --registry-url "$(az acr show -g "$AZURE_RESOURCE_GROUP" -n "$AZURE_ACR_NAME" --query loginServer -o tsv)"
```

Detailed guide: `docs/azure-container-apps.md`

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
- Email/password signup/login support
- MySQL/Postgres-backed user storage (MySQL recommended on Azure)
- Argon2id password hashing

Frontend is wired to backend auth through:

- `VITE_AUTH_BACKEND_URL`
- `VITE_AUTH_STRATEGY` (`backend`, `hybrid`, or `mock`)

See `backend/README.md`, `backend/.env.example`, and `.env.example` for setup.
