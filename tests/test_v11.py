"""Testes v11: notificação do banco, racha pelo bot, correção e /ultimos, assinaturas, metas com ritmo."""
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

# assinatura: Netflix todo mês, ficou mais cara no último
def mday(n, day):
    y, m = T.year, T.month - n
    while m <= 0: m += 12; y -= 1
    return datetime.date(y, m, min(day, 28))
for i, n in enumerate([3, 2, 1, 0]):
    d = mday(n, min(5, T.day))
    data['transactions'].append({'id': 'nf%d' % i, 'walletId': 'w1', 'type': 'gasto', 'amount': 44.9 if n == 0 else 39.9, 'date': d.isoformat(), 'category': 'Assinaturas', 'note': 'Netflix'})
# meta com prazo, atrasada no ritmo
data['goals'] = [{'id': 'gl1', 'name': 'Viagem', 'target': 1200, 'deadline': (T + datetime.timedelta(days=150)).isoformat(), 'created': (T - datetime.timedelta(days=90)).isoformat(), 'walletId': '', 'adds': [{'id': 'ga1', 'date': (T - datetime.timedelta(days=80)).isoformat(), 'amount': 100, 'note': ''}]}]
tg('/start')


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('barnabank_debts_v3', %s);localStorage.setItem('barnabank_settings_v1', JSON.stringify({pixKey:'joao@pix.com', ownerName:'João Pedro'}));localStorage.setItem('barnabank_cloud', %s);}" % (json.dumps(json.dumps(data)), json.dumps(json.dumps({'url': BOT, 'key': KEY}))))
    route_fonts(ctx)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(2500)
    st = lambda: json.loads(page.evaluate("localStorage.getItem('barnabank_debts_v3')"))
    sync = lambda: (page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"), page.wait_for_timeout(1800))

    # ---------------- 1. notificação do banco
    tg('Compra aprovada: R$ 45,90 em PADARIA DO ZE para o cartão Nubank final 1234.')
    cp = [x for x in snap()['cardPurchases'] if x['amount'] == 45.9]
    check(cp and cp[0]['cardId'] == 'c1' and cp[0]['category'] == 'Alimentação' and 'Padaria' in cp[0]['desc'], 'compra no crédito vira compra no cartão: %s' % (cp[0] if cp else '-'))
    check('compra no cartão' in last() and 'Nubank' in last(), 'resposta da notificação: %s' % plain(last())[:100])
    tg('Você recebeu um Pix de Larissa Mota no valor de R$ 50,00.')
    lar = [x for x in snap()['debts'] if x['name'] == 'Larissa Mota'][0]
    check(any(p_['amount'] == 50 for p_ in lar['payments']), 'Pix recebido de quem te deve vira pagamento')
    tg('Compra no débito aprovada R$ 12,00 em UBER *TRIP')
    tu = [x for x in snap()['transactions'] if x['amount'] == 12 and 'Uber' in x.get('note', '')]
    check(tu and tu[0]['category'] == 'Transporte', 'débito vira gasto na carteira (Transporte): %s' % (tu[0] if tu else '-'))
    tg('Pix enviado: R$ 30,00 para JOAO SILVA')
    check(any(x['amount'] == 30 and 'Joao Silva' in x.get('note', '') for x in snap()['transactions']), 'Pix enviado vira gasto com o nome')

    # ---------------- 2. racha pelo bot
    tg('racha 120 do churrasco com Bia e Caio até sexta')
    g = [x for x in snap()['groups'] if x['title'].lower() == 'churrasco']
    gd = [x for x in snap()['debts'] if g and x.get('groupId') == g[0]['id']]
    check(g and len(gd) == 2 and all(x['principal'] == 40 for x in gd) and g[0]['myShare'] == 40 and {x['name'] for x in gd} == {'Bia Lima', 'Caio Reis'}, 'racha cria o grupo (40 cada, com você): %s' % [(x['name'], x['principal']) for x in gd])
    check(g and datetime.date.fromisoformat(g[0]['dueDate']).weekday() == 4, 'até sexta: %s' % (g[0]['dueDate'] if g else '-'))
    kb = json.loads(json.dumps(msgs()[-1]['body'].get('reply_markup', {}))).get('inline_keyboard', [])
    link = [r[0]['url'] for r in kb if r and r[0].get('url', '').startswith(BOT + '/s/')]
    check(link and 'wa.me' in kb[0][0].get('url', ''), 'resposta tem WhatsApp e o link do grupo')
    if link:
        c, html = http('GET', link[0][len(BOT):])
        check(c == 200 and 'Churrasco' in html and 'Bia' in html, 'link do grupo funciona')
    gid = g[0]['id'] if g else ''
    tg('racha 90 com Ana e Rafael sem mim')
    g2 = [x for x in snap()['groups'] if x['total'] == 90]
    d2 = [x for x in snap()['debts'] if g2 and x.get('groupId') == g2[0]['id']]
    check(g2 and not g2[0]['includeMe'] and sorted(x['principal'] for x in d2) == [45, 45], 'sem mim: 45 cada')
    rid = [o for o in json.loads(kv()['inbox']) if o.get('type') == 'group'][-1]['id']
    tg(cb='undo:' + rid)
    check(not [x for x in snap()['groups'] if x['total'] == 90], 'Desfazer apaga o racha')

    # ---------------- 3. correção e /ultimos
    tg('gastei 30 lanche')
    tg('na verdade foi 45')
    tl = [x for x in snap()['transactions'] if 'Lanche' == x.get('category') and x.get('note', '').endswith('via Telegram')]
    check(tl and tl[-1]['amount'] == 45, 'na verdade foi 45: corrige o valor')
    check('Corrigido' in last(), 'resposta: %s' % plain(last())[:80])
    tg('na verdade foi lazer')
    tl = [x for x in snap()['transactions'] if x['amount'] == 45 and x.get('note', '').endswith('via Telegram')]
    check(tl and tl[-1]['category'] == 'Lazer', 'na verdade foi lazer: troca a categoria')
    tg('/ultimos')
    ul = last()
    check('Últimos lançamentos' in ul and 'Gasto' in ul, '/ultimos lista: %s' % plain(ul)[:140])
    kb = [x for x in sent() if x['method'] == 'sendMessage'][-1]['body']['reply_markup']['inline_keyboard'][0]
    check(len(kb) >= 3 and kb[0]['text'] == '🗑 1', 'botões de apagar')
    tg(cb=kb[0]['callback_data'])
    check('Apagado' in last() and not [x for x in snap()['transactions'] if x['amount'] == 45 and x.get('category') == 'Lazer'], 'apagar o 1 desfaz o último')

    # ---------------- 4. metas pelo bot
    tg('guardei 100 na viagem')
    gl = snap()['goals'][0]
    check(len(gl['adds']) == 2, 'guardei 100 na viagem: entra na meta')
    check('Viagem' in last() and 'R$ 200,00 de R$ 1.200,00' in last() and 'abaixo do ritmo' in last(), 'resposta da meta com o ritmo: %s' % plain(last())[:160])
    tg('guardei 50 na casa')
    check('Não achei a meta' in last(), 'meta que não existe')

    # ---------------- 5. app: assinaturas e meta
    sync()
    page.click('#pageTabs button[data-page="relatorios"]'); page.wait_for_timeout(500)
    sub = N(page.inner_text('#relSubs'))
    check('Netflix' in sub and 'subiu de R$ 39,90 para R$ 44,90' in sub, 'assinaturas no Relatórios: %s' % sub[:160])
    check('Mercado' not in sub, 'mercado (várias vezes no mês) não conta como assinatura')
    page.screenshot(path=SP + '/v11_subs.png', full_page=True)
    page.click('#pageTabs button[data-page="carteiras"]'); page.wait_for_timeout(500)
    gt = N(page.inner_text('#goalList'))
    check('abaixo do ritmo' in gt, 'meta mostra que está abaixo do ritmo: %s' % gt[:140])
    check(len(st()['goals'][0]['adds']) == 2, 'app pegou o que foi guardado pelo bot')
    check(any(x['amount'] == 45.9 for x in st()['cardPurchases']), 'app pegou a compra no cartão')
    http('GET', '/__cron')
    al = [m for m in msgs() if 'Ficou mais caro' in m['body']['text']]
    check(al and 'Netflix' in al[-1]['body']['text'] and 'R$ 44,90' in al[-1]['body']['text'], 'bot avisa que a Netflix ficou mais cara')
    n = len(al)
    http('GET', '/__cron')
    check(len([m for m in msgs() if 'Ficou mais caro' in m['body']['text']]) == n, 'não repete o aviso')

    check(not errs, 'sem erros de JS %s' % errs)
    b.close()
print('\n%d falha(s)' % len(fails))
