import { TestBed } from '@angular/core/testing';
import { CameraScannerComponent } from './camera-scanner.component';

describe('CameraScannerComponent', () => {
  it('emits a steady code once, again only after it has been away', () => {
    const fixture = TestBed.createComponent(CameraScannerComponent);
    const c = fixture.componentInstance as any;
    const seen: string[] = [];
    fixture.componentInstance.scanned.subscribe(v => seen.push(v));
    c.consider('1001', 0);
    expect(seen).toEqual([]); // one frame is not enough
    c.consider('1001', 300);
    for (let t = 600; t < 9000; t += 300) c.consider('1001', t); // held in front of the camera
    expect(seen).toEqual(['1001']);
    c.consider('1002', 9000);
    c.consider('1002', 9300);
    c.consider('1001', 20000);
    c.consider('1001', 20300);
    expect(seen).toEqual(['1001', '1002', '1001']);
  });
});
