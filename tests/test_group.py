import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, sys, datetime
from playwright.sync_api import sync_playwright

SP = OUT
URL = APP_URL
T = datetime.date.today()
fails = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
def N(t): return t.replace('\xa0', ' ').replace(' ', ' ')

seed = {'debts': [], 'contacts': {'bia': {'phone': '11988887777'}}, 'transactions': [], 'groups': [],
        'wallets': [{'id': 'w1', 'name': 'Nubank', 'icon': '💜'}]}

INLINE_CARDS_CSS = (".card[data-debt-id].open{position:relative !important;inset:auto !important;z-index:auto !important;border-radius:18px !important;overflow:visible !important;padding-bottom:0 !important;background:var(--card) !important;border:1px solid var(--stroke) !important}"
    ".card[data-debt-id].open > .card-head{position:static !important}body.sheet-open{overflow:auto !important}body.sheet-open .fab{display:inline-flex !important}")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True)
    ctx.add_init_script("document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent=%s;document.head.appendChild(s);});" % json.dumps(INLINE_CARDS_CSS))
    ctx.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com'}));sessionStorage.setItem('s','1');}" % json.dumps(json.dumps(seed)))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    dialogs = []
    page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    page.goto(URL); page.wait_for_timeout(300)
    def open_group(title):
        c = page.locator('.gcard', has_text=title).first
        if 'open' not in (c.get_attribute('class') or ''):
            c.locator('.gcard-head').click(); page.wait_for_timeout(200)
        return page.locator('.gcard', has_text=title).first
    stored = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))

    # 1) criar grupo dividindo igual com "eu" incluído: 100 / 3
    page.click('#btnNew')
    check(page.is_visible('#formModeToggle'), 'Nova dívida mostra Individual / Em grupo')
    page.click('#formModeToggle button[data-m="group"]')
    check(page.is_visible('#groupOverlay'), 'Em grupo abre o formulário do grupo')
    page.fill('#gTitle', 'Churrasco de sábado')
    page.fill('#gTotal', '100')
    page.fill('#gPartInput', 'Ana, Bia')
    page.wait_for_timeout(100)
    amts = [N(t) for t in page.locator('#gParts .gp-amt').all_inner_texts()]
    check(amts == ['R$ 33,34', 'R$ 33,33', 'R$ 33,33'], 'divisão sem perder centavo: %s' % amts)
    page.fill('#gPartInput', 'ana'); page.press('#gPartInput', 'Enter')
    check('já está no grupo' in page.inner_text('#gErr'), 'nome repetido é recusado')
    page.screenshot(path=SP + '/g_form.png')
    page.click('#gSave'); page.wait_for_timeout(300)
    st = stored()
    g1 = st['groups'][0]
    d_ana = [d for d in st['debts'] if d['name'] == 'Ana'][0]
    check(len(st['debts']) == 2 and all(d.get('groupId') == g1['id'] for d in st['debts']), 'grupo gera 1 dívida por participante com groupId')
    check(d_ana['principal'] == 33.34 and abs(g1['myShare'] - 33.33) < 1e-9, 'Ana 33,34 e minha parte 33,33 (não vira dívida)')
    check(d_ana['firstDue'] == g1['dueDate'], 'vencimento da dívida = "pagar até" do grupo')
    check(page.is_visible('.gcard'), 'card do grupo aparece em Pessoas')
    check('R$ 0,00 de R$ 66,67 recebidos' in N(page.inner_text('.gcard')), 'barra de progresso: %s' % N(page.inner_text('.gcard .gp-amount')))

    # 2) clicar no avatar abre a dívida da pessoa; registrar pagamento com observação
    page.click('.g-av[data-debt="%s"]' % d_ana['id']); page.wait_for_timeout(300)
    card = page.locator('.card.open')
    check(card.count() == 1 and 'Ana' in card.inner_text(), 'avatar abre a dívida da Ana')
    check(card.locator('.grp-pill', has_text='Churrasco de sábado').count() == 1, 'dívida mostra a etiqueta do grupo')
    card.locator('.pf-note').fill('pago pelo Pedro')
    card.locator('[data-act="registrar"]').click(); page.wait_for_timeout(300)
    d_ana = [d for d in stored()['debts'] if d['name'] == 'Ana'][0]
    check(d_ana['payments'][0].get('note') == 'pago pelo Pedro', 'pagamento guarda a observação (amigo pagando pelo outro)')
    check('R$ 33,34 de R$ 66,67 recebidos' in N(page.inner_text('.gcard')), 'progresso do grupo atualiza')
    check(page.locator('.g-av.st-pago').count() == 1, 'avatar da Ana fica como pago')

    # 3) cobrar pendentes
    open_group('Churrasco').locator('[data-gact="charge"]').click(); page.wait_for_timeout(200)
    msg = N(page.input_value('#chargeMsg'))
    check('Bia: R$ 33,33' in msg and 'Já pagaram: Ana' in msg and '*Pix:* joao@pix.com' in msg, 'mensagem pronta para o grupo')
    check(page.locator('#chargeList a.btn-whats').count() == 1, 'link individual para quem tem telefone (Bia)')
    check(page.get_attribute('#chargeGroupLink', 'href').startswith('https://wa.me/?text='), 'botão abre WhatsApp com a mensagem')
    page.screenshot(path=SP + '/g_charge.png')
    page.click('#chargeClose')

    # 4) editar: muda o total -> redivide só entre quem não pagou
    open_group('Churrasco').locator('[data-gact="edit"]').click(); page.wait_for_timeout(200)
    page.fill('#gTotal', '160'); page.wait_for_timeout(100)
    check('redividido só entre quem ainda não pagou' in page.inner_text('#gWarn'), 'aviso de redivisão ao mudar o total')
    page.click('#gSave'); page.wait_for_timeout(300)
    st = stored(); g1 = st['groups'][0]
    bia = [d for d in st['debts'] if d['name'] == 'Bia'][0]
    ana = [d for d in st['debts'] if d['name'] == 'Ana'][0]
    check(ana['principal'] == 33.34 and bia['principal'] == 63.33 and abs(g1['myShare'] - 63.33) < 1e-9, 'Ana mantém 33,34; Bia e eu 63,33 cada')

    # 5) editar: remover quem já pagou (vira individual) e adicionar alguém
    open_group('Churrasco').locator('[data-gact="edit"]').click(); page.wait_for_timeout(200)
    page.locator('#gParts .gp-row', has_text='Ana').locator('.gp-del').click()
    check('vira individual' in page.inner_text('#gWarn') or 'continua como individual' in page.inner_text('#gWarn'), 'aviso: Ana vira individual')
    page.fill('#gPartInput', 'Caio'); page.click('#gPartAdd')
    page.click('#gSave'); page.wait_for_timeout(300)
    st = stored()
    ana = [d for d in st['debts'] if d['name'] == 'Ana'][0]
    caio = [d for d in st['debts'] if d['name'] == 'Caio']
    check('groupId' not in ana and len(ana['payments']) == 1, 'Ana saiu do grupo e manteve o pagamento')
    check(len(caio) == 1 and caio[0]['groupId'] == g1['id'], 'Caio entrou no grupo')

    # 6) valores diferentes sem mim: soma tem que fechar
    page.click('#btnNew'); page.click('#formModeToggle button[data-m="group"]')
    page.fill('#gTitle', 'Presente da Duda'); page.fill('#gTotal', '300')
    page.uncheck('#gIncludeMe')
    page.click('#gSplitToggle button[data-s="custom"]')
    page.fill('#gPartInput', 'Eva, Fábio'); page.wait_for_timeout(100)
    inputs = page.locator('#gParts .gp-input')
    inputs.nth(0).fill('100'); inputs.nth(1).fill('150')
    check('Faltam R$ 50,00' in N(page.inner_text('#gSum')), 'aviso "faltam R$ 50" quando a soma não bate')
    page.click('#gSave'); page.wait_for_timeout(150)
    check('Faltam' in N(page.inner_text('#gErr')), 'não salva enquanto a soma não fecha')
    inputs.nth(1).fill('200')
    check('Fecha certinho' in N(page.inner_text('#gSum')), 'soma fecha')
    page.click('#gSave'); page.wait_for_timeout(300)
    st = stored()
    check(len(st['groups']) == 2, 'segundo grupo criado')

    # 7) grupo atrasado (data e prazo no passado)
    page.click('#btnNew'); page.click('#formModeToggle button[data-m="group"]')
    page.fill('#gTitle', 'Pizza'); page.fill('#gTotal', '90')
    page.fill('#gDate', (T - datetime.timedelta(days=20)).isoformat())
    page.fill('#gDue', (T - datetime.timedelta(days=5)).isoformat())
    page.fill('#gPartInput', 'Gabi, Hugo'); page.wait_for_timeout(50)
    page.click('#gSave'); page.wait_for_timeout(300)
    pizza = page.locator('.gcard', has_text='Pizza')
    check('atrasado' in pizza.locator('.badge').inner_text(), 'grupo vencido mostra atrasados: %s' % pizza.locator('.badge').inner_text())
    check(pizza.locator('.g-av.st-atrasado').count() == 2, 'avatares atrasados em vermelho')
    page.screenshot(path=SP + '/g_list.png', full_page=True)

    # 8) agrupar por amigo mantém a etiqueta
    page.click('#btnGroup'); page.wait_for_timeout(200)
    page.locator('.group-head', has_text='Gabi').click(); page.wait_for_timeout(200)
    check(page.locator('.group-children .grp-pill', has_text='Pizza').count() == 1, 'agrupado por amigo: etiqueta do grupo aparece')
    page.click('#btnGroup'); page.wait_for_timeout(200)

    # 9) backup inclui grupos e importa de volta
    page.click('#btnExportMenuToggle')
    with page.expect_download() as dl:
        page.click('#btnExportJson')
    bk = json.load(open(dl.value.path()))
    check(len(bk.get('groups', [])) == 3, 'backup JSON inclui os 3 grupos')

    # 10) excluir grupo: manter dívidas como individuais
    open_group('Pizza').locator('[data-gact="delete"]').click()
    check(page.is_visible('#gDelKeep'), 'excluir pergunta se mantém as dívidas')
    page.click('#gDelKeep'); page.wait_for_timeout(300)
    st = stored()
    gh = [d for d in st['debts'] if d['name'] in ('Gabi', 'Hugo')]
    check(len(st['groups']) == 2 and len(gh) == 2 and all('groupId' not in d for d in gh), 'grupo apagado, Gabi e Hugo viraram individuais')

    # 11) excluir grupo apagando tudo
    open_group('Presente da Duda').locator('[data-gact="delete"]').click()
    page.click('#gDelAll'); page.wait_for_timeout(300)
    st = stored()
    check(len(st['groups']) == 1 and not [d for d in st['debts'] if d['name'] in ('Eva', 'Fábio')], 'grupo e dívidas de Eva e Fábio apagados')

    # 12) importar o backup de antes restaura os grupos
    page.set_input_files('#fileImport', dl.value.path()); page.wait_for_timeout(400)
    body = N(page.inner_text('#adBody')) if page.is_visible('#appDialog') else ''
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    st = stored()
    check(len(st['groups']) == 3 and 'Grupos: 1 → 3' in body, 'importação restaura grupos e mostra no resumo')

    # 13) editar dívida de grupo mostra o aviso
    pass #, page.locator('#list .card').count(), page.locator('#list').inner_text()[:200].replace('\n',' | '), 'page:', page.evaluate("document.getElementById('pagePessoas').style.display"))
    page.locator('.card', has_text='Bia').first.locator('.card-head .avatar').click(); page.wait_for_timeout(200)
    pass #, page.locator('.card.open').count(), [x[:30] for x in page.locator('.card.open .who .name').all_inner_texts()], page.locator('.card', has_text='Bia').count())
    page.locator('.card.open [data-act="edit"]').click(); page.wait_for_timeout(200)
    check(page.is_visible('#formGroupNote') and not page.is_visible('#formModeToggle'), 'editar dívida de grupo avisa e esconde a escolha de tipo')
    page.click('#btnCancel')

    check(not errors, 'sem erros de JavaScript %s' % errors)
    b.close()

print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
