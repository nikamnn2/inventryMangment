/** Purpose: CSV file download helper used by the stock and report exports. */
export function sendCsv(res, filename, header, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body);
}
