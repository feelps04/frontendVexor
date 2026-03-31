#!/usr/bin/env bash
# =============================================================================
# setup-vercel-env.sh
# Configura todas as variáveis de ambiente nos projetos Vercel via CLI.
#
# Pré-requisitos:
#   npm i -g vercel
#   vercel login          (faz auth uma vez)
#
# Uso:
#   bash scripts/setup-vercel-env.sh
# =============================================================================
set -euo pipefail

# ── Projetos Vercel ───────────────────────────────────────────────────────────
WEB_PROJECT="vexorflow"          # nome do projeto web no Vercel (frontend)
API_PROJECT="vexorflow-api"      # nome do projeto api no Vercel (backend)
ENV="production"                 # production | preview | development

# ── Helpers ───────────────────────────────────────────────────────────────────
add_env() {
  local project="$1"
  local name="$2"
  local value="$3"
  local scope="${4:-$ENV}"
  echo "[vercel] $project → $name ($scope)"
  # Remove primeira, depois adiciona (evita duplicata)
  vercel env rm "$name" "$scope" --project "$project" --yes 2>/dev/null || true
  printf '%s' "$value" | vercel env add "$name" "$scope" --project "$project"
}

echo ""
echo "========================================"
echo "  VexorFlow — Vercel Environment Setup"
echo "========================================"
echo ""

# ── Lê segredos do .env local (nunca hardcoded aqui) ─────────────────────────
API_ENV_FILE="$(dirname "$0")/../packages/api/.env"
if [[ -f "$API_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$API_ENV_FILE"; set +a
  echo "✅ Leu $API_ENV_FILE"
else
  echo "⚠️  $API_ENV_FILE não encontrado — variáveis serão pedidas manualmente"
fi

# ── Solicita segredos que ainda não estão definidos ───────────────────────────
prompt_if_empty() {
  local var="$1"
  local label="$2"
  if [[ -z "${!var:-}" ]]; then
    read -rsp "  → $label: " input
    echo ""
    export "$var"="$input"
  fi
}

prompt_if_empty DATABASE_URL        "DATABASE_URL (Supabase Transaction Pooler)"
prompt_if_empty JWT_SECRET          "JWT_SECRET (string aleatória longa)"
prompt_if_empty MINIMAX_API_KEY     "MINIMAX_API_KEY"
prompt_if_empty BRAPI_TOKEN         "BRAPI_TOKEN"
prompt_if_empty TELEGRAM_BOT_TOKEN  "TELEGRAM_BOT_TOKEN (Enter para pular)"

# ── Projeto WEB (frontend) ────────────────────────────────────────────────────
echo ""
echo "--- Projeto WEB: $WEB_PROJECT ---"

# Vite não deve ter VITE_PUBLIC_API_URL setado em prod (usa same-origin via rewrite)
# Mas mantemos o Supabase configurável
add_env "$WEB_PROJECT" "VITE_SUPABASE_URL"      "https://pbecklboewiowuoclmln.supabase.co"
add_env "$WEB_PROJECT" "VITE_SUPABASE_ANON_KEY" "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiZWNrbGJvZXdpb3d1b2NsbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NDYxMjQsImV4cCI6MjA5MDMyMjEyNH0.hh-8rXRiwgrFb2b3oDJnCxC8hxJ5gjmeHa8WAPdgc-k"

# ── Projeto API (backend) ─────────────────────────────────────────────────────
echo ""
echo "--- Projeto API: $API_PROJECT ---"

add_env "$API_PROJECT" "NODE_ENV"             "production"
add_env "$API_PROJECT" "PORT"                 "3001"
add_env "$API_PROJECT" "DATABASE_URL"         "${DATABASE_URL}"
add_env "$API_PROJECT" "JWT_SECRET"           "${JWT_SECRET}"
add_env "$API_PROJECT" "MINIMAX_API_KEY"      "${MINIMAX_API_KEY}"
add_env "$API_PROJECT" "VEXOR_MT5_SECRET"     "sk_live_vexor_2026_97percent_survival"
add_env "$API_PROJECT" "CORS_ORIGINS"         "https://www.vexorflow.com,https://vexorflow.com"
add_env "$API_PROJECT" "COOKIE_SECURE"        "true"
add_env "$API_PROJECT" "REDIS_URL"            "${REDIS_URL:-}"
add_env "$API_PROJECT" "KAFKA_BROKERS"        "${KAFKA_BROKERS:-localhost:9092}"
add_env "$API_PROJECT" "PG_STARTUP_ATTEMPTS"  "5"
add_env "$API_PROJECT" "PG_STARTUP_BACKOFF_MS" "2000"

if [[ -n "${BRAPI_TOKEN:-}" ]]; then
  add_env "$API_PROJECT" "BRAPI_TOKEN" "${BRAPI_TOKEN}"
fi

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  add_env "$API_PROJECT" "TELEGRAM_BOT_TOKEN" "${TELEGRAM_BOT_TOKEN}"
fi

echo ""
echo "✅ Concluído! Verifique em:"
echo "   https://vercel.com/$WEB_PROJECT/settings/environment-variables"
echo "   https://vercel.com/$API_PROJECT/settings/environment-variables"
echo ""
echo "Próximo passo: bash scripts/setup-supabase.sh"
