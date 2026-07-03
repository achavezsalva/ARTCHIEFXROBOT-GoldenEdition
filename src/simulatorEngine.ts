/**
 * Forex Simulator Engine (Client-side Fallback & Core)
 * This allows the simulation to run fully in the browser, making it fully compatible with Vercel.
 */

import { Candle, Trade, EASettings, SimulatorState, PAIR_CONFIGS, Timeframe, TIMEFRAME_SECONDS } from "./types";

export const DEFAULT_SETTINGS: EASettings = {
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

export function getTimestampForMonthYear(month: number, year: number, endOfMonth = false): number {
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

export function getMonthName(month: number): string {
  const months = [
    "Enero", "Pebrero", "Marso", "Abril", "Mayo", "Hunyo",
    "Hulyo", "Agosto", "Setyembre", "Oktubre", "Nobyembre", "Disyembre"
  ];
  return months[month - 1] || "Enero";
}

// Indicator calculations
export function calculateSMA(candles: Candle[], period: number, offset = 0): number {
  if (candles.length < period + offset) return 0;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[candles.length - 1 - i - offset].close;
  }
  return sum / period;
}

export function calculateATR(candles: Candle[], period: number, offset = 0): number {
  if (candles.length < period + offset + 1) return 0.00015;
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

export function calculateRSI(candles: Candle[], period: number, offset = 0): number {
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

export function updateIndicatorsForLatest(candles: Candle[], settings: EASettings) {
  if (candles.length === 0) return;
  const current = candles[candles.length - 1];
  current.fastMa = calculateSMA(candles, settings.FastMA, 0);
  current.slowMa = calculateSMA(candles, settings.SlowMA, 0);
  current.rsi = calculateRSI(candles, settings.RSIPeriod, 0);
  current.atr = calculateATR(candles, settings.ATR_Period, 0);
}

export function initCandlesForPair(pair: string, baseTime: number, timeframe: Timeframe = '1M'): Candle[] {
  const config = PAIR_CONFIGS[pair];
  const candles: Candle[] = [];
  let currentPrice = config.basePrice;
  const spacing = TIMEFRAME_SECONDS[timeframe] || 60;
  let time = baseTime - 150 * spacing;

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
    time += spacing;
  }

  // Pre-calculate historical indicators
  for (let i = 25; i < candles.length; i++) {
    const sub = candles.slice(0, i + 1);
    candles[i].fastMa = calculateSMA(sub, DEFAULT_SETTINGS.FastMA, 0);
    candles[i].slowMa = calculateSMA(sub, DEFAULT_SETTINGS.SlowMA, 0);
    candles[i].rsi = calculateRSI(sub, DEFAULT_SETTINGS.RSIPeriod, 0);
    candles[i].atr = calculateATR(sub, DEFAULT_SETTINGS.ATR_Period, 0);
  }

  return candles;
}

export function createInitialState(pair = "EURUSD", timeframe: Timeframe = '1M'): SimulatorState {
  const simTime = Math.floor(Date.now() / 1000) - 3600 * 24;
  const candles = initCandlesForPair(pair, simTime, timeframe);

  return {
    balance: 10000,
    equity: 10000,
    floatingPL: 0,
    margin: 0,
    freeMargin: 10000,
    drawdownPercent: 0,
    totalClosedProfit: 0,
    openTrades: [],
    closedTrades: [],
    activePair: pair,
    isRunning: false,
    speed: 5,
    timeframe,
    marketCondition: "normal",
    currentAction: "Naka-pause. Pindutin ang Play para magsimula.",
    breakEvenPrice: 0,
    targetProfitCash: 0,
    nextGridLot: DEFAULT_SETTINGS.BaseLotSize,
    candles,
    eaEnabled: true,
    settings: { ...DEFAULT_SETTINGS },
    testPeriodEnabled: false,
    testStartMonth: 1,
    testStartYear: 2026,
    testEndMonth: 12,
    testEndYear: 2026,
  };
}

// Single step tick function for the state
export function tickState(state: SimulatorState, simTime: number): SimulatorState {
  const newState = { ...state };
  const config = PAIR_CONFIGS[newState.activePair];
  const candles = [...newState.candles];
  if (candles.length === 0) return state;

  const currentCandle = { ...candles[candles.length - 1] };
  let price = currentCandle.close;

  // Price movement simulation
  const pipSize = config.pipSize;
  let bias = 0;
  let volMult = 1.0;

  if (newState.marketCondition === 'bullish') {
    bias = pipSize * 0.15;
  } else if (newState.marketCondition === 'bearish') {
    bias = -pipSize * 0.15;
  } else if (newState.marketCondition === 'volatile') {
    volMult = 2.5;
  } else if (newState.marketCondition === 'range') {
    const diff = config.basePrice - price;
    bias = diff * 0.02;
    volMult = 0.6;
  }

  const noise = (Math.random() - 0.5) * pipSize * 4 * volMult;
  price += bias + noise;

  currentCandle.close = price;
  if (price > currentCandle.high) currentCandle.high = price;
  if (price < currentCandle.low) currentCandle.low = price;

  // Indicators
  candles[candles.length - 1] = currentCandle;
  updateIndicatorsForLatest(candles, newState.settings);

  const spread = config.spreadPips * pipSize;
  const bid = price;
  const ask = price + spread;

  // Floating P/L calculations
  let floatingPL = 0;
  const updatedOpenTrades = newState.openTrades.map(trade => {
    const t = { ...trade };
    const exitPrice = t.type === 'BUY' ? bid : ask;
    const priceDiff = t.type === 'BUY' ? (exitPrice - t.openPrice) : (t.openPrice - exitPrice);
    
    if (newState.activePair === 'USDJPY') {
      t.profit = (priceDiff / exitPrice) * t.lots * 100000;
    } else {
      t.profit = priceDiff * t.lots * 100000;
    }
    floatingPL += t.profit;
    return t;
  });

  const equity = newState.balance + floatingPL;
  const margin = updatedOpenTrades.reduce((sum, t) => sum + (t.lots * 100000) / 500, 0);
  const freeMargin = equity - margin;
  const drawdownPercent = newState.balance > 0 ? ((floatingPL < 0 ? -floatingPL : 0) / newState.balance) * 100 : 0;

  newState.openTrades = updatedOpenTrades;
  newState.floatingPL = floatingPL;
  newState.equity = equity;
  newState.margin = margin;
  newState.freeMargin = freeMargin;
  newState.drawdownPercent = drawdownPercent;

  // Margin call stop out check or equity reaches 0
  if (equity <= 0 || (updatedOpenTrades.length > 0 && margin > 0 && (equity / margin) * 100 <= 20)) {
    newState.isRunning = false; // Stop the simulation & trade
    newState.currentAction = equity <= 0
      ? "EQUITY ZERO HIT! Naubos ang equity ($0.00). Huminto ang robot at sinara ang lahat ng posisyon."
      : "STOP OUT HIT! Ang Margin Level ay mas mababa sa 20%. Huminto ang robot at sinara ang lahat ng posisyon.";
    
    // Close all open positions
    if (updatedOpenTrades.length > 0) {
      const closedList = [...newState.closedTrades];
      let bal = newState.balance;
      updatedOpenTrades.forEach(trade => {
        const exitPrice = trade.type === 'BUY' ? bid : ask;
        const priceDiff = trade.type === 'BUY' ? (exitPrice - trade.openPrice) : (trade.openPrice - exitPrice);
        let profit = 0;
        if (newState.activePair === 'USDJPY') {
          profit = (priceDiff / exitPrice) * trade.lots * 100000;
        } else {
          profit = priceDiff * trade.lots * 100000;
        }
        closedList.push({
          ...trade,
          closePrice: exitPrice,
          closeTime: simTime,
          profit,
          comment: `${trade.comment} (STOP OUT - EQUITY ZERO)`
        });
        bal += profit;
      });

      newState.openTrades = [];
      newState.closedTrades = closedList;
      newState.balance = Math.round(Math.max(0, bal) * 100) / 100;
    } else {
      newState.balance = Math.round(Math.max(0, newState.balance) * 100) / 100;
    }

    newState.floatingPL = 0;
    newState.equity = newState.balance;
    newState.margin = 0;
    newState.freeMargin = newState.balance;
    newState.drawdownPercent = 0;
    newState.candles = candles;
    return newState;
  }

  // Basket calculations
  const totalOpenTrades = updatedOpenTrades.length;
  const basketType = totalOpenTrades > 0 ? updatedOpenTrades[0].type : null;
  const totalVolume = updatedOpenTrades.reduce((sum, t) => sum + t.lots, 0);
  const totalCost = updatedOpenTrades.reduce((sum, t) => sum + (t.openPrice * t.lots), 0);
  const lastLot = totalOpenTrades > 0 ? updatedOpenTrades[updatedOpenTrades.length - 1].lots : newState.settings.BaseLotSize;

  let breakEvenPrice = 0;
  let targetProfitCash = 0;
  let nextGridLot = newState.settings.BaseLotSize;

  if (totalOpenTrades > 0 && totalVolume > 0) {
    breakEvenPrice = totalCost / totalVolume;
    targetProfitCash = newState.settings.BasketTPPips * totalVolume * 10;

    if (totalOpenTrades < newState.settings.MaxMartingaleSteps) {
      nextGridLot = Number((lastLot * newState.settings.LotMultiplier).toFixed(2));
    } else {
      nextGridLot = newState.settings.BaseLotSize;
    }
  }

  newState.breakEvenPrice = breakEvenPrice;
  newState.targetProfitCash = targetProfitCash;
  newState.nextGridLot = nextGridLot;

  // Basket TP hit
  if (totalOpenTrades > 0 && floatingPL >= targetProfitCash && targetProfitCash > 0) {
    newState.currentAction = "BASKET TP HIT! Closing all trades...";
    
    const closedList = [...newState.closedTrades];
    let bal = newState.balance;
    updatedOpenTrades.forEach(trade => {
      const exitPrice = trade.type === 'BUY' ? bid : ask;
      const priceDiff = trade.type === 'BUY' ? (exitPrice - trade.openPrice) : (trade.openPrice - exitPrice);
      let profit = 0;
      if (newState.activePair === 'USDJPY') {
        profit = (priceDiff / exitPrice) * trade.lots * 100000;
      } else {
        profit = priceDiff * trade.lots * 100000;
      }
      closedList.push({
        ...trade,
        closePrice: exitPrice,
        closeTime: simTime,
        profit,
        comment: `${trade.comment} (Basket TP)`
      });
      bal += profit;
    });

    const roundedBal = Math.round(bal * 100) / 100;
    newState.openTrades = [];
    newState.closedTrades = closedList;
    newState.balance = roundedBal;
    newState.floatingPL = 0;
    newState.equity = roundedBal;
    newState.margin = 0;
    newState.freeMargin = roundedBal;
    newState.drawdownPercent = 0;
    newState.candles = candles;
    return newState;
  }

  // EA Trading signals
  if (newState.eaEnabled) {
    const fastMA_current = currentCandle.fastMa || price;
    const slowMA_current = currentCandle.slowMa || price;
    const rsi = currentCandle.rsi || 50;
    const atr = currentCandle.atr || (pipSize * 15);

    const prevCandle = candles[candles.length - 2];
    const fastMA_prev = prevCandle ? (prevCandle.fastMa || price) : price;
    const slowMA_prev = prevCandle ? (prevCandle.slowMa || price) : price;

    if (totalOpenTrades === 0) {
      newState.currentAction = "Nag-aabang ng signal...";
      newState.nextGridLot = newState.settings.BaseLotSize;

      // Buy signal
      if (fastMA_prev <= slowMA_prev && fastMA_current > slowMA_current && rsi < newState.settings.RSI_Upper) {
        newState.currentAction = "BUY Signal Triggered!";
        const newTicket = 10000 + newState.openTrades.length + newState.closedTrades.length + 1;
        newState.openTrades.push({
          ticket: newTicket,
          symbol: newState.activePair,
          type: 'BUY',
          lots: newState.settings.BaseLotSize,
          openPrice: ask,
          openTime: simTime,
          profit: 0,
          comment: "Artchie BUY",
          magicNumber: newState.settings.MagicNumber
        });
      }
      // Sell signal
      else if (fastMA_prev >= slowMA_prev && fastMA_current < slowMA_current && rsi > newState.settings.RSI_Lower) {
        newState.currentAction = "SELL Signal Triggered!";
        const newTicket = 10000 + newState.openTrades.length + newState.closedTrades.length + 1;
        newState.openTrades.push({
          ticket: newTicket,
          symbol: newState.activePair,
          type: 'SELL',
          lots: newState.settings.BaseLotSize,
          openPrice: bid,
          openTime: simTime,
          profit: 0,
          comment: "Artchie SELL",
          magicNumber: newState.settings.MagicNumber
        });
      }
    } else {
      newState.currentAction = "Bumabawi / Naghihintay ma-TP...";

      const lastPrice = updatedOpenTrades[updatedOpenTrades.length - 1].openPrice;
      const gridSpacing = (newState.settings.GridDistance * pipSize) + (atr * 0.5);

      if (basketType === 'BUY' && ask <= lastPrice - gridSpacing) {
        newState.currentAction = "Opening Grid BUY...";
        const newTicket = 10000 + newState.openTrades.length + newState.closedTrades.length + 1;
        newState.openTrades.push({
          ticket: newTicket,
          symbol: newState.activePair,
          type: 'BUY',
          lots: nextGridLot,
          openPrice: ask,
          openTime: simTime,
          profit: 0,
          comment: `Artchie Grid BUY #${totalOpenTrades + 1}`,
          magicNumber: newState.settings.MagicNumber
        });
      } else if (basketType === 'SELL' && bid >= lastPrice + gridSpacing) {
        newState.currentAction = "Opening Grid SELL...";
        const newTicket = 10000 + newState.openTrades.length + newState.closedTrades.length + 1;
        newState.openTrades.push({
          ticket: newTicket,
          symbol: newState.activePair,
          type: 'SELL',
          lots: nextGridLot,
          openPrice: bid,
          openTime: simTime,
          profit: 0,
          comment: `Artchie Grid SELL #${totalOpenTrades + 1}`,
          magicNumber: newState.settings.MagicNumber
        });
      }
    }
  } else {
    newState.currentAction = "EA is disabled. Manual mode active.";
  }

  newState.candles = candles;
  newState.totalClosedProfit = newState.closedTrades.reduce((sum, t) => sum + t.profit, 0);

  return newState;
}

export function generateLocalAiAnalysis(state: SimulatorState): string {
  const openTradesCount = state.openTrades.length;
  const winRate = state.closedTrades.length > 0 
    ? (state.closedTrades.filter(t => t.profit > 0).length / state.closedTrades.length) * 100 
    : 0;
  
  let marketAnalysis = "";
  if (state.marketCondition === "normal") {
    marketAnalysis = "Nasa **Normal Regime** ang merkado sa ngayon. Ang system ay mag-aabang ng malinis na Fast/Slow MA crossover. Dahil walang malinaw na trend, maayos ang grid spacing ngunit mag-ingat sa biglaang breakout.";
  } else if (state.marketCondition === "bullish") {
    marketAnalysis = "Nasa **Bullish Trend** ang pair. Mas mataas ang tiyansa na mag-trigger ang BUY orders. Kung mayroon kang mga open SELL grid positions, mag-ingat sa lumalaking floating loss habang umaakyat ang presyo.";
  } else if (state.marketCondition === "bearish") {
    marketAnalysis = "Nasa **Bearish Trend** ang pair. Pabor ito sa mga grid SELL trades. Mag-ingat kung may maiwang BUY grid sa ilalim habang patuloy na bumabagsak ang merkado.";
  } else if (state.marketCondition === "volatile") {
    marketAnalysis = "Nasa **High Volatility Regime** ang market! Malalaki ang kandila at mabilis ang paggalaw. Magandang kumita sa grid dahil mabilis ma-hit ang Basket TP, ngunit napakataas din ng panganib na ma-trigger ang madaming Martingale steps sa maikling oras.";
  } else {
    marketAnalysis = "Nasa **Range-Bound (Sideways)** condition ang pair. Ito ang pinaka-paboritong kundisyon ng ating **Artchie Grid/Martingale System** dahil pabalik-balik ang presyo sa base rate, kaya madaling ma-clear ang parehong BUY at SELL baskets.";
  }

  const drawdownWarning = state.drawdownPercent > 15
    ? `⚠️ **MAHALAGANG BABALA:** Ang iyong kasalukuyang Drawdown ay nasa **${state.drawdownPercent.toFixed(1)}%**. Mapanganib na ito para sa isang Martingale system! Kapag lumagpas ito sa 30-50%, maaari kang makaranas ng Margin Call.`
    : `✅ **Ligtas na Drawdown:** Ang iyong Drawdown ay napakababa pa lamang (**${state.drawdownPercent.toFixed(1)}%**). Safe pa ang account at malaki ang Free Margin para suportahan ang mga susunod na grid steps kung sakaling humaba ang martingale.`;

  return `### 📊 Market Regime & Analysis (Local Fallback)
${marketAnalysis}

### ⚠️ Risk Assessment & Drawdown
* **Current Drawdown:** ${state.drawdownPercent.toFixed(2)}%
* **Open Trades:** ${openTradesCount} positions active
* **Equity:** $${state.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
* **Win Rate:** ${winRate.toFixed(1)}% (${state.closedTrades.length} trades closed)

${drawdownWarning}

### 🔧 Optimization Checklist
1. **Dagdagan ang GridDistance:** Kung masyadong volatile ang market, gawin itong **30-40 pips** para hindi mabilis maubos ang MaxMartingaleSteps.
2. **Isaayos ang LotMultiplier:** Ang kasalukuyang multiplier na **${state.settings.LotMultiplier}x** ay agresibo. Ibaba ito sa **1.2x** o **1.3x** para sa mas ligtas na recovery.
3. **Babaan ang BaseLotSize:** Magsimula lagi sa **0.01** kapag mababa sa $10,000 ang capital upang maiwasan ang stop out.

### 💡 AI Coach's Golden Tip
*"Ang Martingale at Grid system ay parang sining—madaling kumita kapag sideways, ngunit delikado kapag one-way trend. Lagi mong pairan ng disiplina ang paggamit nito. Ang pinakamagandang robot ay ang robot na pinapatay kapag may malalaking high-impact news!"*`;
}
