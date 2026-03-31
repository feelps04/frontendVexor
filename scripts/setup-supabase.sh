#!/usr/bin/env bash
# =============================================================================
# setup-supabase.sh
# Configura o projeto Supabase via Management API (sem precisar do dashboard).
#
# Pré-requisitos:
#   1. Gere um Access Token em: https://supabase.com/dashboard/account/tokens
#   2. Exporte: export SUPABASE_ACCESS_TOKEN="sbp_..."
#
# Uso:
#   export SUPABASE_ACCESS_TOKEN="sbp_..."
#   bash scripts/setup-supabase.sh
# =============================================================================
set -euo pipefail

PROJECT_REF="pbecklboewiowuoclmln"
SUPABASE_API="https://api.supabase.com/v1"

# ── Valida token ──────────────────────────────────────────────────────────────
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo ""
  echo "Gere um token em: https://supabase.com/dashboard/account/tokens"
  read -rsp "Cole seu SUPABASE_ACCESS_TOKEN: " SUPABASE_ACCESS_TOKEN
  echo ""
  export SUPABASE_ACCESS_TOKEN
fi

AUTH_HEADER="Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"

echo ""
echo "========================================="
echo "  VexorFlow — Supabase Setup"
echo "  Projeto: $PROJECT_REF"
echo "========================================="
echo ""

# ── Helper ────────────────────────────────────────────────────────────────────
supabase_patch() {
  local path="$1"
  local body="$2"
  local label="$3"
  echo "[supabase] $label"
  local resp
  resp=$(curl -s -w "\n%{http_code}" \
    -X PATCH \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${SUPABASE_API}${path}")
  local http_code
  http_code=$(echo "$resp" | tail -1)
  local body_resp
  body_resp=$(echo "$resp" | head -n -1)
  if [[ "$http_code" =~ ^2 ]]; then
    echo "  ✅ HTTP $http_code"
  else
    echo "  ❌ HTTP $http_code: $body_resp"
  fi
}

supabase_get() {
  local path="$1"
  curl -s \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${SUPABASE_API}${path}"
}

# ── 1. Configurações de Auth ──────────────────────────────────────────────────
echo "--- Auth config ---"
supabase_patch "/projects/${PROJECT_REF}/config/auth" \
  '{
    "site_url": "https://www.vexorflow.com",
    "uri_allow_list": [
      "https://www.vexorflow.com/**",
      "https://vexorflow.com/**",
      "http://localhost:5173/**",
      "http://127.0.0.1:5173/**"
    ],
    "jwt_exp": 3600,
    "enable_signup": true,
    "enable_email_confirmations": false,
    "mailer_autoconfirm": true,
    "external_email_enabled": true,
    "external_phone_enabled": false,
    "disable_signup": false
  }' \
  "Auth: site_url + redirect URLs + JWT TTL"

# ── 2. Configura SMTP (opcional — mantém defaults se não tiver) ───────────────
echo ""
echo "--- Verificando status do projeto ---"
STATUS=$(supabase_get "/projects/${PROJECT_REF}")
echo "$STATUS" | grep -o '"status":"[^"]*"' || echo "  (status obtido)"

# ── 3. Cria tabelas essenciais via SQL ────────────────────────────────────────
echo ""
echo "--- Executando migrations SQL ---"

run_sql() {
  local label="$1"
  local sql="$2"
  echo "[sql] $label"
  local resp
  resp=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$sql" | jq -Rs .)}" \
    "${SUPABASE_API}/projects/${PROJECT_REF}/database/query")
  local http_code
  http_code=$(echo "$resp" | tail -1)
  if [[ "$http_code" =~ ^2 ]]; then
    echo "  ✅ OK"
  else
    echo "  ⚠️  HTTP $http_code (pode ser que a tabela já exista)"
  fi
}

# Tabela de perfis (vinculada ao auth.users)
run_sql "tabela profiles" "
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  name        text,
  role        text DEFAULT 'user',
  account_id  text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS \"profiles_own\" ON public.profiles
  FOR ALL USING (auth.uid() = id);
"

# Função que cria perfil automaticamente no signup
run_sql "trigger auto-profile" "
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS \$\$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
\$\$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
"

# Tabela para cache de ticks MT5
run_sql "tabela mt5_ticks" "
CREATE TABLE IF NOT EXISTS public.mt5_ticks (
  symbol     text NOT NULL,
  bid        numeric,
  ask        numeric,
  last       numeric,
  source     text DEFAULT 'genial',
  received_at timestamptz DEFAULT now(),
  PRIMARY KEY (symbol)
);
ALTER TABLE public.mt5_ticks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS \"mt5_ticks_read\" ON public.mt5_ticks
  FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS \"mt5_ticks_insert\" ON public.mt5_ticks
  FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS \"mt5_ticks_update\" ON public.mt5_ticks
  FOR UPDATE USING (true);
"

echo ""
echo "✅ Supabase configurado!"
echo ""
echo "Acesse o dashboard para confirmar:"
echo "  https://supabase.com/dashboard/project/${PROJECT_REF}/auth/url-configuration"
echo "  https://supabase.com/dashboard/project/${PROJECT_REF}/editor"
echo ""
echo "Próximo passo: faça o deploy da API e do frontend."
