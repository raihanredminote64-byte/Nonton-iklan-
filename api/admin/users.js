'use strict';

const { sendJson, handleOptions, getTokenFromReq } = require('../../lib/http');
const { listUsers, publicUser } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

// Catatan: sama seperti sebelumnya, halaman admin tidak punya login khusus —
// token user apapun yang valid bisa membuka daftar admin. Rekomendasi:
// tambah ADMIN_KEY / peran admin di iterasi berikutnya (lihat BUILD_NOTES.md).
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const token = getTokenFromReq(req, null);
    if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
    const auth = await getAuthUser(token);
    if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
    const users = await listUsers();
    return sendJson(res, 200, { users: users.map(publicUser) });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
