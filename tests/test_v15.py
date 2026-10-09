"""Testes v15: bot de lembretes pra quem te deve (menu, parcelas, PIX com QR, já paguei, prazo, histórico, recibo, quando avisar, pausar)."""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get('BB_TEST_OUT') or os.path.join(tempfile.gettempdir(), 'bb-tests')
os.makedirs(OUT, exist_ok=True)
APP_URL = os.environ.get('BB_URL', 'http://localhost:8765/index.html')
import json, re, os, urllib.request, datetime
SP = OUT
exec(open(os.path.join(HERE, 'test_v5.py')).read().split('fails = []')[0])
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
upd = [500]
def tg(text=None, cb=None, chat=999, first=None, photo=False, caption=None):
    upd[0] += 1; uid = upd[0]
    u = {'update_id': uid}
    if cb: u['callback_query'] = {'id': 'c%d' % uid, 'data': cb, 'message': {'message_id': 1, 'chat': {'id': chat}, 'text': 'algo'}}
    else:
        m = {'message_id': uid, 'chat': {'id': chat}, 'from': {'id': chat, 'first_name': first or 'Fulano'}}
        if photo:
            m['photo'] = [{'file_id': 'small', 'width': 90, 'height': 60}, {'file_id': 'big', 'width': 900, 'height': 1200, 'file_size': 30000}]
            if caption: m['caption'] = caption
        else: m['text'] = text
        u['message'] = m
    return http('POST', HP, u, {'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': HS})
def of(chat, *methods):
    methods = methods or ('sendMessage', 'editMessageText')
    return [x for x in sent() if x['method'] in methods and str(x['body'].get('chat_id')) == str(chat)]
last = lambda chat='999': (of(chat) or [{'body': {'text': ''}}])[-1]['body'].get('text', '')
plain = lambda t: N(re.sub('<[^>]+>', '', t))
def kb(x):
    m = x['body'].get('reply_markup') or {}
    m = json.loads(m) if isinstance(m, str) else m
    return [b for row in m.get('inline_keyboard', []) for b in row]
def lastkb(chat):
    msgs = of(chat)
    return kb(msgs[-1]) if msgs else []
cbs = lambda chat: [b.get('callback_data', '') for b in lastkb(chat)]
snap = lambda: json.loads(kv()['snapshot'])
friends = lambda: json.loads(kv()['friends'])
T = datetime.date.today()
iso = lambda d: d.isoformat()
ddmm = lambda d: d.strftime('%d/%m')

tg('/start')
data['debts'].append(debt('d2b', 'Larissa Mota', 300, ago(5), 3))
data['debts'].append(debt('d7', 'Pedro Alves', 200, ago(27), 1, firstDue=iso(T + datetime.timedelta(days=3))))
snapd = dict(data)
snapd['settings'] = {'pixKey': 'joao@pix.com', 'ownerName': 'João Pedro', 'ownerCity': 'São Paulo'}
snapd['invites'] = {'larissa mota': {'code': 'cLARISSA00000001', 'on': True}, 'pedro alves': {'code': 'cPEDRO000000001', 'on': True}}
check(http('PUT', '/api/state', {'snapshot': snapd}, AUTH)[0] == 200, 'dados na nuvem')
tg('gastei 8 cafe')  # gera o resumo pela nuvem
summ = json.loads(kv()['summary'])
check(any(c['key'] == 'larissa mota' for c in summ['charges']), 'resumo tem a Larissa')

# ---------------- 1. entrar: boas-vindas com menu e comandos só pra ela
tg('/start cLARISSA00000001', chat=555, first='Larissa')
welcome = of(555)[-1]
check('Pronto' in welcome['body']['text'] and 'fr:parc' in cbs(555) and 'fr:pago' in cbs(555) and 'fr:prazo' in cbs(555), 'boas-vindas com o menu de botões: %s' % cbs(555))
smc = [x for x in sent() if x['method'] == 'setMyCommands']
check(smc and smc[-1]['body']['scope'] == {'type': 'chat', 'chat_id': '555'} and any(c['command'] == 'parcelas' for c in smc[-1]['body']['commands']), 'comandos aparecem só no chat dela')
tg('/start cPEDRO000000001', chat=666, first='Pedro')
tg('/menu', chat=555)
check('/parcelas' in last('555') and '/pausar' in last('555') and 'fr:hist' in cbs('555'), '/menu explica tudo')

# ---------------- 2. parcelas
tg(cb='fr:parc', chat=555)
t = plain(last('555'))
check('Suas parcelas' in t and 'Empréstimo em 4x' in t and 'Empréstimo em 3x' in t and '1ª' in t and '⏰' in t and 'Em aberto no total' in t, 'parcelas das duas dívidas: %s' % t[:220])
tg('parcelas', chat=555)
check('Suas parcelas' in last('555'), 'funciona escrito também (sem barra)')

# ---------------- 3. PIX com QR
n0 = len(of(555, 'sendPhoto'))
tg('/pix', chat=555)
ph = of(555, 'sendPhoto')
check(len(ph) == n0 + 1 and ph[-1]['body']['photo'].startswith('[file') and 'PIX de' in ph[-1]['body']['caption'], 'manda o QR Code como foto: %s' % (ph[-1]['body'].get('caption', '')[:80] if ph else '-'))
code = re.search(r'<code>([^<]+)</code>', last('555'))
check(code and code.group(1).startswith('000201') and 'joao@pix.com' in code.group(1) and '5802BR' in code.group(1), 'copia e cola com a chave')
other = [b for b in lastkb('555') if b.get('callback_data', '').startswith('fr:pix:')]
check(len(other) >= 2, 'botões para outro valor (cada dívida / tudo): %s' % [b['text'] for b in other])
amt0 = re.search(r'54\d\d([\d.]+)5802', code.group(1)).group(1) if code else ''
tg(cb=other[-1]['callback_data'], chat=555)
code2 = re.search(r'<code>([^<]+)</code>', last('555'))
amt1 = re.search(r'54\d\d([\d.]+)5802', code2.group(1)).group(1) if code2 else ''
check(amt0 and amt1 and amt0 != amt1, 'outro valor muda o PIX (%s → %s)' % (amt0, amt1))

# ---------------- 4. já paguei (valor → comprovante → qual dívida)
tg('já paguei', chat=555)
check('Quanto você pagou' in last('555') and any(c.startswith('fr:pv:') for c in cbs('555')), 'pergunta o valor')
tg('120', chat=555)
check('comprovante' in last('555') and 'fr:np' in cbs('555'), 'pede o comprovante')
tg(photo=True, chat=555)
check('de qual' in last('555') and any(c.startswith('fr:pd:') for c in cbs('555')), 'pergunta de qual dívida')
tg(cb='fr:pd:0', chat=555)
check('Avisei' in last('555') and 'R$ 120,00' in plain(last('555')), 'confirma o envio: %s' % plain(last('555'))[:120])
own = of(999, 'sendPhoto')[-1]
check('Larissa Mota' in own['body']['caption'] and 'diz que pagou' in own['body']['caption'] and own['body']['photo'] == 'big', 'dono recebe com a foto do comprovante')
claim_cb = [b['callback_data'] for b in kb(own) if b['callback_data'].startswith('claim:ok:')][0]
cid = claim_cb.split(':')[2]
check(('cphoto:' + cid) in kv(), 'comprovante guardado pro app')
check(json.loads(kv()['claim:' + cid]).get('debtId') == 'd2', 'pedido aponta pra dívida escolhida')
tg(cb=claim_cb)
check('confirmou seu pagamento' in last('555'), 'Larissa fica sabendo que foi confirmado')
d2 = [d for d in snap()['debts'] if d['id'] == 'd2'][0]
check(any(abs(p['amount'] - 120) < 0.01 for p in d2['payments']), 'pagamento entrou na dívida certa')
# foto com o valor na legenda, de uma vez
tg(photo=True, caption='50', chat=555)
check('de qual' in last('555'), 'foto com legenda: já pega o valor, só pergunta a dívida')
tg(cb='fr:pd:all', chat=555)
own = of(999, 'sendPhoto')[-1]
no_cb = [b['callback_data'] for b in kb(own) if b['callback_data'].startswith('claim:no:')][0]
tg(cb=no_cb)
check('não encontrou' in last('555'), 'recusado: Larissa fica sabendo')
# sem comprovante
tg('/paguei 30', chat=555)
tg(cb='fr:np', chat=555)
if 'de qual' in last('555'): tg(cb='fr:pd:1', chat=555)
check('Avisei' in last('555') and 'sem comprovante' in last('999'), 'dá pra mandar sem comprovante')
tg(cb='claim:no:' + json.loads(kv()['claims'])[-1])

# ---------------- 5. pedir prazo
tg('/prazo', chat=555)
pz = [c for c in cbs('555') if c.startswith('fr:pz:')]
check(len(pz) == 3 and 'Pedir mais prazo' in last('555'), 'prazo: 3 datas prontas')
tg(cb=pz[0], chat=555)
check('Pedido enviado' in last('555'), 'pedido enviado')
check('pediu mais prazo' in last('999') and 'claim:ok:' in json.dumps(of(999)[-1]['body'].get('reply_markup')), 'dono recebe com Aceitar/Recusar')
pz_ok = [b['callback_data'] for b in lastkb('999') if b['callback_data'].startswith('claim:ok:')][0]
tg('/prazo', chat=555)
check('esperando resposta' in last('555'), 'não deixa pedir duas vezes')
tg(cb=pz_ok)
check('aceitou' in last('555'), 'prazo aceito: Larissa fica sabendo')
d20 = T + datetime.timedelta(days=20)
tg('/prazo', chat=555)
tg(ddmm(d20) + ' recebo meu salário', chat=555)
check('Pedido enviado' in last('555') and ddmm(d20) in last('555'), 'data digitada: %s' % plain(last('555'))[:100])
check('recebo meu salário' in last('999'), 'motivo vai junto pro dono')
tg(cb=[b['callback_data'] for b in lastkb('999') if b['callback_data'].startswith('claim:no:')][0])
check('não aceitou' in last('555'), 'prazo recusado: ela fica sabendo')
tg('/prazo amanhã de manhã talvez', chat=555)
check('Não entendi a data' in last('555'), 'data que não dá pra entender')
tg('cancelar', chat=555)
check(last('555').startswith('Cancelado'), 'cancelar o pedido de prazo')

# ---------------- 6. histórico
tg('/historico', chat=555)
t = plain(last('555'))
check('Seus pagamentos' in t and 'R$ 60,00' in t and 'R$ 120,00' in t and 'Total pago' in t, 'histórico: %s' % t[:200])

# ---------------- 8. quando ser lembrado
http('GET', '/__cron')
check(not [x for x in of(666) if 'Lembrete' in x['body'].get('text', '')], 'Pedro (vence em 3 dias) não recebe nada com a véspera padrão')
tg('/lembretes', chat=666)
check('na véspera' in last('666') and 'fr:lead:3' in cbs('666'), '/lembretes mostra as opções')
tg(cb='fr:lead:3', chat=666)
check(friends()['pedro alves'].get('lead') == 3, 'guardou: 3 dias antes')
http('GET', '/__cron')
check('em 3 dias' in plain(last('666')) and 'fr:pago' in cbs('666'), 'lembrete 3 dias antes, com o menu: %s' % plain(last('666'))[:100])

# ---------------- 9. pausar
tg('/lembretes', chat=555)
tg(cb='fr:pmenu', chat=555)
p7 = [c for c in cbs('555') if c.startswith('fr:pause:')]
tg(cb=p7[1], chat=555)
check('Pausado' in last('555') and 'pausou os lembretes' in last('999'), 'pausa e o dono é avisado')
fr = friends(); fr['larissa mota']['sent'] = {}
http('POST', '/__kvset', {'friends': json.dumps(fr)})
n5 = len(of(555))
http('GET', '/__cron')
check(len(of(555)) == n5, 'pausado: o cron não manda nada')
tg('/retomar', chat=555)
check('voltaram' in last('555') and 'voltou a receber' in last('999') and 'pause' not in friends()['larissa mota'], '/retomar')
tg('/pausar 5', chat=555)
check(friends()['larissa mota'].get('pause') == iso(T + datetime.timedelta(days=5)), '/pausar 5 = 5 dias')
tg('/pausar 90', chat=555)
check('Escolha uma data' in last('555'), 'não deixa pausar demais')

# ---------------- 7. recibo
tg('/recibo', chat=666)
check('Ainda não tem dívida quitada' in last('666'), 'recibo antes de quitar')
tg('recebi 200 do pedro')
for _ in range(3):
    ask = [c for c in cbs(999) if c.startswith('ask:')]
    if not ask: break
    tg(cb=ask[0])
docs666 = of(666, 'sendDocument')
check(docs666 and 'recibo de quitação' in docs666[-1]['body']['caption'], 'quitou: recibo chega sozinho pro Pedro')
check('já foi pro Pedro' in of(999, 'sendDocument')[-1]['body']['caption'], 'dono sabe que o recibo já foi')
tg('/recibo', chat=666)
check(len(of(666, 'sendDocument')) == len(docs666) + 1, '/recibo manda de novo quando quiser')
tg('/status', chat=666)
check('Nada em aberto' in last('666'), 'Pedro sem nada em aberto')

# ---------------- segurança e outras mensagens
tg('oi, tudo bem?', chat=555)
check('não repassa mensagens' in last('555') and 'fr:parc' in cbs('555'), 'mensagem solta: explica e mostra o menu')
tg(cb='fr:parc', chat=557)
check(not [x for x in of(557) if 'Larissa' in x['body'].get('text', '') or 'parcela' in x['body'].get('text', '')], 'estranho não vê nada pelos botões')
tg('/parcelas', chat=557)
check('privado' in last('557'), 'estranho: bot privado')
tg('/parar', chat=555)
check([x for x in sent() if x['method'] == 'deleteMyCommands' and x['body']['scope']['chat_id'] == '555'], '/parar tira os comandos')
check('larissa mota' not in friends(), 'saiu')

print('\n%d falha(s)' % len(fails))
sys.exit(1 if fails else 0)
