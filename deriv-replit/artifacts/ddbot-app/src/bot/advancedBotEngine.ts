/**
 * advancedBotEngine.ts — Production-grade strategy engine v2
 *
 * New in v2:
 *   - martingaleMultiplier: stake doubles (or custom) on each consecutive loss, resets on win
 *   - BotTradeStore integration: every trade recorded to localStorage
 *   - Auto-reconnect-safe: engine is stateless between WS connections
 */

import { BotTradeStore } from '@/stores/botTradeStore';
import { getCurrentDCirclesState } from './dcirclesState';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyType = 'DIFFER' | 'OVER_1' | 'UNDER_8';

export interface BotConfig {
    strategy: StrategyType;
    symbol: string;
    stake: number;
    targetProfit: number;
    stopLoss: number;
    martingaleMultiplier: number;   // 1 = off, 2 = double on loss, etc.
    differDigitA?: number;
    differDigitB?: number;
}

export type BotPhase = 'IDLE' | 'VIRTUAL' | 'REAL' | 'RECOVERY' | 'STOPPED';

export interface BotState {
    running: boolean;
    phase: BotPhase;
    profit: number;
    tradeCount: number;
    winCount: number;
    lossCount: number;
    lastLog: string;
    logs: string[];
    currentStake: number;
    consecutiveLosses: number;
}

export type TradeResult = 'WIN' | 'LOSS';

export type ExecuteTradeFn = (
    symbol: string,
    contractType: string,
    barrier: number,
    stake: number
) => Promise<TradeResult>;

// ─────────────────────────────────────────────────────────────────────────────
// DCircles confirmation helpers
// ─────────────────────────────────────────────────────────────────────────────

function checkDCirclesOver1(): boolean {
    const s = getCurrentDCirclesState();
    const d0 = s.digits[0]; const d1 = s.digits[1];
    if (!d0 || !d1) return false;
    return d0.pct < 10.5 && !d0.isRed && d1.pct < 10.5 && !d1.isRed;
}

function checkDCirclesUnder8(): boolean {
    const s = getCurrentDCirclesState();
    const d8 = s.digits[8]; const d9 = s.digits[9];
    if (!d8 || !d9) return false;
    return d8.pct < 10.5 && !d8.isRed && d9.pct < 10.5 && !d9.isRed;
}

function checkDCirclesGeneral(): boolean {
    const s = getCurrentDCirclesState();
    if (s.updatedAt === 0) return true;
    return Object.values(s.digits).every(d => !d.isRed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recovery engine
// ─────────────────────────────────────────────────────────────────────────────

class RecoveryStrategyEngine {
    private over6Counter = 0;
    private active = false;

    reset(): void { this.over6Counter = 0; this.active = false; }
    activate(): void { this.active = true; this.over6Counter = 0; }
    isActive(): boolean { return this.active; }

    onDigit(digit: number): boolean {
        if (!this.active) return false;
        if (digit > 6) this.over6Counter++;
        return this.over6Counter >= 3;
    }

    decideContract(last20: number[]): { contract: string; barrier: number } {
        if (last20.length === 0) return { contract: 'DIGITOVER', barrier: 5 };
        const over5Pct = (last20.filter(d => d > 5).length / last20.length) * 100;
        const under4Pct = (last20.filter(d => d < 4).length / last20.length) * 100;
        if (over5Pct > 60) return { contract: 'DIGITUNDER', barrier: 4 };
        if (under4Pct > 60) return { contract: 'DIGITOVER', barrier: 5 };
        return { contract: 'DIGITOVER', barrier: 5 };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AdvancedBotEngine
// ─────────────────────────────────────────────────────────────────────────────

export class AdvancedBotEngine {
    private config: BotConfig;
    private state: BotState;
    private executeTrade: ExecuteTradeFn;
    private onStateChange: (s: BotState) => void;

    private lockRef = false;
    private lastTickKey: string | null = null;
    private exitDigits: number[] = [];
    private recovery = new RecoveryStrategyEngine();
    private sessionStart = Date.now();

    constructor(
        config: BotConfig,
        executeTrade: ExecuteTradeFn,
        onStateChange: (s: BotState) => void
    ) {
        this.config = config;
        this.executeTrade = executeTrade;
        this.onStateChange = onStateChange;
        this.state = this.freshState();
    }

    private freshState(): BotState {
        return {
            running: false, phase: 'IDLE', profit: 0,
            tradeCount: 0, winCount: 0, lossCount: 0,
            lastLog: '', logs: [],
            currentStake: this.config.stake,
            consecutiveLosses: 0,
        };
    }

    // ── Public ────────────────────────────────────────────────────────────────

    start(): void {
        if (this.state.running) return;
        this.sessionStart = Date.now();
        this.state = { ...this.freshState(), running: true, phase: 'VIRTUAL' };
        this.exitDigits = [];
        this.recovery.reset();
        this.lockRef = false;
        this.lastTickKey = null;
        this.log('🚀 Bot started — virtual mode active');
        this.emit();
    }

    stop(reason = '🛑 Bot stopped manually'): void {
        this.log(reason);
        this.state = { ...this.state, running: false, phase: 'STOPPED' };
        this.lockRef = false;
        this.emit();
    }

    onTick(tickKey: string, digit: number): void {
        if (!this.state.running) return;
        if (tickKey === this.lastTickKey) return;
        this.lastTickKey = tickKey;
        if (this.lockRef) return;

        const { phase } = this.state;

        if (phase === 'VIRTUAL') {
            this.exitDigits.push(digit);
            if (this.exitDigits.length > 20) this.exitDigits.shift();
            this.checkEntrySignal(digit, true);
        } else if (phase === 'RECOVERY') {
            this.handleRecoveryTick(digit);
        } else if (phase === 'REAL') {
            this.exitDigits.push(digit);
            if (this.exitDigits.length > 20) this.exitDigits.shift();
            this.checkEntrySignal(digit, false);
        }
    }

    getState(): BotState { return { ...this.state }; }

    // ── Entry detection ───────────────────────────────────────────────────────

    private checkEntrySignal(digit: number, isVirtual: boolean): void {
        const { strategy, differDigitA = 0, differDigitB = 1 } = this.config;
        let isEntry = false; let dcOk = false;

        if (strategy === 'OVER_1')  { isEntry = digit === 5 || digit === 6; dcOk = checkDCirclesOver1(); }
        else if (strategy === 'UNDER_8') { isEntry = digit === 7 || digit === 4 || digit === 9; dcOk = checkDCirclesUnder8(); }
        else { isEntry = digit === differDigitA || digit === differDigitB; dcOk = checkDCirclesGeneral(); }

        if (!isEntry) return;
        this.log(`📍 Entry digit ${digit} detected`);

        if (!dcOk) { this.log('⛔ DCircles NOT confirmed — skipping'); return; }
        this.log(`✅ DCircles OK — strategy: ${strategy}`);

        if (isVirtual) { this.log('🔁 Switching to REAL mode'); this.setState({ phase: 'REAL' }); }
        void this.executeBatch();
    }

    // ── Batch (3 trades) ──────────────────────────────────────────────────────

    private async executeBatch(): Promise<void> {
        if (this.lockRef) { this.log('⚠️ Lock — batch skipped'); return; }
        this.lockRef = true;

        const { strategy, symbol, differDigitA = 0 } = this.config;
        let contract: string; let barrier: number;

        if      (strategy === 'OVER_1')  { contract = 'DIGITOVER';  barrier = 1; }
        else if (strategy === 'UNDER_8') { contract = 'DIGITUNDER'; barrier = 8; }
        else                             { contract = 'DIGITDIFF';  barrier = differDigitA; }

        const BATCH = 3;
        this.log(`📦 Batch start — ${BATCH} trades | ${contract}:${barrier}`);

        for (let i = 0; i < BATCH; i++) {
            if (!this.state.running) break;
            const tradeStake = this.state.currentStake;
            this.log(`📡 Trade ${i + 1}/${BATCH} — ${symbol} ${contract}:${barrier} @ $${tradeStake.toFixed(2)}`);

            let result: TradeResult;
            try { result = await this.executeTrade(symbol, contract, barrier, tradeStake); }
            catch (err) { this.log(`❌ Error: ${String(err)}`); result = 'LOSS'; }

            this.setState({ tradeCount: this.state.tradeCount + 1 });

            if (result === 'WIN') {
                const gain = +(tradeStake * 0.95).toFixed(2);
                const nextProfit = +(this.state.profit + gain).toFixed(2);
                this.setState({
                    winCount: this.state.winCount + 1,
                    profit: nextProfit,
                    currentStake: this.config.stake,
                    consecutiveLosses: 0,
                });
                this.log(`✅ WIN +$${gain} | P&L $${nextProfit}`);
                this.recordTrade(symbol, contract, barrier, tradeStake, 'WIN', gain, nextProfit, false);
            } else {
                const nextProfit = +(this.state.profit - tradeStake).toFixed(2);
                const consLosses = this.state.consecutiveLosses + 1;
                const mult = this.config.martingaleMultiplier;
                const nextStake = mult > 1 ? +(tradeStake * mult).toFixed(2) : this.config.stake;
                this.setState({
                    lossCount: this.state.lossCount + 1,
                    profit: nextProfit,
                    currentStake: nextStake,
                    consecutiveLosses: consLosses,
                });
                this.log(`❌ LOSS | P&L $${nextProfit}${mult > 1 ? ` | Next stake $${nextStake} (×${mult})` : ''}`);
                this.recordTrade(symbol, contract, barrier, tradeStake, 'LOSS', -tradeStake, nextProfit, false);
                this.recovery.activate();
            }

            if (!this.checkTPSL()) { this.lockRef = false; return; }
        }

        this.log('📦 Batch complete');
        this.lockRef = false;

        if (this.state.running && this.recovery.isActive()) {
            this.setState({ phase: 'RECOVERY' });
            this.log('🔄 Recovery phase — waiting for 3 OVER 6 digits');
        }
    }

    // ── Recovery ──────────────────────────────────────────────────────────────

    private handleRecoveryTick(digit: number): void {
        if (!this.recovery.isActive()) { this.setState({ phase: 'REAL' }); return; }
        const ready = this.recovery.onDigit(digit);
        if (!ready) return;
        if (!checkDCirclesGeneral()) { this.log('⛔ Recovery DCircles check FAILED — waiting'); return; }
        this.log('🔄 3 OVER 6 seen + DCircles OK — firing recovery');
        this.recovery.reset();
        void this.executeRecoveryTrade();
    }

    private async executeRecoveryTrade(): Promise<void> {
        if (this.lockRef) return;
        this.lockRef = true;

        const { contract, barrier } = this.recovery.decideContract(this.exitDigits);
        this.log(`🔄 Recovery trade: ${contract}:${barrier}`);

        let result: TradeResult;
        try { result = await this.executeTrade(this.config.symbol, contract, barrier, this.state.currentStake); }
        catch { result = 'LOSS'; }

        if (result === 'WIN') {
            const gain = +(this.state.currentStake * 0.95).toFixed(2);
            const nextProfit = +(this.state.profit + gain).toFixed(2);
            this.setState({ winCount: this.state.winCount + 1, profit: nextProfit, currentStake: this.config.stake, consecutiveLosses: 0 });
            this.log(`✅ Recovery WIN +$${gain} | P&L $${nextProfit}`);
            this.recordTrade(this.config.symbol, contract, barrier, this.state.currentStake, 'WIN', gain, nextProfit, true);
        } else {
            const tradeStake = this.state.currentStake;
            const nextProfit = +(this.state.profit - tradeStake).toFixed(2);
            const mult = this.config.martingaleMultiplier;
            const nextStake = mult > 1 ? +(tradeStake * mult).toFixed(2) : this.config.stake;
            this.setState({ lossCount: this.state.lossCount + 1, profit: nextProfit, currentStake: nextStake, consecutiveLosses: this.state.consecutiveLosses + 1 });
            this.log(`❌ Recovery LOSS | P&L $${nextProfit}`);
            this.recordTrade(this.config.symbol, contract, barrier, tradeStake, 'LOSS', -tradeStake, nextProfit, true);
        }

        this.lockRef = false;
        if (!this.checkTPSL()) return;
        this.setState({ phase: 'REAL' });
        this.log('↩️ Back to REAL monitoring');
    }

    // ── TP / SL ───────────────────────────────────────────────────────────────

    private checkTPSL(): boolean {
        const { profit } = this.state;
        if (profit >= this.config.targetProfit) { this.stop(`🎯 TAKE PROFIT hit ($${profit.toFixed(2)})`); return false; }
        if (profit <= -this.config.stopLoss)    { this.stop(`🛑 STOP LOSS hit ($${profit.toFixed(2)})`);  return false; }
        return true;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private recordTrade(symbol: string, contract: string, barrier: number, stake: number, result: TradeResult, profit: number, sessionProfit: number, isRecovery: boolean) {
        try {
            BotTradeStore.record({
                timestamp: Date.now(),
                symbol, strategy: this.config.strategy,
                contractType: contract, barrier, stake, result,
                profit, sessionProfit,
                phase: this.state.phase,
                isRecovery,
            });
        } catch {}
    }

    private log(msg: string): void {
        const ts = new Date().toISOString().substring(11, 23);
        const line = `[${ts}] ${msg}`;
        const logs = [line, ...this.state.logs].slice(0, 150);
        this.state = { ...this.state, lastLog: line, logs };
        this.emit();
    }

    private setState(partial: Partial<BotState>): void { this.state = { ...this.state, ...partial }; this.emit(); }
    private emit(): void { this.onStateChange({ ...this.state }); }
}
