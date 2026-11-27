import { TestBed } from '@angular/core/testing';
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
    vi.spyOn(svc, 'load').mockImplementation(async () => {
        svc.members.set([SUPER, OTHER_ADMIN, STAFF]);
        return null;
    });
    const fixture = TestBed.createComponent(MembersComponent);
    fixture.detectChanges();
    return { svc, fixture, c: fixture.componentInstance as any };
}

afterEach(() => {
    vi.useRealTimers();
});

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
        expect(c.roles()).toEqual(['admin', 'manager', 'accountant', 'sales']);
        expect(c.canManage(SUPER)).toBe(false);
        expect(c.canManage(OTHER_ADMIN)).toBe(true);
        expect(c.canDelete(OTHER_ADMIN)).toBe(true);
        expect(c.canDelete({ ...STAFF, email: 'root@x.y' })).toBe(false); // own account
    });

    it('keeps a regular admin away from admin accounts and the admin role', () => {
        const { c } = setup('adm@x.y', false);
        expect(c.roles()).toEqual(['manager', 'accountant', 'sales']);
        expect(c.canManage(OTHER_ADMIN)).toBe(false);
        expect(c.canManage(STAFF)).toBe(true);
        expect(c.canDelete(OTHER_ADMIN)).toBe(false);
    });

    it('shows no actions for someone another admin added', () => {
        const { svc, fixture, c } = setup('adm@x.y', false);
        svc.members.set([{ ...PENDING, manageable: false }]);
        fixture.detectChanges();
        expect(c.canManage({ ...STAFF, manageable: false })).toBe(false);
        expect(fixture.nativeElement.textContent).toContain('Newbie');
        expect(fixture.nativeElement.querySelectorAll('tbody button').length).toBe(0);
    });

    it('maps roles to badge styles', () => {
        const { c } = setup('root@x.y', true);
        expect([c.roleClass('admin'), c.roleClass('manager'), c.roleClass('accountant')]).toEqual(['danger', 'info', 'ok']);
    });

    it('shows a load error', async () => {
        TestBed.configureTestingModule({ imports: [MembersComponent], providers: baseProviders() });
        vi.spyOn(TestBed.inject(MembersService), 'load').mockResolvedValue('Cannot reach the server.');
        const fixture = TestBed.createComponent(MembersComponent);
        await fixture.whenStable();
        expect((fixture.componentInstance as any).loadError()).toBe('Cannot reach the server.');
    });

    describe('dialog', () => {
        it('requires a name and email for a new member', async () => {
            const { svc, c } = setup('root@x.y', true);
            const add = vi.spyOn(svc, 'add');
            c.open();
            await c.save(new Event('submit'));
            expect(c.error()).toBe('Name and email are required.');
            expect(add).not.toHaveBeenCalled();
        });

        it('registers a member, emails the link and confirms', async () => {
            vi.useFakeTimers();
            const { svc, c } = setup('root@x.y', true);
            const add = vi.spyOn(svc, 'add').mockResolvedValue({ error: null, emailSent: true });
            c.open();
            c.form = { name: ' New ', email: ' NEW@x.y ', role: 'manager', password: '' };
            c.save(new Event('submit'));
            await vi.advanceTimersByTimeAsync(0);
            expect(add).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', email: 'new@x.y', role: 'manager' }));
            expect(c.dialog()).toBe(false);
            expect(c.saved()).toBe('Activation email sent to new@x.y.');
            expect(c.savedTone()).toBe('ok');
            await vi.advanceTimersByTimeAsync(2500);
            expect(c.saved()).toBe('');
        });

        it('warns when the member was registered but the email could not be sent', async () => {
            vi.useFakeTimers();
            const { svc, c } = setup('root@x.y', true);
            vi.spyOn(svc, 'add').mockResolvedValue({ error: null, emailSent: false });
            c.open();
            c.form = { name: 'New', email: 'new@x.y', role: 'manager', password: '' };
            c.save(new Event('submit'));
            await vi.advanceTimersByTimeAsync(0);
            expect(c.saved()).toContain('Member registered, but the email could not be sent');
            expect(c.savedTone()).toBe('warn');
            await vi.advanceTimersByTimeAsync(6000);
        });

        it('shows the server error and stays open', async () => {
            const { svc, fixture, c } = setup('root@x.y', true);
            vi.spyOn(svc, 'add').mockResolvedValue({ error: 'new@x.y is already registered.', emailSent: false });
            c.open();
            fixture.detectChanges();
            c.form = { name: 'N', email: 'new@x.y', role: 'manager', password: 'longenough1' };
            await c.save(new Event('submit'));
            expect(c.error()).toBe('new@x.y is already registered.');
            expect(c.dialog()).toBe(true);
        });

        it('edits an existing member without needing a password', async () => {
            vi.useFakeTimers();
            const { svc, c } = setup('root@x.y', true);
            const update = vi.spyOn(svc, 'update').mockResolvedValue(null);
            c.open(STAFF);
            expect(c.form.password).toBe('');
            c.form.role = 'accountant';
            c.save(new Event('submit'));
            await vi.advanceTimersByTimeAsync(0);
            expect(update).toHaveBeenCalledWith('staff@x.y', expect.objectContaining({ role: 'accountant', name: 'Staff' }));
            expect(c.saved()).toBe('Member updated.');
            await vi.advanceTimersByTimeAsync(2500);
        });

        it('shows the status and offers a resend for pending members only', () => {
            const { svc, fixture } = setup('root@x.y', true);
            svc.members.set([STAFF, PENDING]);
            fixture.detectChanges();
            const text = fixture.nativeElement.textContent;
            expect(text).toContain('Pending activation');
            expect((text.match(/Resend email/g) ?? []).length).toBe(1);
        });

        it('resends the activation email', async () => {
            vi.useFakeTimers();
            const { svc, c } = setup('root@x.y', true);
            const resend = vi.spyOn(svc, 'resend').mockResolvedValue({ error: null, emailSent: true });
            c.resend(PENDING);
            await vi.advanceTimersByTimeAsync(0);
            expect(resend).toHaveBeenCalledWith('new@x.y');
            expect(c.saved()).toBe('Activation email sent to new@x.y.');
            await vi.advanceTimersByTimeAsync(2500);
        });

        it('warns when a resent link could not be emailed and shows resend errors', async () => {
            vi.useFakeTimers();
            const { svc, c } = setup('root@x.y', true);
            const resend = vi.spyOn(svc, 'resend');
            resend.mockResolvedValue({ error: null, emailSent: false });
            c.resend(PENDING);
            await vi.advanceTimersByTimeAsync(0);
            expect(c.saved()).toContain('Link refreshed, but the email could not be sent');
            await vi.advanceTimersByTimeAsync(6000);
            resend.mockResolvedValue({ error: 'This member has already activated their account.', emailSent: false });
            c.resend(PENDING);
            await vi.advanceTimersByTimeAsync(0);
            expect(c.loadError()).toBe('This member has already activated their account.');
        });

        it('offers activation only for pending members the caller may manage', () => {
            const { svc, fixture } = setup('adm@x.y', false);
            svc.members.set([STAFF, PENDING, { ...PENDING, email: 'padm@x.y', role: 'admin' }]);
            fixture.detectChanges();
            const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
            expect(buttons.filter(b => b.textContent?.trim() === 'Activate').length).toBe(1);
        });

        it('activates a pending member with the typed password', async () => {
            vi.useFakeTimers();
            const { svc, fixture, c } = setup('root@x.y', true);
            const activate = vi.spyOn(svc, 'activate').mockResolvedValue(null);
            c.openActivate(PENDING);
            fixture.detectChanges();
            expect(fixture.nativeElement.textContent).toContain('Activate Newbie');
            c.activatePassword = 'short';
            c.activate(new Event('submit'));
            await vi.advanceTimersByTimeAsync(0);
            expect(c.error()).toBe('Password must be at least 8 characters.');
            expect(activate).not.toHaveBeenCalled();
            c.activatePassword = 'handpass123';
            c.activate(new Event('submit'));
            await vi.advanceTimersByTimeAsync(0);
            expect(activate).toHaveBeenCalledWith('new@x.y', 'handpass123');
            expect(c.activating()).toBeNull();
            expect(c.saved()).toBe('Newbie is now active.');
            await vi.advanceTimersByTimeAsync(2500);
        });

        it('keeps the activation dialog open when the server refuses', async () => {
            const { svc, c } = setup('root@x.y', true);
            vi.spyOn(svc, 'activate').mockResolvedValue('This member has already activated their account.');
            c.openActivate(PENDING);
            c.activatePassword = 'handpass123';
            await c.activate(new Event('submit'));
            expect(c.error()).toBe('This member has already activated their account.');
            expect(c.activating()).toEqual(PENDING);
        });

        it('closes without saving', () => {
            const { c } = setup('root@x.y', true);
            c.open();
            c.close();
            expect(c.dialog()).toBe(false);
        });
    });

    describe('password reset requests', () => {
        const ASKED: Member = { ...STAFF, passwordReset: { status: 'requested', code: '482913' } };

        it('lists waiting requests, shows the code and approves it', async () => {
            vi.useFakeTimers();
            const { svc, fixture, c } = setup('root@x.y', true);
            svc.members.set([SUPER, ASKED]);
            fixture.detectChanges();
            expect(fixture.nativeElement.textContent).toContain('asked to reset their password');
            const approve = vi.spyOn(svc, 'approveReset').mockResolvedValue(null);
            c.openReview(ASKED);
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.reset-code').textContent.trim()).toBe('482913');
            c.decideReset(true);
            await vi.advanceTimersByTimeAsync(0);
            expect(approve).toHaveBeenCalledWith('staff@x.y', '482913');
            expect(c.reviewing()).toBeNull();
            expect(c.saved()).toContain('Approved.');
            await vi.advanceTimersByTimeAsync(2500);
        });

        it('rejects a request and shows a failure', async () => {
            vi.useFakeTimers();
            const { svc, c } = setup('root@x.y', true);
            const reject = vi.spyOn(svc, 'rejectReset').mockResolvedValue('This request has changed.');
            c.openReview(ASKED);
            c.decideReset(false);
            await vi.advanceTimersByTimeAsync(0);
            expect(reject).toHaveBeenCalledWith('staff@x.y');
            expect(c.loadError()).toBe('This request has changed.');
        });
    });

    describe('removing', () => {
        it('asks first, then removes', async () => {
            vi.useFakeTimers();
            const { svc, fixture, c } = setup('root@x.y', true);
            const remove = vi.spyOn(svc, 'remove').mockResolvedValue(null);
            c.confirming.set(STAFF);
            fixture.detectChanges();
            expect(fixture.nativeElement.textContent).toContain('Remove Staff?');
            c.remove();
            await vi.advanceTimersByTimeAsync(0);
            expect(remove).toHaveBeenCalledWith('staff@x.y');
            expect(c.confirming()).toBeNull();
            expect(c.saved()).toBe('Member removed.');
            await vi.advanceTimersByTimeAsync(2500);
        });

        it('shows the failure', async () => {
            const { svc, c } = setup('root@x.y', true);
            vi.spyOn(svc, 'remove').mockResolvedValue('The super admin account cannot be deleted.');
            c.confirming.set(STAFF);
            await c.remove();
            expect(c.loadError()).toBe('The super admin account cannot be deleted.');
        });

        it('does nothing when nothing is selected', async () => {
            const { svc, c } = setup('root@x.y', true);
            const remove = vi.spyOn(svc, 'remove');
            await c.remove();
            expect(remove).not.toHaveBeenCalled();
        });
    });
});
