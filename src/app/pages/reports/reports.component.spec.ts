import { TestBed } from '@angular/core/testing';
import { DataService, ReportData } from '../../core/services/data.service';
import { SALE, baseProviders, fillData } from '../../testing/fixtures';
import { ReportsComponent } from './reports.component';

const report = (bills: number): ReportData => ({
    totals: { revenue: 1000, weightSold: 5, bills, bundlesPacked: 1 },
    sales: [SALE],
    packing: [{ id: 'b1', code: 'AL-1', pieces: 1, weight: 1, packed: '2026-01-01', status: 'Packed', rack: 'A', productName: 'Window Frame' }],
});

describe('ReportsComponent', () => {
    let data: DataService;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [ReportsComponent], providers: baseProviders() });
        data = TestBed.inject(DataService);
        fillData(data);
    });

    it('loads the "All" report on start and renders it', async () => {
        const get = vi.spyOn(data, 'getReport').mockResolvedValue(report(1));
        const fixture = TestBed.createComponent(ReportsComponent);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(get).toHaveBeenCalledWith('All');
        expect((fixture.componentInstance as any).report().totals.bills).toBe(1);
        expect(fixture.nativeElement.textContent).toContain('INV-1');
    });

    it('reloads when another range is picked', async () => {
        const get = vi.spyOn(data, 'getReport').mockResolvedValue(report(2));
        const fixture = TestBed.createComponent(ReportsComponent);
        const c = fixture.componentInstance as any;
        await c.select('Week');
        expect(c.range()).toBe('Week');
        expect(get).toHaveBeenCalledWith('Week');
        expect(c.report().totals.bills).toBe(2);
    });

    it('shows an error when the report cannot be loaded', async () => {
        vi.spyOn(data, 'getReport').mockRejectedValue(new Error('boom'));
        const fixture = TestBed.createComponent(ReportsComponent);
        await fixture.whenStable();
        expect((fixture.componentInstance as any).error()).toContain('Could not load');
    });

    it('ignores a stale response that arrives after a newer request', async () => {
        let releaseFirst!: (r: ReportData) => void;
        const get = vi.spyOn(data, 'getReport');
        get.mockReturnValueOnce(new Promise<ReportData>(res => (releaseFirst = res))).mockReturnValueOnce(Promise.resolve(report(2)));
        const fixture = TestBed.createComponent(ReportsComponent); // request 1 (pending)
        const c = fixture.componentInstance as any;
        await c.select('Month'); // request 2 (resolves first)
        releaseFirst(report(99));
        await fixture.whenStable();
        expect(c.report().totals.bills).toBe(2);
    });

    it('downloads the sales and packing CSVs for the current range', () => {
        vi.spyOn(data, 'getReport').mockResolvedValue(report(1));
        const download = vi.spyOn(data, 'download').mockResolvedValue();
        const c = TestBed.createComponent(ReportsComponent).componentInstance as any;
        c.exportCsv('sales');
        c.exportCsv('packing');
        expect(download).toHaveBeenCalledWith('/api/reports/sales.csv?range=All', 'sales-report.csv');
        expect(download).toHaveBeenCalledWith('/api/reports/packing.csv?range=All', 'packing-report.csv');
    });
});
