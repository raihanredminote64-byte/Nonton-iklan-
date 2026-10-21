'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { TOTAL_BUTTONS, publicUser, saveUser, getUser, getSettings } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

const COOLDOWN_MS = 30000;
const REFERRAL_BONUS = 2000;

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

    // Sistem VIP dihapus: semua tombol misi terbuka untuk semua user (kecuali diblokir/cooldown).
    const now = Date.now();
    if (!Array.isArray(user.missionCooldownUntil)) user.missionCooldownUntil = Array(TOTAL_BUTTONS).fill(0);
    if (!Array.isArray(user.missionCompleted)) user.missionCompleted = Array(TOTAL_BUTTONS).fill(false);
    const until = user.missionCooldownUntil[missionIndex] || 0;
    if (until > now) {
      const secs = Math.ceil((until - now) / 1000);
      return sendJson(res, 429, { error: `Tombol masih cooldown. Tunggu ${secs} detik lagi.` });
    }

    const settings = await getSettings();
    const reward = settings.missionReward;
    user.balance = (user.balance || 0) + reward;
    user.missionCompleted[missionIndex] = true;
    user.missionCooldownUntil[missionIndex] = now + COOLDOWN_MS;

    // Bonus referral Rp 2000 SEKALI per undangan, saat yang diundang menyelesaikan misi
    // (pengganti pemicu lama "bayar VIP", karena sistem VIP sudah dihapus).
    if (user.referredBy && !user.referralBonusPaid) {
      try {
        const referrer = await getUser(user.referredBy);
        if (referrer && !referrer.isBlocked) {
          referrer.balance = (referrer.balance || 0) + REFERRAL_BONUS;
          referrer.referralEarnings = (referrer.referralEarnings || 0) + REFERRAL_BONUS;
          await saveUser(referrer);
          user.referralBonusPaid = true;
        }
      } catch (e) { /* Kegagalan bonus tidak boleh menggagalkan misi user. */ }
    }

    await saveUser(user);
    return sendJson(res, 200, { user: publicUser(user), reward });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
