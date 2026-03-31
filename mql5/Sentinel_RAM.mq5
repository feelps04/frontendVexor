//+------------------------------------------------------------------+
//|                SentinelCloudPublisher.mq5                        |
//|                     Copyright 2024, Sentinel AI                 |
//|   Envia ticks do MT5 via HTTP para Supabase Realtime            |
//|                                                                  |
//|  ARQUITETURA 24/7:                                              |
//|    MT5 (VPS) → HTTP POST → Supabase Realtime → Frontend         |
//|                                                                  |
//|  Vantagens:                                                      |
//|    - Funciona 24/7 mesmo com PC desligado                        |
//|    - Pega TODOS os ativos do servidor automaticamente            |
//|    - Não precisa de Node.js local                                |
//|    - 100% gratuito (Vercel + Supabase)                           |
//+------------------------------------------------------------------+
#property copyright "Sentinel AI"
#property version   "2.00"
#property strict

//+------------------------------------------------------------------+
//| PARÂMETROS DE ENTRADA                                            |
//+------------------------------------------------------------------+
sinput group "=== Configuração Cloud ==="
input string  InpLambdaUrl       = "https://www.vexorflow.com";  // URL do Tick Publisher
input string  InpApiKey          = "CWxb5izg-Y0UKNvNjyYpyXuBfbo6jfi_Ec9l9vjAlVUbwIhf5BoilNQj9p-AeiR6"; // API Key (obrigatória para API protegida)
input int     InpTimerMs         = 250;                      // Intervalo do timer (ms)
input int     InpSymsPerCycle    = 200;                      // Símbolos processados por ciclo
input bool    InpAutoSelect      = true;                    // Auto-adicionar TODOS os símbolos

sinput group "=== Filtro de Símbolos ==="
input bool    InpFilterByPrefix  = false;                   // Filtrar por prefixo
input string  InpAllowedPrefixes  = "";                      // Prefixos permitidos (ex: AAPL,MSFT)

//+------------------------------------------------------------------+
//| VARIÁVEIS GLOBAIS                                                |
//+------------------------------------------------------------------+
int      g_tickCount     = 0;
int      g_sentCount     = 0;
int      g_errorCount    = 0;
string   g_lastError     = "";
datetime g_lastSendTime  = 0;
int      g_rotIdx        = 0;      // Ponteiro de rotação pelos símbolos
int      g_healthCheck   = 0;
int      g_hbGlobal      = 0;
int      g_netErrorStreak = 0;     // Falhas de rede consecutivas
uint     g_safeStopUntilMs = 0;    // Pausa temporária para "respirar" em falha DNS/rede

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("=== SentinelCloudPublisher v2.00 INICIANDO ===");
   Print("Cloud URL: ", InpLambdaUrl);
   Print("Timer: ", InpTimerMs, "ms | Por ciclo: ", InpSymsPerCycle);
   if(StringLen(InpApiKey) == 0)
   {
      Print("ERRO: InpApiKey vazio. Configure sua API Key antes de iniciar o EA.");
      return INIT_PARAMETERS_INCORRECT;
   }
   
   // AUTO-SELECT: busca todos os ativos do servidor sem intervenção manual
   if(InpAutoSelect)
      AutoSelectAllSymbols();
   
   // Iniciar timer
   if(!EventSetMillisecondTimer(InpTimerMs))
   {
      Print("ERRO EventSetMillisecondTimer: ", GetLastError());
      return INIT_FAILED;
   }
   
   int mwTotal = SymbolsTotal(true);
   double voltaMs = MathCeil((double)mwTotal / InpSymsPerCycle) * InpTimerMs;
   
   Print("=== SentinelCloudPublisher INICIADO ===");
   Print("Market Watch: ", mwTotal, " símbolos");
   Print("Volta completa em: ~", (int)voltaMs, "ms (~", DoubleToString(voltaMs / 1000.0, 2), "s)");
   
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| OnDeinit                                                         |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("SentinelCloudPublisher encerrado. Razão: ", reason);
   Print("Ticks processados: ", g_tickCount);
   Print("Enviados: ", g_sentCount, " | Erros: ", g_errorCount);
}

//+------------------------------------------------------------------+
//| AutoSelectAllSymbols                                             |
//|                                                                  |
//| Varre TODOS os símbolos disponíveis no servidor da corretora     |
//| (SymbolsTotal(false)) e os ativa no Market Watch.               |
//| O usuário NÃO precisa fazer NADA manualmente no MT5.            |
//+------------------------------------------------------------------+
void AutoSelectAllSymbols()
{
   int total = SymbolsTotal(false);   // false = servidor completo da corretora
   int added = 0;

   for(int i = 0; i < total; i++)
   {
      string sym = SymbolName(i, false);
      if(StringLen(sym) == 0) continue;
      
      if(InpFilterByPrefix && !IsSymbolAllowed(sym))
         continue;
      
      if(!SymbolInfoInteger(sym, SYMBOL_SELECT))
      {
         SymbolSelect(sym, true);
         added++;
      }
   }

   Print("AutoSelect concluído: ",
         total, " símbolos no servidor | ",
         added, " novos no Market Watch | ",
         SymbolsTotal(true), " total no Market Watch agora.");
}

//+------------------------------------------------------------------+
//| IsSymbolAllowed                                                  |
//+------------------------------------------------------------------+
bool IsSymbolAllowed(string sym)
{
   if(!InpFilterByPrefix) return true;
   
   string symUpper = sym;
   StringToUpper(symUpper);
   
   string prefixes = InpAllowedPrefixes + ",";
   int pLen = StringLen(prefixes);
   int start = 0;
   
   for(int i = 0; i < pLen; i++)
   {
      if(StringSubstr(prefixes, i, 1) == ",")
      {
         string prefix = StringSubstr(prefixes, start, i - start);
         StringTrimLeft(prefix);
         StringTrimRight(prefix);
         if(StringLen(prefix) > 0 && StringFind(symUpper, prefix) == 0)
            return true;
         start = i + 1;
      }
   }
   return false;
}

//+------------------------------------------------------------------+
//| OnTimer — Rotação contínua por TODOS os símbolos do Market Watch |
//|                                                                  |
//| Exemplo com 4.500 símbolos:                                      |
//|   InpSymsPerCycle=200, timer=50ms → volta em ~1.125ms (~1,1s)   |
//|   InpSymsPerCycle=500, timer=50ms → volta em ~450ms             |
//+------------------------------------------------------------------+
void OnTimer()
{
   uint nowMs = GetTickCount();
   if(g_safeStopUntilMs > nowMs)
      return;

   g_hbGlobal++;
   int total = SymbolsTotal(true);
   if(total == 0) return;

   if(g_rotIdx >= total) g_rotIdx = 0;

   // Símbolo em foco sempre atualizado
   SendTickForSymbol(Symbol());

   // Lote deste ciclo
   int processed = 0;
   int collected = 0;
   string jsonTicks = "";
   
   while(processed < InpSymsPerCycle && g_rotIdx < total)
   {
      string sym = SymbolName(g_rotIdx, true);
      g_rotIdx++;
      processed++;
      
      if(sym == Symbol()) continue;  // Já enviado acima
      
      MqlTick tick;
      if(!SymbolInfoTick(sym, tick)) continue;
      if(tick.bid <= 0 && tick.ask <= 0) continue;
      
      // Montar JSON do tick
      string tickJson = StringFormat(
         "{\"symbol\":\"%s\",\"bid\":%.8f,\"ask\":%.8f,\"last\":%.8f,\"volume\":%lld,\"time\":%lld,\"source\":\"mt5\"}",
         sym,
         tick.bid,
         tick.ask,
         tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2,
         tick.volume,
         tick.time
      );
      
      if(jsonTicks != "")
         jsonTicks += ",";
      
      jsonTicks += tickJson;
      collected++;
      g_tickCount++;
   }

   if(g_rotIdx >= total) g_rotIdx = 0;

   // Enviar batch
   if(collected > 0)
   {
      string body = "{\"ticks\":[" + jsonTicks + "]}";
      
      if(SendToLambda(body))
      {
         g_sentCount += collected;
         g_lastSendTime = TimeCurrent();
      }
      else
      {
         g_errorCount++;
      }
   }

   // Log de saúde a cada 100 ciclos
   g_healthCheck++;
   if(g_healthCheck >= 100)
   {
      Print("HB: ",       g_hbGlobal,
            " | MW: ",    total,
            " | Ticks: ", g_tickCount,
            " | Enviados: ", g_sentCount,
            " | Erros: ", g_errorCount,
            " | Volta: ~",
            (int)MathCeil((double)total / InpSymsPerCycle) * InpTimerMs, "ms");
      g_healthCheck = 0;
   }
}

//+------------------------------------------------------------------+
//| SendTickForSymbol - Envia tick único de um símbolo               |
//+------------------------------------------------------------------+
bool SendTickForSymbol(string sym)
{
   MqlTick tick;
   if(!SymbolInfoTick(sym, tick)) return false;
   if(tick.bid <= 0 && tick.ask <= 0) return false;
   
   string body = StringFormat(
      "{\"symbol\":\"%s\",\"bid\":%.8f,\"ask\":%.8f,\"last\":%.8f,\"volume\":%lld,\"time\":%lld,\"source\":\"mt5\"}",
      sym,
      tick.bid,
      tick.ask,
      tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2,
      tick.volume,
      tick.time
   );
   
   if(SendTick(body))
   {
      g_tickCount++;
      g_sentCount++;
      return true;
   }
   else
   {
      g_errorCount++;
      return false;
   }
}

//+------------------------------------------------------------------+
//| SendTick - Envia tick único                                      |
//+------------------------------------------------------------------+
bool SendTick(string body)
{
   char   data[];
   char   result[];
   string resultHeaders;
   
   StringToCharArray(body, data, 0, StringLen(body), CP_UTF8);
   
   string headers = "Content-Type: application/json\r\n";
   headers += "Authorization: Bearer " + InpApiKey + "\r\n";
   int timeout = 5000;
   
   int res = WebRequest(
      "POST",
      InpLambdaUrl + "/api/v1/mt5/tick",
      headers,
      timeout,
      data,
      result,
      resultHeaders
   );
   
   if(res == -1)
   {
      int err = GetLastError();
      g_netErrorStreak++;
      if(g_netErrorStreak >= 3)
      {
         g_safeStopUntilMs = GetTickCount() + 5000; // respira 5s após sequência de falhas
         g_netErrorStreak = 0;
      }
      g_lastError = "WebRequest error: " + IntegerToString(err);
      if(err == 4060)
         g_lastError = "URL não permitida. Adicione em Tools > Options > Expert Advisors > Allow WebRequest";
      else if(err == 4014)
         g_lastError = "WebRequest bloqueado (4014). Execute como Expert Advisor (não indicador/tester), habilite Algo Trading e permita a URL em Tools > Options > Expert Advisors.";
      else if(err == 4013)
         g_lastError = "DNS_HOSTNAME_NOT_FOUND (4013). Verifique DNS/URL e aguarde a janela de respiração.";
      Print("[ERRO] ", g_lastError);
      return false;
   }
   
   g_netErrorStreak = 0;
   return (res >= 200 && res < 300);
}

//+------------------------------------------------------------------+
//| SendToLambda - Envia batch de ticks                              |
//+------------------------------------------------------------------+
bool SendToLambda(string body)
{
   char   data[];
   char   result[];
   string resultHeaders;
   
   // Converter para bytes
   StringToCharArray(body, data, 0, StringLen(body), CP_UTF8);
   
   // Headers
   string headers = "Content-Type: application/json\r\n";
   headers += "Authorization: Bearer " + InpApiKey + "\r\n";
   
   // Timeout 5 segundos
   int timeout = 5000;
   
   // Enviar POST
   int res = WebRequest(
      "POST",
      InpLambdaUrl + "/api/v1/mt5/ticks",
      headers,
      timeout,
      data,
      result,
      resultHeaders
   );
   
   if(res == -1)
   {
      int err = GetLastError();
      g_netErrorStreak++;
      if(g_netErrorStreak >= 3)
      {
         g_safeStopUntilMs = GetTickCount() + 5000; // respira 5s após sequência de falhas
         g_netErrorStreak = 0;
      }
      g_lastError = "WebRequest error: " + IntegerToString(err);
      
      // Erros comuns
      if(err == 4060)
         g_lastError = "URL não permitida. Adicione em Tools > Options > Expert Advisors > Allow WebRequest";
      else if(err == 4014)
         g_lastError = "WebRequest bloqueado (4014). Execute como Expert Advisor (não indicador/tester), habilite Algo Trading e permita a URL em Tools > Options > Expert Advisors.";
      else if(err == 4013)
         g_lastError = "DNS_HOSTNAME_NOT_FOUND (4013). Verifique DNS/URL e aguarde a janela de respiração.";
      
      Print("[ERRO] ", g_lastError);
      return false;
   }
   
   // Verificar resposta
   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   
   if(res >= 200 && res < 300)
   {
      g_netErrorStreak = 0;
      return true;
   }
   else
   {
      g_lastError = "HTTP " + IntegerToString(res) + ": " + response;
      Print("[ERRO] ", g_lastError);
      return false;
   }
}

//+------------------------------------------------------------------+
//| OnTick — Atualização imediata do símbolo em foco                 |
//+------------------------------------------------------------------+
void OnTick()
{
   // Desativado para evitar pressão de rede/DNS em horários de instabilidade.
   // O envio segue apenas pelo OnTimer em batch.
   // SendTickForSymbol(Symbol());
}
//+------------------------------------------------------------------+
