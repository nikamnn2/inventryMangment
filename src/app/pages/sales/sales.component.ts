import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService, Sale } from '../../core/services/data.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Purpose: Sales page: record a sale from a bundle (scan or pick it), preview the bill and browse sales history. */
@Component({
  selector: 'app-sales',
  imports: [FormsModule, IconComponent, DecimalPipe, NgTemplateOutlet],
  templateUrl: './sales.component.html',
  styleUrl: './sales.component.scss',
})
export class SalesComponent {
  protected readonly data = inject(DataService);
  protected readonly tab = signal<'new' | 'history'>('new');
  protected readonly available = computed(() => this.data.bundles().filter(b => b.pieces > 0));
  protected readonly bundleId = signal(this.available()[0]?.id ?? '');
  protected readonly qty = signal(1);
  protected readonly customer = signal('');
  protected readonly scan = signal('');
  protected readonly error = signal('');
  protected readonly bill = signal<Sale | null>(null);
  protected readonly detail = signal<Sale | null>(null);

  protected readonly current = computed(() => this.data.bundles().find(b => b.id === this.bundleId()));
  /** Stock left after the sale, or a warning when the quantity is too high. */
  protected readonly remaining = computed(() => {
    const b = this.current();
    const q = Number(this.qty());
    if (!b || !(q > 0)) return '—';
    if (q > b.pieces) return 'Not enough stock';
    return `${b.pieces - q} pcs · ${(b.weight - (b.weight / b.pieces) * q).toFixed(2)} kg`;
  });

  /** Looks a bundle up from a scanned / typed ID and selects it. */
  protected async find(e: Event): Promise<void> {
    e.preventDefault();
    const b = await this.data.findBundle(this.scan());
    if (typeof b === 'string') return void this.error.set(b);
    if (b.pieces === 0) return void this.error.set('This bundle is sold out.');
    this.error.set('');
    this.bundleId.set(b.id);
  }

  /** Records the sale on the server (which deducts stock) and shows the bill. */
  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    const result = await this.data.recordSale(this.bundleId(), Number(this.qty()), this.customer().trim());
    if (typeof result === 'string') {
      this.error.set(result);
      return;
    }
    this.error.set('');
    this.bill.set(result);
    if (!this.current() || this.current()!.pieces === 0) this.bundleId.set(this.available()[0]?.id ?? '');
  }

  /** Prints the bill. */
  protected print(): void {
    window.print();
  }
}
