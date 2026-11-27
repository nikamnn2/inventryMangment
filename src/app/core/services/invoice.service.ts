/** Purpose: client for sales invoices: bundle lookup, create, list, approve / reject, and saved customers. */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** One bundle on an invoice. */
export interface InvoiceLine { bundleId: string; dieNo: string; product: string; size: string; pcs: number; weight: number; }

export interface InvoiceCustomer { name: string; contact: string; email: string; }

/** A saved customer, suggested while typing the name. */
export interface SavedCustomer extends InvoiceCustomer { city: string; }

export interface Invoice {
  saleNo: string;
  status: 'pending' | 'issuing' | 'issued' | 'rejected';
  company: string;
  customer: InvoiceCustomer;
  items: InvoiceLine[];
  totals: { bundles: number; pcs: number; weight: number };
  createdByName?: string;
  createdAt: string;
  issuedAt?: string;
}

const message = (e: unknown): string => {
  const err = e as HttpErrorResponse;
  if (err?.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  return err?.error?.error ?? 'Something went wrong. Please try again.';
};

/** Calls resolve to the result, or to an error message (a string). */
@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private readonly http = inject(HttpClient);

  private async call<T>(request: () => Promise<T>): Promise<T | string> {
    try {
      return await request();
    } catch (e) {
      return message(e);
    }
  }

  lookup(code: string): Promise<InvoiceLine | string> {
    return this.call(() => firstValueFrom(this.http.get<InvoiceLine>(`/api/sales/lookup/${encodeURIComponent(code)}`)));
  }

  list(): Promise<Invoice[] | string> {
    return this.call(() => firstValueFrom(this.http.get<Invoice[]>('/api/sales/invoices')));
  }

  customers(): Promise<SavedCustomer[] | string> {
    return this.call(() => firstValueFrom(this.http.get<SavedCustomer[]>('/api/sales/customers')));
  }

  create(bundleIds: string[], customer: InvoiceCustomer): Promise<Invoice | string> {
    return this.call(() => firstValueFrom(this.http.post<Invoice>('/api/sales/invoices', { bundleIds, customer })));
  }

  decide(saleNo: string, decision: 'approve' | 'reject'): Promise<Invoice | string> {
    return this.call(() => firstValueFrom(this.http.post<Invoice>(`/api/sales/invoices/${encodeURIComponent(saleNo)}/${decision}`, {})));
  }
}
