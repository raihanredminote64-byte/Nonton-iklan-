'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { getSettings, saveSettings, validReward } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    if (req.method === 'GET') {
      const token = getTokenFromReq(req, null);
      if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
      const auth = await getAuthUser(token);
      if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
      const settings = await getSettings();
      return sendJson(res, 200, { missionReward: settings.missionReward });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const token = getTokenFromReq(req, body);
      if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
      const auth = await getAuthUser(token);
      if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
      const reward = validReward(body.missionReward);
      if (reward === null) {
        return sendJson(res, 400, { error: 'missionReward harus bilangan bulat 0 - 1000000.' });
      }
      const saved = await saveSettings({ missionReward: reward });
      return sendJson(res, 200, { missionReward: saved.missionReward });
    }
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
