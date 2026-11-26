/** Purpose: request handlers for managing team members: invite (with activation e-mail), resend, activate by hand, edit role / password and delete, with the super-admin protections. */
import { COLLECTIONS as C } from '../database/collections.js';
import { hashPassword, newActivation } from '../services/auth.service.js';
import { activationEmail } from '../services/mail.service.js';
import { canSeeMember, isSuperAdmin, memberView, parseMemberUpdate, parseNewMember, parsePassword } from '../models/user.model.js';
import { HttpError } from '../utils/index.js';

const NO_SECRETS = { projection: { _id: 0, passwordHash: 0, activationHash: 0, activationExpires: 0 } };
const ONLY_SUPER = 'Only the super admin can manage admin accounts.';

export function membersController({ db, config, mailer }) {
  const users = db.collection(C.users);
  const view = (u, req) => memberView(u, config, { showAddedBy: isSuperAdmin(req.user.sub, config) });
  /** For the caller, a member they may not see simply does not exist. */
  const visible = (member, req) => canSeeMember(req.user.sub, member, config);

  /** Stores a fresh activation token for the member and emails the link. Resolves to whether the email went out. */
  async function sendActivation(member) {
    const { token, activationHash, activationExpires } = newActivation(config.activationHours);
    await users.updateOne({ email: member.email }, { $set: { status: 'pending', activationHash, activationExpires } });
    const mail = activationEmail({
      name: member.name,
      role: member.role,
      link: `${config.appUrl}/activate?token=${token}`,
      hours: config.activationHours,
    });
    return mailer.send({ to: member.email, ...mail });
  }

  return {
    /** Lists the members the caller may see: everyone for the super admin, otherwise themselves and their own employees. */
    async list(req, res) {
      const all = await users.find({}, NO_SECRETS).sort({ name: 1 }).toArray();
      res.json(all.filter(u => visible(u, req)).map(u => view(u, req)));
    },

    /** Invites a new member: stored as "pending" and an activation link is e-mailed. Only the super admin can create admins. */
    async create(req, res) {
      const member = parseNewMember(req.body);
      if (member.role === 'admin' && !isSuperAdmin(req.user.sub, config)) throw new HttpError(403, ONLY_SUPER);
      if (await users.findOne({ email: member.email })) throw new HttpError(409, `${member.email} is already registered.`);
      const doc = { ...member, status: 'pending', createdBy: req.user.sub.toLowerCase(), createdAt: new Date() };
      await users.insertOne(doc);
      const emailSent = await sendActivation(doc);
      res.status(201).json({ ...view(doc, req), emailSent });
    },

    /** Sends a new activation email to a member who has not activated yet (the old link stops working). */
    async resend(req, res) {
      const email = req.params.email.toLowerCase();
      const current = await users.findOne({ email });
      if (!current || !visible(current, req)) throw new HttpError(404, 'Member not found.');
      if (current.role === 'admin' && !isSuperAdmin(req.user.sub, config)) throw new HttpError(403, ONLY_SUPER);
      if ((current.status ?? 'active') !== 'pending') throw new HttpError(409, 'This member has already activated their account.');
      res.json({ emailSent: await sendActivation(current) });
    },

    /**
     * Activates a pending member by hand, for when the activation email does not arrive: the caller sets a
     * password and passes it on. Admins can only be activated by the super admin.
     */
    async activate(req, res) {
      const email = req.params.email.toLowerCase();
      const current = await users.findOne({ email });
      if (!current || !visible(current, req)) throw new HttpError(404, 'Member not found.');
      if (current.role === 'admin' && !isSuperAdmin(req.user.sub, config)) throw new HttpError(403, ONLY_SUPER);
      const password = parsePassword(req.body?.password, { required: true });
      // matching on "pending" means a password the member has just chosen through the link is never overwritten
      const result = await users.updateOne(
        { email, status: 'pending' },
        {
          $set: { passwordHash: await hashPassword(password), status: 'active', activatedAt: new Date(), activatedBy: req.user.sub.toLowerCase() },
          $unset: { activationHash: '', activationExpires: '' },
        },
      );
      if (!result.matchedCount) throw new HttpError(409, 'This member has already activated their account.');
      res.json(view({ ...current, status: 'active' }, req));
    },

    /** Changes a member's name, role or password (an empty password keeps the current one). */
    async update(req, res) {
      const email = req.params.email.toLowerCase();
      const { password, ...changes } = parseMemberUpdate(req.body);
      const current = await users.findOne({ email });
      if (!current || !visible(current, req)) throw new HttpError(404, 'Member not found.');

      const callerIsSuper = isSuperAdmin(req.user.sub, config);
      if (isSuperAdmin(email, config) && (changes.role !== 'admin' || !callerIsSuper)) {
        throw new HttpError(403, 'The super admin account cannot be changed by anyone else or lose admin access.');
      }
      if ((current.role === 'admin' || changes.role === 'admin') && !callerIsSuper) throw new HttpError(403, ONLY_SUPER);

      const $set = { ...changes, updatedAt: new Date() };
      if (password) $set.passwordHash = await hashPassword(password);
      await users.updateOne({ email }, { $set });
      res.json(view({ ...current, ...changes }, req));
    },

    /** Deletes a member (never yourself and never the super admin). */
    async remove(req, res) {
      const email = req.params.email.toLowerCase();
      if (email === req.user.sub) throw new HttpError(400, 'You cannot delete your own account.');
      const current = await users.findOne({ email });
      if (!current || !visible(current, req)) throw new HttpError(404, 'Member not found.');
      if (isSuperAdmin(email, config)) throw new HttpError(403, 'The super admin account cannot be deleted.');
      if (current.role === 'admin' && !isSuperAdmin(req.user.sub, config)) throw new HttpError(403, ONLY_SUPER);
      await users.deleteOne({ email });
      res.status(204).end();
    },
  };
}
