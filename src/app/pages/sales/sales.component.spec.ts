import type { Mock } from "vitest";
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
        vi.spyOn(data, 'refreshBundles').mockResolvedValue();
        vi.spyOn(data, 'refreshSales').mockResolvedValue();
        api = TestBed.inject(InvoiceService);
        vi.spyOn(api, 'list').mockResolvedValue(invoices);
        vi.spyOn(api, 'customers').mockResolvedValue(SAVED);
        vi.spyOn(api, 'search').mockResolvedValue([]);
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
        const lookup = vi.spyOn(api, 'lookup').mockImplementation(async (code) => (code === '103719' ? LINE('103719') : LINE('103838', 16, 19.78)));
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
        const lookup = vi.spyOn(api, 'lookup').mockResolvedValue(LINE('103719'));
        await Promise.all([c.add('103719'), c.add('103719')]);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(c.items().length).toBe(1);
    });

    describe('bundle suggestions', () => {
        const FOUND = [LINE('103719'), { ...LINE('103838', 16, 19.78), product: '18x40 HANDAL', rack: 'Black' }];
        const key = (k: string) => c.bundleKey(new KeyboardEvent('keydown', { key: k, cancelable: true }));
        const settle = () => new Promise(r => setTimeout(r, 20));

        async function ready() {
            await setup();
            c.searchDelay = 0;
            (api.search as Mock).mockResolvedValue(FOUND);
            return vi.spyOn(api, 'lookup').mockImplementation(async (code) => FOUND.find(f => f.bundleId === code) ?? 'Bundle not found.');
        }

        it('lists matches while typing and adds the one clicked, with its details', async () => {
            const lookup = await ready();
            c.typeBundle('1037');
            await settle();
            expect(api.search).toHaveBeenCalledWith('1037');
            expect(text()).toContain('18x40 HANDAL');
            expect(text()).toContain('16 PCS · 19.78 kg');
            expect(text()).toContain('Rack Black');
            (fixture.nativeElement.querySelectorAll('.bundle-combo li')[1] as HTMLElement).click();
            await settle();
            expect(lookup).toHaveBeenCalledWith('103838');
            expect(c.items().map((i: InvoiceLine) => i.bundleId)).toEqual(['103838']);
            expect(c.code()).toBe('');
            expect(c.bundleListOpen()).toBe(false);
            // an added bundle is not suggested again
            c.openBundleList();
            await settle();
            expect(c.bundleSuggestions().map((b: InvoiceLine) => b.bundleId)).toEqual(['103719']);
        });

        it('adds the suggestion marked with the arrow keys', async () => {
            await ready();
            c.typeBundle('10');
            await settle();
            key('ArrowDown');
            key('ArrowDown');
            await c.submitBundle(new Event('submit'));
            expect(c.items()[0].bundleId).toBe('103838');
        });

        it('on Enter without choosing adds only the exact number, never the first suggestion', async () => {
            const lookup = await ready();
            c.typeBundle('1037');
            await settle();
            await c.submitBundle(new Event('submit'));
            expect(lookup).toHaveBeenCalledWith('1037');
            expect(c.items()).toEqual([]);
            expect(c.error()).toBe('Bundle not found.');
        });

        it('ignores a late answer, says when nothing matches, and closes on Escape', async () => {
            await ready();
            let late!: (v: InvoiceLine[]) => void;
            (api.search as Mock).mockReturnValueOnce(new Promise(r => (late = r))).mockReturnValueOnce(Promise.resolve([]));
            c.typeBundle('old');
            await settle();
            c.typeBundle('zzz');
            await settle();
            late(FOUND);
            await settle();
            expect(c.bundleSuggestions()).toEqual([]);
            expect(text()).toContain('No available bundle matches.');
            key('Escape');
            expect(c.bundleListOpen()).toBe(false);
        });
    });

    it('shows why a bundle cannot be added', async () => {
        await setup();
        vi.spyOn(api, 'lookup').mockResolvedValue('Bundle 7 is already sold.');
        await c.add('7');
        expect(c.error()).toBe('Bundle 7 is already sold.');
        expect(c.items()).toEqual([]);
    });

    it('keeps the unfinished sale for this session', async () => {
        await setup();
        vi.spyOn(api, 'lookup').mockResolvedValue(LINE('103719'));
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
        expect(c.listOpen()).toBe(false);
    });

    it('asks for the customer name and number before creating', async () => {
        await setup();
        const create = vi.spyOn(api, 'create');
        c.review(new Event('submit'));
        expect(c.formError()).toBe('Add at least one bundle.');
        c.items.set([LINE('1')]);
        c.review(new Event('submit'));
        expect(c.formError()).toBe('Enter the customer name.');
        c.setField('name', 'N');
        c.review(new Event('submit'));
        expect(c.formError()).toBe('Enter a valid contact number.');
        c.setField('contact', '9860470406');
        c.setField('email', 'bad');
        c.review(new Event('submit'));
        expect(c.formError()).toBe('Enter a valid email address.');
        expect(create).not.toHaveBeenCalled();
    });

    it("creates an admin's invoice at once and opens it for printing", async () => {
        await setup('admin');
        const create = vi.spyOn(api, 'create').mockResolvedValue(INVOICE);
        c.items.set([LINE('2'), LINE('1')]);
        c.customer.set({ name: ' Ganesh Landge ', contact: '9860470406', email: '' });
        expect(text()).toContain('Create invoice');
        c.review(new Event('submit'));
        await c.create();
        expect(create).toHaveBeenCalledWith(['1', '2'], { name: 'Ganesh Landge', contact: '9860470406', email: '' });
        expect(c.items()).toEqual([]);
        expect(text()).toContain('SALES INVOICE');
        expect(text()).toContain('SALE-000150');
        expect(text()).toContain('Print invoice (A4)');
        expect(data.refreshBundles).toHaveBeenCalled();
        const print = vi.spyOn(window, 'print');
        c.print();
        expect(print).toHaveBeenCalled();
    });

    it("sends a sales user's invoice for approval, with nothing to print", async () => {
        await setup('sales');
        vi.spyOn(api, 'create').mockResolvedValue({ ...INVOICE, status: 'pending' });
        c.items.set([LINE('1')]);
        c.customer.set({ name: 'N', contact: '9860470406', email: '' });
        expect(text()).toContain('Send for approval');
        c.review(new Event('submit'));
        await c.create();
        expect(c.viewing()).toBeNull();
        expect(c.notice()).toContain('sent to an admin');
        c.viewing.set({ ...INVOICE, status: 'pending' });
        expect(text()).toContain('WAITING FOR ADMIN APPROVAL');
        expect(text()).not.toContain('Print invoice');
        expect(text()).not.toContain('Approve & create invoice');
        expect(fixture.nativeElement.querySelector('.invoice.sheet')).toBeNull();
    });

    it('saves nothing until the invoice has been checked and confirmed', async () => {
        await setup('admin');
        const create = vi.spyOn(api, 'create').mockResolvedValue(INVOICE);
        c.items.set([LINE('222', 16, 19.78), LINE('111')]);
        c.customer.set({ name: 'Ravi Traders', contact: '9860470406', email: '' });
        c.review(new Event('submit'));
        const shown = text();
        for (const part of ['Check before creating', 'Ravi Traders', '111', '222', '2 bundles · 26 pcs · 42.32 kg']) expect(shown).toContain(part);
        expect(create).not.toHaveBeenCalled();
        (fixture.nativeElement.querySelector('.review-modal .btn:not(.primary)') as HTMLButtonElement).click();
        expect(c.reviewing()).toBeNull();
        await c.create(); // nothing was confirmed
        expect(create).not.toHaveBeenCalled();
        expect(c.items().length).toBe(2);
        c.review(new Event('submit'));
        await Promise.all([c.create(), c.create()]); // a double click
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('lets a sales user cancel their own waiting invoice only', async () => {
        const mine: Invoice = { ...INVOICE, saleNo: 'SALE-000151', status: 'pending', createdBy: 'a@b.c' };
        const others: Invoice = { ...INVOICE, saleNo: 'SALE-000152', status: 'pending', createdBy: 'x@y.z' };
        const approved: Invoice = { ...INVOICE, createdBy: 'a@b.c' };
        await setup('sales', [mine, others, approved]);
        c.tab.set('invoices');
        text();
        const offered = [...fixture.nativeElement.querySelectorAll('.invoice-actions .danger-text')].map((b: any) => b.getAttribute('aria-label'));
        expect(offered).toEqual(['Cancel invoice SALE-000151']);
        c.askDelete(mine);
        expect(text()).toContain('Cancel SALE-000151?');
        vi.spyOn(api, 'remove').mockResolvedValue({ deleted: 'SALE-000151', restocked: 0, notRestored: [], numberReused: false });
        (api.list as any).mockResolvedValue([others, approved]);
        await c.confirmDelete();
        expect(c.notice()).toBe('SALE-000151 was cancelled. Its bundles are available again.');
    });

    it('keeps the list when the invoice cannot be created', async () => {
        await setup();
        vi.spyOn(api, 'create').mockResolvedValue('Bundle 1 was just taken by someone else.');
        c.items.set([LINE('1')]);
        c.customer.set({ name: 'N', contact: '9860470406', email: '' });
        c.review(new Event('submit'));
        await c.create();
        expect(c.formError()).toContain('just taken');
        expect(c.items().length).toBe(1);
    });

    it('lets an admin approve or reject a waiting invoice', async () => {
        await setup('admin', [{ ...INVOICE, status: 'pending' }]);
        c.tab.set('invoices');
        expect(text()).toContain('1 waiting');
        expect(text()).toContain('Review');
        const decide = vi.spyOn(api, 'decide').mockImplementation(async (_n, d) => ({ ...INVOICE, status: d === 'approve' ? 'issued' : 'rejected' }));
        await c.decide(c.invoices()[0], 'approve');
        expect(decide).toHaveBeenCalledWith('SALE-000150', 'approve');
        expect(c.viewing().status).toBe('issued');
        await c.decide(c.invoices()[0], 'reject');
        expect(c.viewing()).toBeNull();
        decide.mockResolvedValue('This invoice has already been decided.');
        await c.decide(c.invoices()[0], 'approve');
        expect(c.listError()).toBe('This invoice has already been decided.');
    });

    const PDF = new File(['%PDF-'], 'SALE-000150.pdf', { type: 'application/pdf' });

    it('downloads the PDF on a computer, for an issued invoice only, and shows why it failed', async () => {
        await setup();
        Object.defineProperty(c, 'mobile', { value: false });
        const pdf = vi.spyOn(api, 'pdf').mockResolvedValue(PDF);
        const save = vi.spyOn(api, 'saveFile');
        const share = vi.spyOn(api, 'shareFile');
        c.openInvoice(INVOICE);
        expect(text()).toContain('Download PDF');
        expect(text()).not.toContain('Share PDF');
        await c.sendPdf(INVOICE);
        expect(save).toHaveBeenCalledWith(PDF);
        expect(share).not.toHaveBeenCalled();
        pdf.mockResolvedValue('Only an approved invoice can be downloaded.');
        c.openInvoice(INVOICE);
        await c.sendPdf(INVOICE);
        expect(text()).toContain('Only an approved invoice can be downloaded.');
        c.openInvoice({ ...INVOICE, status: 'pending' });
        expect(text()).not.toContain('Download PDF');
    });

    it('shares the PDF on a phone, fetched when the invoice is opened', async () => {
        await setup();
        Object.defineProperty(c, 'mobile', { value: true });
        const pdf = vi.spyOn(api, 'pdf').mockResolvedValue(PDF);
        const share = vi.spyOn(api, 'shareFile').mockResolvedValue('shared');
        const save = vi.spyOn(api, 'saveFile');
        c.openInvoice(INVOICE);
        expect(pdf).toHaveBeenCalledTimes(1);
        expect(text()).toContain('Share PDF');
        expect(text()).not.toContain('Download PDF');
        await c.sendPdf(INVOICE);
        expect(share).toHaveBeenCalledWith(PDF);
        expect(pdf).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
        expect(c.pdfNote()).toBe('');
        share.mockResolvedValue('saved');
        await c.sendPdf(INVOICE);
        expect(text()).toContain('was saved to your downloads');
    });

    it('shows the rack of each added bundle', async () => {
        await setup();
        vi.spyOn(api, 'lookup').mockResolvedValue({ ...LINE('103719'), rack: 'Champagne' });
        await c.add('103719');
        expect(text()).toContain('Champagne');
    });

    it('lets an admin delete an invoice after confirming, and says what happened', async () => {
        await setup('admin', [INVOICE]);
        c.tab.set('invoices');
        text();
        (fixture.nativeElement.querySelector('[aria-label="Delete invoice SALE-000150"]') as HTMLButtonElement).click();
        expect(text()).toContain('Delete SALE-000150?');
        expect(text()).toContain('back into stock');
        const remove = vi.spyOn(api, 'remove').mockResolvedValue({ deleted: 'SALE-000150', restocked: 1, notRestored: ['103719'], numberReused: true });
        (api.list as any).mockResolvedValue([]);
        await c.confirmDelete();
        expect(remove).toHaveBeenCalledWith('SALE-000150');
        expect(c.invoices()).toEqual([]);
        expect(c.notice()).toBe('SALE-000150 was deleted. 1 bundle is back in stock. Check these bundles, which changed after the sale and were left as they are: 103719. The next invoice will be SALE-000150 again.');
        expect(data.refreshBundles).toHaveBeenCalled();
    });

    it('keeps the invoice when deleting fails, and offers delete to admins only', async () => {
        await setup('admin', [INVOICE]);
        vi.spyOn(api, 'remove').mockResolvedValue('Only an admin can delete invoices.');
        c.askDelete(INVOICE);
        await c.confirmDelete();
        expect(c.deleteError()).toBe('Only an admin can delete invoices.');
        expect(c.invoices().length).toBe(1);
        expect(api.list).toHaveBeenCalledTimes(2);
        expect(data.refreshBundles).toHaveBeenCalled();
        c.tab.set('invoices');
        TestBed.inject(AuthService).user.set({ email: 's@x.y', name: 'S', role: 'sales', modules: ['sales'] });
        text();
        expect(fixture.nativeElement.querySelector('[aria-label^="Delete invoice "]')).toBeNull();
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
