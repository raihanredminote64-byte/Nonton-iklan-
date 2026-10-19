'use strict';
const crypto = require('crypto');
function getKey() {
  const hex = process.env.DB_ENCRYPTION_KEY;
  if (!hex) { const e = new Error('Database encryption key belum dikonfigurasi (DB_ENCRYPTION_KEY tidak ada).'); e.status = 500; throw e; }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) { const e = new Error('DB_ENCRYPTION_KEY harus 32 byte (64 hex).'); e.status = 500; throw e; }
  return key;
}
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decrypt(b64) {
  const key = getKey();
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 28) throw new Error('Data terenkripsi tidak valid.');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
module.exports = { encrypt, decrypt };
