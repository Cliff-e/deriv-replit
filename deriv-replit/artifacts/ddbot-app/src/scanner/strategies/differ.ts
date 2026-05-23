/**
 * differ.ts — DIFFER strategy scanner (ddbot-app)
 *
 * ONLY CHANGE: entry rule — cursor touches digit A OR digit B.
 * All other Differ logic unchanged.
 */

export const differStrategy = (
    ticks: (number | string)[],
    digitA: number,
    digitB: number
) => {
    if (!ticks || ticks.length === 0) return null;

    const last = ticks[ticks.length - 1];
    const digit = Number(String(last).slice(-1));

    if (digit !== digitA && digit !== digitB) return null;

    return {
        contract: 'DIGITDIFF',
        barrier: digit,
        probability: 50,
        meta: { entryDigit: digit }
    };
};

export const differ = differStrategy;
