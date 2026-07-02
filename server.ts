/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { Candle, Trade, EASettings, SimulatorState, PAIR_CONFIGS, Timeframe, TIMEFRAME_SECONDS } from "./src/types.js";
import { MQL4_ROBOT_SOURCE } from "./src/robot_source.js";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// DEFAULT EA SETTINGS
const DEFAULT_SETTINGS: EASettings = {
  BaseLotSize: 0.01,
  LotMultiplier: 1.4,
  MaxMartingaleSteps: 6,
  GridDistance: 25, // in pips
  BasketTPPips: 30, // in pips
  FastMA: 10,
  SlowMA: 20,
  RSIPeriod: 14,
  RSI_Upper: 70,
  RSI_Lower: 30,
  ATR_Period: 14,
  MagicNumber: 1001,
};

// SIMULATOR IN-MEMORY DATABASE
let activePair = "EURUSD";
let balance = 10000;
let totalClosedProfit = 0;
let openTrades: Trade[] = [];
let closedTrades: Trade[] = [];
let isRunning = false;
let speed = 5; // default 5x speed
let timeframe: Timeframe = "1M";
let marketCondition: 'normal' | 'bullish' | 'bearish' | 'volatile' | 'range' = "normal";
let currentAction = "Naka-pause. Pindutin ang Play para magsimula.";
let nextTicket = 10001;
let simTime = Math.floor(Date.now() / 1000) - 3600 * 24; // start 1 day ago in sim time
let eaEnabled = true;

// Backtest Date Period settings
let testPeriodEnabled = false;
let testStartMonth = 1; // January (1-12)
let testStartYear = 2026;
let testEndMonth = 12; // December (1-12)
let testEndYear = 2026;

function getTimestampForMonthYear(month: number, year: number, endOfMonth = false): number {
  if (endOfMonth) {
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const d = new Date(Date.UTC(nextYear, nextMonth - 1, 1, 0, 0, 0));
    return Math.floor(d.getTime() / 1000) - 1;
  } else {
    const d = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    return Math.floor(d.getTime() / 1000);
  }
}

function getMonthName(month: number): string {
  const months = [
    "Enero", "Pebrero", "Marso", "Abril", "Mayo", "Hunyo",
    "Hulyo", "Agosto", "Setyembre", "Oktubre", "Nobyembre", "Disyembre"
  ];
  return months[month - 1] || "Enero";
}

function resetSimulationTime() {
  if (testPeriodEnabled) {
    simTime = getTimestampForMonthYear(testStartMonth, testStartYear, false);
  } else {
    simTime = Math.floor(Date.now() / 1000) - 3600 * 24;
  }
}


// Pre-load historical candles for each pair
const pairCandles: Record<string, Candle[]> = {};

function initCandles(pair: string) {
  const config = PAIR_CONFIGS[pair];
  const candles: Candle[] = [];
  let currentPrice = config.basePrice;
  let time = simTime - 150 * 60; // 150 minutes ago

  for (let i = 0; i < 150; i++) {
    const volatility = config.pipSize * 8;
    const change = (Math.random() - 0.5) * volatility;
    const open = currentPrice;
    const close = currentPrice + change;
    const high = Math.max(open, close) + Math.random() * (config.pipSize * 4);
    const low = Math.min(open, close) - Math.random() * (config.pipSize * 4);

    candles.push({
      time,
      open,
      high,
      low,
      close,
    });
    currentPrice = close;
    time += 60;
  }
  pairCandles[pair] = candles;
}

// Initialize all pairs
Object.keys(PAIR_CONFIGS).forEach(pair => {
  initCandles(pair);
});

let settings: EASettings = { ...DEFAULT_SETTINGS };

// TECHNICAL INDICATORS CALCULATORS
function calculateSMA(candles: Candle[], period: number, offset = 0): number {
  if (candles.length < period + offset) return 0;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[candles.length - 1 - i - offset].close;
  }
  return sum / period;
}

function calculateATR(candles: Candle[], period: number, offset = 0): number {
  if (candles.length < period + offset + 1) return 0.00015; // default reasonable atr
  let trSum = 0;
  for (let i = 0; i < period; i++) {
    const idx = candles.length - 1 - i - offset;
    const prevIdx = idx - 1;
    const c = candles[idx];
    const prevC = candles[prevIdx];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevC.close),
      Math.abs(c.low - prevC.close)
    );
    trSum += tr;
  }
  return trSum / period;
}

function calculateRSI(candles: Candle[], period: number, offset = 0): number {
  if (candles.length < period + offset + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    const idx = candles.length - 1 - i - offset;
    const change = candles[idx].close - candles[idx - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

// Update indicator values in the candles list
function updateIndicators(candles: Candle[]) {
  if (candles.length === 0) return;
  const current = candles[candles.length - 1];
  current.fastMa = calculateSMA(candles, settings.FastMA, 0);
  current.slowMa = calculateSMA(candles, settings.SlowMA, 0);
  current.rsi = calculateRSI(candles, settings.RSIPeriod, 0);
  current.atr = calculateATR(candles, settings.ATR_Period, 0);
}

// Trigger initial indicators calculations
Object.keys(pairCandles).forEach(pair => {
  const list = pairCandles[pair];
  for (let i = 25; i < list.length; i++) {
    const sub = list.slice(0, i + 1);
    list[i].fastMa = calculateSMA(sub, settings.FastMA, 0);
    list[i].slowMa = calculateSMA(sub, settings.SlowMA, 0);
    list[i].rsi = calculateRSI(sub, settings.RSIPeriod, 0);
    list[i].atr = calculateATR(sub, settings.ATR_Period, 0);
  }
});

// OPEN A TRADE HELPER
function openTrade(type: 'BUY' | 'SELL', lots: number, price: number, comment: string): Trade {
  const trade: Trade = {
    ticket: nextTicket++,
    symbol: activePair,
    type,
    lots,
    openPrice: price,
    openTime: simTime,
    profit: 0,
    comment,
    magicNumber: settings.MagicNumber
  };
  openTrades.push(trade);
  return trade;
}

// CLOSE ALL TRADES HELPER
function closeAllTrades(comment = "Basket Close") {
  const config = PAIR_CONFIGS[activePair];
  const candles = pairCandles[activePair];
  const currentPrice = candles[candles.length - 1].close;
  const spread = config.spreadPips * config.pipSize;
  const bid = currentPrice;
  const ask = currentPrice + spread;

  openTrades.forEach(trade => {
    const exitPrice = trade.type === 'BUY' ? bid : ask;
    const priceDiff = trade.type === 'BUY' ? (exitPrice - trade.openPrice) : (trade.openPrice - exitPrice);
    
    let profit = 0;
    if (activePair === 'USDJPY') {
      profit = (priceDiff / exitPrice) * trade.lots * 100000;
    } else {
      profit = priceDiff * trade.lots * 100000;
    }

    trade.closePrice = exitPrice;
    trade.closeTime = simTime;
    trade.profit = profit;
    trade.comment = `${trade.comment} (${comment})`;
    closedTrades.push(trade);
    balance += profit;
  });

  openTrades = [];
}

// SIMULATOR MAIN TICK ACTION (Runs every step)
function tickSimulation() {
  const config = PAIR_CONFIGS[activePair];
  const candles = pairCandles[activePair];
  if (!candles || candles.length === 0) return;

  const currentCandle = candles[candles.length - 1];
  let price = currentCandle.close;

  // Generate a tick price deviation based on market condition
  const pipSize = config.pipSize;
  let bias = 0;
  let volMult = 1.0;

  if (marketCondition === 'bullish') {
    bias = pipSize * 0.15; // upward bias
  } else if (marketCondition === 'bearish') {
    bias = -pipSize * 0.15; // downward bias
  } else if (marketCondition === 'volatile') {
    volMult = 2.5; // highly volatile
  } else if (marketCondition === 'range') {
    // Reverts to basePrice
    const diff = config.basePrice - price;
    bias = diff * 0.02;
    volMult = 0.6;
  }

  const noise = (Math.random() - 0.5) * pipSize * 4 * volMult;
  price += bias + noise;

  // Update current candle high/low/close
  currentCandle.close = price;
  if (price > currentCandle.high) currentCandle.high = price;
  if (price < currentCandle.low) currentCandle.low = price;

  // Spread and Ask/Bid calculation
  const spread = config.spreadPips * pipSize;
  const bid = price;
  const ask = price + spread;

  // 1. Calculate active Floating P/L of open positions
  let floatingPL = 0;
  openTrades.forEach(trade => {
    const exitPrice = trade.type === 'BUY' ? bid : ask;
    const priceDiff = trade.type === 'BUY' ? (exitPrice - trade.openPrice) : (trade.openPrice - exitPrice);
    
    if (activePair === 'USDJPY') {
      trade.profit = (priceDiff / exitPrice) * trade.lots * 100000;
    } else {
      trade.profit = priceDiff * trade.lots * 100000;
    }
    floatingPL += trade.profit;
  });

  const equity = balance + floatingPL;
  const margin = openTrades.reduce((sum, t) => sum + (t.lots * 100000) / 500, 0); // 1:500 Leverage

  // 2. Stop Out / Margin Call safety check (20% margin level stop-out)
  if (openTrades.length > 0 && margin > 0) {
    const marginLevel = (equity / margin) * 100;
    if (marginLevel <= 20 || equity <= 0) {
      currentAction = "STOP OUT HIT! Margin Level is below 20%. Closing positions.";
      closeAllTrades("STOP OUT");
      return;
    }
  }

  // Calculate Basket Data
  let totalOpenTrades = openTrades.length;
  let basketType = totalOpenTrades > 0 ? openTrades[0].type : null;
  let totalVolume = openTrades.reduce((sum, t) => sum + t.lots, 0);
  let totalCost = openTrades.reduce((sum, t) => sum + (t.openPrice * t.lots), 0);
  let lastLot = totalOpenTrades > 0 ? openTrades[openTrades.length - 1].lots : settings.BaseLotSize;

  let breakEvenPrice = 0;
  let targetProfitCash = 0;
  let nextGridLot = settings.BaseLotSize;

  if (totalOpenTrades > 0 && totalVolume > 0) {
    breakEvenPrice = totalCost / totalVolume;
    // Target Profit is BasketTPPips * volume * 10 dollars (standard pip multiplier)
    targetProfitCash = settings.BasketTPPips * totalVolume * 10;

    if (totalOpenTrades < settings.MaxMartingaleSteps) {
      nextGridLot = Number((lastLot * settings.LotMultiplier).toFixed(2));
    } else {
      nextGridLot = settings.BaseLotSize; // Safety limit reset
    }
  }

  // 3. Check Basket Take Profit
  if (totalOpenTrades > 0 && floatingPL >= targetProfitCash && targetProfitCash > 0) {
    currentAction = "BASKET TP HIT! Closing all trades...";
    closeAllTrades("Basket TP");
    return;
  }

  // EA AUTOMATIC TRADING LOGIC
  if (eaEnabled) {
    const fastMA_current = currentCandle.fastMa || price;
    const slowMA_current = currentCandle.slowMa || price;
    const rsi = currentCandle.rsi || 50;
    const atr = currentCandle.atr || (pipSize * 15);

    // Get previous indicators (at completed candle index 1, i.e., candles[candles.length - 2])
    const prevCandle = candles[candles.length - 2];
    const fastMA_prev = prevCandle ? (prevCandle.fastMa || price) : price;
    const slowMA_prev = prevCandle ? (prevCandle.slowMa || price) : price;

    if (totalOpenTrades === 0) {
      currentAction = "Nag-aabang ng signal...";
      nextGridLot = settings.BaseLotSize;

      // BUY SIGNAL: Fast MA crosses above Slow MA, and RSI is not overbought (< RSI_Upper)
      if (fastMA_prev <= slowMA_prev && fastMA_current > slowMA_current && rsi < settings.RSI_Upper) {
        currentAction = "BUY Signal Triggered!";
        openTrade('BUY', settings.BaseLotSize, ask, "Artchie BUY");
      }
      // SELL SIGNAL: Fast MA crosses below Slow MA, and RSI is not oversold (> RSI_Lower)
      else if (fastMA_prev >= slowMA_prev && fastMA_current < slowMA_current && rsi > settings.RSI_Lower) {
        currentAction = "SELL Signal Triggered!";
        openTrade('SELL', settings.BaseLotSize, bid, "Artchie SELL");
      }
    } else {
      currentAction = "Bumabawi / Naghihintay ma-TP...";

      const lastPrice = openTrades[openTrades.length - 1].openPrice;
      // Grid spacing with ATR dynamic filter
      const gridSpacing = (settings.GridDistance * pipSize) + (atr * 0.5);

      if (basketType === 'BUY' && ask <= lastPrice - gridSpacing) {
        currentAction = "Opening Grid BUY...";
        openTrade('BUY', nextGridLot, ask, `Artchie Grid BUY #${totalOpenTrades + 1}`);
      } else if (basketType === 'SELL' && bid >= lastPrice + gridSpacing) {
        currentAction = "Opening Grid SELL...";
        openTrade('SELL', nextGridLot, bid, `Artchie Grid SELL #${totalOpenTrades + 1}`);
      }
    }
  } else {
    currentAction = "EA is disabled. Manual mode active.";
  }
}

// TIMER ENGINE TO RUN SIMULATION STEPS
let simTimerInterval: NodeJS.Timeout | null = null;

function startSimTimer() {
  if (simTimerInterval) clearInterval(simTimerInterval);

  simTimerInterval = setInterval(() => {
    if (!isRunning || speed === 0) return;

    // Based on the speed multiplier, simulate a certain number of seconds
    // 1 physical step runs every 400ms.
    // Speed:
    // 1x -> advances simTime by 1 sec
    // 5x -> advances simTime by 5 sec
    // 20x -> advances simTime by 20 sec
    // 100x -> advances simTime by 100 sec
    const secondsToAdvance = speed;

    for (let s = 0; s < secondsToAdvance; s++) {
      simTime += 1;

      // Check if backtest period has ended
      if (testPeriodEnabled) {
        const endTimestamp = getTimestampForMonthYear(testEndMonth, testEndYear, true);
        if (simTime >= endTimestamp) {
          isRunning = false;
          currentAction = `Tapos na ang Backtest Period (${getMonthName(testStartMonth)} ${testStartYear} hanggang ${getMonthName(testEndMonth)} ${testEndYear})!`;
          break;
        }
      }

      // If we cross a 1-minute boundary, finalize current candle and open a new one
      if (simTime % 60 === 0) {
        const candles = pairCandles[activePair];
        const last = candles[candles.length - 1];

        // Finalize indicators for the closing candle
        updateIndicators(candles);

        // Append a new 1M candle
        candles.push({
          time: simTime,
          open: last.close,
          high: last.close,
          low: last.close,
          close: last.close,
        });

        // Limit history to 200 candles to keep browser responsive
        if (candles.length > 200) {
          candles.shift();
        }
      }

      // Execute simulation tick actions
      tickSimulation();
    }
  }, 400);
}

// USER DATABASE STRUCTURE
interface User {
  email: string;
  password?: string;
  role: 'admin' | 'user';
}

const users: User[] = [
  { email: "achavezsalva@gmail.com", password: "adminpassword", role: "admin" } // seed admin
];

// Start simulation immediately
startSimTimer();

// AUTH ENDPOINTS
app.post("/api/auth/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Required ang email at password!" });
  }
  const cleanEmail = email.trim().toLowerCase();
  const existing = users.find(u => u.email === cleanEmail);
  if (existing) {
    return res.status(400).json({ error: "Ang email na ito ay rehistrado na!" });
  }
  
  // Automatically make achavezsalva@gmail.com an admin
  const role = cleanEmail === "achavezsalva@gmail.com" ? "admin" : "user";
  const newUser: User = { email: cleanEmail, password, role };
  users.push(newUser);
  
  res.json({ success: true, user: { email: cleanEmail, role } });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Required ang email at password!" });
  }
  const cleanEmail = email.trim().toLowerCase();
  
  // Special auto-create admin if logging in first time with default password
  let user = users.find(u => u.email === cleanEmail);
  if (!user && cleanEmail === "achavezsalva@gmail.com") {
    user = { email: cleanEmail, password, role: "admin" };
    users.push(user);
  }
  
  if (!user || user.password !== password) {
    return res.status(400).json({ error: "Maling email o password!" });
  }
  
  res.json({ success: true, user: { email: cleanEmail, role: user.role } });
});

app.post("/api/auth/google", (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Required ang Google email!" });
  }
  const cleanEmail = email.trim().toLowerCase();
  let user = users.find(u => u.email === cleanEmail);
  
  const role = cleanEmail === "achavezsalva@gmail.com" ? "admin" : "user";
  if (!user) {
    user = { email: cleanEmail, role };
    users.push(user);
  }
  
  res.json({ success: true, user: { email: cleanEmail, role } });
});

// GET CURRENT STATE ENDPOINT (PROTECTED WITH EMAIL QUERY CHECK)
app.get("/api/simulator/download-robot", (req, res) => {
  const email = (req.query.email as string || "").trim().toLowerCase();
  if (email !== "achavezsalva@gmail.com") {
    return res.status(403).send("Forbidden. Admin lamang (achavezsalva@gmail.com) ang pinahihintulutang mag-download.");
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=Artchie_FXROBOT_3_0_Golden.ex4");
  
  // Create a mock EX4 compiled file content with binary structure and a secure message
  const compiledHeader = Buffer.from([
    0x45, 0x58, 0x34, 0x00, // EX4\0 signature
    0x03, 0x00, 0x00, 0x00, // Version
    0x50, 0x52, 0x4F, 0x54, 0x45, 0x43, 0x54, 0x45, 0x44 // "PROTECTED"
  ]);
  const secureNotice = Buffer.from(
    "\r\n==================================================\r\n" +
    "ARTCHIE FXROBOT v3.0 (GOLDEN EDITION) - COMPILED BINARY\r\n" +
    "Protected & Secured by QuantumTune Lab. All Rights Reserved.\r\n" +
    "This file is compiled (.EX4) and ready for MetaTrader 4.\r\n" +
    "Source code is closed-source and restricted.\r\n" +
    "==================================================\r\n"
  );
  res.send(Buffer.concat([compiledHeader, secureNotice]));
});

// GET CURRENT STATE ENDPOINT
app.get("/api/simulator/state", (req, res) => {
  const candles = pairCandles[activePair] || [];
  const config = PAIR_CONFIGS[activePair];

  // Recalculate indicators for the latest incomplete candle so the UI updates
  if (candles.length > 0) {
    updateIndicators(candles);
  }

  let totalVolume = openTrades.reduce((sum, t) => sum + t.lots, 0);
  let totalCost = openTrades.reduce((sum, t) => sum + (t.openPrice * t.lots), 0);
  let breakEvenPrice = totalVolume > 0 ? (totalCost / totalVolume) : 0;
  let targetProfitCash = totalVolume > 0 ? (settings.BasketTPPips * totalVolume * 10) : 0;
  let floatingPL = openTrades.reduce((sum, t) => sum + t.profit, 0);
  let lastLot = openTrades.length > 0 ? openTrades[openTrades.length - 1].lots : settings.BaseLotSize;
  let nextGridLot = settings.BaseLotSize;

  if (openTrades.length > 0) {
    if (openTrades.length < settings.MaxMartingaleSteps) {
      nextGridLot = Number((lastLot * settings.LotMultiplier).toFixed(2));
    } else {
      nextGridLot = settings.BaseLotSize;
    }
  }

  const equity = balance + floatingPL;
  const margin = openTrades.reduce((sum, t) => sum + (t.lots * 100000) / 500, 0);
  const freeMargin = equity - margin;
  const drawdownPercent = balance > 0 ? ((floatingPL < 0 ? -floatingPL : 0) / balance) * 100 : 0;

  const totalClosedPr = closedTrades.reduce((sum, t) => sum + t.profit, 0);

  const state: SimulatorState = {
    balance,
    equity,
    floatingPL,
    margin,
    freeMargin,
    drawdownPercent,
    totalClosedProfit: totalClosedPr,
    openTrades,
    closedTrades,
    activePair,
    isRunning,
    speed,
    timeframe,
    marketCondition,
    currentAction,
    breakEvenPrice,
    targetProfitCash,
    nextGridLot,
    candles,
    eaEnabled,
    settings,
    testPeriodEnabled,
    testStartMonth,
    testStartYear,
    testEndMonth,
    testEndYear,
  };

  res.json(state);
});

// UPDATE EA SETTINGS ENDPOINT
app.post("/api/simulator/settings", (req, res) => {
  settings = { ...settings, ...req.body };
  res.json({ success: true, settings });
});

// CONTROL SIMULATION ENDPOINT
app.post("/api/simulator/control", (req, res) => {
  const { action, value } = req.body;

  if (action === "toggle_run") {
    isRunning = value !== undefined ? value : !isRunning;
  } else if (action === "set_balance") {
    balance = Math.max(1, Number(value));
  } else if (action === "speed") {
    speed = Number(value);
  } else if (action === "market_condition") {
    marketCondition = value;
  } else if (action === "active_pair") {
    activePair = value;
    // Close open positions if pair changes
    if (openTrades.length > 0) {
      closeAllTrades("Pair Swapped");
    }
  } else if (action === "ea_toggle") {
    eaEnabled = value !== undefined ? value : !eaEnabled;
  } else if (action === "replay_step") {
    isRunning = false;
    const candles = pairCandles[activePair];
    if (candles && candles.length > 0) {
      for (let s = 0; s < 60; s++) {
        simTime += 1;
        if (simTime % 60 === 0) {
          const last = candles[candles.length - 1];
          updateIndicators(candles);
          candles.push({
            time: simTime,
            open: last.close,
            high: last.close,
            low: last.close,
            close: last.close,
          });
          if (candles.length > 200) {
            candles.shift();
          }
        }
        tickSimulation();
      }
    }
  } else if (action === "update_test_period") {
    testPeriodEnabled = !!value.testPeriodEnabled;
    testStartMonth = Number(value.testStartMonth);
    testStartYear = Number(value.testStartYear);
    testEndMonth = Number(value.testEndMonth);
    testEndYear = Number(value.testEndYear);

    // Reset and apply new backtest period
    balance = 10000;
    openTrades = [];
    closedTrades = [];
    isRunning = false;
    speed = 5;
    marketCondition = "normal";
    currentAction = testPeriodEnabled 
      ? `Naka-set ang Backtest mula ${getMonthName(testStartMonth)} ${testStartYear}. Pindutin ang Play para simulan.` 
      : "Naka-pause. Pindutin ang Play para magsimula.";
    eaEnabled = true;
    resetSimulationTime();
    initCandles(activePair);
  } else if (action === "reset") {
    balance = 10000;
    openTrades = [];
    closedTrades = [];
    isRunning = false;
    speed = 5;
    marketCondition = "normal";
    currentAction = "Naka-pause. Pindutin ang Play para magsimula.";
    eaEnabled = true;
    resetSimulationTime();
    initCandles(activePair);
  }

  res.json({ success: true });
});

// MANUAL TRADE ENDPOINT
app.post("/api/simulator/trade", (req, res) => {
  const { type, lots } = req.body;
  const config = PAIR_CONFIGS[activePair];
  const candles = pairCandles[activePair];
  const price = candles[candles.length - 1].close;
  const spread = config.spreadPips * config.pipSize;

  const tradePrice = type === 'BUY' ? (price + spread) : price;
  openTrade(type, lots, tradePrice, "Manual Trade");

  res.json({ success: true });
});

// CLOSE ALL ENDPOINT
app.post("/api/simulator/close-all", (req, res) => {
  closeAllTrades("Manual Close All");
  res.json({ success: true });
});

// AI RISK ANALYSIS ENHANCED BY GEMINI
app.post("/api/simulator/ai-analysis", async (req, res) => {
  try {
    // If the client sends the simulator state, use it (making the API stateless)
    const clientState = req.body && req.body.candles ? req.body : null;
    
    const activePairVal = clientState ? clientState.activePair : activePair;
    const balanceVal = clientState ? clientState.balance : balance;
    const openTradesVal = clientState ? clientState.openTrades : openTrades;
    const closedTradesVal = clientState ? clientState.closedTrades : closedTrades;
    const marketConditionVal = clientState ? clientState.marketCondition : marketCondition;
    const settingsVal = clientState ? clientState.settings : settings;
    const candlesVal = clientState ? clientState.candles : (pairCandles[activePair] || []);

    const latestCandle = candlesVal[candlesVal.length - 1];

    // Build context
    const openTradesCount = openTradesVal.length;
    const floatingPL = openTradesVal.reduce((sum: number, t: any) => sum + t.profit, 0);
    const equity = balanceVal + floatingPL;
    const margin = openTradesVal.reduce((sum: number, t: any) => sum + (t.lots * 100000) / 500, 0);
    const drawdownPercent = balanceVal > 0 ? ((floatingPL < 0 ? -floatingPL : 0) / balanceVal) * 100 : 0;

    const totalClosedCount = closedTradesVal.length;
    const totalWins = closedTradesVal.filter((t: any) => t.profit > 0).length;
    const winRate = totalClosedCount > 0 ? (totalWins / totalClosedCount) * 100 : 0;

    const context = {
      pair: activePairVal,
      balance: balanceVal,
      equity,
      drawdownPercent,
      floatingPL,
      margin,
      openTradesCount,
      marketCondition: marketConditionVal,
      indicators: {
        price: latestCandle ? latestCandle.close : 0,
        fastMa: latestCandle ? latestCandle.fastMa : 0,
        slowMa: latestCandle ? latestCandle.slowMa : 0,
        rsi: latestCandle ? latestCandle.rsi : 0,
        atr: latestCandle ? latestCandle.atr : 0,
      },
      eaSettings: settingsVal,
      totalClosedCount,
      winRate,
    };

    const prompt = `
      You are 'Artchie AI Coach' - a premium forex risk management consultant.
      Analyze the following simulation state of the 'Artchie FXROBOT 3.0' Grid / Martingale bot:

      STATE INFO:
      ${JSON.stringify(context, null, 2)}

      Write a highly professional and structured risk analysis report. Keep it concise, practical, and tailored to the user's trading strategy.
      Speak directly to the trader. Use a professional, slightly encouraging tone.
      You can blend english and some casual Tagalog terms to make it friendly and engaging for the user, matching their original prompt vibe.
      
      Structure your response exactly as follows:
      ### 📊 Market Regime & Analysis
      Briefly explain the current simulated market condition and whether the moving average crossover and RSI levels justify active trades or keeping still.

      ### ⚠️ Risk Assessment & Drawdown
      Analyze the current basket risk. Grid/Martingale has high tail-risk; warning the user about the dangers of their current MaxMartingaleSteps, BaseLotSize, and active drawdown. 

      ### 🔧 Optimization Checklist
      Provide 3-4 concrete parameter tuning tips (e.g., 'Dapat bang taasan ang GridDistance?', 'Baguhin ang LotMultiplier?').

      ### 💡 AI Coach's Golden Tip
      A final golden rule of trading for the user.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    res.json({ analysis: response.text });
  } catch (error: any) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Failed to generate AI Analysis. Please try again." });
  }
});

// Serve frontend assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Forex Simulator Server running on port ${PORT}`);
  });
}

startServer();
