'use strict';

// Dashboard admin: reward iklan + MISI MANUAL (buat misi resmi, awasi pengiriman,
// gagalkan yang curang). Semua digabung di endpoint ini karena batas 12 fungsi
// Vercel Hobby.
const { sendJson, handleOptions, readJson, getTokenFromReq } = require('../../lib/http');
const {
  getSettings, saveSettings, validReward,
  getMissions, saveMissions, getSubmissions, saveSubmissions, getUser, saveUser, makeId,
} = require('../../lib/db');
const { getAuthUser } = require('../../lib/auth');
const { parseMissionInput, publicMission } = require('../missions');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    if (req.method === 'GET') {
      const token = getTokenFromReq(req, null);
      if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
      const auth = await getAuthUser(token);
      if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });
      const settings = await getSettings();
      const missions = (await getMissions())
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(publicMission);
      const submissions = (await getSubmissions())
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return sendJson(res, 200, { missionReward: settings.missionReward, missions, submissions });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const token = getTokenFromReq(req, body);
      if (!token) return sendJson(res, 401, { error: 'Token tidak ada. Silakan login.' });
      const auth = await getAuthUser(token);
      if (!auth) return sendJson(res, 401, { error: 'Sesi tidak valid. Silakan login lagi.' });

      // Buat misi manual RESMI (creator ADMIN, tanpa potong saldo).
      if (body.action === 'createMission') {
        const input = parseMissionInput(body);
        if (input.error) return sendJson(res, 400, { error: input.error });
        const missions = await getMissions();
        const mission = {
          id: makeId('mm'),
          creator: 'ADMIN',
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
        return sendJson(res, 200, { mission: publicMission(mission), plan: input.plan });
      }

      // Atur ulang misi manual: ubah isi/link/profit/total biaya/status.
      // Klik yang sudah terpakai dihitung dari data lama; sisa klik dihitung ulang
      // dari budget bersih baru dikurangi reward yang sudah dibayarkan. Selisih
      // total biaya misi user dipotong dari / dikembalikan ke saldo pembuat.
      if (body.action === 'updateMission') {
        const missions = await getMissions();
        const mission = missions.find((m) => m.id === body.missionId);
        if (!mission) return sendJson(res, 404, { error: 'Misi tidak ditemukan.' });
        const input = parseMissionInput(body);
        if (input.error) return sendJson(res, 400, { error: input.error });

        const usedClicks = Math.max(0, (mission.clicksTotal || 0) - (mission.clicksLeft || 0));
        const spent = usedClicks * (mission.reward || 0);
        const remainingNet = input.plan.net - spent;
        if (remainingNet < 0) {
          return sendJson(res, 400, { error: 'Total biaya baru terlalu kecil: reward yang sudah dibayarkan Rp ' + spent.toLocaleString('id-ID') + '.' });
        }

        const fundingDelta = input.budget - (mission.budgetTotal || 0);
        let creator = null;
        if (mission.creator !== 'ADMIN' && fundingDelta !== 0) {
          creator = await getUser(mission.creator);
          if (!creator) return sendJson(res, 400, { error: 'Akun pembuat misi tidak ditemukan.' });
          if (fundingDelta > 0 && (creator.balance || 0) < fundingDelta) {
            return sendJson(res, 400, { error: 'Saldo pembuat tidak cukup untuk menaikkan total biaya misi.' });
          }
          creator.balance = (creator.balance || 0) - fundingDelta;
        }

        const remainingClicks = Math.floor(remainingNet / input.reward);
        mission.title = input.title;
        mission.description = input.description;
        if (Object.prototype.hasOwnProperty.call(body, 'photoUrl')) mission.photoUrl = input.photoUrl;
        mission.link = input.link;
        mission.reward = input.reward;
        mission.budgetTotal = input.budget;
        mission.fee = input.plan.fee;
        mission.clicksTotal = usedClicks + remainingClicks;
        mission.clicksLeft = remainingClicks;
        if (['active', 'nonaktif', 'habis'].includes(body.status)) mission.status = body.status;
        else if (mission.status === 'habis' && remainingClicks > 0) mission.status = 'active';
        if (mission.status === 'active' && remainingClicks <= 0) mission.status = 'habis';
        mission.updatedAt = Date.now();
        if (creator) await saveUser(creator);
        await saveMissions(missions);
        return sendJson(res, 200, { mission: publicMission(mission), usedClicks, spent, fundingDelta });
      }

      // Reset slot klik misi ke penuh. Riwayat pengiriman tidak dihapus: user
      // yang sudah mengerjakan tetap tercatat selesai dan tidak bisa mengulang.
      if (body.action === 'resetMission') {
        const missions = await getMissions();
        const mission = missions.find((m) => m.id === body.missionId);
        if (!mission) return sendJson(res, 404, { error: 'Misi tidak ditemukan.' });
        mission.clicksLeft = mission.clicksTotal || 0;
        mission.status = mission.clicksLeft > 0 ? 'active' : 'habis';
        mission.updatedAt = Date.now();
        await saveMissions(missions);
        return sendJson(res, 200, { mission: publicMission(mission) });
      }

      // Hapus misi manual. Riwayat pengiriman dipertahankan untuk audit dan
      // statistik member. Sisa nilai klik misi user dikembalikan ke pembuat
      // (clicksLeft x reward; biaya platform 5% tidak dikembalikan).
      if (body.action === 'deleteMission') {
        const missions = await getMissions();
        const idx = missions.findIndex((m) => m.id === body.missionId);
        if (idx === -1) return sendJson(res, 404, { error: 'Misi tidak ditemukan.' });
        const mission = missions[idx];
        let refund = 0;
        if (mission.creator !== 'ADMIN' && (mission.clicksLeft || 0) > 0) {
          refund = (mission.clicksLeft || 0) * (mission.reward || 0);
          const creator = await getUser(mission.creator);
          if (creator && refund > 0) {
            creator.balance = (creator.balance || 0) + refund;
            await saveUser(creator);
          }
        }
        missions.splice(idx, 1);
        await saveMissions(missions);
        return sendJson(res, 200, { ok: true, deletedMissionId: mission.id, refund, creator: mission.creator });
      }

      // Gagalkan pengiriman misi manual yang curang: reward yang sudah dibayar
      // otomatis dipotong balik dari saldo user, slot klik dikembalikan.
      if (body.action === 'rejectSubmission') {
        const submissions = await getSubmissions();
        const sub = submissions.find((s) => s.id === body.submissionId);
        if (!sub) return sendJson(res, 404, { error: 'Pengiriman tidak ditemukan.' });
        if (sub.status !== 'approved') {
          return sendJson(res, 400, { error: 'Pengiriman ini sudah digagalkan.' });
        }
        sub.status = 'rejected';
        sub.reviewedAt = Date.now();
        const completer = await getUser(sub.username);
        if (completer) {
          completer.balance = (completer.balance || 0) - (sub.reward || 0);
          await saveUser(completer);
        }
        const missions = await getMissions();
        const mission = missions.find((m) => m.id === sub.missionId);
        if (mission) {
          mission.clicksLeft = (mission.clicksLeft || 0) + 1;
          if (mission.status === 'habis' && mission.clicksLeft > 0) mission.status = 'active';
          await saveMissions(missions);
        }
        await saveSubmissions(submissions);
        return sendJson(res, 200, { ok: true, deducted: sub.reward || 0 });
      }

      // Default: atur reward iklan.
      const reward = validReward(body.missionReward);
      if (reward === null) {
        return sendJson(res, 400, { error: 'missionReward harus bilangan bulat 0 - 1000000.' });
      }
      const saved = await saveSettings({ missionReward: reward });
      return sendJson(res, 200, { missionReward: saved.missionReward });
    }
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  } catch (e) {
    const status = e.status || 500;
    return sendJson(res, status, { error: e.message || 'Terjadi kesalahan server.' });
  }
};
