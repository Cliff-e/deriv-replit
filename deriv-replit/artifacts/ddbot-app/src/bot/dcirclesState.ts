/**
 * dcirclesState.ts
 *
 * Shared singleton that holds the latest DCircles digit-frequency state
 * and broadcasts updates to all subscribers.
 *
 * The tick feed calls updateDCirclesState() on every new tick.
 * Bot strategies read it via getCurrentDCirclesState() or
 * subscribe with subscribeToDCirclesUpdates().
 */

export interface DigitStats {
    pct: number;
    isRed: boolean;
}

export interface DCirclesState {
    digits: Record<number, DigitStats>;
    updatedAt: number;
}

type DCirclesCallback = (state: DCirclesState) => void;

const subscribers: Set<DCirclesCallback> = new Set();

let currentState: DCirclesState = {
    digits: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [i, { pct: 10, isRed: false }])
    ) as Record<number, DigitStats>,
    updatedAt: 0,
};

export function updateDCirclesState(digitsArray: number[]): void {
    if (!digitsArray || digitsArray.length === 0) return;

    const total = digitsArray.length;
    const freq: Record<number, number> = {};
    for (let d = 0; d <= 9; d++) freq[d] = 0;
    for (const d of digitsArray) {
        if (d >= 0 && d <= 9) freq[d]++;
    }

    const newDigits: Record<number, DigitStats> = {} as Record<number, DigitStats>;
    for (let d = 0; d <= 9; d++) {
        const pct = (freq[d] / total) * 100;
        newDigits[d] = {
            pct,
            isRed: pct > 10 * 1.5,
        };
    }

    currentState = { digits: newDigits, updatedAt: Date.now() };
    for (const cb of subscribers) {
        try { cb(currentState); } catch { /* ignore */ }
    }
}

export function getCurrentDCirclesState(): DCirclesState {
    return currentState;
}

export function subscribeToDCirclesUpdates(callback: DCirclesCallback): () => void {
    subscribers.add(callback);
    return () => { subscribers.delete(callback); };
}
