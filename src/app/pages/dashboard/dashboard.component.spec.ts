import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { baseProviders, fillData } from '../../testing/fixtures';
import { DashboardComponent, greetingFor } from './dashboard.component';

const summary = {
    today: { packed: 2, bills: 3, revenue: 5000 },
    soldBundles: 1,
    trend: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ date: `2026-01-0${i + 1}`, label, weight: i * 10 })),
};

describe('DashboardComponent', () => {
    let data: DataService;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [DashboardComponent], providers: baseProviders() });
        data = TestBed.inject(DataService);
        fillData(data);
    });

    it('links bundle items to the Bundles page, searched for the clicked bundle', async () => {
        vi.spyOn(data, 'getDashboard').mockResolvedValue(summary);
        TestBed.inject(AuthService).user.set({ email: 'a@x.y', name: 'Asha', role: 'admin', modules: ['dashboard', 'bundles'] });
        vi.spyOn(TestBed.inject(AuthService), 'can').mockReturnValue(true);
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        const fixture = TestBed.createComponent(DashboardComponent);
        await fixture.whenStable();
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        const href = (selector: string) => el.querySelector(selector)?.getAttribute('href');
        const first = data.bundles()[0].id;

        expect([...el.querySelectorAll('a.kpi')].map(a => a.getAttribute('href'))).toEqual([null, '/bundles', null, null]);
        expect(href('a.donut-row')).toBe('/bundles');
        expect(href('a.bar-col')).toBe('/bundles?q=' + first);
        expect(href('a.alert')).toContain('/bundles?q=');
        expect(href('tbody td.mono a')).toBe('/bundles?q=' + first);
        el.querySelector<HTMLTableRowElement>('tbody tr')!.click();
        expect(navigate).toHaveBeenCalledWith(['/bundles'], { queryParams: { q: first } });
    });

    it('does not link bundle items for a role without the Bundles page', async () => {
        vi.spyOn(data, 'getDashboard').mockResolvedValue(summary);
        vi.spyOn(TestBed.inject(AuthService), 'can').mockReturnValue(false);
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
        const fixture = TestBed.createComponent(DashboardComponent);
        await fixture.whenStable();
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;

        expect(el.querySelectorAll('a.kpi[href], a.bar-col[href], a.donut-row[href], a.alert[href], td.mono a[href]').length).toBe(0);
        el.querySelector<HTMLTableRowElement>('tbody tr')!.click();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('picks the greeting from the time of day', () => {
        const at = (h: number, m = 0) => greetingFor(new Date(2026, 0, 1, h, m));
        expect([at(5), at(11, 59)]).toEqual(['Good morning', 'Good morning']);
        expect([at(12), at(16, 59)]).toEqual(['Good afternoon', 'Good afternoon']);
        expect([at(17), at(23, 59), at(0), at(4, 59)]).toEqual(Array(4).fill('Good evening'));
    });

    it('greets whoever is signed in by first name, and follows a change of user', async () => {
        vi.spyOn(data, 'getDashboard').mockResolvedValue(summary);
        const auth = TestBed.inject(AuthService);
        auth.user.set({ email: 'g@x.y', name: '  Ganesh Patil ', role: 'admin', modules: [] });
        const fixture = TestBed.createComponent(DashboardComponent);
        await fixture.whenStable();
        fixture.detectChanges();
        const heading = () => fixture.nativeElement.querySelector('h1').textContent.trim();

        expect(heading()).toBe(`${greetingFor(new Date())}, Ganesh 👋`);
        auth.user.set({ email: 'a@x.y', name: 'Asha', role: 'admin', modules: [] });
        fixture.detectChanges();
        expect(heading()).toContain(', Asha');
        auth.user.set(null);
        fixture.detectChanges();
        expect(heading()).toBe(`${greetingFor(new Date())} 👋`);
    });

    it('shows API numbers once the summary loads', async () => {
        vi.spyOn(data, 'getDashboard').mockResolvedValue(summary);
        const fixture = TestBed.createComponent(DashboardComponent);
        await fixture.whenStable();
        fixture.detectChanges();
        const c = fixture.componentInstance as any;

        expect(c.today()).toEqual({ packed: 2, sales: 3, revenue: 5000 });
        expect(c.soldBundles()).toBe(1);
        expect(c.days().length).toBe(7);
        expect(c.trend().line.startsWith('M0.0')).toBe(true);
        expect(fixture.nativeElement.textContent).toContain('Products');
    });

    it('falls back to local numbers when the summary request fails', async () => {
        vi.spyOn(data, 'getDashboard').mockRejectedValue(new Error('offline'));
        const fixture = TestBed.createComponent(DashboardComponent);
        await fixture.whenStable();
        const c = fixture.componentInstance as any;

        expect(c.today()).toEqual({ packed: 0, sales: 0, revenue: 0 });
        expect(c.soldBundles()).toBe(1); // b3 has 0 pieces
        expect(c.days()).toEqual([]);
    });

    it('builds KPIs, bars, statuses and the donut from the bundles', async () => {
        vi.spyOn(data, 'getDashboard').mockResolvedValue(summary);
        const fixture = TestBed.createComponent(DashboardComponent);
        await fixture.whenStable();
        const c = fixture.componentInstance as any;

        expect(c.kpis().map((k: {
            label: string;
        }) => k.label)).toEqual(['Products', 'Bundles', 'Total pieces', 'Stock weight']);
        expect(c.kpis()[3].note).toContain('1 bundle(s) low');
        expect(c.bars().find((b: {
            id: string;
        }) => b.id === 'b2')).toEqual(expect.objectContaining({ glass: true, low: true }));
        expect(c.statuses().map((s: {
            count: number;
        }) => s.count)).toEqual([1, 1, 1]);
        expect(c.donut()).toContain('conic-gradient(');
    });
});
