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

  protected async signIn(event: Event, email: string, password: string): Promise<void> {
    event.preventDefault();
    if (!this.auth.disabled && (!email.trim() || !password)) {
      this.error.set('Enter your email and password.');
      return;
    }
    this.error.set('');
    this.loading.set(true);
    const err = await this.auth.login(email.trim(), password);
    this.loading.set(false);
    if (err) this.error.set(err);
    else await this.router.navigateByUrl('/dashboard');
  }
}
