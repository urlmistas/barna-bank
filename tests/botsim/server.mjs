// Roda o worker.js em Node com KV em memória e Telegram falso, para testar.
import http from 'node:http';
import worker from '../../bot/worker.js';
const store = new Map();
const sent = [];
const tgState = {webhook: '', failHook: false, lastError: ''};
const aiCalls = [];
// a nota é de 2 dias atrás (horário de Brasília)
const nfceDate = () => { const d = new Date(Date.now() - 2 * 86400000 - 3 * 3600000).toISOString(); return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4); };
const vision = {agreed: false, reply: '{"tipo":"outro"}'};
const env = {
  AI: process.env.NOAI ? undefined : {run: async (model, input) => {
    aiCalls.push(model);
    if (/whisper/.test(model)) return {text: process.env.WHISPER || ' Gastei 30 reais no mercado.'};
    if (/vision/.test(model)) {
      // como o modelo da Meta: pede o "agree" uma vez antes de funcionar
      if (input.prompt === 'agree') { vision.agreed = true; return {response: 'ok'}; }
      if (!vision.agreed) throw new Error('5016: Prior to using this model, you must submit the prompt `agree`');
      return {response: vision.reply};
    }
    return {response: 'Você tem R$ 10,00 de teste.'};
  }},
  TELEGRAM_TOKEN: process.env.TOK || '123:TEST', SYNC_KEY: process.env.KEY || 'chave-de-teste-1234567890',
  BB: { get: async k => store.has(k) ? store.get(k) : null, put: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); } }
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://api.telegram.org/file/bot123:TEST/')) {
    const fs = await import('node:fs');
    return new Response(fs.readFileSync(new URL('./photo.jpg', import.meta.url)));
  }
  if (/^https:\/\/[^/]*\.gov\.br\//.test(url)) {
    if (/fora/.test(url)) return new Response('erro', {status: 503});
    return new Response('<html><body><div id="conteudo"><div class="txtCenter"><div id="u20" class="txtTopo">SUPERMERCADO EXEMPLO LTDA</div><div class="text">CNPJ: 12.345.678/0001-90</div></div>' +
      '<table id="tabResult"><tr><td><span class="txtTit">ARROZ 5KG</span></td><td><span class="valor">25,90</span></td></tr><tr><td><span class="txtTit">FEIJAO 1KG</span></td><td><span class="valor">8,49</span></td></tr><tr><td><span class="txtTit">CAFE 500G</span></td><td><span class="valor">53,11</span></td></tr></table>' +
      '<div id="totalNota"><div id="linhaTotal"><label>Qtd. total de itens:</label><span class="totalNumb">3</span></div><div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">87,50</span></div></div>' +
      '<div id="infos"><ul><li><strong> Emissão: </strong>' + nfceDate() + ' 10:11:12-03:00</li></ul></div></div></body></html>', {headers: {'Content-Type': 'text/html'}});
  }
  if (url.startsWith('https://api.telegram.org/')) {
    if (!url.startsWith('https://api.telegram.org/bot123:TEST/')) return new Response(JSON.stringify({ok: false, error_code: 404, description: 'Not Found'}), {status: 404});
    const method = url.split('/').pop();
    let body;
    if (opts.body instanceof FormData) { body = {}; for (const [k, v] of opts.body.entries()) body[k] = typeof v === 'string' ? v : '[file ' + v.size + ' bytes]'; }
    else body = JSON.parse(opts.body || '{}');
    sent.push({method, body});
    if (method === 'setWebhook') {
      if (tgState.failHook) return new Response(JSON.stringify({ok: false, description: 'Bad Request: bad webhook: Failed to resolve host: Name or service not known'}));
      tgState.webhook = body.url;
    }
    if (method === 'getWebhookInfo') return new Response(JSON.stringify({ok: true, result: {url: tgState.webhook, pending_update_count: tgState.webhook ? 0 : 3, last_error_message: tgState.lastError || undefined, last_error_date: tgState.lastError ? Math.floor(Date.now() / 1000) - 60 : undefined}}));
    if (method === 'getFile') return new Response(JSON.stringify({ok: true, result: {file_id: body.file_id, file_path: 'photos/file_1.jpg'}}));
    if (method === 'getMe') return new Response(JSON.stringify({ok: true, result: {username: 'barna_teste_bot'}}));
    if (method === 'sendMessage' || method === 'sendPhoto') return new Response(JSON.stringify({ok: true, result: {message_id: sent.length}}));
    return new Response(JSON.stringify({ok: true, result: true}));
  }
  return realFetch(url, opts);
};
const ctx = {waitUntil: p => p};
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = 'http://localhost:8787' + req.url;
  if (req.url === '/__sent') { res.end(JSON.stringify(sent)); return; }
  if (req.url === '/__ai') { res.end(JSON.stringify(aiCalls)); return; }
  if (req.url === '/__kv') { res.end(JSON.stringify(Object.fromEntries(store))); return; }
  if (req.url.startsWith('/__now=')) { const t = Date.parse(decodeURIComponent(req.url.slice(7))); const real = Date.now.__real || Date.now; const off = t - real(); Date.now = Object.assign(() => real() + off, {__real: real}); res.end('ok'); return; }
  if (req.url === '/__vision') { vision.reply = body.toString(); res.end('ok'); return; }
  if (req.url === '/__kvset') { const o = JSON.parse(body.toString() || '{}'); for (const k of Object.keys(o)) { if (o[k] === null) store.delete(k); else store.set(k, o[k]); } res.end('ok'); return; }
  if (req.url === '/__tg') { res.end(JSON.stringify(tgState)); return; }
  if (req.url.startsWith('/__fail=')) { tgState.failHook = req.url.endsWith('1'); res.end('ok'); return; }
  if (req.url === '/__unhook') { tgState.webhook = ''; tgState.lastError = 'SSL error {error:1416F086:SSL routines:tls_process_server_certificate:certificate verify failed}'; res.end('ok'); return; }
  if (req.url === '/__age') { const h = JSON.parse(store.get('hookCheck') || '{"t":0}'); h.t -= 20 * 60 * 1000; store.set('hookCheck', JSON.stringify(h)); res.end('ok'); return; }
  if (req.url === '/__cron') { await worker.scheduled({}, env, ctx); res.end('ok'); return; }
  const r = await worker.fetch(new Request(url, {method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body}), env, ctx);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('listening'));
