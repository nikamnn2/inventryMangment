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

/** An empty rack is saved as "—". */
export const hasRack = (rack?: string): boolean => !!rack && !['—', '-'].includes(rack);

/** The length column: the number in the product's CL value ("15/FT" is 15), else the value itself. */
export const lengthOf = (clValue?: string): string => clValue?.match(/\d+(\.\d+)?/)?.[0] ?? (clValue?.trim() || '-');

/**
 * Purpose: the sales invoice. On screen it is a card-style preview; on A4 paper it prints as a
 * packing-list table with weight and piece subtotals. Only an issued invoice is marked as the printable
 * sheet, so one waiting for approval cannot be printed as an invoice.
 */
@Component({
  selector: 'app-invoice-sheet',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './invoice-sheet.component.html',
  styleUrl: './invoice-sheet.component.scss',
})
export class InvoiceSheetComponent {
  readonly invoice = input.required<Invoice>();

  /** The groups, with serial numbers that run on from one product to the next. */
  protected readonly groups = computed(() => {
    let sr = 0;
    return groupByProduct(this.invoice().items).map(g => ({ ...g, rows: g.items.map(item => ({ sr: ++sr, item })) }));
  });
  /** The rack column appears only when some bundle on the invoice has a rack. */
  protected readonly showRack = computed(() => this.invoice().items.some(i => hasRack(i.rack)));
  protected readonly hasRack = hasRack;
  protected readonly lengthOf = lengthOf;

  /** Two decimals without thousands separators, as on the packing list. */
  protected two(value: number): string {
    return value.toFixed(2);
  }

  protected perPiece(item: InvoiceLine): string {
    return item.pcs > 0 ? (item.weight / item.pcs).toFixed(2) : '-';
  }
}
