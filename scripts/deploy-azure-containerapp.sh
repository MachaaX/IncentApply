#!/usr/bin/env bash
set -euo pipefail

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) is required. Install it first."
  exit 1
fi

AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-incentapply}"
AZURE_LOCATION="${AZURE_LOCATION:-eastus}"
AZURE_ACR_NAME="${AZURE_ACR_NAME:-}"
AZURE_CONTAINERAPP_ENV="${AZURE_CONTAINERAPP_ENV:-cae-incentapply}"
AZURE_CONTAINERAPP_NAME="${AZURE_CONTAINERAPP_NAME:-incentapply-web}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
IMAGE_NAME="incentapply:${IMAGE_TAG}"

if [[ -z "${AZURE_ACR_NAME}" ]]; then
  echo "Set AZURE_ACR_NAME before running this script."
  echo "Example: export AZURE_ACR_NAME=incentapplyacr123"
  exit 1
fi

echo "Ensuring Azure Container Apps extension..."
az extension add --name containerapp --upgrade >/dev/null

echo "Registering required Azure resource providers (safe if already registered)..."
az provider register --namespace Microsoft.App >/dev/null
az provider register --namespace Microsoft.OperationalInsights >/dev/null

echo "Creating resource group if needed..."
az group create \
  --name "${AZURE_RESOURCE_GROUP}" \
  --location "${AZURE_LOCATION}" \
  >/dev/null

if ! az acr show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${AZURE_ACR_NAME}" >/dev/null 2>&1; then
  echo "Creating Azure Container Registry (${AZURE_ACR_NAME})..."
  az acr create \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${AZURE_ACR_NAME}" \
    --sku Basic \
    --admin-enabled true \
    >/dev/null
fi

if ! az containerapp env show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${AZURE_CONTAINERAPP_ENV}" >/dev/null 2>&1; then
  echo "Creating Container Apps environment (${AZURE_CONTAINERAPP_ENV})..."
  az containerapp env create \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${AZURE_CONTAINERAPP_ENV}" \
    --location "${AZURE_LOCATION}" \
    >/dev/null
fi

echo "Building container image in ACR (${AZURE_ACR_NAME}/${IMAGE_NAME})..."
az acr build \
  --registry "${AZURE_ACR_NAME}" \
  --image "${IMAGE_NAME}" \
  .

ACR_LOGIN_SERVER="$(az acr show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${AZURE_ACR_NAME}" --query loginServer -o tsv)"
ACR_USERNAME="$(az acr credential show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${AZURE_ACR_NAME}" --query username -o tsv)"
ACR_PASSWORD="$(az acr credential show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${AZURE_ACR_NAME}" --query passwords[0].value -o tsv)"
IMAGE_REF="${ACR_LOGIN_SERVER}/${IMAGE_NAME}"

ENV_VARS=(
  "NODE_ENV=production"
  "PORT=8080"
)

if [[ -n "${DATABASE_URL:-}" ]]; then ENV_VARS+=("DATABASE_URL=${DATABASE_URL}"); fi
if [[ -n "${JWT_SECRET:-}" ]]; then ENV_VARS+=("JWT_SECRET=${JWT_SECRET}"); fi
if [[ -n "${FRONTEND_URL:-}" ]]; then ENV_VARS+=("FRONTEND_URL=${FRONTEND_URL}"); fi
if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then ENV_VARS+=("GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"); fi
if [[ -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then ENV_VARS+=("GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}"); fi
if [[ -n "${GOOGLE_REDIRECT_URI:-}" ]]; then ENV_VARS+=("GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}"); fi
if [[ -n "${ENTRA_CLIENT_ID:-}" ]]; then ENV_VARS+=("ENTRA_CLIENT_ID=${ENTRA_CLIENT_ID}"); fi
if [[ -n "${ENTRA_CLIENT_SECRET:-}" ]]; then ENV_VARS+=("ENTRA_CLIENT_SECRET=${ENTRA_CLIENT_SECRET}"); fi
if [[ -n "${ENTRA_REDIRECT_URI:-}" ]]; then ENV_VARS+=("ENTRA_REDIRECT_URI=${ENTRA_REDIRECT_URI}"); fi
if [[ -n "${ENTRA_DISCOVERY_URL:-}" ]]; then ENV_VARS+=("ENTRA_DISCOVERY_URL=${ENTRA_DISCOVERY_URL}"); fi
if [[ -n "${ENTRA_SCOPES:-}" ]]; then ENV_VARS+=("ENTRA_SCOPES=${ENTRA_SCOPES}"); fi

if az containerapp show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${AZURE_CONTAINERAPP_NAME}" >/dev/null 2>&1; then
  echo "Updating existing Container App (${AZURE_CONTAINERAPP_NAME})..."
  az containerapp registry set \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${AZURE_CONTAINERAPP_NAME}" \
    --server "${ACR_LOGIN_SERVER}" \
    --username "${ACR_USERNAME}" \
    --password "${ACR_PASSWORD}" \
    >/dev/null

  az containerapp update \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${AZURE_CONTAINERAPP_NAME}" \
    --image "${IMAGE_REF}" \
    --set-env-vars "${ENV_VARS[@]}" \
    >/dev/null
else
  echo "Creating new Container App (${AZURE_CONTAINERAPP_NAME})..."
  az containerapp create \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${AZURE_CONTAINERAPP_NAME}" \
    --environment "${AZURE_CONTAINERAPP_ENV}" \
    --image "${IMAGE_REF}" \
    --target-port 8080 \
    --ingress external \
    --min-replicas 0 \
    --max-replicas 1 \
    --registry-server "${ACR_LOGIN_SERVER}" \
    --registry-username "${ACR_USERNAME}" \
    --registry-password "${ACR_PASSWORD}" \
    --env-vars "${ENV_VARS[@]}" \
    >/dev/null
fi

APP_FQDN="$(az containerapp show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${AZURE_CONTAINERAPP_NAME}" --query properties.configuration.ingress.fqdn -o tsv)"
echo "Deployment complete."
echo "Public URL: https://${APP_FQDN}"
