import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PagerComponent, createPager } from '../../shared/components/pager/pager.component';

/** Purpose: Stock Overview page: every bundle with filters (available / sold, product, search), per-category totals and a CSV export. */
@Component({
  selector: 'app-stock',
  imports: [IconComponent, DecimalPipe, FormsModule, PagerComponent],
  templateUrl: './stock.component.html',
  styleUrl: './stock.component.scss',
})
export class StockComponent {
  protected readonly data = inject(DataService);
  protected readonly q = signal('');
  protected readonly state = signal('all');
  protected readonly profile = signal('');

  /** Bundles that match the filters, sorted by product name. */
  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.data.bundles()
      .filter(b =>
        (this.state() === 'all' || (this.state() === 'sold' ? b.pieces === 0 : b.pieces > 0)) &&
        (!this.profile() || b.code === this.profile()) &&
        (!q || `${b.id} ${b.code} ${this.data.productName(b.code)} ${b.rack}`.toLowerCase().includes(q)))
      .sort((a, b) => this.data.productName(a.code).localeCompare(this.data.productName(b.code)));
  });

  protected readonly pager = createPager(() => this.rows(), () => `${this.state()}|${this.profile()}|${this.q()}`);

  /** Pieces, bundles and weight per category, with its share of total stock. */
  protected readonly summary = computed(() => {
    const total = Math.max(1, this.data.totalPieces());
    return (['Aluminium', 'Glass'] as const).map(cat => {
      const list = this.data.bundles().filter(b => this.data.categoryOf(b.code) === cat);
      const pcs = list.reduce((n, b) => n + b.pieces, 0);
      return { cat, pcs, bundles: list.length, weight: list.reduce((n, b) => n + b.weight, 0), share: (pcs / total) * 100 };
    });
  });

  /** The API builds the CSV from the same filters the screen uses. */
  protected exportCsv(): void {
    const params = new URLSearchParams({ state: this.state() });
    if (this.profile()) params.set('dieNo', this.profile());
    if (this.q().trim()) params.set('q', this.q().trim());
    void this.data.download(`/api/stock/export.csv?${params}`, 'stock-overview.csv');
  }
}
