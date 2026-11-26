/** Purpose: CSV file download helper used by the stock and report exports. */
export function sendCsv(res, filename, header, rows) {
  // text starting with = + - @ would be run as a formula by Excel / Sheets, so it gets a leading quote mark
  const safe = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v ?? ''));
  const esc = v => `"${safe(v).replace(/"/g, '""')}"`;
  const body = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body);
}
