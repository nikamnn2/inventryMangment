import { TestBed } from '@angular/core/testing';
import { DataService } from '../../core/services/data.service';
import { baseProviders, fillData } from '../../testing/fixtures';
import { DashboardComponent } from './dashboard.component';

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

  it('shows API numbers once the summary loads', async () => {
    spyOn(data, 'getDashboard').and.resolveTo(summary);
    const fixture = TestBed.createComponent(DashboardComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const c = fixture.componentInstance as any;

    expect(c.today()).toEqual({ packed: 2, sales: 3, revenue: 5000 });
    expect(c.soldBundles()).toBe(1);
    expect(c.days().length).toBe(7);
    expect(c.trend().line.startsWith('M0.0')).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Products');
  });

  it('falls back to local numbers when the summary request fails', async () => {
    spyOn(data, 'getDashboard').and.rejectWith(new Error('offline'));
    const fixture = TestBed.createComponent(DashboardComponent);
    await fixture.whenStable();
    const c = fixture.componentInstance as any;

    expect(c.today()).toEqual({ packed: 0, sales: 0, revenue: 0 });
    expect(c.soldBundles()).toBe(1); // b3 has 0 pieces
    expect(c.days()).toEqual([]);
  });

  it('builds KPIs, bars, statuses and the donut from the bundles', async () => {
    spyOn(data, 'getDashboard').and.resolveTo(summary);
    const fixture = TestBed.createComponent(DashboardComponent);
    await fixture.whenStable();
    const c = fixture.componentInstance as any;

    expect(c.kpis().map((k: { label: string }) => k.label)).toEqual(['Products', 'Bundles', 'Total pieces', 'Stock weight']);
    expect(c.kpis()[3].note).toContain('1 bundle(s) low');
    expect(c.bars().find((b: { id: string }) => b.id === 'b2')).toEqual(jasmine.objectContaining({ glass: true, low: true }));
    expect(c.statuses().map((s: { count: number }) => s.count)).toEqual([1, 1, 1]);
    expect(c.donut()).toContain('conic-gradient(');
  });
});
