import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Member, MembersService } from './members.service';

const member = (over: Partial<Member> = {}): Member => ({ email: 'a@b.c', name: 'A', role: 'manager', superAdmin: false, status: 'pending', ...over });
const form = { name: 'A', email: 'a@b.c', role: 'manager' as const };

describe('MembersService', () => {
  let svc: MembersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(MembersService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('loads the member list', async () => {
    const p = svc.load();
    http.expectOne('/api/members').flush([member()]);
    expect(await p).toBeNull();
    expect(svc.members().length).toBe(1);
  });

  it('reports an unreachable server', async () => {
    const p = svc.load();
    http.expectOne('/api/members').error(new ProgressEvent('error'), { status: 0 });
    expect(await p).toContain('Cannot reach the server');
  });

  it('registers a member then reloads the list', async () => {
    const p = svc.add(form);
    const req = http.expectOne('/api/members');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(form);
    req.flush({ ...member(), emailSent: true });
    await Promise.resolve();
    http.expectOne('/api/members').flush([member()]);
    expect(await p).toEqual({ error: null, emailSent: true });
  });

  it('returns the server message when registering fails', async () => {
    const p = svc.add(form);
    http.expectOne('/api/members').flush({ error: 'a@b.c is already registered.' }, { status: 409, statusText: 'Conflict' });
    expect(await p).toEqual({ error: 'a@b.c is already registered.', emailSent: false });
  });

  it('resends the activation email', async () => {
    const p = svc.resend('a@b.c');
    const req = http.expectOne('/api/members/a%40b.c/resend');
    expect(req.request.method).toBe('POST');
    req.flush({ emailSent: false });
    expect(await p).toEqual({ error: null, emailSent: false });
  });

  it('returns the error when a resend is refused', async () => {
    const p = svc.resend('a@b.c');
    http.expectOne('/api/members/a%40b.c/resend').flush({ error: 'This member has already activated their account.' }, { status: 409, statusText: 'Conflict' });
    expect((await p).error).toBe('This member has already activated their account.');
  });

  it('updates a member by email', async () => {
    const p = svc.update('a@b.c', { name: 'New', role: 'accountant', password: '' });
    const req = http.expectOne('/api/members/a%40b.c');
    expect(req.request.method).toBe('PUT');
    req.flush(member());
    await Promise.resolve();
    http.expectOne('/api/members').flush([]);
    expect(await p).toBeNull();
  });

  it('removes a member and surfaces failures', async () => {
    const ok = svc.remove('a@b.c');
    http.expectOne('/api/members/a%40b.c').flush(null, { status: 204, statusText: 'No Content' });
    await Promise.resolve();
    http.expectOne('/api/members').flush([]);
    expect(await ok).toBeNull();

    const bad = svc.remove('root@x.y');
    http.expectOne('/api/members/root%40x.y').flush({}, { status: 500, statusText: 'Error' });
    expect(await bad).toContain('Something went wrong');
  });
});
