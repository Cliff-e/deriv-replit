/**
 * advancedBotEngine.ts  — Production-grade strategy engine
 *
 * Strategies:
 *   DIFFER   entry on user-selected Digit A or Digit B (only entry change)
 *   OVER_1   DCircles: digits 0&1 < 10.50% + no red bar; entry: 5 or 6; 3 trades/batch
 *   UNDER_8  DCircles: digits 8&9 < 10.50% + no red bar; entry: 7, 4, or 9; 3 trades/batch
 *
 * Safety:
 *   - Execution lock (one trade at a time)
 *   - Per-tick debounce (same tick epoch never triggers twice)
 *   - Async race protection via lockRef
 *   - Virtual mode before confirmed entry
 *   - Shared RecoveryStrategyEngine (triggers only on REAL trade loss)
 *   - TP / SL session control
 */

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
}

export type TradeResult = 'WIN' | 'LOSS';

export type ExecuteTradeFn = (
    symbol: string,
    contractType: string,
    barrier: number,
    stake: number
) => Promise<TradeResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Digit store — virtual + real exit digits, tracks last 20 total
// ─────────────────────────────────────────────────────────────────────────────

interface DigitStore {
    virtual: number[];
    real: number[];
}

function createDigitStore(): DigitStore {
    return { virtual: [], real: [] };
}

function addVirtualExitDigit(store: DigitStore, digit: number): void {
    store.virtual.push(digit);
    if (store.virtual.length > 20) store.virtual.shift();
}

function addRealExitDigit(store: DigitStore, digit: number): void {
    store.real.push(digit);
    if (store.real.length > 20) store.real.shift();
}

function getLast20Digits(store: DigitStore): number[] {
    return [...store.virtual, ...store.real].slice(-20);
}

// ─────────────────────────────────────────────────────────────────────────────
// DCircles confirmation
// ─────────────────────────────────────────────────────────────────────────────

function checkDCirclesOver1(): boolean {
    const s = getCurrentDCirclesState();
    const d0 = s.digits[0];
    const d1 = s.digits[1];
    if (!d0 || !d1) return false;
    return d0.pct < 10.5 && !d0.isRed && d1.pct < 10.5 && !d1.isRed;
}

function checkDCirclesUnder8(): boolean {
    const s = getCurrentDCirclesState();
    const d8 = s.digits[8];
    const d9 = s.digits[9];
    if (!d8 || !d9) return false;
    return d8.pct < 10.5 && !d8.isRed && d9.pct < 10.5 && !d9.isRed;
}

function checkDCirclesGeneral(): boolean {
    const s = getCurrentDCirclesState();
    if (s.updatedAt === 0) return true;
    return Object.values(s.digits).every(d => !d.isRed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recovery engine — shared, one per BotEngine instance
// ─────────────────────────────────────────────────────────────────────────────

class RecoveryStrategyEngine {
    private over6Counter = 0;
    private active = false;

    reset(): void {
        this.over6Counter = 0;
        this.active = false;
    }

    activate(): void {
        this.active = true;
        this.over6Counter = 0;
    }

    isActive(): boolean {
        return this.active;
    }

    /** Feed digit; returns true when 3 OVER 6 digits seen */
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
    private digitStore = createDigitStore();
    private recovery = new RecoveryStrategyEngine();

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
            running: false,
            phase: 'IDLE',
            profit: 0,
            tradeCount: 0,
            winCount: 0,
            lossCount: 0,
            lastLog: '',
            logs: [],
            currentStake: this.config.stake,
        };
    }

    // ── Public API ────────────────────────────────────────────────────────────

    start(): void {
        if (this.state.running) return;
        this.state = { ...this.freshState(), running: true, phase: 'VIRTUAL' };
        this.digitStore = createDigitStore();
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

    /**
     * Feed every new tick here. Call from WS message handler.
     * @param tickKey  unique per tick (e.g. `${symbol}:${epoch}`)
     * @param digit    last digit 0–9
     */
    onTick(tickKey: string, digit: number): void {
        if (!this.state.running) return;
        if (tickKey === this.lastTickKey) return;
        this.lastTickKey = tickKey;

        if (this.lockRef) return;

        const { phase } = this.state;

        if (phase === 'VIRTUAL') {
            addVirtualExitDigit(this.digitStore, digit);
            this.checkEntrySignal(digit, true);
            return;
        }

        if (phase === 'RECOVERY') {
            this.handleRecoveryTick(digit);
            return;
        }

        if (phase === 'REAL') {
            addVirtualExitDigit(this.digitStore, digit);
            this.checkEntrySignal(digit, false);
        }
    }

    getState(): BotState {
        return { ...this.state };
    }

    // ── Entry detection ───────────────────────────────────────────────────────

    private checkEntrySignal(digit: number, isVirtual: boolean): void {
        const { strategy, differDigitA = 0, differDigitB = 1 } = this.config;

        let isEntry = false;
        let dcOk = false;

        if (strategy === 'OVER_1') {
            isEntry = digit === 5 || digit === 6;
            dcOk = checkDCirclesOver1();
        } else if (strategy === 'UNDER_8') {
            isEntry = digit === 7 || digit === 4 || digit === 9;
            dcOk = checkDCirclesUnder8();
        } else {
            isEntry = digit === differDigitA || digit === differDigitB;
            dcOk = checkDCirclesGeneral();
        }

        if (!isEntry) return;

        this.log(`📍 Entry detected — digit ${digit}`);

        if (!dcOk) {
            this.log('⛔ DCircles confirmation FAILED — skipping entry');
            return;
        }

        this.log(`✅ DCircles confirmation PASSED — strategy: ${strategy}`);

        if (isVirtual) {
            this.log('🔁 Switching to REAL mode');
            this.setState({ phase: 'REAL' });
        }

        void this.executeBatch();
    }

    // ── Batch execution (3 trades per entry) ─────────────────────────────────

    private async executeBatch(): Promise<void> {
        if (this.lockRef) {
            this.log('⚠️ Lock active — batch skipped');
            return;
        }
        this.lockRef = true;

        const { strategy, symbol, differDigitA = 0 } = this.config;
        const BATCH_SIZE = 3;

        let contract: string;
        let barrier: number;

        if (strategy === 'OVER_1') {
            contract = 'DIGITOVER';
            barrier = 1;
        } else if (strategy === 'UNDER_8') {
            contract = 'DIGITUNDER';
            barrier = 8;
        } else {
            contract = 'DIGITDIFF';
            barrier = differDigitA;
        }

        this.log(`📦 Batch start — ${BATCH_SIZE} trades | ${contract}:${barrier}`);

        for (let i = 0; i < BATCH_SIZE; i++) {
            if (!this.state.running) break;

            const tradeStake = this.state.currentStake;
            this.log(`📡 Trade ${i + 1}/${BATCH_SIZE} — ${symbol} ${contract}:${barrier} @ $${tradeStake.toFixed(2)}`);

            let result: TradeResult;
            try {
                result = await this.executeTrade(symbol, contract, barrier, tradeStake);
            } catch (err) {
                this.log(`❌ Trade error: ${String(err)}`);
                result = 'LOSS';
            }

            addRealExitDigit(this.digitStore, barrier);
            this.setState({ tradeCount: this.state.tradeCount + 1 });

            if (result === 'WIN') {
                const gain = +(tradeStake * 0.95).toFixed(2);
                this.setState({
                    winCount: this.state.winCount + 1,
                    profit: +(this.state.profit + gain).toFixed(2),
                    currentStake: this.config.stake,
                });
                this.log(`✅ WIN | profit +$${gain} | total $${this.state.profit.toFixed(2)}`);
            } else {
                this.setState({
                    lossCount: this.state.lossCount + 1,
                    profit: +(this.state.profit - tradeStake).toFixed(2),
                });
                this.log(`❌ LOSS | total $${this.state.profit.toFixed(2)}`);
                this.recovery.activate();
                this.log('🔄 Recovery engine activated');
            }

            if (!this.checkTPSL()) {
                this.lockRef = false;
                return;
            }
        }

        this.log('📦 Batch complete — waiting for next entry');
        this.lockRef = false;

        if (this.state.running && this.recovery.isActive()) {
            this.setState({ phase: 'RECOVERY' });
            this.log('🔄 Entering RECOVERY phase — waiting for 3 OVER 6 digits');
        }
    }

    // ── Recovery tick handler ─────────────────────────────────────────────────

    private handleRecoveryTick(digit: number): void {
        if (!this.recovery.isActive()) {
            this.setState({ phase: 'REAL' });
            return;
        }

        const ready = this.recovery.onDigit(digit);
        if (!ready) return;

        if (!checkDCirclesGeneral()) {
            this.log('⛔ Recovery DCircles check FAILED — waiting');
            return;
        }

        this.log('🔄 Recovery trigger ready: 3 OVER 6 seen + DCircles OK');
        this.recovery.reset();
        void this.executeRecoveryTrade();
    }

    private async executeRecoveryTrade(): Promise<void> {
        if (this.lockRef) return;
        this.lockRef = true;

        const last20 = getLast20Digits(this.digitStore);
        const { contract, barrier } = this.recovery.decideContract(last20);

        this.log(`🔄 Recovery trade: ${contract}:${barrier}`);

        let result: TradeResult;
        try {
            result = await this.executeTrade(
                this.config.symbol, contract, barrier, this.state.currentStake
            );
        } catch {
            result = 'LOSS';
        }

        if (result === 'WIN') {
            const gain = +(this.state.currentStake * 0.95).toFixed(2);
            this.setState({
                winCount: this.state.winCount + 1,
                profit: +(this.state.profit + gain).toFixed(2),
                currentStake: this.config.stake,
            });
            this.log(`✅ Recovery WIN | total $${this.state.profit.toFixed(2)}`);
        } else {
            this.setState({
                lossCount: this.state.lossCount + 1,
                profit: +(this.state.profit - this.state.currentStake).toFixed(2),
            });
            this.log(`❌ Recovery LOSS | total $${this.state.profit.toFixed(2)}`);
        }

        this.lockRef = false;

        if (!this.checkTPSL()) return;

        this.setState({ phase: 'REAL' });
        this.log('↩️ Recovery done — back to REAL monitoring');
    }

    // ── TP / SL ───────────────────────────────────────────────────────────────

    private checkTPSL(): boolean {
        const { profit } = this.state;
        const { targetProfit, stopLoss } = this.config;

        if (profit >= targetProfit) {
            this.stop(`🎯 TAKE PROFIT hit ($${profit.toFixed(2)}) — session ended`);
            return false;
        }
        if (profit <= -stopLoss) {
            this.stop(`🛑 STOP LOSS hit ($${profit.toFixed(2)}) — session ended`);
            return false;
        }
        return true;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private log(msg: string): void {
        const ts = new Date().toISOString().substring(11, 23);
        const line = `[${ts}] ${msg}`;
        const logs = [line, ...this.state.logs].slice(0, 150);
        this.state = { ...this.state, lastLog: line, logs };
        console.log('[AdvancedBot]', msg);
        this.emit();
    }

    private setState(partial: Partial<BotState>): void {
        this.state = { ...this.state, ...partial };
        this.emit();
    }

    private emit(): void {
        this.onStateChange({ ...this.state });
    }
}
