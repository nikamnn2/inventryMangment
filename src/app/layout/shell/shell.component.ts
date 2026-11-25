import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ROLE_LABELS } from '../../core/config/modules';
import { isMobileDevice } from '../../core/config/device';

/** One sidebar entry. `module` is the permission it needs; `mobileOnly` hides it on desktop. */
interface NavItem { path: string; label: string; icon: string; module?: string; mobileOnly?: boolean; }

/**
 * Purpose: app frame after sign-in: sidebar menu, top bar (search, notifications, sign out) and the page area.
 * It also loads all data once and shows a retry card if the API is unreachable.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly router = inject(Router);
  protected readonly data = inject(DataService);
  protected readonly auth = inject(AuthService);

  /** The sidebar menu structure. */
  protected readonly groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Workspace',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
        { path: '/products', label: 'Products', icon: 'box' },
        { path: '/bundles', label: 'Bundles', icon: 'layers' },
        { path: '/scan', label: 'Scan bundle', icon: 'layers', module: 'bundles', mobileOnly: true },
        { path: '/sales', label: 'Sales', icon: 'receipt' },
        { path: '/stock', label: 'Stock Overview', icon: 'warehouse' },
      ],
    },
    {
      title: 'Business',
      items: [
        { path: '/customers', label: 'Customers', icon: 'users' },
        { path: '/suppliers', label: 'Suppliers', icon: 'truck' },
        { path: '/reports', label: 'Reports', icon: 'chart' },
      ],
    },
    {
      title: 'System',
      items: [
        { path: '/members', label: 'Members', icon: 'users' },
        { path: '/settings', label: 'Settings', icon: 'settings' },
      ],
    },
  ];

  /** Menu groups with only the tabs this role may open; empty groups are dropped. */
  protected readonly menu = computed(() =>
    this.groups
      .map(g => ({ title: g.title, items: g.items.filter(i => (!i.mobileOnly || isMobileDevice()) && this.auth.can(i.module ?? i.path.slice(1))) }))
      .filter(g => g.items.length));

  protected readonly roleLabel = computed(() => {
    if (this.auth.user()?.superAdmin) return 'Super admin';
    const role = this.auth.user()?.role ?? '';
    return ROLE_LABELS[role] ?? role;
  });

  /** Whether the sidebar drawer is open (small screens). */
  protected readonly drawerOpen = signal(false);
  /** Name of the current page, shown in the top bar. */
  protected readonly page = signal(this.labelFor(this.router.url));

  /** Avatar letters for the signed-in user. */
  protected initials(): string {
    return (this.auth.user()?.name ?? '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  /** Retry loading the data after a failure. */
  protected reload(): void {
    void this.data.load();
  }

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) void this.data.load();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        this.page.set(this.labelFor(e.urlAfterRedirects));
        this.drawerOpen.set(false);
      });
  }

  /** Page title for a URL (used for the breadcrumb). */
  private labelFor(url: string): string {
    const path = '/' + url.split(/[?#]/)[0].split('/').filter(Boolean)[0];
    return this.groups.flatMap(g => g.items).find(i => i.path === path)?.label ?? 'Dashboard';
  }

  /** Ends the session and returns to the login page. */
  protected signOut(): void {
    this.auth.logout();
  }
}
