/** Purpose: users and roles: which role can open which section, member validation and the safe views returned to the browser (never the password hash). */
import { oneOf, str } from '../utils/index.js';
import { HttpError } from '../utils/http-error.js';

/** Roles that can be assigned to a member. */
export const ROLES = ['admin', 'manager', 'accountant'];

/** Every tab (module) in the app. A module name is also what the API routes are guarded with. */
export const MODULES = ['dashboard', 'products', 'bundles', 'sales', 'stock', 'customers', 'suppliers', 'reports', 'settings', 'members'];

/**
 * Who can open which tab. This is the single place to change access: edit the lists below and the
 * API (403) and the Angular menu/routes (hidden/redirected) both follow. The manager and accountant
 * lists are a starting point until the access rules are decided. `members` (user registration)
 * is admin-only.
 */
export const ROLE_MODULES = {
  admin: MODULES,
  manager: ['dashboard', 'products', 'bundles', 'sales', 'stock', 'customers', 'suppliers', 'reports'],
  accountant: ['dashboard', 'sales', 'stock', 'customers', 'suppliers', 'reports'],
};

/** Sections the given role may open (empty for an unknown role). */
export const modulesFor = role => ROLE_MODULES[role] ?? [];
export const canAccess = (role, module) => modulesFor(role).includes(module);

/** The super admin is the account named by ADMIN_EMAIL: it is an admin that nobody can demote or delete. */
export const isSuperAdmin = (email, config) => !!email && email.toLowerCase() === config.adminEmail?.toLowerCase();

/** Who an admin sees on the Members page: everyone, except that only the super admin sees the super admin. */
export const canSeeMember = (callerEmail, member, config) =>
  isSuperAdmin(callerEmail, config) || !isSuperAdmin(member.email, config);

/**
 * Whom an admin may change. The super admin may change everyone. Any other admin only their own
 * account and the employees they registered, never other admins or other admins' employees.
 */
export const canManageMember = (callerEmail, member, config) => {
  const caller = callerEmail.toLowerCase();
  return isSuperAdmin(caller, config) || member.email === caller || (member.createdBy === caller && member.role !== 'admin');
};

/** The user details sent to the browser after login (no secrets). */
export const publicUser = (u, config) => ({
  email: u.email,
  name: u.name,
  role: u.role,
  superAdmin: isSuperAdmin(u.email, config),
  modules: modulesFor(u.role),
});

/** Simple e-mail format check. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Passwords that are tried first by anyone guessing ("aluminium" was this app's demo password). */
const COMMON_PASSWORDS = ['aluminium', 'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'admin123', 'admin@123', 'changeme123'];

/** Password rules: 8-200 characters and not a well-known password (or empty when the field is optional). */
export const parsePassword = (value, { required }) => {
  const v = typeof value === 'string' ? value : '';
  if (!v && !required) return '';
  if (v.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (v.length > 200) throw new HttpError(400, 'Password must be at most 200 characters.');
  if (COMMON_PASSWORDS.includes(v.toLowerCase())) throw new HttpError(400, 'This password is too common. Choose a different one.');
  return v;
};

/** Validates a "register member" payload. The member sets their own password through the activation link. */
export function parseNewMember(body) {
  const email = str(body?.email, 'Email', { required: true, max: 120 }).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return {
    name: str(body?.name, 'Name', { required: true, max: 80 }),
    email,
    role: oneOf(body?.role, 'Role', ROLES),
  };
}

/** Validates an "edit member" payload; an empty password means "keep the current one". */
export function parseMemberUpdate(body) {
  return {
    name: str(body?.name, 'Name', { required: true, max: 80 }),
    role: oneOf(body?.role, 'Role', ROLES),
    password: parsePassword(body?.password, { required: false }),
  };
}

/**
 * A member as shown in the Members list (no password or activation data). Only the super admin is
 * told who added the member, because that address can be the otherwise hidden super admin.
 */
export const memberView = (u, config, { showAddedBy = false } = {}) => ({
  email: u.email,
  name: u.name,
  role: u.role,
  superAdmin: isSuperAdmin(u.email, config),
  status: u.status ?? 'active',
  createdAt: u.createdAt,
  ...(showAddedBy && { addedBy: u.createdBy ?? null }),
});
