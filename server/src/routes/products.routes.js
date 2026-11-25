/** Purpose: URLs for the product catalogue (list/search, get one, create, edit) keyed by Die No. */
import { Router } from 'express';
import { productsController } from '../controllers/products.controller.js';
import { wrap } from '../utils/index.js';

export default function productRoutes(ctx) {
  const c = productsController(ctx);
  const r = Router();
  r.get('/', wrap(c.list));
  r.get('/:dieNo', wrap(c.get));
  r.post('/', wrap(c.create));
  r.put('/:dieNo', wrap(c.update));
  return r;
}
