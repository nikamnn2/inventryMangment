import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Pager, PagerComponent, createPager } from './pager.component';

const numbers = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** A pager over `count` records, on a desktop or on a phone. */
function setup(count: number, phone = false) {
  spyOn(window, 'matchMedia').and.returnValue({ matches: phone, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList);
  const items = signal(numbers(count));
  const filter = signal('');
  const pager: Pager<number> = TestBed.runInInjectionContext(() => createPager(items, filter));
  const fixture = TestBed.createComponent(PagerComponent);
  fixture.componentRef.setInput('pager', pager);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const click = (text: string) => {
    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === text)!.click();
    fixture.detectChanges();
  };
  return { pager, items, filter, fixture, el, click };
}

describe('Pager', () => {
  it('shows 8 records per page on a desktop', () => {
    const { pager, el, click } = setup(23);
    expect(pager.rows()).toEqual(numbers(8));
    expect(el.textContent).toContain('1–8 of 23');
    click('Next');
    click('Next');
    expect(pager.rows()).toEqual([17, 18, 19, 20, 21, 22, 23]);
    expect(el.textContent).toContain('Page 3 of 3');
    expect(el.querySelectorAll('button')[1].disabled).toBeTrue();
    click('Previous');
    expect(pager.rows()[0]).toBe(9);
  });

  it('adds 8 at a time to the list on a phone', () => {
    const { pager, el, click } = setup(23, true);
    expect(pager.rows().length).toBe(8);
    click('Show more');
    expect(pager.rows()).toEqual(numbers(16));
    click('Show more');
    expect(pager.rows().length).toBe(23);
    expect(el.textContent).toContain('Showing 23 of 23');
    expect(el.querySelector('button')).toBeNull();
  });

  it('has no controls when everything fits on one page', () => {
    const { el, pager } = setup(8);
    expect(el.querySelector('nav')).toBeNull();
    expect(pager.rows().length).toBe(8);
  });

  it('returns to page 1 on a new filter, stays put on new data, and never goes past the end', () => {
    const { pager, items, filter } = setup(20);
    pager.go(3);
    items.set(numbers(19));
    expect(pager.page()).toBe(3);
    items.set(numbers(16));
    expect(pager.page()).toBe(2);
    expect(pager.rows()[0]).toBe(9);
    filter.set('abc');
    expect(pager.page()).toBe(1);
    items.set([]);
    expect([pager.from(), pager.to(), pager.rows().length]).toEqual([0, 0, 0]);
    pager.go(99);
    expect(pager.page()).toBe(1);
  });
});
