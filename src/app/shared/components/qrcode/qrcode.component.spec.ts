import { TestBed } from '@angular/core/testing';
import { QrcodeComponent } from './qrcode.component';

describe('QrcodeComponent', () => {
  it('draws a QR code for a bundle id', () => {
    const f = TestBed.createComponent(QrcodeComponent);
    f.componentRef.setInput('value', '9f3a1c27b04e8d51');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('QR code 9f3a1c27b04e8d51');
    expect(el.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(100);
  });
});
