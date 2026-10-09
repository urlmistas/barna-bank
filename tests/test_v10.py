"""Testes v10: esconder valores, nota de confiança, recibo de quitação, prazo pelo link, nota fiscal no bot."""
import os, sys, tempfile, subprocess
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
AUTH = {'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' '))
def http(method, path, body=None, headers=None, raw=None):
    data = raw.encode() if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BOT + path, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
kv = lambda: json.loads(http('GET', '/__kv')[1])
sent = lambda: json.loads(http('GET', '/__sent')[1])
http('GET', '/setup?key=' + KEY)
hook = [x for x in sent() if x['method'] == 'setWebhook'][-1]['body']
HP, HS = '/tg/' + hook['url'].rsplit('/', 1)[1], hook['secret_token']
upd = [100]
def tg(text=None, cb=None, chat=999, first=None, photo=False, caption=None, uid=None):
    if uid is None: upd[0] += 1; uid = upd[0]
    u = {'update_id': uid}
    if cb: u['callback_query'] = {'id': 'c%d' % uid, 'data': cb, 'message': {'message_id': 1, 'chat': {'id': chat}, 'text': 'algo'}}
    else:
        m = {'message_id': uid, 'chat': {'id': chat}, 'from': {'id': chat, 'first_name': first or 'Fulano'}}
        if photo: m['photo'] = [{'file_id': 'small', 'width': 90, 'height': 60}, {'file_id': 'big', 'width': 900, 'height': 1200, 'file_size': 30000}]; m['caption'] = caption
        else: m['text'] = text
        u['message'] = m
    return http('POST', HP, u, {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HS})
msgs = lambda chat='999': [x for x in sent() if x['method'] in ('sendMessage', 'editMessageText') and str(x['body'].get('chat_id')) == chat]
docs = lambda chat='999': [x for x in sent() if x['method'] == 'sendDocument' and str(x['body'].get('chat_id')) == chat]
last = lambda chat='999': (msgs(chat) or [{'body': {'text': ''}}])[-1]['body']['text']
plain = lambda t: N(re.sub('<[^>]+>', '', t))
snap = lambda: json.loads(kv()['snapshot'])
fmt = lambda d: d.strftime('%d/%m/%Y')
T = datetime.date.today()
tg('/start')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com', ownerName:'João Pedro', ownerCity:'São Paulo'}));localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(2500)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    sync = lambda: (page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"), page.wait_for_timeout(1800))
    visible_money = lambda: re.findall(r'R\$\s?\d', page.evaluate("document.body.innerText"))
    def open_person(name):
        page.click('#btnSearch'); page.fill('#gsInput', name.lower()); page.wait_for_timeout(200)
        page.locator('#gsResults .gs-item', has_text=name).first.click(); page.wait_for_timeout(500)

    # ---------------- 1. olhinho
    check(len(visible_money()) > 3, 'valores aparecem normalmente')
    page.click('#btnPrivacy'); page.wait_for_timeout(300)
    check(not visible_money() and '•••••' in page.evaluate("document.body.innerText"), 'olhinho esconde todos os valores')
    page.screenshot(path=SP + '/v10_privacy.png')
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(400)
    check(not visible_money(), 'continua escondido ao trocar de aba')
    page.reload(); page.wait_for_timeout(1200)
    check(not visible_money() and page.get_attribute('#btnPrivacy', 'aria-pressed') == 'true', 'lembra depois de recarregar')
    page.click('#btnPrivacy'); page.wait_for_timeout(300)
    check(len(visible_money()) > 3, 'mostra de novo')
    check(st()['transactions'][0]['amount'] == data['transactions'][0]['amount'], 'dados não mudam')

    # ---------------- 2. nota de confiança
    open_person('Larissa')
    t = N(page.inner_text('#personContent .trust'))
    check(re.search(r'^\d{1,3}\b', t) and 'Confiança' in t and ('em dia' in t), 'nota de confiança na página: %s' % t[:140])
    page.screenshot(path=SP + '/v10_trust.png')
    open_person('Ana Souza')
    t2 = N(page.inner_text('#personContent .trust'))
    check('Confiança' in t2, 'Ana (pagou tudo): %s' % t2[:140])
    page.click('#btnNew'); page.wait_for_timeout(300)
    page.fill('#fName', 'Larissa Mota'); page.wait_for_timeout(200)
    check(page.is_visible('#trustHint') and 'Confiança' in page.inner_text('#trustHint'), 'dica de confiança no formulário: %s' % page.inner_text('#trustHint'))
    page.fill('#fName', 'Pessoa Nova'); page.wait_for_timeout(200)
    check(not page.is_visible('#trustHint'), 'some para pessoa nova')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)

    # ---------------- 3. convite da Bia (para receber o recibo)
    open_person('Bia Lima')
    page.click('#personTg'); page.wait_for_timeout(1200)
    code = page.input_value('#tgUrl').rsplit('=', 1)[1]
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(1500)
    tg('/start ' + code, chat=777, first='Bia')
    check('Pronto' in last('777'), 'Bia entrou nos lembretes')

    # ---------------- 4. recibo de quitação
    tg('recebi 45 da bia')
    m_ = [x for x in sent() if 'ask:' in json.dumps(x['body'].get('reply_markup', ''))][-1]['body']['reply_markup']
    m_ = json.loads(m_) if isinstance(m_, str) else m_
    tg(cb=m_['inline_keyboard'][0][0]['callback_data'])
    d = docs()
    check(d and 'quitou' in d[-1]['body']['caption'] and d[-1]['body']['document'].startswith('[file'), 'bot manda o recibo em PDF quando a Bia quita')
    check(docs('777') and 'recibo de quitação' in docs('777')[-1]['body']['caption'], 'Bia recebe o recibo no Telegram sozinha (automático)')
    check('já foi pro Bia' in d[-1]['body']['caption'], 'dono fica sabendo que o recibo já foi: %s' % d[-1]['body']['caption'][-60:])
    sync()
    toast = N(page.inner_text('#undoStack'))
    check('Bia quitou' in toast and 'Recibo' in toast, 'app avisa que quitou, com botão Recibo: %s' % toast)
    with page.expect_download() as dl:
        page.locator('#undoStack .undo-toast', has_text='quitou').locator('button').click()
    path = os.path.join(OUT, 'v10_recibo.pdf'); dl.value.save_as(path)
    raw = open(path, 'rb').read()
    txt = subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout if raw[:5] == b'%PDF-' else ''
    txt = N(txt)
    check(raw[:5] == b'%PDF-' and 'RECIBO DE QUITAÇÃO' in txt and 'Bia Lima' in txt and 'João Pedro' in txt and 'setenta e cinco reais' in txt and 'São Paulo' in txt, 'PDF do recibo certinho: %s' % N(txt)[:160])
    subprocess.run(['pdftoppm', '-r', '60', '-png', '-singlefile', path, os.path.join(OUT, 'v10_recibo')])
    open_person('Bia Lima')
    page.locator('#personDebts .card').first.click(); page.wait_for_timeout(300)
    check(page.locator('#personDebts [data-act="receipt"]').count() >= 1, 'dívida quitada tem o botão "Recibo de quitação"')

    # ---------------- 5. pedir mais prazo pelo link
    open_person('Larissa')
    page.click('#personShare'); page.wait_for_timeout(1500)
    url = page.input_value('#shUrl'); token = url.rsplit('/', 1)[1]
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)
    c, html = http('GET', '/s/' + token)
    check('Precisa de mais prazo?' in html and 'id="zdate"' in html, 'link tem "Pedir mais prazo"')
    nd = (T + datetime.timedelta(days=10)).isoformat()
    check(http('POST', '/s/%s/prazo' % token, {'date': T.isoformat()})[0] == 400, 'data de hoje não vale')
    c, _ = http('POST', '/s/%s/prazo' % token, {'date': nd, 'note': 'recebo dia 15'})
    check(c == 200, 'pedido de prazo enviado')
    check('pediu mais prazo' in last() and 'recebo dia 15' in last(), 'dono recebe o pedido no Telegram: %s' % plain(last())[:120])
    check(http('POST', '/s/%s/prazo' % token, {'date': nd})[0] == 409, 'não deixa pedir de novo enquanto espera')
    c, html = http('GET', '/s/' + token)
    check('aguardando resposta' in html, 'link mostra que está esperando')
    sync()
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(300)
    cb_txt = N(page.inner_text('#claimsDash'))
    check('pediu prazo até' in cb_txt, 'app mostra o pedido: %s' % cb_txt[:100])
    page.screenshot(path=SP + '/v10_prazo_app.png')
    page.locator('#claimsDash .claim-row.prazo [data-cl="ok"]').click(); page.wait_for_timeout(2500)
    lar = [x for x in snap()['debts'] if x['name'] == 'Larissa Mota'][0]
    check(nd in (lar.get('dueOverride') or {}).values(), 'nuvem remarcou a parcela: %s' % lar.get('dueOverride'))
    summ = json.loads(kv()['summary'])
    lc = [x for x in summ['charges'] if x['key'] == 'larissa mota'][0]
    check(lc['late'] == 0 and lc['next']['date'] == nd, 'Larissa não está mais atrasada; próximo em %s' % lc['next'])
    c, html = http('GET', '/s/' + token)
    check('aceito, a nova data já vale' in html, 'link mostra que foi aceito')
    sync()
    sl = [x for x in st()['debts'] if x['name'] == 'Larissa Mota'][0]
    check(nd in (sl.get('dueOverride') or {}).values(), 'app pegou a nova data')
    # recusar pelo Telegram
    nd2 = (T + datetime.timedelta(days=40)).isoformat()
    http('POST', '/s/%s/prazo' % token, {'date': nd2})
    cid = [x for x in json.loads(kv()['claims'])][-1]
    tg(cb='claim:no:' + cid)
    check('recusado' in last(), 'recusar pelo Telegram')
    c, html = http('GET', '/s/' + token)
    check('não aceito' in html, 'link mostra que não foi aceito')

    # ---------------- 6. nota fiscal: link do QR
    nfce = 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261012345678000190650010000123451123456789|2|1|1|0A1B2C3D4E5F'
    tg(nfce)
    tx = [x for x in snap()['transactions'] if x['amount'] == 87.5]
    two = (T - datetime.timedelta(days=2)).isoformat()
    check(tx and tx[0]['category'] == 'Mercado' and tx[0]['date'] == two and 'Supermercado Exemplo' in tx[0].get('note', ''), 'link da NFC-e vira gasto (loja, valor, data, Mercado): %s' % (tx[0] if tx else '-'))
    check('Supermercado Exemplo' in last() and 'R$ 87,50' in last() and '3 itens' in last(), 'resposta da nota: %s' % plain(last())[:120])
    off = 'https://fora.fazenda.sp.gov.br/nfce/qrcode?p=35261012345678000190650010000123451123456789|2|1|0' + str(T.day) + '|42.30|abc|1|hash'
    tg(off)
    check(any(x['amount'] == 42.3 for x in snap()['transactions']), 'Sefaz fora do ar: usa o valor do QR de contingência')
    tg('https://exemplo.com/nfce?p=123')
    check('Não entendi' in last() or 'Supermercado' not in last(), 'link que não é do governo é ignorado')

    # ---------------- 7. nota fiscal: foto do cupom (IA)
    yday = T - datetime.timedelta(days=1)
    http('POST', '/__vision', raw=json.dumps({'tipo': 'cupom', 'loja': 'PADARIA PAO QUENTE', 'total': '23,40', 'data': fmt(yday)}))
    tg(photo=True, caption=None)
    ai = json.loads(http('GET', '/__ai')[1])
    check(ai.count('@cf/meta/llama-3.2-11b-vision-instruct') >= 2, 'aceita a licença do modelo de visão sozinho')
    t23 = [x for x in snap()['transactions'] if x['amount'] == 23.4]
    check(t23 and t23[0]['date'] == yday.isoformat() and t23[0]['category'] == 'Alimentação', 'foto do cupom vira gasto: %s' % (t23[0] if t23 else '-'))
    check('Padaria Pao Quente' in last() and 'confira' in last(), 'resposta avisa que foi lido pela IA')
    http('POST', '/__vision', raw=json.dumps({'tipo': 'cupom', 'loja': 'POSTO SHELL', 'total': 'R$ 150,00', 'data': fmt(T)}))
    tg(photo=True, caption='nubank')
    t150 = [x for x in snap()['transactions'] if x['amount'] == 150 and 'Posto' in x.get('note', '')]
    check(t150 and t150[0]['walletId'] == 'w1', 'legenda com a carteira: entra no Nubank')
    http('POST', '/__vision', raw='{"tipo":"pix"}')
    tg(photo=True, caption=None)
    check('legenda' in last(), 'comprovante de PIX sem legenda: pede a legenda')

    # ---------------- 8. mensagem repetida pelo Telegram não duplica
    n0 = len(snap()['transactions'])
    tg('gastei 9 bala', uid=5000); tg('gastei 9 bala', uid=5000)
    check(len(snap()['transactions']) == n0 + 1, 'mesma mensagem reenviada entra uma vez só')

    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
