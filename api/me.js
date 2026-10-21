'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../lib/http');
const { publicUser, getSettings, saveUser, applyVerification } = require('../lib/db');
const { getAuthUser } = require('../lib/auth');

const MAX_PROOF_URL_CHARS = 2 * 1024 * 1024; // 2 MB

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    if (req.method === 'GET') {
      const token = getTokenFromReq(req, null);
      if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
      const auth = await getAuthUser(token);
      if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
      const user = auth.user;
      // missionReward disertakan agar frontend bisa menampilkan reward terkini
      // (endpoint publik terpisah tidak dibuat: batas 12 fungsi Vercel Hobby).
      const settings = await getSettings();
      return sendJson(res, 200, { user: publicUser(user), missionReward: settings.missionReward });
    }
    if (req.method === 'POST') {
      // Kirim bukti verifikasi pengguna asli (screenshot top up Rp 1.000 via DANA).
      // Validasi OTOMATIS: user langsung terverifikasi begitu bukti terkirim.
      // (Endpoint digabung di /api/me karena batas 12 fungsi Vercel Hobby.)
      const body = await readJson(req);
      const token = getTokenFromReq(req, body);
      if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
      const auth = await getAuthUser(token);
      if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
      const user = auth.user;
      if (user.isBlocked) return sendJson(res, 403, { error: 'Akun diblokir.' });
      const proofName = typeof body.proofName === 'string' ? body.proofName.trim().slice(0, 200) : '';
      const proofUrl = typeof body.proofUrl === 'string' ? body.proofUrl : '';
      if (!proofName) return sendJson(res, 400, { error: 'Nama file bukti wajib diisi.' });
      if (!proofUrl || proofUrl.length > MAX_PROOF_URL_CHARS) {
        return sendJson(res, 400, { error: 'Bukti tidak valid atau terlalu besar.' });
      }
      if (!user.isVerified) {
        user.verificationProofName = proofName;
        user.verificationProofUrl = proofUrl;
        await applyVerification(user);
      }
      await saveUser(user);
      const settings = await getSettings();
      return sendJson(res, 200, { user: publicUser(user), missionReward: settings.missionReward });
    }
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
