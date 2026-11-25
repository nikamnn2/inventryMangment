/** Purpose: request handlers for customers and suppliers (list and add). */
import { parseParty } from '../models/party.model.js';

/** Customers and suppliers share the same simple shape; `collection` picks which one. */
export function partiesController(db, collection) {
  const col = db.collection(collection);

  return {
    async list(_req, res) {
      res.json(await col.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray());
    },

    async create(req, res) {
      const doc = parseParty(req.body);
      await col.insertOne({ ...doc });
      res.status(201).json(doc);
    },
  };
}
