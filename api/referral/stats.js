'use strict';

const { sendJson, handleOptions, getTokenFromReq } = require('../../lib/http');
const { listUsers, isVipActive } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const token = getTokenFromReq(req, null);
    if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
    const auth = await getAuthUser(token);
    if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
    const user = auth.user;
    const users = await listUsers();
    const mine = users.filter((u) => u.referredBy === user.username);
    const now = Date.now();
    const activeVIP = mine.filter((u) => isVipActive(u, now)).length;
    return sendJson(res, 200, {
      total: mine.length,
      activeVIP,
      earnings: user.referralEarnings || 0,
      referredBy: user.referredBy || null,
    });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
