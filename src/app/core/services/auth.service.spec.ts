import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AUTH_DISABLED } from '../config/auth.config';
import { AuthService } from './auth.service';

const USER = { email: 'nikamnn2@gmail.com', name: 'Nikhil Nikam', role: 'admin', modules: ['dashboard', 'sales'] };

function setup(disabled: boolean) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AUTH_DISABLED, useValue: disabled }],
  });
  return { auth: TestBed.inject(AuthService), http: TestBed.inject(HttpTestingController) };
}

describe('AuthService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe('with authentication enabled', () => {
    it('starts signed out', () => {
      const { auth } = setup(false);
      expect(auth.loggedIn()).toBeFalse();
      expect(auth.user()).toBeNull();
    });

    it('restores the session from storage', () => {
      localStorage.setItem('invenza.token', 'tok');
      localStorage.setItem('invenza.user', JSON.stringify(USER));
      const { auth } = setup(false);
      expect(auth.loggedIn()).toBeTrue();
      expect(auth.user()).toEqual(USER);
    });

    it('asks for a fresh sign-in when the stored session has no roles', () => {
      localStorage.setItem('invenza.token', 'tok');
      localStorage.setItem('invenza.user', JSON.stringify({ email: 'a@b.c', name: 'A', role: 'admin' }));
      const { auth } = setup(false);
      expect(auth.loggedIn()).toBeFalse();
    });

    it('allows only the tabs the user has', () => {
      const { auth } = setup(false);
      expect(auth.can('sales')).toBeFalse();
      auth.user.set(USER);
      expect(auth.can('sales')).toBeTrue();
      expect(auth.can('settings')).toBeFalse();
    });

    it('ignores a corrupted stored user', () => {
      localStorage.setItem('invenza.user', '{not json');
      expect(setup(false).auth.user()).toBeNull();
    });

    it('stores the token on a successful login', async () => {
      const { auth, http } = setup(false);
      const p = auth.login('a@b.c', 'pw');
      const req = http.expectOne('/api/auth/login');
      expect(req.request.body).toEqual({ email: 'a@b.c', password: 'pw' });
      req.flush({ token: 'tok', user: USER });
      expect(await p).toBeNull();
      expect(auth.token()).toBe('tok');
      expect(localStorage.getItem('invenza.token')).toBe('tok');
    });

    it('returns the server message for bad credentials', async () => {
      const { auth, http } = setup(false);
      const p = auth.login('a@b.c', 'bad');
      http.expectOne('/api/auth/login').flush({ error: 'Invalid email or password.' }, { status: 401, statusText: 'Unauthorized' });
      expect(await p).toBe('Invalid email or password.');
      expect(auth.loggedIn()).toBeFalse();
    });

    it('explains when the server is unreachable', async () => {
      const { auth, http } = setup(false);
      const p = auth.login('a@b.c', 'pw');
      http.expectOne('/api/auth/login').error(new ProgressEvent('error'));
      expect(await p).toContain('Cannot reach the server');
    });

    it('uses a generic message when the error has no body', async () => {
      const { auth, http } = setup(false);
      const p = auth.login('a@b.c', 'pw');
      http.expectOne('/api/auth/login').flush(null, { status: 500, statusText: 'Server Error' });
      expect(await p).toBe('Sign in failed.');
    });

    it('still signs in when storage is unavailable', async () => {
      const { auth, http } = setup(false);
      spyOn(Storage.prototype, 'setItem').and.throwError('denied');
      const p = auth.login('a@b.c', 'pw');
      http.expectOne('/api/auth/login').flush({ token: 'tok', user: USER });
      expect(await p).toBeNull();
      expect(auth.loggedIn()).toBeTrue();
    });

    it('clears the session and goes to the login page on logout', () => {
      localStorage.setItem('invenza.token', 'tok');
      const { auth } = setup(false);
      const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
      auth.logout();
      expect(auth.loggedIn()).toBeFalse();
      expect(localStorage.getItem('invenza.token')).toBeNull();
      expect(nav).toHaveBeenCalledWith('/login');
    });
  });

  describe('account activation', () => {
    it('looks up who a link is for', async () => {
      const { auth, http } = setup(false);
      const p = auth.activationInfo('tok/en');
      http.expectOne('/api/auth/activate/tok%2Fen').flush({ name: 'A', email: 'a@b.c', role: 'manager' });
      expect(await p).toEqual({ name: 'A', email: 'a@b.c', role: 'manager' });
    });

    it('returns the message for a bad or expired link', async () => {
      const { auth, http } = setup(false);
      const p = auth.activationInfo('old');
      http.expectOne('/api/auth/activate/old').flush({ error: 'This activation link is invalid or has expired.' }, { status: 404, statusText: 'Not Found' });
      expect(await p).toBe('This activation link is invalid or has expired.');
    });

    it('falls back to a generic message when the server cannot be reached', async () => {
      const { auth, http } = setup(false);
      const p = auth.activationInfo('x');
      http.expectOne('/api/auth/activate/x').error(new ProgressEvent('error'));
      expect(await p).toContain('Could not check this link');
    });

    it('sets the password', async () => {
      const { auth, http } = setup(false);
      const p = auth.activate('tok', 'longenough1');
      const req = http.expectOne('/api/auth/activate');
      expect(req.request.body).toEqual({ token: 'tok', password: 'longenough1' });
      req.flush({ ok: true });
      expect(await p).toBeNull();
    });

    it('returns the error when activation fails', async () => {
      const { auth, http } = setup(false);
      const p = auth.activate('tok', 'short');
      http.expectOne('/api/auth/activate').flush({ error: 'Password must be at least 8 characters.' }, { status: 400, statusText: 'Bad Request' });
      expect(await p).toBe('Password must be at least 8 characters.');
      const q = auth.activate('tok', 'x');
      http.expectOne('/api/auth/activate').error(new ProgressEvent('error'));
      expect(await q).toContain('Could not activate');
    });
  });

  describe('with authentication disabled', () => {
    it('is always logged in as the demo user and never calls the API', async () => {
      const { auth, http } = setup(true);
      expect(auth.loggedIn()).toBeTrue();
      expect(auth.user()?.email).toBe('nikamnn2@gmail.com');
      expect(auth.can('settings')).toBeTrue();
      expect(await auth.login('x', 'y')).toBeNull();
      http.expectNone('/api/auth/login');
    });
  });
});
