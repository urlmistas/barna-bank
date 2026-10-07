"""Testes v13: no link de cobrança, escolher qual dívida pagar."""
import os, sys, tempfile, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, os, urllib.request, datetime
SP = OUT
exec(open(os.path.join(HERE, 'test_v5.py')).read().split('fails = []')[0])
from playwright.sync_api import sync_playwright
BOT, KEY = 'http://localhost:8787', 'chave-de-teste-1234567890'
AUTH = {'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
def http(method, path, body=None, headers=None, raw=None):
    data = raw.encode() if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BOT + path, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
kv = lambda: json.loads(http('GET', '/__kv')[1])
sent = lambda: json.loads(http('GET', '/__sent')[1])
http('GET', '/setup?key=' + KEY)
hook = [x for x in sent() if x['method'] == 'setWebhook'][-1]['body']
HP, HS = '/tg/' + hook['url'].rsplit('/', 1)[1], hook['secret_token']
upd = [100]
def tg(text=None, cb=None, chat=999, first=None, photo=False, caption=None, uid=None):
    if uid is None: upd[0] += 1; uid = upd[0]
    u = {'update_id': uid}
    if cb: u['callback_query'] = {'id': 'c%d' % uid, 'data': cb, 'message': {'message_id': 1, 'chat': {'id': chat}, 'text': 'algo'}}
    else:
        m = {'message_id': uid, 'chat': {'id': chat}, 'from': {'id': chat, 'first_name': first or 'Fulano'}}
        if photo: m['photo'] = [{'file_id': 'small', 'width': 90, 'height': 60}, {'file_id': 'big', 'width': 900, 'height': 1200, 'file_size': 30000}]; m['caption'] = caption
        else: m['text'] = text
        u['message'] = m
    return http('POST', HP, u, {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HS})
msgs = lambda chat='999': [x for x in sent() if x['method'] in ('sendMessage', 'editMessageText') and str(x['body'].get('chat_id')) == chat]
docs = lambda chat='999': [x for x in sent() if x['method'] == 'sendDocument' and str(x['body'].get('chat_id')) == chat]
last = lambda chat='999': (msgs(chat) or [{'body': {'text': ''}}])[-1]['body']['text']
plain = lambda t: N(re.sub('<[^>]+>', '', t))
snap = lambda: json.loads(kv()['snapshot'])
fmt = lambda d: d.strftime('%d/%m/%Y')
T = datetime.date.today()

# Larissa com uma segunda dívida (em dia)
data['debts'].append(debt('d2b', 'Larissa Mota', 300, ago(5), 3))
tg('/start')
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com', ownerName:'João'}));localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(2000)
    page.click('#btnSearch'); page.fill('#gsInput', 'larissa'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(500)
    page.click('#personShare'); page.wait_for_timeout(1500)
    url = page.input_value('#shUrl'); token = url.rsplit('/', 1)[1]
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    # a página do link
    lp = ctx.new_page(); lp.goto(url); lp.wait_for_timeout(600)
    opts = lp.locator('#which option')
    labels = [opts.nth(i).inner_text() for i in range(opts.count())]
    check(len(labels) == 3 and 'Tudo que falta' in labels[-1], 'link: escolher entre as 2 dívidas ou tudo: %s' % labels)
    check(lp.locator('button', has_text='Pagar esta').count() == 2, 'cada dívida tem "Pagar esta"')
    lp.locator('button', has_text='Pagar esta').nth(1).click(); lp.wait_for_timeout(700)
    lp.screenshot(path=SP + '/v13_link.png', full_page=True)
    v = lp.input_value('#amt')
    check(v == '100,00', 'escolher a 2ª dívida muda o valor do PIX (%s)' % v)
    check('Empréstimo' in lp.inner_text('#pwhichl') or '300' in lp.inner_text('#pwhichl') or '100,00' in lp.inner_text('#pwhichl'), 'Já paguei mostra a que se refere: %s' % lp.inner_text('#pwhichl'))
    c, _ = http('POST', '/s/%s/pago' % token, {'amount': 100, 'debt': '1', 'note': 'parcela'})
    check(c == 200 and 'diz que pagou' in last() and 'Empréstimo' in last() and '·' in plain(last()), 'dono recebe o pedido com a dívida: %s' % plain(last())[:120])
    cid = json.loads(kv()['claims'])[-1]
    tg(cb='claim:ok:' + cid)
    check(not kv().get('lastError'), 'sem erro no motor: %s' % kv().get('lastError'))
    d2b = [x for x in snap()['debts'] if x['id'] == 'd2b'][0]
    d2 = [x for x in snap()['debts'] if x['id'] == 'd2'][0]
    check(any(p_['amount'] == 100 for p_ in d2b['payments']) and not any(p_['amount'] == 100 for p_ in d2['payments']), 'pagamento entrou na dívida escolhida, não na mais antiga')
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
