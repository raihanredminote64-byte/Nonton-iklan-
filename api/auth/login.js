'use strict';

const { sendJson, handleOptions, readJson } = require('../../lib/http');
const { normalizeUsername, isValidUsername, getUser, saveUser, publicUser } = require('../../lib/db');
const { verifyPassword, createSession, pruneSessions } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!isValidUsername(username)) return sendJson(res, 400, { error: 'Username tidak valid.' });
    if (!password) return sendJson(res, 400, { error: 'Password wajib diisi.' });

    const user = await getUser(username);
    if (!user) return sendJson(res, 404, { error: 'User tidak ditemukan. Silakan daftar.' });
    if (!verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: 'Password salah!' });
    }
    if (user.isBlocked) return sendJson(res, 403, { error: 'Akun diblokir.' });

    const session = createSession();
    user.sessions.push(session);
    pruneSessions(user);
    await saveUser(user);
    return sendJson(res, 200, { user: publicUser(user), token: session.token });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
