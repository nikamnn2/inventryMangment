import { TestBed } from '@angular/core/testing';
import { DataService } from '../../core/services/data.service';
import { PRODUCTS, baseProviders, fillData } from '../../testing/fixtures';
import { ProductsComponent } from './products.component';

afterEach(() => {
    vi.useRealTimers();
});

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
        expect(c.filtered().map((p: {
            code: string;
        }) => p.code)).toEqual(['GL-1']);
        c.cat.set('All');
        c.q.set('silver');
        expect(c.filtered().map((p: {
            code: string;
        }) => p.code)).toEqual(['AL-1']);
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
        expect(c.dialog()).toBe(false);
    });

    it('requires a Die No and a name', async () => {
        const add = vi.spyOn(data, 'addProduct');
        c.open();
        c.form.code = '  ';
        await submit();
        expect(add).not.toHaveBeenCalled();
        expect(c.error()).toContain('required');
    });

    it('shows the server error when saving fails', async () => {
        vi.spyOn(data, 'addProduct').mockResolvedValue('Die No AL-9 already exists.');
        c.open();
        c.form.code = 'AL-9';
        c.form.name = 'Dup';
        await submit();
        expect(c.error()).toBe('Die No AL-9 already exists.');
        expect(c.dialog()).toBe(true);
    });

    it('adds a product, confirms, and clears the confirmation after a moment', async () => {
        vi.useFakeTimers();
        const add = vi.spyOn(data, 'addProduct').mockResolvedValue(null);
        c.open();
        c.form.code = ' AL-9 ';
        c.form.name = ' New ';
        submit();
        await vi.advanceTimersByTimeAsync(0);
        expect(add).toHaveBeenCalledWith(expect.objectContaining({ code: 'AL-9', name: 'New' }));
        expect(c.saved()).toBe('Product saved.');
        expect(c.dialog()).toBe(false);
        await vi.advanceTimersByTimeAsync(2500);
        expect(c.saved()).toBe('');
    });

    it('updates an existing product', async () => {
        vi.useFakeTimers();
        const update = vi.spyOn(data, 'updateProduct').mockResolvedValue(null);
        c.open(PRODUCTS[0]);
        submit();
        await vi.advanceTimersByTimeAsync(0);
        expect(update).toHaveBeenCalledWith('AL-1', expect.objectContaining({ code: 'AL-1' }));
        expect(c.saved()).toBe('Product updated.');
        await vi.advanceTimersByTimeAsync(2500);
    });
});
