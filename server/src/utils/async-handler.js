/** Forwards rejected promises from async route handlers to Express' error middleware. */
export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
