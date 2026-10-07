import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, sys, datetime
sys.argv = ['x', 'tmp']
exec(open(os.path.join(HERE, 'seed.py')).read().split('with sync_playwright() as p:')[0])

fails = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
def N(t): return (t or '').replace('\xa0', ' ').replace(' ', ' ')
def ym_add(d, n):
    y, m = d.year, d.month - 1 + n
    y += m // 12; m %= 12
    return datetime.date(y, m + 1, 1)

# cartão com compra antiga não paga (rotativo)
old = ym_add(T, -2).replace(day=1).isoformat()
data['cards'] = [{'id': 'c1', 'name': 'Roxinho', 'limit': 3000, 'closingDay': 5, 'dueDay': 12, 'walletId': 'w1'}]
data['cardPurchases'] = [{'id': 'p1', 'cardId': 'c1', 'desc': 'Fone', 'amount': 300, 'installments': 1, 'date': old, 'category': 'Eletrônicos'}]
data['cardPayments'] = []
data['bills'] = []

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True)
    route_fonts(ctx)
    ctx.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_last_export','%s');sessionStorage.setItem('s','1');}" % (json.dumps(json.dumps(data)), T.isoformat()))
    page = ctx.new_page()
    errors, natives = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: (natives.append(d.message), d.dismiss()))
    page.goto(URL); page.wait_for_timeout(700)
    stored = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    debt = lambda i: [d for d in stored()['debts'] if d['id'] == i][0]

    # ---------- Início: Esta semana + Recebi + Desfazer
    rows = page.locator('#weekList .wk-row')
    check(rows.count() >= 4, 'Esta semana lista vencimentos (%d)' % rows.count())
    first_title = rows.first.locator('.wk-title').inner_text()
    check(first_title == 'Larissa Mota', 'mais atrasado aparece primeiro (%s)' % first_title)
    n_before = len(debt('d2')['payments'])
    rows.first.locator('.wk-act').click(); page.wait_for_timeout(300)
    check(len(debt('d2')['payments']) == n_before + 1, 'Recebi em 1 toque registra pagamento')
    check(page.locator('.undo-toast').count() == 1 and 'Recebido' in N(page.inner_text('#undoStack')), 'aparece "Desfazer"')
    page.locator('.undo-toast button').first.click(); page.wait_for_timeout(300)
    check(len(debt('d2')['payments']) == n_before, 'Desfazer remove o pagamento')
    page.screenshot(path=SP + '/n_dash.png')

    # ---------- Pessoas: pendentes, arquivo, resumo, ordenação
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    names = page.locator('#list .card .who .name').all_inner_texts()
    check(not any('Ana Souza' in x for x in names), 'lista abre só com pendentes (Ana quitada some)')
    check(names and 'Larissa Mota' in names[0], 'ordem "vence primeiro": %s' % (names[0][:20] if names else None))
    check(page.inner_text('#archiveCount') == '1', 'Arquivo mostra contador 1')
    check(not page.locator('#pessoasResumo').evaluate('e => e.open'), 'Resumo começa recolhido')
    check('em atraso' in N(page.inner_text('#resumoLine')), 'linha do resumo: %s' % N(page.inner_text('#resumoLine')))
    page.click('#filters button[data-f="pagos"]'); page.wait_for_timeout(200)
    check(any('Ana Souza' in x for x in page.locator('#list .card .who .name').all_inner_texts()), 'Arquivo mostra a dívida quitada')
    page.click('#filters button[data-f="pendentes"]'); page.wait_for_timeout(200)

    # quick pay no card
    rafa = page.locator('#list .card', has_text='Rafael Nunes')
    rafa.locator('.quick-pay').click(); page.wait_for_timeout(300)
    check(len(debt('d3')['payments']) == 1 and debt('d3')['payments'][0]['amount'] == 250, 'Recebi no card registra a parcela (R$ 250)')
    check(page.locator('#list .card', has_text='Rafael Nunes').count() == 0, 'quitada sai da lista de pendentes')
    page.locator('.undo-toast button').last.click(); page.wait_for_timeout(300)
    check(len(debt('d3')['payments']) == 0 and page.locator('#list .card', has_text='Rafael Nunes').count() == 1, 'Desfazer devolve para a lista')

    # abas do card
    vin = page.locator('#list .card', has_text='Vinicius Prado')
    vin.locator('.card-head .avatar').click(); page.wait_for_timeout(400)
    vin = page.locator('#list .card.open')
    check(vin.locator('.card-panel[data-panel="resumo"]').is_visible(), 'card abre na aba Resumo')
    vin.locator('.ct-btn[data-tab="parcelas"]').click(); page.wait_for_timeout(150)
    check(vin.locator('.card-panel[data-panel="parcelas"] .inst-row').count() == 6 and not vin.locator('.card-panel[data-panel="resumo"]').is_visible(), 'aba Parcelas mostra as 6 parcelas')
    vin.locator('.ct-btn[data-tab="historico"]').click(); page.wait_for_timeout(150)
    check(vin.locator('.card-panel[data-panel="historico"] .history-row').count() == 2, 'aba Histórico mostra 2 pagamentos')
    page.screenshot(path=SP + '/n_tabs.png')

    # editar pagamento em janela do app
    vin.locator('.hr-edit').first.click(); page.wait_for_timeout(300)
    check(page.is_visible('#appDialog') and page.is_visible('#epAmount'), 'editar pagamento abre janela do app (sem prompt)')
    page.fill('#epAmount', '200'); page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    amts = sorted(p_['amount'] for p_ in debt('d1')['payments'])
    check(200 in amts, 'pagamento editado para R$ 200 (%s)' % amts)
    check(page.locator('#list .card.open .ct-btn.active').inner_text().startswith('Histórico'), 'aba continua em Histórico depois de salvar')
    # remover com desfazer
    page.locator('#list .card.open .hr-del').first.click(); page.wait_for_timeout(300)
    check(len(debt('d1')['payments']) == 1, 'pagamento removido')
    page.locator('.undo-toast button').last.click(); page.wait_for_timeout(300)
    check(len(debt('d1')['payments']) == 2, 'remoção desfeita')

    # ---------- máscara de dinheiro
    page.click('#btnNew'); page.wait_for_timeout(300)
    page.fill('#fName', 'Teste Máscara')
    page.click('#fPrincipal'); page.keyboard.type('1234,5')
    check(page.input_value('#fPrincipal') == '1.234,5', 'máscara enquanto digita: %s' % page.input_value('#fPrincipal'))
    page.click('#fDate'); page.wait_for_timeout(100)
    check(page.input_value('#fPrincipal') == '1.234,50', 'ao sair do campo vira 1.234,50 (%s)' % page.input_value('#fPrincipal'))
    ov = page.locator('#overlay').evaluate("e => getComputedStyle(e).alignItems")
    check(ov == 'flex-end', 'no celular a janela sobe de baixo (align-items=%s)' % ov)
    page.screenshot(path=SP + '/n_sheet.png')
    page.click('#btnSave'); page.wait_for_timeout(300)
    nd = [d for d in stored()['debts'] if d['name'] == 'Teste Máscara']
    check(nd and nd[0]['principal'] == 1234.5, 'valor salvo como 1234,50')

    # ---------- página da pessoa
    vc = page.locator('#list .card', has_text='Vinicius Prado')
    if 'open' not in (vc.get_attribute('class') or ''):
        vc.locator('.card-head .avatar').click(); page.wait_for_timeout(300)
    page.locator('#list .card.open .ct-btn[data-tab="resumo"]').click()
    page.locator('#list .card.open [data-act="profile"]').click(); page.wait_for_timeout(300)
    check(page.is_visible('#pagePessoa') and 'Vinicius Prado' in page.inner_text('.ph-name'), 'abre a página da pessoa')
    check(page.locator('.person-history .history-row').count() == 2 and page.locator('#personDebts .card').count() == 1, 'página mostra dívidas e histórico')
    check(page.locator('.person-actions a.btn-whats').count() == 1, 'botão de cobrar no WhatsApp (tem telefone)')
    page.screenshot(path=SP + '/n_person.png', full_page=True)
    page.click('#btnPersonBack'); page.wait_for_timeout(200)
    check(page.is_visible('#pagePessoas'), 'Voltar retorna para Pessoas')

    # ---------- carteiras: transferência e editar
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(200)
    bal = lambda: page.evaluate("JSON.stringify(['w1','w2'].map(function(id){ return document.querySelector('#walletList').innerText }))")
    page.click('#btnNewTransaction'); page.wait_for_timeout(200)
    page.click('#txTypeToggle button[data-t="transferencia"]')
    check(page.is_visible('#txToField') and not page.is_visible('#txCategoryField'), 'Transferir mostra "Para" e esconde categoria')
    page.select_option('#txWallet', 'w1'); page.select_option('#txToWallet', 'w2')
    page.fill('#txAmount', '100'); page.click('#btnTxSave'); page.wait_for_timeout(300)
    tx = [t for t in stored()['transactions'] if t['type'] == 'transferencia']
    check(len(tx) == 1 and tx[0]['walletId'] == 'w1' and tx[0]['toWalletId'] == 'w2' and tx[0]['amount'] == 100, 'transferência salva')
    txt = N(page.inner_text('#walletList'))
    check('R$ 2.919,60' in txt and '-R$ 800,00' in txt, 'saldos: Nubank −100, Inter +100 (%s)' % txt.replace(chr(10), ' | '))
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(200)
    check(N(page.inner_text('#dashMonthIn')) == 'R$ 3.200,00', 'transferência não conta como entrada do mês')
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(200)
    page.locator('#walletList .card', has_text='Dinheiro').locator('.card-head').click(); page.wait_for_timeout(300)
    page.locator('#walletList .card.open .wtx-edit').first.click(); page.wait_for_timeout(200)
    check(page.inner_text('#txModalTitle') == 'Editar lançamento' and page.input_value('#txAmount') == '64,00', 'editar lançamento abre preenchido')
    page.fill('#txAmount', '70'); page.click('#btnTxSave'); page.wait_for_timeout(300)
    check([t for t in stored()['transactions'] if t['id'] == 't4'][0]['amount'] == 70, 'lançamento editado para R$ 70')

    # ---------- contas fixas
    page.click('#pageTabs button[data-page="contas"]'); page.wait_for_timeout(300)
    check(page.is_visible('#pageContas'), 'aba Contas abre')
    due_day = (T + datetime.timedelta(days=2))
    page.click('#btnNewBill'); page.wait_for_timeout(200)
    page.fill('#bdName', 'Internet'); page.fill('#bdAmount', '99,90'); page.fill('#bdDay', str(due_day.day))
    page.select_option('#bdWallet', 'w1')
    if due_day.month != T.month:
        page.fill('#bdStart', due_day.strftime('%Y-%m'))
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    if due_day.month != T.month:
        page.click('#ctNext'); page.wait_for_timeout(200)
    row = page.locator('.bill-row', has_text='Internet')
    check(row.count() == 1 and 'Vence em 2 dias' in N(row.inner_text()), 'conta fixa aparece com "Vence em 2 dias"')
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(200)
    check(page.locator('#weekList .wk-row', has_text='Internet').count() == 1, 'conta fixa aparece em Esta semana')
    page.click('#pageTabs button[data-page="contas"]'); page.wait_for_timeout(200)
    if due_day.month != T.month:
        page.click('#ctNext'); page.wait_for_timeout(200)
    page.locator('.bill-row', has_text='Internet').locator('.bill-act').click(); page.wait_for_timeout(200)
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    st = stored()
    bill = st['bills'][0]
    paid_tx = [t for t in st['transactions'] if t.get('auto', '').startswith('bill:')]
    check(len(bill['paid']) == 1 and len(paid_tx) == 1 and paid_tx[0]['amount'] == 99.9 and paid_tx[0]['walletId'] == 'w1', 'Paguei marca a conta e lança gasto na carteira')
    check('Paga' in N(page.locator('.bill-row', has_text='Internet').inner_text()), 'conta mostra "Paga"')
    page.locator('.undo-toast button').last.click(); page.wait_for_timeout(300)
    st = stored()
    check(not st['bills'][0]['paid'] and not [t for t in st['transactions'] if t.get('auto', '').startswith('bill:')], 'Desfazer desmarca e apaga o lançamento')
    if due_day.month != T.month:
        page.click('#ctToday'); page.wait_for_timeout(200)

    # ---------- cartão: rotativo, compra parcelada, pagamento parcial
    card = page.locator('.cc-block', has_text='Roxinho')
    check('ficou da fatura anterior' in N(card.inner_text()) or 'foi para a próxima' in N(card.inner_text()), 'saldo não pago vai para a fatura seguinte (rotativo)')
    card.locator('[data-a="buy"]').click(); page.wait_for_timeout(200)
    page.fill('#cpDesc', 'Tênis'); page.fill('#cpAmount', '600'); page.fill('#cpN', '3'); page.fill('#cpDate', T.isoformat())
    hint = N(page.inner_text('#cpHint'))
    check('3x de R$ 200,00' in hint, 'dica mostra a fatura e as parcelas: %s' % hint)
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    card = page.locator('.cc-block', has_text='Roxinho')
    check('Usado R$ 900,00' in N(card.inner_text()) and 'Disponível R$ 2.100,00' in N(card.inner_text()), 'limite usado/disponível: %s' % N(card.locator('.cc-limit-txt').inner_text()))
    page.screenshot(path=SP + '/n_contas.png', full_page=True)
    # vai para a fatura que contém a 1ª parcela e paga só uma parte
    first_key = page.evaluate("invoiceKeyFor ? null : null") if False else None
    for _ in range(3):
        c = page.locator('.cc-block', has_text='Roxinho')
        if c.locator('[data-a="items"]').inner_text().strip().startswith('0'):
            page.click('#ctNext'); page.wait_for_timeout(150)
        else:
            break
    c = page.locator('.cc-block', has_text='Roxinho')
    c.locator('[data-a="pay"]').click(); page.wait_for_timeout(200)
    page.fill('#piAmount', '50'); page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    st = stored()
    check(len(st['cardPayments']) == 1 and st['cardPayments'][0]['amount'] == 50 and [t for t in st['transactions'] if t.get('auto', '').startswith('card:')], 'pagamento parcial da fatura registrado e lançado na carteira')
    check('Usado R$ 850,00' in N(page.locator('.cc-block', has_text='Roxinho').inner_text()), 'limite libera o valor pago')

    # ---------- excluir carteira com janela do app
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(200)
    wc = page.locator('#walletList .card', has_text='Dinheiro')
    if 'open' not in (wc.get_attribute('class') or ''):
        wc.locator('.card-head .avatar').click(); page.wait_for_timeout(300)
    page.locator('#walletList .card.open [data-act="del-wallet"]').click(); page.wait_for_timeout(200)
    check(page.is_visible('#appDialog') and 'Dinheiro' in page.inner_text('#adBody'), 'excluir carteira pede confirmação na janela do app')
    page.click('#adActions [data-ad="cancel"]'); page.wait_for_timeout(150)

    # ---------- backup inclui contas e cartões
    page.click('#btnExportMenuToggle')
    with page.expect_download() as dl:
        page.click('#btnExportJson')
    bk = json.load(open(dl.value.path()))
    check(all(k in bk for k in ('bills', 'cards', 'cardPurchases', 'cardPayments')) and len(bk['cardPurchases']) == 2, 'backup JSON inclui contas fixas e cartões')

    check(not natives, 'nenhuma caixinha nativa do navegador (%s)' % natives)
    check(not errors, 'sem erros de JavaScript %s' % errors)
    b.close()
print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
