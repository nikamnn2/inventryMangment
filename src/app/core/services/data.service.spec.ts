import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Bundle, DataService, Product } from './data.service';

const apiBundle = { bundleId: 'ab12cd34ef901234', dieNo: 'AL-1002', pieces: 32, weight: 198.4, packed: '2026-10-26', status: 'Shipped', rack: 'A-03' };
const bundle = (over: Partial<Bundle> = {}): Bundle => ({ id: 'b1', code: 'AL-1', pieces: 10, weight: 50, packed: '2026-01-01', status: 'Packed', rack: 'A', ...over });

describe('DataService', () => {
  let svc: DataService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(DataService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('derives totals and low-stock from the cached bundles', () => {
    svc.bundles.set([bundle({ pieces: 40, weight: 200 }), bundle({ id: 'b2', pieces: 8, weight: 40 }), bundle({ id: 'b3', pieces: 0, weight: 0 })]);
    expect(svc.totalPieces()).toBe(48);
    expect(svc.totalWeight()).toBe(240);
    expect(svc.lowStock().map(b => b.id)).toEqual(['b2']); // sold-out bundles are not "low"
  });

  it('follows the low-stock limit from settings', () => {
    svc.bundles.set([bundle({ pieces: 15 })]);
    expect(svc.lowStock().length).toBe(1);
    svc.settings.set({ company: 'x', gstin: '', phone: '', lowStockLimit: 10, weightUnit: 'kg', rates: { Aluminium: 1, Glass: 1 } });
    expect(svc.lowStock().length).toBe(0);
  });

  it('looks up product names and categories', () => {
    svc.products.set([{ code: 'GL-1', name: 'Clear', category: 'Glass', size: '', finish: '' }]);
    expect(svc.productName('GL-1')).toBe('Clear');
    expect(svc.productName('??')).toBe('??');
    expect(svc.categoryOf('GL-1')).toBe('Glass');
  });

  it('maps API bundles (bundleId/dieNo) to the UI shape on lookup', async () => {
    const p = svc.findBundle('ab12');
    http.expectOne('/api/bundles/lookup/ab12').flush(apiBundle);
    expect(await p).toEqual(jasmine.objectContaining({ id: 'ab12cd34ef901234', code: 'AL-1002', pieces: 32 }));
  });

  it('returns the server message when a scan is not found', async () => {
    const p = svc.findBundle('zzzz');
    http.expectOne('/api/bundles/lookup/zzzz').flush({ error: 'Bundle not found.' }, { status: 404, statusText: 'Not Found' });
    expect(await p).toBe('Bundle not found.');
  });

  it('does not call the API for an empty scan', async () => {
    expect(await svc.findBundle('  ')).toContain('Scan or type');
  });

  it('adds a product through the API using dieNo', async () => {
    const product: Product = { code: 'AL-9', name: 'New', category: 'Aluminium', size: '', finish: '' };
    const p = svc.addProduct(product);
    const req = http.expectOne('/api/products');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.dieNo).toBe('AL-9');
    req.flush({ ...req.request.body });
    expect(await p).toBeNull();
    expect(svc.products()[0].code).toBe('AL-9');
  });

  it('surfaces a duplicate Die No error from the API', async () => {
    const p = svc.addProduct({ code: 'AL-1', name: 'Dup', category: 'Aluminium', size: '', finish: '' });
    http.expectOne('/api/products').flush({ error: 'Die No AL-1 already exists.' }, { status: 409, statusText: 'Conflict' });
    expect(await p).toBe('Die No AL-1 already exists.');
    expect(svc.products().length).toBe(0);
  });

  it('records a sale, then refreshes bundles and sales', async () => {
    const p = svc.recordSale('b1', 2, 'ACME');
    const post = http.expectOne('/api/sales');
    expect(post.request.body).toEqual({ bundleId: 'b1', quantity: 2, customer: 'ACME' });
    post.flush({ billNo: 'INV-1043', bundleId: 'b1', product: 'X', pcs: 2, weight: 5, customer: 'ACME', amount: 100, createdAt: new Date().toISOString() });
    await Promise.resolve();
    http.expectOne('/api/bundles').flush([]);
    http.expectOne('/api/sales').flush([]);
    const sale = await p;
    expect(typeof sale).toBe('object');
    expect((sale as { id: string }).id).toBe('INV-1043');
  });

  it('returns the API error and refreshes stock when a sale is rejected', async () => {
    const p = svc.recordSale('b1', 99, '');
    http.expectOne('/api/sales').flush({ error: 'Only 10 pcs available in this bundle.' }, { status: 409, statusText: 'Conflict' });
    await Promise.resolve();
    http.expectOne('/api/bundles').flush([]);
    expect(await p).toBe('Only 10 pcs available in this bundle.');
  });

  it('reports an unreachable server clearly', async () => {
    const p = svc.addProduct({ code: 'X', name: 'X', category: 'Glass', size: '', finish: '' });
    http.expectOne('/api/products').error(new ProgressEvent('error'), { status: 0 });
    expect(await p).toContain('Cannot reach the server');
  });
  it('treats tabs the role cannot open (403) as empty instead of failing the load', async () => {
    const p = svc.load();
    const deny = { error: 'You do not have access to this section.' };
    const forbidden = { status: 403, statusText: 'Forbidden' };
    http.expectOne('/api/products').flush(deny, forbidden);
    http.expectOne('/api/bundles').flush(deny, forbidden);
    http.expectOne('/api/sales').flush([]);
    http.expectOne('/api/customers').flush([]);
    http.expectOne('/api/suppliers').flush([]);
    http.expectOne('/api/settings').flush(deny, forbidden);
    await p;
    expect(svc.loaded()).toBeTrue();
    expect(svc.loadError()).toBe('');
    expect(svc.products()).toEqual([]);
    expect(svc.settings()).toBeNull();
  });

  it('still reports other load failures', async () => {
    const p = svc.load();
    http.expectOne('/api/products').flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    http.match(() => true).forEach(r => r.flush([]));
    await p;
    expect(svc.loaded()).toBeFalse();
    expect(svc.loadError()).toBe('boom');
  });
});
