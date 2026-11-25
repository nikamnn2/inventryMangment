/** Purpose: validation for customers and suppliers. */
import { str } from '../utils/index.js';

/** Customers and suppliers share the same shape. */
export function parseParty(body) {
  return {
    name: str(body?.name, 'Name', { required: true }),
    city: str(body?.city, 'City', { max: 60 }),
    contact: str(body?.contact, 'Contact', { max: 60 }),
    detail: str(body?.detail, 'Details', { max: 200 }),
    status: 'Active',
  };
}
