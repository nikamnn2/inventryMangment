import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { isMobileDevice } from '../../core/config/device';
import { AuthService } from '../../core/services/auth.service';
import { DataService, Sale } from '../../core/services/data.service';
import { Invoice, InvoiceCustomer, InvoiceLine, InvoiceService, SavedCustomer } from '../../core/services/invoice.service';
import { CameraScannerComponent } from '../../shared/components/camera-scanner/camera-scanner.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { InvoiceSheetComponent } from '../../shared/components/invoice-sheet/invoice-sheet.component';
import { PagerComponent, createPager } from '../../shared/components/pager/pager.component';

/** The unfinished sale is kept for this browser session, so a reload does not lose a long list of scans. */
const DRAFT_KEY = 'invenza.saleDraft';
const NO_CUSTOMER: InvoiceCustomer = { name: '', contact: '', email: '' };
const digits = (v: string) => v.replace(/\D/g, '');

/**
 * Purpose: Sales page (admins and the sales department). New sale: add whole bundles by number or, on a
 * phone, by camera; then the customer; then create the invoice (a sales user's waits for an admin).
 * Invoices: every invoice, to view, print, approve or reject.
 */
@Component({
  selector: 'app-sales',
  imports: [IconComponent, DecimalPipe, DatePipe, NgTemplateOutlet, PagerComponent, CameraScannerComponent, InvoiceSheetComponent],
  templateUrl: './sales.component.html',
  styleUrl: './sales.component.scss',
})
export class SalesComponent {
  protected readonly data = inject(DataService);
  private readonly auth = inject(AuthService);
  private readonly api = inject(InvoiceService);

  protected readonly tab = signal<'new' | 'invoices'>('new');
  protected readonly isAdmin = computed(() => this.auth.disabled || this.auth.user()?.role === 'admin');
  /** The camera is offered on phones and tablets only; a desktop types or uses a hardware scanner. */
  protected readonly mobile = isMobileDevice();
  protected readonly scanning = signal(false);

  private readonly draft = this.readDraft();
  /** Bundles on the new sale, the latest first (so what was just scanned is on top). */
  protected readonly items = signal<InvoiceLine[]>(this.draft.items);
  protected readonly customer = signal<InvoiceCustomer>(this.draft.customer);
  protected readonly code = signal('');
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly formError = signal('');
  protected readonly saving = signal(false);
  private readonly adding = new Set<string>();

  protected readonly totals = computed(() => this.items().reduce(
    (t, i) => ({ bundles: t.bundles + 1, pcs: t.pcs + i.pcs, weight: Math.round((t.weight + i.weight) * 100) / 100 }),
    { bundles: 0, pcs: 0, weight: 0 }));
  protected readonly itemPager = createPager(() => this.items());

  // ---- customer suggestions ----
  protected readonly saved = signal<SavedCustomer[]>([]);
  protected readonly listOpen = signal(false);
  protected readonly highlighted = signal(0);
  private picked: SavedCustomer | null = null;

  /** Saved customers whose name (or number) contains what is typed. */
  protected readonly suggestions = computed(() => {
    const typed = this.customer().name.trim().toLowerCase();
    if (!typed) return this.saved().slice(0, 8);
    const number = /^[\d\s+()-]+$/.test(typed) ? digits(typed) : '';
    return this.saved().filter(c => c.name.toLowerCase().includes(typed) || (!!number && digits(c.contact).includes(number))).slice(0, 8);
  });

  /** Tells the user whether this customer is already saved (same name and number) or will be added. */
  protected readonly customerStatus = computed(() => {
    const { name, contact } = this.customer();
    if (!name.trim() || digits(contact).length < 7) return '';
    const known = this.saved().some(c => c.name.toLowerCase() === name.trim().toLowerCase() && digits(c.contact).slice(-10) === digits(contact).slice(-10));
    return known ? 'Saved customer' : 'New customer: will be saved with this invoice';
  });

  // ---- invoices ----
  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly listError = signal('');
  protected readonly viewing = signal<Invoice | null>(null);
  protected readonly deciding = signal(false);
  protected readonly waiting = computed(() => this.invoices().filter(i => i.status === 'pending').length);
  protected readonly invoicePager = createPager(() => this.invoices());
  /** Bills made before invoices existed (one bundle each). */
  protected readonly oldBills = computed(() => this.data.sales().filter(s => !s.invoiceNo));
  protected readonly oldPager = createPager(() => this.oldBills());
  protected readonly detail = signal<Sale | null>(null);

  constructor() {
    void this.loadInvoices();
    void this.loadCustomers();
    effect(() => {
      const draft = { items: this.items(), customer: this.customer() };
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage unavailable */ }
    });
  }

  private readDraft(): { items: InvoiceLine[]; customer: InvoiceCustomer } {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
      if (Array.isArray(saved?.items)) return { items: saved.items, customer: { ...NO_CUSTOMER, ...saved.customer } };
    } catch { /* no usable draft */ }
    return { items: [], customer: { ...NO_CUSTOMER } };
  }

  private async loadInvoices(): Promise<void> {
    const result = await this.api.list();
    if (typeof result === 'string') this.listError.set(result);
    else {
      this.invoices.set(result);
      this.listError.set('');
    }
  }

  private async loadCustomers(): Promise<void> {
    const result = await this.api.customers();
    if (typeof result !== 'string') this.saved.set(result);
  }

  /** Looks a bundle up by its number and adds it, with all its details, to the list. */
  protected async add(raw: string): Promise<void> {
    const code = raw.trim().toLowerCase();
    if (!code || this.adding.has(code)) return;
    if (this.items().some(i => i.bundleId === code)) return this.refuse(`Bundle ${code} is already in the list.`);
    this.adding.add(code);
    try {
      const found = await this.api.lookup(code);
      if (typeof found === 'string') return this.refuse(found);
      if (this.items().some(i => i.bundleId === found.bundleId)) return this.refuse(`Bundle ${found.bundleId} is already in the list.`);
      this.items.update(list => [found, ...list]);
      this.itemPager.go(1);
      this.code.set('');
      this.error.set('');
      this.notice.set(`Added bundle ${found.bundleId}: ${found.product}, ${found.pcs} pcs, ${found.weight} kg.`);
    } finally {
      this.adding.delete(code);
    }
  }

  private refuse(why: string): void {
    this.notice.set('');
    this.error.set(why);
  }

  protected remove(bundleId: string): void {
    this.items.update(list => list.filter(i => i.bundleId !== bundleId));
    this.notice.set('');
  }

  protected clearSale(): void {
    this.items.set([]);
    this.customer.set({ ...NO_CUSTOMER });
    this.picked = null;
    this.error.set('');
    this.notice.set('');
    this.formError.set('');
  }

  protected setField(field: keyof InvoiceCustomer, value: string): void {
    this.customer.update(c => ({ ...c, [field]: value }));
  }

  protected typeName(value: string): void {
    // a different name than the chosen customer: drop the details that were filled in for them
    const picked = this.picked;
    if (picked && value !== picked.name) {
      this.customer.update(c => ({ ...c, contact: c.contact === picked.contact ? '' : c.contact, email: c.email === picked.email ? '' : c.email }));
      this.picked = null;
    }
    this.setField('name', value);
    this.highlighted.set(0);
    this.listOpen.set(true);
  }

  /** Chooses a saved customer: their details fill the other fields. */
  protected choose(c: SavedCustomer): void {
    this.picked = c;
    this.customer.set({ name: c.name, contact: c.contact, email: c.email });
    this.listOpen.set(false);
    this.formError.set('');
  }

  /** Arrow keys move through the suggestions, Enter chooses, Escape closes. */
  protected nameKey(event: KeyboardEvent): void {
    const list = this.suggestions();
    if (event.key === 'Escape') return this.listOpen.set(false);
    if (!this.listOpen() || !list.length) {
      if (event.key === 'ArrowDown') this.listOpen.set(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlighted.update(i => (i + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.choose(list[Math.min(this.highlighted(), list.length - 1)]);
    }
  }

  /** Creates the invoice: issued at once for an admin, otherwise sent to an admin to approve. */
  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    const c = this.customer();
    const customer = { name: c.name.trim(), contact: c.contact.trim(), email: c.email.trim() };
    const problem = !this.items().length ? 'Add at least one bundle.'
      : !customer.name ? 'Enter the customer name.'
      : digits(customer.contact).length < 7 ? 'Enter a valid contact number.'
      : customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ? 'Enter a valid email address.' : '';
    this.formError.set(problem);
    if (problem || this.saving()) return;
    this.saving.set(true);
    // the invoice lists bundles in the order they were added
    const result = await this.api.create(this.items().map(i => i.bundleId).reverse(), customer);
    this.saving.set(false);
    if (typeof result === 'string') {
      this.formError.set(result);
      return;
    }
    this.scanning.set(false);
    this.clearSale();
    this.notice.set(result.status === 'issued'
      ? `Invoice ${result.saleNo} created.`
      : `${result.saleNo} was sent to an admin. The invoice is created when they approve it.`);
    if (result.status === 'issued') this.viewing.set(result);
    await Promise.all([this.loadInvoices(), this.loadCustomers(), result.status === 'issued' ? this.refreshStock() : undefined]);
  }

  /** Admin: approve (creates the invoice) or reject a waiting one. */
  protected async decide(invoice: Invoice, decision: 'approve' | 'reject'): Promise<void> {
    if (this.deciding()) return;
    this.deciding.set(true);
    const result = await this.api.decide(invoice.saleNo, decision);
    this.deciding.set(false);
    if (typeof result === 'string') {
      this.listError.set(result);
      this.viewing.set(null);
    } else {
      this.viewing.set(decision === 'approve' ? result : null);
      this.notice.set(decision === 'approve' ? `Invoice ${result.saleNo} created.` : `${result.saleNo} was rejected. Its bundles are available again.`);
    }
    await Promise.all([this.loadInvoices().then(() => typeof result === 'string' && this.listError.set(result)), this.refreshStock()]);
  }

  /** Stock and sales changed. A sales user may not see those lists; the invoice is saved either way. */
  private async refreshStock(): Promise<void> {
    await Promise.all([this.data.refreshBundles().catch(() => undefined), this.data.refreshSales().catch(() => undefined)]);
  }

  protected statusLabel(status: Invoice['status']): string {
    return status === 'issued' ? 'Issued' : status === 'rejected' ? 'Rejected' : 'Waiting for approval';
  }

  /** Prints the open invoice (A4) or old bill. */
  protected print(): void {
    window.print();
  }
}
