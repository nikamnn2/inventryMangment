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
    const nav = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const done = submit('admin@invenza.com', 'aluminium');
    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({ email: 'admin@invenza.com', password: 'aluminium' });
    req.flush({ token: 'jwt-token', user: { email: 'admin@invenza.com', name: 'Admin', role: 'admin' } });
    await done;
    await fixture.whenStable();
    expect(localStorage.getItem('invenza.token')).toBe('jwt-token');
    expect(nav).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the server message on bad credentials and does not navigate', async () => {
    const nav = spyOn(router, 'navigateByUrl').and.resolveTo(true);
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
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
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
