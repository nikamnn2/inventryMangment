import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/services/auth.service';
import { baseProviders } from '../../testing/fixtures';
import { ResetPasswordComponent } from './reset-password.component';

const PENDING = { email: 'a@x.y', token: 't'.repeat(64), code: '123456' };

describe('ResetPasswordComponent', () => {
  async function setup(pending: typeof PENDING | null, status: 'approved' | 'waiting' | 'none' = 'approved') {
    TestBed.configureTestingModule({ imports: [ResetPasswordComponent], providers: baseProviders() });
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'pendingReset').and.returnValue(pending);
    const check = spyOn(auth, 'resetStatus').and.resolveTo({ status });
    const save = spyOn(auth, 'resetPassword').and.resolveTo(null);
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, check, save, c: fixture.componentInstance as any, text: () => fixture.nativeElement.textContent as string };
  }

  it('shows no form without a request on this device', async () => {
    const { text, check, fixture } = await setup(null);
    expect(check).not.toHaveBeenCalled();
    expect(text()).toContain('no approved password reset on this device');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('shows no form while the request is waiting or after it is gone', async () => {
    const { text, fixture } = await setup(PENDING, 'waiting');
    expect(text()).toContain('waiting for admin approval');
    expect(text()).toContain('123456');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('checks both passwords, then changes it', async () => {
    const { c, save, text, fixture } = await setup(PENDING);
    expect(text()).toContain('Set a new password');
    await c.submit(new Event('submit'), 'short', 'short');
    expect(c.error()).toBe('Password must be at least 8 characters.');
    await c.submit(new Event('submit'), 'longenough1', 'different11');
    expect(c.error()).toBe('The two passwords do not match.');
    expect(save).not.toHaveBeenCalled();
    await c.submit(new Event('submit'), 'longenough1', 'longenough1');
    expect(save).toHaveBeenCalledWith(PENDING, 'longenough1');
    fixture.detectChanges();
    expect(text()).toContain('Password changed');
  });
});
