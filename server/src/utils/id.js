import { randomBytes } from 'node:crypto';

/** Purpose: generates a unique 16-character hex ID for a new bundle (also the value encoded in its barcode / QR code). */
export const newBundleId = () => randomBytes(8).toString('hex');
