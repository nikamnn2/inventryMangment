import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AUTH_DISABLED } from '../../core/config/auth.config';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
    let fixture: ComponentFixture<LoginComponent>;
    let router: Router;
    let http: HttpTestingController;

    const submit = async (email: string, password: string) => {
        const el: HTMLElement = fixture.nativeElement;
        (el.querySelector('#user') as HTMLInputElement).value = email;
        (el.querySelector('#pw') as HTMLInputElement).value = password;
        el.querySelector('form')!.dispatchEvent(new Event('submit'));
        await fixture.whenStable();
    };

    beforeEach(async () => {
        localStorage.clear();
        sessionStorage.clear();
        await TestBed.configureTestingModule({
            imports: [LoginComponent],
            providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AUTH_DISABLED, useValue: false }],
        }).compileComponents();
        fixture = TestBed.createComponent(LoginComponent);
        router = TestBed.inject(Router);
        http = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
    });

    it('renders the welcome heading', () => {
        expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Welcome back');
    });

    it('toggles password visibility', () => {
        const el: HTMLElement = fixture.nativeElement;
        const pw = el.querySelector('#pw') as HTMLInputElement;
        expect(pw.type).toBe('password');
        (el.querySelector('.peek') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(pw.type).toBe('text');
    });

    it('asks for both fields before calling the API', async () => {
        await submit('', '');
        fixture.detectChanges();
        http.expectNone('/api/auth/login');
        expect(fixture.nativeElement.querySelector('.error').textContent).toContain('Enter your email and password');
    });

    it('stores the token and opens the dashboard on success', async () => {
        const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        const done = submit('admin@invenza.com', 'aluminium');
        const req = http.expectOne('/api/auth/login');
        // "Keep me signed in" starts ticked
        expect(req.request.body).toEqual({ email: 'admin@invenza.com', password: 'aluminium', remember: true });
        req.flush({ token: 'jwt-token', user: { email: 'admin@invenza.com', name: 'Admin', role: 'admin' } });
        await done;
        await fixture.whenStable();
        expect(localStorage.getItem('invenza.token')).toBe('jwt-token');
        expect(nav).toHaveBeenCalledWith('/dashboard');
    });

    it('stays signed in only for this browser session when the box is not ticked', async () => {
        vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        (fixture.nativeElement.querySelector('input[name=remember]') as HTMLInputElement).checked = false;
        const done = submit('admin@invenza.com', 'aluminium');
        const req = http.expectOne('/api/auth/login');
        expect(req.request.body).toEqual({ email: 'admin@invenza.com', password: 'aluminium' });
        req.flush({ token: 'jwt-token', user: { email: 'admin@invenza.com', name: 'Admin', role: 'admin', modules: [] } });
        await done;
        expect(sessionStorage.getItem('invenza.token')).toBe('jwt-token');
        expect(localStorage.getItem('invenza.token')).toBeNull();
    });

    describe('forgot password', () => {
        const pending = { email: 'a@b.com', token: 'secret', code: '482913' };
        const text = () => { fixture.detectChanges(); return fixture.nativeElement.textContent as string; };
        const settle = async () => { await new Promise(r => setTimeout(r)); await fixture.whenStable(); };

        it('sends a request to the admin and shows the code', async () => {
            (fixture.nativeElement.querySelector('#user') as HTMLInputElement).value = 'a@b.com';
            (fixture.nativeElement.querySelector('.forgot') as HTMLAnchorElement).click();
            fixture.detectChanges();
            expect((fixture.nativeElement.querySelector('#reset-email') as HTMLInputElement).value).toBe('a@b.com');
            fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
            http.expectOne('/api/auth/forgot').flush({ token: 'secret', code: '482913' });
            await settle();
            expect(text()).toContain('Request sent');
            expect(text()).toContain('482913');
        });

        it('goes to the new-password page with only the email once approved', async () => {
            localStorage.setItem('invenza.reset', JSON.stringify(pending));
            const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
            const done = submit('A@b.com', '');
            http.expectOne('/api/auth/forgot/status').flush({ status: 'approved' });
            await done;
            await settle();
            expect(nav).toHaveBeenCalledWith('/reset-password');
            http.expectNone('/api/auth/login');
        });

        it('says when it is still waiting, and when it was turned down', async () => {
            localStorage.setItem('invenza.reset', JSON.stringify(pending));
            const first = submit('a@b.com', '');
            http.expectOne('/api/auth/forgot/status').flush({ status: 'waiting' });
            await first;
            await settle();
            expect(text()).toContain('waiting for admin approval');
            const second = submit('a@b.com', '');
            http.expectOne('/api/auth/forgot/status').flush({ status: 'none' });
            await second;
            await settle();
            expect(text()).toContain('rejected or has expired');
            expect(localStorage.getItem('invenza.reset')).toBeNull();
        });

        it('does not let an email without a request from this browser skip the password', async () => {
            localStorage.setItem('invenza.reset', JSON.stringify(pending));
            await submit('someone@else.com', '');
            http.expectNone('/api/auth/forgot/status');
            expect(text()).toContain('Enter your email and password');
        });
    });

    it('shows the server message on bad credentials and does not navigate', async () => {
        const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        const done = submit('admin@invenza.com', 'nope');
        http.expectOne('/api/auth/login').flush({ error: 'Invalid email or password.' }, { status: 401, statusText: 'Unauthorized' });
        await done;
        await fixture.whenStable();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.error').textContent).toContain('Invalid email or password.');
        expect(nav).not.toHaveBeenCalled();
        expect(localStorage.getItem('invenza.token')).toBeNull();
    });
});

describe('LoginComponent with login disabled (temporary bypass)', () => {
    it('opens the dashboard without credentials or any API call', async () => {
        await TestBed.configureTestingModule({
            imports: [LoginComponent],
            providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AUTH_DISABLED, useValue: true }],
        }).compileComponents();
        const fixture = TestBed.createComponent(LoginComponent);
        const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        (el.querySelector('#user') as HTMLInputElement).value = '';
        (el.querySelector('#pw') as HTMLInputElement).value = '';
        el.querySelector('form')!.dispatchEvent(new Event('submit'));
        await fixture.whenStable();
        TestBed.inject(HttpTestingController).expectNone('/api/auth/login');
        expect(nav).toHaveBeenCalledWith('/dashboard');
    });
});
