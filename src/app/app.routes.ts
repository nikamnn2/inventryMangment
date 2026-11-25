/**
 * Purpose: URL map of the app. Public pages (login, activate) and, behind the auth guard, every page inside the app shell.
 * Each page is lazy-loaded; moduleGuard blocks tabs a role cannot open, mobileOnlyGuard keeps the camera scan page on phones.
 */
import { Routes } from '@angular/router';
import { authGuard, mobileOnlyGuard, moduleGuard } from './core/http/auth.http';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    title: 'Sign in · Invenza',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'activate',
    title: 'Activate account · Invenza',
    loadComponent: () => import('./pages/activate/activate.component').then(m => m.ActivateComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell/shell.component').then(m => m.ShellComponent),
    children: [
      { path: 'dashboard', title: 'Dashboard · Invenza', canActivate: [moduleGuard('dashboard')], loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'products', title: 'Products · Invenza', canActivate: [moduleGuard('products')], loadComponent: () => import('./pages/products/products.component').then(m => m.ProductsComponent) },
      { path: 'bundles', title: 'Bundles · Invenza', canActivate: [moduleGuard('bundles')], loadComponent: () => import('./pages/bundles/bundles.component').then(m => m.BundlesComponent) },
      { path: 'scan', title: 'Scan bundle · Invenza', canActivate: [mobileOnlyGuard, moduleGuard('bundles')], loadComponent: () => import('./pages/scan/scan.component').then(m => m.ScanComponent) },
      { path: 'sales', title: 'Sales · Invenza', canActivate: [moduleGuard('sales')], loadComponent: () => import('./pages/sales/sales.component').then(m => m.SalesComponent) },
      { path: 'stock', title: 'Stock Overview · Invenza', canActivate: [moduleGuard('stock')], loadComponent: () => import('./pages/stock/stock.component').then(m => m.StockComponent) },
      { path: 'customers', title: 'Customers · Invenza', data: { kind: 'customers' }, canActivate: [moduleGuard('customers')], loadComponent: () => import('./pages/parties/parties.component').then(m => m.PartiesComponent) },
      { path: 'suppliers', title: 'Suppliers · Invenza', data: { kind: 'suppliers' }, canActivate: [moduleGuard('suppliers')], loadComponent: () => import('./pages/parties/parties.component').then(m => m.PartiesComponent) },
      { path: 'reports', title: 'Reports · Invenza', canActivate: [moduleGuard('reports')], loadComponent: () => import('./pages/reports/reports.component').then(m => m.ReportsComponent) },
      { path: 'members', title: 'Members · Invenza', canActivate: [moduleGuard('members')], loadComponent: () => import('./pages/members/members.component').then(m => m.MembersComponent) },
      { path: 'settings', title: 'Settings · Invenza', canActivate: [moduleGuard('settings')], loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent) },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
