'use strict';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, status, obj) {
  setCors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.statusCode = 200;
    res.end('');
    return true;
  }
  return false;
}

async function readJson(req) {
  // Vercel already parses JSON body into req.body for Content-Type: application/json.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      if (req.body.trim() === '') return {};
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
  }
  // Fallback: read raw stream (local / edge cases).
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function getTokenFromReq(req, body) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  if (body && typeof body.token === 'string' && body.token) return body.token.trim();
  if (req.query && typeof req.query.token === 'string' && req.query.token) return req.query.token.trim();
  return '';
}

module.exports = { setCors, sendJson, handleOptions, readJson, getTokenFromReq };
