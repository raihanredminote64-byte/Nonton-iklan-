'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { publicUser, saveUser, getUser } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const REFERRAL_BONUS = 2000;
const MAX_PROOF_URL_CHARS = 2 * 1024 * 1024; // 2 MB

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

    const proofName = typeof body.proofName === 'string' ? body.proofName.trim().slice(0, 200) : '';
    const proofUrl = typeof body.proofUrl === 'string' ? body.proofUrl : '';
    if (!proofName) return sendJson(res, 400, { error: 'Nama file bukti wajib diisi.' });
    if (!proofUrl || proofUrl.length > MAX_PROOF_URL_CHARS) {
      return sendJson(res, 400, { error: 'Bukti pembayaran tidak valid atau terlalu besar.' });
    }
    if (user.isBlocked) return sendJson(res, 403, { error: 'Akun diblokir.' });

    const now = Date.now();
    if (user.subStatus === 'active' && user.subExpiryDate && user.subExpiryDate > now) {
      user.subExpiryDate = user.subExpiryDate + SEVEN_DAYS_MS;
    } else {
      user.subStatus = 'active';
      user.subExpiryDate = now + SEVEN_DAYS_MS;
    }
    user.paymentProofName = proofName;
    user.paymentProofUrl = proofUrl;

    // Bonus referral Rp 2000 SEKALI per undangan, saat pertama kali yang diundang bayar buka kunci.
    if (user.referredBy && !user.referralBonusPaid) {
      const referrer = await getUser(user.referredBy);
      if (referrer && !referrer.isBlocked) {
        referrer.balance = (referrer.balance || 0) + REFERRAL_BONUS;
        referrer.referralEarnings = (referrer.referralEarnings || 0) + REFERRAL_BONUS;
        await saveUser(referrer);
        user.referralBonusPaid = true;
      }
      // Jika referrer tidak ada / diblokir: jangan set referralBonusPaid, agar bisa
      // dibayar nanti bila referrer tersedia. (Tidak mengubah user.referralBonusPaid.)
    }

    await saveUser(user);
    return sendJson(res, 200, { user: publicUser(user) });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
