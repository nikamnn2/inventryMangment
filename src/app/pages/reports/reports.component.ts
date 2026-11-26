import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { DataService, Range, ReportData } from '../../core/services/data.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PagerComponent, createPager } from '../../shared/components/pager/pager.component';

/** Shown until the first report arrives. */
const EMPTY: ReportData = { totals: { revenue: 0, weightSold: 0, bills: 0, bundlesPacked: 0 }, sales: [], packing: [] };

/** Purpose: Reports page: totals for Today / Week / Month / All with the sales and packing tables and CSV downloads. */
@Component({
  selector: 'app-reports',
  imports: [IconComponent, DecimalPipe, PagerComponent],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent {
  private readonly data = inject(DataService);
  protected readonly ranges: Range[] = ['Today', 'Week', 'Month', 'All'];
  protected readonly range = signal<Range>('All');
  protected readonly report = signal<ReportData>(EMPTY);
  protected readonly error = signal('');
  private request = 0;

  protected readonly salesPager = createPager(() => this.report().sales, () => this.range());
  protected readonly packingPager = createPager(() => this.report().packing, () => this.range());

  constructor() {
    void this.select('All');
  }

  /** Loads the report for a range; a counter ignores slow, out-of-date responses. */
  protected async select(range: Range): Promise<void> {
    this.range.set(range);
    const mine = ++this.request; // ignore out-of-order responses
    try {
      const data = await this.data.getReport(range);
      if (mine === this.request) {
        this.report.set(data);
        this.error.set('');
      }
    } catch {
      if (mine === this.request) this.error.set('Could not load the report. Please try again.');
    }
  }

  /** Downloads the current range as a CSV file. */
  protected exportCsv(kind: 'sales' | 'packing'): void {
    void this.data.download(`/api/reports/${kind}.csv?range=${this.range()}`, `${kind}-report.csv`);
  }
}
