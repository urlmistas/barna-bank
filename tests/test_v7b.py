"""Testes v7b: foto pelo Telegram, desfazer depois de aplicado, lembretes, histórico, importar extrato, cabe no mês."""
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
def http(method, path, body=None, headers=None):
    req = urllib.request.Request(BOT + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
kv = lambda: json.loads(http('GET', '/__kv')[1])
sent = lambda: json.loads(http('GET', '/__sent')[1])
http('GET', '/setup?key=' + KEY)
hook = [x for x in sent() if x['method'] == 'setWebhook'][-1]['body']
HP, HS = '/tg/' + hook['url'].rsplit('/', 1)[1], hook['secret_token']
upd = [0]
def tg(text=None, cb=None, photo=False, caption=None, mid=None):
    upd[0] += 1
    u = {'update_id': upd[0]}
    if cb: u['callback_query'] = {'id': 'c%d' % upd[0], 'data': cb, 'message': {'message_id': mid or 1, 'chat': {'id': 999}, 'text': '✅ algo\nEntra no app'}}
    else:
        m = {'message_id': upd[0], 'chat': {'id': 999}}
        if photo: m['photo'] = [{'file_id': 'small', 'width': 90, 'height': 60}, {'file_id': 'big', 'width': 900, 'height': 600, 'file_size': 30000}]; m['caption'] = caption
        else: m['text'] = text
        u['message'] = m
    return http('POST', HP, u, {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HS})
msgs = lambda: [x for x in sent() if x['method'] in ('sendMessage', 'editMessageText')]
last = lambda: msgs()[-1]['body']['text']
inbox = lambda: json.loads(kv().get('inbox', '[]'))
tg('/start')

# ---------------- bot: foto, lembretes, semanal
tg(photo=True, caption=None)
check('legenda' in last(), 'foto sem legenda: pede a legenda')
tg(photo=True, caption='recebi 30 da larissa')
op = inbox()[-1]
check(op['type'] == 'pay' and op.get('photo') is True and 'photo:' + op['id'] in kv(), 'foto com legenda: pagamento + comprovante guardado')
check('Comprovante anexado' in last(), 'confirma o comprovante')
photo_op = op['id']
check(msgs()[-1]['body']['reply_markup']['inline_keyboard'][0][0]['text'] == 'Desfazer', 'botão se chama "Desfazer"')
tg(photo=True, caption='gastei 20 mercado')
check('só vai junto em pagamentos' in last(), 'foto em gasto: avisa que só vale para pagamento')
tg('gastei 15 lanche')
undo_now = inbox()[-1]['id']
tg(cb='undo:' + undo_now)
check(not any(o['id'] == undo_now for o in inbox()) and 'Não vai entrar no app' in last() and '<s>' in last(), 'Desfazer antes do app abrir: some da fila e risca a mensagem')
tg('gastei 99 teste')
undo_later = inbox()[-1]['id']
tg('/lembretes')
check('Diário às 9h' in last() and 'ligado' in last(), '/lembretes mostra o estado')
tg('/lembretes semanal')
check('Resumo de domingo: <b>desligado</b>' in last(), '/lembretes semanal desliga o domingo')
tg('/lembretes liga')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com'}));localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(2500)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))

    # foto virou comprovante
    d2 = [d for d in st()['debts'] if d['id'] == 'd2'][0]
    pay = [x for x in d2['payments'] if x['amount'] == 30]
    check(pay and pay[0].get('receiptId') == 'rc-tg-' + photo_op, 'pagamento do Telegram entrou com o comprovante')
    check(('photo:' + photo_op) not in kv(), 'foto apagada da nuvem depois de entrar no app')
    t99 = [t for t in st()['transactions'] if t['amount'] == 99]
    check(len(t99) == 1, 'gasto de 99 entrou')
    # desfazer depois de aplicado
    tg(cb='undo:' + undo_later)
    check('Já saiu do app' in last(), 'Desfazer depois que entrou: a nuvem já desfaz (%s)' % last()[-60:])
    check(not [t for t in json.loads(kv()['snapshot'])['transactions'] if t['amount'] == 99], 'gasto desfeito nos dados da nuvem')
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_timeout(1500)
    check(not [t for t in st()['transactions'] if t['amount'] == 99], 'app desfez o gasto que veio do Telegram')
    check(json.loads(kv().get('undo', '[]')) == [], 'fila de desfazer zerada')

    # semanal e véspera
    summ = json.loads(kv()['summary'])
    check(summ.get('week') and 'in' in summ['week'] and summ['week']['received'], 'resumo da semana enviado para o bot')
    tg('/semanal')
    check('Sua semana' in last() and 'Quem te pagou' in last() and 'Larissa' in last(), '/semanal: %s' % N(re.sub('<[^>]+>', '', last()))[:120])
    # a nuvem refaz o resumo às 9h com as regras do app: uma conta fixa que vence amanhã entra no aviso
    tom = datetime.date.today() + datetime.timedelta(days=1)
    snap = json.loads(kv()['snapshot'])
    snap['bills'] = (snap.get('bills') or []) + [{'id': 'bnet', 'name': 'Internet', 'amount': 120, 'dueDay': tom.day, 'kind': 'gasto', 'paid': {}}]
    http('PUT', '/api/state', {'snapshot': snap}, {'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    http('GET', '/__cron')
    check('Vence amanhã' in last() and 'Internet' in last(), 'lembrete das 9h avisa o que vence amanhã')

    # ---------------- 10. histórico
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(300)
    page.click('#btnNewTransaction'); page.click('#txTypeToggle button[data-t="gasto"]')
    page.fill('#txAmount', '77'); page.fill('#txCategory', 'Lazer'); page.click('#btnTxSave'); page.wait_for_timeout(1500)
    page.click('#btnHistory2'); page.wait_for_timeout(600)
    h = N(page.inner_text('#adBody'))
    check('Gasto de R$ 77,00' in h or 'Gasto R$ 77,00' in h, 'histórico registra o gasto: %s' % h[:200])
    page.locator('#adBody .hist-row', has_text='77').first.click(); page.wait_for_timeout(300)
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(1500)
    check(not [t for t in st()['transactions'] if t['amount'] == 77], 'voltar no tempo desfaz o gasto')
    page.click('#btnHistory2'); page.wait_for_timeout(600)
    check('Voltou para antes de' in page.inner_text('#adBody'), 'a volta também fica no histórico')
    page.locator('#adBody .hist-row', has_text='Voltou').first.click(); page.wait_for_timeout(300)
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(1500)
    check([t for t in st()['transactions'] if t['amount'] == 77], 'desfazer a volta traz o gasto de novo')

    # ---------------- 12. importar extrato
    ofx = SP + '/extrato.ofx'
    open(ofx, 'w', encoding='latin-1').write('''OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003000000[-3:BRT]<TRNAMT>-45.90<FITID>A1<MEMO>IFOOD *RESTAURANTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261004<TRNAMT>-23.50<FITID>A2<MEMO>Uber Trip</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>1500.00<FITID>A3<MEMO>Transferência recebida - João Pix</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-89.90<FITID>A4<MEMO>Padaria São José</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>''')
    with page.expect_file_chooser() as fc:
        page.click('#btnImportStatement')
    fc.value.set_files(ofx); page.wait_for_timeout(600)
    rows = page.locator('#imList .im-row')
    check(rows.count() == 4, 'OFX: 4 lançamentos (com acento em latin-1)')
    cats = [r.locator('.im-cat').input_value() for r in rows.all()]
    descs = N(page.inner_text('#imList'))
    check('Transferência recebida' in descs and 'Padaria São José' in descs, 'acentos lidos certo')
    check('Alimentação' in cats and 'Transporte' in cats and 'Transferências' in cats, 'categorias adivinhadas: %s' % cats)
    padaria = page.locator('#imList .im-row', has_text='Padaria')
    padaria.locator('.im-cat').fill('Café da manhã')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(400)
    s = st()
    imp = [t for t in s['transactions'] if t.get('imp', '').startswith('f:A')]
    check(len(imp) == 4 and any(t['type'] == 'entrada' and t['amount'] == 1500 for t in imp), 'importou 4 (1 entrada)')
    check(s['catRules'].get('padaria sao') == 'Café da manhã', 'aprendeu a categoria corrigida: %s' % s['catRules'])
    with page.expect_file_chooser() as fc:
        page.click('#btnImportStatement')
    fc.value.set_files(ofx); page.wait_for_timeout(600)
    check(page.locator('#imList .im-row.skip').count() == 4 and 'já importado' in page.inner_text('#imList'), 'mesmo arquivo de novo: tudo marcado como já importado')
    page.click('#adActions [data-ad="cancel"]'); page.wait_for_timeout(200)
    csv = SP + '/nubank.csv'
    open(csv, 'w').write('Data,Valor,Identificador,Descrição\n07/10/2026,-32.50,x1,Compra no débito - Padaria São Bento\n06/10/2026,-12.00,x2,Compra no débito - Drogasil\n')
    with page.expect_file_chooser() as fc:
        page.click('#btnImportStatement')
    fc.value.set_files(csv); page.wait_for_timeout(600)
    cats = [r.locator('.im-cat').input_value() for r in page.locator('#imList .im-row').all()]
    check(cats == ['Café da manhã', 'Saúde'], 'CSV Nubank conta + regra aprendida aplicada: %s' % cats)
    page.click('#adActions [data-ad="cancel"]'); page.wait_for_timeout(200)
    inter = SP + '/inter.csv'
    open(inter, 'w', encoding='latin-1').write('Extrato Conta Corrente\nConta;12345\n\nData Lançamento;Histórico;Descrição;Valor;Saldo\n05/10/2026;Pix enviado;Fulano de Tal;-150,00;1.200,00\n04/10/2026;Pix recebido;Ciclano;1.250,50;1.350,00\n')
    with page.expect_file_chooser() as fc:
        page.click('#btnImportStatement')
    fc.value.set_files(inter); page.wait_for_timeout(600)
    t = N(page.inner_text('#imList'))
    check('Pix enviado · Fulano de Tal' in t and '−R$ 150,00' in t and '+R$ 1.250,50' in t, 'CSV do Inter (; e vírgula, cabeçalho no meio): %s' % t[:120])
    page.click('#adActions [data-ad="cancel"]'); page.wait_for_timeout(200)
    card = SP + '/fatura.csv'
    open(card, 'w').write('date,title,amount\n2026-10-01,Netflix,55.90\n2026-10-02,Pagamento recebido,-500.00\n')
    data_has_card = page.evaluate("JSON.parse(localStorage.getItem('barnabank_debts_v3')).cards.length")
    if data_has_card:
        with page.expect_file_chooser() as fc:
            page.click('#btnImportStatement')
        fc.value.set_files(card); page.wait_for_timeout(600)
        check(page.eval_on_selector('#imTarget', 'e => e.value').startswith('c:') and page.is_checked('#imFlip'), 'CSV de fatura: escolhe o cartão e inverte os sinais')
        check(page.locator('#imList .im-row.skip').count() == 1, 'pagamento da fatura fica de fora')
        page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(400)
        check(any(p_['desc'] == 'Netflix' and p_['category'] == 'Assinaturas' for p_ in st()['cardPurchases']), 'Netflix virou compra no cartão, categoria Assinaturas')

    # ---------------- 13. cabe no mês
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(300)
    page.click('#dashForecast [data-fits]'); page.wait_for_timeout(300)
    page.fill('#fiDesc', 'Celular'); page.fill('#fiAmount', '1200'); page.fill('#fiN', '10'); page.wait_for_timeout(300)
    t = N(page.inner_text('#fiOut'))
    check(('Cabe' in t or 'Não cabe' in t) and '10x de R$ 120,00' in t, 'simulação: %s' % t[:160])
    check(page.locator('#fiOut .fi-r').count() >= 10 and page.locator('#fiOut .fi-r.has').count() == 10, 'tabela mês a mês com as 10 parcelas')
    page.fill('#fiAmount', '999999'); page.fill('#fiN', '1'); page.wait_for_timeout(300)
    t = N(page.inner_text('#fiOut'))
    check('Não cabe' in t, 'valor absurdo: não cabe')
    page.fill('#fiAmount', '1200'); page.fill('#fiN', '10'); page.wait_for_timeout(200)
    n0 = len(st()['cardPurchases'])
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(400)
    check(len(st()['cardPurchases']) == n0 + 1 and st()['cardPurchases'][-1]['installments'] == 10, 'Registrar a compra cria a compra em 10x no cartão')
    page.screenshot(path=SP + '/v7b_dash.png', full_page=True)
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
