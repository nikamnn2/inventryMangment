import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Category, DataService, Product } from '../../core/services/data.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PagerComponent, createPager } from '../../shared/components/pager/pager.component';

/** Empty product form. */
const blank = (): Product => ({ code: '', name: '', category: 'Aluminium' as Category, size: '', finish: '', clValue: '' });

/** Purpose: Products page: the catalogue of profiles and glass types (Die No, name, size, finish), with search, category filter, add and edit. */
@Component({
  selector: 'app-products',
  imports: [FormsModule, IconComponent, PagerComponent],
  templateUrl: './products.component.html',
  styleUrl: './products.component.scss',
})
export class ProductsComponent {
  protected readonly data = inject(DataService);
  protected readonly cats = ['All', 'Aluminium', 'Glass'];
  protected readonly cat = signal('All');
  protected readonly q = signal('');
  protected readonly dialog = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly saved = signal('');
  protected form: Product = blank();

  /** Products matching the category tabs and the search box. */
  protected readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.data.products().filter(p =>
      (this.cat() === 'All' || p.category === this.cat()) &&
      (!q || `${p.code} ${p.name} ${p.finish} ${p.size}`.toLowerCase().includes(q)));
  });

  protected readonly pager = createPager(() => this.filtered(), () => `${this.cat()}|${this.q()}`);

  /** Opens the add / edit dialog. */
  protected open(p?: Product): void {
    this.form = p ? { ...p } : blank();
    this.editing.set(p?.code ?? null);
    this.error.set('');
    this.dialog.set(true);
  }

  protected close(): void {
    this.dialog.set(false);
  }

  /** Validates and saves the product, then shows a short confirmation. */
  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const product = { ...this.form, code: this.form.code.trim(), name: this.form.name.trim() };
    if (!product.code || !product.name) {
      this.error.set('Die No and Product name are required.');
      return;
    }
    const old = this.editing();
    const err = await (old ? this.data.updateProduct(old, product) : this.data.addProduct(product));
    if (err) {
      this.error.set(err);
      return;
    }
    this.close();
    this.saved.set(old ? 'Product updated.' : 'Product saved.');
    setTimeout(() => this.saved.set(''), 2500);
  }
}
