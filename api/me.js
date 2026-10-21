'use strict';

const { sendJson, handleOptions, getTokenFromReq } = require('../lib/http');
const { publicUser, getSettings } = require('../lib/db');
const { getAuthUser } = require('../lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const token = getTokenFromReq(req, null);
    if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
    const auth = await getAuthUser(token);
    if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
    const user = auth.user;
    // missionReward disertakan agar frontend bisa menampilkan reward terkini
    // (endpoint publik terpisah tidak dibuat: batas 12 fungsi Vercel Hobby).
    const settings = await getSettings();
    return sendJson(res, 200, { user: publicUser(user), missionReward: settings.missionReward });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
