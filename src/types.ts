/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  fastMa?: number;
  slowMa?: number;
  rsi?: number;
  atr?: number;
}

export interface Trade {
  ticket: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  lots: number;
  openPrice: number;
  openTime: number; // timestamp
  closePrice?: number;
  closeTime?: number; // timestamp
  profit: number;
  comment: string;
  magicNumber: number;
}

export interface EASettings {
  BaseLotSize: number;
  LotMultiplier: number;
  MaxMartingaleSteps: number;
  GridDistance: number; // Pips
  BasketTPPips: number;  // Pips from Break Even
  FastMA: number;
  SlowMA: number;
  RSIPeriod: number;
  RSI_Upper: number;
  RSI_Lower: number;
  ATR_Period: number;
  MagicNumber: number;
}

export type Timeframe = '1M' | '5M' | '15M' | '30M' | '1H' | '4H' | 'D1' | 'W1' | 'MN';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1M': 60,
  '5M': 300,
  '15M': 900,
  '30M': 1800,
  '1H': 3600,
  '4H': 14400,
  'D1': 86400,
  'W1': 604800,
  'MN': 2592000,
};

export interface SimulatorState {
  balance: number;
  equity: number;
  floatingPL: number;
  margin: number;
  freeMargin: number;
  drawdownPercent: number;
  totalClosedProfit: number;
  openTrades: Trade[];
  closedTrades: Trade[];
  activePair: string;
  isRunning: boolean;
  speed: number; // 0 = paused, 1 = 1x, 5 = 5x, 20 = 20x, 100 = 100x
  timeframe: Timeframe;
  marketCondition: 'normal' | 'bullish' | 'bearish' | 'volatile' | 'range';
  currentAction: string;
  breakEvenPrice: number;
  targetProfitCash: number;
  nextGridLot: number;
  candles: Candle[];
  eaEnabled: boolean;
  settings: EASettings;
  testPeriodEnabled?: boolean;
  testStartMonth?: number;
  testStartYear?: number;
  testEndMonth?: number;
  testEndYear?: number;
}

export interface RiskMetrics {
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin: number;
  averageLoss: number;
  sharpeRatio: number;
}

export const PAIR_CONFIGS: Record<string, { basePrice: number; digits: number; pipSize: number; spreadPips: number }> = {
  'EURUSD': { basePrice: 1.1250, digits: 5, pipSize: 0.0001, spreadPips: 1.2 },
  'GBPUSD': { basePrice: 1.2850, digits: 5, pipSize: 0.0001, spreadPips: 1.5 },
  'AUDUSD': { basePrice: 0.6750, digits: 5, pipSize: 0.0001, spreadPips: 1.4 },
  'USDJPY': { basePrice: 145.20, digits: 3, pipSize: 0.01, spreadPips: 1.3 },
};
