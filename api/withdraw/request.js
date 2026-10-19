'use strict';

const crypto = require('crypto');
const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { publicUser, saveUser } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

const MIN_WITHDRAW = 100000;

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const body = await readJson(req);
    const token = getTokenFromReq(req, body);
    if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
    const auth = await getAuthUser(token);
    if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
    const user = auth.user;

    const amount = Number(body.amount);
    const account = typeof body.account === 'string' ? body.account.trim().slice(0, 100) : '';
    if (!Number.isInteger(amount) || amount < MIN_WITHDRAW) {
      return sendJson(res, 400, { error: 'Minimal penarikan Rp 100.000.' });
    }
    if (!account) return sendJson(res, 400, { error: 'Nomor rekening / E-Wallet wajib diisi.' });
    if (user.isBlocked) return sendJson(res, 403, { error: 'Akun diblokir.' });
    if (amount > (user.balance || 0)) {
      return sendJson(res, 400, { error: 'Saldo tidak cukup.' });
    }

    // SATU-SATUNYA tempat saldo berkurang (kecuali refund saat admin menolak withdraw).
    user.balance = (user.balance || 0) - amount;
    if (!Array.isArray(user.withdrawRequests)) user.withdrawRequests = [];
    const withdraw = {
      id: crypto.randomBytes(8).toString('hex'),
      amount,
      account,
      status: 'Pending',
      createdAt: Date.now(),
    };
    user.withdrawRequests.push(withdraw);
    await saveUser(user);
    return sendJson(res, 200, { user: publicUser(user), withdraw });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
