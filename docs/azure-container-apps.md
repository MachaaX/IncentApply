# Deploy IncentApply To Azure Container Apps

## Why this option

- Works well for a single Node service that serves both API + built React app.
- Can scale down to `0` replicas when idle.
- Good fit for a student-credit budget.

## 1) Prepare Azure CLI

```bash
az login
az account set --subscription "<subscription-id-or-name>"
az extension add --name containerapp --upgrade
```

## 2) Set deployment variables

```bash
export AZURE_RESOURCE_GROUP=rg-incentapply
export AZURE_LOCATION=eastus
export AZURE_ACR_NAME=incentapplyacr123
export AZURE_CONTAINERAPP_ENV=cae-incentapply
export AZURE_CONTAINERAPP_NAME=incentapply-web
```

Optional but recommended:

```bash
export DATABASE_URL="<mysql-connection-string>"
export JWT_SECRET="<strong-random-secret>"
export GOOGLE_CLIENT_ID="<google-client-id>"
export GOOGLE_CLIENT_SECRET="<google-client-secret>"
```

## 3) Deploy

```bash
npm run deploy:azure
```

The script prints your public URL when done.

## 4) Update OAuth redirect URIs

After first deploy, update provider callbacks to:

- Google: `https://<public-domain>/api/auth/google/callback`

## 5) Keep costs low

- Current config uses `min-replicas=0` and `max-replicas=1`.
- Scale up only if needed.
- Add a budget alert in Azure Cost Management.
