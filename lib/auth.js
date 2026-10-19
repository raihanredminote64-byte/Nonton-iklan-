'use strict';

const crypto = require('crypto');
const { listUsers } = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, 64);
  } catch (e) {
    return false;
  }
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

function createSession() {
  return {
    token: crypto.randomBytes(32).toString('hex'),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

function pruneSessions(user) {
  const now = Date.now();
  if (!Array.isArray(user.sessions)) user.sessions = [];
  user.sessions = user.sessions.filter((s) => s && s.expiresAt && s.expiresAt > now);
  // Batasi maksimal 10 sesi aktif per user.
  if (user.sessions.length > 10) user.sessions = user.sessions.slice(-10);
}

// Cari user dari token (scan semua user; cukup untuk skala kecil).
// Mengembalikan { user, session } atau null.
async function getAuthUser(token) {
  if (!token || typeof token !== 'string') return null;
  const users = await listUsers();
  const now = Date.now();
  for (const user of users) {
    if (!Array.isArray(user.sessions)) continue;
    const session = user.sessions.find((s) => s && s.token === token && s.expiresAt && s.expiresAt > now);
    if (session) return { user, session };
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, createSession, pruneSessions, getAuthUser, SESSION_TTL_MS };
