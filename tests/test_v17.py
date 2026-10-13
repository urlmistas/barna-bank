"""Testes v17: layout de Carteiras, Contas e Relatórios (topo enxuto, painel de números, abas no celular, botão flutuante por aba)."""
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
data['cards'] = [{'id': 'c1', 'name': 'Roxinho', 'limit': 3000, 'closingDay': 5, 'dueDay': 12, 'walletId': 'w1'}]
data['cardPurchases'] = [{'id': 'p1', 'cardId': 'c1', 'desc': 'Fone', 'amount': 300, 'installments': 3, 'date': ago(20), 'category': 'Eletrônicos'}]
data['cardPayments'] = []
data['bills'] = [{'id': 'b1', 'name': 'Internet', 'amount': 99.9, 'dueDay': 15, 'category': 'Internet', 'walletId': 'w1', 'paidMonths': {}}]
data['goals'] = [{'id': 'g1', 'name': 'Viagem', 'target': 3000, 'deadline': '2027-03-01', 'adds': []}]

def go(page, pg):
    page.evaluate("document.querySelector('#pageTabs [data-page=\"%s\"]').click()" % pg); page.wait_for_timeout(400)
vis = lambda page, sel: page.locator(sel).first.is_visible()

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------- celular
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);}" % json.dumps(json.dumps(data)))
    route_fonts(ctx, sheet=True)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(1200)
    check(vis(page, '.data-panel'), 'Início: "Seus dados" aparece')
    check(vis(page, '#btnNew') and not vis(page, '#fabCtx'), 'Início: botão Nova dívida')

    go(page, 'carteiras')
    check(page.inner_text('.pg-title').strip() == 'Carteiras' and re.search(r'Total R\$ [\d.]+,\d\d', N(page.inner_text('#pageCarteiras .pg-sub'))) and '3 carteiras' in page.inner_text('#pageCarteiras .pg-sub'), 'Carteiras: topo com o total: %s' % N(page.inner_text('#pageCarteiras .pg-head')))
    check(not vis(page, '.data-panel'), 'Carteiras: sem "Seus dados"')
    check(vis(page, '#walletList') and not vis(page, '#recList') and not vis(page, '#goalList'), 'Carteiras: aba Carteiras mostra só as carteiras')
    check(vis(page, '#fabCtx') and not vis(page, '#btnNew') and page.inner_text('#fabCtxLabel') == 'Lançamento', 'Carteiras: botão flutuante vira Lançamento')
    page.click('#fabCtx'); page.wait_for_timeout(300)
    check(page.locator('#txOverlay.show, .overlay.show').count() >= 1, 'Lançamento abre o formulário')
    page.click('#btnTxCancel'); page.wait_for_timeout(300)
    page.click('.pg-seg[data-for="carteiras"] [data-sec="goal"]'); page.wait_for_timeout(300)
    check(vis(page, '#goalList') and not vis(page, '#walletList') and 'Viagem' in page.inner_text('#goalList'), 'aba Metas')
    check(page.inner_text('#fabCtxLabel') == 'Meta', 'botão flutuante vira Meta')
    page.screenshot(path=SP + '/v17_m_carteiras_metas.png')

    go(page, 'contas')
    check(vis(page, '.ct-stats.sum-strip') and 'R$' in page.inner_text('#ctToPay'), 'Contas: números num painel só')
    check(vis(page, '#billList') and not vis(page, '#calCard') and not vis(page, '#cardList'), 'Contas: começa nas contas fixas')
    check(page.inner_text('#fabCtxLabel') == 'Nova conta', 'Contas: botão flutuante Nova conta')
    page.click('.pg-seg[data-for="contas"] [data-sec="cal"]'); page.wait_for_timeout(300)
    check(vis(page, '#calCard') and not vis(page, '#billList'), 'aba Calendário')
    page.click('.pg-seg[data-for="contas"] [data-sec="cards"]'); page.wait_for_timeout(300)
    check(vis(page, '#cardList') and 'Roxinho' in page.inner_text('#cardList') and page.inner_text('#fabCtxLabel') == 'Novo cartão', 'aba Cartões')
    page.screenshot(path=SP + '/v17_m_contas_cartoes.png')

    go(page, 'relatorios')
    check(not vis(page, '#btnNew') and not vis(page, '#fabCtx'), 'Relatórios: sem botão flutuante')
    check(vis(page, '#dashChartHolder') and not vis(page, '#relOutCategories'), 'Relatórios: Visão geral primeiro')
    page.click('.pg-seg[data-for="relatorios"] [data-sec="cat"]'); page.wait_for_timeout(300)
    check(vis(page, '#relOutCategories') and vis(page, '#relBudget') and not vis(page, '#dashChartHolder'), 'aba Categorias')
    page.click('.pg-seg[data-for="relatorios"] [data-sec="fixos"]'); page.wait_for_timeout(300)
    check(vis(page, '#relMix') and vis(page, '#relCards'), 'aba Fixos e cartão (com as faturas)')
    page.screenshot(path=SP + '/v17_m_relatorios.png')

    # a aba escolhida fica guardada
    page.reload(); page.wait_for_timeout(1200)
    go(page, 'contas')
    check(vis(page, '#cardList') and not vis(page, '#billList'), 'lembra a aba escolhida depois de recarregar')
    check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), 'sem rolagem pro lado')
    ctx.close()

    # ---------------- PC: tudo de uma vez, sem abas
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);}" % json.dumps(json.dumps(data)))
    route_fonts(ctx, sheet=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(1200)
    go(page, 'carteiras')
    check(not vis(page, '.pg-seg[data-for="carteiras"]') and vis(page, '#walletList') and vis(page, '#recList') and vis(page, '#goalList'), 'PC: Carteiras mostra tudo, sem abas')
    check(vis(page, '#btnNewTransaction') and not vis(page, '#fabCtx'), 'PC: Lançamento no topo')
    go(page, 'contas')
    check(vis(page, '#calCard') and vis(page, '#billList') and vis(page, '#cardList'), 'PC: Contas mostra tudo')
    go(page, 'relatorios')
    check(vis(page, '#dashChartHolder') and vis(page, '#relOutCategories') and vis(page, '#relMix'), 'PC: Relatórios mostra tudo')
    page.screenshot(path=SP + '/v17_pc_relatorios.png', full_page=True)
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
