import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { baseProviders } from '../../testing/fixtures';
import { ActivateComponent } from './activate.component';

const INFO = { name: 'Asha Rao', email: 'asha@x.y', role: 'accountant' };

async function create(token: string | null) {
    TestBed.configureTestingModule({
        imports: [ActivateComponent],
        providers: [...baseProviders(), { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } } }],
    });
    const auth = TestBed.inject(AuthService);
    const fixture = TestBed.createComponent(ActivateComponent);
    return { auth, fixture, c: fixture.componentInstance as any };
}

describe('ActivateComponent', () => {
    it('greets the invited member when the link is valid', async () => {
        const { auth, fixture } = await create('tok');
        vi.spyOn(auth, 'activationInfo').mockResolvedValue(INFO);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const text = fixture.nativeElement.textContent;
        expect(auth.activationInfo).toHaveBeenCalledWith('tok');
        expect(text).toContain('Welcome, Asha Rao');
        expect(text).toContain('asha@x.y');
    });

    it('explains a bad or expired link', async () => {
        const { auth, fixture } = await create('old');
        vi.spyOn(auth, 'activationInfo').mockResolvedValue('This activation link is invalid or has expired.');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Link not valid');
        expect(fixture.nativeElement.textContent).toContain('invalid or has expired');
    });

    it('does not call the API when the link has no token', async () => {
        const { auth, fixture, c } = await create(null);
        const info = vi.spyOn(auth, 'activationInfo');
        fixture.detectChanges();
        await fixture.whenStable();
        expect(info).not.toHaveBeenCalled();
        expect(c.linkError()).toContain('incomplete');
    });

    describe('choosing a password', () => {
        async function ready() {
            const ctx = await create('tok');
            vi.spyOn(ctx.auth, 'activationInfo').mockResolvedValue(INFO);
            ctx.fixture.detectChanges();
            await ctx.fixture.whenStable();
            return ctx;
        }

        it('rejects a short password and a mismatch without calling the API', async () => {
            const { auth, c } = await ready();
            const activate = vi.spyOn(auth, 'activate');
            await c.submit(new Event('submit'), 'short', 'short');
            expect(c.error()).toBe('Password must be at least 8 characters.');
            await c.submit(new Event('submit'), 'longenough1', 'different123');
            expect(c.error()).toBe('The two passwords do not match.');
            expect(activate).not.toHaveBeenCalled();
        });

        it('shows the server error', async () => {
            const { auth, c } = await ready();
            vi.spyOn(auth, 'activate').mockResolvedValue('This activation link is invalid or has expired.');
            await c.submit(new Event('submit'), 'longenough1', 'longenough1');
            expect(c.error()).toContain('invalid or has expired');
            expect(c.done()).toBe(false);
            expect(c.saving()).toBe(false);
        });

        it('activates and points to the sign-in page', async () => {
            const { auth, fixture, c } = await ready();
            const activate = vi.spyOn(auth, 'activate').mockResolvedValue(null);
            await c.submit(new Event('submit'), 'longenough1', 'longenough1');
            fixture.detectChanges();
            expect(activate).toHaveBeenCalledWith('tok', 'longenough1');
            expect(fixture.nativeElement.textContent).toContain('Account activated');
        });

        it('can show and hide the password', async () => {
            const { fixture, c } = await ready();
            fixture.detectChanges();
            const input = fixture.nativeElement.querySelector('#pw') as HTMLInputElement;
            expect(input.type).toBe('password');
            c.showPassword.set(true);
            fixture.detectChanges();
            expect(input.type).toBe('text');
        });
    });
});
