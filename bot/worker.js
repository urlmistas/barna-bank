// BarnaBank: bot do Telegram + nuvem para sincronizar o app.
// Roda como Cloudflare Worker. Precisa de:
//   KV "BB" (os dados), segredos TELEGRAM_TOKEN e SYNC_KEY.
// Rotas:
//   POST /tg/<hash>        webhook do Telegram
//   GET  /setup?key=...    registra o webhook e os comandos do bot
//   GET  /api/state        o app busca os dados e as mensagens pendentes (Authorization: Bearer SYNC_KEY)
//   PUT  /api/state        o app envia os dados atualizados e confirma as mensagens aplicadas
//   (cron diário)          manda os vencimentos do dia no Telegram

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
      if (url.pathname === '/setup') return await setup(req, url, env);
      if (url.pathname === '/status') return await status(req, url, env);
      if (url.pathname.startsWith('/tg/')) return await telegram(req, env, url);
      if (url.pathname.startsWith('/s/') && req.method === 'GET') return await sharePage(url, env);
      if (url.pathname === '/') return json({app: 'BarnaBank', ok: true});
      return json({error: 'not found'}, 404);
    } catch (e) {
      return json({error: String(e && e.message || e)}, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const origin = await env.BB.get('origin');
      if (origin) await ensureWebhook(env, origin, true);
      await dailyReminder(env);
    })());
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
    const [snapshot, inbox, meta, undo] = await Promise.all([getJSON(env, 'snapshot', null), getJSON(env, 'inbox', []), getJSON(env, 'meta', {}), getJSON(env, 'undo', [])]);
    return json({snapshot, inbox, undo, updatedAt: meta.updatedAt || null});
  }
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({error: 'bad body'}, 400);
    const ack = Array.isArray(body.ack) ? body.ack : [];
    if (body.snapshot && typeof body.snapshot === 'object') await putJSON(env, 'snapshot', body.snapshot);
    if (body.summary && typeof body.summary === 'object') await putJSON(env, 'summary', body.summary);
    if (body.shares && typeof body.shares === 'object') await saveShares(env, body.shares);
    let inbox = await getJSON(env, 'inbox', []);
    if (ack.length) {
      inbox = inbox.filter(op => !ack.includes(op.id));
      await putJSON(env, 'inbox', inbox);
      if (env.BB.delete) for (const id of ack) await env.BB.delete('photo:' + id);
    }
    const undoAck = Array.isArray(body.undoAck) ? body.undoAck : [];
    if (undoAck.length) {
      const undo = await getJSON(env, 'undo', []);
      await putJSON(env, 'undo', undo.filter(u => !undoAck.includes(u.id)));
    }
    const updatedAt = new Date().toISOString();
    await putJSON(env, 'meta', {updatedAt});
    return json({ok: true, updatedAt, pending: inbox.length});
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
  'Tudo entra no BarnaBank na próxima vez que você abrir o app.\n\n' +
  '/cobrar Fulano: mensagem de cobrança pronta para encaminhar\n' +
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
  if (typeof msg.text !== 'string' && !photo) return;
  const chat = String(msg.chat.id);
  let owner = await env.BB.get('owner');
  const text = String(msg.text || msg.caption || '').trim();
  if (!owner) {
    if (/^\/start/.test(text)) {
      await env.BB.put('owner', chat);
      await say(env, chat, '👋 Pronto! Este bot agora é só seu.\n\n' + HELP);
    } else await say(env, chat, 'Mande /start para ativar o bot.');
    return;
  }
  if (chat !== owner) { await say(env, chat, 'Este bot é privado.'); return; }
  await handleText(env, chat, text, photo);
  return;
}

async function onCallback(env, cq) {
  const owner = await env.BB.get('owner');
  const chat = cq.message && String(cq.message.chat.id);
  if (!owner || chat !== owner) return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
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
    let note;
    if (i !== -1) {
      inbox.splice(i, 1);
      await putJSON(env, 'inbox', inbox);
      if (env.BB.delete) await env.BB.delete('photo:' + id);
      note = '↩️ Desfeito. Não vai entrar no app.';
    } else {
      // já entrou no app: o app desfaz na próxima vez que abrir
      const undo = await getJSON(env, 'undo', []);
      if (!undo.some(u => u.id === id)) undo.push({id, at: new Date().toISOString()});
      await putJSON(env, 'undo', undo.slice(-100));
      note = '↩️ Desfeito. Sai do app na próxima vez que você abrir.';
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
    const inbox = await getJSON(env, 'inbox', []);
    return say(env, chat, inbox.length ? '<b>Esperando o app abrir:</b>\n' + inbox.map(o => '• ' + esc(o.text)).join('\n') : 'Nada pendente: o app já pegou tudo. ✅');
  }
  const op = parseMessage(cmd ? text.replace(/^\/\w+\s*/, cmd + ' ') : text, summary);
  if (!op) return say(env, chat, 'Não entendi 🤔\n\n' + HELP);
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
  return say(env, chat, '✅ ' + describe(op) + photoNote + '\n<i>Entra no app na próxima vez que você abrir.</i>', {
    reply_markup: {inline_keyboard: [[{text: 'Desfazer', callback_data: 'undo:' + op.id}]]}
  });
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
function stale(summary) {
  if (!summary) return '\n\n<i>O app ainda não mandou os dados. Abra o BarnaBank e ligue a nuvem em Configurações.</i>';
  const h = (Date.now() - new Date(summary.at).getTime()) / 3600000;
  return h > 24 ? '\n\n<i>Dados de ' + fmtDate(summary.at.slice(0, 10)) + ' (última vez que o app abriu).</i>' : '';
}
async function resumoText(env, s) {
  if (!s) return 'Ainda não tenho dados.' + stale(s);
  const rec = (s.people || []).reduce((a, p) => a + p.rec, 0), pay = (s.people || []).reduce((a, p) => a + p.pay, 0);
  const late = (s.late || []).reduce((a, p) => a + p.amount, 0);
  const inbox = await getJSON(env, 'inbox', []);
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
  await say(env, chat, '<b>Cobrança para ' + esc(c.name) + '</b> · ' + brl(c.remaining) + ' em aberto' + (c.late ? ', ' + brl(c.late) + ' atrasado' : '') +
    '\n<i>Encaminhe a mensagem abaixo ou use o botão.</i>' + stale(summary));
  // a mensagem vai sem formatação, pronta para encaminhar
  return tg(env, 'sendMessage', {chat_id: chat, text: c.text, disable_web_page_preview: true, reply_markup: {inline_keyboard: buttons}});
}

// ---------------------------------------------------------------- links de cobrança (páginas públicas, só leitura)
async function saveShares(env, shares) {
  const old = await getJSON(env, 'shareIndex', []);
  const now = Object.keys(shares).filter(t => /^[A-Za-z0-9]{16,40}$/.test(t) && shares[t] && typeof shares[t] === 'object').slice(0, 300);
  for (const t of now) await putJSON(env, 'share:' + t, shares[t]);
  for (const t of old) if (!now.includes(t) && env.BB.delete) await env.BB.delete('share:' + t);
  await putJSON(env, 'shareIndex', now);
}
const fmtFull = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4) : '';
const STATE = {paga: ['Paga', 'ok'], pago: ['Pagou', 'ok'], atrasada: ['Atrasada', 'late'], atrasado: ['Atrasado', 'late'], parcial: ['Parcial', 'part'], aberta: ['Em aberto', ''], pendente: ['Falta pagar', '']};
async function sharePage(url, env) {
  const token = url.pathname.slice(3).replace(/[^A-Za-z0-9]/g, '');
  const v = token ? await getJSON(env, 'share:' + token, null) : null;
  if (!v) return page('Link desativado', '<div class="card center"><h1>Link desativado</h1><p class="muted">Este link de cobrança não existe mais. Peça um novo para quem te mandou.</p></div>', '', 404);
  const owner = v.owner ? esc(v.owner) : 'quem te mandou';
  const pix = v.pix ? '<div class="card pix"><div><span class="muted">PIX de ' + owner + '</span><code id="pix">' + esc(v.pix) + '</code></div><button onclick="copyPix()">Copiar</button></div>' : '';
  const upd = '<p class="foot">Atualizado em ' + fmtFull((v.updatedAt || '').slice(0, 10)) + ' · BarnaBank</p>';
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
      '<div class="card">' + rows + '</div>' + pix + upd;
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
  return page('Resumo para ' + v.name, hero + (v.remaining > 0 ? pix : '') + debts + upd, v.remaining > 0 ? brl(v.remaining) + ' em aberto' : 'Tudo quitado');
}
function initials(n) { const p = String(n || '?').replace(/\./g, '').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function page(title, body, desc, status) {
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<title>' + esc(title) + ' · BarnaBank</title><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc || 'BarnaBank') + '">' +
    '<meta name="theme-color" content="#10152a"><style>' + CSS + '</style></head><body><main>' +
    '<div class="brand"><span class="mark">B</span>BarnaBank</div>' + body + '</main>' +
    '<script>function copyPix(){var t=document.getElementById("pix").textContent;var b=event.target;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent="Copiado ✓"},function(){var r=document.createRange();r.selectNode(document.getElementById("pix"));getSelection().removeAllRanges();getSelection().addRange(r);b.textContent="Selecionado"})}</script></body></html>';
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
button{background:linear-gradient(155deg,#e8cd8a,#c9a24a);color:#1b1404;border:none;border-radius:12px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer}.foot{text-align:center;color:#5d6390;font-size:12px;margin-top:18px}
`;
