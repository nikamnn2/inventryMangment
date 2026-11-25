/** Purpose: rounds money / weight values to 2 decimals without floating-point drift (e.g. 1.005 -> 1.01). */
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
