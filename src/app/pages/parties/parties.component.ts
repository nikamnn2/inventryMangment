import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Purpose: one page used for both Customers and Suppliers (the route data decides which). */
@Component({
  selector: 'app-parties',
  imports: [IconComponent],
  templateUrl: './parties.component.html',
  styleUrl: './parties.component.scss',
})
export class PartiesComponent {
  private readonly data = inject(DataService);
  private readonly kind = inject(ActivatedRoute).snapshot.data['kind'] as 'customers' | 'suppliers';

  protected readonly isCustomers = this.kind === 'customers';
  protected readonly title = computed(() => (this.isCustomers ? 'Customers' : 'Suppliers'));
  protected readonly singular = computed(() => (this.isCustomers ? 'customer' : 'supplier'));
  protected readonly subtitle = computed(() => (this.isCustomers ? 'Fabricators, builders and contractors you sell to.' : 'Extruders, glass makers and finishing partners.'));
  protected readonly list = computed(() => (this.isCustomers ? this.data.customers() : this.data.suppliers()));

  /** Avatar letters from a name. */
  protected initials(name: string): string {
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  /** Badge colour for a party status (Active / Due / other). */
  protected badgeClass(status: string): string {
    return status === 'Active' ? 'ok' : status === 'Due' ? 'warn' : 'danger';
  }
}
