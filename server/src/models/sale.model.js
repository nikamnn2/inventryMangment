/** Purpose: validation of the "record a sale" request (which bundle, how many pieces, which customer). */
import { num, str } from '../utils/index.js';

/** Validates a "record a sale" request. */
export function parseSaleRequest(body) {
  return {
    bundleId: str(body?.bundleId, 'Bundle', { required: true, max: 64 }),
    quantity: num(body?.quantity, 'Quantity', { integer: true, min: 1 }),
    customer: str(body?.customer, 'Customer', { max: 120 }) || 'Walk-in customer',
  };
}
