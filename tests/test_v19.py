"""Testes v19: assunto e descrição da dívida + página nova do link "do que devo" (banner, próximo pagamento, dívidas, histórico, Inter)."""
import os, sys, tempfile
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
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
def http(method, path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BOT + path, method=method)) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
http('GET', '/setup?key=' + KEY)
T = datetime.date.today()
def mon(k, day):
    y, m = T.year, T.month + k
    while m > 12: m -= 12; y += 1
    while m < 1: m += 12; y -= 1
    return datetime.date(y, m, min(day, 28)).isoformat()
# o que eu devo pro Ches: notebook em 7x (5 pagas) e um plano de celular recorrente
data['debts'].append(dict(id='nb', name='Ches', kind='payable', principal=810.32, rate=0, interestType='composto', installments=7, days=210, date=mon(-5, 19), dueDay=8,
    notes='anotação privada xyz', subject='Notebook Dell', discount=0, lateFeePct=0, lateInterestPct=0,
    payments=[{'date': mon(-5 + i, 8), 'amount': 115.76} for i in range(1, 6)]))
data['debts'].append(dict(id='cel', name='Ches', kind='payable', principal=45, rate=0, interestType='composto', installments=1, days=30, date=mon(-4, 5), dueDay=5,
    notes='', subject='Plano de celular', recurring={'amount': 45, 'label': 'Plano de celular'}, discount=0, lateFeePct=0, lateInterestPct=0,
    payments=[{'date': mon(-4 + i, 5), 'amount': 45} for i in range(1, 5)]))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({ownerName:'João'}));localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(2000)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))

    # ---------------- 1. assunto e descrição no formulário
    page.click('#btnNew'); page.wait_for_timeout(300)
    page.click('#formKindToggle button[data-k="payable"]'); page.wait_for_timeout(150)
    page.fill('#fName', 'Ches')
    check(page.is_visible('#fSubject') and page.is_visible('#fPubNote'), 'formulário tem "Do que se trata" e "Descrição no link"')
    page.fill('#fSubject', 'Conserto da moto')
    page.fill('#fPubNote', 'Troca da embreagem na oficina do Zé.')
    page.fill('#fPrincipal', '777,60'); page.fill('#fInstallments', '6')
    page.click('#btnSave'); page.wait_for_timeout(500)
    moto = [d for d in st()['debts'] if d.get('subject') == 'Conserto da moto']
    check(len(moto) == 1 and moto[0]['pubNote'] == 'Troca da embreagem na oficina do Zé.', 'salvou assunto e descrição')
    # editar mantém, e apagar o assunto remove o campo
    nb = [d for d in st()['debts'] if d['id'] == 'nb'][0]
    check(nb['subject'] == 'Notebook Dell', 'assunto de dado antigo continua')

    # ---------------- 2. link "do que devo"
    page.click('#btnSearch'); page.fill('#gsInput', 'ches'); page.wait_for_timeout(250)
    page.locator('#gsResults .gs-item', has_text='Ches').first.click(); page.wait_for_timeout(500)
    check('Conserto da moto' in page.inner_text('#personContent'), 'página da pessoa mostra o assunto')
    page.click('#personOweShare'); page.wait_for_timeout(2500)
    url = page.input_value('#shUrl')
    token = url.rsplit('/s/', 1)[-1]
    check(re.match(r'^[A-Za-z0-9]{16,40}$', token) is not None, 'link criado: %s' % url)
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    c, html = http('GET', '/s/' + token)
    t = N(re.sub('<[^>]+>', ' ', html))
    check(c == 200 and 'class="lk"' in html, 'página nova do link (%s)' % c)
    check('family=Inter' in html and 'font:15px/1.45 Inter' in html, 'fonte Inter')
    check('João ainda deve a Ches' in t, 'banner: quem deve a quem')
    check('FALTA PAGAR' in t and 'pagos de' in t, 'banner: falta pagar e progresso')
    check('Em aberto' in t and 'Recorrente' in t and 'Quitadas' in t and 'Termina tudo' in t, 'banner: em aberto, recorrente, quitadas e quando termina')
    check(re.search(r'(PRÓXIMO PAGAMENTO|PAGAMENTO ATRASADO) · ', t) is not None, 'card do próximo pagamento')
    check(t.count('Conserto da moto') >= 1 and 'Notebook Dell' in t and 'Plano de celular' in t, 'dívidas com o assunto como título')
    check('“Troca da embreagem na oficina do Zé.”' in t, 'descrição do link aparece')
    check('anotação privada xyz' not in html, 'anotação privada NÃO aparece')
    check('6x de R$ 129,60' in t and '7x de R$ 115,76' in t, 'subtítulo com as parcelas')
    check(re.search(r'Parcela \d+ de 7', t) is not None and 'Termina' in t, 'parcela X de Y e quando termina')
    check('Recorrente' in t and 'todo dia 5' in t, 'recorrente: valor e dia do mês')
    check('Últimos pagamentos' in t and re.search(r'Notebook Dell \dª parcela', t) is not None, 'histórico diz de qual parcela foi')
    check('Total pago' in t, 'total pago no fim do histórico')
    check('<details class="lk-insts"' in html and 'Ver parcelas' in t, 'parcelas recolhidas em "Ver parcelas"')
    ctx.close()

    # ---------------- 3. visual: PC (duas colunas, histórico sem nada embaixo) e celular (sem rolar pro lado)
    for (w, h, tag) in [(1280, 900, 'pc'), (390, 844, 'm')]:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        pg.goto(BOT + '/s/' + token); pg.wait_for_timeout(300)
        box = lambda sel: pg.locator(sel).first.bounding_box()
        bn, nx, hs, db = box('.lk-banner'), box('.lk-next'), box('.lk-hist'), box('.lk-debts')
        if tag == 'pc':
            check(hs['x'] > bn['x'] + bn['width'] - 1 and abs(hs['y'] - bn['y']) < 2, 'PC: últimos pagamentos ao lado do banner')
            check(nx['y'] > bn['y'] + bn['height'] - 1 and db['y'] > nx['y'] + nx['height'] - 1, 'PC: próximo pagamento embaixo do banner, dívidas depois')
            check(abs((hs['y'] + hs['height']) - (db['y'] + db['height'])) < 2, 'PC: coluna dos pagamentos vai até o fim (nada embaixo)')
        else:
            check(abs(bn['width'] - nx['width']) < 2 and bn['width'] > 340, 'celular: blocos na largura toda')
            check(hs['y'] > db['y'], 'celular: últimos pagamentos no fim')
            check(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'celular: sem rolagem pro lado')
        pg.locator('details.lk-insts').first.evaluate('e => e.open = true')
        check(pg.locator('.lk-grid-i .lk-i').count() >= 6, '%s: abrir mostra as parcelas' % tag)
        pg.screenshot(path=SP + '/v19_link_%s.png' % tag, full_page=True)
        pg.close()
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
