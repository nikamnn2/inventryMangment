import { Route } from '@angular/router';
import { routes } from './app.routes';

describe('app routes', () => {
  const all = (list: Route[]): Route[] => list.flatMap(r => [r, ...all(r.children ?? [])]);

  it('lazy-loads a component for every page', async () => {
    const loaders = all(routes).filter(r => r.loadComponent);
    expect(loaders.length).toBe(14); // login, activate, shell and eleven pages
    for (const r of loaders) {
      expect(await (r.loadComponent as () => Promise<unknown>)()).toBeTruthy();
    }
  });

  it('protects the shell with the auth guard', () => {
    const shell = routes.find(r => r.path === '' && r.children)!;
    expect(shell.canActivate?.length).toBe(1);
  });

  it('reuses the parties page for customers and suppliers', () => {
    const kinds = all(routes).filter(r => r.data?.['kind']).map(r => r.data!['kind']);
    expect(kinds).toEqual(['customers', 'suppliers']);
  });

  it('redirects unknown paths to the login page', () => {
    expect(routes.find(r => r.path === '**')?.redirectTo).toBe('login');
  });
});
