/** Purpose: request handlers for login, the "who am I" check and account activation. */
import { randomUUID } from 'node:crypto';
import { COLLECTIONS as C } from '../database/collections.js';
import { checkPassword, hashPassword, hashToken, signToken } from '../services/auth.service.js';
import { parsePassword, publicUser } from '../models/user.model.js';
import { HttpError, str } from '../utils/index.js';

/** Same message for unknown, used and expired links so nothing is leaked about which one it is. */
const BAD_LINK = 'This activation link is invalid or has expired. Ask your admin to send a new one.';

/** Compared against when there is no password to check, so the response time does not reveal which accounts exist. */
const NO_PASSWORD = hashPassword(randomUUID());

export function authController({ db, config }) {
  const users = db.collection(C.users);

  /** Finds the pending member an activation token belongs to. */
  async function pendingByToken(token) {
    const hash = typeof token === 'string' && token ? hashToken(token) : null;
    const user = hash && (await users.findOne({ activationHash: hash, status: 'pending', activationExpires: { $gt: new Date() } }));
    if (!user) throw new HttpError(404, BAD_LINK);
    return user;
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
      res.json({ token: signToken(user, config), user: publicUser(user, config) });
    },

    /** Returns the user decoded from the login token (used by the front end to restore the session). */
    me(req, res) {
      res.json(publicUser({ email: req.user.sub, name: req.user.name, role: req.user.role }, config));
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
