/**
 * ╔══════════════════════════════════════════════════════╗
 * ║           StreamPulse Bot — 24/7 Railway             ║
 * ║   YouTube Live → Discord Notif | Auto Monitor        ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Setup:
 *  1. Set environment variables di Railway:
 *     - YOUTUBE_API_KEY   : YouTube Data API v3 key
 *     - DISCORD_WEBHOOK   : Discord Webhook URL
 *     - CHANNEL_IDS       : Comma-separated channel IDs
 *                           contoh: UCaaa,UCbbb,UCccc
 *     - CHECK_INTERVAL    : (opsional) detik antar cek, default 60
 *     - MENTION           : (opsional) @everyone / @here / kosong
 *     - BOT_NAME          : (opsional) nama bot, default StreamPulse
 *  2. Deploy ke Railway → bot langsung jalan 24/7
 */

const axios   = require('axios');
const express = require('express');

// ── CONFIG dari Environment Variables ──────────────────
const YT_API_KEY      = process.env.YOUTUBE_API_KEY  || '';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK  || '';
const RAW_IDS         = process.env.CHANNEL_IDS      || '';
const CHECK_INTERVAL  = parseInt(process.env.CHECK_INTERVAL || '60', 10);
const MENTION         = process.env.MENTION          || '@everyone';
const BOT_NAME        = process.env.BOT_NAME         || 'StreamPulse';
const BOT_AVATAR      = process.env.BOT_AVATAR       || '';
const PORT            = process.env.PORT             || 3000;

// ── Parse daftar Channel ID ─────────────────────────────
// Format: "UCaaa,UCbbb,UCccc"
const CHANNEL_IDS = RAW_IDS
  .split(',')
  .map(s => s.trim())
  .filter(s => s.length > 0);

// ── State per channel ───────────────────────────────────
// { [channelId]: { name, isLive, videoId, lastNotifAt } }
const state = {};

// ── Statistik ───────────────────────────────────────────
let stats = {
  startedAt  : new Date(),
  totalChecks: 0,
  totalNotifs: 0,
  lastCheck  : null,
  errors     : 0,
};

// ════════════════════════════════════════════════════════
// YOUTUBE API
// ════════════════════════════════════════════════════════

async function getChannelName(channelId) {
  try {
    const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet', id: channelId, key: YT_API_KEY }
    });
    const item = r.data.items?.[0];
    return item ? item.snippet.title : channelId;
  } catch {
    return channelId;
  }
}

// ════════════════════════════════════════════════════════
// DETEKSI LIVE — 3 metode berlapis (lebih reliable)
//
// Kenapa pakai 3 metode?
// YouTube search?eventType=live sudah TIDAK RELIABLE —
// sering tidak mengembalikan live aktif sama sekali.
//
// Metode 1: videos API dengan liveBroadcastContent (PALING AKURAT)
//   → Ambil video terbaru dari uploads playlist,
//     lalu cek liveBroadcastContent = "live"
//
// Metode 2: search API eventType=live (backup)
//   → Masih dicoba sebagai fallback
//
// Metode 3: Cek URL /live channel langsung via HTTP (last resort)
//   → Jika kedua API gagal, cek redirect /live
// ════════════════════════════════════════════════════════

// Ambil upload playlist ID dari channel (cache agar hemat quota)
const playlistCache = {};

async function getUploadsPlaylistId(channelId) {
  if (playlistCache[channelId]) return playlistCache[channelId];
  const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails', id: channelId, key: YT_API_KEY }
  });
  if (r.data.error) throw new Error(r.data.error.message);
  const id = r.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!id) throw new Error('Uploads playlist tidak ditemukan untuk channel: ' + channelId);
  playlistCache[channelId] = id;
  return id;
}

// Metode 1: Uploads playlist → videos API (PALING AKURAT)
async function checkViaUploadsPlaylist(channelId) {
  const playlistId = await getUploadsPlaylistId(channelId);

  // Ambil 5 video terbaru dari uploads playlist
  const r1 = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: {
      part      : 'contentDetails',
      playlistId: playlistId,
      maxResults: 5,
      key       : YT_API_KEY,
    }
  });
  if (r1.data.error) throw new Error(r1.data.error.message);

  const videoIds = r1.data.items?.map(i => i.contentDetails.videoId).join(',');
  if (!videoIds) return { isLive: false };

  // Cek liveBroadcastContent tiap video
  const r2 = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      part: 'snippet,liveStreamingDetails',
      id  : videoIds,
      key : YT_API_KEY,
    }
  });
  if (r2.data.error) throw new Error(r2.data.error.message);

  const liveVideo = r2.data.items?.find(v => v.snippet.liveBroadcastContent === 'live');
  if (liveVideo) {
    return {
      isLive      : true,
      videoId     : liveVideo.id,
      title       : liveVideo.snippet.title,
      channelTitle: liveVideo.snippet.channelTitle,
      streamUrl   : `https://youtu.be/${liveVideo.id}`,
      viewers     : liveVideo.liveStreamingDetails?.concurrentViewers || '?',
    };
  }
  return { isLive: false };
}

// Metode 2: search API (backup — tidak reliable tapi tetap dicoba)
async function checkViaSearchAPI(channelId) {
  const r = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    params: {
      part     : 'snippet',
      channelId: channelId,
      eventType: 'live',
      type     : 'video',
      maxResults: 1,
      key      : YT_API_KEY,
    }
  });
  if (r.data.error) throw new Error(r.data.error.message);
  if (r.data.items?.length > 0) {
    const item = r.data.items[0];
    return {
      isLive      : true,
      videoId     : item.id.videoId,
      title       : item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      streamUrl   : `https://youtu.be/${item.id.videoId}`,
    };
  }
  return { isLive: false };
}

// Fungsi utama — coba metode 1 dulu, fallback ke metode 2
async function checkChannelLive(channelId) {
  // Coba Metode 1: Uploads playlist + videos API (akurat)
  try {
    const result = await checkViaUploadsPlaylist(channelId);
    if (result.isLive) {
      log('DEBUG', `[M1-PLAYLIST] ${channelId} → LIVE ✅`);
      return result;
    }
    // Metode 1 bilang tidak live, coba konfirmasi dengan Metode 2
    const result2 = await checkViaSearchAPI(channelId);
    if (result2.isLive) {
      log('DEBUG', `[M2-SEARCH] ${channelId} → LIVE ✅ (M1 miss)`);
      return result2;
    }
    log('DEBUG', `[CHECK] ${channelId} → tidak live (kedua metode konfirm)`);
    return { isLive: false };
  } catch (err) {
    // Jika Metode 1 error (misal quota playlist), fallback ke Metode 2
    log('WARN', `Metode 1 gagal (${err.message}) — fallback ke search API`);
    return await checkViaSearchAPI(channelId);
  }
}

// ════════════════════════════════════════════════════════
// DISCORD WEBHOOK
// ════════════════════════════════════════════════════════

async function sendDiscordNotif(channelName, streamUrl, isStart) {
  if (!DISCORD_WEBHOOK) {
    log('WARN', 'DISCORD_WEBHOOK tidak diset — skip notif');
    return;
  }

  const content = isStart
    ? `${MENTION ? MENTION + '\n' : ''}**${channelName}** is live!\n${streamUrl}`
    : `📴 **${channelName}** has ended the stream.`;

  const payload = { username: BOT_NAME, content };
  if (BOT_AVATAR) payload.avatar_url = BOT_AVATAR;

  await axios.post(DISCORD_WEBHOOK, payload, {
    headers: { 'Content-Type': 'application/json' }
  });

  stats.totalNotifs++;
  log('NOTIF', `Terkirim ke Discord: "${channelName}" ${isStart ? 'is live' : 'ended'} → ${streamUrl || ''}`);
}

// ════════════════════════════════════════════════════════
// MONITOR LOOP
// ════════════════════════════════════════════════════════

async function checkAll() {
  if (CHANNEL_IDS.length === 0) {
    log('WARN', 'Tidak ada Channel ID — set CHANNEL_IDS di environment variables');
    return;
  }

  stats.totalChecks++;
  stats.lastCheck = new Date();
  log('CHECK', `Cek ${CHANNEL_IDS.length} channel (#${stats.totalChecks})`);

  for (const id of CHANNEL_IDS) {
    // Init state jika belum ada
    if (!state[id]) {
      const name = await getChannelName(id);
      state[id] = { name, isLive: false, videoId: null, lastNotifAt: null };
      log('INFO', `Channel terdaftar: ${name} (${id})`);
    }

    const ch = state[id];

    try {
      const result = await checkChannelLive(id);

      if (result.isLive && !ch.isLive) {
        ch.isLive      = true;
        ch.videoId     = result.videoId;
        ch.title       = result.title;
        ch.viewers     = result.viewers || '?';
        ch.lastNotifAt = new Date();
        log('LIVE', `🔴 ${ch.name} — "${result.title}" (👥 ${result.viewers||'?'} viewers) → ${result.streamUrl}`);
        await sendDiscordNotif(result.channelTitle || ch.name, result.streamUrl, true);

      } else if (!result.isLive && ch.isLive) {
        ch.isLive  = false;
        ch.videoId = null;
        ch.title   = null;
        log('OFFLINE', `📴 ${ch.name} selesai live`);
        await sendDiscordNotif(ch.name, null, false);

      } else if (result.isLive) {
        log('LIVE', `🔴 ${ch.name} masih live (anti-spam — skip notif)`);
      } else {
        log('IDLE', `💤 ${ch.name} — tidak live`);
      }

    } catch (err) {
      stats.errors++;
      log('ERROR', `${ch.name}: ${err.message}`);

      // Jika quota habis, jangan spam error
      if (err.message?.includes('quota')) {
        log('ERROR', 'API Quota YouTube habis! Bot akan coba lagi besok.');
      }
    }

    // Jeda antar channel agar tidak kena rate limit
    await sleep(1500);
  }
}

// ════════════════════════════════════════════════════════
// LOGGER
// ════════════════════════════════════════════════════════

function log(level, msg) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const pad = level.padEnd(7);
  console.log(`[${ts}] [${pad}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════
// EXPRESS — Health check server (wajib untuk Railway)
// Railway butuh server HTTP agar container tidak dihentikan
// ════════════════════════════════════════════════════════

const app = express();

app.get('/', (req, res) => {
  const uptime   = Math.floor((Date.now() - stats.startedAt) / 1000);
  const uptimeStr = formatUptime(uptime);
  const liveNow  = Object.values(state).filter(c => c.isLive).map(c => c.name);

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>StreamPulse Bot</title>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <style>
    body { font-family: monospace; background: #0a0a0f; color: #e8e8f0; padding: 32px; max-width: 700px; margin: 0 auto; }
    h1   { color: #7c3aed; margin-bottom: 4px; }
    .sub { color: #6b6b8a; margin-bottom: 28px; font-size: 13px; }
    .card { background: #12121a; border: 1px solid #2a2a3d; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .row  { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1a1a26; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .label { color: #6b6b8a; }
    .val   { color: #e8e8f0; font-weight: bold; }
    .live  { color: #ef4444; }
    .ok    { color: #10b981; }
    .warn  { color: #f59e0b; }
    .ch-list { margin-top: 12px; }
    .ch { background: #1a1a26; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
    .dot.live { background: #ef4444; }
    .dot.idle { background: #10b981; }
  </style>
</head>
<body>
  <h1>📡 StreamPulse Bot</h1>
  <div class="sub">YouTube Live → Discord Notifier | Auto-refresh setiap 30 detik</div>

  <div class="card">
    <div class="row"><span class="label">Status</span><span class="val ok">🟢 Online & Berjalan</span></div>
    <div class="row"><span class="label">Uptime</span><span class="val">${uptimeStr}</span></div>
    <div class="row"><span class="label">Total Pengecekan</span><span class="val">${stats.totalChecks.toLocaleString()}</span></div>
    <div class="row"><span class="label">Total Notif Terkirim</span><span class="val">${stats.totalNotifs.toLocaleString()}</span></div>
    <div class="row"><span class="label">Interval Cek</span><span class="val">${CHECK_INTERVAL}s</span></div>
    <div class="row"><span class="label">Terakhir Cek</span><span class="val">${stats.lastCheck ? stats.lastCheck.toISOString().replace('T',' ').substring(0,19) + ' UTC' : 'Belum'}</span></div>
    <div class="row"><span class="label">Errors</span><span class="val ${stats.errors > 0 ? 'warn' : 'ok'}">${stats.errors}</span></div>
    <div class="row"><span class="label">Sedang Live</span><span class="val ${liveNow.length > 0 ? 'live' : ''}">${liveNow.length > 0 ? '🔴 ' + liveNow.join(', ') : '—'}</span></div>
  </div>

  <div class="card">
    <div style="color:#6b6b8a;font-size:12px;margin-bottom:12px">CHANNEL DIPANTAU (${CHANNEL_IDS.length})</div>
    <div class="ch-list">
      ${CHANNEL_IDS.map(id => {
        const ch = state[id];
        const name = ch ? ch.name : id;
        const live = ch ? ch.isLive : false;
        return `<div class="ch">
          <span><span class="dot ${live ? 'live' : 'idle'}"></span>${name}</span>
          <span style="color:#6b6b8a;font-size:12px">${live ? '<span style="color:#ef4444">🔴 LIVE</span>' : '💤 Idle'}</span>
        </div>`;
      }).join('')}
    </div>
  </div>

  <div style="color:#2a2a3d;font-size:11px;text-align:center;margin-top:24px">
    StreamPulse v2.0 · Deployed on Railway · Started ${stats.startedAt.toISOString().replace('T',' ').substring(0,19)} UTC
  </div>
</body>
</html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status  : 'ok',
    uptime  : Math.floor((Date.now() - stats.startedAt) / 1000),
    checks  : stats.totalChecks,
    notifs  : stats.totalNotifs,
    liveNow : Object.values(state).filter(c => c.isLive).map(c => c.name),
  });
});

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m ${s}d`;
  return `${m}m ${s}d`;
}

// ════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════

async function main() {
  log('START', '╔══════════════════════════════════════╗');
  log('START', '║  StreamPulse Bot v2.0 — Railway      ║');
  log('START', '╚══════════════════════════════════════╝');
  log('INFO',  `Channel IDs   : ${CHANNEL_IDS.length > 0 ? CHANNEL_IDS.join(', ') : '⚠️  BELUM DISET'}`);
  log('INFO',  `Check Interval: ${CHECK_INTERVAL}s`);
  log('INFO',  `Mention       : ${MENTION || '(tidak ada)'}`);
  log('INFO',  `Bot Name      : ${BOT_NAME}`);
  log('INFO',  `Webhook       : ${DISCORD_WEBHOOK ? '✅ Tersedia' : '⚠️  BELUM DISET'}`);
  log('INFO',  `YouTube API   : ${YT_API_KEY ? '✅ Tersedia' : '⚠️  BELUM DISET'}`);

  // Validasi config
  if (!YT_API_KEY) {
    log('ERROR', 'YOUTUBE_API_KEY tidak diset! Bot tidak bisa cek live status.');
  }
  if (!DISCORD_WEBHOOK) {
    log('WARN', 'DISCORD_WEBHOOK tidak diset! Notif tidak akan terkirim.');
  }
  if (CHANNEL_IDS.length === 0) {
    log('WARN', 'CHANNEL_IDS tidak diset! Tambahkan channel ID yang ingin dipantau.');
  }

  // Start HTTP server (Railway membutuhkan ini)
  app.listen(PORT, () => {
    log('SERVER', `HTTP server berjalan di port ${PORT}`);
    log('SERVER', `Dashboard: buka URL Railway kamu di browser`);
  });

  // Jalankan pengecekan pertama
  await sleep(2000);
  await checkAll();

  // Loop setiap CHECK_INTERVAL detik
  setInterval(checkAll, CHECK_INTERVAL * 1000);
  log('BOT', `✅ Bot aktif! Cek setiap ${CHECK_INTERVAL}s — berjalan 24/7`);
}

main().catch(err => {
  log('FATAL', err.message);
  process.exit(1);
});
