import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Bundle, DataService, Status } from '../../core/services/data.service';
import { QrcodeComponent } from '../../shared/components/qrcode/qrcode.component';
import { BarcodeComponent } from '../../shared/components/barcode/barcode.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PagerComponent, createPager } from '../../shared/components/pager/pager.component';

/** Fields of the add / edit dialog. */
interface BundleForm { code: string; pieces: number; weight: number; packed: string; rack: string; status: Status; }

/** Purpose: Bundles page: list / search bundles, add or edit one, and open its printable label (barcode + QR code). */
@Component({
  selector: 'app-bundles',
  imports: [FormsModule, IconComponent, BarcodeComponent, QrcodeComponent, DecimalPipe, PagerComponent],
  templateUrl: './bundles.component.html',
  styleUrl: './bundles.component.scss',
})
export class BundlesComponent {
  protected readonly data = inject(DataService);
  /** Search text; a link such as /bundles?q=<id> (from the dashboard) fills it in. */
  protected readonly q = signal(inject(ActivatedRoute, { optional: true })?.snapshot.queryParamMap.get('q') ?? '');
  protected readonly dialog = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly label = signal<Bundle | null>(null);
  protected form: BundleForm = this.blank();

  constructor() {
    // the sticker is hidden until printing, so its fonts must be fetched ahead of the print window
    for (const font of ['400 16px Inconsolata', '700 16px Inconsolata', '700 16px Arimo']) {
      void globalThis.document?.fonts?.load(font).catch(() => undefined);
    }
  }

  protected readonly pager = createPager(() => this.list(), () => this.q());

  /** Bundles matching the search box (ID, die no, product name or rack). */
  protected list(): Bundle[] {
    const q = this.q().trim().toLowerCase();
    return this.data.bundles().filter(b => !q || `${b.id} ${b.code} ${this.data.productName(b.code)} ${b.rack}`.toLowerCase().includes(q));
  }

  /** First letter capital, the rest small: "BLACK" and "black" both give "Black". */
  protected firstCapital(text: string): string {
    const value = text.trim();
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  /** Average weight per piece shown in the form. */
  protected avg(): string {
    return this.form.pieces > 0 ? (this.form.weight / this.form.pieces).toFixed(3) : '';
  }

  /** Default values for a new bundle. */
  private blank(): BundleForm {
    // there may be no products yet (new database, or the list is still loading)
    return { code: this.data.products()[0]?.code ?? '', pieces: 10, weight: 50, packed: new Date().toISOString().slice(0, 10), rack: '', status: 'Packed' };
  }

  /** Opens the dialog, empty for a new bundle or filled for editing. */
  protected open(b?: Bundle): void {
    this.form = b ? { code: b.code, pieces: b.pieces, weight: b.weight, packed: b.packed, rack: b.rack, status: b.status } : this.blank();
    this.editingId.set(b?.id ?? null);
    this.error.set('');
    this.dialog.set(true);
  }

  /** Validates and saves the bundle (create or update). */
  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const f = this.form;
    if (!f.code || !(f.pieces >= 0) || !(f.weight >= 0) || (!this.editingId() && (f.pieces < 1 || f.weight <= 0))) {
      this.error.set('Select a product and enter pieces and weight.');
      return;
    }
    const id = this.editingId();
    let failure: string | null;
    let created: Bundle | null = null;
    if (id) {
      failure = await this.data.updateBundle(id, { ...f, rack: f.rack || '—' });
    } else {
      const r = await this.data.addBundle({ ...f, rack: f.rack || '—' });
      failure = typeof r === 'string' ? r : null;
      created = typeof r === 'string' ? null : r;
    }
    if (failure) {
      this.error.set(failure);
      return;
    }
    this.dialog.set(false);
    // a new bundle gets its barcode + QR code right away: show its label so it can be printed
    if (created) this.label.set(created);
  }

  /** Prints the label (the browser print dialog; only the label is visible when printing). */
  protected print(): void {
    window.print();
  }
}
