import { TestBed } from '@angular/core/testing';
import { Invoice, InvoiceLine } from '../../../core/services/invoice.service';
import { InvoiceSheetComponent, groupByProduct, lengthOf } from './invoice-sheet.component';

const line = (bundleId: string, product: string, pcs: number, weight: number, more: Partial<InvoiceLine> = {}): InvoiceLine =>
  ({ bundleId, dieNo: '', product, size: '', length: '15/FT', pcs, weight, ...more });
const ITEMS = [line('SV118', '1.5+1 PLAIN PIPE', 40, 44.9), line('SV129', '1.5X1 L PIPE', 40, 44.1), line('SV119', '1.5+1 PLAIN PIPE', 40, 44.94)];

describe('InvoiceSheetComponent', () => {
  function render(items: InvoiceLine[], more: Partial<Invoice> = {}) {
    const fixture = TestBed.createComponent(InvoiceSheetComponent);
    const totals = { bundles: items.length, pcs: items.reduce((n, i) => n + i.pcs, 0), weight: Math.round(items.reduce((n, i) => n + i.weight, 0) * 100) / 100 };
    fixture.componentRef.setInput('invoice', {
      saleNo: 'SALE-000150', status: 'issued', company: 'Siddheshwar Aluminium & Glass', customer: { name: 'Dull Nagar', contact: '9860470406', email: '' },
      items, totals, createdAt: '2026-11-23T10:00:00', issuedAt: '2026-11-23T10:00:00', ...more,
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const rows = (selector: string) => [...el.querySelectorAll(selector)].map(r => [...r.children].map(c => c.textContent!.trim()));
    return { el, rows, text: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  it('groups bundles by product with subtotals, in the order first added', () => {
    expect(groupByProduct(ITEMS).map(g => [g.product, g.items.length, g.pcs, g.weight])).toEqual([['1.5+1 PLAIN PIPE', 2, 80, 89.84], ['1.5X1 L PIPE', 1, 40, 44.1]]);
  });

  it('prints a table like the packing list, with serial numbers running across products', () => {
    const { el, rows, text } = render(ITEMS);
    expect(rows('thead tr')).toEqual([['Sr No', 'Barcode', 'WT', 'PC', 'LE', 'WT/PC']]);
    expect(rows('tr.product')).toEqual([['1.5+1 PLAIN PIPE'], ['1.5X1 L PIPE']]);
    expect(rows('tr.item')).toEqual([
      ['1', 'SV118', '44.90', '40.00', '15', '1.12'],
      ['2', 'SV119', '44.94', '40.00', '15', '1.12'],
      ['3', 'SV129', '44.10', '40.00', '15', '1.10'],
    ]);
    expect(rows('tr.sum-row')).toEqual([['', '', '89.84', '80.00', '', ''], ['', '', '44.10', '40.00', '', '']]);
    expect(rows('tr.total-row')).toEqual([['GRAND TOTAL · 3 bundles', '133.94', '120.00', '', '']]);
    const paper = el.querySelector('.print-view')!.textContent!;
    for (const part of ['SALES INVOICE', 'Dull Nagar', '23/11/2026', 'SALE-000150', 'Siddheshwar Aluminium & Glass', '9860470406', 'Billed to', 'Total weight', '133.94 Kg', 'Thank you for your business!']) expect(paper).toContain(part);
    expect(text()).not.toContain('₹');
    expect(el.querySelector('tfoot')).toBeNull();
    expect(el.querySelector('.invoice.sheet')).not.toBeNull();
  });

  it('adds a Rack column only when a bundle has a rack', () => {
    const { rows } = render([line('1', 'A', 10, 20, { rack: 'Black' }), line('2', 'A', 10, 20, { rack: '—' })]);
    expect(rows('thead tr')[0]).toEqual(['Sr No', 'Barcode', 'Rack', 'WT', 'PC', 'LE', 'WT/PC']);
    expect(rows('tr.item').map(r => r[2])).toEqual(['Black', '']);
    expect(rows('tr.sum-row')[0].length).toBe(7);
  });

  it('shows the number of the length, and a dash when there is none', () => {
    expect([lengthOf('15/FT'), lengthOf('16'), lengthOf('12.5 ft'), lengthOf(''), lengthOf(undefined), lengthOf('long')]).toEqual(['15', '16', '12.5', '-', '-', 'long']);
  });

  it('shows a card-style preview on screen, with the table hidden until printing', () => {
    const { el, rows } = render([line('1', 'A', 10, 22.54, { rack: 'Black' }), line('2', 'A', 10, 26.8, { rack: '—' })]);
    const preview = el.querySelector<HTMLElement>('.screen-view')!;
    const squash = (v: string) => v.split(' ').join('').split('\n').join('');
    const text = squash(preview.textContent!);
    for (const part of ['SALESINVOICE', 'SiddheshwarAluminium&Glass', 'SALE-000150', 'Issued', '23Nov2026', 'Billedto', 'DullNagar', '9860470406',
      'Bundles2', 'TotalPCS20', 'Totalweight49.34Kg', 'Die:-', '2bundles', 'Subtotal20PCS49.34Kg', 'Grandtotal', '2bundles·20PCS', 'Thankyouforyourbusiness!']) {
      expect(text).toContain(squash(part));
    }
    expect([...preview.querySelectorAll('li')].map(li => [...li.children].map(c => squash(c.textContent!)))).toEqual([
      ['1', 'Black', '10PCS', '22.54Kg'], ['2', '—', '10PCS', '26.80Kg'],
    ]);
    expect(preview.querySelector('table')).toBeNull();
    expect(getComputedStyle(el.querySelector('.print-view')!).display).toBe('none');
    // the preview's styles do not reach the print table
    expect(rows('.print-view tr.item').length).toBe(2);
    expect(el.querySelector('.print-view [class*="pv-"]')).toBeNull();
  });

  it('is not marked printable while waiting for approval', () => {
    const { el, text } = render(ITEMS, { status: 'pending' });
    expect(text()).toContain('WAITING FOR ADMIN APPROVAL');
    expect(el.querySelector('.invoice.sheet')).toBeNull();
  });
});
