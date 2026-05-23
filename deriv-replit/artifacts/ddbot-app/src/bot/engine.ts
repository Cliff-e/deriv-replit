type BotConfig = {
    stake: number;
    martingale: number;
    stopLoss: number;
    targetWins?: number;
    targetProfit?: number;
};

type TradeSignal = {
    symbol: string;
    contract: string;
    barrier: number;
};

export class BotEngine {
    private cycles = 0;
    private losses = 0;
    private profit = 0;
    private running = false;

    private maxCycles = 2;
    private signal!: TradeSignal;
    private getTicks!: () => (number | string)[];

    constructor(private config: BotConfig) {}

    // 🚀 START
    start(signal: TradeSignal, getTicks: () => (number | string)[]) {
        this.running = true;
        this.signal = signal;
        this.cycles = 0;
        this.losses = 0;
        this.profit = 0;
        this.getTicks = getTicks;

        console.log('🤖 Bot started (waiting for entry...)');

        this.waitForEntry();
    }

    stop() {
        this.running = false;
        console.log('🛑 Bot stopped');
    }

    // 🎯 WAIT FOR ENTRY (5 or 6)
    private waitForEntry() {
        if (!this.running) return;

        const ticks = this.getTicks();

        if (!ticks || ticks.length === 0) {
            return setTimeout(() => this.waitForEntry(), 300);
        }

        const last = ticks[ticks.length - 1];
        const digit = Number(String(last).slice(-1));

        if (digit === 5 || digit === 6) {
            console.log(`🎯 Entry hit on digit ${digit}`);
            this.runCycle();
            return;
        }

        setTimeout(() => this.waitForEntry(), 200);
    }

    // 🔁 CYCLE
    private runCycle() {
        if (!this.running) return;

        if (this.cycles >= this.maxCycles) {
            console.log('🎯 Completed 2 cycles');
            return this.stop();
        }

        console.log(`🔁 Cycle ${this.cycles + 1}`);
        this.tradeOver1();
    }

    // 🔹 OVER 1
    private tradeOver1() {
        const stake = this.getStake();

        console.log('📡 OVER 1', stake);

        const win = this.simulate();

        if (win) {
            this.finishCycle(stake);
        } else {
            this.losses++;
            console.log('❌ Lost OVER 1 → UNDER 5');
            this.tradeUnder5(stake);
        }
    }

    // 🔻 UNDER 5
    private tradeUnder5(stake: number) {
        console.log('📡 UNDER 5');

        const win = this.simulate();

        if (win) {
            this.finishCycle(stake);
        } else {
            this.losses++;
            console.log('❌ Lost UNDER 5 → OVER 5 loop');
            this.tradeOver5Loop(stake);
        }
    }

    // 🔁 OVER 5 LOOP
    private tradeOver5Loop(stake: number) {
        console.log('🔁 LOOP: OVER 5');

        let win = false;

        while (!win && this.running) {
            this.losses++;
            win = this.simulate();
        }

        if (win) {
            this.finishCycle(stake);
        }
    }

    // ✅ FINISH CYCLE
    private finishCycle(stake: number) {
        this.cycles++;
        this.losses = 0;
        this.profit += stake;

        console.log(`✅ Cycle ${this.cycles}/${this.maxCycles} | Profit: ${this.profit}`);

        // 🎯 STOP CONDITIONS
        if (this.config.targetWins && this.cycles >= this.config.targetWins) {
            console.log('🎯 Target wins reached');
            return this.stop();
        }

        if (this.config.targetProfit && this.profit >= this.config.targetProfit) {
            console.log('💰 Target profit reached');
            return this.stop();
        }

        if (this.profit <= -this.config.stopLoss) {
            console.log('🛑 Stop loss hit');
            return this.stop();
        }

        // 🔁 WAIT FOR NEXT ENTRY
        setTimeout(() => this.waitForEntry(), 500);
    }

    // 💰 MARTINGALE
    private getStake() {
        return this.config.stake * Math.pow(this.config.martingale, this.losses);
    }

    // 🎲 SIMULATION (replace later)
    private simulate() {
        return Math.random() > 0.45;
    }
}