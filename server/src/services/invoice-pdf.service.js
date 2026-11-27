/** Purpose: draws a sales invoice as an A4 PDF, laid out like the one printed from the website (a packing-list table). */
import PDFDocument from 'pdfkit';

const MM = 72 / 25.4;
const SIDE = 10 * MM;
const TOP = 12 * MM;

/** The PDF's built-in fonts only have Western European characters. */
const DRAWABLE = /^[\t\n\r\x20-\x7E -ÿ–—‘’“”•…€]*$/;

/** True when every text on the invoice can be drawn (Marathi or Hindi text cannot, for example). */
export const canDraw = invoice => [
  invoice.company, invoice.customer.name, invoice.customer.contact, invoice.customer.email,
  ...invoice.items.flatMap(i => [i.product, i.length, i.rack, i.bundleId]),
].every(text => DRAWABLE.test(String(text ?? '')));

/** An empty rack is saved as "—". */
const hasRack = rack => !!rack && !['—', '-'].includes(rack);

/** The length column: the number in the product's CL value ("15/FT" is 15), else the value itself. */
export const lengthOf = clValue => String(clValue ?? '').match(/\d+(\.\d+)?/)?.[0] ?? (String(clValue ?? '').trim() || '-');

const two = n => n.toFixed(2);

/** "23/11/2026" in the reader's time zone (the server itself usually runs on UTC). */
export function formatDate(date, timeZone) {
  const format = zone => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: zone }).format(new Date(date));
  try {
    return format(timeZone || 'Asia/Kolkata');
  } catch {
    return format('Asia/Kolkata'); // an unknown zone name
  }
}

/** The invoice's bundles grouped by product, in the order the products were first added. */
function groupByProduct(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.product}\n${item.dieNo}`;
    const group = groups.get(key) ?? { product: item.product, items: [], pcs: 0, weight: 0 };
    group.items.push(item);
    group.pcs += item.pcs;
    group.weight = Math.round((group.weight + item.weight) * 100) / 100;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The table's columns with their share of the width; Rack only when some bundle has one. */
function columnsFor(withRack) {
  const shares = withRack
    ? [['Sr No', 10, 'center'], ['Barcode', 20, 'left'], ['Rack', 17, 'left'], ['WT', 15, 'right'], ['PC', 15, 'right'], ['LE', 8, 'center'], ['WT/PC', 15, 'right']]
    : [['Sr No', 10, 'center'], ['Barcode', 27, 'left'], ['WT', 17, 'right'], ['PC', 17, 'right'], ['LE', 12, 'center'], ['WT/PC', 17, 'right']];
  return shares.map(([title, share, align]) => ({ title, share: share / 100, align }));
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
  const bottom = doc.page.height - TOP - 12; // room for the page number
  const ROW = 17.5;
  const SIZE = 10;
  const withRack = invoice.items.some(i => hasRack(i.rack));
  const columns = columnsFor(withRack);
  let y = TOP;

  const INK = '#0f1b2a';
  const MUTED = '#5d6e83';
  const font = (size, bold = false, color = INK) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  /** One line of text inside a box; a long value is printed smaller rather than cut or wrapped. */
  const fit = (value, x, top, w, height, { align = 'left', bold = false, size = SIZE, color = INK } = {}) => {
    let s = size;
    font(s, bold, color);
    while (s > 5.5 && doc.widthOfString(value) > w - 10) font((s -= 0.5), bold, color);
    doc.text(value, x + 5, top + (height - s) / 2 + 0.5, { width: w - 10, height: s + 3, align, lineBreak: false });
  };
  const box = (x, top, w, height, { fill, stroke = '#c3cedb' } = {}) => {
    if (fill) doc.rect(x, top, w, height).fill(fill);
    doc.rect(x, top, w, height).lineWidth(0.6).strokeColor(stroke).stroke();
  };
  /** The colours of each kind of row. */
  const STYLES = {
    head: { fill: '#123c55', stroke: '#123c55', color: '#ffffff', bold: true },
    product: { fill: '#dff1f6', color: '#08546b', bold: true },
    sum: { fill: '#eef3f9', bold: true },
    total: { fill: '#1769a8', stroke: '#1769a8', color: '#ffffff', bold: true },
    even: {},
    odd: { fill: '#f8fafc' },
  };
  /** A row of the table: one value per column. `spans` merges the first columns into one cell. */
  const row = (values, { style = STYLES.even, spans = 1, align, boldColumn } = {}) => {
    let x = SIDE;
    let column = 0;
    values.forEach((value, i) => {
      const count = i === 0 ? spans : 1;
      const w = columns.slice(column, column + count).reduce((n, c) => n + c.share, 0) * width;
      box(x, y, w, ROW, style);
      if (value !== '') fit(String(value), x, y, w, ROW, { align: align ?? (count > 1 ? 'left' : columns[column].align), bold: style.bold || i === boldColumn, color: style.color });
      x += w;
      column += count;
    });
    y += ROW;
  };
  const header = () => row(columns.map(c => c.title), { style: STYLES.head, align: 'center' });
  /** Starts a new page, with the column headings again, when the next `height` points do not fit. */
  const need = height => {
    if (y + height > bottom) {
      doc.addPage();
      y = TOP;
      header();
    }
  };

  // ---- the coloured heading: title and company at the left, invoice number and date at the right ----
  const BANNER = 54;
  const gradient = doc.linearGradient(SIDE, y, SIDE + width, y + BANNER);
  gradient.stop(0, '#0b1f2f').stop(0.55, '#0f3b54').stop(1, '#176b8a');
  doc.roundedRect(SIDE, y, width, BANNER, 7).fill(gradient);
  fit('SALES INVOICE', SIDE + 8, y + 9, width * 0.6, 22, { bold: true, size: 16, color: '#ffffff' });
  fit(invoice.company || ' ', SIDE + 8, y + 31, width * 0.6, 15, { size: 9.5, color: '#cfe4ee' });
  fit(invoice.saleNo, SIDE + width * 0.6 - 8, y + 9, width * 0.4, 20, { bold: true, size: 13, color: '#ffffff', align: 'right' });
  fit(`Date  ${formatDate(invoice.issuedAt ?? invoice.createdAt, timeZone)}`, SIDE + width * 0.6 - 8, y + 30, width * 0.4, 16, { bold: true, size: 10, color: '#ffffff', align: 'right' });
  y += BANNER + 8;

  // ---- the customer, and the three totals beside it ----
  const GAP = 6;
  const customerWidth = (width - GAP * 3) * (2.2 / 5.2);
  const statWidth = (width - GAP * 3 - customerWidth) / 3;
  const name = invoice.customer.name.toUpperCase();
  const contact = [invoice.customer.contact, invoice.customer.email].filter(Boolean).join(' · ');
  font(11.5, true);
  const nameHeight = doc.heightOfString(name, { width: customerWidth - 16 });
  font(8.5);
  const contactHeight = doc.heightOfString(contact, { width: customerWidth - 16 });
  const info = Math.max(46, 17 + nameHeight + contactHeight + 6);
  doc.roundedRect(SIDE, y, customerWidth, info, 6).lineWidth(0.7).strokeColor('#d5dee9').stroke();
  font(7.5, true, MUTED).text('BILLED TO', SIDE + 8, y + 6, { lineBreak: false });
  font(11.5, true).text(name, SIDE + 8, y + 17, { width: customerWidth - 16 });
  font(8.5, false, '#3d4d61').text(contact, SIDE + 8, y + 18 + nameHeight, { width: customerWidth - 16 });
  [['BUNDLES', invoice.totals.bundles], ['TOTAL PCS', invoice.totals.pcs], ['TOTAL WEIGHT', `${two(invoice.totals.weight)} Kg`]].forEach(([label, value], i) => {
    const x = SIDE + customerWidth + GAP + i * (statWidth + GAP);
    doc.roundedRect(x, y, statWidth, info, 6).fill('#eef3f9');
    fit(label, x + 2, y + info / 2 - 17, statWidth - 4, 11, { bold: true, size: 7.5, color: MUTED });
    fit(String(value), x + 2, y + info / 2 - 2, statWidth - 4, 17, { bold: true, size: 13 });
  });
  y += info + 8;
  header();

  const empty = columns.map(() => '');
  const wt = withRack ? 3 : 2; // the position of the weight column
  let sr = 0;
  for (const group of groupByProduct(invoice.items)) {
    need(ROW * 2); // the product name stays with its first bundle
    row([group.product], { style: STYLES.product, spans: columns.length });
    let stripe = 0;
    for (const item of group.items) {
      need(ROW);
      const values = [++sr, item.bundleId, two(item.weight), two(item.pcs), lengthOf(item.length), item.pcs > 0 ? two(item.weight / item.pcs) : '-'];
      if (withRack) values.splice(2, 0, hasRack(item.rack) ? item.rack : '');
      row(values, { style: stripe++ % 2 ? STYLES.even : STYLES.odd, boldColumn: 1 });
    }
    need(ROW);
    const subtotal = [...empty];
    subtotal[wt] = two(group.weight);
    subtotal[wt + 1] = two(group.pcs);
    row(subtotal, { style: STYLES.sum });
  }
  need(ROW);
  const count = invoice.totals.bundles;
  row([`GRAND TOTAL · ${count} ${count === 1 ? 'bundle' : 'bundles'}`, two(invoice.totals.weight), two(invoice.totals.pcs), '', ''], { style: STYLES.total, spans: wt });

  if (y + 38 <= bottom) {
    font(9, false, MUTED).text('Thank you for your business!', SIDE, y + 20, { width, align: 'center', lineBreak: false });
  }

  const { count: pageCount } = doc.bufferedPageRange();
  if (pageCount > 1) {
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // writing inside the margin must not start another page
      font(8.5);
      doc.text(`${invoice.saleNo} · Page ${i + 1} of ${pageCount}`, SIDE, doc.page.height - TOP + 4, { width, align: 'right', lineBreak: false });
    }
  }
  doc.end();
  return done;
}
