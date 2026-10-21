'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { normalizeUsername, getUser, saveUser, publicUser, applyVerification } = require('../../lib/db');
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
    if (!username) return sendJson(res, 400, { error: 'Username wajib diisi.' });
    const target = await getUser(username);
    if (!target) return sendJson(res, 404, { error: 'User tidak ditemukan.' });
    // Hanya ubah field yang dikirim agar toggle verifikasi tidak mengutak-atik status blokir (dan sebaliknya).
    if (typeof body.blocked === 'boolean') target.isBlocked = body.blocked;
    if (typeof body.verified === 'boolean') {
      if (body.verified && !target.isVerified) {
        await applyVerification(target);
      } else if (!body.verified) {
        target.isVerified = false;
        target.verifiedAt = null;
      }
    }
    await saveUser(target);
    return sendJson(res, 200, { user: publicUser(target) });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
