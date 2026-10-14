"""Testes v18: Pessoas no layout aprovado (abas com total, filtros em pílula, menu ⋯, "Cobrar todos" em Atrasados)."""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, os
SP = OUT
exec(open(os.path.join(HERE, 'test_v5.py')).read().split('fails = []')[0])
from playwright.sync_api import sync_playwright
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
vis = lambda page, sel: page.locator(sel).first.is_visible()

with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h, tag) in [(1280, 900, 'pc'), (390, 844, 'm')]:
        ctx = b.new_context(viewport={'width': w, 'height': h})
        ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);}" % json.dumps(json.dumps(data)))
        route_fonts(ctx, sheet=True)
        page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(URL); page.wait_for_timeout(1200)
        page.evaluate("document.querySelector('#pageTabs [data-page=\"pessoas\"]').click()"); page.wait_for_timeout(500)
        # abas com o total
        rec, pay = N(page.inner_text('#ktAmtRec')), N(page.inner_text('#ktAmtPay'))
        check(re.match(r'R\$ [\d.]+,\d\d$', rec) and re.match(r'R\$ [\d.]+,\d\d$', pay), '%s: abas mostram o total (Me devem %s · Eu devo %s)' % (tag, rec, pay))
        # o que saiu do topo
        check(not vis(page, '#pessoasResumo') and not vis(page, '#ppMenu') and not vis(page, '#btnBoard'), '%s: topo limpo (resumo e ferramentas no ⋯)' % tag)
        check(not vis(page, '#lateBar .late-bar'), '%s: "Cobrar todos" escondido em Em aberto' % tag)
        late = page.inner_text('#lateCount').strip()
        check(late.isdigit() and int(late) > 0, '%s: pílula Atrasados com a contagem (%s)' % (tag, late))
        # pílula Atrasados mostra o "Cobrar todos"
        page.click('#filters [data-f="atrasados"]'); page.wait_for_timeout(300)
        check(vis(page, '#lateBar [data-nudge-all]'), '%s: em Atrasados aparece o Cobrar todos' % tag)
        page.click('#filters [data-f="pendentes"]'); page.wait_for_timeout(300)
        # menu ⋯
        page.click('#ppMore'); page.wait_for_timeout(200)
        check(vis(page, '#ppMenu') and vis(page, '#sortSel') and vis(page, '#btnBoard') and vis(page, '#btnSplit') and not vis(page, '#btnGroup'), '%s: ⋯ abre ordenar, resumo, placar e dividir (agrupar saiu: a lista já é por pessoa)' % tag)
        page.screenshot(path=SP + '/v18_%s_menu.png' % tag)
        page.click('#btnResumo'); page.wait_for_timeout(400)
        check(vis(page, '#pessoasResumo') and not vis(page, '#ppMenu'), '%s: Resumo e gráfico abre o resumo e fecha o menu' % tag)
        page.click('#ppMore'); page.wait_for_timeout(150)
        page.mouse.click(5, h - 300); page.wait_for_timeout(200)
        check(not vis(page, '#ppMenu'), '%s: clicar fora fecha o menu' % tag)
        # grupo fechado mostra só o essencial
        # v20: uma linha por pessoa (e por grupo)
        names = [N(x) for x in page.locator('#peopleList .prow .pr-info b').all_inner_texts()]
        check(len(names) == len(set(names)) and len(names) >= 3, '%s: lista com uma linha por pessoa: %s' % (tag, names))
        # grupo: no celular abre embaixo da linha, no PC no painel
        if page.locator('#peopleList .prow.is-group').count():
            page.locator('#peopleList .prow.is-group').first.click(); page.wait_for_timeout(400)
            where = '#psDetail .gcard.open' if tag == 'pc' else '#peopleList .gcard.open'
            check(vis(page, where) and page.locator('.gcard.open').count() == 1, '%s: grupo abre (%s), sem card duplicado' % (tag, where))
        # pessoa no PC: abre no painel com o topo e a dívida
        if tag == 'pc':
            page.locator('#peopleList .prow:not(.is-group)').first.click(); page.wait_for_timeout(400)
            check(vis(page, '#psDetail .person-top') and page.locator('#psDetail .card.open').count() == 1, 'pc: pessoa abre no painel com a dívida aberta')
        # trocar pra Eu devo
        page.click('#kindToggle [data-k="payable"]'); page.wait_for_timeout(300)
        check('Cartão Nubank' in page.inner_text('#peopleList'), '%s: Eu devo lista as minhas dívidas' % tag)
        check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), '%s: sem rolagem pro lado' % tag)
        page.screenshot(path=SP + '/v18_%s_pessoas.png' % tag)
        check(not errs, '%s: sem erros de JS %s' % (tag, errs))
        ctx.close()
    b.close()
print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
