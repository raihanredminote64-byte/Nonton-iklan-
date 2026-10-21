'use strict';

// Misi Manual (misi klik): dibuat admin (resmi) atau user (dipotong saldo).
// Alur user: buka link misi -> upload screenshot hasil -> TERVERIFIKASI OTOMATIS
// (langsung dibayar dari budget misi). Admin mengawasi & bisa menggagalkan
// pengiriman curang dari dashboard (saldo otomatis dipotong balik di sana).
const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../lib/http');
const {
  publicUser, saveUser, getMissions, saveMissions, getSubmissions, saveSubmissions,
  missionPlan, makeId, MISSION_FEE_PERCENT,
} = require('../lib/db');
const { getAuthUser } = require('../lib/auth');

const MAX_IMAGE_CHARS = 2 * 1024 * 1024; // 2 MB

function validHttpUrl(s) {
  try {
    const u = new URL(String(s || ''));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function publicMission(m) {
  return {
    id: m.id,
    creator: m.creator,
    isOfficial: m.creator === 'ADMIN',
    title: m.title,
    description: m.description || '',
    photoUrl: m.photoUrl || null,
    link: m.link,
    reward: m.reward,
    budgetTotal: m.budgetTotal,
    fee: m.fee,
    clicksTotal: m.clicksTotal,
    clicksLeft: m.clicksLeft,
    status: m.status,
    createdAt: m.createdAt,
  };
}

function parseMissionInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
  const link = typeof body.link === 'string' ? body.link.trim().slice(0, 1000) : '';
  const photoUrl = typeof body.photoUrl === 'string' && body.photoUrl.length <= MAX_IMAGE_CHARS ? body.photoUrl : null;
  if (!title) return { error: 'Nama misi wajib diisi.' };
  if (!validHttpUrl(link)) return { error: 'Link misi tidak valid (harus http/https).' };
  const plan = missionPlan(body.budget, body.reward);
  if (!plan) {
    return { error: 'Total biaya / profit per misi tidak valid: setelah biaya ' + MISSION_FEE_PERCENT + '%, budget tidak cukup untuk minimal 1 klik.' };
  }
  return { title, description, link, photoUrl, plan, budget: Number(body.budget), reward: Number(body.reward) };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    const token = getTokenFromReq(req, body);
    if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
    const auth = await getAuthUser(token);
    if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
    const user = auth.user;

    if (req.method === 'GET') {
      const missions = await getMissions();
      const submissions = await getSubmissions();
      const active = missions
        .filter((m) => m.status === 'active')
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(publicMission);
      const myMissions = missions
        .filter((m) => m.creator === user.username)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(publicMission);
      const mySubmissions = {};
      submissions.forEach((s) => {
        if (s.username === user.username) mySubmissions[s.missionId] = s.status;
      });
      // Statistik pemantauan untuk misi buatan sendiri: jumlah klik per jam (WIB).
      const myMissionHours = {};
      myMissions.forEach((m) => { myMissionHours[m.id] = Array(24).fill(0); });
      submissions.forEach((s) => {
        if (s.status === 'approved' && myMissionHours[s.missionId]) {
          const hourWib = new Date((s.createdAt || 0) + 7 * 3600 * 1000).getUTCHours();
          myMissionHours[s.missionId][hourWib] += 1;
        }
      });
      return sendJson(res, 200, { missions: active, myMissions, mySubmissions, myMissionHours, feePercent: MISSION_FEE_PERCENT });
    }

    if (req.method === 'POST') {
      if (user.isBlocked) return sendJson(res, 403, { error: 'Akun diblokir.' });

      if (body.action === 'create') {
        if (!user.isVerified) {
          return sendJson(res, 403, { error: 'Akun belum terverifikasi. Verifikasi dulu untuk membuat misi.' });
        }
        const input = parseMissionInput(body);
        if (input.error) return sendJson(res, 400, { error: input.error });
        if ((user.balance || 0) < input.budget) {
          return sendJson(res, 400, { error: 'Saldo tidak cukup. Saldo kamu Rp ' + (user.balance || 0).toLocaleString('id-ID') + ', total biaya Rp ' + input.budget.toLocaleString('id-ID') + '.' });
        }
        user.balance -= input.budget;
        await saveUser(user);
        const missions = await getMissions();
        const mission = {
          id: makeId('mm'),
          creator: user.username,
          title: input.title,
          description: input.description,
          photoUrl: input.photoUrl,
          link: input.link,
          reward: input.reward,
          budgetTotal: input.budget,
          fee: input.plan.fee,
          clicksTotal: input.plan.clicks,
          clicksLeft: input.plan.clicks,
          status: 'active',
          createdAt: Date.now(),
        };
        missions.push(mission);
        await saveMissions(missions);
        return sendJson(res, 200, { user: publicUser(user), mission: publicMission(mission), plan: input.plan });
      }

      if (body.action === 'submit') {
        if (!user.isVerified) {
          return sendJson(res, 403, { error: 'Akun belum terverifikasi. Verifikasi dulu untuk mengerjakan misi.' });
        }
        const proofName = typeof body.proofName === 'string' ? body.proofName.trim().slice(0, 200) : '';
        const proofUrl = typeof body.proofUrl === 'string' ? body.proofUrl : '';
        if (!proofName || !proofUrl || proofUrl.length > MAX_IMAGE_CHARS) {
          return sendJson(res, 400, { error: 'Screenshot hasil wajib diupload.' });
        }
        const missions = await getMissions();
        const mission = missions.find((m) => m.id === body.missionId);
        if (!mission) return sendJson(res, 404, { error: 'Misi tidak ditemukan.' });
        if (mission.creator === user.username) {
          return sendJson(res, 400, { error: 'Tidak bisa mengerjakan misi sendiri.' });
        }
        if (mission.status !== 'active' || (mission.clicksLeft || 0) < 1) {
          return sendJson(res, 400, { error: 'Misi sudah habis / tidak aktif.' });
        }
        const submissions = await getSubmissions();
        if (submissions.some((s) => s.missionId === mission.id && s.username === user.username)) {
          return sendJson(res, 409, { error: 'Kamu sudah mengirim misi ini (1x per user).' });
        }
        // Verifikasi OTOMATIS: langsung disetujui & dibayar dari budget misi.
        user.balance = (user.balance || 0) + mission.reward;
        mission.clicksLeft -= 1;
        if (mission.clicksLeft <= 0) mission.status = 'habis';
        const submission = {
          id: makeId('ms'),
          missionId: mission.id,
          missionTitle: mission.title,
          username: user.username,
          proofName,
          proofUrl,
          reward: mission.reward,
          status: 'approved',
          createdAt: Date.now(),
        };
        submissions.push(submission);
        await saveSubmissions(submissions);
        await saveMissions(missions);
        await saveUser(user);
        return sendJson(res, 200, { user: publicUser(user), submission, mission: publicMission(mission) });
      }

      return sendJson(res, 400, { error: 'action tidak dikenal.' });
    }

    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};

// Dipakai api/admin/settings.js untuk membuat misi resmi (creator ADMIN).
module.exports.parseMissionInput = parseMissionInput;
module.exports.publicMission = publicMission;
