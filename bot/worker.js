import {pixCode, qrSvg, qrPng} from './pix.mjs';
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
    {command: 'ultimos', description: 'Últimos lançamentos (para apagar ou corrigir)'},
    {command: 'repetir', description: 'Lança de novo o último gasto'},
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
    for (const id of claimIds.slice(-60)) { const c = await getJSON(env, 'claim:' + id, null); if (c && c.status === 'pending') claims.push({id: c.id, kind: c.kind || 'pago', at: c.at, amount: c.amount, note: c.note, label: c.label, hasPhoto: c.hasPhoto, token: c.token, newDate: c.newDate || '', due: c.due || ''}); }
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
  '• 📎 foto do PIX com a legenda <code>recebi 50 do Vini</code> (vai como comprovante)\n' +
  '• 🧾 foto do cupom fiscal, ou o link do QR Code da nota (vira gasto com loja, valor e data)\n' +
  '• 🏦 encaminhe a notificação do banco (<i>Compra aprovada R$ 45,90 em…</i>)\n' +
  '• 👥 <code>racha 120 do churrasco com Bia e Caio</code> (cria o grupo e o link)\n' +
  '• 🎯 <code>guardei 100 na viagem</code>\n' +
  '• ✏️ <code>na verdade foi 45</code> corrige o último · /ultimos pra apagar\n\n' +
  'Entra no BarnaBank na hora (o app pega quando abrir).\n\n' +
  '/cobrar Fulano: mensagem de cobrança pronta para encaminhar\n' +
  '🎙️ Pode mandar <b>áudio</b> também.\n' +
  '❓ Perguntas: <code>quanto gastei com ifood esse mês?</code>, <code>quem me deve mais?</code>, <code>quanto o Vini já me pagou?</code>\n\n' +
  '/resumo · /atrasados · /semana · /semanal · /saldo · /repetir · /ultimos · /pendentes · /lembretes';

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
  if (up.update_id != null) {
    const seen = await getJSON(env, 'seenUpd', []);
    if (seen.includes(up.update_id)) return;
    seen.push(up.update_id);
    await putJSON(env, 'seenUpd', seen.slice(-60));
  }
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
  if (owner && chat && chat !== owner && /^fr:/.test(cq.data || '')) return friendCallback(env, cq, chat);
  if (!owner || chat !== owner) return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
  const cd = /^claim:(ok|no):(.+)$/.exec(cq.data || '');
  if (cd) {
    const r = await claimDecide(env, cd[2], cd[1] === 'ok');
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: r.already ? 'Já estava resolvido' : cd[1] === 'ok' ? 'Feito' : 'Recusado'});
  }
  const ak = /^ask:([^:]+):(d|w|x)(?::(\w+))?$/.exec(cq.data || '');
  if (ak) return onAsk(env, cq, chat, ak[1], ak[2], ak[3]);
  const rc = /^rcpt:(.+)$/.exec(cq.data || '');
  if (rc) {
    const r = await receiptToFriend(env, rc[1]);
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: r.ok ? 'Recibo enviado pra ' + r.name : r.error, show_alert: !r.ok});
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
  const m = /^undo:([^:]+)(:l)?$/.exec(cq.data || '');
  if (m) {
    const id = m[1], fromList = !!m[2];
    await dropRecent(env, id);
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
    if (fromList) { await say(env, chat, note.replace('↩️ Desfeito.', '↩️ Apagado.')); return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: 'Apagado'}); }
    const old = (cq.message && cq.message.text) || '';
    await tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: '<s>' + esc(old.split('\n')[0].replace(/^✅\s*/, '')) + '</s>\n' + note, parse_mode: 'HTML'});
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: 'Desfeito'});
  }
  return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
}

async function handleText(env, chat, text, photo) {
  const summary = await getJSON(env, 'summary', null);
  const askCaption = () => say(env, chat, '📎 Manda a foto com uma <b>legenda</b> dizendo o que é, tipo:\n<code>recebi 50 do Vini</code>\n\nA foto vai junto como comprovante do pagamento.\n\n🧾 Foto de <b>cupom fiscal</b> eu leio sozinho' + (env.AI ? '' : ' (precisa do Workers AI ligado)') + '.');
  if (photo && (!text || !parseMessage(text, summary))) {
    if (!env.AI) return askCaption();
    const got = await readReceiptPhoto(env, photo);
    if (got.kind !== 'cupom') return got.error ? say(env, chat, got.error) : askCaption();
    return launchPurchase(env, chat, {amount: got.total, store: got.store, date: got.date, wallet: walletHint(text, summary)}, '🤖 <i>Lido da foto: confira o valor.</i>');
  }
  const nfce = nfceUrl(text);
  if (nfce) {
    const got = await readNfce(nfce);
    if (!got.total) return say(env, chat, '🧾 Não consegui abrir essa nota no site da Sefaz agora.' + (got.store ? ' (' + esc(got.store) + ')' : '') + '\nManda escrito, tipo: <code>gastei 87,50 mercado</code>');
    return launchPurchase(env, chat, {amount: got.total, store: got.store, date: got.date, items: got.items, wallet: walletHint(text.replace(nfce, ''), summary)}, '');
  }
  const cmd = (/^\/(\w+)/.exec(text) || [])[1];
  if (cmd === 'start' || cmd === 'ajuda' || cmd === 'help') return say(env, chat, HELP);
  if (cmd === 'resumo') return say(env, chat, await resumoText(env, summary));
  if (cmd === 'atrasados') return say(env, chat, atrasadosText(summary));
  if (cmd === 'semana') return say(env, chat, semanaText(summary, 7));
  if (cmd === 'semanal') return say(env, chat, weekText(summary));
  if (cmd === 'lembretes') {
    const prefs = await getJSON(env, 'prefs', {daily: true, weekly: true});
    const arg = norm(text.replace(/^\/lembretes(@\w+)?\s*/i, ''));
    if (/^(desliga|off|parar|nao)/.test(arg)) { prefs.daily = false; prefs.weekly = false; prefs.monthly = false; }
    else if (/^(liga|on|sim)/.test(arg)) { prefs.daily = true; prefs.weekly = true; prefs.monthly = true; }
    else if (/^diario/.test(arg)) prefs.daily = !prefs.daily;
    else if (/^semanal/.test(arg)) prefs.weekly = !prefs.weekly;
    else if (/^mensal/.test(arg)) prefs.monthly = prefs.monthly === false;
    await putJSON(env, 'prefs', prefs);
    return say(env, chat, '<b>Lembretes</b>\n☀️ Diário às 9h (hoje, amanhã e atrasados): <b>' + (prefs.daily !== false ? 'ligado' : 'desligado') + '</b>\n📆 Resumo de domingo: <b>' + (prefs.weekly !== false ? 'ligado' : 'desligado') + '</b>\n🗓️ Resumo do mês (dia 1): <b>' + (prefs.monthly !== false ? 'ligado' : 'desligado') + '</b>\n\n<code>/lembretes diario</code>, <code>/lembretes semanal</code> ou <code>/lembretes mensal</code> liga/desliga cada um. <code>/lembretes desligar</code> desliga tudo.');
  }
  if (cmd === 'saldo') return say(env, chat, saldoText(summary));
  if (cmd === 'cobrar' || /^cobrar\b/i.test(text)) return cobrar(env, chat, summary, text.replace(/^\/?cobrar(@\w+)?\s*/i, ''));
  if (cmd === 'ultimos' || cmd === 'últimos') return ultimos(env, chat);
  if (cmd === 'repetir' || /^(repetir|repete|de novo|denovo|mais um igual)$/i.test(text.trim())) {
    const last = (await getJSON(env, 'recent', [])).filter(r => r.op).pop();
    if (!last) return say(env, chat, 'Não achei um gasto ou entrada pra repetir. Manda um, tipo <code>gastei 8 café</code>, e depois é só /repetir.');
    return launchOp(env, chat, {...last.op, repeat: true, text: 'repetir: ' + last.label}, text);
  }
  const special = parseSpecial(text, summary);
  if (special) {
    if (special.error) return say(env, chat, special.error);
    if (special.type === 'edit') {
      const rec = (await getJSON(env, 'recent', [])).filter(r => r.kind !== 'edit');
      const last = rec[rec.length - 1];
      if (!last) return say(env, chat, 'Não achei nada lançado pelo bot pra corrigir. Veja /ultimos.');
      special.target = last.id;
    }
    return launchOp(env, chat, special, text);
  }
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
  // pagamento: se a pessoa tem mais de uma dívida (ou você tem mais de uma carteira), pergunta antes
  if (op.type === 'pay') { const asked = await askDetails(env, chat, op, summary, photoNote); if (asked) return asked; }
  return finishOp(env, chat, op, photoNote, null);
}
async function finishOp(env, chat, op, note, editId) {
  const inbox = await getJSON(env, 'inbox', []);
  inbox.push(op);
  await putJSON(env, 'inbox', inbox.slice(-200));
  await pushRecent(env, op, describe(op));
  // responde primeiro (a mensagem já está salva na fila) e depois lança nos dados da nuvem
  const markup = {inline_keyboard: [[{text: 'Desfazer', callback_data: 'undo:' + op.id}]]};
  let sent;
  if (editId) {
    sent = await tg(env, 'editMessageText', {chat_id: chat, message_id: editId, text: '✅ ' + describe(op) + note, parse_mode: 'HTML', reply_markup: markup});
    if (sent && sent.ok) sent.result = {message_id: editId};
  } else sent = await say(env, chat, '✅ ' + describe(op) + note, {reply_markup: markup});
  const res = await cloudApply(env, e => withReceipts(e, e.applyOps([op])));
  const r = res && res[0];
  if (res) await sendReceipts(env, res);
  if (r && !r.ok && sent && sent.ok) {
    // o app também não conseguiria: avisa já, em vez de esperar o app abrir
    await tg(env, 'editMessageText', {chat_id: chat, message_id: sent.result.message_id, parse_mode: 'HTML',
      text: '⚠️ <s>' + describe(op) + '</s>\nNão lancei: ' + esc(r.msg) + '.'});
    const again = (await getJSON(env, 'inbox', [])).filter(o => o.id !== op.id);
    await putJSON(env, 'inbox', again);
  }
  return sent;
}

// ---------------------------------------------------------------- "recebi 500 do Vini": de qual dívida? em qual carteira?
async function askDetails(env, chat, op, s, note) {
  if (!s || op.debtId) return null;
  const who = matchPerson(op.name, s, op.kind === 'payable' ? 'pay' : 'rec');
  if (!who) return null; // pessoa que não deve nada: o motor já avisa na hora
  const debts = who ? (s.openDebts || []).filter(d => d.name === who && d.kind === op.kind) : [];
  if (!debts.length) return null;
  const wallets = (s.wallets || []).map(w => w.name);
  const needDebt = debts.length > 1;
  const needWallet = !op.wallet && wallets.length > 1 && !s.defaultWallet;
  if (!needDebt && !needWallet) return null;
  if (who) op.name = who;
  const st = {op, debts: debts.map(d => ({id: d.id, title: d.title, remaining: d.remaining, late: d.late})), wallets, needWallet, note: note || ''};
  await env.BB.put('ask:' + op.id, JSON.stringify(st), {expirationTtl: 60 * 60 * 24});
  return askStep(env, chat, st, needDebt ? 'debt' : 'wallet', null);
}
function askStep(env, chat, st, step, editId) {
  const op = st.op, pay = op.kind === 'payable';
  const head = '💸 ' + (pay ? 'Pago' : 'Recebido') + ' <b>' + brl(op.amount) + '</b>' + (pay ? ' a ' : ' de ') + '<b>' + esc(op.name) + '</b>.';
  let text, kb;
  if (step === 'debt') {
    text = head + '\nFoi de qual dívida?';
    kb = st.debts.map((d, i) => [{text: d.title + ' · falta ' + brl(d.remaining) + (d.late ? ' (atrasada)' : ''), callback_data: 'ask:' + op.id + ':d:' + i}]);
    kb.push([{text: 'Mais antiga primeiro', callback_data: 'ask:' + op.id + ':d:a'}]);
  } else {
    text = head + (st.choice ? '\n↳ ' + esc(st.choice) : '') + '\n' + (pay ? 'Saiu de qual carteira?' : 'Caiu em qual carteira?');
    kb = [];
    st.wallets.forEach((w, i) => { if (i % 2 === 0) kb.push([]); kb[kb.length - 1].push({text: w, callback_data: 'ask:' + op.id + ':w:' + i}); });
    kb.push([{text: 'Não mexer em carteira', callback_data: 'ask:' + op.id + ':w:n'}]);
  }
  kb.push([{text: 'Cancelar', callback_data: 'ask:' + op.id + ':x'}]);
  if (editId) return tg(env, 'editMessageText', {chat_id: chat, message_id: editId, text, parse_mode: 'HTML', reply_markup: {inline_keyboard: kb}});
  return say(env, chat, text, {reply_markup: {inline_keyboard: kb}});
}
async function onAsk(env, cq, chat, id, kind, val) {
  const st = await getJSON(env, 'ask:' + id, null);
  const mid = cq.message && cq.message.message_id;
  if (!st) return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: 'Esse pedido expirou. Manda de novo.', show_alert: true});
  if (kind === 'x') {
    if (env.BB.delete) { await env.BB.delete('ask:' + id); await env.BB.delete('photo:' + id); }
    await tg(env, 'editMessageText', {chat_id: chat, message_id: mid, text: '<s>' + (st.op.kind === 'payable' ? 'Pago ' : 'Recebido ') + brl(st.op.amount) + '</s>\nCancelado. Não lancei nada.', parse_mode: 'HTML'});
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: 'Cancelado'});
  }
  if (kind === 'd') {
    const d = val !== 'a' ? st.debts[+val] : null;
    if (d) { st.op.debtId = d.id; st.choice = d.title; } else st.choice = 'mais antiga primeiro';
    if (st.needWallet) {
      await putJSON(env, 'ask:' + id, st);
      await tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
      return askStep(env, chat, st, 'wallet', mid);
    }
  }
  if (kind === 'w') {
    if (val === 'n') { st.op.noWallet = true; st.wchoice = 'sem carteira'; }
    else { st.op.wallet = st.wallets[+val] || ''; st.wchoice = st.op.wallet; }
  }
  if (env.BB.delete) await env.BB.delete('ask:' + id);
  await tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
  const parts = [st.choice, st.wchoice].filter(Boolean).map(esc);
  return finishOp(env, chat, st.op, (parts.length ? '\n↳ ' + parts.join(' · ') : '') + st.note, mid);
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
  // assinatura que subiu de preço (uma vez por valor) e meta ficando pra trás (dia 20, uma vez no mês)
  const raised = (s.subs || []).filter(x => x.raised && sentA[month + ':sub:' + x.key + ':' + x.last] !== 1);
  const behind = new Date(Date.parse(today + 'T12:00:00Z')).getUTCDate() === 20 ? (s.goals || []).filter(g => g.behind > 0 && !g.done && sentA[month + ':goal:' + g.name] !== 1) : [];
  if (prefs.daily !== false && (raised.length || behind.length)) {
    let out = '';
    if (raised.length) out += '<b>📈 Ficou mais caro</b>\n' + raised.map(x => '• ' + esc(x.name) + ': ' + brl(x.prev) + ' → <b>' + brl(x.last) + '</b> (+' + brl((x.last - x.prev) * 12) + ' por ano)').join('\n');
    if (behind.length) out += (out ? '\n\n' : '') + '<b>🎯 Meta ficando pra trás</b>\n' + behind.map(g => '• ' + esc(g.name) + ': ' + brl(g.behind) + ' abaixo do ritmo · guarde ' + brl(g.perMonth) + '/mês' + (g.deadline ? ' até ' + fmtDate(g.deadline) : '')).join('\n') +
      (behind.some(g => !g.wallet) ? '\nResponda <code>guardei 100 na ' + esc(behind.find(g => !g.wallet).name.toLowerCase()) + '</code> quando guardar.' : '');
    await say(env, owner, out);
    raised.forEach(x => { sentA[month + ':sub:' + x.key + ':' + x.last] = 1; });
    behind.forEach(g => { sentA[month + ':goal:' + g.name] = 1; });
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
  // dia 1: resumo do mês que passou (uma vez)
  if (prefs.monthly !== false && today.slice(8, 10) === '01' && s.lastMonth && !sentA[month + ':monthly']) {
    await say(env, owner, monthText(s.lastMonth));
    sentA[month + ':monthly'] = 1;
    await putJSON(env, 'alertsSent', sentA);
  }
  // domingo: resumo da semana
  if (prefs.weekly !== false && new Date(Date.parse(today + 'T12:00:00Z')).getUTCDay() === 0) await say(env, owner, weekText(s));
}
function monthText(m) {
  const net = m.in - m.out;
  let out = '<b>🗓️ Seu ' + esc(m.month.toLowerCase()) + '</b>\n\n⬇️ Entrou: <b>' + brl(m.in) + '</b>\n⬆️ Saiu: <b>' + brl(m.out) + '</b>\n' + (net >= 0 ? '🟢 Sobrou ' : '🔴 Faltou ') + '<b>' + brl(Math.abs(net)) + '</b>';
  if (m.prevSpent > 0 && m.spent > 0) { const d = Math.round((m.spent - m.prevSpent) / m.prevSpent * 100); if (Math.abs(d) >= 5) out += '\nGastos ' + (d > 0 ? '📈 ' + d + '% a mais' : '📉 ' + Math.abs(d) + '% a menos') + ' que no mês anterior.'; }
  if ((m.topCats || []).length) out += '\n\n<b>Onde mais gastou</b>\n' + m.topCats.map(c => '• ' + esc(c.name) + ': ' + brl(c.amount)).join('\n');
  if ((m.received || []).length) out += '\n\n<b>Quem te pagou</b>\n' + m.received.map(r => '• ' + esc(r.name) + ': ' + brl(r.amount)).join('\n');
  if ((m.late || []).length) out += '\n\n<b>Ainda atrasados</b>\n' + m.late.map(r => '• ' + esc(r.name) + ': ' + brl(r.amount)).join('\n') + '\n/cobrar pra mandar a cobrança';
  if ((m.goals || []).length) out += '\n\n🎯 ' + m.goals.map(g => esc(g.name) + ' ' + g.pct + '%').join(' · ');
  return out;
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

// ---------------------------------------------------------------- frases especiais: notificação do banco, racha, metas, correção
const BANKS = [['nubank', 'Nubank'], ['nu pagamentos', 'Nubank'], ['inter', 'Inter'], ['itau', 'Itaú'], ['bradesco', 'Bradesco'], ['santander', 'Santander'], ['caixa', 'Caixa'],
  ['c6', 'C6'], ['picpay', 'PicPay'], ['mercado pago', 'Mercado Pago'], ['banco do brasil', 'Banco do Brasil'], ['neon', 'Neon'], ['next', 'Next'], ['pagbank', 'PagBank'], ['sicoob', 'Sicoob'], ['sicredi', 'Sicredi'], ['will', 'Will Bank']];
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
function parseDue(t) {
  const today = todayBR(), n = norm(t);
  let m = /(?:ate|pra|para)\s+(?:o\s+)?dia\s+(\d{1,2})\b/.exec(n);
  if (m) {
    const d = +m[1]; if (d < 1 || d > 31) return '';
    let iso = today.slice(0, 8) + String(d).padStart(2, '0');
    if (iso <= today) { const nx = new Date(Date.parse(today.slice(0, 8) + '01T12:00:00Z') + 32 * 86400000).toISOString(); iso = nx.slice(0, 8) + String(d).padStart(2, '0'); }
    return iso;
  }
  m = /(?:ate|pra|para)\s+(?:o\s+dia\s+)?(\d{1,2})\/(\d{1,2})\b/.exec(n);
  if (m) { let iso = today.slice(0, 4) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); if (iso <= today) iso = (+today.slice(0, 4) + 1) + iso.slice(4); return iso; }
  m = /(?:ate|pra|para)\s+(?:a\s+|o\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)/.exec(n);
  if (m) { const want = WEEKDAYS.indexOf(m[1]), cur = new Date(Date.parse(today + 'T12:00:00Z')).getUTCDay(); return addDays(today, ((want - cur + 7) % 7) || 7); }
  return '';
}
function parseSpecial(raw, summary) {
  const t = raw.trim().replace(/\s+/g, ' ');
  let m;
  // correção do último lançamento: "na verdade foi 45", "corrige pra lazer"
  if ((m = /^(?:na verdade|corrig(?:e|ir|i)|errei|ops)[,!.]?\s*(?:foi|era|é|e|pra|para|o valor (?:foi|era|é))?\s*(.*)$/i.exec(t))) {
    const rest = m[1].trim();
    const v = new RegExp('^' + NUM + '\\b\\s*(?:(?:de|em|no|na|com)\\s+)?(.*)$', 'i').exec(rest);
    const amount = v ? money(v[1]) : 0, category = (v ? v[2] : rest).replace(/^(?:de|em|no|na|com)\s+/i, '').trim();
    if (!(amount > 0) && !category) return {error: 'Diga o valor ou a categoria certa, tipo: <code>na verdade foi 45</code> ou <code>na verdade foi lazer</code>.'};
    return {type: 'edit', amount, category: amount > 0 ? category : category, text: t.slice(0, 200)};
  }
  // racha: "racha 120 do churrasco com Bia e Caio até sexta"
  if ((m = new RegExp('^(?:racha|rachar|rachei|rachamos|divide|dividi|dividir|dividimos)\\s+(?:a\\s+conta\\s+(?:de\\s+|do\\s+|da\\s+)?)?' + NUM + '\\s*(.*)$', 'i').exec(t))) {
    const amount = money(m[1]);
    let rest = m[2];
    const includeMe = !/\bsem\s+(?:mim|eu)\b|\beu\s+n[aã]o\b/i.test(rest);
    const dueDate = parseDue(rest);
    rest = rest.replace(/\bsem\s+(?:mim|eu)\b|\beu\s+n[aã]o\b/ig, ' ').replace(/\b(?:at[eé]|pra|para)\s+(?:o\s+dia\s+|dia\s+|a\s+|o\s+)?(?:\d{1,2}(?:\/\d{1,2})?|domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado)\b.*$/i, ' ').trim();
    const w = /^(?:(?:do|da|de|no|na|com\s+o|com\s+a)\s+(.+?)\s+)?com\s+(.+)$/i.exec(rest);
    if (!w) return {error: 'Diga com quem, tipo: <code>racha 120 do churrasco com Bia e Caio</code>'};
    const names = w[2].split(/\s*,\s*|\s+e\s+/i).map(x => cleanName(x)).filter(x => x && !/^(eu|mim)$/i.test(x));
    if (!names.length) return {error: 'Diga com quem, tipo: <code>racha 120 com Bia e Caio</code>'};
    const title = w[1] ? w[1].trim().replace(/^\w/, c => c.toUpperCase()) : '';
    return {type: 'group', amount, names, includeMe, dueDate, title, text: t.slice(0, 200)};
  }
  // metas: "guardei 100 na viagem"
  if ((m = new RegExp('^(?:guardei|separei|juntei|poupei|coloquei|depositei)\\s+' + NUM + '\\s+(?:na|no|pra|para|em|pro)\\s+(?:a\\s+|o\\s+)?(?:meta\\s+(?:da\\s+|do\\s+|de\\s+)?)?(.+)$', 'i').exec(t))) {
    const name = m[2].trim();
    const goals = (summary && summary.goals) || [];
    if (goals.length && !goals.some(g => norm(g.name) === norm(name) || norm(g.name).startsWith(norm(name)) || norm(name).startsWith(norm(g.name))))
      return {error: 'Não achei a meta "' + esc(name) + '". Suas metas: ' + goals.map(g => esc(g.name)).join(', ') + '.'};
    return {type: 'goal', amount: money(m[1]), name, text: t.slice(0, 200)};
  }
  return parseBankNotice(t, summary);
}
// notificação do banco encaminhada: "Compra aprovada R$ 45,90 em MERCADO X", "Pix recebido de Fulano R$ 100,00"
// nome do banco ("LARISSA MOTA SILVA", "VINICIUS P PRADO") → nome do app ("Larissa Mota", "Vini"), só se for um só
const NAME_STOP = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const tokens = n => norm(n).split(/\s+/).filter(w => w && !NAME_STOP.has(w));
function matchPerson(raw, summary, kind) {
  const people = ((summary && summary.people) || []).filter(p => kind === 'pay' ? p.pay > 0 : kind === 'rec' ? p.rec > 0 : true);
  const q = tokens(raw);
  if (!q.length) return '';
  const pick = list => { const names = [...new Set(list.map(p => p.name))]; return names.length === 1 ? names[0] : ''; };
  let hit = pick(people.filter(p => tokens(p.name).join(' ') === q.join(' ')));
  if (hit) return hit;
  // todas as palavras do nome no app aparecem no nome do banco (o banco costuma mandar o nome completo)
  hit = pick(people.filter(p => { const t = tokens(p.name); return t.length && t.every(w => q.includes(w)) && t[0] === q[0]; }));
  if (hit) return hit;
  // mesmo primeiro nome (ou apelido que começa igual: Vini → Vinicius), e só uma pessoa assim
  hit = pick(people.filter(p => (tokens(p.name)[0] || '') === q[0]));
  if (hit) return hit;
  return pick(people.filter(p => { const f = tokens(p.name)[0] || ''; return f.length >= 3 && q[0].startsWith(f); }));
}
function parseBankNotice(t, summary) {
  if (/^(gastei|recebi|paguei|ganhei|emprestei|devo|comprei)\b/i.test(t)) return null;
  const vm = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)/i.exec(t);
  if (!vm) return null;
  const n = norm(t);
  if (!/(compra|aprovad|cartao|final \d{4}|pix|transferencia|recebeu|recebid|debitad|debito|credito|pagamento|boleto|\bted\b|deposito)/.test(n)) return null;
  const amount = parseBRL(vm[1]);
  const bank = (BANKS.find(b => new RegExp('\\b' + b[0] + '\\b').test(n)) || [])[1] || '';
  const incoming = /(recebeu|recebid|chegou|deposito|caiu na|credito em conta|te enviou|enviou para voce|voce recebeu)/.test(n);
  const isPix = /\bpix\b|transferencia|\bted\b/.test(n);
  const card = !incoming && /compra/.test(n) && !/debito/.test(n) && /(credito|cartao|final \d{4})/.test(n);
  const inst = /\bem\s+(\d{1,2})\s*x\b|(\d{1,2})\s+parcelas/.exec(n);
  const wallets = (summary && summary.wallets || []).map(w => w.name);
  const wallet = bank ? (wallets.find(w => norm(w).includes(norm(bank)) || norm(bank).includes(norm(w))) || '') : '';
  // pessoa (pix/transferência)
  const pm = /(?:\bde|\bpara|\bpor|\bda|\bdo)\s+([A-ZÀ-Ú][A-Za-zÀ-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][A-Za-zÀ-ú]+){0,3})/.exec(t.replace(/R\$\s*[\d.,]+/g, ''));
  const person = pm && !BANKS.some(b => norm(pm[1]).startsWith(b[0])) ? pm[1].trim() : '';
  const base = {text: t.slice(0, 200), bank, wallet, viaBank: true};
  if (isPix && person) {
    const recName = incoming ? matchPerson(person, summary, 'rec') : '', payName = incoming ? '' : matchPerson(person, summary, 'pay');
    if (recName) return {...base, type: 'pay', kind: 'receivable', name: recName, amount};
    if (payName) return {...base, type: 'pay', kind: 'payable', name: payName, amount};
  }
  if (incoming) return {...base, type: 'tx', kind: 'entrada', amount, category: isPix ? 'Pix recebido' : 'Entrada', note: person ? 'de ' + person : ''};
  // estabelecimento
  let store = '';
  const sm = /\bem\s+(?!\d{1,2}\/|\d{1,2}x)([A-Z0-9*][A-Z0-9 *&'.\-\/]{1,40}?)(?=\s+(?:para|no\s+cart|com\s+o|valor|no\s+valor|às|as\s+\d|em\s+\d|foi|aprovad|dia\s+\d)|[.,;!]|$)/.exec(t)
    || /-\s*([A-Z0-9*][A-Z0-9 *&'.\/]{1,40}?)\s+valor/i.exec(t) || /estabelecimento:?\s+(.+?)(?=[.,;]|$)/i.exec(t);
  if (sm) store = sm[1].replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!store && isPix && person) store = person;
  return {...base, type: 'tx', kind: 'gasto', amount, store: titleCase(store), note: titleCase(store) || (isPix ? 'Pix enviado' : ''), card, cardHint: bank,
    installments: inst ? +(inst[1] || inst[2]) : 1, category: isPix && !store ? 'Transferências' : ''};
}
// lança uma operação especial: grava, aplica na nuvem e responde com o resultado
async function launchOp(env, chat, op, text) {
  op.id = 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  op.at = new Date().toISOString();
  op.date = op.date || todayBR();
  op.text = (op.text || text || '').slice(0, 200);
  const inbox = await getJSON(env, 'inbox', []);
  inbox.push(op);
  await putJSON(env, 'inbox', inbox.slice(-200));
  const res = await cloudApply(env, e => withReceipts(e, e.applyOps([op])));
  const r = res && res[0];
  if (r && !r.ok) {
    await putJSON(env, 'inbox', (await getJSON(env, 'inbox', [])).filter(o => o.id !== op.id));
    return say(env, chat, '⚠️ Não lancei: ' + esc(r.msg) + '.');
  }
  if (res) await sendReceipts(env, res);
  const undoBtn = [{text: 'Desfazer', callback_data: 'undo:' + op.id}];
  const later = r ? '' : '\n<i>Entra no app na próxima vez que você abrir.</i>';
  if (op.type === 'edit') {
    await pushRecent(env, op, 'correção', 'edit');
    return say(env, chat, '✏️ ' + esc(r ? r.msg : 'Correção anotada') + later, {reply_markup: {inline_keyboard: [undoBtn]}});
  }
  if (op.type === 'group') {
    const g = r && r.group;
    await pushRecent(env, op, 'Racha ' + brl(op.amount));
    if (!g) return say(env, chat, '👥 Racha de ' + brl(op.amount) + ' com ' + esc(op.names.join(', ')) + ' anotado.' + later, {reply_markup: {inline_keyboard: [undoBtn]}});
    const origin = await env.BB.get('origin');
    const link = origin ? origin + '/s/' + g.token : '';
    const each = g.parts.map(p => '• ' + esc(p.name) + ': <b>' + brl(p.amount) + '</b>').join('\n');
    const wa = 'Pessoal, ' + g.title + ' deu ' + brl(op.amount).replace(/ /g, ' ') + '. Aqui dá pra ver quanto cada um paga e o PIX: ' + link;
    const kb = [];
    if (link) kb.push([{text: '💬 Mandar no WhatsApp', url: 'https://wa.me/?text=' + encodeURIComponent(wa)}], [{text: '🔗 Abrir o link do grupo', url: link}]);
    kb.push(undoBtn);
    return say(env, chat, '👥 <b>' + esc(g.title) + '</b> · ' + brl(op.amount) + (g.myShare ? ' (sua parte: ' + brl(g.myShare) + ')' : '') + '\n' + each + '\nPagar até ' + fmtDate(g.due) + '.', {reply_markup: {inline_keyboard: kb}});
  }
  if (op.type === 'goal') {
    const gl = r && r.goal;
    await pushRecent(env, op, 'Meta ' + esc(op.name) + ' +' + brl(op.amount));
    if (!gl) return say(env, chat, '🎯 Guardado ' + brl(op.amount) + ' na meta ' + esc(op.name) + '.' + later, {reply_markup: {inline_keyboard: [undoBtn]}});
    let extra = '';
    if (gl.deadline && gl.pct < 100) extra = '\nPra chegar até ' + fmtDate(gl.deadline) + ': ' + brl(gl.perMonth) + '/mês' + (gl.behind ? ' · ainda ' + brl(gl.behind) + ' abaixo do ritmo' : ' · no ritmo ✅');
    return say(env, chat, '🎯 <b>' + esc(gl.name) + '</b>: ' + brl(gl.saved) + ' de ' + brl(gl.target) + ' (' + gl.pct + '%)' + (gl.pct >= 100 ? ' 🎉 Meta batida!' : '') + extra, {reply_markup: {inline_keyboard: [undoBtn]}});
  }
  // notificação do banco
  const head = op.repeat ? '🔁 Repetido' : '🏦 ' + (op.bank ? esc(op.bank) + ' · ' : '') + (op.type === 'pay' ? 'pagamento' : op.card ? 'compra no cartão' : op.kind === 'entrada' ? 'entrada' : 'gasto');
  await pushRecent(env, op, r ? esc(r.msg) : describe(op));
  return say(env, chat, head + '\n✅ ' + (r ? esc(r.msg) : describe(op)) + later, {reply_markup: {inline_keyboard: [undoBtn]}});
}
// últimos lançamentos feitos pelo bot (para apagar ou corrigir)
async function pushRecent(env, op, label, kind) {
  const rec = await getJSON(env, 'recent', []);
  const keep = op.type === 'tx' ? {type: 'tx', kind: op.kind, amount: op.amount, category: op.category || '', wallet: op.wallet || '', store: op.store || '', note: op.note || '', card: !!op.card, cardHint: op.cardHint || ''} : null;
  rec.push({id: op.id, label: String(label || op.text || '').replace(/<[^>]+>/g, '').slice(0, 90), at: op.at || new Date().toISOString(), kind: kind || op.type, op: keep});
  await putJSON(env, 'recent', rec.slice(-15));
}
async function dropRecent(env, id) {
  const rec = await getJSON(env, 'recent', []);
  if (rec.some(r => r.id === id)) await putJSON(env, 'recent', rec.filter(r => r.id !== id));
}
async function ultimos(env, chat) {
  const rec = (await getJSON(env, 'recent', [])).filter(r => r.kind !== 'edit').slice(-5).reverse();
  if (!rec.length) return say(env, chat, 'Nada lançado pelo bot ainda.');
  const lines = rec.map((r, i) => (i + 1) + '. ' + esc(r.label) + ' <i>(' + fmtDate(new Date(Date.parse(r.at) - 3 * 3600000).toISOString().slice(0, 10)) + ')</i>');
  return say(env, chat, '<b>Últimos lançamentos</b>\n' + lines.join('\n') + '\n\nToque no número pra apagar. Pra corrigir o último: <code>na verdade foi 45</code>.', {
    reply_markup: {inline_keyboard: [rec.map((r, i) => ({text: '🗑 ' + (i + 1), callback_data: ('undo:' + r.id + ':l').slice(0, 64)}))]}
  });
}

// ---------------------------------------------------------------- recibos de quitação (PDF feito pelo motor)
function withReceipts(e, res) {
  if (res && res.quitou && res.quitou.length) res.receipts = res.quitou.map(q => { const r = e.receipt(q.debtId); return r ? {...r, debtId: q.debtId} : null; }).filter(Boolean);
  return res;
}
async function sendDoc(env, chat, rc, caption, markup) {
  const bytes = new Uint8Array(rc.pdf.length);
  for (let i = 0; i < rc.pdf.length; i++) bytes[i] = rc.pdf.charCodeAt(i) & 255;
  const fd = new FormData();
  fd.append('chat_id', chat); fd.append('caption', caption); fd.append('parse_mode', 'HTML');
  if (markup) fd.append('reply_markup', JSON.stringify(markup));
  fd.append('document', new Blob([bytes], {type: 'application/pdf'}), rc.file);
  try { return await (await fetch('https://api.telegram.org/bot' + TOKEN(env) + '/sendDocument', {method: 'POST', body: fd})).json(); } catch (e) { return {ok: false, description: String(e && e.message || e)}; }
}
async function sendReceipts(env, res) {
  const owner = await env.BB.get('owner');
  if (!owner || !res || !res.receipts) return;
  for (const rc of res.receipts) {
    const fr = await friendFor(env, rc.key);
    const first = firstOf(rc.name);
    if (fr) {
      const sm = await getJSON(env, 'summary', null);
      const r = await sendDoc(env, fr.chat, rc, '🎉 Quitado! Aqui está o recibo de quitação' + (sm && sm.owner ? ' de ' + esc(firstOf(sm.owner)) : '') + ': ' + brl(rc.total) + ', tudo pago. Valeu! 🙌');
      if (r && r.ok) {
        await sendDoc(env, owner, rc, '🎉 <b>' + esc(rc.name) + '</b> quitou! ' + brl(rc.total) + ' recebidos no total.\n📨 O recibo já foi pro ' + esc(first) + ' no Telegram.');
        continue;
      }
    }
    await sendDoc(env, owner, rc, '🎉 <b>' + esc(rc.name) + '</b> quitou! ' + brl(rc.total) + ' recebidos no total.\nO recibo de quitação está aqui, pronto pra encaminhar.',
      fr ? {inline_keyboard: [[{text: '📨 Mandar o recibo pro ' + first + ' no Telegram', callback_data: ('rcpt:' + rc.debtId).slice(0, 64)}]]} : null);
  }
}
async function receiptToFriend(env, debtId) {
  const rc = await engineRun(env, e => e.receipt(debtId));
  if (!rc) return {ok: false, error: 'Essa dívida não está quitada.'};
  const fr = await friendFor(env, rc.key);
  if (!fr) return {ok: false, error: firstOf(rc.name) + ' não está nos lembretes do Telegram.'};
  const s = await getJSON(env, 'summary', null);
  const who = s && s.owner ? firstOf(s.owner) : 'quem te emprestou';
  const r = await sendDoc(env, fr.chat, rc, '🧾 Oi, ' + esc(firstOf(rc.name)) + '! Aqui está o recibo de quitação de ' + esc(who) + ': ' + brl(rc.total) + ', tudo pago. Valeu! 🙌');
  return r.ok ? {ok: true, name: firstOf(rc.name)} : {ok: false, error: 'O Telegram não entregou (' + (r.description || 'erro') + ').'};
}
// roda o motor sem gravar nada (só para consultar)
async function engineRun(env, fn) {
  try {
    const str = await env.BB.get('snapshot');
    if (!str) return null;
    const origin = await env.BB.get('origin');
    if (!ENGINE) ENGINE = getEngine();
    ENGINE.load(JSON.parse(str), {url: origin || ''});
    return fn(ENGINE);
  } catch (e) {
    await putJSON(env, 'lastError', {at: new Date().toISOString(), error: 'motor: ' + String(e && (e.stack || e.message) || e).slice(0, 600)});
    return null;
  }
}

// ---------------------------------------------------------------- notas fiscais: foto do cupom (IA) e link da NFC-e
const titleCase = s => String(s || '').toLowerCase().replace(/(^|[\s/(-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Ltda|Me|Epp|S\/?a|Eireli)\b\.?/gi, x => x.toUpperCase()).trim();
function walletHint(text, summary) {
  const t = norm(String(text || '').replace(/^(no|na|pelo|pela|via)\s+/i, ''));
  if (!t) return '';
  const hit = (summary && summary.wallets || []).find(w => norm(w.name) === t || t.includes(norm(w.name)));
  return hit ? hit.name : '';
}
function parseBRL(v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v || '').replace(/[^\d.,]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}
// data da nota: aceita até 60 dias para trás; senão usa hoje
function sanePurchaseDate(d) {
  const today = todayBR();
  return /^\d{4}-\d{2}-\d{2}$/.test(d || '') && d <= today && d >= addDays(today, -60) ? d : today;
}
async function launchPurchase(env, chat, p, footer) {
  if (!(p.amount > 0 && p.amount < 100000)) return say(env, chat, '🧾 Não consegui achar o valor total. Manda escrito, tipo: <code>gastei 87,50 mercado</code>');
  const store = titleCase(p.store || '').slice(0, 60);
  const op = {type: 'tx', kind: 'gasto', amount: p.amount, store, note: store ? store + ' (nota fiscal)' : 'nota fiscal', wallet: p.wallet || '',
    id: 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), date: sanePurchaseDate(p.date)};
  op.text = ('nota: ' + (store || 'compra') + ' ' + brl(p.amount)).slice(0, 200);
  const inbox = await getJSON(env, 'inbox', []);
  inbox.push(op);
  await putJSON(env, 'inbox', inbox.slice(-200));
  await pushRecent(env, op, 'Gasto de ' + brl(op.amount) + (store ? ' · ' + esc(store) : ''));
  const res = await cloudApply(env, e => e.applyOps([op]));
  const r = res && res[0];
  const cat = r && r.ok && r.category ? r.category : '';
  return say(env, chat, '🧾 ' + (store ? '<b>' + esc(store) + '</b> · ' : '') + fmtDate(op.date) + (p.items ? ' · ' + p.items + (p.items === 1 ? ' item' : ' itens') : '') +
    '\n✅ Gasto de <b>' + brl(p.amount) + '</b>' + (cat ? ' · ' + esc(cat) : '') + (op.wallet ? ' (' + esc(op.wallet) + ')' : '') + (footer ? '\n' + footer : ''), {
    reply_markup: {inline_keyboard: [[{text: 'Desfazer', callback_data: 'undo:' + op.id}]]}
  });
}
const VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
async function readReceiptPhoto(env, ph) {
  try {
    if (ph.file_size && ph.file_size > 8 * 1024 * 1024) return {kind: 'outro'};
    const f = await tg(env, 'getFile', {file_id: ph.file_id});
    if (!f.ok || !f.result || !f.result.file_path) return {kind: 'outro', error: 'Não consegui baixar a foto.'};
    const r = await fetch('https://api.telegram.org/file/bot' + TOKEN(env) + '/' + f.result.file_path);
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const image = 'data:image/jpeg;base64,' + btoa(bin);
    const messages = [
      {role: 'system', content: 'Você lê fotos de comprovantes brasileiros e responde só com JSON, sem texto em volta.'},
      {role: 'user', content: 'Se a foto for um cupom fiscal, nota fiscal (NFC-e) ou recibo de compra, responda {"tipo":"cupom","loja":"nome da loja","total":"valor final pago, ex 87,50","data":"DD/MM/AAAA"}. ' +
        'O total é o VALOR A PAGAR / TOTAL final, não um item. Se for comprovante de PIX ou transferência, responda {"tipo":"pix"}. Se for outra coisa, responda {"tipo":"outro"}.'}
    ];
    let out;
    try { out = await env.AI.run(VISION, {messages, image, max_tokens: 160, temperature: 0}); }
    catch (e) {
      // o modelo de visão da Meta pede um "aceite" de licença uma vez só
      if (!/agree|licen/i.test(String(e && e.message || e))) throw e;
      await env.AI.run(VISION, {prompt: 'agree'}).catch(() => {});
      out = await env.AI.run(VISION, {messages, image, max_tokens: 160, temperature: 0});
    }
    const txt = String(out && (out.response || out.result || out.description) || '');
    const m = /\{[\s\S]*\}/.exec(txt);
    if (!m) return {kind: 'outro'};
    const j = JSON.parse(m[0].replace(/,\s*}/g, '}'));
    if (j.tipo !== 'cupom') return {kind: j.tipo === 'pix' ? 'pix' : 'outro'};
    const d = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(String(j.data || ''));
    const date = d ? (d[3].length === 2 ? '20' + d[3] : d[3]) + '-' + d[2] + '-' + d[1] : '';
    return {kind: 'cupom', store: String(j.loja || '').slice(0, 80), total: parseBRL(j.total), date};
  } catch (e) {
    await putJSON(env, 'lastError', {at: new Date().toISOString(), error: 'cupom: ' + String(e && e.message || e).slice(0, 300)});
    return {kind: 'outro', error: '🧾 Não consegui ler a foto agora. Manda escrito, tipo: <code>gastei 87,50 mercado</code>' + (/(\b|_)AI\b|binding|not found|model/i.test(String(e && e.message || e)) ? '\n(Confira se o Workers AI está ligado: veja o README do bot.)' : '')};
  }
}
// link do QR Code da NFC-e (aponte a câmera do celular pro QR e compartilhe o link com o bot)
function nfceUrl(text) {
  const m = /https?:\/\/[^\s<>"]+/i.exec(String(text || ''));
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    if (!/\.gov\.br$/i.test(u.hostname) || !/(nfce|sefaz|fazenda|sef\.|\.set\.)/i.test(u.hostname + u.pathname)) return null;
    if (!u.searchParams.get('p') && !u.searchParams.get('chNFe')) return null;
    return m[0];
  } catch (e) { return null; }
}
async function readNfce(link) {
  const u = new URL(link);
  const p = (u.searchParams.get('p') || '').split('|');
  const chave = (p[0] || u.searchParams.get('chNFe') || '').replace(/\D/g, '');
  const out = {store: '', total: 0, date: '', items: 0};
  // contingência (offline): o valor e o dia vêm no próprio QR
  if (p.length >= 8 && /^\d+(\.\d{1,2})?$/.test(p[4] || '')) {
    out.total = parseBRL(Number(p[4]));
    if (chave.length === 44 && /^\d{2}$/.test(p[3] || '')) out.date = '20' + chave.slice(2, 4) + '-' + chave.slice(4, 6) + '-' + p[3];
  }
  if (!out.total && u.searchParams.get('vNF')) out.total = parseBRL(Number(u.searchParams.get('vNF')));
  try {
    const r = await fetch(link, {headers: {'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36', 'Accept': 'text/html'}, redirect: 'follow'});
    if (r.ok) {
      const html = (await r.text()).slice(0, 600000);
      const st = /class="txtTopo"[^>]*>\s*([^<]+?)\s*</i.exec(html) || /Raz[ãa]o Social:?\s*<\/?[^>]*>\s*([^<]+?)\s*</i.exec(html);
      if (st) out.store = st[1].replace(/&amp;/g, '&').trim();
      const tt = /Valor a pagar R\$:?\s*<\/label>\s*<span[^>]*>\s*([\d.]+,\d{2})/i.exec(html) || /class="[^"]*totalNumb[^"]*txtMax[^"]*"[^>]*>\s*([\d.]+,\d{2})/i.exec(html) || /Valor total R\$:?\s*<\/label>\s*<span[^>]*>\s*([\d.]+,\d{2})/i.exec(html);
      if (tt) out.total = parseBRL(tt[1]);
      const dt = /Emiss[ãa]o:\s*<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(html);
      if (dt) out.date = dt[3] + '-' + dt[2] + '-' + dt[1];
      out.items = (html.match(/class="txtTit"/g) || []).length;
    }
  } catch (e) { /* site da Sefaz fora do ar: fica com o que veio no QR */ }
  return out;
}

// ---------------------------------------------------------------- bot de lembretes para quem te deve
// O app cria um convite por pessoa (snapshot.invites[chave] = {code, on}). A pessoa abre
// t.me/<seu bot>?start=<code>, aperta Começar e passa a receber os lembretes.
// friends[chave] = {chat, code, at, name, sent, lead (dias de antecedência), pause (até quando)}
// Ela só enxerga o que é dela: tudo sai da chave ligada ao chat.
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
const FR_CMDS = [
  {command: 'menu', description: 'Tudo que dá pra fazer aqui'},
  {command: 'status', description: 'Quanto está em aberto'},
  {command: 'parcelas', description: 'Parcelas e vencimentos'},
  {command: 'pix', description: 'PIX copia e cola e QR Code'},
  {command: 'paguei', description: 'Avisar que pagou (com comprovante)'},
  {command: 'prazo', description: 'Pedir mais prazo'},
  {command: 'historico', description: 'O que você já pagou'},
  {command: 'recibo', description: 'Recibo de quitação'},
  {command: 'lembretes', description: 'Quando ser avisado'},
  {command: 'pausar', description: 'Pausar os lembretes'},
  {command: 'parar', description: 'Não receber mais nada'}
];
function friendMenu(c) {
  const rows = c ? [
    [{text: '📋 Parcelas', callback_data: 'fr:parc'}, {text: '💠 PIX', callback_data: 'fr:pix'}],
    [{text: '✅ Já paguei', callback_data: 'fr:pago'}, {text: '🗓️ Pedir prazo', callback_data: 'fr:prazo'}],
    [{text: '📜 Histórico', callback_data: 'fr:hist'}, {text: '⚙️ Lembretes', callback_data: 'fr:cfg'}]
  ] : [[{text: '📜 Histórico', callback_data: 'fr:hist'}, {text: '🧾 Recibo', callback_data: 'fr:rc'}]];
  if (c && c.link) rows.push([{text: '🔗 Ver tudo no site', url: c.link}]);
  return {inline_keyboard: rows};
}
const leadLabel = n => n === 0 ? 'só no dia do vencimento' : n === 1 ? 'na véspera e no dia' : n + ' dias antes e no dia';
function friendText(c, kind, owner, lead) {
  const who = owner ? '<b>' + esc(owner) + '</b>' : 'quem te emprestou';
  let out = '👋 Oi, ' + esc(firstOf(c.name)) + '! ';
  if (kind === 'late') out += 'Lembrete de ' + who + ': tem <b>' + brl(c.late) + '</b> atrasado' + (c.lateSince ? ' desde ' + fmtDate(c.lateSince) : '') + '.';
  else if (kind === 'today') out += 'Lembrete de ' + who + ': <b>hoje</b> vence <b>' + brl(c.next.amount) + '</b>.';
  else if (kind === 'tomorrow') out += 'Lembrete de ' + who + ': <b>amanhã</b> (' + fmtDate(c.next.date) + ') vence <b>' + brl(c.next.amount) + '</b>.';
  else if (kind === 'soon') out += 'Lembrete de ' + who + ': <b>em ' + lead + ' dias</b> (' + fmtDate(c.next.date) + ') vence <b>' + brl(c.next.amount) + '</b>.';
  else {
    out += 'Resumo com ' + who + ':';
    if (c.late > 0) out += '\n⏰ Atrasado: <b>' + brl(c.late) + '</b>' + (c.lateSince ? ' (desde ' + fmtDate(c.lateSince) + ')' : '');
    if (c.next && !(c.late > 0 && c.next.date < todayBR())) out += '\n📅 Próximo: <b>' + brl(c.next.amount) + '</b> em ' + fmtDate(c.next.date);
  }
  out += '\nEm aberto no total: ' + brl(c.remaining) + '.';
  return out;
}
async function sendFriend(env, fr, c, kind, s) {
  let text = friendText(c, kind, s.owner, fr.lead);
  if (s.pix) text += '\n\nPIX: <code>' + esc(s.pix) + '</code>';
  text += '\n\n<i>Mensagem automática. Já pagou? Toque em ✅ Já paguei. Para não receber mais: /parar</i>';
  return tg(env, 'sendMessage', {chat_id: fr.chat, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: friendMenu(c)});
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
const friendView = (env, key) => engineRun(env, e => e.friendView ? e.friendView(key) : null);
const friendToken = (c, fr) => { const m = c && c.link && /\/s\/([A-Za-z0-9]+)/.exec(c.link); return m ? m[1] : 'tg' + fr.code; };
const getWait = async (env, chat) => getJSON(env, 'fwait:' + chat, null);
const setWait = (env, chat, w) => w ? env.BB.put('fwait:' + chat, JSON.stringify(w), {expirationTtl: 86400}) : (env.BB.delete ? env.BB.delete('fwait:' + chat) : env.BB.put('fwait:' + chat, 'null'));
const CANCEL = {text: 'Cancelar', callback_data: 'fr:x'};

function parcelasText(v) {
  if (!v || !(v.debts || []).length) return 'Nada em aberto agora. 🎉';
  const out = ['📋 <b>Suas parcelas</b>'];
  v.debts.forEach(d => {
    out.push('\n<b>' + esc(d.title) + '</b> · desde ' + fmtFull(d.date));
    if ((d.insts || []).length) d.insts.forEach(it => {
      const part = it.open > 0 && it.open < it.value - 0.005 ? ' · falta ' + brl(it.open) : '';
      const st = it.state === 'paga' ? '✅' : it.state === 'atrasada' ? '⏰' : it.state === 'parcial' ? '◐' : '▫️';
      out.push(st + ' ' + it.n + 'ª · ' + brl(it.value) + ' · ' + (it.state === 'paga' ? 'paga' : (it.due < todayBR() ? 'venceu ' : 'vence ') + fmtFull(it.due)) + part);
    });
    else out.push((d.late > 0 ? '⏰ ' : '▫️ ') + brl(d.remaining) + (d.due ? ' · ' + (d.due < todayBR() ? 'venceu ' : 'vence ') + fmtFull(d.due) : ''));
    if (d.paid > 0) out.push('<i>Já pago ' + brl(d.paid) + ' de ' + brl(d.total) + '</i>');
  });
  out.push('\nEm aberto no total: <b>' + brl(v.remaining) + '</b>' + (v.late > 0 ? ' · <b>' + brl(v.late) + '</b> atrasado' : ''));
  return out.join('\n');
}
function historicoText(v) {
  if (!v || !(v.history || []).length) return '📜 Ainda não tem nenhum pagamento registrado.';
  const many = new Set(v.history.map(h => h.title + h.debtDate)).size > 1;
  return '📜 <b>Seus pagamentos</b>\n\n' + v.history.map(h => '✅ ' + fmtFull(h.date) + ' · <b>' + brl(h.amount) + '</b>' + (many ? ' · ' + esc(h.title) : '')).join('\n') +
    '\n\nTotal pago: <b>' + brl(v.paidTotal) + '</b>' + (v.remaining > 0 ? ' · falta ' + brl(v.remaining) : ' · tudo quitado 🎉');
}
// opções de valor: o que está atrasado, cada dívida, tudo
function amountChoices(v) {
  const ch = payChoices(v).map(x => ({value: x.value, amt: x.amt, label: x.label}));
  if (ch.length) return ch;
  const out = [];
  if (v.suggest > 0) out.push({value: 's', amt: v.suggest, label: (v.late > 0 ? 'Atrasado · ' : 'Próxima parcela · ') + brl(v.suggest)});
  if (v.remaining > 0 && Math.abs(v.remaining - v.suggest) > 0.005) out.push({value: 'all', amt: v.remaining, label: 'Tudo que falta · ' + brl(v.remaining)});
  return out;
}
async function friendPix(env, chat, v, s, value) {
  if (!v || !(v.remaining > 0)) return say(env, chat, 'Nada em aberto agora. 🎉');
  if (!v.pixInfo) return say(env, chat, (s && s.owner ? esc(firstOf(s.owner)) : 'Quem te emprestou') + ' ainda não cadastrou a chave PIX. Pede direto pra ' + (s && s.owner ? esc(firstOf(s.owner)) : 'ele(a)') + '.');
  const ch = amountChoices(v);
  const pick = ch.find(x => x.value === value) || ch[0] || {amt: v.remaining, value: 'all'};
  const code = pixCode({...v.pixInfo, amount: pick.amt, txid: 'BBTG' + String(chat).slice(-8)});
  const owner = s && s.owner ? esc(firstOf(s.owner)) : 'quem te emprestou';
  const fd = new FormData();
  fd.append('chat_id', chat); fd.append('parse_mode', 'HTML');
  fd.append('caption', '💠 PIX de <b>' + brl(pick.amt) + '</b> pra ' + owner + '\nNo app do banco: PIX → ler QR Code, ou copie o código abaixo (Copia e cola).');
  fd.append('photo', new Blob([qrPng(code)], {type: 'image/png'}), 'pix.png');
  try { await fetch('https://api.telegram.org/bot' + TOKEN(env) + '/sendPhoto', {method: 'POST', body: fd}); } catch (e) { /* o código abaixo já resolve */ }
  const others = ch.filter(x => x.value !== pick.value).slice(0, 5).map(x => [{text: 'Outro valor: ' + x.label, callback_data: 'fr:pix:' + x.value}]);
  return tg(env, 'sendMessage', {chat_id: chat, parse_mode: 'HTML', text: '<code>' + esc(code) + '</code>\n\n<i>Toque no código pra copiar. Depois de pagar, toque em ✅ Já paguei.</i>',
    reply_markup: {inline_keyboard: [...others, [{text: '✅ Já paguei', callback_data: 'fr:pago'}]]}});
}
async function fetchTgPhoto(env, ph) {
  if (ph.file_size && ph.file_size > 8 * 1024 * 1024) return '';
  const f = await tg(env, 'getFile', {file_id: ph.file_id});
  if (!f.ok || !f.result || !f.result.file_path) return '';
  const r = await fetch('https://api.telegram.org/file/bot' + TOKEN(env) + '/' + f.result.file_path);
  if (!r.ok) return '';
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const mime = ph.mime_type || (/\.png$/i.test(f.result.file_path) ? 'image/png' : 'image/jpeg');
  return 'data:' + mime + ';base64,' + btoa(bin);
}
async function claimRate(env, token) {
  const rate = await getJSON(env, 'crate:' + token, {n: 0, t: 0});
  if (Date.now() - rate.t > 3600000) { rate.n = 0; rate.t = Date.now(); }
  if (rate.n >= 5) return false;
  rate.n++; await putJSON(env, 'crate:' + token, rate);
  return true;
}
// "Já paguei": valor → comprovante → (qual dívida) → pedido pro dono confirmar
async function pagoStep(env, chat, me, fr, c, v, w) {
  if (!v || !(v.remaining > 0)) { await setWait(env, chat, null); return say(env, chat, 'Nada em aberto agora. 🎉'); }
  if (!(w.amount > 0)) {
    await setWait(env, chat, w);
    const ch = amountChoices(v).slice(0, 4).map(x => [{text: x.label, callback_data: 'fr:pv:' + Math.round(x.amt * 100) + (x.value !== 's' && x.value !== 'all' ? ':' + x.value : '')}]);
    return say(env, chat, '✅ <b>Avisar que pagou</b>\nQuanto você pagou? Toque numa opção ou mande o valor (ex: <code>150</code>).' + (w.photo ? '' : '\n<i>Se tiver o comprovante, pode mandar a foto com o valor na legenda.</i>'), {reply_markup: {inline_keyboard: [...ch, [CANCEL]]}});
  }
  if (!w.photo && !w.nophoto) {
    await setWait(env, chat, w);
    return say(env, chat, '📎 Manda a <b>foto ou print do comprovante</b> de ' + brl(w.amount) + '.', {reply_markup: {inline_keyboard: [[{text: 'Enviar sem comprovante', callback_data: 'fr:np'}], [CANCEL]]}});
  }
  const ds = v.debts || [];
  if (ds.length > 1 && w.debt == null) {
    const hit = payChoices(v).filter(x => Math.abs(x.amt - w.amount) < 0.005);
    if (hit.length === 1) w.debt = hit[0].value;
    else {
      await setWait(env, chat, w);
      const rows = payChoices(v).slice(0, 6).map(x => [{text: x.label, callback_data: 'fr:pd:' + x.value}]);
      return say(env, chat, 'Esse pagamento de <b>' + brl(w.amount) + '</b> é de qual?', {reply_markup: {inline_keyboard: [...rows, [CANCEL]]}});
    }
  }
  await setWait(env, chat, null);
  const token = friendToken(c, fr);
  if (!await claimRate(env, token)) return say(env, chat, 'Muitos envios seguidos. Tente de novo daqui a uma hora.');
  const id = 'cl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let debtId = null, debtTitle = '';
  if (/^\d+$/.test(String(w.debt)) && ds[+w.debt]) { debtId = ds[+w.debt]._id || null; debtTitle = ds[+w.debt].title + ' de ' + fmtFull(ds[+w.debt].date); }
  else if (w.debt === 'late') debtTitle = 'o que está atrasado';
  const photo = w.photo ? await fetchTgPhoto(env, w.photo) : '';
  const claim = {id, token, at: new Date().toISOString(), amount: w.amount, note: '', who: null, whoName: '', status: 'pending', hasPhoto: !!photo, debtId, debtTitle,
    label: c.name + (debtTitle ? ' · ' + debtTitle : ''), linkName: c.name, ref: {name: c.name}, chat, via: 'tg'};
  if (photo) await env.BB.put('cphoto:' + id, photo, {expirationTtl: 60 * 60 * 24 * 45});
  const ids = await getJSON(env, 'claims', []);
  ids.push(id);
  await putJSON(env, 'claims', ids.slice(-200));
  const owner = await env.BB.get('owner');
  if (owner) {
    const text = '💸 <b>' + esc(claim.label) + '</b> diz que pagou <b>' + brl(w.amount) + '</b> (pelo Telegram)' + (photo ? '' : '\n<i>(sem comprovante)</i>') + '\n\nConfere no banco e confirma:';
    const kb = {inline_keyboard: [[{text: '✅ Recebi', callback_data: 'claim:ok:' + id}, {text: '❌ Não recebi', callback_data: 'claim:no:' + id}]]};
    const r = photo ? await tg(env, 'sendPhoto', {chat_id: owner, photo: w.photo.file_id, caption: text, parse_mode: 'HTML', reply_markup: kb}) : await say(env, owner, text, {reply_markup: kb});
    if (r && r.ok && r.result) claim.tg = {chat: owner, msg: r.result.message_id, photo: !!photo};
  }
  await putJSON(env, 'claim:' + id, claim);
  return say(env, chat, '📨 Pronto! Avisei ' + (v.owner ? esc(firstOf(v.owner)) : 'quem te emprestou') + ' que você pagou <b>' + brl(w.amount) + '</b>' + (debtTitle ? ' (' + esc(debtTitle) + ')' : '') + '. Quando for confirmado, te aviso aqui.');
}
// pedir mais prazo
async function prazoStart(env, chat, fr, c, v, arg) {
  if (!v || !(v.remaining > 0)) return say(env, chat, 'Nada em aberto agora. 🎉');
  const token = friendToken(c, fr);
  if ((await claimsFor(env, token)).some(x => x.kind === 'prazo' && x.status === 'pending')) return say(env, chat, '⏳ Você já tem um pedido de prazo esperando resposta. Assim que responderem, te aviso aqui.');
  if (arg) return prazoSend(env, chat, fr, c, v, arg);
  await setWait(env, chat, {kind: 'prazo'});
  const today = todayBR();
  const opts = [7, 15, 30].map(n => ({text: fmtDate(addDays(today, n)) + ' (+' + n + ' dias)', callback_data: 'fr:pz:' + addDays(today, n)}));
  return say(env, chat, '🗓️ <b>Pedir mais prazo</b>\nAté quando você consegue pagar <b>' + brl(v.suggest || v.remaining) + '</b>' + (v.nextDue ? ' (' + (v.nextDue < today ? 'venceu' : 'vence') + ' ' + fmtDate(v.nextDue) + ')' : '') + '?\n\nToque numa data ou mande a sua, se quiser com o motivo (ex: <code>20/10 recebo dia 20</code>).',
    {reply_markup: {inline_keyboard: [opts, [CANCEL]]}});
}
function parseFriendDate(text) {
  const t = norm(text);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : parseDue('ate ' + t.replace(/^(ate|pra|para)\s+/, ''));
  const note = String(text).replace(/^\s*(?:at[eé]|pra|para)?\s*(?:o\s+)?(?:dia\s+)?\d{1,2}(?:\/\d{1,2}(?:\/\d{2,4})?)?\s*[,.-]?\s*/i, '').trim();
  return {iso, note: iso === text ? '' : note};
}
async function prazoSend(env, chat, fr, c, v, raw) {
  const today = todayBR(), {iso, note} = parseFriendDate(raw);
  if (!iso || iso <= today || iso > addDays(today, 120)) await setWait(env, chat, {kind: 'prazo'});
  if (!iso) return say(env, chat, 'Não entendi a data 🤔 Manda assim: <code>20/10</code> ou <code>dia 20</code>.', {reply_markup: {inline_keyboard: [[CANCEL]]}});
  if (iso <= today || iso > addDays(today, 120)) return say(env, chat, 'Escolha uma data entre amanhã e daqui a 4 meses.', {reply_markup: {inline_keyboard: [[CANCEL]]}});
  await setWait(env, chat, null);
  const token = friendToken(c, fr);
  if (!await claimRate(env, token)) return say(env, chat, 'Muitos envios seguidos. Tente de novo daqui a uma hora.');
  const amount = v.suggest || v.remaining, due = v.nextDue || '';
  const id = 'cl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const claim = {id, kind: 'prazo', token, at: new Date().toISOString(), newDate: iso, amount, due, note: note.slice(0, 140), who: null, whoName: '', status: 'pending', hasPhoto: false,
    label: c.name, linkName: c.name, ref: {name: c.name}, chat, via: 'tg'};
  const ids = await getJSON(env, 'claims', []);
  ids.push(id);
  await putJSON(env, 'claims', ids.slice(-200));
  const owner = await env.BB.get('owner');
  if (owner) {
    const text = '🗓️ <b>' + esc(c.name) + '</b> pediu mais prazo (pelo Telegram)\nPagar <b>' + brl(amount) + '</b>' + (due ? ' (' + (due < today ? 'venceu' : 'vence') + ' ' + fmtDate(due) + ')' : '') + ' até <b>' + fmtDate(iso) + '</b>' +
      (claim.note ? '\n“' + esc(claim.note) + '”' : '') + '\n\nAceita?';
    const r = await say(env, owner, text, {reply_markup: {inline_keyboard: [[{text: '✅ Aceitar', callback_data: 'claim:ok:' + id}, {text: '❌ Recusar', callback_data: 'claim:no:' + id}]]}});
    if (r && r.ok && r.result) claim.tg = {chat: owner, msg: r.result.message_id, photo: false};
  }
  await putJSON(env, 'claim:' + id, claim);
  return say(env, chat, '📨 Pedido enviado: pagar ' + brl(amount) + ' até <b>' + fmtFull(iso) + '</b>. Te aviso aqui quando responderem.');
}
// configurar lembretes: antecedência e pausa
function cfgText(fr) {
  const lead = fr.lead == null ? 1 : fr.lead, today = todayBR();
  const paused = fr.pause && fr.pause > today;
  return '⚙️ <b>Lembretes</b>\nAgora você recebe <b>' + leadLabel(lead) + '</b> do vencimento' + (paused ? ', mas está <b>pausado até ' + fmtFull(fr.pause) + '</b>' : '') + '. Se atrasar, a cada 3 dias.\n\nQuando você quer ser avisado?';
}
function cfgMarkup(fr) {
  const lead = fr.lead == null ? 1 : fr.lead, paused = fr.pause && fr.pause > todayBR();
  const b = (n, t) => ({text: (lead === n ? '✓ ' : '') + t, callback_data: 'fr:lead:' + n});
  return {inline_keyboard: [[b(3, '3 dias antes'), b(1, '1 dia antes'), b(0, 'Só no dia')],
    paused ? [{text: '▶️ Voltar a receber agora', callback_data: 'fr:resume'}] : [{text: '⏸️ Pausar por um tempo', callback_data: 'fr:pmenu'}]]};
}
function pauseMarkup() {
  const today = todayBR();
  return {inline_keyboard: [[3, 7, 15].map(n => ({text: n + ' dias', callback_data: 'fr:pause:' + addDays(today, n)})), [{text: 'Até ' + fmtDate(addDays(today, 30)), callback_data: 'fr:pause:' + addDays(today, 30)}, CANCEL]]};
}
async function friendSet(env, me, patch) {
  const friends = await getJSON(env, 'friends', {});
  if (!friends[me]) return null;
  Object.assign(friends[me], patch);
  Object.keys(patch).forEach(k => { if (patch[k] == null) delete friends[me][k]; });
  await putJSON(env, 'friends', friends);
  return friends[me];
}
async function pauseFriend(env, chat, me, c, until) {
  const today = todayBR();
  if (!until || until <= today || until > addDays(today, 60)) return say(env, chat, 'Escolha uma data entre amanhã e daqui a 2 meses. Ex: <code>/pausar 20/10</code>.', {reply_markup: pauseMarkup()});
  await friendSet(env, me, {pause: until});
  await say(env, chat, '⏸️ Pausado. Você não recebe lembretes até <b>' + fmtFull(until) + '</b>; a partir desse dia volta ao normal. Pra voltar antes: /retomar');
  const owner = await env.BB.get('owner');
  if (owner) await say(env, owner, '⏸️ <b>' + esc(c ? c.name : me) + '</b> pausou os lembretes do Telegram até ' + fmtFull(until) + '.');
}
async function sendFriendReceipts(env, chat, v, pick) {
  const list = (v && v.paidDebts) || [];
  if (!list.length) return say(env, chat, '🧾 Ainda não tem dívida quitada. Quando você quitar, o recibo chega aqui sozinho.');
  if (pick == null && list.length > 1) {
    return say(env, chat, '🧾 De qual dívida você quer o recibo?', {reply_markup: {inline_keyboard: list.slice(0, 6).map((d, i) => [{text: d.title + ' (' + fmtFull(d.date) + ') · ' + brl(d.total), callback_data: 'fr:rc:' + i}])}});
  }
  const d = list[pick == null ? 0 : +pick];
  if (!d) return;
  const rc = await engineRun(env, e => e.receipt(d._id));
  if (!rc) return say(env, chat, 'Não consegui gerar esse recibo agora. Tente de novo mais tarde.');
  const s = await getJSON(env, 'summary', null);
  return sendDoc(env, chat, rc, '🧾 Recibo de quitação: ' + brl(rc.total) + ', tudo pago' + (s && s.owner ? ' a ' + esc(firstOf(s.owner)) : '') + '.');
}
const FR_ROUTES = [
  [/^\/?(menu|ajuda|help|opcoes|comandos)\b/, 'menu'],
  [/^\/?(status|resumo|start|saldo|quanto devo)\b/, 'status'],
  [/^\/?parcelas?\b/, 'parc'],
  [/^\/?(pix|qr ?code|qr|pagar|chave)\b/, 'pix'],
  [/^\/?(ja paguei|paguei|pago|comprovante)\b/, 'pago'],
  [/^\/?(prazo|adiar|mais prazo)\b/, 'prazo'],
  [/^\/?(historico|pagamentos)\b/, 'hist'],
  [/^\/?(recibo|quitacao)\b/, 'rc'],
  [/^\/?(lembretes?|avisos?|config\w*)\b/, 'cfg'],
  [/^\/?(pausar|pausa)\b/, 'pause'],
  [/^\/?(retomar|voltar)\b/, 'resume']
];
async function friendAction(env, chat, me, fr, act, arg, extra) {
  const s = await getJSON(env, 'summary', null);
  const c = s && (s.charges || []).find(x => x.key === me) || null;
  const owner = s && s.owner ? firstOf(s.owner) : '';
  const needView = ['parc', 'pix', 'pago', 'prazo', 'hist', 'rc', 'pv', 'np', 'pd', 'pz', 'photo'].includes(act);
  const v = needView ? await friendView(env, me) : null;
  if (act === 'menu') return say(env, chat, '📌 <b>O que dá pra fazer aqui</b>' + (owner ? ' (com ' + esc(owner) + ')' : '') + '\n\n' +
    '📋 /parcelas · parcelas e vencimentos\n💠 /pix · PIX com o valor certo e QR Code\n✅ /paguei · avisar que pagou, com o comprovante\n🗓️ /prazo · pedir mais prazo\n📜 /historico · o que você já pagou\n🧾 /recibo · recibo de quitação\n⚙️ /lembretes · quando ser avisado\n⏸️ /pausar · pausar por um tempo\n🔕 /parar · não receber mais nada', {reply_markup: friendMenu(c)});
  if (act === 'status') return say(env, chat, c ? friendText(c, 'status', s.owner) + (s.pix ? '\n\nPIX: <code>' + esc(s.pix) + '</code>' : '') : 'Nada em aberto agora. 🎉', {reply_markup: friendMenu(c)});
  if (act === 'parc') return say(env, chat, parcelasText(v), {reply_markup: friendMenu(c)});
  if (act === 'hist') return say(env, chat, historicoText(v), {reply_markup: v && v.paidDebts && v.paidDebts.length ? {inline_keyboard: [[{text: '🧾 Recibo de quitação', callback_data: 'fr:rc'}]]} : undefined});
  if (act === 'rc') return sendFriendReceipts(env, chat, v, arg);
  if (act === 'pix') return friendPix(env, chat, v, s, arg);
  if (act === 'pago' || act === 'photo') {
    const w = {kind: 'pago'};
    const amt = arg ? money((new RegExp(NUM, 'i').exec(arg) || [])[1] || '') : NaN;
    if (amt > 0) w.amount = amt;
    if (extra && extra.photo) w.photo = extra.photo;
    if (!c) return say(env, chat, 'Nada em aberto agora. 🎉');
    return pagoStep(env, chat, me, fr, c, v, w);
  }
  if (act === 'pv' || act === 'np' || act === 'pd') {
    const w = await getWait(env, chat);
    if (!w || w.kind !== 'pago' || !c) return say(env, chat, 'Esse pedido expirou. Toque em ✅ Já paguei de novo.', {reply_markup: friendMenu(c)});
    if (act === 'pv') { const m = /^(\d+)(?::(\w+))?$/.exec(arg || ''); if (m) { w.amount = +m[1] / 100; if (m[2]) w.debt = m[2]; } }
    if (act === 'np') w.nophoto = true;
    if (act === 'pd') w.debt = arg;
    return pagoStep(env, chat, me, fr, c, v, w);
  }
  if (act === 'prazo') return c ? prazoStart(env, chat, fr, c, v, arg) : say(env, chat, 'Nada em aberto agora. 🎉');
  if (act === 'pz') return c ? prazoSend(env, chat, fr, c, v, arg) : null;
  if (act === 'cfg') return say(env, chat, cfgText(fr), {reply_markup: cfgMarkup(fr)});
  if (act === 'lead') {
    const n = [0, 1, 3].includes(+arg) ? +arg : 1;
    const nf = await friendSet(env, me, {lead: n});
    return say(env, chat, '✓ Combinado: você recebe ' + leadLabel(n) + ' do vencimento' + (nf && nf.pause && nf.pause > todayBR() ? ' (quando a pausa acabar)' : '') + '.');
  }
  if (act === 'pmenu') return say(env, chat, '⏸️ Pausar os lembretes até quando? Ou mande <code>/pausar 20/10</code>.', {reply_markup: pauseMarkup()});
  if (act === 'pause') {
    if (!arg) return say(env, chat, '⏸️ Pausar os lembretes até quando? Ou mande <code>/pausar 20/10</code>.', {reply_markup: pauseMarkup()});
    const d = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : /^\d{1,2}$/.test(arg.trim()) && +arg <= 60 && !/dia/.test(arg) ? addDays(todayBR(), +arg) : parseFriendDate(arg).iso;
    return pauseFriend(env, chat, me, c, d);
  }
  if (act === 'resume') {
    await friendSet(env, me, {pause: null});
    await say(env, chat, '▶️ Pronto, os lembretes voltaram.');
    const ow = await env.BB.get('owner');
    if (ow && fr.pause && fr.pause > todayBR()) await say(env, ow, '▶️ <b>' + esc(c ? c.name : me) + '</b> voltou a receber os lembretes do Telegram.');
    return;
  }
}
async function friendMessage(env, chat, msg, code) {
  const friends = await getJSON(env, 'friends', {});
  const owner = await env.BB.get('owner');
  const s = await getJSON(env, 'summary', null);
  const ownerName = s && s.owner ? firstOf(s.owner) : '';
  const text = String(msg.text || msg.caption || '').trim();
  if (code) {
    const snap = await getJSON(env, 'snapshot', null);
    const inv = (snap && snap.invites) || {};
    const key = Object.keys(inv).find(k => inv[k].code === code);
    if (!key) { await say(env, chat, 'Esse convite não vale mais. Peça um novo para quem te mandou.'); return; }
    Object.keys(friends).forEach(k => { if (friends[k].chat === chat && k !== key) delete friends[k]; });
    const old = friends[key];
    const isNew = !old || old.chat !== chat || old.code !== code;
    const name = [msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(' ');
    friends[key] = {chat, code, at: new Date().toISOString(), name, sent: {}, ...(old && !isNew ? {lead: old.lead, pause: old.pause} : {})};
    Object.keys(friends[key]).forEach(k => { if (friends[key][k] === undefined) delete friends[key][k]; });
    await putJSON(env, 'friends', friends);
    await tg(env, 'setMyCommands', {commands: FR_CMDS, scope: {type: 'chat', chat_id: chat}});
    const c = s && (s.charges || []).find(x => x.key === key);
    await say(env, chat, '✅ Pronto! Você vai receber aqui os lembretes do que está em aberto' + (ownerName ? ' com <b>' + esc(ownerName) + '</b>' : '') +
      ': na véspera e no dia do vencimento, e a cada 3 dias se atrasar.' + (c ? '\n\n' + friendText(c, 'status', s.owner) : '') +
      '\n\nPelos botões você vê as parcelas, pega o PIX, avisa que pagou e pede mais prazo. /menu mostra tudo, /parar para não receber mais.', {reply_markup: friendMenu(c)});
    if (isNew && owner) {
      const who = c ? c.name : (name || 'Alguém');
      await say(env, owner, '📨 <b>' + esc(who) + '</b> entrou nos lembretes do Telegram. O bot avisa na véspera e no dia do vencimento (e a cada 3 dias se atrasar).');
    }
    return;
  }
  const me = Object.keys(friends).find(k => friends[k].chat === chat);
  if (!me) { await say(env, chat, 'Este bot é privado.'); return; }
  const fr = friends[me];
  const c = s && (s.charges || []).find(x => x.key === me);
  const n = norm(text);
  if (/^\/(parar|stop|sair)\b/.test(n)) {
    delete friends[me];
    await putJSON(env, 'friends', friends);
    await setWait(env, chat, null);
    await tg(env, 'deleteMyCommands', {scope: {type: 'chat', chat_id: chat}});
    await say(env, chat, 'Pronto, você não recebe mais lembretes. Se mudar de ideia, é só abrir o convite de novo.');
    if (owner) await say(env, owner, '🔕 <b>' + esc(c ? c.name : me) + '</b> saiu dos lembretes do Telegram.');
    return;
  }
  const photo = (msg.photo && msg.photo.length) ? pickPhoto(msg.photo) : (msg.document && /^image\//.test(msg.document.mime_type || '') ? msg.document : null);
  const wait = await getWait(env, chat);
  if (photo) {
    const w = wait && wait.kind === 'pago' ? wait : {kind: 'pago'};
    w.photo = {file_id: photo.file_id, file_size: photo.file_size, mime_type: photo.mime_type};
    const amt = text ? money((new RegExp(NUM, 'i').exec(text) || [])[1] || '') : NaN;
    if (amt > 0) w.amount = amt;
    if (!c) return say(env, chat, 'Nada em aberto agora. 🎉');
    return pagoStep(env, chat, me, fr, c, await friendView(env, me), w);
  }
  if (/^(cancelar|cancela)\b/.test(n.replace(/^\//, ''))) { if (wait) await setWait(env, chat, null); return say(env, chat, wait ? 'Cancelado.' : 'Nada pra cancelar.', {reply_markup: friendMenu(c)}); }
  if (wait && !text.startsWith('/')) {
    if (wait.kind === 'pago') {
      const amt = money((new RegExp(NUM, 'i').exec(text) || [])[1] || '');
      if (!(amt > 0) && !(wait.amount > 0)) return say(env, chat, 'Não entendi o valor 🤔 Manda só o número, tipo <code>150</code> ou <code>150,50</code>.', {reply_markup: {inline_keyboard: [[CANCEL]]}});
      if (amt > 0) wait.amount = amt;
      if (!c) return say(env, chat, 'Nada em aberto agora. 🎉');
      return pagoStep(env, chat, me, fr, c, await friendView(env, me), wait);
    }
    if (wait.kind === 'prazo' && c) return prazoSend(env, chat, fr, c, await friendView(env, me), text);
  }
  for (const [re, act] of FR_ROUTES) {
    const m = re.exec(n);
    if (m) {
      if (wait) await setWait(env, chat, null);
      const arg = text.slice(text.search(/\s|$/)).trim() || null;
      return friendAction(env, chat, me, fr, act, act === 'pago' && /^\/?(ja paguei)/.test(n) ? text.replace(/^\/?j[aá]\s+paguei/i, '').trim() || null : arg);
    }
  }
  await say(env, chat, 'Este bot é automático e não repassa mensagens' + (ownerName ? '; para falar com ' + esc(ownerName) + ', mande mensagem direto' : '') + '. O que dá pra fazer aqui:', {reply_markup: friendMenu(c)});
}
async function friendCallback(env, cq, chat) {
  const friends = await getJSON(env, 'friends', {});
  const me = Object.keys(friends).find(k => friends[k].chat === chat);
  await tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
  if (!me) return say(env, chat, 'Você não está mais nos lembretes. Para voltar, abra o convite de novo.');
  const m = /^fr:(\w+)(?::(.+))?$/.exec(cq.data || '');
  if (!m) return;
  if (m[1] === 'x') { await setWait(env, chat, null); return say(env, chat, 'Cancelado.'); }
  return friendAction(env, chat, me, friends[me], m[1], m[2] == null ? null : m[2]);
}
// todo dia às 9h: X dias antes (padrão: véspera), no dia do vencimento e, se atrasado, a cada 3 dias
async function friendReminders(env) {
  const [friends, snap, s, owner] = await Promise.all([getJSON(env, 'friends', {}), getJSON(env, 'snapshot', null), getJSON(env, 'summary', null), env.BB.get('owner')]);
  if (!s || !snap || !Object.keys(friends).length) return;
  const today = todayBR(), inv = snap.invites || {}, done = [];
  let dirty = false;
  for (const key of Object.keys(friends)) {
    const fr = friends[key], iv = inv[key];
    if (!iv || iv.code !== fr.code || iv.on === false) continue;
    if (fr.pause && fr.pause > today) continue;
    if (fr.pause) { delete fr.pause; dirty = true; }
    const c = (s.charges || []).find(x => x.key === key);
    if (!c) continue;
    fr.sent = fr.sent || {};
    const lead = fr.lead == null ? 1 : fr.lead;
    let kind = null;
    if (c.late > 0) { if (!fr.sent.late || addDays(fr.sent.late, 3) <= today) kind = 'late'; }
    else if (c.next && c.next.date === today) kind = 'today';
    else if (c.next && lead > 0 && c.next.date === addDays(today, lead)) kind = lead === 1 ? 'tomorrow' : 'soon';
    if (!kind || fr.sent.day === today) continue;
    const r = await sendFriend(env, fr, c, kind, s);
    if (r.ok) {
      fr.sent.day = today;
      if (kind === 'late') fr.sent.late = today;
      done.push(esc(firstOf(c.name)) + ' (' + (kind === 'late' ? 'atrasado' : kind === 'today' ? 'vence hoje' : kind === 'tomorrow' ? 'vence amanhã' : 'vence em ' + lead + ' dias') + ')');
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
  if (parts[2] === 'prazo' && req.method === 'POST') return prazoCreate(req, env, token, v);
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
// pessoa com mais de uma dívida: escolher qual vai pagar (ou tudo)
function payChoices(v) {
  const ds = (v.type === 'person' && v.debts) || [];
  if (ds.length < 2) return [];
  const today = todayBR(), out = [];
  const lateN = ds.filter(d => d.late > 0).length;
  if (lateN > 1) out.push({value: 'late', amt: v.late, label: 'Tudo que está atrasado · ' + brl(v.late)});
  ds.forEach((d, i) => {
    const when = d.late > 0 ? 'atrasado' : d.due ? 'vence ' + fmtFull(d.due) : (d.insts || []).find(x => x.open > 0) ? 'parcela de ' + fmtFull((d.insts || []).find(x => x.open > 0).due) : '';
    out.push({value: String(i), amt: d.payNow || d.remaining, label: d.title + ' (' + fmtFull(d.date) + ') · ' + brl(d.payNow || d.remaining) + (when ? ' ' + when : '')});
  });
  out.push({value: 'all', amt: v.remaining, label: 'Tudo que falta · ' + brl(v.remaining)});
  return out;
}
function whichSelect(v, amount) {
  const ch = payChoices(v);
  if (!ch.length) return '';
  let sel = ch.findIndex(c => Math.abs(c.amt - amount) < 0.005);
  if (sel < 0) sel = 0;
  return '<label class="lbl" for="which">O que você vai pagar</label><select id="which">' +
    ch.map((c, i) => '<option value="' + c.value + '" data-amt="' + Number(c.amt).toFixed(2) + '"' + (i === sel ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select>';
}
function pixBlock(token, v, amount, owner) {
  if (!v.pixInfo && !v.pix) return '';
  if (!v.pixInfo) return '<div class="card pix"><div><span class="muted">PIX de ' + owner + '</span><code id="pix">' + esc(v.pix) + '</code></div><button onclick="copyEl(\'pix\',this)">Copiar</button></div>';
  const ch = payChoices(v);
  if (ch.length && !ch.some(c => Math.abs(c.amt - amount) < 0.005)) amount = ch[0].amt;
  const code = pixCode({...v.pixInfo, amount, txid: 'BB' + token.slice(0, 10)});
  return '<div class="card paybox" id="pagar"><h2>Pagar com PIX</h2>' +
    (v.type === 'group' ? '<label class="lbl" for="who">Quem está pagando</label><select id="who">' + v.members.map((m, i) => m.remaining > 0 ? '<option value="' + i + '" data-amt="' + m.remaining.toFixed(2) + '">' + esc(m.name) + ' · ' + brl(m.remaining) + '</option>' : '').join('') + '</select>' : '') +
    whichSelect(v, amount) +
    '<label class="lbl" for="amt">Valor</label><div class="amt"><span>R$</span><input id="amt" inputmode="decimal" autocomplete="off" value="' + amount.toFixed(2).replace('.', ',') + '"></div>' +
    '<div class="qr"><img id="qr" alt="QR Code do PIX" src="data:image/svg+xml;base64,' + btoa(qrSvg(code)) + '"></div>' +
    '<div class="cc"><code id="cc">' + esc(code) + '</code></div>' +
    '<button class="wide" onclick="copyEl(\'cc\',this)">Copiar código PIX</button>' +
    '<p class="muted small center-t">No app do banco: PIX → <b>Copia e cola</b> (ou leia o QR). Vai pra ' + owner + ', chave ' + esc(v.pix) + '.</p></div>';
}
function paidBlock(v, claims) {
  claims = claims.filter(c => c.kind !== 'prazo');
  const list = claims.map(c => '<div class="row slim"><span class="cl ' + c.status + '">' + (c.status === 'ok' ? '✓' : c.status === 'no' ? '✕' : '⏳') + '</span><div class="grow"><b>' + brl(c.amount) + (c.whoName && v.type === 'group' ? ' · ' + esc(c.whoName) : '') + '</b><span class="muted">informado em ' + fmtFull(c.at.slice(0, 10)) +
    (c.status === 'ok' ? ' · confirmado' : c.status === 'no' ? ' · não encontrado, fale com quem te mandou' : ' · aguardando confirmação') + '</span></div></div>').join('');
  return '<div class="card"><h2>Já pagou?</h2><p class="muted small">Avise aqui e mande o comprovante. O pagamento entra quando for confirmado.</p>' +
    (list ? '<div class="claims">' + list + '</div>' : '') +
    '<button class="wide ghost" id="paidOpen" onclick="document.getElementById(\'paidForm\').hidden=false;this.hidden=true">Já paguei · mandar comprovante</button>' +
    '<form id="paidForm" hidden onsubmit="return sendPaid(event)">' +
    (v.type === 'group' ? '<label class="lbl" for="pwho">Quem pagou</label><select id="pwho">' + v.members.map((m, i) => m.remaining > 0 ? '<option value="' + i + '" data-amt="' + m.remaining.toFixed(2) + '">' + esc(m.name) + '</option>' : '').join('') + '</select>' : '') +
    (payChoices(v).length ? '<p class="muted small">Referente a: <b id="pwhichl"></b></p>' : '') +
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
  const owe = v.dir === 'owe';
  const pay = owe ? '' : open ? pixBlock(token, v, suggest, owner) + paidBlock(v, claims) + prazoBlock(v, claims) : (claims.some(c => c.kind !== 'prazo') ? paidBlock(v, claims) : '');
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
  const debts = (v.debts || []).map((d, i) => {
    const insts = (d.insts || []).map(it => {
      const st = STATE[it.state] || ['', ''];
      return '<div class="row slim"><span class="n">' + it.n + 'ª</span><div class="grow"><b>' + brl(it.value) + '</b><span class="muted">vence ' + fmtFull(it.due) + (it.open > 0 && it.open < it.value - 0.005 ? ' · falta ' + brl(it.open) : '') + '</span></div><span class="tag ' + st[1] + '">' + st[0] + '</span></div>';
    }).join('');
    const pays = (d.payments || []).slice(0, 8).map(p => '<div class="row slim"><span class="muted">' + fmtFull(p.date) + (p.label && p.label !== 'pagamento' ? ' · ' + esc(p.label) : '') + '</span><div class="grow"></div>' + (p.done ? '<span class="q-badge">Quitada</span>' : '') + '<b class="okc">' + brl(p.amount) + '</b></div>').join('');
    const pickBtn = (v.debts || []).length > 1 && v.pixInfo ? '<button class="ghost small" onclick="pickDebt(' + i + ')">Pagar esta</button>' : '';
    return '<div class="card"><div class="dh"><div><h2>' + esc(d.title) + '</h2><span class="muted">' + (d.monthly > 0 ? brl(d.monthly) + ' por mês · ' : '') + 'desde ' + fmtFull(d.date) + (d.due ? ' · vence ' + fmtFull(d.due) : '') + '</span></div>' +
      '<div class="right"><b class="' + (d.late > 0 ? 'latec' : '') + '">' + brl(d.remaining) + '</b><span class="muted">' + (owe ? 'falta pagar' : 'em aberto') + '</span></div></div>' +
      '<div class="prog"><i style="width:' + (d.total > 0 ? Math.min(100, d.paid / d.total * 100) : 0) + '%"></i></div>' +
      '<p class="muted small">' + (d.monthly > 0 ? 'Cobrado até agora ' : 'Total ') + brl(d.total) + ' · já pago ' + brl(d.paid) + (d.late > 0 ? ' · <span class="latec">' + brl(d.late) + ' atrasado</span>' : '') + '</p>' + pickBtn +
      (insts ? '<h3>Parcelas</h3>' + insts : '') + (pays ? '<h3>Pagamentos</h3>' + pays : '') + '</div>';
  }).join('');
  const hero = owe
    ? '<div class="card hero"><span class="muted">' + (v.owner ? owner + ' deve a ' + esc(v.name) : 'Dívida com ' + esc(v.name)) + '</span>' +
      (v.remaining > 0
        ? '<h1>' + brl(v.remaining) + '</h1><p class="muted">falta pagar' + (v.late > 0 ? ' · <span class="latec">' + brl(v.late) + ' atrasado</span>' : '') + '</p>'
        : '<h1>Tudo pago 🎉</h1><p class="muted">Não deve mais nada por enquanto.</p>') +
      (v.donePaid > 0 || v.debts.some(d => d.paid > 0) ? '<p class="muted small">Já pago: ' + brl(v.donePaid + v.debts.reduce((a, d) => a + d.paid, 0)) + '</p>' : '') + '</div>'
    : '<div class="card hero"><span class="muted">Oi, ' + esc(v.name) + '!</span>' +
    (v.remaining > 0
      ? '<h1>' + brl(v.remaining) + '</h1><p class="muted">em aberto com ' + owner + (v.late > 0 ? ' · <span class="latec">' + brl(v.late) + ' atrasado</span>' : '') + '</p>'
      : '<h1>Tudo quitado 🎉</h1><p class="muted">Você não deve nada para ' + owner + '. Valeu!</p>') +
    (v.doneCount ? '<p class="muted small">' + v.doneCount + ' dívida(s) já quitada(s), ' + brl(v.donePaid) + ' pagos.</p>' : '') + '</div>';
  if (owe) return owePage(v, v.owner || '');
  return page('Resumo para ' + v.name, hero + pay + debts + upd + script, v.remaining > 0 ? brl(v.remaining) + ' em aberto' : 'Tudo quitado');
}
const PAGE_JS = `
function copyEl(id,b){var t=document.getElementById(id).textContent;var done=function(){b.textContent="Copiado ✓";setTimeout(function(){b.textContent=b.getAttribute("data-l")||"Copiar"},2500)};b.setAttribute("data-l",b.getAttribute("data-l")||b.textContent);(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(done,function(){var r=document.createRange();r.selectNode(document.getElementById(id));getSelection().removeAllRanges();getSelection().addRange(r);b.textContent="Selecionado: copie"})}
function num(s){s=String(s||"").replace(/[^0-9,\\.]/g,"");if(s.indexOf(",")>=0)s=s.replace(/\\./g,"").replace(",",".");var v=parseFloat(s);return isNaN(v)?0:v}
var amt=document.getElementById("amt"),tm;
function upd(){clearTimeout(tm);tm=setTimeout(function(){fetch("/s/"+TK+"/pix.json?v="+num(amt.value)).then(function(r){return r.json()}).then(function(j){if(!j.code)return;document.getElementById("cc").textContent=j.code;document.getElementById("qr").src="data:image/svg+xml;base64,"+btoa(j.svg)})},350)}
if(amt)amt.addEventListener("input",upd);
var who=document.getElementById("who");if(who)who.addEventListener("change",function(){amt.value=who.options[who.selectedIndex].getAttribute("data-amt").replace(".",",");upd()});
var which=document.getElementById("which");function useWhich(){amt.value=which.options[which.selectedIndex].getAttribute("data-amt").replace(".",",");var pa=document.getElementById("pamt");if(pa)pa.value=amt.value;var pl=document.getElementById("pwhichl");if(pl)pl.textContent=which.options[which.selectedIndex].textContent;upd()}
if(which)which.addEventListener("change",useWhich);
function pickDebt(i){if(!which)return;for(var k=0;k<which.options.length;k++){if(which.options[k].value===String(i))which.selectedIndex=k}useWhich();document.getElementById("pagar").scrollIntoView({behavior:"smooth"})}
var pwho=document.getElementById("pwho"),pamt=document.getElementById("pamt");
function syncP(){if(pwho&&pamt)pamt.value=pwho.options[pwho.selectedIndex].getAttribute("data-amt").replace(".",",")}
if(pwho){pwho.addEventListener("change",syncP);syncP()}else if(pamt&&amt){pamt.value=amt.value}
if(which){var pl0=document.getElementById("pwhichl");if(pl0)pl0.textContent=which.options[which.selectedIndex].textContent}
function shrink(f){return new Promise(function(res){if(!f)return res("");var u=URL.createObjectURL(f),i=new Image();i.onload=function(){var k=Math.min(1,1400/Math.max(i.naturalWidth,i.naturalHeight)),c=document.createElement("canvas");c.width=Math.round(i.naturalWidth*k);c.height=Math.round(i.naturalHeight*k);var x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL("image/jpeg",0.72))};i.onerror=function(){res("")};i.src=u})}
function sendPrazo(e){e.preventDefault();var b=document.getElementById("zsend"),m=document.getElementById("zmsg"),d=document.getElementById("zdate").value,zw=document.getElementById("zwho");if(!d){m.textContent="Escolha a data.";return false}b.disabled=true;b.textContent="Enviando…";
fetch("/s/"+TK+"/prazo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date:d,note:document.getElementById("znote").value,who:zw?+zw.value:null})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){if(x.ok){document.getElementById("przForm").innerHTML='<p class="okmsg">✓ Pedido enviado! A resposta aparece aqui.</p>';setTimeout(function(){location.reload()},2500)}else{m.textContent=x.j.error||"Não deu certo, tente de novo.";b.disabled=false;b.textContent="Enviar pedido"}}).catch(function(){m.textContent="Sem conexão, tente de novo.";b.disabled=false;b.textContent="Enviar pedido"});return false}
function sendPaid(e){e.preventDefault();var b=document.getElementById("psend"),m=document.getElementById("pmsg"),v=num(pamt.value);if(!(v>0)){m.textContent="Informe o valor.";return false}b.disabled=true;b.textContent="Enviando…";
shrink(document.getElementById("pfile").files[0]).then(function(photo){return fetch("/s/"+TK+"/pago",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:v,note:document.getElementById("pnote").value,who:pwho?+pwho.value:null,debt:which?which.value:null,photo:photo})})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){if(x.ok){document.getElementById("paidForm").innerHTML='<p class="okmsg">✓ Enviado! Assim que for confirmado, aparece aqui.</p>';setTimeout(function(){location.reload()},2500)}else{m.textContent=x.j.error||"Não deu certo, tente de novo.";b.disabled=false;b.textContent="Enviar"}}).catch(function(){m.textContent="Sem conexão, tente de novo.";b.disabled=false;b.textContent="Enviar"});return false}
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
async function prazoCreate(req, env, token, v) {
  if (!v) return json({error: 'Link desativado.'}, 404);
  if (v.dir === 'owe') return json({error: 'Este link é só de consulta.'}, 400);
  const rate = await getJSON(env, 'crate:' + token, {n: 0, t: 0});
  if (Date.now() - rate.t > 3600000) { rate.n = 0; rate.t = Date.now(); }
  if (rate.n >= 5) return json({error: 'Muitos envios seguidos. Tente de novo em uma hora.'}, 429);
  const body = await req.json().catch(() => null);
  if (!body) return json({error: 'Envio inválido.'}, 400);
  const today = todayBR(), newDate = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || newDate <= today || newDate > addDays(today, 120)) return json({error: 'Escolha uma data entre amanhã e daqui a 4 meses.'}, 400);
  let who = null, whoName = '', amount = 0, due = '';
  if (v.type === 'group') {
    who = +body.who;
    if (!(who >= 0 && who < v.members.length)) return json({error: 'Escolha quem vai pagar.'}, 400);
    whoName = v.members[who].name; amount = v.members[who].remaining; due = v.dueDate || '';
  } else { amount = v.suggest || v.remaining || 0; due = v.nextDue || ''; }
  const claims = await claimsFor(env, token);
  if (claims.some(c => c.kind === 'prazo' && c.status === 'pending' && (v.type !== 'group' || c.who === who))) return json({error: 'Já tem um pedido de prazo esperando resposta.'}, 409);
  rate.n++; await putJSON(env, 'crate:' + token, rate);
  const id = 'cl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const claim = {id, kind: 'prazo', token, at: new Date().toISOString(), newDate, amount, due, note: String(body.note || '').slice(0, 140), who, whoName, status: 'pending', hasPhoto: false,
    label: v.type === 'group' ? whoName + ' · ' + v.title : v.name, linkName: v.type === 'group' ? v.title : v.name};
  const ids = await getJSON(env, 'claims', []);
  ids.push(id);
  await putJSON(env, 'claims', ids.slice(-200));
  const owner = await env.BB.get('owner');
  if (owner) {
    const text = '🗓️ <b>' + esc(claim.label) + '</b> pediu mais prazo\nPagar <b>' + brl(amount) + '</b>' + (due ? ' (' + (due < today ? 'venceu' : 'vence') + ' ' + fmtDate(due) + ')' : '') + ' até <b>' + fmtDate(newDate) + '</b>' +
      (claim.note ? '\n“' + esc(claim.note) + '”' : '') + '\n\nAceita?';
    const r = await say(env, owner, text, {reply_markup: {inline_keyboard: [[{text: '✅ Aceitar', callback_data: 'claim:ok:' + id}, {text: '❌ Recusar', callback_data: 'claim:no:' + id}]]}});
    if (r && r.ok && r.result) claim.tg = {chat: owner, msg: r.result.message_id, photo: false};
  }
  await putJSON(env, 'claim:' + id, claim);
  return json({ok: true});
}
function prazoBlock(v, claims) {
  const today = todayBR();
  const mine = claims.filter(c => c.kind === 'prazo');
  const list = mine.map(c => '<div class="row slim"><span class="cl ' + c.status + '">' + (c.status === 'ok' ? '✓' : c.status === 'no' ? '✕' : '⏳') + '</span><div class="grow"><b>Até ' + fmtFull(c.newDate) + (c.whoName && v.type === 'group' ? ' · ' + esc(c.whoName) : '') + '</b><span class="muted">pedido em ' + fmtFull(c.at.slice(0, 10)) +
    (c.status === 'ok' ? ' · aceito, a nova data já vale' : c.status === 'no' ? ' · não aceito, fale com quem te mandou' : ' · aguardando resposta') + '</span></div></div>').join('');
  const pendingAll = v.type !== 'group' && mine.some(c => c.status === 'pending');
  return '<div class="card"><h2>Precisa de mais prazo?</h2><p class="muted small">Proponha uma nova data. A pessoa recebe o pedido e a resposta aparece aqui.</p>' +
    (list ? '<div class="claims">' + list + '</div>' : '') +
    (pendingAll ? '' : '<button class="wide ghost" id="przOpen" onclick="document.getElementById(\'przForm\').hidden=false;this.hidden=true">Pedir mais prazo</button>' +
    '<form id="przForm" hidden onsubmit="return sendPrazo(event)">' +
    (v.type === 'group' ? '<label class="lbl" for="zwho">Quem</label><select id="zwho">' + v.members.map((m, i) => m.remaining > 0 ? '<option value="' + i + '">' + esc(m.name) + '</option>' : '').join('') + '</select>' : '') +
    '<label class="lbl" for="zdate">Consigo pagar até</label><input id="zdate" type="date" min="' + addDays(today, 1) + '" max="' + addDays(today, 120) + '" required>' +
    '<label class="lbl" for="znote">Mensagem (opcional)</label><input id="znote" maxlength="140" placeholder="Ex: recebo meu salário dia 15">' +
    '<button class="wide" id="zsend" type="submit">Enviar pedido</button><p class="muted small" id="zmsg"></p></form>') + '</div>';
}
async function claimCreate(req, env, token, v) {
  if (!v) return json({error: 'Link desativado.'}, 404);
  if (v.dir === 'owe') return json({error: 'Este link é só de consulta.'}, 400);
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
  let debtId = null, debtTitle = '';
  if (v.type === 'person' && /^\d+$/.test(String(body.debt || '')) && v.debts && v.debts[+body.debt]) { debtId = v.debts[+body.debt]._id || null; debtTitle = v.debts[+body.debt].title + ' de ' + fmtFull(v.debts[+body.debt].date); }
  else if (body.debt === 'late') debtTitle = 'o que está atrasado';
  const claim = {id, token, at: new Date().toISOString(), amount, note: String(body.note || '').slice(0, 140), who, whoName, status: 'pending', hasPhoto: !!photo, debtId, debtTitle,
    label: (v.type === 'group' ? whoName + ' · ' + v.title : v.name) + (debtTitle ? ' · ' + debtTitle : ''), linkName: v.type === 'group' ? v.title : v.name};
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
  let op = null;
  c.status = ok ? 'ok' : 'no';
  c.decidedAt = new Date().toISOString();
  if (ok) {
    const ref = (v && v._ref) || c.ref || {};
    op = c.kind === 'prazo'
      ? {type: 'resched', newDate: c.newDate, date: todayBR(), at: c.decidedAt, text: 'prazo pedido pelo link (' + c.label + ') até ' + fmtDate(c.newDate),
        id: 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), viaLink: true}
      : {type: 'pay', kind: 'receivable', amount: c.amount, date: todayBR(), at: c.decidedAt, text: 'pagamento informado pelo link (' + c.label + ')',
      id: 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), viaLink: true};
    if (ref.type === 'group' && ref.members && ref.members[c.who]) { op.debtId = ref.members[c.who].debtId; op.name = ref.members[c.who].name; }
    else if (ref.debtId) { op.debtId = ref.debtId; op.name = ref.name; }
    else if (c.debtId) { op.debtId = c.debtId; op.name = ref.name || c.linkName; }
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
  let applied = null, res = null;
  if (ok) { res = await cloudApply(env, e => withReceipts(e, e.applyOps([op]))); applied = res && res[0]; }
  if (c.tg && c.kind === 'prazo') {
    const note = ok ? '✅ <b>Prazo aceito</b>: ' + esc(c.label) + ' paga até ' + fmtDate(c.newDate) + '.' + (applied && applied.ok ? ' Já está no app (e nos lembretes).' : ' Entra no app na próxima vez que você abrir.')
      : '❌ Pedido de prazo recusado (' + esc(c.label) + ', até ' + fmtDate(c.newDate) + '). A pessoa vê isso no link.';
    await tg(env, 'editMessageText', {chat_id: c.tg.chat, message_id: c.tg.msg, parse_mode: 'HTML', text: note});
  } else if (c.tg) {
    const note = ok ? '✅ <b>Confirmado</b>: ' + esc(c.label) + ' pagou ' + brl(c.amount) + '.' + (applied && applied.ok ? ' Já está no app.' : ' Entra no app na próxima vez que você abrir.') : '❌ Marcado como não recebido (' + esc(c.label) + ', ' + brl(c.amount) + '). A pessoa vê isso no link.';
    await tg(env, c.tg.photo ? 'editMessageCaption' : 'editMessageText', {chat_id: c.tg.chat, message_id: c.tg.msg, parse_mode: 'HTML', ...(c.tg.photo ? {caption: note} : {text: note})});
  }
  if (c.chat) {
    const sm = await getJSON(env, 'summary', null), who = sm && sm.owner ? esc(firstOf(sm.owner)) : 'Quem te emprestou';
    const msg = c.kind === 'prazo'
      ? (ok ? '✅ ' + who + ' aceitou: agora você paga ' + brl(c.amount) + ' até <b>' + fmtFull(c.newDate) + '</b>. Os lembretes já seguem a nova data.' : '❌ ' + who + ' não aceitou o prazo até ' + fmtFull(c.newDate) + '. Melhor falar direto com ' + who + '.')
      : (ok ? '✅ ' + who + ' confirmou seu pagamento de <b>' + brl(c.amount) + '</b>. Valeu! 🙌' : '❌ ' + who + ' não encontrou o pagamento de ' + brl(c.amount) + '. Confere o comprovante e fala direto com ' + who + '.');
    await say(env, c.chat, msg);
  }
  if (res) await sendReceipts(env, res);
  return {ok: true, status: c.status};
}
function initials(n) { const p = String(n || '?').replace(/\./g, '').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
// ---------------------------------------------------------------- link "do que devo": banner, próximo pagamento, dívidas e histórico
const LK_ICONS = {
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  laptop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  gift: '<path d="M12 7v14"/><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"/><rect x="3" y="7" width="18" height="4" rx="1"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  money: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', chev: '<path d="m6 9 6 6 6-6"/>'
};
// ícone pelo assunto (o texto que a pessoa escreveu); cada um com a sua cor
const LK_KEYS = [
  [/conserto|oficina|mecanic|reparo|pneu|embreagem|reforma|pedreiro/, 'wrench', 'gold'],
  [/moto|carro|uber|gasolina|combust|ipva|seguro do carro|estacionamento/, 'car', 'gold'],
  [/notebook|computador|\bpc\b|monitor|teclado|playstation|\bps5\b|xbox|videogame|console|tv\b|televis/, 'laptop', 'blue'],
  [/celular|iphone|telefone|plano|chip|internet/, 'phone', 'blue'],
  [/viagem|passagem|aviao|hotel|pousada|hospedagem|airbnb/, 'plane', 'purple'],
  [/mercado|compra|loja|roupa|tenis|shopee|amazon|mercado livre/, 'cart', 'orange'],
  [/aluguel|casa|apartamento|condominio|\bluz\b|agua|gas\b|movel|moveis|geladeira/, 'house', 'orange'],
  [/curso|faculdade|escola|livro|material|mensalidade|matricula/, 'book', 'purple'],
  [/saude|medico|remedio|dentista|hospital|exame|farmacia|consulta/, 'heart', 'red'],
  [/presente|aniversario|natal/, 'gift', 'red'],
  [/restaurante|ifood|comida|lanche|pizza|churrasco|\bbar\b|cerveja|jantar|almoco/, 'food', 'orange']
];
function lkIcon(d) {
  const t = norm((d.info && d.info.subject) || d.title || '');
  if (d.info && d.info.recurring) { const hit = LK_KEYS.find(k => k[0].test(t)); return hit ? [hit[1], 'green'] : ['repeat', 'green']; }
  const hit = LK_KEYS.find(k => k[0].test(t));
  return hit ? [hit[1], hit[2]] : (/grupo|racha|churras/.test(t) ? ['users', 'blue'] : ['money', 'gold']);
}
const lkSvg = (name, size) => '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + LK_ICONS[name] + '</svg>';
const LK_MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const lkMonYr = iso => iso ? LK_MON[+iso.slice(5, 7) - 1] + '/' + iso.slice(2, 4) : '';
function lkWhen(iso) {
  const d = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(todayBR() + 'T12:00:00Z')) / 86400000);
  if (d === 0) return {txt: 'hoje', cls: 'soon'};
  if (d === 1) return {txt: 'amanhã', cls: 'soon'};
  if (d < 0) return {txt: d === -1 ? 'atrasada desde ontem' : 'atrasada há ' + (-d) + ' dias', cls: 'late'};
  return {txt: 'em ' + d + ' dias', cls: d <= 7 ? 'soon' : ''};
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const LK_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// link gerado por um app de antes da v19 (sem "info" e "summary"): calcula aqui o que dá com o que veio
function lkFill(v) {
  const debts = (v.debts || []).map(d => {
    if (d.info) return d;
    const insts = (d.insts || []).slice().sort((a, b) => a.n - b.n), rec = d.monthly > 0;
    const open = insts.filter(it => it.open > 0.005);
    const vals = insts.map(it => it.value), same = vals.length && vals.every(x => Math.abs(x - vals[0]) < 0.05);
    let next = open[0] ? {date: open[0].due, amount: open[0].open, n: open[0].n} : (d.remaining > 0 && d.due ? {date: d.due, amount: d.remaining, n: 1} : null);
    const count = rec ? 0 : (insts.length ? insts[insts.length - 1].n : 1);
    return {...d, info: {subject: '', note: '', recurring: rec, day: rec && next ? +next.date.slice(8, 10) : 0,
      count, instValue: rec ? 0 : (same ? vals[0] : count === 1 ? d.total : 0), planLabel: '',
      paidCount: insts.filter(it => it.state === 'paga').length, next,
      after: open[1] ? {date: open[1].due, amount: open[1].open, n: open[1].n} : null,
      end: rec || !insts.length ? (rec ? '' : d.due || '') : insts[insts.length - 1].due, monthsPaid: rec ? (d.payments || []).length : 0}};
  });
  if (v.summary) return {...v, debts};
  const hist = [], dues = [], ends = [];
  debts.forEach(d => {
    const f = d.info, insts = (d.insts || []).slice().sort((a, b) => a.n - b.n);
    let cum = 0;
    (d.payments || []).slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(p => {
      const before = cum;
      cum += p.amount || 0;
      let label = 'pagamento';
      if (f.recurring) label = LK_MONTHS[+p.date.slice(5, 7) - 1];
      else if (f.count > 1 && insts.length === f.count) { let acc = 0, k = 0; while (k < insts.length - 1 && (acc += insts[k].value) < cum - 0.01) k++; label = 'parcela ' + insts[k].n + '/' + f.count; }
      const tot = insts.reduce((a, it) => a + (it.value || 0), 0);
      hist.push({date: p.date, amount: p.amount, title: d.title, label, done: !f.recurring && tot > 0 && before < tot - 0.01 && cum >= tot - 0.01});
    });
    if (f.next) dues.push({date: f.next.date, amount: f.next.amount, title: d.title, n: f.next.n, of: f.count, recurring: f.recurring});
    if (f.after) dues.push({date: f.after.date, amount: f.after.amount, title: d.title, n: f.after.n, of: f.count, recurring: f.recurring});
    if (!f.recurring && f.end) ends.push(f.end);
  });
  hist.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  dues.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const open = debts.filter(d => d.remaining > 0.005);
  return {...v, debts, summary: {
    openCount: open.filter(d => !d.info.recurring).length, recurringCount: open.filter(d => d.info.recurring).length,
    doneCount: v.doneCount || 0, paidTotal: Math.round(((v.donePaid || 0) + debts.reduce((a, d) => a + (d.paid || 0), 0)) * 100) / 100,
    payCount: hist.length, next: dues[0] || null, after: dues[1] || null, endAll: ends.sort().pop() || '', history: hist.slice(0, 8)}};
}
function owePage(v, ownerName) {
  v = lkFill(v);
  const s = v.summary || {}, debts = (v.debts || []).slice();
  // por vencimento; as recorrentes ficam por último, seja qual for a data
  const nxd = d => (d.info && d.info.next && d.info.next.date) || '9999';
  debts.sort((a, b) => ((a.info && a.info.recurring) ? 1 : 0) - ((b.info && b.info.recurring) ? 1 : 0) || (nxd(a) < nxd(b) ? -1 : nxd(a) > nxd(b) ? 1 : 0));
  const paidTot = s.paidTotal || 0, total = paidTot + (v.remaining || 0), pct = total > 0 ? Math.round(paidTot / total * 100) : 0;
  const me = ownerName || 'Você', them = v.name || '';
  const stats = [['Em aberto', String(s.openCount || 0), (s.openCount === 1 ? 'dívida' : 'dívidas'), '']];
  if (s.recurringCount) stats.push(['Recorrente', String(s.recurringCount), 'todo mês', '']);
  stats.push(['Quitadas', String(s.doneCount || 0), s.doneCount === 1 ? 'já acertada' : 'já acertadas', 'ok']);
  stats.push(s.endAll ? ['Termina tudo', lkMonYr(s.endAll), s.recurringCount ? 'sem as recorrentes' : 'última parcela', ''] : ['Já pago', brl(paidTot), plural(s.payCount || 0, 'pagamento', 'pagamentos'), 'ok']);
  const banner = '<section class="lk-banner" aria-label="Resumo"><div class="lk-bl">' +
    '<div class="lk-who"><span class="lk-av me">' + esc(initials(me).slice(0, 1)) + '</span><span class="lk-arrow">' + lkSvg('arrow', 16) + '</span><span class="lk-av them">' + esc(initials(them).slice(0, 1)) + '</span>' +
    '<span>' + esc(me) + (v.remaining > 0 ? ' ainda deve a ' : ' não deve nada a ') + '<b>' + esc(them) + '</b></span></div>' +
    (v.remaining > 0
      ? '<div class="lk-big"><span class="lk-lbl">FALTA PAGAR</span><b>' + brl(v.remaining) + '</b>' + (v.late > 0 ? '<span class="lk-late">' + brl(v.late) + ' atrasado</span>' : '') + '</div>'
      : '<div class="lk-big"><span class="lk-lbl">SITUAÇÃO</span><b class="okc">Tudo pago</b></div>') +
    '<div class="lk-prog"><div class="lk-bar"><i style="width:' + pct + '%"></i></div><div class="lk-pt"><span><b class="okc">' + brl(paidTot) + '</b> pagos de ' + brl(total) + '</span><span>' + pct + '%</span></div></div></div>' +
    '<div class="lk-stats' + (stats.length % 2 ? ' odd' : '') + '">' + stats.map(x => '<div class="lk-stat"><span>' + x[0] + '</span><b class="' + (x[3] === 'ok' ? 'okc' : '') + '">' + esc(x[1]) + '</b><small>' + x[2] + '</small></div>').join('') + '</div></section>';
  let next = '';
  if (s.next) {
    const w = lkWhen(s.next.date), dd = s.next.date;
    next = '<section class="lk-next ' + w.cls + '" aria-label="Próximo pagamento"><div class="lk-cal"><span>' + LK_MON[+dd.slice(5, 7) - 1].toUpperCase() + '</span><b>' + dd.slice(8, 10) + '</b></div>' +
      '<div class="lk-nx"><span class="lk-lbl">' + (w.cls === 'late' ? 'PAGAMENTO ATRASADO' : 'PRÓXIMO PAGAMENTO') + ' · ' + w.txt.toUpperCase() + '</span>' +
      '<b>' + esc(s.next.title) + ' <span>· ' + (s.next.recurring ? 'mensalidade' : 'parcela ' + s.next.n + ' de ' + s.next.of) + '</span></b></div>' +
      '<div class="lk-nv"><b>' + brl(s.next.amount) + '</b>' + (s.after ? '<span>depois: ' + brl(s.after.amount) + ' em ' + fmtDate(s.after.date) + '</span>' : '') + '</div></section>';
  }
  const hist = (s.history || []).length
    ? (s.history || []).map(h => '<div class="lk-h"><span class="lk-ck">' + lkSvg('check', 13) + '</span><div><div class="lk-nm"><b>' + esc(h.title) + '</b>' + (h.done ? '<span class="q-badge">' + lkSvg('check', 11) + 'Quitada</span>' : '') + '</div><span>' + esc(h.label) + ' · ' + fmtFull(h.date) + '</span></div><em>' + brl(h.amount) + '</em></div>').join('')
    : '<p class="lk-empty">Nenhum pagamento ainda.</p>';
  const aside = '<aside class="lk-hist" aria-label="Últimos pagamentos"><div class="lk-hh"><h2>Últimos pagamentos</h2>' + (s.payCount ? '<span>' + s.payCount + ' no total</span>' : '') + '</div>' + hist +
    '<div class="lk-tot"><span>Total pago</span><b>' + brl(paidTot) + '</b></div></aside>';
  const cards = debts.map(d => {
    const f = d.info || {}, [ico, col] = lkIcon(d), nx = f.next;
    const sub = f.recurring ? brl(d.monthly) + ' todo dia ' + (f.day || '') : f.planLabel || (f.count > 1 ? f.count + 'x de ' + brl(f.instValue || 0) : 'parcela única');
    const right = f.recurring
      ? (d.late > 0 ? '<b class="latec">' + brl(d.late) + '</b><span>atrasado</span>' : '<b class="okc">Em dia</b><span>' + (nx ? 'próxima em ' + fmtDate(nx.date) : 'tudo pago') + '</span>')
      : '<b' + (d.late > 0 ? ' class="latec"' : '') + '>' + brl(d.remaining) + '</b><span>falta de ' + brl(d.total) + '</span>';
    const insts = d.insts || [];
    const segs = !f.recurring && insts.length > 1 && insts.length <= 48
      ? '<div class="lk-segs" aria-label="' + f.paidCount + ' de ' + insts.length + ' parcelas pagas">' + insts.map(it => '<i class="' + (it.state === 'paga' ? 'ok' : it.state === 'atrasada' ? 'late' : nx && it.n === nx.n ? 'nx' : '') + '"></i>').join('') + '</div>' : '';
    const chips = [];
    if (nx) {
      const w = lkWhen(nx.date);
      if (!f.recurring && f.count > 1) chips.push(['Parcela ' + nx.n + ' de ' + f.count, '']);
      chips.push(['Próxima ' + fmtDate(nx.date) + (w.cls ? ' · ' + w.txt : '') + (f.recurring ? ' · ' + brl(nx.amount) : ''), w.cls]);
    }
    if (f.end && f.count > 1) chips.push(['Termina ' + lkMonYr(f.end), '']);
    if (f.recurring && f.monthsPaid) chips.push([plural(f.monthsPaid, 'mês pago', 'meses pagos'), '']);
    const list = !f.recurring && insts.length > 1
      ? '<details class="lk-insts"><summary><span class="sh">Ver parcelas</span><span class="hd">Esconder parcelas</span>' + lkSvg('chev', 15) + '</summary><div class="lk-grid-i">' +
        insts.map(it => '<div class="lk-i ' + (it.state === 'paga' ? 'ok' : it.state === 'atrasada' ? 'late' : '') + '"><span>' + it.n + 'ª</span><b>' + fmtDate(it.due) + '</b><em>' + (it.state === 'paga' ? 'Paga' : it.state === 'atrasada' ? 'Atrasada' : brl(it.open > 0 ? it.open : it.value)) + '</em></div>').join('') + '</div></details>'
      : '';
    return '<article class="lk-debt"><div class="lk-dh"><span class="lk-ico ' + col + '">' + lkSvg(ico, 22) + '</span><div class="lk-dt"><h3>' + esc(d.title) + (f.recurring ? ' <span class="lk-tag">Recorrente</span>' : '') + '</h3>' +
      '<span>' + sub + ' · desde ' + fmtFull(d.date) + '</span>' + (f.note ? '<p class="lk-note">“' + esc(f.note) + '”</p>' : '') + '</div><div class="lk-dr">' + right + '</div></div>' +
      segs + (chips.length || list ? '<div class="lk-chips">' + chips.map(c => '<span class="' + c[1] + '">' + esc(c[0]) + '</span>').join('') + '</div>' : '') + list + '</article>';
  }).join('');
  const upd = (v.updatedAt || '').slice(0, 10);
  const body = '<div class="lk-top"><span class="mark">B</span><span class="lk-brand">BarnaBank</span><span class="lk-upd">Página só para consulta · atualizado em ' + fmtFull(upd) + '</span></div>' +
    '<div class="lk-layout">' + banner + next + aside +
    '<div class="lk-debts">' + (debts.length ? '<div class="lk-dhh"><h2>Dívidas em aberto</h2><span>Ordenado por vencimento</span></div>' + cards : '<div class="lk-debt lk-empty">Nada em aberto agora.</div>') + '</div></div>';
  return page('Quanto falta pagar', body, v.remaining > 0 ? 'Falta pagar ' + brl(v.remaining) : 'Tudo pago', 200, 'lk');
}
const LK_CSS = `
body.lk main{max-width:1180px;padding:28px 24px 48px}body.lk .brand{display:none}
.lk-top{display:flex;align-items:center;gap:10px;margin:0 0 20px}.lk-brand{font-weight:600;color:#8c92a3}.lk-upd{margin-left:auto;font-size:12.5px;color:#6b7182;text-align:right}
.lk-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;grid-template-rows:auto auto 1fr;gap:20px;align-items:start}
.lk-banner{grid-column:1;grid-row:1;border-radius:22px;padding:26px 28px;border:1px solid #2a2618;background:linear-gradient(135deg,#1a1710 0%,#14171f 60%);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,300px);gap:28px;align-items:center}
.lk-bl{display:flex;flex-direction:column;gap:16px;min-width:0}
.lk-who{display:flex;align-items:center;gap:8px;font-size:14px;color:#a9aebb}.lk-who b{color:#eee9da;font-weight:600}
.lk-av{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:12.5px;flex-shrink:0}.lk-av.me{background:#2a2f3c;color:#e8cd8a}.lk-av.them{background:#1d2a44;color:#8fb5f5}.lk-arrow{color:#6b7182;display:flex}
.lk-lbl{font-size:12px;font-weight:700;color:#8c92a3;letter-spacing:.05em}
.lk-big{display:flex;flex-direction:column;gap:4px}.lk-big b{font-size:48px;font-weight:800;letter-spacing:-.02em;line-height:1}.lk-late{color:#e2665c;font-weight:600;font-size:13.5px}
.lk-prog{display:flex;flex-direction:column;gap:7px;max-width:460px}.lk-bar{height:9px;border-radius:99px;background:#1f2430;overflow:hidden}.lk-bar i{display:block;height:100%;background:#57b98a}
.lk-pt{display:flex;justify-content:space-between;font-size:13px;color:#8c92a3}.lk-pt b{font-weight:600}.lk-pt span:last-child{font-weight:600;color:#a9aebb}
.lk-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}.lk-stats.odd .lk-stat:last-child{grid-column:1 / -1}
.lk-stat{background:rgba(10,12,17,.55);border:1px solid #1f2430;border-radius:14px;padding:14px;display:flex;flex-direction:column;min-width:0}.lk-stat span{font-size:12px;color:#8c92a3}.lk-stat b{font-size:24px;font-weight:800;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lk-stat small{font-size:11.5px;color:#6b7182}
.lk-next{grid-column:1;grid-row:2;background:rgba(201,162,74,.09);border:1px solid rgba(201,162,74,.5);border-radius:20px;padding:18px 22px;display:flex;align-items:center;gap:20px}
.lk-next.late{background:rgba(226,102,92,.08);border-color:rgba(226,102,92,.45)}.lk-next .lk-lbl{color:#e8cd8a}.lk-next.late .lk-lbl{color:#f0a39c}
.lk-cal{width:68px;flex-shrink:0;border-radius:14px;background:#1b1810;border:1px solid rgba(201,162,74,.35);text-align:center;padding:8px 0;display:flex;flex-direction:column}.lk-cal span{font-size:11.5px;font-weight:700;color:#e8cd8a;letter-spacing:.08em}.lk-cal b{font-size:28px;font-weight:800;line-height:1.1}
.lk-nx{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}.lk-nx b{font-size:16px;font-weight:600}.lk-nx b span{color:#a9aebb;font-weight:500}
.lk-nv{text-align:right;flex-shrink:0;display:flex;flex-direction:column}.lk-nv b{font-size:28px;font-weight:800}.lk-nv span{font-size:12.5px;color:#a9aebb}
.lk-hist{grid-column:2;grid-row:1 / span 3;align-self:stretch;background:#14171f;border:1px solid #1f2430;border-radius:22px;padding:20px;display:flex;flex-direction:column;margin:0}
.lk-hh{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}.lk-hh h2{font-size:16px}.lk-hh span{font-size:12px;color:#6b7182}
.lk-h{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #181c25}.lk-h div{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}.lk-h b{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lk-h div span{font-size:12px;color:#8c92a3}.lk-h em{font-style:normal;font-size:13.5px;font-weight:700;color:#57b98a;white-space:nowrap}
.lk-nm{display:flex;align-items:center;gap:8px;min-width:0}.lk-nm b{min-width:0}
.lk-ck{width:26px;height:26px;border-radius:50%;background:rgba(87,185,138,.14);color:#57b98a;display:grid;place-items:center;flex-shrink:0}
.lk-tot{margin-top:auto;border-top:1px solid #1f2430;padding-top:14px;display:flex;justify-content:space-between;font-size:13px;color:#8c92a3}.lk-tot b{color:#eee9da;font-weight:700}
.lk-debts{grid-column:1;grid-row:3;display:flex;flex-direction:column;gap:14px}
.lk-dhh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:2px 2px 0}.lk-dhh h2{font-size:16px}.lk-dhh span{font-size:12.5px;color:#6b7182}
.lk-debt{background:#14171f;border:1px solid #1f2430;border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:14px}.lk-debt.lk-empty{color:#8c92a3;text-align:center}
.lk-dh{display:flex;gap:14px;align-items:flex-start}
.lk-ico{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;flex-shrink:0}.lk-ico.gold{background:#22202a;color:#e8cd8a}.lk-ico.blue{background:#1a2230;color:#8fb5f5}.lk-ico.green{background:#1c2620;color:#57b98a}.lk-ico.purple{background:#211d30;color:#b4a6f7}.lk-ico.orange{background:#2a1f16;color:#f0a865}.lk-ico.red{background:#2a1a1a;color:#f0a39c}
.lk-dt{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}.lk-dt h3{margin:0;font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap;text-transform:none;letter-spacing:normal;color:#eee9da}.lk-hh h2,.lk-dhh h2{margin:0}.lk-dt > span{font-size:13px;color:#8c92a3}
.lk-tag{font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:rgba(87,185,138,.12);color:#57b98a}
.lk-note{margin:2px 0 0;font-size:13px;color:#a9aebb}
.lk-dr{text-align:right;flex-shrink:0;display:flex;flex-direction:column}.lk-dr b{font-size:18px;font-weight:700}.lk-dr span{font-size:12px;color:#8c92a3}
.lk-segs{display:flex;gap:5px}.lk-segs i{flex:1;height:8px;border-radius:4px;background:#1f2430}.lk-segs i.ok{background:#57b98a}.lk-segs i.nx{background:#c9a24a}.lk-segs i.late{background:#e2665c}
.lk-chips{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.lk-chips > span{font-size:12.5px;font-weight:600;padding:5px 10px;border-radius:999px;background:#101319;color:#a9aebb}.lk-chips > span.soon{background:rgba(201,162,74,.12);color:#e8cd8a}.lk-chips > span.late{background:rgba(226,102,92,.12);color:#f0a39c}
.lk-insts{margin-top:-6px}.lk-insts summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:10px;border:1px solid #252a36;font-size:13px;font-weight:600}.lk-insts summary::-webkit-details-marker{display:none}
.lk-insts .hd{display:none}.lk-insts[open] .hd{display:inline}.lk-insts[open] .sh{display:none}.lk-insts[open] summary svg{transform:rotate(180deg)}
.lk-grid-i{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:6px;margin-top:12px}
.lk-i{border-radius:12px;background:#101319;border:1px solid #1f2430;padding:10px 6px;display:flex;flex-direction:column;gap:3px;text-align:center}.lk-i span{font-size:11.5px;font-weight:700;color:#6b7182}.lk-i b{font-size:12.5px;font-weight:600}.lk-i em{font-style:normal;font-size:11.5px;font-weight:600;color:#a9aebb}
.lk-i.ok{background:rgba(87,185,138,.07);border-color:rgba(87,185,138,.25)}.lk-i.ok b{color:#8c92a3}.lk-i.ok em{color:#57b98a}.lk-i.late{background:rgba(226,102,92,.07);border-color:rgba(226,102,92,.3)}.lk-i.late em{color:#f0a39c}
.lk-empty{color:#8c92a3;font-size:13px;margin:6px 0}
@media (max-width:900px){
  body.lk main{padding:18px 16px 36px}
  .lk-layout{display:flex;flex-direction:column;align-items:stretch;gap:14px}
  .lk-banner{grid-template-columns:minmax(0,1fr);gap:18px;padding:20px 18px}.lk-big b{font-size:40px}
  .lk-next{padding:14px 16px;gap:14px;flex-wrap:wrap}.lk-nv{text-align:left;width:100%;padding-left:82px;margin-top:-4px}.lk-nv b{font-size:24px}
  .lk-debts{order:3}.lk-hist{order:4}
  .lk-dt h3{font-size:16.5px}.lk-dr b{font-size:16.5px}
}
@media (max-width:480px){.lk-upd{display:none}.lk-dhh span{display:none}.lk-ico{width:42px;height:42px}.lk-nv{padding-left:0}}
`;

function page(title, body, desc, status, bodyClass) {
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<title>' + esc(title) + ' · BarnaBank</title><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc || 'BarnaBank') + '">' +
    '<meta name="theme-color" content="#0a0c11"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' + CSS + (bodyClass === 'lk' ? LK_CSS : '') + '</style></head><body' + (bodyClass ? ' class="' + bodyClass + '"' : '') + '><main>' +
    '<div class="brand"><span class="mark">B</span>BarnaBank</div>' + body + '</main>' +
    '</body></html>';
  return new Response(html, {status: status || 200, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
const CSS = `
*{box-sizing:border-box}:root{color-scheme:dark}body{margin:0;background:radial-gradient(900px 500px at 0% -10%,rgba(201,162,74,.07),transparent 60%),#0a0c11;color:#eee9da;font:15px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums;min-height:100vh}
main{max-width:560px;margin:0 auto;padding:20px 16px 40px}.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:#8c92a3;margin:4px 0 16px}
.mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(155deg,#e8cd8a,#c9a24a);color:#1b1404;display:grid;place-items:center;font-weight:800}
.card{background:#14171f;border:1px solid #252a36;border-radius:18px;padding:16px;margin-bottom:12px}.center{text-align:center;padding:32px 16px}
.hero h1{font-size:34px;margin:4px 0 2px;line-height:1.15}h1{font-size:24px;margin:6px 0}h2{font-size:16px;margin:0}h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5a6072;margin:16px 0 4px}
.muted{color:#8c92a3;display:block;font-size:13px}.small{font-size:12.5px;margin:8px 0 0}p{margin:4px 0}
.big{display:flex;align-items:baseline;gap:6px;margin:14px 0 8px;flex-wrap:wrap}.big b{font-size:24px;color:#e8cd8a}.big .muted{display:inline}.pct{margin-left:auto;font-weight:700;font-size:18px}
.bar{display:flex;gap:3px;height:9px}.seg{background:#101319;border-radius:5px;overflow:hidden;min-width:6px}.seg i{display:block;height:100%;background:#c9a24a}.seg.pago i{background:#57b98a}.seg.atrasado{background:rgba(226,102,92,.25)}
.q-badge{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;border-radius:5px;border:1px solid rgba(87,185,138,.35);background:rgba(87,185,138,.10);color:#57b98a;font-size:11.5px;font-weight:600;line-height:16px;padding:1px 7px;white-space:nowrap}
.row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #252a36}.row:first-child{border-top:none}.row.slim{padding:8px 0}.grow{flex:1;min-width:0}.grow b{display:block}
.av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:#c9a24a;color:#0a0c11;flex-shrink:0}.av.pago{background:#57b98a}.av.atrasado{background:#e2665c}
.tag{font-size:12.5px;font-weight:700;padding:4px 10px;border-radius:999px;background:#101319;color:#e8cd8a;white-space:nowrap}.tag.ok{color:#57b98a;background:rgba(87,185,138,.12)}.tag.late{color:#e2665c;background:rgba(226,102,92,.12)}.tag.part{color:#e8cd8a}
.n{width:30px;color:#8c92a3;font-weight:700}.dh{display:flex;justify-content:space-between;gap:12px}.right{text-align:right}.right b{font-size:18px}
.prog{height:7px;background:#101319;border-radius:4px;overflow:hidden;margin-top:12px}.prog i{display:block;height:100%;background:#57b98a}
.okc{color:#57b98a}.latec{color:#e2665c}.pix{display:flex;align-items:center;gap:12px;border-color:rgba(201,162,74,.45)}.pix div{flex:1;min-width:0}.pix code{display:block;font-size:15px;color:#e8cd8a;overflow-wrap:anywhere;margin-top:2px}
button{background:linear-gradient(155deg,#e8cd8a,#c9a24a);color:#1b1404;border:none;border-radius:12px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer}button:disabled{opacity:.6}
.wide{width:100%;margin-top:10px;padding:13px}.ghost{background:#101319;color:#e8cd8a;border:1px solid rgba(201,162,74,.45)}
.lbl{display:block;font-size:12.5px;color:#8c92a3;margin:12px 0 5px}.amt{display:flex;align-items:center;gap:8px;background:#101319;border:1px solid #252a36;border-radius:12px;padding:4px 12px}.amt span{color:#8c92a3;font-weight:700}
input,select{width:100%;background:#101319;border:1px solid #252a36;border-radius:12px;color:#eee9da;font:inherit;padding:11px 12px}.amt input{border:none;padding:8px 0;font-size:20px;font-weight:700;background:transparent}.amt input:focus{outline:none}.amt:focus-within{border-color:#c9a24a}input:focus,select:focus{outline:none;border-color:#c9a24a}
input[type=file]{padding:9px}.qr{background:#fff;border-radius:16px;padding:10px;margin:14px auto 10px;width:230px;max-width:80%}.qr img{display:block;width:100%;height:auto}
.cc code{display:block;font-size:11px;color:#8c92a3;background:#101319;border-radius:10px;padding:9px 10px;overflow-wrap:anywhere;max-height:62px;overflow:hidden}.center-t{text-align:center}
.cl{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;background:#101319;color:#e8cd8a;flex-shrink:0}.cl.ok{color:#57b98a}.cl.no{color:#e2665c}.claims{margin-top:6px}.okmsg{color:#57b98a;font-weight:700;text-align:center;padding:10px 0}.foot{text-align:center;color:#5a6072;font-size:12px;margin-top:18px}
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
