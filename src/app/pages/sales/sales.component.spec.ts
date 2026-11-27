import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { Invoice, InvoiceLine, InvoiceService, SavedCustomer } from '../../core/services/invoice.service';
import { SALE, baseProviders, fillData } from '../../testing/fixtures';
import { SalesComponent } from './sales.component';

const LINE = (bundleId: string, pcs = 10, weight = 22.54): InvoiceLine => ({ bundleId, dieNo: '3TT', product: '3TT', size: '3/4', pcs, weight });
const SAVED: SavedCustomer[] = [
  { name: 'Ganesh Landge', contact: '9860470406', email: 'g@x.com', city: 'Pune' },
  { name: 'Skyline Facades', contact: '+91 98190 72210', email: '', city: 'Mumbai' },
];
const INVOICE: Invoice = {
  saleNo: 'SALE-000150', status: 'issued', company: 'Sahyadri', customer: { name: 'Ganesh Landge', contact: '9860470406', email: '' },
  items: [LINE('103719')], totals: { bundles: 1, pcs: 10, weight: 22.54 }, createdAt: '2026-10-14T10:19:00Z', issuedAt: '2026-10-14T10:19:00Z',
};

describe('SalesComponent', () => {
  let data: DataService;
  let api: InvoiceService;
  let c: any;
  let fixture: ReturnType<typeof TestBed.createComponent<SalesComponent>>;
  const text = () => { fixture.detectChanges(); return fixture.nativeElement.textContent.replace(/\s+/g, ' ') as string; };

  async function setup(role = 'admin', invoices: Invoice[] = []) {
    sessionStorage.removeItem('invenza.saleDraft');
    TestBed.configureTestingModule({ imports: [SalesComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    spyOn(data, 'refreshBundles').and.resolveTo();
    spyOn(data, 'refreshSales').and.resolveTo();
    api = TestBed.inject(InvoiceService);
    spyOn(api, 'list').and.resolveTo(invoices);
    spyOn(api, 'customers').and.resolveTo(SAVED);
    const auth = TestBed.inject(AuthService);
    Object.defineProperty(auth, 'disabled', { value: false });
    auth.user.set({ email: 'a@b.c', name: 'A', role, modules: ['sales'] });
    fixture = TestBed.createComponent(SalesComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }
  afterEach(() => sessionStorage.removeItem('invenza.saleDraft'));

  it('adds each bundle once, newest first, with running totals', async () => {
    await setup();
    const lookup = spyOn(api, 'lookup').and.callFake(async code => (code === '103719' ? LINE('103719') : LINE('103838', 16, 19.78)));
    await c.add(' 103719 ');
    await c.add('103838');
    expect(c.items().map((i: InvoiceLine) => i.bundleId)).toEqual(['103838', '103719']);
    expect(c.totals()).toEqual({ bundles: 2, pcs: 26, weight: 42.32 });
    expect(text()).toContain('Total PCS26');
    await c.add('103719');
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(c.error()).toContain('already in the list');
    c.remove('103838');
    expect(c.totals().bundles).toBe(1);
  });

  it('does not add a bundle twice when the camera reads it again during the lookup', async () => {
    await setup();
    const lookup = spyOn(api, 'lookup').and.resolveTo(LINE('103719'));
    await Promise.all([c.add('103719'), c.add('103719')]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(c.items().length).toBe(1);
  });

  it('shows why a bundle cannot be added', async () => {
    await setup();
    spyOn(api, 'lookup').and.resolveTo('Bundle 7 is already sold.');
    await c.add('7');
    expect(c.error()).toBe('Bundle 7 is already sold.');
    expect(c.items()).toEqual([]);
  });

  it('keeps the unfinished sale for this session', async () => {
    await setup();
    spyOn(api, 'lookup').and.resolveTo(LINE('103719'));
    await c.add('103719');
    c.setField('name', 'Ravi');
    fixture.detectChanges();
    await fixture.whenStable();
    const again = TestBed.createComponent(SalesComponent).componentInstance as any;
    expect(again.items().length).toBe(1);
    expect(again.customer().name).toBe('Ravi');
  });

  it('suggests saved customers and fills their details', async () => {
    await setup();
    c.typeName('gan');
    expect(c.suggestions().map((s: SavedCustomer) => s.name)).toEqual(['Ganesh Landge']);
    c.typeName('98190');
    expect(c.suggestions().map((s: SavedCustomer) => s.name)).toEqual(['Skyline Facades']);
    c.typeName('gan');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.suggestions li') as HTMLElement).click();
    expect(c.customer()).toEqual({ name: 'Ganesh Landge', contact: '9860470406', email: 'g@x.com' });
    expect(c.customerStatus()).toBe('Saved customer');
    // another name: the filled-in details of the chosen one are not kept
    c.typeName('Ganesh Landge Traders');
    expect(c.customer()).toEqual({ name: 'Ganesh Landge Traders', contact: '', email: '' });
    c.setField('contact', '9000000001');
    expect(c.customerStatus()).toContain('New customer');
  });

  it('can choose a suggestion with the keyboard', async () => {
    await setup();
    c.typeName('');
    const key = (k: string) => c.nameKey(new KeyboardEvent('keydown', { key: k, cancelable: true }));
    key('ArrowDown');
    key('Enter');
    expect(c.customer().name).toBe('Skyline Facades');
    c.typeName('gan');
    key('Escape');
    expect(c.listOpen()).toBeFalse();
  });

  it('asks for the customer name and number before creating', async () => {
    await setup();
    const create = spyOn(api, 'create');
    await c.create(new Event('submit'));
    expect(c.formError()).toBe('Add at least one bundle.');
    c.items.set([LINE('1')]);
    await c.create(new Event('submit'));
    expect(c.formError()).toBe('Enter the customer name.');
    c.setField('name', 'N');
    await c.create(new Event('submit'));
    expect(c.formError()).toBe('Enter a valid contact number.');
    c.setField('contact', '9860470406');
    c.setField('email', 'bad');
    await c.create(new Event('submit'));
    expect(c.formError()).toBe('Enter a valid email address.');
    expect(create).not.toHaveBeenCalled();
  });

  it("creates an admin's invoice at once and opens it for printing", async () => {
    await setup('admin');
    const create = spyOn(api, 'create').and.resolveTo(INVOICE);
    c.items.set([LINE('2'), LINE('1')]);
    c.customer.set({ name: ' Ganesh Landge ', contact: '9860470406', email: '' });
    expect(text()).toContain('Create invoice');
    await c.create(new Event('submit'));
    expect(create).toHaveBeenCalledWith(['1', '2'], { name: 'Ganesh Landge', contact: '9860470406', email: '' });
    expect(c.items()).toEqual([]);
    expect(text()).toContain('SALES INVOICE');
    expect(text()).toContain('Print invoice (A4)');
    expect(data.refreshBundles).toHaveBeenCalled();
    const print = spyOn(window, 'print');
    c.print();
    expect(print).toHaveBeenCalled();
  });

  it("sends a sales user's invoice for approval, with nothing to print", async () => {
    await setup('sales');
    spyOn(api, 'create').and.resolveTo({ ...INVOICE, status: 'pending' });
    c.items.set([LINE('1')]);
    c.customer.set({ name: 'N', contact: '9860470406', email: '' });
    expect(text()).toContain('Send for approval');
    await c.create(new Event('submit'));
    expect(c.viewing()).toBeNull();
    expect(c.notice()).toContain('sent to an admin');
    c.viewing.set({ ...INVOICE, status: 'pending' });
    expect(text()).toContain('WAITING FOR ADMIN APPROVAL');
    expect(text()).not.toContain('Print invoice');
    expect(text()).not.toContain('Approve & create invoice');
    expect(fixture.nativeElement.querySelector('.invoice.sheet')).toBeNull();
  });

  it('keeps the list when the invoice cannot be created', async () => {
    await setup();
    spyOn(api, 'create').and.resolveTo('Bundle 1 was just taken by someone else.');
    c.items.set([LINE('1')]);
    c.customer.set({ name: 'N', contact: '9860470406', email: '' });
    await c.create(new Event('submit'));
    expect(c.formError()).toContain('just taken');
    expect(c.items().length).toBe(1);
  });

  it('lets an admin approve or reject a waiting invoice', async () => {
    await setup('admin', [{ ...INVOICE, status: 'pending' }]);
    c.tab.set('invoices');
    expect(text()).toContain('1 waiting');
    expect(text()).toContain('Review');
    const decide = spyOn(api, 'decide').and.callFake(async (_n, d) => ({ ...INVOICE, status: d === 'approve' ? 'issued' : 'rejected' }));
    await c.decide(c.invoices()[0], 'approve');
    expect(decide).toHaveBeenCalledWith('SALE-000150', 'approve');
    expect(c.viewing().status).toBe('issued');
    await c.decide(c.invoices()[0], 'reject');
    expect(c.viewing()).toBeNull();
    decide.and.resolveTo('This invoice has already been decided.');
    await c.decide(c.invoices()[0], 'approve');
    expect(c.listError()).toBe('This invoice has already been decided.');
  });

  it('still shows earlier single-bundle bills', async () => {
    await setup();
    c.tab.set('invoices');
    expect(text()).toContain('Earlier bills');
    expect(text()).toContain('INV-1');
    c.detail.set(SALE);
    expect(text()).toContain('Window Frame');
  });
});
