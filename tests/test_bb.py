import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, datetime, sys, re
from playwright.sync_api import sync_playwright

SP = OUT
URL = APP_URL
T = datetime.date.today()

def months_ago(n, day):
    y, m = T.year, T.month - n
    while m <= 0:
        m += 12; y -= 1
    return datetime.date(y, m, min(day, 28)).isoformat()

DAY = min(T.day, 28)
start3 = months_ago(3, DAY)   # parcela 1 vence ~2 meses atrás, 2 ~1 mês atrás, 3 ~hoje/futuro
startF = T.isoformat()        # tudo no futuro
old_tx_date = months_ago(6, 5)

def debt(id, name, date, n, **kw):
    d = dict(id=id, name=name, principal=1000, date=date, days=n*30, installments=n, rate=0,
             interestType='composto', dueDay=DAY, payments=[], notes='', kind='receivable', discount=0)
    d.update(kw)
    return d

p1 = months_ago(2, DAY)
data = {
  'debts': [
    debt('a', 'Ana Parcial', start3, 4, payments=[
        {'date': p1, 'amount': 250, 'mode': 'target', 'target': 0},
        {'date': months_ago(1, DAY), 'amount': 100, 'mode': 'target', 'target': 1}]),
    debt('b', 'Bruno Adianta', startF, 4, payments=[
        {'date': T.isoformat(), 'amount': 750, 'mode': 'target', 'target': 0}]),
    debt('c', 'Caio Multa', start3, 4, lateFeePct=2, lateInterestPct=1, payments=[
        {'date': p1, 'amount': 250, 'mode': 'target', 'target': 0}]),
    debt('d', 'Duda Antigo', start3, 4, payments=[
        {'date': p1, 'amount': 600}]),   # formato antigo: abate em ordem
    debt('e', 'Edu Price', startF, 12, rate=5, interestType='price',
         notes='teste </script><b>x</b>'),
  ],
  'contacts': {},
  'wallets': [{'id': 'w1', 'name': 'Nubank', 'icon': '<img src=x onerror=alert(1)>'}],
  'transactions': [{'id': 't1', 'walletId': 'w1', 'type': 'entrada', 'amount': 500, 'date': old_tx_date, 'category': 'Salário'}],
}

fails = []
def N(t): return t.replace('\xa0',' ').replace('\u202f',' ')
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

INLINE_CARDS_CSS = (".card[data-debt-id].open{position:relative !important;inset:auto !important;z-index:auto !important;border-radius:18px !important;overflow:visible !important;padding-bottom:0 !important;background:var(--card) !important;border:1px solid var(--stroke) !important}"
    ".card[data-debt-id].open > .card-head{position:static !important}body.sheet-open{overflow:auto !important}body.sheet-open .fab{display:inline-flex !important}")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 400, 'height': 900}, accept_downloads=True)
    ctx.add_init_script("document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent=%s;document.head.appendChild(s);});" % json.dumps(INLINE_CARDS_CSS))
    ctx.add_init_script("if(!sessionStorage.getItem('seeded')){localStorage.setItem('barnabank_debts_v3', %s); sessionStorage.setItem('seeded','1');}" % json.dumps(json.dumps(data)))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    dialogs = []
    def on_dialog(dlg):
        dialogs.append(dlg.message); dlg.accept()
    page.on('dialog', on_dialog)
    page.goto(URL)
    page.click('#pageTabs button[data-page="pessoas"]')
    page.wait_for_timeout(300)

    stored = json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    check(len(stored['transactions']) == 1, 'lançamento de 6 meses atrás NÃO foi apagado')

    def card(name):
        return page.locator('.card', has=page.locator('.name', has_text=name)).first
    def open_card(name):
        c = card(name)
        if 'open' not in (c.get_attribute('class') or ''):
            c.locator('.card-head').click(); page.wait_for_timeout(150)
        page.evaluate("document.querySelectorAll('.od-details').forEach(function(d){ d.open = true; })")
        return card(name)

    # A: parcial fica em atraso
    c = open_card('Ana Parcial')
    txt = c.inner_text().replace('\xa0',' ')
    check('atrasado' in c.locator('.badge').inner_text().replace('\xa0',' '), 'Ana: status atrasado')
    check('R$ 150,00' in c.locator('.badge').inner_text().replace('\xa0',' '), 'Ana: badge mostra R$ 150 em atraso')
    check('Pendente de parcelas anteriores' in txt, 'Ana: mostra pendente da parcela 2')
    check(re.search(r'Parcela\s+3/4', txt) is not None, 'Ana: parcela da vez é a 3')
    page.screenshot(path=SP + '/shot_ana_before.png', full_page=False)
    c.locator('.card-body').screenshot(path=SP + '/shot_ana_card.png')
    # paga a parcela 3 sem incluir pendente
    c.locator('[data-act="registrar"]').click(); page.wait_for_timeout(200)
    c = open_card('Ana Parcial')
    check('R$ 150,00' in c.locator('.badge').inner_text().replace('\xa0',' '), 'Ana: após pagar parcela 3, a 2 continua com R$ 150 em atraso')
    check('Parcela 4/4' in c.inner_text().replace('\xa0',' ') or 'Parcela\n4/4' in c.inner_text().replace('\xa0',' ') or re.search(r'Parcela\s+4/4', c.inner_text().replace('\xa0',' ')), 'Ana: agora parcela da vez é a 4')
    # inclui pendente com valor personalizado (só 50), sem pagar a 4
    c.locator('[data-act="incluir-pendente"]').click()
    c.locator('.pf-pend-amount').fill('50')
    c.locator('.pf-amount').fill('0')
    c.locator('[data-act="registrar"]').click(); page.wait_for_timeout(200)
    c = open_card('Ana Parcial')
    check('R$ 100,00' in c.locator('.badge').inner_text().replace('\xa0',' '), 'Ana: pendente parcial (50) reduz atraso para R$ 100')
    c.locator('[data-act="incluir-pendente"]').click()
    c.locator('.pf-amount').fill('0')
    c.locator('[data-act="registrar"]').click(); page.wait_for_timeout(200)
    c = open_card('Ana Parcial')
    check('atrasado' not in c.locator('.badge').inner_text().replace('\xa0',' '), 'Ana: incluindo o resto do pendente, sai do atraso (%s)' % c.locator('.badge').inner_text().replace('\xa0',' '))

    # B: adiantamento
    c = open_card('Bruno Adianta')
    states = c.locator('.inst-row .ir-st').all_inner_texts()
    check(states[:3] == ['Recebida']*3 and states[3] == 'Em aberto', 'Bruno: 3 parcelas adiantadas ficam como recebidas (%s)' % states)
    check('atrasado' not in c.locator('.badge').inner_text().replace('\xa0',' '), 'Bruno: sem atraso')

    # C: multa + mora
    c = open_card('Caio Multa')
    txt = c.inner_text().replace('\xa0',' ')
    m = re.search(r'Encargos de atraso\s*R\$\s*([\d.,]+)', txt, re.I)
    check(m is not None and float(m.group(1).replace('.','').replace(',','.')) > 7, 'Caio: encargos calculados (%s)' % (m.group(1) if m else None))
    c.locator('.card-body').screenshot(path=SP + '/shot_caio_card.png')

    # D: formato antigo (FIFO)
    c = open_card('Duda Antigo')
    states = c.locator('.inst-row .ir-st').all_inner_texts()
    check(states[0] == 'Recebida' and states[1] == 'Recebida' and states[2] in ('Parcial','Em atraso'), 'Duda: pagamento antigo de 600 cobre 2 parcelas e parte da 3ª (%s)' % states)

    # E: Price
    c = open_card('Edu Price')
    txt = c.inner_text().replace('\xa0',' ')
    check('R$ 1.353,9' in txt, 'Edu: total Tabela Price R$ 1.353,90 (1000, 5%, 12x)')
    check('Tabela Price' in txt, 'Edu: rótulo Tabela Price')

    # F: backup JSON completo
    page.click('#btnExportMenuToggle')
    with page.expect_download() as dl:
        page.click('#btnExportJson')
    bk = json.load(open(dl.value.path()))
    check(all(k in bk for k in ('debts','wallets','transactions','settings','contacts')), 'backup JSON tem dívidas, carteiras, lançamentos e configurações')
    check(len(bk['wallets']) == 1 and len(bk['transactions']) == 1, 'backup JSON com 1 carteira e 1 lançamento')

    # G: cópia .html não quebra com </script>
    with page.expect_download() as dl2:
        page.locator('#btnExportHtml').dispatch_event('click')
    dl2.value.save_as(SP + '/copia.html')
    page2 = ctx.new_page()
    errs2 = []
    page2.on('pageerror', lambda e: errs2.append(str(e)))
    page2.goto('file://' + SP + '/copia.html?snapshot=1')
    page2.click('#pageTabs button[data-page="pessoas"]')
    page2.wait_for_timeout(300)
    check(page2.locator('.card').count() == 5 and not errs2, 'cópia .html abre com as 5 dívidas mesmo com </script> na anotação (%d, %s)' % (page2.locator('.card').count(), errs2))
    page2.close()

    # H: importar restaura carteiras/lançamentos e pede confirmação
    page.evaluate("localStorage.clear()")
    imp = dict(bk); imp['transactions'] = bk['transactions'] + [{'id':'t2','walletId':'w1','type':'gasto','amount':20,'date':T.isoformat(),'category':'Mercado'}]
    open(SP + '/imp.json','w').write(json.dumps(imp))
    n_dialogs = len(dialogs)
    page.set_input_files('#fileImport', SP + '/imp.json'); page.wait_for_timeout(400)
    check(page.is_visible('#appDialog') and 'substituir' in page.inner_text('#adBody'), 'importação pede confirmação (janela do app)')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    stored = json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    check(len(stored['transactions']) == 2 and len(stored['wallets']) == 1, 'importação restaurou carteiras e lançamentos')

    # I: carteira com ícone malicioso não executa
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(300)
    check(not any('alert' in d_ or d_ == '1' for d_ in dialogs[n_dialogs+1:]), 'ícone da carteira não executa HTML')
    page.screenshot(path=SP + '/shot_wallets.png')

    check(not errors, 'sem erros de JavaScript (%s)' % errors)
    b.close()

print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
