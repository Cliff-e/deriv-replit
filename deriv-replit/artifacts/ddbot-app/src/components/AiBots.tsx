/**
 * AiBots.tsx — Advanced Strategy Bot v2
 *
 * Changes vs v1:
 *  • Auto-connects WS on mount using authToken from localStorage — no re-auth needed
 *  • Watches storage events so connection fires the moment the user logs in
 *  • Martingale panel: multiplier slider + consecutive-loss display
 *  • TP / SL as a dedicated "Risk Controls" panel with progress bars
 *  • Trade history linked to BotTradeStore → Summary / Transactions / Journal tabs
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AdvancedBotEngine,
    type BotConfig,
    type BotPhase,
    type BotState,
    type StrategyType,
    type TradeResult,
} from '@/bot/advancedBotEngine';
import { updateDCirclesState } from '@/bot/dcirclesState';
import { BotTradeStore, type BotTrade } from '@/stores/botTradeStore';

const DERIV_WS = 'wss://ws.derivws.com/websockets/v3';
const APP_ID   = (import.meta.env.VITE_DERIV_APP_ID as string | undefined) ?? '36300';

const DIGIT_SYMBOLS = [
    { label: 'Volatility 10 Index',  value: 'R_10'    },
    { label: 'Volatility 25 Index',  value: 'R_25'    },
    { label: 'Volatility 50 Index',  value: 'R_50'    },
    { label: 'Volatility 75 Index',  value: 'R_75'    },
    { label: 'Volatility 100 Index', value: 'R_100'   },
    { label: 'Volatility 10 (1s)',   value: '1HZ10V'  },
    { label: 'Volatility 25 (1s)',   value: '1HZ25V'  },
    { label: 'Volatility 50 (1s)',   value: '1HZ50V'  },
    { label: 'Volatility 75 (1s)',   value: '1HZ75V'  },
    { label: 'Volatility 100 (1s)', value: '1HZ100V' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const AiBots: React.FC = () => {
    // Strategy settings
    const [strategy,       setStrategy]       = useState<StrategyType>('OVER_1');
    const [symbol,         setSymbol]         = useState('R_75');
    const [stake,          setStake]          = useState(1);
    const [targetProfit,   setTargetProfit]   = useState(10);
    const [stopLoss,       setStopLoss]       = useState(5);
    const [martingale,     setMartingale]     = useState(false);
    const [martMultiplier, setMartMultiplier] = useState(2);
    const [differDigitA,   setDifferDigitA]   = useState(2);
    const [differDigitB,   setDifferDigitB]   = useState(8);

    // UI tabs
    const [activeTab, setActiveTab] = useState<'bot' | 'summary' | 'transactions' | 'journal'>('bot');

    // Connection
    const [connStatus, setConnStatus]   = useState<'disconnected' | 'connecting' | 'authorized' | 'error'>('disconnected');
    const [loginId,    setLoginId]      = useState<string>('');

    // Bot state
    const [botState, setBotState] = useState<BotState>({
        running: false, phase: 'IDLE', profit: 0,
        tradeCount: 0, winCount: 0, lossCount: 0,
        lastLog: '', logs: [], currentStake: 1, consecutiveLosses: 0,
    });

    // Trade history for tabs
    const [tradeHistory, setTradeHistory] = useState<BotTrade[]>(() => BotTradeStore.getAll());

    const ws          = useRef<WebSocket | null>(null);
    const engineRef   = useRef<AdvancedBotEngine | null>(null);
    const digitsBuffer = useRef<Record<string, number[]>>({});
    const reconnTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const authorizedRef = useRef(false);

    // ── Trade executor ────────────────────────────────────────────────────────

    const executeTradeRef = useRef<
        (sym: string, contract: string, barrier: number, amt: number) => Promise<TradeResult>
    >();

    executeTradeRef.current = (sym, contract, barrier, amt) =>
        new Promise((resolve, reject) => {
            if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not open')); return;
            }
            const timeout = setTimeout(() => reject(new Error('Trade timeout')), 30_000);
            const handler = (event: MessageEvent) => {
                let data: Record<string, unknown>;
                try { data = JSON.parse(event.data as string) as Record<string, unknown>; } catch { return; }
                if (data['msg_type'] === 'proposal') {
                    const p = data['proposal'] as { id?: string } | undefined;
                    if (p?.id) ws.current?.send(JSON.stringify({ buy: p.id, price: amt }));
                    return;
                }
                if (data['msg_type'] === 'buy') {
                    clearTimeout(timeout);
                    ws.current?.removeEventListener('message', handler);
                    if (data['error']) { reject(new Error(String((data['error'] as { message?: string }).message ?? 'Buy error'))); return; }
                    const buy = data['buy'] as { profit?: number } | undefined;
                    resolve((buy?.profit ?? 0) >= 0 ? 'WIN' : 'LOSS');
                }
            };
            ws.current.addEventListener('message', handler);
            ws.current.send(JSON.stringify({
                proposal: 1, amount: amt, basis: 'stake',
                contract_type: contract, currency: 'USD',
                duration: 1, duration_unit: 't', symbol: sym, barrier: String(barrier),
            }));
        });

    // ── WebSocket connection ──────────────────────────────────────────────────

    const connectWS = useCallback(() => {
        const token = localStorage.getItem('authToken');
        if (!token) { setConnStatus('disconnected'); return; }

        if (ws.current && ws.current.readyState !== WebSocket.CLOSED) ws.current.close();

        setConnStatus('connecting');
        const socket = new WebSocket(`${DERIV_WS}?app_id=${APP_ID}`);
        ws.current = socket;

        socket.onopen = () => {
            socket.send(JSON.stringify({ authorize: token }));
        };

        socket.onmessage = (msg: MessageEvent) => {
            let data: Record<string, unknown>;
            try { data = JSON.parse(msg.data as string) as Record<string, unknown>; } catch { return; }

            if (data['msg_type'] === 'authorize') {
                if (data['error']) { setConnStatus('error'); authorizedRef.current = false; return; }
                const acct = data['authorize'] as { loginid?: string } | undefined;
                authorizedRef.current = true;
                setConnStatus('authorized');
                setLoginId(acct?.loginid ?? '');
                // Subscribe all symbols for live DCircles data
                DIGIT_SYMBOLS.forEach(s => {
                    socket.send(JSON.stringify({ ticks: s.value, subscribe: 1 }));
                });
                return;
            }

            if (data['msg_type'] === 'tick') {
                const tick = data['tick'] as { symbol: string; quote: number; epoch: number } | undefined;
                if (!tick) return;
                const { symbol: sym, quote, epoch } = tick;
                const str = String(quote);
                const dec = str.split('.')[1] ?? '';
                const lastDigit = dec.length > 0
                    ? parseInt(dec[dec.length - 1], 10)
                    : Math.floor(quote) % 10;

                if (!digitsBuffer.current[sym]) digitsBuffer.current[sym] = [];
                digitsBuffer.current[sym].push(lastDigit);
                if (digitsBuffer.current[sym].length > 1000) digitsBuffer.current[sym].shift();

                updateDCirclesState(digitsBuffer.current[sym]);
                engineRef.current?.onTick(`${sym}:${epoch}`, lastDigit);
            }
        };

        socket.onerror = () => { setConnStatus('error'); authorizedRef.current = false; };
        socket.onclose = () => {
            authorizedRef.current = false;
            setConnStatus('disconnected');
            // Auto-reconnect after 5s if token still exists
            if (localStorage.getItem('authToken')) {
                reconnTimer.current = setTimeout(() => connectWS(), 5_000);
            }
        };
    }, []);

    // Auto-connect on mount + watch for new tokens
    useEffect(() => {
        connectWS();

        const onStorage = (e: StorageEvent) => {
            if (e.key === 'authToken' && e.newValue) connectWS();
        };
        window.addEventListener('storage', onStorage);

        return () => {
            window.removeEventListener('storage', onStorage);
            if (reconnTimer.current) clearTimeout(reconnTimer.current);
            ws.current?.close();
        };
    }, [connectWS]);

    // Subscribe to trade store for live tab updates
    useEffect(() => {
        return BotTradeStore.subscribe(() => {
            setTradeHistory(BotTradeStore.getAll());
        });
    }, []);

    // ── Bot controls ──────────────────────────────────────────────────────────

    const startBot = () => {
        if (!authorizedRef.current) return;

        const config: BotConfig = {
            strategy, symbol, stake, targetProfit, stopLoss,
            martingaleMultiplier: martingale ? martMultiplier : 1,
            differDigitA, differDigitB,
        };

        const engine = new AdvancedBotEngine(
            config,
            (sym, contract, barrier, amount) => executeTradeRef.current!(sym, contract, barrier, amount),
            state => {
                setBotState({ ...state });
                if (!state.running) setTradeHistory(BotTradeStore.getAll());
            }
        );
        engineRef.current = engine;
        engine.start();
    };

    const stopBot = () => engineRef.current?.stop('🛑 Stopped manually');

    const running = botState.running;
    const authorized = connStatus === 'authorized';

    // ── Stats for trade history tabs ──────────────────────────────────────────
    const histStats = BotTradeStore.stats(tradeHistory);
    const sessionTrades = tradeHistory.slice(0, botState.tradeCount);

    // ── TP / SL progress ──────────────────────────────────────────────────────
    const profitPct = Math.min(100, running ? (botState.profit / targetProfit) * 100 : 0);
    const lossPct   = Math.min(100, running ? (Math.abs(Math.min(0, botState.profit)) / stopLoss) * 100 : 0);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={S.page}>
            {/* Header */}
            <div style={S.header}>
                <div style={S.headerLeft}>
                    <span style={S.headerTitle}>Deriv Bot Engine</span>
                    <span style={S.headerBadge}>v2</span>
                </div>
                <div style={S.connRow}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: connColor(connStatus), display: 'inline-block' }} />
                    <span style={{ fontSize: 11, color: connColor(connStatus) }}>
                        {connStatus === 'authorized' ? `Authorized${loginId ? ` · ${loginId}` : ''}`
                         : connStatus === 'connecting' ? 'Connecting…'
                         : connStatus === 'error'      ? 'Auth error'
                         : 'Disconnected'}
                    </span>
                    {connStatus === 'disconnected' && (
                        <button onClick={connectWS} style={S.microBtn}>Reconnect</button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div style={S.tabs}>
                {(['bot', 'summary', 'transactions', 'journal'] as const).map(t => (
                    <button key={t} onClick={() => setActiveTab(t)} style={{
                        ...S.tab,
                        borderBottom: activeTab === t ? '2px solid #00c853' : '2px solid transparent',
                        color: activeTab === t ? '#fff' : '#555',
                    }}>
                        {t === 'bot' ? '⚡ Bot' : t === 'summary' ? '📊 Summary' : t === 'transactions' ? '💳 Transactions' : '📋 Journal'}
                    </button>
                ))}
            </div>

            {/* ── BOT TAB ─────────────────────────────────────────────────── */}
            {activeTab === 'bot' && (
                <div style={S.body}>
                    {/* Left: controls */}
                    <div style={S.left}>
                        <div style={S.section}>
                            <div style={S.sectionTitle}>Strategy</div>
                            <div style={S.pills}>
                                {(['OVER_1', 'UNDER_8', 'DIFFER'] as StrategyType[]).map(s => (
                                    <button key={s} onClick={() => !running && setStrategy(s)} style={{
                                        ...S.pill,
                                        background: strategy === s ? stratColor(s) : '#1a1a1a',
                                        color: strategy === s ? '#000' : '#555',
                                        border: `1px solid ${strategy === s ? stratColor(s) : '#2a2a2a'}`,
                                        cursor: running ? 'default' : 'pointer',
                                    }}>
                                        {s === 'OVER_1' ? 'OVER1' : s === 'UNDER_8' ? 'UNDER8' : 'DIFFER'}
                                    </button>
                                ))}
                            </div>
                            <div style={S.stratDesc}>
                                {strategy === 'OVER_1'  && 'Entry: digit 5 or 6. DCircles guard: digits 0 & 1 < 10.5%.'}
                                {strategy === 'UNDER_8' && 'Entry: digit 7, 4, or 9. DCircles guard: digits 8 & 9 < 10.5%.'}
                                {strategy === 'DIFFER'  && `Entry: digit ${differDigitA} or ${differDigitB}. DCircles no-red guard.`}
                            </div>

                            {strategy === 'DIFFER' && (
                                <div style={S.row}>
                                    <div style={S.field}>
                                        <label style={S.lbl}>Digit A</label>
                                        <input type="number" min={0} max={9} value={differDigitA}
                                            onChange={e => setDifferDigitA(Number(e.target.value))}
                                            style={S.inp} disabled={running} />
                                    </div>
                                    <div style={S.field}>
                                        <label style={S.lbl}>Digit B</label>
                                        <input type="number" min={0} max={9} value={differDigitB}
                                            onChange={e => setDifferDigitB(Number(e.target.value))}
                                            style={S.inp} disabled={running} />
                                    </div>
                                </div>
                            )}

                            <div style={S.field}>
                                <label style={S.lbl}>Symbol</label>
                                <select value={symbol} onChange={e => setSymbol(e.target.value)}
                                    style={S.sel} disabled={running}>
                                    {DIGIT_SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                            </div>

                            <div style={S.field}>
                                <label style={S.lbl}>Base Stake ($)</label>
                                <input type="number" min={0.35} step={0.01} value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                    style={S.inp} disabled={running} />
                            </div>
                        </div>

                        {/* Risk Controls */}
                        <div style={{ ...S.section, borderTop: '1px solid #1a1a1a' }}>
                            <div style={S.sectionTitle}>Risk Controls</div>

                            <div style={S.row}>
                                <div style={S.field}>
                                    <label style={S.lbl}>Take Profit ($)</label>
                                    <input type="number" min={0.01} step={0.5} value={targetProfit}
                                        onChange={e => setTargetProfit(Number(e.target.value))}
                                        style={{ ...S.inp, borderColor: '#00c85333' }} disabled={running} />
                                </div>
                                <div style={S.field}>
                                    <label style={S.lbl}>Stop Loss ($)</label>
                                    <input type="number" min={0.01} step={0.5} value={stopLoss}
                                        onChange={e => setStopLoss(Number(e.target.value))}
                                        style={{ ...S.inp, borderColor: '#e5393533' }} disabled={running} />
                                </div>
                            </div>

                            {running && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#444', marginBottom: 3 }}>
                                            <span>Take Profit</span>
                                            <span style={{ color: '#00c853' }}>${botState.profit.toFixed(2)} / ${targetProfit}</span>
                                        </div>
                                        <div style={S.progressBg}>
                                            <div style={{ ...S.progressBar, width: `${Math.max(0, profitPct)}%`, background: '#00c853' }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#444', marginBottom: 3 }}>
                                            <span>Stop Loss</span>
                                            <span style={{ color: '#e53935' }}>${Math.abs(Math.min(0, botState.profit)).toFixed(2)} / ${stopLoss}</span>
                                        </div>
                                        <div style={S.progressBg}>
                                            <div style={{ ...S.progressBar, width: `${lossPct}%`, background: '#e53935' }} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Martingale Panel */}
                        <div style={{ ...S.section, borderTop: '1px solid #1a1a1a' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={S.sectionTitle}>Martingale</div>
                                <div onClick={() => !running && setMartingale(m => !m)} style={{
                                    width: 36, height: 20, borderRadius: 10, position: 'relative',
                                    background: martingale ? '#00c853' : '#2a2a2a',
                                    cursor: running ? 'default' : 'pointer', transition: 'background 0.2s',
                                    flexShrink: 0,
                                }}>
                                    <div style={{
                                        position: 'absolute', top: 2, width: 16, height: 16,
                                        borderRadius: '50%', background: '#fff',
                                        left: martingale ? 18 : 2, transition: 'left 0.2s',
                                    }} />
                                </div>
                            </div>

                            {martingale && (
                                <>
                                    <div style={S.field}>
                                        <label style={S.lbl}>Multiplier (on loss)</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input type="range" min={1.5} max={4} step={0.5} value={martMultiplier}
                                                onChange={e => setMartMultiplier(Number(e.target.value))}
                                                style={{ flex: 1 }} disabled={running} />
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#e8b923', minWidth: 24 }}>×{martMultiplier}</span>
                                        </div>
                                    </div>
                                    {running && botState.consecutiveLosses > 0 && (
                                        <div style={{ fontSize: 11, color: '#e8b923', background: '#1a1500', padding: '5px 8px', borderRadius: 5, border: '1px solid #e8b92333' }}>
                                            ⚠ {botState.consecutiveLosses} consecutive loss{botState.consecutiveLosses > 1 ? 'es' : ''} — stake: ${botState.currentStake.toFixed(2)}
                                        </div>
                                    )}
                                    <div style={{ fontSize: 10, color: '#444', lineHeight: 1.5 }}>
                                        Stake multiplies by ×{martMultiplier} on each loss. Resets to base on win.
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Start/Stop */}
                        <div style={{ padding: '0 14px 14px' }}>
                            {!running
                                ? <button onClick={startBot} disabled={!authorized} style={{
                                    ...S.actionBtn, background: authorized ? '#00a844' : '#1a2a1a',
                                    color: authorized ? '#fff' : '#444', cursor: authorized ? 'pointer' : 'default',
                                  }}>▶ Start Bot</button>
                                : <button onClick={stopBot} style={{ ...S.actionBtn, background: '#c62828', color: '#fff' }}>⏹ Stop Bot</button>
                            }
                        </div>
                    </div>

                    {/* Right: live dashboard */}
                    <div style={S.right}>
                        {/* Stat strip */}
                        <div style={S.statRow}>
                            {[
                                { label: 'MODE',     val: botState.phase,            color: phaseColor(botState.phase) },
                                { label: 'STRATEGY', val: strategy,                  color: stratColor(strategy) },
                                { label: 'TRADES',   val: botState.tradeCount,       color: '#ccc' },
                                { label: 'WIN / LOSS', val: `${botState.winCount} / ${botState.lossCount}`, color: '#ccc' },
                                { label: 'P&L',      val: `${botState.profit >= 0 ? '+' : ''}$${botState.profit.toFixed(2)}`,
                                                     color: botState.profit >= 0 ? '#00c853' : '#e53935' },
                                { label: 'STAKE',    val: `$${botState.currentStake.toFixed(2)}`, color: '#ccc' },
                            ].map(({ label, val, color }) => (
                                <div key={label} style={S.statCard}>
                                    <div style={S.statLbl}>{label}</div>
                                    <div style={{ ...S.statVal, color }}>{val}</div>
                                </div>
                            ))}
                        </div>

                        {/* Event log */}
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a1a1a' }}>
                            <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Event Log</div>
                            <div style={{ height: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {botState.logs.length === 0
                                    ? <div style={{ fontSize: 10, color: '#2a2a2a' }}>No events yet — start the bot to begin.</div>
                                    : botState.logs.slice(0, 60).map((line, i) => (
                                        <div key={i} style={{
                                            fontSize: 10, fontFamily: 'monospace',
                                            color: line.includes('WIN') ? '#00c853'
                                                 : line.includes('LOSS') || line.includes('❌') ? '#e53935'
                                                 : line.includes('🔄') ? '#ff8800'
                                                 : line.includes('🛑') || line.includes('🎯') ? '#888'
                                                 : i === 0 ? '#999' : '#444',
                                        }}>{line}</div>
                                    ))
                                }
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── SUMMARY TAB ─────────────────────────────────────────────── */}
            {activeTab === 'summary' && (
                <div style={S.tabContent}>
                    <div style={S.summaryGrid}>
                        {[
                            { label: 'Total Trades',  val: histStats.total,                    color: '#ccc' },
                            { label: 'Wins',          val: histStats.wins,                     color: '#00c853' },
                            { label: 'Losses',        val: histStats.losses,                   color: '#e53935' },
                            { label: 'Win Rate',      val: `${histStats.winRate.toFixed(1)}%`, color: histStats.winRate >= 50 ? '#00c853' : '#e53935' },
                            { label: 'Total P&L',     val: `${histStats.profit >= 0 ? '+' : ''}$${histStats.profit.toFixed(2)}`, color: histStats.profit >= 0 ? '#00c853' : '#e53935' },
                            { label: 'Total Staked',  val: `$${histStats.stake.toFixed(2)}`,   color: '#aaa' },
                        ].map(({ label, val, color }) => (
                            <div key={label} style={S.summaryCard}>
                                <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
                                <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
                            </div>
                        ))}
                    </div>
                    <div style={{ padding: '0 14px', display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => { BotTradeStore.clear(); setTradeHistory([]); }}
                            style={{ fontSize: 10, color: '#555', background: 'none', border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
                            Clear History
                        </button>
                    </div>
                </div>
            )}

            {/* ── TRANSACTIONS TAB ────────────────────────────────────────── */}
            {activeTab === 'transactions' && (
                <div style={S.tabContent}>
                    {tradeHistory.length === 0
                        ? <div style={{ padding: 20, color: '#333', fontSize: 12 }}>No transactions yet. Start the bot to record trades.</div>
                        : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                                    {['Time', 'Symbol', 'Strategy', 'Contract', 'Stake', 'Result', 'Profit', 'P&L'].map(h => (
                                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {tradeHistory.slice(0, 50).map(t => (
                                    <tr key={t.id} style={{ borderBottom: '1px solid #141414' }}>
                                        <td style={{ padding: '5px 10px', color: '#444' }}>{new Date(t.timestamp).toISOString().slice(11, 19)}</td>
                                        <td style={{ padding: '5px 10px', color: '#888' }}>{t.symbol}</td>
                                        <td style={{ padding: '5px 10px', color: stratColor(t.strategy as StrategyType) }}>{t.strategy}</td>
                                        <td style={{ padding: '5px 10px', color: '#666' }}>{t.contractType}:{t.barrier}</td>
                                        <td style={{ padding: '5px 10px', color: '#888' }}>${t.stake.toFixed(2)}</td>
                                        <td style={{ padding: '5px 10px', fontWeight: 700, color: t.result === 'WIN' ? '#00c853' : '#e53935' }}>{t.result}</td>
                                        <td style={{ padding: '5px 10px', color: t.profit >= 0 ? '#00c853' : '#e53935' }}>{t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}</td>
                                        <td style={{ padding: '5px 10px', color: t.sessionProfit >= 0 ? '#00c853' : '#e53935' }}>{t.sessionProfit >= 0 ? '+' : ''}${t.sessionProfit.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    }
                </div>
            )}

            {/* ── JOURNAL TAB ─────────────────────────────────────────────── */}
            {activeTab === 'journal' && (
                <div style={S.tabContent}>
                    {tradeHistory.length === 0
                        ? <div style={{ padding: 20, color: '#333', fontSize: 12 }}>No journal entries yet.</div>
                        : tradeHistory.slice(0, 100).map(t => (
                            <div key={t.id} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '7px 14px', borderBottom: '1px solid #141414',
                            }}>
                                <span style={{ fontSize: 14 }}>{t.result === 'WIN' ? '✅' : '❌'}</span>
                                <span style={{ fontSize: 9, color: '#444', minWidth: 70 }}>{new Date(t.timestamp).toISOString().slice(11, 19)}</span>
                                <span style={{ fontSize: 10, color: stratColor(t.strategy as StrategyType), minWidth: 60 }}>{t.strategy}</span>
                                <span style={{ fontSize: 10, color: '#666', flex: 1 }}>{t.symbol} · {t.contractType}:{t.barrier} · ${t.stake.toFixed(2)} stake</span>
                                {t.isRecovery && <span style={{ fontSize: 9, color: '#ff8800', background: '#1a0f00', padding: '1px 5px', borderRadius: 3 }}>RECOVERY</span>}
                                <span style={{ fontSize: 11, fontWeight: 700, color: t.profit >= 0 ? '#00c853' : '#e53935', minWidth: 60, textAlign: 'right' }}>
                                    {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
                                </span>
                            </div>
                        ))
                    }
                </div>
            )}
        </div>
    );
};

export default AiBots;

// ── helpers ───────────────────────────────────────────────────────────────────

function connColor(s: string) {
    if (s === 'authorized') return '#00c853';
    if (s === 'connecting') return '#e8b923';
    if (s === 'error')      return '#e53935';
    return '#555';
}
function phaseColor(p: BotPhase) {
    switch (p) {
        case 'VIRTUAL':  return '#e8b923';
        case 'REAL':     return '#00c853';
        case 'RECOVERY': return '#ff8800';
        case 'STOPPED':  return '#888';
        default:         return '#555';
    }
}
function stratColor(s: string) {
    if (s === 'OVER_1')  return '#00c853';
    if (s === 'UNDER_8') return '#e53935';
    return '#e8b923';
}

// ── styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
    page: { display:'flex', flexDirection:'column', height:'100vh', background:'#0c0c0c', color:'#ccc', fontFamily:"'Inter',ui-sans-serif,system-ui,sans-serif", fontSize:12, overflow:'hidden' },
    header: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 16px', borderBottom:'1px solid #1a1a1a', background:'#0e0e0e', flexShrink:0 },
    headerLeft: { display:'flex', alignItems:'center', gap:8 },
    headerTitle: { fontWeight:600, fontSize:12, color:'#888', letterSpacing:0.5 },
    headerBadge: { fontSize:9, color:'#444', background:'#1a1a1a', padding:'1px 6px', borderRadius:3, border:'1px solid #2a2a2a' },
    connRow: { display:'flex', alignItems:'center', gap:6 },
    microBtn: { fontSize:9, padding:'2px 8px', background:'#1a1a1a', color:'#555', border:'1px solid #2a2a2a', borderRadius:3, cursor:'pointer' },
    tabs: { display:'flex', borderBottom:'1px solid #1a1a1a', background:'#0e0e0e', flexShrink:0 },
    tab: { padding:'8px 16px', background:'none', border:'none', cursor:'pointer', fontSize:11, fontWeight:500, letterSpacing:0.2, transition:'all 0.15s' },
    body: { display:'flex', flex:1, overflow:'hidden' },
    left: { width:240, flexShrink:0, borderRight:'1px solid #1a1a1a', overflowY:'auto', display:'flex', flexDirection:'column' },
    right: { flex:1, overflowY:'auto', display:'flex', flexDirection:'column' },
    section: { padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 },
    sectionTitle: { fontSize:11, fontWeight:600, color:'#ddd' },
    pills: { display:'flex', gap:4 },
    pill: { flex:1, padding:'5px 0', borderRadius:5, fontSize:10, fontWeight:600, letterSpacing:0.3, transition:'all 0.15s' },
    stratDesc: { fontSize:10, color:'#4a4a4a', lineHeight:1.5, minHeight:28 },
    row: { display:'flex', gap:8 },
    field: { display:'flex', flexDirection:'column', gap:4, flex:1 },
    lbl: { fontSize:9, color:'#444', textTransform:'uppercase', letterSpacing:0.5 },
    inp: { background:'#181818', color:'#ccc', border:'1px solid #2a2a2a', borderRadius:5, padding:'6px 8px', fontSize:12, width:'100%', boxSizing:'border-box' },
    sel: { background:'#181818', color:'#00c8ff', border:'1px solid #2a2a2a', borderRadius:5, padding:'6px 8px', fontSize:11, width:'100%' },
    progressBg: { height:4, background:'#1a1a1a', borderRadius:2, overflow:'hidden' },
    progressBar: { height:'100%', borderRadius:2, transition:'width 0.3s' },
    actionBtn: { width:'100%', padding:'10px 0', border:'none', borderRadius:6, fontSize:12, fontWeight:700, letterSpacing:0.3, transition:'all 0.15s' },
    statRow: { display:'flex', borderBottom:'1px solid #1a1a1a', flexShrink:0 },
    statCard: { flex:1, padding:'8px 12px', borderRight:'1px solid #1a1a1a' },
    statLbl: { fontSize:8, color:'#444', textTransform:'uppercase', letterSpacing:0.5, marginBottom:3 },
    statVal: { fontSize:12, fontWeight:600 },
    tabContent: { flex:1, overflowY:'auto' },
    summaryGrid: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:0, padding:14 },
    summaryCard: { padding:'12px 14px', background:'#111', margin:4, borderRadius:6, border:'1px solid #1a1a1a' },
};
