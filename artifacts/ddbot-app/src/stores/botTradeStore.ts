/**
 * botTradeStore.ts — lightweight localStorage-backed trade store
 *
 * Persists every bot trade so Summary, Transactions, and Journal
 * panels can read it from any page without MobX coupling.
 *
 * Usage:
 *   BotTradeStore.record(trade)          — called by AiBots on each result
 *   BotTradeStore.getAll()               — returns full history (newest first)
 *   BotTradeStore.subscribe(cb)          — fires on every new trade
 *   BotTradeStore.clear()                — wipe history
 */

export interface BotTrade {
  id: string;
  timestamp: number;
  symbol: string;
  strategy: string;
  contractType: string;
  barrier: number;
  stake: number;
  result: 'WIN' | 'LOSS';
  profit: number;         // positive = gain, negative = loss
  sessionProfit: number;  // running total for this session
  phase: string;
  isRecovery: boolean;
}

const STORAGE_KEY = 'botTradeHistory';
const TRADE_EVENT = 'botTradeRecorded';
const MAX_RECORDS = 500;

type Subscriber = (trade: BotTrade) => void;
const subscribers = new Set<Subscriber>();

function load(): BotTrade[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

function save(trades: BotTrade[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades.slice(0, MAX_RECORDS)));
}

export const BotTradeStore = {
  record(trade: Omit<BotTrade, 'id'>): BotTrade {
    const full: BotTrade = { ...trade, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const existing = load();
    save([full, ...existing]);
    for (const cb of subscribers) { try { cb(full); } catch {} }
    window.dispatchEvent(new CustomEvent(TRADE_EVENT, { detail: full }));
    return full;
  },

  getAll(): BotTrade[] { return load(); },

  getSession(sessionStart: number): BotTrade[] {
    return load().filter(t => t.timestamp >= sessionStart);
  },

  clear() { localStorage.removeItem(STORAGE_KEY); },

  subscribe(cb: Subscriber): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },

  stats(trades: BotTrade[]) {
    const wins    = trades.filter(t => t.result === 'WIN').length;
    const losses  = trades.filter(t => t.result === 'LOSS').length;
    const profit  = trades.reduce((s, t) => s + t.profit, 0);
    const stake   = trades.reduce((s, t) => s + t.stake, 0);
    return { wins, losses, total: trades.length, profit, stake, winRate: trades.length ? (wins / trades.length) * 100 : 0 };
  },
};
