/** Purpose: company settings: default values and validation. */
import { num, oneOf, str } from '../utils/index.js';

/** The settings collection holds a single document with this id. */
export const SETTINGS_ID = 'main';

/** Used until an admin saves their own settings (company, low-stock limit, price per kg for each category). */
export const DEFAULT_SETTINGS = {
  _id: SETTINGS_ID,
  company: 'Siddheshwar Aluminium & Glass',
  gstin: '',
  phone: '',
  lowStockLimit: 20,
  weightUnit: 'kg',
  rates: { Aluminium: 310, Glass: 95 },
};

/** Validates the settings form and returns the document fields. */
export function parseSettings(b = {}) {
  return {
    company: str(b.company, 'Company name', { required: true }),
    gstin: str(b.gstin, 'GSTIN', { max: 20 }),
    phone: str(b.phone, 'Phone', { max: 30 }),
    lowStockLimit: num(b.lowStockLimit, 'Low-stock threshold', { integer: true, min: 1 }),
    weightUnit: oneOf(b.weightUnit ?? 'kg', 'Weight unit', ['kg', 'tonnes']),
    rates: {
      Aluminium: num(b.rates?.Aluminium, 'Aluminium rate', { min: 0 }),
      Glass: num(b.rates?.Glass, 'Glass rate', { min: 0 }),
    },
  };
}
