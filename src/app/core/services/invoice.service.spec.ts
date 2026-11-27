import type { Mock } from "vitest";
import { TestBed } from '@angular/core/testing';
import { baseProviders } from '../../testing/fixtures';
import { InvoiceService } from './invoice.service';

describe('InvoiceService sharing', () => {
    const file = new File(['%PDF-1'], 'SALE-1.pdf', { type: 'application/pdf' });
    const nav = navigator as unknown as Record<string, unknown>;
    const win = globalThis as unknown as Record<string, unknown>;
    let service: InvoiceService;
    let saved: Mock;
    const give = (key: string, value: unknown) => Object.defineProperty(navigator, key, { value, configurable: true });

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: baseProviders() });
        service = TestBed.inject(InvoiceService);
        saved = vi.spyOn(service, 'saveFile');
    });
    afterEach(() => {
        delete nav['canShare'];
        delete nav['share'];
        delete win['InvenzaApp'];
    });

    it("uses the Android app's own share sheet when the app offers it", async () => {
        const share = vi.fn();
        win['InvenzaApp'] = { share };
        expect(await service.shareFile(file)).toBe('shared');
        expect(share).toHaveBeenCalledWith('SALE-1.pdf', 'application/pdf', btoa('%PDF-1'));
        expect(saved).not.toHaveBeenCalled();
    });

    it("uses the phone browser's share sheet", async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        give('canShare', () => true);
        give('share', share);
        expect(await service.shareFile(file)).toBe('shared');
        expect(share).toHaveBeenCalledWith({ files: [file], title: 'SALE-1.pdf' });
        share.mockRejectedValue(new DOMException('closed', 'AbortError'));
        expect(await service.shareFile(file)).toBe('cancelled');
        expect(saved).not.toHaveBeenCalled();
    });

    it('saves the file where sharing is not possible, including an older app', async () => {
        win['InvenzaApp'] = {};
        give('canShare', undefined);
        expect(await service.shareFile(file)).toBe('saved');
        give('canShare', () => true);
        give('share', () => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
        expect(await service.shareFile(file)).toBe('saved');
        expect(saved).toHaveBeenCalledTimes(2);
    });
});
