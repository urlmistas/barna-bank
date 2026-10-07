"""Testes v14: resumo do mês no dia 1, /repetir, multa e mora padrão."""
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

tg('/start')
snapd = dict(data); snapd['settings'] = {'pixKey': 'joao@pix.com', 'defaultLateFee': 2, 'defaultLateInterest': 1}
check(http('PUT', '/api/state', {'snapshot': snapd}, AUTH)[0] == 200, 'dados na nuvem')

# ---------------- /repetir
tg('gastei 8 cafe')
tg('/repetir')
check('Repetido' in last() and 'R$ 8,00' in plain(last()), '/repetir lança de novo: %s' % plain(last())[:80])
tg('de novo')
caf = [x for x in snap()['transactions'] if x['amount'] == 8]
check(len(caf) == 3, 'três cafés (%d)' % len(caf))
rid = json.loads(kv()['recent'])[-1]['id']
tg(cb='undo:' + rid)
check(len([x for x in snap()['transactions'] if x['amount'] == 8]) == 2, 'Desfazer o repetido')

# ---------------- multa e mora padrão nas dívidas do bot
tg('Vini me deve 50')
dv = [x for x in snap()['debts'] if x['principal'] == 50 and 'Telegram' in x.get('notes', '')]
check(dv and dv[0]['lateFeePct'] == 2 and dv[0]['lateInterestPct'] == 1, 'dívida pelo bot já vem com multa 2%% e mora 1%%: %s' % (repr((dv[0]['lateFeePct'], dv[0]['lateInterestPct'])) if dv else '-'))
tg('devo 30 pro Carlos')
dp = [x for x in snap()['debts'] if x['principal'] == 30 and x['kind'] == 'payable']
check(dp and dp[0]['lateFeePct'] == 0, 'o que eu devo não ganha multa padrão')

# ---------------- resumo do mês no dia 1
nm = (T.replace(day=28) + datetime.timedelta(days=5)).replace(day=1)
http('GET', '/__now=' + nm.isoformat() + 'T12:30:00Z')
http('GET', '/__cron')
MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
mm = [m for m in msgs() if 'Seu ' + MESES[T.month - 1] in m['body']['text']]
check(mm and 'Entrou' in mm[-1]['body']['text'] and 'Onde mais gastou' in mm[-1]['body']['text'], 'dia 1: resumo do mês que passou: %s' % (plain(mm[-1]['body']['text'])[:160] if mm else '-'))
http('GET', '/__cron')
check(len([m for m in msgs() if 'Seu ' + MESES[T.month - 1] in m['body']['text']]) == len(mm), 'só uma vez')
tg('/lembretes mensal')
check('Resumo do mês (dia 1): <b>desligado' in last(), '/lembretes mensal desliga')

# ---------------- app: formulário já vem com a multa padrão
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({defaultLateFee:2, defaultLateInterest:1}));}" % json.dumps(json.dumps(data)))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(800)
    page.click('#btnNew'); page.wait_for_timeout(300)
    check(page.input_value('#fLateFee') == '2' and page.input_value('#fLateInterest') == '1', 'nova dívida já vem com multa e mora padrão')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    page.click('#btnSettings'); page.wait_for_timeout(200)
    page.fill('#setDefaultLateFee', '5'); page.click('#btnSettingsSave'); page.wait_for_timeout(200)
    check(json.loads(page.evaluate("localStorage.getItem('barnabank_settings_v1')"))['defaultLateFee'] == 5, 'configuração salva')
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
