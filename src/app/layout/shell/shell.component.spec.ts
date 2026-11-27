import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AUTH_DISABLED } from '../../core/config/auth.config';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { ShellComponent } from './shell.component';

@Component({ template: 'page' })
class DummyComponent {
}

describe('ShellComponent', () => {
    let data: DataService;
    let auth: AuthService;

    function create() {
        TestBed.configureTestingModule({
            imports: [ShellComponent],
            providers: [
                provideRouter([{ path: 'stock', component: DummyComponent }, { path: '**', component: DummyComponent }]),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: AUTH_DISABLED, useValue: true }, // signs in the all-tabs demo user
            ],
        });
        data = TestBed.inject(DataService);
        auth = TestBed.inject(AuthService);
        vi.spyOn(data, 'load').mockResolvedValue();
        const fixture = TestBed.createComponent(ShellComponent);
        fixture.detectChanges();
        return { fixture, c: fixture.componentInstance as any };
    }

    it('loads the data and shows the navigation', () => {
        const { fixture } = create();
        expect(data.load).toHaveBeenCalled();
        const text = fixture.nativeElement.textContent;
        for (const label of ['Dashboard', 'Products', 'Bundles', 'Sales', 'Stock Overview', 'Customers', 'Suppliers', 'Reports', 'Settings']) {
            expect(text).toContain(label);
        }
    });

    it('shows an accountant only their tabs and their role name', () => {
        TestBed.configureTestingModule({
            imports: [ShellComponent],
            providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AUTH_DISABLED, useValue: false }],
        });
        TestBed.inject(AuthService).user.set({ email: 'a@b.c', name: 'Asha Rao', role: 'accountant', modules: ['dashboard', 'sales', 'reports'] });
        vi.spyOn(TestBed.inject(DataService), 'load').mockResolvedValue();
        const fixture = TestBed.createComponent(ShellComponent);
        fixture.detectChanges();
        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Sales');
        expect(text).toContain('Reports');
        expect(text).toContain('Accountant');
        for (const hidden of ['Products', 'Bundles', 'Customers', 'Settings'])
            expect(text).not.toContain(hidden);
        expect(text).not.toContain('System'); // a group with no tabs is dropped
    });

    it('builds initials from the signed-in user', () => {
        const { c } = create();
        auth.user.set({ email: 'a@b.c', name: 'Nikhil Nikam', role: 'admin', modules: [] });
        expect(c.initials()).toBe('NN');
        auth.user.set(null);
        expect(c.initials()).toBe('?');
    });

    it('follows navigation: updates the page title and closes the drawer', async () => {
        const { c } = create();
        expect(c.page()).toBe('Dashboard');
        c.drawerOpen.set(true);
        await TestBed.inject(Router).navigateByUrl('/stock?x=1');
        expect(c.page()).toBe('Stock Overview');
        expect(c.drawerOpen()).toBe(false);
        await TestBed.inject(Router).navigateByUrl('/unknown');
        expect(c.page()).toBe('Dashboard');
    });

    it('reloads data and signs out on request', () => {
        const { c } = create();
        c.reload();
        expect(data.load).toHaveBeenCalledTimes(2);
        const logout = vi.spyOn(auth, 'logout');
        c.signOut();
        expect(logout).toHaveBeenCalled();
    });
});
