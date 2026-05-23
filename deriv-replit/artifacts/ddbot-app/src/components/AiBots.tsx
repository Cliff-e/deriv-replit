/**
 * AiBots.tsx — Advanced Strategy Bot (DIFFER / OVER 1 / UNDER 8)
 *
 * Replaces the legacy AI Cycle Bot.  Full advanced strategy engine:
 *   DIFFER  — entry on user-selected Digit A or Digit B (unchanged except entry rule)
 *   OVER 1  — DCircles guard (digits 0 & 1 < 10.50%, no red); entry: 5 or 6
 *   UNDER 8 — DCircles guard (digits 8 & 9 < 10.50%, no red); entry: 7, 4, or 9
 *
 * Each strategy executes exactly 3 trades per entry, then waits for the next entry.
 * Recovery engine fires only on real trade loss.
 * Session ends on TP or SL hit and requires manual restart.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDerivAuth } from '@/auth/useDerivAuth';
import {
    AdvancedBotEngine,
    type BotConfig,
    type BotPhase,
    type BotState,
    type StrategyType,
    type TradeResult,
} from '@/bot/advancedBotEngine';
import { updateDCirclesState } from '@/bot/dcirclesState';

const DERIV_WS = 'wss://ws.derivws.com/websockets/v3';
const APP_ID = (import.meta.env.VITE_DERIV_APP_ID as string | undefined) ?? '36300';

const DIGIT_SYMBOLS = [
    { label: 'Volatility 10 Index', value: 'R_10' },
    { label: 'Volatility 25 Index', value: 'R_25' },
    { label: 'Volatility 50 Index', value: 'R_50' },
    { label: 'Volatility 75 Index', value: 'R_75' },
    { label: 'Volatility 100 Index', value: 'R_100' },
    { label: 'Volatility 10 (1s)', value: '1HZ10V' },
    { label: 'Volatility 25 (1s)', value: '1HZ25V' },
    { label: 'Volatility 50 (1s)', value: '1HZ50V' },
    { label: 'Volatility 75 (1s)', value: '1HZ75V' },
    { label: 'Volatility 100 (1s)', value: '1HZ100V' },
];

const AiBots: React.FC = () => {
    const { isAuthenticated, isVerifying, activeLoginId } = useDerivAuth();

    // Settings
    const [strategy, setStrategy] = useState<StrategyType>('OVER_1');
    const [symbol, setSymbol] = useState('R_75');
    const [stake, setStake] = useState(1);
    const [targetProfit, setTargetProfit] = useState(10);
    const [stopLoss, setStopLoss] = useState(5);
    const [differDigitA, setDifferDigitA] = useState(2);
    const [differDigitB, setDifferDigitB] = useState(8);

    // Bot state mirrored from engine
    const [botState, setBotState] = useState<BotState>({
        running: false,
        phase: 'IDLE',
        profit: 0,
        tradeCount: 0,
        winCount: 0,
        lossCount: 0,
        lastLog: '',
        logs: [],
        currentStake: 1,
    });

    // Connection
    const [authorized, setAuthorized] = useState(false);
    const [connStatus, setConnStatus] = useState('Waiting for login…');

    const ws = useRef<WebSocket | null>(null);
    const engineRef = useRef<AdvancedBotEngine | null>(null);
    const authorizedRef = useRef(false);
    const digitsBuffer = useRef<Record<string, number[]>>({});

    useEffect(() => { authorizedRef.current = authorized; }, [authorized]);

    // Trade executor — real Deriv WebSocket buy
    const executeTradeRef = useRef<
        (sym: string, contract: string, barrier: number, amt: number) => Promise<TradeResult>
    >();

    executeTradeRef.current = (
        sym: string,
        contract: string,
        barrier: number,
        amt: number
    ): Promise<TradeResult> =>
        new Promise((resolve, reject) => {
            if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not open'));
                return;
            }

            const timeout = setTimeout(() => reject(new Error('Trade timeout (30s)')), 30_000);

            const handler = (event: MessageEvent) => {
                let data: Record<string, unknown>;
                try { data = JSON.parse(event.data as string) as Record<string, unknown>; }
                catch { return; }

                if (data['msg_type'] === 'proposal') {
                    const p = data['proposal'] as { id?: string } | undefined;
                    if (p?.id) ws.current?.send(JSON.stringify({ buy: p.id, price: amt }));
                    return;
                }

                if (data['msg_type'] === 'buy') {
                    clearTimeout(timeout);
                    ws.current?.removeEventListener('message', handler);
                    if (data['error']) {
                        reject(new Error(String((data['error'] as { message?: string }).message ?? 'Buy error')));
                        return;
                    }
                    const buy = data['buy'] as { profit?: number } | undefined;
                    resolve((buy?.profit ?? 0) >= 0 ? 'WIN' : 'LOSS');
                }
            };

            ws.current.addEventListener('message', handler);

            ws.current.send(JSON.stringify({
                proposal: 1,
                amount: amt,
                basis: 'stake',
                contract_type: contract,
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: sym,
                barrier: String(barrier),
            }));
        });

    // WebSocket
    const connectWS = useCallback(() => {
        const token = localStorage.getItem('authToken');
        ws.current = new WebSocket(`${DERIV_WS}?app_id=${APP_ID}`);

        ws.current.onopen = () => {
            setConnStatus('Connected — authorizing…');
            if (token) ws.current?.send(JSON.stringify({ authorize: token }));
            else setConnStatus('No auth token found — please log in');
        };

        ws.current.onmessage = (msg: MessageEvent) => {
            let data: Record<string, unknown>;
            try { data = JSON.parse(msg.data as string) as Record<string, unknown>; }
            catch { return; }

            if (data['msg_type'] === 'authorize') {
                if (data['error']) {
                    const err = data['error'] as { message?: string };
                    setConnStatus(`Auth failed: ${err.message ?? 'unknown'}`);
                    setAuthorized(false);
                    return;
                }
                setAuthorized(true);
                authorizedRef.current = true;
                setConnStatus('Ready — select strategy and press Start');
                DIGIT_SYMBOLS.forEach(s => {
                    ws.current?.send(JSON.stringify({ ticks: s.value, subscribe: 1 }));
                });
                return;
            }

            if (data['msg_type'] === 'tick') {
                const tick = data['tick'] as { symbol: string; quote: number; epoch: number } | undefined;
                if (!tick) return;
                const { symbol: sym, quote, epoch } = tick;

                // Extract last digit from price string
                const str = String(quote);
                const dec = str.split('.')[1] ?? '';
                const lastDigit = dec.length > 0
                    ? parseInt(dec[dec.length - 1], 10)
                    : Math.floor(quote) % 10;

                // Maintain per-symbol digit buffer for DCircles
                if (!digitsBuffer.current[sym]) digitsBuffer.current[sym] = [];
                digitsBuffer.current[sym].push(lastDigit);
                if (digitsBuffer.current[sym].length > 1000) digitsBuffer.current[sym].shift();

                // Feed DCircles singleton (uses all ticks for the active symbol)
                updateDCirclesState(digitsBuffer.current[sym]);

                // Feed engine
                engineRef.current?.onTick(`${sym}:${epoch}`, lastDigit);
            }
        };

        ws.current.onerror = () => setConnStatus('WebSocket error');
        ws.current.onclose = () => {
            setAuthorized(false);
            authorizedRef.current = false;
            setConnStatus('Disconnected');
        };
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        ws.current?.close();
        setAuthorized(false);
        setConnStatus('Connecting…');
        connectWS();
        return () => { ws.current?.close(); };
    }, [isAuthenticated, connectWS]);

    // Start / Stop
    const startBot = () => {
        if (!authorized) return;

        const config: BotConfig = {
            strategy, symbol, stake, targetProfit, stopLoss,
            differDigitA, differDigitB,
        };

        const engine = new AdvancedBotEngine(
            config,
            (sym, contract, barrier, amount) =>
                executeTradeRef.current!(sym, contract, barrier, amount),
            state => setBotState({ ...state })
        );

        engineRef.current = engine;
        engine.start();
    };

    const stopBot = () => engineRef.current?.stop('🛑 Stopped manually');

    const running = botState.running;

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div style={S.wrap}>
            <h2 style={S.heading}>Advanced Strategy Bot</h2>

            {/* Auth status */}
            <div style={S.row}>
                <span style={{ color: connColor(isVerifying, isAuthenticated, authorized), fontWeight: 600 }}>
                    {isVerifying ? '○ Checking session…'
                        : !isAuthenticated ? '○ Not logged in'
                        : authorized ? '● Authorized'
                        : '○ Connecting…'}
                </span>
                {activeLoginId && <span style={S.muted}>{activeLoginId}</span>}
            </div>
            <div style={S.muted}>{connStatus}</div>

            {/* Live session stats */}
            {botState.phase !== 'IDLE' && (
                <div style={S.stats}>
                    <span style={{ color: phaseColor(botState.phase), fontWeight: 700 }}>
                        {botState.phase}
                    </span>
                    <span>Trades: {botState.tradeCount}</span>
                    <span>W/L: {botState.winCount}/{botState.lossCount}</span>
                    <span style={{ color: botState.profit >= 0 ? '#00e06e' : '#ff4444', fontWeight: 700 }}>
                        P&L: {botState.profit >= 0 ? '+' : ''}{botState.profit.toFixed(2)}
                    </span>
                    <span style={S.muted}>Stake: ${botState.currentStake.toFixed(2)}</span>
                </div>
            )}

            {/* Settings panel */}
            <div style={S.panel}>
                <div style={S.field}>
                    <label style={S.lbl}>Strategy</label>
                    <select value={strategy} onChange={e => setStrategy(e.target.value as StrategyType)}
                        style={S.sel} disabled={running}>
                        <option value="OVER_1">OVER 1 — entry on digit 5 or 6</option>
                        <option value="UNDER_8">UNDER 8 — entry on digit 7, 4, or 9</option>
                        <option value="DIFFER">DIFFER — entry on Digit A or Digit B</option>
                    </select>
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
                        {DIGIT_SYMBOLS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                </div>

                <div style={S.row}>
                    <div style={S.field}>
                        <label style={S.lbl}>Base Stake ($)</label>
                        <input type="number" min={0.35} step={0.01} value={stake}
                            onChange={e => setStake(Number(e.target.value))}
                            style={S.inp} disabled={running} />
                    </div>
                    <div style={S.field}>
                        <label style={S.lbl}>Take Profit ($)</label>
                        <input type="number" min={0.01} step={0.5} value={targetProfit}
                            onChange={e => setTargetProfit(Number(e.target.value))}
                            style={S.inp} disabled={running} />
                    </div>
                    <div style={S.field}>
                        <label style={S.lbl}>Stop Loss ($)</label>
                        <input type="number" min={0.01} step={0.5} value={stopLoss}
                            onChange={e => setStopLoss(Number(e.target.value))}
                            style={S.inp} disabled={running} />
                    </div>
                </div>
            </div>

            {/* Strategy info pill */}
            <div style={S.info}>
                {strategy === 'OVER_1' && 'DCircles guard: digits 0 & 1 must be < 10.50% with no red bar. Entry on digit 5 or 6. 3 trades per entry.'}
                {strategy === 'UNDER_8' && 'DCircles guard: digits 8 & 9 must be < 10.50% with no red bar. Entry on digit 7, 4, or 9. 3 trades per entry.'}
                {strategy === 'DIFFER' && `DIFFER entry rule: cursor touches digit ${differDigitA} OR digit ${differDigitB}. All other Differ logic unchanged.`}
            </div>

            {/* Controls */}
            <div style={S.row}>
                {!running ? (
                    <button onClick={startBot} disabled={!authorized}
                        style={{ ...S.btn, background: '#00e06e', color: '#000', opacity: authorized ? 1 : 0.4 }}>
                        ▶ Start Bot
                    </button>
                ) : (
                    <button onClick={stopBot}
                        style={{ ...S.btn, background: '#ff4444', color: '#fff' }}>
                        ⏹ Stop Bot
                    </button>
                )}
            </div>

            {/* Log feed */}
            {botState.logs.length > 0 && (
                <div style={S.log}>
                    {botState.logs.slice(0, 40).map((line, i) => (
                        <div key={i} style={S.logLine}>{line}</div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AiBots;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers & styles
// ─────────────────────────────────────────────────────────────────────────────

function connColor(verifying: boolean, authed: boolean, authorized: boolean) {
    if (verifying) return '#aaa';
    if (!authed) return '#ff4444';
    if (authorized) return '#00e06e';
    return '#ffaa00';
}

function phaseColor(phase: BotPhase) {
    switch (phase) {
        case 'VIRTUAL': return '#ffaa00';
        case 'REAL': return '#00e06e';
        case 'RECOVERY': return '#ff8800';
        case 'STOPPED': return '#888';
        default: return '#888';
    }
}

const S: Record<string, React.CSSProperties> = {
    wrap: {
        padding: 20, maxWidth: 560, margin: '0 auto',
        display: 'flex', flexDirection: 'column', gap: 12,
        background: '#0d0d0d', color: '#e4e4e4',
        borderRadius: 12, border: '1px solid #1e1e1e',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13,
    },
    heading: { margin: 0, fontSize: 15, fontWeight: 700, color: '#00e06e', letterSpacing: 1 },
    row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    muted: { color: '#555', fontSize: 12 },
    stats: {
        display: 'flex', gap: 14, flexWrap: 'wrap',
        background: '#141414', padding: '8px 12px', borderRadius: 8,
    },
    panel: {
        display: 'flex', flexDirection: 'column', gap: 10,
        background: '#121212', padding: '12px 14px',
        borderRadius: 8, border: '1px solid #1c1c1c',
    },
    field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 120 },
    lbl: { fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
    inp: {
        background: '#1a1a1a', color: '#e0e0e0',
        border: '1px solid #2e2e2e', borderRadius: 6,
        padding: '6px 9px', fontSize: 13, width: '100%', boxSizing: 'border-box',
    },
    sel: {
        background: '#1a1a1a', color: '#00d0ff',
        border: '1px solid #2e2e2e', borderRadius: 6,
        padding: '7px 9px', fontSize: 13, width: '100%',
    },
    btn: {
        border: 'none', borderRadius: 7, padding: '9px 24px',
        cursor: 'pointer', fontWeight: 700, fontSize: 13, letterSpacing: 0.3,
    },
    info: {
        background: '#111', borderLeft: '3px solid #1e1e1e',
        padding: '8px 12px', borderRadius: 4,
        color: '#555', fontSize: 12, lineHeight: 1.6,
    },
    log: {
        background: '#090909', border: '1px solid #181818',
        borderRadius: 8, padding: '10px 12px',
        maxHeight: 240, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 3,
    },
    logLine: { fontSize: 11, color: '#666', lineHeight: 1.4 },
};
