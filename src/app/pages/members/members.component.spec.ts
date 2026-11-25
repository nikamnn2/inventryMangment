import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { AUTH_DISABLED } from '../../core/config/auth.config';
import { AuthService } from '../../core/services/auth.service';
import { Member, MembersService } from '../../core/services/members.service';
import { baseProviders } from '../../testing/fixtures';
import { MembersComponent } from './members.component';

const SUPER: Member = { email: 'root@x.y', name: 'Root', role: 'admin', superAdmin: true, status: 'active' };
const OTHER_ADMIN: Member = { email: 'adm@x.y', name: 'Adm', role: 'admin', superAdmin: false, status: 'active' };
const STAFF: Member = { email: 'staff@x.y', name: 'Staff', role: 'manager', superAdmin: false, status: 'active' };
const PENDING: Member = { ...STAFF, email: 'new@x.y', name: 'Newbie', status: 'pending' };

function setup(callerEmail: string, superAdmin: boolean) {
  TestBed.configureTestingModule({
    imports: [MembersComponent],
    providers: [...baseProviders(), { provide: AUTH_DISABLED, useValue: false }],
  });
  TestBed.inject(AuthService).user.set({ email: callerEmail, name: 'Me', role: 'admin', modules: ['members'], superAdmin });
  const svc = TestBed.inject(MembersService);
  spyOn(svc, 'load').and.callFake(async () => {
    svc.members.set([SUPER, OTHER_ADMIN, STAFF]);
    return null;
  });
  const fixture = TestBed.createComponent(MembersComponent);
  fixture.detectChanges();
  return { svc, fixture, c: fixture.componentInstance as any };
}

describe('MembersComponent', () => {
  it('lists members and filters by text', async () => {
    const { fixture, c } = setup('root@x.y', true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Super admin');
    expect(c.filtered().length).toBe(3);
    c.q.set('staff');
    expect(c.filtered().map((m: Member) => m.email)).toEqual(['staff@x.y']);
  });

  it('lets the super admin manage other admins but never the super admin row', () => {
    const { c } = setup('root@x.y', true);
    expect(c.roles()).toEqual(['admin', 'manager', 'accountant']);
    expect(c.canManage(SUPER)).toBeFalse();
    expect(c.canManage(OTHER_ADMIN)).toBeTrue();
    expect(c.canDelete(OTHER_ADMIN)).toBeTrue();
    expect(c.canDelete({ ...STAFF, email: 'root@x.y' })).toBeFalse(); // own account
  });

  it('keeps a regular admin away from admin accounts and the admin role', () => {
    const { c } = setup('adm@x.y', false);
    expect(c.roles()).toEqual(['manager', 'accountant']);
    expect(c.canManage(OTHER_ADMIN)).toBeFalse();
    expect(c.canManage(STAFF)).toBeTrue();
    expect(c.canDelete(OTHER_ADMIN)).toBeFalse();
  });

  it('maps roles to badge styles', () => {
    const { c } = setup('root@x.y', true);
    expect([c.roleClass('admin'), c.roleClass('manager'), c.roleClass('accountant')]).toEqual(['danger', 'info', 'ok']);
  });

  it('shows a load error', async () => {
    TestBed.configureTestingModule({ imports: [MembersComponent], providers: baseProviders() });
    spyOn(TestBed.inject(MembersService), 'load').and.resolveTo('Cannot reach the server.');
    const fixture = TestBed.createComponent(MembersComponent);
    await fixture.whenStable();
    expect((fixture.componentInstance as any).loadError()).toBe('Cannot reach the server.');
  });

  describe('dialog', () => {
    it('requires a name and email for a new member', async () => {
      const { svc, c } = setup('root@x.y', true);
      const add = spyOn(svc, 'add');
      c.open();
      await c.save(new Event('submit'));
      expect(c.error()).toBe('Name and email are required.');
      expect(add).not.toHaveBeenCalled();
    });

    it('registers a member, emails the link and confirms', fakeAsync(() => {
      const { svc, c } = setup('root@x.y', true);
      const add = spyOn(svc, 'add').and.resolveTo({ error: null, emailSent: true });
      c.open();
      c.form = { name: ' New ', email: ' NEW@x.y ', role: 'manager', password: '' };
      c.save(new Event('submit'));
      tick();
      expect(add).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'New', email: 'new@x.y', role: 'manager' }));
      expect(c.dialog()).toBeFalse();
      expect(c.saved()).toBe('Activation email sent to new@x.y.');
      expect(c.savedTone()).toBe('ok');
      tick(2500);
      expect(c.saved()).toBe('');
    }));

    it('warns when the member was registered but the email could not be sent', fakeAsync(() => {
      const { svc, c } = setup('root@x.y', true);
      spyOn(svc, 'add').and.resolveTo({ error: null, emailSent: false });
      c.open();
      c.form = { name: 'New', email: 'new@x.y', role: 'manager', password: '' };
      c.save(new Event('submit'));
      tick();
      expect(c.saved()).toContain('Member registered, but the email could not be sent');
      expect(c.savedTone()).toBe('warn');
      tick(6000);
    }));

    it('shows the server error and stays open', async () => {
      const { svc, fixture, c } = setup('root@x.y', true);
      spyOn(svc, 'add').and.resolveTo({ error: 'new@x.y is already registered.', emailSent: false });
      c.open();
      fixture.detectChanges();
      c.form = { name: 'N', email: 'new@x.y', role: 'manager', password: 'longenough1' };
      await c.save(new Event('submit'));
      expect(c.error()).toBe('new@x.y is already registered.');
      expect(c.dialog()).toBeTrue();
    });

    it('edits an existing member without needing a password', fakeAsync(() => {
      const { svc, c } = setup('root@x.y', true);
      const update = spyOn(svc, 'update').and.resolveTo(null);
      c.open(STAFF);
      expect(c.form.password).toBe('');
      c.form.role = 'accountant';
      c.save(new Event('submit'));
      tick();
      expect(update).toHaveBeenCalledWith('staff@x.y', jasmine.objectContaining({ role: 'accountant', name: 'Staff' }));
      expect(c.saved()).toBe('Member updated.');
      tick(2500);
    }));

    it('shows the status and offers a resend for pending members only', () => {
      const { svc, fixture } = setup('root@x.y', true);
      svc.members.set([STAFF, PENDING]);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Pending activation');
      expect((text.match(/Resend email/g) ?? []).length).toBe(1);
    });

    it('resends the activation email', fakeAsync(() => {
      const { svc, c } = setup('root@x.y', true);
      const resend = spyOn(svc, 'resend').and.resolveTo({ error: null, emailSent: true });
      c.resend(PENDING);
      tick();
      expect(resend).toHaveBeenCalledWith('new@x.y');
      expect(c.saved()).toBe('Activation email sent to new@x.y.');
      tick(2500);
    }));

    it('warns when a resent link could not be emailed and shows resend errors', fakeAsync(() => {
      const { svc, c } = setup('root@x.y', true);
      const resend = spyOn(svc, 'resend');
      resend.and.resolveTo({ error: null, emailSent: false });
      c.resend(PENDING);
      tick();
      expect(c.saved()).toContain('Link refreshed, but the email could not be sent');
      tick(6000);
      resend.and.resolveTo({ error: 'This member has already activated their account.', emailSent: false });
      c.resend(PENDING);
      tick();
      expect(c.loadError()).toBe('This member has already activated their account.');
    }));

    it('closes without saving', () => {
      const { c } = setup('root@x.y', true);
      c.open();
      c.close();
      expect(c.dialog()).toBeFalse();
    });
  });

  describe('removing', () => {
    it('asks first, then removes', fakeAsync(() => {
      const { svc, fixture, c } = setup('root@x.y', true);
      const remove = spyOn(svc, 'remove').and.resolveTo(null);
      c.confirming.set(STAFF);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Remove Staff?');
      c.remove();
      tick();
      expect(remove).toHaveBeenCalledWith('staff@x.y');
      expect(c.confirming()).toBeNull();
      expect(c.saved()).toBe('Member removed.');
      tick(2500);
    }));

    it('shows the failure', async () => {
      const { svc, c } = setup('root@x.y', true);
      spyOn(svc, 'remove').and.resolveTo('The super admin account cannot be deleted.');
      c.confirming.set(STAFF);
      await c.remove();
      expect(c.loadError()).toBe('The super admin account cannot be deleted.');
    });

    it('does nothing when nothing is selected', async () => {
      const { svc, c } = setup('root@x.y', true);
      const remove = spyOn(svc, 'remove');
      await c.remove();
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
