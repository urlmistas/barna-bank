"""Testes das novidades v5. Uso: python3 test_v5.py"""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, datetime
SP = OUT
exec(open(os.path.join(HERE, 'seed.py')).read().split('with sync_playwright')[0])
from playwright.sync_api import sync_playwright

ym = T.isoformat()[:7]
data['cards'] = [{'id': 'c1', 'name': 'Roxinho', 'limit': 3000, 'closingDay': 5, 'dueDay': 12, 'walletId': 'w1'}]
data['cardPurchases'] = [
    {'id': 'p1', 'cardId': 'c1', 'desc': 'Tênis', 'amount': 600, 'installments': 3, 'date': ago(0), 'category': 'Roupas'},
    {'id': 'p2', 'cardId': 'c1', 'desc': 'Feira', 'amount': 90, 'installments': 1, 'date': ago(0), 'category': 'Mercado'}]
data['cardPayments'] = [{'id': 'cp1', 'cardId': 'c1', 'invoice': ym, 'amount': 333, 'date': ago(0), 'txId': 't9'}]
data['transactions'].append({'id': 't9', 'walletId': 'w1', 'type': 'gasto', 'amount': 333, 'date': ago(0), 'category': 'Cartão de crédito', 'auto': 'card:cp1'})

fails = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_last_export','%s');localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com'}));sessionStorage.setItem('s','1');}" % (json.dumps(json.dumps(data)), T.isoformat()))
    route_fonts(ctx)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('dialog', lambda d: (errs.append('native dialog: ' + d.message), d.dismiss()))
    page.goto(URL); page.wait_for_timeout(700)
    stored = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))

    # 1. indicador deslizante
    ind = lambda sel: page.evaluate("""s => { const h = document.querySelector(s), i = h.querySelector(':scope > .seg-ind'), a = h.querySelector(':scope > button.active');
        if(!i || !a) return null; const ir = i.getBoundingClientRect(), ar = a.getBoundingClientRect(), ic = a.querySelector('.i');
        const tr = (h.id === 'pageTabs' && innerWidth <= 640 && ic) ? ic.getBoundingClientRect() : ar;
        return {dx: Math.abs(ir.left - tr.left), dw: Math.abs(ir.width - tr.width), op: getComputedStyle(i).opacity, ready: h.classList.contains('seg-ready')}; }""", sel)
    r = ind('#pageTabs')
    check(r and r['dx'] < 1.5 and r['dw'] < 1.5 and r['op'] == '1' and r['ready'], 'menu de baixo: indicador em cima do item ativo %s' % r)
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(80)
    mid = ind('#pageTabs')
    page.wait_for_timeout(500)
    r = ind('#pageTabs')
    check(mid and mid['dx'] > 3, 'indicador anda (no meio da animação ainda não chegou: %s)' % (mid and round(mid['dx'], 1)))
    check(r and r['dx'] < 1.5, 'indicador chega em Pessoas %s' % r)
    page.click('#filters button[data-f="atrasados"]'); page.wait_for_timeout(500)
    r = ind('#filters')
    check(r and r['dx'] < 1.5 and r['dw'] < 1.5, 'filtros: indicador em Atrasados %s' % r)
    page.click('#filters button[data-f="pendentes"]'); page.wait_for_timeout(450)
    page.click('#kindToggle button[data-k="payable"]'); page.wait_for_timeout(450)
    r = ind('#kindToggle')
    check(r and r['dx'] < 1.5, 'Me devem / Eu devo: indicador acompanha')
    page.click('#kindToggle button[data-k="receivable"]'); page.wait_for_timeout(450)

    # 2. abas do card
    page.locator('#list .card').first.locator('.card-head .avatar').click(); page.wait_for_timeout(300)
    if not page.locator('#list .card.open').count():
        page.locator('#list .card').first.locator('.card-head .avatar').click(); page.wait_for_timeout(300)
    page.locator('#list .card.open .ct-btn[data-tab="parcelas"]').click(); page.wait_for_timeout(500)
    r = ind('#list .card.open .card-tabs')
    check(r and r['dx'] < 1.5 and r['dw'] < 1.5, 'abas do card: indicador em Parcelas %s' % r)
    page.locator('#list .card.open .ct-btn[data-tab="resumo"]').click(); page.wait_for_timeout(300)

    # 3. barra de atrasados + cobrar todos
    lb = N(page.inner_text('#lateBar'))
    check('atrasad' in lb and 'Cobrar todos' in lb, 'barra de atrasados em Pessoas: %s' % lb)
    page.click('#lateBar [data-nudge-all]'); page.wait_for_timeout(300)
    rows = page.locator('#adBody .nudge-row')
    check(rows.count() >= 3, 'lista de cobrança com %d pessoas' % rows.count())
    vin = page.locator('#adBody .nudge-row', has_text='Vinicius')
    href = vin.locator('a.btn-whats').get_attribute('href') if vin.count() else ''
    check(href.startswith('https://wa.me/5511988887777?text=') and 'joao%40pix.com' in href, 'Vinicius: link do WhatsApp com mensagem e PIX')
    lar = page.locator('#adBody .nudge-row', has_text='Larissa')
    check(lar.locator('[data-copy]').count() == 1, 'sem telefone: botão Copiar')
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    lar.locator('[data-copy]').click(); page.wait_for_timeout(300)
    check('done' in (lar.get_attribute('class') or ''), 'cobrado marca a linha')
    check('larissa mota' in stored().get('nudges', {}), 'data da cobrança salva')
    check('cobrado hoje' in N(lar.inner_text()), 'mostra "cobrado hoje"')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(200)
    check('cobrada hoje' in N(page.inner_text('#lateBar')), 'barra mostra quantas já foram cobradas hoje')

    # 4. lembrete do dia
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(300)
    tb = N(page.inner_text('#todayBanner'))
    check('atrasado' in tb, 'lembrete do dia no Início: %s' % tb)
    page.click('#todayBanner [data-rb="close"]'); page.wait_for_timeout(200)
    check(page.inner_text('#todayBanner').strip() == '' and page.evaluate("localStorage.getItem('barnabank_remind_day')") == T.isoformat(), 'dispensar esconde até amanhã')
    check(page.locator('#startCard .start-card').count() == 0, 'começo rápido não aparece para quem já usa o app')

    # 5. relatórios: cartão nas categorias, sem contar a fatura duas vezes
    page.click('#pageTabs button[data-page="relatorios"]'); page.wait_for_timeout(300)
    cats = N(page.inner_text('#relOutCategories'))
    check('Roupas' in cats and 'R$ 200,00' in cats, 'parcela do tênis (R$ 200) em Roupas')
    check('Cartão de crédito' not in cats, 'pagamento da fatura não aparece como gasto de novo')
    check(page.locator('#relOutCategories .cbr-card').count() >= 2, 'selo de cartão nas categorias')
    out_expected = 420.5 + 1100 + 64 + 189.9 + 200 + 90 if T.day >= 6 else None
    mix = page.locator('#relMix svg rect').count()
    check(mix >= 1, 'gráfico de 6 meses desenhado (%d barras)' % mix)
    check('Cartão R$ 290,00' in N(page.inner_text('#relMix')), 'legenda: cartão R$ 290 no mês')
    check(page.locator('#relCardsWrap').is_visible() and 'Roxinho' in page.inner_text('#relCards'), 'faturas do mês por cartão')

    # 6. orçamento
    check('Defina um teto' in page.inner_text('#relBudget'), 'orçamento vazio explica o que fazer')
    page.click('#btnBudgets'); page.wait_for_timeout(300)
    inp = page.locator('#adBody [data-cat="Mercado"]')
    check(inp.count() == 1, 'Mercado aparece entre as categorias')
    inp.fill('500')
    page.fill('#bdNewCat', 'Lazer'); page.fill('#bdNewVal', '150')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    bud = N(page.inner_text('#relBudget'))
    check('Mercado' in bud and 'de R$ 500,00' in bud and 'Lazer' in bud, 'orçamento listado: %s' % bud[:120])
    check(stored().get('budgets', {}).get('Mercado') == 500, 'orçamento salvo')
    merc_ok = ('R$ 510,50' in bud) if T.day >= 6 else True
    check(merc_ok, 'Mercado soma conta + cartão (420,50 + 90)')
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(300)
    check('Orçamento de' in page.inner_text('#dashPlan'), 'orçamento resumido no Início')

    # 7. metas
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(300)
    check('Nenhuma meta' in page.inner_text('#goalList'), 'metas vazias explicam')
    page.click('#btnNewGoal'); page.wait_for_timeout(300)
    page.fill('#glName', 'Viagem'); page.fill('#glTarget', '2000'); page.fill('#glStart', '300')
    d = (T + datetime.timedelta(days=150)).isoformat()
    page.fill('#glDeadline', d)
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    gc = page.locator('.goal-card', has_text='Viagem')
    check(gc.count() == 1 and 'R$ 300,00 de R$ 2.000,00' in N(gc.inner_text()), 'meta criada com saldo inicial')
    check('/mês' in gc.inner_text(), 'mostra quanto guardar por mês: %s' % N(gc.locator('.gc-sub').inner_text()))
    gc.locator('[data-gl="add"]').click(); page.wait_for_timeout(200)
    page.fill('#gmAmount', '200'); page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    check('R$ 500,00 de' in N(gc.inner_text()) and '25%' in gc.inner_text(), 'guardar soma na meta')
    gc.locator('[data-gl="take"]').click(); page.wait_for_timeout(200)
    page.fill('#gmAmount', '9999'); page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(200)
    check('Só tem' in page.inner_text('#adErr'), 'não deixa retirar mais do que tem')
    page.click('#adActions [data-ad="cancel"]'); page.wait_for_timeout(200)
    page.click('#btnNewGoal'); page.wait_for_timeout(200)
    page.fill('#glName', 'Reserva'); page.fill('#glTarget', '5000'); page.select_option('#glWallet', 'w1')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    rv = page.locator('.goal-card', has_text='Reserva')
    check(rv.count() == 1 and 'saldo de Nubank' in rv.inner_text() and rv.locator('[data-gl="add"]').count() == 0, 'meta ligada à carteira usa o saldo dela')
    check(len(stored().get('goals', [])) == 2, 'metas salvas')
    rv.locator('[data-gl="edit"]').click(); page.wait_for_timeout(200)
    page.click('#glDelete'); page.wait_for_timeout(300)
    check(page.locator('.goal-card', has_text='Reserva').count() == 0, 'excluir meta')
    page.locator('#undoStack .undo-toast', has_text='Reserva').locator('button').click(); page.wait_for_timeout(300)
    check(page.locator('.goal-card', has_text='Reserva').count() == 1, 'desfazer exclusão da meta')

    # 8. busca geral
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(200)
    page.keyboard.press('/'); page.wait_for_timeout(200)
    check(page.locator('#searchOverlay.show').count() == 1, 'tecla / abre a busca')
    page.keyboard.type('tenis'); page.wait_for_timeout(200)
    res = N(page.inner_text('#gsResults'))
    check('Tênis' in res and 'CARTÃO' in res.upper(), 'acha a compra "Tênis" sem acento: %s' % res[:80])
    page.keyboard.press('Enter'); page.wait_for_timeout(400)
    check(page.evaluate('document.getElementById("pageContas").style.display') == '', 'Enter leva para Contas')
    page.click('#btnSearch'); page.wait_for_timeout(200)
    page.fill('#gsInput', 'lariss'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(400)
    check('Larissa Mota' in page.inner_text('#personContent'), 'resultado de pessoa abre a página dela')
    page.click('#btnSearch'); page.fill('#gsInput', '75'); page.wait_for_timeout(200)
    check(page.locator('#gsResults .gs-item').count() >= 3, 'busca por valor (75)')
    page.fill('#gsInput', 'internet'); page.wait_for_timeout(200)
    check('Internet' in page.inner_text('#gsResults'), 'acha lançamento por categoria')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    check(page.locator('#searchOverlay.show').count() == 0, 'Esc fecha a busca')

    # 9. imagem do grupo
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    page.locator('.gcard .gcard-head .name').first.click(); page.wait_for_timeout(300)
    page.click('.gcard [data-gact="image"]'); page.wait_for_timeout(1200)
    w = page.evaluate("(() => { const i = document.querySelector('#adBody .gi-prev'); return i ? [i.naturalWidth, i.naturalHeight, i.src.slice(0, 22)] : null; })()")
    check(w and w[0] == 1080 and w[1] > 900 and w[2] == 'data:image/png;base64,', 'imagem do grupo gerada %s' % w)
    with page.expect_download() as dl:
        page.click('#adActions [data-ad="ok"]')
    path = SP + '/v5_grupo.png'
    dl.value.save_as(path)
    check(dl.value.suggested_filename == 'grupo-churrasco-de-sabado.png', 'baixa a imagem: %s' % dl.value.suggested_filename)

    check(not errs, 'sem erros de JavaScript %s' % errs)
    ctx.close()

    # 10. boas-vindas num aparelho novo
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    route_fonts(ctx)
    page = ctx.new_page()
    errs2 = []
    page.on('pageerror', lambda e: errs2.append(str(e)))
    page.goto(URL); page.wait_for_timeout(500)
    check(page.locator('#welcomeOverlay.show').count() == 1, 'boas-vindas aparece com o app vazio')
    page.click('#welcomeOverlay [data-wl="wallet"]'); page.wait_for_timeout(300)
    check(page.locator('#walletModalOverlay.show, .overlay.show').count() >= 1 and page.locator('#welcomeOverlay.show').count() == 0, 'escolher "Criar carteira" abre o formulário')
    page.keyboard.press('Escape'); page.wait_for_timeout(100)
    page.reload(); page.wait_for_timeout(400)
    check(page.locator('#welcomeOverlay.show').count() == 0, 'boas-vindas não volta depois')
    sc = N(page.inner_text('#startCard'))
    check('Comece por aqui' in sc and '0/5' in sc, 'começo rápido no Início: %s' % sc[:60])
    page.click('#startCard [data-sc="hide"]'); page.wait_for_timeout(200)
    check(page.inner_text('#startCard').strip() == '', 'dá para esconder o começo rápido')
    check(not errs2, 'sem erros de JavaScript (app vazio) %s' % errs2)
    b.close()

print('\n%d falha(s)' % len(fails))
