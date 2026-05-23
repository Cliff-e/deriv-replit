/**
 * differ.ts — DIFFER strategy scanner
 *
 * ONLY CHANGE: Entry rule now fires when cursor touches
 * digit A OR digit B (user-selected).
 *
 * All other Differ logic (TP/SL, recovery, DCircles confirmation,
 * execution) remains unchanged.
 */

export const differStrategy = (
    ticks: (number | string)[],
    digitA: number,
    digitB: number
) => {
    if (!ticks || ticks.length === 0) return null;

    const last = ticks[ticks.length - 1];
    const digit = Number(String(last).slice(-1));

    // NEW ENTRY RULE: digit A OR digit B
    if (digit !== digitA && digit !== digitB) return null;

    return {
        contract: 'DIGITDIFF',
        barrier: digit,
        probability: 50,
        meta: {
            entryDigit: digit,
            matchedA: digit === digitA,
            matchedB: digit === digitB,
        }
    };
};

// Legacy default export for backward compatibility with runStrategy()
export const differ = differStrategy;
