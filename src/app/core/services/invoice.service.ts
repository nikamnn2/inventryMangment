/** Purpose: client for sales invoices: bundle lookup, create, list, approve / reject, and saved customers. */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** One bundle on an invoice. */
export interface InvoiceLine { bundleId: string; dieNo: string; product: string; size: string; rack?: string; length?: string; pcs: number; weight: number; }

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

const toBase64 = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

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

  /** Bundles that can be sold and match what is typed, for suggestions. */
  search(text: string): Promise<InvoiceLine[] | string> {
    return this.call(() => firstValueFrom(this.http.get<InvoiceLine[]>(`/api/sales/search?q=${encodeURIComponent(text)}`)));
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

  /** The PDF of an issued invoice, or an error message. */
  async pdf(saleNo: string): Promise<File | string> {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    try {
      const body = await firstValueFrom(this.http.get(`/api/sales/invoices/${encodeURIComponent(saleNo)}/pdf?tz=${encodeURIComponent(zone)}`, { responseType: 'blob' }));
      return new File([body], `${saleNo}.pdf`, { type: 'application/pdf' });
    } catch (e) {
      // the error body arrives as a file too: read the message out of it
      const body = (e as HttpErrorResponse)?.error;
      if (body instanceof Blob) {
        try { return JSON.parse(await body.text()).error ?? message(e); } catch { /* not a message */ }
      }
      return message(e);
    }
  }

  /** Saves a file to the computer or phone. */
  saveFile(file: File): void {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click(); // the Android app saves it to Downloads
    // some phone browsers start the download a moment later
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  /**
   * Opens the phone's share sheet (WhatsApp, email...). The Android app does it itself, because its web
   * view cannot; where sharing is not possible the file is saved instead.
   */
  async shareFile(file: File): Promise<'shared' | 'cancelled' | 'saved'> {
    const app = (globalThis as { InvenzaApp?: { share?: (name: string, type: string, base64: string) => void } }).InvenzaApp;
    if (app?.share) {
      app.share(file.name, file.type, await toBase64(file));
      return 'shared';
    }
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        return 'shared';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'cancelled'; // the user closed the share sheet
      }
    }
    this.saveFile(file);
    return 'saved';
  }

  decide(saleNo: string, decision: 'approve' | 'reject'): Promise<Invoice | string> {
    return this.call(() => firstValueFrom(this.http.post<Invoice>(`/api/sales/invoices/${encodeURIComponent(saleNo)}/${decision}`, {})));
  }
}
