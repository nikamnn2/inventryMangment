import { TestBed } from '@angular/core/testing';
import { BarcodeComponent } from './barcode.component';

describe('BarcodeComponent', () => {
  const render = (value: string) => {
    const f = TestBed.createComponent(BarcodeComponent);
    f.componentRef.setInput('value', value);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  };

  it('draws bars for a bundle id', () => {
    const el = render('9f3a1c27b04e8d51');
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('Barcode 9f3a1c27b04e8d51');
    expect(el.querySelectorAll('rect').length).toBeGreaterThan(10);
  });

  it('shows a message when the value cannot be encoded', () => {
    expect(render('é').textContent).toContain('Cannot encode');
  });
});
