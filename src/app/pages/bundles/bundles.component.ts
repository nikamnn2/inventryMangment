import { DecimalPipe } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Bundle, DataService, Status } from '../../core/services/data.service';
import { RackSelectComponent } from './rack-select.component';
import { hasRack, matchRack, rackOptions } from './racks';
import { QrcodeComponent } from '../../shared/components/qrcode/qrcode.component';
import { BarcodeComponent } from '../../shared/components/barcode/barcode.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import { PAGE_SIZE, PagerComponent, createPager } from '../../shared/components/pager/pager.component';

/** Records shown under the form while bundles are being added, so the form and the newest ones fit together. */
export const ADDING_PAGE_SIZE = 5;

/** Fields of the add panel and the edit dialog. */
interface BundleForm { code: string; pieces: number | null; weight: number | null; packed: string; rack: string; status: Status; }

/** Purpose: Bundles page: list / search bundles, add several one after another or edit one, and open a printable label (barcode + QR code). */
@Component({
  selector: 'app-bundles',
  imports: [FormsModule, IconComponent, BarcodeComponent, QrcodeComponent, DecimalPipe, PagerComponent, RackSelectComponent, ToastComponent],
  templateUrl: './bundles.component.html',
  styleUrl: './bundles.component.scss',
})
export class BundlesComponent {
  protected readonly data = inject(DataService);
  private readonly auth = inject(AuthService);

  /** Black, Silver, Gold and every other rack in use; "Other" is added by the drop-down itself. */
  protected readonly racks = computed(() => rackOptions(this.data.bundles()));
  /** True while "Other" is chosen in the edit dialog. */
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

  // ---- deleting (admins) ----
  protected readonly isAdmin = computed(() => this.auth.disabled || this.auth.user()?.role === 'admin');
  protected readonly deleting = signal<Bundle | null>(null);
  protected readonly deleteError = signal('');
  protected readonly removing = signal(false);

  protected askDelete(bundle: Bundle): void {
    this.deleteError.set('');
    this.deleting.set(bundle);
  }

  protected async confirmDelete(): Promise<void> {
    const bundle = this.deleting();
    if (!bundle || this.removing()) return;
    this.removing.set(true);
    const error = await this.data.deleteBundle(bundle.id);
    this.removing.set(false);
    if (error) {
      this.deleteError.set(error);
      return;
    }
    this.deleting.set(null);
    this.picked.update(set => new Set([...set].filter(id => id !== bundle.id)));
    this.notice.set(`Bundle ${bundle.id} was deleted.`);
  }
  /** Search text; a link such as /bundles?q=<id> (from the dashboard) fills it in. */
  protected readonly q = signal(inject(ActivatedRoute, { optional: true })?.snapshot.queryParamMap.get('q') ?? '');
  protected readonly dialog = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly label = signal<Bundle | null>(null);
  protected form: BundleForm = this.blank();

  // ---- adding bundles one after another, in a panel above the list ----
  protected readonly adding = signal(false);
  /** Kept apart from the edit dialog's fields, so editing a row does not disturb what is being typed. */
  protected entry: BundleForm = this.blank();
  protected entryOther = false;
  protected readonly entryError = signal('');
  protected readonly entrySaving = signal(false);
  /** Saved since the panel was opened, the latest first. */
  protected readonly added = signal<Bundle[]>([]);
  /** Set when "Done" is pressed over typed but unsaved values: pressing it again discards them. */
  protected readonly discard = signal(false);
  private readonly piecesBox = viewChild<ElementRef<HTMLInputElement>>('piecesBox');

  constructor() {
    // the sticker is hidden until printing, so its fonts must be fetched ahead of the print window
    for (const font of ['700 16px Arimo']) {
      void globalThis.document?.fonts?.load(font).catch(() => undefined);
    }
  }

  protected readonly pager = createPager(() => this.list(), () => `${this.adding()}|${this.q()}`, () => (this.adding() ? ADDING_PAGE_SIZE : PAGE_SIZE));

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

  /** Average weight per piece shown in a form. */
  protected avg(form: BundleForm = this.form): string {
    const { pieces, weight } = form;
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

  /** Opens the add panel above the list. It stays open until "Done", however many bundles are saved. */
  protected startAdding(): void {
    if (!this.adding()) {
      this.entry = this.blank();
      this.entryOther = false;
      this.entryError.set('');
      this.added.set([]);
      this.discard.set(false);
      this.notice.set('');
      this.q.set(''); // so every new bundle appears in the list
      this.clearPicked(); // ticking is not offered while adding
      this.adding.set(true);
    }
    this.focusPieces();
  }

  private focusPieces(): void {
    setTimeout(() => this.piecesBox()?.nativeElement.focus());
  }

  /** Closes the panel; the list goes back to its usual page size and is read from the server again. */
  protected finishAdding(): void {
    if (this.entrySaving()) return;
    // do not silently drop a bundle that was typed but not saved
    if ((this.entry.pieces !== null || this.entry.weight !== null) && !this.discard()) {
      this.discard.set(true);
      return;
    }
    const count = this.added().length;
    this.adding.set(false);
    if (count) this.notice.set(`${count} ${count === 1 ? 'bundle' : 'bundles'} added.`);
    // also picks up what others changed meanwhile; if it fails, the list on screen stays
    void this.data.refreshBundles().catch(() => undefined);
  }

  /** What is wrong with the fields, or '' when they can be saved. */
  private problem(f: BundleForm, other: boolean, isNew: boolean): string {
    const { pieces, weight } = f;
    if (!f.code || pieces === null || weight === null || !(pieces >= 0) || !(weight >= 0) || (isNew && (pieces < 1 || weight <= 0))) {
      return 'Select a product and enter pieces and weight.';
    }
    return other && !f.rack.trim() ? 'Type the new rack value, or choose one from the list.' : '';
  }

  /** Saves one new bundle and gets the panel ready for the next: pieces and weight empty, the rest kept. */
  protected async saveEntry(e: Event): Promise<void> {
    e.preventDefault();
    // pressing Enter twice must not make two bundles
    if (this.entrySaving()) return;
    this.discard.set(false);
    const f = { ...this.entry };
    const problem = this.problem(f, this.entryOther, true);
    this.entryError.set(problem);
    if (problem) return;
    const rack = matchRack(f.rack, this.racks());
    this.entrySaving.set(true);
    const result = await this.data.addBundle({ ...f, pieces: f.pieces!, weight: f.weight!, rack: rack || '—' });
    if (typeof result === 'string') {
      this.entrySaving.set(false);
      this.entryError.set(result);
      return;
    }
    this.rememberRack(rack);
    this.entry = { ...this.entry, pieces: null, weight: null, rack };
    this.entryOther = false;
    this.added.update(list => [result, ...list]);
    this.entrySaving.set(false);
    this.pager.go(1);
    this.focusPieces();
  }

  /** Opens the edit dialog for one bundle. */
  protected open(b: Bundle): void {
    this.form = { code: b.code, pieces: b.pieces, weight: b.weight, packed: b.packed, rack: hasRack(b.rack) ? matchRack(b.rack, this.racks()) : '', status: b.status };
    this.rackOther = false;
    this.editingId.set(b.id);
    this.error.set('');
    this.dialog.set(true);
  }

  /** Validates and saves the edited bundle. */
  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const f = this.form;
    const id = this.editingId();
    const problem = this.problem(f, this.rackOther, false);
    if (!id || problem) {
      this.error.set(problem);
      return;
    }
    const failure = await this.data.updateBundle(id, { ...f, pieces: f.pieces!, weight: f.weight!, rack: matchRack(f.rack, this.racks()) || '—' });
    if (failure) {
      this.error.set(failure);
      return;
    }
    this.dialog.set(false);
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
