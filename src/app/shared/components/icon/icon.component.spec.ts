import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';

describe('IconComponent', () => {
  const render = (name: string, size?: number) => {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', name);
    if (size) fixture.componentRef.setInput('size', size);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('draws every path of a known icon at the requested size', () => {
    const el = render('dashboard', 24);
    expect(el.querySelectorAll('path').length).toBe(4);
    expect(el.querySelector('svg')!.getAttribute('width')).toBe('24');
  });

  it('draws nothing for an unknown icon', () => {
    expect(render('does-not-exist').querySelectorAll('path').length).toBe(0);
  });
});
