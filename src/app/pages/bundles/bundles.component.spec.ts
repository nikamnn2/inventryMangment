import { TestBed } from '@angular/core/testing';
import { DataService } from '../../core/services/data.service';
import { BUNDLES, baseProviders, fillData } from '../../testing/fixtures';
import { BundlesComponent } from './bundles.component';

describe('BundlesComponent', () => {
  let data: DataService;
  let c: any;
  let fixture: ReturnType<typeof TestBed.createComponent<BundlesComponent>>;
  const submit = () => c.save(new Event('submit'));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BundlesComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    fixture = TestBed.createComponent(BundlesComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('lists every bundle and filters by id, die no, product name or rack', () => {
    expect(c.list().length).toBe(3);
    c.q.set('clear glass');
    expect(c.list().map((b: { id: string }) => b.id)).toEqual(['b2']);
    c.q.set('a-01');
    expect(c.list().map((b: { id: string }) => b.id)).toEqual(['b1']);
  });

  it('calculates the average weight from the form', () => {
    c.open();
    c.form.pieces = 10;
    c.form.weight = 25;
    expect(c.avg()).toBe('2.500');
    c.form.pieces = 0;
    expect(c.avg()).toBe('');
  });

  it('opens the dialog blank for a new bundle and filled for an edit', () => {
    c.open();
    expect(c.dialog()).toBeTrue();
    expect(c.editingId()).toBeNull();
    expect(c.form.code).toBe('AL-1');
    c.open(BUNDLES[1]);
    expect(c.editingId()).toBe('b2');
    expect(c.form).toEqual(jasmine.objectContaining({ code: 'GL-1', pieces: 8, rack: 'G-01' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Clear Glass');
  });

  it('rejects an invalid new bundle without calling the API', async () => {
    const add = spyOn(data, 'addBundle');
    c.open();
    c.form.pieces = 0;
    await submit();
    expect(add).not.toHaveBeenCalled();
    expect(c.error()).toContain('Select a product');
  });

  it('creates a bundle, closes the dialog and opens its new label (barcode + QR code)', async () => {
    const add = spyOn(data, 'addBundle').and.resolveTo({ ...BUNDLES[0], id: 'new' });
    c.open();
    c.form.rack = '';
    await submit();
    expect(add).toHaveBeenCalledWith(jasmine.objectContaining({ rack: '—' }));
    expect(c.dialog()).toBeFalse();
    expect(c.label()?.id).toBe('new');
  });

  it('shows the server message when creating fails', async () => {
    spyOn(data, 'addBundle').and.resolveTo('Unknown product Die No X.');
    c.open();
    await submit();
    expect(c.error()).toBe('Unknown product Die No X.');
    expect(c.dialog()).toBeTrue();
  });

  it('updates an existing bundle', async () => {
    const update = spyOn(data, 'updateBundle').and.resolveTo(null);
    c.open(BUNDLES[0]);
    await submit();
    expect(update).toHaveBeenCalledWith('b1', jasmine.objectContaining({ code: 'AL-1', rack: 'A-01' }));
    expect(c.dialog()).toBeFalse();
  });

  it('keeps the dialog open when an update fails', async () => {
    spyOn(data, 'updateBundle').and.resolveTo('Bundle not found.');
    c.open(BUNDLES[0]);
    await submit();
    expect(c.error()).toBe('Bundle not found.');
  });

  it('prints the label', () => {
    const print = spyOn(window, 'print');
    c.print();
    expect(print).toHaveBeenCalled();
  });

  it('keeps the sticker label in the form and prints it on the sticker only when set', () => {
    const fixture = TestBed.createComponent(BundlesComponent);
    const c = fixture.componentInstance as any;
    const bundle = { id: 'x1', code: 'AL-1001', pieces: 1, weight: 1, packed: '2026-11-26', status: 'Packed', rack: 'A', stickerText: 'URGENT ORDER' };
    c.open(bundle);
    expect(c.form.stickerText).toBe('URGENT ORDER');
    c.open();
    expect(c.form.stickerText).toBe('');

    c.dialog.set(false);
    c.label.set(bundle);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sticker .st-note').textContent.trim()).toBe('URGENT ORDER');
    c.label.set({ ...bundle, stickerText: undefined });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sticker .st-note')).toBeNull();
  });
});
