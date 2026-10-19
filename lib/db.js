'use strict';

const { put, list } = require('@vercel/blob');
const { encrypt, decrypt } = require('./crypto');

const TOTAL_BUTTONS = 10;
const DEFAULT_LINKS = Array(TOTAL_BUTTONS).fill('https://sfl.gl/gMmpBje');
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

function getBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    const err = new Error('Database belum dikonfigurasi (BLOB_READ_WRITE_TOKEN tidak ada).');
    err.status = 500;
    throw err;
  }
  return token;
}

function normalizeUsername(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

function isValidUsername(normalized) {
  return USERNAME_RE.test(normalized);
}

function userPath(normalizedUsername) {
  return `users/${normalizedUsername}.json`;
}

async function getBlobText(pathname) {
  const token = getBlobToken();
  const res = await list({ prefix: pathname, limit: 10, token });
  const blob = (res.blobs || []).find((b) => b.pathname === pathname) || (res.blobs || [])[0];
  if (!blob) return null;
  const downloadUrl = blob.downloadUrl || blob.url;
  // Private blobs: fetch with token auth. Try signed downloadUrl first.
  let r = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok && blob.url && blob.url !== downloadUrl) {
    r = await fetch(blob.url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!r.ok) {
    const err = new Error('Gagal membaca data dari database.');
    err.status = 500;
    throw err;
  }
  const raw = await r.text();
  try { return decrypt(raw); }
  catch (e) { return raw; }
}

async function putBlobJson(pathname, obj) {
  const token = getBlobToken();
  // Store harus PUBLIC (nontoniklan-db-pub2) agar SDK put() bisa menulis.
  // Isi dienkripsi AES-256-GCM (DB_ENCRYPTION_KEY) sehingga URL publik
  // hanya berisi ciphertext, tidak bisa dibaca tanpa kunci server.
  const ciphertext = encrypt(JSON.stringify(obj));
  await put(pathname, ciphertext, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'text/plain',
    allowOverwrite: true,
    token,
  });
}

async function getUser(normalizedUsername) {
  if (!isValidUsername(normalizedUsername)) return null;
  const text = await getBlobText(userPath(normalizedUsername));
  if (!text) return null;
  try {
    const user = JSON.parse(text);
    if (!user || user.username !== normalizedUsername) return null;
    return user;
  } catch (e) {
    return null;
  }
}

async function saveUser(user) {
  user.updatedAt = Date.now();
  await putBlobJson(userPath(user.username), user);
  return user;
}

async function listUsers() {
  const token = getBlobToken();
  const users = [];
  let cursor;
  do {
    const res = await list({ prefix: 'users/', limit: 1000, cursor, token });
    const blobs = res.blobs || [];
    for (const blob of blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      try {
        let r = await fetch(blob.downloadUrl || blob.url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok && blob.url) {
          r = await fetch(blob.url, { headers: { Authorization: `Bearer ${token}` } });
        }
        if (!r.ok) continue;
        let rawText = await r.text();
        try { rawText = decrypt(rawText); } catch (e) { /* legacy plaintext, pakai apa adanya */ }
        const user = JSON.parse(rawText);
        if (user && typeof user.username === 'string') users.push(user);
      } catch (e) {
        // Skip corrupt record, continue with others.
      }
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return users;
}

async function getLinks() {
  const text = await getBlobText('config/links.json');
  if (!text) return [...DEFAULT_LINKS];
  try {
    const parsed = JSON.parse(text);
    const links = Array.isArray(parsed) ? parsed : parsed.links;
    if (!Array.isArray(links) || links.length !== TOTAL_BUTTONS) return [...DEFAULT_LINKS];
    return links.map((l) => (typeof l === 'string' && l.trim() ? l.trim() : DEFAULT_LINKS[0]));
  } catch (e) {
    return [...DEFAULT_LINKS];
  }
}

async function saveLinks(links) {
  await putBlobJson('config/links.json', { links, updatedAt: Date.now() });
  return links;
}

function publicUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    balance: user.balance || 0,
    isBlocked: !!user.isBlocked,
    subStatus: user.subStatus || 'inactive',
    subExpiryDate: user.subExpiryDate || null,
    paymentProofName: user.paymentProofName || null,
    paymentProofUrl: user.paymentProofUrl || null,
    missionCompleted: Array.isArray(user.missionCompleted) ? user.missionCompleted : Array(TOTAL_BUTTONS).fill(false),
    missionCooldownUntil: Array.isArray(user.missionCooldownUntil) ? user.missionCooldownUntil : Array(TOTAL_BUTTONS).fill(0),
    referredBy: user.referredBy || null,
    referralEarnings: user.referralEarnings || 0,
    referralBonusPaid: !!user.referralBonusPaid,
    withdrawRequests: Array.isArray(user.withdrawRequests) ? user.withdrawRequests : [],
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function isVipActive(user, nowMs) {
  const now = nowMs || Date.now();
  return !!user && user.subStatus === 'active' && user.subExpiryDate && now < user.subExpiryDate;
}

function newUserRecord({ username, passwordHash, referredBy }) {
  const now = Date.now();
  return {
    username,
    passwordHash,
    balance: 0,
    isBlocked: false,
    subStatus: 'inactive',
    subExpiryDate: null,
    paymentProofName: null,
    paymentProofUrl: null,
    missionCompleted: Array(TOTAL_BUTTONS).fill(false),
    missionCooldownUntil: Array(TOTAL_BUTTONS).fill(0),
    referredBy: referredBy || null,
    referralEarnings: 0,
    referralBonusPaid: false,
    withdrawRequests: [],
    sessions: [],
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = {
  TOTAL_BUTTONS,
  DEFAULT_LINKS,
  normalizeUsername,
  isValidUsername,
  getUser,
  saveUser,
  listUsers,
  getLinks,
  saveLinks,
  publicUser,
  isVipActive,
  newUserRecord,
};
