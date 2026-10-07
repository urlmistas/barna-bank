"""Testes v12: layout novo (topo único, Início em colunas, dívida aberta em painel/tela cheia)."""
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

def boot(w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com'}));}" % json.dumps(json.dumps(data)))
    route_fonts(ctx, sheet=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1200)
    return ctx, pg
errs = []
box = lambda pg, sel: pg.locator(sel).first.bounding_box()
with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- PC
    ctx, page = boot(1280, 900)
    hb, tb, br = box(page, 'header.topbar'), box(page, '#pageTabs'), box(page, 'header.topbar .brand')
    check(tb['y'] >= hb['y'] and tb['y'] + tb['height'] <= hb['y'] + hb['height'] + 1 and abs((tb['y'] + tb['height'] / 2) - (br['y'] + br['height'] / 2)) < 12, 'PC: menu dentro do topo, na mesma linha da logo')
    m, s_ = box(page, '.home-main'), box(page, '.home-side')
    check(s_['x'] > m['x'] + m['width'] - 1 and abs(s_['y'] - m['y']) < 2, 'PC: Início em duas colunas alinhadas no topo')
    check('A receber' in N(page.inner_text('#dashSummary')) and 'Fim do mês' in N(page.inner_text('#dashSummary')), 'resumo embaixo do saldo')
    rc = page.locator('#dashReceive .rc-row')
    check(rc.count() >= 3 and 'atrasado' in N(rc.first.inner_text()), 'A receber: pessoas com barra, atrasados primeiro')
    check(page.locator('#weekList .wk-group.late').count() == 1 and 'precisa de você' in page.inner_text('#weekList').lower(), 'agenda separa "Precisa de você"')
    check(page.locator('#dashCatBar .cat-bar i').count() >= 2, 'mês: barra de gastos por categoria')
    page.screenshot(path=SP + '/v12_pc_home.png', full_page=True)
    rc.first.click(); page.wait_for_timeout(500)
    check(page.locator('#pagePessoa').is_visible() or page.locator('#pagePessoas').is_visible(), 'clicar em quem te deve abre a pessoa')
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(400)
    check('Escolha alguém' in page.inner_text('#psDetail'), 'PC: painel vazio explica o que fazer')
    page.locator('#list .card', has_text='Larissa Mota').first.locator('.card-head .avatar').click(); page.wait_for_timeout(500)
    det = N(page.inner_text('#psDetail'))
    check('Larissa Mota' in det and 'falta de' in det and page.locator('#psDetail .pf-amount').count() == 1, 'PC: dívida abre no painel do lado')
    lb, db = box(page, '#list'), box(page, '#psDetail')
    check(db['x'] > lb['x'] + lb['width'] - 1, 'PC: painel fica à direita da lista')
    check(page.locator('#list .card.open .card-body').count() == 0, 'PC: o detalhe saiu da lista (lista fica enxuta)')
    n0 = len([d for d in json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))['debts'] if d['name'] == 'Larissa Mota'][0]['payments'])
    page.fill('#psDetail .pf-amount', '50,00'); page.click('#psDetail [data-act="registrar"]'); page.wait_for_timeout(500)
    n1 = len([d for d in json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))['debts'] if d['name'] == 'Larissa Mota'][0]['payments'])
    check(n1 == n0 + 1, 'PC: registrar pagamento pelo painel')
    page.screenshot(path=SP + '/v12_pc_pessoas.png', full_page=True)
    page.click('#psDetail .od-close'); page.wait_for_timeout(300)
    check(page.locator('#list .card.open').count() == 0 and 'Escolha alguém' in page.inner_text('#psDetail'), 'PC: fechar o painel')
    page.click('#pageTabs button[data-page="relatorios"]'); page.wait_for_timeout(400)
    check(page.locator('#pageRelatorios #dashChartHolder svg').count() == 1, 'gráfico de evolução foi para Relatórios')
    ctx.close()

    # ---------------- celular
    ctx, page = boot(390, 844)
    tb = box(page, '#pageTabs')
    check(tb['y'] > 700, 'celular: menu continua embaixo')
    m, s_ = box(page, '.home-main'), box(page, '.home-side')
    check(s_['y'] > m['y'] + m['height'] - 1, 'celular: Início numa coluna só')
    page.screenshot(path=SP + '/v12_m_home.png', full_page=True)
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(400)
    page.locator('#list .card', has_text='Larissa Mota').first.locator('.card-head .avatar').click(); page.wait_for_timeout(500)
    card = page.locator('#list .card.open').first
    check(page.evaluate("getComputedStyle(document.querySelector('#list .card.open')).position") == 'fixed' and page.evaluate("document.body.classList.contains('sheet-open')"), 'celular: dívida aberta ocupa a tela')
    cb = card.bounding_box()
    check(cb['y'] <= 1 and cb['height'] > 800, 'celular: tela cheia (%s)' % cb)
    check('falta de' in N(card.inner_text()) and not page.locator('#btnNew').is_visible(), 'celular: topo com quanto falta; botão Nova dívida some')
    page.screenshot(path=SP + '/v12_m_divida.png')
    card.locator('.card-head .chev').click(); page.wait_for_timeout(400)
    check(page.locator('#list .card.open').count() == 0 and not page.evaluate("document.body.classList.contains('sheet-open')"), 'celular: voltar fecha')
    page.locator('#list .card', has_text='Vinicius').first.locator('.card-head .avatar').click(); page.wait_for_timeout(300)
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(300)
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    check(page.locator('#list .card.open').count() == 0, 'celular: trocar de aba fecha a dívida aberta')
    ctx.close()

    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
