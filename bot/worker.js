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
      if (url.pathname === '/setup') return await setup(req, url, env);
      if (url.pathname === '/status') return await status(req, url, env);
      if (url.pathname.startsWith('/tg/')) return await telegram(req, env, url);
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
    const [snapshot, inbox, meta] = await Promise.all([getJSON(env, 'snapshot', null), getJSON(env, 'inbox', []), getJSON(env, 'meta', {})]);
    return json({snapshot, inbox, updatedAt: meta.updatedAt || null});
  }
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({error: 'bad body'}, 400);
    const ack = Array.isArray(body.ack) ? body.ack : [];
    if (body.snapshot && typeof body.snapshot === 'object') await putJSON(env, 'snapshot', body.snapshot);
    if (body.summary && typeof body.summary === 'object') await putJSON(env, 'summary', body.summary);
    let inbox = await getJSON(env, 'inbox', []);
    if (ack.length) {
      inbox = inbox.filter(op => !ack.includes(op.id));
      await putJSON(env, 'inbox', inbox);
    }
    const updatedAt = new Date().toISOString();
    await putJSON(env, 'meta', {updatedAt});
    return json({ok: true, updatedAt, pending: inbox.length});
  }
  return json({error: 'method'}, 405);
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
  '• <code>ganhei 150 freela</code>\n\n' +
  'Tudo entra no BarnaBank na próxima vez que você abrir o app.\n\n' +
  '/resumo · /atrasados · /semana · /saldo · /pendentes';

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
  if (!msg || !msg.chat || typeof msg.text !== 'string') return;
  const chat = String(msg.chat.id);
  let owner = await env.BB.get('owner');
  const text = msg.text.trim();
  if (!owner) {
    if (/^\/start/.test(text)) {
      await env.BB.put('owner', chat);
      await say(env, chat, '👋 Pronto! Este bot agora é só seu.\n\n' + HELP);
    } else await say(env, chat, 'Mande /start para ativar o bot.');
    return;
  }
  if (chat !== owner) { await say(env, chat, 'Este bot é privado.'); return; }
  await handleText(env, chat, text);
  return;
}

async function onCallback(env, cq) {
  const owner = await env.BB.get('owner');
  const chat = cq.message && String(cq.message.chat.id);
  if (!owner || chat !== owner) return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
  const m = /^undo:(.+)$/.exec(cq.data || '');
  if (m) {
    const inbox = await getJSON(env, 'inbox', []);
    const i = inbox.findIndex(op => op.id === m[1]);
    if (i !== -1) {
      inbox.splice(i, 1);
      await putJSON(env, 'inbox', inbox);
      await tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: '↩️ Cancelado.'});
      return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: 'Cancelado'});
    }
    return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: 'Já entrou no app; desfaça por lá.', show_alert: true});
  }
  return tg(env, 'answerCallbackQuery', {callback_query_id: cq.id});
}

async function handleText(env, chat, text) {
  const cmd = (/^\/(\w+)/.exec(text) || [])[1];
  const summary = await getJSON(env, 'summary', null);
  if (cmd === 'start' || cmd === 'ajuda' || cmd === 'help') return say(env, chat, HELP);
  if (cmd === 'resumo') return say(env, chat, await resumoText(env, summary));
  if (cmd === 'atrasados') return say(env, chat, atrasadosText(summary));
  if (cmd === 'semana') return say(env, chat, semanaText(summary, 7));
  if (cmd === 'saldo') return say(env, chat, saldoText(summary));
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
  const inbox = await getJSON(env, 'inbox', []);
  inbox.push(op);
  await putJSON(env, 'inbox', inbox.slice(-200));
  return say(env, chat, '✅ ' + describe(op) + '\n<i>Entra no app na próxima vez que você abrir.</i>', {
    reply_markup: {inline_keyboard: [[{text: '↩️ Desfazer', callback_data: 'undo:' + op.id}]]}
  });
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
async function dailyReminder(env) {
  const owner = await env.BB.get('owner');
  const s = await getJSON(env, 'summary', null);
  if (!owner || !s) return;
  const today = todayBR();
  const items = (s.due || []).filter(i => i.date <= today);
  if (!items.length) return;
  const dueToday = items.filter(i => i.date === today), late = items.filter(i => i.date < today);
  let out = '<b>☀️ Bom dia!</b>';
  if (dueToday.length) out += '\n\n<b>Vence hoje</b>\n' + dueToday.map(i => '• ' + esc(i.title) + ': ' + (i.dir === 'in' ? '+' : '−') + brl(i.amount)).join('\n');
  if (late.length) out += '\n\n<b>Atrasado</b>\n' + late.map(i => '• ' + esc(i.title) + ' (desde ' + fmtDate(i.date) + '): ' + brl(i.amount)).join('\n');
  out += '\n\nResponda <code>recebi 20 do Fulano</code> quando alguém pagar.';
  await say(env, owner, out);
}

