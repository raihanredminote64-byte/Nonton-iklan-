'use strict';

const { sendJson, handleOptions } = require('../lib/http');
const { getSettings } = require('../lib/db');

// Publik: frontend user perlu tahu reward saat ini untuk ditampilkan (+Rp X).
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const settings = await getSettings();
    return sendJson(res, 200, { missionReward: settings.missionReward });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
