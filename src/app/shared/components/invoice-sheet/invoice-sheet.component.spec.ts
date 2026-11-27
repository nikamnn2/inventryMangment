import { TestBed } from '@angular/core/testing';
import { Invoice } from '../../../core/services/invoice.service';
import { InvoiceSheetComponent, groupByProduct } from './invoice-sheet.component';

const line = (bundleId: string, product: string, pcs: number, weight: number) => ({ bundleId, dieNo: '', product, size: '', pcs, weight });
const ITEMS = [line('103719', '3TT', 10, 22.54), line('103838', '18x40 HANDAL', 16, 19.78), line('104252', '3TT', 10, 26.8)];

describe('InvoiceSheetComponent', () => {
  it('groups bundles by product with subtotals, in the order first added', () => {
    expect(groupByProduct(ITEMS).map(g => [g.product, g.items.length, g.pcs, g.weight])).toEqual([['3TT', 2, 20, 49.34], ['18x40 HANDAL', 1, 16, 19.78]]);
  });

  it('shows the rack after each bundle that has one', () => {
    const fixture = TestBed.createComponent(InvoiceSheetComponent);
    const items = [{ ...line('1', 'A', 1, 2), rack: 'Black' }, { ...line('2', 'A', 1, 2), rack: '—' }, line('3', 'A', 1, 2)];
    fixture.componentRef.setInput('invoice', { saleNo: 'S', status: 'issued', company: 'C', customer: { name: 'n', contact: '1', email: '' }, items, totals: { bundles: 3, pcs: 3, weight: 6 }, createdAt: '2026-01-01' });
    fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('li')].map((li: any) => li.textContent.trim()))
      .toEqual(['Bundle 1: 2 Kg, 1 PCS, Rack: Black', 'Bundle 2: 2 Kg, 1 PCS', 'Bundle 3: 2 Kg, 1 PCS']);
  });

  it('shows the invoice like the printed form, without prices', () => {
    const fixture = TestBed.createComponent(InvoiceSheetComponent);
    const invoice: Invoice = {
      saleNo: 'SALE-000150', status: 'issued', company: 'Aluminum Anodizing Manufacturing', customer: { name: 'ganesh landge', contact: '9860470406', email: '' },
      items: ITEMS, totals: { bundles: 3, pcs: 36, weight: 69.12 }, createdAt: '2026-10-14T15:49:00', issuedAt: '2026-10-14T15:49:00',
    };
    fixture.componentRef.setInput('invoice', invoice);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');
    // compared without spaces: the layout, not the markup, puts space between the parts
    const squash = (v: string) => v.replace(/\s+/g, '');
    for (const part of ['SALES INVOICE', 'Aluminum Anodizing Manufacturing', 'Sale Number: SALE-000150', 'Date: Oct 14, 2026, 03:49 PM', 'Name: ganesh landge', '3TT (Die: -) 2 bundles',
      'Bundle 104252: 26.8 Kg, 10 PCS', 'Subtotal: 49.34 Kg, 20 PCS', '1 bundle ', 'GRAND TOTAL:', 'Total PCS: 36', '69.12 Kg', 'Total Bundles: 3', 'Thank you for your business!']) {
      expect(squash(text)).toContain(squash(part));
    }
    expect(text).toContain('18x40 HANDAL (Die: -)');
    expect(text).not.toContain('1 bundles');
    expect(text).not.toContain('₹');
    expect(text).not.toContain('Email:');
    expect(fixture.nativeElement.querySelector('.invoice.sheet')).not.toBeNull();
  });
});
