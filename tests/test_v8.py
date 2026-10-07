"""Testes v8: PIX nos links, Já paguei, visualizações, perguntas, áudio, comparar meses, alertas, placar, dividir conta."""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, os, urllib.request, base64, datetime
SP = OUT
exec(open(os.path.join(HERE, 'test_v5.py')).read().split('fails = []')[0])
from playwright.sync_api import sync_playwright
import cv2, numpy as np
BOT, KEY = 'http://localhost:8787', 'chave-de-teste-1234567890'
data['debts'].append(debt('d9', 'Larissa Mota', 90, ago(5), 1))
for k in range(1, 4):
    data['transactions'].append({'id': 'lz%d' % k, 'walletId': 'w1', 'type': 'gasto', 'amount': 100, 'date': m_ago(k, 10), 'category': 'Lazer'})
data['transactions'].append({'id': 'lz0', 'walletId': 'w1', 'type': 'gasto', 'amount': 400, 'date': ago(0), 'category': 'Lazer'})
fails = []
def check(c, m):
    print(('OK   ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
N = lambda s: re.sub(r'\s+', ' ', re.sub('<[^>]+>', ' ', s).replace('\xa0', ' '))
def http(method, path, body=None, headers=None):
    h = dict(headers or {})
    if body is not None: h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(BOT + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
kv = lambda: json.loads(http('GET', '/__kv')[1])
sent = lambda: json.loads(http('GET', '/__sent')[1])
http('GET', '/setup?key=' + KEY)
hook = [x for x in sent() if x['method'] == 'setWebhook'][-1]['body']
HP, HS = '/tg/' + hook['url'].rsplit('/', 1)[1], hook['secret_token']
upd = [0]
def tg(text=None, cb=None, voice=False):
    upd[0] += 1
    u = {'update_id': upd[0]}
    if cb: u['callback_query'] = {'id': 'c%d' % upd[0], 'data': cb, 'message': {'message_id': 1, 'chat': {'id': 999}}}
    else:
        m = {'message_id': upd[0], 'chat': {'id': 999}}
        if voice: m['voice'] = {'file_id': 'v1', 'duration': 4, 'mime_type': 'audio/ogg'}
        else: m['text'] = text
        u['message'] = m
    return http('POST', HP, u, {'X-Telegram-Bot-Api-Secret-Token': HS})
msgs = lambda: [x for x in sent() if x['method'] in ('sendMessage', 'editMessageText', 'sendPhoto', 'editMessageCaption')]
def last(): b = msgs()[-1]['body']; return b.get('text') or b.get('caption') or ''
inbox = lambda: json.loads(kv().get('inbox', '[]'))
tg('/start')
JPG = 'data:image/jpeg;base64,' + base64.b64encode(open(os.path.join(HERE, 'botsim', 'photo.jpg'), 'rb').read()).decode()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL)
    page.evaluate("localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_last_export','%s');localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com', ownerName:'João', ownerCity:'São Paulo'}));localStorage.setItem('barnabank_welcomed','1');localStorage.setItem('barnabank_cloud', %s);" % (json.dumps(json.dumps(data)), T.isoformat(), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    page.goto(URL); page.wait_for_timeout(1500)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))

    # links: pessoa (Larissa), dívida d9, grupo
    page.click('#btnSearch'); page.fill('#gsInput', 'larissa'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(400)
    page.click('#personShare'); page.wait_for_timeout(1500)
    purl = page.input_value('#shUrl'); ptok = purl.rsplit('/', 1)[1]
    check('Ainda não foi aberto' in page.inner_text('#adBody'), 'janela do link: ainda não foi aberto')
    page.click('#adActions [data-ad="ok"]')
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    page.locator('.gcard .gcard-head .name').first.click(); page.wait_for_timeout(300)
    page.click('.gcard [data-gact="share"]'); page.wait_for_timeout(1500)
    gurl = page.input_value('#shUrl'); gtok = gurl.rsplit('/', 1)[1]
    page.click('#adActions [data-ad="ok"]')
    sv = json.loads(kv()['share:' + ptok])
    check(sv['pixInfo']['key'] == 'joao@pix.com' and sv['pixInfo']['city'] == 'São Paulo' and sv['_ref']['name'] == 'Larissa Mota', 'link guarda dados do PIX e a referência privada')
    check(sv['suggest'] == 140, 'valor sugerido = atrasado (R$ 140)')

    # 6. PIX na página
    code, html = http('GET', '/s/' + ptok, headers={'User-Agent': 'WhatsApp/2.23'})
    m = re.search(r'<code id="cc">([^<]+)</code>', html)
    cc = m.group(1) if m else ''
    check(cc.startswith('000201') and '0114joao@pix.com' not in cc and 'joao@pix.com' in cc and '5406140.00' in cc and '6009SAO PAULO' in cc, 'copia e cola com chave, valor R$ 140 e cidade')
    check('Copiar código PIX' in html and 'data:image/svg+xml;base64,' in html, 'QR na página')
    pg2 = ctx.new_page(); pg2.set_viewport_size({'width': 420, 'height': 900})
    pg2.goto(purl); pg2.wait_for_timeout(500)
    img = pg2.locator('#qr'); img.scroll_into_view_if_needed(); img.screenshot(path=SP + '/v8_qr.png')
    val, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(SP + '/v8_qr.png'))
    check(val == cc, 'QR lido com câmera = copia e cola')
    pg2.fill('#amt', '50,00'); pg2.wait_for_timeout(900)
    cc2 = pg2.inner_text('#cc')
    check('540550.00' in cc2 and cc2 != cc, 'mudar o valor gera outro código (R$ 50)')
    pg2.screenshot(path=SP + '/v8_page.png', full_page=True)
    # 7. visualizações
    http('GET', '/s/' + ptok, headers={'User-Agent': 'TelegramBot (like TwitterBot)'})
    vw = json.loads(kv().get('views:' + ptok, 'null'))
    check(vw and vw['count'] == 1, 'só conta a abertura de verdade (pré-visualização do WhatsApp/Telegram não conta): %s' % (vw and vw['count']))
    check(any('abriu o link de cobrança' in (x['body'].get('text') or '') for x in msgs()), 'bot avisa que a Larissa abriu o link')

    # 5. Já paguei
    pg2.click('#paidOpen'); pg2.fill('#pamt', '50,00'); pg2.fill('#pnote', 'paguei uma parte')
    pg2.set_input_files('#pfile', os.path.join(HERE, 'botsim', 'photo.jpg'))
    pg2.click('#psend'); pg2.wait_for_timeout(1500)
    check('Enviado' in pg2.inner_text('body') or 'aguardando confirmação' in pg2.inner_text('body'), 'página confirma o envio')
    ph = [x for x in sent() if x['method'] == 'sendPhoto']
    check(ph and 'Larissa' in ph[-1]['body']['caption'] and 'R$ 50,00' in ph[-1]['body']['caption'] and 'claim:ok:' in ph[-1]['body']['reply_markup'], 'você recebe a foto no Telegram com Recebi / Não recebi')
    pg2.reload(); pg2.wait_for_timeout(400)
    check('aguardando confirmação' in pg2.inner_text('body'), 'página mostra "aguardando confirmação"')
    claim_id = json.loads(kv()['claims'])[-1]
    tg(cb='claim:ok:' + claim_id)
    op = inbox()[-1]
    check(op['type'] == 'pay' and op['name'] == 'Larissa Mota' and op['amount'] == 50 and op.get('photo'), 'Recebi: vira pagamento da Larissa com comprovante')
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_timeout(2000)
    pays = [x for d in st()['debts'] if d['name'] == 'Larissa Mota' for x in d['payments'] if x['amount'] == 50]
    check(pays and pays[0].get('receiptId') and pays[0]['note'] == 'informado pelo link', 'pagamento entrou no app com o comprovante')
    pg2.reload(); pg2.wait_for_timeout(400)
    check('confirmado' in pg2.inner_text('body'), 'página mostra "confirmado"')
    # grupo: Caio paga pelo link; você confirma pelo app
    http('POST', '/s/' + gtok + '/pago', {'amount': 75, 'who': 2, 'note': '', 'photo': JPG})
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_timeout(1500)
    page.click('#pageTabs button[data-page="dashboard"]'); page.wait_for_timeout(300)
    t = N(page.inner_text('#claimsDash'))
    check('Caio R.' in t and 'R$ 75,00' in t, 'app mostra o pedido do grupo: %s' % t[:100])
    page.locator('#claimsDash [data-cl="photo"]').click(); page.wait_for_timeout(600)
    check(page.locator('#adBody img.rc-prev').count() == 1, 'dá pra ver o comprovante no app')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(200)
    page.locator('#claimsDash [data-cl="ok"]').click(); page.wait_for_timeout(2500)
    caio = [d for d in st()['debts'] if d['id'] == 'g1c'][0]
    check(sum(x['amount'] for x in caio['payments']) == 75, 'Recebi no app: a parte do Caio no grupo foi quitada')
    # não recebi + limite de envios
    http('POST', '/s/' + ptok + '/pago', {'amount': 10, 'note': 'teste'})
    cid = json.loads(kv()['claims'])[-1]
    tg(cb='claim:no:' + cid)
    t = N(http('GET', '/s/' + ptok, headers={'User-Agent': 'WhatsApp'})[1])
    check('não encontrado' in t, 'Não recebi: a página avisa a pessoa')
    for i in range(5): code, _ = http('POST', '/s/' + ptok + '/pago', {'amount': 1})
    check(code == 429, 'limite de envios por hora (anti-spam)')

    # 8. perguntas
    tg('quanto gastei com lazer esse mês?')
    check('Lazer' in last() and 'R$ 400,00' in last(), 'pergunta: gasto com lazer no mês → %s' % N(last())[:80])
    tg('quem me deve mais?')
    check('Quem mais te deve' in last() and 'Larissa' in last(), 'pergunta: quem me deve mais')
    tg('quanto a larissa já me pagou?')
    check('Larissa Mota' in last() and 'já te pagou' in last(), 'pergunta: quanto a Larissa já pagou → %s' % N(last())[:90])
    tg('qual meu saldo?')
    check('Carteiras' in last(), 'pergunta: saldo')
    tg('quanto eu devo?')
    check('Cartão Nubank' in last() or 'não deve nada' in last(), 'pergunta: quanto eu devo')
    tg('como faço pra economizar no fim do ano?')
    check(last().startswith('🤖') and 'confira no app' in last(), 'pergunta livre vai pra IA (com aviso)')
    tg('bom dia, tudo bem?')
    check('Não entendi' in last(), 'conversa solta não vira pergunta')

    # 10. áudio
    tg(voice=True)
    texts = [x['body'].get('text', '') for x in msgs()[-2:]]
    check('Entendi' in texts[0] and 'Gastei 30 reais no mercado' in texts[0], 'áudio transcrito: %s' % N(texts[0])[:60])
    op = inbox()[-1]
    check(op['type'] == 'tx' and op['amount'] == 30 and op['category'] == 'mercado', 'áudio virou gasto de R$ 30 no mercado')

    # 14. alertas
    page.goto(URL); page.wait_for_timeout(1500)
    t = N(page.inner_text('#dashAlerts'))
    check('Lazer: R$ 400,00' in t and '4x da sua média' in t, 'alerta de gasto fora do padrão: %s' % t[:120])
    http('GET', '/__cron')
    al = [x['body']['text'] for x in msgs() if 'fora do padrão' in (x['body'].get('text') or '')]
    check(len(al) == 1 and 'Lazer' in al[0], 'bot avisa o gasto fora do padrão')
    http('GET', '/__cron')
    al = [x['body']['text'] for x in msgs() if 'fora do padrão' in (x['body'].get('text') or '')]
    check(len(al) == 1, 'e não repete o mesmo aviso no mês')
    while page.locator('#dashAlerts [data-alx]').count():
        page.locator('#dashAlerts [data-alx]').first.click(); page.wait_for_timeout(150)
    check(page.inner_text('#dashAlerts').strip() == '', 'dá pra esconder o alerta')

    # 13. comparar meses
    page.click('#pageTabs button[data-page="relatorios"]'); page.wait_for_timeout(400)
    t = N(page.inner_text('#relCompare'))
    check('Lazer' in t and 'R$ 100,00 → R$ 400,00' in t and '+R$ 300,00' in t, 'comparação com o mês anterior: %s' % t[:140])

    # 15. placar
    page.click('#pageTabs button[data-page="pessoas"]'); page.wait_for_timeout(300)
    page.click('#btnBoard'); page.wait_for_timeout(300)
    t = N(page.inner_text('#adBody'))
    check('Quem mais pegou' in t and 'Quem mais devolveu' in t and 'pontualidade' in t, 'placar com medalhas: %s' % t[:120])
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(200)

    # 16. dividir conta
    page.click('#btnSplit'); page.wait_for_timeout(300)
    page.fill('#spTitle', 'Bar do Zé'); page.fill('#spPerson', 'Ana Souza, Bia Lima'); page.click('#spAddPerson')
    page.click('#spAddItem'); page.locator('#spItems .sp-name').nth(0).fill('Cerveja'); page.locator('#spItems .sp-qty').nth(0).fill('2'); page.locator('#spItems .sp-price').nth(0).fill('12,00')
    page.click('#spAddItem'); page.locator('#spItems .sp-name').nth(1).fill('Picanha'); page.locator('#spItems .sp-price').nth(1).fill('80,00')
    page.locator('#spItems [data-i="1"] [data-w="Bia Lima"]').click()
    page.check('#spService'); page.wait_for_timeout(200)
    t = N(page.inner_text('#spTotals'))
    check('Eu R$ 52,80' in t and 'Ana Souza R$ 52,80' in t and 'Bia Lima R$ 8,80' in t and 'R$ 114,40' in t, 'divisão por item + 10%%: %s' % t)
    page.screenshot(path=SP + '/v8_split.png')
    page.route('https://cdn.jsdelivr.net/**', lambda r: r.abort())  # simula sem internet (no GitHub tem)
    with page.expect_file_chooser() as fc:
        page.click('#spScan')
    fc.value.set_files(os.path.join(HERE, 'botsim', 'photo.jpg')); page.wait_for_timeout(2500)
    check('Não consegui ler' in page.inner_text('#spErr') or 'Lendo' in page.inner_text('#spErr'), 'sem internet pro leitor da foto: avisa e deixa digitar')
    page.click('#spSave'); page.wait_for_timeout(500)
    s = st()
    g = [x for x in s['groups'] if x['title'] == 'Bar do Zé'][0]
    ds = {d['name']: d['principal'] for d in s['debts'] if d.get('groupId') == g['id']}
    check(g['total'] == 114.4 and g['myShare'] == 52.8 and ds == {'Ana Souza': 52.8, 'Bia Lima': 8.8}, 'virou grupo: Ana 52,80, Bia 8,80, sua parte 52,80')
    check('Picanha' in g['notes'], 'itens anotados no grupo')
    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
