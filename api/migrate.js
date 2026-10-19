'use strict';

const { sendJson, handleOptions, readJson } = require('../lib/http');
const {
  normalizeUsername, isValidUsername, getUser, saveUser, publicUser,
  newUserRecord, TOTAL_BUTTONS,
} = require('../lib/db');
const { hashPassword, createSession, pruneSessions } = require('../lib/auth');

function asNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cleanBoolArray(v) {
  if (!Array.isArray(v)) return Array(TOTAL_BUTTONS).fill(false);
  return Array.from({ length: TOTAL_BUTTONS }, (_, i) => !!v[i]);
}

function cleanNumberArray(v) {
  if (!Array.isArray(v)) return Array(TOTAL_BUTTONS).fill(0);
  return Array.from({ length: TOTAL_BUTTONS }, (_, i) => {
    const n = Number(v[i]);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
}

function cleanWithdraws(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const w of v) {
    if (!w || typeof w !== 'object') continue;
    const amount = Number(w.amount);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const status = ['Pending', 'Disetujui', 'Ditolak'].includes(w.status) ? w.status : 'Pending';
    out.push({
      id: typeof w.id === 'string' && w.id ? String(w.id).slice(0, 100) : `legacy-${Date.now()}-${out.length}`,
      amount,
      account: typeof w.account === 'string' ? w.account.slice(0, 100) : '',
      status,
      createdAt: Number.isFinite(Number(w.createdAt)) ? Number(w.createdAt) : Date.now(),
    });
  }
  return out;
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    const legacy = body.legacy && typeof body.legacy === 'object' ? body.legacy : null;

    if (!isValidUsername(username)) return sendJson(res, 400, { error: 'Username tidak valid.' });
    if (!password) return sendJson(res, 400, { error: 'Password wajib diisi.' });
    if (!legacy) return sendJson(res, 400, { error: 'Data legacy tidak ada.' });

    const existing = await getUser(username);
    if (existing) {
      return sendJson(res, 409, { error: 'User sudah ada di server. Silakan login.' });
    }

    const balance = asNumber(legacy.balance, 0);
    if (balance < 0) return sendJson(res, 400, { error: 'Saldo legacy tidak valid.' });

    let referredBy = null;
    if (typeof legacy.referredBy === 'string' && legacy.referredBy.trim()) {
      referredBy = normalizeUsername(legacy.referredBy);
    }

    const user = newUserRecord({ username, passwordHash: hashPassword(password), referredBy });
    user.balance = balance;
    user.isBlocked = !!legacy.isBlocked;
    user.referralEarnings = Math.max(0, asNumber(legacy.referralEarnings, 0));
    user.referralBonusPaid = !!legacy.referralBonusPaid;
    user.missionCompleted = cleanBoolArray(legacy.missionCompleted);
    user.missionCooldownUntil = cleanNumberArray(legacy.missionCooldownUntil);
    user.withdrawRequests = cleanWithdraws(legacy.withdrawRequests);

    // VIP: jika legacy aktif tapi expiry sudah lewat, jadikan inactive.
    const subStatus = legacy.subStatus === 'active' ? 'active' : 'inactive';
    const subExpiry = Number.isFinite(Number(legacy.subExpiryDate)) ? Number(legacy.subExpiryDate) : null;
    if (subStatus === 'active' && subExpiry && subExpiry > Date.now()) {
      user.subStatus = 'active';
      user.subExpiryDate = subExpiry;
    } else {
      user.subStatus = 'inactive';
      user.subExpiryDate = null;
    }
    user.paymentProofName = typeof legacy.paymentProofName === 'string' ? legacy.paymentProofName.slice(0, 200) : null;
    const proofUrl = typeof legacy.paymentProofUrl === 'string' ? legacy.paymentProofUrl : null;
    user.paymentProofUrl = proofUrl && proofUrl.length <= 2 * 1024 * 1024 ? proofUrl : null;

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
