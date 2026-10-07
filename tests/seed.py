import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
"""Screenshots of BarnaBank with realistic sample data. Usage: python3 shots_bb.py <prefix>"""
import json, sys, datetime
from playwright.sync_api import sync_playwright

SP = OUT
URL = APP_URL
prefix = sys.argv[1] if len(sys.argv) > 1 else 'base'
T = datetime.date.today()
def ago(days): return (T - datetime.timedelta(days=days)).isoformat()
def m_ago(n, day):
    y, m = T.year, T.month - n
    while m <= 0: m += 12; y -= 1
    return datetime.date(y, m, min(day, 28)).isoformat()

def debt(i, name, amt, date, n, **kw):
    d = dict(id=i, name=name, principal=amt, date=date, days=n*30, installments=n, rate=0, interestType='composto',
             dueDay=int(date[-2:]), payments=[], notes='', kind='receivable', discount=0, lateFeePct=0, lateInterestPct=0)
    d.update(kw); return d

data = {
 'debts': [
   debt('d1', 'Vinicius Prado', 1200, m_ago(3, 10), 6, rate=3, payments=[{'date': m_ago(2, 10), 'amount': 230, 'walletId': 'w1'}, {'date': m_ago(1, 12), 'amount': 230, 'walletId': 'w1'}]),
   debt('d2', 'Larissa Mota', 400, m_ago(2, 5), 4, payments=[{'date': m_ago(1, 5), 'amount': 60}]),
   debt('d3', 'Rafael Nunes', 250, ago(3), 1, notes='Combinou de pagar no PIX'),
   debt('d4', 'Cartão Nubank', 1800, m_ago(1, 15), 3, kind='payable', payments=[{'date': ago(10), 'amount': 600, 'walletId': 'w2'}]),
   debt('g1a', 'Ana Souza', 75, ago(12), 1, firstDue=ago(2), groupId='g1', payments=[{'date': ago(5), 'amount': 75}]),
   debt('g1b', 'Bia Lima', 75, ago(12), 1, firstDue=ago(2), groupId='g1', payments=[{'date': ago(4), 'amount': 30}]),
   debt('g1c', 'Caio Reis', 75, ago(12), 1, firstDue=ago(2), groupId='g1'),
 ],
 'groups': [dict(id='g1', title='Churrasco de sábado', kind='receivable', date=ago(12), total=300, splitMode='equal', includeMe=True, myShare=75, dueDate=ago(2), walletId='w1', notes='')],
 'contacts': {'vinicius prado': {'phone': '11988887777'}},
 'wallets': [{'id': 'w1', 'name': 'Nubank', 'icon': '💳'}, {'id': 'w2', 'name': 'Inter', 'icon': '🏦'}, {'id': 'w3', 'name': 'Dinheiro', 'icon': '💵'}],
 'transactions': [
   {'id': 't1', 'walletId': 'w1', 'type': 'entrada', 'amount': 3200, 'date': m_ago(0, 5), 'category': 'Salário'},
   {'id': 't2', 'walletId': 'w1', 'type': 'gasto', 'amount': 420.5, 'date': m_ago(0, 6), 'category': 'Mercado'},
   {'id': 't3', 'walletId': 'w2', 'type': 'gasto', 'amount': 1100, 'date': m_ago(0, 1), 'category': 'Aluguel'},
   {'id': 't4', 'walletId': 'w3', 'type': 'gasto', 'amount': 64, 'date': ago(1), 'category': 'Lanche'},
   {'id': 't5', 'walletId': 'w2', 'type': 'entrada', 'amount': 800, 'date': m_ago(1, 20), 'category': 'Freela'},
   {'id': 't6', 'walletId': 'w1', 'type': 'gasto', 'amount': 189.9, 'date': ago(2), 'category': 'Internet'},
 ],
}

FD = (os.environ.get('BB_FONTS') or '').rstrip('/') + '/'
FONT_FILES = {'baloo2': FD + 'baloo2/Baloo2[wght].ttf', 'inter': FD + 'inter/Inter[opsz,wght].ttf', 'nunito': FD + 'nunito/Nunito[wght].ttf'}
FONT_CSS = ("@font-face{font-family:'Baloo 2';src:url(https://fonts.gstatic.com/local/baloo2.ttf);font-weight:400 800}"
            "@font-face{font-family:'Inter';src:url(https://fonts.gstatic.com/local/inter.ttf);font-weight:100 900}"
            "@font-face{font-family:'Nunito';src:url(https://fonts.gstatic.com/local/nunito.ttf);font-weight:200 1000}")
def route_fonts(ctx):
    # sem as fontes locais: não depende da internet (o visual não importa nos testes)
    if FD == '/' or not os.path.isdir(FD):
        ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        return
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=FONT_CSS))
    ctx.route('https://fonts.gstatic.com/local/*', lambda r: r.fulfill(status=200, content_type='font/ttf', body=open(FONT_FILES[r.request.url.rsplit('/',1)[1][:-4]], 'rb').read()))

with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h, tag) in [(390, 844, 'm'), (1280, 860, 'd')]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if tag == 'm' else 1)
        ctx.add_init_script("localStorage.setItem('barnabank_debts_v3', %s); localStorage.setItem('barnabank_last_export', '%s');" % (json.dumps(json.dumps(data)), T.isoformat()))
        route_fonts(ctx)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(700)
        pg.screenshot(path=f'{SP}/{prefix}_{tag}_dash.png', full_page=True)
        pg.click('#pageTabs button[data-page="pessoas"]'); pg.wait_for_timeout(300)
        pg.locator('#list .card').first.locator('.card-head .avatar').click(); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{SP}/{prefix}_{tag}_pessoas.png', full_page=True)
        pg.click('#pageTabs button[data-page="carteiras"]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{SP}/{prefix}_{tag}_carteiras.png', full_page=True)
        pg.click('#pageTabs button[data-page="relatorios"]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{SP}/{prefix}_{tag}_rel.png', full_page=True)
        pg.click('#btnNew'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{SP}/{prefix}_{tag}_modal.png')
        print(tag, 'errors:', errs)
        ctx.close()
    b.close()
