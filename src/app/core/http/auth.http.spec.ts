import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import { AUTH_DISABLED } from '../config/auth.config';
import { AuthService } from '../services/auth.service';
import { authGuard, authInterceptor, moduleGuard } from './auth.http';

describe('authInterceptor', () => {
    let http: HttpClient;
    let ctrl: HttpTestingController;
    let auth: AuthService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), { provide: AUTH_DISABLED, useValue: false }],
        });
        http = TestBed.inject(HttpClient);
        ctrl = TestBed.inject(HttpTestingController);
        auth = TestBed.inject(AuthService);
    });

    it('adds the bearer token to API calls', () => {
        auth.token.set('tok');
        http.get('/api/products').subscribe();
        expect(ctrl.expectOne('/api/products').request.headers.get('Authorization')).toBe('Bearer tok');
    });

    it('leaves other URLs and token-less calls alone', () => {
        auth.token.set('tok');
        http.get('/assets/x.json').subscribe();
        expect(ctrl.expectOne('/assets/x.json').request.headers.has('Authorization')).toBe(false);
        auth.token.set(null);
        http.get('/api/products').subscribe();
        expect(ctrl.expectOne('/api/products').request.headers.has('Authorization')).toBe(false);
    });

    it('signs out when the API answers 401', () => {
        const logout = vi.spyOn(auth, 'logout');
        http.get('/api/products').subscribe({ error: () => undefined });
        ctrl.expectOne('/api/products').flush({}, { status: 401, statusText: 'Unauthorized' });
        expect(logout).toHaveBeenCalled();
    });

    it('does not sign out on a failed login attempt or other errors', () => {
        const logout = vi.spyOn(auth, 'logout');
        http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
        ctrl.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
        http.get('/api/products').subscribe({ error: () => undefined });
        ctrl.expectOne('/api/products').flush({}, { status: 500, statusText: 'Error' });
        expect(logout).not.toHaveBeenCalled();
    });
});

describe('authGuard', () => {
    const run = () => TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));

    function setup(platform: string) {
        TestBed.configureTestingModule({
            providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: PLATFORM_ID, useValue: platform }, { provide: AUTH_DISABLED, useValue: false }],
        });
        return TestBed.inject(AuthService);
    }

    it('lets a signed-in user through', () => {
        setup('browser').token.set('tok');
        expect(run()).toBe(true);
    });

    it('redirects a signed-out user to /login', () => {
        setup('browser').token.set(null);
        const result = run() as UrlTree;
        expect(result instanceof UrlTree).toBe(true);
        expect(result.toString()).toBe('/login');
    });

    it('allows server-side rendering through', () => {
        setup('server');
        expect(run()).toBe(true);
    });
});

describe('moduleGuard', () => {
    const run = (module: string) => TestBed.runInInjectionContext(() => moduleGuard(module)({} as never, {} as never));

    function setup(platform = 'browser') {
        TestBed.configureTestingModule({
            providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: PLATFORM_ID, useValue: platform }, { provide: AUTH_DISABLED, useValue: false }],
        });
        return TestBed.inject(AuthService);
    }

    it('opens a tab the role has', () => {
        setup().user.set({ email: 'a@b.c', name: 'A', role: 'accountant', modules: ['reports'] });
        expect(run('reports')).toBe(true);
    });

    it('sends a role without a dashboard to its own first page', () => {
        setup().user.set({ email: 'a@b.c', name: 'A', role: 'sales', modules: ['sales'] });
        expect(String(run('dashboard'))).toBe('/sales');
    });

    it('sends the user to the dashboard for a tab the role lacks', () => {
        setup().user.set({ email: 'a@b.c', name: 'A', role: 'accountant', modules: ['dashboard', 'reports'] });
        const result = run('settings') as UrlTree;
        expect(result instanceof UrlTree).toBe(true);
        expect(result.toString()).toBe('/dashboard');
    });

    it('skips the check while prerendering', () => {
        setup('server');
        expect(run('settings')).toBe(true);
    });
});
