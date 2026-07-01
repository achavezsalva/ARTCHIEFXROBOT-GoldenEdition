/**
 * Copyright (c) QuantumTune Lab.
 * SPDX-License-Identifier: Apache-2.0
 */

export const MQL4_ROBOT_SOURCE = `//+------------------------------------------------------------------+
//|                                              Artchie FXROBOT.mq4 |
//|                                                  QuantumTune Lab |
//|                                     Version 3.0 (Golden Edition) |
//+------------------------------------------------------------------+
#property copyright "QuantumTune Lab"
#property link      ""
#property version   "3.00"
#property strict

//--- Input parameters (Settings ng EA)
input double BaseLotSize      = 0.01;  // Simulang Lot Size
input double LotMultiplier    = 1.4;   // Martingale Multiplier
input int    MaxMartingaleSteps = 6;   // Max na beses mag-doble ng lot
input int    GridDistance     = 25;    // Layo sa Pips bago mag-open ng bagong trade
input int    BasketTPPips     = 30;    // Target na Kita sa Pips (mula sa Break Even)
input int    FastMA           = 10;    // Fast Moving Average
input int    SlowMA           = 20;    // Slow Moving Average
input int    MagicNumber      = 1001;  // EA Identifier

//--- Golden Combination Inputs
input int    RSIPeriod        = 14;    // RSI Period
input int    RSI_Upper        = 70;    // RSI Overbought
input int    RSI_Lower        = 30;    // RSI Oversold
input int    ATR_Period       = 14;    // ATR Period

//--- Global Variables para sa Dashboard at Logic
double BreakEvenPrice = 0;
double FloatingPL = 0;
int    TotalOpenTrades = 0;
double NextGridLot = 0;
double TotalClosedProfit = 0;
double TargetProfitCash = 0;
string current_action = "Nag-aabang ng signal...";

double fastMA_current = 0;
double slowMA_current = 0;
double fastMA_prev = 0;
double slowMA_prev = 0;

int Panel_X = 15;
int Panel_Y = 15;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   Print("Artchie FXROBOT 3.0 Online: Golden Grid System Active!");

// Gagawa ng floating dashboard sa chart
   DrawDashboardFrame();

// Bubuksan ang timer para mag-update ang dashboard kahit weekend
   EventSetTimer(1);

   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
// Patayin ang timer at burahin ang mga drawings sa chart
   EventKillTimer();
   ObjectsDeleteAll(0, "Artchie_");
   ObjectsDeleteAll(0, "MA_Line_");
   Print("Artchie FXROBOT Offline.");
  }

//+------------------------------------------------------------------+
//| Timer function (Updates dashboard on weekends/no ticks)          |
//+------------------------------------------------------------------+
void OnTimer()
  {
   CalculateClosedProfit();
   int basketType = CalculateBasketData();
   UpdateDashboardValues(fastMA_current, slowMA_current, NextGridLot, TotalOpenTrades, FloatingPL, TotalClosedProfit, current_action);
  }

//+------------------------------------------------------------------+
//| Expert tick function (Bumabasa ng presyo at nagte-trade)         |
//+------------------------------------------------------------------+
void OnTick()
  {
// 1. Update MA values
   fastMA_current = iMA(Symbol(), 0, FastMA, 0, MODE_SMA, PRICE_CLOSE, 0);
   slowMA_current = iMA(Symbol(), 0, SlowMA, 0, MODE_SMA, PRICE_CLOSE, 0);
   fastMA_prev    = iMA(Symbol(), 0, FastMA, 0, MODE_SMA, PRICE_CLOSE, 1);
   slowMA_prev    = iMA(Symbol(), 0, SlowMA, 0, MODE_SMA, PRICE_CLOSE, 1);

// Update RSI and ATR (Golden Combination)
   double rsi = iRSI(Symbol(), 0, RSIPeriod, PRICE_CLOSE, 0);
   double atr = iATR(Symbol(), 0, ATR_Period, 0);

// 2. I-drawing ang mga linya sa chart
   DrawMA_Lines(fastMA_current, slowMA_current);

// 3. I-update ang kita at statistics ng basket
   CalculateClosedProfit();
   int basketType = CalculateBasketData();

// 4. Check if Basket hit Take Profit
   if(TotalOpenTrades > 0 && FloatingPL >= TargetProfitCash && TargetProfitCash > 0)
     {
      current_action = "BASKET TP HIT! Closing trades...";
      CloseAllTrades();
      return; // Ihinto muna ang tick habang nagco-close
     }

// 5. Entry Logic (Crossover at Grid Addition)
   if(TotalOpenTrades == 0) // WALANG TRADE - MAG-AABANG NG CROSSOVER
     {
      current_action = "Nag-aabang ng signal...";
      NextGridLot = BaseLotSize;

      // BUY SIGNAL (Corrected: Mag-buy basta HINDI PA overbought)
      if(fastMA_prev <= slowMA_prev && fastMA_current > slowMA_current && rsi < RSI_Upper)
        {
         current_action = "BUY Signal Triggered!";
         int ticket = OrderSend(Symbol(), OP_BUY, BaseLotSize, Ask, 3, 0, 0, "Artchie BUY", MagicNumber, 0, clrGreen);
         if(ticket < 0)
            Print("Buy Error: ", GetLastError());
        }
      // SELL SIGNAL (Corrected: Mag-sell basta HINDI PA oversold)
      else
         if(fastMA_prev >= slowMA_prev && fastMA_current < slowMA_current && rsi > RSI_Lower)
           {
            current_action = "SELL Signal Triggered!";
            int ticket = OrderSend(Symbol(), OP_SELL, BaseLotSize, Bid, 3, 0, 0, "Artchie SELL", MagicNumber, 0, clrRed);
            if(ticket < 0)
               Print("Sell Error: ", GetLastError());
           }
     }
   else // MAY TRADE - GRID / MARTINGALE LOGIC
     {
      current_action = "Bumabawi / Naghihintay ma-TP...";

      // Hanapin ang pinakahuling presyo at uri ng trade
      double lastPrice = 0;
      for(int i = OrdersTotal() - 1; i >= 0; i--)
        {
         if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderSymbol() == Symbol() && OrderMagicNumber() == MagicNumber)
           {
            lastPrice = OrderOpenPrice();
            break; // Nakuha na ang pinakahuli
           }
        }

      // Compute ang distansya base sa points (1 pip = 10 points sa 5-digit) + ATR dynamic filter
      double gridSpacing = (GridDistance * Point * 10) + (atr * 0.5);

      // Kung pabagsak ang presyo at nakaka-BUY tayo (Averaging Down)
      if(basketType == OP_BUY && Ask <= lastPrice - gridSpacing)
        {
         current_action = "Opening Grid BUY...";
         int ticket = OrderSend(Symbol(), OP_BUY, NextGridLot, Ask, 3, 0, 0, "Artchie Grid BUY", MagicNumber, 0, clrLime);
         if(ticket < 0)
            Print("Grid Buy Error: ", GetLastError());
        }
      // Kung pataas ang presyo at nakaka-SELL tayo (Averaging Up)
      else
         if(basketType == OP_SELL && Bid >= lastPrice + gridSpacing)
           {
            current_action = "Opening Grid SELL...";
            int ticket = OrderSend(Symbol(), OP_SELL, NextGridLot, Bid, 3, 0, 0, "Artchie Grid SELL", MagicNumber, 0, clrOrange);
            if(ticket < 0)
               Print("Grid Sell Error: ", GetLastError());
           }
     }

// 6. Refresh Dashboard
   UpdateDashboardValues(fastMA_current, slowMA_current, NextGridLot, TotalOpenTrades, FloatingPL, TotalClosedProfit, current_action);
  }

//+------------------------------------------------------------------+
//| Helpers para i-compute ang basket data                           |
//+------------------------------------------------------------------+
int CalculateBasketData()
  {
   TotalOpenTrades = 0;
   FloatingPL = 0;
   double totalCost = 0;
   double totalVolume = 0;
   int type = -1;
   double lastLot = 0;

   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderSymbol() == Symbol() && OrderMagicNumber() == MagicNumber)
        {
         TotalOpenTrades++;
         FloatingPL += (OrderProfit() + OrderSwap() + OrderCommission());
         totalVolume += OrderLots();
         totalCost += (OrderOpenPrice() * OrderLots());
         type = OrderType();
         lastLot = OrderLots();
        }
     }

   if(TotalOpenTrades > 0 && totalVolume > 0)
     {
      BreakEvenPrice = totalCost / totalVolume;

      // Compute Virtual TP in Cash (Dollars)
      double pipValue = MarketInfo(Symbol(), MODE_TICKVALUE) * (Point / MarketInfo(Symbol(), MODE_TICKSIZE));
      TargetProfitCash = (BasketTPPips * 10) * totalVolume * pipValue; // x10 para sa points

      // Compute ang susunod na Martingale Lot Size
      if(TotalOpenTrades < MaxMartingaleSteps)
        {
         NextGridLot = NormalizeDouble(lastLot * LotMultiplier, 2);
        }
      else
        {
         NextGridLot = BaseLotSize; // Reset kung lumagpas sa safety limit
        }
     }
   else
     {
      BreakEvenPrice = 0;
      TargetProfitCash = 0;
      NextGridLot = BaseLotSize;
     }

   return type;
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void CalculateClosedProfit()
  {
   TotalClosedProfit = 0;
   int historyTotal = OrdersHistoryTotal();
   for(int i = 0; i < historyTotal; i++)
     {
      if(OrderSelect(i, SELECT_BY_POS, MODE_HISTORY) && OrderSymbol() == Symbol() && OrderMagicNumber() == MagicNumber)
        {
         TotalClosedProfit += (OrderProfit() + OrderSwap() + OrderCommission());
        }
     }
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void CloseAllTrades()
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderSymbol() == Symbol() && OrderMagicNumber() == MagicNumber)
        {
         if(OrderType() == OP_BUY)
            OrderClose(OrderTicket(), OrderLots(), Bid, 3, clrWhite);
         else
            if(OrderType() == OP_SELL)
               OrderClose(OrderTicket(), OrderLots(), Ask, 3, clrWhite);
        }
     }
  }

//+------------------------------------------------------------------+
//| Dashboard at Chart Visuals                                       |
//+------------------------------------------------------------------+
void DrawMA_Lines(double f_ma, double s_ma)
  {
   string f_name = "MA_Line_Fast";
   string s_name = "MA_Line_Slow";
   datetime time1 = Time[1];
   datetime time0 = Time[0];

   if(ObjectFind(0, f_name) < 0)
      ObjectCreate(0, f_name, OBJ_TREND, 0, time1, f_ma, time0, f_ma);
   else
     {
      ObjectMove(0, f_name, 0, time1, fastMA_prev);
      ObjectMove(0, f_name, 1, time0, f_ma);
     }
   ObjectSetInteger(0, f_name, OBJPROP_COLOR, clrCyan);
   ObjectSetInteger(0, f_name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, f_name, OBJPROP_RAY_RIGHT, false);

   if(ObjectFind(0, s_name) < 0)
      ObjectCreate(0, s_name, OBJ_TREND, 0, time1, s_ma, time0, s_ma);
   else
     {
      ObjectMove(0, s_name, 0, time1, slowMA_prev);
      ObjectMove(0, s_name, 1, time0, s_ma);
     }
   ObjectSetInteger(0, s_name, OBJPROP_COLOR, clrOrange);
   ObjectSetInteger(0, s_name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, s_name, OBJPROP_RAY_RIGHT, false);
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void DrawDashboardFrame()
  {
   string bgName = "Artchie_BG";
   ObjectCreate(0, bgName, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, bgName, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, bgName, OBJPROP_XDISTANCE, Panel_X);
   ObjectSetInteger(0, bgName, OBJPROP_YDISTANCE, Panel_Y);
   ObjectSetInteger(0, bgName, OBJPROP_XSIZE, 330);
   ObjectSetInteger(0, bgName, OBJPROP_YSIZE, 260); // Pinalaki para sa bagong features
   ObjectSetInteger(0, bgName, OBJPROP_BGCOLOR, clrMidnightBlue);
   ObjectSetInteger(0, bgName, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bgName, OBJPROP_COLOR, clrWhite);

// Static Labels
   CreateLabel("Artchie_Title", "ARTCHIE FXROBOT (Golden Edition)", Panel_X + 15, Panel_Y + 15, 10, clrYellow, true);
   CreateLabel("Artchie_L1", "Fast MA ("+IntegerToString(FastMA)+"): ", Panel_X + 15, Panel_Y + 45, 9, clrCyan, false);
   CreateLabel("Artchie_L2", "Slow MA ("+IntegerToString(SlowMA)+"): ", Panel_X + 15, Panel_Y + 65, 9, clrOrange, false);

   CreateLabel("Artchie_L_Trades", "Total Open Trades:", Panel_X + 15, Panel_Y + 95, 9, clrWhite, false);
   CreateLabel("Artchie_L_PL",     "Floating P/L:",      Panel_X + 15, Panel_Y + 115, 9, clrWhite, false);
   CreateLabel("Artchie_L_Target", "Basket Target (TP):",Panel_X + 15, Panel_Y + 135, 9, clrWhite, false);
   CreateLabel("Artchie_L_BE",     "Break Even Price:",  Panel_X + 15, Panel_Y + 155, 9, clrWhite, false);
   CreateLabel("Artchie_L_Lot",    "Next Grid Lot Size:",Panel_X + 15, Panel_Y + 175, 9, clrWhite, false);
   CreateLabel("Artchie_L_Closed", "Total Kinita (TP/SL):", Panel_X + 15, Panel_Y + 195, 9, clrWhite, false);

// Dynamic Values (Placeholders)
   CreateLabel("Artchie_V1", "...", Panel_X + 160, Panel_Y + 45, 9, clrWhite, true);
   CreateLabel("Artchie_V2", "...", Panel_X + 160, Panel_Y + 65, 9, clrWhite, true);

   CreateLabel("Artchie_V_Trades", "0 / " + IntegerToString(MaxMartingaleSteps), Panel_X + 160, Panel_Y + 95, 9, clrAqua, true);
   CreateLabel("Artchie_V_PL",     "$ 0.00", Panel_X + 160, Panel_Y + 115, 9, clrWhite, true);
   CreateLabel("Artchie_V_Target", "$ 0.00", Panel_X + 160, Panel_Y + 135, 9, clrYellow, true);
   CreateLabel("Artchie_V_BE",     "0.00000", Panel_X + 160, Panel_Y + 155, 9, clrOrange, true);
   CreateLabel("Artchie_V_Lot",    "0.00",    Panel_X + 160, Panel_Y + 175, 9, clrMagenta, true);
   CreateLabel("Artchie_V_Closed", "$ 0.00",  Panel_X + 160, Panel_Y + 195, 9, clrWhite, true);

   CreateLabel("Artchie_V_Action", "...", Panel_X + 15, Panel_Y + 225, 9, clrWhite, false);
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void UpdateDashboardValues(double fast, double slow, double lot, int trades, double profit, double closed_profit, string action)
  {
   ObjectSetString(0, "Artchie_V1", OBJPROP_TEXT, DoubleToStr(fast, 5));
   ObjectSetString(0, "Artchie_V2", OBJPROP_TEXT, DoubleToStr(slow, 5));

   ObjectSetString(0, "Artchie_V_Trades", OBJPROP_TEXT, IntegerToString(trades) + " / " + IntegerToString(MaxMartingaleSteps));

// Color-coded Floating P/L
   string plText = "$ " + DoubleToStr(profit, 2);
   color plColor = (profit >= 0) ? clrLime : clrRed;
   ObjectSetString(0, "Artchie_V_PL", OBJPROP_TEXT, plText);
   ObjectSetInteger(0, "Artchie_V_PL", OBJPROP_COLOR, plColor);

// Basket TP Target Update
   ObjectSetString(0, "Artchie_V_Target", OBJPROP_TEXT, "$ " + DoubleToStr(TargetProfitCash, 2));

// Color-coded Closed P/L
   string closedPlText = "$ " + DoubleToStr(closed_profit, 2);
   color closedPlColor = (closed_profit >= 0) ? clrLime : clrRed;
   ObjectSetString(0, "Artchie_V_Closed", OBJPROP_TEXT, closedPlText);
   ObjectSetInteger(0, "Artchie_V_Closed", OBJPROP_COLOR, closedPlColor);

   ObjectSetString(0, "Artchie_V_BE", OBJPROP_TEXT, DoubleToStr(BreakEvenPrice, 5));
   ObjectSetString(0, "Artchie_V_Lot", OBJPROP_TEXT, DoubleToStr(lot, 2));

   ObjectSetString(0, "Artchie_V_Action", OBJPROP_TEXT, "Aksyon: " + action);
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void CreateLabel(string name, string text, int x, int y, int size, color col, bool isBold)
  {
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, size);
   ObjectSetInteger(0, name, OBJPROP_COLOR, col);
   if(isBold)
      ObjectSetInteger(0, name, OBJPROP_BACK, false);
  }
//+------------------------------------------------------------------+
`;

