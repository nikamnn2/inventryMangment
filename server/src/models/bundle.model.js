/** Purpose: rules for a bundle (die no, pieces, weight, packed date, rack, status): validation and the average-weight-per-piece calculation. */
import { HttpError, isoDate, num, oneOf, round2, str } from '../utils/index.js';

/** Allowed bundle statuses: Packed -> Shipped (out for delivery) -> Sold. */
export const BUNDLE_STATUSES = ['Packed', 'Shipped', 'Sold'];

/** Adds avgWeight (kg per piece) to a bundle for display. */
export const withAvg = b => ({ ...b, avgWeight: b.pieces > 0 ? Math.round((b.weight / b.pieces) * 1000) / 1000 : 0 });

/** Validates a bundle payload. `products` is the products collection, used to check the Die No exists. */
export async function parseBundle(body, products, { creating }) {
  const dieNo = str(body?.dieNo, 'Product / Die No', { required: true, max: 40 });
  if (!(await products.findOne({ dieNo }))) throw new HttpError(400, `Unknown product Die No ${dieNo}.`);
  const pieces = num(body?.pieces, 'Pieces', { integer: true, min: creating ? 1 : 0 });
  const weight = num(body?.weight, 'Weight', creating ? { min: 0, exclusiveMin: true } : { min: 0 });
  const packed = str(body?.packed, 'Date packed', { max: 10 }) || isoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(packed) || Number.isNaN(Date.parse(packed))) throw new HttpError(400, 'Date packed must be YYYY-MM-DD.');
  return {
    dieNo,
    pieces,
    weight: round2(weight),
    packed,
    rack: str(body?.rack, 'Rack', { max: 20 }) || '—',
    status: oneOf(body?.status ?? 'Packed', 'Status', creating ? ['Packed', 'Shipped'] : BUNDLE_STATUSES),
  };
}
