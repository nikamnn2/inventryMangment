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

  describe('rack', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('keeps the last chosen rack for the next new bundle, until another is chosen', async () => {
      const add = spyOn(data, 'addBundle').and.resolveTo({ ...BUNDLES[0], id: 'new' });
      c.open();
      expect(c.form.rack).toBe('');
      c.form.rack = 'silver';
      await submit();
      expect(add).toHaveBeenCalledWith(jasmine.objectContaining({ rack: 'Silver' }));
      c.open();
      expect(c.form.rack).toBe('Silver');
      // editing an old bundle shows its own rack and does not change the choice for new ones
      c.open(BUNDLES[0]);
      expect(c.form.rack).toBe('A-01');
      spyOn(data, 'updateBundle').and.resolveTo(null);
      await submit();
      c.open();
      expect(c.form.rack).toBe('Silver');
    });

    it('adds a value typed under Other to the choices, and asks for it when left empty', async () => {
      const add = spyOn(data, 'addBundle').and.callFake(async b => {
        const saved = { ...b, id: 'new' };
        data.bundles.update(l => [saved, ...l]);
        return saved;
      });
      c.open();
      c.rackOther = true;
      c.form.rack = '  ';
      await submit();
      expect(c.error()).toContain('Type the new rack value');
      expect(add).not.toHaveBeenCalled();
      c.form.rack = 'Champagne';
      await submit();
      expect(c.racks().slice(0, 3)).toEqual(['Black', 'Silver', 'Gold']);
      expect(c.racks().at(-1)).toBe('Champagne');
    });

    it('changes the rack of several selected bundles', async () => {
      c.togglePick('b1');
      c.togglePick('b2');
      expect(c.pickedBundles().map((b: { id: string }) => b.id)).toEqual(['b1', 'b2']);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('2 selected');
      const set = spyOn(data, 'setRack').and.resolveTo({ updated: 1, held: ['b2'] });
      c.openRackDialog();
      await c.changeRacks(new Event('submit'));
      expect(c.rackError()).toBe('Choose the rack to set.');
      c.bulkRack = 'gold';
      await c.changeRacks(new Event('submit'));
      expect(set).toHaveBeenCalledWith(['b1', 'b2'], 'Gold');
      expect(c.rackDialog()).toBeFalse();
      expect(c.pickedBundles()).toEqual([]);
      expect(c.notice()).toContain('on 1 bundle.');
      expect(c.notice()).toContain('b2');
    });

    it('selects all bundles found by the search, and keeps the selection when saving fails', async () => {
      c.q.set('a-0');
      c.pickAll();
      expect(c.pickedBundles().map((b: { id: string }) => b.id)).toEqual(['b1', 'b3']);
      expect(c.allPicked()).toBeTrue();
      spyOn(data, 'setRack').and.resolveTo('Cannot reach the server.');
      c.openRackDialog();
      c.bulkRack = 'Black';
      await c.changeRacks(new Event('submit'));
      expect(c.rackError()).toBe('Cannot reach the server.');
      expect(c.pickedBundles().length).toBe(2);
      c.pickAll();
      expect(c.pickedBundles()).toEqual([]);
    });
  });

  it('prints the label', () => {
    const print = spyOn(window, 'print');
    c.print();
    expect(print).toHaveBeenCalled();
  });

  it('prints the details as a table, with the batch and date made from the packing date', () => {
    const fixture = TestBed.createComponent(BundlesComponent);
    const c = fixture.componentInstance as any;
    c.label.set({ id: '78b54792f27734c0', code: 'AL-1001', pieces: 10, weight: 30, packed: '2026-11-26', status: 'Packed', rack: '' });
    fixture.detectChanges();
    const rows = [...fixture.nativeElement.querySelectorAll('.sticker .st-row')].map((r: any) => r.textContent.replace(/\s+/g, ''));
    expect(rows[0]).toBe('BUNDLEID:78b54792f27734c0');
    expect(rows[2]).toBe('PCS:10AVGWT:3.000');
    expect(rows[3]).toBe('TOTALWT:30.00Kg');
    expect(rows[5]).toBe('BATCH:B-261126MFG:26-11-26');
    expect(rows.length).toBe(6);
    expect([c.batch(''), c.shortDate('')]).toEqual(['-', '-']);
  });

  it('prints the rack as the sticker label, and no label line for an empty rack', () => {
    const fixture = TestBed.createComponent(BundlesComponent);
    const c = fixture.componentInstance as any;
    const bundle = { id: 'x1', code: 'AL-1001', pieces: 1, weight: 1, packed: '2026-11-26', status: 'Packed', rack: 'BLACK' };
    const note = () => fixture.nativeElement.querySelector('.sticker .st-label')?.textContent.replace(/\s+/g, '') ?? null;
    c.label.set(bundle);
    fixture.detectChanges();
    expect(note()).toBe('LABEL:Black');
    for (const [rack, printed] of [['black', 'Black'], ['  MATT BLACK ', 'Matt black'], ['a-01', 'A-01']]) {
      c.label.set({ ...bundle, rack });
      fixture.detectChanges();
      expect(note()).toBe('LABEL:' + printed.replace(' ', ''));
    }
    for (const rack of ['', '—', '-']) {
      c.label.set({ ...bundle, rack });
      fixture.detectChanges();
      expect(note()).toBeNull();
    }
  });
});
