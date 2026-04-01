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
#property version   "2.10"
#property strict

#include <Trade\Trade.mqh>

//+------------------------------------------------------------------+
//| PARÂMETROS DE ENTRADA                                            |
//+------------------------------------------------------------------+
sinput group "=== Configuração Cloud ==="
input string  InpLambdaUrl       = "https://api.vexorflow.com";  // URL do Tick Publisher
input string  InpApiKey          = "";                       // API Key (opcional)
input int     InpTimerMs         = 50;                       // Intervalo do timer (ms)
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
int      g_orderPollCtr  = 0;      // Contador para polling de ordens (~1s = 20 ciclos × 50ms)
CTrade   g_trade;                  // Executor de ordens MT5

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("=== SentinelCloudPublisher v2.00 INICIANDO ===");
   Print("Cloud URL: ", InpLambdaUrl);
   Print("Timer: ", InpTimerMs, "ms | Por ciclo: ", InpSymsPerCycle);
   
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
   g_hbGlobal++;
   long tsMs = (long)TimeTradeServer() * 1000;
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

   // Polling de ordens a cada 20 ciclos (~1 segundo)
   g_orderPollCtr++;
   if(g_orderPollCtr >= 20)
   {
      g_orderPollCtr = 0;
      PollAndExecuteOrders();
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
   int timeout = 5000;
   
   int res = WebRequest(
      "POST",
      InpLambdaUrl + "/tick",
      headers,
      timeout,
      data,
      result,
      resultHeaders
   );
   
   if(res == -1)
   {
      int err = GetLastError();
      g_lastError = "WebRequest error: " + IntegerToString(err);
      if(err == 4060)
         g_lastError = "URL não permitida. Adicione em Tools > Options > Expert Advisors > Allow WebRequest";
      Print("[ERRO] ", g_lastError);
      return false;
   }
   
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
   if(StringLen(InpApiKey) > 0)
      headers += "Authorization: Bearer " + InpApiKey + "\r\n";
   
   // Timeout 5 segundos
   int timeout = 5000;
   
   // Enviar POST
   int res = WebRequest(
      "POST",
      InpLambdaUrl + "/ticks/batch",
      headers,
      timeout,
      data,
      result,
      resultHeaders
   );
   
   if(res == -1)
   {
      int err = GetLastError();
      g_lastError = "WebRequest error: " + IntegerToString(err);
      
      // Erros comuns
      if(err == 4060)
         g_lastError = "URL não permitida. Adicione em Tools > Options > Expert Advisors > Allow WebRequest";
      
      Print("[ERRO] ", g_lastError);
      return false;
   }
   
   // Verificar resposta
   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   
   if(res >= 200 && res < 300)
   {
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
//| JsonGetString — extrai valor string de JSON plano                |
//+------------------------------------------------------------------+
string JsonGetString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if(pos < 0) return "";
   pos += StringLen(search);
   int end = StringFind(json, "\"", pos);
   if(end < 0) return "";
   return StringSubstr(json, pos, end - pos);
}

//+------------------------------------------------------------------+
//| JsonGetNumber — extrai valor numérico de JSON plano              |
//+------------------------------------------------------------------+
double JsonGetNumber(string json, string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos < 0) return 0;
   pos += StringLen(search);
   // skip whitespace
   while(pos < StringLen(json) && StringSubstr(json, pos, 1) == " ") pos++;
   string num = "";
   int len = StringLen(json);
   for(int i = pos; i < len; i++)
   {
      string ch = StringSubstr(json, i, 1);
      if(ch == "," || ch == "}" || ch == "]") break;
      num += ch;
   }
   return StringToDouble(num);
}

//+------------------------------------------------------------------+
//| PollAndExecuteOrders — busca ordens pendentes e executa          |
//+------------------------------------------------------------------+
void PollAndExecuteOrders()
{
   char   result[];
   string resultHeaders;
   char   emptyData[];

   string headers = "Content-Type: application/json\r\n";
   if(StringLen(InpApiKey) > 0)
      headers += "Authorization: Bearer " + InpApiKey + "\r\n";

   int res = WebRequest(
      "GET",
      InpLambdaUrl + "/api/v1/orders/pending",
      headers,
      5000,
      emptyData,
      result,
      resultHeaders
   );

   if(res != 200) return;

   string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   // Extrair array de ordens: {"orders":[...]}
   int arrStart = StringFind(body, "[");
   int arrEnd   = StringFind(body, "]");
   if(arrStart < 0 || arrEnd < 0) return;

   string arr = StringSubstr(body, arrStart + 1, arrEnd - arrStart - 1);
   if(StringLen(arr) == 0) return;

   // Iterar objetos {…} dentro do array
   int cursor = 0;
   int arrLen = StringLen(arr);
   while(cursor < arrLen)
   {
      int objStart = StringFind(arr, "{", cursor);
      if(objStart < 0) break;

      // Encontrar fechamento do objeto (nível 1)
      int depth = 0;
      int objEnd = -1;
      for(int i = objStart; i < arrLen; i++)
      {
         string ch = StringSubstr(arr, i, 1);
         if(ch == "{") depth++;
         else if(ch == "}") { depth--; if(depth == 0) { objEnd = i; break; } }
      }
      if(objEnd < 0) break;

      string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
      cursor = objEnd + 1;

      string orderId = JsonGetString(obj, "id");
      string symbol  = JsonGetString(obj, "symbol");
      string type    = JsonGetString(obj, "type");
      double volume  = JsonGetNumber(obj, "volume");
      double price   = JsonGetNumber(obj, "price");

      if(StringLen(orderId) == 0 || StringLen(symbol) == 0) continue;
      if(volume <= 0) volume = 0.01;

      // Executar ordem
      bool ok = false;
      string execErr = "";

      if(type == "BUY")
         ok = g_trade.Buy(volume, symbol, price, 0, 0, "vexor");
      else if(type == "SELL")
         ok = g_trade.Sell(volume, symbol, price, 0, 0, "vexor");
      else
         execErr = "unknown type: " + type;

      if(!ok && StringLen(execErr) == 0)
         execErr = "MT5 error " + IntegerToString(g_trade.ResultRetcode()) + ": " + g_trade.ResultRetcodeDescription();

      // Reportar resultado ao backend
      ulong ticket = ok ? g_trade.ResultOrder() : 0;
      double filled = ok ? g_trade.ResultPrice() : 0;

      string patchBody;
      if(ok)
         patchBody = StringFormat(
            "{\"status\":\"filled\",\"ticket\":%llu,\"filledPrice\":%.8f}",
            ticket, filled
         );
      else
         patchBody = StringFormat(
            "{\"status\":\"rejected\",\"error\":\"%s\"}",
            execErr
         );

      char patchData[];
      char patchResult[];
      string patchHeaders;
      StringToCharArray(patchBody, patchData, 0, StringLen(patchBody), CP_UTF8);

      string pHeaders = "Content-Type: application/json\r\n";
      if(StringLen(InpApiKey) > 0)
         pHeaders += "Authorization: Bearer " + InpApiKey + "\r\n";

      WebRequest(
         "PATCH",
         InpLambdaUrl + "/api/v1/orders/" + orderId,
         pHeaders,
         5000,
         patchData,
         patchResult,
         patchHeaders
      );

      Print("[ORDER] ", type, " ", symbol, " vol=", volume,
            ok ? " FILLED ticket=" + IntegerToString((long)ticket) + " price=" + DoubleToString(filled, 5)
               : " REJECTED: " + execErr);
   }
}

//+------------------------------------------------------------------+
//| OnTick — Atualização imediata do símbolo em foco                 |
//+------------------------------------------------------------------+
void OnTick()
{
   g_hbGlobal++;
   SendTickForSymbol(Symbol());
}
//+------------------------------------------------------------------+
