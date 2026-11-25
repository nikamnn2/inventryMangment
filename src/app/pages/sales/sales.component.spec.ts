import { TestBed } from '@angular/core/testing';
import { DataService } from '../../core/services/data.service';
import { BUNDLES, SALE, baseProviders, fillData } from '../../testing/fixtures';
import { SalesComponent } from './sales.component';

describe('SalesComponent', () => {
  let data: DataService;
  let c: any;
  let fixture: ReturnType<typeof TestBed.createComponent<SalesComponent>>;
  const event = () => new Event('submit');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SalesComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    fixture = TestBed.createComponent(SalesComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('only offers bundles that still have stock and selects the first one', () => {
    expect(c.available().map((b: { id: string }) => b.id)).toEqual(['b1', 'b2']);
    expect(c.bundleId()).toBe('b1');
    expect(c.current().id).toBe('b1');
  });

  it('previews what is left after the sale', () => {
    c.qty.set(10);
    expect(c.remaining()).toBe('30 pcs · 150.00 kg');
    c.qty.set(99);
    expect(c.remaining()).toBe('Not enough stock');
    c.qty.set(0);
    expect(c.remaining()).toBe('—');
    c.bundleId.set('nope');
    c.qty.set(1);
    expect(c.remaining()).toBe('—');
  });

  it('switches tabs and renders the history', () => {
    c.tab.set('history');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('INV-1');
    c.detail.set(SALE);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Window Frame');
  });

  describe('scan lookup', () => {
    it('shows the lookup error', async () => {
      spyOn(data, 'findBundle').and.resolveTo('Bundle not found.');
      await c.find(event());
      expect(c.error()).toBe('Bundle not found.');
    });

    it('refuses a sold-out bundle', async () => {
      spyOn(data, 'findBundle').and.resolveTo(BUNDLES[2]);
      await c.find(event());
      expect(c.error()).toBe('This bundle is sold out.');
    });

    it('selects the scanned bundle', async () => {
      spyOn(data, 'findBundle').and.resolveTo(BUNDLES[1]);
      await c.find(event());
      expect(c.error()).toBe('');
      expect(c.bundleId()).toBe('b2');
    });
  });

  describe('recording a sale', () => {
    it('shows the server message on failure', async () => {
      spyOn(data, 'recordSale').and.resolveTo('Only 3 pcs available in this bundle.');
      await c.submit(event());
      expect(c.error()).toBe('Only 3 pcs available in this bundle.');
      expect(c.bill()).toBeNull();
    });

    it('keeps the bundle selected and shows the bill when stock remains', async () => {
      const record = spyOn(data, 'recordSale').and.resolveTo(SALE);
      c.customer.set('  Acme ');
      await c.submit(event());
      expect(record).toHaveBeenCalledWith('b1', 1, 'Acme');
      expect(c.bill()).toBe(SALE);
      expect(c.bundleId()).toBe('b1');
    });

    it('moves to the next available bundle when the sold one is empty', async () => {
      spyOn(data, 'recordSale').and.callFake(async () => {
        data.bundles.update(l => l.map(b => (b.id === 'b1' ? { ...b, pieces: 0 } : b)));
        return SALE;
      });
      await c.submit(event());
      expect(c.bundleId()).toBe('b2');
    });
  });

  it('prints the bill', () => {
    const print = spyOn(window, 'print');
    c.print();
    expect(print).toHaveBeenCalled();
  });
});
