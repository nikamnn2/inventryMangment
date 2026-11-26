/** Purpose: holds the signed-in user and login token (kept in localStorage), and talks to the auth API: sign in, activation links, sign out. */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AUTH_DISABLED } from '../config/auth.config';
import { MODULES } from '../config/modules';

export interface User { email: string; name: string; role: string; modules: string[]; superAdmin?: boolean; }

/** A "forgot password" request made in this browser. `token` proves it is the same browser later. */
export interface PendingReset { email: string; token: string; code: string; }

export type ResetStatus = 'waiting' | 'approved' | 'none';

/** Storage keys for the saved session, and for a password reset waiting for approval. */
const TOKEN_KEY = 'invenza.token';
const USER_KEY = 'invenza.user';
const RESET_KEY = 'invenza.reset';

const messageFrom = (e: unknown, fallback: string): string => {
  const err = e as HttpErrorResponse;
  if (err?.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  return err?.error?.error ?? fallback;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  /** True when login is bypassed for demos (see auth.config.ts). */
  readonly disabled = inject(AUTH_DISABLED);
  private static readonly DEMO_USER: User = { email: 'nikamnn2@gmail.com', name: 'Nikhil Nikam', role: 'admin', modules: [...MODULES], superAdmin: true };

  private readonly stored = this.disabled ? null : this.parseUser();
  // a session saved before roles existed has no module list: ask the user to sign in again
  readonly token = signal<string | null>(this.stored ? this.read(TOKEN_KEY) : null);
  readonly user = signal<User | null>(this.disabled ? AuthService.DEMO_USER : this.stored);
  readonly loggedIn = computed(() => this.disabled || !!this.token());

  /** True when the signed-in user's role may open the given tab. */
  can(module: string): boolean {
    return this.disabled || (this.user()?.modules.includes(module) ?? false);
  }

  private read(key: string): string | null {
    try { return this.browser ? sessionStorage.getItem(key) ?? localStorage.getItem(key) : null; } catch { return null; }
  }

  /** Removes the saved session from both places it can be kept. */
  private forgetSession(): void {
    try {
      for (const store of [localStorage, sessionStorage]) {
        store.removeItem(TOKEN_KEY);
        store.removeItem(USER_KEY);
      }
    } catch { /* storage unavailable */ }
  }

  private parseUser(): User | null {
    try {
      const u = JSON.parse(this.read(USER_KEY) ?? 'null') as User | null;
      return Array.isArray(u?.modules) ? u : null;
    } catch { return null; }
  }

  /**
   * Resolves to an error message, or null when signed in. With `remember` ("Keep me signed in") the
   * sign-in lasts for weeks and survives closing the browser; without it, it ends with the browser.
   */
  async login(email: string, password: string, remember = false): Promise<string | null> {
    if (this.disabled) return null; // temporary bypass: no API call, no token
    try {
      const res = await firstValueFrom(this.http.post<{ token: string; user: User }>('/api/auth/login', { email, password, ...(remember && { remember }) }));
      this.token.set(res.token);
      this.user.set(res.user);
      this.forgetSession();
      try {
        // the Android app keeps it in localStorage either way: its app lock looks for the sign-in there
        const store = remember || 'InvenzaApp' in globalThis ? localStorage : sessionStorage;
        store.setItem(TOKEN_KEY, res.token);
        store.setItem(USER_KEY, JSON.stringify(res.user));
      } catch { /* storage unavailable: session lasts until reload */ }
      this.clearReset();
      return null;
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 0) return 'Cannot reach the server. Is the API running?';
      return (e as HttpErrorResponse).error?.error ?? 'Sign in failed.';
    }
  }

  /** The reset request waiting in this browser, if any. */
  pendingReset(): PendingReset | null {
    try {
      const saved = JSON.parse((this.browser && localStorage.getItem(RESET_KEY)) || 'null') as PendingReset | null;
      return saved?.email && saved.token ? saved : null;
    } catch { return null; }
  }

  clearReset(): void {
    try { localStorage.removeItem(RESET_KEY); } catch { /* ignore */ }
  }

  /** "Forgot password?": asks the admin to allow a new password. Resolves to the request, or an error message. */
  async forgotPassword(email: string): Promise<PendingReset | string> {
    try {
      const res = await firstValueFrom(this.http.post<{ token: string; code: string }>('/api/auth/forgot', { email }));
      const pending = { email: email.trim().toLowerCase(), token: res.token, code: res.code };
      try { localStorage.setItem(RESET_KEY, JSON.stringify(pending)); } catch {
        return 'This browser cannot save the request. Turn off private browsing and try again.';
      }
      return pending;
    } catch (e) {
      return messageFrom(e, 'Could not send the request. Please try again.');
    }
  }

  /** Whether the admin has approved it. Resolves to an error message when the server cannot be asked. */
  async resetStatus(pending: PendingReset): Promise<{ status: ResetStatus } | string> {
    try {
      return await firstValueFrom(this.http.post<{ status: ResetStatus }>('/api/auth/forgot/status', { email: pending.email, token: pending.token }));
    } catch (e) {
      return messageFrom(e, 'Could not check the request. Please try again.');
    }
  }

  /** Sets the new password for an approved request. Resolves to an error message, or null on success. */
  async resetPassword(pending: PendingReset, password: string): Promise<string | null> {
    try {
      await firstValueFrom(this.http.post('/api/auth/forgot/reset', { email: pending.email, token: pending.token, password }));
      this.clearReset();
      this.forgetSession();
      this.token.set(null);
      this.user.set(null);
      return null;
    } catch (e) {
      return messageFrom(e, 'Could not change the password. Please try again.');
    }
  }

  /** Who an activation link is for; resolves to an error message when the link is bad or expired. */
  async activationInfo(token: string): Promise<{ name: string; email: string; role: string } | string> {
    try {
      return await firstValueFrom(this.http.get<{ name: string; email: string; role: string }>(`/api/auth/activate/${encodeURIComponent(token)}`));
    } catch (e) {
      return (e as HttpErrorResponse).error?.error ?? 'Could not check this link. Please try again.';
    }
  }

  /** Sets the member's password, which activates the account. Resolves to an error message, or null on success. */
  async activate(token: string, password: string): Promise<string | null> {
    try {
      await firstValueFrom(this.http.post('/api/auth/activate', { token, password }));
      return null;
    } catch (e) {
      return (e as HttpErrorResponse).error?.error ?? 'Could not activate the account. Please try again.';
    }
  }

  /** Purpose: clears the session and returns to the login page. */
  logout(): void {
    this.token.set(null);
    this.user.set(null);
    this.forgetSession();
    this.router.navigateByUrl('/login');
  }
}
