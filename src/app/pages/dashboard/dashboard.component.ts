import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, NgZone, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { DashboardSummary, DataService, Status } from '../../core/services/data.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Greeting for the time of day: morning from 05:00, afternoon from 12:00, evening from 17:00 until 05:00. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  return hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Purpose: Dashboard page: key figures, stock per bundle, status split, today's activity and the 7-day sales trend. */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, IconComponent, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  protected readonly data = inject(DataService);
  private readonly auth = inject(AuthService);

  /** The current time, refreshed while the page is open so the greeting follows the clock. */
  private readonly now = signal(new Date());

  /** For example "Good evening, Ganesh", using the first name of whoever is signed in. */
  protected readonly greeting = computed(() => {
    const first = this.auth.user()?.name.trim().split(/\s+/)[0];
    return first ? `${greetingFor(this.now())}, ${first}` : greetingFor(this.now());
  });

  /** The four headline tiles (products, bundles, total pieces, stock weight). */
  protected readonly kpis = computed(() => [
    { label: 'Products', value: String(this.data.products().length).padStart(2, '0'), unit: '', note: 'Profiles & glass types', icon: 'box', tone: 't1' },
    { label: 'Bundles', value: String(this.data.bundleCount()).padStart(2, '0'), unit: '', note: 'Packed, shipped & sold', icon: 'layers', tone: 't2' },
    { label: 'Total pieces', value: this.data.totalPieces().toLocaleString('en-IN'), unit: 'pcs', note: 'Across all bundles', icon: 'warehouse', tone: 't3' },
    { label: 'Stock weight', value: (this.data.totalWeight() / 1000).toFixed(2), unit: 'tonnes', note: `${this.data.lowStock().length} bundle(s) low on stock`, icon: 'scale', tone: 't4' },
  ]);

  /** Today's numbers and the 7-day trend come from the API (computed in MongoDB's data). */
  private readonly summary = signal<DashboardSummary | null>(null);

  constructor() {
    // browser only (a timer would stall server rendering), and outside Angular's zone so the app still counts as idle
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = inject(NgZone).runOutsideAngular(() => setInterval(() => this.now.set(new Date()), 30_000));
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
    void this.data.getDashboard().then(s => this.summary.set(s)).catch(() => undefined);
  }

  protected readonly today = computed(() => {
    const t = this.summary()?.today;
    return { packed: t?.packed ?? 0, sales: t?.bills ?? 0, revenue: t?.revenue ?? 0 };
  });

  protected readonly soldBundles = computed(() => this.summary()?.soldBundles ?? this.data.bundles().filter(b => b.pieces === 0).length);

  /** Bar chart of pieces left in each bundle (low-stock bundles are flagged). */
  protected readonly bars = computed(() => {
    const list = this.data.bundles();
    const max = Math.max(1, ...list.map(b => b.pieces));
    return list.map(b => ({
      id: b.id,
      code: b.code,
      pieces: b.pieces,
      glass: this.data.categoryOf(b.code) === 'Glass',
      low: b.pieces < this.data.lowLimit(),
      h: Math.max(6, (b.pieces / max) * 82),
    }));
  });

  /** How many bundles are Packed / Shipped / Sold. */
  protected readonly statuses = computed(() => {
    const list = this.data.bundles();
    return (['Packed', 'Shipped', 'Sold'] as Status[]).map(name => ({
      name,
      cls: name.toLowerCase(),
      count: list.filter(b => b.status === name).length,
    }));
  });

  /** CSS conic-gradient that draws the status split as a donut chart. */
  protected readonly donut = computed(() => {
    const colors: Record<string, string> = { Packed: '#2c8a5f', Shipped: '#3f6fc4', Sold: '#d98b2b' };
    const total = Math.max(1, this.data.bundleCount());
    let acc = 0;
    const stops = this.statuses().filter(s => s.count).map(s => {
      const from = (acc / total) * 100;
      acc += s.count;
      return `${colors[s.name]} ${from}% ${(acc / total) * 100}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  });

  /** Day labels for the trend chart. */
  protected readonly days = computed(() => (this.summary()?.trend ?? []).map(t => t.label));

  /** Weight sold per day over the last seven days. */
  protected readonly trend = computed(() => {
    const values = this.summary()?.trend.map(t => t.weight) ?? [0, 0, 0, 0, 0, 0, 0];
    const max = Math.max(1, ...values) * 1.15;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * 400, 130 - (v / max) * 120] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L400 140 L0 140 Z` };
  });
}
