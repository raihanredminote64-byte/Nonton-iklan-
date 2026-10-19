'use strict';

const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const { TOTAL_BUTTONS, DEFAULT_LINKS, getLinks, saveLinks } = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');

function validLinks(links) {
  if (!Array.isArray(links) || links.length !== TOTAL_BUTTONS) return null;
  const cleaned = [];
  for (const l of links) {
    if (typeof l !== 'string') return null;
    const t = l.trim();
    if (!t || t.length > 500 || !/^https?:\/\//i.test(t)) return null;
    cleaned.push(t);
  }
  return cleaned;
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    if (req.method === 'GET') {
      // GET publik: link tombol memang ditampilkan ke semua user yang login.
      const links = await getLinks();
      return sendJson(res, 200, { links });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const token = getTokenFromReq(req, body);
      if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
      const auth = await getAuthUser(token);
      if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
      const links = validLinks(body.links);
      if (!links) {
        return sendJson(res, 400, { error: `links harus array ${TOTAL_BUTTONS} URL (http/https).` });
      }
      await saveLinks(links);
      return sendJson(res, 200, { links });
    }
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};

// Default export guard: DEFAULT_LINKS dipakai fallback di db.js, bukan di sini.
void DEFAULT_LINKS;
