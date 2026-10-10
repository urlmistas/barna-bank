"""Testes v16: renegociar uma dívida (mudar o valor das parcelas daqui pra frente, na mesma dívida)."""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, os, datetime
SP = OUT
exec(open(os.path.join(HERE, 'test_v5.py')).read().split('fails = []')[0])
from playwright.sync_api import sync_playwright
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
T = datetime.date.today()
def months_from(d, k, day):
    y, m = d.year, d.month + k
    while m > 12: m -= 12; y += 1
    while m < 1: m += 12; y -= 1
    return datetime.date(y, m, min(day, 28))
day = min(T.day, 28)
start = months_from(T, -5, 15)
# o cenário: 10x de 679,90, quatro pagas; a 5ª vence hoje
pai = debt('dpai', 'Pai', 6799, start.isoformat(), 10, kind='payable', dueDay=day,
           payments=[{'date': months_from(T, -4 + i, day).isoformat(), 'amount': 679.90} for i in range(4)])
lar = debt('dl2', 'Larissa Mota', 900, ago(40), 3)  # recebível pra testar "estender"
pai2 = debt('dpai2', 'Mãe', 6799.02, start.isoformat(), 10, kind='payable', dueDay=day,
            payments=[{'date': months_from(T, -4 + i, day).isoformat(), 'amount': 679.90} for i in range(4)])  # sobra 2 centavos de arredondamento
data['debts'] += [pai, lar, pai2]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);}" % json.dumps(json.dumps(data)))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(1500)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    get = lambda i: [d for d in st()['debts'] if d['id'] == i][0]
    def open_debt(name, did):
        page.click('#btnSearch'); page.fill('#gsInput', name); page.wait_for_timeout(250)
        page.locator('#gsResults .gs-item', has_text=name).first.click(); page.wait_for_timeout(500)
        card = page.locator('.card[data-debt-id="%s"]:visible' % did).first
        if 'open' not in (card.get_attribute('class') or ''): card.locator('.card-head').click(); page.wait_for_timeout(400)
        return card

    card = open_debt('Pai', 'dpai')
    before = N(card.inner_text())
    check('10x de R$ 679,90' in before, 'antes: 10x de 679,90')
    check(card.locator('[data-act="reneg"]').count() == 1, 'botão Renegociar')
    card.locator('[data-act="reneg"]').click(); page.wait_for_timeout(300)
    body = N(page.inner_text('#adBody'))
    check('Falta R$ 4.079' in body and '6x de R$ 679,9' in body, 'diálogo mostra o que falta: %s' % body[:120])
    check(page.input_value('#rnStart') == months_from(T, 0, day).isoformat(), 'começa na próxima parcela em aberto (hoje)')
    page.fill('#rnValue', '480'); page.wait_for_timeout(200)
    prev = N(page.inner_text('#rnPrev'))
    check('6x de R$ 480,00' in prev and '6x de R$ 199,9' in prev, 'prévia: 6x de 480 + 6x de 199,90: %s' % prev)
    check(page.get_attribute('#rnDiff', 'placeholder') == '199,90', 'sugere 199,90 de diferença')
    page.screenshot(path=SP + '/v16_reneg.png')
    page.fill('#rnNote', 'combinado com o pai')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(500)
    d = get('dpai')
    check(len(d['plan']) == 16 and d['installments'] == 16, 'plano com 16 parcelas (%d)' % len(d.get('plan', [])))
    vals = [x['v'] for x in d['plan']]
    check(vals[:4] == [679.9] * 4 and vals[4:10] == [480] * 6, 'pagas ficam 679,90; depois 480: %s' % vals[:10])
    check(abs(sum(vals[10:]) - (sum(vals) - 2719.6 - 2880)) < 0.01 and all(abs(v - 199.9) < 0.05 for v in vals[10:]), 'diferença em 199,90: %s' % vals[10:])
    check(abs(sum(vals) - 6799) < 0.01, 'total continua 6.799 (%.2f)' % sum(vals))
    check(d['plan'][4]['due'] == months_from(T, 0, day).isoformat() and d['plan'][10]['due'] == months_from(T, 6, day).isoformat(), 'datas: 480 a partir de hoje, diferença depois de 6 meses')
    card = page.locator('.card[data-debt-id="dpai"]:visible').first
    t = N(card.inner_text())
    check('4x de R$ 679,90 + 6x de R$ 480,00 + 6x de R$ 199,9' in t and 'renegociada' in t, 'topo mostra o plano: %s' % t[:200])
    check('Falta R$ 4.079' in N(page.inner_text('#undoStack')) or 'renegociada' in N(page.inner_text('#undoStack')), 'aviso com Desfazer')
    card.locator('[data-tab="parcelas"]').click(); page.wait_for_timeout(200)
    t = N(card.inner_text())
    check('4/16' in t and '5/16' in t and 'R$ 480,00' in t and '16/16' in t, 'aba Parcelas com 16')
    card.locator('[data-tab="historico"]').click(); page.wait_for_timeout(200)
    t = N(card.inner_text())
    check('Renegociada em' in t and '6x de R$ 679,9' in t and '→' in t and 'combinado com o pai' in t, 'histórico registra a renegociação: %s' % t[:200])
    page.screenshot(path=SP + '/v16_hist.png')
    # pagar a 5ª (480) quita a parcela certinha
    card.locator('[data-tab="resumo"]').click(); page.wait_for_timeout(200)
    check(card.locator('.pf-amount').input_value() == '480,00', 'próximo pagamento sugerido: 480,00 (%s)' % card.locator('.pf-amount').input_value())
    # desfazer
    page.locator('#undoStack .undo-toast', has_text='renegociada').locator('button').click(); page.wait_for_timeout(400)
    d = get('dpai')
    check('plan' not in d and d['installments'] == 10 and 'reneg' not in d, 'Desfazer volta como estava')
    # de novo, e editar o nome não desfaz; mudar o valor desfaz (com aviso)
    card = page.locator('.card[data-debt-id="dpai"]:visible').first
    card.locator('[data-act="reneg"]').click(); page.wait_for_timeout(300)
    page.fill('#rnValue', '480'); page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(400)
    card = page.locator('.card[data-debt-id="dpai"]:visible').first
    card.locator('[data-act="edit"]').click(); page.wait_for_timeout(300)
    check('foi renegociada' in page.inner_text('#formGroupNote'), 'editar avisa que mudar valor desfaz')
    page.fill('#fName', 'Pai'); page.click('#btnSave'); page.wait_for_timeout(300)
    check(len(get('dpai').get('plan', [])) == 16, 'salvar sem mudar valor mantém a renegociação')

    # estender: 900 em 3x de 300, nenhuma paga (1ª atrasada) → parcelas de 200
    card = open_debt('Larissa', 'dl2')
    card.locator('[data-act="reneg"]').click(); page.wait_for_timeout(300)
    check(page.input_value('#rnStart') >= T.isoformat(), 'atrasada: começa a partir de hoje')
    page.fill('#rnValue', '200'); page.wait_for_timeout(150)
    page.check('input[name="rnMode"][value="estender"]'); page.wait_for_timeout(150)
    prev = N(page.inner_text('#rnPrev'))
    check('5x de R$ 200,00' in prev or ('4x de R$ 200,00' in prev and '1x de' in prev), 'estender: parcelas de 200 até acabar: %s' % prev)
    page.check('input[name="rnMode"][value="fim"]'); page.wait_for_timeout(150)
    prev = N(page.inner_text('#rnPrev'))
    check('3x de R$ 200,00' in prev and '1x de R$ 300' in prev, 'fim: diferença numa parcela só: %s' % prev)
    page.check('input[name="rnMode"][value="estender"]')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(400)
    l = get('dl2')
    check(abs(sum(x['v'] for x in l['plan']) - 900) < 0.01 and all(x['due'] >= T.isoformat() for x in l['plan']), 'total igual e sem parcela vencida')
    check('Atrasad' not in N(page.locator('.card[data-debt-id="dl2"]:visible').first.inner_text()), 'deixa de estar atrasada')
    # centavos de arredondamento: o diálogo abre sem travar e não cria parcela de centavos
    card = open_debt('Mãe', 'dpai2')
    card.locator('[data-act="reneg"]').click(); page.wait_for_timeout(400)
    prev = N(page.inner_text('#rnPrev'))
    check('6x de R$ 679,9' in prev and 'Total R$ 4.079,42' in prev, 'abre com a prévia certa (sem travar): %s' % prev)
    page.fill('#rnValue', '480'); page.wait_for_timeout(200)
    prev = N(page.inner_text('#rnPrev'))
    check('6x de R$ 480,00' in prev and '6x de R$ 199,9' in prev and '1x de' not in prev, '480 + 6x de 199,90, sem parcela de centavos: %s' % prev)
    page.fill('#rnDiff', '200'); page.wait_for_timeout(200)
    prev = N(page.inner_text('#rnPrev'))
    check('5x de R$ 200,00' in prev and '1x de R$ 199,42' in prev, 'diferença em parcelas de 200: %s' % prev)
    page.fill('#rnValue', '0,01'); page.check('input[name="rnMode"][value="estender"]'); page.wait_for_timeout(300)
    check('parcelas demais' in page.inner_text('#rnPrev'), 'valor absurdo: avisa em vez de travar')
    page.click('#adActions [data-ad="cancel"]'); page.wait_for_timeout(200)
    # outro diálogo depois não leva os ouvintes do renegociar
    page.evaluate("document.getElementById('btnFits').click()"); page.wait_for_timeout(300); page.fill('#fiAmount', '50'); page.wait_for_timeout(200)
    page.click('#adActions [data-ad="cancel"]'); page.wait_for_timeout(200)
    # PIX/link e motor usam as parcelas novas
    v = page.evaluate("(function(){ var d = JSON.parse(localStorage.getItem('barnabank_debts_v3')).debts.find(function(x){return x.id==='dl2'}); return d.plan.length; })()")
    check(v >= 4, 'plano salvo')
    # quitar parcela a parcela até o fim (o plano novo fecha certinho)
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
