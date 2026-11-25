/** Purpose: holds the signed-in user and login token (kept in localStorage), and talks to the auth API: sign in, activation links, sign out. */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AUTH_DISABLED } from '../config/auth.config';
import { MODULES } from '../config/modules';

export interface User { email: string; name: string; role: string; modules: string[]; superAdmin?: boolean; }

/** localStorage keys for the saved session. */
const TOKEN_KEY = 'invenza.token';
const USER_KEY = 'invenza.user';

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
    try { return this.browser ? localStorage.getItem(key) : null; } catch { return null; }
  }

  private parseUser(): User | null {
    try {
      const u = JSON.parse(this.read(USER_KEY) ?? 'null') as User | null;
      return Array.isArray(u?.modules) ? u : null;
    } catch { return null; }
  }

  /** Resolves to an error message, or null when signed in. */
  async login(email: string, password: string): Promise<string | null> {
    if (this.disabled) return null; // temporary bypass: no API call, no token
    try {
      const res = await firstValueFrom(this.http.post<{ token: string; user: User }>('/api/auth/login', { email, password }));
      this.token.set(res.token);
      this.user.set(res.user);
      try {
        localStorage.setItem(TOKEN_KEY, res.token);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      } catch { /* storage unavailable: session lasts until reload */ }
      return null;
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 0) return 'Cannot reach the server. Is the API running?';
      return (e as HttpErrorResponse).error?.error ?? 'Sign in failed.';
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
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch { /* ignore */ }
    this.router.navigateByUrl('/login');
  }
}
