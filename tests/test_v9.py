"""Testes v9: o bot lança na hora (motor do app na nuvem), backups diários e lembretes para quem te deve."""
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
AUTH = {'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
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
def tg(text=None, cb=None, chat=999, first=None, mid=None):
    upd[0] += 1
    u = {'update_id': upd[0]}
    if cb: u['callback_query'] = {'id': 'c%d' % upd[0], 'data': cb, 'message': {'message_id': mid or 1, 'chat': {'id': chat}, 'text': 'algo'}}
    else:
        u['message'] = {'message_id': upd[0], 'chat': {'id': chat}, 'text': text, 'from': {'id': chat, 'first_name': first or 'Fulano'}}
    return http('POST', HP, u, {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HS})
msgs = lambda chat='999': [x for x in sent() if x['method'] in ('sendMessage', 'editMessageText') and str(x['body'].get('chat_id')) == chat]
last = lambda chat='999': (msgs(chat) or [{'body': {'text': ''}}])[-1]['body']['text']
fmt = lambda iso: iso[8:10] + '/' + iso[5:7]
plain = lambda t: N(re.sub('<[^>]+>', '', t))
inbox = lambda: json.loads(kv().get('inbox', '[]'))
snap = lambda: json.loads(kv()['snapshot'])
tg('/start')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com', ownerName:'João Pedro'}));localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(2500)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    sync = lambda: (page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"), page.wait_for_timeout(1800))
    check('snapshot' in kv() and json.loads(kv()['meta']).get('rev'), 'app mandou os dados e a nuvem tem versão (rev)')
    rev0 = json.loads(kv()['meta'])['rev']
    bal0 = json.loads(kv()['summary'])['balance']

    # ---------------- 1. o bot lança na hora, sem abrir o app
    tg('gastei 35 mercado')
    check('Entra no app na próxima' not in last() and 'Gasto' in last(), 'confirmação sem "entra quando abrir": %s' % plain(last())[:80])
    op = inbox()[-1]
    tx = [t for t in snap()['transactions'] if t['amount'] == 35 and 'Telegram' in t.get('note', '')]
    check(len(tx) == 1, 'gasto já está nos dados da nuvem')
    check(op['id'] in snap().get('tgLog', {}), 'nuvem marcou a mensagem como lançada (tgLog)')
    check(json.loads(kv()['meta'])['rev'] > rev0, 'versão da nuvem subiu')
    check(abs(json.loads(kv()['summary'])['balance'] - (bal0 - 35)) < 0.01, 'resumo já com o saldo novo')
    tg('/saldo')
    check(re.search(r'Total: R\$ ' + re.escape('{:,.2f}'.format(bal0 - 35).replace(',', 'X').replace('.', ',').replace('X', '.')), plain(last())) is not None, '/saldo na hora: %s' % plain(last())[-40:])
    tg('/pendentes')
    check('Nada pendente' in last(), '/pendentes: nada esperando o app')
    tg('/resumo')
    check('esperando o app' not in last(), '/resumo não fala de mensagem esperando')

    # ---------------- 2. o app pega a versão da nuvem (sem duplicar)
    sync()
    t35 = [t for t in st()['transactions'] if t['amount'] == 35 and 'Telegram' in t.get('note', '')]
    check(len(t35) == 1, 'app tem o gasto uma vez só (%d)' % len(t35))
    check(op['id'] not in [o['id'] for o in inbox()], 'app confirmou a mensagem (saiu da fila)')
    toast = page.evaluate("(document.getElementById('toast')||{}).textContent||''")
    check('Telegram: 1 lançamento no app' in toast, 'aviso no app: %s' % toast[:80])

    # ---------------- 3. app com mudança local + mensagem do bot ao mesmo tempo
    page.evaluate("""() => { var s = JSON.parse(localStorage.getItem('barnabank_debts_v3')); s.transactions.push({id:'tlocal', walletId:'w1', type:'gasto', amount: 12.5, date: new Date().toISOString().slice(0,10), category:'Padaria'}); localStorage.setItem('barnabank_debts_v3', JSON.stringify(s)); }""")
    page.reload(); page.wait_for_timeout(300)
    tg('ganhei 150 freela')
    sync()
    s_ = st()
    check(len([t for t in s_['transactions'] if t['amount'] == 150]) == 1 and any(t['id'] == 'tlocal' for t in s_['transactions']), 'mudança local e mensagem do bot ficam as duas, sem duplicar')
    sn = snap()
    check(len([t for t in sn['transactions'] if t['amount'] == 150]) == 1 and any(t['id'] == 'tlocal' for t in sn['transactions']), 'nuvem também ficou com as duas')

    # ---------------- 4. mensagem que não dá pra lançar avisa na hora
    # resumo diz que o Zé deve, mas nos dados não tem dívida dele (ex.: apagada no app): o motor recusa
    sm = json.loads(kv()['summary']); sm['people'] = sm['people'] + [{'name': 'Zé Ninguém', 'rec': 50, 'pay': 0, 'late': 0}]
    http('POST', '/__kvset', {'summary': json.dumps(sm)})
    tg('recebi 20 do Zé Ninguém')
    check('Não lancei' in last() and '<s>' in last(), 'pagamento de quem não deve: avisa na hora (%s)' % plain(last())[:80])
    check(not any('Ninguém' in o.get('text', '') for o in inbox()), 'e não fica na fila')

    # ---------------- 5. backups diários
    k = kv()
    today = datetime.date.today().isoformat()
    check(('bk:' + today) in k and any(x['date'] == today for x in json.loads(k['bkIndex'])), 'backup de hoje guardado')
    yday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    old = json.loads(k['bk:' + today]); old['wallets'][0]['name'] = 'Carteira de ontem'
    idx = json.loads(k['bkIndex']) + [{'date': yday, 'size': 1000}]
    http('POST', '/__kvset', {'bk:' + yday: json.dumps(old), 'bkIndex': json.dumps(idx)})
    c, body = http('GET', '/api/backups', None, AUTH)
    lst = json.loads(body)['backups']
    check(c == 200 and [x['date'] for x in lst][:2] == [today, yday], 'API lista os backups (mais novo primeiro)')
    check(http('GET', '/api/backups', None, {})[0] == 401, 'backups precisam da chave')
    page.click('#btnSettings'); page.wait_for_timeout(300)
    page.click('#btnCloud'); page.wait_for_timeout(400)
    page.click('#clBackups'); page.wait_for_timeout(1200)
    t = N(page.inner_text('#adBody'))
    check('Uma cópia por dia' in t and fmt(yday) in t, 'tela de backups: %s' % t[:120])
    page.screenshot(path=SP + '/v9_backups.png')
    page.click('[data-bk="%s"]' % yday); page.wait_for_timeout(1000)
    check('Voltar para' in page.inner_text('#adTitle'), 'pede confirmação antes de restaurar')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(2500)
    check(st()['wallets'][0]['name'] == 'Carteira de ontem' if 'wallets' in st() else False, 'app voltou para o backup')
    check(snap()['wallets'][0]['name'] == 'Carteira de ontem', 'nuvem também')

    # ---------------- 6. lembretes para quem te deve
    page.click('#btnSearch'); page.fill('#gsInput', 'larissa'); page.wait_for_timeout(200)
    page.locator('#gsResults .gs-item', has_text='Larissa').first.click(); page.wait_for_timeout(500)
    page.screenshot(path=SP + '/v9_person.png')
    check(page.locator('#personTg').count() == 1, 'botão "Lembretes no Telegram" na página da pessoa')
    page.click('#personTg'); page.wait_for_timeout(1200)
    url = page.input_value('#tgUrl')
    m = re.match(r'https://t\.me/barna_teste_bot\?start=([A-Za-z0-9]+)$', url)
    check(m is not None, 'convite com o link do bot: %s' % url)
    page.screenshot(path=SP + '/v9_invite.png')
    code = m.group(1) if m else 'x'
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(1500)
    check(snap().get('invites', {}).get('larissa mota', {}).get('code') == code, 'convite foi pra nuvem')
    tg('/start ' + code, chat=555, first='Larissa')
    check('Pronto' in last('555') and 'João' in last('555') and 'em aberto' in last('555'), 'amiga recebe as boas-vindas: %s' % plain(last('555'))[:140])
    check('Larissa' in last() and 'entrou nos lembretes' in last(), 'dono é avisado')
    check(json.loads(kv()['friends'])['larissa mota']['chat'] == '555', 'amiga guardada')
    tg('/start xxxxxxxxxxxx', chat=556)
    check('não vale mais' in last('556'), 'convite inválido')
    tg('oi', chat=557)
    check('privado' in last('557'), 'estranho: bot privado')
    tg('/resumo', chat=555)
    check('Resumo com' in plain(last('555')) and 'joao@pix.com' in last('555'), 'amiga: /status mostra o que está em aberto e o PIX')
    tg('vou pagar amanhã', chat=555)
    check('só manda os lembretes' in last('555'), 'amiga: outras mensagens explicam o bot')
    check(not any(o.get('text') == 'vou pagar amanhã' for o in inbox()), 'mensagem da amiga não vira lançamento')
    sync()
    page.click('#personTg'); page.wait_for_timeout(600)
    check('recebe os lembretes' in page.inner_text('#adBody'), 'app mostra que ela está conectada')
    page.screenshot(path=SP + '/v9_connected.png')
    page.click('#adActions [data-ad="ok"]'); page.wait_for_timeout(300)

    summ = json.loads(kv()['summary'])
    lar = [c_ for c_ in summ['charges'] if c_['key'] == 'larissa mota'][0]
    check(lar.get('late', 0) > 0 or lar.get('next'), 'resumo tem atraso/próximo vencimento: late=%s next=%s' % (lar.get('late'), lar.get('next')))
    n0 = len(msgs('555'))
    http('GET', '/__cron')
    got = msgs('555')[n0:]
    check(len(got) == 1 and ('atrasado' in got[0]['body']['text'] or 'vence' in got[0]['body']['text']) and '/parar' in got[0]['body']['text'], 'cron manda o lembrete pra amiga: %s' % (plain(got[0]['body']['text'])[:140] if got else '-'))
    check(any('Lembrete enviado' in x['body']['text'] and 'Larissa' in x['body']['text'] for x in msgs()[-3:]), 'dono fica sabendo do lembrete')
    http('GET', '/__cron')
    check(len(msgs('555')) == n0 + 1, 'não repete no mesmo dia')
    tg('/cobrar larissa')
    kb = [r[0] for r in [x for x in sent() if x['method'] == 'sendMessage'][-1]['body'].get('reply_markup', {}).get('inline_keyboard', [])]
    rb = [x for x in kb if x.get('callback_data', '').startswith('remind:')]
    check(rb and 'Larissa' in rb[0]['text'], '/cobrar tem "Mandar lembrete no Telegram"')
    if rb:
        tg(cb=rb[0]['callback_data'])
        check(len(msgs('555')) == n0 + 2, 'botão manda o lembrete na hora')
    tg('/parar', chat=555)
    check('não recebe mais' in last('555') and 'saiu dos lembretes' in last(), '/parar: sai e o dono é avisado')
    check('larissa mota' not in json.loads(kv()['friends']), 'amiga removida')

    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
