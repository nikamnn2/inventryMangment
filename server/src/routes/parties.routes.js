import { Router } from 'express';
import { partiesController } from '../controllers/parties.controller.js';
import { wrap } from '../utils/index.js';

/** Customers and suppliers share the same routes; `collection` picks which one. */
export default function partyRoutes(db, collection) {
  const c = partiesController(db, collection);
  const r = Router();
  r.get('/', wrap(c.list));
  r.post('/', wrap(c.create));
  return r;
}
