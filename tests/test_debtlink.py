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
data['debts'].append(debt('d9', 'Larissa Mota', 90, ago(5), 1, notes=''))
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', re.sub('<[^>]+>', ' ', s).replace('\xa0', ' '))
get = lambda p: (lambda r: (r.status, r.read().decode()))(urllib.request.urlopen(BOT + p)) if True else None
def fetch(path):
    try: return get(path)
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844})
    route_fonts(ctx); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL)
    page.evaluate("localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com', ownerName:'João'}));localStorage.setItem('barnabank_welcomed','1');localStorage.setItem('barnabank_cloud', %s);" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    page.goto(URL); page.wait_for_timeout(1200)
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    card = page.locator('#list .card[data-debt-id="d9"]')
    card.locator('.card-head .avatar').click(); page.wait_for_timeout(300)
    card = page.locator('#list .card[data-debt-id="d9"]')
    card.locator('[data-act="share"]').click(); page.wait_for_timeout(1500)
    check('Link desta dívida' in page.inner_text('#adTitle'), 'janela do link da dívida')
    url = page.input_value('#shUrl')
    code, html = fetch(url[len(BOT):]); t = N(html)
    check(code == 200 and 'R$ 90,00' in t and 'R$ 340,00' not in t and 'Empréstimo em 4x' not in t, 'página mostra só esta dívida (R$ 90), não a de 4x: %s' % t[t.find('Oi'):t.find('Oi')+120])
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    card = page.locator('#list .card[data-debt-id="d9"]')
    check(card.locator('[data-act="share"] .live-dot').count() == 1, 'botão Link marca que está ativo')
    msg = page.evaluate("(() => { const a = document.querySelector('#list .card[data-debt-id=\"d9\"] [data-act=\"whats\"], #list .card[data-debt-id=\"d9\"] [data-act=\"nowhats\"]'); return a ? (a.href || '') : ''; })()")
    page.click('#btnSearch'); page.fill('#gsInput', 'larissa'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(400)
    page.click('#personShare'); page.wait_for_timeout(1500)
    purl = page.input_value('#shUrl')
    code, html = fetch(purl[len(BOT):]); t = N(html)
    check(purl != url and 'R$ 430,00' in t, 'link da pessoa continua com todas as dívidas (R$ 430)')
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
