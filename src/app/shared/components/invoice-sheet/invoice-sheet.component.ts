import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Invoice, InvoiceLine } from '../../../core/services/invoice.service';

export interface InvoiceGroup { product: string; dieNo: string; items: InvoiceLine[]; pcs: number; weight: number; }

/** The invoice's bundles grouped by product, in the order the products were first added. */
export function groupByProduct(items: InvoiceLine[]): InvoiceGroup[] {
  const groups = new Map<string, InvoiceGroup>();
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

/**
 * Purpose: the sales invoice as it is printed on A4 paper. Only an issued invoice is marked as the
 * printable sheet, so one waiting for approval cannot be printed as an invoice.
 */
@Component({
  selector: 'app-invoice-sheet',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './invoice-sheet.component.html',
  styleUrl: './invoice-sheet.component.scss',
})
export class InvoiceSheetComponent {
  readonly invoice = input.required<Invoice>();
  protected readonly groups = computed(() => groupByProduct(this.invoice().items));
}
