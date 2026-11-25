/** Purpose: request handlers for company settings (read and update); falls back to defaults when nothing is saved yet. */
import { COLLECTIONS as C } from '../database/collections.js';
import { DEFAULT_SETTINGS, SETTINGS_ID, parseSettings } from '../models/settings.model.js';

export function settingsController({ db }) {
  const settings = db.collection(C.settings);

  const read = async () => {
    const { _id, ...rest } = (await settings.findOne({ _id: SETTINGS_ID })) ?? DEFAULT_SETTINGS;
    return rest;
  };

  return {
    async get(_req, res) {
      res.json(await read());
    },

    /** Validates and saves the settings. */
    async update(req, res) {
      await settings.updateOne({ _id: SETTINGS_ID }, { $set: parseSettings(req.body) }, { upsert: true });
      res.json(await read());
    },
  };
}
