/** Purpose: draws a sales invoice as an A4 PDF, laid out like the one printed from the website. */
import PDFDocument from 'pdfkit';

const MM = 72 / 25.4;
const SIDE = 16 * MM;
const TOP = 14 * MM;

/** The PDF's built-in fonts only have Western European characters. */
const DRAWABLE = /^[\t\n\r\x20-\x7E -ÿ–—‘’“”•…€]*$/;

/** True when every text on the invoice can be drawn (Marathi or Hindi text cannot, for example). */
export const canDraw = invoice => [
  invoice.company, invoice.customer.name, invoice.customer.contact, invoice.customer.email,
  ...invoice.items.flatMap(i => [i.product, i.dieNo, i.rack, i.bundleId]),
].every(text => DRAWABLE.test(String(text ?? '')));

/** An empty rack is saved as "—". */
const hasRack = rack => !!rack && !['—', '-'].includes(rack);

const upTo2 = n => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const exactly2 = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Oct 14, 2026, 03:49 PM" in the reader's time zone (the server itself usually runs on UTC). */
export function formatDate(date, timeZone) {
  const options = { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true };
  const format = zone => new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).format(new Date(date));
  let text;
  try {
    text = format(timeZone || 'Asia/Kolkata');
  } catch {
    text = format('Asia/Kolkata'); // an unknown zone name
  }
  return text.replace(/ /g, ' ').replace(' at ', ', ');
}

/** The invoice's bundles grouped by product, in the order the products were first added. */
function groupByProduct(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.product}\n${item.dieNo}`;
    const group = groups.get(key) ?? { product: item.product, dieNo: item.dieNo, items: [], pcs: 0, weight: 0 };
    group.items.push(item);
    group.pcs += item.pcs;
    group.weight = Math.round((group.weight + item.weight) * 100) / 100;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Builds the PDF; resolves to its bytes. `compress: false` keeps the text readable for tests. */
export function renderInvoicePdf(invoice, { timeZone, compress = true } = {}) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: TOP, bottom: TOP, left: SIDE, right: SIDE }, bufferPages: true, compress, info: { Title: `Sales invoice ${invoice.saleNo}` } });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - SIDE * 2;
  const bottom = doc.page.height - TOP - 14; // room for the page number
  let y = TOP;

  const font = (size, bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor('#111111');
  /** Starts a new page when the next `height` points do not fit, so lines and totals are never split. */
  const need = height => {
    if (y + height > bottom) {
      doc.addPage();
      y = TOP;
    }
  };
  /** One block of wrapped text; moves down by its height. */
  const text = (value, { size = 10, bold = false, indent = 0, align = 'left', gap = 3, w = width - indent } = {}) => {
    font(size, bold);
    const height = doc.heightOfString(value, { width: w, align });
    need(height);
    doc.text(value, SIDE + indent, y, { width: w, align });
    y += height + gap;
  };
  /** Text at the left and at the right of the same line. */
  const pair = (left, right, { size = 10, bold = false, rightSize = size, rightBold = bold, gap = 4 } = {}) => {
    font(rightSize, rightBold);
    const rightWidth = doc.widthOfString(right) + 2;
    font(size, bold);
    const height = doc.heightOfString(left, { width: width - rightWidth - 12 });
    need(height);
    doc.text(left, SIDE, y, { width: width - rightWidth - 12 });
    font(rightSize, rightBold);
    doc.text(right, SIDE + width - rightWidth, y, { width: rightWidth, align: 'right' });
    y += height + gap;
  };
  const rule = () => {
    need(16);
    y += 5;
    doc.moveTo(SIDE, y).lineTo(SIDE + width, y).lineWidth(0.7).strokeColor('#555555').stroke();
    y += 10;
  };

  text('SALES INVOICE', { size: 17, bold: true, align: 'center', gap: 8 });
  text(invoice.company || ' ', { size: 10, align: 'center', gap: 8 });
  rule();
  pair(`Sale Number: ${invoice.saleNo}`, `Date: ${formatDate(invoice.issuedAt ?? invoice.createdAt, timeZone)}`, { size: 11, bold: true, rightSize: 10, rightBold: false, gap: 12 });
  text('Customer Details:', { size: 11, bold: true, gap: 5 });
  text(`Name: ${invoice.customer.name}`, { gap: 5 });
  text(`Contact: ${invoice.customer.contact}`, { gap: 5 });
  if (invoice.customer.email) text(`Email: ${invoice.customer.email}`, { gap: 5 });
  rule();
  text('Bundle Details:', { size: 12, bold: true, gap: 8 });

  for (const group of groupByProduct(invoice.items)) {
    need(48); // the heading stays with its first bundle
    pair(`${group.product} (Die: ${group.dieNo || '-'})`, `${group.items.length} ${group.items.length === 1 ? 'bundle' : 'bundles'}`, { size: 11, bold: true, rightSize: 10, gap: 5 });
    for (const item of group.items) {
      const rack = hasRack(item.rack) ? `, Rack: ${item.rack}` : '';
      text(`Bundle ${item.bundleId}: ${upTo2(item.weight)} Kg, ${item.pcs} PCS${rack}`, { indent: 16, gap: 2.5 });
    }
    text(`Subtotal: ${exactly2(group.weight)} Kg, ${group.pcs} PCS`, { bold: true, indent: 12, gap: 11 });
  }

  need(56);
  rule();
  pair('GRAND TOTAL:', `${exactly2(invoice.totals.weight)} Kg`, { size: 12, bold: true, gap: 6 });
  pair(`Total PCS: ${invoice.totals.pcs}`, `Total Bundles: ${invoice.totals.bundles}`, { size: 12, bold: true });
  need(60);
  y += 36;
  text('Thank you for your business!', { align: 'center' });

  const { count } = doc.bufferedPageRange();
  if (count > 1) {
    for (let i = 0; i < count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // writing inside the margin must not start another page
      font(8.5);
      doc.text(`${invoice.saleNo} · Page ${i + 1} of ${count}`, SIDE, doc.page.height - TOP + 4, { width, align: 'right', lineBreak: false });
    }
  }
  doc.end();
  return done;
}
