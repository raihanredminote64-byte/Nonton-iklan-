'use strict';

const { sendJson, handleOptions, readJson } = require('../../lib/http');
const { normalizeUsername, isValidUsername, getUser, saveUser, publicUser, newUserRecord } = require('../../lib/db');
const { hashPassword, createSession, pruneSessions } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    const refCode = normalizeUsername(body.refCode || body.ref || '');

    if (!isValidUsername(username)) {
      return sendJson(res, 400, { error: 'Username harus 3-30 karakter, hanya huruf kecil, angka, titik, underscore, dan strip.' });
    }
    if (!password || password.length < 4) {
      return sendJson(res, 400, { error: 'Password minimal 4 karakter.' });
    }

    const existing = await getUser(username);
    if (existing) return sendJson(res, 409, { error: 'Username sudah dipakai. Silakan login atau pilih username lain.' });

    let referredBy = null;
    if (refCode && refCode !== username) {
      const referrer = await getUser(refCode);
      if (referrer) referredBy = refCode;
    }

    const user = newUserRecord({ username, passwordHash: hashPassword(password), referredBy });
    const session = createSession();
    user.sessions.push(session);
    pruneSessions(user);
    await saveUser(user);
    return sendJson(res, 201, { user: publicUser(user), token: session.token });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
