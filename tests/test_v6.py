"""Testes v6 (app + bot). Precisa do botsim/server.mjs rodando em :8787. Uso: python3 test_v6.py"""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, datetime, urllib.request, base64, struct, zlib, os
SP = OUT
src = open(os.path.join(HERE, 'test_v5.py')).read()
exec(src.split('fails = []')[0])
from playwright.sync_api import sync_playwright

BOT = 'http://localhost:8787'
KEY = 'chave-de-teste-1234567890'
fails = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
def http(method, path, body=None, headers=None):
    req = urllib.request.Request(BOT + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
kv = lambda: json.loads(http('GET', '/__kv')[1])
sent = lambda: json.loads(http('GET', '/__sent')[1])
inbox = lambda: json.loads(kv().get('inbox', '[]'))
hook = json.loads(http('GET', '/setup?key=' + KEY)[1]) and [s for s in sent() if s['method'] == 'setWebhook'][-1]['body']
HOOK_PATH, HOOK_SECRET = '/tg/' + hook['url'].rsplit('/', 1)[1], hook['secret_token']
upd = [0]
def tgmsg(text, chat=999):
    upd[0] += 1
    return http('POST', HOOK_PATH, {'update_id': upd[0], 'message': {'message_id': upd[0], 'chat': {'id': chat}, 'text': text}},
                {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HOOK_SECRET})
last_reply = lambda: [s for s in sent() if s['method'] in ('sendMessage', 'editMessageText')][-1]['body']['text']

# ---------------- bot
check(http('GET', '/api/state')[0] == 401, 'API sem chave é recusada')
check(http('GET', '/setup?key=errada')[0] == 401, 'setup com chave errada é recusado')
check(http('POST', HOOK_PATH, {'message': {'chat': {'id': 1}, 'text': 'oi'}}, {'Content-Type': 'application/json'})[0] == 403, 'webhook sem o segredo do Telegram é recusado')
tgmsg('oi', chat=999)
check('/start' in last_reply(), 'antes do /start, pede para ativar')
tgmsg('/start', chat=999)
check('só seu' in last_reply() and kv().get('owner') == '999', '/start define o dono')
tgmsg('Vini me deve 50', chat=111)
check('privado' in last_reply() and not inbox(), 'outra pessoa não consegue usar o bot')

cases = [
    ('Vini me deve 50', dict(type='debt', kind='receivable', name='Vini', amount=50)),
    ('emprestei 300 pra larissa mota em 3x', dict(type='debt', kind='receivable', name='Larissa Mota', amount=300, installments=3)),
    ('devo 80 pro Carlos', dict(type='debt', kind='payable', name='Carlos', amount=80)),
    ('recebi 20 do Vinicius', dict(type='pay', kind='receivable', name='Vinicius', amount=20)),
    ('gastei 35,90 mercado no nubank', dict(type='tx', kind='gasto', amount=35.9, category='mercado', wallet='nubank')),
    ('ganhei 1.200 freela', dict(type='tx', kind='entrada', amount=1200, category='freela')),
    ('/deve Bia 45', dict(type='debt', kind='receivable', name='Bia', amount=45)),
    ('Caio pagou 75', dict(type='pay', kind='receivable', name='Caio', amount=75)),
]
for text, exp in cases:
    tgmsg(text)
    op = inbox()[-1]
    ok = all(op.get(k) == v for k, v in exp.items())
    check(ok and op['text'] == text, 'entende "%s" %s' % (text, '' if ok else '→ ' + json.dumps(op, ensure_ascii=False)))
check('Desfazer' in json.dumps(sent()[-1]['body'], ensure_ascii=False), 'confirmação tem botão Desfazer')
tgmsg('bom dia, tudo bem?')
check('Não entendi' in last_reply() and len(inbox()) == len(cases), 'mensagem sem sentido não vira lançamento')
tgmsg('gastei 10 teste')
op = inbox()[-1]
http('POST', HOOK_PATH, {'update_id': 9999, 'callback_query': {'id': 'cb1', 'data': 'undo:' + op['id'], 'message': {'message_id': 5, 'chat': {'id': 999}}}},
     {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HOOK_SECRET})
check(len(inbox()) == len(cases) and 'Desfeito' in last_reply(), 'Desfazer tira a mensagem da fila')
tgmsg('/pendentes')
check('Vini me deve 50' in last_reply(), '/pendentes lista o que falta entrar')
tgmsg('/resumo')
check('Ainda não tenho dados' in last_reply(), '/resumo sem dados avisa para abrir o app')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    cloud = json.dumps({'url': BOT, 'key': KEY})
    SEED_JS = "localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_last_export','%s');localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com'}));localStorage.setItem('barnabank_welcomed','1');localStorage.setItem('barnabank_cloud', %s);" % (json.dumps(json.dumps(data)), T.isoformat(), json.dumps(cloud))
    route_fonts(ctx)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('dialog', lambda d: (errs.append('native dialog: ' + d.message), d.dismiss()))
    page.goto(URL); page.evaluate(SEED_JS); page.goto(URL); page.wait_for_timeout(2500)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))

    # ---------------- sincronização
    s = st()
    names = [d['name'] for d in s['debts']]
    check('Vini' in names and 'Carlos' in names and 'Bia Lima' in names, 'dívidas do Telegram entraram (Bia virou "Bia Lima")')
    lar = [d for d in s['debts'] if d['name'] == 'Larissa Mota' and d['principal'] == 300]
    check(lar and lar[0]['installments'] == 3, 'empréstimo em 3x para Larissa')
    d1 = [d for d in s['debts'] if d['id'] == 'd1'][0]
    check(any(p_['amount'] == 20 and 'Telegram' in p_.get('note', '') for p_ in d1['payments']), '"recebi 20 do Vinicius" virou pagamento do Vinicius Prado')
    caio = [d for d in s['debts'] if d['id'] == 'g1c'][0]
    check(sum(p_['amount'] for p_ in caio['payments']) == 75, '"Caio pagou 75" quitou a parte do Caio no grupo')
    tx = [t for t in s['transactions'] if 'Telegram' in t.get('note', '')]
    check(any(t['amount'] == 35.9 and t['category'] == 'Mercado' and t['walletId'] == 'w1' for t in tx), 'gasto no Nubank, categoria Mercado (já existente)')
    check(any(t['amount'] == 1200 and t['type'] == 'entrada' for t in tx), 'entrada do freela')
    check(inbox() == [], 'fila do bot esvaziada depois de aplicar')
    k = kv()
    snap, summ = json.loads(k.get('snapshot', 'null')), json.loads(k.get('summary', 'null'))
    check(snap and len(snap['debts']) == len(s['debts']) and 'receipts' not in snap, 'nuvem recebeu os dados (sem fotos)')
    check(summ and summ['balance'] is not None and summ['late'], 'nuvem recebeu o resumo para o bot')
    tgmsg('/resumo')
    r = last_reply()
    check('Saldo nas carteiras' in r and 'A receber' in r and 'Previsão' in r, '/resumo responde com os dados do app')
    tgmsg('/atrasados')
    check('Larissa Mota' in last_reply() and 'joao@pix.com' in last_reply(), '/atrasados lista e mostra o PIX')
    tgmsg('/saldo')
    check('Nubank' in last_reply(), '/saldo')
    http('GET', '/__cron')
    check('Bom dia' in last_reply() and 'Atrasado' in last_reply(), 'lembrete diário das 9h')
    tgmsg('recebi 15 da larissa')
    check(inbox()[-1]['type'] == 'pay', 'com o resumo, "recebi 15 da larissa" é pagamento (ela está na lista)')
    tgmsg('recebi 3200 de salário')
    check(inbox()[-1]['type'] == 'tx' and inbox()[-1]['kind'] == 'entrada', '"recebi 3200 de salário" vira entrada')
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_timeout(1500)
    check(inbox() == [], 'ao voltar para o app, pega as novas mensagens')
    page.wait_for_timeout(3500)
    pushed = json.loads(kv()['snapshot'])
    check(len(pushed['transactions']) == len(st()['transactions']), 'mudanças locais sobem sozinhas para a nuvem')

    # ---------------- 5. só uma parte (Esta semana)
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(300)
    row = page.locator('#weekList .wk-row', has_text='Larissa Mota').first
    check(row.locator('.wk-part').count() == 1, 'botão "só uma parte" no Esta semana')
    row.locator('.wk-part').click(); page.wait_for_timeout(200)
    page.fill('#ppAmount', '9999'); page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(150)
    check('mais do que o total' in page.inner_text('#adErr'), 'não deixa passar do total em aberto')
    page.fill('#ppAmount', '25'); page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    d2 = [d for d in st()['debts'] if d['id'] == 'd2'][0]
    check(d2['payments'][-1]['amount'] == 25 and d2['payments'][-1]['mode'] == 'fifo', 'parcial registrado (abate o mais antigo)')
    check('faltam' in N(page.inner_text('#undoStack')), 'aviso mostra quanto falta')

    # ---------------- 9. previsão
    page.click('#dashForecast .fc-more summary'); page.wait_for_timeout(150)
    fc = N(page.inner_text('#dashForecast'))
    check('Previsão de' in fc and 'terminar o mês' in fc and 'Saldo agora' in fc, 'previsão do mês no Início')

    # ---------------- 6. recorrentes
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(300)
    check('Nenhum recorrente' in page.inner_text('#recList'), 'recorrentes vazios explicam')
    page.click('#btnNewRec'); page.wait_for_timeout(200)
    page.fill('#rcAmount', '21,90'); page.fill('#rcCat', 'Assinaturas'); page.fill('#rcNote', 'Spotify'); page.fill('#rcDay', '1')
    page.fill('#rcStart', datetime.date(T.year if T.month > 2 else T.year - 1, (T.month - 2 - 1) % 12 + 1, 1).isoformat()[:7])
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    sp_tx = [t for t in st()['transactions'] if t.get('auto', '').startswith('rec:')]
    check(len(sp_tx) == 3 and all(t['amount'] == 21.9 for t in sp_tx), 'recorrente lança os meses que já passaram (3 meses)')
    check('Spotify' in page.inner_text('#recList'), 'recorrente listado')
    _b = st(); print('DBG before', len(_b.get('recurring', [])), sum(1 for t in _b['transactions'] if t.get('auto','').startswith('rec:')), page.evaluate("localStorage.getItem('__seeded')"))
    _logs = []
    page.on('console', lambda m: _logs.append(m.text))
    page.reload(); page.wait_for_timeout(1200)
    _a = st(); print('DBG after', len(_a.get('recurring', [])), len(_a['transactions']), len(_b['transactions']), _logs[:5])
    rc = [t for t in st()['transactions'] if t.get('auto', '').startswith('rec:')]
    check(len(rc) == 3, 'abrir de novo não duplica %s' % [(t['date'], t['auto']) for t in rc])
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(300)
    page.click('#btnNewTransaction'); page.wait_for_timeout(200)
    page.click('#txTypeToggle button[data-t="gasto"]')
    page.fill('#txAmount', '50'); page.fill('#txCategory', 'Academia'); page.check('#txRepeat')
    page.click('#btnTxSave'); page.wait_for_timeout(300)
    rec = st()['recurring']
    check(len(rec) == 2 and any(r_['category'] == 'Academia' and r_['day'] == T.day for r_ in rec), '"Repetir todo mês" no lançamento cria o recorrente')
    check(sum(1 for t in st()['transactions'] if t.get('category') == 'Academia') == 1, 'e não duplica o lançamento do mês')

    # ---------------- 7. comprovante
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    card = page.locator('#list .card[data-debt-id="d1"]')
    if 'open' not in (card.get_attribute('class') or ''):
        card.locator('.card-head .avatar').click(); page.wait_for_timeout(300)
    card.locator('.ct-btn[data-tab="historico"]').click(); page.wait_for_timeout(200)
    png = os.path.join(SP, 'v6_rcpt_test.png')
    def mkpng(w, h):
        raw = b''.join(b'\x00' + bytes([200, 120, 40] * w) for _ in range(h))
        chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(png, 'wb').write(mkpng(1600, 900))
    with page.expect_file_chooser() as fc_:
        card.locator('.hr-rcpt').first.click()
    fc_.value.set_files(png); page.wait_for_timeout(800)
    s = st()
    rid = [p_ for p_ in [d for d in s['debts'] if d['id'] == 'd1'][0]['payments'] if p_.get('receiptId')]
    check(len(rid) == 1, 'comprovante anexado ao pagamento')
    card = page.locator('#list .card[data-debt-id="d1"]')
    card.locator('.hr-rcpt.has').first.click(); page.wait_for_timeout(300)
    w = page.evaluate("(() => { const i = document.querySelector('#adBody .rc-prev'); return i ? [i.naturalWidth, i.src.slice(0, 23)] : null; })()")
    check(w and w[0] == 1200 and w[1] == 'data:image/jpeg;base64,', 'comprovante reduzido para 1200px em JPEG %s' % w)
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(200)
    page.reload(); page.wait_for_timeout(900)
    check(page.evaluate("Object.keys(JSON.parse(document.getElementById('seed-data').textContent || '{}')).length >= 0") is not None, 'recarregou')
    with page.expect_download() as dl:
        page.click('#btnExportMenuToggle'); page.click('#btnExportJson')
    bk = json.loads(open(dl.value.path()).read())
    check(rid[0]['receiptId'] in bk.get('receipts', {}), 'comprovante continua salvo depois de recarregar e vai no backup')
    check(len(bk.get('recurring', [])) == 2, 'recorrentes vão no backup')

    # ---------------- 8. etiquetas e pontualidade
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    page.click('#btnSearch'); page.fill('#gsInput', 'larissa'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(400)
    rel = N(page.inner_text('#personContent .person-extra'))
    check('em dia' in rel or 'atrasa' in rel, 'pontualidade na página da pessoa: %s' % rel[:80])
    page.click('#personTagsEdit'); page.wait_for_timeout(200)
    page.click('#tagPick [data-tag="Atrasa"]'); page.fill('#tagNew', 'Vizinha'); page.fill('#tagNotes', 'Recebe dia 5')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    pe = N(page.inner_text('#personContent .person-extra'))
    check('Atrasa' in pe and 'Vizinha' in pe and 'Recebe dia 5' in pe, 'etiquetas e notas salvas')
    c = st()['contacts'].get('larissa mota', {})
    check(c.get('tags') == ['Atrasa', 'Vizinha'], 'etiquetas no armazenamento')
    page.click('#btnSearch'); page.fill('#gsInput', 'vizinha'); page.wait_for_timeout(200)
    check('Larissa' in page.inner_text('#gsResults'), 'busca acha pela etiqueta')
    page.keyboard.press('Escape')

    # ---------------- 11. calendário
    page.click('#pageTabs button[data-page="contas"]'); page.wait_for_timeout(400)
    check(page.locator('#calCard .cal-day').count() >= 28, 'calendário do mês')
    check(page.locator('#calCard .cal-day.today.sel').count() == 1, 'hoje vem selecionado')
    page.locator('#calCard .cal-day[data-day="%s-01"]' % T.isoformat()[:7]).click(); page.wait_for_timeout(200)
    check('Spotify' in page.inner_text('#calList'), 'dia 1 mostra o recorrente')
    has_days = page.locator('#calCard .cal-day.has').count()
    check(has_days >= 3, 'dias com vencimentos marcados (%d)' % has_days)

    # ---------------- 10. resumo do mês
    page.click('#pageTabs button[data-page="relatorios"]'); page.wait_for_timeout(300)
    page.click('#btnMonthImage'); page.wait_for_timeout(1500)
    w = page.evaluate("(() => { const i = document.querySelector('#adBody .gi-prev'); return i ? [i.naturalWidth, i.naturalHeight] : null; })()")
    check(w and w[0] == 1080 and w[1] > 1200, 'imagem do resumo do mês %s' % w)
    with page.expect_download() as dl:
        page.click('#adActions [data-ad="ok"]')
    dl.value.save_as(SP + '/v6_mes.png')
    check(dl.value.suggested_filename.startswith('barnabank-'), 'baixa o resumo')

    check(not errs, 'sem erros de JavaScript %s' % errs)
    ctx.close()

    # ---------------- aparelho novo: puxa da nuvem
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    NEW_JS = "localStorage.setItem('barnabank_cloud', %s);" % json.dumps(cloud)
    route_fonts(ctx)
    page = ctx.new_page(); errs2 = []
    page.on('pageerror', lambda e: errs2.append(str(e)))
    page.goto(URL); page.evaluate(NEW_JS); page.goto(URL); page.wait_for_timeout(1500)
    check('Usar os dados da nuvem' in page.inner_text('#appDialog'), 'aparelho vazio oferece os dados da nuvem')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(800)
    s2 = json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    check(len(s2['debts']) == len(pushed['debts']) and page.locator('#welcomeOverlay.show').count() == 0, 'dados restaurados no aparelho novo')
    check(not errs2, 'sem erros de JavaScript (aparelho novo) %s' % errs2)
    b.close()

print('\n%d falha(s)' % len(fails))
