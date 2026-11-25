import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { DataService } from '../../core/services/data.service';
import { PRODUCTS, baseProviders, fillData } from '../../testing/fixtures';
import { ProductsComponent } from './products.component';

describe('ProductsComponent', () => {
  let data: DataService;
  let c: any;
  let fixture: ReturnType<typeof TestBed.createComponent<ProductsComponent>>;
  const submit = () => c.save(new Event('submit'));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProductsComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    fixture = TestBed.createComponent(ProductsComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('filters by category and search text', () => {
    expect(c.filtered().length).toBe(2);
    c.cat.set('Glass');
    expect(c.filtered().map((p: { code: string }) => p.code)).toEqual(['GL-1']);
    c.cat.set('All');
    c.q.set('silver');
    expect(c.filtered().map((p: { code: string }) => p.code)).toEqual(['AL-1']);
  });

  it('opens blank for add and prefilled for edit, then closes', () => {
    c.open();
    expect(c.editing()).toBeNull();
    expect(c.form.code).toBe('');
    c.open(PRODUCTS[0]);
    expect(c.editing()).toBe('AL-1');
    expect(c.form.name).toBe('Window Frame');
    fixture.detectChanges();
    c.close();
    expect(c.dialog()).toBeFalse();
  });

  it('requires a Die No and a name', async () => {
    const add = spyOn(data, 'addProduct');
    c.open();
    c.form.code = '  ';
    await submit();
    expect(add).not.toHaveBeenCalled();
    expect(c.error()).toContain('required');
  });

  it('shows the server error when saving fails', async () => {
    spyOn(data, 'addProduct').and.resolveTo('Die No AL-9 already exists.');
    c.open();
    c.form.code = 'AL-9';
    c.form.name = 'Dup';
    await submit();
    expect(c.error()).toBe('Die No AL-9 already exists.');
    expect(c.dialog()).toBeTrue();
  });

  it('adds a product, confirms, and clears the confirmation after a moment', fakeAsync(() => {
    const add = spyOn(data, 'addProduct').and.resolveTo(null);
    c.open();
    c.form.code = ' AL-9 ';
    c.form.name = ' New ';
    submit();
    tick();
    expect(add).toHaveBeenCalledWith(jasmine.objectContaining({ code: 'AL-9', name: 'New' }));
    expect(c.saved()).toBe('Product saved.');
    expect(c.dialog()).toBeFalse();
    tick(2500);
    expect(c.saved()).toBe('');
  }));

  it('updates an existing product', fakeAsync(() => {
    const update = spyOn(data, 'updateProduct').and.resolveTo(null);
    c.open(PRODUCTS[0]);
    submit();
    tick();
    expect(update).toHaveBeenCalledWith('AL-1', jasmine.objectContaining({ code: 'AL-1' }));
    expect(c.saved()).toBe('Product updated.');
    tick(2500);
  }));
});
