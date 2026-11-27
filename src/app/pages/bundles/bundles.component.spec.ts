import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/services/auth.service';
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
        expect(c.list().map((b: {
            id: string;
        }) => b.id)).toEqual(['b2']);
        c.q.set('a-01');
        expect(c.list().map((b: {
            id: string;
        }) => b.id)).toEqual(['b1']);
    });

    /** Opens the add panel and enters pieces and weight, as a user would. */
    const typeNew = (values: object = {}) => {
        c.startAdding();
        Object.assign(c.entry, { pieces: 10, weight: 50 }, values);
    };
    const saveNew = () => c.saveEntry(new Event('submit'));
    const savedAs = (id: string) => vi.spyOn(data, 'addBundle').mockImplementation(async (b) => {
        const saved = { ...b, id };
        data.bundles.update(l => [saved, ...l]);
        return saved;
    });

    it('calculates the average weight from the form', () => {
        typeNew({ pieces: 10, weight: 25 });
        expect(c.avg(c.entry)).toBe('2.500');
        c.entry.pieces = 0;
        expect(c.avg(c.entry)).toBe('');
    });

    it('opens the add panel on the page, blank, and the edit dialog filled', () => {
        c.startAdding();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.entry-panel')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.modal-scrim')).toBeNull();
        expect(c.entry.code).toBe('AL-1');
        c.open(BUNDLES[1]);
        expect(c.dialog()).toBe(true);
        expect(c.editingId()).toBe('b2');
        expect(c.form).toEqual(expect.objectContaining({ code: 'GL-1', pieces: 8, rack: 'G-01' }));
        // editing a row leaves what is being added alone
        expect(c.entry).toEqual(expect.objectContaining({ code: 'AL-1', pieces: null }));
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Clear Glass');
    });

    it('rejects an invalid new bundle without calling the API', async () => {
        const add = vi.spyOn(data, 'addBundle');
        typeNew({ pieces: 0 });
        await saveNew();
        expect(add).not.toHaveBeenCalled();
        expect(c.entryError()).toContain('Select a product');
    });

    it('starts pieces and weight empty and does not save until both are entered', async () => {
        const add = vi.spyOn(data, 'addBundle');
        const update = vi.spyOn(data, 'updateBundle');
        c.startAdding();
        expect(c.entry).toEqual(expect.objectContaining({ pieces: null, weight: null }));
        expect(c.avg(c.entry)).toBe('');
        await saveNew();
        c.open(BUNDLES[0]);
        c.form.weight = null; // a cleared number input
        await submit();
        expect(add).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(c.error()).toContain('enter pieces and weight');
    });

    it('stays open after each save, ready for the next, without opening a popup', async () => {
        const add = savedAs('n1');
        typeNew({ code: 'GL-1', packed: '2026-11-20', rack: '' });
        await saveNew();
        expect(add).toHaveBeenCalledWith(expect.objectContaining({ pieces: 10, weight: 50, rack: '—' }));
        expect(c.adding()).toBe(true);
        expect(c.label()).toBeNull();
        expect(c.entry).toEqual(expect.objectContaining({ code: 'GL-1', packed: '2026-11-20', pieces: null, weight: null }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.modal-scrim')).toBeNull();
        // only the print button, ahead of the count, at the top of the panel
        const tools = fixture.nativeElement.querySelector('.entry-panel .card-head .entry-tools');
        expect(tools.firstElementChild.textContent.trim()).toBe('Print label');
        expect(tools.lastElementChild.textContent.trim()).toBe('1 added now');
        expect(fixture.nativeElement.querySelector('.entry-panel .notice')).toBeNull();
        (tools.firstElementChild as HTMLButtonElement).click();
        expect(c.label()?.id).toBe('n1');
        c.label.set(null);
        expect(fixture.nativeElement.textContent).toContain('1 added now');
        const refresh = vi.spyOn(data, 'refreshBundles').mockResolvedValue();
        c.finishAdding();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(c.adding()).toBe(false);
        expect(c.notice()).toBe('1 bundle added.');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('app-toast').textContent.trim()).toBe('1 bundle added.');
    });

    it('hides the list title, search, count and ticking while adding, and shows them again after', () => {
        const has = (selector: string) => { fixture.detectChanges(); return !!fixture.nativeElement.querySelector(selector); };
        const parts = ['input[type=search]', '.pick-bar', 'input.pick'];
        c.togglePick('b1');
        for (const part of parts) expect(has(part)).toBe(true);
        c.startAdding();
        for (const part of parts) expect(has(part)).toBe(false);
        expect(fixture.nativeElement.textContent).not.toContain('Bundle list');
        expect(fixture.nativeElement.textContent).not.toContain('3 bundles');
        expect(fixture.nativeElement.querySelectorAll('table.tbl tbody tr').length).toBe(3);
        expect(c.pickedBundles()).toEqual([]);
        c.finishAdding();
        for (const part of parts) expect(has(part)).toBe(true);
        expect(fixture.nativeElement.textContent).toContain('3 bundles');
    });

    it('shows five records while adding and the usual eight afterwards, from the first page', () => {
        data.bundles.set(Array.from({ length: 20 }, (_, i) => ({ ...BUNDLES[0], id: 'p' + i })));
        expect(c.pager.rows().length).toBe(8);
        c.pager.go(2);
        c.startAdding();
        expect([c.pager.rows().length, c.pager.page(), c.pager.pages()]).toEqual([5, 1, 4]);
        c.pager.go(3);
        c.finishAdding();
        expect([c.pager.rows().length, c.pager.page(), c.pager.pages()]).toEqual([8, 1, 3]);
    });

    it('saves a bundle once when Enter is pressed twice', async () => {
        let done!: (b: any) => void;
        const add = vi.spyOn(data, 'addBundle').mockReturnValue(new Promise(r => (done = r)));
        typeNew();
        const first = saveNew();
        await saveNew();
        c.finishAdding(); // not while saving
        expect(c.adding()).toBe(true);
        done({ ...BUNDLES[0], id: 'n1' });
        await first;
        await saveNew(); // the fields are empty again
        expect(add).toHaveBeenCalledTimes(1);
    });

    it('warns before Done throws away typed values', () => {
        typeNew();
        c.finishAdding();
        expect(c.adding()).toBe(true);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('are not saved');
        c.finishAdding();
        expect(c.adding()).toBe(false);
        expect(c.notice()).toBe('');
    });

    it('shows the server message and keeps what was typed when creating fails', async () => {
        vi.spyOn(data, 'addBundle').mockResolvedValue('Unknown product Die No X.');
        typeNew();
        await saveNew();
        expect(c.entryError()).toBe('Unknown product Die No X.');
        expect(c.entry).toEqual(expect.objectContaining({ pieces: 10, weight: 50 }));
        expect(c.adding()).toBe(true);
    });

    it('updates an existing bundle', async () => {
        const update = vi.spyOn(data, 'updateBundle').mockResolvedValue(null);
        c.open(BUNDLES[0]);
        await submit();
        expect(update).toHaveBeenCalledWith('b1', expect.objectContaining({ code: 'AL-1', rack: 'A-01' }));
        expect(c.dialog()).toBe(false);
    });

    it('keeps the dialog open when an update fails', async () => {
        vi.spyOn(data, 'updateBundle').mockResolvedValue('Bundle not found.');
        c.open(BUNDLES[0]);
        await submit();
        expect(c.error()).toBe('Bundle not found.');
    });

    describe('rack', () => {
        beforeEach(() => localStorage.clear());
        afterEach(() => localStorage.clear());

        it('keeps the last chosen rack for the next new bundle, until another is chosen', async () => {
            const add = savedAs('n1');
            typeNew();
            expect(c.entry.rack).toBe('');
            c.entry.rack = 'silver';
            await saveNew();
            expect(add).toHaveBeenCalledWith(expect.objectContaining({ rack: 'Silver' }));
            expect(c.entry.rack).toBe('Silver');
            c.finishAdding();
            // editing an old bundle shows its own rack and does not change the choice for new ones
            c.open(BUNDLES[0]);
            expect(c.form.rack).toBe('A-01');
            vi.spyOn(data, 'updateBundle').mockResolvedValue(null);
            await submit();
            c.startAdding();
            expect(c.entry.rack).toBe('Silver');
        });

        it('adds a value typed under Other to the choices, and asks for it when left empty', async () => {
            const add = savedAs('n1');
            typeNew();
            c.entryOther = true;
            c.entry.rack = '  ';
            await saveNew();
            expect(c.entryError()).toContain('Type the new rack value');
            expect(add).not.toHaveBeenCalled();
            c.entry.rack = 'Champagne';
            await saveNew();
            expect(c.racks().slice(0, 3)).toEqual(['Black', 'Silver', 'Gold']);
            expect(c.racks().at(-1)).toBe('Champagne');
        });

        it('changes the rack of several selected bundles', async () => {
            c.togglePick('b1');
            c.togglePick('b2');
            expect(c.pickedBundles().map((b: {
                id: string;
            }) => b.id)).toEqual(['b1', 'b2']);
            fixture.detectChanges();
            expect(fixture.nativeElement.textContent).toContain('2 selected');
            const set = vi.spyOn(data, 'setRack').mockResolvedValue({ updated: 1, held: ['b2'] });
            c.openRackDialog();
            await c.changeRacks(new Event('submit'));
            expect(c.rackError()).toBe('Choose the rack to set.');
            c.bulkRack = 'gold';
            await c.changeRacks(new Event('submit'));
            expect(set).toHaveBeenCalledWith(['b1', 'b2'], 'Gold');
            expect(c.rackDialog()).toBe(false);
            expect(c.pickedBundles()).toEqual([]);
            expect(c.notice()).toContain('on 1 bundle.');
            expect(c.notice()).toContain('b2');
        });

        it('selects all bundles found by the search, and keeps the selection when saving fails', async () => {
            c.q.set('a-0');
            c.pickAll();
            expect(c.pickedBundles().map((b: {
                id: string;
            }) => b.id)).toEqual(['b1', 'b3']);
            expect(c.allPicked()).toBe(true);
            vi.spyOn(data, 'setRack').mockResolvedValue('Cannot reach the server.');
            c.openRackDialog();
            c.bulkRack = 'Black';
            await c.changeRacks(new Event('submit'));
            expect(c.rackError()).toBe('Cannot reach the server.');
            expect(c.pickedBundles().length).toBe(2);
            c.pickAll();
            expect(c.pickedBundles()).toEqual([]);
        });
    });

    describe('delete', () => {
        it('asks first, then deletes and says so', async () => {
            const remove = vi.spyOn(data, 'deleteBundle').mockResolvedValue(null);
            c.togglePick('b1');
            c.askDelete(BUNDLES[0]);
            fixture.detectChanges();
            expect(fixture.nativeElement.textContent).toContain('Delete bundle b1?');
            expect(remove).not.toHaveBeenCalled();
            await c.confirmDelete();
            expect(remove).toHaveBeenCalledWith('b1');
            expect(c.deleting()).toBeNull();
            expect(c.pickedBundles()).toEqual([]);
            expect(c.notice()).toBe('Bundle b1 was deleted.');
        });

        it('keeps the dialog open with the reason when it cannot be deleted', async () => {
            vi.spyOn(data, 'deleteBundle').mockResolvedValue('This bundle was sold on SALE-000001. Delete that invoice first.');
            c.askDelete(BUNDLES[0]);
            await c.confirmDelete();
            fixture.detectChanges();
            expect(fixture.nativeElement.textContent).toContain('Delete that invoice first.');
            expect(c.deleting()).not.toBeNull();
        });

        it('offers delete to admins only', () => {
            const auth = TestBed.inject(AuthService);
            Object.defineProperty(auth, 'disabled', { value: false });
            const buttons = () => { fixture.detectChanges(); return fixture.nativeElement.querySelectorAll('[aria-label^="Delete bundle "]').length; };
            auth.user.set({ email: 'm@x.y', name: 'M', role: 'manager', modules: ['bundles'] });
            expect(buttons()).toBe(0);
            auth.user.set({ email: 'a@x.y', name: 'A', role: 'admin', modules: ['bundles'] });
            expect(buttons()).toBe(3);
        });
    });

    it('prints the label', () => {
        const print = vi.spyOn(window, 'print');
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
