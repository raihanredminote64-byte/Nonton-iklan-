'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { normalizeUsername, getUser, saveUser, publicUser } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const body = await readJson(req);
    const token = getTokenFromReq(req, body);
    if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
    const auth = await getAuthUser(token);
    if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });

    const username = normalizeUsername(body.username);
    const withdrawId = typeof body.withdrawId === 'string' ? body.withdrawId : '';
    const status = typeof body.status === 'string' ? body.status : '';
    if (!username) return sendJson(res, 400, { error: 'Username wajib diisi.' });
    if (!withdrawId) return sendJson(res, 400, { error: 'withdrawId wajib diisi.' });
    if (status !== 'Disetujui' && status !== 'Ditolak') {
      return sendJson(res, 400, { error: 'Status harus Disetujui atau Ditolak.' });
    }

    const user = await getUser(username);
    if (!user) return sendJson(res, 404, { error: 'User tidak ditemukan.' });
    if (!Array.isArray(user.withdrawRequests)) user.withdrawRequests = [];
    const wd = user.withdrawRequests.find((w) => w && w.id === withdrawId);
    if (!wd) return sendJson(res, 404, { error: 'Withdraw tidak ditemukan.' });
    if (wd.status !== 'Pending') {
      return sendJson(res, 400, { error: 'Withdraw sudah diproses sebelumnya.' });
    }

    wd.status = status;
    // Refund: satu-satunya penambahan saldo selain misi (+60) dan bonus referral (+2000).
    if (status === 'Ditolak') {
      user.balance = (user.balance || 0) + (wd.amount || 0);
    }
    await saveUser(user);
    return sendJson(res, 200, { user: publicUser(user), withdraw: wd });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
