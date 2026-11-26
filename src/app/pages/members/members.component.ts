import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ROLE_LABELS } from '../../core/config/modules';
import { AuthService } from '../../core/services/auth.service';
import { Member, MemberForm, MembersService, RoleName } from '../../core/services/members.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Empty member form (new members default to the accountant role). */
const blank = (): MemberForm => ({ name: '', email: '', role: 'accountant', password: '' });

/** Purpose: Members page (admin only): invite team members by e-mail, change roles / passwords, resend activation links, activate by hand and remove people. */
@Component({
  selector: 'app-members',
  imports: [FormsModule, IconComponent],
  templateUrl: './members.component.html',
  styleUrl: './members.component.scss',
})
export class MembersComponent {
  protected readonly members = inject(MembersService);
  private readonly auth = inject(AuthService);

  protected readonly labels = ROLE_LABELS;
  protected readonly q = signal('');
  protected readonly dialog = signal(false);
  protected readonly editing = signal<Member | null>(null);
  protected readonly confirming = signal<Member | null>(null);
  protected readonly activating = signal<Member | null>(null);
  protected activatePassword = '';
  protected readonly error = signal('');
  protected readonly loadError = signal('');
  protected readonly saved = signal('');
  protected readonly savedTone = signal<'ok' | 'warn'>('ok');
  protected form: MemberForm = blank();

  protected readonly me = computed(() => this.auth.user());
  protected readonly isSuper = computed(() => this.auth.disabled || !!this.me()?.superAdmin);
  /** Only the super admin can hand out the admin role. */
  protected readonly roles = computed<RoleName[]>(() => (this.isSuper() ? ['admin', 'manager', 'accountant'] : ['manager', 'accountant']));

  protected readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.members.members().filter(m => !q || `${m.name} ${m.email} ${m.role}`.toLowerCase().includes(q));
  });

  constructor() {
    void this.members.load().then(err => this.loadError.set(err ?? ''));
  }

  /** The super admin is untouchable; other admins can only be managed by the super admin. */
  protected canManage(m: Member): boolean {
    if (m.superAdmin) return false;
    return m.role !== 'admin' || this.isSuper();
  }

  /** Same rule as editing, and you cannot delete yourself. */
  protected canDelete(m: Member): boolean {
    return this.canManage(m) && m.email !== this.me()?.email;
  }

  /** Badge colour for a role. */
  protected roleClass(role: string): string {
    return role === 'admin' ? 'danger' : role === 'manager' ? 'info' : 'ok';
  }

  /** Opens the dialog for a new or existing member. */
  protected open(m?: Member): void {
    this.form = m ? { name: m.name, email: m.email, role: m.role, password: '' } : blank();
    this.editing.set(m ?? null);
    this.error.set('');
    this.dialog.set(true);
  }

  protected close(): void {
    this.dialog.set(false);
  }

  /** Creates (sends the activation e-mail) or updates a member. */
  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const f = { ...this.form, name: this.form.name.trim(), email: this.form.email.trim().toLowerCase() };
    if (!f.name || (!this.editing() && !f.email)) {
      this.error.set('Name and email are required.');
      return;
    }
    const editing = this.editing();
    if (editing) {
      const err = await this.members.update(editing.email, f);
      if (err) {
        this.error.set(err);
        return;
      }
      this.close();
      this.flash('Member updated.');
      return;
    }
    const result = await this.members.add(f);
    if (result.error) {
      this.error.set(result.error);
      return;
    }
    this.close();
    this.flashInvite(f.email, result.emailSent, 'registered');
  }

  /** Opens the dialog that activates a pending member without the email. */
  protected openActivate(m: Member): void {
    this.activatePassword = '';
    this.error.set('');
    this.activating.set(m);
  }

  /** Activates the chosen member with the password typed in the dialog. */
  protected async activate(e: Event): Promise<void> {
    e.preventDefault();
    const m = this.activating();
    if (!m) return;
    if (this.activatePassword.length < 8) {
      this.error.set('Password must be at least 8 characters.');
      return;
    }
    const err = await this.members.activate(m.email, this.activatePassword);
    if (err) {
      this.error.set(err);
      return;
    }
    this.activating.set(null);
    this.activatePassword = '';
    this.flash(`${m.name} is now active.`);
  }

  /** Sends the activation email again to a member who has not activated yet. */
  protected async resend(m: Member): Promise<void> {
    const result = await this.members.resend(m.email);
    if (result.error) this.loadError.set(result.error);
    else this.flashInvite(m.email, result.emailSent, 'resent');
  }

  private flashInvite(email: string, emailSent: boolean, what: 'registered' | 'resent'): void {
    if (emailSent) this.flash(`Activation email sent to ${email}.`);
    else this.flash(`${what === 'registered' ? 'Member registered' : 'Link refreshed'}, but the email could not be sent. Check the mail settings on the server.`, 'warn');
  }

  /** Deletes the member chosen in the confirmation dialog. */
  protected async remove(): Promise<void> {
    const m = this.confirming();
    if (!m) return;
    const err = await this.members.remove(m.email);
    this.confirming.set(null);
    if (err) this.loadError.set(err);
    else this.flash('Member removed.');
  }

  /** Shows a short confirmation / warning message that disappears by itself. */
  private flash(text: string, tone: 'ok' | 'warn' = 'ok'): void {
    this.saved.set(text);
    this.savedTone.set(tone);
    setTimeout(() => this.saved.set(''), tone === 'warn' ? 6000 : 2500);
  }
}
