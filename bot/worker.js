import {pixCode, qrSvg} from './pix.mjs';
import {getEngine} from './engine.js';
// BarnaBank: bot do Telegram + nuvem para sincronizar o app.
// Roda como Cloudflare Worker. Precisa de:
//   KV "BB" (os dados), segredos TELEGRAM_TOKEN e SYNC_KEY.
// Rotas:
//   POST /tg/<hash>        webhook do Telegram
//   GET  /setup?key=...    registra o webhook e os comandos do bot
//   GET  /api/state        o app busca os dados e as mensagens pendentes (Authorization: Bearer SYNC_KEY)
//   PUT  /api/state        o app envia os dados atualizados e confirma as mensagens aplicadas
//   GET  /api/backups[/d]  backups diários (últimos 30 dias)
//   (cron diário)          contas recorrentes, backup, lembretes (seus e de quem te deve)
//
// O "motor" (engine.js, gerado do app.js por build-engine.mjs) roda aqui as mesmas regras do app:
// o que chega pelo bot já entra nos dados da nuvem na hora. As mensagens ficam na fila até um app
// confirmar, e o app ignora as que já aplicou (tgLog): se o motor falhar, o app aplica quando abrir.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: {'Content-Type': 'application/json; charset=utf-8', ...CORS}});

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
    try {
      if (url.pathname === '/api/state') return await api(req, env, ctx, url);
      if (url.pathname.startsWith('/api/photo/')) return await apiPhoto(req, url, env);
      if (url.pathname.startsWith('/api/claim/')) return await apiClaim(req, url, env);
      if (url.pathname === '/api/backups' || url.pathname.startsWith('/api/backups/')) return await apiBackups(req, url, env);
      if (url.pathname === '/setup') return await setup(req, url, env);
      if (url.pathname === '/status') return await status(req, url, env);
      if (url.pathname.startsWith('/tg/')) return await telegram(req, env, url);
      if (url.pathname.startsWith('/s/')) return await shareRoute(req, url, env, ctx);
      if (url.pathname === '/') return json({app: 'BarnaBank', ok: true});
      return json({error: 'not found'}, 404);
    } catch (e) {
      return json({error: String(e && e.message || e)}, 500);
    }
  },
  async scheduled(event, env, ctx) {
    const step = async (name, fn) => { try { await fn(); } catch (e) { await putJSON(env, 'lastError', {at: new Date().toISOString(), error: name + ': ' + String(e && (e.stack || e.message) || e).slice(0, 500)}); } };
    const job = (async () => {
      const origin = await env.BB.get('origin');
      if (origin) await step('webhook', () => ensureWebhook(env, origin, true));
      await step('backup', () => backupDaily(env));
      // contas recorrentes do dia e resumo refeito com a data de hoje
      await step('motor', () => cloudApply(env, e => e.runRecurring()));
      await step('lembretes', () => dailyReminder(env));
      await step('amigos', () => friendReminders(env));
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
    await job;
  }
};

// ---------------------------------------------------------------- util
async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// segredos colados no GitHub às vezes vêm com espaço ou quebra de linha no fim
const TOKEN = env => String(env.TELEGRAM_TOKEN || '').trim();
const KEY = env => String(env.SYNC_KEY || '').trim();
const hookSecret = async env => (await sha('barnabank:' + TOKEN(env))).slice(0, 40);
function authed(req, url, env) {
  const k = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim() || String(url.searchParams.get('key') || '').trim();
  return !!KEY(env) && safeEq(k, KEY(env));
}
function safeEq(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function getJSON(env, key, fallback) {
  const v = await env.BB.get(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}
const putJSON = (env, key, v) => env.BB.put(key, JSON.stringify(v));
// o plano grátis do KV tem 1000 gravações por dia: só grava o que mudou (ignorando carimbos de hora)
function sameJSON(a, b, ignore) {
  const strip = o => { if (!o || typeof o !== 'object') return o; const c = {...o}; (ignore || []).forEach(k => delete c[k]); return JSON.stringify(c); };
  return strip(a) === strip(b);
}
async function putIfChanged(env, key, v, ignore) {
  const old = await getJSON(env, key, null);
  if (old && sameJSON(old, v, ignore)) return false;
  await putJSON(env, key, v);
  return true;
}
const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function todayBR() {
  // data de hoje no horário de Brasília
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
const fmtDate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';

async function tg(env, method, body) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN(env) + '/' + method, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})
    });
    return await r.json().catch(() => ({ok: false, description: 'HTTP ' + r.status}));
  } catch (e) {
    return {ok: false, description: String(e && e.message || e)};
  }
}

// ---------------------------------------------------------------- ligação com o Telegram
async function registerWebhook(env, origin) {
  const secret = await hookSecret(env);
  const a = await tg(env, 'setWebhook', {url: origin + '/tg/' + secret, secret_token: secret, allowed_updates: ['message', 'callback_query']});
  const b = await tg(env, 'setMyCommands', {commands: [
    {command: 'resumo', description: 'Quanto tenho a receber, devo e saldo'},
    {command: 'atrasados', description: 'Quem está atrasado'},
    {command: 'semana', description: 'O que vence nos próximos 7 dias'},
    {command: 'saldo', description: 'Saldo das carteiras'},
    {command: 'cobrar', description: 'Mensagem de cobrança pronta (ex.: /cobrar Vini)'},
    {command: 'semanal', description: 'Resumo da semana'},
    {command: 'lembretes', description: 'Ligar ou desligar os lembretes'},
    {command: 'pendentes', description: 'Mensagens esperando o app abrir'},
    {command: 'ajuda', description: 'Como escrever as mensagens'}
  ]});
  await env.BB.put('origin', origin);
  const me = await tg(env, 'getMe');
  if (me.ok && me.result && me.result.username) await env.BB.put('botName', me.result.username);
  await putJSON(env, 'hook', {at: new Date().toISOString(), ok: !!a.ok, description: a.description || ''});
  return {webhook: a, commands: b};
}
// confere se o Telegram está mandando as mensagens para cá; se não estiver, liga de novo
async function ensureWebhook(env, origin, force) {
  const last = await getJSON(env, 'hookCheck', null);
  // deu certo da última vez: confere de 15 em 15 min; deu errado: tenta de novo depois de 1 min
  if (!force && last && Date.now() - last.t < (last.ok ? 15 * 60 * 1000 : 60 * 1000)) return last;
  const secret = await hookSecret(env);
  const want = origin + '/tg/' + secret;
  const info = await tg(env, 'getWebhookInfo');
  let fixed = false;
  if (info.ok && info.result && info.result.url !== want) {
    const r = await registerWebhook(env, origin);
    fixed = !!r.webhook.ok;
  }
  const out = {t: Date.now(), ok: !!(info.ok && (fixed || (info.result && info.result.url === want))), fixed};
  await putJSON(env, 'hookCheck', out);
  return out;
}
async function webhookInfo(env, origin) {
  const secret = await hookSecret(env);
  const info = await tg(env, 'getWebhookInfo');
  const me = await tg(env, 'getMe');
  const r = info.result || {};
  return {
    tokenOk: !!me.ok, bot: me.ok ? '@' + me.result.username : null, tokenError: me.ok ? '' : (me.description || ''),
    webhookOk: !!info.ok && r.url === origin + '/tg/' + secret,
    webhookUrlSet: !!r.url, webhookPointsElsewhere: !!r.url && r.url !== origin + '/tg/' + secret,
    pending: r.pending_update_count || 0,
    lastError: r.last_error_message || '', lastErrorAt: r.last_error_date ? new Date(r.last_error_date * 1000).toISOString() : ''
  };
}
async function say(env, chat, text, extra) {
  const r = await tg(env, 'sendMessage', {chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(extra || {})});
  if (!r.ok) await putJSON(env, 'lastError', {at: new Date().toISOString(), error: 'sendMessage: ' + (r.description || 'falhou')});
  return r;
}

// ---------------------------------------------------------------- API do app
async function api(req, env, ctx, url) {
  if (!authed(req, url, env)) return json({error: 'unauthorized'}, 401);
  // aproveita a visita do app para garantir que o bot está ligado
  if (ctx && ctx.waitUntil) ctx.waitUntil(ensureWebhook(env, url.origin, false).catch(() => {}));
  if (req.method === 'GET') {
    const [snapshot, inbox, meta, undo, claimIds, shareIdx, friends] = await Promise.all([getJSON(env, 'snapshot', null), getJSON(env, 'inbox', []), getJSON(env, 'meta', {}), getJSON(env, 'undo', []), getJSON(env, 'claims', []), getJSON(env, 'shareIndex', []), getJSON(env, 'friends', {})]);
    const claims = [];
    for (const id of claimIds.slice(-60)) { const c = await getJSON(env, 'claim:' + id, null); if (c && c.status === 'pending') claims.push({id: c.id, at: c.at, amount: c.amount, note: c.note, label: c.label, hasPhoto: c.hasPhoto, token: c.token}); }
    const views = {};
    for (const t of shareIdx) { const vw = await getJSON(env, 'views:' + t, null); if (vw) views[t] = {count: vw.count, first: vw.first, last: vw.last}; }
    const fr = {};
    Object.keys(friends).forEach(k => { fr[k] = {code: friends[k].code, at: friends[k].at, name: friends[k].name || ''}; });
    let bot = await env.BB.get('botName');
    if (!bot) { const me = await tg(env, 'getMe'); if (me.ok && me.result && me.result.username) { bot = me.result.username; await env.BB.put('botName', bot); } }
    return json({snapshot, inbox, undo, claims, views, friends: fr, bot: bot || '', rev: meta.rev || 0, updatedAt: meta.updatedAt || null});
  }
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({error: 'bad body'}, 400);
    const ack = Array.isArray(body.ack) ? body.ack : [];
    const snap = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : null;
    const meta = await saveState(env, {
      snapshot: snap,
      summary: body.summary && typeof body.summary === 'object' ? body.summary : null,
      shares: body.shares && typeof body.shares === 'object' ? body.shares : null
    });
    let inbox = await getJSON(env, 'inbox', []);
    if (ack.length) {
      inbox = inbox.filter(op => !ack.includes(op.id));
      await putJSON(env, 'inbox', inbox);
      if (env.BB.delete) for (const id of ack) await env.BB.delete('photo:' + id);
    }
    const undoAck = Array.isArray(body.undoAck) ? body.undoAck : [];
    let undo = await getJSON(env, 'undo', []);
    if (undoAck.length) {
      undo = undo.filter(u => !undoAck.includes(u.id));
      await putJSON(env, 'undo', undo);
    }
    // chegou mensagem do bot enquanto o app mandava os dados: aplica de novo por cima (não duplica)
    if (snap) {
      const log = snap.tgLog || {};
      const ops = inbox.filter(op => !log[op.id]);
      const und = undo.filter(u => log[u.id] && !log[u.id].undone);
      if (ops.length || und.length) {
        const job = cloudApply(env, e => { if (ops.length) e.applyOps(ops); if (und.length) e.undo(und); });
        if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
      }
    }
    return json({ok: true, updatedAt: meta.updatedAt, rev: meta.rev, pending: inbox.length});
  }
  return json({error: 'method'}, 405);
}

// ---------------------------------------------------------------- motor: as regras do app rodando na nuvem
let ENGINE = null;
// carrega os dados, roda fn(motor), grava o resultado. Devolve o que fn devolveu (ou null se não deu).
async function cloudApply(env, fn) {
  try {
    const oldStr = await env.BB.get('snapshot');
    if (!oldStr) return null;
    const origin = await env.BB.get('origin');
    if (!ENGINE) ENGINE = getEngine();
    // tudo síncrono daqui até o fim das contas: duas mensagens ao mesmo tempo não se misturam
    ENGINE.load(JSON.parse(oldStr), {url: origin || ''});
    const out = fn(ENGINE);
    const data = {snapshot: ENGINE.snapshot(), summary: ENGINE.summary(), shares: ENGINE.shares()};
    await saveState(env, data, oldStr);
    return out === undefined ? true : out;
  } catch (e) {
    await putJSON(env, 'lastError', {at: new Date().toISOString(), error: 'motor: ' + String(e && (e.stack || e.message) || e).slice(0, 600)});
    return null;
  }
}
const stripStamp = s => String(s || '').replace(/"exportedAt":"[^"]*",?/, '');
// grava dados, resumo e links; a versão (rev) só sobe quando os dados mudam
async function saveState(env, data, oldStr) {
  const meta = await getJSON(env, 'meta', {});
  let changed = false;
  if (data.snapshot) {
    if (oldStr === undefined) oldStr = await env.BB.get('snapshot');
    const newStr = JSON.stringify(data.snapshot);
    if (stripStamp(oldStr) !== stripStamp(newStr)) {
      if (oldStr) await backupDaily(env, oldStr);
      await env.BB.put('snapshot', newStr);
      changed = true;
    }
  }
  if (data.summary) {
    const old = await getJSON(env, 'summary', null);
    // o "at" só conta se o resumo antigo já tem mais de 12h (senão o bot acharia que os dados estão velhos)
    if (!old || !sameJSON(old, data.summary, ['at']) || Date.now() - Date.parse(old.at || 0) > 12 * 3600000) await putJSON(env, 'summary', data.summary);
  }
  if (data.shares) await saveShares(env, data.shares);
  if (changed || !meta.rev) {
    meta.rev = (meta.rev || 0) + 1;
    meta.updatedAt = new Date().toISOString();
    await putJSON(env, 'meta', meta);
  }
  return meta;
}
// backup: a primeira vez que os dados mudam no dia (ou o cron das 9h) guarda como estavam; fica 35 dias
async function backupDaily(env, snapStr) {
  const day = todayBR();
  const idx = await getJSON(env, 'bkIndex', []);
  if (idx.some(b => b.date === day)) return false;
  const str = snapStr || await env.BB.get('snapshot');
  if (!str) return false;
  await env.BB.put('bk:' + day, str, {expirationTtl: 60 * 60 * 24 * 35});
  const keep = addDays(day, -30);
  const next = idx.filter(b => b.date >= keep).concat([{date: day, size: str.length}]);
  await putJSON(env, 'bkIndex', next.slice(-40));
  return true;
}
async function apiBackups(req, url, env) {
  if (!authed(req, url, env)) return json({error: 'unauthorized'}, 401);
  const day = url.pathname.slice('/api/backups/'.length);
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({error: 'data inválida'}, 400);
    const str = await env.BB.get('bk:' + day);
    if (!str) return json({error: 'not found'}, 404);
    return new Response('{"date":"' + day + '","snapshot":' + str + '}', {headers: {'Content-Type': 'application/json; charset=utf-8', ...CORS}});
  }
  const keep = addDays(todayBR(), -30);
  const idx = (await getJSON(env, 'bkIndex', [])).filter(b => b.date >= keep);
  return json({backups: idx.slice().sort((a, b) => a.date < b.date ? 1 : -1)});
}

async function apiClaim(req, url, env) {
  if (!authed(req, url, env)) return json({error: 'unauthorized'}, 401);
  const rest = url.pathname.slice('/api/claim/'.length).split('/');
  const id = (rest[0] || '').replace(/[^A-Za-z0-9]/g, '');
  if (rest[1] === 'photo' && req.method === 'GET') {
    const ph = await env.BB.get('cphoto:' + id);
    return ph ? json({data: ph}) : json({error: 'not found'}, 404);
  }
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    return json(await claimDecide(env, id, body.decision === 'ok'));
  }
  return json({error: 'method'}, 405);
}

async function apiPhoto(req, url, env) {
  if (!authed(req, url, env)) return json({error: 'unauthorized'}, 401);
  const id = url.pathname.slice('/api/photo/'.length).replace(/[^A-Za-z0-9]/g, '');
  const data = id ? await env.BB.get('photo:' + id) : null;
  return data ? json({data}) : json({error: 'not found'}, 404);
}

async function setup(req, url, env) {
  if (!authed(req, url, env)) return json({error: 'unauthorized'}, 401);
  const r = await registerWebhook(env, url.origin);
  await putJSON(env, 'hookCheck', {t: Date.now(), ok: !!r.webhook.ok, fixed: false});
  const info = await webhookInfo(env, url.origin);
  const owner = await env.BB.get('owner');
  return json({ok: !!r.webhook.ok, webhook: !!r.webhook.ok, description: r.webhook.description || '', commands: !!r.commands.ok,
    ...info, owner: !!owner, worker: url.origin});
}

async function status(req, url, env) {
  if (!authed(req, url, env)) return json({error: 'unauthorized'}, 401);
  const [info, owner, summary, inbox, hook] = await Promise.all([
    webhookInfo(env, url.origin), env.BB.get('owner'), getJSON(env, 'summary', null), getJSON(env, 'inbox', []), getJSON(env, 'hook', null)
  ]);
  const lastError = await getJSON(env, 'lastError', null);
  return json({ok: true, worker: url.origin, ...info, owner: !!owner, lastSetup: hook, botError: lastError,
    summaryAt: summary ? summary.at : null, inbox: inbox.length});
}
// ---------------------------------------------------------------- Telegram
const HELP =
  '<b>Como usar</b>\n' +
  'Escreva do jeito que falaria:\n\n' +
  '• <code>Vini me deve 50</code>\n' +
  '• <code>emprestei 300 pra Larissa em 3x</code>\n' +
  '• <code>devo 80 pro Carlos</code>\n' +
  '• <code>recebi 20 do Vini</code>  /  <code>Vini pagou 20</code>\n' +
  '• <code>paguei 40 pro Carlos</code>\n' +
  '• <code>gastei 35 mercado</code>  (ou <code>gastei 35 mercado no nubank</code>)\n' +
  '• <code>ganhei 150 freela</code>\n' +
  '• 📎 foto do PIX com a legenda <code>recebi 50 do Vini</code> (vai como comprovante)\n\n' +
  'Entra no BarnaBank na hora (o app pega quando abrir).\n\n' +
  '/cobrar Fulano: mensagem de cobrança pronta para encaminhar\n' +
  '🎙️ Pode mandar <b>áudio</b> também.\n' +
  '❓ Perguntas: <code>quanto gastei com ifood esse mês?</code>, <code>quem me deve mais?</code>, <code>quanto o Vini já me pagou?</code>\n\n' +
  '/resumo · /atrasados · /semana · /semanal · /saldo · /pendentes · /lembretes';

async function telegram(req, env, url) {
  const secret = await hookSecret(env);
  if (url.pathname !== '/tg/' + secret || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return json({error: 'forbidden'}, 403);
  const up = await req.json().catch(() => null);
  try {
    await onUpdate(env, up);
  } catch (e) {
    // responde 200 mesmo assim (senão o Telegram fica reenviando) e guarda o erro para o diagnóstico
    await putJSON(env, 'lastError', {at: new Date().toISOString(), error: String(e && (e.stack || e.message) || e).slice(0, 600)});
  }
  return json({ok: true});
}

async function onUpdate(env, up) {
  if (!up) return;
  if (up.callback_query) { await onCallback(env, up.callback_query); return; }
  const msg = up.message;
  if (!msg || !msg.chat) return;
  const photo = (msg.photo && msg.photo.length) ? pickPhoto(msg.photo)
    : (msg.document && /^image\//.test(msg.document.mime_type || '') ? msg.document : null);
  const voice = msg.voice || (msg.audio && /audio/.test(msg.audio.mime_type || 'audio') ? msg.audio : null);
  if (typeof msg.text !== 'string' && !photo && !voice) return;
  const chat = String(msg.chat.id);
  let owner = await env.BB.get('owner');
  const text = String(msg.text || msg.caption || '').trim();
  const invite = /^\/start\s+([A-Za-z0-9]{8,40})$/.exec(text);
  if (chat !== owner && (invite || (owner && await friendByChat(env, chat)))) {
    if (!owner) { await say(env, chat, 'Este bot ainda não foi ativado pelo dono.'); return; }
    await friendMessage(env, chat, msg, invite ? invite[1] : null);
    return;
  }
  if (!owner) {
    if (/^\/start/.test(text)) {
      await env.BB.put('owner', chat);
      await say(env, chat, '👋 Pronto! Este bot agora é só seu.\n\n' + HELP);
    } else await say(env, chat, 'Mande /start para ativar o bot.');
    return;
  }
  if (chat !== owner) { await say(env, chat, 'Este bot é privado.'); return; }
  if (voice) {
    const heard = await transcribe(env, voice);
    if (heard.error) { await say(env, chat, heard.error); return; }
    await say(env, chat, '🎙️ Entendi: <i>“' + esc(heard.text) + '”</i>');
    await handleText(env, chat, heard.text.replace(/[.!]+$/, '').trim(), null);
    return;
  }
  await handleText(env, chat, text, photo);
  return;
}

async function onCallback(env, cq) {
  const owner = await env.BB.get('owner');
  const chat = cq.message && String(cq.message.chat.id);
  if (!owner || chat !== owner) return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
  const cd = /^claim:(ok|no):(.+)$/.exec(cq.data || '');
  if (cd) {
    const r = await claimDecide(env, cd[2], cd[1] === 'ok');
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: r.already ? 'Já estava resolvido' : cd[1] === 'ok' ? 'Confirmado' : 'Marcado como não recebido'});
  }
  const rm = /^remind:(.+)$/.exec(cq.data || '');
  if (rm) {
    const r = await remindFriend(env, rm[1], 'manual');
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: r.ok ? 'Lembrete enviado pra ' + r.name : r.error, show_alert: !r.ok});
  }
  const cb = /^cobrar:(.+)$/.exec(cq.data || '');
  if (cb) {
    await tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
    return cobrar(env, chat, await getJSON(env, 'summary', null), cb[1], true);
  }
  const m = /^undo:(.+)$/.exec(cq.data || '');
  if (m) {
    const id = m[1];
    const inbox = await getJSON(env, 'inbox', []);
    const i = inbox.findIndex(op => op.id === id);
    if (i !== -1) {
      inbox.splice(i, 1);
      await putJSON(env, 'inbox', inbox);
      if (env.BB.delete) await env.BB.delete('photo:' + id);
    }
    const snap = await getJSON(env, 'snapshot', null);
    const inCloud = !!(snap && snap.tgLog && snap.tgLog[id]);
    let note = '↩️ Desfeito. Não vai entrar no app.';
    if (i === -1 || inCloud) {
      // já está nos dados (da nuvem ou de um app): fica na lista de desfazer até o app confirmar
      const undo = await getJSON(env, 'undo', []);
      if (!undo.some(u => u.id === id)) undo.push({id, at: new Date().toISOString()});
      await putJSON(env, 'undo', undo.slice(-100));
      const done = inCloud && await cloudApply(env, e => e.undo([{id}]));
      note = done ? '↩️ Desfeito. Já saiu do app.' : '↩️ Desfeito. Sai do app na próxima vez que você abrir.';
    }
    const old = (cq.message && cq.message.text) || '';
    await tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: '<s>' + esc(old.split('\n')[0].replace(/^✅\s*/, '')) + '</s>\n' + note, parse_mode: 'HTML'});
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: 'Desfeito'});
  }
  return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
}

async function handleText(env, chat, text, photo) {
  if (photo && !text) return say(env, chat, '📎 Manda a foto com uma <b>legenda</b> dizendo o que é, tipo:\n<code>recebi 50 do Vini</code>\n\nA foto vai junto como comprovante do pagamento.');
  const cmd = (/^\/(\w+)/.exec(text) || [])[1];
  const summary = await getJSON(env, 'summary', null);
  if (cmd === 'start' || cmd === 'ajuda' || cmd === 'help') return say(env, chat, HELP);
  if (cmd === 'resumo') return say(env, chat, await resumoText(env, summary));
  if (cmd === 'atrasados') return say(env, chat, atrasadosText(summary));
  if (cmd === 'semana') return say(env, chat, semanaText(summary, 7));
  if (cmd === 'semanal') return say(env, chat, weekText(summary));
  if (cmd === 'lembretes') {
    const prefs = await getJSON(env, 'prefs', {daily: true, weekly: true});
    const arg = norm(text.replace(/^\/lembretes(@\w+)?\s*/i, ''));
    if (/^(desliga|off|parar|nao)/.test(arg)) { prefs.daily = false; prefs.weekly = false; }
    else if (/^(liga|on|sim)/.test(arg)) { prefs.daily = true; prefs.weekly = true; }
    else if (/^diario/.test(arg)) prefs.daily = !prefs.daily;
    else if (/^semanal/.test(arg)) prefs.weekly = !prefs.weekly;
    await putJSON(env, 'prefs', prefs);
    return say(env, chat, '<b>Lembretes</b>\n☀️ Diário às 9h (hoje, amanhã e atrasados): <b>' + (prefs.daily !== false ? 'ligado' : 'desligado') + '</b>\n📆 Resumo de domingo: <b>' + (prefs.weekly !== false ? 'ligado' : 'desligado') + '</b>\n\n<code>/lembretes diario</code> ou <code>/lembretes semanal</code> liga/desliga cada um. <code>/lembretes desligar</code> desliga tudo.');
  }
  if (cmd === 'saldo') return say(env, chat, saldoText(summary));
  if (cmd === 'cobrar' || /^cobrar\b/i.test(text)) return cobrar(env, chat, summary, text.replace(/^\/?cobrar(@\w+)?\s*/i, ''));
  if (cmd === 'pendentes') {
    const waiting = await pendingOps(env);
    return say(env, chat, waiting.length ? '<b>Esperando o app abrir:</b>\n' + waiting.map(o => '• ' + esc(o.text)).join('\n') : 'Nada pendente: tudo já está nos seus dados. ✅');
  }
  const op = parseMessage(cmd ? text.replace(/^\/\w+\s*/, cmd + ' ') : text, summary);
  if (!op) {
    const ans = await answerQuestion(env, text, summary);
    if (ans) return say(env, chat, ans);
    return say(env, chat, 'Não entendi 🤔\n\n' + HELP);
  }
  op.id = 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  op.at = new Date().toISOString();
  op.date = todayBR();
  op.text = text.slice(0, 200);
  let photoNote = '';
  if (photo) {
    if (op.type === 'pay') {
      op.photo = await savePhoto(env, op.id, photo);
      photoNote = op.photo ? '\n📎 Comprovante anexado.' : '\n⚠️ Não consegui baixar a foto; o pagamento entra sem comprovante.';
    } else photoNote = '\n<i>(A foto só vai junto em pagamentos, tipo "recebi 50 do Vini".)</i>';
  }
  const inbox = await getJSON(env, 'inbox', []);
  inbox.push(op);
  await putJSON(env, 'inbox', inbox.slice(-200));
  // responde primeiro (a mensagem já está salva na fila) e depois lança nos dados da nuvem
  const sent = await say(env, chat, '✅ ' + describe(op) + photoNote, {
    reply_markup: {inline_keyboard: [[{text: 'Desfazer', callback_data: 'undo:' + op.id}]]}
  });
  const res = await cloudApply(env, e => e.applyOps([op]));
  const r = res && res[0];
  if (r && !r.ok && sent && sent.ok) {
    // o app também não conseguiria: avisa já, em vez de esperar o app abrir
    await tg(env, 'editMessageText', {chat_id: chat, message_id: sent.result.message_id, parse_mode: 'HTML',
      text: '⚠️ <s>' + describe(op) + '</s>\nNão lancei: ' + esc(r.msg) + '.'});
    const again = (await getJSON(env, 'inbox', [])).filter(o => o.id !== op.id);
    await putJSON(env, 'inbox', again);
  }
  return sent;
}

// ---------------------------------------------------------------- fotos de comprovante
function pickPhoto(sizes) {
  const ok = sizes.filter(p => Math.max(p.width || 0, p.height || 0) <= 1600);
  return (ok.length ? ok : sizes)[(ok.length ? ok : sizes).length - 1];
}
async function savePhoto(env, id, ph) {
  try {
    if (ph.file_size && ph.file_size > 8 * 1024 * 1024) return false;
    const f = await tg(env, 'getFile', {file_id: ph.file_id});
    if (!f.ok || !f.result || !f.result.file_path) return false;
    const r = await fetch('https://api.telegram.org/file/bot' + TOKEN(env) + '/' + f.result.file_path);
    if (!r.ok) return false;
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const mime = ph.mime_type || (/\.png$/i.test(f.result.file_path) ? 'image/png' : 'image/jpeg');
    await env.BB.put('photo:' + id, 'data:' + mime + ';base64,' + btoa(bin), {expirationTtl: 60 * 60 * 24 * 60});
    return true;
  } catch (e) {
    await putJSON(env, 'lastError', {at: new Date().toISOString(), error: 'foto: ' + String(e && e.message || e)});
    return false;
  }
}

// ---------------------------------------------------------------- leitura das mensagens
const NUM = '(?:r\\$\\s*)?(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)(?:\\s*(?:reais|conto|pila|r\\$))?';
function money(s) {
  s = String(s).trim();
  if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = parseFloat(s);
  return isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}
function cleanName(s) {
  return String(s || '').replace(/[.!?,;]+$/, '').replace(/^(o|a|os|as)\s+/i, '').trim().replace(/\s+/g, ' ')
    .split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}
function extras(rest) {
  const out = {};
  const n = /(?:em\s*)?(\d{1,2})\s*x\b/i.exec(rest) || /(\d{1,2})\s*parcelas?/i.exec(rest);
  if (n) { out.installments = parseInt(n[1], 10); rest = rest.replace(n[0], ' '); }
  const d = /\b(?:todo\s+)?dia\s+(\d{1,2})\b/i.exec(rest);
  if (d) { out.dueDay = parseInt(d[1], 10); rest = rest.replace(d[0], ' '); }
  out.note = rest.replace(/^[\s,.-]+|[\s,.-]+$/g, '').replace(/^(de|do|da|pra|para|pro|por)\s+/i, '');
  return out;
}
function isKnownPerson(summary, name, kind) {
  const q = norm(name);
  return !!(summary && (summary.people || []).some(p => (kind === 'pay' ? p.pay > 0 : kind === 'rec' ? p.rec > 0 : true) &&
    (norm(p.name) === q || norm(p.name).split(' ')[0] === q)));
}
function splitWallet(cat, summary) {
  // "mercado no nubank" -> categoria mercado, carteira nubank
  const m = /^(.*?)\s+(?:no|na|pelo|pela|via|com o|com a)\s+([\wÀ-ÿ ]+)$/i.exec(cat);
  if (m) {
    const w = norm(m[2]);
    const wallets = (summary && summary.wallets || []).map(x => x.name);
    const hit = wallets.find(x => norm(x) === w || norm(x).startsWith(w) || w.startsWith(norm(x)));
    if (hit || !wallets.length) return {category: m[1], wallet: hit || m[2]};
  }
  return {category: cat, wallet: ''};
}
function parseMessage(raw, summary) {
  const t = raw.trim().replace(/\s+/g, ' ');
  let m;
  // comandos curtos: /deve Vini 50, /devo Carlos 30, /recebi Vini 20, /paguei Carlos 20, /gastei 35 mercado, /ganhei 100 freela
  if ((m = new RegExp('^deve\\s+(.+?)\\s+' + NUM + '(.*)$', 'i').exec(t))) return {type: 'debt', kind: 'receivable', name: cleanName(m[1]), amount: money(m[2]), ...extras(m[3])};
  if ((m = new RegExp('^devo\\s+([^\\d].*?)\\s+' + NUM + '(.*)$', 'i').exec(t))) return {type: 'debt', kind: 'payable', name: cleanName(m[1]), amount: money(m[2]), ...extras(m[3])};
  // "Vini me deve 50"
  if ((m = new RegExp('^(.+?)\\s+me\\s+deve\\s+' + NUM + '(.*)$', 'i').exec(t))) return {type: 'debt', kind: 'receivable', name: cleanName(m[1]), amount: money(m[2]), ...extras(m[3])};
  // "emprestei 300 pra Larissa em 3x"
  if ((m = new RegExp('^emprestei\\s+' + NUM + '\\s+(?:pra|para|pro|ao|à|a)\\s+(.+?)(\\s+(?:em\\s*)?\\d{1,2}\\s*x.*|\\s+dia\\s+\\d.*)?$', 'i').exec(t))) return {type: 'debt', kind: 'receivable', name: cleanName(m[2]), amount: money(m[1]), ...extras(m[3] || '')};
  // "devo 80 pro Carlos"
  if ((m = new RegExp('^devo\\s+' + NUM + '\\s+(?:pra|para|pro|ao|à|a)\\s+(.+?)(\\s+(?:em\\s*)?\\d{1,2}\\s*x.*|\\s+dia\\s+\\d.*)?$', 'i').exec(t))) return {type: 'debt', kind: 'payable', name: cleanName(m[2]), amount: money(m[1]), ...extras(m[3] || '')};
  // "Vini pagou 20"
  if ((m = new RegExp('^(.+?)\\s+(?:pagou|me pagou|devolveu|me devolveu|mandou|me mandou)\\s+' + NUM + '(.*)$', 'i').exec(t))) return {type: 'pay', kind: 'receivable', name: cleanName(m[1]), amount: money(m[2])};
  // "recebi 20 do Vini" (ou de salário -> entrada)
  if ((m = new RegExp('^recebi\\s+' + NUM + '\\s+(?:do|da|de|dos|das)\\s+(.+)$', 'i').exec(t))) {
    const who = m[2].trim();
    if (isKnownPerson(summary, who, 'rec') || !summary) return {type: 'pay', kind: 'receivable', name: cleanName(who), amount: money(m[1])};
    const sw = splitWallet(who, summary);
    return {type: 'tx', kind: 'entrada', amount: money(m[1]), category: sw.category, wallet: sw.wallet};
  }
  if ((m = new RegExp('^recebi\\s+(.+?)\\s+' + NUM + '$', 'i').exec(t))) return {type: 'pay', kind: 'receivable', name: cleanName(m[1]), amount: money(m[2])};
  // "paguei 40 pro Carlos" (ou "paguei 120 de luz" -> gasto)
  if ((m = new RegExp('^paguei\\s+' + NUM + '\\s+(?:pro|pra|para|ao|à|a)\\s+(.+)$', 'i').exec(t)) && isKnownPerson(summary, m[2], 'pay'))
    return {type: 'pay', kind: 'payable', name: cleanName(m[2]), amount: money(m[1])};
  if ((m = new RegExp('^paguei\\s+([^\\d].*?)\\s+' + NUM + '$', 'i').exec(t)) && isKnownPerson(summary, m[1], 'pay'))
    return {type: 'pay', kind: 'payable', name: cleanName(m[1]), amount: money(m[2])};
  // gastos e entradas
  if ((m = new RegExp('^(?:gastei|paguei|comprei|gasto)\\s+' + NUM + '\\s*(?:de|em|no|na|com|pro|pra|para)?\\s*(.*)$', 'i').exec(t))) {
    const sw = splitWallet(m[2].trim(), summary);
    return {type: 'tx', kind: 'gasto', amount: money(m[1]), category: sw.category || 'Outros', wallet: sw.wallet};
  }
  if ((m = new RegExp('^(?:ganhei|entrou|caiu)\\s+' + NUM + '\\s*(?:de|do|da|com|no|na)?\\s*(.*)$', 'i').exec(t))) {
    const sw = splitWallet(m[2].trim(), summary);
    return {type: 'tx', kind: 'entrada', amount: money(m[1]), category: sw.category || 'Entrada', wallet: sw.wallet};
  }
  return null;
}
function describe(op) {
  const v = brl(op.amount);
  if (op.type === 'debt') {
    const tail = (op.installments > 1 ? ' em ' + op.installments + 'x' : '') + (op.dueDay ? ', todo dia ' + op.dueDay : '') + (op.note ? ' (' + esc(op.note) + ')' : '');
    return op.kind === 'payable' ? 'Você deve <b>' + v + '</b> a <b>' + esc(op.name) + '</b>' + tail : '<b>' + esc(op.name) + '</b> te deve <b>' + v + '</b>' + tail;
  }
  if (op.type === 'pay') return op.kind === 'payable' ? 'Pago <b>' + v + '</b> a <b>' + esc(op.name) + '</b>' : 'Recebido <b>' + v + '</b> de <b>' + esc(op.name) + '</b>';
  return (op.kind === 'entrada' ? 'Entrada' : 'Gasto') + ' de <b>' + v + '</b> · ' + esc(op.category) + (op.wallet ? ' (' + esc(op.wallet) + ')' : '');
}

// ---------------------------------------------------------------- respostas
// mensagens que nem a nuvem nem o app lançaram ainda
async function pendingOps(env) {
  const [inbox, snap] = await Promise.all([getJSON(env, 'inbox', []), getJSON(env, 'snapshot', null)]);
  const log = (snap && snap.tgLog) || {};
  return inbox.filter(o => !log[o.id]);
}
function stale(summary) {
  if (!summary) return '\n\n<i>O app ainda não mandou os dados. Abra o BarnaBank e ligue a nuvem em Configurações.</i>';
  const h = (Date.now() - new Date(summary.at).getTime()) / 3600000;
  return h > 24 ? '\n\n<i>Dados de ' + fmtDate(summary.at.slice(0, 10)) + ' (última vez que o app abriu).</i>' : '';
}
async function resumoText(env, s) {
  if (!s) return 'Ainda não tenho dados.' + stale(s);
  const rec = (s.people || []).reduce((a, p) => a + p.rec, 0), pay = (s.people || []).reduce((a, p) => a + p.pay, 0);
  const late = (s.late || []).reduce((a, p) => a + p.amount, 0);
  const inbox = await pendingOps(env);
  let out = '<b>📊 Resumo</b>\n' +
    '💰 Saldo nas carteiras: <b>' + brl(s.balance) + '</b>\n' +
    '🤝 A receber: <b>' + brl(rec) + '</b>' + (late > 0 ? ' (' + brl(late) + ' atrasado)' : '') + '\n' +
    '💸 Eu devo: <b>' + brl(pay) + '</b>';
  if (s.forecast != null) out += '\n🔮 Previsão para o fim do mês: <b>' + brl(s.forecast) + '</b>';
  const over = (s.budgets || []).filter(b => b.spent > b.limit);
  if (over.length) out += '\n⚠️ Orçamento estourado: ' + over.map(b => esc(b.name)).join(', ');
  if ((s.goals || []).length) out += '\n🎯 ' + s.goals.map(g => esc(g.name) + ' ' + Math.round(g.saved / g.target * 100) + '%').join(' · ');
  if (inbox.length) out += '\n\n⏳ ' + inbox.length + ' mensagem(ns) esperando o app abrir.';
  return out + stale(s);
}
function atrasadosText(s) {
  if (!s) return 'Ainda não tenho dados.' + stale(s);
  const late = s.late || [];
  if (!late.length) return 'Ninguém atrasado. 🎉' + stale(s);
  return '<b>⏰ Atrasados</b>\n' + late.map(p => '• ' + esc(p.name) + ': <b>' + brl(p.amount) + '</b>' + (p.since ? ' (desde ' + fmtDate(p.since) + ')' : '')).join('\n') +
    '\n\nTotal: <b>' + brl(late.reduce((a, p) => a + p.amount, 0)) + '</b>' + (s.pix ? '\nSeu PIX: <code>' + esc(s.pix) + '</code>' : '') + stale(s);
}
function semanaText(s, days) {
  if (!s) return 'Ainda não tenho dados.' + stale(s);
  const today = todayBR();
  const lim = new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const items = (s.due || []).filter(i => i.date <= lim);
  if (!items.length) return 'Nada vencendo nos próximos ' + days + ' dias. 🎉' + stale(s);
  return '<b>📅 Próximos ' + days + ' dias</b>\n' + items.map(i =>
    (i.date < today ? '🔴 ' : i.date === today ? '🟡 ' : '• ') + fmtDate(i.date) + ' · ' + esc(i.title) + ': ' + (i.dir === 'in' ? '+' : '−') + brl(i.amount)).join('\n') + stale(s);
}
function saldoText(s) {
  if (!s) return 'Ainda não tenho dados.' + stale(s);
  return '<b>💰 Carteiras</b>\n' + (s.wallets || []).map(w => '• ' + esc(w.name) + ': <b>' + brl(w.balance) + '</b>').join('\n') + '\n\nTotal: <b>' + brl(s.balance) + '</b>' + stale(s);
}

// ---------------------------------------------------------------- lembrete diário
function addDays(iso, n) { return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
const line = i => '• ' + esc(i.title) + ': ' + (i.dir === 'in' ? '+' : '−') + brl(i.amount);
async function dailyReminder(env) {
  const owner = await env.BB.get('owner');
  const s = await getJSON(env, 'summary', null);
  if (!owner || !s) return;
  const prefs = await getJSON(env, 'prefs', {daily: true, weekly: true});
  const today = todayBR(), tomorrow = addDays(today, 1);
  const items = s.due || [];
  const dueToday = items.filter(i => i.date === today), late = items.filter(i => i.date < today), dueTomorrow = items.filter(i => i.date === tomorrow);
  // gastos fora do padrão: avisa uma vez por categoria por mês
  const sentA = await getJSON(env, 'alertsSent', {}), month = today.slice(0, 7);
  const newAlerts = (s.alerts || []).filter(x => sentA[month + ':' + x.key] !== 1);
  if (prefs.daily !== false && newAlerts.length) {
    await say(env, owner, '<b>⚠️ Gasto fora do padrão</b>\n' + newAlerts.map(x => '• ' + esc(x.name) + ': ' + brl(x.cur) + ' este mês (' + esc(x.text) + ')').join('\n'));
    newAlerts.forEach(x => { sentA[month + ':' + x.key] = 1; });
    Object.keys(sentA).forEach(k => { if (k.slice(0, 7) < month) delete sentA[k]; });
    await putJSON(env, 'alertsSent', sentA);
  }
  if (prefs.daily !== false && (dueToday.length || late.length || dueTomorrow.length)) {
    let out = '<b>☀️ Bom dia!</b>';
    if (dueToday.length) out += '\n\n<b>Vence hoje</b>\n' + dueToday.map(line).join('\n');
    if (dueTomorrow.length) out += '\n\n<b>Vence amanhã</b>\n' + dueTomorrow.map(line).join('\n');
    if (late.length) out += '\n\n<b>Atrasado</b>\n' + late.map(i => '• ' + esc(i.title) + ' (desde ' + fmtDate(i.date) + '): ' + brl(i.amount)).join('\n');
    out += '\n\nResponda <code>recebi 20 do Fulano</code> quando alguém pagar' + (late.some(i => i.dir === 'in') ? ', ou /cobrar para mandar a cobrança' : '') + '.';
    await say(env, owner, out + stale(s));
  }
  // domingo: resumo da semana
  if (prefs.weekly !== false && new Date(Date.parse(today + 'T12:00:00Z')).getUTCDay() === 0) await say(env, owner, weekText(s));
}
function weekText(s) {
  const w = s.week;
  if (!w) return '<b>📆 Resumo da semana</b>\nAbra o app para eu montar o resumo.';
  let out = '<b>📆 Sua semana</b> (' + fmtDate(w.from) + ' a ' + fmtDate(w.to) + ')\n' +
    '\n⬇️ Entrou: <b>' + brl(w.in) + '</b>\n⬆️ Saiu: <b>' + brl(w.out) + '</b>' +
    '\n' + (w.in - w.out >= 0 ? '🟢 Sobrou ' : '🔴 Faltou ') + '<b>' + brl(Math.abs(w.in - w.out)) + '</b>';
  if ((w.topCats || []).length) out += '\n\n<b>Onde mais gastou</b>\n' + w.topCats.map(c => '• ' + esc(c.name) + ': ' + brl(c.amount)).join('\n');
  if ((w.received || []).length) out += '\n\n<b>Quem te pagou</b>\n' + w.received.map(r => '• ' + esc(r.name) + ': ' + brl(r.amount)).join('\n');
  if ((w.late || []).length) out += '\n\n<b>Ainda atrasados</b>\n' + w.late.map(r => '• ' + esc(r.name) + ': ' + brl(r.amount)).join('\n');
  if (w.next && w.next.count) out += '\n\n<b>Próximos 7 dias</b>: ' + w.next.count + ' vencimento(s)' + (w.next.in ? ', entra ' + brl(w.next.in) : '') + (w.next.out ? ', sai ' + brl(w.next.out) : '');
  if ((w.goals || []).length) out += '\n\n🎯 ' + w.goals.map(g => esc(g.name) + ' ' + g.pct + '%').join(' · ');
  return out + stale(s);
}

// ---------------------------------------------------------------- /cobrar
function findCharge(summary, q) {
  const list = (summary && summary.charges) || [];
  q = norm(q);
  if (!q) return null;
  return list.find(c => c.key === q) || list.find(c => norm(c.name) === q) ||
    (list.filter(c => norm(c.name).split(' ')[0] === q).length === 1 ? list.find(c => norm(c.name).split(' ')[0] === q) : null) ||
    (list.filter(c => norm(c.name).includes(q)).length === 1 ? list.find(c => norm(c.name).includes(q)) : null);
}
async function cobrar(env, chat, summary, who, fromButton) {
  if (!summary) return say(env, chat, 'Ainda não tenho dados.' + stale(summary));
  const list = summary.charges || [];
  if (!list.length) return say(env, chat, 'Ninguém te deve nada agora. 🎉' + stale(summary));
  const c = findCharge(summary, who);
  if (!c) {
    const rows = list.slice(0, 12).map(x => [{
      text: x.name + ' · ' + brl(x.late || x.remaining) + (x.late ? ' atrasado' : ''),
      callback_data: ('cobrar:' + x.key).slice(0, 64)
    }]);
    return say(env, chat, (who && !fromButton ? 'Não achei "' + esc(who) + '". ' : '') + 'Quem você quer cobrar?', {reply_markup: {inline_keyboard: rows}});
  }
  const buttons = [];
  if (c.phone) buttons.push([{text: '💬 Abrir no WhatsApp', url: 'https://wa.me/' + c.phone + '?text=' + encodeURIComponent(c.text)}]);
  else buttons.push([{text: '💬 Escolher conversa no WhatsApp', url: 'https://wa.me/?text=' + encodeURIComponent(c.text)}]);
  if (c.link) buttons.push([{text: '🔗 Ver o link de cobrança', url: c.link}]);
  const fr = await friendFor(env, c.key);
  if (fr) buttons.push([{text: '📨 Mandar lembrete pro ' + c.name.split(' ')[0] + ' no Telegram', callback_data: ('remind:' + c.key).slice(0, 64)}]);
  await say(env, chat, '<b>Cobrança para ' + esc(c.name) + '</b> · ' + brl(c.remaining) + ' em aberto' + (c.late ? ', ' + brl(c.late) + ' atrasado' : '') +
    '\n<i>Encaminhe a mensagem abaixo ou use o botão.</i>' + stale(summary));
  // a mensagem vai sem formatação, pronta para encaminhar
  return tg(env, 'sendMessage', {chat_id: chat, text: c.text, disable_web_page_preview: true, reply_markup: {inline_keyboard: buttons}});
}

// ---------------------------------------------------------------- lembretes para quem te deve
// O app cria um convite por pessoa (snapshot.invites[chave] = {code, on}). A pessoa abre
// t.me/<seu bot>?start=<code>, aperta Começar e passa a receber os lembretes. friends[chave] = {chat, code, at, name}
async function friendFor(env, key) {
  const [friends, snap] = await Promise.all([getJSON(env, 'friends', {}), getJSON(env, 'snapshot', null)]);
  const fr = friends[key], iv = snap && snap.invites && snap.invites[key];
  return fr && iv && iv.code === fr.code ? {...fr, on: iv.on !== false} : null;
}
async function friendByChat(env, chat) {
  const friends = await getJSON(env, 'friends', {});
  const key = Object.keys(friends).find(k => friends[k].chat === chat);
  return key ? {key, ...friends[key]} : null;
}
const firstOf = n => String(n || '').trim().split(/\s+/)[0] || '';
function friendText(c, kind, owner) {
  const who = owner ? '<b>' + esc(owner) + '</b>' : 'quem te emprestou';
  let out = '👋 Oi, ' + esc(firstOf(c.name)) + '! ';
  if (kind === 'late') out += 'Lembrete de ' + who + ': tem <b>' + brl(c.late) + '</b> atrasado' + (c.lateSince ? ' desde ' + fmtDate(c.lateSince) : '') + '.';
  else if (kind === 'today') out += 'Lembrete de ' + who + ': <b>hoje</b> vence <b>' + brl(c.next.amount) + '</b>.';
  else if (kind === 'tomorrow') out += 'Lembrete de ' + who + ': <b>amanhã</b> (' + fmtDate(c.next.date) + ') vence <b>' + brl(c.next.amount) + '</b>.';
  else {
    out += 'Resumo com ' + who + ':';
    if (c.late > 0) out += '\n⏰ Atrasado: <b>' + brl(c.late) + '</b>' + (c.lateSince ? ' (desde ' + fmtDate(c.lateSince) + ')' : '');
    if (c.next && !(c.late > 0 && c.next.date < todayBR())) out += '\n📅 Próximo: <b>' + brl(c.next.amount) + '</b> em ' + fmtDate(c.next.date);
  }
  out += '\nEm aberto no total: ' + brl(c.remaining) + '.';
  return out;
}
async function sendFriend(env, fr, c, kind, s) {
  let text = friendText(c, kind, s.owner);
  if (s.pix) text += '\n\nPIX: <code>' + esc(s.pix) + '</code>';
  text += '\n\n<i>Mensagem automática. Já pagou? Avise ' + (s.owner ? esc(firstOf(s.owner)) : 'quem te mandou') + '. Para não receber mais: /parar</i>';
  const extra = c.link ? {reply_markup: {inline_keyboard: [[{text: '🔗 Ver detalhes e pagar com PIX', url: c.link}]]}} : {};
  const r = await tg(env, 'sendMessage', {chat_id: fr.chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra});
  return r;
}
async function remindFriend(env, key, kind) {
  const s = await getJSON(env, 'summary', null);
  const c = s && (s.charges || []).find(x => x.key === key);
  if (!c) return {ok: false, error: 'Não tem nada em aberto com essa pessoa.'};
  const fr = await friendFor(env, key);
  if (!fr) return {ok: false, error: firstOf(c.name) + ' ainda não entrou nos lembretes.'};
  const r = await sendFriend(env, fr, c, kind, s);
  if (!r.ok) return {ok: false, error: 'O Telegram não entregou (' + (r.description || 'erro') + ').'};
  return {ok: true, name: firstOf(c.name)};
}
async function friendMessage(env, chat, msg, code) {
  const friends = await getJSON(env, 'friends', {});
  const owner = await env.BB.get('owner');
  const s = await getJSON(env, 'summary', null);
  const ownerName = s && s.owner ? firstOf(s.owner) : '';
  const text = String(msg.text || '').trim();
  if (code) {
    const snap = await getJSON(env, 'snapshot', null);
    const inv = (snap && snap.invites) || {};
    const key = Object.keys(inv).find(k => inv[k].code === code);
    if (!key) { await say(env, chat, 'Esse convite não vale mais. Peça um novo para quem te mandou.'); return; }
    Object.keys(friends).forEach(k => { if (friends[k].chat === chat && k !== key) delete friends[k]; });
    const isNew = !friends[key] || friends[key].chat !== chat || friends[key].code !== code;
    const name = [msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(' ');
    friends[key] = {chat, code, at: new Date().toISOString(), name, sent: {}};
    await putJSON(env, 'friends', friends);
    const c = s && (s.charges || []).find(x => x.key === key);
    await say(env, chat, '✅ Pronto! Você vai receber aqui os lembretes do que está em aberto' + (ownerName ? ' com <b>' + esc(ownerName) + '</b>' : '') +
      ': na véspera e no dia do vencimento, e a cada 3 dias se atrasar.' + (c ? '\n\n' + friendText(c, 'status', s.owner) : '') +
      '\n\n/status mostra quanto está em aberto. /parar para não receber mais.');
    if (isNew && owner) {
      const who = c ? c.name : (name || 'Alguém');
      await say(env, owner, '📨 <b>' + esc(who) + '</b> entrou nos lembretes do Telegram. O bot avisa na véspera e no dia do vencimento (e a cada 3 dias se atrasar).');
    }
    return;
  }
  const me = Object.keys(friends).find(k => friends[k].chat === chat);
  if (!me) { await say(env, chat, 'Este bot é privado.'); return; }
  const c = s && (s.charges || []).find(x => x.key === me);
  if (/^\/(parar|stop|sair)\b/i.test(text)) {
    delete friends[me];
    await putJSON(env, 'friends', friends);
    await say(env, chat, 'Pronto, você não recebe mais lembretes. Se mudar de ideia, é só abrir o convite de novo.');
    if (owner) await say(env, owner, '🔕 <b>' + esc(c ? c.name : me) + '</b> saiu dos lembretes do Telegram.');
    return;
  }
  if (/^\/(status|resumo|start)\b/i.test(text)) {
    await say(env, chat, c ? friendText(c, 'status', s.owner) + (s.pix ? '\n\nPIX: <code>' + esc(s.pix) + '</code>' : '') : 'Nada em aberto agora. 🎉', c && c.link ? {reply_markup: {inline_keyboard: [[{text: '🔗 Ver detalhes', url: c.link}]]}} : undefined);
    return;
  }
  await say(env, chat, 'Este bot só manda os lembretes' + (ownerName ? ' de ' + esc(ownerName) : '') + '. Para falar com ' + (ownerName ? esc(ownerName) : 'a pessoa') + ', mande mensagem direto.\n\n/status mostra quanto está em aberto. /parar para não receber mais.');
}
// todo dia às 9h: véspera, dia do vencimento e, se atrasado, a cada 3 dias
async function friendReminders(env) {
  const [friends, snap, s, owner] = await Promise.all([getJSON(env, 'friends', {}), getJSON(env, 'snapshot', null), getJSON(env, 'summary', null), env.BB.get('owner')]);
  if (!s || !snap || !Object.keys(friends).length) return;
  const today = todayBR(), tomorrow = addDays(today, 1), inv = snap.invites || {}, done = [];
  let dirty = false;
  for (const key of Object.keys(friends)) {
    const fr = friends[key], iv = inv[key];
    if (!iv || iv.code !== fr.code || iv.on === false) continue;
    const c = (s.charges || []).find(x => x.key === key);
    if (!c) continue;
    fr.sent = fr.sent || {};
    let kind = null;
    if (c.late > 0) { if (!fr.sent.late || addDays(fr.sent.late, 3) <= today) kind = 'late'; }
    else if (c.next && c.next.date === today) kind = 'today';
    else if (c.next && c.next.date === tomorrow) kind = 'tomorrow';
    if (!kind || fr.sent.day === today) continue;
    const r = await sendFriend(env, fr, c, kind, s);
    if (r.ok) {
      fr.sent.day = today;
      if (kind === 'late') fr.sent.late = today;
      done.push(esc(firstOf(c.name)) + ' (' + (kind === 'late' ? 'atrasado' : kind === 'today' ? 'vence hoje' : 'vence amanhã') + ')');
    } else if (r.error_code === 403) {
      delete friends[key];
      if (owner) await say(env, owner, '🔕 <b>' + esc(c.name) + '</b> bloqueou o bot e não recebe mais lembretes.');
    }
    dirty = true;
  }
  if (dirty) await putJSON(env, 'friends', friends);
  if (owner && done.length) await say(env, owner, '📨 Lembrete enviado no Telegram: ' + done.join(', ') + '.');
}

// ---------------------------------------------------------------- links de cobrança (páginas públicas, só leitura)
async function saveShares(env, shares) {
  const old = await getJSON(env, 'shareIndex', []);
  const now = Object.keys(shares).filter(t => /^[A-Za-z0-9]{16,40}$/.test(t) && shares[t] && typeof shares[t] === 'object').slice(0, 300);
  for (const t of now) await putIfChanged(env, 'share:' + t, shares[t], ['updatedAt']);
  for (const t of old) if (!now.includes(t) && env.BB.delete) await env.BB.delete('share:' + t);
  if (JSON.stringify(old) !== JSON.stringify(now)) await putJSON(env, 'shareIndex', now);
}
const fmtFull = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4) : '';
const STATE = {paga: ['Paga', 'ok'], pago: ['Pagou', 'ok'], atrasada: ['Atrasada', 'late'], atrasado: ['Atrasado', 'late'], parcial: ['Parcial', 'part'], aberta: ['Em aberto', ''], pendente: ['Falta pagar', '']};
const BOT_UA = /bot|crawler|spider|preview|whatsapp|facebookexternalhit|telegram|twitter|slack|discord|skype|linkedin|embedly|quora|pinterest|vkshare|w3c_validator/i;
async function shareRoute(req, url, env, ctx) {
  const parts = url.pathname.split('/').filter(Boolean); // ['s', token, ...]
  const token = String(parts[1] || '').replace(/[^A-Za-z0-9]/g, '');
  const v = token ? await getJSON(env, 'share:' + token, null) : null;
  if (parts[2] === 'pix.json' && req.method === 'GET') {
    if (!v || !v.pixInfo) return json({error: 'no pix'}, 404);
    const amt = Math.max(0, Math.min(100000, parseFloat(url.searchParams.get('v')) || 0));
    const code = pixCode({...v.pixInfo, amount: amt, txid: 'BB' + token.slice(0, 10)});
    return json({code, svg: qrSvg(code)});
  }
  if (parts[2] === 'pago' && req.method === 'POST') return claimCreate(req, env, token, v);
  if (parts.length > 2) return json({error: 'not found'}, 404);
  if (!v) return page('Link desativado', '<div class="card center"><h1>Link desativado</h1><p class="muted">Este link de cobrança não existe mais. Peça um novo para quem te mandou.</p></div>', '', 404);
  if (!BOT_UA.test(req.headers.get('User-Agent') || '') && ctx && ctx.waitUntil) ctx.waitUntil(trackView(env, token, v).catch(() => {}));
  return sharePage(env, token, v);
}
async function trackView(env, token, v) {
  const now = new Date().toISOString();
  const rec = await getJSON(env, 'views:' + token, {count: 0, first: now, last: now, notified: ''});
  rec.count++; rec.last = now;
  const owner = await env.BB.get('owner');
  if (owner && (!rec.notified || Date.now() - Date.parse(rec.notified) > 6 * 3600000)) {
    rec.notified = now;
    const who = v.type === 'group' ? 'Alguém abriu o link do grupo <b>' + esc(v.title) + '</b>' : '<b>' + esc(v.name) + '</b> abriu o link de cobrança';
    await say(env, owner, '👀 ' + who + (rec.count > 1 ? ' (' + rec.count + 'ª vez)' : '') + '.');
  }
  await putJSON(env, 'views:' + token, rec);
}
function pixBlock(token, v, amount, owner) {
  if (!v.pixInfo && !v.pix) return '';
  if (!v.pixInfo) return '<div class="card pix"><div><span class="muted">PIX de ' + owner + '</span><code id="pix">' + esc(v.pix) + '</code></div><button onclick="copyEl(\'pix\',this)">Copiar</button></div>';
  const code = pixCode({...v.pixInfo, amount, txid: 'BB' + token.slice(0, 10)});
  return '<div class="card paybox"><h2>Pagar com PIX</h2>' +
    (v.type === 'group' ? '<label class="lbl" for="who">Quem está pagando</label><select id="who">' + v.members.map((m, i) => m.remaining > 0 ? '<option value="' + i + '" data-amt="' + m.remaining.toFixed(2) + '">' + esc(m.name) + ' · ' + brl(m.remaining) + '</option>' : '').join('') + '</select>' : '') +
    '<label class="lbl" for="amt">Valor</label><div class="amt"><span>R$</span><input id="amt" inputmode="decimal" autocomplete="off" value="' + amount.toFixed(2).replace('.', ',') + '"></div>' +
    '<div class="qr"><img id="qr" alt="QR Code do PIX" src="data:image/svg+xml;base64,' + btoa(qrSvg(code)) + '"></div>' +
    '<div class="cc"><code id="cc">' + esc(code) + '</code></div>' +
    '<button class="wide" onclick="copyEl(\'cc\',this)">Copiar código PIX</button>' +
    '<p class="muted small center-t">No app do banco: PIX → <b>Copia e cola</b> (ou leia o QR). Vai pra ' + owner + ', chave ' + esc(v.pix) + '.</p></div>';
}
function paidBlock(v, claims) {
  const list = claims.map(c => '<div class="row slim"><span class="cl ' + c.status + '">' + (c.status === 'ok' ? '✓' : c.status === 'no' ? '✕' : '⏳') + '</span><div class="grow"><b>' + brl(c.amount) + (c.whoName && v.type === 'group' ? ' · ' + esc(c.whoName) : '') + '</b><span class="muted">informado em ' + fmtFull(c.at.slice(0, 10)) +
    (c.status === 'ok' ? ' · confirmado' : c.status === 'no' ? ' · não encontrado, fale com quem te mandou' : ' · aguardando confirmação') + '</span></div></div>').join('');
  return '<div class="card"><h2>Já pagou?</h2><p class="muted small">Avise aqui e mande o comprovante. O pagamento entra quando for confirmado.</p>' +
    (list ? '<div class="claims">' + list + '</div>' : '') +
    '<button class="wide ghost" id="paidOpen" onclick="document.getElementById(\'paidForm\').hidden=false;this.hidden=true">Já paguei · mandar comprovante</button>' +
    '<form id="paidForm" hidden onsubmit="return sendPaid(event)">' +
    (v.type === 'group' ? '<label class="lbl" for="pwho">Quem pagou</label><select id="pwho">' + v.members.map((m, i) => m.remaining > 0 ? '<option value="' + i + '" data-amt="' + m.remaining.toFixed(2) + '">' + esc(m.name) + '</option>' : '').join('') + '</select>' : '') +
    '<label class="lbl" for="pamt">Quanto pagou</label><div class="amt"><span>R$</span><input id="pamt" inputmode="decimal" autocomplete="off" required></div>' +
    '<label class="lbl" for="pfile">Comprovante (foto ou print)</label><input id="pfile" type="file" accept="image/*">' +
    '<label class="lbl" for="pnote">Mensagem (opcional)</label><input id="pnote" maxlength="140" placeholder="Ex: paguei a parcela de outubro">' +
    '<button class="wide" id="psend" type="submit">Enviar</button><p class="muted small" id="pmsg"></p></form></div>';
}
async function sharePage(env, token, v) {
  const owner = v.owner ? esc(v.owner) : 'quem te mandou';
  const claims = await claimsFor(env, token);
  const upd = '<p class="foot">Atualizado em ' + fmtFull((v.updatedAt || '').slice(0, 10)) + ' · BarnaBank</p>';
  const open = v.type === 'group' ? v.remaining > 0 : v.remaining > 0;
  const suggest = v.type === 'group' ? ((v.members.find(m => m.remaining > 0) || {}).remaining || 0) : (v.suggest || v.remaining || 0);
  const pay = open ? pixBlock(token, v, suggest, owner) + paidBlock(v, claims) : (claims.length ? paidBlock(v, claims) : '');
  const script = '<script>var TK=' + JSON.stringify(token) + ';' + PAGE_JS + '</script>';
  if (v.type === 'group') {
    const pct = v.owed > 0 ? Math.min(100, Math.round(v.paid / v.owed * 100)) : 0;
    const done = v.members.filter(m => m.state === 'pago').length;
    const segs = v.members.map(m => '<span class="seg ' + m.state + '" style="flex:' + Math.max(m.total, 0.01) + '"><i style="width:' + (m.total > 0 ? Math.min(100, m.paid / m.total * 100) : 100) + '%"></i></span>').join('');
    const rows = v.members.map(m => {
      const st = STATE[m.state] || ['', ''];
      return '<div class="row"><span class="av ' + m.state + '">' + esc(initials(m.name)) + '</span><div class="grow"><b>' + esc(m.name) + '</b><span class="muted">parte de ' + brl(m.total) + (m.paid > 0 && m.state !== 'pago' ? ' · já pagou ' + brl(m.paid) : '') + '</span></div>' +
        '<span class="tag ' + st[1] + '">' + (m.state === 'pago' ? '✓ Pagou' : (m.state === 'atrasado' ? 'Atrasado · ' : 'Falta ') + brl(m.remaining)) + '</span></div>';
    }).join('');
    const body = '<div class="card hero"><span class="muted">' + owner + ' dividiu</span><h1>' + esc(v.title) + '</h1>' +
      '<p class="muted">' + fmtFull(v.date) + (v.dueDate ? ' · pagar até <b>' + fmtFull(v.dueDate) + '</b>' : '') + '</p>' +
      '<div class="big"><b>' + brl(v.paid) + '</b> <span class="muted">de ' + brl(v.owed) + ' já pago</span><span class="pct">' + pct + '%</span></div>' +
      '<div class="bar">' + segs + '</div>' +
      '<p class="muted small">' + done + ' de ' + v.members.length + ' já pagaram' + (v.myShare > 0 ? ' · conta total ' + brl(v.total) + ', a parte de ' + owner + ' é ' + brl(v.myShare) : '') + '</p></div>' +
      '<div class="card">' + rows + '</div>' + pay + upd + script;
    return page(v.title, body, 'Faltam ' + brl(v.remaining) + ' · ' + done + ' de ' + v.members.length + ' já pagaram');
  }
  const debts = (v.debts || []).map(d => {
    const insts = (d.insts || []).map(it => {
      const st = STATE[it.state] || ['', ''];
      return '<div class="row slim"><span class="n">' + it.n + 'ª</span><div class="grow"><b>' + brl(it.value) + '</b><span class="muted">vence ' + fmtFull(it.due) + (it.open > 0 && it.open < it.value - 0.005 ? ' · falta ' + brl(it.open) : '') + '</span></div><span class="tag ' + st[1] + '">' + st[0] + '</span></div>';
    }).join('');
    const pays = (d.payments || []).slice(0, 8).map(p => '<div class="row slim"><span class="muted">' + fmtFull(p.date) + '</span><div class="grow"></div><b class="okc">' + brl(p.amount) + '</b></div>').join('');
    return '<div class="card"><div class="dh"><div><h2>' + esc(d.title) + '</h2><span class="muted">desde ' + fmtFull(d.date) + (d.due ? ' · vence ' + fmtFull(d.due) : '') + '</span></div>' +
      '<div class="right"><b class="' + (d.late > 0 ? 'latec' : '') + '">' + brl(d.remaining) + '</b><span class="muted">em aberto</span></div></div>' +
      '<div class="prog"><i style="width:' + (d.total > 0 ? Math.min(100, d.paid / d.total * 100) : 0) + '%"></i></div>' +
      '<p class="muted small">Total ' + brl(d.total) + ' · já pago ' + brl(d.paid) + (d.late > 0 ? ' · <span class="latec">' + brl(d.late) + ' atrasado</span>' : '') + '</p>' +
      (insts ? '<h3>Parcelas</h3>' + insts : '') + (pays ? '<h3>Pagamentos</h3>' + pays : '') + '</div>';
  }).join('');
  const hero = '<div class="card hero"><span class="muted">Oi, ' + esc(v.name) + '!</span>' +
    (v.remaining > 0
      ? '<h1>' + brl(v.remaining) + '</h1><p class="muted">em aberto com ' + owner + (v.late > 0 ? ' · <span class="latec">' + brl(v.late) + ' atrasado</span>' : '') + '</p>'
      : '<h1>Tudo quitado 🎉</h1><p class="muted">Você não deve nada para ' + owner + '. Valeu!</p>') +
    (v.doneCount ? '<p class="muted small">' + v.doneCount + ' dívida(s) já quitada(s), ' + brl(v.donePaid) + ' pagos.</p>' : '') + '</div>';
  return page('Resumo para ' + v.name, hero + pay + debts + upd + script, v.remaining > 0 ? brl(v.remaining) + ' em aberto' : 'Tudo quitado');
}
const PAGE_JS = `
function copyEl(id,b){var t=document.getElementById(id).textContent;var done=function(){b.textContent="Copiado ✓";setTimeout(function(){b.textContent=b.getAttribute("data-l")||"Copiar"},2500)};b.setAttribute("data-l",b.getAttribute("data-l")||b.textContent);(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(done,function(){var r=document.createRange();r.selectNode(document.getElementById(id));getSelection().removeAllRanges();getSelection().addRange(r);b.textContent="Selecionado: copie"})}
function num(s){s=String(s||"").replace(/[^0-9,\\.]/g,"");if(s.indexOf(",")>=0)s=s.replace(/\\./g,"").replace(",",".");var v=parseFloat(s);return isNaN(v)?0:v}
var amt=document.getElementById("amt"),tm;
function upd(){clearTimeout(tm);tm=setTimeout(function(){fetch("/s/"+TK+"/pix.json?v="+num(amt.value)).then(function(r){return r.json()}).then(function(j){if(!j.code)return;document.getElementById("cc").textContent=j.code;document.getElementById("qr").src="data:image/svg+xml;base64,"+btoa(j.svg)})},350)}
if(amt)amt.addEventListener("input",upd);
var who=document.getElementById("who");if(who)who.addEventListener("change",function(){amt.value=who.options[who.selectedIndex].getAttribute("data-amt").replace(".",",");upd()});
var pwho=document.getElementById("pwho"),pamt=document.getElementById("pamt");
function syncP(){if(pwho&&pamt)pamt.value=pwho.options[pwho.selectedIndex].getAttribute("data-amt").replace(".",",")}
if(pwho){pwho.addEventListener("change",syncP);syncP()}else if(pamt&&amt){pamt.value=amt.value}
function shrink(f){return new Promise(function(res){if(!f)return res("");var u=URL.createObjectURL(f),i=new Image();i.onload=function(){var k=Math.min(1,1400/Math.max(i.naturalWidth,i.naturalHeight)),c=document.createElement("canvas");c.width=Math.round(i.naturalWidth*k);c.height=Math.round(i.naturalHeight*k);var x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL("image/jpeg",0.72))};i.onerror=function(){res("")};i.src=u})}
function sendPaid(e){e.preventDefault();var b=document.getElementById("psend"),m=document.getElementById("pmsg"),v=num(pamt.value);if(!(v>0)){m.textContent="Informe o valor.";return false}b.disabled=true;b.textContent="Enviando…";
shrink(document.getElementById("pfile").files[0]).then(function(photo){return fetch("/s/"+TK+"/pago",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:v,note:document.getElementById("pnote").value,who:pwho?+pwho.value:null,photo:photo})})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){if(x.ok){document.getElementById("paidForm").innerHTML='<p class="okmsg">✓ Enviado! Assim que for confirmado, aparece aqui.</p>';setTimeout(function(){location.reload()},2500)}else{m.textContent=x.j.error||"Não deu certo, tente de novo.";b.disabled=false;b.textContent="Enviar"}}).catch(function(){m.textContent="Sem conexão, tente de novo.";b.disabled=false;b.textContent="Enviar"});return false}
`;

// ---------------------------------------------------------------- "Já paguei" (pedidos de confirmação)
async function claimsFor(env, token) {
  const ids = await getJSON(env, 'claims', []);
  const out = [];
  for (const id of ids.slice(-60).reverse()) {
    const c = await getJSON(env, 'claim:' + id, null);
    if (c && c.token === token && (c.status === 'pending' || Date.now() - Date.parse(c.at) < 15 * 86400000)) out.push(c);
    if (out.length >= 6) break;
  }
  return out;
}
async function claimCreate(req, env, token, v) {
  if (!v) return json({error: 'Link desativado.'}, 404);
  const rate = await getJSON(env, 'crate:' + token, {n: 0, t: 0});
  if (Date.now() - rate.t > 3600000) { rate.n = 0; rate.t = Date.now(); }
  if (rate.n >= 5) return json({error: 'Muitos envios seguidos. Tente de novo em uma hora.'}, 429);
  const body = await req.json().catch(() => null);
  if (!body) return json({error: 'Envio inválido.'}, 400);
  const amount = Math.round((+body.amount || 0) * 100) / 100;
  if (!(amount > 0 && amount <= 100000)) return json({error: 'Valor inválido.'}, 400);
  let who = null, whoName = '';
  if (v.type === 'group') {
    who = +body.who;
    if (!(who >= 0 && who < v.members.length)) return json({error: 'Escolha quem pagou.'}, 400);
    whoName = v.members[who].name;
  }
  const photo = typeof body.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(body.photo) && body.photo.length < 4.5 * 1024 * 1024 ? body.photo : '';
  rate.n++; await putJSON(env, 'crate:' + token, rate);
  const id = 'cl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const claim = {id, token, at: new Date().toISOString(), amount, note: String(body.note || '').slice(0, 140), who, whoName, status: 'pending', hasPhoto: !!photo,
    label: v.type === 'group' ? whoName + ' · ' + v.title : v.name, linkName: v.type === 'group' ? v.title : v.name};
  if (photo) await env.BB.put('cphoto:' + id, photo, {expirationTtl: 60 * 60 * 24 * 45});
  const ids = await getJSON(env, 'claims', []);
  ids.push(id);
  await putJSON(env, 'claims', ids.slice(-200));
  const owner = await env.BB.get('owner');
  if (owner) {
    const text = '💸 <b>' + esc(claim.label) + '</b> diz que pagou <b>' + brl(amount) + '</b>' + (claim.note ? '\n“' + esc(claim.note) + '”' : '') + (photo ? '' : '\n<i>(sem comprovante)</i>') + '\n\nConfere no banco e confirma:';
    const kb = {inline_keyboard: [[{text: '✅ Recebi', callback_data: 'claim:ok:' + id}, {text: '❌ Não recebi', callback_data: 'claim:no:' + id}]]};
    let r;
    if (photo) {
      const b64 = photo.split(',')[1], bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const fd = new FormData();
      fd.append('chat_id', owner); fd.append('caption', text); fd.append('parse_mode', 'HTML'); fd.append('reply_markup', JSON.stringify(kb));
      fd.append('photo', new Blob([bytes], {type: 'image/jpeg'}), 'comprovante.jpg');
      try { r = await (await fetch('https://api.telegram.org/bot' + TOKEN(env) + '/sendPhoto', {method: 'POST', body: fd})).json(); } catch (e) { r = {ok: false}; }
    } else r = await say(env, owner, text, {reply_markup: kb});
    if (r && r.ok && r.result) { claim.tg = {chat: owner, msg: r.result.message_id, photo: !!photo}; }
  }
  await putJSON(env, 'claim:' + id, claim);
  return json({ok: true});
}
// confirmar ou recusar (pelo Telegram ou pelo app)
async function claimDecide(env, id, ok) {
  const c = await getJSON(env, 'claim:' + id, null);
  if (!c) return {error: 'não encontrado'};
  if (c.status !== 'pending') return {already: c.status};
  const v = await getJSON(env, 'share:' + c.token, null);
  c.status = ok ? 'ok' : 'no';
  c.decidedAt = new Date().toISOString();
  if (ok) {
    const ref = (v && v._ref) || {};
    const op = {type: 'pay', kind: 'receivable', amount: c.amount, date: todayBR(), at: c.decidedAt, text: 'pagamento informado pelo link (' + c.label + ')',
      id: 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), viaLink: true};
    if (ref.type === 'group' && ref.members && ref.members[c.who]) { op.debtId = ref.members[c.who].debtId; op.name = ref.members[c.who].name; }
    else if (ref.debtId) { op.debtId = ref.debtId; op.name = ref.name; }
    else op.name = ref.name || c.linkName;
    if (c.hasPhoto) {
      const ph = await env.BB.get('cphoto:' + id);
      if (ph) { await env.BB.put('photo:' + op.id, ph, {expirationTtl: 60 * 60 * 24 * 60}); op.photo = true; }
    }
    const inbox = await getJSON(env, 'inbox', []);
    inbox.push(op);
    await putJSON(env, 'inbox', inbox.slice(-200));
    c.opId = op.id;
  }
  await putJSON(env, 'claim:' + id, c);
  let applied = null;
  if (ok) { const res = await cloudApply(env, e => e.applyOps([op])); applied = res && res[0]; }
  if (c.tg) {
    const note = ok ? '✅ <b>Confirmado</b>: ' + esc(c.label) + ' pagou ' + brl(c.amount) + '.' + (applied && applied.ok ? ' Já está no app.' : ' Entra no app na próxima vez que você abrir.') : '❌ Marcado como não recebido (' + esc(c.label) + ', ' + brl(c.amount) + '). A pessoa vê isso no link.';
    await tg(env, c.tg.photo ? 'editMessageCaption' : 'editMessageText', {chat_id: c.tg.chat, message_id: c.tg.msg, parse_mode: 'HTML', ...(c.tg.photo ? {caption: note} : {text: note})});
  }
  return {ok: true, status: c.status};
}
function initials(n) { const p = String(n || '?').replace(/\./g, '').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function page(title, body, desc, status) {
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<title>' + esc(title) + ' · BarnaBank</title><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc || 'BarnaBank') + '">' +
    '<meta name="theme-color" content="#10152a"><style>' + CSS + '</style></head><body><main>' +
    '<div class="brand"><span class="mark">B</span>BarnaBank</div>' + body + '</main>' +
    '</body></html>';
  return new Response(html, {status: status || 200, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
const CSS = `
*{box-sizing:border-box}body{margin:0;background:radial-gradient(900px 500px at 0% -10%,rgba(201,162,74,.12),transparent 60%),#10152a;color:#eee9da;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;min-height:100vh}
main{max-width:560px;margin:0 auto;padding:20px 16px 40px}.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:#8d94b8;margin:4px 0 16px}
.mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(155deg,#e8cd8a,#c9a24a);color:#1b1404;display:grid;place-items:center;font-weight:800}
.card{background:#1b2242;border:1px solid #2c3560;border-radius:18px;padding:16px;margin-bottom:12px}.center{text-align:center;padding:32px 16px}
.hero h1{font-size:34px;margin:4px 0 2px;line-height:1.15}h1{font-size:24px;margin:6px 0}h2{font-size:16px;margin:0}h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5d6390;margin:16px 0 4px}
.muted{color:#8d94b8;display:block;font-size:13px}.small{font-size:12.5px;margin:8px 0 0}p{margin:4px 0}
.big{display:flex;align-items:baseline;gap:6px;margin:14px 0 8px;flex-wrap:wrap}.big b{font-size:24px;color:#e8cd8a}.big .muted{display:inline}.pct{margin-left:auto;font-weight:700;font-size:18px}
.bar{display:flex;gap:3px;height:9px}.seg{background:#161c38;border-radius:5px;overflow:hidden;min-width:6px}.seg i{display:block;height:100%;background:#c9a24a}.seg.pago i{background:#57b98a}.seg.atrasado{background:rgba(226,102,92,.25)}
.row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #2c3560}.row:first-child{border-top:none}.row.slim{padding:8px 0}.grow{flex:1;min-width:0}.grow b{display:block}
.av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:#c9a24a;color:#10152a;flex-shrink:0}.av.pago{background:#57b98a}.av.atrasado{background:#e2665c}
.tag{font-size:12.5px;font-weight:700;padding:4px 10px;border-radius:999px;background:#161c38;color:#e8cd8a;white-space:nowrap}.tag.ok{color:#57b98a;background:rgba(87,185,138,.12)}.tag.late{color:#e2665c;background:rgba(226,102,92,.12)}.tag.part{color:#e8cd8a}
.n{width:30px;color:#8d94b8;font-weight:700}.dh{display:flex;justify-content:space-between;gap:12px}.right{text-align:right}.right b{font-size:18px}
.prog{height:7px;background:#161c38;border-radius:4px;overflow:hidden;margin-top:12px}.prog i{display:block;height:100%;background:#57b98a}
.okc{color:#57b98a}.latec{color:#e2665c}.pix{display:flex;align-items:center;gap:12px;border-color:rgba(201,162,74,.45)}.pix div{flex:1;min-width:0}.pix code{display:block;font-size:15px;color:#e8cd8a;overflow-wrap:anywhere;margin-top:2px}
button{background:linear-gradient(155deg,#e8cd8a,#c9a24a);color:#1b1404;border:none;border-radius:12px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer}button:disabled{opacity:.6}
.wide{width:100%;margin-top:10px;padding:13px}.ghost{background:#161c38;color:#e8cd8a;border:1px solid rgba(201,162,74,.45)}
.lbl{display:block;font-size:12.5px;color:#8d94b8;margin:12px 0 5px}.amt{display:flex;align-items:center;gap:8px;background:#161c38;border:1px solid #2c3560;border-radius:12px;padding:4px 12px}.amt span{color:#8d94b8;font-weight:700}
input,select{width:100%;background:#161c38;border:1px solid #2c3560;border-radius:12px;color:#eee9da;font:inherit;padding:11px 12px}.amt input{border:none;padding:8px 0;font-size:20px;font-weight:700;background:transparent}.amt input:focus{outline:none}.amt:focus-within{border-color:#c9a24a}input:focus,select:focus{outline:none;border-color:#c9a24a}
input[type=file]{padding:9px}.qr{background:#fff;border-radius:16px;padding:10px;margin:14px auto 10px;width:230px;max-width:80%}.qr img{display:block;width:100%;height:auto}
.cc code{display:block;font-size:11px;color:#8d94b8;background:#161c38;border-radius:10px;padding:9px 10px;overflow-wrap:anywhere;max-height:62px;overflow:hidden}.center-t{text-align:center}
.cl{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;background:#161c38;color:#e8cd8a;flex-shrink:0}.cl.ok{color:#57b98a}.cl.no{color:#e2665c}.claims{margin-top:6px}.okmsg{color:#57b98a;font-weight:700;text-align:center;padding:10px 0}.foot{text-align:center;color:#5d6390;font-size:12px;margin-top:18px}
`;

// ---------------------------------------------------------------- áudio (Workers AI / Whisper)
async function transcribe(env, voice) {
  if (!env.AI) return {error: '🎙️ Para eu entender áudio, o Workers AI precisa estar ligado na sua Cloudflare. Veja "Áudio e perguntas" no README do bot.'};
  if ((voice.duration || 0) > 90) return {error: 'Áudio muito longo. Manda um de até 1 minuto, tipo “gastei 30 no mercado”.'};
  try {
    const f = await tg(env, 'getFile', {file_id: voice.file_id});
    if (!f.ok) return {error: 'Não consegui baixar o áudio.'};
    const r = await fetch('https://api.telegram.org/file/bot' + TOKEN(env) + '/' + f.result.file_path);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const out = await env.AI.run('@cf/openai/whisper', {audio: [...bytes]});
    const text = String(out && out.text || '').trim();
    if (!text) return {error: 'Não consegui entender o áudio. Tenta de novo falando mais perto.'};
    return {text: text.replace(/^\s*r\$\s*/i, '')};
  } catch (e) {
    await putJSON(env, 'lastError', {at: new Date().toISOString(), error: 'áudio: ' + String(e && e.message || e)});
    return {error: 'Não consegui entender o áudio agora. Tenta escrever, que eu entendo do mesmo jeito.'};
  }
}

// ---------------------------------------------------------------- perguntas em português
function findIn(list, q, key) {
  q = norm(q).replace(/^(o|a|os|as)\s+/, '');
  if (!q) return null;
  return list.find(x => norm(x[key]) === q) || list.find(x => norm(x[key]).split(' ')[0] === q) || list.find(x => norm(x[key]).includes(q)) || list.find(x => q.includes(norm(x[key]))) || null;
}
function periodOf(t) {
  if (/mes passado|ultimo mes/.test(t)) return ['prev', 'no mês passado'];
  if (/semana/.test(t)) return ['week', 'nos últimos 7 dias'];
  if (/hoje/.test(t)) return ['today', 'hoje'];
  return ['month', 'este mês'];
}
async function answerQuestion(env, raw, s) {
  const t = norm(raw).replace(/[?!.]+/g, '').replace(/\s+/g, ' ').trim();
  const asks = /^(quanto|quantos|quem|qual|quais|como|onde|quando|cade|me (diz|fala)|tenho|devo)\b/.test(t);
  if (!asks && !(/\?/.test(raw) && /(gast|dev|pag|sald|receb|entr|orcament|meta|dinheiro|divid|conta|cartao|fatura|previs)/.test(t))) return null;
  if (!s) return 'Ainda não tenho os dados. Abra o app uma vez com a nuvem ligada.';
  const st = s.stats || {}, people = s.people || [];
  let m;
  // gastos por categoria
  if ((m = /quanto (?:eu )?(?:gastei|gasto|torrei|paguei)(?: (?:com|de|em|no|na|nos|nas|pro|pra))? (.+?)(?: (?:esse|este|neste|nesse|no) mes| (?:no )?mes passado| (?:nessa|esta|essa|na) semana| hoje)?$/.exec(t)) && !/^(esse|este|no|neste) mes$/.test(m[1])) {
    const [p, label] = periodOf(t);
    const cats = (st.cats && st.cats[p]) || {};
    const names = Object.keys(cats);
    const hit = names.filter(n => norm(n).includes(norm(m[1])) || norm(m[1]).includes(norm(n)));
    if (!hit.length) {
      const top = names.sort((a, b) => cats[b] - cats[a]).slice(0, 5).map(n => esc(n) + ' ' + brl(cats[n])).join(', ');
      return 'Não achei gastos com “' + esc(m[1]) + '” ' + label + '.' + (top ? '\nOnde você mais gastou: ' + top + '.' : '');
    }
    const sum = hit.reduce((a, n) => a + cats[n], 0);
    return '💸 Com <b>' + esc(hit.join(', ')) + '</b> você gastou <b>' + brl(sum) + '</b> ' + label + '.' + (p === 'month' && st.cats && st.cats.prev ? (() => { const prev = hit.reduce((a, n) => a + (st.cats.prev[n] || 0), 0); return prev > 0 ? '\nMês passado: ' + brl(prev) + '.' : ''; })() : '');
  }
  if (/quanto (?:eu )?(?:gastei|gasto)/.test(t)) {
    const [p, label] = periodOf(t);
    const tot = st.out && st.out[p] != null ? st.out[p] : null;
    if (tot == null) return null;
    const cats = (st.cats && st.cats[p]) || {};
    const top = Object.keys(cats).sort((a, b) => cats[b] - cats[a]).slice(0, 3).map(n => esc(n) + ' ' + brl(cats[n])).join(', ');
    return '💸 Você gastou <b>' + brl(tot) + '</b> ' + label + '.' + (top ? '\nMais em: ' + top + '.' : '');
  }
  if (/quanto (?:eu )?(?:ganhei|recebi|entrou)/.test(t) && !/(do|da|de) [a-z]/.test(t.replace(/(esse|este|no|neste) mes|mes passado/, ''))) {
    const [p, label] = periodOf(t);
    return st.in && st.in[p] != null ? '⬇️ Entrou <b>' + brl(st.in[p]) + '</b> ' + label + '.' : null;
  }
  // pessoas
  if (/quem (?:mais )?(?:me )?deve mais|quem (?:mais )?me deve/.test(t)) {
    const list = people.filter(p => p.rec > 0).sort((a, b) => b.rec - a.rec).slice(0, 5);
    return list.length ? '🤝 <b>Quem mais te deve</b>\n' + list.map((p, i) => (i + 1) + '. ' + esc(p.name) + ': ' + brl(p.rec) + (p.late > 0 ? ' (' + brl(p.late) + ' atrasado)' : '')).join('\n') : 'Ninguém te deve nada agora. 🎉';
  }
  if (/quem (?:ta|esta|tá|está) atrasad|quem atras/.test(t)) return atrasadosText(s);
  if ((m = /quanto (?:o |a )?(.+?) (?:ja )?(?:me )?pagou/.exec(t))) {
    const p = findIn(people, m[1], 'name');
    if (!p) return 'Não achei “' + esc(m[1]) + '” nas suas dívidas.';
    return '✅ <b>' + esc(p.name) + '</b> já te pagou <b>' + brl(p.paid || 0) + '</b>' + (p.paidMonth ? ' (' + brl(p.paidMonth) + ' este mês)' : '') + '.' + (p.rec > 0 ? '\nAinda falta ' + brl(p.rec) + '.' : '');
  }
  if ((m = /quanto (?:o |a )?(.+?) (?:ainda )?me deve/.exec(t))) {
    const p = findIn(people, m[1], 'name');
    if (!p) return 'Não achei “' + esc(m[1]) + '” nas suas dívidas.';
    return p.rec > 0 ? '🤝 <b>' + esc(p.name) + '</b> te deve <b>' + brl(p.rec) + '</b>' + (p.late > 0 ? ', ' + brl(p.late) + ' atrasado' : '') + '.' : '<b>' + esc(p.name) + '</b> não te deve nada. 🎉';
  }
  if ((m = /quanto (?:eu )?devo(?: (?:pro|pra|para|ao|a|à) (.+))?/.exec(t))) {
    if (m[1]) { const p = findIn(people, m[1], 'name'); return p ? 'Você deve <b>' + brl(p.pay) + '</b> a ' + esc(p.name) + '.' : 'Não achei “' + esc(m[1]) + '”.'; }
    const list = people.filter(p => p.pay > 0);
    return list.length ? '💸 Você deve <b>' + brl(list.reduce((a, p) => a + p.pay, 0)) + '</b>:\n' + list.map(p => '• ' + esc(p.name) + ': ' + brl(p.pay)).join('\n') : 'Você não deve nada pra ninguém. 🎉';
  }
  if (/saldo|quanto (?:eu )?tenho|dinheiro (?:eu )?tenho/.test(t)) return saldoText(s);
  if (/previsao|vou terminar|fim do mes|sobra(r)? no fim/.test(t) && s.forecast != null) return '🔮 Se tudo correr como combinado, você termina o mês com <b>' + brl(s.forecast) + '</b>.';
  if (/orcamento|limite/.test(t)) {
    const b = s.budgets || [];
    return b.length ? '<b>Orçamento do mês</b>\n' + b.map(x => '• ' + esc(x.name) + ': ' + brl(x.spent) + ' de ' + brl(x.limit) + (x.spent > x.limit ? ' ⚠️' : '')).join('\n') : 'Você ainda não definiu orçamento no app.';
  }
  if (/meta/.test(t)) {
    const g = s.goals || [];
    return g.length ? '<b>🎯 Metas</b>\n' + g.map(x => '• ' + esc(x.name) + ': ' + brl(x.saved) + ' de ' + brl(x.target)).join('\n') : 'Nenhuma meta criada ainda.';
  }
  // fallback: IA (se ligada), só com os seus dados
  if (env.AI) {
    try {
      const ctx = JSON.stringify({hoje: s.today, saldo: s.balance, carteiras: s.wallets, pessoas: people.map(p => ({nome: p.name, me_deve: p.rec, atrasado: p.late, ja_pagou: p.paid, eu_devo: p.pay})),
        gastos: st.cats, entradas: st.in, saidas: st.out, orcamento: s.budgets, metas: s.goals, vencimentos: (s.due || []).slice(0, 15), previsao_fim_do_mes: s.forecast}).slice(0, 12000);
      const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {max_tokens: 220, messages: [
        {role: 'system', content: 'Você é o assistente do app de finanças BarnaBank. Responda em português do Brasil, em no máximo 3 frases curtas, usando SOMENTE os dados JSON do usuário. Valores em reais no formato R$ 1.234,56. Se a resposta não estiver nos dados, diga que não sabe. Não invente números.'},
        {role: 'user', content: 'Dados: ' + ctx + '\n\nPergunta: ' + raw}]});
      const a = String(r && (r.response || r.result) || '').trim();
      if (a) return '🤖 ' + esc(a) + '\n<i>(resposta da IA, confira no app)</i>';
    } catch (e) {}
  }
  return 'Não sei responder isso ainda 🤔 Tenta:\n• <code>quanto gastei com ifood esse mês?</code>\n• <code>quem me deve mais?</code>\n• <code>quanto o Vini já me pagou?</code>\n• <code>quanto eu devo?</code>\n• <code>qual meu saldo?</code>';
}
