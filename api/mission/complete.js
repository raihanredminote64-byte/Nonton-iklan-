'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { TOTAL_BUTTONS, publicUser, saveUser } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

const REWARD = 60;
const COOLDOWN_MS = 30000;

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

    const missionIndex = Number(body.missionIndex);
    if (!Number.isInteger(missionIndex) || missionIndex < 0 || missionIndex >= TOTAL_BUTTONS) {
      return sendJson(res, 400, { error: 'missionIndex tidak valid.' });
    }
    if (user.isBlocked) return sendJson(res, 403, { error: 'Akun diblokir.' });

    const now = Date.now();
    if (user.subStatus !== 'active') {
      return sendJson(res, 403, { error: 'Akses terkunci. Top up VIP dulu.' });
    }
    if (user.subExpiryDate && now > user.subExpiryDate) {
      user.subStatus = 'inactive';
      user.subExpiryDate = null;
      await saveUser(user);
      return sendJson(res, 403, { error: 'VIP sudah kedaluwarsa. Perpanjang untuk membuka tombol.' });
    }

    if (!Array.isArray(user.missionCooldownUntil)) user.missionCooldownUntil = Array(TOTAL_BUTTONS).fill(0);
    if (!Array.isArray(user.missionCompleted)) user.missionCompleted = Array(TOTAL_BUTTONS).fill(false);
    const until = user.missionCooldownUntil[missionIndex] || 0;
    if (until > now) {
      const secs = Math.ceil((until - now) / 1000);
      return sendJson(res, 429, { error: `Tombol masih cooldown. Tunggu ${secs} detik lagi.` });
    }

    user.balance = (user.balance || 0) + REWARD;
    user.missionCompleted[missionIndex] = true;
    user.missionCooldownUntil[missionIndex] = now + COOLDOWN_MS;
    await saveUser(user);
    return sendJson(res, 200, { user: publicUser(user), reward: REWARD });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
