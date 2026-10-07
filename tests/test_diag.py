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
get = lambda p: urllib.request.urlopen('http://localhost:8787' + p).read().decode()
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
def setup_page(b, key):
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': 'http://localhost:8787', 'key': key}))))
    route_fonts(ctx); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(900)
    return ctx, page, errs
def open_test(page):
    page.click('#btnSettings'); page.click('#btnCloud'); page.wait_for_timeout(200)
    page.click('#clTest'); page.wait_for_timeout(800)
with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. chave errada
    ctx, page, errs = setup_page(b, 'chave-errada-xxxxxxxxxxxx')
    open_test(page)
    check('SYNC_KEY' in page.inner_text('#adBody'), 'chave errada: explica que a SYNC_KEY não bate')
    ctx.close()
    # 2. Telegram recusando o endereço
    get('/__fail=1'); get('/setup?key=chave-de-teste-1234567890'); get('/__unhook')
    ctx, page, errs = setup_page(b, 'chave-de-teste-1234567890')
    get('/__unhook')
    open_test(page)
    t = N(page.inner_text('#adBody'))
    check('Token do Telegram' in t and '@barna_teste_bot' in t, 'mostra que o token está certo e o nome do bot')
    check('ainda não sabe para onde mandar' in t and 'ainda não está no ar' in t, 'explica que o endereço ainda não está no ar: %s' % t[:220])
    check(page.locator('#adActions [data-ad="ok"]').inner_text().strip() == 'Religar bot', 'botão Religar bot')
    get('/__fail=0')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(1200)
    t = N(page.inner_text('#adBody'))
    check('entregando as mensagens' in t and 'Bot funcionando' not in t, 'depois de religar: ligação ok (falta só o /start): %s' % t[:200])
    check('/start' in t, 'lembra de mandar /start')
    check(not errs, 'sem erros de JS %s' % errs)
    ctx.close()
    b.close()
print('\n%d falha(s)' % len(fails))
