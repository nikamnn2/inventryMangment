/** Purpose: validation for products and the allowed categories. */
import { oneOf, str } from '../utils/index.js';

/** Product types the business sells; each has its own rate in the settings. */
export const CATEGORIES = ['Aluminium', 'Glass'];

/** Validates a product payload and returns the document fields. */
export function parseProduct(body) {
  return {
    dieNo: str(body?.dieNo, 'Die No', { required: true, max: 40 }),
    name: str(body?.name, 'Product name', { required: true }),
    category: oneOf(body?.category ?? 'Aluminium', 'Type', CATEGORIES),
    size: str(body?.size, 'Size', { max: 80 }),
    clValue: str(body?.clValue, 'CL value', { max: 40 }),
    finish: str(body?.finish, 'Finish', { max: 80 }),
  };
}
