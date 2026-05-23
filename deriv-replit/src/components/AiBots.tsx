/**
 * AiBots.tsx — AI Cycle Bot integrated with the PKCE auth layer.
 *
 * • WebSocket connects and authorizes automatically once isAuthenticated = true
 * • User only clicks Start / Stop — no manual connect step
 * • Target profit and stop loss are enforced after each trade result
 * • pendingTrade guard prevents proposal spam on every tick
 */

import React, { useEffect, useRef, useState } from "react";
import { useDerivAuth } from "@/auth/useDerivAuth";

const DERIV_WS = "wss://ws.derivws.com/websockets/v3";
const APP_ID = (import.meta.env.VITE_DERIV_APP_ID as string | undefined) || "1089";

const AiBots = () => {
    const { isAuthenticated, isVerifying, activeLoginId } = useDerivAuth();

    // ── Settings ──────────────────────────────────────────────────────────
    const [digits, setDigits] = useState("2,1,8,0");
    const [martingale, setMartingale] = useState(true);
    const [martingaleFactor, setMartingaleFactor] = useState(2);
    const [targetProfit, setTargetProfit] = useState(10);
    const [stopLoss, setStopLoss] = useState(5);
    const [recoveryType, setRecoveryType] = useState("under");
    const [recoveryBarrier, setRecoveryBarrier] = useState(4);
    const [baseStake, setBaseStake] = useState(1);
    const [currentStake, setCurrentStake] = useState(1);
    const [autoMarket, setAutoMarket] = useState(true);

    // ── State ─────────────────────────────────────────────────────────────
    const [running, setRunning] = useState(false);
    const [authorized, setAuthorized] = useState(false);
    const [totalPnL, setTotalPnL] = useState(0);
    const [tradeCount, setTradeCount] = useState(0);
    const [statusMsg, setStatusMsg] = useState("Waiting for login…");

    // ── Refs ──────────────────────────────────────────────────────────────
    const ws = useRef<WebSocket | null>(null);
    const tickData = useRef<Record<string, number[]>>({});
    const pendingTrade = useRef(false);
    const runningRef = useRef(false);
    const totalPnLRef = useRef(0);
    const currentStakeRef = useRef(1);

    useEffect(() => { runningRef.current = running; }, [running]);
    useEffect(() => { totalPnLRef.current = totalPnL; }, [totalPnL]);
    useEffect(() => {
        setCurrentStake(baseStake);
        currentStakeRef.current = baseStake;
    }, [baseStake]);

    // ── Market list ───────────────────────────────────────────────────────
    const markets = [
        "Volatility 10 Index", "Volatility 25 Index", "Volatility 50 Index",
        "Volatility 75 Index", "Volatility 90 Index", "Volatility 100 Index",
        "Volatility 10 (1s) Index", "Volatility 25 (1s) Index", "Volatility 50 (1s) Index",
        "Volatility 75 (1s) Index", "Volatility 90 (1s) Index", "Volatility 100 (1s) Index",
        "EURUSD", "GBPUSD", "USDJPY",
    ];
    const [market, setMarket] = useState(markets[0]);

    // ── WebSocket ─────────────────────────────────────────────────────────
    const connectWS = () => {
        const token = localStorage.getItem("authToken");

        ws.current = new WebSocket(`${DERIV_WS}?app_id=${APP_ID}`);

        ws.current.onopen = () => {
            setStatusMsg("Connected — authorizing…");
            if (token) {
                ws.current?.send(JSON.stringify({ authorize: token }));
            } else {
                setStatusMsg("No auth token found");
            }
        };

        ws.current.onmessage = (msg) => {
            const data = JSON.parse(msg.data) as Record<string, unknown>;

            if (data.msg_type === "authorize") {
                if (data.error) {
                    const err = data.error as { message?: string };
                    setStatusMsg(`Auth failed: ${err.message ?? "unknown"}`);
                    setAuthorized(false);
                    return;
                }
                setAuthorized(true);
                setStatusMsg("Ready — press Start to begin trading");
                markets.forEach(symbol => {
                    ws.current?.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
                });
                return;
            }

            if (data.proposal) {
                const proposal = data.proposal as { id: string };
                ws.current?.send(JSON.stringify({
                    buy: proposal.id,
                    price: currentStakeRef.current,
                }));
                setStatusMsg("🟢 Buy executed");
                return;
            }

            if (data.buy) {
                pendingTrade.current = false;
                const buy = data.buy as { profit?: number };
                const profit = buy.profit ?? 0;

                setTotalPnL(prev => {
                    const next = +(prev + profit).toFixed(2);
                    totalPnLRef.current = next;
                    return next;
                });
                setTradeCount(prev => prev + 1);
                handleResult(profit >= 0);

                if (totalPnLRef.current >= targetProfit) {
                    stopBot("🎯 Target profit reached");
                    return;
                }
                if (totalPnLRef.current <= -stopLoss) {
                    stopBot("🛑 Stop loss triggered");
                    return;
                }
                return;
            }

            if (!data.tick) return;
            const tick = data.tick as { symbol: string; quote: number };
            const { symbol, quote } = tick;

            if (!tickData.current[symbol]) tickData.current[symbol] = [];
            tickData.current[symbol].push(quote);
            if (tickData.current[symbol].length > 20) tickData.current[symbol].shift();

            if (authorized && runningRef.current) runEngine(symbol);
        };

        ws.current.onerror = () => setStatusMsg("WebSocket error");
        ws.current.onclose = () => {
            setAuthorized(false);
            setStatusMsg("Disconnected");
        };
    };

    // ── Auto-connect when auth is confirmed ───────────────────────────────
    useEffect(() => {
        if (!isAuthenticated) return;

        if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
            ws.current.close();
        }

        setAuthorized(false);
        setStatusMsg("Connecting…");
        connectWS();

        return () => ws.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // ── AI market selection ───────────────────────────────────────────────
    const selectBestMarket = () => {
        let best = markets[0];
        let bestScore = -Infinity;

        for (const m of markets) {
            const ticks = tickData.current[m] || [];
            if (ticks.length < 5) continue;

            let volatility = 0;
            for (let i = 1; i < ticks.length; i++) {
                volatility += Math.abs(ticks[i] - ticks[i - 1]);
            }

            let score = volatility;
            if (m.includes("(1s)")) score += 50;
            if (m.includes("90")) score += 30;

            if (score > bestScore) { bestScore = score; best = m; }
        }
        return best;
    };

    const placeTrade = (symbol: string, stake: number) => {
        if (pendingTrade.current) return;
        pendingTrade.current = true;

        ws.current?.send(JSON.stringify({
            proposal: 1,
            amount: stake,
            basis: "stake",
            contract_type: "DIGITMATCH",
            currency: "USD",
            duration: 1,
            duration_unit: "t",
            symbol,
            barrier: digits.split(",")[0] || "0",
        }));

        setStatusMsg(`📊 Proposal sent — ${symbol} @ $${stake}`);
    };

    const handleResult = (won: boolean) => {
        if (won) {
            currentStakeRef.current = baseStake;
            setCurrentStake(baseStake);
        } else if (martingale) {
            const next = +(currentStakeRef.current * martingaleFactor).toFixed(2);
            currentStakeRef.current = next;
            setCurrentStake(next);
        }
    };

    const runEngine = (symbol: string) => {
        const ticks = tickData.current[symbol] || [];
        if (ticks.length < 10) return;

        let volatility = 0;
        for (let i = 1; i < ticks.length; i++) {
            volatility += Math.abs(ticks[i] - ticks[i - 1]);
        }

        if (volatility > 5) {
            const selected = autoMarket ? selectBestMarket() : symbol;
            placeTrade(selected, currentStakeRef.current);
        }
    };

    const startBot = () => {
        if (!isAuthenticated || !authorized) return;
        setRunning(true);
        runningRef.current = true;
        setTotalPnL(0);
        totalPnLRef.current = 0;
        setTradeCount(0);
        currentStakeRef.current = baseStake;
        setCurrentStake(baseStake);
        pendingTrade.current = false;
        setStatusMsg("🚀 Bot running");
    };

    const stopBot = (reason = "Stopped") => {
        setRunning(false);
        runningRef.current = false;
        pendingTrade.current = false;
        setStatusMsg(reason);
    };

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div style={styles.container}>
            <h2>AI Cycle Bot</h2>

            <div style={styles.statusBar}>
                <span style={{
                    color: isVerifying ? "#aaa"
                        : !isAuthenticated ? "#ff4444"
                        : authorized ? "#00ff66"
                        : "#ffaa00"
                }}>
                    {isVerifying ? "○ Checking session…"
                        : !isAuthenticated ? "○ Waiting for login…"
                        : authorized ? "● Connected & authorized"
                        : "○ Connecting…"}
                </span>
                <span style={{ color: "#aaa", fontSize: 12 }}>{activeLoginId ?? ""}</span>
            </div>
            <div style={styles.statusBar}>
                <span style={{ color: "#aaa", fontSize: 13 }}>{statusMsg}</span>
                <span>
                    Trades: {tradeCount} &nbsp;|&nbsp; P&amp;L:&nbsp;
                    <span style={{ color: totalPnL >= 0 ? "#00ff66" : "#ff4444" }}>
                        {totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)}
                    </span>
                </span>
            </div>

            <div style={styles.group}>
                <label>
                    <input type="checkbox" checked={autoMarket}
                        onChange={() => setAutoMarket(!autoMarket)} />
                    &nbsp;Auto Market Selection (AI + Live Ticks)
                </label>
                {!autoMarket && (
                    <select value={market} onChange={e => setMarket(e.target.value)}
                        style={styles.select}>
                        {markets.map(m => (
                            <option key={m} value={m} style={styles.option}>{m}</option>
                        ))}
                    </select>
                )}
            </div>

            <div style={styles.group}>
                <label>Cycle Digits</label>
                <input value={digits} onChange={e => setDigits(e.target.value)} style={styles.input} />
            </div>

            <div style={styles.group}>
                <label>Base Stake ($)</label>
                <input type="number" value={baseStake}
                    onChange={e => setBaseStake(Number(e.target.value))} style={styles.input} />
                <span style={{ color: "#aaa", fontSize: 12 }}>Current stake: ${currentStake.toFixed(2)}</span>
            </div>

            <div style={styles.group}>
                <label>
                    <input type="checkbox" checked={martingale}
                        onChange={() => setMartingale(!martingale)} />
                    &nbsp;Martingale
                </label>
                {martingale && (
                    <input type="number" value={martingaleFactor}
                        onChange={e => setMartingaleFactor(Number(e.target.value))} style={styles.input} />
                )}
            </div>

            <div style={styles.group}>
                <label>Target Profit ($)</label>
                <input type="number" value={targetProfit}
                    onChange={e => setTargetProfit(Number(e.target.value))} style={styles.input} />
            </div>
            <div style={styles.group}>
                <label>Stop Loss ($)</label>
                <input type="number" value={stopLoss}
                    onChange={e => setStopLoss(Number(e.target.value))} style={styles.input} />
            </div>

            <div style={styles.group}>
                <label>Recovery Type</label>
                <select value={recoveryType} onChange={e => setRecoveryType(e.target.value)} style={styles.select}>
                    <option value="under">Under</option>
                    <option value="over">Over</option>
                </select>
            </div>
            <div style={styles.group}>
                <label>Recovery Barrier</label>
                <input type="number" value={recoveryBarrier}
                    onChange={e => setRecoveryBarrier(Number(e.target.value))} style={styles.input} />
            </div>

            <div style={styles.buttons}>
                {!running ? (
                    <button onClick={startBot} disabled={!authorized}
                        style={{ ...styles.btn, opacity: authorized ? 1 : 0.4 }}>
                        ▶ Start Bot
                    </button>
                ) : (
                    <button onClick={() => stopBot()} style={styles.btn}>⏹ Stop Bot</button>
                )}
            </div>
        </div>
    );
};

export default AiBots;

const styles: Record<string, React.CSSProperties> = {
    container: {
        padding: 20, maxWidth: 500, margin: "0 auto",
        display: "flex", flexDirection: "column", gap: 15,
        background: "#111", color: "#fff", borderRadius: 10,
    },
    statusBar: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" },
    group: { display: "flex", flexDirection: "column", gap: 5 },
    buttons: { display: "flex", gap: 10 },
    input: { background: "#1a1a1a", color: "#fff", border: "1px solid #333", borderRadius: 6, padding: "6px 10px" },
    select: { backgroundColor: "#111", color: "#00ff66", border: "1px solid #00ff66", padding: "8px", borderRadius: "6px" },
    option: { backgroundColor: "#111", color: "#00ff66" },
    btn: { background: "#00ff66", color: "#111", border: "none", borderRadius: 6, padding: "8px 20px", cursor: "pointer", fontWeight: 700 },
};
