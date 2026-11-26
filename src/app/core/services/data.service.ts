/**
 * Purpose: the front end's single data store. Loads products, bundles, sales, customers, suppliers and settings from the API into signals
 * that every page reads, and wraps each API call (create / edit / scan lookup / sale / reports / CSV download).
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Bundle lifecycle: Packed -> Shipped (out for delivery) -> Sold. */
export type Status = 'Packed' | 'Shipped' | 'Sold';
export type Category = 'Aluminium' | 'Glass';

/** `code` is the product's Die No. */
export interface Product {
  code: string;
  name: string;
  category: Category;
  size: string;
  finish: string;
  clValue?: string;
}

/** A packed lot of pieces. `id` is the bundle ID encoded in its barcode / QR code; `code` is the product's Die No. */
export interface Bundle {
  id: string;
  code: string;
  pieces: number;
  weight: number;
  packed: string;
  status: Status;
  rack: string;
  /** Optional text printed in bold on the sticker. */
  stickerText?: string;
}

/** One bill: which bundle, how many pieces, weight and amount. */
export interface Sale {
  id: string;
  date: string;
  ts: number;
  bundleId: string;
  product: string;
  pcs: number;
  weight: number;
  customer: string;
  amount: number;
}

/** A customer or supplier. */
export interface Party { name: string; city: string; contact: string; detail: string; status: string; }

/** Company details, low-stock threshold and the price per kg for each category. */
export interface Settings {
  company: string;
  gstin: string;
  phone: string;
  lowStockLimit: number;
  weightUnit: string;
  rates: Record<Category, number>;
}

/** Figures the API computes for the dashboard (today, sold bundles, 7-day trend). */
export interface DashboardSummary {
  today: { packed: number; bills: number; revenue: number };
  soldBundles: number;
  trend: { date: string; label: string; weight: number }[];
}

/** Totals and rows for the Reports page. */
export interface ReportData {
  totals: { revenue: number; weightSold: number; bills: number; bundlesPacked: number };
  sales: Sale[];
  packing: (Bundle & { productName: string })[];
}

export type Range = 'Today' | 'Week' | 'Month' | 'All';

/** Fallback "low stock" threshold (pieces) until the settings load. */
export const LOW_STOCK_LIMIT = 20;

/* ---- API <-> UI shape adapters (the API speaks dieNo / bundleId / billNo) ---- */
interface ApiProduct { dieNo: string; name: string; category: Category; size: string; finish: string; clValue?: string; }
interface ApiBundle { bundleId: string; dieNo: string; pieces: number; weight: number; packed: string; status: Status; rack: string; stickerText?: string; }
interface ApiSale { billNo: string; bundleId: string; product: string; pcs: number; weight: number; customer: string; amount: number; createdAt: string; }

/** Converters between the API's field names (dieNo, bundleId, billNo) and the names used by the screens. */
const toProduct = (p: ApiProduct): Product => ({ code: p.dieNo, name: p.name, category: p.category, size: p.size, finish: p.finish, clValue: p.clValue });
const fromProduct = (p: Product): ApiProduct => ({ dieNo: p.code, name: p.name, category: p.category, size: p.size, finish: p.finish, clValue: p.clValue ?? '' });
const toBundle = (b: ApiBundle): Bundle => ({ id: b.bundleId, code: b.dieNo, pieces: b.pieces, weight: b.weight, packed: b.packed, status: b.status, rack: b.rack, ...(b.stickerText && { stickerText: b.stickerText }) });
const fromBundle = (b: Partial<Bundle>) => ({ dieNo: b.code, pieces: b.pieces, weight: b.weight, packed: b.packed, rack: b.rack, status: b.status, stickerText: b.stickerText });
const toSale = (s: ApiSale): Sale => {
  const ts = Date.parse(s.createdAt);
  const date = new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' ·');
  return { id: s.billNo, date, ts, bundleId: s.bundleId, product: s.product, pcs: s.pcs, weight: s.weight, customer: s.customer, amount: s.amount };
};

/** A tab the role cannot open answers 403: treat that data as empty instead of failing the whole load. */
const soft = <T>(p: Promise<T>, fallback: T): Promise<T> =>
  p.catch((e: unknown) => ((e as HttpErrorResponse)?.status === 403 ? fallback : Promise.reject(e)));

/** Turns an HTTP error into a short message for the user. */
const message = (e: unknown): string => {
  const err = e as HttpErrorResponse;
  if (err?.status === 0) return 'Cannot reach the server. Is the API running?';
  return err?.error?.error ?? 'Something went wrong. Please try again.';
};

/** Purpose: shared data service (one instance for the whole app). */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);

  readonly products = signal<Product[]>([]);
  readonly bundles = signal<Bundle[]>([]);
  readonly sales = signal<Sale[]>([]);
  readonly customers = signal<Party[]>([]);
  readonly suppliers = signal<Party[]>([]);
  readonly settings = signal<Settings | null>(null);
  readonly loaded = signal(false);
  readonly loadError = signal('');

  readonly lowLimit = computed(() => this.settings()?.lowStockLimit ?? LOW_STOCK_LIMIT);
  readonly bundleCount = computed(() => this.bundles().length);
  readonly totalPieces = computed(() => this.bundles().reduce((n, b) => n + b.pieces, 0));
  readonly totalWeight = computed(() => this.bundles().reduce((n, b) => n + b.weight, 0));
  /** Bundles with some stock left but below the low-stock threshold (drives the menu badge and dashboard). */
  readonly lowStock = computed(() => this.bundles().filter(b => b.pieces > 0 && b.pieces < this.lowLimit()));

  /** Current time; one place to override in tests. */
  now(): number {
    return Date.now();
  }

  /** Loads everything the app needs after sign-in. */
  async load(): Promise<void> {
    try {
      const [products, , , customers, suppliers, settings] = await Promise.all([
        soft(firstValueFrom(this.http.get<ApiProduct[]>('/api/products')), []),
        soft(this.refreshBundles(), undefined),
        soft(this.refreshSales(), undefined),
        soft(firstValueFrom(this.http.get<Party[]>('/api/customers')), []),
        soft(firstValueFrom(this.http.get<Party[]>('/api/suppliers')), []),
        soft(firstValueFrom(this.http.get<Settings>('/api/settings')), null),
      ]);
      this.products.set(products.map(toProduct));
      this.customers.set(customers);
      this.suppliers.set(suppliers);
      this.settings.set(settings);
      this.loadError.set('');
      this.loaded.set(true);
    } catch (e) {
      this.loadError.set(message(e));
    }
  }

  /** Purpose: reload the bundle list from the API. */
  async refreshBundles(): Promise<void> {
    this.bundles.set((await firstValueFrom(this.http.get<ApiBundle[]>('/api/bundles'))).map(toBundle));
  }

  /** Purpose: reload the sales list from the API. */
  async refreshSales(): Promise<void> {
    this.sales.set((await firstValueFrom(this.http.get<ApiSale[]>('/api/sales'))).map(toSale));
  }

  /** Purpose: find a product by its Die No. */
  product(code: string): Product | undefined {
    return this.products().find(p => p.code === code);
  }

  /** Purpose: product name for a Die No (falls back to the Die No itself). */
  productName(code: string): string {
    return this.product(code)?.name ?? code;
  }

  /** Purpose: Aluminium or Glass for a Die No. */
  categoryOf(code: string): Category {
    return this.product(code)?.category ?? 'Aluminium';
  }

  /** Each mutation resolves to an error message, or null/the saved record on success. */
  async addProduct(p: Product): Promise<string | null> {
    try {
      const saved = await firstValueFrom(this.http.post<ApiProduct>('/api/products', fromProduct(p)));
      this.products.update(list => [toProduct(saved), ...list]);
      return null;
    } catch (e) {
      return message(e);
    }
  }

  /** Purpose: edit a product (reloads bundles when the Die No changes, because bundles are linked by it). */
  async updateProduct(oldCode: string, p: Product): Promise<string | null> {
    try {
      const saved = toProduct(await firstValueFrom(this.http.put<ApiProduct>(`/api/products/${encodeURIComponent(oldCode)}`, fromProduct(p))));
      this.products.update(list => list.map(x => (x.code === oldCode ? saved : x)));
      if (saved.code !== oldCode) await this.refreshBundles();
      return null;
    } catch (e) {
      return message(e);
    }
  }

  /** Purpose: create a bundle; the server returns it with its new bundle ID. */
  async addBundle(b: Omit<Bundle, 'id'>): Promise<Bundle | string> {
    try {
      const saved = toBundle(await firstValueFrom(this.http.post<ApiBundle>('/api/bundles', fromBundle(b))));
      this.bundles.update(list => [saved, ...list]);
      return saved;
    } catch (e) {
      return message(e);
    }
  }

  /** Purpose: edit a bundle, e.g. change its status to Shipped when it goes out for delivery. */
  async updateBundle(id: string, b: Partial<Bundle>): Promise<string | null> {
    try {
      const saved = toBundle(await firstValueFrom(this.http.put<ApiBundle>(`/api/bundles/${id}`, fromBundle(b))));
      this.bundles.update(list => list.map(x => (x.id === id ? saved : x)));
      return null;
    } catch (e) {
      return message(e);
    }
  }

  /** Barcode / scanner lookup by full ID or a unique prefix. */
  async findBundle(scan: string): Promise<Bundle | string> {
    const q = scan.trim();
    if (!q) return 'Scan or type a bundle ID first.';
    try {
      return toBundle(await firstValueFrom(this.http.get<ApiBundle>(`/api/bundles/lookup/${encodeURIComponent(q)}`)));
    } catch (e) {
      return message(e);
    }
  }

  /** Deducts stock from a bundle and creates a bill. Resolves to an error message on failure. */
  async recordSale(bundleId: string, quantity: number, customer: string): Promise<Sale | string> {
    try {
      const sale = toSale(await firstValueFrom(this.http.post<ApiSale>('/api/sales', { bundleId, quantity, customer })));
      await Promise.all([this.refreshBundles(), this.refreshSales()]);
      return sale;
    } catch (e) {
      await this.refreshBundles().catch(() => undefined); // stock may have changed under us
      return message(e);
    }
  }

  /** Purpose: save company settings. */
  async saveSettings(s: Settings): Promise<string | null> {
    try {
      this.settings.set(await firstValueFrom(this.http.put<Settings>('/api/settings', s)));
      return null;
    } catch (e) {
      return message(e);
    }
  }

  /** Purpose: fetch the dashboard figures. */
  getDashboard(): Promise<DashboardSummary> {
    return firstValueFrom(this.http.get<DashboardSummary>('/api/dashboard'));
  }

  /** Purpose: fetch the report for Today / Week / Month / All. */
  async getReport(range: Range): Promise<ReportData> {
    const r = await firstValueFrom(this.http.get<{ totals: ReportData['totals']; sales: ApiSale[]; packing: (ApiBundle & { productName: string })[] }>(`/api/reports?range=${range}`));
    return {
      totals: r.totals,
      sales: r.sales.map(toSale),
      packing: r.packing.map(b => ({ ...toBundle(b), productName: b.productName })),
    };
  }

  /** Downloads a CSV produced by the API (sends the auth header, which a plain link cannot). */
  async download(path: string, filename: string): Promise<void> {
    const blob = await firstValueFrom(this.http.get(path, { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
