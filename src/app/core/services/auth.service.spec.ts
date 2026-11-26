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
  const clear = () => { localStorage.clear(); sessionStorage.clear(); };
  beforeEach(clear);
  afterEach(clear);

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
      // not "keep me signed in": it ends with the browser
      expect(sessionStorage.getItem('invenza.token')).toBe('tok');
      expect(localStorage.getItem('invenza.token')).toBeNull();
    });

    it('keeps the sign-in after the browser closes when asked to', async () => {
      const { auth, http } = setup(false);
      const p = auth.login('a@b.c', 'pw', true);
      const req = http.expectOne('/api/auth/login');
      expect(req.request.body).toEqual({ email: 'a@b.c', password: 'pw', remember: true });
      req.flush({ token: 'tok', user: USER });
      await p;
      expect(localStorage.getItem('invenza.token')).toBe('tok');
      expect(sessionStorage.getItem('invenza.token')).toBeNull();
    });

    it('restores a sign-in that lasts only for the browser session, and signing out removes it', () => {
      sessionStorage.setItem('invenza.token', 'tok');
      sessionStorage.setItem('invenza.user', JSON.stringify(USER));
      const { auth } = setup(false);
      expect(auth.loggedIn()).toBeTrue();
      spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
      auth.logout();
      expect(sessionStorage.getItem('invenza.token')).toBeNull();
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

  describe('forgotten password', () => {
    const pending = { email: 'a@b.c', token: 'secret', code: '123456' };

    it('sends the request and remembers it in this browser', async () => {
      const { auth, http } = setup(false);
      const p = auth.forgotPassword(' A@B.c ');
      http.expectOne('/api/auth/forgot').flush({ token: 'secret', code: '123456' });
      expect(await p).toEqual(pending);
      expect(auth.pendingReset()).toEqual(pending);
    });

    it('checks the approval and changes the password, then forgets the request', async () => {
      const { auth, http } = setup(false);
      localStorage.setItem('invenza.reset', JSON.stringify(pending));
      const check = auth.resetStatus(pending);
      const asked = http.expectOne('/api/auth/forgot/status');
      expect(asked.request.body).toEqual({ email: 'a@b.c', token: 'secret' });
      asked.flush({ status: 'approved' });
      expect(await check).toEqual({ status: 'approved' });

      const save = auth.resetPassword(pending, 'longenough1');
      const req = http.expectOne('/api/auth/forgot/reset');
      expect(req.request.body).toEqual({ email: 'a@b.c', token: 'secret', password: 'longenough1' });
      req.flush({ ok: true });
      expect(await save).toBeNull();
      expect(auth.pendingReset()).toBeNull();
    });

    it('returns the server message and keeps the request when something fails', async () => {
      const { auth, http } = setup(false);
      localStorage.setItem('invenza.reset', JSON.stringify(pending));
      const save = auth.resetPassword(pending, 'x');
      http.expectOne('/api/auth/forgot/reset').flush({ error: 'Not approved.' }, { status: 403, statusText: 'Forbidden' });
      expect(await save).toBe('Not approved.');
      expect(auth.pendingReset()).toEqual(pending);
      const send = auth.forgotPassword('a@b.c');
      http.expectOne('/api/auth/forgot').error(new ProgressEvent('error'));
      expect(await send).toContain('Cannot reach the server');
    });

    it('ignores damaged saved data', () => {
      localStorage.setItem('invenza.reset', '{oops');
      expect(setup(false).auth.pendingReset()).toBeNull();
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
