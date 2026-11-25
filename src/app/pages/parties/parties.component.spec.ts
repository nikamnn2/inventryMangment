import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { baseProviders, fillData } from '../../testing/fixtures';
import { PartiesComponent } from './parties.component';

function create(kind: 'customers' | 'suppliers') {
  TestBed.configureTestingModule({
    imports: [PartiesComponent],
    providers: [...baseProviders(), { provide: ActivatedRoute, useValue: { snapshot: { data: { kind } } } }],
  });
  fillData(TestBed.inject(DataService));
  const fixture = TestBed.createComponent(PartiesComponent);
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance as any };
}

describe('PartiesComponent', () => {
  it('shows customers', () => {
    const { fixture, c } = create('customers');
    expect(c.title()).toBe('Customers');
    expect(c.singular()).toBe('customer');
    expect(c.list().length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Shree Glazing Works');
  });

  it('shows suppliers', () => {
    const { fixture, c } = create('suppliers');
    expect(c.title()).toBe('Suppliers');
    expect(c.subtitle()).toContain('Extruders');
    expect(fixture.nativeElement.textContent).toContain('Hindal Extrusions');
  });

  it('builds initials and badge classes', () => {
    const { c } = create('customers');
    expect(c.initials('shree glazing works')).toBe('SG');
    expect(c.badgeClass('Active')).toBe('ok');
    expect(c.badgeClass('Due')).toBe('warn');
    expect(c.badgeClass('Delayed')).toBe('danger');
  });
});
