import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Purpose: "Activate your account" page opened from the e-mailed link. Shows who was invited and lets them choose a password. */
@Component({
  selector: 'app-activate',
  imports: [IconComponent, RouterLink],
  templateUrl: './activate.component.html',
  styleUrl: './activate.component.scss',
})
export class ActivateComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';

  protected readonly checking = signal(true);
  protected readonly invite = signal<{ name: string; email: string; role: string } | null>(null);
  protected readonly linkError = signal('');
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly done = signal(false);
  protected readonly showPassword = signal(false);

  async ngOnInit(): Promise<void> {
    if (!this.token) {
      this.linkError.set('This activation link is incomplete. Open the link from your email again.');
    } else {
      const info = await this.auth.activationInfo(this.token);
      if (typeof info === 'string') this.linkError.set(info);
      else this.invite.set(info);
    }
    this.checking.set(false);
  }

  /** Validates the two passwords match (min 8 characters), then activates the account. */
  protected async submit(event: Event, password: string, confirm: string): Promise<void> {
    event.preventDefault();
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
    const err = await this.auth.activate(this.token, password);
    this.saving.set(false);
    if (err) this.error.set(err);
    else this.done.set(true);
  }
}
