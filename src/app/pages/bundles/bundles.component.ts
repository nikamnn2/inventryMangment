import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Bundle, DataService, Status } from '../../core/services/data.service';
import { RackSelectComponent } from './rack-select.component';
import { hasRack, matchRack, rackOptions } from './racks';
import { QrcodeComponent } from '../../shared/components/qrcode/qrcode.component';
import { BarcodeComponent } from '../../shared/components/barcode/barcode.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PagerComponent, createPager } from '../../shared/components/pager/pager.component';

/** Fields of the add / edit dialog. */
interface BundleForm { code: string; pieces: number | null; weight: number | null; packed: string; rack: string; status: Status; }

/** Purpose: Bundles page: list / search bundles, add or edit one, and open its printable label (barcode + QR code). */
@Component({
  selector: 'app-bundles',
  imports: [FormsModule, IconComponent, BarcodeComponent, QrcodeComponent, DecimalPipe, PagerComponent, RackSelectComponent],
  templateUrl: './bundles.component.html',
  styleUrl: './bundles.component.scss',
})
export class BundlesComponent {
  protected readonly data = inject(DataService);
  private readonly auth = inject(AuthService);

  /** Black, Silver, Gold and every other rack in use; "Other" is added by the drop-down itself. */
  protected readonly racks = computed(() => rackOptions(this.data.bundles()));
  /** True while "Other" is chosen in the add / edit dialog. */
  protected rackOther = false;

  // ---- changing the rack of several bundles ----
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  /** The ticked bundles that still exist, in list order. */
  protected readonly pickedBundles = computed(() => this.data.bundles().filter(b => this.picked().has(b.id)));
  protected readonly rackDialog = signal(false);
  protected bulkRack = '';
  protected bulkOther = false;
  protected readonly rackError = signal('');
  protected readonly rackSaving = signal(false);
  protected readonly notice = signal('');
  /** Search text; a link such as /bundles?q=<id> (from the dashboard) fills it in. */
  protected readonly q = signal(inject(ActivatedRoute, { optional: true })?.snapshot.queryParamMap.get('q') ?? '');
  protected readonly dialog = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly label = signal<Bundle | null>(null);
  protected form: BundleForm = this.blank();

  constructor() {
    // the sticker is hidden until printing, so its fonts must be fetched ahead of the print window
    for (const font of ['700 16px Arimo']) {
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

  /** "2026-11-26" as "26-11-26", the way the sticker shows the manufacturing date. */
  protected shortDate(date: string): string {
    const [year, month, day] = date.slice(0, 10).split('-');
    return day ? `${day}-${month}-${year.slice(2)}` : '-';
  }

  /** The batch number on the sticker, made from the packing date: 26 Nov 2026 is "B-261126". */
  protected batch(date: string): string {
    const short = this.shortDate(date);
    return short === '-' ? '-' : 'B-' + short.replaceAll('-', '');
  }

  /** Average weight per piece shown in the form. */
  protected avg(): string {
    const { pieces, weight } = this.form;
    return pieces !== null && pieces > 0 && weight !== null ? (weight / pieces).toFixed(3) : '';
  }

  /** Where this user's last rack choice is remembered on this device. */
  private lastRackKey(): string {
    return `invenza.lastRack:${this.auth.user()?.email ?? ''}`;
  }

  private lastRack(): string {
    try { return localStorage.getItem(this.lastRackKey()) ?? ''; } catch { return ''; }
  }

  private rememberRack(rack: string): void {
    try { localStorage.setItem(this.lastRackKey(), rack); } catch { /* storage unavailable */ }
  }

  /** Default values for a new bundle. */
  private blank(): BundleForm {
    // there may be no products yet (new database, or the list is still loading)
    return { code: this.data.products()[0]?.code ?? '', pieces: null, weight: null, packed: new Date().toISOString().slice(0, 10), rack: this.lastRack(), status: 'Packed' };
  }

  /** Opens the dialog, empty for a new bundle or filled for editing. */
  protected open(b?: Bundle): void {
    this.form = b ? { code: b.code, pieces: b.pieces, weight: b.weight, packed: b.packed, rack: hasRack(b.rack) ? matchRack(b.rack, this.racks()) : '', status: b.status } : this.blank();
    this.rackOther = false;
    this.editingId.set(b?.id ?? null);
    this.error.set('');
    this.dialog.set(true);
  }

  /** Validates and saves the bundle (create or update). */
  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const f = this.form;
    const { pieces, weight } = f;
    if (!f.code || pieces === null || weight === null || !(pieces >= 0) || !(weight >= 0) || (!this.editingId() && (pieces < 1 || weight <= 0))) {
      this.error.set('Select a product and enter pieces and weight.');
      return;
    }
    if (this.rackOther && !f.rack.trim()) {
      this.error.set('Type the new rack value, or choose one from the list.');
      return;
    }
    const rack = matchRack(f.rack, this.racks());
    const id = this.editingId();
    let failure: string | null;
    let created: Bundle | null = null;
    if (id) {
      failure = await this.data.updateBundle(id, { ...f, pieces, weight, rack: rack || '—' });
    } else {
      const r = await this.data.addBundle({ ...f, pieces, weight, rack: rack || '—' });
      failure = typeof r === 'string' ? r : null;
      created = typeof r === 'string' ? null : r;
      if (created) this.rememberRack(rack);
    }
    if (failure) {
      this.error.set(failure);
      return;
    }
    this.dialog.set(false);
    // a new bundle gets its barcode + QR code right away: show its label so it can be printed
    if (created) this.label.set(created);
  }

  protected togglePick(id: string): void {
    this.picked.update(set => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    this.notice.set('');
  }

  /** True when every bundle matching the search is ticked (on all pages). */
  protected allPicked(): boolean {
    const list = this.list();
    return !!list.length && list.every(b => this.picked().has(b.id));
  }

  /** Ticks (or clears) every bundle matching the search. */
  protected pickAll(): void {
    const on = !this.allPicked();
    this.picked.update(set => {
      const next = new Set(set);
      for (const b of this.list()) on ? next.add(b.id) : next.delete(b.id);
      return next;
    });
    this.notice.set('');
  }

  protected clearPicked(): void {
    this.picked.set(new Set());
  }

  protected openRackDialog(): void {
    this.bulkRack = '';
    this.bulkOther = false;
    this.rackError.set('');
    this.rackDialog.set(true);
  }

  /** Sets the chosen rack on every ticked bundle. */
  protected async changeRacks(e: Event): Promise<void> {
    e.preventDefault();
    const typed = matchRack(this.bulkRack, this.racks());
    if (!typed) {
      this.rackError.set(this.bulkOther ? 'Type the new rack value.' : 'Choose the rack to set.');
      return;
    }
    if (this.rackSaving()) return;
    this.rackSaving.set(true);
    const result = await this.data.setRack(this.pickedBundles().map(b => b.id), typed);
    this.rackSaving.set(false);
    if (typeof result === 'string') {
      this.rackError.set(result);
      return;
    }
    this.rackDialog.set(false);
    this.clearPicked();
    const held = result.held.length ? ` Not changed, waiting for invoice approval: ${result.held.join(', ')}.` : '';
    this.notice.set(`Rack set to “${typed}” on ${result.updated} ${result.updated === 1 ? 'bundle' : 'bundles'}.${held} Print their stickers again.`);
  }

  /** Prints the label (the browser print dialog; only the label is visible when printing). */
  protected print(): void {
    window.print();
  }
}
