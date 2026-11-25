/** Purpose: shared sample data and providers for the component unit tests. */
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Bundle, DataService, Product, Sale, Settings } from '../core/services/data.service';

export const PRODUCTS: Product[] = [
  { code: 'AL-1', name: 'Window Frame', category: 'Aluminium', size: '6 m', finish: 'Silver', clValue: '15/FT' },
  { code: 'GL-1', name: 'Clear Glass', category: 'Glass', size: '2440 mm', finish: 'Clear' },
];

export const BUNDLES: Bundle[] = [
  { id: 'b1', code: 'AL-1', pieces: 40, weight: 200, packed: '2026-01-01', status: 'Packed', rack: 'A-01' },
  { id: 'b2', code: 'GL-1', pieces: 8, weight: 40, packed: '2026-01-02', status: 'Shipped', rack: 'G-01' },
  { id: 'b3', code: 'AL-1', pieces: 0, weight: 0, packed: '2026-01-03', status: 'Sold', rack: 'A-02' },
];

export const SALE: Sale = {
  id: 'INV-1', date: '01 Jan 2026 · 10:00', ts: 0, bundleId: 'b1', product: 'Window Frame', pcs: 2, weight: 10, customer: 'Walk-in customer', amount: 3100,
};

export const SETTINGS: Settings = {
  company: 'Acme', gstin: '', phone: '', lowStockLimit: 20, weightUnit: 'kg', rates: { Aluminium: 310, Glass: 95 },
};

/** Common providers for component specs; the real DataService is used with its signals pre-filled. */
export const baseProviders = (): (Provider | EnvironmentProviders)[] => [provideRouter([]), provideHttpClient(), provideHttpClientTesting()];

export function fillData(data: DataService): void {
  data.products.set(structuredClone(PRODUCTS));
  data.bundles.set(structuredClone(BUNDLES));
  data.sales.set([structuredClone(SALE)]);
  data.customers.set([{ name: 'Shree Glazing Works', city: 'Pune', contact: '1', detail: 'd', status: 'Active' }, { name: 'Skyline', city: 'M', contact: '2', detail: 'd', status: 'Due' }]);
  data.suppliers.set([{ name: 'Hindal Extrusions', city: 'Pune', contact: '3', detail: 'd', status: 'Delayed' }]);
  data.settings.set(structuredClone(SETTINGS));
}
