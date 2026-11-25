/** Purpose: names of the app sections (tabs) and friendly role labels shared by the menu, guards and Members page. */
/** Every tab in the app. The API decides which of these a role may open (see server/src/models/user.model.js). */
export const MODULES = ['dashboard', 'products', 'bundles', 'sales', 'stock', 'customers', 'suppliers', 'reports', 'settings', 'members'] as const;

export type Module = (typeof MODULES)[number];

export const ROLE_LABELS: Record<string, string> = { admin: 'Administrator', manager: 'Manager', accountant: 'Accountant' };
