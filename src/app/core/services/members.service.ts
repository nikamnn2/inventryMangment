/** Purpose: client for the admin-only Members API: list, invite, resend activation e-mail, activate by hand, edit and delete team members. */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type RoleName = 'admin' | 'manager' | 'accountant';

export interface Member {
  email: string;
  name: string;
  role: RoleName;
  superAdmin: boolean;
  status: 'active' | 'pending';
  createdAt?: string;
  /** Email of whoever registered this member; only sent to the super admin. */
  addedBy?: string | null;
}

export interface MemberForm { name: string; email: string; role: RoleName; password: string; }

/** Outcome of registering a member or resending the activation email. */
export interface InviteResult { error: string | null; emailSent: boolean; }

/** Turns an HTTP error into a short message the user can read. */
const message = (e: unknown): string => {
  const err = e as HttpErrorResponse;
  if (err?.status === 0) return 'Cannot reach the server. Is the API running?';
  return err?.error?.error ?? 'Something went wrong. Please try again.';
};

/** Admin-only user management (the /api/members endpoints). Mutations resolve to an error message, or null on success. */
@Injectable({ providedIn: 'root' })
export class MembersService {
  private readonly http = inject(HttpClient);

  readonly members = signal<Member[]>([]);

  /** Purpose: refresh the members list. */
  async load(): Promise<string | null> {
    try {
      this.members.set(await firstValueFrom(this.http.get<Member[]>('/api/members')));
      return null;
    } catch (e) {
      return message(e);
    }
  }

  /** Registers the member and emails them an activation link; they choose their own password there. */
  async add(form: Pick<MemberForm, 'name' | 'email' | 'role'>): Promise<InviteResult> {
    try {
      const res = await firstValueFrom(this.http.post<Member & { emailSent: boolean }>('/api/members', form));
      await this.load();
      return { error: null, emailSent: res.emailSent };
    } catch (e) {
      return { error: message(e), emailSent: false };
    }
  }

  /** Sends a new activation email to a member who has not activated yet. */
  async resend(email: string): Promise<InviteResult> {
    try {
      const res = await firstValueFrom(this.http.post<{ emailSent: boolean }>(`/api/members/${encodeURIComponent(email)}/resend`, {}));
      return { error: null, emailSent: res.emailSent };
    } catch (e) {
      return { error: message(e), emailSent: false };
    }
  }

  /** Activates a pending member without the email, using a password the admin passes on to them. */
  async activate(email: string, password: string): Promise<string | null> {
    try {
      await firstValueFrom(this.http.post<Member>(`/api/members/${encodeURIComponent(email)}/activate`, { password }));
      return await this.load();
    } catch (e) {
      return message(e);
    }
  }

  /** Purpose: change a member's name / role / password. */
  async update(email: string, form: Pick<MemberForm, 'name' | 'role' | 'password'>): Promise<string | null> {
    try {
      await firstValueFrom(this.http.put<Member>(`/api/members/${encodeURIComponent(email)}`, form));
      return await this.load();
    } catch (e) {
      return message(e);
    }
  }

  /** Purpose: delete a member. */
  async remove(email: string): Promise<string | null> {
    try {
      await firstValueFrom(this.http.delete(`/api/members/${encodeURIComponent(email)}`));
      return await this.load();
    } catch (e) {
      return message(e);
    }
  }
}
