//+------------------------------------------------------------------+
//|                SentinelCloudPublisher.mq5                        |
//|                     Copyright 2024, Sentinel AI                  |
//|   Envia ticks do MT5 via HTTP para VexorFlow API                 |
//|                                                                   |
//|  ARQUITETURA 24/7:                                               |
//|    MT5 (VPS/PC) → HTTP POST → VexorFlow API → Frontend           |
//|                                                                   |
//|  INSTALAÇÃO:                                                      |
//|    1. MT5 → Ferramentas → Opções → Expert Advisors:              |
//|         ✅ Permitir WebRequest para as URLs listadas              |
//|         Adicione: https://www.vexorflow.com                       |
//|    2. Attach em qualquer gráfico (ex: WINM25 M1)                 |
//+------------------------------------------------------------------+
#property copyright "Sentinel AI"
#property version   "2.01"
#property strict

//+------------------------------------------------------------------+
//| PARÂMETROS DE ENTRADA                                            |
//+------------------------------------------------------------------+
sinput group "=== Configuração Cloud ==="
input string  InpApiBase       = "https://www.vexorflow.com/api/v1/mt5"; // Base URL da API
input string  InpApiKey        = "sk_live_vexor_2026_97percent_survival"; // Bearer token
input int     InpTimerMs       = 50;    // Intervalo do timer (ms)
input int     InpSymsPerCycle  = 200;   // Símbolos processados por ciclo
input bool    InpAutoSelect    = true;  // Auto-adicionar TODOS os símbolos

sinput group "=== Filtro de Símbolos ==="
input bool    InpFilterByPrefix  = false; // Filtrar por prefixo
input string  InpAllowedPrefixes = "";    // Prefixos permitidos (ex: WIN,WDO,PETR)

//+------------------------------------------------------------------+
//| VARIÁVEIS GLOBAIS                                                |
//+------------------------------------------------------------------+
int      g_tickCount    = 0;
int      g_sentCount    = 0;
int      g_errorCount   = 0;
string   g_lastError    = "";
datetime g_lastSendTime = 0;
int      g_rotIdx       = 0;
int      g_healthCheck  = 0;
int      g_hbGlobal     = 0;

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("=== SentinelCloudPublisher v2.01 INICIANDO ===");
   Print("API Base: ", InpApiBase);
   Print("Timer: ", InpTimerMs, "ms | Por ciclo: ", InpSymsPerCycle);

   if(StringLen(InpApiBase) == 0 || StringLen(InpApiKey) == 0)
   {
      Alert("SentinelCloudPublisher: InpApiBase e InpApiKey são obrigatórios.");
      return INIT_FAILED;
   }

   if(InpAutoSelect)
      AutoSelectAllSymbols();

   if(!EventSetMillisecondTimer(InpTimerMs))
   {
      Print("ERRO EventSetMillisecondTimer: ", GetLastError());
      return INIT_FAILED;
   }

   int mwTotal  = SymbolsTotal(true);
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
   Print("Ticks processados: ", g_tickCount, " | Enviados: ", g_sentCount, " | Erros: ", g_errorCount);
}

//+------------------------------------------------------------------+
//| AutoSelectAllSymbols                                             |
//+------------------------------------------------------------------+
void AutoSelectAllSymbols()
{
   int total = SymbolsTotal(false); // false = servidor completo da corretora
   int added = 0;

   for(int i = 0; i < total; i++)
   {
      string sym = SymbolName(i, false);
      if(StringLen(sym) == 0) continue;
      if(InpFilterByPrefix && !IsSymbolAllowed(sym)) continue;

      if(!SymbolInfoInteger(sym, SYMBOL_SELECT))
      {
         SymbolSelect(sym, true);
         added++;
      }
   }

   Print("AutoSelect: ", total, " no servidor | ", added, " novos | ",
         SymbolsTotal(true), " total no Market Watch");
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
   int start = 0;

   for(int i = 0; i < StringLen(prefixes); i++)
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
//| OnTimer — Rotação contínua pelos símbolos do Market Watch        |
//+------------------------------------------------------------------+
void OnTimer()
{
   g_hbGlobal++;

   int total = SymbolsTotal(true);
   if(total == 0) return;
   if(g_rotIdx >= total) g_rotIdx = 0;

   // Símbolo em foco — envio imediato individual
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

      if(sym == Symbol()) continue; // já enviado acima

      MqlTick tick;
      if(!SymbolInfoTick(sym, tick)) continue;
      if(tick.bid <= 0 && tick.ask <= 0) continue;

      string safeSym = sym;
      StringReplace(safeSym, "\"", "");

      string tickJson = StringFormat(
         "{\"symbol\":\"%s\",\"bid\":%.8f,\"ask\":%.8f,\"last\":%.8f,\"volume\":%lld,\"time\":%lld,\"source\":\"genial\"}",
         safeSym,
         tick.bid,
         tick.ask,
         tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2.0,
         tick.volume,
         (long)tick.time
      );

      if(jsonTicks != "") jsonTicks += ",";
      jsonTicks += tickJson;
      collected++;
      g_tickCount++;
   }

   if(g_rotIdx >= total) g_rotIdx = 0;

   if(collected > 0)
   {
      string body = "{\"ticks\":[" + jsonTicks + "]}";
      if(PostBatch(body))
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
      Print("HB: ",        g_hbGlobal,
            " | MW: ",     total,
            " | Ticks: ",  g_tickCount,
            " | Env: ",    g_sentCount,
            " | Err: ",    g_errorCount,
            " | Volta: ~", (int)MathCeil((double)total / InpSymsPerCycle) * InpTimerMs, "ms");
      g_healthCheck = 0;
   }
}

//+------------------------------------------------------------------+
//| OnTick — Atualização imediata do símbolo em foco                 |
//+------------------------------------------------------------------+
void OnTick()
{
   SendTickForSymbol(Symbol());
}

//+------------------------------------------------------------------+
//| SendTickForSymbol — tick único para /api/v1/mt5/tick              |
//+------------------------------------------------------------------+
bool SendTickForSymbol(string sym)
{
   MqlTick tick;
   if(!SymbolInfoTick(sym, tick)) return false;
   if(tick.bid <= 0 && tick.ask <= 0) return false;

   string safeSym = sym;
   StringReplace(safeSym, "\"", "");

   string body = StringFormat(
      "{\"symbol\":\"%s\",\"bid\":%.8f,\"ask\":%.8f,\"last\":%.8f,\"volume\":%lld,\"time\":%lld,\"source\":\"genial\"}",
      safeSym,
      tick.bid,
      tick.ask,
      tick.last > 0 ? tick.last : (tick.bid + tick.ask) / 2.0,
      tick.volume,
      (long)tick.time
   );

   if(PostSingle(body))
   {
      g_tickCount++;
      g_sentCount++;
      return true;
   }
   g_errorCount++;
   return false;
}

//+------------------------------------------------------------------+
//| BuildHeaders — monta cabeçalhos com Authorization: Bearer         |
//+------------------------------------------------------------------+
string BuildHeaders()
{
   string h = "Content-Type: application/json\r\n";
   if(StringLen(InpApiKey) > 0)
      h += "Authorization: Bearer " + InpApiKey + "\r\n";
   return h;
}

//+------------------------------------------------------------------+
//| DoPost — executa WebRequest e retorna se foi 2xx                  |
//| FIX: remove null terminator que StringToCharArray adiciona        |
//+------------------------------------------------------------------+
bool DoPost(string url, string body)
{
   char   data[];
   char   result[];
   string resultHeaders;

   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   // StringToCharArray inclui o \0 final — remove para não corromper o JSON
   if(len > 0 && data[len - 1] == 0)
      ArrayResize(data, len - 1);

   int res = WebRequest("POST", url, BuildHeaders(), 5000, data, result, resultHeaders);

   if(res == -1)
   {
      int err = GetLastError();
      g_lastError = "WebRequest err=" + IntegerToString(err);
      if(err == 4060)
         g_lastError = "URL não permitida — adicione " + InpApiBase + " em MT5 → Opções → Expert Advisors";
      if(g_errorCount <= 3 || g_errorCount % 50 == 0)
         Print("[ERRO] ", g_lastError);
      return false;
   }

   if(res < 200 || res >= 300)
   {
      string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      g_lastError = "HTTP " + IntegerToString(res) + ": " + resp;
      if(g_errorCount <= 3 || g_errorCount % 50 == 0)
         Print("[ERRO] ", g_lastError);
      return false;
   }

   return true;
}

bool PostSingle(string body) { return DoPost(InpApiBase + "/tick",  body); }
bool PostBatch (string body) { return DoPost(InpApiBase + "/ticks", body); }

//+------------------------------------------------------------------+
