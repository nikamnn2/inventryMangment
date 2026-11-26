/** Purpose: request handlers for login, the "who am I" check and account activation. */
import { randomUUID } from 'node:crypto';
import { COLLECTIONS as C } from '../database/collections.js';
import { checkPassword, hashPassword, hashToken, newResetRequest, signToken } from '../services/auth.service.js';
import { passwordResetEmail } from '../services/mail.service.js';
import { isSuperAdmin, parsePassword, publicUser } from '../models/user.model.js';
import { HttpError, str } from '../utils/index.js';

/** Same message for unknown, used and expired links so nothing is leaked about which one it is. */
const BAD_LINK = 'This activation link is invalid or has expired. Ask your admin to send a new one.';

const NO_RESET = 'This password reset is not approved or has expired. Use "Forgot password?" to ask again.';

/** Compared against when there is no password to check, so the response time does not reveal which accounts exist. */
const NO_PASSWORD = hashPassword(randomUUID());

export function authController({ db, config, mailer }) {
  const users = db.collection(C.users);

  /** Finds the pending member an activation token belongs to. */
  async function pendingByToken(token) {
    const hash = typeof token === 'string' && token ? hashToken(token) : null;
    const user = hash && (await users.findOne({ activationHash: hash, status: 'pending', activationExpires: { $gt: new Date() } }));
    if (!user) throw new HttpError(404, BAD_LINK);
    return user;
  }

  /** Finds the account whose reset request was made by the browser holding `token`. */
  const resetFilter = (email, token) => ({
    email, 'resetRequest.tokenHash': hashToken(String(token ?? '')), 'resetRequest.expires': { $gt: new Date() },
  });

  /** Tells whoever can approve the request (the super admin, and the admin who added this member). */
  async function notifyApprovers(member) {
    const approvers = new Set([config.adminEmail?.toLowerCase()]);
    if (member.role !== 'admin' && member.createdBy) {
      const creator = await users.findOne({ email: member.createdBy, role: 'admin' });
      if (creator) approvers.add(creator.email);
    }
    const mail = passwordResetEmail({ name: member.name, email: member.email, link: `${config.appUrl}/members` });
    await Promise.all([...approvers].filter(Boolean).map(to => mailer.send({ to, ...mail })));
  }

  return {
    /** Checks email + password and returns a login token. Pending (not yet activated) accounts are refused. */
    async login(req, res) {
      const email = str(req.body?.email, 'Email', { required: true }).toLowerCase();
      const password = str(req.body?.password, 'Password', { required: true, max: 200 });
      const user = await users.findOne({ email });
      if (user?.status === 'pending') throw new HttpError(403, 'Your account is not activated yet. Open the activation link we emailed you.');
      // same message for unknown user and wrong password
      const matches = await checkPassword(password, user?.passwordHash ?? (await NO_PASSWORD));
      if (!user?.passwordHash || !matches) throw new HttpError(401, 'Invalid email or password.');
      // they remembered the password, so a waiting reset request is no longer needed
      if (user.resetRequest) await users.updateOne({ email }, { $unset: { resetRequest: '' } });
      res.json({ token: signToken(user, config, { remember: req.body?.remember === true }), user: publicUser(user, config) });
    },

    /** Returns the user decoded from the login token (used by the front end to restore the session). */
    me(req, res) {
      res.json(publicUser({ email: req.user.sub, name: req.user.name, role: req.user.role }, config));
    },

    /**
     * Public: "Forgot password?". Records a request for an admin to approve. The answer is the same
     * whether or not the account exists, so it cannot be used to find out who has an account.
     */
    async forgotPassword(req, res) {
      const email = str(req.body?.email, 'Email', { required: true, max: 120 }).toLowerCase();
      const { token, code, record } = newResetRequest();
      const user = await users.findOne({ email });
      // nobody is above the super admin to approve it: that password is reset on the server (npm run password)
      if (user && user.status !== 'pending' && !isSuperAdmin(email, config)) {
        await users.updateOne({ email }, { $set: { resetRequest: record } });
        // not awaited: the response time must not reveal whether an email was sent
        notifyApprovers(user).catch(err => console.error('[mail] reset notice failed:', err.message));
      }
      res.json({ token, code });
    },

    /** Public: has the admin approved the request this browser made? */
    async resetStatus(req, res) {
      const email = str(req.body?.email, 'Email', { required: true, max: 120 }).toLowerCase();
      const user = await users.findOne(resetFilter(email, req.body?.token));
      res.json({ status: !user ? 'none' : user.resetRequest.status === 'approved' ? 'approved' : 'waiting' });
    },

    /** Public: sets the new password, only for an approved request and only from the browser that asked. Single use. */
    async resetPassword(req, res) {
      const email = str(req.body?.email, 'Email', { required: true, max: 120 }).toLowerCase();
      const filter = { ...resetFilter(email, req.body?.token), 'resetRequest.status': 'approved' };
      if (!(await users.findOne(filter))) throw new HttpError(403, NO_RESET);
      const password = parsePassword(req.body?.password, { required: true });
      // changing the password also ends every older sign-in (see sessionStamp)
      const result = await users.updateOne(filter, {
        $set: { passwordHash: await hashPassword(password), passwordResetAt: new Date() },
        $unset: { resetRequest: '' },
      });
      if (!result.matchedCount) throw new HttpError(403, NO_RESET);
      res.json({ ok: true, email });
    },

    /** Public: who is this activation link for? */
    async activationInfo(req, res) {
      const user = await pendingByToken(req.params.token);
      res.json({ name: user.name, email: user.email, role: user.role });
    },

    /** Public: the member chooses their password, which activates the account. */
    async activate(req, res) {
      const user = await pendingByToken(req.body?.token);
      const password = parsePassword(req.body?.password, { required: true });
      await users.updateOne(
        { email: user.email },
        { $set: { passwordHash: await hashPassword(password), status: 'active', activatedAt: new Date() }, $unset: { activationHash: '', activationExpires: '' } },
      );
      res.json({ ok: true, email: user.email });
    },
  };
}
