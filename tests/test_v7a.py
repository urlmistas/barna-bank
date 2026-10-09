import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, urllib.request
SP = OUT
exec(open(os.path.join(HERE, 'test_v5.py')).read().split('fails = []')[0])
from playwright.sync_api import sync_playwright
BOT, KEY = 'http://localhost:8787', 'chave-de-teste-1234567890'
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
def http(method, path, body=None, headers=None):
    req = urllib.request.Request(BOT + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
kv = lambda: json.loads(http('GET', '/__kv')[1])
sent = lambda: json.loads(http('GET', '/__sent')[1])
st = json.loads(http('GET', '/setup?key=' + KEY)[1])
hook = [x for x in sent() if x['method'] == 'setWebhook'][-1]['body']
HP, HS = '/tg/' + hook['url'].rsplit('/', 1)[1], hook['secret_token']
upd = [0]
def tg(text=None, cb=None):
    upd[0] += 1
    u = {'update_id': upd[0]}
    if text: u['message'] = {'message_id': upd[0], 'chat': {'id': 999}, 'text': text}
    else: u['callback_query'] = {'id': 'c%d' % upd[0], 'data': cb, 'message': {'message_id': 1, 'chat': {'id': 999}}}
    return http('POST', HP, u, {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HS})
msgs = lambda: [x['body'] for x in sent() if x['method'] == 'sendMessage']
tg('/start')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com'}));localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(1200)

    # 14. link da pessoa
    page.click('#btnSearch'); page.fill('#gsInput', 'larissa'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(400)
    page.click('#personShare'); page.wait_for_timeout(1200)
    url = page.input_value('#shUrl')
    check(re.match(r'^http://localhost:8787/s/[A-Za-z0-9]{22}$', url) is not None, 'link criado: %s' % url)
    page.fill('#shOwner', 'João'); page.dispatch_event('#shOwner', 'change'); page.wait_for_timeout(3500)
    wa = page.get_attribute('#shWa', 'href')
    check(wa.startswith('https://wa.me/?text=') and 'Larissa' in urllib.parse.unquote(wa), 'botão WhatsApp com a mensagem e o link')
    code, html = http('GET', url[len(BOT):])
    t = N(re.sub('<[^>]+>', ' ', html))
    check(code == 200 and 'Oi, Larissa!' in t and 'R$ 340,00' in t, 'página mostra o que a Larissa deve: %s' % t[:160])
    check('Parcelas' in t and 'Atrasada' in t and 'joao@pix.com' in t and 'com João' in t, 'parcelas, atraso, PIX e seu nome')
    check('Vinicius' not in html and 'Caio' not in html and 'Nubank' not in html, 'página não mostra nada de outras pessoas nem das carteiras')
    check('noindex' in html, 'página fora do Google (noindex)')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(200)
    check(page.locator('#personShare .live-dot').count() == 1, 'botão marca que o link está ativo')

    # 6. /cobrar no bot
    tg('/cobrar')
    m = msgs()[-1]
    names = [r[0]['text'] for r in m['reply_markup']['inline_keyboard']]
    check('Quem você quer cobrar' in m['text'] and any('Larissa' in n for n in names), '/cobrar sem nome lista as pessoas: %s' % names)
    key = [r[0]['callback_data'] for r in m['reply_markup']['inline_keyboard'] if 'Larissa' in r[0]['text']][0]
    tg(cb=key)
    m = msgs()[-1]
    check('Larissa' in m['text'] and '*Detalhes:* ' + url in m['text'] and 'parse_mode' not in m, 'tocar no nome manda a mensagem pronta com o link')
    btns = [r[0] for r in m['reply_markup']['inline_keyboard']]
    check(any(x.get('url', '').startswith('https://wa.me/?text=') for x in btns) and any(x.get('url') == url for x in btns), 'botões: WhatsApp e link de cobrança')
    tg('cobrar vinicius')
    m = msgs()[-1]
    check(any(r[0].get('url', '').startswith('https://wa.me/5511988887777?text=') for r in m['reply_markup']['inline_keyboard']), '"cobrar vinicius": abre direto na conversa dele (tem telefone)')
    tg('/cobrar fulano')
    check('Não achei "fulano"' in msgs()[-1]['text'], 'nome que não existe: avisa e mostra a lista')

    # 15. link do grupo
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    page.locator('.gcard .gcard-head .name').first.click(); page.wait_for_timeout(300)
    page.click('.gcard [data-gact="share"]'); page.wait_for_timeout(1500)
    gurl = page.input_value('#shUrl')
    code, html = http('GET', gurl[len(BOT):])
    t = N(re.sub('<[^>]+>', ' ', html))
    check(code == 200 and 'Churrasco de sábado' in t and 'Ana S.' in t and 'Bia L.' in t and 'Caio R.' in t, 'página do grupo com todos: %s' % t[:140])
    check('✓ Pagou' in t and 'Falta R$ 45,00' in t or 'Atrasado · R$ 45,00' in t, 'mostra quem pagou e quanto falta')
    check('1 de 3 já pagaram' in t and 'João dividiu' in t, 'contagem e nome de quem dividiu')
    check('Ana Souza' not in html, 'sobrenome abreviado no link do grupo')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(200)
    page.click('.gcard [data-gact="charge"]'); page.wait_for_timeout(300)
    check(gurl in page.input_value('#chargeMsg'), 'mensagem de cobrança do grupo leva o link')
    page.click('#chargeClose')

    # atualiza sozinho
    page.evaluate("""() => { const b = [...document.querySelectorAll('.gcard .g-av')].find(x => x.textContent.includes('Caio')); b.click(); }"""); page.wait_for_timeout(400)
    page.locator('#list .card.open .quick-pay').first.click(); page.wait_for_timeout(3800)
    t = N(re.sub('<[^>]+>', ' ', http('GET', gurl[len(BOT):])[1]))
    check('2 de 3 já pagaram' in t, 'pagamento novo aparece no link sozinho: %s' % re.search(r'\d de 3 já pagaram', t).group(0))

    # desativar
    page.click('#btnSearch'); page.fill('#gsInput', 'larissa'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(300)
    page.click('#personShare'); page.wait_for_timeout(400)
    page.click('#shOff'); page.wait_for_timeout(1200)
    code, html = http('GET', url[len(BOT):])
    check(code == 404 and 'Link desativado' in html, 'desativar: o link para de funcionar')
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
