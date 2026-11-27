import { TestBed } from '@angular/core/testing';
import { Bundle } from '../../core/services/data.service';
import { RackSelectComponent } from './rack-select.component';
import { matchRack, rackOptions } from './racks';

const bundle = (rack: string) => ({ id: rack, code: 'x', pieces: 1, weight: 1, packed: '2026-01-01', status: 'Packed', rack }) as Bundle;

describe('rack choices', () => {
  it('lists Black, Silver, Gold, then other used racks oldest first, without repeats or empties', () => {
    // newest first, as the app holds them
    const list = ['Copper', 'BLACK', '—', 'rose gold', '', 'Rose  Gold ', '-', 'silver'].map(bundle);
    expect(rackOptions(list)).toEqual(['Black', 'Silver', 'Gold', 'Rose Gold', 'Copper']);
    expect(rackOptions([])).toEqual(['Black', 'Silver', 'Gold']);
  });

  it('matches a choice ignoring capitals', () => {
    expect(matchRack('  bLaCk ', ['Black'])).toBe('Black');
    expect(matchRack(' Copper ', ['Black'])).toBe('Copper');
  });

  it('keeps Other last and opens a box to type a new value', () => {
    const fixture = TestBed.createComponent(RackSelectComponent);
    fixture.componentRef.setInput('options', ['Black', 'Silver', 'Gold', 'Copper']);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const select = () => el.querySelector('select')!;
    const choose = (v: string) => {
      select().value = v;
      select().dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    expect([...select().options].map(o => o.text)).toEqual(['No rack', 'Black', 'Silver', 'Gold', 'Copper', 'Other…']);
    expect(el.querySelector('input')).toBeNull();

    choose('__other__');
    const box = el.querySelector('input')!;
    box.value = 'Champagne';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([fixture.componentInstance.value(), fixture.componentInstance.other()]).toEqual(['Champagne', true]);
    expect(el.querySelector('input')).not.toBeNull();

    choose('Gold');
    expect([fixture.componentInstance.value(), fixture.componentInstance.other()]).toEqual(['Gold', false]);
    expect(el.querySelector('input')).toBeNull();
  });

  it('shows a saved value in capitals as its list entry', () => {
    const fixture = TestBed.createComponent(RackSelectComponent);
    fixture.componentRef.setInput('options', ['Black', 'Silver', 'Gold']);
    fixture.componentRef.setInput('value', 'BLACK');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select').value).toBe('Black');
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });
});
