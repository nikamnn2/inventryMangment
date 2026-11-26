import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, PendingReset } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Purpose: choose a new password after the admin approved a "forgot password" request made in this browser. */
@Component({
  selector: 'app-reset-password',
  imports: [RouterLink, IconComponent],
  templateUrl: './reset-password.component.html',
  // looks the same as the account activation page
  styleUrl: '../activate/activate.component.scss',
})
export class ResetPasswordComponent implements OnInit {
  private readonly auth = inject(AuthService);

  protected readonly checking = signal(true);
  /** Why a new password cannot be set right now (empty when it can). */
  protected readonly blocked = signal('');
  protected readonly pending = signal<PendingReset | null>(null);
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly done = signal(false);
  protected readonly showPassword = signal(false);

  async ngOnInit(): Promise<void> {
    const pending = this.auth.pendingReset();
    this.pending.set(pending);
    const result = pending ? await this.auth.resetStatus(pending) : { status: 'none' as const };
    if (typeof result === 'string') this.blocked.set(result);
    else if (result.status === 'waiting') this.blocked.set(`Your request is still waiting for admin approval. Your request code is ${pending!.code}.`);
    else if (result.status === 'none') this.blocked.set('There is no approved password reset on this device. Use "Forgot password?" on the sign-in page.');
    this.checking.set(false);
  }

  /** Validates the two passwords match (min 8 characters), then saves the new one. */
  protected async submit(event: Event, password: string, confirm: string): Promise<void> {
    event.preventDefault();
    const pending = this.pending();
    if (!pending) return;
    if (password.length < 8) {
      this.error.set('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      this.error.set('The two passwords do not match.');
      return;
    }
    this.error.set('');
    this.saving.set(true);
    const err = await this.auth.resetPassword(pending, password);
    this.saving.set(false);
    if (err) this.error.set(err);
    else this.done.set(true);
  }
}
