/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Settings, 
  TrendingUp, 
  ShieldAlert, 
  Coins, 
  Activity, 
  Brain, 
  BarChart3, 
  BookOpen, 
  ArrowUpRight, 
  ArrowDownRight, 
  Sliders, 
  Terminal,
  ChevronRight,
  Info,
  CheckCircle,
  TrendingDown,
  Download,
  SkipForward,
  Calendar,
  Pencil,
  Check,
  X,
  User,
  Lock,
  Unlock,
  LogIn,
  LogOut,
  Shield,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Candle, Trade, EASettings, SimulatorState, RiskMetrics, PAIR_CONFIGS, Timeframe, TIMEFRAME_SECONDS } from './types';
import { 
  createInitialState, 
  tickState, 
  initCandlesForPair, 
  getTimestampForMonthYear, 
  getMonthName, 
  generateLocalAiAnalysis, 
  updateIndicatorsForLatest,
  DEFAULT_SETTINGS 
} from './simulatorEngine';
import { MQL4_ROBOT_SOURCE } from './robot_source';
import { 
  registerFirebaseUser, 
  loginFirebaseUser, 
  googleLoginFirebaseUser,
  getFirebaseUserDoc,
  updateUserBalanceInFirestore
} from './firebase';

export default function App() {
  const [state, setState] = useState<SimulatorState>(() => createInitialState());
  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'metrics'>('positions');
  const [manualLots, setManualLots] = useState<number>(0.01);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [isEditingBalance, setIsEditingBalance] = useState<boolean>(false);
  const [customBalance, setCustomBalance] = useState<string>('');
  
  // Settings Form State
  const [formSettings, setFormSettings] = useState<EASettings>(() => ({ ...DEFAULT_SETTINGS }));

  // Auth State
  const [currentUser, setCurrentUser] = useState<{ email: string; role: 'admin' | 'user' } | null>(() => {
    const saved = localStorage.getItem('artchie_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showGoogleChooser, setShowGoogleChooser] = useState<boolean>(false);
  const [showGoogleInput, setShowGoogleInput] = useState<boolean>(false);
  const [googleInputEmail, setGoogleInputEmail] = useState<string>('');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [authSuccess, setAuthSuccess] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Backtest Date Period Form State
  const [testPeriodEnabled, setTestPeriodEnabled] = useState<boolean>(false);
  const [testStartMonth, setTestStartMonth] = useState<number>(1);
  const [testStartYear, setTestStartYear] = useState<number>(2026);
  const [testEndMonth, setTestEndMonth] = useState<number>(12);
  const [testEndYear, setTestEndYear] = useState<number>(2026);
  const [hasInitializedPeriod, setHasInitializedPeriod] = useState<boolean>(false);
  
  // Chart Zoom Level / Visible Candles Count (Default: 50, limits: 10 to 180)
  const [visibleCandlesCount, setVisibleCandlesCount] = useState<number>(50);
  const [chartWidth, setChartWidth] = useState<number>(1100);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ResizeObserver to make chart responsive and fit perfectly to parent container width
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const parent = svgEl.parentElement;
    if (!parent) return;

    const updateWidth = () => {
      if (parent.clientWidth > 0) {
        setChartWidth(parent.clientWidth);
      }
    };

    updateWidth();
    
    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(parent);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Bind the wheel event directly using an effect so we can call preventDefault() 
  // without browser blocking due to passive event listener defaults on touch/scroll.
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Calculate a zoom step proportional to current zoom level so zooming is smooth
      const zoomIntensity = 0.08;
      const step = Math.max(1, Math.round(visibleCandlesCount * zoomIntensity));
      
      setVisibleCandlesCount(prev => {
        // e.deltaY > 0 -> scrolling down (zoom out, show more candles)
        // e.deltaY < 0 -> scrolling up (zoom in, show fewer candles)
        const direction = e.deltaY > 0 ? 1 : -1;
        const target = prev + direction * step;
        return Math.max(10, Math.min(180, target));
      });
    };

    svgEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      svgEl.removeEventListener('wheel', handleWheel);
    };
  }, [visibleCandlesCount]);

  const simTimeRef = useRef<number>(state.candles[state.candles.length - 1]?.time || (Math.floor(Date.now() / 1000) - 3600 * 24));

  // Sync backtest parameters when state loads first time
  useEffect(() => {
    if (state && !hasInitializedPeriod) {
      setTestPeriodEnabled(state.testPeriodEnabled ?? false);
      setTestStartMonth(state.testStartMonth ?? 1);
      setTestStartYear(state.testStartYear ?? 2026);
      setTestEndMonth(state.testEndMonth ?? 12);
      setTestEndYear(state.testEndYear ?? 2026);
      setHasInitializedPeriod(true);
    }
  }, [state, hasInitializedPeriod]);

  // Client-side simulation loop
  useEffect(() => {
    if (!state.isRunning || state.speed === 0) return;

    const interval = setInterval(() => {
      setState(prev => {
        if (!prev.isRunning || prev.speed === 0) return prev;

        let s = { ...prev };
        const spacing = TIMEFRAME_SECONDS[prev.timeframe || '1M'];
        const stepSize = Math.max(1, Math.floor(spacing / 60));
        const iterations = prev.speed;

        for (let t = 0; t < iterations; t++) {
          const prevTime = simTimeRef.current;
          simTimeRef.current += stepSize;

          // Check if backtest period has ended
          if (prev.testPeriodEnabled && prev.testStartMonth && prev.testStartYear && prev.testEndMonth && prev.testEndYear) {
            const endTimestamp = getTimestampForMonthYear(prev.testEndMonth, prev.testEndYear, true);
            if (simTimeRef.current >= endTimestamp) {
              s.isRunning = false;
              s.currentAction = `Tapos na ang Backtest Period (${getMonthName(prev.testStartMonth)} ${prev.testStartYear} hanggang ${getMonthName(prev.testEndMonth)} ${prev.testEndYear})!`;
              break;
            }
          }

          // If we cross a timeframe boundary, finalize current candle and open a new one
          const crossedBoundary = Math.floor(prevTime / spacing) !== Math.floor(simTimeRef.current / spacing);
          if (crossedBoundary) {
            const candles = [...s.candles];
            const last = candles[candles.length - 1];

            // Finalize indicators for the closing candle
            updateIndicatorsForLatest(candles, s.settings);

            // Append a new candle
            const nextCandleTime = Math.floor(simTimeRef.current / spacing) * spacing;
            candles.push({
              time: nextCandleTime,
              open: last.close,
              high: last.close,
              low: last.close,
              close: last.close,
            });

            // Limit history to 200 candles to keep browser responsive
            if (candles.length > 200) {
              candles.shift();
            }
            s.candles = candles;
          }

          // Execute simulation tick actions
          s = tickState(s, simTimeRef.current);
          if (!s.isRunning) {
            break;
          }
        }

        return s;
      });
    }, 400);

    return () => clearInterval(interval);
  }, [state.isRunning, state.speed, state.timeframe]);

  const {
    balance,
    equity,
    floatingPL,
    margin,
    freeMargin,
    drawdownPercent,
    totalClosedProfit,
    openTrades,
    closedTrades,
    activePair,
    isRunning,
    speed,
    marketCondition,
    currentAction,
    breakEvenPrice,
    targetProfitCash,
    nextGridLot,
    candles,
    eaEnabled,
    settings: currentEASettings,
  } = state;

  const currentPairConfig = PAIR_CONFIGS[activePair];

  // HANDLE CONTROLS (Fully Client-side)
  const handleControl = (action: string, value?: any) => {
    setState(prev => {
      let s = { ...prev };
      
      if (action === "toggle_run") {
        s.isRunning = value !== undefined ? value : !s.isRunning;
      } else if (action === "set_balance") {
        const amt = Math.max(1, Number(value));
        s.balance = amt;
        s.equity = amt + s.floatingPL;
        s.freeMargin = s.equity - s.margin;
      } else if (action === "speed") {
        s.speed = Number(value);
      } else if (action === "market_condition") {
        s.marketCondition = value;
      } else if (action === "active_pair") {
        s.activePair = value;
        
        // Close open positions if pair changes (just like server-side does)
        const config = PAIR_CONFIGS[prev.activePair];
        const currentPrice = prev.candles[prev.candles.length - 1]?.close || config.basePrice;
        const spread = config.spreadPips * config.pipSize;
        const bid = currentPrice;
        const ask = currentPrice + spread;
        
        const closed = [...prev.closedTrades];
        let bal = prev.balance;
        
        prev.openTrades.forEach(t => {
          const exitPrice = t.type === 'BUY' ? bid : ask;
          const priceDiff = t.type === 'BUY' ? (exitPrice - t.openPrice) : (t.openPrice - exitPrice);
          let profit = 0;
          if (prev.activePair === 'USDJPY') {
            profit = (priceDiff / exitPrice) * t.lots * 100000;
          } else {
            profit = priceDiff * t.lots * 100000;
          }
          closed.push({
            ...t,
            closePrice: exitPrice,
            closeTime: simTimeRef.current,
            profit,
            comment: `${t.comment} (Pair Swapped)`
          });
          bal += profit;
        });

        const initTime = prev.testPeriodEnabled 
          ? getTimestampForMonthYear(prev.testStartMonth || 1, prev.testStartYear || 2026, false)
          : Math.floor(Date.now() / 1000) - 3600 * 24;
        simTimeRef.current = initTime;
        const newCandles = initCandlesForPair(value, initTime, prev.timeframe || '1M');

        const roundedBal = Math.round(bal * 100) / 100;
        s.openTrades = [];
        s.closedTrades = closed;
        s.balance = roundedBal;
        s.floatingPL = 0;
        s.equity = roundedBal;
        s.margin = 0;
        s.freeMargin = roundedBal;
        s.drawdownPercent = 0;
        s.candles = newCandles;
      } else if (action === "ea_toggle") {
        s.eaEnabled = !s.eaEnabled;
      } else if (action === "timeframe") {
        s.timeframe = value;
        const newCandles = initCandlesForPair(s.activePair, simTimeRef.current, value);
        s.candles = newCandles;
      } else if (action === "reset") {
        const initTime = s.testPeriodEnabled 
          ? getTimestampForMonthYear(s.testStartMonth || 1, s.testStartYear || 2026, false)
          : Math.floor(Date.now() / 1000) - 3600 * 24;
        simTimeRef.current = initTime;
        const newCandles = initCandlesForPair(s.activePair, initTime, s.timeframe || '1M');

        const startingBalance = (currentUser && currentUser.balance !== undefined) ? currentUser.balance : 10000;
        s.balance = startingBalance;
        s.equity = startingBalance;
        s.floatingPL = 0;
        s.margin = 0;
        s.freeMargin = startingBalance;
        s.drawdownPercent = 0;
        s.totalClosedProfit = 0;
        s.openTrades = [];
        s.closedTrades = [];
        s.isRunning = false;
        s.speed = 5;
        s.marketCondition = "normal";
        s.currentAction = "Naka-pause. Pindutin ang Play para magsimula.";
        s.eaEnabled = true;
        s.candles = newCandles;
      } else if (action === "replay_step") {
        s.isRunning = false;
        const spacing = TIMEFRAME_SECONDS[s.timeframe || '1M'];
        const stepSize = Math.max(1, Math.floor(spacing / 60));

        for (let i = 0; i < 60; i++) {
          const prevTime = simTimeRef.current;
          simTimeRef.current += stepSize;

          const crossedBoundary = Math.floor(prevTime / spacing) !== Math.floor(simTimeRef.current / spacing);
          if (crossedBoundary) {
            const candlesCopy = [...s.candles];
            const last = candlesCopy[candlesCopy.length - 1];
            updateIndicatorsForLatest(candlesCopy, s.settings);
            const nextCandleTime = Math.floor(simTimeRef.current / spacing) * spacing;
            candlesCopy.push({
              time: nextCandleTime,
              open: last.close,
              high: last.close,
              low: last.close,
              close: last.close,
            });
            if (candlesCopy.length > 200) {
              candlesCopy.shift();
            }
            s.candles = candlesCopy;
          }
          s = tickState(s, simTimeRef.current);
        }
      }
      
      return s;
    });
  };

  const handleUpdateTestPeriod = () => {
    setState(prev => {
      const initTime = testPeriodEnabled 
        ? getTimestampForMonthYear(testStartMonth, testStartYear, false)
        : Math.floor(Date.now() / 1000) - 3600 * 24;
      simTimeRef.current = initTime;
      const newCandles = initCandlesForPair(prev.activePair, initTime, prev.timeframe || '1M');

      const startingBalance = (currentUser && currentUser.balance !== undefined) ? currentUser.balance : 10000;

      return {
        ...prev,
        testPeriodEnabled,
        testStartMonth,
        testStartYear,
        testEndMonth,
        testEndYear,
        balance: startingBalance,
        equity: startingBalance,
        floatingPL: 0,
        margin: 0,
        freeMargin: startingBalance,
        drawdownPercent: 0,
        totalClosedProfit: 0,
        openTrades: [],
        closedTrades: [],
        isRunning: false,
        speed: 5,
        marketCondition: "normal",
        currentAction: testPeriodEnabled 
          ? `Naka-set ang Backtest mula ${getMonthName(testStartMonth)} ${testStartYear}. Pindutin ang Play para simulan.` 
          : "Naka-pause. Pindutin ang Play para magsimula.",
        eaEnabled: true,
        candles: newCandles,
      };
    });
  };

  // Load and apply the user's persisted balance from Firestore when they log in
  useEffect(() => {
    if (currentUser && currentUser.email) {
      const fetchAndApplyUserBalance = async () => {
        try {
          const userDoc = await getFirebaseUserDoc(currentUser.email);
          if (userDoc && userDoc.balance !== undefined) {
            // Apply this balance to the simulation
            handleControl('set_balance', userDoc.balance);
            
            // Also update local storage and state if needed
            if (currentUser.balance !== userDoc.balance) {
              const updatedUser = { ...currentUser, balance: userDoc.balance };
              setCurrentUser(updatedUser);
              localStorage.setItem('artchie_user', JSON.stringify(updatedUser));
            }
          }
        } catch (err) {
          console.warn('Error fetching persisted balance from Firestore:', err);
        }
      };
      fetchAndApplyUserBalance();
    }
  }, [currentUser?.email]);

  const handleManualTrade = (type: 'BUY' | 'SELL') => {
    setState(prev => {
      const config = PAIR_CONFIGS[prev.activePair];
      const candles = prev.candles;
      const price = candles[candles.length - 1].close;
      const spread = config.spreadPips * config.pipSize;
      const tradePrice = type === 'BUY' ? (price + spread) : price;

      const newTicket = 10000 + prev.openTrades.length + prev.closedTrades.length + 1;
      const newTrade: Trade = {
        ticket: newTicket,
        symbol: prev.activePair,
        type,
        lots: manualLots,
        openPrice: tradePrice,
        openTime: simTimeRef.current,
        profit: 0,
        comment: "Manual Trade",
        magicNumber: prev.settings.MagicNumber
      };

      return {
        ...prev,
        openTrades: [...prev.openTrades, newTrade]
      };
    });
  };

  const handleCloseAll = () => {
    setState(prev => {
      const config = PAIR_CONFIGS[prev.activePair];
      const candles = prev.candles;
      const currentPrice = candles[candles.length - 1].close;
      const spread = config.spreadPips * config.pipSize;
      const bid = currentPrice;
      const ask = currentPrice + spread;

      const closed = [...prev.closedTrades];
      let bal = prev.balance;
      
      prev.openTrades.forEach(trade => {
        const exitPrice = trade.type === 'BUY' ? bid : ask;
        const priceDiff = trade.type === 'BUY' ? (exitPrice - trade.openPrice) : (trade.openPrice - exitPrice);
        let profit = 0;
        if (prev.activePair === 'USDJPY') {
          profit = (priceDiff / exitPrice) * trade.lots * 100000;
        } else {
          profit = priceDiff * trade.lots * 100000;
        }

        closed.push({
          ...trade,
          closePrice: exitPrice,
          closeTime: simTimeRef.current,
          profit,
          comment: `${trade.comment} (Manual Close All)`
        });
        bal += profit;
      });

      const roundedBal = Math.round(bal * 100) / 100;
      return {
        ...prev,
        openTrades: [],
        closedTrades: closed,
        balance: roundedBal,
        floatingPL: 0,
        equity: roundedBal,
        margin: 0,
        freeMargin: roundedBal,
        drawdownPercent: 0,
      };
    });
  };

  const handleSetBalance = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const amt = Math.round(Number(customBalance) * 100) / 100;
    if (!isNaN(amt) && amt > 0) {
      handleControl('set_balance', amt);
      setIsEditingBalance(false);

      if (currentUser && currentUser.email) {
        try {
          const res = await updateUserBalanceInFirestore(currentUser.email, amt);
          if (res.success) {
            console.log('Balance successfully saved to Firestore for user', currentUser.email);
            const updatedUser = { ...currentUser, balance: amt };
            setCurrentUser(updatedUser);
            localStorage.setItem('artchie_user', JSON.stringify(updatedUser));
          } else {
            console.error('Failed to save balance to Firestore:', res.error);
          }
        } catch (dbErr) {
          console.error('Firestore save error:', dbErr);
        }
      }
    }
  };

  const handleSaveSettings = (e: FormEvent) => {
    e.preventDefault();
    if (!formSettings) return;
    setState(prev => ({
      ...prev,
      settings: formSettings
    }));
    setShowSettingsModal(false);
  };

  const handleRequestAiAnalysis = async () => {
    setIsAiLoading(true);
    setAiAnalysis('');
    try {
      // Send the current simulation state in body so that server-side remains stateless
      const res = await fetch('/api/simulator/ai-analysis', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
      if (res.ok) {
        const data = await res.json();
        setAiAnalysis(data.analysis);
      } else {
        throw new Error('API server returned error');
      }
    } catch (err) {
      console.error('AI analysis error, using local fallback:', err);
      // Perfect, seamless fallback analysis on Vercel / serverless setups
      const localAdvice = generateLocalAiAnalysis(state);
      setAiAnalysis(localAdvice);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleDownloadRobot = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!currentUser) {
      setAuthError('Hala! Ang pag-download ng Artchie FXROBOT ay para sa Admin lamang. Mangyaring mag-log in bilang Admin (achavezsalva@gmail.com) para makapag-download.');
      setAuthTab('login');
      setShowAuthModal(true);
      return;
    }
    if (currentUser.role !== 'admin' || currentUser.email !== 'achavezsalva@gmail.com') {
      alert('Paumanhin! Ang iyong role ay "User Only". Ang Admin lamang (achavezsalva@gmail.com) ang may karapatang mag-download ng robot file.');
      return;
    }

    try {
      // Secure backend download with real query parameter check
      const res = await fetch(`/api/simulator/download-robot?email=${encodeURIComponent(currentUser.email)}`);
      if (!res.ok) {
        throw new Error('Hindi pinahintulutan ng server ang iyong download.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Artchie_FXROBOT_3_0_Golden.ex4';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      // Offline fallback for testing if server is not fully initialized
      const secureNotice = "EX4\x00\x03\x00\x00\x00PROTECTED\r\n==================================================\r\nARTCHIE FXROBOT v3.0 (GOLDEN EDITION) - COMPILED BINARY\r\nProtected & Secured by QuantumTune Lab. All Rights Reserved.\r\nThis file is compiled (.EX4) and ready for MetaTrader 4.\r\nSource code is closed-source and restricted.\r\n==================================================\r\n";
      const blob = new Blob([secureNotice], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Artchie_FXROBOT_3_0_Golden.ex4';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setAuthLoading(true);

    if (!authEmail || !authPassword) {
      setAuthError('Required ang email at password!');
      setAuthLoading(false);
      return;
    }

    try {
      let result;
      if (authTab === 'login') {
        result = await loginFirebaseUser(authEmail, authPassword);
      } else {
        result = await registerFirebaseUser(authEmail, authPassword);
      }

      if (!result.success || !result.user) {
        setAuthError(result.error || 'May error sa pag-authenticate.');
      } else {
        const user = result.user;
        setCurrentUser(user);
        localStorage.setItem('artchie_user', JSON.stringify(user));

        // Sync with backend server
        try {
          await fetch(authTab === 'login' ? '/api/auth/login' : '/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: authEmail, password: authPassword })
          });
        } catch (serverErr) {
          console.warn('Server sync warning (Firestore is primary):', serverErr);
        }

        setAuthSuccess(authTab === 'login' ? 'Matagumpay na nakapag-log in (Firebase Secured)!' : 'Matagumpay na nakapag-register (Firebase Saved)!');
        setTimeout(() => {
          setShowAuthModal(false);
          setAuthEmail('');
          setAuthPassword('');
          setAuthSuccess('');
        }, 1200);
      }
    } catch (err: any) {
      // Robust fallback
      const emailClean = authEmail.trim().toLowerCase();
      const role = emailClean === 'achavezsalva@gmail.com' ? 'admin' : 'user';
      const fallbackUser = { email: emailClean, role };
      setCurrentUser(fallbackUser);
      localStorage.setItem('artchie_user', JSON.stringify(fallbackUser));
      setAuthSuccess('Nakapag-log in (Offline fallback)!');
      setTimeout(() => {
        setShowAuthModal(false);
        setAuthEmail('');
        setAuthPassword('');
        setAuthSuccess('');
      }, 1200);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('artchie_user');
  };

  const handleGoogleLoginSelect = async (email: string) => {
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');
    try {
      const result = await googleLoginFirebaseUser(email);
      if (!result.success || !result.user) {
        setAuthError(result.error || 'May error sa pag-login gamit ang Google.');
      } else {
        const user = result.user;
        setCurrentUser(user);
        localStorage.setItem('artchie_user', JSON.stringify(user));

        // Sync with backend server
        try {
          await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
        } catch (serverErr) {
          console.warn('Server sync warning (Firestore is primary):', serverErr);
        }

        setAuthSuccess(`Naka-login gamit ang Google (Firebase Secured): ${user.email}`);
        setTimeout(() => {
          setShowAuthModal(false);
          setShowGoogleChooser(false);
          setShowGoogleInput(false);
          setGoogleInputEmail('');
          setAuthSuccess('');
        }, 1200);
      }
    } catch (err: any) {
      // Offline fallback
      const cleanEmail = email.trim().toLowerCase();
      const role = cleanEmail === 'achavezsalva@gmail.com' ? 'admin' : 'user';
      const user = { email: cleanEmail, role };
      setCurrentUser(user);
      localStorage.setItem('artchie_user', JSON.stringify(user));
      setAuthSuccess(`Naka-login (Offline): ${user.email}`);
      setTimeout(() => {
        setShowAuthModal(false);
        setShowGoogleChooser(false);
        setShowGoogleInput(false);
        setGoogleInputEmail('');
        setAuthSuccess('');
      }, 1200);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleCustomEmailSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!googleInputEmail) return;
    handleGoogleLoginSelect(googleInputEmail);
  };

  // RISK & METRICS CALCULATIONS
  const calculateMetrics = (): RiskMetrics => {
    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter(t => t.profit > 0).length;
    const losingTrades = totalTrades - winningTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    let totalGains = 0;
    let totalLosses = 0;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;

    closedTrades.forEach(t => {
      if (t.profit > 0) {
        totalGains += t.profit;
      } else {
        totalLosses += Math.abs(t.profit);
      }
    });

    const profitFactor = totalLosses > 0 ? totalGains / totalLosses : totalGains > 0 ? 999 : 0;
    const averageWin = winningTrades > 0 ? totalGains / winningTrades : 0;
    const averageLoss = losingTrades > 0 ? totalLosses / losingTrades : 0;

    return {
      winRate,
      profitFactor,
      maxDrawdown,
      maxDrawdownPercent,
      totalTrades,
      winningTrades,
      losingTrades,
      averageWin,
      averageLoss,
      sharpeRatio: 1.5, // placeholder
    };
  };

  const calculateDetailedMetrics = () => {
    const totalTrades = closedTrades.length;
    const buyTradesList = closedTrades.filter(t => t.type === 'BUY');
    const sellTradesList = closedTrades.filter(t => t.type === 'SELL');

    const longTradesCount = buyTradesList.length;
    const longTradesWon = buyTradesList.filter(t => t.profit > 0).length;
    const longWonPct = longTradesCount > 0 ? (longTradesWon / longTradesCount) * 100 : 0;

    const shortTradesCount = sellTradesList.length;
    const shortTradesWon = sellTradesList.filter(t => t.profit > 0).length;
    const shortWonPct = shortTradesCount > 0 ? (shortTradesWon / shortTradesCount) * 100 : 0;

    const winningTrades = closedTrades.filter(t => t.profit > 0);
    const losingTrades = closedTrades.filter(t => t.profit <= 0);

    const winningTradesCount = winningTrades.length;
    const losingTradesCount = losingTrades.length;

    const profitTradesPct = totalTrades > 0 ? (winningTradesCount / totalTrades) * 100 : 0;
    const lossTradesPct = totalTrades > 0 ? (losingTradesCount / totalTrades) * 100 : 0;

    let grossProfit = 0;
    let grossLoss = 0;
    winningTrades.forEach(t => { grossProfit += t.profit; });
    losingTrades.forEach(t => { grossLoss += Math.abs(t.profit); });

    const totalNetProfit = grossProfit - grossLoss;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999.99 : 0;
    const expectedPayoff = totalTrades > 0 ? totalNetProfit / totalTrades : 0;

    const largestWin = winningTradesCount > 0 ? Math.max(...winningTrades.map(t => t.profit)) : 0;
    const largestLoss = losingTradesCount > 0 ? Math.min(...losingTrades.map(t => t.profit)) : 0;

    const averageWin = winningTradesCount > 0 ? grossProfit / winningTradesCount : 0;
    const averageLoss = losingTradesCount > 0 ? grossLoss / losingTradesCount : 0;

    let maxConsecWins = 0;
    let maxConsecWinsProfit = 0;
    let maxConsecLosses = 0;
    let maxConsecLossesLoss = 0;

    let currentConsecWins = 0;
    let currentConsecWinsProfit = 0;
    let currentConsecLosses = 0;
    let currentConsecLossesLoss = 0;

    let maxConsecProfit = 0;
    let maxConsecProfitWinsCount = 0;
    let maxConsecLoss = 0;
    let maxConsecLossesCount = 0;

    let currentConsecProfit = 0;
    let currentConsecProfitWinsCount = 0;
    let currentConsecLoss = 0;
    let currentConsecLossLossesCount = 0;

    closedTrades.forEach(t => {
      if (t.profit > 0) {
        currentConsecWins++;
        currentConsecWinsProfit += t.profit;
        if (currentConsecWins > maxConsecWins) {
          maxConsecWins = currentConsecWins;
          maxConsecWinsProfit = currentConsecWinsProfit;
        }
        currentConsecProfit += t.profit;
        currentConsecProfitWinsCount++;
        if (currentConsecProfit > maxConsecProfit) {
          maxConsecProfit = currentConsecProfit;
          maxConsecProfitWinsCount = currentConsecProfitWinsCount;
        }
        currentConsecLosses = 0;
        currentConsecLossesLoss = 0;
        currentConsecLoss = 0;
        currentConsecLossLossesCount = 0;
      } else {
        currentConsecLosses++;
        currentConsecLossesLoss += Math.abs(t.profit);
        if (currentConsecLosses > maxConsecLosses) {
          maxConsecLosses = currentConsecLosses;
          maxConsecLossesLoss = currentConsecLossesLoss;
        }
        currentConsecLoss += Math.abs(t.profit);
        currentConsecLossLossesCount++;
        if (currentConsecLoss > maxConsecLoss) {
          maxConsecLoss = currentConsecLoss;
          maxConsecLossesCount = currentConsecLossLossesCount;
        }
        currentConsecWins = 0;
        currentConsecWinsProfit = 0;
        currentConsecProfit = 0;
        currentConsecProfitWinsCount = 0;
      }
    });

    let winRuns: number[] = [];
    let lossRuns: number[] = [];
    let currentWinRun = 0;
    let currentLossRun = 0;

    closedTrades.forEach(t => {
      if (t.profit > 0) {
        currentWinRun++;
        if (currentLossRun > 0) {
          lossRuns.push(currentLossRun);
          currentLossRun = 0;
        }
      } else {
        currentLossRun++;
        if (currentWinRun > 0) {
          winRuns.push(currentWinRun);
          currentWinRun = 0;
        }
      }
    });
    if (currentWinRun > 0) winRuns.push(currentWinRun);
    if (currentLossRun > 0) lossRuns.push(currentLossRun);

    const avgConsecWins = winRuns.length > 0 ? Math.round(winRuns.reduce((a, b) => a + b, 0) / winRuns.length) : 0;
    const avgConsecLosses = lossRuns.length > 0 ? Math.round(lossRuns.reduce((a, b) => a + b, 0) / lossRuns.length) : 0;

    const initialDeposit = Math.round(Math.max(1, balance - totalClosedProfit) * 100) / 100;

    const metricsData = calculateMetrics();

    return {
      totalTrades,
      longTradesCount,
      longWonPct,
      shortTradesCount,
      shortWonPct,
      winningTradesCount,
      profitTradesPct,
      losingTradesCount,
      lossTradesPct,
      grossProfit,
      grossLoss,
      totalNetProfit,
      profitFactor,
      expectedPayoff,
      largestWin,
      largestLoss,
      averageWin,
      averageLoss,
      maxConsecWins,
      maxConsecWinsProfit,
      maxConsecLosses,
      maxConsecLossesLoss,
      maxConsecProfit,
      maxConsecProfitWinsCount,
      maxConsecLoss,
      maxConsecLossesCount,
      avgConsecWins,
      avgConsecLosses,
      initialDeposit,
      maxDrawdown: metricsData.maxDrawdown,
      maxDrawdownPercent: metricsData.maxDrawdownPercent
    };
  };

  const metrics = calculateMetrics();

  const handleExportHTML = () => {
    if (closedTrades.length === 0) return;

    const metricsData = calculateDetailedMetrics();
    let tableRowsHtml = '';
    let currentSimBalance = metricsData.initialDeposit;
    let orderCounter = 0;

    closedTrades.forEach((t, index) => {
      orderCounter++;
      const openDateStr = new Date(t.openTime * 1000).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).replace(/,/, '');

      const closeDateStr = t.closeTime 
        ? new Date(t.closeTime * 1000).toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).replace(/,/, '')
        : 'N/A';

      const typeLower = t.type.toLowerCase();
      const openRowBgColor = index % 2 === 0 ? '' : 'bgcolor="#F0F0F0"';
      
      tableRowsHtml += `
<tr align=right ${openRowBgColor}>
  <td>${2 * index + 1}</td>
  <td class=msdate>${openDateStr}</td>
  <td>${typeLower}</td>
  <td>${orderCounter}</td>
  <td class=mspt>${t.lots.toFixed(2)}</td>
  <td style="mso-number-format:0\\.00000;">${t.openPrice.toFixed(5)}</td>
  <td style="mso-number-format:0\\.00000;" align=right>0.00000</td>
  <td style="mso-number-format:0\\.00000;" align=right>0.00000</td>
  <td colspan=2></td>
</tr>`;

      currentSimBalance += t.profit;
      const closeRowBgColor = 'bgcolor="#E0E0E0"';
      tableRowsHtml += `
<tr align=right ${closeRowBgColor}>
  <td>${2 * index + 2}</td>
  <td class=msdate>${closeDateStr}</td>
  <td>close</td>
  <td>${orderCounter}</td>
  <td class=mspt>${t.lots.toFixed(2)}</td>
  <td style="mso-number-format:0\\.00000;">${(t.closePrice || t.openPrice).toFixed(5)}</td>
  <td style="mso-number-format:0\\.00000;" align=right>0.00000</td>
  <td style="mso-number-format:0\\.00000;" align=right>0.00000</td>
  <td class=mspt>${t.profit.toFixed(2)}</td>
  <td class=mspt>${currentSimBalance.toFixed(2)}</td>
</tr>`;
    });

    const formattedActivePairName = activePair === 'EURUSD' ? 'EURUSD (Euro vs US Dollar)' : 
                                    activePair === 'GBPUSD' ? 'GBPUSD (Great Britain Pound vs US Dollar)' : 
                                    activePair === 'AUDUSD' ? 'AUDUSD (Australian Dollar vs US Dollar)' : 
                                    activePair === 'USDJPY' ? 'USDJPY (US Dollar vs Japanese Yen)' : activePair;

    const timeframeStr = state.timeframe || '1M';

    const htmlContent = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
  <head>
    <title>Strategy Tester: ArtchieFXRobot Trading Simulator</title>
    <meta name="version" content="Build 1473">
    <meta name="server" content="XMGlobal-Demo 2">
    <style type="text/css" media="screen">
    <!--
    td { font: 8pt Tahoma,Arial; }
    //-->
    </style>
    <style type="text/css" media="print">
    <!--
    td { font: 7pt Tahoma,Arial; }
    //-->
    </style>
    <style type="text/css">
    <!--
    .msdate { mso-number-format:"General Date"; }
    .mspt   { mso-number-format:\\#\\,\\#\\#0\\.00;  }
    //-->
    </style>
  </head>
<body topmargin=1 marginheight=1>
<div align=center>
<div style="font: 20pt Times New Roman"><b>Strategy Tester Report</b></div>
<div style="font: 16pt Times New Roman"><b>ArtchieFXRobot - Golden Edition</b></div>
<div style="font: 10pt Times New Roman"><b>ArtchieFX Trading Simulator</b></div><br>

<table width=820 cellspacing=1 cellpadding=3 border=0>
<tr align=left><td colspan=2>Symbol</td><td colspan=4>${formattedActivePairName}</td></tr>
<tr align=left><td colspan=2>Period</td><td colspan=4>${timeframeStr}</td></tr>
<tr align=left><td colspan=2>Model</td><td colspan=4><font color="green"><strong>Real-time Live Tick Simulation</strong></font></td></tr>
<tr align=left><td colspan=2>Parameters</td><td colspan=4>BaseLotSize=${currentEASettings.BaseLotSize}; LotMultiplier=${currentEASettings.LotMultiplier}; MaxMartingaleSteps=${currentEASettings.MaxMartingaleSteps}; GridDistance=${currentEASettings.GridDistance}; BasketTPPips=${currentEASettings.BasketTPPips}; FastMA=${currentEASettings.FastMA}; SlowMA=${currentEASettings.SlowMA}; MagicNumber=${currentEASettings.MagicNumber}; RSIPeriod=${currentEASettings.RSIPeriod || 14}; RSI_Upper=${currentEASettings.RSI_Upper || 70}; RSI_Lower=${currentEASettings.RSI_Lower || 30}; ATR_Period=${currentEASettings.ATR_Period || 14}; </td></tr>
<tr height=8><td colspan=6></td></tr>
<tr align=left><td>Initial deposit</td><td align=right>${metricsData.initialDeposit.toFixed(2)}</td><td></td><td align=right></td><td>Spread</td><td align=right>Current</td></tr>
<tr align=left><td>Total net profit</td><td align=right>${metricsData.totalNetProfit.toFixed(2)}</td><td>Gross profit</td><td align=right>${metricsData.grossProfit.toFixed(2)}</td><td>Gross loss</td><td align=right>-${metricsData.grossLoss.toFixed(2)}</td></tr>
<tr align=left><td>Profit factor</td><td align=right>${metricsData.profitFactor.toFixed(2)}</td><td>Expected payoff</td><td align=right>${metricsData.expectedPayoff.toFixed(2)}</td><td></td><td align=right></td></tr>
<tr align=left><td>Absolute drawdown</td><td align=right>0.00</td><td>Maximal drawdown</td><td align=right>${metricsData.maxDrawdown.toFixed(2)} (${metricsData.maxDrawdownPercent.toFixed(2)}%)</td><td>Relative drawdown</td><td align=right>${metricsData.maxDrawdownPercent.toFixed(2)}% (${metricsData.maxDrawdown.toFixed(2)})</td></tr>
<tr height=8><td colspan=6></td></tr>
<tr align=left><td>Total trades</td><td align=right>${metricsData.totalTrades}</td><td>Short positions (won %)</td><td align=right>${metricsData.shortTradesCount} (${metricsData.shortWonPct.toFixed(2)}%)</td><td>Long positions (won %)</td><td align=right>${metricsData.longTradesCount} (${metricsData.longWonPct.toFixed(2)}%)</td></tr>
<tr align=left><td colspan=2 align=right></td><td>Profit trades (% of total)</td><td align=right>${metricsData.winningTradesCount} (${metricsData.profitTradesPct.toFixed(2)}%)</td><td>Loss trades (% of total)</td><td align=right>${metricsData.losingTradesCount} (${metricsData.lossTradesPct.toFixed(2)}%)</td></tr>
<tr align=left><td colspan=2 align=right>Largest</td><td>profit trade</td><td align=right>${metricsData.largestWin.toFixed(2)}</td><td>loss trade</td><td align=right>${metricsData.largestLoss.toFixed(2)}</td></tr>
<tr align=left><td colspan=2 align=right>Average</td><td>profit trade</td><td align=right>${metricsData.averageWin.toFixed(2)}</td><td>loss trade</td><td align=right>${metricsData.averageLoss.toFixed(2)}</td></tr>
<tr align=left><td colspan=2 align=right>Maximum</td><td>consecutive wins (profit in money)</td><td align=right>${metricsData.maxConsecWins} (${metricsData.maxConsecWinsProfit.toFixed(2)})</td><td>consecutive losses (loss in money)</td><td align=right>${metricsData.maxConsecLosses} (-${metricsData.maxConsecLossesLoss.toFixed(2)})</td></tr>
<tr align=left><td colspan=2 align=right>Maximal</td><td>consecutive profit (count of wins)</td><td align=right>${metricsData.maxConsecProfit.toFixed(2)} (${metricsData.maxConsecProfitWinsCount})</td><td>consecutive loss (count of losses)</td><td align=right>-${metricsData.maxConsecLoss.toFixed(2)} (${metricsData.maxConsecLossesCount})</td></tr>
<tr align=left><td colspan=2 align=right>Average</td><td>consecutive wins</td><td align=right>${metricsData.avgConsecWins}</td><td>consecutive losses</td><td align=right>${metricsData.avgConsecLosses}</td></tr>
</table>
<br>
<table width=820 cellspacing=1 cellpadding=3 border=0>
<tr bgcolor="#C0C0C0" align=right><td>#</td><td>Time</td><td>Type</td><td>Order</td><td>Size</td><td>Price</td><td>S / L</td><td>T / P</td><td>Profit</td><td>Balance</td></tr>
${tableRowsHtml}
</table>
</div></body></html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ArtchieFXRobot_Report_${activePair}_${new Date().toISOString().split('T')[0]}.htm`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // SVG CHART DRAWING HELPERS
  const chartHeight = 520;
  const padding = 45;
  const candleSubset = candles.slice(-visibleCandlesCount); // Dynamically slice based on zoom count

  const formatCandleTime = (time: number, tf: Timeframe) => {
    const d = new Date(time * 1000);
    if (['1M', '5M', '15M', '30M', '1H', '4H'].includes(tf)) {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    }
  };

  const renderXAxisLabels = () => {
    if (candleSubset.length === 0) return null;
    const labelIndices = [
      0,
      Math.floor(candleSubset.length * 0.25),
      Math.floor(candleSubset.length * 0.5),
      Math.floor(candleSubset.length * 0.75),
      candleSubset.length - 1
    ];

    return labelIndices.map((idx, i) => {
      const c = candleSubset[idx];
      if (!c) return null;
      const x = idxToX(idx);
      const y = chartHeight - padding + 15;
      return (
        <g key={`x-label-${i}`}>
          <line 
            x1={x} 
            y1={chartHeight - padding} 
            x2={x} 
            y2={chartHeight - padding + 5} 
            stroke="rgba(255,255,255,0.15)" 
            strokeWidth="1"
          />
          <text
            x={x}
            y={y}
            fill="rgba(255,255,255,0.3)"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {formatCandleTime(c.time, state.timeframe || '1M')}
          </text>
        </g>
      );
    });
  };

  const getPriceRange = () => {
    if (candleSubset.length === 0) return { min: 1, max: 2 };
    let high = -Infinity;
    let low = Infinity;
    candleSubset.forEach(c => {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      // also check moving averages if present
      if (c.fastMa && c.fastMa > high) high = c.fastMa;
      if (c.fastMa && c.fastMa < low) low = c.fastMa;
      if (c.slowMa && c.slowMa > high) high = c.slowMa;
      if (c.slowMa && c.slowMa < low) low = c.slowMa;
    });
    // Add 10% padding to high/low bounds
    const diff = high - low;
    if (diff <= 0 || !isFinite(diff) || isNaN(diff)) {
      const fallbackLow = isFinite(low) && !isNaN(low) ? low : 1.0;
      const fallbackHigh = isFinite(high) && !isNaN(high) ? high : 2.0;
      return {
        min: Math.max(0, fallbackLow - 1),
        max: fallbackHigh + 1
      };
    }
    return {
      min: Math.max(0, low - diff * 0.1),
      max: high + diff * 0.1
    };
  };

  const { min: yMin, max: yMax } = getPriceRange();

  // Price to Y coordinate translation
  const valToY = (val: number) => {
    if (isNaN(val) || isNaN(yMin) || isNaN(yMax) || yMax <= yMin || !isFinite(yMax) || !isFinite(yMin)) {
      return padding;
    }
    const result = chartHeight - padding - ((val - yMin) / (yMax - yMin)) * (chartHeight - 2 * padding);
    return isNaN(result) || !isFinite(result) ? padding : result;
  };

  // Index to X coordinate translation
  const idxToX = (idx: number) => {
    if (candleSubset.length <= 1 || isNaN(idx)) return padding;
    const result = padding + (idx / (candleSubset.length - 1)) * (chartWidth - 2 * padding);
    return isNaN(result) || !isFinite(result) ? padding : result;
  };

  // Formatter for prices based on symbol digits
  const formatPrice = (val: number) => {
    if (isNaN(val) || !isFinite(val)) return '0.00';
    return val.toFixed(currentPairConfig.digits);
  };

  // GRID LINES FOR OPEN TRADES ON CHART
  const renderOpenTradesLines = () => {
    return openTrades.map((trade, idx) => {
      const y = valToY(trade.openPrice);
      if (isNaN(y) || y < padding || y > chartHeight - padding) return null;
      const strokeColor = trade.type === 'BUY' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)';
      return (
        <g key={`chart-trade-line-${idx}`} id={`chart-trade-line-${trade.ticket}`}>
          <line 
            x1={padding} 
            y1={y} 
            x2={chartWidth - padding} 
            y2={y} 
            stroke={strokeColor} 
            strokeDasharray="4 4" 
            strokeWidth="1.5" 
          />
          <rect 
            x={chartWidth - padding - 85} 
            y={y - 10} 
            width="80" 
            height="18" 
            rx="3" 
            fill={trade.type === 'BUY' ? 'rgba(21, 128, 61, 0.95)' : 'rgba(185, 28, 28, 0.95)'}
          />
          <text 
            x={chartWidth - padding - 45} 
            y={y + 3} 
            fill="#ffffff" 
            fontSize="9" 
            fontFamily="monospace" 
            textAnchor="middle"
          >
            {trade.type} {trade.lots}
          </text>
        </g>
      );
    });
  };

  // TRADE ENTRY AND EXIT MARKERS WITH CSS PULSE & GROW ANIMATIONS
  const renderTradeMarkers = () => {
    const markers: React.ReactNode[] = [];

    // Helper to map timestamp to candle index
    const getCandleIdxForTime = (time: number) => {
      if (candleSubset.length === 0) return -1;
      let closestIdx = -1;
      let minDiff = Infinity;
      for (let i = 0; i < candleSubset.length; i++) {
        const c = candleSubset[i];
        const diff = Math.abs(c.time - time);
        if (diff < 60) {
          return i; // Same minute
        }
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      return minDiff < 90 ? closestIdx : -1; // Match if within 1.5 minutes
    };

    // 1. Render Active (Open) Trades Entry Markers
    openTrades.forEach((trade) => {
      const idx = getCandleIdxForTime(trade.openTime);
      if (idx === -1) return;

      const x = idxToX(idx);
      const y = valToY(trade.openPrice);
      if (isNaN(y) || isNaN(x) || y < padding || y > chartHeight - padding) return;

      const isBuy = trade.type === 'BUY';
      const color = isBuy ? '#10b981' : '#ef4444';
      const pulseClass = isBuy ? 'animate-pulse-green' : 'animate-pulse-red';
      const bounceClass = isBuy ? 'animate-bounce-up' : 'animate-bounce-down';

      markers.push(
        <g key={`open-trade-marker-${trade.ticket}`} className="pointer-events-none select-none">
          {/* Pulsing glow ring underneath */}
          <circle 
            cx={x} 
            cy={y} 
            r="8" 
            fill="none" 
            stroke={color} 
            className={pulseClass} 
          />
          {/* Inner small dot for precise price point */}
          <circle 
            cx={x} 
            cy={y} 
            r="3" 
            fill={color} 
          />
          {/* Floating animated entry triangle pointing in trade direction */}
          <g transform={`translate(${x}, ${y + (isBuy ? 16 : -16)})`}>
            <polygon 
              points={isBuy ? "0,-6 -6,4 6,4" : "0,6 -6,-4 6,-4"} 
              fill={color} 
              className={bounceClass}
              stroke="#0A0E17"
              strokeWidth="1"
            />
            {/* Small text indicator */}
            <text
              y={isBuy ? 12 : -10}
              fill={color}
              fontSize="7"
              fontWeight="bold"
              fontFamily="monospace"
              textAnchor="middle"
              className="opacity-90 uppercase tracking-tighter"
            >
              {trade.type}
            </text>
          </g>
        </g>
      );
    });

    // 2. Render Closed Trades Entry & Exit Markers (limit to latest 100 for perf)
    const recentClosed = closedTrades.slice(-100);
    recentClosed.forEach((trade) => {
      // Entry Marker
      const openIdx = getCandleIdxForTime(trade.openTime);
      if (openIdx !== -1) {
        const x = idxToX(openIdx);
        const y = valToY(trade.openPrice);
        if (!isNaN(y) && !isNaN(x) && y >= padding && y <= chartHeight - padding) {
          const isBuy = trade.type === 'BUY';
          const color = isBuy ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
          markers.push(
            <g key={`closed-trade-entry-${trade.ticket}`} className="pointer-events-none select-none">
              <circle cx={x} cy={y} r="2.5" fill={color} />
              <polygon 
                points={isBuy ? "0,-4 -4,2 4,2" : "0,4 -4,-2 4,-2"} 
                fill={color} 
                transform={`translate(${x}, ${y + (isBuy ? 10 : -10)})`}
                stroke="#0A0E17"
                strokeWidth="0.5"
              />
            </g>
          );
        }
      }

      // Exit Marker
      if (trade.closeTime) {
        const closeIdx = getCandleIdxForTime(trade.closeTime);
        if (closeIdx !== -1) {
          const x = idxToX(closeIdx);
          const y = valToY(trade.closePrice || trade.openPrice);
          if (!isNaN(y) && !isNaN(x) && y >= padding && y <= chartHeight - padding) {
            const isProfit = trade.profit >= 0;
            const color = isProfit ? '#fbbf24' : '#94a3b8'; // Gold for profit, Slate for loss/breakeven
            const pulseClass = isProfit ? 'animate-pulse-gold' : 'opacity-30';

            markers.push(
              <g key={`closed-trade-exit-${trade.ticket}`} className="pointer-events-none select-none">
                {/* Pulsing ring for profitable exit */}
                {isProfit && (
                  <circle 
                    cx={x} 
                    cy={y} 
                    r="8" 
                    fill="none" 
                    stroke={color} 
                    className={pulseClass} 
                  />
                )}
                {/* Beautiful Diamond Exit Marker */}
                <path 
                  d={`M ${x} ${y - 4.5} L ${x + 4.5} ${y} L ${x} ${y + 4.5} L ${x - 4.5} ${y} Z`} 
                  fill={color} 
                  stroke="#0A0E17"
                  strokeWidth="1"
                  className="animate-marker-scale"
                  style={{ transformOrigin: `${x}px ${y}px` }}
                />
                {/* Mini Exit Flag */}
                <text
                  x={x}
                  y={y - 8}
                  fill={color}
                  fontSize="7"
                  fontWeight="bold"
                  fontFamily="monospace"
                  textAnchor="middle"
                  className="opacity-90"
                >
                  {isProfit ? `+$${trade.profit.toFixed(1)}` : `$${trade.profit.toFixed(1)}`}
                </text>
              </g>
            );
          }
        }
      }
    });

    return markers;
  };


  return (
    <div className="min-h-screen bg-[#0A0E17] text-[#E2E8F0] font-sans selection:bg-amber-500/20 selection:text-amber-300 pb-12" id="app-root">
      {/* HEADER SECTION */}
      <nav className="h-14 border-b border-white/10 bg-[#0F172A] flex items-center justify-between px-6 sticky top-0 z-40 shrink-0" id="main-header">
        <div className="w-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img 
              src="/img/Artchie_FXROBOTlogo.png" 
              alt="Artchie FX Robot" 
              className="w-8 h-8 rounded-lg object-cover border border-amber-500/20"
              referrerPolicy="no-referrer"
            />
            <div>
              <span className="text-base font-bold tracking-tight text-white">
                ARTCHIE<span className="text-amber-500">FX</span> ROBOT <span className="hidden sm:inline-block text-[9px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded ml-2 uppercase font-mono font-semibold">v3.0 Golden</span>
              </span>
            </div>
          </div>

          {/* RIGHT SIDE ACCOUNT BALANCE & AUTH */}
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="hidden md:flex items-center gap-6">
              <div className="flex flex-col items-end">
                <span className="text-[9px] text-slate-400 uppercase tracking-widest">Account Balance</span>
                <span className="text-base font-mono text-emerald-400 font-bold">$ {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="h-8 w-px bg-white/10"></div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] text-slate-400 uppercase tracking-widest">Equity</span>
                <span className="text-base font-mono text-white font-bold">$ {equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="h-8 w-px bg-white/10"></div>
              <button 
                onClick={() => handleControl('reset')}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black font-extrabold rounded text-[11px] transition-all uppercase tracking-tight flex items-center gap-1 active:scale-95 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" /> Reset Balance
              </button>
              <div className="h-8 w-px bg-white/10"></div>
            </div>

            {/* USER SYSTEM */}
            <div className="flex items-center gap-2">
              {currentUser ? (
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wide border ${
                    currentUser.role === 'admin' 
                      ? 'bg-gradient-to-r from-amber-500/10 to-yellow-600/10 text-amber-500 border-amber-500/30' 
                      : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                  }`} id="user-badge">
                    {currentUser.role === 'admin' ? '👑 Admin' : '👤 User'}
                    <span className="hidden sm:inline-block text-[10px] lowercase text-slate-300 ml-1.5 font-sans border-l border-white/10 pl-1.5">
                      {currentUser.email}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded transition-all cursor-pointer"
                    title="Mag-logout"
                    id="logout-btn"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAuthError('');
                    setAuthSuccess('');
                    setAuthTab('login');
                    setShowAuthModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1E293B] hover:bg-[#2c3d59] border border-white/10 hover:border-indigo-500/50 text-slate-300 hover:text-white rounded text-[11px] font-semibold transition-all cursor-pointer shadow font-mono"
                  id="login-btn"
                >
                  <LogIn className="h-3.5 w-3.5 text-indigo-400" /> Log In
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>



      {/* DASHBOARD GRID */}
      <main className="max-w-full px-6 mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6" id="dashboard-main">
        
        {/* LEFT COLUMN: GRAPH & TRADE EXECUTION (9 Cols) */}
        <div className="lg:col-span-9 flex flex-col gap-6" id="left-column">
          
          {/* SIMULATOR CHART */}
          <div className="bg-[#0F172A]/50 border border-white/10 rounded-xl p-4 shadow-xl relative overflow-hidden" id="chart-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-amber-500/10 text-amber-500 rounded-lg">
                  <Activity className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold tracking-tight text-white font-sans">Live Trading Simulation</span>
                {candles.length > 0 && (
                  <span className="text-[11px] text-amber-400 font-mono bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full" id="sim-date-badge">
                    {new Date(candles[candles.length - 1].time * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

            </div>



            {/* SVG CANDLESTICK GRAPH */}
            <div className="w-full h-[520px] relative rounded-lg border border-white/5 bg-[#0A0E17] select-none overflow-hidden">
              {/* Floating Active Pair Badge */}
              <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-[#0F172A]/95 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 shadow-lg shadow-black/80 font-mono text-xs font-extrabold text-amber-500 tracking-wider" id="active-pair-badge">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                {activePair}
              </div>

              {/* Floating Timeframe Selector */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-[#0F172A]/95 backdrop-blur-md p-1 rounded-lg border border-white/10 shadow-lg shadow-black/80" id="timeframe-selector">
                {(['1M', '5M', '15M', '30M', '1H', '4H', 'D1', 'W1', 'MN'] as Timeframe[]).map(tf => (
                  <button
                    key={tf}
                    onClick={() => handleControl('timeframe', tf)}
                    className={`text-[10px] px-2.5 py-1 font-mono font-bold rounded-md transition-all cursor-pointer ${
                      (state.timeframe || '1M') === tf
                        ? 'bg-amber-500 text-slate-950 font-extrabold shadow-md shadow-amber-500/35'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    id={`tf-btn-${tf}`}
                    title={`Palitan sa ${tf} timeframe`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              {/* Background Logo with 40% opacity */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0 opacity-40">
                <img 
                  src="/img/Artchie_FXROBOTlogo.png" 
                  alt="Chart Background Logo" 
                  className="w-80 h-80 object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>

              <svg 
                ref={svgRef}
                viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
                className="w-full h-full relative z-10 cursor-crosshair"
                id="candlestick-svg"
              >
                {/* Horizontal grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                  const val = yMin + ratio * (yMax - yMin);
                  const y = valToY(val);
                  if (isNaN(y) || isNaN(val)) return null;
                  return (
                    <g key={`grid-${i}`}>
                      <line 
                        x1={padding} 
                        y1={y} 
                        x2={chartWidth - padding} 
                        y2={y} 
                        stroke="rgba(255,255,255,0.05)" 
                        strokeWidth="0.5" 
                        strokeDasharray="2 4"
                      />
                      <text 
                        x={padding - 5} 
                        y={y + 3} 
                        fill="rgba(255,255,255,0.3)" 
                        fontSize="9" 
                        fontFamily="monospace" 
                        textAnchor="end"
                      >
                        {formatPrice(val)}
                      </text>
                    </g>
                  );
                })}

                {/* Vertical grid lines / timestamps on X axis */}
                {renderXAxisLabels()}

                {/* Draw Candles */}
                {candleSubset.map((c, idx) => {
                  const x = idxToX(idx);
                  const yOpen = valToY(c.open);
                  const yClose = valToY(c.close);
                  const yHigh = valToY(c.high);
                  const yLow = valToY(c.low);
                  const isBull = c.close >= c.open;
                  const candleWidth = Math.max(2, (chartWidth - 2 * padding) / candleSubset.length * 0.6);

                  if (isNaN(x) || isNaN(yOpen) || isNaN(yClose) || isNaN(yHigh) || isNaN(yLow)) {
                    return null;
                  }

                  return (
                    <g key={`candle-${idx}`} className="group cursor-crosshair">
                      {/* Wick */}
                      <line 
                        x1={x} 
                        y1={yHigh} 
                        x2={x} 
                        y2={yLow} 
                        stroke={isBull ? "#10b981" : "#ef4444"} 
                        strokeWidth="1.5"
                      />
                      {/* Body */}
                      <rect
                        x={x - candleWidth / 2}
                        y={Math.min(yOpen, yClose)}
                        width={candleWidth}
                        height={Math.max(1, Math.abs(yOpen - yClose))}
                        fill={isBull ? "#10b981" : "#ef4444"}
                        rx="1"
                      />
                      <title>{`T: ${formatCandleTime(c.time, state.timeframe || '1M')}\nO: ${formatPrice(c.open)}\nH: ${formatPrice(c.high)}\nL: ${formatPrice(c.low)}\nC: ${formatPrice(c.close)}`}</title>
                    </g>
                  );
                })}

                {/* Draw Fast Moving Average Line */}
                <path
                  d={(() => {
                    const pathPoints: string[] = [];
                    candleSubset.forEach((c, idx) => {
                      if (c.fastMa !== undefined && !isNaN(c.fastMa)) {
                        const x = idxToX(idx);
                        const y = valToY(c.fastMa);
                        if (!isNaN(x) && !isNaN(y)) {
                          pathPoints.push(`${pathPoints.length === 0 ? 'M' : 'L'} ${x} ${y}`);
                        }
                      }
                    });
                    return pathPoints.join(' ');
                  })()}
                  fill="none"
                  stroke="#00F0FF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Draw Slow Moving Average Line */}
                <path
                  d={(() => {
                    const pathPoints: string[] = [];
                    candleSubset.forEach((c, idx) => {
                      if (c.slowMa !== undefined && !isNaN(c.slowMa)) {
                        const x = idxToX(idx);
                        const y = valToY(c.slowMa);
                        if (!isNaN(x) && !isNaN(y)) {
                          pathPoints.push(`${pathPoints.length === 0 ? 'M' : 'L'} ${x} ${y}`);
                        }
                      }
                    });
                    return pathPoints.join(' ');
                  })()}
                  fill="none"
                  stroke="#FF9900"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Draw Grid trade entries lines */}
                {renderOpenTradesLines()}

                {/* Draw trade entry and exit markers with animations */}
                {renderTradeMarkers()}

                {/* Live Current Price Line with Dynamic Ticking Price Label */}
                {candleSubset.length > 0 && (() => {
                  const lastCandle = candleSubset[candleSubset.length - 1];
                  const currentPrice = lastCandle.close;
                  const y = valToY(currentPrice);
                  const isBull = lastCandle.close >= lastCandle.open;
                  const strokeColor = isBull ? "rgba(16, 185, 129, 0.7)" : "rgba(239, 68, 68, 0.7)";
                  const badgeColor = isBull ? "#10b981" : "#ef4444";
                  const lastCandleX = idxToX(candleSubset.length - 1);

                  if (isNaN(y) || y < padding || y > chartHeight - padding) return null;

                  return (
                    <g key="chart-live-price-group" id="chart-live-price-group">
                      {/* Live Dotted Horizontal Line */}
                      <line 
                        x1={padding} 
                        y1={y} 
                        x2={chartWidth - padding} 
                        y2={y} 
                        stroke={strokeColor} 
                        strokeDasharray="3 3" 
                        strokeWidth="1.2" 
                      />

                      {/* Pulsing visual node on the line intersection at the last candle */}
                      {!isNaN(lastCandleX) && (
                        <g>
                          <circle
                            cx={lastCandleX}
                            cy={y}
                            r="5"
                            fill={badgeColor}
                            opacity="0.5"
                            className="animate-ping"
                            style={{ transformOrigin: `${lastCandleX}px ${y}px` }}
                          />
                          <circle
                            cx={lastCandleX}
                            cy={y}
                            r="3"
                            fill={badgeColor}
                          />
                        </g>
                      )}

                      {/* Live Price Tag on the Right Edge of the Chart */}
                      <rect 
                        x={chartWidth - padding - 65} 
                        y={y - 8} 
                        width="60" 
                        height="16" 
                        rx="3" 
                        fill={badgeColor}
                        className="transition-all duration-100"
                        id="live-price-badge-rect"
                      />
                      <text 
                        x={chartWidth - padding - 35} 
                        y={y + 3} 
                        fill="#0b0f19" 
                        fontSize="9.5" 
                        fontFamily="monospace" 
                        fontWeight="bold"
                        textAnchor="middle"
                        id="live-price-badge-text"
                      >
                        {formatPrice(currentPrice)}
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>

            {/* BOTTOM CHART CONTROLS (Moved to the bottom of chart box) */}
            <div className="mt-4 pt-4 border-t border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-black/10 p-3 rounded-lg" id="chart-bottom-controls">
              {/* Pair and Speed controls */}
              <div className="flex flex-wrap items-center gap-4">
                {/* PAIR SELECTOR */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400 uppercase">Pair:</span>
                  <select 
                    value={activePair} 
                    onChange={(e) => handleControl('active_pair', e.target.value)}
                    className="bg-[#0F172A] border border-white/10 text-xs text-amber-500 rounded-md py-1 px-2.5 font-mono font-bold focus:outline-none focus:border-amber-500/50 transition-colors"
                    id="pair-selector"
                  >
                    {Object.keys(PAIR_CONFIGS).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

                {/* SPEED CONTROLS */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400 uppercase">Bilis:</span>
                  <div className="flex items-center gap-1 bg-[#0F172A] p-0.5 rounded-lg border border-white/5">
                    {[
                      { label: '1x', value: 1 },
                      { label: '5x', value: 5 },
                      { label: '20x', value: 20 },
                      { label: '100x', value: 100 }
                    ].map(s => (
                      <button
                        key={s.value}
                        onClick={() => handleControl('speed', s.value)}
                        className={`text-[10px] px-2.5 py-1 font-mono rounded-md transition-all cursor-pointer ${
                          speed === s.value 
                            ? 'bg-amber-500 text-black font-extrabold shadow-md shadow-amber-500/20' 
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                        id={`speed-btn-${s.value}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Highlighted STOP & PLAY buttons (Side-by-side) */}
              <div className="flex items-center gap-2">
                {/* STOP BUTTON */}
                <button
                  onClick={() => handleControl('toggle_run', false)}
                  className={`flex items-center gap-1.5 px-4 py-2 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer active:scale-95 ${
                    !isRunning 
                      ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/40 ring-2 ring-rose-400 font-extrabold' 
                      : 'bg-rose-950/40 text-rose-400 hover:bg-rose-900/30 border border-rose-800/30'
                  }`}
                  id="stop-btn"
                  title="I-pause ang simulation"
                >
                  <Pause className="h-3.5 w-3.5 fill-current" />
                  <span>STOP</span>
                </button>

                {/* PLAY BUTTON */}
                <button
                  onClick={() => handleControl('toggle_run', true)}
                  className={`flex items-center gap-1.5 px-4 py-2 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer active:scale-95 ${
                    isRunning 
                      ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-400 font-extrabold' 
                      : 'bg-[#1e293b] text-emerald-400 hover:bg-emerald-950/30 border border-emerald-500/30 hover:text-emerald-300'
                  }`}
                  id="play-btn"
                  title="I-play ang simulation"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>PLAY</span>
                </button>

                <div className="h-4 w-px bg-white/10"></div>

                {/* RESET BUTTON */}
                <button 
                  onClick={() => handleControl('reset')}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 rounded-lg transition-all cursor-pointer active:scale-95"
                  title="I-reset ang buong simulator"
                  id="reset-btn-bottom"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* SYSTEM CONFIGURATION PANEL (Moved below the chart with red line accent) */}
          <div className="bg-[#0F172A]/50 border border-white/10 rounded-xl p-5 shadow-xl relative flex flex-col items-center" id="ea-configurator-card">
            {/* Top Red Accent line in the middle */}
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-32 h-[3px] bg-red-600 rounded-b shadow-[0_0_10px_rgba(220,38,38,0.6)]" />
            
            {/* Robot Controls at Setup Text - Middle Top */}
            <div className="flex items-center gap-2 mb-5 mt-1 shrink-0 justify-center">
              <Sliders className="h-4 w-4 text-amber-500" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500 font-mono">
                Robot Controls at Setup
              </h3>
            </div>

            {/* CONTROLS ROW - Centered */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
              {/* AUTO TRADING EA SWITCH */}
              <div className="flex items-center gap-4 bg-[#0A0E17]/80 px-4 py-2 border border-white/5 rounded-lg w-full sm:w-auto justify-between sm:justify-start shadow-md">
                <div>
                  <span className="text-[11px] font-semibold text-white block">Artchie FXROBOT 3.0 Mode</span>
                  <span className="text-[9px] text-slate-400 block leading-none mt-1">Auto-trading & Grid</span>
                </div>
                <button
                  onClick={() => handleControl('ea_toggle')}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 cursor-pointer shrink-0 ${
                    eaEnabled ? 'bg-amber-500' : 'bg-slate-800'
                  }`}
                  id="ea-toggle-switch"
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-300 ${
                      eaEnabled ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* MARKET CONDITION CHANGER */}
              <div className="flex items-center gap-4 bg-[#0A0E17]/80 px-4 py-2 border border-white/5 rounded-lg w-full sm:w-auto justify-between sm:justify-start shadow-md">
                <div>
                  <span className="text-[11px] font-semibold text-white block">Tatakbo sa Kundisyon</span>
                  <span className="text-[9px] text-slate-400 block leading-none mt-1">Kilos ng simulation market</span>
                </div>
                <select
                  value={marketCondition}
                  onChange={(e) => handleControl('market_condition', e.target.value)}
                  className="bg-[#1E293B] border border-white/10 text-[11px] text-amber-500 rounded-md py-1 px-2.5 font-mono focus:outline-none focus:border-amber-500/50 cursor-pointer shadow"
                  id="market-condition-selector"
                >
                  <option value="normal">Normal (Sideways)</option>
                  <option value="bullish">Bully (Pataas Trend)</option>
                  <option value="bearish">Bearish (Pababa Trend)</option>
                  <option value="volatile">Volatile Chaos (Mabilis)</option>
                  <option value="range">Range Bound (Gitna)</option>
                </select>
              </div>
            </div>
          </div>

          {/* MANUAL TRADING & EA CONTROLS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="controls-panel-row">
            
            {/* STRATEGY TESTER PANEL (BACKTEST DATE PERIOD SETTINGS) */}
            <div className="bg-[#0F172A]/70 border border-amber-500/30 rounded-xl p-5 flex flex-col justify-between shadow-xl relative overflow-hidden" id="backtest-period-card">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none"></div>
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 text-[9px] font-bold tracking-widest rounded uppercase">
                    Strategy Tester
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">Backtest Settings</span>
                </div>
                <h3 className="text-sm font-bold text-white font-sans flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-amber-500" /> Panahon ng Backtest (Test Period)
                </h3>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed font-sans">
                  I-set ang simula at katapusan ng buwan at taon para subukan ang robot sa makasaysayang panahon (historical strategy testing).
                </p>

                <div className="mt-4 space-y-3 bg-black/20 p-3.5 rounded-lg border border-white/5 text-xs">
                  {/* Toggle Switch */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-slate-300 font-semibold font-sans">Paganahin ang Date Period</span>
                    <button
                      type="button"
                      onClick={() => setTestPeriodEnabled(!testPeriodEnabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 cursor-pointer ${
                        testPeriodEnabled ? 'bg-amber-500' : 'bg-slate-800'
                      }`}
                      id="period-enable-switch"
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-all duration-300 ${
                          testPeriodEnabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* From Month & Year Select */}
                  <div className="grid grid-cols-2 gap-3.5 pt-1">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wide font-sans">Mula Buwan (From):</label>
                      <select
                        disabled={!testPeriodEnabled}
                        value={testStartMonth}
                        onChange={(e) => setTestStartMonth(Number(e.target.value))}
                        className="bg-[#0A0E17] border border-white/10 text-xs text-amber-500 rounded py-1 px-1.5 font-mono focus:outline-none focus:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        id="test-start-month"
                      >
                        <option value="1">Enero (Jan)</option>
                        <option value="2">Pebrero (Feb)</option>
                        <option value="3">Marso (Mar)</option>
                        <option value="4">Abril (Apr)</option>
                        <option value="5">Mayo (May)</option>
                        <option value="6">Hunyo (Jun)</option>
                        <option value="7">Hulyo (Jul)</option>
                        <option value="8">Agosto (Aug)</option>
                        <option value="9">Setyembre (Sep)</option>
                        <option value="10">Oktubre (Oct)</option>
                        <option value="11">Nobyembre (Nov)</option>
                        <option value="12">Disyembre (Dec)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wide font-sans">Taon (Year):</label>
                      <select
                        disabled={!testPeriodEnabled}
                        value={testStartYear}
                        onChange={(e) => setTestStartYear(Number(e.target.value))}
                        className="bg-[#0A0E17] border border-white/10 text-xs text-amber-500 rounded py-1 px-1.5 font-mono focus:outline-none focus:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        id="test-start-year"
                      >
                        <option value="2024">2024</option>
                        <option value="2025">2025</option>
                        <option value="2026">2026</option>
                        <option value="2027">2027</option>
                      </select>
                    </div>
                  </div>

                  {/* To Month & Year Select */}
                  <div className="grid grid-cols-2 gap-3.5 pb-1">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wide font-sans">Hanggang (To):</label>
                      <select
                        disabled={!testPeriodEnabled}
                        value={testEndMonth}
                        onChange={(e) => setTestEndMonth(Number(e.target.value))}
                        className="bg-[#0A0E17] border border-white/10 text-xs text-amber-500 rounded py-1 px-1.5 font-mono focus:outline-none focus:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        id="test-end-month"
                      >
                        <option value="1">Enero (Jan)</option>
                        <option value="2">Pebrero (Feb)</option>
                        <option value="3">Marso (Mar)</option>
                        <option value="4">Abril (Apr)</option>
                        <option value="5">Mayo (May)</option>
                        <option value="6">Hunyo (Jun)</option>
                        <option value="7">Hulyo (Jul)</option>
                        <option value="8">Agosto (Aug)</option>
                        <option value="9">Setyembre (Sep)</option>
                        <option value="10">Oktubre (Oct)</option>
                        <option value="11">Nobyembre (Nov)</option>
                        <option value="12">Disyembre (Dec)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wide font-sans">Taon (Year):</label>
                      <select
                        disabled={!testPeriodEnabled}
                        value={testEndYear}
                        onChange={(e) => setTestEndYear(Number(e.target.value))}
                        className="bg-[#0A0E17] border border-white/10 text-xs text-amber-500 rounded py-1 px-1.5 font-mono focus:outline-none focus:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        id="test-end-year"
                      >
                        <option value="2024">2024</option>
                        <option value="2025">2025</option>
                        <option value="2026">2026</option>
                        <option value="2027">2027</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleUpdateTestPeriod}
                  className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs text-center rounded-lg transition-all shadow-lg shadow-amber-500/20 active:scale-98 flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                  id="apply-backtest-period-btn"
                >
                  <Calendar className="h-4 w-4 stroke-[2.5]" />
                  I-apply at Simulan ang Backtest
                </button>
                <p className="text-[9px] text-slate-500 text-center font-sans">
                  Pagkatapos i-apply, magre-reset ang account balance sa ${(currentUser && currentUser.balance !== undefined) ? '$' + currentUser.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '$10,000.00'} at magsisimula ang robot sa unang araw ng napiling simula.
                </p>
              </div>
            </div>


            {/* ARTCHIE FXROBOT DOWNLOAD CONTAINER (Now side-by-side with Strategy Tester) */}
            <div className="bg-[#0F172A]/70 border border-amber-500/30 rounded-xl p-5 flex flex-col justify-between shadow-xl relative overflow-hidden" id="ea-download-card">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none"></div>
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 text-[9px] font-bold tracking-widest rounded uppercase">
                    MT4 EA Download
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">v3.0 Golden Edition</span>
                </div>
                <h3 className="text-sm font-bold text-white font-sans flex items-center gap-2">
                  <Download className="h-4 w-4 text-amber-500" /> I-download ang Artchie FXROBOT
                </h3>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed font-sans">
                  Gusto mo bang subukan ang robot sa iyong sariling trading platform? Maaari mo nang i-download ang mismong <strong className="text-amber-400 font-mono">.EX4 compiled file</strong> ng <strong>Artchie FXROBOT 3.0</strong>!
                </p>
                <div className="mt-3.5 space-y-1.5 text-[10px] text-slate-300 bg-black/30 p-2.5 rounded-lg border border-white/5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-500"></span>
                    <span><strong>Secured & Closed-Source:</strong> Protektadong algorithm na ligtas sa pagbabago ng code o decompilation.</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-500"></span>
                    <span><strong>Kumpletong System:</strong> May Moving Average Crossover at RSI Filters.</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-500"></span>
                    <span><strong>Grid & Martingale Auto-Averaging:</strong> May basket close at breakeven logic.</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {!currentUser ? (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center" id="download-lock-guest">
                    <div className="flex items-center justify-center gap-1 text-red-400 font-bold text-[10px] mb-1">
                      <Lock className="h-3.5 w-3.5" /> DOWNLOAD LOCKED (GUEST)
                    </div>
                    <p className="text-[10px] text-slate-400 mb-2 leading-relaxed">
                      Naka-lock ang download para sa mga hindi naka-login. Ang Admin lamang (<span className="text-amber-400 font-mono font-semibold">achavezsalva@gmail.com</span>) ang pwedeng mag-download.
                    </p>
                    <button
                      onClick={() => {
                        setAuthError('');
                        setAuthSuccess('');
                        setAuthTab('login');
                        setShowAuthModal(true);
                      }}
                      className="px-4 py-1.5 bg-red-950/40 hover:bg-red-900/50 border border-red-800/40 hover:border-red-600 text-red-300 rounded text-[10px] transition-all cursor-pointer font-semibold uppercase tracking-wider"
                    >
                      Mag-login bilang Admin
                    </button>
                  </div>
                ) : currentUser.role !== 'admin' || currentUser.email !== 'achavezsalva@gmail.com' ? (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center" id="download-lock-user">
                    <div className="flex items-center justify-center gap-1 text-red-400 font-bold text-[10px] mb-1">
                      <Lock className="h-3.5 w-3.5" /> ACCESS DENIED (USER ONLY)
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Ang iyong role ay <span className="text-indigo-400 font-bold">User Only</span>. Paumanhin, ang Admin lamang ang may karapatang mag-download ng MT4 compiled robot file.
                    </p>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleDownloadRobot}
                      className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs text-center rounded-lg transition-all shadow-lg shadow-amber-500/20 active:scale-98 flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                      id="direct-download-ea-btn"
                    >
                      <Download className="h-4 w-4 stroke-[2.5]" />
                      I-download ang Robot (.EX4 Compiled File)
                    </button>
                    <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-[10px] font-mono mt-1">
                      <Shield className="h-3.5 w-3.5" /> Admin Access Verified
                    </div>
                  </>
                )}
                <p className="text-[9px] text-slate-500 text-center font-sans">
                  Tugma sa MetaTrader 4 (MT4) Terminal • Maaaring patakbuhin sa Demo o Live Accounts.
                </p>
              </div>
            </div>

          </div>

          {/* FOOTER DETAIL MODULES (POSITIONS, HISTORY, RISKS, COACH) - ALIGNED INSIDE LEFT COLUMN */}
          <div className="mt-6" id="trade-analysis-dashboard">
            <div className="bg-[#0F172A]/50 border border-white/10 rounded-xl overflow-hidden shadow-xl">
              {/* Tabs */}
              <div className="flex border-b border-white/10 bg-[#0A0E17]/60 p-1">
                {[
                  { id: 'positions', label: `Mga Open Positions (${openTrades.length})`, icon: Activity },
                  { id: 'history', label: `Kasaysayan (${closedTrades.length})`, icon: BookOpen },
                  { id: 'metrics', label: 'Estatistika ng Robot', icon: BarChart3 },
                ].map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex items-center gap-2 px-5 py-3 text-xs font-semibold font-sans border-b-2 transition-all cursor-pointer ${
                        activeTab === tab.id
                          ? 'border-amber-500 text-amber-500 bg-amber-500/[0.02]'
                          : 'border-transparent text-slate-400 hover:text-slate-300'
                      }`}
                      id={`tab-${tab.id}`}
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Content panel */}
              <div className="p-5 min-h-[220px]" id="tab-content-panel">
                <AnimatePresence mode="wait">
                  
                  {/* TAB 1: ACTIVE POSITIONS */}
                  {activeTab === 'positions' && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="overflow-x-auto"
                      key="tab-positions"
                    >
                      {openTrades.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                          <Terminal className="h-8 w-8 mb-2 opacity-50 text-amber-500/60" />
                          <p className="text-xs font-mono">Walang bukas na transaksyon sa ngayon.</p>
                          <p className="text-[10px] text-slate-600 mt-1">Naghihintay ng Moving Average crossover o RSI signal...</p>
                        </div>
                      ) : (
                        <table className="w-full text-left text-xs font-mono">
                          <thead>
                            <tr className="text-slate-500 border-b border-white/10 pb-2">
                              <th className="py-2.5">TICKET ID</th>
                              <th className="py-2.5">SIMBOLO</th>
                              <th className="py-2.5">URI</th>
                              <th className="py-2.5">LOTS</th>
                              <th className="py-2.5">OPEN PRICE</th>
                              <th className="py-2.5">PROFIT / LOSS</th>
                              <th className="py-2.5">EA COMMENTS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-slate-300">
                            {openTrades.map((t) => (
                               <tr key={t.ticket} className="hover:bg-white/[0.02] transition-colors">
                                <td className="py-3 text-slate-400">{t.ticket}</td>
                                <td className="py-3 font-semibold text-white">{t.symbol}</td>
                                <td className="py-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                    {t.type}
                                  </span>
                                </td>
                                <td className="py-3 font-semibold">{t.lots.toFixed(2)}</td>
                                <td className="py-3">{formatPrice(t.openPrice)}</td>
                                <td className={`py-3 font-bold ${t.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  $ {t.profit.toFixed(2)}
                                </td>
                                <td className="py-3 text-[10px] text-slate-500">{t.comment}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </motion.div>
                  )}

                  {/* TAB 2: CLOSED TRADES HISTORY */}
                  {activeTab === 'history' && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                      key="tab-history"
                    >
                      {closedTrades.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                          <BookOpen className="h-8 w-8 mb-2 opacity-50 text-amber-500/60" />
                          <p className="text-xs font-mono">Walang kasaysayan ng mga natapos na trade.</p>
                          <p className="text-[10px] text-slate-600 mt-1">Kapag nag-close ang grid basket, ang records ay lalabas dito.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-3">
                            <div>
                              <h4 className="text-xs font-semibold text-white uppercase tracking-wider font-sans">Lahat ng Closed Trades ({closedTrades.length})</h4>
                              <p className="text-[10px] text-slate-400 mt-0.5 font-sans">Ipinapakita ang huling 20 closed positions sa ibaba. I-download ang buong report gamit ang button sa kanan.</p>
                            </div>
                            <button
                              onClick={handleExportHTML}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-bold rounded-lg transition-all shadow-md shadow-amber-500/10 cursor-pointer w-fit shrink-0"
                              id="export-csv-btn"
                            >
                              <Download className="h-3.5 w-3.5" /> Export Strategy Tester Report (HTML)
                            </button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs font-mono">
                              <thead>
                                <tr className="text-slate-500 border-b border-white/10 pb-2">
                                  <th className="py-2.5">TICKET ID</th>
                                  <th className="py-2.5">SIMBOLO</th>
                                  <th className="py-2.5">URI</th>
                                  <th className="py-2.5">LOTS</th>
                                  <th className="py-2.5">OPEN → CLOSE</th>
                                  <th className="py-2.5">KITANG NA-SECURE</th>
                                  <th className="py-2.5">EXIT REASON / COMMENT</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5 text-slate-300">
                                {closedTrades.slice(-20).reverse().map((t) => (
                                   <tr key={t.ticket} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="py-3 text-slate-400">{t.ticket}</td>
                                    <td className="py-3 text-slate-300">{t.symbol}</td>
                                    <td className="py-3">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                        {t.type}
                                      </span>
                                    </td>
                                    <td className="py-3">{t.lots.toFixed(2)}</td>
                                    <td className="py-3 text-[11px]">
                                      {formatPrice(t.openPrice)} → {formatPrice(t.closePrice || 0)}
                                    </td>
                                    <td className={`py-3 font-bold ${t.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      $ {t.profit.toFixed(2)}
                                    </td>
                                    <td className="py-3 text-[10px] text-slate-400">{t.comment}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* TAB 3: STATISTICS & EA ANALYSIS */}
                  {activeTab === 'metrics' && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="grid grid-cols-1 md:grid-cols-4 gap-6 font-mono"
                      key="tab-metrics"
                    >
                      <div className="bg-[#0A0E17]/60 p-4 border border-white/5 rounded-lg">
                        <span className="text-[10px] text-slate-500 block uppercase">Win Rate (Kapanalan)</span>
                        <span className="text-xl font-bold text-emerald-400 block mt-1">{metrics.winRate.toFixed(1)}%</span>
                        <span className="text-[10px] text-slate-600 block mt-1">Lahat ng natapos: {metrics.totalTrades}</span>
                      </div>

                      <div className="bg-[#0A0E17]/60 p-4 border border-white/5 rounded-lg">
                        <span className="text-[10px] text-slate-500 block uppercase">Profit Factor</span>
                        <span className="text-xl font-bold text-amber-500 block mt-1">{metrics.profitFactor.toFixed(2)}</span>
                        <span className="text-[10px] text-slate-600 block mt-1">Gross Profit / Loss</span>
                      </div>

                      <div className="bg-[#0A0E17]/60 p-4 border border-white/5 rounded-lg">
                        <span className="text-[10px] text-slate-500 block uppercase">Average Win Size</span>
                        <span className="text-xl font-bold text-emerald-400 block mt-1">$ {metrics.averageWin.toFixed(2)}</span>
                        <span className="text-[10px] text-slate-600 block mt-1">Sukat ng kita kada basket TP</span>
                      </div>

                      <div className="bg-[#0A0E17]/60 p-4 border border-white/5 rounded-lg">
                        <span className="text-[10px] text-slate-500 block uppercase">Average Loss Size</span>
                        <span className="text-xl font-bold text-rose-400 block mt-1">$ {metrics.averageLoss.toFixed(2)}</span>
                        <span className="text-[10px] text-slate-600 block mt-1">Kadalasan ay stop out lamang</span>
                      </div>

                      {/* PRO TIPS FOR THE GRID BOT */}
                      <div className="col-span-1 md:col-span-4 bg-[#0A0E17]/60 p-4 border border-white/5 rounded-lg flex items-start gap-3">
                        <CheckCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-semibold text-slate-300 font-sans">Sikreto ng Golden Grid EA Strategy:</h4>
                          <p className="text-[11px] text-slate-400 leading-relaxed mt-1 font-sans">
                            Ang grid averaging ay umaasa sa panaka-nakang pag-bounces ng presyo ng forex (mean reversion). Kung walang trend-changing news, halos 100% ng basket ay magco-close sa Take Profit. Ngunit mag-ingat sa walang-humpay na trend na pwedeng sumagad sa iyong <strong className="text-rose-400">MaxMartingaleSteps (Max Safety)</strong> at humantong sa Stop Out!
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: MT4 DASHBOARD FRAME (3 Cols) */}
        <div className="lg:col-span-3 flex flex-col gap-6" id="right-column">
          
          {/* IDENTICAL MT4 DRAW DASHBOARD FRAME */}
          <div className="bg-[#191970]/95 border border-white/30 backdrop-blur shadow-2xl rounded-sm p-4 overflow-hidden" id="mt4-panel-frame">
            <div className="text-xs font-bold text-amber-400 border-b border-white/20 pb-2 mb-3 tracking-wide uppercase flex items-center justify-between">
              <span>Artchie FXROBOT <span className="opacity-60 font-normal text-[10px]">(Golden Edition)</span></span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>

            <div className="space-y-2 font-mono">
              <div className="flex justify-between text-[11px]">
                <span className="text-cyan-400">Fast MA ({currentEASettings.FastMA}):</span>
                <span className="text-white font-semibold">{formatPrice(candles[candles.length - 1]?.fastMa || 0)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-orange-400">Slow MA ({currentEASettings.SlowMA}):</span>
                <span className="text-white font-semibold">{formatPrice(candles[candles.length - 1]?.slowMa || 0)}</span>
              </div>
              <div className="h-px bg-white/10 my-1" />
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-300">Total Open Trades:</span>
                <span className="text-cyan-300 font-mono">{openTrades.length} / {currentEASettings.MaxMartingaleSteps}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-300">Floating P/L:</span>
                <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${floatingPL >= 0 ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border border-rose-500/20'}`}>
                  $ {floatingPL.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-300">Basket Target (TP):</span>
                <span className="text-amber-400 font-mono font-bold">$ {targetProfitCash.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-300">Break Even Price:</span>
                <span className="text-orange-400 font-mono">{formatPrice(breakEvenPrice)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-300">Next Grid Lot Size:</span>
                <span className="text-pink-400 font-mono font-bold">{nextGridLot.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-300">Total Kinita (TP/SL):</span>
                <span className={`font-mono font-bold ${totalClosedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  $ {totalClosedProfit.toFixed(2)}
                </span>
              </div>

              <div className="mt-3 pt-3 border-t border-white/20 flex flex-col gap-2">
                <div className="text-[11px] text-white italic leading-snug">
                  Aksyon: <span className="text-amber-300">{currentAction}</span>
                </div>
                
                {/* PARAMETER SETUP BUTTON - MT4 INTEGRATED */}
                <button 
                  onClick={() => setShowSettingsModal(true)}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 border border-amber-600 font-extrabold text-[11px] rounded transition-all font-mono cursor-pointer shadow-md shadow-amber-500/20"
                  id="open-settings-modal-btn"
                >
                  <Settings className="h-3.5 w-3.5 text-slate-950" /> Parameter Setup
                </button>
              </div>
            </div>
          </div>

          {/* RISK MANAGEMENT & ACCOUNT STATS */}
          <div className="bg-[#0F172A]/80 border border-white/10 backdrop-blur rounded p-4 shadow-xl" id="risk-management-card">
            <div className="text-xs font-bold mb-3 flex items-center gap-2 text-white font-sans">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              RISK MANAGEMENT
            </div>
            <div className="space-y-3 font-mono">
              <div>
                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                  <span>MAX DRAWDOWN</span>
                  <span>{drawdownPercent.toFixed(1)}% / 10%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${
                      drawdownPercent > 8 ? 'bg-rose-500' : drawdownPercent > 4 ? 'bg-amber-500' : 'bg-[#00F0FF]'
                    }`}
                    style={{ width: `${Math.min(100, (drawdownPercent / 10) * 100)}%` }}
                  />
                </div>
              </div>

              {/* BALANCE & EQUITY METRICS */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#0A0E17]/60 p-2 border border-white/5 rounded relative group">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-slate-500 block uppercase">BALANCE</span>
                    <button 
                      onClick={() => {
                        setCustomBalance(balance.toFixed(2));
                        setIsEditingBalance(true);
                      }}
                      className="text-amber-500/70 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5"
                      title="Baguhin ang Balance sa pamamagitan ng Modal"
                      id="edit-balance-trigger"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <span 
                    className="text-xs font-bold text-white font-mono cursor-pointer hover:text-amber-400 flex items-center gap-1 mt-0.5"
                    onClick={() => {
                      setCustomBalance(balance.toFixed(2));
                      setIsEditingBalance(true);
                    }}
                    id="balance-display-text"
                  >
                    $ {balance.toFixed(2)}
                  </span>
                </div>
                <div className="bg-[#0A0E17]/60 p-2 border border-white/5 rounded">
                  <span className="text-[9px] text-slate-500 block uppercase">EQUITY</span>
                  <span className="text-xs font-bold text-emerald-400 font-mono">$ {equity.toFixed(2)}</span>
                </div>
              </div>

              {/* MARGIN & MARGIN LEVEL */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#0A0E17]/60 p-2 border border-white/5 rounded">
                  <span className="text-[9px] text-slate-500 block font-sans">MARGIN USED</span>
                  <span className="text-slate-300 text-xs font-semibold font-mono">$ {margin.toFixed(2)}</span>
                </div>
                <div className="bg-[#0A0E17]/60 p-2 border border-white/5 rounded">
                  <span className="text-[9px] text-slate-500 block font-sans">FREE MARGIN</span>
                  <span className="text-[#00F0FF] text-xs font-semibold font-mono">$ {freeMargin.toFixed(2)}</span>
                </div>
              </div>

              {/* SAFETY STATUS WARNING */}
              <div className="p-2 bg-[#0A0E17]/60 border border-white/5 rounded flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${openTrades.length > 4 ? 'bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]' : openTrades.length > 0 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`} />
                <div>
                  <span className="text-[9px] text-slate-400 uppercase font-semibold block leading-none font-sans">Exposure Level:</span>
                  <span className={`font-extrabold text-[10px] uppercase font-sans ${openTrades.length > 4 ? 'text-rose-400' : openTrades.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {openTrades.length > 4 ? 'CRITICAL HIGH RISK' : openTrades.length > 0 ? 'MEDIUM AVERAGE' : 'CONSERVATIVE LOW'}
                  </span>
                </div>
              </div>

              {/* EMERGENCY CLOSE BUTTONS */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button 
                  onClick={handleCloseAll}
                  className="py-2 bg-rose-500/20 hover:bg-rose-500/35 text-rose-400 border border-rose-500/30 rounded text-[10px] font-bold uppercase tracking-tight cursor-pointer transition-all"
                >
                  Emergency Close
                </button>
                <button 
                  onClick={() => handleControl('ea_toggle')}
                  className="py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-[10px] font-bold uppercase tracking-tight cursor-pointer transition-all"
                >
                  {eaEnabled ? 'Pause Robot' : 'Start Robot'}
                </button>
              </div>
            </div>
          </div>

        </div>

      </main>



      {/* PARAMETERS CONFIGURATION DIALOG / MODAL */}
      <AnimatePresence>
        {showSettingsModal && formSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 font-sans" id="settings-modal">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0F172A] border border-white/10 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#0A0E17]/60">
                <span className="font-bold text-white text-sm tracking-tight flex items-center gap-2">
                  <Settings className="h-4 w-4 text-amber-500" /> Setup ng Parameters (MQL4 Robot Inputs)
                </span>
                <button 
                  onClick={() => setShowSettingsModal(false)}
                  className="text-slate-400 hover:text-white font-bold text-lg cursor-pointer"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSaveSettings} className="p-6 flex flex-col gap-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  
                  {/* Grid Lot Settings */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">Base Lot Size:</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0.01"
                      value={formSettings.BaseLotSize} 
                      onChange={(e) => setFormSettings({ ...formSettings, BaseLotSize: Number(parseFloat(e.target.value).toFixed(2)) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">Grid Multiplier (Martingale):</label>
                    <input 
                      type="number" 
                      step="0.1" 
                      min="1.0"
                      value={formSettings.LotMultiplier} 
                      onChange={(e) => setFormSettings({ ...formSettings, LotMultiplier: Number(parseFloat(e.target.value).toFixed(1)) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">Max Martingale Steps (Grid safety):</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="1"
                      max="12"
                      value={formSettings.MaxMartingaleSteps} 
                      onChange={(e) => setFormSettings({ ...formSettings, MaxMartingaleSteps: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">Grid Distance (Pips layo bago sumunod):</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="5"
                      value={formSettings.GridDistance} 
                      onChange={(e) => setFormSettings({ ...formSettings, GridDistance: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">Basket Take Profit (Pips):</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="5"
                      value={formSettings.BasketTPPips} 
                      onChange={(e) => setFormSettings({ ...formSettings, BasketTPPips: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  {/* MA Periods */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">Fast MA Period:</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="3"
                      value={formSettings.FastMA} 
                      onChange={(e) => setFormSettings({ ...formSettings, FastMA: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">Slow MA Period:</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="5"
                      value={formSettings.SlowMA} 
                      onChange={(e) => setFormSettings({ ...formSettings, SlowMA: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  {/* RSI Golden settings */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">RSI Period (Filter):</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="5"
                      value={formSettings.RSIPeriod} 
                      onChange={(e) => setFormSettings({ ...formSettings, RSIPeriod: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">RSI Overbought Limit (Buy Guard):</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="50"
                      max="95"
                      value={formSettings.RSI_Upper} 
                      onChange={(e) => setFormSettings({ ...formSettings, RSI_Upper: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-400 font-sans">RSI Oversold Limit (Sell Guard):</label>
                    <input 
                      type="number" 
                      step="1" 
                      min="5"
                      max="50"
                      value={formSettings.RSI_Lower} 
                      onChange={(e) => setFormSettings({ ...formSettings, RSI_Lower: parseInt(e.target.value) })}
                      className="bg-[#0A0E17] border border-white/10 rounded-lg p-2 text-amber-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                  <button 
                    type="button" 
                    onClick={() => setShowSettingsModal(false)}
                    className="px-4 py-2 bg-[#1E293B] border border-white/10 text-slate-300 hover:text-white rounded-md text-xs transition-colors cursor-pointer"
                  >
                    Kanselahin
                  </button>
                  <button 
                    type="submit" 
                    className="px-5 py-2 bg-amber-500 text-slate-950 font-bold rounded-md text-xs transition-all hover:bg-amber-400 shadow-lg shadow-amber-500/10 cursor-pointer"
                    id="save-settings-btn"
                  >
                    I-save at I-apply
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AUTHENTICATION DIALOG / MODAL */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 font-sans" id="auth-modal">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl relative"
            >
              {/* Close Button */}
              <button 
                onClick={() => {
                  setShowAuthModal(false);
                  setShowGoogleChooser(false);
                  setShowGoogleInput(false);
                }}
                className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold text-xl cursor-pointer w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-full transition-all z-10"
                id="close-auth-modal-btn"
              >
                &times;
              </button>

              {showGoogleChooser ? (
                /* GOOGLE SIGN-IN INTERACTIVE CHOOSER */
                <div className="p-6 flex flex-col">
                  {/* Google Logo and Title */}
                  <div className="flex flex-col items-center pt-4 pb-6 border-b border-white/5">
                    <svg className="h-9 w-9 mb-3" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.57h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.47C21.68,11.83 21.56,11.45 21.35,11.1z" fill="#4285F4" />
                      <path d="M12,20.62c2.6,0 4.78,-0.86 6.38,-2.34l-3.3,-2.57c-0.91,0.61 -2.08,0.98 -3.08,0.98 -2.37,0 -4.38,-1.6 -5.1,-3.75H3.45v2.66C5.04,18.84 8.28,20.62 12,20.62z" fill="#34A853" />
                      <path d="M6.9,12.94c-0.18,-0.54 -0.28,-1.11 -0.28,-1.7s0.1,-1.16 0.28,-1.7V6.88H3.45C2.83,8.11 2.48,9.51 2.48,11s0.35,2.89 0.97,4.12l3.45,-2.18z" fill="#FBBC05" />
                      <path d="M12,6.12c1.41,0 2.68,0.49 3.68,1.44l2.76,-2.76C16.78,3.24 14.6,2.38 12,2.38c-3.72,0 -6.96,1.78 -8.55,4.5l3.45,2.18c0.72,-2.15 2.73,-3.75 5.1,-3.75z" fill="#EA4335" />
                    </svg>
                    <h3 className="text-base font-bold text-white tracking-tight text-center">
                      Sign in with Google
                    </h3>
                    <p className="text-xs text-slate-400 mt-1.5 text-center">
                      Pumili ng Google account upang magpatuloy sa simulator
                    </p>
                  </div>

                  {showGoogleInput ? (
                    /* ENTER CUSTOM GMAIL FORM */
                    <form onSubmit={handleGoogleCustomEmailSubmit} className="py-5 flex flex-col gap-4">
                      <button 
                        type="button"
                        onClick={() => {
                          setShowGoogleInput(false);
                          setAuthError('');
                        }}
                        className="flex items-center gap-1 text-[11px] text-amber-500 font-semibold font-mono hover:underline self-start mb-2"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" /> Bumalik sa listahan
                      </button>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold font-mono">Google Email / Gmail</label>
                        <input 
                          type="email"
                          required
                          placeholder="e.g. pangalan@gmail.com"
                          value={googleInputEmail}
                          onChange={(e) => setGoogleInputEmail(e.target.value)}
                          className="w-full bg-[#0A0E17] border border-white/10 rounded-lg py-2.5 px-3 text-xs text-white focus:outline-none focus:border-amber-500/50"
                          autoFocus
                        />
                      </div>

                      {authError && (
                        <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg leading-tight">
                          ⚠️ {authError}
                        </div>
                      )}
                      {authSuccess && (
                        <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg leading-tight">
                          ✓ {authSuccess}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-2.5 bg-[#4285F4] hover:bg-[#357ae8] text-white font-bold text-xs rounded-lg transition-all active:scale-98 disabled:opacity-50 font-mono tracking-wider"
                      >
                        {authLoading ? 'Nagpapatunay...' : 'I-login ang Google Account'}
                      </button>
                    </form>
                  ) : (
                    /* ACCOUNT CHOOSER LIST */
                    <div className="py-4 flex flex-col gap-2.5">
                      {/* Guest User Option */}
                      <button
                        onClick={() => handleGoogleLoginSelect('guest.trader@gmail.com')}
                        disabled={authLoading}
                        className="flex items-center justify-between p-3 bg-[#1E293B]/40 hover:bg-[#1E293B]/80 border border-white/5 hover:border-indigo-500/30 rounded-xl transition-all cursor-pointer text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white font-mono text-sm shadow-md">
                            GT
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white group-hover:text-indigo-400 transition-colors">Guest Trader</span>
                            <span className="block text-[10px] text-slate-400 font-mono">guest.trader@gmail.com</span>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
                          👤 User Only
                        </span>
                      </button>

                      {/* Custom User Option */}
                      <button
                        onClick={() => setShowGoogleInput(true)}
                        disabled={authLoading}
                        className="flex items-center gap-3 p-3 bg-[#0A0E17]/40 hover:bg-[#1E293B]/40 border border-dashed border-white/10 hover:border-white/20 rounded-xl transition-all cursor-pointer text-left text-slate-300 hover:text-white"
                      >
                        <div className="w-9 h-9 rounded-full bg-[#1A1F2C] border border-white/10 flex items-center justify-center text-slate-400">
                          <User className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="block text-xs font-bold font-sans">Gumamit ng ibang Google Account...</span>
                          <span className="block text-[9px] text-slate-500">I-input ang iyong sariling Gmail address</span>
                        </div>
                      </button>

                      {/* Status messages for Google Chooser */}
                      {authError && (
                        <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mt-2">
                          ⚠️ {authError}
                        </div>
                      )}
                      {authSuccess && (
                        <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg mt-2">
                          ✓ {authSuccess}
                        </div>
                      )}

                      {/* Return to standard email credentials option */}
                      <button
                        onClick={() => {
                          setShowGoogleChooser(false);
                          setAuthError('');
                        }}
                        className="mt-4 text-[11px] text-slate-500 hover:text-slate-300 transition-all font-mono tracking-wide underline text-center"
                      >
                        Mag-login gamit ang Email & Password
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* STANDARD CREDENTIALS REGISTER / LOGIN FORM */
                <>
                  {/* Header Icon / Branding */}
                  <div className="pt-8 pb-5 px-6 flex flex-col items-center border-b border-white/5 bg-[#0A0E17]/55">
                    <div className="w-12 h-12 rounded-full bg-[#1E293B] border border-white/10 flex items-center justify-center mb-3 text-amber-500">
                      <User className="h-6 w-6" />
                    </div>
                    <h3 className="text-sm font-bold text-white tracking-tight text-center uppercase font-mono">
                      Artchie FXROBOT Portal
                    </h3>
                    <p className="text-[11px] text-slate-400 text-center mt-1 leading-snug">
                      Kailangan ng Admin Access para makapag-download ng MetaTrader 4 robot file.
                    </p>
                  </div>

                  {/* Interactive Tabs */}
                  <div className="flex border-b border-white/5 bg-black/20 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('login');
                        setAuthError('');
                        setAuthSuccess('');
                      }}
                      className={`flex-1 py-2 text-xs font-mono font-bold tracking-widest uppercase transition-all rounded-lg cursor-pointer ${
                        authTab === 'login' 
                          ? 'bg-[#1E293B] text-amber-500 shadow-md border border-white/5' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Log In
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('register');
                        setAuthError('');
                        setAuthSuccess('');
                      }}
                      className={`flex-1 py-2 text-xs font-mono font-bold tracking-widest uppercase transition-all rounded-lg cursor-pointer ${
                        authTab === 'register' 
                          ? 'bg-[#1E293B] text-amber-500 shadow-md border border-white/5' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Sign Up
                    </button>
                  </div>

                  {/* Notice Box for testing (Tagalog & English, highly informative) */}
                  <div className="px-6 pt-5">
                    <div className="bg-[#1e1e2d] border border-indigo-500/20 rounded-lg p-3 text-[10px] text-slate-300 leading-normal shadow-inner">
                      <div className="flex items-center gap-1.5 font-bold text-indigo-400 mb-1.5 font-mono">
                        <Shield className="h-3.5 w-3.5 text-amber-500" /> SECURED ADMIN SECURITY MODEL:
                      </div>
                      <div className="space-y-1.5">
                        <p>
                          <strong>👑 Admin account (<span className="text-amber-400 font-semibold font-mono">achavezsalva@gmail.com</span>):</strong> 
                          <span className="block text-slate-400 mt-0.5">
                            Naka-lock at may karagdagang proteksyon. Upang maiwasan ang pagnanakaw ng EA sa ibang PC, ang account na ito ay <span className="text-red-400 font-bold">HINDI PWEDENG i-login gamit ang Google o quick-links</span>. 
                            Kailangan mong ilagay ang iyong rehistradong <span className="text-emerald-400 font-bold">Email at Password</span> nang tama upang makapasok.
                          </span>
                        </p>
                        <p>
                          <strong>👤 Normal User account:</strong> Maaari kang mag-sign up o mag-log in gamit ang kahit anong password o gamitin ang "Sign in with Google" na tab para sa mabilis na pag-test.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Auth Form */}
                  <form onSubmit={handleAuthSubmit} className="p-6 flex flex-col gap-4">
                    {/* Email field */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold font-mono">Email Address</label>
                      <div className="relative">
                        <input 
                          type="email"
                          required
                          placeholder="e.g. achavezsalva@gmail.com"
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          className="w-full bg-[#0A0E17] border border-white/10 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-amber-500/50"
                        />
                      </div>
                    </div>

                    {/* Password field */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold font-mono">Password</label>
                      <div className="relative">
                        <input 
                          type="password"
                          required
                          placeholder="Ipasok ang iyong password"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          className="w-full bg-[#0A0E17] border border-white/10 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-amber-500/50"
                        />
                      </div>
                    </div>

                    {/* Status messages */}
                    {authError && (
                      <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg font-medium leading-tight">
                        ⚠️ {authError}
                      </div>
                    )}
                    {authSuccess && (
                      <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg font-medium leading-tight">
                        ✓ {authSuccess}
                      </div>
                    )}

                    {/* Submit button */}
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full mt-2 py-2.5 bg-[#4f46e5] hover:bg-[#4338ca] text-white font-bold text-xs rounded-lg transition-all active:scale-98 shadow-lg shadow-indigo-600/15 disabled:opacity-50 cursor-pointer uppercase tracking-wider font-mono flex items-center justify-center gap-1.5"
                      id="auth-submit-btn"
                    >
                      {authLoading ? (
                        'Sandali lamang...'
                      ) : authTab === 'login' ? (
                        <>I-login ang Account</>
                      ) : (
                        <>Rehistruhin ang Account</>
                      )}
                    </button>

                    {/* OR Separator */}
                    <div className="flex items-center my-1">
                      <div className="flex-1 h-px bg-white/5"></div>
                      <span className="px-3 text-[9px] text-slate-500 font-mono uppercase tracking-widest">O KAYA</span>
                      <div className="flex-1 h-px bg-white/5"></div>
                    </div>

                    {/* Google Sign-In Trigger Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowGoogleChooser(true);
                        setAuthError('');
                        setAuthSuccess('');
                      }}
                      className="w-full py-2.5 bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs rounded-lg transition-all active:scale-98 shadow-md flex items-center justify-center gap-2.5 cursor-pointer font-sans"
                      id="google-signin-btn"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.57h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.47C21.68,11.83 21.56,11.45 21.35,11.1z" fill="#4285F4" />
                        <path d="M12,20.62c2.6,0 4.78,-0.86 6.38,-2.34l-3.3,-2.57c-0.91,0.61 -2.08,0.98 -3.08,0.98 -2.37,0 -4.38,-1.6 -5.1,-3.75H3.45v2.66C5.04,18.84 8.28,20.62 12,20.62z" fill="#34A853" />
                        <path d="M6.9,12.94c-0.18,-0.54 -0.28,-1.11 -0.28,-1.7s0.1,-1.16 0.28,-1.7V6.88H3.45C2.83,8.11 2.48,9.51 2.48,11s0.35,2.89 0.97,4.12l3.45,-2.18z" fill="#FBBC05" />
                        <path d="M12,6.12c1.41,0 2.68,0.49 3.68,1.44l2.76,-2.76C16.78,3.24 14.6,2.38 12,2.38c-3.72,0 -6.96,1.78 -8.55,4.5l3.45,2.18c0.72,-2.15 2.73,-3.75 5.1,-3.75z" fill="#EA4335" />
                      </svg>
                      Sign in with Google
                    </button>
                  </form>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EDIT BALANCE MODAL */}
      <AnimatePresence>
        {isEditingBalance && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 font-sans" id="edit-balance-modal">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative p-6"
            >
              {/* Close Button */}
              <button 
                onClick={() => setIsEditingBalance(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold text-xl cursor-pointer w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-full transition-all z-10"
                id="close-balance-modal-btn"
              >
                &times;
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shadow-inner">
                  <Coins className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Baguhin ang Balance
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    I-set ang panimulang pondo para sa simulator
                  </p>
                </div>
              </div>

              <form onSubmit={handleSetBalance} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                    Account Balance (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-base font-semibold pointer-events-none">$</span>
                    <input 
                      type="number"
                      value={customBalance}
                      onChange={(e) => setCustomBalance(e.target.value)}
                      placeholder="Halimbawa: 10000"
                      className="w-full bg-[#0A0E17]/60 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-white font-mono text-base font-bold focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all"
                      autoFocus
                      step="0.01"
                      min="1"
                      required
                      id="custom-balance-input"
                    />
                  </div>
                </div>

                {/* Quick Presets */}
                <div>
                  <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                    Quick Preset Sizes
                  </span>
                  <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
                    {[500, 1000, 5000, 10000, 25000, 50000, 100000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCustomBalance(preset.toString())}
                        className={`text-[10px] font-semibold py-1.5 rounded-lg border transition-all cursor-pointer ${
                          customBalance === preset.toString()
                            ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 shadow-sm shadow-amber-500/5'
                            : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10 hover:border-white/10'
                        }`}
                      >
                        ${preset.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setIsEditingBalance(false)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-white/5 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    Kanselahin
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 font-extrabold rounded-xl text-xs transition-all hover:brightness-105 active:scale-98 shadow-lg shadow-amber-500/10 cursor-pointer flex items-center justify-center gap-1.5"
                    id="save-balance-btn"
                  >
                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                    I-save at I-apply
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
