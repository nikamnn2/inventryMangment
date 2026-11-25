/** Purpose: escapes user search text so it is matched literally inside MongoDB regex queries (prevents regex injection). */
export const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
