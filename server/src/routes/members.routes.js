/** Purpose: URLs for registering and managing team members (admin only): list, invite, resend activation, activate by hand, edit, delete. */
import { Router } from 'express';
import { membersController } from '../controllers/members.controller.js';
import { wrap } from '../utils/index.js';

export default function memberRoutes(ctx) {
  const c = membersController(ctx);
  const r = Router();
  r.get('/', wrap(c.list));
  r.post('/', wrap(c.create));
  r.post('/:email/resend', wrap(c.resend));
  r.post('/:email/activate', wrap(c.activate));
  r.post('/:email/reset/approve', wrap(c.approveReset));
  r.post('/:email/reset/reject', wrap(c.rejectReset));
  r.put('/:email', wrap(c.update));
  r.delete('/:email', wrap(c.remove));
  return r;
}
