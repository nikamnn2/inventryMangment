import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Purpose: Sign-in page. Checks the form, calls the API and opens the dashboard on success. */
@Component({
  selector: 'app-login',
  imports: [IconComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly authDisabled = this.auth.disabled;
  protected readonly showPassword = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');
  /** Which card is showing: sign in, ask for a reset, or "request sent". */
  protected readonly view = signal<'signin' | 'forgot' | 'sent'>('signin');
  protected readonly email = signal(this.auth.pendingReset()?.email ?? '');
  protected readonly code = signal('');

  protected async signIn(event: Event, email: string, password: string, remember = true): Promise<void> {
    event.preventDefault();
    this.info.set('');
    if (!this.auth.disabled && email.trim() && !password) {
      await this.continueReset(email.trim().toLowerCase());
      return;
    }
    if (!this.auth.disabled && (!email.trim() || !password)) {
      this.error.set('Enter your email and password.');
      return;
    }
    this.error.set('');
    this.loading.set(true);
    const err = await this.auth.login(email.trim(), password, remember);
    this.loading.set(false);
    if (err) this.error.set(err);
    else await this.router.navigateByUrl('/dashboard');
  }

  /** Email only: if this browser asked for a reset and it is approved, go and choose the new password. */
  private async continueReset(email: string): Promise<void> {
    const pending = this.auth.pendingReset();
    if (!pending || pending.email !== email) {
      this.error.set('Enter your email and password.');
      return;
    }
    this.error.set('');
    this.loading.set(true);
    const result = await this.auth.resetStatus(pending);
    this.loading.set(false);
    if (typeof result === 'string') this.error.set(result);
    else if (result.status === 'approved') await this.router.navigateByUrl('/reset-password');
    else if (result.status === 'waiting') this.info.set(`Your password reset is waiting for admin approval. Your request code is ${pending.code}.`);
    else {
      this.auth.clearReset();
      this.error.set('Your reset request was rejected or has expired. Use "Forgot password?" to ask again.');
    }
  }

  protected showForgot(email: string): void {
    this.email.set(email.trim());
    this.error.set('');
    this.info.set('');
    this.view.set('forgot');
  }

  protected showSignIn(): void {
    this.error.set('');
    this.view.set('signin');
  }

  /** Sends the reset request to the admin. */
  protected async requestReset(event: Event, email: string): Promise<void> {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      this.error.set('Enter your email address.');
      return;
    }
    this.error.set('');
    this.loading.set(true);
    const result = await this.auth.forgotPassword(email.trim());
    this.loading.set(false);
    if (typeof result === 'string') {
      this.error.set(result);
      return;
    }
    this.email.set(result.email);
    this.code.set(result.code);
    this.view.set('sent');
  }
}
