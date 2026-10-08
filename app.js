(function(){
  "use strict";

  var STORAGE_KEY = "barnabank_debts_v3";
  var SETTINGS_KEY = "barnabank_settings_v1";
  var LAST_EXPORT_KEY = "barnabank_last_export";
  var BANNER_SNOOZE_KEY = "barnabank_backup_banner_snooze";

  var DEFAULT_SETTINGS = {
    currency: 'BRL',
    dateFormat: 'dmy',
    confirmDelete: true,
    backupReminder: true,
    defaultRate: 0,
    defaultLateFee: 0,
    defaultLateInterest: 0,
    pixKey: '',
    ownerName: '',
    pixType: 'auto',
    ownerCity: '',
    defaultWalletId: ''
  };
  function loadSettings(){
    try{
      var raw = localStorage.getItem(SETTINGS_KEY);
      if(raw){
        var parsed = JSON.parse(raw);
        var merged = {};
        Object.keys(DEFAULT_SETTINGS).forEach(function(k){
          merged[k] = (parsed[k] !== undefined) ? parsed[k] : DEFAULT_SETTINGS[k];
        });
        return merged;
      }
    }catch(e){}
    return Object.assign({}, DEFAULT_SETTINGS);
  }
  function saveSettings(){
    try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch(e){ warnSaveFailed(e); }
  }

  var CURRENCY_LOCALE = {BRL:'pt-BR', USD:'en-US', EUR:'de-DE'};
  var money;
  function rebuildMoneyFormatter(){
    var cur = settings.currency || 'BRL';
    var locale = CURRENCY_LOCALE[cur] || 'pt-BR';
    money = new Intl.NumberFormat(locale, {style:'currency', currency:cur});
  }
  var fmtDate = function(iso){
    if(!iso) return '—';
    var p = iso.split('-');
    var yyyy = p[0], mm = p[1], dd = p[2];
    var fmt = settings.dateFormat || 'dmy';
    if(fmt === 'mdy') return mm+'/'+dd+'/'+yyyy.slice(2);
    if(fmt === 'iso') return yyyy+'-'+mm+'-'+dd;
    return dd+'/'+mm+'/'+yyyy.slice(2);
  };
  var todayISO = function(){ return toISO(new Date()); };
  function pad2(n){ return (n<10?'0':'')+n; }
  function toISO(dateObj){ return dateObj.getFullYear()+'-'+pad2(dateObj.getMonth()+1)+'-'+pad2(dateObj.getDate()); }

  // ---------- ícones (Lucide, embutidos no sprite #iconSprite) ----------
  function ic(name, cls){ return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>'; }
  // SVG completo, para documentos gerados à parte (extrato, ranking), onde o sprite não existe
  function icInline(name, attrs){
    var sym = document.getElementById('i-' + name);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (attrs ? ' ' + attrs : '') + '>' + (sym ? sym.innerHTML : '') + '</svg>';
  }
  var WALLET_ICONS = ['wallet','credit-card','landmark','banknote','piggy-bank','coins','vault','smartphone','building','briefcase','gem','gift','shopping-bag','house','car','plane'];
  var EMOJI_TO_ICON = {'💳':'credit-card','🏦':'landmark','🏛':'landmark','💵':'banknote','💴':'banknote','💶':'banknote','💷':'banknote','💸':'banknote',
    '👛':'wallet','👜':'shopping-bag','💰':'coins','🪙':'coins','🐷':'piggy-bank','🐖':'piggy-bank','📱':'smartphone','🏠':'house','🏡':'house',
    '🏢':'building','💼':'briefcase','💎':'gem','🎁':'gift','🛍':'shopping-bag','🚗':'car','✈':'plane'};
  function walletIconKey(icon){
    if(!icon) return 'wallet';
    if(WALLET_ICONS.indexOf(icon) !== -1) return icon;
    var bare = String(icon).replace(/\uFE0F/g, '').trim();
    return EMOJI_TO_ICON[bare] || icon;
  }
  function isIconKey(icon){ return WALLET_ICONS.indexOf(icon) !== -1; }
  function walletIconHtml(w){
    var k = w && w.icon;
    if(!k || isIconKey(k)) return ic(k || 'wallet');
    return '<span class="wi-txt">' + escapeHtml(k) + '</span>';
  }
  function walletLabel(w){ return (w.icon && !isIconKey(w.icon) ? w.icon + ' ' : '') + w.name; }

  // ---------- campos de dinheiro com máscara (1.234,56) ----------
  function fmtMoneyInput(n){ return (n === '' || n == null || isNaN(n)) ? '' : Number(n).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
  function parseMoneyBR(v){
    v = String(v == null ? '' : v).trim();
    if(!v) return NaN;
    if(v.indexOf(',') >= 0) v = v.replace(/\./g, '').replace(',', '.');
    else if(!/^-?\d+\.\d{1,2}$/.test(v)) v = v.replace(/\./g, '');
    var n = parseFloat(v.replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? NaN : n;
  }
  function moneyVal(el){ return parseMoneyBR(el && el.value); }
  function setMoney(el, n){ if(el) el.value = fmtMoneyInput(n); }
  function maskMoneyValue(v, deleting){
    v = String(v || '');
    if(!deleting){
      if(/\.$/.test(v) && v.indexOf(',') === -1) v = v.slice(0, -1) + ',';
      else if(v.indexOf(',') === -1 && /^\d+\.\d{1,2}$/.test(v)) v = v.replace('.', ',');
    }
    var hasComma = v.indexOf(',') >= 0;
    var parts = v.split(',');
    var intDigits = parts[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    var dec = hasComma ? parts.slice(1).join('').replace(/\D/g, '').slice(0, 2) : '';
    if(!intDigits && !hasComma) return '';
    return (intDigits || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (hasComma ? ',' + dec : '');
  }
  document.addEventListener('input', function(e){
    var t = e.target;
    if(!t.classList || !t.classList.contains('money')) return;
    var nv = maskMoneyValue(t.value, /^delete/.test(e.inputType || ''));
    if(nv !== t.value) t.value = nv;
  }, true);
  document.addEventListener('blur', function(e){
    var t = e.target;
    if(!t.classList || !t.classList.contains('money') || !t.value) return;
    var n = parseMoneyBR(t.value);
    if(!isNaN(n)) t.value = fmtMoneyInput(n);
  }, true);
  function nameKey(name){ return (name||'').trim().toLowerCase(); }

  // ---------- wallets (carteiras) ----------
  function walletEvents(walletId){
    var events = [];
    state.transactions.forEach(function(t){
      if(t.type === 'transferencia'){
        var wn = function(id){ var w = state.wallets.find(function(x){ return x.id === id; }); return w ? w.name : 'carteira excluída'; };
        if(t.walletId === walletId) events.push({date: t.date, amount: t.amount, kind: 'gasto', label: 'Transferência para ' + wn(t.toWalletId), note: t.note, isLoan: false, isTransfer: true, id: t.id});
        if(t.toWalletId === walletId) events.push({date: t.date, amount: t.amount, kind: 'entrada', label: 'Transferência de ' + wn(t.walletId), note: t.note, isLoan: false, isTransfer: true, id: t.id});
        return;
      }
      if(t.walletId === walletId) events.push({date: t.date, amount: t.amount, kind: t.type, label: t.category || (t.type==='gasto'?'Gasto':'Entrada'), note: t.note, isLoan: false, id: t.id, auto: t.auto});
    });
    state.debts.forEach(function(d){
      (d.payments||[]).forEach(function(p){
        if(p.walletId === walletId){
          events.push({
            date: p.date, amount: p.amount,
            kind: d.kind === 'payable' ? 'gasto' : 'entrada',
            label: (d.kind === 'payable' ? 'Pagamento para ' : 'Recebido de ') + d.name,
            note: p.note, isLoan: true, debtId: d.id, paymentId: p.id
          });
        }
      });
    });
    return events.sort(function(a,b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  }
  function walletBalance(walletId){
    return walletEvents(walletId).reduce(function(sum, e){ return sum + (e.kind === 'entrada' ? e.amount : -e.amount); }, 0);
  }
  function totalWalletsBalance(){
    return state.wallets.reduce(function(sum, w){ return sum + walletBalance(w.id); }, 0);
  }

  function migrateDebts(arr){
    return (arr || []).map(function(d){
      if(!Array.isArray(d.payments)){
        d.payments = [];
      } else if(d.payments.length && typeof d.payments[0] === 'string'){
        // old format: array of dates, one per full installment
        var n = Math.max(1, Math.round(d.days/30));
        var instVal = (d.principal * Math.pow(1 + (d.rate/100), n)) / n;
        d.payments = d.payments.map(function(dt){ return {date: dt, amount: instVal}; });
      }
      if(typeof d.notes !== 'string') d.notes = '';
      if(d.interestType !== 'simples' && d.interestType !== 'composto' && d.interestType !== 'price') d.interestType = 'composto';
      if(typeof d.lateFeePct !== 'number' || isNaN(d.lateFeePct) || d.lateFeePct < 0) d.lateFeePct = 0;
      if(typeof d.lateInterestPct !== 'number' || isNaN(d.lateInterestPct) || d.lateInterestPct < 0) d.lateInterestPct = 0;
      if(d.kind !== 'payable') d.kind = 'receivable';
      if(typeof d.discount !== 'number' || isNaN(d.discount)) d.discount = 0;
      if(!d.installments || isNaN(d.installments) || d.installments < 1){
        // dado antigo: preserva o número de parcelas que já estava valendo (round(dias/30))
        d.installments = Math.max(1, Math.round((d.days||30)/30));
      }
      if(!d.days || isNaN(d.days)){ d.days = d.installments * 30; }
      if(!d.dueDay){
        var base = d.date ? parseInt(d.date.split('-')[2],10) : 1;
        d.dueDay = base || 1;
      }
      if(d.firstDue && !/^\d{4}-\d{2}-\d{2}$/.test(d.firstDue)) delete d.firstDue;
      if(d.dueOverride){
        if(typeof d.dueOverride !== 'object' || Array.isArray(d.dueOverride)) delete d.dueOverride;
        else { Object.keys(d.dueOverride).forEach(function(k){ if(!/^\d{1,3}$/.test(k) || !/^\d{4}-\d{2}-\d{2}$/.test(d.dueOverride[k])) delete d.dueOverride[k]; }); if(!Object.keys(d.dueOverride).length) delete d.dueOverride; }
      }
      if(d.groupId && typeof d.groupId !== 'string') delete d.groupId;
      delete d.paid;
      return d;
    });
  }

  function isSnapshotMode(){
    try{
      return new URLSearchParams(window.location.search).get('snapshot') === '1';
    }catch(e){ return false; }
  }
  function loadData(){
    var raw = null;
    if(!isSnapshotMode()){
      try{ raw = localStorage.getItem(STORAGE_KEY); }catch(e){}
    }
    var parsed = null;
    if(raw){
      try{ parsed = JSON.parse(raw); }catch(e){ parsed = null; }
    }
    if(!parsed){
      var seedEl = document.getElementById('seed-data');
      try{ parsed = JSON.parse(seedEl.textContent); }catch(e){ parsed = null; }
    }
    if(!parsed) return {debts:[], contacts:{}, wallets:[], transactions:[], groups:[], bills:[], cards:[], cardPurchases:[], cardPayments:[]};
    if(Array.isArray(parsed)) return {debts: migrateDebts(parsed), contacts:{}, wallets:[], transactions:[], groups:[], bills:[], cards:[], cardPurchases:[], cardPayments:[]};
    var contacts = parsed.contacts || {};
    Object.keys(contacts).forEach(function(k){
      if(contacts[k] && typeof contacts[k].phone === 'string'){
        contacts[k].phone = contacts[k].phone.replace(/\D/g,'');
      }
    });
    var wallets = Array.isArray(parsed.wallets) ? parsed.wallets : [];
    wallets.forEach(function(w){ if(w) w.icon = walletIconKey(w.icon); });
    var transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    var debts = migrateDebts(parsed.debts || []);
    var groups = migrateGroups(parsed.groups);
    linkGroups(debts, groups);
    var fin = migrateFinance(parsed);
    return {debts: debts, contacts: contacts, wallets: wallets, transactions: transactions, groups: groups,
      bills: fin.bills, cards: fin.cards, cardPurchases: fin.cardPurchases, cardPayments: fin.cardPayments,
      budgets: fin.budgets, goals: fin.goals, nudges: fin.nudges, recurring: fin.recurring, shares: fin.shares, tgLog: fin.tgLog, catRules: fin.catRules, invites: fin.invites};
  }
  // contas fixas e cartões: só aceita registros com o mínimo necessário
  function migrateFinance(p){
    p = p || {};
    var num = function(v){ return typeof v === 'number' && !isNaN(v); };
    var day = function(v){ v = parseInt(v, 10); return v >= 1 && v <= 31 ? v : 1; };
    var bills = (Array.isArray(p.bills) ? p.bills : []).filter(function(b){ return b && b.id && typeof b.name === 'string' && num(b.amount); }).map(function(b){
      b.kind = b.kind === 'entrada' ? 'entrada' : 'gasto'; b.dueDay = day(b.dueDay);
      if(!b.paid || typeof b.paid !== 'object') b.paid = {};
      return b;
    });
    var cards = (Array.isArray(p.cards) ? p.cards : []).filter(function(c){ return c && c.id && typeof c.name === 'string'; }).map(function(c){
      c.closingDay = day(c.closingDay); c.dueDay = day(c.dueDay); if(!num(c.limit)) c.limit = 0;
      return c;
    });
    var cardIds = {};
    cards.forEach(function(c){ cardIds[c.id] = true; });
    var cardPurchases = (Array.isArray(p.cardPurchases) ? p.cardPurchases : []).filter(function(x){
      return x && x.id && cardIds[x.cardId] && num(x.amount) && x.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '');
    });
    var cardPayments = (Array.isArray(p.cardPayments) ? p.cardPayments : []).filter(function(x){
      return x && x.id && cardIds[x.cardId] && num(x.amount) && /^\d{4}-\d{2}$/.test(x.invoice || '');
    });
    var budgets = {};
    if(p.budgets && typeof p.budgets === 'object' && !Array.isArray(p.budgets)){
      Object.keys(p.budgets).forEach(function(k){ var v = p.budgets[k]; if(num(v) && v > 0 && k.trim()) budgets[k.trim()] = Math.round(v * 100) / 100; });
    }
    var goals = (Array.isArray(p.goals) ? p.goals : []).filter(function(g){ return g && g.id && typeof g.name === 'string' && num(g.target) && g.target > 0; }).map(function(g){
      g.adds = (Array.isArray(g.adds) ? g.adds : []).filter(function(a){ return a && num(a.amount); });
      if(typeof g.walletId !== 'string') g.walletId = '';
      if(typeof g.deadline !== 'string' || (g.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(g.deadline))) g.deadline = '';
      return g;
    });
    var nudges = {};
    if(p.nudges && typeof p.nudges === 'object'){
      Object.keys(p.nudges).forEach(function(k){ if(/^\d{4}-\d{2}-\d{2}$/.test(p.nudges[k])) nudges[k] = p.nudges[k]; });
    }
    var walletIds = {};
    (Array.isArray(p.wallets) ? p.wallets : []).forEach(function(w){ if(w && w.id) walletIds[w.id] = true; });
    var recurring = (Array.isArray(p.recurring) ? p.recurring : []).filter(function(r){
      return r && r.id && num(r.amount) && r.amount > 0 && typeof r.walletId === 'string' && /^\d{4}-\d{2}$/.test(r.start || '');
    }).map(function(r){
      r.type = r.type === 'entrada' ? 'entrada' : 'gasto'; r.day = day(r.day);
      if(!r.posted || typeof r.posted !== 'object') r.posted = {};
      if(typeof r.category !== 'string') r.category = '';
      return r;
    });
    var shares = {};
    if(p.shares && typeof p.shares === 'object' && !Array.isArray(p.shares)){
      Object.keys(p.shares).forEach(function(t){
        var sh = p.shares[t];
        if(/^[A-Za-z0-9]{16,40}$/.test(t) && sh && (sh.type === 'person' || sh.type === 'group' || sh.type === 'debt') && typeof sh.ref === 'string') shares[t] = sh;
      });
    }
    var tgLog = {}, cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    if(p.tgLog && typeof p.tgLog === 'object'){
      Object.keys(p.tgLog).forEach(function(k){ var l = p.tgLog[k]; if(l && typeof l === 'object' && (l.at || '') >= cutoff) tgLog[k] = l; });
    }
    var invites = {};
    if(p.invites && typeof p.invites === 'object' && !Array.isArray(p.invites)){
      Object.keys(p.invites).forEach(function(k){ var iv = p.invites[k]; if(iv && typeof iv === 'object' && /^[A-Za-z0-9]{8,40}$/.test(iv.code || '')) invites[k] = {code: iv.code, on: iv.on !== false, created: iv.created || ''}; });
    }
    var catRules = {};
    if(p.catRules && typeof p.catRules === 'object'){ Object.keys(p.catRules).forEach(function(k){ if(typeof p.catRules[k] === 'string') catRules[k] = p.catRules[k]; }); }
    return {bills: bills, cards: cards, cardPurchases: cardPurchases, cardPayments: cardPayments, budgets: budgets, goals: goals, nudges: nudges, recurring: recurring, shares: shares, tgLog: tgLog, catRules: catRules, invites: invites};
  }
  // ---------- grupos (vaquinha / conta dividida) ----------
  function migrateGroups(arr){
    return (Array.isArray(arr) ? arr : []).filter(function(g){ return g && g.id && typeof g.title === 'string'; }).map(function(g){
      if(g.kind !== 'payable') g.kind = 'receivable';
      if(typeof g.total !== 'number' || isNaN(g.total) || g.total < 0) g.total = 0;
      if(g.splitMode !== 'custom') g.splitMode = 'equal';
      g.includeMe = g.kind === 'receivable' && !!g.includeMe;
      if(typeof g.myShare !== 'number' || isNaN(g.myShare) || g.myShare < 0) g.myShare = 0;
      if(!g.includeMe) g.myShare = 0;
      if(typeof g.notes !== 'string') g.notes = '';
      if(typeof g.walletId !== 'string') g.walletId = '';
      return g;
    });
  }
  // dívidas apontando para grupo que não existe mais viram individuais
  function linkGroups(debts, groups){
    var ids = {};
    groups.forEach(function(g){ ids[g.id] = true; });
    debts.forEach(function(d){ if(d.groupId && !ids[d.groupId]) delete d.groupId; });
  }
  // divide sem perder centavo: R$ 100 / 3 = 33,34 + 33,33 + 33,33
  function splitEqual(total, count){
    var cents = Math.round(total * 100);
    var base = Math.floor(cents / count);
    var extra = cents - base * count;
    var shares = [];
    for(var i = 0; i < count; i++) shares.push((base + (i < extra ? 1 : 0)) / 100);
    return shares;
  }
  var saveFailedWarned = false;
  function warnSaveFailed(err){
    if(saveFailedWarned) return;
    saveFailedWarned = true;
    var msg = 'Não consegui salvar neste navegador' + (err && err.name === 'QuotaExceededError' ? ' (armazenamento cheio)' : '') +
      '. Exporte um backup JSON agora para não perder nada.';
    if(typeof showToast === 'function') showToast(msg, 'triangle-alert');
    try{ console.error('BarnaBank: falha ao salvar', err); }catch(e){}
  }
  function saveData(){
    invalidateSchedules();
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        debts: state.debts, contacts: state.contacts, wallets: state.wallets, transactions: state.transactions, groups: state.groups,
        bills: state.bills, cards: state.cards, cardPurchases: state.cardPurchases, cardPayments: state.cardPayments,
        budgets: state.budgets, goals: state.goals, nudges: state.nudges, recurring: state.recurring, shares: state.shares, tgLog: state.tgLog, catRules: state.catRules, invites: state.invites
      }));
      saveFailedWarned = false;
      if(typeof cloudSchedule === 'function') cloudSchedule();
      if(typeof histSchedule === 'function') histSchedule();
    }catch(e){ warnSaveFailed(e); }
  }
  // backup completo: tudo que o app guarda
  function buildBackup(){
    return {
      app: 'BarnaBank', version: 2, exportedAt: new Date().toISOString(),
      debts: state.debts, contacts: state.contacts,
      wallets: state.wallets, transactions: state.transactions,
      groups: state.groups,
      bills: state.bills, cards: state.cards, cardPurchases: state.cardPurchases, cardPayments: state.cardPayments,
      budgets: state.budgets, goals: state.goals, nudges: state.nudges, recurring: state.recurring, shares: state.shares, catRules: state.catRules, invites: state.invites, tgLog: state.tgLog,
      receipts: typeof receiptsForBackup === 'function' ? receiptsForBackup() : {},
      settings: settings
    };
  }

  var settings = loadSettings();
  rebuildMoneyFormatter();
  var loaded = loadData();
  var state = {
    debts: loaded.debts,
    contacts: loaded.contacts,
    wallets: loaded.wallets,
    transactions: loaded.transactions,
    groups: loaded.groups,
    bills: loaded.bills,
    cards: loaded.cards,
    cardPurchases: loaded.cardPurchases,
    cardPayments: loaded.cardPayments,
    budgets: loaded.budgets || {},
    goals: loaded.goals || [],
    nudges: loaded.nudges || {},
    recurring: loaded.recurring || [],
    shares: loaded.shares || {},
    tgLog: loaded.tgLog || {},
    invites: loaded.invites || {},
    catRules: loaded.catRules || {},
    openId: null,
    openGroupId: null,
    openGroups: {},
    filter: 'pendentes',
    sort: 'due',
    cardTab: {},
    personKey: null,
    prevPage: 'pessoas',
    query: '',
    grouped: false,
    viewKind: 'receivable',
    editingId: null,
    pendingDeleteId: null,
    page: 'dashboard',
    openWalletId: null
  };

  function installments(d){ return Math.max(1, d.installments || 1); }
  // Valor total contratado (sem encargos de atraso)
  function finalValue(d){
    var n = installments(d);
    var r = (d.rate||0)/100;
    if(d.interestType === 'simples'){
      return d.principal * (1 + r * n);
    }
    if(d.interestType === 'price'){
      if(r <= 0) return d.principal;
      return n * (d.principal * r / (1 - Math.pow(1 + r, -n)));
    }
    return d.principal * Math.pow(1 + r, n);
  }
  function installmentValue(d){ return finalValue(d) / installments(d); }
  function paidAmount(d){
    return (d.payments||[]).reduce(function(sum,p){ return sum + (p.amount||0); }, 0);
  }
  function round2(v){ return Math.round(v*100)/100; }
  function daysBetweenISO(a, b){
    var da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
    return Math.round((db - da)/86400000);
  }
  function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
  function dueDateForInstallment(d, idx){
    // idx: 0-based installment index
    if(d.dueOverride && d.dueOverride[idx]) return new Date(d.dueOverride[idx] + 'T00:00:00');
    if(d.firstDue){
      // vencimento da 1ª parcela definido direto (ex.: grupo com data de pagamento)
      var f = new Date(d.firstDue + 'T00:00:00');
      var tm = f.getMonth() + idx;
      var fy = f.getFullYear() + Math.floor(tm/12), fm = tm % 12;
      return new Date(fy, fm, Math.min(f.getDate(), daysInMonth(fy, fm)));
    }
    var base = new Date(d.date + 'T00:00:00');
    var totalMonths = base.getMonth() + idx + 1;
    var y = base.getFullYear() + Math.floor(totalMonths/12);
    var m = totalMonths % 12;
    var day = Math.min(d.dueDay || base.getDate(), daysInMonth(y,m));
    return new Date(y, m, day);
  }

  // ---------- motor de parcelas ----------
  // Reproduz todos os pagamentos em ordem de data e calcula, parcela por parcela,
  // quanto foi pago, quanto falta e os encargos de atraso (multa + juros de mora).
  // Tipos de pagamento:
  //   mode 'target' → paga primeiro `pendingPart` das parcelas anteriores em atraso
  //                   (pendentes), depois a parcela `target`; o que sobrar adianta as
  //                   próximas parcelas e, no fim, abate atrasados; o resto vira crédito.
  //   mode 'fifo' (ou pagamentos antigos sem mode) → abate da parcela mais antiga em aberto.
  var EPS = 0.005;
  var scheduleCache = null;
  function invalidateSchedules(){ scheduleCache = null; }
  function debtSchedule(d){
    var today = todayISO();
    if(!scheduleCache || scheduleCache.day !== today) scheduleCache = {day: today, map: {}};
    var key = d.id + '|' + JSON.stringify([d.principal, d.rate, d.interestType, d.installments, d.date, d.dueDay, d.discount, d.lateFeePct, d.lateInterestPct, d.settledDate, d.firstDue, d.dueOverride, d.payments]);
    var hit = scheduleCache.map[d.id];
    if(hit && hit.key === key) return hit.sched;
    var sched = computeSchedule(d, today);
    scheduleCache.map[d.id] = {key: key, sched: sched};
    return sched;
  }
  function computeSchedule(d, asOf){
    var n = installments(d);
    var V = installmentValue(d);
    var multaPct = Math.max(0, d.lateFeePct || 0);
    var moraPct = Math.max(0, d.lateInterestPct || 0);
    var hasPenalty = multaPct > 0 || moraPct > 0;
    var insts = [];
    for(var i=0;i<n;i++){
      var due = dueDateForInstallment(d, i);
      insts.push({i: i, due: due, dueISO: toISO(due), value: V, rem: V, paid: 0, pen: 0, penPaid: 0, multaDone: false, lastISO: null, touched: false, lastPayISO: null});
    }
    function accrue(inst, tISO){
      if(!hasPenalty || tISO <= inst.dueISO) return;
      if(inst.rem > EPS){
        if(!inst.multaDone){ inst.pen += inst.rem * multaPct/100; inst.multaDone = true; }
        var from = (inst.lastISO && inst.lastISO > inst.dueISO) ? inst.lastISO : inst.dueISO;
        var days = daysBetweenISO(from, tISO);
        if(days > 0) inst.pen += inst.rem * (moraPct/100/30) * days;
      }
      inst.lastISO = tISO;
    }
    function payInst(inst, amount, tISO){
      if(amount <= 0) return 0;
      accrue(inst, tISO);
      var a = Math.min(amount, inst.pen);
      inst.pen -= a; inst.penPaid += a; amount -= a;
      var b = Math.min(amount, inst.rem);
      inst.rem -= b; inst.paid += b; amount -= b;
      if(a + b > 0){ inst.touched = true; inst.lastPayISO = tISO; }
      return amount;
    }
    function payRange(from, to, amount, tISO){
      for(var k=from;k<to && amount > EPS;k++) amount = payInst(insts[k], amount, tISO);
      return amount;
    }
    // em qual data os encargos param de correr (dívida quitada c/ desconto)
    var endISO = asOf;
    if(d.settledDate) endISO = d.settledDate < asOf ? d.settledDate : asOf;
    else if((d.discount||0) > EPS && (d.payments||[]).length){
      endISO = (d.payments||[]).reduce(function(mx,p){ return p.date > mx ? p.date : mx; }, '0000-00-00');
    }
    var credit = 0;
    var ordered = (d.payments||[]).map(function(p, idx){ return {p:p, idx:idx}; });
    ordered.sort(function(a,b){ return a.p.date < b.p.date ? -1 : (a.p.date > b.p.date ? 1 : a.idx - b.idx); });
    ordered.forEach(function(o){
      var p = o.p, t = p.date, left = p.amount || 0;
      if(p.mode === 'target' && typeof p.target === 'number'){
        var tgt = Math.max(0, Math.min(n-1, p.target));
        var pend = Math.min(left, Math.max(0, p.pendingPart || 0));
        var pendLeft = payRange(0, tgt, pend, t);
        left = left - pend + pendLeft;
        left = payRange(tgt, n, left, t);  // parcela escolhida + adiantamento
        left = payRange(0, tgt, left, t);  // sobrou depois da última? abate atrasados
      } else {
        left = payRange(0, n, left, t);
      }
      credit += left;
    });
    insts.forEach(function(inst){ accrue(inst, endISO); });
    // desconto concedido na quitação
    var disc = Math.max(0, d.discount || 0);
    insts.forEach(function(inst){
      if(disc <= EPS) return;
      var a = Math.min(disc, inst.pen); inst.pen -= a; disc -= a;
      var b = Math.min(disc, inst.rem); inst.rem -= b; disc -= b;
      inst.discounted = (inst.discounted||0) + a + b;
    });
    var open = 0, penCharged = 0, overdue = 0, overdueCount = 0;
    insts.forEach(function(inst){
      inst.open = inst.rem + inst.pen;
      if(inst.open <= EPS){ inst.open = 0; inst.rem = 0; inst.pen = 0; }
      inst.late = inst.open > 0 && inst.dueISO < asOf;
      inst.state = inst.open === 0 ? 'paga' : (inst.late ? 'atrasada' : (inst.touched ? 'parcial' : 'aberta'));
      open += inst.open;
      if(inst.late){ overdue += inst.open; overdueCount++; }
    });
    // encargos gerados = pagos + ainda devidos (o perdoado entra em d.discount)
    penCharged = insts.reduce(function(s, inst){ return s + inst.penPaid + inst.pen; }, 0);
    var firstOpen = null;
    for(var k=0;k<n;k++){ if(insts[k].open > 0){ firstOpen = insts[k]; break; } }
    // parcela "da vez" para o formulário: a primeira em aberto que não é uma parcial já vencida
    var target = null;
    for(var j=0;j<n;j++){
      var it = insts[j];
      if(it.open > 0 && !(it.touched && it.late)){ target = it; break; }
    }
    var pending = 0, pendingList = [];
    insts.forEach(function(it){
      if(it.open > 0 && (target === null || it.i < target.i)){ pending += it.open; pendingList.push(it); }
    });
    return {
      insts: insts, open: round2(open), credit: round2(credit), penaltiesCharged: penCharged,
      penaltiesOpen: insts.reduce(function(s,it){ return s + it.pen; }, 0),
      overdue: overdue, overdueCount: overdueCount, firstOpen: firstOpen,
      target: target, pending: pending, pendingList: pendingList
    };
  }
  function effectiveTotal(d){ var s = debtSchedule(d); return Math.max(0, finalValue(d) + s.penaltiesCharged - (d.discount||0)); }
  function remaining(d){ return debtSchedule(d).open; }
  function creditOf(d){ return debtSchedule(d).credit; }
  function profit(d){ return effectiveTotal(d) - d.principal; }
  function isPaid(d){ return remaining(d) <= EPS && (paidAmount(d) > 0 || (d.discount||0) > 0); }
  function progressPct(d){
    var paid = Math.min(paidAmount(d), effectiveTotal(d)), total = paid + remaining(d);
    return Math.max(0, Math.min(100, (paid/(total||1))*100));
  }
  function overdueAmount(d){ return debtSchedule(d).overdue; }
  // valor que está "na mesa" agora: atrasado (se houver) ou a próxima parcela em aberto
  function amountDueNow(d){
    var s = debtSchedule(d);
    if(s.overdue > 0) return s.overdue;
    return s.firstOpen ? s.firstOpen.open : 0;
  }
  // quanto vence (em aberto) num dado mês, incluindo o que já está atrasado se for o mês atual
  function openInMonth(d, y, m){
    var s = debtSchedule(d), now = new Date(), isCurrent = now.getFullYear() === y && now.getMonth() === m;
    return s.insts.reduce(function(sum, it){
      if(it.open <= 0) return sum;
      var sameMonth = it.due.getFullYear() === y && it.due.getMonth() === m;
      return sum + ((sameMonth || (isCurrent && it.late)) ? it.open : 0);
    }, 0);
  }
  // compatibilidade: quantas parcelas estão totalmente pagas
  function installmentsCovered(d){
    return debtSchedule(d).insts.filter(function(it){ return it.open === 0; }).length;
  }
  function nextDueDate(d){
    if(isPaid(d)) return null;
    var s = debtSchedule(d);
    return s.firstOpen ? s.firstOpen.due : null;
  }
  function daysUntilDue(d){
    var due = nextDueDate(d);
    if(!due) return null;
    var t = new Date(); t.setHours(0,0,0,0);
    var dd = new Date(due); dd.setHours(0,0,0,0);
    return Math.round((dd - t)/86400000);
  }
  function statusOf(d){
    if(isPaid(d)) return 'pago';
    var diff = daysUntilDue(d);
    if(diff === null) return 'pago';
    if(diff < 0) return 'atrasado';
    if(diff === 0) return 'hoje';
    if(diff <= 7) return 'embreve';
    return 'emdia';
  }
  function statusLabel(d){
    var s = statusOf(d);
    var diff = daysUntilDue(d);
    if(s === 'pago') return (d.discount||0) > 0.005 ? 'Pago (c/ desconto)' : 'Pago';
    if(s === 'atrasado') return money.format(overdueAmount(d)) + ' atrasado · ' + Math.abs(diff) + 'd';
    if(s === 'hoje') return 'Vence hoje';
    if(s === 'embreve') return 'Vence em ' + diff + (diff===1?' dia':' dias');
    return 'Em dia';
  }
  function interestTypeLabel(t){ return t === 'simples' ? 'simples' : (t === 'price' ? 'Tabela Price' : 'composto'); }
  function initials(name){
    var parts = name.trim().split(/\s+/);
    var s = parts[0] ? parts[0][0] : '?';
    if(parts.length > 1) s += parts[parts.length-1][0];
    return s.toUpperCase();
  }
  function escapeHtml(s){ var div = document.createElement('div'); div.textContent = s; return div.innerHTML; }
  function onlyDigits(s){ return (s||'').replace(/\D/g,''); }
  function whatsPhone(name){
    var contact = state.contacts[nameKey(name)];
    var phone = contact ? onlyDigits(contact.phone) : '';
    if(!phone) return '';
    return phone.length <= 11 ? '55' + phone : phone; // assume BR se não tiver DDI
  }
  function whatsappLink(d){
    var phone = whatsPhone(d.name);
    if(!phone) return null;
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(whatsappMessage(d));
  }
  function whatsappMessage(d){
    var due = nextDueDate(d);
    var msg;
    var st = statusOf(d);
    var sch = debtSchedule(d);
    var wg = groupOf(d);
    if(wg && installments(d) === 1){
      msg = st === 'atrasado'
        ? 'Oi ' + d.name + ', tudo bem? Sobre o *' + wg.title + '*: sua parte de ' + money.format(remaining(d)) + ' ficou em aberto (era até ' + fmtDate(toISO(due)) + '). Consegue acertar comigo? 🙂'
        : 'Oi ' + d.name + ', tudo bem? Sobre o *' + wg.title + '*: sua parte ficou ' + money.format(remaining(d)) + (due ? ', pra pagar até ' + fmtDate(toISO(due)) : '') + '. Qualquer coisa me avisa 🙂';
    } else if(st === 'atrasado'){
      msg = 'Oi ' + d.name + ', tudo bem? Passando pra lembrar que ' +
        (sch.overdueCount > 1 ? 'tem ' + sch.overdueCount + ' parcelas em aberto, somando ' : 'ficou em aberto ') +
        money.format(sch.overdue) + ' (vencimento em ' + fmtDate(toISO(due)) + '). Consegue acertar comigo? Pode ser uma parte também 🙂';
    } else if(st === 'hoje'){
      msg = 'Oi ' + d.name + ', tudo bem? Só passando pra lembrar que sua parcela de ' + money.format(amountDueNow(d)) + ' vence hoje. Consegue enviar? 🙂';
    } else {
      msg = 'Oi ' + d.name + ', tudo bem? Sua próxima parcela é de ' + money.format(amountDueNow(d)) + (due ? (', vencimento em ' + fmtDate(toISO(due))) : '') + '. Qualquer coisa me avisa 🙂';
    }
    if(settings.pixKey) msg += '\nPIX: ' + settings.pixKey;
    var slink = shareLinkFor('debt', d.id) || shareLinkFor('person', nameKey(d.name));
    if(slink) msg += '\nDetalhes: ' + slink;
    return msg;
  }

  var listEl = document.getElementById('list');

  function render(){
    renderStats();
    renderSmartCards();
    renderChart();
    renderDuePanel();
    renderGroups();
    renderList();
    renderLateBar();
    if(typeof renderClaims === 'function') renderClaims();
    renderAll();
    saveData();
    if(typeof checkNewlyPaid === 'function') checkNewlyPaid();
    if(typeof syncSheet === 'function') syncSheet();
  }

  // ---------- smart dashboard cards ----------
  function renderSmartCards(){
    var isPayable = state.viewKind === 'payable';
    var pool = state.debts.filter(function(d){ return d.kind === state.viewKind; });
    var pending = pool.filter(function(d){ return !isPaid(d); });

    document.getElementById('scLateLabel').innerHTML = ic('triangle-alert') + ' Em atraso';
    document.getElementById('scMonthLabel').innerHTML = ic('coins') + (isPayable ? ' Pagar este mês' : ' Receber este mês');
    document.getElementById('scBestLabel').innerHTML = ic('trophy') + (isPayable ? ' Credor mais cobrado' : ' Melhor pagador');

    // próximo vencimento
    var withDue = pending.map(function(d){ return {d:d, due: nextDueDate(d)}; }).filter(function(x){ return x.due; });
    withDue.sort(function(a,b){ return a.due - b.due; });
    var scNextDue = document.getElementById('scNextDue');
    if(withDue.length){
      var item = withDue[0];
      var diff = daysUntilDue(item.d);
      var whenStr = diff < 0 ? Math.abs(diff) + 'd atrasado' : diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : 'em ' + diff + 'd';
      scNextDue.textContent = item.d.name + ' · ' + whenStr;
      scNextDue.title = money.format(amountDueNow(item.d));
    } else {
      scNextDue.innerHTML = 'Nada pendente ' + ic('party-popper', 'i-ok');
    }

    // em atraso
    var lateDebts = pending.filter(function(d){ return statusOf(d) === 'atrasado'; });
    var lateSum = lateDebts.reduce(function(s, d){ return s + overdueAmount(d); }, 0);
    document.getElementById('scLate').textContent = lateDebts.length > 0 ? (money.format(lateSum) + ' · ' + lateDebts.length + (lateDebts.length===1?' dívida':' dívidas')) : '0';

    // receber/pagar este mês
    var now = new Date(); var y = now.getFullYear(), m = now.getMonth();
    var monthTotal = 0;
    pending.forEach(function(d){ monthTotal += openInMonth(d, y, m); });
    document.getElementById('scMonth').textContent = money.format(monthTotal);
    var rl = document.getElementById('resumoLine');
    if(rl){
      var parts = [];
      if(lateSum > EPS) parts.push('<b class="neg">' + money.format(lateSum) + '</b> em atraso');
      if(monthTotal > EPS) parts.push('<b>' + money.format(monthTotal) + '</b> ' + (isPayable ? 'a pagar' : 'a receber') + ' este mês');
      rl.innerHTML = parts.length ? parts.join(' · ') : (pending.length ? 'Tudo em dia' : 'Nada pendente');
    }

    // melhor pagador / mais cobrado
    var byKey = {};
    pool.forEach(function(d){
      var key = nameKey(d.name);
      if(!byKey[key]) byKey[key] = {name: d.name, late: 0, received: 0, count: 0};
      byKey[key].late += (statusOf(d) === 'atrasado' ? 1 : 0);
      byKey[key].received += paidAmount(d);
      byKey[key].count++;
    });
    var people = Object.keys(byKey).map(function(k){ return byKey[k]; });
    var scBest = document.getElementById('scBest');
    if(!people.length){
      scBest.textContent = '—';
    } else {
      people.sort(function(a,b){ if(a.late !== b.late) return a.late - b.late; return b.received - a.received; });
      var best = people[0];
      scBest.innerHTML = escapeHtml(best.name) + (best.late === 0 ? ' ' + ic('badge-check', 'i-ok') : ' (' + best.late + ' atraso' + (best.late>1?'s':'') + ')');
    }
  }

  // ---------- due calendar panel ----------
  function renderDuePanel(){
    var late = [], today = [], soon = [];
    state.debts.filter(function(d){ return d.kind === state.viewKind; }).forEach(function(d){
      var s = statusOf(d);
      if(s === 'atrasado') late.push(d);
      else if(s === 'hoje') today.push(d);
      else if(s === 'embreve') soon.push(d);
    });
    function sortByDue(a,b){
      var da = nextDueDate(a), db = nextDueDate(b);
      return (da?da.getTime():0) - (db?db.getTime():0);
    }
    late.sort(sortByDue); today.sort(sortByDue); soon.sort(sortByDue);

    function itemHtml(d){
      var due = nextDueDate(d);
      return '<div class="due-item" data-id="'+d.id+'">' +
        '<div><div class="di-name">'+escapeHtml(d.name)+'</div><div class="di-sub">'+statusLabel(d)+' · venc. '+(due?fmtDate(toISO(due)):'—')+'</div></div>' +
        '<div class="di-val">'+money.format(amountDueNow(d))+'</div>' +
      '</div>';
    }
    function fillCol(id, arr){
      var el = document.getElementById(id);
      el.innerHTML = arr.length ? arr.map(itemHtml).join('') : '<div class="due-empty">Nada por aqui</div>';
      el.querySelectorAll('.due-item').forEach(function(it){
        it.addEventListener('click', function(){
          state.openId = it.getAttribute('data-id');
          state.filter = 'todos';
          document.querySelectorAll('#filters button').forEach(function(b){ b.classList.remove('active'); });
          document.querySelector('#filters button[data-f="todos"]').classList.add('active');
          render();
          var card = document.querySelector('.card.open');
          if(card) card.scrollIntoView({behavior:'smooth', block:'center'});
        });
      });
    }
    fillCol('dueLate', late);
    fillCol('dueToday', today);
    fillCol('dueSoon', soon);
  }

  function renderStats(){
    var pool = state.debts.filter(function(d){ return d.kind === state.viewKind; });
    if(state.viewKind === 'payable'){
      var totalDebt=0, totalPending=0, totalPaidP=0, totalDiscountP=0;
      pool.forEach(function(d){
        totalDebt += d.principal;
        totalPending += remaining(d);
        totalPaidP += paidAmount(d);
        totalDiscountP += (d.discount||0);
      });
      document.getElementById('statLabel1').innerHTML = ic('banknote-arrow-up') + ' Total das dívidas';
      document.getElementById('statPrincipal').textContent = money.format(totalDebt);
      document.getElementById('statLabel2').innerHTML = ic('hourglass') + ' Falta pagar';
      document.getElementById('statRemaining').textContent = money.format(totalPending);
      document.getElementById('statLabel3').innerHTML = ic('circle-check') + ' Já pago';
      document.getElementById('statReceived').textContent = money.format(totalPaidP);
      document.getElementById('statLabel4').innerHTML = ic('badge-percent') + ' Descontos conseguidos';
      document.getElementById('statProfit').textContent = money.format(totalDiscountP);
    } else {
      var totalPrincipal=0, totalRemaining=0, totalReceived=0, totalProfit=0;
      pool.forEach(function(d){
        totalPrincipal += d.principal;
        totalRemaining += remaining(d);
        totalReceived += paidAmount(d);
        totalProfit += profit(d);
      });
      document.getElementById('statLabel1').innerHTML = ic('hand-coins') + ' Total emprestado';
      document.getElementById('statPrincipal').textContent = money.format(totalPrincipal);
      document.getElementById('statLabel2').innerHTML = ic('hourglass') + ' A receber ainda';
      document.getElementById('statRemaining').textContent = money.format(totalRemaining);
      document.getElementById('statLabel3').innerHTML = ic('circle-check') + ' Já recebido';
      document.getElementById('statReceived').textContent = money.format(totalReceived);
      document.getElementById('statLabel4').innerHTML = ic('trending-up') + ' Lucro estimado';
      document.getElementById('statProfit').textContent = money.format(totalProfit);
    }
  }

  // ---------- evolution chart ----------
  function buildEvoChartSVG(points, gradId){
    gradId = gradId || 'areaGrad';
    var W = 640, H = 160, padL = 8, padR = 8, padT = 14, padB = 26;
    var dates = points.map(function(p){ return p.date; });
    var minD = dates[0], maxD = dates[dates.length-1];
    var minTime = new Date(minD).getTime(), maxTime = new Date(maxD).getTime();
    var span = Math.max(1, maxTime - minTime);
    var vals = points.map(function(p){ return p.total; });
    var maxVal = Math.max.apply(null, vals.concat([0]));
    var minVal = Math.min.apply(null, vals.concat([0]));
    var range = Math.max(1, maxVal - minVal);

    function x(t){
      if(points.length === 1) return (W-padL-padR)/2 + padL;
      return padL + ((new Date(t).getTime() - minTime) / span) * (W - padL - padR);
    }
    function y(v){
      return H - padB - ((v - minVal) / range) * (H - padT - padB);
    }
    var baselineY = y(0);

    var linePts = points.map(function(p){ return x(p.date).toFixed(1) + ',' + y(p.total).toFixed(1); });
    var lineStr = 'M ' + linePts.join(' L ');
    var areaStr = lineStr + ' L ' + x(points[points.length-1].date).toFixed(1) + ',' + baselineY.toFixed(1) + ' L ' + x(points[0].date).toFixed(1) + ',' + baselineY.toFixed(1) + ' Z';

    var dots = points.map(function(p){
      return '<circle cx="'+x(p.date).toFixed(1)+'" cy="'+y(p.total).toFixed(1)+'" r="3" fill="#e8cd8a" stroke="#0a0c11" stroke-width="1"/>';
    }).join('');

    return '<svg class="evochart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">' +
        '<defs><linearGradient id="'+gradId+'" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#c9a24a" stop-opacity="0.35"/>' +
          '<stop offset="100%" stop-color="#c9a24a" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path d="'+areaStr+'" fill="url(#'+gradId+')" stroke="none"/>' +
        '<path d="'+lineStr+'" fill="none" stroke="#e8cd8a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        dots +
        '<text x="'+padL+'" y="'+(H-6)+'" font-size="10" fill="#8c92a3" font-family="Nunito, sans-serif">'+fmtDate(minD)+'</text>' +
        '<text x="'+(W-padR)+'" y="'+(H-6)+'" font-size="10" fill="#8c92a3" font-family="Nunito, sans-serif" text-anchor="end">'+fmtDate(maxD)+'</text>' +
      '</svg>';
  }

  function renderChart(){
    var holder = document.getElementById('chartHolder');
    var sub = document.getElementById('chartSub');
    var isPayable = state.viewKind === 'payable';
    document.getElementById('chartTitle').textContent = isPayable ? 'Evolução do quanto você já pagou' : 'Evolução do quanto você já recebeu';
    var events = [];
    state.debts.filter(function(d){ return d.kind === state.viewKind; }).forEach(function(d){
      (d.payments||[]).forEach(function(p){ events.push({date:p.date, amount:p.amount}); });
    });
    if(events.length === 0){
      holder.innerHTML = '<div class="chart-empty">Assim que você marcar o primeiro pagamento, o gráfico aparece aqui.</div>';
      sub.textContent = '';
      return;
    }
    events.sort(function(a,b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var cum = 0;
    var points = events.map(function(e){ cum += e.amount; return {date:e.date, total:cum}; });

    sub.textContent = money.format(cum) + (isPayable ? ' pagos até agora' : ' recebidos até agora');
    holder.innerHTML = buildEvoChartSVG(points, 'areaGradPessoas');
  }

  // ---------- list rendering ----------
  function applyFilterSortSearch(items){
    var q = state.query.trim().toLowerCase();
    var out = items.filter(function(d){
      if(state.filter === 'pendentes' && isPaid(d)) return false;
      if(state.filter === 'pagos' && !isPaid(d)) return false;
      if(state.filter === 'atrasados' && statusOf(d) !== 'atrasado') return false;
      if(q && d.name.toLowerCase().indexOf(q) === -1 && !(groupOf(d) && groupOf(d).title.toLowerCase().indexOf(q) !== -1)) return false;
      return true;
    });
    out.sort(function(a,b){
      switch(state.sort){
        case 'due':
          if(isPaid(a) !== isPaid(b)) return isPaid(a) ? 1 : -1;
          if(isPaid(a)) return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
          var da = nextDueDate(a), db = nextDueDate(b);
          return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
        case 'oldest': return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
        case 'valueDesc': return finalValue(b) - finalValue(a);
        case 'valueAsc': return finalValue(a) - finalValue(b);
        case 'statusPendingFirst':
          if(isPaid(a) !== isPaid(b)) return isPaid(a) ? 1 : -1;
          return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
        case 'recent':
        default: return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
      }
    });
    return out;
  }

  function renderList(){
    listEl.innerHTML = '';
    var pool = state.debts.filter(function(d){ return d.kind === state.viewKind; });
    var items = applyFilterSortSearch(pool);
    var isPayable = state.viewKind === 'payable';

    var archived = pool.filter(isPaid).length;
    var ac = document.getElementById('archiveCount');
    if(ac) ac.textContent = archived ? archived : '';
    if(items.length === 0){
      var empty = document.createElement('div');
      empty.className = 'empty';
      var hasGroups = groupListEl && groupListEl.children.length > 0;
      if(pool.length === 0) empty.textContent = isPayable ? 'Nenhuma dívida sua cadastrada ainda. Toque em "Nova dívida" para começar.' : 'Nenhuma dívida cadastrada ainda. Toque em "Nova dívida" para começar.';
      else if(state.query.trim()) empty.textContent = 'Nada encontrado para "' + state.query.trim() + '".';
      else if(state.filter === 'pendentes') empty.innerHTML = ic('party-popper', 'i-ok') + ' Tudo quitado! ' + (archived ? 'As dívidas pagas estão no Arquivo.' : '');
      else if(state.filter === 'atrasados') empty.innerHTML = ic('circle-check', 'i-ok') + ' Nenhuma dívida atrasada.';
      else if(state.filter === 'pagos') empty.textContent = 'O Arquivo está vazio. Dívidas quitadas aparecem aqui.';
      else empty.textContent = 'Nenhuma dívida encontrada com esse filtro.';
      if(!(hasGroups && state.filter !== 'todos' && pool.length)) listEl.appendChild(empty);
      placeOpenDetail();
      return;
    }

    if(!state.grouped){
      items.forEach(function(d){ listEl.appendChild(buildCard(d)); });
      placeOpenDetail();
      return;
    }

    // grouped by name (case/whitespace-insensitive), preserving sort order of first appearance
    var groups = [];
    var byKey = {};
    var displayName = {};
    items.forEach(function(d){
      var key = d.name.trim().toLowerCase();
      if(!byKey[key]){ byKey[key] = []; groups.push(key); displayName[key] = d.name; }
      byKey[key].push(d);
    });

    groups.forEach(function(key){
      var debts = byKey[key];
      var name = displayName[key];
      var totalPrincipal=0, totalRemaining=0;
      debts.forEach(function(d){ totalPrincipal += d.principal; totalRemaining += remaining(d); });
      var open = !!state.openGroups[key];

      var g = document.createElement('div');
      g.className = 'group' + (open ? ' open' : '');

      var gh = document.createElement('div');
      gh.className = 'group-head';
      gh.innerHTML =
        '<div class="avatar">' + initials(name) + '</div>' +
        '<div class="name">' + escapeHtml(name) + ' <span style="color:var(--muted);font-weight:400;font-size:12px;">(' + debts.length + (debts.length===1?' dívida':' dívidas') + ')</span></div>' +
        '<div class="gstat">' + (isPayable ? 'falta pagar' : 'falta receber') + '<b>' + money.format(totalRemaining) + '</b></div>' +
        '<div class="chev">' + ic('chevron-down') + '</div>';
      gh.addEventListener('click', function(){
        state.openGroups[key] = !state.openGroups[key];
        render();
      });
      g.appendChild(gh);

      if(open){
        var children = document.createElement('div');
        children.className = 'group-children';
        debts.forEach(function(d){ children.appendChild(buildCard(d)); });
        g.appendChild(children);
      }

      listEl.appendChild(g);
    });
    placeOpenDetail();
  }

  // ---------- card da dívida (abas Resumo / Parcelas / Histórico) ----------
  var openedOnce = {};
  function defaultWalletId(d){
    var g = groupOf(d);
    if(g && g.walletId && state.wallets.some(function(w){ return w.id === g.walletId; })) return g.walletId;
    if(settings.defaultWalletId && state.wallets.some(function(w){ return w.id === settings.defaultWalletId; })) return settings.defaultWalletId;
    return '';
  }
  // valor do "Recebi/Paguei" em um toque: tudo o que está vencido, ou a próxima parcela
  function quickPayInfo(d){
    if(isPaid(d)) return null;
    var s = debtSchedule(d);
    if(s.overdue > EPS) return {amount: round2(s.overdue), mode: 'fifo'};
    if(s.firstOpen && s.firstOpen.open > EPS) return {amount: round2(s.firstOpen.open), mode: 'target', target: s.firstOpen.i};
    return null;
  }
  function addPayment(d, payment, label){
    d.payments.push(payment);
    invalidateSchedules();
    render();
    showUndo(label, function(){
      d.payments = d.payments.filter(function(p){ return p !== payment; });
      invalidateSchedules();
      render();
    }, 'Pagamento desfeito', 'circle-check');
  }
  function quickPay(d){
    var q = quickPayInfo(d);
    if(!q) return;
    var payment = {id: uid(), date: todayISO(), amount: q.amount, mode: q.mode};
    if(q.mode === 'target') payment.target = q.target;
    var w = defaultWalletId(d);
    if(w) payment.walletId = w;
    addPayment(d, payment, (d.kind === 'payable' ? 'Pago ' : 'Recebido ') + money.format(q.amount) + (d.kind === 'payable' ? ' a ' : ' de ') + firstName(d.name));
  }
  function walletOptions(selected){
    return '<option value="">— não afetar carteira —</option>' + state.wallets.map(function(w){
      return '<option value="' + escapeHtml(w.id) + '"' + (selected === w.id ? ' selected' : '') + '>' + escapeHtml(walletLabel(w)) + '</option>';
    }).join('');
  }
  function editPaymentDialog(d, p){
    openDialog({
      title: 'Editar pagamento', icon: 'pencil', okText: 'Salvar',
      html:
        '<div class="field"><label for="epAmount">Valor (R$)</label><input id="epAmount" class="money" type="text" inputmode="decimal" autocomplete="off" value="' + fmtMoneyInput(p.amount) + '"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="epDate">Data</label><input type="date" id="epDate" value="' + escapeHtml(p.date) + '"></div>' +
          '<div class="field"><label for="epWallet">Carteira</label><select id="epWallet" class="select" style="width:100%;">' + walletOptions(p.walletId || '') + '</select></div>' +
        '</div>' +
        '<div class="field"><label for="epNote">Obs. (opcional)</label><input id="epNote" type="text" maxlength="80" value="' + escapeHtml(p.note || '') + '"></div>',
      onOk: function(body){
        var v = moneyVal(body.querySelector('#epAmount'));
        if(!(v > 0)) return 'Informe um valor maior que zero.';
        var dt = body.querySelector('#epDate').value;
        if(!/^\d{4}-\d{2}-\d{2}$/.test(dt)) return 'Informe a data do pagamento.';
        p.amount = round2(v); p.date = dt;
        if(p.pendingPart > p.amount) p.pendingPart = p.amount;
        var w = body.querySelector('#epWallet').value;
        if(w) p.walletId = w; else delete p.walletId;
        var note = body.querySelector('#epNote').value.trim();
        if(note) p.note = note; else delete p.note;
        return true;
      }
    }).then(function(ok){ if(ok){ invalidateSchedules(); render(); showToast('Pagamento atualizado', 'circle-check'); } });
  }
  function removePayment(d, p, label){
    var idx = d.payments.indexOf(p);
    if(idx === -1) return;
    d.payments.splice(idx, 1);
    // pagamentos depois deste que tinham ido para uma parcela adiantada voltam a cobrir a mais antiga em aberto
    // (senão, apagar a parcela 3 deixa a 5 paga e a 3 atrasada)
    var retarget = [];
    d.payments.forEach(function(x){
      if(x.mode === 'target' && x.date >= p.date){ retarget.push({x: x, target: x.target, pendingPart: x.pendingPart}); x.mode = 'fifo'; delete x.target; delete x.pendingPart; }
    });
    invalidateSchedules();
    render();
    showUndo(label || 'Pagamento removido', function(){
      d.payments.splice(Math.min(idx, d.payments.length), 0, p);
      retarget.forEach(function(r){ r.x.mode = 'target'; r.x.target = r.target; if(r.pendingPart !== undefined) r.x.pendingPart = r.pendingPart; });
      invalidateSchedules();
      render();
    }, 'Pagamento restaurado', 'trash');
  }

  function buildCard(d, opts){
    opts = opts || {};
    var n = installments(d);
    var open = state.openId === d.id;
    var status = statusOf(d);
    var isPayable = d.kind === 'payable';
    var grp = groupOf(d);
    var sched = debtSchedule(d);
    var paid = isPaid(d);
    var q = quickPayInfo(d);

    var card = document.createElement('div');
    card.className = 'card' + (open ? ' open' : '') + (paid ? ' is-paid' : '');
    card.setAttribute('data-debt-id', d.id);

    var head = document.createElement('div');
    head.className = 'card-head';
    var headVal, headLbl;
    if(paid){ headVal = installmentValue(d); headLbl = 'por parcela'; }
    else if(sched.overdue > 0){ headVal = sched.overdue; headLbl = 'em atraso'; }
    else { headVal = sched.firstOpen ? sched.firstOpen.open : installmentValue(d); headLbl = (sched.firstOpen && sched.firstOpen.touched) ? 'falta na parcela' : 'próxima parcela'; }
    head.innerHTML =
      '<div class="avatar">' + escapeHtml(initials(d.name)) + '</div>' +
      '<div class="who">' +
        '<div class="name">' + escapeHtml(d.name) + ' <span class="kind-pill ' + (isPayable?'payable':'receivable') + '">' + (isPayable?'A pagar':'A receber') + '</span>' +
          (grp ? '<button type="button" class="grp-pill" title="Ver o grupo">' + ic('users') + '<span>' + escapeHtml(grp.title) + '</span></button>' : '') + '</div>' +
        '<div class="sub"><span class="badge ' + status + '">' + statusLabel(d) + '</span><span class="sub-since"> · ' + (isPayable ? 'desde ' : 'emprestado em ') + fmtDate(d.date) + '</span></div>' +
      '</div>' +
      '<div class="head-amount">' + money.format(headVal) + '<br><span style="font-size:10px;color:var(--muted);font-weight:400;">' + headLbl + '</span></div>' +
      (q ? '<button type="button" class="quick-pay" title="Registrar ' + escapeHtml(money.format(q.amount)) + (isPayable ? ' pago' : ' recebido') + ' hoje" aria-label="Registrar ' + escapeHtml(money.format(q.amount)) + (isPayable ? ' pago a ' : ' recebido de ') + escapeHtml(d.name) + ' hoje">' + ic('check') + '<span>' + (isPayable ? 'Paguei' : 'Recebi') + '</span></button>' : '') +
      '<div class="chev">' + ic('chevron-down') + '</div>';
    head.addEventListener('click', function(){
      state.openId = open ? null : d.id;
      render();
    });
    var grpPill = head.querySelector('.grp-pill');
    if(grpPill) grpPill.addEventListener('click', function(e){ e.stopPropagation(); focusGroup(grp.id); });
    var qp = head.querySelector('.quick-pay');
    if(qp) qp.addEventListener('click', function(e){ e.stopPropagation(); quickPay(d); });
    card.appendChild(head);

    var body = document.createElement('div');
    body.className = 'card-body';
    var inner = document.createElement('div');
    inner.className = 'card-body-inner';

    // ---- parcelas
    var STATE_LABEL = {paga: isPayable ? 'Paga' : 'Recebida', parcial: 'Parcial', atrasada: 'Em atraso', aberta: 'Em aberto'};
    var stampsHtml = sched.insts.map(function(it){
      var cls = it.state === 'paga' ? ' filled' : it.state === 'atrasada' ? (it.touched ? ' late partial' : ' late') : it.state === 'parcial' ? ' partial' : '';
      var tip = 'Parcela ' + (it.i+1) + '/' + n + ' · venc. ' + fmtDate(it.dueISO) + ' · ' + STATE_LABEL[it.state] + (it.open > 0 ? ' · falta ' + money.format(it.open) : '');
      return '<div class="stamp' + cls + '" title="' + escapeHtml(tip) + '">' + (it.state === 'paga' ? '' : (it.i+1)) + '</div>';
    }).join('');
    var instRows = sched.insts.map(function(it){
      var detail;
      if(it.state === 'paga'){
        detail = (it.lastPayISO ? (isPayable ? 'paga em ' : 'recebida em ') + fmtDate(it.lastPayISO) : 'quitada');
        if(it.lastPayISO && it.lastPayISO > it.dueISO) detail += ' (com atraso)';
        else if(it.lastPayISO && it.lastPayISO < it.dueISO && it.i > 0) detail += ' (adiantada)';
      } else {
        detail = 'falta ' + money.format(it.open);
        if(it.paid > 0) detail += ' · já ' + (isPayable?'pago':'recebido') + ' ' + money.format(it.paid + it.penPaid);
        if(it.pen > 0.005) detail += ' · encargos ' + money.format(it.pen);
      }
      return '<div class="inst-row st-' + it.state + '"><span class="ir-n">' + (it.i+1) + '/' + n + '</span><span class="ir-due">' + fmtDate(it.dueISO) + '</span>' +
        '<span class="ir-val">' + money.format(it.value) + '</span><span class="ir-st">' + STATE_LABEL[it.state] + '</span><span class="ir-det">' + detail + '</span></div>';
    }).join('');

    // ---- formulário de pagamento
    var tgt = sched.target;
    var payInfoHtml = tgt
      ? '<div class="pf-info">Parcela <b>' + (tgt.i+1) + '/' + n + '</b> · vence ' + fmtDate(tgt.dueISO) + ' · em aberto <b>' + money.format(tgt.open) + '</b>' +
        (tgt.pen > 0.005 ? ' <span class="pf-muted">(inclui ' + money.format(tgt.pen) + ' de encargos)</span>' : '') +
        '<div class="pf-muted">Se pagar a mais, o excedente adianta as próximas parcelas.</div></div>'
      : '';
    var pendingHtml = '';
    if(sched.pending > 0.005){
      var pendNames = sched.pendingList.map(function(it){ return (it.i+1) + 'ª (' + money.format(it.open) + ')'; }).join(', ');
      pendingHtml = '<div class="pf-pending">' +
        '<div>' + ic('triangle-alert') + ' ' + (tgt ? 'Pendente de parcelas anteriores' : 'Em aberto') + ': <b>' + money.format(sched.pending) + '</b> <span class="pf-muted">— parcela' + (sched.pendingList.length>1?'s ':' ') + pendNames + '</span></div>' +
        (tgt ? '<div class="pf-pend-row"><button class="btn btn-ghost btn-sm" data-act="incluir-pendente" type="button">+ Incluir pendente neste pagamento</button>' +
          '<div class="pf-field pf-pend-field" style="display:none;"><label>Quanto do pendente</label><input type="text" inputmode="decimal" autocomplete="off" class="pf-pend-amount money" value="' + fmtMoneyInput(sched.pending) + '"></div></div>' : '') +
      '</div>';
    }
    var payFormHtml = paid ? '' :
      '<div class="pay-form">' + payInfoHtml + pendingHtml +
        '<div class="pf-field"><label>' + (tgt ? (isPayable?'Valor pago desta parcela':'Valor recebido desta parcela') : (isPayable?'Valor pago':'Valor recebido')) + '</label><input type="text" inputmode="decimal" autocomplete="off" class="pf-amount money" value="' + fmtMoneyInput(tgt ? tgt.open : sched.pending) + '"></div>' +
        '<div class="pf-field"><label>Data</label><input type="date" class="pf-date" value="' + todayISO() + '"></div>' +
        '<div class="pf-field"><label>Carteira</label><select class="pf-wallet select">' + walletOptions(defaultWalletId(d)) + '</select></div>' +
        '<div class="pf-field"><label>Obs. (opcional)</label><input type="text" class="pf-note" maxlength="80" placeholder="' + (grp ? 'Ex: pago pelo Pedro' : 'Ex: pagou em dinheiro') + '"></div>' +
        '<button class="btn btn-primary btn-sm" data-act="registrar">' + ic('check') + ' Registrar pagamento</button>' +
      '</div>';

    // ---- histórico
    var sortedPayments = (d.payments||[]).slice().sort(function(a,b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
    var historyRows = sortedPayments.map(function(p){
      var realIdx = d.payments.indexOf(p);
      var tag = '';
      if(p.mode === 'target' && typeof p.target === 'number') tag = ' · parcela ' + (p.target+1) + (p.pendingPart > 0.005 ? ' + ' + money.format(p.pendingPart) + ' de pendente' : '');
      var w = p.walletId ? state.wallets.find(function(x){ return x.id === p.walletId; }) : null;
      return '<div class="history-row"><span>' + fmtDate(p.date) + (p.note ? ' · ' + escapeHtml(p.note) : '') + '<span class="hr-tag">' + tag + (w ? ' · ' + escapeHtml(w.name) : '') + '</span></span><b>' + money.format(p.amount) + '</b>' +
        '<button class="hr-rcpt' + (p.receiptId ? ' has' : '') + '" data-idx="' + realIdx + '" title="' + (p.receiptId ? 'Ver comprovante' : 'Anexar comprovante') + '" aria-label="' + (p.receiptId ? 'Ver comprovante' : 'Anexar comprovante') + '">' + ic(p.receiptId ? 'image' : 'paperclip') + '</button>' +
        '<button class="hr-edit" data-idx="' + realIdx + '" title="Editar este pagamento" aria-label="Editar este pagamento">' + ic('pencil') + '</button>' +
        '<button class="hr-del" data-idx="' + realIdx + '" title="Remover este pagamento" aria-label="Remover este pagamento">' + ic('x') + '</button></div>';
    }).join('');
    var historyHtml = historyRows ? '<div class="history-list">' + historyRows + '</div>' : '<div class="history-empty">Nenhum pagamento registrado ainda.</div>';

    // ---- resumo
    var due = nextDueDate(d);
    var wLink = isPayable ? null : whatsappLink(d);
    var detailItems = '<div class="detail-item"><div class="dl">Valor original</div><div class="dv">' + money.format(d.principal) + '</div></div>';
    if(!isPayable) detailItems += '<div class="detail-item"><div class="dl">Juros ao mês</div><div class="dv gold">' + d.rate.toString().replace('.',',') + '% <span style="font-size:10px;color:var(--muted);font-weight:400;">(' + interestTypeLabel(d.interestType) + ')</span></div></div>';
    detailItems +=
      '<div class="detail-item"><div class="dl">' + (isPayable?'Total da dívida':'Total a receber') + '</div><div class="dv">' + money.format(finalValue(d)) + '</div></div>' +
      (isPayable ? '' : '<div class="detail-item"><div class="dl">Lucro estimado</div><div class="dv gold">' + money.format(profit(d)) + '</div></div>') +
      '<div class="detail-item"><div class="dl">' + (isPayable?'Já pago':'Já recebido') + '</div><div class="dv green">' + money.format(paidAmount(d)) + '</div></div>' +
      '<div class="detail-item"><div class="dl">' + (isPayable?'Falta pagar':'Falta receber') + '</div><div class="dv red">' + money.format(remaining(d)) + '</div></div>' +
      '<div class="detail-item"><div class="dl">Parcelas</div><div class="dv">' + n + 'x</div></div>' +
      '<div class="detail-item"><div class="dl">Próximo vencimento</div><div class="dv">' + (due ? fmtDate(toISO(due)) : '—') + '</div></div>' +
      (d.discount > 0.005 ? '<div class="detail-item"><div class="dl">Desconto concedido</div><div class="dv" style="color:var(--red);">' + money.format(d.discount) + '</div></div>' : '') +
      (sched.overdue > 0 ? '<div class="detail-item"><div class="dl">Em atraso</div><div class="dv red">' + money.format(sched.overdue) + ' <span style="font-size:10px;color:var(--muted);font-weight:400;">(' + sched.overdueCount + ' parcela' + (sched.overdueCount>1?'s':'') + ')</span></div></div>' : '') +
      ((d.lateFeePct || d.lateInterestPct) ? '<div class="detail-item"><div class="dl">Encargos de atraso</div><div class="dv">' + money.format(sched.penaltiesCharged) + ' <span style="font-size:10px;color:var(--muted);font-weight:400;">(multa ' + String(d.lateFeePct||0).replace('.',',') + '% + mora ' + String(d.lateInterestPct||0).replace('.',',') + '%/mês)</span></div></div>' : '') +
      (sched.credit > 0.005 ? '<div class="detail-item"><div class="dl">' + (isPayable?'Paguei a mais':'Recebido a mais (crédito)') + '</div><div class="dv gold">' + money.format(sched.credit) + '</div></div>' : '');

    var tab = (state.cardTab && state.cardTab[d.id]) || 'resumo';
    function tabBtn(id, label){ return '<button type="button" class="ct-btn' + (tab === id ? ' active' : '') + '" role="tab" aria-selected="' + (tab === id) + '" data-tab="' + id + '">' + label + '</button>'; }
    var totalDue = effectiveTotal(d), remain = remaining(d);
    var odHead = '<div class="od-head">' +
      '<div class="od-top"><span class="od-name">' + escapeHtml(d.name) + (grp ? ' <span class="od-grp">· ' + escapeHtml(grp.title) + '</span>' : '') + '</span><span class="od-status ' + status + '">' + statusLabel(d) + '</span></div>' +
      '<div class="od-amt"><b>' + money.format(paid ? paidAmount(d) : remain) + '</b><span>' + (paid ? (isPayable ? 'pago no total' : 'recebido no total') : 'falta de ' + money.format(totalDue)) + '</span></div>' +
      '<div class="od-bar"><i style="width:' + progressPct(d).toFixed(1) + '%"></i></div>' +
      '<div class="od-meta">' + (isPayable ? 'Dívida de ' : 'Emprestado em ') + fmtDate(d.date) + ' · ' + (n > 1 ? n + 'x de ' + money.format(installmentValue(d)) : 'parcela única') + (d.rate > 0 ? ' · juros ' + String(d.rate).replace('.', ',') + '% a.m.' : ' · sem juros') + '</div>' +
    '</div>';
    inner.innerHTML = odHead +
      '<div class="card-tabs" role="tablist">' +
        tabBtn('resumo', 'Resumo') +
        tabBtn('parcelas', 'Parcelas <span class="ct-n">' + installmentsCovered(d) + '/' + n + '</span>') +
        tabBtn('historico', 'Histórico <span class="ct-n">' + sortedPayments.length + '</span>') +
      '</div>' +
      '<div class="card-panel" data-panel="resumo"' + (tab === 'resumo' ? '' : ' hidden') + '>' +
        '<details class="od-details"><summary>Detalhes: valor original, juros, lucro, vencimentos</summary><div class="detail-grid">' + detailItems + '</div></details>' +
        (d.notes ? '<div class="notes-block"><b>Anotações</b>' + escapeHtml(d.notes) + '</div>' : '') +
        payFormHtml +
        '<div class="card-actions">' +
          (wLink ? '<a class="btn btn-whats btn-sm" href="' + wLink + '" target="_blank" rel="noopener" data-act="whats">' + ic('message-circle') + ' WhatsApp</a>' : (isPayable ? '' : '<button class="btn btn-ghost btn-sm" data-act="nowhats" title="Cadastre o telefone em Editar">' + ic('message-circle') + ' WhatsApp</button>')) +
          (opts.inPerson ? '' : '<button class="btn btn-ghost btn-sm" data-act="profile">' + ic('user') + ' Ver pessoa</button>') +
          (paid ? '' : '<button class="btn btn-ghost btn-sm" data-act="settle">' + ic('badge-percent') + ' Quitar c/ desconto</button>') +
          '<div class="spacer"></div>' +
          (!isPayable ? '<button class="btn btn-ghost btn-sm" data-act="share" title="Link só desta dívida">' + ic('share-2') + ' Link' + (shareFor('debt', d.id) ? ' <span class="live-dot" title="ativo"></span>' : '') + '</button>' : '') +
          (paid && !isPayable ? '<button class="btn btn-primary btn-sm" data-act="receipt">' + ic('receipt') + ' Recibo de quitação</button>' : '') +
          '<button class="btn btn-ghost btn-sm" data-act="statement">' + ic('file-text') + ' Extrato</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="edit">' + ic('pencil') + ' Editar</button>' +
          '<button class="btn btn-danger btn-sm" data-act="del">' + ic('trash') + ' Excluir</button>' +
        '</div>' +
      '</div>' +
      '<div class="card-panel" data-panel="parcelas"' + (tab === 'parcelas' ? '' : ' hidden') + '>' +
        '<div class="stamps">' + stampsHtml + '</div><div class="inst-list">' + instRows + '</div>' +
      '</div>' +
      '<div class="card-panel" data-panel="historico"' + (tab === 'historico' ? '' : ' hidden') + '>' +
        '<div class="history">' + historyHtml +
          '<button class="pf-undo" data-act="undo" ' + (sortedPayments.length ? '' : 'disabled') + '>' + ic('undo-2') + ' Desfazer último pagamento</button>' +
        '</div>' +
      '</div>';

    // abas
    inner.querySelector('.card-tabs').addEventListener('click', function(e){
      var b = e.target.closest('.ct-btn');
      if(!b) return;
      e.stopPropagation();
      var t = b.getAttribute('data-tab');
      if(!state.cardTab) state.cardTab = {};
      state.cardTab[d.id] = t;
      inner.querySelectorAll('.ct-btn').forEach(function(x){ var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); });
      inner.querySelectorAll('.card-panel').forEach(function(p){ p.hidden = p.getAttribute('data-panel') !== t; });
      body.style.maxHeight = 'none';
    });
    inner.addEventListener('click', function(e){ if(e.target.closest('input, select, textarea, label')) e.stopPropagation(); });

    // pendente
    var amountInput = inner.querySelector('.pf-amount'), dateInput = inner.querySelector('.pf-date');
    var walletInput = inner.querySelector('.pf-wallet'), noteInput = inner.querySelector('.pf-note');
    var pendBtn = inner.querySelector('[data-act="incluir-pendente"]'), pendField = inner.querySelector('.pf-pend-field'), pendInput = inner.querySelector('.pf-pend-amount');
    var includePending = false;
    if(pendBtn){
      pendBtn.addEventListener('click', function(e){
        e.stopPropagation();
        includePending = !includePending;
        pendField.style.display = includePending ? '' : 'none';
        pendBtn.textContent = includePending ? '− Não incluir pendente' : '+ Incluir pendente neste pagamento';
        if(includePending){ pendInput.focus(); pendInput.select(); }
      });
    }
    var registrarBtn = inner.querySelector('[data-act="registrar"]');
    if(registrarBtn){
      registrarBtn.addEventListener('click', function(e){
        e.stopPropagation();
        var val = moneyVal(amountInput);
        if(isNaN(val) || val < 0) val = 0;
        var pend = 0;
        if(includePending && pendInput){
          pend = moneyVal(pendInput);
          if(isNaN(pend) || pend < 0){ showToast('Informe um valor válido para o pendente.', 'circle-alert'); return; }
        }
        if(val + pend <= 0){ showToast('Informe um valor maior que zero.', 'circle-alert'); return; }
        var dt = dateInput.value || todayISO();
        var isFuture = dt > todayISO();
        var before = debtSchedule(d);
        var payment = {id: uid(), date: dt, amount: round2(val + pend)};
        if(before.target){ payment.mode = 'target'; payment.target = before.target.i; if(pend > 0) payment.pendingPart = round2(pend); }
        else payment.mode = 'fifo';
        if(walletInput && walletInput.value) payment.walletId = walletInput.value;
        var noteVal = noteInput ? noteInput.value.trim() : '';
        if(noteVal) payment.note = noteVal;
        // resumo do que aconteceu (calculado antes de registrar de vez)
        d.payments.push(payment); invalidateSchedules();
        var after = debtSchedule(d);
        d.payments.pop(); invalidateSchedules();
        var adiantadas = after.insts.filter(function(it){ return before.target && it.i > before.target.i && it.open === 0 && before.insts[it.i].open > 0; }).length;
        var msg = (isFuture ? 'Registrado com data futura (' + fmtDate(dt) + ')' : (isPayable ? 'Pago ' : 'Recebido ') + money.format(payment.amount));
        if(adiantadas > 0) msg += ' · ' + adiantadas + ' parcela' + (adiantadas>1?'s':'') + ' adiantada' + (adiantadas>1?'s':'');
        if(after.credit - before.credit > 0.005) msg += ' · ' + money.format(after.credit - before.credit) + ' a mais';
        if(before.target && after.insts[before.target.i].open > 0.005) msg += ' · faltam ' + money.format(after.insts[before.target.i].open);
        addPayment(d, payment, msg);
      });
    }

    inner.querySelectorAll('.hr-edit').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var p = d.payments[parseInt(btn.getAttribute('data-idx'),10)];
        if(p) editPaymentDialog(d, p);
      });
    });
    inner.querySelectorAll('.hr-rcpt').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var p = d.payments[parseInt(btn.getAttribute('data-idx'),10)];
        if(p) receiptAction(d, p);
      });
    });
    inner.querySelectorAll('.hr-del').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var p = d.payments[parseInt(btn.getAttribute('data-idx'),10)];
        if(p) removePayment(d, p, 'Pagamento de ' + money.format(p.amount) + ' removido');
      });
    });
    inner.querySelector('[data-act="undo"]').addEventListener('click', function(e){
      e.stopPropagation();
      if(sortedPayments.length) removePayment(d, sortedPayments[0], 'Último pagamento desfeito');
    });
    var noWhats = inner.querySelector('[data-act="nowhats"]');
    if(noWhats) noWhats.addEventListener('click', function(e){ e.stopPropagation(); showToast('Cadastre o telefone em "Editar" para cobrar pelo WhatsApp.', 'phone'); });
    var shareBtn = inner.querySelector('[data-act="share"]');
    if(shareBtn) shareBtn.addEventListener('click', function(e){ e.stopPropagation(); openShareDialog('debt', d.id, d.name); });
    var whatsBtn = inner.querySelector('[data-act="whats"]');
    if(whatsBtn) whatsBtn.addEventListener('click', function(e){ e.stopPropagation(); });
    var profBtn = inner.querySelector('[data-act="profile"]');
    if(profBtn) profBtn.addEventListener('click', function(e){ e.stopPropagation(); openPerson(d.name); });
    var settleBtn = inner.querySelector('[data-act="settle"]');
    if(settleBtn) settleBtn.addEventListener('click', function(e){ e.stopPropagation(); openSettleModal(d); });
    inner.querySelector('[data-act="statement"]').addEventListener('click', function(e){ e.stopPropagation(); openStatement(d); });
    var rcBtn = inner.querySelector('[data-act="receipt"]');
    if(rcBtn) rcBtn.addEventListener('click', function(e){ e.stopPropagation(); shareReceipt(d); });
    inner.querySelector('[data-act="edit"]').addEventListener('click', function(e){ e.stopPropagation(); openModal(d); });
    inner.querySelector('[data-act="del"]').addEventListener('click', function(e){
      e.stopPropagation();
      if(settings.confirmDelete) openDeleteModal(d); else performDelete(d);
    });

    body.appendChild(inner);
    card.appendChild(body);
    if(open){
      if(openedOnce[d.id]) body.style.maxHeight = 'none';
      else {
        openedOnce[d.id] = true;
        requestAnimationFrame(function(){ body.style.maxHeight = body.scrollHeight + 'px'; });
        setTimeout(function(){ if(body.isConnected) body.style.maxHeight = 'none'; }, 320);
      }
    } else {
      delete openedOnce[d.id];
      body.style.maxHeight = '0px';
    }
    return card;
  }

  function showToast(msg, icon){
    if(typeof histNote === 'function') histNote(msg);
    var t = document.getElementById('toast');
    t.innerHTML = (icon ? ic(icon) : '') + '<span>' + escapeHtml(msg) + '</span>';
    t.classList.toggle('lift', typeof undoQueue !== 'undefined' && undoQueue.length > 0);
    t.classList.add('show');
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(function(){ t.classList.remove('show'); }, 2600);
  }

  // ---------- janelas do próprio app (no lugar de alert / confirm / prompt) ----------
  var appDialogEl = document.getElementById('appDialog');
  var adResolve = null, adOnOk = null;
  function openDialog(opts){
    return new Promise(function(resolve){
      if(adResolve) adResolve(false);
      adResolve = resolve;
      adOnOk = opts.onOk || null;
      document.getElementById('adTitle').innerHTML = (opts.icon ? ic(opts.icon, 'h-ic') : '') + '<span>' + escapeHtml(opts.title || '') + '</span>';
      document.getElementById('adBody').innerHTML = opts.html || '';
      document.getElementById('adErr').textContent = '';
      document.getElementById('adActions').innerHTML =
        (opts.alert ? '' : '<button class="btn btn-ghost" type="button" data-ad="cancel">' + escapeHtml(opts.cancelText || 'Cancelar') + '</button>') +
        '<button class="btn ' + (opts.danger ? 'btn-danger-solid' : 'btn-primary') + '" type="button" data-ad="ok">' + escapeHtml(opts.okText || 'OK') + '</button>';
      appDialogEl.classList.add('show');
      var first = appDialogEl.querySelector('#adBody input, #adBody select, #adBody textarea') || appDialogEl.querySelector('[data-ad="ok"]');
      setTimeout(function(){ if(first) first.focus(); }, 40);
    });
  }
  function closeDialog(result){
    appDialogEl.classList.remove('show');
    var r = adResolve; adResolve = null; adOnOk = null;
    if(r) r(result);
  }
  function dialogOk(){
    if(adOnOk){
      var res = adOnOk(document.getElementById('adBody'));
      if(typeof res === 'string'){ document.getElementById('adErr').textContent = res; return; }
      if(res === false) return;
    }
    closeDialog(true);
  }
  appDialogEl.addEventListener('click', function(e){
    if(e.target === appDialogEl){ closeDialog(false); return; }
    var b = e.target.closest('[data-ad]');
    if(!b) return;
    if(b.getAttribute('data-ad') === 'ok') dialogOk(); else closeDialog(false);
  });
  function appConfirm(title, html, opts){
    opts = opts || {};
    return openDialog({title: title, html: html, okText: opts.okText || 'Confirmar', cancelText: opts.cancelText, danger: opts.danger, icon: opts.icon});
  }
  function appAlert(title, html, icon){ return openDialog({title: title, html: html, okText: 'Entendi', alert: true, icon: icon}); }

  // ---------- desfazer (pilha de avisos com botão) ----------
  var undoStackEl = document.getElementById('undoStack');
  var undoQueue = [];
  var undoSeq = 0;
  function renderUndoStack(){
    undoStackEl.innerHTML = '';
    undoQueue.forEach(function(entry){
      var el = document.createElement('div');
      el.className = 'undo-toast';
      el.innerHTML = (entry.icon ? ic(entry.icon) : '') + '<span>' + escapeHtml(entry.label) + '</span><button type="button">' + escapeHtml(entry.btn || 'Desfazer') + '</button>';
      el.querySelector('button').addEventListener('click', function(){ undoOne(entry.uid); });
      undoStackEl.appendChild(el);
    });
  }
  // label: o que aconteceu; undoFn: como voltar atrás; doneMsg: aviso depois de desfazer
  function showUndo(label, undoFn, doneMsg, icon){
    if(typeof histNote === 'function') histNote(label);
    var t = document.getElementById('toast');
    t.classList.remove('show');
    var entry = {uid: 'u' + (++undoSeq), label: label, undo: undoFn, doneMsg: doneMsg, icon: icon};
    undoQueue.push(entry);
    if(undoQueue.length > 3){ var ev = undoQueue.shift(); clearTimeout(ev.timer); }
    entry.timer = setTimeout(function(){
      undoQueue = undoQueue.filter(function(e){ return e.uid !== entry.uid; });
      renderUndoStack();
    }, 7000);
    renderUndoStack();
  }
  function undoOne(uid){
    var entry = undoQueue.find(function(e){ return e.uid === uid; });
    if(!entry) return;
    clearTimeout(entry.timer);
    undoQueue = undoQueue.filter(function(e){ return e.uid !== uid; });
    renderUndoStack();
    entry.undo();
    if(entry.doneMsg) showToast(entry.doneMsg, 'undo-2');
  }

  // ---------- toolbar ----------
  function updateGroupButtonLabel(){
    var btn = document.getElementById('btnGroup');
    if(state.grouped){ btn.textContent = 'Ver lista simples'; return; }
    btn.textContent = state.viewKind === 'payable' ? 'Agrupar por credor' : 'Agrupar por amigo';
  }
  document.getElementById('kindToggle').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-k]');
    if(!btn) return;
    state.viewKind = btn.getAttribute('data-k');
    document.querySelectorAll('#kindToggle button').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    updateGroupButtonLabel();
    render();
  });
  document.getElementById('filters').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-f]');
    if(!btn) return;
    state.filter = btn.getAttribute('data-f');
    document.querySelectorAll('#filters button').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    render();
  });
  document.getElementById('search').addEventListener('input', function(e){ state.query = e.target.value; render(); });
  document.getElementById('sortSel').addEventListener('change', function(e){ state.sort = e.target.value; render(); });
  document.getElementById('sortSel').value = state.sort;
  document.getElementById('btnGroup').addEventListener('click', function(){
    state.grouped = !state.grouped;
    this.classList.toggle('active', state.grouped);
    updateGroupButtonLabel();
    render();
  });

  // ---------- add/edit modal ----------
  var overlay = document.getElementById('overlay');
  var modalTitle = document.getElementById('modalTitle');
  var formKindToggle = document.getElementById('formKindToggle');
  var receivableOnlyBlock = document.getElementById('receivableOnlyBlock');
  var receivableOnlyBlock2 = document.getElementById('receivableOnlyBlock2');
  var lblName = document.getElementById('lblName');
  var lblPrincipal = document.getElementById('lblPrincipal');
  var lblDate = document.getElementById('lblDate');
  var fName = document.getElementById('fName');
  var fPrincipal = document.getElementById('fPrincipal');
  var fRate = document.getElementById('fRate');
  var fDate = document.getElementById('fDate');
  var fInstallments = document.getElementById('fInstallments');
  var fDueDay = document.getElementById('fDueDay');
  var fInterestType = document.getElementById('fInterestType');
  var fPhone = document.getElementById('fPhone');
  var fNotes = document.getElementById('fNotes');
  var fLateFee = document.getElementById('fLateFee');
  var fLateInterest = document.getElementById('fLateInterest');
  var formErr = document.getElementById('formErr');
  var formFormula = document.getElementById('formFormula');
  var currentFormKind = 'receivable';

  function formulaHtml(p, r, n, type){
    var total = finalValue({principal:p, rate:r, installments:n, interestType: type});
    var inst = total / n;
    var rStr = r.toString().replace('.',',') + '%';
    if(type === 'price'){
      return 'Parcela = ' + money.format(p) + ' × ' + rStr + ' ÷ (1 − (1 + ' + rStr + ')<sup>−' + n + '</sup>) = ' + money.format(inst) +
        '<br>' + n + ' × ' + money.format(inst) + ' = ' + money.format(total) +
        '<br><span style="opacity:.75">Juros só sobre o que ainda falta pagar (padrão de financiamentos).</span>';
    }
    var calc = type === 'simples'
      ? money.format(p) + ' × (1 + ' + rStr + ' × ' + n + ') = ' + money.format(total)
      : money.format(p) + ' × (1 + ' + rStr + ')' + toSuperscript(n) + ' = ' + money.format(total);
    calc += '<br>' + money.format(total) + ' ÷ ' + n + ' parcela' + (n>1?'s':'') + ' = ' + money.format(inst) + '/parcela';
    if(type !== 'simples' && n > 1 && r > 0){
      var priceTotal = finalValue({principal:p, rate:r, installments:n, interestType:'price'});
      calc += '<br><span style="opacity:.75">Na Tabela Price daria ' + money.format(priceTotal) + ' no total.</span>';
    }
    return calc;
  }
  function updateFormFormula(){
    var isPayable = currentFormKind === 'payable';
    var p = moneyVal(fPrincipal) || 0;
    var r = fRate.value.trim() === '' ? 0 : (parseFloat(fRate.value) || 0);
    var n = Math.max(1, parseInt(fInstallments.value,10) || 1);
    if(isPayable || p <= 0 || r <= 0){
      formFormula.style.display = 'none';
      return;
    }
    var calc = formulaHtml(p, r, n, fInterestType.value);
    formFormula.innerHTML = '<div class="fl">Como vai ficar</div>' + calc;
    formFormula.style.display = '';
  }

  function setFormKind(kind){
    currentFormKind = kind === 'payable' ? 'payable' : 'receivable';
    document.querySelectorAll('#formKindToggle button').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-k') === currentFormKind);
    });
    var isPayable = currentFormKind === 'payable';
    receivableOnlyBlock.style.display = isPayable ? 'none' : '';
    receivableOnlyBlock2.style.display = isPayable ? 'none' : '';
    lblName.textContent = isPayable ? 'Nome da empresa ou pessoa a quem devo' : 'Nome do amigo';
    fName.placeholder = isPayable ? 'Ex: Cartão Nubank' : 'Ex: Vinicius';
    lblPrincipal.textContent = isPayable ? 'Valor total da dívida (R$)' : 'Valor emprestado (R$)';
    lblDate.textContent = isPayable ? 'Data que a dívida começou' : 'Data do empréstimo';
    updateFormFormula();
  }
  formKindToggle.addEventListener('click', function(e){
    var btn = e.target.closest('button[data-k]');
    if(!btn) return;
    setFormKind(btn.getAttribute('data-k'));
  });
  [fPrincipal, fRate, fInstallments, fInterestType].forEach(function(el){
    el.addEventListener('input', updateFormFormula);
    el.addEventListener('change', updateFormFormula);
  });

  // ---------- phone mask ----------
  function formatPhoneDisplay(rawDigits){
    var d = onlyDigits(rawDigits).slice(0,13);
    var ddi = '';
    if(d.length > 11 && d.slice(0,2) === '55'){ ddi = d.slice(0,2); d = d.slice(2); }
    var out = ddi ? '+' + ddi + ' ' : '';
    if(d.length === 0) return '';
    if(d.length <= 2) return out + d;
    var ddd = d.slice(0,2);
    var num = d.slice(2);
    out += '(' + ddd + ') ';
    if(num.length === 0) return out;
    if(num.length <= 4) return out + num;
    if(num.length <= 8){ return out + num.slice(0,4) + '-' + num.slice(4); }
    return out + num.slice(0,5) + '-' + num.slice(5,9);
  }
  fPhone.addEventListener('input', function(){
    fPhone.value = formatPhoneDisplay(fPhone.value);
  });

  function populateFriendsList(){
    var names = [];
    state.debts.forEach(function(d){ if(names.indexOf(d.name) === -1) names.push(d.name); });
    names.sort(function(a,b){ return a.localeCompare(b, 'pt-BR'); });
    var dl = document.getElementById('friendsList');
    dl.innerHTML = names.map(function(n){ return '<option value="' + escapeHtml(n) + '">'; }).join('');
  }

  function openModal(debt){
    state.editingId = debt ? debt.id : null;
    modalTitle.textContent = debt ? 'Editar dívida' : 'Nova dívida';
    document.getElementById('formModeToggle').style.display = debt ? 'none' : '';
    document.querySelectorAll('#formModeToggle button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-m') === 'single'); });
    var fgNote = document.getElementById('formGroupNote'), fg = debt ? groupOf(debt) : null;
    fgNote.style.display = fg ? '' : 'none';
    fgNote.textContent = fg ? 'Esta dívida faz parte do grupo “' + fg.title + '”. O que mudar aqui vale só para ' + debt.name + '. Para mudar o grupo todo, use Editar grupo.' : '';
    populateFriendsList();
    setFormKind(debt ? debt.kind : state.viewKind);
    fName.value = debt ? debt.name : '';
    fPrincipal.value = debt ? fmtMoneyInput(debt.principal) : '';
    fRate.value = debt ? debt.rate : (settings.defaultRate || '');
    fInterestType.value = debt ? (debt.interestType || 'composto') : 'composto';
    fDate.value = debt ? debt.date : todayISO();
    fInstallments.value = debt ? installments(debt) : 1;
    fDueDay.value = debt ? debt.dueDay : new Date().getDate();
    var contact = state.contacts[nameKey(debt ? debt.name : '')];
    fPhone.value = contact ? formatPhoneDisplay(contact.phone) : '';
    fNotes.value = debt ? debt.notes : '';
    fLateFee.value = debt ? (debt.lateFeePct || '') : (settings.defaultLateFee || '');
    fLateInterest.value = debt ? (debt.lateInterestPct || '') : (settings.defaultLateInterest || '');
    formErr.textContent = '';
    updateFormFormula();
    overlay.classList.add('show');
    fName.focus();
  }
  function closeModal(){ overlay.classList.remove('show'); }

  document.getElementById('btnNew').addEventListener('click', function(){ openModal(null); });
  document.getElementById('btnCancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e){ if(e.target === overlay) closeModal(); });
  fName.addEventListener('input', function(){
    if(state.editingId) return; // não sobrescreve telefone ao editar
    var contact = state.contacts[nameKey(fName.value)];
    if(contact) fPhone.value = formatPhoneDisplay(contact.phone);
  });

  function saveForm(opts){
    var isPayable = currentFormKind === 'payable';
    var name = fName.value.trim();
    var principal = moneyVal(fPrincipal);
    var rate = isPayable ? 0 : (fRate.value.trim() === '' ? 0 : parseFloat(fRate.value));
    var interestType = isPayable ? 'composto' : (fInterestType.value === 'simples' || fInterestType.value === 'price' ? fInterestType.value : 'composto');
    var lateFeePct = fLateFee.value.trim() === '' ? 0 : parseFloat(fLateFee.value);
    var lateInterestPct = fLateInterest.value.trim() === '' ? 0 : parseFloat(fLateInterest.value);
    var date = fDate.value;
    var installmentsRaw = fInstallments.value.trim() === '' ? 1 : parseInt(fInstallments.value, 10);
    var days = installmentsRaw > 0 ? installmentsRaw * 30 : 0;
    var dueDay = parseInt(fDueDay.value, 10);
    var phoneDigits = isPayable ? '' : onlyDigits(fPhone.value);
    var notes = isPayable ? '' : fNotes.value.trim();

    if(!name){ formErr.textContent = isPayable ? 'Informe o nome da empresa ou pessoa.' : 'Informe o nome do amigo.'; return; }
    if(isNaN(principal) || principal <= 0){ formErr.textContent = 'Informe um valor válido.'; return; }
    if(!isPayable && (isNaN(rate) || rate < 0)){ formErr.textContent = 'Informe uma taxa de juros válida (pode ser 0 para sem juros).'; return; }
    if(!isPayable && rate > 100 && !(opts && opts.highRateOk)){
      appConfirm('Taxa muito alta', 'Uma taxa de <b>' + escapeHtml(rate.toString().replace('.',',')) + '% ao mês</b> é bem acima do comum, e o valor final pode ficar altíssimo. Quer continuar mesmo assim?', {okText: 'Continuar', icon: 'triangle-alert'})
        .then(function(ok){ if(ok) saveForm({highRateOk: true}); });
      return;
    }
    if(isNaN(lateFeePct) || lateFeePct < 0 || lateFeePct > 100){ formErr.textContent = 'Multa por atraso inválida (use de 0 a 100%).'; return; }
    if(isNaN(lateInterestPct) || lateInterestPct < 0 || lateInterestPct > 100){ formErr.textContent = 'Juros de mora inválidos (use de 0 a 100% ao mês).'; return; }
    if(!date){ formErr.textContent = isPayable ? 'Informe quando a dívida começou.' : 'Informe a data do empréstimo.'; return; }
    if(isNaN(installmentsRaw) || installmentsRaw <= 0){ formErr.textContent = 'Informe um número de parcelas válido.'; return; }
    if(!isPayable && phoneDigits && phoneDigits.length < 10){ formErr.textContent = 'Telefone incompleto — inclua DDD (ex: 11999998888).'; return; }
    if(isNaN(dueDay) || dueDay < 1 || dueDay > 31){ dueDay = parseInt(date.split('-')[2],10); }

    if(state.editingId){
      var d = state.debts.find(function(x){ return x.id === state.editingId; });
      var prevDueDay = d.dueDay;
      d.name = name; d.principal = principal; d.rate = rate; d.interestType = interestType; d.date = date; d.days = days; d.installments = installmentsRaw; d.dueDay = dueDay; d.notes = notes; d.kind = currentFormKind; d.lateFeePct = lateFeePct; d.lateInterestPct = lateInterestPct;
      if(d.firstDue && dueDay !== prevDueDay){
        var fd = new Date(d.firstDue + 'T00:00:00');
        d.firstDue = toISO(new Date(fd.getFullYear(), fd.getMonth(), Math.min(dueDay, daysInMonth(fd.getFullYear(), fd.getMonth()))));
      }
      showToast('Dívida atualizada');
    } else {
      state.debts.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
        name: name, principal: principal, date: date, days: days, installments: installmentsRaw, rate: rate, interestType: interestType, dueDay: dueDay, payments: [], notes: notes, kind: currentFormKind, discount: 0, lateFeePct: lateFeePct, lateInterestPct: lateInterestPct
      });
      showToast('Dívida adicionada');
    }
    if(phoneDigits){ var pc = state.contacts[nameKey(name)] || {}; pc.phone = phoneDigits; state.contacts[nameKey(name)] = pc; }
    closeModal();
    render();
  }
  document.getElementById('btnSave').addEventListener('click', function(){ saveForm(); });

  // ---------- settings modal ----------
  var settingsOverlay = document.getElementById('settingsOverlay');
  function openSettings(){
    document.getElementById('setCurrency').value = settings.currency;
    document.getElementById('setDateFormat').value = settings.dateFormat;
    document.getElementById('setDefaultRate').value = settings.defaultRate;
    document.getElementById('setDefaultLateFee').value = settings.defaultLateFee || '';
    document.getElementById('setDefaultLateInterest').value = settings.defaultLateInterest || '';
    document.getElementById('setPixKey').value = settings.pixKey || '';
    document.getElementById('setPixType').value = settings.pixType || 'auto';
    document.getElementById('setOwnerCity').value = settings.ownerCity || '';
    document.getElementById('setOwnerName').value = settings.ownerName || '';
    document.getElementById('setDefaultWallet').innerHTML = walletOptions(settings.defaultWalletId || '').replace('— não afetar carteira —', '— nenhuma —');
    document.getElementById('setConfirmDelete').checked = !!settings.confirmDelete;
    document.getElementById('setBackupReminder').checked = !!settings.backupReminder;
    settingsOverlay.classList.add('show');
  }
  function closeSettings(){ settingsOverlay.classList.remove('show'); }
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnSettingsClose').addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', function(e){ if(e.target === settingsOverlay) closeSettings(); });
  document.getElementById('btnSettingsSave').addEventListener('click', function(){
    settings.currency = document.getElementById('setCurrency').value;
    settings.dateFormat = document.getElementById('setDateFormat').value;
    var dr = parseFloat(document.getElementById('setDefaultRate').value);
    settings.defaultRate = isNaN(dr) || dr < 0 ? 0 : dr;
    var lf = parseFloat(document.getElementById('setDefaultLateFee').value), li = parseFloat(document.getElementById('setDefaultLateInterest').value);
    settings.defaultLateFee = isNaN(lf) || lf < 0 ? 0 : Math.min(lf, 100);
    settings.defaultLateInterest = isNaN(li) || li < 0 ? 0 : Math.min(li, 100);
    settings.pixKey = document.getElementById('setPixKey').value.trim();
    settings.pixType = document.getElementById('setPixType').value;
    settings.ownerCity = document.getElementById('setOwnerCity').value.trim();
    settings.ownerName = document.getElementById('setOwnerName').value.trim();
    settings.defaultWalletId = document.getElementById('setDefaultWallet').value;
    settings.confirmDelete = document.getElementById('setConfirmDelete').checked;
    settings.backupReminder = document.getElementById('setBackupReminder').checked;
    saveSettings();
    rebuildMoneyFormatter();
    closeSettings();
    render();
    checkBackupReminder();
    showToast('Configurações salvas');
  });

  // ---------- navegação entre páginas ----------
  var PAGE_IDS = {dashboard: 'pageDashboard', pessoas: 'pagePessoas', carteiras: 'pageCarteiras', relatorios: 'pageRelatorios', pessoa: 'pagePessoa', contas: 'pageContas'};
  var PAGE_TAB = {pessoa: 'pessoas'};
  function showPage(page, opts){
    if(!PAGE_IDS[page]) page = 'dashboard';
    if(page !== state.page && state.page !== 'pessoa') state.prevPage = state.page;
    state.page = page;
    // celular: sair de Pessoas fecha a dívida aberta (ela ocupa a tela toda)
    if(page !== 'pessoas' && page !== 'pessoa' && typeof wideMQ !== 'undefined' && !wideMQ.matches) state.openId = null;
    var tabPage = PAGE_TAB[page] || page;
    document.querySelectorAll('#pageTabs button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-page') === tabPage); });
    Object.keys(PAGE_IDS).forEach(function(p){ var el = document.getElementById(PAGE_IDS[p]); if(el) el.style.display = p === page ? '' : 'none'; });
    if(page === 'pessoas' || page === 'pessoa') render(); else renderAll();
    if(!(opts && opts.keepScroll)) window.scrollTo(0, 0);
    if(typeof syncSheet === 'function') syncSheet();
  }

  // ---------- página da pessoa ----------
  function openPerson(name){
    state.personKey = nameKey(name);
    state.openId = null;
    showPage('pessoa');
  }
  document.getElementById('btnPersonBack').addEventListener('click', function(){
    showPage(state.prevPage && state.prevPage !== 'pessoa' ? state.prevPage : 'pessoas');
  });
  function renderPersonPage(){
    var el = document.getElementById('personContent');
    var key = state.personKey;
    var debts = state.debts.filter(function(d){ return nameKey(d.name) === key; });
    if(!debts.length){
      el.innerHTML = '<div class="empty">Nenhuma dívida com essa pessoa no momento.</div>';
      return;
    }
    var name = debts[0].name;
    var rec = debts.filter(function(d){ return d.kind === 'receivable'; });
    var pay = debts.filter(function(d){ return d.kind === 'payable'; });
    function sum(arr, fn){ return arr.reduce(function(s, d){ return s + fn(d); }, 0); }
    var contact = state.contacts[key];
    var phone = contact && contact.phone ? contact.phone : '';
    var lateRec = rec.filter(function(d){ return statusOf(d) === 'atrasado'; });
    var urgent = rec.filter(function(d){ return !isPaid(d); }).sort(function(a, b){ var x = nextDueDate(a), y = nextDueDate(b); return (x ? x.getTime() : 0) - (y ? y.getTime() : 0); })[0];
    var wLink = urgent ? whatsappLink(urgent) : null;
    var since = debts.reduce(function(m, d){ return d.date < m ? d.date : m; }, debts[0].date);

    var stats = '';
    if(rec.length){
      stats += '<div class="stat"><div class="label">' + ic('hand-coins') + ' Já emprestei</div><div class="value">' + money.format(sum(rec, function(d){ return d.principal; })) + '</div></div>' +
        '<div class="stat green"><div class="label">' + ic('circle-check') + ' Já recebi</div><div class="value">' + money.format(sum(rec, paidAmount)) + '</div></div>' +
        '<div class="stat gold"><div class="label">' + ic('hourglass') + ' Falta receber</div><div class="value">' + money.format(sum(rec, remaining)) + '</div></div>' +
        '<div class="stat red"><div class="label">' + ic('triangle-alert') + ' Em atraso</div><div class="value">' + money.format(sum(lateRec, overdueAmount)) + '</div></div>';
    }
    if(pay.length){
      stats += '<div class="stat blue"><div class="label">' + ic('banknote-arrow-up') + ' Eu devo</div><div class="value">' + money.format(sum(pay, remaining)) + '</div></div>' +
        '<div class="stat green"><div class="label">' + ic('circle-check') + ' Já paguei</div><div class="value">' + money.format(sum(pay, paidAmount)) + '</div></div>';
    }
    var history = [];
    debts.forEach(function(d){ (d.payments || []).forEach(function(p){ history.push({p: p, d: d}); }); });
    history.sort(function(a, b){ return a.p.date < b.p.date ? 1 : (a.p.date > b.p.date ? -1 : 0); });
    var histHtml = history.length ? history.map(function(h){
      var g = groupOf(h.d);
      return '<div class="history-row"><span>' + fmtDate(h.p.date) + ' · ' + (h.d.kind === 'payable' ? 'paguei' : 'recebi') +
        '<span class="hr-tag"> · ' + (g ? escapeHtml(g.title) : (h.d.kind === 'payable' ? 'dívida de ' : 'empréstimo de ') + fmtDate(h.d.date)) + (h.p.note ? ' · ' + escapeHtml(h.p.note) : '') + '</span></span>' +
        '<b class="' + (h.d.kind === 'payable' ? 'neg' : 'pos') + '">' + money.format(h.p.amount) + '</b></div>';
    }).join('') : '<div class="history-empty">Nenhum pagamento ainda.</div>';

    el.innerHTML =
      '<div class="person-head">' +
        '<div class="avatar avatar-lg">' + escapeHtml(initials(name)) + '</div>' +
        '<div class="ph-info"><h2 class="ph-name">' + escapeHtml(name) + '</h2>' +
          '<div class="ph-sub">' + debts.length + (debts.length === 1 ? ' dívida' : ' dívidas') + ' · desde ' + fmtDate(since) + (phone ? ' · ' + escapeHtml(formatPhoneDisplay(phone)) : '') + '</div></div>' +
      '</div>' +
      '<div class="person-actions">' +
        (wLink ? '<a class="btn btn-whats btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(wLink) + '">' + ic('message-circle') + ' Cobrar no WhatsApp</a>' : '') +
        (rec.length ? '<button type="button" class="btn btn-ghost btn-sm" id="personShare">' + ic('share-2') + ' Link de cobrança' + (shareFor('person', key) ? ' <span class="live-dot" title="ativo"></span>' : '') + '</button>' : '') +
        (rec.length && cloudOn() ? '<button type="button" class="btn btn-ghost btn-sm" id="personTg">' + ic('send') + ' Lembretes no Telegram' + (friendOf(key) ? ' <span class="live-dot" title="conectado"></span>' : '') + '</button>' : '') +
        '<button type="button" class="btn btn-primary btn-sm" id="personNewDebt">' + ic('plus') + ' Nova dívida com ' + escapeHtml(firstName(name)) + '</button>' +
      '</div>' +
      personExtraHtml(key) +
      '<div class="stats person-stats">' + stats + '</div>' +
      '<div class="section-h">' + ic('handshake') + ' Dívidas</div>' +
      '<div class="list" id="personDebts"></div>' +
      '<div class="section-h">' + ic('list') + ' Histórico de pagamentos</div>' +
      '<div class="history-list person-history">' + histHtml + '</div>';

    var listBox = document.getElementById('personDebts');
    debts.slice().sort(function(a, b){
      if(isPaid(a) !== isPaid(b)) return isPaid(a) ? 1 : -1;
      var x = nextDueDate(a), y = nextDueDate(b);
      return (x ? x.getTime() : Infinity) - (y ? y.getTime() : Infinity);
    }).forEach(function(d){ listBox.appendChild(buildCard(d, {inPerson: true})); });
    document.getElementById('personTagsEdit').addEventListener('click', function(){ personTagsDialog(key, name); });
    var psh = document.getElementById('personShare');
    if(psh) psh.addEventListener('click', function(){ openShareDialog('person', key, name); });
    var ptg = document.getElementById('personTg');
    if(ptg) ptg.addEventListener('click', function(){ openTgRemind(key, name); });
    document.getElementById('personNewDebt').addEventListener('click', function(){
      openModal(null);
      setFormKind(rec.length || !pay.length ? 'receivable' : 'payable');
      fName.value = name;
      if(phone) fPhone.value = formatPhoneDisplay(phone);
    });
  }

  // ---------- dívida aberta: painel ao lado no PC, tela cheia no celular ----------
  var wideMQ = window.matchMedia ? window.matchMedia('(min-width:1024px)') : {matches: false, addEventListener: function(){}};
  function placeOpenDetail(){
    var pane = document.getElementById('psDetail');
    if(!pane) return;
    pane.innerHTML = '';
    var card = listEl.querySelector('.card[data-debt-id].open');
    if(wideMQ.matches && card){
      var body = card.querySelector('.card-body');
      if(body){
        body.style.maxHeight = 'none';
        var close = document.createElement('button');
        close.type = 'button'; close.className = 'btn btn-ghost btn-sm btn-icon od-close'; close.setAttribute('aria-label', 'Fechar');
        close.innerHTML = ic('x');
        close.addEventListener('click', function(){ state.openId = null; render(); });
        pane.appendChild(close);
        pane.appendChild(body);
        pane.classList.add('has');
        return;
      }
    }
    pane.classList.remove('has');
    if(wideMQ.matches) pane.innerHTML = '<div class="ps-empty">' + ic('hand-coins') + '<b>Escolha alguém na lista</b><span>A dívida abre aqui do lado, com as parcelas, o histórico e o botão de registrar pagamento.</span></div>';
  }
  function syncSheet(){
    var host = state.page === 'pessoas' ? listEl : state.page === 'pessoa' ? document.getElementById('personContent') : null;
    var open = !wideMQ.matches && !!(host && host.querySelector('.card[data-debt-id].open'));
    document.body.classList.toggle('sheet-open', open);
  }
  if(wideMQ.addEventListener) wideMQ.addEventListener('change', function(){ render(); });

  // ---------- "Esta semana" no Início ----------
  // cada fonte devolve itens {date, title, sub, amount, dir:'in'|'out', late, icon, open(), act:{label, run()}}
  var weekSources = [];
  weekSources.push(function(limitISO){
    var today = todayISO();
    return state.debts.filter(function(d){ return !isPaid(d); }).map(function(d){
      var due = nextDueDate(d);
      if(!due) return null;
      var dueISO = toISO(due);
      if(dueISO > limitISO) return null;
      var q = quickPayInfo(d);
      var g = groupOf(d);
      var late = dueISO < today;
      return {
        date: dueISO, title: d.name, late: late,
        sub: (g ? g.title + ' · ' : '') + (late ? 'atrasado desde ' + fmtDate(dueISO) : dueISO === today ? 'vence hoje' : 'vence ' + fmtDate(dueISO)),
        amount: q ? q.amount : amountDueNow(d), dir: d.kind === 'payable' ? 'out' : 'in',
        icon: d.kind === 'payable' ? 'banknote-arrow-up' : 'hand-coins',
        open: function(){ goToDebt(d.id); },
        act: q ? {label: d.kind === 'payable' ? 'Paguei' : 'Recebi', run: function(){ quickPay(d); }} : null,
        part: q ? {label: d.kind === 'payable' ? 'Paguei só uma parte' : 'Recebi só uma parte', run: function(){ partialPayDialog(d); }} : null
      };
    }).filter(Boolean);
  });
  function goToDebt(id){
    var d = state.debts.find(function(x){ return x.id === id; });
    if(!d) return;
    if(typeof setViewKind === 'function') setViewKind(d.kind);
    resetListFilters();
    state.openId = id;
    showPage('pessoas');
    if(state.grouped) { state.openGroups[d.name.trim().toLowerCase()] = true; render(); }
    var c = listEl.querySelector('.card.open');
    if(c) c.scrollIntoView({behavior: 'smooth', block: 'start'});
  }
  function renderWeek(){
    var box = document.getElementById('weekList');
    if(!box) return;
    var limit = new Date(); limit.setDate(limit.getDate() + 7);
    var limitISO = toISO(limit);
    var items = [];
    weekSources.forEach(function(src){ items = items.concat(src(limitISO) || []); });
    items.sort(function(a, b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var inSum = 0, outSum = 0;
    items.forEach(function(it){ if(it.dir === 'in') inSum += it.amount; else outSum += it.amount; });
    document.getElementById('weekSub').textContent = items.length
      ? (inSum ? 'entra ' + money.format(inSum) : '') + (inSum && outSum ? ' · ' : '') + (outSum ? 'sai ' + money.format(outSum) : '')
      : '';
    if(!items.length){
      box.innerHTML = '<div class="wk-empty">' + ic('party-popper', 'i-ok') + ' Nada vencendo nos próximos 7 dias.</div>';
      return;
    }
    box.innerHTML = '';
    var shown = items.slice(0, 12), hasLate = shown.some(function(it){ return it.late; }), lastGroup = null;
    shown.forEach(function(it){
      var grpName = it.late ? 'Precisa de você' : 'Esta semana';
      if(hasLate && grpName !== lastGroup){
        var gh = document.createElement('div');
        gh.className = 'wk-group' + (it.late ? ' late' : '');
        gh.textContent = grpName;
        box.appendChild(gh);
        lastGroup = grpName;
      }
      var row = document.createElement('div');
      row.className = 'wk-row' + (it.late ? ' late' : '');
      row.innerHTML =
        '<span class="wk-ic ' + it.dir + '">' + ic(it.icon) + '</span>' +
        '<button type="button" class="wk-main"><span class="wk-title">' + escapeHtml(it.title) + '</span><span class="wk-sub">' + escapeHtml(it.sub) + '</span></button>' +
        '<span class="wk-amt ' + it.dir + '">' + (it.dir === 'out' ? '−' : '+') + money.format(it.amount) + '</span>' +
        '<span class="wk-acts">' +
          (it.part ? '<button type="button" class="btn btn-ghost btn-sm btn-icon wk-part" title="' + escapeHtml(it.part.label) + '" aria-label="' + escapeHtml(it.part.label) + '">' + ic('chart-pie') + '</button>' : '') +
          (it.act ? '<button type="button" class="btn btn-ghost btn-sm wk-act">' + ic('check') + '<span>' + escapeHtml(it.act.label) + '</span></button>' : '') +
        '</span>';
      row.querySelector('.wk-main').addEventListener('click', it.open);
      var a = row.querySelector('.wk-act');
      if(a) a.addEventListener('click', function(){ it.act.run(); });
      var pt = row.querySelector('.wk-part');
      if(pt) pt.addEventListener('click', function(){ it.part.run(); });
      box.appendChild(row);
    });
    if(items.length > 12){
      var more = document.createElement('div');
      more.className = 'wk-more';
      more.textContent = '+ ' + (items.length - 12) + ' itens';
      box.appendChild(more);
    }
  }

  // ---------- "Resumo" recolhível em Pessoas ----------
  var resumoEl = document.getElementById('pessoasResumo');
  try{ if(localStorage.getItem('bb_resumo_open') === '1') resumoEl.open = true; }catch(e){}
  resumoEl.addEventListener('toggle', function(){ try{ localStorage.setItem('bb_resumo_open', resumoEl.open ? '1' : '0'); }catch(e){} });

  // ---------- folhas de baixo: arrastar para fechar (celular) ----------
  (function(){
    var startY = null, sheet = null, ov = null;
    document.addEventListener('touchstart', function(e){
      var m = e.target.closest('.overlay.show .modal');
      if(!m || m.scrollTop > 0) return;
      var r = m.getBoundingClientRect();
      if(e.touches[0].clientY - r.top > 56) return;
      startY = e.touches[0].clientY; sheet = m; ov = m.parentElement;
      sheet.style.transition = 'none';
    }, {passive: true});
    document.addEventListener('touchmove', function(e){
      if(startY === null) return;
      var dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = 'translateY(' + dy + 'px)';
    }, {passive: true});
    document.addEventListener('touchend', function(e){
      if(startY === null) return;
      var dy = (e.changedTouches[0].clientY - startY);
      sheet.style.transition = ''; sheet.style.transform = '';
      if(dy > 90) ov.dispatchEvent(new MouseEvent('click', {bubbles: true}));
      startY = null; sheet = null; ov = null;
    });
  })();

  // ---------- simulator ----------
  var simOverlay = document.getElementById('simOverlay');
  var simPrincipal = document.getElementById('simPrincipal');
  var simRate = document.getElementById('simRate');
  var simInstallments = document.getElementById('simInstallments');
  var simInterestType = document.getElementById('simInterestType');
  function updateSimulator(){
    var p = moneyVal(simPrincipal) || 0;
    var r = parseFloat(simRate.value) || 0;
    var n = Math.max(1, parseInt(simInstallments.value,10) || 1);
    var total = finalValue({principal:p, rate:r, installments:n, interestType: simInterestType.value});
    var inst = total / n;
    document.getElementById('simN').textContent = n + 'x';
    document.getElementById('simInstallment').textContent = money.format(inst);
    document.getElementById('simTotal').textContent = money.format(total);
    document.getElementById('simProfit').textContent = money.format(total - p);

    var formula = formulaHtml(p, r, n, simInterestType.value);
    document.getElementById('simFormula').innerHTML = '<div class="fl">Como chegamos nesse valor</div>' + formula;
  }
  function toSuperscript(n){
    var map = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
    return n.toString().split('').map(function(c){ return map[c] || c; }).join('');
  }
  [simPrincipal, simRate, simInstallments, simInterestType].forEach(function(el){ el.addEventListener('input', updateSimulator); el.addEventListener('change', updateSimulator); });
  document.getElementById('btnSimulator').addEventListener('click', function(){
    updateSimulator();
    simOverlay.classList.add('show');
  });
  document.getElementById('btnSimClose').addEventListener('click', function(){ simOverlay.classList.remove('show'); });
  simOverlay.addEventListener('click', function(e){ if(e.target === simOverlay) simOverlay.classList.remove('show'); });
  document.getElementById('btnSimUse').addEventListener('click', function(){
    simOverlay.classList.remove('show');
    openModal(null);
    fPrincipal.value = simPrincipal.value;
    fRate.value = simRate.value;
    fInstallments.value = simInstallments.value;
    fInterestType.value = simInterestType.value;
  });

  // ---------- delete modal ----------
  var deleteOverlay = document.getElementById('deleteOverlay');
  var delName = document.getElementById('delName');

  function performDelete(debt){
    var idx = state.debts.findIndex(function(x){ return x.id === debt.id; });
    if(idx === -1) return;
    var removed = state.debts[idx];
    state.debts.splice(idx, 1);
    if(state.openId === debt.id) state.openId = null;
    render();
    showUndoToast(removed, idx);
  }
  function openDeleteModal(debt){
    state.pendingDeleteId = debt.id;
    delName.textContent = debt.name;
    deleteOverlay.classList.add('show');
  }
  function closeDeleteModal(){ deleteOverlay.classList.remove('show'); state.pendingDeleteId = null; }
  document.getElementById('btnDelCancel').addEventListener('click', closeDeleteModal);
  deleteOverlay.addEventListener('click', function(e){ if(e.target === deleteOverlay) closeDeleteModal(); });
  document.getElementById('btnDelConfirm').addEventListener('click', function(){
    var d = state.debts.find(function(x){ return x.id === state.pendingDeleteId; });
    closeDeleteModal();
    if(d) performDelete(d);
  });

  function showUndoToast(debt, idx){
    showUndo('Dívida de ' + debt.name + ' excluída', function(){
      state.debts.splice(Math.min(idx, state.debts.length), 0, debt);
      render();
    }, 'Dívida restaurada', 'trash');
  }

  // ---------- settle with discount ----------
  var settleOverlay = document.getElementById('settleOverlay');
  var settleTargetId = null;
  function openSettleModal(d){
    settleTargetId = d.id;
    var isPayable = d.kind === 'payable';
    document.getElementById('settleName').textContent = d.name;
    document.getElementById('settleRemaining').textContent = money.format(remaining(d));
    document.getElementById('settleVerb').textContent = isPayable ? 'pagar' : 'receber';
    document.getElementById('lblSettleAmount').textContent = isPayable ? 'Valor que será pago agora (R$)' : 'Valor que será recebido agora (R$)';
    var input = document.getElementById('settleAmount');
    setMoney(input, remaining(d));
    document.getElementById('settleDate').value = todayISO();
    document.getElementById('settleNote').value = '';
    var settleWalletSel = document.getElementById('settleWallet');
    settleWalletSel.innerHTML = '<option value="">— não afetar carteira —</option>' +
      state.wallets.map(function(w){ return '<option value="'+escapeHtml(w.id)+'">' + escapeHtml(walletLabel(w)) + '</option>'; }).join('');
    settleWalletSel.value = defaultWalletId(d);
    document.getElementById('settleErr').textContent = '';
    settleOverlay.classList.add('show');
  }
  function closeSettleModal(){ settleOverlay.classList.remove('show'); settleTargetId = null; }
  document.getElementById('btnSettleCancel').addEventListener('click', closeSettleModal);
  settleOverlay.addEventListener('click', function(e){ if(e.target === settleOverlay) closeSettleModal(); });
  function confirmSettle(){
    var d = state.debts.find(function(x){ return x.id === settleTargetId; });
    if(!d) return;
    var val = moneyVal(document.getElementById('settleAmount'));
    if(isNaN(val) || val < 0){ document.getElementById('settleErr').textContent = 'Informe um valor válido.'; return; }
    var rem = remaining(d);
    var discountGiven = Math.max(0, rem - val);
    var note = document.getElementById('settleNote').value.trim();
    var dt = document.getElementById('settleDate').value || todayISO();
    var walletId = document.getElementById('settleWallet').value;
    if(val > 0){
      var payment = {date: dt, amount: val, mode: 'fifo', note: note || 'Quitação com desconto'};
      if(walletId) payment.walletId = walletId;
      d.payments.push(payment);
    }
    d.discount = (d.discount||0) + discountGiven;
    d.settledDate = dt;
    closeSettleModal();
    render();
    showToast(discountGiven > 0.005 ? 'Dívida quitada com desconto de ' + money.format(discountGiven) : 'Dívida quitada');
  }
  document.getElementById('btnSettleConfirm').addEventListener('click', confirmSettle);

  // ---------- dívida em grupo (vaquinha / conta dividida) ----------
  // Um grupo gera uma dívida normal por participante (debt.groupId). Parcelas, pagamentos,
  // atraso, WhatsApp e carteiras continuam funcionando por pessoa; o grupo só junta a visão.
  function uid(prefix){ return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
  function groupById(id){ for(var i=0;i<state.groups.length;i++){ if(state.groups[i].id === id) return state.groups[i]; } return null; }
  function groupOf(d){ return d && d.groupId ? groupById(d.groupId) : null; }
  function groupMembers(g){ return state.debts.filter(function(d){ return d.groupId === g.id; }); }
  function memberState(d){ var s = statusOf(d); return s === 'pago' ? 'pago' : (s === 'atrasado' ? 'atrasado' : 'pendente'); }
  function groupStats(g){
    var members = groupMembers(g), owed = 0, paid = 0, rem = 0, late = 0, done = 0;
    members.forEach(function(d){
      var et = effectiveTotal(d);
      owed += et; paid += Math.min(paidAmount(d), et); rem += remaining(d);
      var s = memberState(d);
      if(s === 'atrasado') late++;
      if(s === 'pago') done++;
    });
    return {members: members, owed: owed, paid: paid, remaining: rem, late: late, done: done};
  }
  function parseMoney(v){ return parseMoneyBR(v); }
  function addDaysISO(iso, days){ var dt = new Date(iso + 'T00:00:00'); dt.setDate(dt.getDate() + days); return toISO(dt); }
  function firstName(name){ return String(name).trim().split(/\s+/)[0] || name; }
  function setViewKind(kind){
    state.viewKind = kind === 'payable' ? 'payable' : 'receivable';
    document.querySelectorAll('#kindToggle button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-k') === state.viewKind); });
    updateGroupButtonLabel();
  }
  function resetListFilters(){
    state.filter = 'todos';
    document.querySelectorAll('#filters button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-f') === 'todos'); });
    state.query = '';
    document.getElementById('search').value = '';
  }
  function goToPessoas(){
    if(state.page !== 'pessoas') showPage('pessoas', {keepScroll: true});
  }
  // abre a dívida de um participante, como se tivesse clicado nela na lista
  function openDebtFromGroup(debtId){
    var d = state.debts.find(function(x){ return x.id === debtId; });
    if(!d) return;
    setViewKind(d.kind);
    resetListFilters();
    state.openId = d.id;
    if(state.grouped) state.openGroups[d.name.trim().toLowerCase()] = true;
    goToPessoas();
    render();
    var card = listEl.querySelector('.card.open');
    if(card) card.scrollIntoView({behavior:'smooth', block:'start'});
  }
  function focusGroup(gid){
    var g = groupById(gid);
    if(!g) return;
    goToPessoas();
    setViewKind(g.kind);
    resetListFilters();
    state.openGroupId = gid;
    render();
    var el = null;
    groupListEl.querySelectorAll('.gcard').forEach(function(c){ if(c.getAttribute('data-gid') === gid) el = c; });
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }

  // ---------- lista de grupos (página Pessoas) ----------
  var groupListEl = document.getElementById('groupList');
  function groupMatchesFilter(g, st){
    var q = state.query.trim().toLowerCase();
    if(q && g.title.toLowerCase().indexOf(q) === -1 &&
       !st.members.some(function(d){ return d.name.toLowerCase().indexOf(q) !== -1; })) return false;
    if(state.filter === 'pendentes' && !(st.remaining > EPS)) return false;
    if(state.filter === 'pagos' && !(st.members.length && st.remaining <= EPS)) return false;
    if(state.filter === 'atrasados' && !st.late) return false;
    return true;
  }
  function renderGroups(){
    var items = state.groups
      .filter(function(g){ return g.kind === state.viewKind; })
      .map(function(g){ return {g: g, st: groupStats(g)}; })
      .filter(function(x){ return groupMatchesFilter(x.g, x.st); });
    items.sort(function(a, b){ return a.g.date < b.g.date ? 1 : (a.g.date > b.g.date ? -1 : 0); });
    groupListEl.innerHTML = '';
    if(!items.length) return;
    var title = document.createElement('div');
    title.className = 'glist-title';
    title.textContent = items.length === 1 ? '1 grupo' : items.length + ' grupos';
    groupListEl.appendChild(title);
    items.forEach(function(x){ groupListEl.appendChild(buildGroupCard(x.g, x.st)); });
  }
  function buildGroupCard(g, st){
    var isPayable = g.kind === 'payable';
    var open = state.openGroupId === g.id;
    var n = st.members.length;
    var card = document.createElement('div');
    card.className = 'gcard' + (open ? ' open' : '');
    card.setAttribute('data-gid', g.id);

    var badgeCls, badgeTxt;
    if(!n){ badgeCls = 'pendente'; badgeTxt = 'Sem participantes'; }
    else if(st.remaining <= EPS){ badgeCls = 'pago'; badgeTxt = 'Quitado'; }
    else if(st.late){ badgeCls = 'atrasado'; badgeTxt = st.late + (st.late === 1 ? ' atrasado' : ' atrasados'); }
    else { badgeCls = 'emdia'; badgeTxt = st.done + '/' + n + (isPayable ? ' pagos' : ' pagaram'); }

    var sub = fmtDate(g.date) + ' · ' + n + (n === 1 ? ' pessoa' : ' pessoas') + (g.dueDate ? ' · pagar até ' + fmtDate(g.dueDate) : '');
    var pct = st.owed > 0 ? Math.max(0, Math.min(100, st.paid / st.owed * 100)) : 0;
    var meta = '';
    if(g.includeMe && g.myShare > EPS) meta = 'Conta total ' + money.format(g.total) + ' · sua parte ' + money.format(g.myShare);
    else if(Math.abs(g.total - st.owed) > 0.009 && n) meta = 'Total combinado ' + money.format(g.total);
    // barra dividida por pessoa: cada pedaço tem o tamanho da parte dela e mostra quanto já foi pago
    var segs = st.members.map(function(d){
      var et = effectiveTotal(d), s = memberState(d);
      var fill = et > 0 ? Math.max(0, Math.min(100, paidAmount(d) / et * 100)) : 100;
      return '<span class="gp-seg st-' + s + '" style="flex:' + Math.max(et, 0.01).toFixed(2) + ' 1 0" title="' + escapeHtml(d.name + ': ' + money.format(Math.min(paidAmount(d), et)) + ' de ' + money.format(et)) + '"><i style="width:' + fill.toFixed(1) + '%"></i></span>';
    }).join('');

    var avatars = st.members.map(function(d){
      var s = memberState(d);
      var label = s === 'pago' ? (isPayable ? 'pago' : 'pagou') : (s === 'atrasado' ? 'atrasado, falta ' + money.format(remaining(d)) : 'falta ' + money.format(remaining(d)));
      var tail = s === 'pago' ? '<span class="g-av-st" aria-hidden="true">' + ic('check') + '</span>'
        : '<span class="g-av-due">' + money.format(remaining(d)) + '</span>';
      return '<button type="button" class="g-av st-' + s + '" data-debt="' + escapeHtml(d.id) + '" title="' + escapeHtml(d.name + ': ' + label) + '" aria-label="' + escapeHtml(d.name + ': ' + label + '. Abrir dívida') + '">' +
        '<span class="avatar">' + escapeHtml(initials(d.name)) + '</span>' +
        '<span class="g-av-name">' + escapeHtml(firstName(d.name)) + '</span>' + tail +
      '</button>';
    }).join('');

    var head = document.createElement('div');
    head.className = 'gcard-head';
    head.innerHTML =
      '<div class="g-icon" aria-hidden="true">' + ic('users') + '</div>' +
      '<div class="who"><div class="name">' + escapeHtml(g.title) + '</div><div class="sub">' + sub + '</div></div>' +
      '<div class="badge ' + badgeCls + '">' + badgeTxt + '</div>' +
      '<div class="chev">' + ic('chevron-down') + '</div>';
    head.addEventListener('click', function(){
      state.openGroupId = open ? null : g.id;
      render();
    });
    card.appendChild(head);

    var top = document.createElement('div');
    top.innerHTML =
      (n ? '<div class="gcard-prog">' +
        '<div class="gp-top"><div class="gp-amount"><b>' + money.format(st.paid) + '</b> <span>de ' + money.format(st.owed) + (isPayable ? ' pagos' : ' recebidos') + '</span></div>' +
        '<div class="gp-pct">' + Math.round(pct) + '%</div></div>' +
        '<div class="gp-bar">' + segs + '</div>' +
        (meta ? '<div class="gp-meta">' + meta + '</div>' : '') +
      '</div>' : '') +
      (n ? '<div class="g-avatars">' + avatars + '</div>' : '');
    while(top.firstChild) card.appendChild(top.firstChild);

    var body = document.createElement('div');
    body.className = 'gcard-body';
    if(open){
      var rows = st.members.map(function(d){
        var s = memberState(d), rem = remaining(d), paid = paidAmount(d), txt, cls = '';
        if(s === 'pago'){ txt = ic('check') + (isPayable ? ' pago' : ' pagou'); cls = 'ok'; }
        else {
          txt = (paid > EPS ? (isPayable ? 'já paguei ' : 'pagou ') + money.format(paid) + ' · ' : '') + 'falta ' + money.format(rem);
          if(s === 'atrasado'){ txt += ' · atrasado'; cls = 'late'; }
        }
        return '<div class="g-row"><span class="gr-name">' + escapeHtml(d.name) + '</span>' +
          '<span class="gr-val">' + money.format(effectiveTotal(d)) + '</span>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-open="' + escapeHtml(d.id) + '">Abrir ' + ic('chevron-right', 'i-sm') + '</button>' +
          '<span class="gr-st ' + cls + '">' + txt + '</span></div>';
      }).join('');
      if(g.includeMe && g.myShare > EPS){
        rows += '<div class="g-row me"><span class="gr-name">Você</span><span class="gr-val">' + money.format(g.myShare) + '</span><span></span>' +
          '<span class="gr-st">sua parte, fica fora da cobrança</span></div>';
      }
      if(!n) rows = '<div class="g-empty">Ninguém neste grupo. Use Editar grupo para adicionar pessoas.</div>';
      var wallet = g.walletId ? state.wallets.find(function(w){ return w.id === g.walletId; }) : null;
      body.innerHTML =
        rows +
        (wallet ? '<div class="g-meta">Pagamentos caem em: <b>' + escapeHtml(walletLabel(wallet)) + '</b></div>' : '') +
        (g.notes ? '<div class="notes-block" style="margin-top:10px;"><b>Anotações</b> ' + escapeHtml(g.notes) + '</div>' : '') +
        '<div class="card-actions g-actions">' +
          (!isPayable && st.remaining > EPS ? '<button type="button" class="btn btn-whats btn-sm" data-gact="charge">' + ic('message-circle') + ' Cobrar pendentes</button>' : '') +
          (n && !isPayable ? '<button type="button" class="btn btn-ghost btn-sm" data-gact="share">' + ic('share-2') + ' Link do grupo' + (shareFor('group', g.id) ? ' <span class="live-dot" title="ativo"></span>' : '') + '</button>' : '') +
          (n ? '<button type="button" class="btn btn-ghost btn-sm" data-gact="image">' + ic('image') + ' Imagem resumo</button>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" data-gact="edit">' + ic('pencil') + ' Editar grupo</button>' +
          '<div class="spacer"></div>' +
          '<button type="button" class="btn btn-danger btn-sm" data-gact="delete">' + ic('trash') + ' Excluir grupo</button>' +
        '</div>';
    }
    card.appendChild(body);

    card.addEventListener('click', function(e){
      var av = e.target.closest('[data-debt]');
      if(av){ e.stopPropagation(); openDebtFromGroup(av.getAttribute('data-debt')); return; }
      var op = e.target.closest('[data-open]');
      if(op){ e.stopPropagation(); openDebtFromGroup(op.getAttribute('data-open')); return; }
      var act = e.target.closest('[data-gact]');
      if(!act) return;
      e.stopPropagation();
      var a = act.getAttribute('data-gact');
      if(a === 'charge') openCharge(g);
      else if(a === 'image') shareGroupImage(g);
      else if(a === 'share') openShareDialog('group', g.id, g.title);
      else if(a === 'edit') openGroupModal(g);
      else if(a === 'delete') openGroupDelete(g);
    });
    return card;
  }

  // ---------- formulário do grupo ----------
  var groupOverlay = document.getElementById('groupOverlay');
  var gTitle = document.getElementById('gTitle'), gTotal = document.getElementById('gTotal'), gDate = document.getElementById('gDate');
  var gDue = document.getElementById('gDue'), gWallet = document.getElementById('gWallet'), gNotes = document.getElementById('gNotes');
  var gIncludeMe = document.getElementById('gIncludeMe'), gIncludeMeRow = document.getElementById('gIncludeMeRow');
  var gPartInput = document.getElementById('gPartInput'), gPartsEl = document.getElementById('gParts');
  var gSumEl = document.getElementById('gSum'), gWarnEl = document.getElementById('gWarn'), gErrEl = document.getElementById('gErr');
  var gForm = null;

  function gIncluding(){ return gForm && gForm.kind === 'receivable' && gIncludeMe.checked; }
  function openGroupModal(group, kind){
    populateFriendsList();
    var editing = !!group;
    gForm = {
      editingId: editing ? group.id : null,
      kind: editing ? group.kind : (kind === 'payable' ? 'payable' : 'receivable'),
      split: editing ? group.splitMode : 'equal',
      parts: [], removed: [],
      me: editing ? (group.myShare || 0) : 0,
      origTotal: editing ? group.total : null,
      eq: {rest: 0, n: 0, fixed: 0}
    };
    if(editing){
      groupMembers(group).forEach(function(d){
        gForm.parts.push({name: d.name, amount: d.principal, debtId: d.id,
          locked: paidAmount(d) > EPS || (d.discount || 0) > EPS, paid: paidAmount(d)});
      });
    }
    document.getElementById('groupModalTitle').textContent = editing ? 'Editar grupo' : 'Nova dívida em grupo';
    document.getElementById('gSave').textContent = editing ? 'Salvar grupo' : 'Criar grupo';
    document.getElementById('gKindToggle').style.display = editing ? 'none' : '';
    gTitle.value = editing ? group.title : '';
    gTotal.value = editing ? fmtMoneyInput(group.total) : '';
    gDate.value = editing ? group.date : todayISO();
    gDue.value = editing ? (group.dueDate || '') : addDaysISO(todayISO(), 7);
    gNotes.value = editing ? group.notes : '';
    gIncludeMe.checked = editing ? !!group.includeMe : true;
    gPartInput.value = '';
    gWallet.innerHTML = '<option value="">— nenhuma —</option>' + state.wallets.map(function(w){
      return '<option value="' + escapeHtml(w.id) + '">' + escapeHtml(walletLabel(w)) + '</option>';
    }).join('');
    gWallet.value = editing && group.walletId && state.wallets.some(function(w){ return w.id === group.walletId; }) ? group.walletId : '';
    gErrEl.textContent = '';
    setGroupKind(gForm.kind);
    setGroupSplit(gForm.split);
    groupOverlay.classList.add('show');
    gTitle.focus();
  }
  function closeGroupModal(){ groupOverlay.classList.remove('show'); gForm = null; }

  function setGroupKind(k){
    gForm.kind = k === 'payable' ? 'payable' : 'receivable';
    document.querySelectorAll('#gKindToggle button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-k') === gForm.kind); });
    gIncludeMeRow.style.display = gForm.kind === 'receivable' ? '' : 'none';
    document.getElementById('lblGParts').textContent = gForm.kind === 'payable' ? 'Para quem eu devo' : 'Quem participa';
    renderGroupParts();
  }
  function setGroupSplit(s){
    gForm.split = s === 'custom' ? 'custom' : 'equal';
    document.querySelectorAll('#gSplitToggle button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-s') === gForm.split); });
    renderGroupParts();
  }
  document.getElementById('gKindToggle').addEventListener('click', function(e){
    var b = e.target.closest('button[data-k]'); if(b && gForm) setGroupKind(b.getAttribute('data-k'));
  });
  document.getElementById('gSplitToggle').addEventListener('click', function(e){
    var b = e.target.closest('button[data-s]'); if(b && gForm) setGroupSplit(b.getAttribute('data-s'));
  });
  gIncludeMe.addEventListener('change', function(){ if(gForm) renderGroupParts(); });
  gTotal.addEventListener('input', function(){
    if(!gForm) return;
    if(gForm.split === 'equal') renderGroupParts(); else updateGroupSum();
    updateGroupWarn();
  });

  function recalcEqual(){
    if(gForm.split !== 'equal') return;
    var total = parseMoney(gTotal.value);
    if(isNaN(total)) total = 0;
    var inc = gIncluding();
    var locked = gForm.parts.filter(function(p){ return p.locked; });
    var free = gForm.parts.filter(function(p){ return !p.locked; });
    var fixed = round2(locked.reduce(function(s, p){ return s + p.amount; }, 0));
    var n = free.length + (inc ? 1 : 0);
    var rest = round2(total - fixed);
    gForm.eq = {rest: rest, n: n, fixed: fixed, locked: locked.length};
    if(n > 0 && rest >= 0){
      var sh = splitEqual(rest, n);
      free.forEach(function(p, i){ p.amount = sh[i]; });
      gForm.me = inc ? sh[n - 1] : 0;
    } else {
      free.forEach(function(p){ p.amount = 0; });
      gForm.me = 0;
    }
  }
  function partRowHtml(p, i){
    var custom = gForm.split === 'custom';
    var amt = custom && !p.locked
      ? '<input class="gp-input money" type="text" inputmode="decimal" autocomplete="off" data-i="' + i + '" value="' + (p.amount > 0 ? fmtMoneyInput(p.amount) : '') + '" placeholder="0,00" aria-label="Valor de ' + escapeHtml(p.name) + '">'
      : '<span class="gp-amt">' + money.format(p.amount || 0) + '</span>';
    var lockNote = p.locked ? '<small>' + (gForm.kind === 'payable' ? 'já paguei ' : 'já pagou ') + money.format(p.paid) + '</small>' : '';
    return '<div class="gp-row"><span class="avatar">' + escapeHtml(initials(p.name)) + '</span>' +
      '<span class="gp-name">' + escapeHtml(p.name) + lockNote + '</span>' + amt +
      '<button type="button" class="gp-del" data-del="' + i + '" aria-label="Remover ' + escapeHtml(p.name) + '">' + ic('x') + '</button></div>';
  }
  function meRowHtml(){
    var custom = gForm.split === 'custom';
    var amt = custom
      ? '<input class="gp-input money" type="text" inputmode="decimal" autocomplete="off" data-me="1" value="' + (gForm.me > 0 ? fmtMoneyInput(gForm.me) : '') + '" placeholder="0,00" aria-label="Sua parte">'
      : '<span class="gp-amt">' + money.format(gForm.me || 0) + '</span>';
    return '<div class="gp-row me"><span class="avatar">EU</span><span class="gp-name">Você<small>sua parte, não vira dívida</small></span>' + amt + '<span></span></div>';
  }
  function renderGroupParts(){
    if(!gForm) return;
    recalcEqual();
    var html = gForm.parts.map(partRowHtml).join('');
    if(!gForm.parts.length) html = '<div class="g-empty">Ninguém ainda. Digite um nome acima e toque em Adicionar.</div>';
    if(gIncluding()) html += meRowHtml();
    gPartsEl.innerHTML = html;
    updateGroupSum();
    updateGroupWarn();
  }
  function updateGroupSum(){
    var total = parseMoney(gTotal.value);
    var inc = gIncluding();
    var sum = round2(gForm.parts.reduce(function(s, p){ return s + (p.amount || 0); }, 0) + (inc ? (gForm.me || 0) : 0));
    var cls = '', txt;
    if(!gForm.parts.length){ txt = 'Adicione pelo menos uma pessoa.'; }
    else if(!(total > 0)){ txt = 'Informe o valor total para dividir.'; }
    else if(gForm.split === 'equal'){
      var eq = gForm.eq;
      if(eq.rest < -EPS){ cls = 'bad'; txt = 'Quem já pagou soma ' + money.format(eq.fixed) + ', mais que o total.'; }
      else if(eq.n === 0){ cls = 'warn'; txt = 'Todo mundo já pagou: não sobrou ninguém para redividir.'; }
      else {
        var sh = splitEqual(eq.rest, eq.n), hi = sh[0], lo = sh[eq.n - 1];
        cls = 'ok';
        txt = money.format(eq.rest) + ' ÷ ' + eq.n + ' = ' + (hi === lo ? money.format(hi) : money.format(lo) + ' a ' + money.format(hi)) + ' cada';
        if(hi !== lo) txt += ' (os centavos que sobram vão para os primeiros)';
        if(eq.locked) txt += ' · quem já pagou mantém o valor';
      }
    } else {
      var diff = round2(total - sum);
      if(Math.abs(diff) <= EPS){ cls = 'ok'; txt = 'Fecha certinho com o total de ' + money.format(total) + '.'; }
      else if(diff > 0){ cls = 'warn'; txt = 'Faltam ' + money.format(diff) + ' pra fechar o total de ' + money.format(total) + '.'; }
      else { cls = 'bad'; txt = 'Passou ' + money.format(-diff) + ' do total de ' + money.format(total) + '.'; }
    }
    gSumEl.className = 'g-sum' + (cls ? ' ' + cls : '');
    gSumEl.innerHTML = ic(cls === 'ok' ? 'circle-check' : cls === 'bad' ? 'circle-alert' : cls === 'warn' ? 'triangle-alert' : 'info') + '<span>' + escapeHtml(txt) + '</span>';
  }
  function updateGroupWarn(){
    if(!gForm || !gForm.editingId){ gWarnEl.innerHTML = ''; return; }
    var payable = gForm.kind === 'payable', lines = [];
    gForm.removed.forEach(function(p){
      if(p.locked){
        lines.push(payable
          ? 'Você já pagou ' + money.format(p.paid) + ' a ' + escapeHtml(p.name) + ': essa dívida sai do grupo e continua como individual.'
          : escapeHtml(p.name) + ' já pagou ' + money.format(p.paid) + ': a dívida dele sai do grupo e continua como individual.');
      } else {
        lines.push('A dívida de ' + escapeHtml(p.name) + ' será apagada.');
      }
    });
    var total = parseMoney(gTotal.value);
    if(gForm.split === 'equal' && gForm.parts.some(function(p){ return p.locked; }) && !isNaN(total) && Math.abs(total - gForm.origTotal) > EPS){
      lines.push('O valor novo é redividido só entre quem ainda não pagou.');
    }
    gWarnEl.innerHTML = lines.length ? '<b>Ao salvar:</b><ul><li>' + lines.join('</li><li>') + '</li></ul>' : '';
  }

  function addGroupParticipants(raw){
    var names = String(raw || '').split(/[,;\n]+/).map(function(s){ return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var dupes = [];
    names.forEach(function(name){
      var key = nameKey(name);
      if(gForm.parts.some(function(p){ return nameKey(p.name) === key; })){ dupes.push(name); return; }
      var back = -1;
      gForm.removed.forEach(function(p, i){ if(nameKey(p.name) === key) back = i; });
      if(back >= 0){ gForm.parts.push(gForm.removed.splice(back, 1)[0]); return; }
      if(gForm.parts.length >= 60) return;
      gForm.parts.push({name: name, amount: 0, debtId: null, locked: false, paid: 0});
    });
    gErrEl.textContent = dupes.length ? dupes.join(', ') + (dupes.length > 1 ? ' já estão' : ' já está') + ' no grupo.' : '';
    gPartInput.value = '';
    renderGroupParts();
  }
  document.getElementById('gPartAdd').addEventListener('click', function(){ addGroupParticipants(gPartInput.value); gPartInput.focus(); });
  gPartInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); if(gPartInput.value.trim()) addGroupParticipants(gPartInput.value); }
  });
  gPartInput.addEventListener('input', function(){ if(/[,;]/.test(gPartInput.value)) addGroupParticipants(gPartInput.value); });
  gPartsEl.addEventListener('input', function(e){
    var t = e.target;
    if(!gForm || !t.classList.contains('gp-input')) return;
    var v = parseMoney(t.value);
    v = isNaN(v) || v < 0 ? 0 : round2(v);
    if(t.hasAttribute('data-me')) gForm.me = v;
    else { var p = gForm.parts[parseInt(t.getAttribute('data-i'), 10)]; if(p) p.amount = v; }
    updateGroupSum();
  });
  gPartsEl.addEventListener('click', function(e){
    var b = e.target.closest('.gp-del');
    if(!b || !gForm) return;
    var p = gForm.parts.splice(parseInt(b.getAttribute('data-del'), 10), 1)[0];
    if(p && p.debtId) gForm.removed.push(p);
    renderGroupParts();
  });

  function newGroupDebt(g, name, amount){
    return {
      id: uid(), name: name, principal: amount, date: g.date, days: 30, installments: 1,
      rate: 0, interestType: 'composto', dueDay: parseInt(g.dueDate.split('-')[2], 10), firstDue: g.dueDate,
      payments: [], notes: '', kind: g.kind, discount: 0, lateFeePct: 0, lateInterestPct: 0, groupId: g.id
    };
  }
  function saveGroup(){
    if(!gForm) return;
    var title = gTitle.value.trim();
    var total = parseMoney(gTotal.value);
    var date = gDate.value, due = gDue.value;
    var inc = gIncluding();
    function fail(msg){ gErrEl.textContent = msg; }
    if(gPartInput.value.trim()) addGroupParticipants(gPartInput.value);
    if(!title) return fail('Dê um nome ao grupo (ex: Churrasco de sábado).');
    if(!(total > 0)) return fail('Informe o valor total.');
    if(!date) return fail('Informe a data do grupo.');
    if(!due) return fail('Informe até quando pagar.');
    if(due < date) return fail('A data para pagar não pode ser antes da data do grupo.');
    if(!gForm.parts.length) return fail('Adicione pelo menos uma pessoa.');
    total = round2(total);
    if(gForm.split === 'equal'){
      recalcEqual();
      if(gForm.eq.rest < -EPS) return fail('Quem já pagou soma mais que o total. Aumente o total.');
      if(gForm.parts.some(function(p){ return !p.locked && !(p.amount > 0); })) return fail('O total não dá para dividir entre todo mundo.');
    } else {
      if(gForm.parts.some(function(p){ return !p.locked && !(p.amount > 0); })) return fail('Informe o valor de cada pessoa.');
      var sum = round2(gForm.parts.reduce(function(s, p){ return s + p.amount; }, 0) + (inc ? gForm.me : 0));
      var diff = round2(total - sum);
      if(Math.abs(diff) > EPS) return fail(diff > 0 ? 'Faltam ' + money.format(diff) + ' para fechar o total.' : 'A soma passou ' + money.format(-diff) + ' do total.');
    }
    var dueDay = parseInt(due.split('-')[2], 10);
    var g, created = 0;
    if(gForm.editingId){
      g = groupById(gForm.editingId);
      if(!g){ closeGroupModal(); return; }
      var keep = {};
      gForm.parts.forEach(function(p){ if(p.debtId) keep[p.debtId] = p; });
      var detached = 0, removed = 0;
      state.debts = state.debts.filter(function(d){
        if(d.groupId !== g.id) return true;
        var p = keep[d.id];
        if(!p){
          if(paidAmount(d) > EPS || (d.discount || 0) > EPS){ delete d.groupId; detached++; return true; }
          removed++; return false;
        }
        if(!p.locked) d.principal = p.amount;
        if(!isPaid(d)){ d.firstDue = due; d.dueDay = dueDay; }
        return true;
      });
      g.title = title; g.total = total; g.date = date; g.dueDate = due;
      g.splitMode = gForm.split; g.includeMe = inc; g.myShare = inc ? round2(gForm.me) : 0;
      g.walletId = gWallet.value; g.notes = gNotes.value.trim();
      gForm.parts.forEach(function(p){ if(!p.debtId){ state.debts.push(newGroupDebt(g, p.name, p.amount)); created++; } });
      showToast('Grupo atualizado' + (detached ? ' · ' + detached + ' virou individual' : '') + (removed ? ' · ' + removed + ' removido' + (removed > 1 ? 's' : '') : ''));
    } else {
      g = {
        id: uid('g-'), title: title, kind: gForm.kind, date: date, total: total,
        splitMode: gForm.split, includeMe: inc, myShare: inc ? round2(gForm.me) : 0,
        dueDate: due, walletId: gWallet.value, notes: gNotes.value.trim()
      };
      state.groups.push(g);
      gForm.parts.forEach(function(p){ state.debts.push(newGroupDebt(g, p.name, p.amount)); created++; });
      showToast('Grupo criado: ' + created + (created === 1 ? ' dívida gerada' : ' dívidas geradas'));
    }
    var gid = g.id;
    closeGroupModal();
    focusGroup(gid);
  }
  document.getElementById('gSave').addEventListener('click', saveGroup);
  document.getElementById('gCancel').addEventListener('click', closeGroupModal);
  groupOverlay.addEventListener('click', function(e){ if(e.target === groupOverlay) closeGroupModal(); });

  // "+ Nova dívida": Individual ou Em grupo
  document.getElementById('formModeToggle').addEventListener('click', function(e){
    var b = e.target.closest('button[data-m]');
    if(!b || b.getAttribute('data-m') !== 'group') return;
    var k = currentFormKind;
    closeModal();
    openGroupModal(null, k);
  });

  // ---------- cobrar pendentes ----------
  var chargeOverlay = document.getElementById('chargeOverlay');
  var chargeMsg = document.getElementById('chargeMsg');
  function groupChargeText(g){
    var st = groupStats(g);
    var pend = st.members.filter(function(d){ return remaining(d) > EPS; });
    var paid = st.members.filter(function(d){ return memberState(d) === 'pago'; });
    var lines = ['Oi, pessoal! Passando pra lembrar do *' + g.title + '* (' + fmtDate(g.date) + ').', '', 'Faltam:'];
    pend.forEach(function(d){ lines.push('• ' + d.name + ': ' + money.format(remaining(d)) + (memberState(d) === 'atrasado' ? ' (atrasado)' : '')); });
    if(paid.length) lines.push('', 'Já pagaram: ' + paid.map(function(d){ return firstName(d.name); }).join(', ') + ' ✓');
    if(g.dueDate) lines.push('', 'Prazo: ' + fmtDate(g.dueDate));
    if(settings.pixKey) lines.push('PIX: ' + settings.pixKey);
    var glink = shareLinkFor('group', g.id);
    if(glink) lines.push('Quem já pagou: ' + glink);
    lines.push('', 'Valeu! 🙂');
    return {text: lines.join('\n'), pend: pend};
  }
  function updateChargeLink(){ document.getElementById('chargeGroupLink').href = 'https://wa.me/?text=' + encodeURIComponent(chargeMsg.value); }
  function openCharge(g){
    var r = groupChargeText(g);
    chargeMsg.value = r.text;
    updateChargeLink();
    document.getElementById('chargeTitle').textContent = 'Cobrar pendentes · ' + g.title;
    document.getElementById('chargeCopyStatus').textContent = '';
    document.getElementById('chargeList').innerHTML = r.pend.map(function(d){
      var link = whatsappLink(d);
      return '<div class="charge-row"><span><b>' + escapeHtml(d.name) + '</b> ' + money.format(remaining(d)) + '</span>' +
        (link ? '<a class="btn btn-whats btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(link) + '">WhatsApp</a>'
              : '<span class="charge-nophone">sem telefone</span>') + '</div>';
    }).join('') || '<div class="g-empty">Ninguém pendente.</div>';
    chargeOverlay.classList.add('show');
  }
  function closeCharge(){ chargeOverlay.classList.remove('show'); }
  chargeMsg.addEventListener('input', updateChargeLink);
  document.getElementById('chargeClose').addEventListener('click', closeCharge);
  chargeOverlay.addEventListener('click', function(e){ if(e.target === chargeOverlay) closeCharge(); });
  document.getElementById('chargeCopy').addEventListener('click', function(){
    var status = document.getElementById('chargeCopyStatus');
    function fallback(){
      chargeMsg.focus(); chargeMsg.select();
      try{ document.execCommand('copy'); status.textContent = 'Mensagem copiada.'; }
      catch(e){ status.textContent = 'Selecionei a mensagem: use Copiar do teclado.'; }
    }
    try{ navigator.clipboard.writeText(chargeMsg.value).then(function(){ status.textContent = 'Mensagem copiada.'; }, fallback); }
    catch(e){ fallback(); }
  });

  // ---------- excluir grupo ----------
  var groupDelOverlay = document.getElementById('groupDelOverlay');
  var pendingGroupDel = null;
  function openGroupDelete(g){
    pendingGroupDel = g.id;
    var ms = groupMembers(g);
    var paidSum = ms.reduce(function(s, d){ return s + paidAmount(d); }, 0);
    document.getElementById('gDelText').innerHTML = ms.length
      ? 'O grupo <b>' + escapeHtml(g.title) + '</b> tem ' + ms.length + (ms.length === 1 ? ' dívida' : ' dívidas') + '. O que fazer com ' + (ms.length === 1 ? 'ela' : 'elas') + '?' +
        (paidSum > EPS ? '<br><br>Se apagar tudo, os pagamentos já registrados (' + money.format(paidSum) + ') também somem.' : '')
      : 'O grupo <b>' + escapeHtml(g.title) + '</b> não tem ninguém. Ele será apagado.';
    document.getElementById('gDelKeep').style.display = ms.length ? '' : 'none';
    document.getElementById('gDelAll').textContent = ms.length ? 'Apagar grupo e dívidas' : 'Apagar grupo';
    groupDelOverlay.classList.add('show');
  }
  function closeGroupDelete(){ groupDelOverlay.classList.remove('show'); pendingGroupDel = null; }
  function finishGroupDelete(keepDebts){
    var g = groupById(pendingGroupDel);
    closeGroupDelete();
    if(!g) return;
    var n = groupMembers(g).length;
    if(keepDebts) state.debts.forEach(function(d){ if(d.groupId === g.id) delete d.groupId; });
    else state.debts = state.debts.filter(function(d){ return d.groupId !== g.id; });
    state.groups = state.groups.filter(function(x){ return x.id !== g.id; });
    if(state.openGroupId === g.id) state.openGroupId = null;
    render();
    showToast(keepDebts ? 'Grupo excluído. As dívidas continuam como individuais.' : 'Grupo excluído' + (n ? ' com ' + n + (n === 1 ? ' dívida' : ' dívidas') : ''));
  }
  document.getElementById('gDelKeep').addEventListener('click', function(){ finishGroupDelete(true); });
  document.getElementById('gDelAll').addEventListener('click', function(){ finishGroupDelete(false); });
  document.getElementById('gDelCancel').addEventListener('click', closeGroupDelete);
  groupDelOverlay.addEventListener('click', function(e){ if(e.target === groupDelOverlay) closeGroupDelete(); });

  // =====================================================================
  // Contas fixas (contas e receitas recorrentes) e cartões de crédito
  // =====================================================================
  function ymKey(y, m){ return y + '-' + pad2(m + 1); }
  function ymOf(iso){ return String(iso).slice(0, 7); }
  function ymAdd(key, n){
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return ymKey(y, m);
  }
  function dayIn(key, day){
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1;
    return toISO(new Date(y, m, Math.min(Math.max(1, day || 1), daysInMonth(y, m))));
  }
  function ymLabel(key){ return MONTH_NAMES[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4); }
  function ymShort(key){ return MONTH_NAMES[+key.slice(5, 7) - 1].slice(0, 3).toLowerCase(); }
  function daysFromToday(iso){ var t = new Date(todayISO() + 'T00:00:00'), d = new Date(iso + 'T00:00:00'); return Math.round((d - t) / 86400000); }
  var contasState = {key: ymOf(todayISO())};

  // ---------- contas fixas ----------
  function billApplies(b, key){ return b.active !== false && (!b.startMonth || key >= b.startMonth) && (!b.endMonth || key <= b.endMonth); }
  function billStatus(b, key){
    var due = dayIn(key, b.dueDay);
    var paid = b.paid && b.paid[key];
    if(paid) return {st: 'paga', due: due};
    var diff = daysFromToday(due);
    return {st: diff < 0 ? 'atrasada' : diff <= 7 ? 'embreve' : 'aberta', due: due, diff: diff};
  }
  function billTxOf(b, key){
    var id = b.paid && b.paid[key];
    return id ? state.transactions.find(function(t){ return t.id === id; }) : null;
  }
  function payBillDialog(b, key){
    var isIn = b.kind === 'entrada';
    openDialog({
      title: (isIn ? 'Receber: ' : 'Pagar: ') + b.name, icon: isIn ? 'arrow-down-left' : 'receipt', okText: isIn ? 'Marcar como recebida' : 'Marcar como paga',
      html: '<p class="warn">' + ymLabel(key) + ' · vence ' + fmtDate(dayIn(key, b.dueDay)) + '</p>' +
        '<div class="field-row"><div class="field"><label for="pbAmount">Valor (R$)</label><input id="pbAmount" class="money" type="text" inputmode="decimal" autocomplete="off" value="' + fmtMoneyInput(b.amount) + '"></div>' +
        '<div class="field"><label for="pbDate">Data</label><input id="pbDate" type="date" value="' + todayISO() + '"></div></div>' +
        '<div class="field"><label for="pbWallet">Carteira</label><select id="pbWallet" class="select" style="width:100%;">' + walletOptions(b.walletId || settings.defaultWalletId || '') + '</select></div>',
      onOk: function(body){
        var v = moneyVal(body.querySelector('#pbAmount'));
        if(!(v > 0)) return 'Informe um valor maior que zero.';
        var dt = body.querySelector('#pbDate').value || todayISO();
        var w = body.querySelector('#pbWallet').value;
        markBillPaid(b, key, round2(v), dt, w);
        return true;
      }
    });
  }
  function markBillPaid(b, key, amount, date, walletId){
    if(!b.paid) b.paid = {};
    var tx = null;
    if(walletId){
      tx = {id: uid(), walletId: walletId, type: b.kind === 'entrada' ? 'entrada' : 'gasto', amount: amount, date: date, category: b.category || b.name, note: b.name, auto: 'bill:' + b.id + ':' + key};
      state.transactions.push(tx);
    }
    b.paid[key] = tx ? tx.id : 'x';
    renderAll(); saveData();
    showUndo(b.name + (b.kind === 'entrada' ? ' recebida' : ' paga') + ' · ' + money.format(amount), function(){
      unmarkBill(b, key, true);
    }, 'Marcação desfeita', 'receipt');
  }
  function unmarkBill(b, key, silent){
    var id = b.paid && b.paid[key];
    if(!id) return;
    state.transactions = state.transactions.filter(function(t){ return t.id !== id; });
    delete b.paid[key];
    renderAll(); saveData();
    if(!silent) showToast(b.name + ': marcação de ' + ymLabel(key) + ' desfeita', 'undo-2');
  }
  function billDialog(b){
    var editing = !!b;
    b = b || {kind: 'gasto', name: '', amount: '', dueDay: new Date().getDate(), walletId: settings.defaultWalletId || '', category: '', startMonth: contasState.key};
    var cats = [];
    state.transactions.forEach(function(t){ if(t.category && cats.indexOf(t.category) === -1 && t.type !== 'transferencia') cats.push(t.category); });
    openDialog({
      title: editing ? 'Editar conta fixa' : 'Nova conta fixa', icon: 'repeat', okText: editing ? 'Salvar' : 'Criar',
      html:
        '<div class="field"><label for="bdKind">Tipo</label><select id="bdKind" class="select" style="width:100%;">' +
          '<option value="gasto"' + (b.kind !== 'entrada' ? ' selected' : '') + '>Conta a pagar (aluguel, internet, assinatura…)</option>' +
          '<option value="entrada"' + (b.kind === 'entrada' ? ' selected' : '') + '>Receita que entra todo mês (salário, aluguel recebido…)</option>' +
        '</select></div>' +
        '<div class="field"><label for="bdName">Nome</label><input id="bdName" type="text" maxlength="50" placeholder="Ex: Internet, Aluguel, Netflix" value="' + escapeHtml(b.name) + '"></div>' +
        '<div class="field-row"><div class="field"><label for="bdAmount">Valor (R$)</label><input id="bdAmount" class="money" type="text" inputmode="decimal" autocomplete="off" value="' + (b.amount !== '' ? fmtMoneyInput(b.amount) : '') + '" placeholder="0,00"></div>' +
        '<div class="field"><label for="bdDay">Dia do vencimento</label><input id="bdDay" type="number" min="1" max="31" step="1" value="' + escapeHtml(String(b.dueDay)) + '"></div></div>' +
        '<div class="field-row"><div class="field"><label for="bdCat">Categoria</label><input id="bdCat" type="text" list="bdCats" maxlength="40" placeholder="Ex: Moradia" value="' + escapeHtml(b.category || '') + '"><datalist id="bdCats">' + cats.map(function(c){ return '<option value="' + escapeHtml(c) + '">'; }).join('') + '</datalist></div>' +
        '<div class="field"><label for="bdWallet">Carteira</label><select id="bdWallet" class="select" style="width:100%;">' + walletOptions(b.walletId || '').replace('— não afetar carteira —', '— nenhuma —') + '</select></div></div>' +
        '<div class="field"><label for="bdStart">Começa em</label><input id="bdStart" type="month" value="' + escapeHtml(b.startMonth || contasState.key) + '"></div>' +
        (editing ? '<button type="button" class="btn btn-danger btn-sm" id="bdDelete">' + ic('trash') + ' Excluir conta fixa</button>' : ''),
      onOk: function(body){
        var name = body.querySelector('#bdName').value.trim();
        var amount = moneyVal(body.querySelector('#bdAmount'));
        var day = parseInt(body.querySelector('#bdDay').value, 10);
        if(!name) return 'Dê um nome para a conta.';
        if(!(amount > 0)) return 'Informe o valor (pode ser um valor médio).';
        if(!(day >= 1 && day <= 31)) return 'Informe um dia de vencimento entre 1 e 31.';
        var data = {kind: body.querySelector('#bdKind').value, name: name, amount: round2(amount), dueDay: day,
          category: body.querySelector('#bdCat').value.trim(), walletId: body.querySelector('#bdWallet').value,
          startMonth: body.querySelector('#bdStart').value || contasState.key};
        if(editing){ Object.keys(data).forEach(function(k){ b[k] = data[k]; }); }
        else { data.id = uid('b-'); data.active = true; data.paid = {}; state.bills.push(data); }
        return true;
      }
    }).then(function(ok){ if(ok){ renderAll(); saveData(); showToast(editing ? 'Conta fixa atualizada' : 'Conta fixa criada', 'circle-check'); } });
    var del = document.getElementById('bdDelete');
    if(del) del.addEventListener('click', function(){
      closeDialog(false);
      var idx = state.bills.indexOf(b);
      if(idx === -1) return;
      state.bills.splice(idx, 1);
      renderAll(); saveData();
      showUndo('Conta fixa "' + b.name + '" excluída', function(){
        state.bills.splice(Math.min(idx, state.bills.length), 0, b);
        renderAll(); saveData();
      }, 'Conta fixa restaurada', 'trash');
    });
  }

  // ---------- cartões de crédito ----------
  function invoiceKeyFor(card, iso){
    var key = ymOf(iso);
    return iso > dayIn(key, card.closingDay) ? ymAdd(key, 1) : key;
  }
  function invoiceDates(card, key){
    var dueKey = card.dueDay > card.closingDay ? key : ymAdd(key, 1);
    return {close: dayIn(key, card.closingDay), due: dayIn(dueKey, card.dueDay)};
  }
  // monta todas as faturas do cartão, levando o que não foi pago até o vencimento para a fatura seguinte
  function cardInvoices(card){
    var map = {};
    function inv(k){ return map[k] || (map[k] = {key: k, items: [], charges: 0, paid: 0, payments: []}); }
    state.cardPurchases.forEach(function(p){
      if(p.cardId !== card.id) return;
      var n = Math.max(1, parseInt(p.installments, 10) || 1);
      var first = invoiceKeyFor(card, p.date);
      var parts = splitEqual(p.amount, n);
      for(var i = 0; i < n; i++){
        var it = inv(ymAdd(first, i));
        it.items.push({p: p, i: i, n: n, value: parts[i]});
        it.charges = round2(it.charges + parts[i]);
      }
    });
    state.cardPayments.forEach(function(x){
      if(x.cardId !== card.id) return;
      var it = inv(x.invoice);
      it.paid = round2(it.paid + x.amount);
      it.payments.push(x);
    });
    var keys = Object.keys(map).sort();
    var today = todayISO(), nowKey = ymOf(today);
    if(!keys.length) return {map: map, get: function(k){ var it = inv(k); fill(it, 0); return it; }};
    var k = keys[0], last = keys[keys.length - 1] > nowKey ? keys[keys.length - 1] : nowKey, carry = 0;
    function fill(it, c){
      var dt = invoiceDates(card, it.key);
      it.close = dt.close; it.due = dt.due; it.carry = c;
      it.total = round2(it.charges + c);
      it.balance = round2(it.total - it.paid);
      it.status = it.total <= EPS && it.paid <= EPS ? 'vazia' : it.balance <= EPS ? 'paga' : today > it.due ? 'atrasada' : today > it.close ? 'fechada' : 'aberta';
    }
    while(k <= last){
      var it = inv(k);
      fill(it, carry);
      carry = (today > it.due && Math.abs(it.balance) > EPS) ? it.balance : 0;
      if(carry > 0) it.rolled = carry;
      k = ymAdd(k, 1);
    }
    return {map: map, get: function(key){ var it = inv(key); if(it.total === undefined) fill(it, 0); return it; }};
  }
  function cardUsed(card){
    var pur = 0, pay = 0;
    state.cardPurchases.forEach(function(p){ if(p.cardId === card.id) pur += p.amount; });
    state.cardPayments.forEach(function(x){ if(x.cardId === card.id) pay += x.amount; });
    return Math.max(0, round2(pur - pay));
  }
  function cardDialog(card){
    var editing = !!card;
    card = card || {name: '', limit: '', closingDay: 5, dueDay: 12, walletId: settings.defaultWalletId || ''};
    openDialog({
      title: editing ? 'Editar cartão' : 'Novo cartão de crédito', icon: 'credit-card', okText: editing ? 'Salvar' : 'Criar cartão',
      html:
        '<div class="field"><label for="cdName">Nome do cartão</label><input id="cdName" type="text" maxlength="30" placeholder="Ex: Nubank, Inter Gold" value="' + escapeHtml(card.name) + '"></div>' +
        '<div class="field"><label for="cdLimit">Limite (R$)</label><input id="cdLimit" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + (card.limit !== '' ? fmtMoneyInput(card.limit) : '') + '"></div>' +
        '<div class="field-row"><div class="field"><label for="cdClose">Dia que a fatura fecha</label><input id="cdClose" type="number" min="1" max="31" value="' + card.closingDay + '"></div>' +
        '<div class="field"><label for="cdDue">Dia do vencimento</label><input id="cdDue" type="number" min="1" max="31" value="' + card.dueDay + '"></div></div>' +
        '<div class="field"><label for="cdWallet">Pagar a fatura com</label><select id="cdWallet" class="select" style="width:100%;">' + walletOptions(card.walletId || '').replace('— não afetar carteira —', '— escolher na hora —') + '</select></div>' +
        (editing ? '<button type="button" class="btn btn-danger btn-sm" id="cdDelete">' + ic('trash') + ' Excluir cartão</button>' : ''),
      onOk: function(body){
        var name = body.querySelector('#cdName').value.trim();
        var limit = moneyVal(body.querySelector('#cdLimit'));
        var cd = parseInt(body.querySelector('#cdClose').value, 10), dd = parseInt(body.querySelector('#cdDue').value, 10);
        if(!name) return 'Dê um nome para o cartão.';
        if(!(cd >= 1 && cd <= 31) || !(dd >= 1 && dd <= 31)) return 'Use dias entre 1 e 31 para fechamento e vencimento.';
        var data = {name: name, limit: isNaN(limit) ? 0 : round2(limit), closingDay: cd, dueDay: dd, walletId: body.querySelector('#cdWallet').value};
        if(editing) Object.keys(data).forEach(function(k){ card[k] = data[k]; });
        else { data.id = uid('c-'); state.cards.push(data); }
        return true;
      }
    }).then(function(ok){ if(ok){ renderAll(); saveData(); showToast(editing ? 'Cartão atualizado' : 'Cartão criado', 'credit-card'); } });
    var del = document.getElementById('cdDelete');
    if(del) del.addEventListener('click', function(){
      closeDialog(false);
      appConfirm('Excluir cartão?', '<p class="warn">Excluir o cartão <b>' + escapeHtml(card.name) + '</b> e todas as compras dele? Os pagamentos de fatura já lançados nas carteiras continuam lá.</p>', {okText: 'Excluir', danger: true, icon: 'trash'}).then(function(ok){
        if(!ok) return;
        state.cards = state.cards.filter(function(c){ return c !== card; });
        state.cardPurchases = state.cardPurchases.filter(function(p){ return p.cardId !== card.id; });
        state.cardPayments = state.cardPayments.filter(function(p){ return p.cardId !== card.id; });
        renderAll(); saveData(); showToast('Cartão excluído', 'trash');
      });
    });
  }
  function purchaseDialog(card){
    var cats = [];
    state.cardPurchases.forEach(function(p){ if(p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });
    state.transactions.forEach(function(t){ if(t.type === 'gasto' && t.category && cats.indexOf(t.category) === -1) cats.push(t.category); });
    openDialog({
      title: 'Compra no ' + card.name, icon: 'shopping-bag', okText: 'Adicionar compra',
      html:
        '<div class="field"><label for="cpDesc">Descrição</label><input id="cpDesc" type="text" maxlength="50" placeholder="Ex: Tênis, Mercado, iFood"></div>' +
        '<div class="field-row"><div class="field"><label for="cpAmount">Valor total (R$)</label><input id="cpAmount" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>' +
        '<div class="field"><label for="cpN">Parcelas</label><input id="cpN" type="number" min="1" max="48" value="1"></div></div>' +
        '<div class="field-row"><div class="field"><label for="cpDate">Data da compra</label><input id="cpDate" type="date" value="' + todayISO() + '"></div>' +
        '<div class="field"><label for="cpCat">Categoria</label><input id="cpCat" type="text" list="cpCats" maxlength="40" placeholder="Ex: Roupas"><datalist id="cpCats">' + cats.map(function(c){ return '<option value="' + escapeHtml(c) + '">'; }).join('') + '</datalist></div></div>' +
        '<p class="warn" id="cpHint"></p>',
      onOk: function(body){
        var desc = body.querySelector('#cpDesc').value.trim();
        var amount = moneyVal(body.querySelector('#cpAmount'));
        var n = parseInt(body.querySelector('#cpN').value, 10);
        var date = body.querySelector('#cpDate').value || todayISO();
        if(!desc) return 'Descreva a compra.';
        if(!(amount > 0)) return 'Informe o valor da compra.';
        if(!(n >= 1 && n <= 48)) return 'Use de 1 a 48 parcelas.';
        state.cardPurchases.push({id: uid('p-'), cardId: card.id, desc: desc, amount: round2(amount), installments: n, date: date, category: body.querySelector('#cpCat').value.trim()});
        return true;
      }
    }).then(function(ok){ if(ok){ renderAll(); saveData(); showToast('Compra adicionada', 'shopping-bag'); } });
    var hint = document.getElementById('cpHint');
    function upd(){
      var dt = document.getElementById('cpDate').value || todayISO();
      var n = parseInt(document.getElementById('cpN').value, 10) || 1;
      var v = moneyVal(document.getElementById('cpAmount'));
      var key = invoiceKeyFor(card, dt);
      hint.textContent = 'Entra na fatura de ' + ymLabel(key).toLowerCase() + (n > 1 ? ' (' + n + 'x' + (v > 0 ? ' de ' + money.format(v / n) : '') + ', até ' + ymLabel(ymAdd(key, n - 1)).toLowerCase() + ')' : '') + '.';
    }
    ['cpDate', 'cpN', 'cpAmount'].forEach(function(id){ document.getElementById(id).addEventListener('input', upd); });
    upd();
  }
  function payInvoiceDialog(card, it){
    openDialog({
      title: 'Pagar fatura · ' + card.name, icon: 'credit-card', okText: 'Registrar pagamento',
      html: '<p class="warn">Fatura de ' + ymLabel(it.key).toLowerCase() + ' · vence ' + fmtDate(it.due) + ' · em aberto <b>' + money.format(Math.max(0, it.balance)) + '</b></p>' +
        '<div class="field-row"><div class="field"><label for="piAmount">Valor pago (R$)</label><input id="piAmount" class="money" type="text" inputmode="decimal" autocomplete="off" value="' + fmtMoneyInput(Math.max(0, it.balance)) + '"></div>' +
        '<div class="field"><label for="piDate">Data</label><input id="piDate" type="date" value="' + todayISO() + '"></div></div>' +
        '<div class="field"><label for="piWallet">Carteira</label><select id="piWallet" class="select" style="width:100%;">' + walletOptions(card.walletId || settings.defaultWalletId || '') + '</select></div>' +
        '<p class="warn">Pagou só uma parte? Sem problema: o que faltar vai para a próxima fatura depois do vencimento.</p>',
      onOk: function(body){
        var v = moneyVal(body.querySelector('#piAmount'));
        if(!(v > 0)) return 'Informe o valor pago.';
        var dt = body.querySelector('#piDate').value || todayISO();
        var w = body.querySelector('#piWallet').value;
        var pay = {id: uid('cp-'), cardId: card.id, invoice: it.key, amount: round2(v), date: dt};
        if(w){
          var tx = {id: uid(), walletId: w, type: 'gasto', amount: round2(v), date: dt, category: 'Cartão de crédito', note: 'Fatura ' + card.name + ' (' + ymShort(it.key) + ')', auto: 'card:' + pay.id};
          state.transactions.push(tx);
          pay.txId = tx.id;
        }
        state.cardPayments.push(pay);
        renderAll(); saveData();
        showUndo('Fatura ' + card.name + ': pago ' + money.format(v), function(){
          state.cardPayments = state.cardPayments.filter(function(x){ return x !== pay; });
          if(pay.txId) state.transactions = state.transactions.filter(function(t){ return t.id !== pay.txId; });
          renderAll(); saveData();
        }, 'Pagamento da fatura desfeito', 'credit-card');
        return true;
      }
    });
  }
  // lançamento automático apagado na carteira: desfaz o vínculo (e volta, se desfizer)
  function onTransactionRemoved(tx){
    if(!tx || !tx.auto) return;
    var m = /^bill:([^:]+):(\d{4}-\d{2})$/.exec(tx.auto);
    if(m){ var b = state.bills.find(function(x){ return x.id === m[1]; }); if(b && b.paid && b.paid[m[2]] === tx.id){ delete b.paid[m[2]]; tx._unlinked = {bill: b, key: m[2]}; } return; }
    var c = /^card:(.+)$/.exec(tx.auto);
    if(c){ var i = state.cardPayments.findIndex(function(x){ return x.id === c[1]; }); if(i !== -1){ tx._unlinked = {pay: state.cardPayments.splice(i, 1)[0], idx: i}; } }
  }
  function onTransactionRestored(tx){
    var u = tx && tx._unlinked;
    if(!u) return;
    if(u.bill){ u.bill.paid = u.bill.paid || {}; u.bill.paid[u.key] = tx.id; }
    if(u.pay) state.cardPayments.splice(Math.min(u.idx, state.cardPayments.length), 0, u.pay);
    delete tx._unlinked;
  }

  // ---------- página Contas ----------
  var CARD_TONES = ['tone-a', 'tone-b', 'tone-c', 'tone-d'];
  var openInvoice = {};
  function renderContasPage(){
    var key = contasState.key;
    document.getElementById('ctMonthLabel').textContent = ymLabel(key);
    var bills = state.bills.filter(function(b){ return billApplies(b, key); });
    bills.sort(function(a, b){ return a.dueDay - b.dueDay; });
    var toPay = 0, paidOut = 0, toReceive = 0, received = 0;
    var billBox = document.getElementById('billList');
    billBox.innerHTML = bills.length ? '' : '<div class="ct-empty">' + ic('repeat') + '<div><b>Nenhuma conta fixa ainda.</b><br>Cadastre aluguel, internet, assinaturas ou o seu salário e marque como pago todo mês.</div></div>';
    bills.forEach(function(b){
      var st = billStatus(b, key);
      var isIn = b.kind === 'entrada';
      var tx = billTxOf(b, key);
      var amount = tx ? tx.amount : b.amount;
      if(isIn){ if(st.st === 'paga') received += amount; else toReceive += amount; }
      else { if(st.st === 'paga') paidOut += amount; else toPay += amount; }
      var stTxt = st.st === 'paga' ? (isIn ? 'Recebida' : 'Paga') + (tx ? ' em ' + fmtDate(tx.date) : '')
        : st.st === 'atrasada' ? 'Atrasada ' + Math.abs(st.diff) + 'd'
        : st.diff === 0 ? 'Vence hoje' : st.st === 'embreve' ? 'Vence em ' + st.diff + (st.diff === 1 ? ' dia' : ' dias') : 'Vence dia ' + b.dueDay;
      var row = document.createElement('div');
      row.className = 'bill-row st-' + st.st + (isIn ? ' is-in' : '');
      row.innerHTML =
        '<span class="bill-ic">' + ic(isIn ? 'arrow-down-left' : 'receipt') + '</span>' +
        '<button type="button" class="bill-main"><span class="bill-name">' + escapeHtml(b.name) + '</span><span class="bill-sub">' + escapeHtml(stTxt) + (b.category ? ' · ' + escapeHtml(b.category) : '') + '</span></button>' +
        '<span class="bill-amt">' + (isIn ? '+' : '') + money.format(amount) + '</span>' +
        (st.st === 'paga'
          ? '<button type="button" class="btn btn-ghost btn-sm bill-act" data-a="unmark" title="Desmarcar">' + ic('undo-2') + '</button>'
          : '<button type="button" class="btn btn-sm bill-act ' + (st.st === 'atrasada' ? 'btn-primary' : 'btn-ghost') + '" data-a="pay">' + ic('check') + '<span>' + (isIn ? 'Recebi' : 'Paguei') + '</span></button>');
      row.querySelector('.bill-main').addEventListener('click', function(){ billDialog(b); });
      row.querySelector('.bill-act').addEventListener('click', function(){
        if(this.getAttribute('data-a') === 'pay') payBillDialog(b, key); else unmarkBill(b, key);
      });
      billBox.appendChild(row);
    });
    document.getElementById('ctToPay').textContent = money.format(toPay);
    document.getElementById('ctPaid').textContent = money.format(paidOut);
    document.getElementById('ctToReceive').textContent = money.format(toReceive + received);
    document.getElementById('ctToReceiveSub').textContent = toReceive > EPS ? 'falta ' + money.format(toReceive) : (received > EPS ? 'tudo recebido' : '');

    // cartões
    var cardBox = document.getElementById('cardList');
    cardBox.innerHTML = state.cards.length ? '' : '<div class="ct-empty">' + ic('credit-card') + '<div><b>Nenhum cartão ainda.</b><br>Cadastre seu cartão para lançar compras parceladas e acompanhar cada fatura.</div></div>';
    var invoiceDue = 0;
    state.cards.forEach(function(card, ci){
      var all = cardInvoices(card);
      var it = all.get(key);
      var used = cardUsed(card);
      var avail = round2((card.limit || 0) - used);
      var pct = card.limit > 0 ? Math.min(100, used / card.limit * 100) : 0;
      if(it.balance > EPS) invoiceDue += it.balance;
      var stLbl = {vazia: 'Sem compras', paga: 'Paga', atrasada: 'Atrasada', fechada: 'Fechada', aberta: 'Aberta'}[it.status];
      var el = document.createElement('div');
      el.className = 'cc-block';
      var open = !!openInvoice[card.id];
      el.innerHTML =
        '<div class="cc-visual ' + CARD_TONES[ci % CARD_TONES.length] + '">' +
          '<div class="cc-top"><span class="cc-name">' + escapeHtml(card.name) + '</span><button type="button" class="cc-edit" aria-label="Editar cartão">' + ic('pencil') + '</button></div>' +
          '<div class="cc-chip" aria-hidden="true"></div>' +
          '<div class="cc-limit"><div class="cc-bar"><div style="width:' + pct.toFixed(1) + '%"></div></div>' +
            '<div class="cc-limit-txt"><span>Usado ' + money.format(used) + '</span><span>' + (card.limit ? 'Disponível ' + money.format(avail) : 'Sem limite cadastrado') + '</span></div></div>' +
          '<div class="cc-days">Fecha dia ' + card.closingDay + ' · vence dia ' + card.dueDay + '</div>' +
        '</div>' +
        '<div class="inv">' +
          '<div class="inv-head"><div><div class="inv-title">Fatura de ' + ymLabel(key).toLowerCase() + '</div>' +
            '<div class="inv-sub">fecha ' + fmtDate(it.close) + ' · vence ' + fmtDate(it.due) + '</div></div>' +
            '<span class="badge inv-' + it.status + '">' + stLbl + '</span></div>' +
          '<div class="inv-nums"><div><span>Total</span><b>' + money.format(it.total) + '</b></div><div><span>Pago</span><b class="pos">' + money.format(it.paid) + '</b></div>' +
            '<div><span>' + (it.balance < -EPS ? 'Crédito' : 'Falta') + '</span><b class="' + (it.balance > EPS ? 'neg' : '') + '">' + money.format(Math.abs(it.balance)) + '</b></div></div>' +
          (it.carry > EPS ? '<div class="inv-note">' + ic('triangle-alert') + ' Inclui ' + money.format(it.carry) + ' que ficou da fatura anterior.</div>' : '') +
          (it.carry < -EPS ? '<div class="inv-note ok">' + ic('circle-check') + ' Crédito de ' + money.format(-it.carry) + ' da fatura anterior.</div>' : '') +
          (it.rolled ? '<div class="inv-note">' + ic('triangle-alert') + ' ' + money.format(it.rolled) + ' não foi pago até o vencimento e foi para a próxima fatura.</div>' : '') +
          '<div class="card-actions inv-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-a="buy">' + ic('plus') + ' Compra</button>' +
            (it.balance > EPS ? '<button type="button" class="btn btn-primary btn-sm" data-a="pay">' + ic('check') + ' Pagar fatura</button>' : '') +
            '<div class="spacer"></div>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-a="items" aria-expanded="' + open + '">' + it.items.length + (it.items.length === 1 ? ' lançamento' : ' lançamentos') + ' ' + ic(open ? 'chevron-down' : 'chevron-right', 'i-sm') + '</button>' +
          '</div>' +
          (open ? '<div class="inv-items">' + (it.items.length ? it.items.map(function(x){
              return '<div class="inv-item"><span class="ii-desc">' + escapeHtml(x.p.desc) + '<small>' + fmtDate(x.p.date) + (x.n > 1 ? ' · parcela ' + (x.i + 1) + '/' + x.n : '') + (x.p.category ? ' · ' + escapeHtml(x.p.category) : '') + '</small></span>' +
                '<b>' + money.format(x.value) + '</b><button type="button" class="ii-del" data-pid="' + escapeHtml(x.p.id) + '" aria-label="Excluir compra">' + ic('x') + '</button></div>';
            }).join('') : '<div class="history-empty">Nenhuma compra nesta fatura.</div>') +
            it.payments.map(function(x){ return '<div class="inv-item pay"><span class="ii-desc">Pagamento<small>' + fmtDate(x.date) + '</small></span><b class="pos">−' + money.format(x.amount) + '</b><span></span></div>'; }).join('') +
          '</div>' : '') +
        '</div>';
      el.querySelector('.cc-edit').addEventListener('click', function(){ cardDialog(card); });
      el.querySelector('[data-a="buy"]').addEventListener('click', function(){ purchaseDialog(card); });
      var pb = el.querySelector('[data-a="pay"]');
      if(pb) pb.addEventListener('click', function(){ payInvoiceDialog(card, it); });
      el.querySelector('[data-a="items"]').addEventListener('click', function(){ openInvoice[card.id] = !openInvoice[card.id]; renderContasPage(); });
      el.querySelectorAll('.ii-del').forEach(function(btn){
        btn.addEventListener('click', function(){
          var idx = state.cardPurchases.findIndex(function(p){ return p.id === btn.getAttribute('data-pid'); });
          if(idx === -1) return;
          var p = state.cardPurchases.splice(idx, 1)[0];
          renderAll(); saveData();
          showUndo('Compra "' + p.desc + '" excluída' + (p.installments > 1 ? ' (todas as parcelas)' : ''), function(){
            state.cardPurchases.splice(Math.min(idx, state.cardPurchases.length), 0, p);
            renderAll(); saveData();
          }, 'Compra restaurada', 'trash');
        });
      });
      cardBox.appendChild(el);
    });
    document.getElementById('ctInvoices').textContent = money.format(invoiceDue);
  }
  document.getElementById('ctPrev').addEventListener('click', function(){ contasState.key = ymAdd(contasState.key, -1); renderContasPage(); });
  document.getElementById('ctNext').addEventListener('click', function(){ contasState.key = ymAdd(contasState.key, 1); renderContasPage(); });
  document.getElementById('ctToday').addEventListener('click', function(){ contasState.key = ymOf(todayISO()); renderContasPage(); });
  document.getElementById('btnNewBill').addEventListener('click', function(){ billDialog(null); });
  document.getElementById('btnNewCard').addEventListener('click', function(){ cardDialog(null); });

  // contas e faturas também aparecem em "Esta semana"
  weekSources.push(function(limitISO){
    var today = todayISO(), out = [];
    [ymAdd(ymOf(today), -1), ymOf(today), ymAdd(ymOf(today), 1)].forEach(function(key){
      state.bills.forEach(function(b){
        if(!billApplies(b, key)) return;
        var st = billStatus(b, key);
        if(st.st === 'paga' || st.due > limitISO) return;
        var isIn = b.kind === 'entrada', late = st.due < today;
        out.push({date: st.due, title: b.name, late: late, amount: b.amount, dir: isIn ? 'in' : 'out', icon: isIn ? 'arrow-down-left' : 'receipt',
          sub: 'conta fixa' + (key !== ymOf(today) ? ' de ' + ymShort(key) : '') + ' · ' + (late ? 'atrasada desde ' + fmtDate(st.due) : st.due === today ? 'vence hoje' : 'vence ' + fmtDate(st.due)),
          open: function(){ contasState.key = key; showPage('contas'); },
          act: {label: isIn ? 'Recebi' : 'Paguei', run: function(){ payBillDialog(b, key); }}});
      });
    });
    state.cards.forEach(function(card){
      var all = cardInvoices(card);
      [ymAdd(ymOf(today), -1), ymOf(today), ymAdd(ymOf(today), 1)].forEach(function(key){
        var it = all.get(key);
        if(!(it.balance > EPS) || it.due > limitISO || it.rolled) return;
        var late = it.due < today;
        out.push({date: it.due, title: 'Fatura ' + card.name, late: late, amount: it.balance, dir: 'out', icon: 'credit-card',
          sub: 'cartão · ' + (late ? 'venceu ' + fmtDate(it.due) : it.due === today ? 'vence hoje' : 'vence ' + fmtDate(it.due)),
          open: function(){ contasState.key = key; showPage('contas'); },
          act: {label: 'Pagar', run: function(){ payInvoiceDialog(card, it); }}});
      });
    });
    return out;
  });

  // ---------- keyboard shortcuts ----------
  document.addEventListener('keydown', function(e){
    if(appDialogEl.classList.contains('show')){
      if(e.key === 'Escape') closeDialog(false);
      if(e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ e.preventDefault(); dialogOk(); }
      return;
    }
    if(groupOverlay.classList.contains('show')){ if(e.key === 'Escape') closeGroupModal(); return; }
    if(groupDelOverlay.classList.contains('show')){ if(e.key === 'Escape') closeGroupDelete(); return; }
    if(chargeOverlay.classList.contains('show')){ if(e.key === 'Escape') closeCharge(); return; }
    if(settleOverlay.classList.contains('show')){
      if(e.key === 'Escape'){ closeSettleModal(); }
      if(e.key === 'Enter'){ confirmSettle(); }
      return;
    }
    if(deleteOverlay.classList.contains('show')){
      if(e.key === 'Escape'){ closeDeleteModal(); }
      if(e.key === 'Enter'){ document.getElementById('btnDelConfirm').click(); }
      return;
    }
    if(overlay.classList.contains('show')){
      if(e.key === 'Escape'){ closeModal(); }
      if(e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ e.preventDefault(); saveForm(); }
    }
  });

  // ---------- export / import ----------
  var exportMenu = document.getElementById('exportMenu');
  document.getElementById('btnExportMenuToggle').addEventListener('click', function(e){
    e.stopPropagation();
    exportMenu.classList.toggle('show');
  });
  document.addEventListener('click', function(e){
    if(!exportMenu.contains(e.target) && e.target.id !== 'btnExportMenuToggle'){
      exportMenu.classList.remove('show');
    }
  });

  document.getElementById('btnExportJson').addEventListener('click', function(){
    var blob = new Blob([JSON.stringify(buildBackup(), null, 2)], {type:'application/json'});
    downloadBlob(blob, 'barnabank-backup-' + todayISO() + '.json');
    exportMenu.classList.remove('show');
    markBackupDone();
    showToast('Backup exportado em JSON');
  });

  function csvEscape(v){
    var s = String(v);
    if(/[",\n;]/.test(s)) s = '"' + s.replace(/"/g,'""') + '"';
    return s;
  }
  document.getElementById('btnExportCsv').addEventListener('click', function(){
    var headers = ['Tipo','Nome','Grupo','Valor Original','Data','Parcelas','Dia de Vencimento','Taxa de Juros (%)','Tipo de Juros',
      'Valor Final','Valor da Parcela','Status','Proximo Vencimento',
      'Ja Pago','Falta Pagar','Lucro Estimado','Desconto Concedido','Anotacoes'];
    var rows = state.debts.map(function(d){
      var due = nextDueDate(d);
      return [
        (d.kind === 'payable' ? 'A Pagar' : 'A Receber'),
        d.name,
        (groupOf(d) ? groupOf(d).title : ''),
        d.principal.toFixed(2).replace('.',','),
        fmtDate(d.date),
        installments(d),
        d.dueDay,
        d.rate.toString().replace('.',','),
        interestTypeLabel(d.interestType),
        finalValue(d).toFixed(2).replace('.',','),
        installmentValue(d).toFixed(2).replace('.',','),
        statusLabel(d),
        due ? fmtDate(toISO(due)) : '-',
        paidAmount(d).toFixed(2).replace('.',','),
        remaining(d).toFixed(2).replace('.',','),
        profit(d).toFixed(2).replace('.',','),
        (d.discount||0).toFixed(2).replace('.',','),
        d.notes || ''
      ].map(csvEscape).join(';');
    });
    var csv = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    downloadBlob(blob, 'barnabank-' + todayISO() + '.csv');
    exportMenu.classList.remove('show');
    markBackupDone();
    showToast('Backup exportado em CSV');
  });
  document.getElementById('btnImportJson').addEventListener('click', function(){
    document.getElementById('fileImport').click();
  });
  document.getElementById('fileImport').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      var importFinish = null;
      try{
        var data = JSON.parse(reader.result);
        var rawDebts;
        if(Array.isArray(data)){
          rawDebts = data;
        } else if(data && Array.isArray(data.debts)){
          rawDebts = data.debts;
        } else {
          throw new Error('formato inválido');
        }
        var migrated = migrateDebts(JSON.parse(JSON.stringify(rawDebts)));
        var valid = migrated.filter(function(d){
          return d && typeof d.name === 'string' && d.name.trim() !== '' &&
            typeof d.principal === 'number' && !isNaN(d.principal) && d.principal > 0 &&
            typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
        });
        valid.forEach(function(d){
          if(!d.id) d.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
          d.payments = (d.payments||[]).filter(function(p){
            return p && typeof p.amount === 'number' && !isNaN(p.amount) && p.amount > 0 && typeof p.date === 'string';
          });
        });
        var hasWallets = data && !Array.isArray(data) && Array.isArray(data.wallets);
        var hasTx = data && !Array.isArray(data) && Array.isArray(data.transactions);
        var wallets = hasWallets ? data.wallets.filter(function(w){ return w && w.id && typeof w.name === 'string'; }) : null;
        if(wallets) wallets.forEach(function(w){ w.icon = walletIconKey(w.icon); });
        var txs = hasTx ? data.transactions.filter(function(t){
          return t && typeof t.amount === 'number' && !isNaN(t.amount) && typeof t.date === 'string' && (t.type === 'gasto' || t.type === 'entrada' || (t.type === 'transferencia' && typeof t.toWalletId === 'string'));
        }) : null;
        var skipped = migrated.length - valid.length;
        var hasGroups = data && !Array.isArray(data) && Array.isArray(data.groups);
        var groups = hasGroups ? migrateGroups(JSON.parse(JSON.stringify(data.groups))) : state.groups.filter(function(g){
          return valid.some(function(d){ return d.groupId === g.id; });
        });
        linkGroups(valid, groups);

        var li = function(t){ return '<li>' + t + '</li>'; };
        var msg = '<p class="warn">Importar este backup vai <b>substituir</b> os dados atuais:</p><ul class="ad-list">' +
          li('Dívidas: ' + state.debts.length + ' atuais → <b>' + valid.length + '</b> do arquivo') +
          li(hasWallets ? 'Carteiras: ' + state.wallets.length + ' → <b>' + wallets.length + '</b>' : 'Carteiras: o arquivo não tem (as atuais ficam)') +
          li(hasTx ? 'Lançamentos: ' + state.transactions.length + ' → <b>' + txs.length + '</b>' : 'Lançamentos: o arquivo não tem (os atuais ficam)') +
          (hasGroups ? li('Grupos: ' + state.groups.length + ' → <b>' + groups.length + '</b>') : '') +
          (data && Array.isArray(data.bills) ? li('Contas fixas: ' + state.bills.length + ' → <b>' + data.bills.length + '</b>') : '') +
          (data && Array.isArray(data.cards) ? li('Cartões: ' + state.cards.length + ' → <b>' + data.cards.length + '</b>') : '') +
          (data && Array.isArray(data.goals) ? li('Metas: ' + state.goals.length + ' → <b>' + data.goals.length + '</b>') : '') +
          '</ul>' +
          (skipped > 0 ? '<p class="warn">' + skipped + ' registro(s) inválido(s) serão ignorados.</p>' : '') +
          '<p class="warn">Dica: exporte um backup do estado atual antes, por segurança.</p>';
        importFinish = function(){

        state.debts = valid;
        state.groups = groups;
        var hasFin = data && !Array.isArray(data) && (Array.isArray(data.bills) || Array.isArray(data.cards));
        var fin = data && !Array.isArray(data) ? migrateFinance(JSON.parse(JSON.stringify(data))) : null;
        if(hasFin){
          state.bills = fin.bills; state.cards = fin.cards; state.cardPurchases = fin.cardPurchases; state.cardPayments = fin.cardPayments;
        }
        if(fin && data.budgets && typeof data.budgets === 'object') state.budgets = fin.budgets;
        if(fin && Array.isArray(data.goals)) state.goals = fin.goals;
        if(fin && data.nudges && typeof data.nudges === 'object') state.nudges = fin.nudges;
        if(fin && Array.isArray(data.recurring)) state.recurring = fin.recurring;
        if(fin && data.shares && typeof data.shares === 'object') state.shares = fin.shares;
        if(fin && data.catRules && typeof data.catRules === 'object') state.catRules = fin.catRules;
        if(fin && data.invites && typeof data.invites === 'object') state.invites = fin.invites;
        if(fin && data.tgLog && typeof data.tgLog === 'object') state.tgLog = fin.tgLog;
        if(data && data.receipts) importReceipts(data.receipts);
        state.openGroupId = null;
        if(data && !Array.isArray(data) && data.contacts && typeof data.contacts === 'object') state.contacts = data.contacts;
        if(hasWallets) state.wallets = wallets;
        if(hasTx) state.transactions = txs;
        if(data && data.settings && typeof data.settings === 'object'){
          Object.keys(DEFAULT_SETTINGS).forEach(function(k){
            if(data.settings[k] !== undefined) settings[k] = data.settings[k];
          });
          saveSettings();
          rebuildMoneyFormatter();
        }
        state.openId = null;
        render();
        renderAll();
        showToast(skipped > 0
          ? 'Backup importado — ' + skipped + ' registro(s) inválido(s) foram ignorados'
          : 'Backup importado com sucesso', 'circle-check');
        };
        appConfirm('Importar backup?', msg, {okText: 'Importar e substituir', icon: 'upload'}).then(function(ok){ if(ok) importFinish(); });
      }catch(err){
        appAlert('Arquivo inválido', '<p class="warn">Não foi possível ler esse arquivo. Verifique se é um backup <b>.json</b> exportado pelo BarnaBank.</p>', 'circle-alert');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('btnExportHtml').addEventListener('click', function(){
    var seedEl = document.getElementById('seed-data');
    // "<" vira \u003c para que uma tag de fechamento de script dentro de uma anotação não quebre o arquivo
    seedEl.textContent = JSON.stringify(buildBackup(), null, 2).replace(/</g, '\\u003c');
    var link = document.querySelector('link[data-app-css]'), scr = document.querySelector('script[data-app-js]');
    var getText = function(el, attr){ return el ? fetch(el.getAttribute(attr)).then(function(r){ if(!r.ok) throw new Error(); return r.text(); }) : Promise.resolve(null); };
    Promise.all([getText(link, 'href'), getText(scr, 'src')]).then(function(parts){
      var root = document.documentElement.cloneNode(true);
      if(parts[0] !== null){ var l = root.querySelector('link[data-app-css]'), st = document.createElement('style'); st.textContent = parts[0]; l.parentNode.replaceChild(st, l); }
      if(parts[1] !== null){ var sc = root.querySelector('script[data-app-js]'), ns = document.createElement('script'); ns.textContent = parts[1]; sc.parentNode.replaceChild(ns, sc); }
      var htmlStr = '<!DOCTYPE html>\n' + root.outerHTML;
      downloadBlob(new Blob([htmlStr], {type:'text/html'}), 'barnabank.html');
      showToast('Cópia atualizada baixada');
    }).catch(function(){ showToast('Não consegui montar a cópia agora. Tente de novo com internet.', 'triangle-alert'); });
  });
  function downloadBlob(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- backup reminder ----------
  var backupBanner = document.getElementById('backupBanner');
  function daysSince(iso){
    if(!iso) return null;
    var t = new Date(); t.setHours(0,0,0,0);
    var d = new Date(iso + 'T00:00:00');
    return Math.round((t - d) / 86400000);
  }
  function markBackupDone(){
    localStorage.setItem(LAST_EXPORT_KEY, todayISO());
    localStorage.removeItem(BANNER_SNOOZE_KEY);
    backupBanner.style.display = 'none';
  }
  function checkBackupReminder(){
    if(!settings.backupReminder || state.debts.length === 0){
      backupBanner.style.display = 'none';
      return;
    }
    var snoozeUntil = localStorage.getItem(BANNER_SNOOZE_KEY);
    if(snoozeUntil && snoozeUntil >= todayISO()){
      backupBanner.style.display = 'none';
      return;
    }
    var lastExport = localStorage.getItem(LAST_EXPORT_KEY);
    var days = daysSince(lastExport);
    if(days === null || days >= 14){
      var msg = days === null
        ? 'Você ainda não fez nenhum backup dos seus dados.'
        : 'Já faz ' + days + ' dias sem backup dos seus dados.';
      document.getElementById('backupBannerMsg').innerHTML = ic('save') + '<span>' + escapeHtml(msg) + '</span>';
      backupBanner.style.display = 'flex';
    } else {
      backupBanner.style.display = 'none';
    }
  }
  document.getElementById('btnBannerExport').addEventListener('click', function(){
    document.getElementById('btnExportJson').click();
  });
  document.getElementById('btnBannerDismiss').addEventListener('click', function(){
    var snooze = new Date(); snooze.setDate(snooze.getDate() + 3);
    localStorage.setItem(BANNER_SNOOZE_KEY, toISO(snooze));
    backupBanner.style.display = 'none';
  });

  // ---------- printable statement ----------
  function openStatement(d){
    var n = installments(d);
    var issued = new Date();
    var issuedStr = issued.toLocaleDateString('pt-BR') + ' às ' + issued.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
    var due = nextDueDate(d);
    var isPayable = d.kind === 'payable';

    var sortedPayments = (d.payments||[]).slice().sort(function(a,b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var rows = sortedPayments.length ? sortedPayments.map(function(p, idx){
      return '<tr>' +
        '<td>' + (idx+1) + '</td>' +
        '<td>' + fmtDate(p.date) + (p.note ? ' — ' + escapeHtml(p.note) : '') + '</td>' +
        '<td>' + money.format(p.amount) + '</td>' +
        '<td><span class="pill pill-paid">' + (isPayable?'Pago':'Recebido') + '</span></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="4" style="color:#9a8f6a;font-style:italic;">Nenhum pagamento registrado ainda.</td></tr>';
    if(!isPaid(d)){
      debtSchedule(d).insts.forEach(function(it){
        if(it.open <= 0) return;
        rows += '<tr>' +
          '<td>' + (it.i+1) + '/' + n + '</td>' +
          '<td>Parcela venc. ' + fmtDate(it.dueISO) + (it.pen > 0.005 ? ' (inclui ' + money.format(it.pen) + ' de encargos)' : '') + '</td>' +
          '<td>' + money.format(it.open) + '</td>' +
          '<td><span class="pill pill-pending">' + (it.late ? 'Em atraso' : (it.touched ? 'Parcial' : 'A vencer')) + '</span></td>' +
        '</tr>';
      });
    }

    var notesSection = d.notes
      ? '<div class="s-notes"><div class="s-label">Anotações</div><p>' + escapeHtml(d.notes) + '</p></div>'
      : '';

    var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
      '<title>Extrato — ' + escapeHtml(d.name) + ' — BarnaBank</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Nunito:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">' +
      '<style>' +
        '*{box-sizing:border-box;}' +
        'body{margin:0;background:#e9e4d6;font-family:"Inter",sans-serif;color:#232418;padding:36px 18px;}' +
        '.sheet{max-width:680px;margin:0 auto;background:#fbf8f0;border:1px solid #d8d0ba;position:relative;padding:56px 56px 44px;box-shadow:0 18px 50px rgba(30,25,10,0.18);}' +
        '.sheet::before{content:"";position:absolute;inset:14px;border:1px solid #cbbf9c;pointer-events:none;}' +
        '.s-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;}' +
        '.s-brand{display:flex;align-items:center;gap:12px;}' +
        '.s-mark{width:38px;height:38px;border-radius:9px;background:linear-gradient(155deg,#e8cd8a,#c9a24a 65%,#8a6c25);display:flex;align-items:center;justify-content:center;font-family:"Baloo 2",sans-serif;font-weight:700;color:#241a04;font-size:17px;}' +
        '.s-brandname{font-family:"Baloo 2",sans-serif;font-weight:600;font-size:19px;letter-spacing:0.3px;}' +
        '.s-doctype{text-align:right;font-family:"Nunito",sans-serif;font-style:italic;color:#8a7a4e;font-size:15px;}' +
        '.s-rule{height:1px;background:linear-gradient(90deg,transparent,#c9a24a,transparent);margin:22px 0 26px;}' +
        '.s-title{font-family:"Baloo 2",sans-serif;font-weight:600;font-size:28px;margin:0 0 4px;}' +
        '.s-sub{font-family:"Nunito",sans-serif;font-size:17px;color:#6b6248;margin-bottom:28px;}' +
        '.s-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:28px;}' +
        '.s-label{font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#9a8f6a;margin-bottom:5px;font-weight:600;}' +
        '.s-val{font-family:"Baloo 2",sans-serif;font-size:16px;font-weight:600;color:#2a2410;}' +
        '.s-val.accent{color:#a5822b;}' +
        '.s-summary{background:#f3ecda;border:1px solid #e2d6b1;border-radius:2px;padding:20px 24px;margin-bottom:28px;display:grid;grid-template-columns:1fr 1fr;gap:16px;}' +
        '.s-summary .row{display:flex;justify-content:space-between;font-size:14px;padding:4px 0;border-bottom:1px dotted #d6c99b;}' +
        '.s-summary .row:last-child{border-bottom:none;}' +
        '.s-summary .row b{font-family:"Nunito","Courier New",sans-serif;font-weight:600;}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:24px;}' +
        'thead th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:#9a8f6a;font-weight:600;padding:0 0 8px;border-bottom:1px solid #cbbf9c;}' +
        'tbody td{padding:9px 0;border-bottom:1px solid #ece4cc;font-size:13.5px;font-family:"Nunito","Courier New",sans-serif;}' +
        'tbody tr:last-child td{border-bottom:none;}' +
        '.pill{font-family:"Inter",sans-serif;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;}' +
        '.pill-paid{background:#dfeee3;color:#3f7d57;}' +
        '.pill-pending{background:#f2e6cf;color:#a5822b;}' +
        '.s-notes{margin-bottom:24px;}' +
        '.s-notes p{font-family:"Nunito",sans-serif;font-size:16px;line-height:1.5;color:#3a3320;margin:4px 0 0;}' +
        '.s-footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;padding-top:18px;border-top:1px solid #d8d0ba;}' +
        '.s-footer .issued{font-size:11px;color:#9a8f6a;}' +
        '.s-seal{width:56px;height:56px;border-radius:50%;border:1.5px solid #c9a24a;display:flex;align-items:center;justify-content:center;font-family:"Baloo 2",sans-serif;font-size:11px;color:#a5822b;text-align:center;line-height:1.2;transform:rotate(-8deg);}' +
        '.no-print{max-width:680px;margin:0 auto 18px;text-align:right;}' +
        '.no-print button{font-family:"Inter";font-weight:600;font-size:13px;background:#232418;color:#fbf8f0;border:none;padding:10px 18px;border-radius:8px;cursor:pointer;}' +
        '@media print{.no-print{display:none;} body{background:#fff;padding:0;} .sheet{box-shadow:none;border:none;margin:0;max-width:none;}}' +
      '</style></head><body>' +
        '<div class="no-print"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>' +
        '<div class="sheet">' +
          '<div class="s-top">' +
            '<div class="s-brand"><div class="s-mark">B</div><div class="s-brandname">BarnaBank</div></div>' +
            '<div class="s-doctype">' + (isPayable ? 'Extrato de Dívida' : 'Extrato de Empréstimo') + '</div>' +
          '</div>' +
          '<div class="s-rule"></div>' +
          '<div class="s-title">' + escapeHtml(d.name) + '</div>' +
          '<div class="s-sub">' + (isPayable ? 'Referente à dívida contraída em ' : 'Referente ao empréstimo concedido em ') + fmtDate(d.date) + '</div>' +
          '<div class="s-grid">' +
            '<div><div class="s-label">Valor original</div><div class="s-val">' + money.format(d.principal) + '</div></div>' +
            (isPayable ? '' : '<div><div class="s-label">Juros ao mês</div><div class="s-val accent">' + d.rate.toString().replace('.',',') + '% (' + interestTypeLabel(d.interestType) + ')</div></div>') +
            '<div><div class="s-label">Parcelas</div><div class="s-val">' + n + 'x</div></div>' +
          '</div>' +
          '<div class="s-summary">' +
            '<div class="row"><span>' + (isPayable?'Valor total da dívida':'Valor total a receber') + '</span><b>' + money.format(finalValue(d)) + '</b></div>' +
            (isPayable ? '' : '<div class="row"><span>Lucro estimado</span><b>' + money.format(profit(d)) + '</b></div>') +
            '<div class="row"><span>' + (isPayable?'Já pago':'Já recebido') + '</span><b>' + money.format(paidAmount(d)) + '</b></div>' +
            '<div class="row"><span>' + (isPayable?'Falta pagar':'Falta receber') + '</span><b>' + money.format(remaining(d)) + '</b></div>' +
            (d.discount > 0.005 ? '<div class="row"><span>Desconto concedido</span><b>' + money.format(d.discount) + '</b></div>' : '') +
          '</div>' +
          '<table><thead><tr><th>Parcela</th><th>Data / nota</th><th>Valor</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          notesSection +
          '<div class="s-footer">' +
            '<div class="issued">Documento gerado por BarnaBank em ' + issuedStr + '<br>Caráter informativo, uso pessoal entre as partes.</div>' +
            '<div class="s-seal">BARNA<br>BANK</div>' +
          '</div>' +
        '</div>' +
      '</body></html>';

    var win = window.open('', '_blank');
    if(!win){ appAlert('Janela bloqueada', '<p class="warn">Seu navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.</p>', 'circle-alert'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  // ---------- ranking PDF (estilo gacha/RPG, pra mostrar aos amigos) ----------
  function openRanking(){
    var byKey = {};
    state.debts.filter(function(d){ return d.kind === 'receivable'; }).forEach(function(d){
      var key = nameKey(d.name);
      if(!byKey[key]) byKey[key] = {name: d.name, loans: 0, principal: 0, received: 0, pending: 0, late: 0};
      var g = byKey[key];
      g.loans++;
      g.principal += d.principal;
      g.received += paidAmount(d);
      g.pending += remaining(d);
      if(statusOf(d) === 'atrasado') g.late++;
    });
    var people = Object.keys(byKey).map(function(k){ return byKey[k]; });
    if(!people.length){ showToast('Cadastre pelo menos uma dívida "a receber" para gerar o ranking.'); return; }
    people.sort(function(a,b){ return b.received - a.received; });

    var medals = [
      icInline('medal', 'width="34" height="34" style="color:#d4a72c"'),
      icInline('medal', 'width="34" height="34" style="color:#9aa3b2"'),
      icInline('medal', 'width="34" height="34" style="color:#b8763a"')
    ];
    var titles = ['Lenda Suprema','Herói de Ouro','Guardião Brilhante'];

    var podium = people.slice(0,3).map(function(p, i){
      return '<div class="podium-card rank-' + (i+1) + '">' +
        '<div class="pc-medal">' + medals[i] + '</div>' +
        '<div class="pc-avatar">' + initials(p.name) + '</div>' +
        '<div class="pc-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="pc-title">' + titles[i] + '</div>' +
        '<div class="pc-val">' + money.format(p.received) + '</div>' +
        '<div class="pc-sub">pago até agora</div>' +
      '</div>';
    }).join('');

    var restRows = people.slice(3).map(function(p, i){
      return '<div class="rank-row">' +
        '<div class="rr-pos">#' + (i+4) + '</div>' +
        '<div class="rr-avatar">' + initials(p.name) + '</div>' +
        '<div class="rr-name">' + escapeHtml(p.name) + '<span class="rr-sub">' + p.loans + (p.loans===1?' empréstimo':' empréstimos') + (p.late ? ' · ' + p.late + ' atrasado' + (p.late>1?'s':'') : ' · em dia') + '</span></div>' +
        '<div class="rr-val">' + money.format(p.received) + '</div>' +
      '</div>';
    }).join('');

    var totalReceived = people.reduce(function(s,p){ return s+p.received; }, 0);
    var issued = new Date();
    var issuedStr = issued.toLocaleDateString('pt-BR');

    var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
      '<title>Ranking — BarnaBank</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Nunito:wght@500;600;700;800&display=swap" rel="stylesheet">' +
      '<style>' +
        '*{box-sizing:border-box;}' +
        'body{margin:0;font-family:"Nunito",sans-serif;color:#fff3d6;padding:32px 16px;' +
          'background:radial-gradient(900px 500px at 15% -10%, rgba(255,214,120,0.25), transparent 60%),' +
          'radial-gradient(700px 500px at 100% 10%, rgba(120,170,255,0.18), transparent 55%),' +
          'linear-gradient(180deg,#1b1240,#0c0a24 60%, #070613);}' +
        '.sheet{max-width:720px;margin:0 auto;position:relative;}' +
        '.r-top{text-align:center;margin-bottom:6px;}' +
        '.r-eyebrow{font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#ffd67a;font-weight:700;}' +
        '.r-title{font-family:"Baloo 2",sans-serif;font-size:38px;font-weight:800;margin:6px 0 2px;' +
          'background:linear-gradient(155deg,#fff2c6,#ffd67a 55%,#f3a63c);-webkit-background-clip:text;background-clip:text;color:transparent;' +
          'text-shadow:0 2px 24px rgba(255,214,120,0.35);}' +
        '.r-sub{color:#b9aee0;font-size:13.5px;margin-bottom:26px;}' +
        '.podium{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:30px;align-items:end;}' +
        '.podium-card{border-radius:18px;padding:20px 12px 16px;text-align:center;position:relative;' +
          'background:linear-gradient(165deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02));' +
          'border:1px solid rgba(255,214,120,0.35);box-shadow:0 10px 30px rgba(0,0,0,0.35);}' +
        '.podium-card.rank-1{transform:translateY(-14px);border-color:#ffd67a;box-shadow:0 14px 40px rgba(255,214,120,0.25);}' +
        '.pc-medal{font-size:30px;margin-bottom:4px;}' +
        '.pc-avatar{width:54px;height:54px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;' +
          'font-family:"Baloo 2",sans-serif;font-weight:700;font-size:19px;color:#2a1a02;' +
          'background:linear-gradient(155deg,#ffe9ad,#ffd67a 60%,#e0a83f);box-shadow:0 4px 14px rgba(255,214,120,0.4);}' +
        '.pc-name{font-family:"Baloo 2",sans-serif;font-weight:700;font-size:16px;color:#fff3d6;}' +
        '.pc-title{font-size:10.5px;color:#c9a24a;text-transform:uppercase;letter-spacing:0.6px;margin:2px 0 10px;}' +
        '.pc-val{font-family:"Baloo 2",sans-serif;font-weight:800;font-size:18px;color:#ffe9ad;}' +
        '.pc-sub{font-size:10.5px;color:#a599c9;margin-top:2px;}' +
        '.rank-list{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:8px;margin-bottom:22px;}' +
        '.rank-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;}' +
        '.rank-row:nth-child(even){background:rgba(255,255,255,0.03);}' +
        '.rr-pos{font-family:"Baloo 2",sans-serif;font-weight:700;color:#a599c9;width:28px;}' +
        '.rr-avatar{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
          'font-family:"Baloo 2",sans-serif;font-weight:700;font-size:12.5px;color:#2a1a02;background:linear-gradient(155deg,#e7d9ff,#b9a2f0);}' +
        '.rr-name{flex:1;font-weight:700;font-size:13.5px;color:#fff3d6;}' +
        '.rr-sub{display:block;font-weight:500;font-size:11px;color:#a599c9;margin-top:2px;}' +
        '.rr-val{font-family:"Baloo 2",sans-serif;font-weight:700;font-size:14px;color:#ffe9ad;}' +
        '.r-footer-stat{text-align:center;margin-bottom:24px;}' +
        '.r-footer-stat .fs-label{font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:#a599c9;margin-bottom:6px;}' +
        '.r-footer-stat .fs-val{font-family:"Baloo 2",sans-serif;font-size:26px;font-weight:800;color:#ffe9ad;}' +
        '.r-footer{text-align:center;font-size:11px;color:#7a70a0;padding-top:14px;border-top:1px dashed rgba(255,255,255,0.12);}' +
        '.no-print{max-width:720px;margin:0 auto 18px;text-align:right;}' +
        '.no-print button{font-family:"Nunito",sans-serif;font-weight:700;font-size:13px;background:linear-gradient(155deg,#ffe9ad,#ffd67a);color:#2a1a02;border:none;padding:10px 18px;border-radius:20px;cursor:pointer;}' +
        '@media print{.no-print{display:none;} body{padding:0;} }' +
        '@media (max-width:560px){.podium{grid-template-columns:1fr;} .podium-card.rank-1{transform:none;}}' +
      '</style></head><body>' +
        '<div class="no-print"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>' +
        '<div class="sheet">' +
          '<div class="r-top">' +
            '<div class="r-eyebrow">' + icInline('sparkles', 'width="14" height="14" style="vertical-align:-2px"') + ' BarnaBank apresenta</div>' +
            '<div class="r-title">Ranking dos Pagadores</div>' +
            '<div class="r-sub">Gerado em ' + issuedStr + ' · quem mais honrou seus compromissos até agora</div>' +
          '</div>' +
          '<div class="podium">' + podium + '</div>' +
          (restRows ? '<div class="rank-list">' + restRows + '</div>' : '') +
          '<div class="r-footer-stat"><div class="fs-label">Total já recebido por todos</div><div class="fs-val">' + money.format(totalReceived) + '</div></div>' +
          '<div class="r-footer">Documento gerado por BarnaBank · uso pessoal e divertido entre amigos</div>' +
        '</div>' +
      '</body></html>';

    var win = window.open('', '_blank');
    if(!win){ appAlert('Janela bloqueada', '<p class="warn">Seu navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.</p>', 'circle-alert'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
  document.getElementById('btnRanking').addEventListener('click', openRanking);

  // ---------- PWA manifest (best effort, works over http/https and many mobile browsers) ----------
  try{
    var manifest = {
      name: "BarnaBank",
      short_name: "BarnaBank",
      description: "Controle pessoal de empréstimos entre amigos",
      start_url: ".",
      display: "standalone",
      background_color: "#0a0c11",
      theme_color: "#0a0c11",
      icons: [{
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%2310152a'/%3E%3Ctext x='50' y='68' font-family='Georgia,serif' font-weight='700' font-size='58' fill='%23c9a24a' text-anchor='middle'%3EB%3C/text%3E%3C/svg%3E",
        sizes: "100x100",
        type: "image/svg+xml"
      }]
    };
    var manifestBlob = new Blob([JSON.stringify(manifest)], {type:'application/manifest+json'});
    document.getElementById('manifestLink').href = URL.createObjectURL(manifestBlob);
  }catch(e){}

  // ---------- page tabs (Pessoas / Carteiras) ----------
  document.getElementById('pageTabs').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-page]');
    if(!btn) return;
    showPage(btn.getAttribute('data-page'));
  });

  function renderAll(){
    if(state.page === 'carteiras'){ renderWalletsPage(); renderRecurring(); renderGoals(); }
    if(state.page === 'dashboard') renderDashboard();
    if(state.page === 'relatorios'){ renderRelatorios(); renderEvoChart(); if(typeof renderSubs === 'function') renderSubs(); }
    if(state.page === 'pessoa') renderPersonPage();
    if(state.page === 'contas' && typeof renderContasPage === 'function'){ renderContasPage(); renderCalendar(); }
  }

  // ---------- relatórios ----------
  var MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var relState = {year: new Date().getFullYear(), month: new Date().getMonth()};

  function renderCategoryBars(containerEl, type, y, m){
    var byCat = {};
    var total = 0;
    state.transactions.forEach(function(t){
      if(t.type !== type) return;
      var dt = new Date(t.date + 'T00:00:00');
      if(dt.getFullYear() !== y || dt.getMonth() !== m) return;
      byCat[t.category] = (byCat[t.category] || 0) + t.amount;
      total += t.amount;
    });
    var cats = Object.keys(byCat).map(function(c){ return {name: c, amount: byCat[c]}; });
    cats.sort(function(a,b){ return b.amount - a.amount; });
    if(!cats.length){
      containerEl.innerHTML = '<div class="chart-empty">Nenhum lançamento nesse período.</div>';
      return total;
    }
    var max = cats[0].amount;
    containerEl.innerHTML = cats.map(function(c){
      var pct = total > 0 ? (c.amount / total * 100) : 0;
      var widthPct = max > 0 ? (c.amount / max * 100) : 0;
      return '<div class="cat-bar-row"><div class="cbr-top"><span class="cbr-name">' + escapeHtml(c.name) + '</span><span class="cbr-val">' + money.format(c.amount) + ' · ' + pct.toFixed(0) + '%</span></div>' +
        '<div class="cat-bar-track"><div class="cat-bar-fill ' + type + '" style="width:' + widthPct.toFixed(1) + '%;"></div></div></div>';
    }).join('');
    return total;
  }

  function renderRelatorios(){
    var y = relState.year, m = relState.month;
    document.getElementById('relPeriodLabel').textContent = MONTH_NAMES[m] + ' ' + y;

    var totalOut = renderSpendBars(document.getElementById('relOutCategories'), y, m);
    var totalIn = renderCategoryBars(document.getElementById('relInCategories'), 'entrada', y, m);
    document.getElementById('relTotalIn').textContent = money.format(totalIn);
    document.getElementById('relTotalOut').textContent = money.format(totalOut);
    var net = totalIn - totalOut;
    var netEl = document.getElementById('relNet');
    netEl.textContent = money.format(net);
    netEl.style.color = net >= 0 ? 'var(--green)' : 'var(--red)';

    // comparação com o mês anterior (gastos)
    var prevM = m === 0 ? 11 : m - 1, prevY = m === 0 ? y - 1 : y;
    var prevOut = monthSpending(prevY + '-' + pad2(prevM + 1)).total;
    var subEl = document.getElementById('relOutSub');
    if(prevOut > 0){
      var diffPct = (totalOut - prevOut) / prevOut * 100;
      subEl.innerHTML = ic(diffPct >= 0 ? 'trending-up' : 'trending-down', 'i-sm') + ' ' + Math.abs(diffPct).toFixed(0) + '% vs mês anterior';
      subEl.style.color = diffPct > 0 ? 'var(--red)' : 'var(--green)';
    } else {
      subEl.textContent = '';
    }

    // empréstimos no período
    var loanReceived = 0, loanPaid = 0;
    state.debts.forEach(function(d){
      (d.payments || []).forEach(function(p){
        var dt = new Date(p.date + 'T00:00:00');
        if(dt.getFullYear() === y && dt.getMonth() === m){
          if(d.kind === 'payable') loanPaid += p.amount; else loanReceived += p.amount;
        }
      });
    });
    document.getElementById('relLoanReceived').textContent = money.format(loanReceived);
    document.getElementById('relLoanPaid').textContent = money.format(loanPaid);
    renderRelExtras(y, m);
  }

  document.getElementById('relPrevMonth').addEventListener('click', function(){
    relState.month--;
    if(relState.month < 0){ relState.month = 11; relState.year--; }
    renderRelatorios();
  });
  document.getElementById('relNextMonth').addEventListener('click', function(){
    relState.month++;
    if(relState.month > 11){ relState.month = 0; relState.year++; }
    renderRelatorios();
  });

  // ---------- dashboard ----------
  function renderBalanceSub(id){
    var el = document.getElementById(id);
    if(!el) return;
    var n = state.wallets.length;
    el.innerHTML = n
      ? '<span>' + n + (n === 1 ? ' carteira' : ' carteiras') + '</span>' + state.wallets.slice(0, 5).map(function(w){
          return '<span class="bc-w" title="' + escapeHtml(w.name) + '">' + walletIconHtml(w) + escapeHtml(w.name) + '</span>';
        }).join('')
      : '<span>Crie uma carteira para acompanhar seu saldo.</span>';
  }
  function renderDashboard(){
    document.getElementById('dashTotalBalance').textContent = money.format(totalWalletsBalance());
    renderBalanceSub('dashWalletsSub');
    renderWeek();
    renderTodayBanner();
    renderStartCard();
    renderForecast();
    renderAlerts();
    renderClaims();
    renderDashPlan();

    var now = new Date(); var y = now.getFullYear(), m = now.getMonth();
    var monthIn = 0, monthOut = 0;
    state.wallets.forEach(function(w){
      walletEvents(w.id).forEach(function(e){
        var dt = new Date(e.date);
        if(!e.isTransfer && dt.getFullYear() === y && dt.getMonth() === m){
          if(e.kind === 'entrada') monthIn += e.amount; else monthOut += e.amount;
        }
      });
    });
    document.getElementById('dashMonthIn').textContent = money.format(monthIn);
    document.getElementById('dashMonthOut').textContent = money.format(monthOut);
    var net = monthIn - monthOut;
    var netEl = document.getElementById('dashMonthNet');
    netEl.textContent = money.format(net);
    netEl.style.color = net >= 0 ? 'var(--green)' : 'var(--red)';

    renderHomeSide();
  }
  function renderEvoChart(){
    var holder = document.getElementById('dashChartHolder');
    if(!holder) return;
    var sub = document.getElementById('dashChartSub');
    var events = [];
    state.wallets.forEach(function(w){
      walletEvents(w.id).forEach(function(e){ events.push({date: e.date, amount: e.kind === 'entrada' ? e.amount : -e.amount}); });
    });
    if(!events.length){
      holder.innerHTML = '<div class="chart-empty">Assim que você tiver lançamentos ou pagamentos vinculados a carteiras, o gráfico aparece aqui.</div>';
      sub.textContent = '';
    } else {
      events.sort(function(a,b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
      var cum = 0;
      var points = events.map(function(e){ cum += e.amount; return {date: e.date, total: cum}; });
      sub.textContent = 'Saldo atual: ' + money.format(cum);
      holder.innerHTML = buildEvoChartSVG(points, 'areaGradDash');
    }
  }

  // ---------- carteiras (wallets) ----------
  function renderWalletsPage(){
    document.getElementById('walletsTotalBalance').textContent = money.format(totalWalletsBalance());
    renderBalanceSub('walletsSub');
    var listEl = document.getElementById('walletList');
    listEl.innerHTML = '';
    if(!state.wallets.length){
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhuma carteira ainda. Clique em "+ Nova carteira" para começar.';
      listEl.appendChild(empty);
      return;
    }
    state.wallets.forEach(function(w){ listEl.appendChild(buildWalletCard(w)); });
  }

  function buildWalletCard(w){
    var open = state.openWalletId === w.id;
    var bal = walletBalance(w.id);
    var card = document.createElement('div');
    card.className = 'card' + (open ? ' open' : '');

    var head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML =
      '<div class="avatar wallet-avatar">' + walletIconHtml(w) + '</div>' +
      '<div class="who"><div class="name">' + escapeHtml(w.name) + '</div></div>' +
      '<div class="head-amount wallet-amount" style="' + (bal < 0 ? 'color:var(--red);' : 'color:var(--green);') + '">' + money.format(bal) + '</div>' +
      '<div class="chev">' + ic('chevron-down') + '</div>';
    head.addEventListener('click', function(){
      state.openWalletId = open ? null : w.id;
      renderWalletsPage();
    });
    card.appendChild(head);

    var body = document.createElement('div');
    body.className = 'card-body';
    var inner = document.createElement('div');
    inner.className = 'card-body-inner';

    var events = walletEvents(w.id);
    var rowsHtml = events.length ? events.map(function(e){
      return '<div class="wallet-tx-row"><div class="wtx-info"><span class="wtx-cat">' + escapeHtml(e.label) + (e.note ? ' · ' + escapeHtml(e.note) : '') + '</span><span class="wtx-date">' + fmtDate(e.date) + (e.isLoan ? ' · empréstimo' : '') + '</span></div>' +
        '<span class="wtx-amount ' + e.kind + '">' + (e.kind === 'gasto' ? '−' : '+') + money.format(e.amount) + '</span>' +
        (e.isLoan ? '' : '<button class="wtx-edit" data-txid="' + escapeHtml(e.id) + '" title="Editar lançamento" aria-label="Editar lançamento">' + ic('pencil') + '</button>' +
          '<button class="wtx-del" data-txid="' + escapeHtml(e.id) + '" title="Excluir lançamento" aria-label="Excluir lançamento">' + ic('x') + '</button>') +
      '</div>';
    }).join('') : '<div class="history-empty">Nenhum lançamento nessa carteira ainda.</div>';

    inner.innerHTML =
      '<div class="history-list">' + rowsHtml + '</div>' +
      '<div class="card-actions" style="margin-top:12px;">' +
        '<button class="btn btn-ghost btn-sm" data-act="add-tx">' + ic('plus') + ' Lançamento nessa carteira</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-ghost btn-sm" data-act="edit-wallet">' + ic('pencil') + ' Editar</button>' +
        '<button class="btn btn-danger btn-sm" data-act="del-wallet">' + ic('trash') + ' Excluir</button>' +
      '</div>';

    inner.querySelectorAll('.wtx-del').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var txId = btn.getAttribute('data-txid');
        var idx = state.transactions.findIndex(function(t){ return t.id === txId; });
        if(idx === -1) return;
        var tx = state.transactions.splice(idx, 1)[0];
        if(typeof onTransactionRemoved === 'function') onTransactionRemoved(tx);
        renderWalletsPage();
        saveData();
        showUndo('Lançamento de ' + money.format(tx.amount) + ' removido', function(){
          state.transactions.splice(Math.min(idx, state.transactions.length), 0, tx);
          if(typeof onTransactionRestored === 'function') onTransactionRestored(tx);
          renderAll(); saveData();
        }, 'Lançamento restaurado', 'trash');
      });
    });
    inner.querySelectorAll('.wtx-edit').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var tx = state.transactions.find(function(t){ return t.id === btn.getAttribute('data-txid'); });
        if(tx) openTxModal(tx.walletId, tx);
      });
    });
    inner.querySelector('[data-act="add-tx"]').addEventListener('click', function(e){
      e.stopPropagation();
      openTxModal(w.id);
    });
    inner.querySelector('[data-act="edit-wallet"]').addEventListener('click', function(e){
      e.stopPropagation();
      openWalletModal(w);
    });
    inner.querySelector('[data-act="del-wallet"]').addEventListener('click', function(e){
      e.stopPropagation();
      appConfirm('Excluir carteira?', '<p class="warn">Excluir a carteira <b>' + escapeHtml(w.name) + '</b>? Os lançamentos dela também serão apagados. Pagamentos de empréstimo continuam existindo, só perdem o vínculo com a carteira.</p>', {okText: 'Excluir carteira', danger: true, icon: 'trash'}).then(function(ok){
      if(ok){
        state.transactions = state.transactions.filter(function(t){ return t.walletId !== w.id && t.toWalletId !== w.id; });
        state.debts.forEach(function(d){ (d.payments||[]).forEach(function(p){ if(p.walletId === w.id) delete p.walletId; }); });
        state.wallets = state.wallets.filter(function(x){ return x.id !== w.id; });
        if(state.openWalletId === w.id) state.openWalletId = null;
        renderWalletsPage();
        saveData();
        showToast('Carteira excluída');
      }
      });
    });

    body.appendChild(inner);
    card.appendChild(body);
    if(open){ requestAnimationFrame(function(){ body.style.maxHeight = body.scrollHeight + 'px'; }); }
    else { body.style.maxHeight = '0px'; }
    return card;
  }

  var walletModalOverlay = document.getElementById('walletModalOverlay');
  var editingWalletId = null;
  function openWalletModal(wallet){
    editingWalletId = wallet ? wallet.id : null;
    document.getElementById('walletModalTitle').textContent = wallet ? 'Editar carteira' : 'Nova carteira';
    document.getElementById('wName').value = wallet ? wallet.name : '';
    renderIconPicker(wallet ? walletIconKey(wallet.icon) : 'wallet');
    document.getElementById('walletErr').textContent = '';
    walletModalOverlay.classList.add('show');
  }
  function closeWalletModal(){ walletModalOverlay.classList.remove('show'); }
  var wIconPicker = document.getElementById('wIconPicker');
  function renderIconPicker(current){
    var opts = WALLET_ICONS.slice();
    if(current && !isIconKey(current)) opts.unshift(current); // emoji antigo continua disponível
    document.getElementById('wIcon').value = current || 'wallet';
    wIconPicker.innerHTML = opts.map(function(k){
      var on = k === current;
      return '<button type="button" class="ip-opt' + (on ? ' active' : '') + '" role="radio" aria-checked="' + on + '" data-icon="' + escapeHtml(k) + '" title="' + escapeHtml(k) + '">' +
        (isIconKey(k) ? ic(k) : '<span class="wi-txt">' + escapeHtml(k) + '</span>') + '</button>';
    }).join('');
  }
  wIconPicker.addEventListener('click', function(e){
    var b = e.target.closest('.ip-opt');
    if(!b) return;
    document.getElementById('wIcon').value = b.getAttribute('data-icon');
    wIconPicker.querySelectorAll('.ip-opt').forEach(function(o){ var on = o === b; o.classList.toggle('active', on); o.setAttribute('aria-checked', on); });
  });
  document.getElementById('btnNewWallet').addEventListener('click', function(){ openWalletModal(null); });
  document.getElementById('btnWalletCancel').addEventListener('click', closeWalletModal);
  walletModalOverlay.addEventListener('click', function(e){ if(e.target === walletModalOverlay) closeWalletModal(); });
  document.getElementById('btnWalletSave').addEventListener('click', function(){
    var name = document.getElementById('wName').value.trim();
    var icon = document.getElementById('wIcon').value.trim();
    if(!name){ document.getElementById('walletErr').textContent = 'Informe um nome.'; return; }
    if(editingWalletId){
      var w = state.wallets.find(function(x){ return x.id === editingWalletId; });
      w.name = name; w.icon = icon;
      showToast('Carteira atualizada');
    } else {
      state.wallets.push({id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), name: name, icon: icon});
      showToast('Carteira criada');
    }
    closeWalletModal();
    renderWalletsPage();
    saveData();
  });

  // ---------- lançamentos (gastos/entradas) ----------
  var txModalOverlay = document.getElementById('txModalOverlay');
  var currentTxType = 'entrada';
  var editingTxId = null;
  function populateWalletSelect(preselectId){
    var sel = document.getElementById('txWallet');
    sel.innerHTML = state.wallets.map(function(w){ return '<option value="' + escapeHtml(w.id) + '">' + escapeHtml(walletLabel(w)) + '</option>'; }).join('');
    if(preselectId) sel.value = preselectId;
  }
  function populateCategoryList(){
    var cats = [];
    state.transactions.forEach(function(t){ if(t.category && cats.indexOf(t.category) === -1) cats.push(t.category); });
    document.getElementById('categoryList').innerHTML = cats.map(function(c){ return '<option value="' + escapeHtml(c) + '">'; }).join('');
  }
  function setTxType(type){
    currentTxType = type;
    document.querySelectorAll('#txTypeToggle button').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-t') === type);
    });
    var isT = type === 'transferencia';
    document.getElementById('txToField').style.display = isT ? '' : 'none';
    document.getElementById('txCategoryField').style.display = isT ? 'none' : '';
    document.getElementById('lblTxWallet').textContent = isT ? 'De' : 'Carteira';
    document.getElementById('txRepeatRow').style.display = (isT || editingTxId) ? 'none' : '';
    if(isT){
      var from = document.getElementById('txWallet').value, to = document.getElementById('txToWallet');
      if(!to.value || to.value === from){ var other = state.wallets.find(function(w){ return w.id !== from; }); if(other) to.value = other.id; }
    }
  }
  document.getElementById('txTypeToggle').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-t]');
    if(!btn) return;
    setTxType(btn.getAttribute('data-t'));
  });
  function openTxModal(preselectWalletId, tx){
    if(!state.wallets.length){
      showToast('Crie uma carteira primeiro.', 'wallet');
      openWalletModal(null);
      return;
    }
    editingTxId = tx ? tx.id : null;
    populateWalletSelect(tx ? tx.walletId : preselectWalletId);
    var toSel = document.getElementById('txToWallet');
    toSel.innerHTML = state.wallets.map(function(w){ return '<option value="' + escapeHtml(w.id) + '">' + escapeHtml(walletLabel(w)) + '</option>'; }).join('');
    if(tx && tx.toWalletId) toSel.value = tx.toWalletId;
    populateCategoryList();
    document.getElementById('txModalTitle').textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
    document.getElementById('btnTxSave').textContent = tx ? 'Salvar alterações' : 'Salvar lançamento';
    setTxType(tx ? tx.type : 'entrada');
    document.getElementById('txAmount').value = tx ? fmtMoneyInput(tx.amount) : '';
    document.getElementById('txDate').value = tx ? tx.date : todayISO();
    document.getElementById('txCategory').value = tx && tx.type !== 'transferencia' ? (tx.category || '') : '';
    document.getElementById('txNote').value = tx ? (tx.note || '') : '';
    document.getElementById('txErr').textContent = '';
    document.getElementById('txRepeat').checked = false;
    document.getElementById('txRepeatRow').style.display = (currentTxType === 'transferencia' || editingTxId) ? 'none' : '';
    txModalOverlay.classList.add('show');
  }
  function closeTxModal(){ txModalOverlay.classList.remove('show'); }
  document.getElementById('btnNewTransaction').addEventListener('click', function(){ openTxModal(null); });
  document.getElementById('btnTxCancel').addEventListener('click', closeTxModal);
  txModalOverlay.addEventListener('click', function(e){ if(e.target === txModalOverlay) closeTxModal(); });
  document.getElementById('btnTxSave').addEventListener('click', function(){
    var walletId = document.getElementById('txWallet').value;
    var toWalletId = document.getElementById('txToWallet').value;
    var amount = moneyVal(document.getElementById('txAmount'));
    var date = document.getElementById('txDate').value || todayISO();
    var category = document.getElementById('txCategory').value.trim();
    var note = document.getElementById('txNote').value.trim();
    var errEl = document.getElementById('txErr');
    var isT = currentTxType === 'transferencia';
    if(!walletId){ errEl.textContent = 'Selecione uma carteira.'; return; }
    if(isNaN(amount) || amount <= 0){ errEl.textContent = 'Informe um valor maior que zero.'; return; }
    if(isT && (!toWalletId || toWalletId === walletId)){ errEl.textContent = 'Escolha uma carteira de destino diferente da de origem.'; return; }
    if(!isT && !category){ errEl.textContent = 'Informe uma categoria.'; return; }
    var data = {walletId: walletId, type: currentTxType, amount: round2(amount), date: date, category: isT ? 'Transferência' : category, note: note};
    if(isT) data.toWalletId = toWalletId;
    if(editingTxId){
      var tx = state.transactions.find(function(t){ return t.id === editingTxId; });
      if(tx){
        Object.keys(data).forEach(function(k){ tx[k] = data[k]; });
        if(!isT) delete tx.toWalletId;
      }
    } else {
      data.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      if(!isT && document.getElementById('txRepeat').checked){
        var rr = {id: uid('r-'), type: data.type, amount: data.amount, category: data.category, note: data.note, day: parseInt(date.slice(8), 10),
          walletId: walletId, start: ymOf(date), active: true, posted: {}};
        rr.posted[ymOf(date)] = data.id;
        data.auto = 'rec:' + rr.id + ':' + ymOf(date);
        state.recurring.push(rr);
      }
      state.transactions.push(data);
    }
    closeTxModal();
    renderAll();
    saveData();
    var wn = function(id){ var w = state.wallets.find(function(x){ return x.id === id; }); return w ? w.name : ''; };
    showToast(editingTxId ? 'Lançamento atualizado'
      : isT ? 'Transferido ' + money.format(amount) + ' de ' + wn(walletId) + ' para ' + wn(toWalletId)
      : (currentTxType === 'gasto' ? 'Gasto' : 'Entrada') + ' de ' + money.format(amount) + ' registrad' + (currentTxType === 'gasto' ? 'o' : 'a'), 'circle-check');
  });


  // =====================================================================
  // v5: indicador deslizante, cobrança, orçamento, metas, busca geral,
  //     imagem do grupo e boas-vindas
  // =====================================================================
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function ymDiff(a, b){ return (+a.slice(0, 4) * 12 + +a.slice(5, 7)) - (+b.slice(0, 4) * 12 + +b.slice(5, 7)); }
  function normTxt(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function copyText(t){
    return new Promise(function(res){
      function fb(){
        var ta = document.createElement('textarea');
        ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false; try{ ok = document.execCommand('copy'); }catch(e){}
        document.body.removeChild(ta); res(ok);
      }
      try{ navigator.clipboard.writeText(t).then(function(){ res(true); }, fb); }catch(e){ fb(); }
    });
  }
  function relDay(iso){
    var d = daysBetweenISO(iso, todayISO());
    return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : 'há ' + d + ' dias';
  }

  // ---------- indicador que desliza entre as opções ----------
  var SEG_SEL = '.filters, .page-tabs, .card-tabs, .tx-type-toggle';
  var mobileNav = window.matchMedia('(max-width: 640px)');
  var segRO = typeof ResizeObserver === 'function' ? new ResizeObserver(function(entries){
    entries.forEach(function(en){ var h = en.target._segHost || en.target; if(h._segInd) segPlace(h, true); });
  }) : null;
  function segActive(host){
    for(var i = 0; i < host.children.length; i++){
      var c = host.children[i];
      if(c.tagName === 'BUTTON' && c.classList.contains('active')) return c;
    }
    return null;
  }
  function segInit(host){
    if(host._segInd) return;
    var ind = document.createElement('span');
    ind.className = 'seg-ind';
    ind.setAttribute('aria-hidden', 'true');
    host.insertBefore(ind, host.firstChild);
    host._segInd = ind;
    host.classList.add('seg-host');
    if(segRO){
      segRO.observe(host);
      Array.prototype.forEach.call(host.children, function(c){ if(c.tagName === 'BUTTON'){ c._segHost = host; segRO.observe(c); } });
    }
    segPlace(host, true);
  }
  function segPlace(host, instant){
    var ind = host._segInd, btn = segActive(host);
    if(!ind) return;
    if(!btn || !btn.getClientRects().length){
      ind.style.opacity = '0';
      host.classList.remove('seg-ready');
      return;
    }
    var x = btn.offsetLeft, y = btn.offsetTop, w = btn.offsetWidth, h = btn.offsetHeight;
    if(host.id === 'pageTabs' && mobileNav.matches){
      var icn = btn.querySelector('.i');
      if(icn){
        var br = btn.getBoundingClientRect(), ir = icn.getBoundingClientRect();
        x += ir.left - br.left; y += ir.top - br.top; w = ir.width; h = ir.height;
      }
    }
    var animate = !instant && host.classList.contains('seg-ready') && ind.style.opacity === '1';
    if(!animate) host.classList.add('seg-noanim');
    ind.style.width = w + 'px';
    ind.style.height = h + 'px';
    ind.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    ind.style.opacity = '1';
    ind.setAttribute('data-for', btn.getAttribute('data-t') || '');
    host.classList.add('seg-ready');
    if(!animate){ void ind.offsetWidth; host.classList.remove('seg-noanim'); }
  }
  if(typeof MutationObserver === 'function'){
    new MutationObserver(function(muts){
      var hosts = [], fresh = false;
      muts.forEach(function(m){
        if(m.type === 'attributes'){
          var p = m.target.parentNode;
          if(m.target.tagName === 'BUTTON' && p && p._segInd && hosts.indexOf(p) === -1) hosts.push(p);
        } else if(m.addedNodes.length) fresh = true;
      });
      if(fresh) document.querySelectorAll(SEG_SEL).forEach(segInit);
      hosts.forEach(function(h){ segPlace(h, false); });
    }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
  }
  document.querySelectorAll(SEG_SEL).forEach(segInit);
  function segRefreshAll(){ document.querySelectorAll('.seg-host').forEach(function(h){ segPlace(h, true); }); }
  if(mobileNav.addEventListener) mobileNav.addEventListener('change', segRefreshAll);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(segRefreshAll);

  // ---------- cobrança: atrasados de todo mundo ----------
  function lateReceivables(){
    var by = {}, list = [];
    state.debts.forEach(function(d){
      if(d.kind !== 'receivable' || statusOf(d) !== 'atrasado') return;
      var k = nameKey(d.name);
      if(!by[k]){ by[k] = {key: k, name: d.name, debts: [], overdue: 0, oldest: null}; list.push(by[k]); }
      by[k].debts.push(d);
      by[k].overdue = round2(by[k].overdue + overdueAmount(d));
      var due = nextDueDate(d);
      if(due && (!by[k].oldest || due < by[k].oldest)) by[k].oldest = due;
    });
    list.sort(function(a, b){ return b.overdue - a.overdue; });
    return list;
  }
  function nudgeText(p){
    if(p.debts.length === 1) return whatsappMessage(p.debts[0]);
    var lines = p.debts.map(function(d){
      var g = groupOf(d);
      return '• ' + (g ? g.title : 'empréstimo de ' + fmtDate(d.date)) + ': ' + money.format(overdueAmount(d));
    });
    var msg = 'Oi ' + firstName(p.name) + ', tudo bem? Passando pra lembrar do que ficou em aberto comigo:\n' + lines.join('\n') +
      '\nTotal: ' + money.format(p.overdue) + '. Consegue acertar? Pode ser uma parte também 🙂';
    if(settings.pixKey) msg += '\nPIX: ' + settings.pixKey;
    var slink = shareLinkFor('person', p.key);
    if(slink) msg += '\nDetalhes: ' + slink;
    return msg;
  }
  function nudgeSub(p){
    var days = p.oldest ? daysBetweenISO(toISO(p.oldest), todayISO()) : 0;
    var last = state.nudges[p.key];
    return money.format(p.overdue) + (days ? ' · ' + days + 'd de atraso' : '') + (last ? ' · cobrado ' + relDay(last) : '');
  }
  function openNudgeAll(){
    var people = lateReceivables();
    if(!people.length){ showToast('Ninguém em atraso agora', 'party-popper'); return; }
    var total = people.reduce(function(s, p){ return s + p.overdue; }, 0);
    var rows = people.map(function(p, i){
      var phone = whatsPhone(p.name);
      var done = state.nudges[p.key] === todayISO();
      return '<div class="nudge-row' + (done ? ' done' : '') + '" data-i="' + i + '">' +
        '<span class="avatar">' + escapeHtml(initials(p.name)) + '</span>' +
        '<div class="nr-info"><b>' + escapeHtml(p.name) + (p.debts.length > 1 ? ' <small style="color:var(--muted);font-weight:500;">· ' + p.debts.length + ' dívidas</small>' : '') + '</b><span>' + escapeHtml(nudgeSub(p)) + '</span></div>' +
        (phone
          ? '<a class="btn btn-whats btn-sm" target="_blank" rel="noopener" href="' + escapeHtml('https://wa.me/' + phone + '?text=' + encodeURIComponent(nudgeText(p))) + '">' + ic('message-circle') + ' WhatsApp</a>'
          : '<button type="button" class="btn btn-ghost btn-sm" data-copy title="Sem telefone: copia a mensagem">' + ic('copy') + ' Copiar</button>') +
      '</div>';
    }).join('');
    openDialog({
      title: 'Cobrar atrasados', icon: 'bell-ring', alert: true, okText: 'Fechar',
      html: '<p class="warn">' + people.length + (people.length === 1 ? ' pessoa' : ' pessoas') + ' · <b>' + money.format(total) + '</b> em atraso. ' +
        'Cada botão abre a conversa com a mensagem pronta' + (settings.pixKey ? ', já com seu PIX' : '') + '.</p>' +
        '<div class="nudge-list">' + rows + '</div>'
    });
    var box = document.querySelector('#adBody .nudge-list');
    box.addEventListener('click', function(e){
      var row = e.target.closest('.nudge-row');
      if(!row) return;
      var p = people[+row.getAttribute('data-i')];
      if(e.target.closest('a.btn-whats')) markNudged(p, row);
      else if(e.target.closest('[data-copy]')){
        copyText(nudgeText(p)).then(function(ok){ showToast(ok ? 'Mensagem para ' + firstName(p.name) + ' copiada' : 'Não consegui copiar', ok ? 'copy' : 'triangle-alert'); });
        markNudged(p, row);
      }
    });
  }
  function markNudged(p, row){
    state.nudges[p.key] = todayISO();
    saveData();
    row.classList.add('done');
    row.querySelector('.nr-info span').textContent = nudgeSub(p);
    renderLateBar();
  }
  function renderLateBar(){
    var el = document.getElementById('lateBar');
    if(!el) return;
    var people = state.viewKind === 'receivable' ? lateReceivables() : [];
    if(!people.length){ el.innerHTML = ''; return; }
    var total = people.reduce(function(s, p){ return s + p.overdue; }, 0);
    var pending = people.filter(function(p){ return state.nudges[p.key] !== todayISO(); }).length;
    el.innerHTML = '<div class="late-bar">' + ic('bell-ring') +
      '<span class="lb-txt"><b>' + people.length + (people.length === 1 ? ' pessoa atrasada' : ' pessoas atrasadas') + '</b> · ' + money.format(total) +
      (pending < people.length ? ' · ' + (people.length - pending) + ' cobrada' + (people.length - pending > 1 ? 's' : '') + ' hoje' : '') + '</span>' +
      '<button type="button" class="btn btn-whats btn-sm" data-nudge-all>' + ic('message-circle') + ' Cobrar todos</button></div>';
  }
  document.getElementById('lateBar').addEventListener('click', function(e){ if(e.target.closest('[data-nudge-all]')) openNudgeAll(); });

  // lembrete do dia, no Início
  var REMIND_KEY = 'barnabank_remind_day';
  function renderTodayBanner(){
    var el = document.getElementById('todayBanner');
    if(!el) return;
    var today = todayISO();
    var items = [];
    weekSources.forEach(function(src){ items = items.concat(src(today) || []); });
    var dueToday = items.filter(function(i){ return i.date === today && !i.late; });
    var late = items.filter(function(i){ return i.late; });
    if(lsGet(REMIND_KEY) === today || (!dueToday.length && !late.length)){ el.innerHTML = ''; return; }
    var parts = [];
    if(dueToday.length) parts.push(dueToday.length + (dueToday.length === 1 ? ' vence hoje' : ' vencem hoje'));
    if(late.length) parts.push(late.length + (late.length === 1 ? ' atrasado' : ' atrasados'));
    var names = dueToday.concat(late).map(function(i){ return i.title; });
    var hasLateRec = lateReceivables().length > 0;
    el.innerHTML = '<div class="remind-banner"><span class="rb-ic">' + ic('bell-ring') + '</span>' +
      '<div class="rb-txt"><b>' + parts.join(' · ') + '</b><span>' + escapeHtml(names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '')) + '</span></div>' +
      '<div class="rb-actions">' +
        (hasLateRec ? '<button type="button" class="btn btn-whats btn-sm" data-rb="nudge" title="Cobrar atrasados">' + ic('message-circle') + '<span>Cobrar</span></button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-rb="close" title="Dispensar por hoje" aria-label="Dispensar por hoje">' + ic('x') + '</button>' +
      '</div></div>';
  }
  document.getElementById('todayBanner').addEventListener('click', function(e){
    var b = e.target.closest('[data-rb]');
    if(!b) return;
    if(b.getAttribute('data-rb') === 'nudge') openNudgeAll();
    else { lsSet(REMIND_KEY, todayISO()); renderTodayBanner(); }
  });

  // ---------- gastos do mês (inclui cartão, sem contar fatura duas vezes) ----------
  function monthSpending(key){
    var res = {byCat: {}, total: 0, card: 0, bills: 0, other: 0};
    function add(cat, v, kind){
      cat = (cat || '').trim() || 'Outros';
      var ck = normTxt(cat);
      var c = res.byCat[ck] || (res.byCat[ck] = {name: cat, amount: 0, card: 0});
      c.amount = round2(c.amount + v);
      if(kind === 'card') c.card = round2(c.card + v);
      res.total = round2(res.total + v);
      res[kind] = round2(res[kind] + v);
    }
    state.transactions.forEach(function(t){
      if(t.type !== 'gasto' || ymOf(t.date) !== key) return;
      if(t.auto && /^(card|bill):/.test(t.auto)) return; // fatura e conta fixa entram pelos próprios registros
      add(t.category, t.amount, 'other');
    });
    state.bills.forEach(function(b){
      if(b.kind === 'entrada' || !b.paid || !b.paid[key]) return;
      var tx = billTxOf(b, key);
      add(b.category || b.name, tx ? tx.amount : b.amount, 'bills');
    });
    state.cardPurchases.forEach(function(p){
      var n = Math.max(1, parseInt(p.installments, 10) || 1);
      var off = ymDiff(key, ymOf(p.date));
      if(off < 0 || off >= n) return;
      add(p.category || 'Cartão de crédito', splitEqual(p.amount, n)[off], 'card');
    });
    return res;
  }
  function renderSpendBars(el, y, m){
    var sp = monthSpending(y + '-' + pad2(m + 1));
    var cats = Object.keys(sp.byCat).map(function(k){ return sp.byCat[k]; }).sort(function(a, b){ return b.amount - a.amount; });
    if(!cats.length){
      el.innerHTML = '<div class="chart-empty">Nenhum gasto nesse período.</div>';
      return 0;
    }
    var max = cats[0].amount;
    el.innerHTML = cats.map(function(c){
      var pct = sp.total > 0 ? c.amount / sp.total * 100 : 0;
      var wo = max > 0 ? (c.amount - c.card) / max * 100 : 0, wc = max > 0 ? c.card / max * 100 : 0;
      return '<div class="cat-bar-row"><div class="cbr-top"><span class="cbr-name">' + escapeHtml(c.name) +
          (c.card > EPS ? '<span class="cbr-card" title="no cartão de crédito">' + ic('credit-card') + money.format(c.card) + '</span>' : '') + '</span>' +
          '<span class="cbr-val">' + money.format(c.amount) + ' · ' + pct.toFixed(0) + '%</span></div>' +
        '<div class="cat-bar-track split">' +
          (wo > 0.05 ? '<i class="cb-o" style="width:' + wo.toFixed(1) + '%"></i>' : '') +
          (wc > 0.05 ? '<i class="cb-c" style="width:' + wc.toFixed(1) + '%"></i>' : '') +
        '</div></div>';
    }).join('') +
    (sp.card > EPS ? '<div class="cat-note">' + ic('info') + '<span>Inclui ' + money.format(sp.card) + ' de compras no cartão, cada parcela no mês dela. O pagamento da fatura não conta de novo.</span></div>' : '');
    return sp.total;
  }

  // ---------- orçamento por categoria ----------
  function budgetEntries(){
    return Object.keys(state.budgets).map(function(k){ return {name: k, limit: state.budgets[k]}; });
  }
  function budgetStatus(key){
    var sp = monthSpending(key);
    var isNow = key === ymOf(todayISO());
    var daysLeft = isNow ? daysInMonth(+key.slice(0, 4), +key.slice(5, 7) - 1) - new Date().getDate() + 1 : 0;
    return budgetEntries().map(function(b){
      var c = sp.byCat[normTxt(b.name)];
      var spent = c ? c.amount : 0;
      var pct = b.limit > 0 ? spent / b.limit * 100 : 0;
      return {name: b.name, limit: b.limit, spent: spent, pct: pct, left: round2(b.limit - spent),
        cls: pct > 100 + 1e-9 ? 'over' : pct >= 80 ? 'warn' : 'ok', perDay: isNow && daysLeft > 0 && b.limit - spent > EPS ? (b.limit - spent) / daysLeft : 0};
    }).sort(function(a, b){ return b.pct - a.pct; });
  }
  function renderBudgetCard(y, m){
    var el = document.getElementById('relBudget');
    if(!el) return;
    var key = y + '-' + pad2(m + 1);
    var rows = budgetStatus(key);
    if(!rows.length){
      el.innerHTML = '<div class="card-cta">' + ic('target') + '<span>Defina um teto por categoria (ex.: Mercado R$ 600, Lazer R$ 300) e acompanhe aqui quanto ainda pode gastar no mês. Compras no cartão contam.</span></div>';
      return;
    }
    el.innerHTML = rows.map(function(r){
      var hint = r.cls === 'over' ? 'Passou ' + money.format(-r.left) + ' do limite'
        : (r.perDay ? 'Restam ' + money.format(r.left) + ' · dá ' + money.format(r.perDay) + '/dia até o fim do mês' : 'Restam ' + money.format(r.left));
      return '<div class="bud-row ' + r.cls + '"><div class="bud-top"><span class="bn">' + escapeHtml(r.name) + '</span>' +
        '<span class="bv"><b>' + money.format(r.spent) + '</b> de ' + money.format(r.limit) + '</span></div>' +
        '<div class="bud-track"><div class="bud-fill" style="width:' + Math.min(100, r.pct).toFixed(1) + '%"></div></div>' +
        '<div class="bud-hint">' + hint + '</div></div>';
    }).join('');
  }
  function knownExpenseCats(){
    var seen = {}, out = [];
    function push(c){ c = (c || '').trim(); var k = normTxt(c); if(!c || seen[k]) return; seen[k] = true; out.push(c); }
    Object.keys(state.budgets).forEach(push);
    state.transactions.forEach(function(t){ if(t.type === 'gasto' && !(t.auto && /^card:/.test(t.auto))) push(t.category); });
    state.cardPurchases.forEach(function(p){ push(p.category); });
    state.bills.forEach(function(b){ if(b.kind !== 'entrada') push(b.category || b.name); });
    return out;
  }
  function budgetDialog(){
    var cats = knownExpenseCats();
    var sp = monthSpending(ymOf(todayISO()));
    var rowsHtml = cats.map(function(c, i){
      var spent = sp.byCat[normTxt(c)];
      return '<div class="bd-row"><label for="bd' + i + '">' + escapeHtml(c) + '<span class="bd-spent">' + (spent ? money.format(spent.amount) + ' este mês' : 'nada este mês') + '</span></label>' +
        '<input id="bd' + i + '" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="sem limite" data-cat="' + escapeHtml(c) + '" value="' + (state.budgets[c] ? fmtMoneyInput(state.budgets[c]) : '') + '"></div>';
    }).join('');
    openDialog({
      title: 'Orçamento do mês', icon: 'target', okText: 'Salvar orçamento',
      html: '<p class="warn">Quanto você quer gastar, no máximo, por mês em cada categoria. Deixe vazio para não limitar.</p>' +
        (cats.length ? '<div class="bd-list">' + rowsHtml + '</div>' : '') +
        '<div class="field-row"><div class="field"><label for="bdNewCat">Outra categoria</label><input id="bdNewCat" type="text" maxlength="40" placeholder="Ex: Mercado"></div>' +
        '<div class="field"><label for="bdNewVal">Limite (R$)</label><input id="bdNewVal" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"></div></div>',
      onOk: function(body){
        var next = {};
        body.querySelectorAll('[data-cat]').forEach(function(inp){
          var v = moneyVal(inp);
          if(v > 0) next[inp.getAttribute('data-cat')] = round2(v);
        });
        var nc = body.querySelector('#bdNewCat').value.trim(), nv = moneyVal(body.querySelector('#bdNewVal'));
        if(nc && !(nv > 0)) return 'Informe o limite para "' + nc + '".';
        if(nc){
          var exist = Object.keys(next).concat(cats).find(function(k){ return normTxt(k) === normTxt(nc); });
          next[exist || nc] = round2(nv);
        }
        state.budgets = next;
        return true;
      }
    }).then(function(ok){ if(ok){ renderAll(); saveData(); showToast('Orçamento salvo', 'target'); } });
  }
  document.getElementById('btnBudgets').addEventListener('click', budgetDialog);

  // ---------- gráfico: contas fixas x cartão x outros (6 meses) ----------
  var MIX_COLORS = {bills: '#6f9ee8', card: '#b58cf0', other: '#e2665c'};
  function renderMixChart(y, m){
    var el = document.getElementById('relMix');
    if(!el) return;
    var key = y + '-' + pad2(m + 1);
    var months = [];
    for(var i = 5; i >= 0; i--){ var k = ymAdd(key, -i); months.push({key: k, sp: monthSpending(k)}); }
    var max = Math.max.apply(null, months.map(function(x){ return x.sp.total; }));
    if(!(max > 0)){ el.innerHTML = '<div class="chart-empty">Sem gastos nos últimos 6 meses.</div>'; return; }
    var W = Math.max(300, Math.round(el.clientWidth || 600)), H = 210, top = 22, base = 180, slot = W / 6, bw = Math.min(54, slot * 0.56);
    var svg = '<svg class="mix-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gastos dos últimos 6 meses por tipo">';
    svg += '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" stroke="#252a36" stroke-width="1"/>';
    months.forEach(function(mo, idx){
      var cx = slot * idx + slot / 2, x = cx - bw / 2, yy = base, sel = mo.key === key;
      var op = sel ? 1 : 0.5;
      ['bills', 'card', 'other'].forEach(function(t){
        var v = mo.sp[t];
        if(!(v > 0)) return;
        var h = Math.max(2, v / max * (base - top));
        yy -= h;
        svg += '<rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (h - 1).toFixed(1) + '" rx="4" fill="' + MIX_COLORS[t] + '" opacity="' + op + '"><title>' + escapeHtml(ymShort(mo.key) + ': ' + ({bills: 'contas fixas', card: 'cartão', other: 'outros'})[t] + ' ' + money.format(v)) + '</title></rect>';
      });
      if(mo.sp.total > 0) svg += '<text x="' + cx + '" y="' + (yy - 6).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-family="Nunito, sans-serif" font-weight="700" fill="' + (sel ? '#eee9da' : '#8c92a3') + '">' + escapeHtml(compactMoney(mo.sp.total)) + '</text>';
      svg += '<text x="' + cx + '" y="' + (base + 20) + '" text-anchor="middle" font-size="12" font-family="Inter, sans-serif" font-weight="' + (sel ? 700 : 500) + '" fill="' + (sel ? '#e8cd8a' : '#8c92a3') + '">' + ymShort(mo.key) + '</text>';
    });
    svg += '</svg>';
    var cur = months[5].sp;
    el.innerHTML = svg + '<div class="mix-legend">' +
      '<span><i style="background:' + MIX_COLORS.bills + '"></i>Contas fixas <b>' + money.format(cur.bills) + '</b></span>' +
      '<span><i style="background:' + MIX_COLORS.card + '"></i>Cartão <b>' + money.format(cur.card) + '</b></span>' +
      '<span><i style="background:' + MIX_COLORS.other + '"></i>Outros gastos <b>' + money.format(cur.other) + '</b></span></div>';
  }
  function compactMoney(v){
    if(v >= 10000) return (v / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 0}) + 'k';
    if(v >= 1000) return (v / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + 'k';
    return Math.round(v).toLocaleString('pt-BR');
  }
  var INV_LABEL = {paga: 'paga', atrasada: 'atrasada', fechada: 'fechada', aberta: 'aberta', vazia: 'sem compras'};
  function renderRelCards(y, m){
    var wrap = document.getElementById('relCardsWrap'), el = document.getElementById('relCards');
    if(!wrap || !el) return;
    wrap.hidden = !state.cards.length;
    if(!state.cards.length) return;
    var key = y + '-' + pad2(m + 1);
    el.innerHTML = state.cards.map(function(card){
      var it = cardInvoices(card).get(key);
      var used = cardUsed(card), lim = card.limit > 0 ? Math.min(100, used / card.limit * 100) : 0;
      return '<div class="rc-row"><span class="rc-ic">' + ic('credit-card') + '</span>' +
        '<span class="rc-name">' + escapeHtml(card.name) + '</span><span class="rc-val">' + money.format(it.total || 0) + '</span>' +
        '<span class="rc-sub">fatura de ' + ymShort(key) + ' · vence ' + fmtDate(it.due) + (card.limit > 0 ? ' · limite usado ' + lim.toFixed(0) + '%' : '') + '</span>' +
        '<span class="rc-st ' + it.status + '">' + (INV_LABEL[it.status] || '') + '</span>' +
        (card.limit > 0 ? '<span class="rc-lim"><i style="width:' + lim.toFixed(1) + '%"></i></span>' : '') +
      '</div>';
    }).join('');
  }
  function renderRelExtras(y, m){
    renderCompare(y, m);
    renderBudgetCard(y, m);
    renderMixChart(y, m);
    renderRelCards(y, m);
  }

  // ---------- metas de economia ----------
  function goalSaved(g){
    if(g.walletId){
      var w = state.wallets.find(function(x){ return x.id === g.walletId; });
      if(w) return Math.max(0, round2(walletBalance(w.id)));
    }
    return Math.max(0, round2((g.adds || []).reduce(function(s, a){ return s + a.amount; }, 0)));
  }
  function goalInfo(g){
    var saved = goalSaved(g), left = Math.max(0, round2(g.target - saved));
    var pct = g.target > 0 ? Math.min(100, saved / g.target * 100) : 0;
    var done = left <= EPS;
    var perMonth = 0, late = false;
    if(g.deadline && !done){
      var days = daysBetweenISO(todayISO(), g.deadline);
      if(days < 0) late = true;
      else perMonth = left / Math.max(1, Math.round(days / 30.44));
    }
    // ritmo: quanto já devia ter guardado, se fosse guardando igual todo mês desde que criou a meta
    var behind = 0, monthAdds = 0, ym = ymOf(todayISO());
    (g.adds || []).forEach(function(a){ if(ymOf(a.date) === ym) monthAdds += a.amount; });
    if(g.deadline && g.created && !done && !late && g.deadline > g.created){
      var total = daysBetweenISO(g.created, g.deadline), el = daysBetweenISO(g.created, todayISO());
      var expected = g.target * Math.max(0, Math.min(1, el / total));
      if(saved < expected - Math.max(1, g.target * 0.05)) behind = round2(expected - saved);
    }
    var w = g.walletId ? state.wallets.find(function(x){ return x.id === g.walletId; }) : null;
    var sub = done ? 'Meta batida!' : g.deadline ? (late ? 'prazo era ' + fmtDate(g.deadline) : 'até ' + fmtDate(g.deadline) + ' · guarde ' + money.format(perMonth) + '/mês' + (behind ? ' · ' + money.format(behind) + ' abaixo do ritmo' : '')) : 'sem prazo · faltam ' + money.format(left);
    if(w) sub += ' · saldo de ' + w.name;
    return {saved: saved, left: left, pct: pct, done: done, perMonth: round2(perMonth), late: late, wallet: w, sub: sub, behind: behind, monthAdds: round2(monthAdds)};
  }
  function renderGoals(){
    var el = document.getElementById('goalList');
    if(!el) return;
    if(!state.goals.length){
      el.innerHTML = '<div class="ct-empty" style="grid-column:1 / -1;">' + ic('target') + '<div><b>Nenhuma meta ainda.</b><br>Viagem, reserva de emergência, um celular novo… Crie uma meta e o BarnaBank mostra quanto guardar por mês.</div></div>';
      return;
    }
    el.innerHTML = state.goals.map(function(g){
      var gi = goalInfo(g);
      return '<div class="goal-card' + (gi.done ? ' done' : '') + '" data-goal="' + escapeHtml(g.id) + '">' +
        '<div class="gc-head"><span class="gc-ic">' + ic(gi.done ? 'party-popper' : 'target') + '</span>' +
          '<div class="gc-info"><div class="gc-name">' + escapeHtml(g.name) + '</div><div class="gc-sub">' + escapeHtml(gi.sub) + '</div></div>' +
          '<div class="gc-pct">' + Math.floor(gi.pct) + '%</div></div>' +
        '<div class="gc-amt"><b>' + money.format(gi.saved) + '</b> de ' + money.format(g.target) + '</div>' +
        '<div class="gc-bar"><i style="width:' + gi.pct.toFixed(1) + '%"></i></div>' +
        '<div class="gc-actions">' +
          (gi.wallet ? '' :
            '<button type="button" class="btn btn-primary btn-sm" data-gl="add">' + ic('plus') + ' Guardar</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-gl="take"' + (gi.saved > EPS ? '' : ' disabled') + '>' + ic('minus') + ' Retirar</button>') +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-gl="edit" title="Editar meta" aria-label="Editar meta">' + ic('pencil') + '</button>' +
        '</div></div>';
    }).join('');
  }
  document.getElementById('goalList').addEventListener('click', function(e){
    var b = e.target.closest('[data-gl]');
    if(!b) return;
    var g = state.goals.find(function(x){ return x.id === b.closest('[data-goal]').getAttribute('data-goal'); });
    if(!g) return;
    var a = b.getAttribute('data-gl');
    if(a === 'edit') goalDialog(g); else goalMoveDialog(g, a === 'take');
  });
  document.getElementById('btnNewGoal').addEventListener('click', function(){ goalDialog(null); });
  function goalDialog(g){
    var editing = !!g;
    g = g || {name: '', target: '', deadline: '', walletId: ''};
    openDialog({
      title: editing ? 'Editar meta' : 'Nova meta', icon: 'target', okText: editing ? 'Salvar' : 'Criar meta',
      html:
        '<div class="field"><label for="glName">Nome da meta</label><input id="glName" type="text" maxlength="40" placeholder="Ex: Viagem, Reserva, PS5" value="' + escapeHtml(g.name) + '"></div>' +
        '<div class="field-row"><div class="field"><label for="glTarget">Quanto quer juntar (R$)</label><input id="glTarget" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + (g.target !== '' ? fmtMoneyInput(g.target) : '') + '"></div>' +
        '<div class="field"><label for="glDeadline">Até quando (opcional)</label><input id="glDeadline" type="date" value="' + escapeHtml(g.deadline || '') + '"></div></div>' +
        '<div class="field"><label for="glWallet">Como acompanhar</label><select id="glWallet" class="select" style="width:100%;">' +
          '<option value="">Valores que eu guardar aqui na meta</option>' +
          state.wallets.map(function(w){ return '<option value="' + escapeHtml(w.id) + '"' + (g.walletId === w.id ? ' selected' : '') + '>Saldo da carteira ' + escapeHtml(walletLabel(w)) + '</option>'; }).join('') +
        '</select></div>' +
        (editing ? '' : '<div class="field" id="glStartWrap"><label for="glStart">Já tenho guardado (opcional)</label><input id="glStart" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>') +
        (editing ? '<button type="button" class="btn btn-danger btn-sm" id="glDelete">' + ic('trash') + ' Excluir meta</button>' : ''),
      onOk: function(body){
        var name = body.querySelector('#glName').value.trim();
        var target = moneyVal(body.querySelector('#glTarget'));
        if(!name) return 'Dê um nome para a meta.';
        if(!(target > 0)) return 'Informe quanto quer juntar.';
        var data = {name: name, target: round2(target), deadline: body.querySelector('#glDeadline').value || '', walletId: body.querySelector('#glWallet').value};
        if(editing) Object.keys(data).forEach(function(k){ g[k] = data[k]; });
        else {
          data.id = uid('g-'); data.adds = []; data.created = todayISO();
          var st = moneyVal(body.querySelector('#glStart'));
          if(st > 0 && !data.walletId) data.adds.push({id: uid('ga-'), date: todayISO(), amount: round2(st), note: 'saldo inicial'});
          state.goals.push(data);
        }
        return true;
      }
    }).then(function(ok){ if(ok){ renderAll(); saveData(); showToast(editing ? 'Meta atualizada' : 'Meta criada', 'target'); } });
    var sel = document.getElementById('glWallet'), sw = document.getElementById('glStartWrap');
    if(sel && sw) sel.addEventListener('change', function(){ sw.style.display = sel.value ? 'none' : ''; });
    var del = document.getElementById('glDelete');
    if(del) del.addEventListener('click', function(){
      closeDialog(false);
      var idx = state.goals.indexOf(g);
      if(idx === -1) return;
      state.goals.splice(idx, 1);
      renderAll(); saveData();
      showUndo('Meta "' + g.name + '" excluída', function(){
        state.goals.splice(Math.min(idx, state.goals.length), 0, g);
        renderAll(); saveData();
      }, 'Meta restaurada', 'trash');
    });
  }
  function goalMoveDialog(g, take){
    var gi = goalInfo(g);
    openDialog({
      title: (take ? 'Retirar de ' : 'Guardar em ') + g.name, icon: take ? 'minus' : 'piggy-bank', okText: take ? 'Retirar' : 'Guardar',
      html: '<p class="warn">Guardado: <b>' + money.format(gi.saved) + '</b> de ' + money.format(g.target) + (gi.left > EPS && !take ? ' · faltam ' + money.format(gi.left) : '') + '</p>' +
        '<div class="field-row"><div class="field"><label for="gmAmount">Valor (R$)</label><input id="gmAmount" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"' +
          (!take && gi.perMonth > 0 ? ' value="' + fmtMoneyInput(round2(gi.perMonth)) + '"' : '') + '></div>' +
        '<div class="field"><label for="gmDate">Data</label><input id="gmDate" type="date" value="' + todayISO() + '"></div></div>',
      onOk: function(body){
        var v = moneyVal(body.querySelector('#gmAmount'));
        if(!(v > 0)) return 'Informe o valor.';
        if(take && v > gi.saved + EPS) return 'Só tem ' + money.format(gi.saved) + ' guardado nessa meta.';
        var add = {id: uid('ga-'), date: body.querySelector('#gmDate').value || todayISO(), amount: round2(take ? -v : v)};
        g.adds = g.adds || [];
        g.adds.push(add);
        renderAll(); saveData();
        var after = goalInfo(g);
        showUndo((take ? 'Retirado ' : 'Guardado ') + money.format(v) + ' · ' + g.name, function(){
          g.adds = g.adds.filter(function(x){ return x !== add; });
          renderAll(); saveData();
        }, 'Desfeito', take ? 'minus' : 'piggy-bank');
        if(!take && after.done && !gi.done) setTimeout(function(){ showToast('Meta "' + g.name + '" batida! 🎉', 'party-popper'); }, 300);
        return true;
      }
    });
  }

  // Início: orçamento e metas resumidos
  function renderDashPlan(){
    var el = document.getElementById('dashPlan');
    if(!el) return;
    var html = '';
    var rows = budgetStatus(ymOf(todayISO()));
    if(rows.length){
      html += '<div class="chart-card" data-go="relatorios"><div class="chart-head"><div class="title section-title">' + ic('target') + ' Orçamento de ' + MONTH_NAMES[new Date().getMonth()].toLowerCase() + '</div>' +
        '<div class="sub">' + (function(n){ return n ? n + (n === 1 ? ' estourou' : ' estouraram') : 'tudo dentro do limite'; })(rows.filter(function(r){ return r.cls === 'over'; }).length) + '</div></div>' +
        rows.slice(0, 4).map(function(r){
          return '<div class="mini-row ' + r.cls + '"><span class="mn">' + escapeHtml(r.name) + '</span><span class="mv">' + money.format(r.spent) + ' / ' + money.format(r.limit) + '</span>' +
            '<span class="mt"><i style="width:' + Math.min(100, r.pct).toFixed(1) + '%"></i></span></div>';
        }).join('') + '</div>';
    }
    if(state.goals.length){
      html += '<div class="chart-card" data-go="carteiras"><div class="chart-head"><div class="title section-title">' + ic('piggy-bank') + ' Metas</div>' +
        '<div class="sub">' + state.goals.filter(function(g){ return goalInfo(g).done; }).length + '/' + state.goals.length + ' batidas</div></div>' +
        state.goals.slice(0, 4).map(function(g){
          var gi = goalInfo(g);
          return '<div class="mini-row"><span class="mn">' + escapeHtml(g.name) + '</span><span class="mv">' + money.format(gi.saved) + ' / ' + money.format(g.target) + '</span>' +
            '<span class="mt"><i style="width:' + gi.pct.toFixed(1) + '%"></i></span></div>';
        }).join('') + '</div>';
    }
    el.innerHTML = html;
  }
  document.getElementById('dashPlan').addEventListener('click', function(e){
    var c = e.target.closest('[data-go]');
    if(c) showPage(c.getAttribute('data-go'));
  });

  // ---------- busca geral ----------
  var searchOverlay = document.getElementById('searchOverlay');
  var gsInput = document.getElementById('gsInput'), gsResults = document.getElementById('gsResults');
  var gsItems = [], gsActive = 0;
  function openSearch(){
    searchOverlay.classList.add('show');
    gsInput.value = '';
    gsRun();
    setTimeout(function(){ gsInput.focus(); }, 30);
  }
  function closeSearch(){ searchOverlay.classList.remove('show'); }
  function gsMark(text, q){
    var s = String(text || ''), n = normTxt(s), i = q ? n.indexOf(q) : -1;
    if(i === -1) return escapeHtml(s);
    return escapeHtml(s.slice(0, i)) + '<mark>' + escapeHtml(s.slice(i, i + q.length)) + '</mark>' + escapeHtml(s.slice(i + q.length));
  }
  function gsCollect(raw){
    var q = normTxt(raw.trim());
    if(!q) return [];
    var amt = /^[\d.,]+$/.test(raw.trim()) ? parseMoneyBR(raw) : NaN;
    function has(){ for(var i = 0; i < arguments.length; i++){ if(normTxt(arguments[i]).indexOf(q) !== -1) return true; } return false; }
    function amtIs(v){ return !isNaN(amt) && amt > 0 && Math.abs(v - amt) < 0.005; }
    var secs = [];
    function sec(title, items){ if(items.length) secs.push({title: title, items: items}); }

    var people = {}, peopleList = [];
    state.debts.forEach(function(d){
      var k = nameKey(d.name);
      if(!people[k]){ people[k] = {name: d.name, rec: 0, pay: 0, n: 0}; peopleList.push(people[k]); }
      people[k].n++;
      if(d.kind === 'payable') people[k].pay += remaining(d); else people[k].rec += remaining(d);
    });
    sec('Pessoas', peopleList.filter(function(p){ var pc = state.contacts[nameKey(p.name)] || {}; return has(p.name, (pc.tags || []).join(' '), pc.notes); }).map(function(p){
      return {icon: 'user', title: p.name, sub: p.n + (p.n === 1 ? ' dívida' : ' dívidas') + (p.rec > EPS ? ' · te deve ' + money.format(p.rec) : '') + (p.pay > EPS ? ' · você deve ' + money.format(p.pay) : ''),
        go: function(){ openPerson(p.name); }};
    }));
    sec('Grupos', state.groups.filter(function(g){ return has(g.title, g.notes) || amtIs(g.total); }).map(function(g){
      var st = groupStats(g);
      return {icon: 'users', title: g.title, sub: fmtDate(g.date) + ' · ' + st.members.length + ' pessoas · falta ' + money.format(st.remaining), amount: g.total, dir: g.kind === 'payable' ? 'out' : 'in',
        go: function(){ focusGroup(g.id); }};
    }));
    sec('Dívidas', state.debts.filter(function(d){ return (has(d.notes) && !has(d.name)) || amtIs(d.principal) || amtIs(remaining(d)); }).map(function(d){
      return {icon: d.kind === 'payable' ? 'banknote-arrow-up' : 'hand-coins', title: d.name, sub: (d.kind === 'payable' ? 'eu devo · ' : 'me deve · ') + 'desde ' + fmtDate(d.date) + (d.notes ? ' · ' + d.notes : ''),
        amount: d.principal, dir: d.kind === 'payable' ? 'out' : 'in', go: function(){ goToDebt(d.id); }};
    }));
    sec('Carteiras', state.wallets.filter(function(w){ return has(w.name); }).map(function(w){
      return {icon: isIconKey(w.icon) ? w.icon : 'wallet', title: w.name, sub: 'saldo ' + money.format(walletBalance(w.id)), go: function(){ goWallet(w.id); }};
    }));
    var wn = function(id){ var w = state.wallets.find(function(x){ return x.id === id; }); return w ? w.name : ''; };
    sec('Lançamentos', state.transactions.filter(function(t){ return has(t.category, t.note) || amtIs(t.amount); })
      .sort(function(a, b){ return a.date < b.date ? 1 : -1; }).map(function(t){
        return {icon: t.type === 'transferencia' ? 'arrow-left-right' : t.type === 'gasto' ? 'trending-down' : 'trending-up', title: t.category || 'Lançamento',
          sub: fmtDate(t.date) + ' · ' + wn(t.walletId) + (t.note ? ' · ' + t.note : ''), amount: t.amount, dir: t.type === 'entrada' ? 'in' : (t.type === 'gasto' ? 'out' : ''),
          go: function(){ goWallet(t.walletId); }};
      }));
    sec('Contas fixas', state.bills.filter(function(b){ return has(b.name, b.category) || amtIs(b.amount); }).map(function(b){
      return {icon: b.kind === 'entrada' ? 'arrow-down-left' : 'receipt', title: b.name, sub: (b.kind === 'entrada' ? 'receita' : 'conta') + ' · todo dia ' + b.dueDay + (b.category ? ' · ' + b.category : ''),
        amount: b.amount, dir: b.kind === 'entrada' ? 'in' : 'out', go: function(){ showPage('contas'); billDialog(b); }};
    }));
    var cardName = function(id){ var c = state.cards.find(function(x){ return x.id === id; }); return c ? c.name : ''; };
    sec('Cartão', state.cards.filter(function(c){ return has(c.name); }).map(function(c){
      return {icon: 'credit-card', title: c.name, sub: 'fecha dia ' + c.closingDay + ' · vence dia ' + c.dueDay, go: function(){ showPage('contas'); scrollToSel('#cardList'); }};
    }).concat(state.cardPurchases.filter(function(p){ return has(p.desc, p.category) || amtIs(p.amount); })
      .sort(function(a, b){ return a.date < b.date ? 1 : -1; }).map(function(p){
        var card = state.cards.find(function(x){ return x.id === p.cardId; });
        return {icon: 'shopping-bag', title: p.desc, sub: cardName(p.cardId) + ' · ' + fmtDate(p.date) + (p.installments > 1 ? ' · ' + p.installments + 'x' : '') + (p.category ? ' · ' + p.category : ''),
          amount: p.amount, dir: 'out', go: function(){ if(card) contasState.key = invoiceKeyFor(card, p.date); showPage('contas'); scrollToSel('#cardList'); }};
      })));
    sec('Metas', state.goals.filter(function(g){ return has(g.name); }).map(function(g){
      var gi = goalInfo(g);
      return {icon: 'target', title: g.name, sub: money.format(gi.saved) + ' de ' + money.format(g.target), go: function(){ showPage('carteiras'); scrollToSel('[data-goal="' + g.id + '"]'); }};
    }));
    secs.forEach(function(s){ s.more = Math.max(0, s.items.length - 6); s.items = s.items.slice(0, 6); });
    return secs;
  }
  function scrollToSel(sel){
    setTimeout(function(){ var el = document.querySelector(sel); if(el) el.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 60);
  }
  function goWallet(id){
    if(!id) return;
    state.openWalletId = id;
    showPage('carteiras');
    scrollToSel('#walletList .card.open');
  }
  function gsRun(){
    var raw = gsInput.value;
    var q = normTxt(raw.trim());
    if(!q){
      gsItems = [];
      gsResults.innerHTML = '<div class="gs-empty">Busque por pessoa, grupo, carteira, categoria, conta fixa, compra no cartão ou meta.<br>Dá pra buscar por valor também: <b>45,00</b></div>';
      return;
    }
    var secs = gsCollect(raw);
    gsItems = [];
    if(!secs.length){ gsResults.innerHTML = '<div class="gs-empty">Nada encontrado para "' + escapeHtml(raw.trim()) + '".</div>'; return; }
    gsResults.innerHTML = secs.map(function(s){
      return '<div class="gs-sec">' + escapeHtml(s.title) + (s.more ? ' · +' + s.more : '') + '</div>' + s.items.map(function(it){
        var i = gsItems.push(it) - 1;
        return '<button type="button" class="gs-item" data-i="' + i + '"><span class="gs-ic">' + ic(it.icon) + '</span>' +
          '<span class="gs-txt"><b>' + gsMark(it.title, q) + '</b><small>' + gsMark(it.sub, q) + '</small></span>' +
          (it.amount != null ? '<span class="gs-amt ' + (it.dir || '') + '">' + money.format(it.amount) + '</span>' : '') + '</button>';
      }).join('');
    }).join('');
    gsSetActive(0);
  }
  function gsSetActive(i){
    var btns = gsResults.querySelectorAll('.gs-item');
    if(!btns.length) return;
    gsActive = (i + btns.length) % btns.length;
    btns.forEach(function(b, j){ b.classList.toggle('active', j === gsActive); });
    btns[gsActive].scrollIntoView({block: 'nearest'});
  }
  function gsGo(i){
    var it = gsItems[i];
    if(!it) return;
    closeSearch();
    it.go();
  }
  gsInput.addEventListener('input', gsRun);
  gsInput.addEventListener('keydown', function(e){
    if(e.key === 'ArrowDown'){ e.preventDefault(); gsSetActive(gsActive + 1); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); gsSetActive(gsActive - 1); }
    else if(e.key === 'Enter'){ e.preventDefault(); gsGo(gsActive); }
  });
  gsResults.addEventListener('click', function(e){ var b = e.target.closest('.gs-item'); if(b) gsGo(+b.getAttribute('data-i')); });
  searchOverlay.addEventListener('click', function(e){ if(e.target === searchOverlay || e.target.closest('#gsClose')) closeSearch(); });
  document.getElementById('btnSearch').addEventListener('click', openSearch);
  document.addEventListener('keydown', function(e){
    if(searchOverlay.classList.contains('show')){ if(e.key === 'Escape') closeSearch(); return; }
    if(welcomeOverlay.classList.contains('show')){ if(e.key === 'Escape') closeWelcome(); return; }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if(document.querySelector('.overlay.show')) return;
    if((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)){ e.preventDefault(); openSearch(); }
  });

  // ---------- imagem de resumo do grupo ----------
  function roundRect(c, x, y, w, h, r){
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function fitText(c, s, maxW){
    if(c.measureText(s).width <= maxW) return s;
    while(s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }
  function drawGroupImage(g){
    var st = groupStats(g), ms = st.members, isPayable = g.kind === 'payable';
    var W = 1080, P = 72, rowH = 104;
    var showMe = g.includeMe && g.myShare > EPS;
    var H = 560 + ms.length * rowH + (showMe ? rowH : 0) + 150;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#14171f'); bg.addColorStop(1, '#0a0c11');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    var glow = c.createRadialGradient(0, 0, 0, 0, 0, 700);
    glow.addColorStop(0, 'rgba(201,162,74,0.18)'); glow.addColorStop(1, 'rgba(201,162,74,0)');
    c.fillStyle = glow; c.fillRect(0, 0, W, H);

    // marca
    var mg = c.createLinearGradient(P, 60, P + 64, 124);
    mg.addColorStop(0, '#e8cd8a'); mg.addColorStop(1, '#c9a24a');
    c.fillStyle = mg; roundRect(c, P, 60, 64, 64, 16); c.fill();
    c.fillStyle = '#1b1404'; c.font = '700 34px "Baloo 2", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('B', P + 32, 94);
    c.textAlign = 'left'; c.fillStyle = '#8c92a3'; c.font = '600 28px Inter, sans-serif';
    c.fillText('BarnaBank', P + 84, 94);
    if(g.dueDate){ c.textAlign = 'right'; c.fillText('pagar até ' + fmtDate(g.dueDate), W - P, 94); c.textAlign = 'left'; }

    // título
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#eee9da'; c.font = '700 64px "Baloo 2", sans-serif';
    c.fillText(fitText(c, g.title, W - 2 * P), P, 222);
    c.fillStyle = '#8c92a3'; c.font = '500 28px Inter, sans-serif';
    c.fillText(fmtDate(g.date) + ' · ' + ms.length + (ms.length === 1 ? ' pessoa' : ' pessoas') + (showMe ? ' · conta total ' + money.format(g.total) : ''), P, 270);

    // valores
    var pct = st.owed > 0 ? Math.max(0, Math.min(100, st.paid / st.owed * 100)) : 0;
    c.fillStyle = '#e8cd8a'; c.font = '700 70px "Baloo 2", sans-serif';
    var paidTxt = money.format(st.paid);
    c.fillText(paidTxt, P, 372);
    var pw = c.measureText(paidTxt).width;
    c.fillStyle = '#8c92a3'; c.font = '500 30px Inter, sans-serif';
    c.fillText('de ' + money.format(st.owed) + (isPayable ? ' pagos' : ' recebidos'), P + pw + 18, 370);
    c.textAlign = 'right'; c.fillStyle = '#eee9da'; c.font = '700 44px "Baloo 2", sans-serif';
    c.fillText(Math.round(pct) + '%', W - P, 370); c.textAlign = 'left';

    // barra por pessoa
    var bx = P, by = 404, bw = W - 2 * P, bh = 22, gap = 8;
    var tot = ms.reduce(function(s, d){ return s + Math.max(effectiveTotal(d), 0.01); }, 0);
    var avail = bw - gap * Math.max(0, ms.length - 1), x = bx;
    var COL = {pago: '#57b98a', pendente: '#c9a24a', atrasado: '#e2665c'};
    ms.forEach(function(d){
      var et = Math.max(effectiveTotal(d), 0.01), w = avail * et / tot, s = memberState(d);
      c.fillStyle = s === 'atrasado' ? 'rgba(226,102,92,0.22)' : '#101319';
      roundRect(c, x, by, w, bh, 8); c.fill();
      var f = Math.max(0, Math.min(1, paidAmount(d) / et));
      if(f > 0){ c.save(); roundRect(c, x, by, w, bh, 8); c.clip(); c.fillStyle = s === 'pago' ? COL.pago : COL.pendente; c.fillRect(x, by, w * f, bh); c.restore(); }
      x += w + gap;
    });

    // pessoas
    var y = 500;
    function row(name, label, state_, valueTxt){
      c.fillStyle = 'rgba(255,255,255,0.035)'; roundRect(c, P, y, W - 2 * P, rowH - 16, 22); c.fill();
      var cy = y + (rowH - 16) / 2;
      c.fillStyle = state_ === 'me' ? '#252a36' : (COL[state_] || '#6f9ee8');
      c.beginPath(); c.arc(P + 50, cy, 28, 0, Math.PI * 2); c.fill();
      c.fillStyle = state_ === 'me' ? '#eee9da' : '#0a0c11'; c.font = '700 22px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(initials(name), P + 50, cy + 1);
      c.textAlign = 'left'; c.fillStyle = '#eee9da'; c.font = '600 32px Inter, sans-serif';
      c.fillText(fitText(c, name, 430), P + 98, cy + 1);
      c.textAlign = 'right'; c.font = '700 30px Inter, sans-serif';
      c.fillStyle = state_ === 'pago' ? '#57b98a' : state_ === 'atrasado' ? '#e2665c' : state_ === 'me' ? '#8c92a3' : '#e8cd8a';
      c.fillText(label, W - P - 28, cy + 1);
      if(valueTxt){ var lw = c.measureText(label).width; c.font = '500 24px Inter, sans-serif'; c.fillStyle = '#8c92a3'; c.fillText(valueTxt, W - P - 40 - lw, cy + 2); }
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      y += rowH;
    }
    ms.forEach(function(d){
      var s = memberState(d);
      if(s === 'pago') row(d.name, '✓ ' + (isPayable ? 'pago' : 'pagou'), 'pago', money.format(effectiveTotal(d)));
      else row(d.name, (s === 'atrasado' ? 'atrasado · ' : 'falta ') + money.format(remaining(d)), s, paidAmount(d) > EPS ? 'pagou ' + money.format(paidAmount(d)) + ' ·' : '');
    });
    if(showMe) row('Você', 'sua parte ' + money.format(g.myShare), 'me', '');

    // rodapé
    y += 20;
    c.fillStyle = '#252a36'; c.fillRect(P, y, W - 2 * P, 2);
    c.font = '600 28px Inter, sans-serif'; c.fillStyle = '#e8cd8a';
    if(settings.pixKey && !isPayable) c.fillText('PIX: ' + fitText(c, settings.pixKey, W - 2 * P - 80), P, y + 62);
    c.font = '500 22px Inter, sans-serif'; c.fillStyle = '#5a6072'; c.textAlign = 'right';
    c.fillText('atualizado em ' + fmtDate(todayISO()), W - P, y + 108);
    c.textAlign = 'left';
    return cv;
  }
  function shareGroupImage(g){
    var fontsReady = document.fonts && document.fonts.load
      ? Promise.all(['700 64px "Baloo 2"', '600 28px Inter', '700 30px Inter', '500 28px Inter'].map(function(f){ return document.fonts.load(f).catch(function(){}); }))
      : Promise.resolve();
    fontsReady.then(function(){
      var cv = drawGroupImage(g);
      var url = cv.toDataURL('image/png');
      cv.toBlob(function(blob){
        var fname = 'grupo-' + (normTxt(g.title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'barnabank') + '.png';
        var file = null;
        try{ file = new File([blob], fname, {type: 'image/png'}); }catch(e){}
        var canShare = !!(file && navigator.canShare && navigator.canShare({files: [file]}));
        openDialog({
          title: 'Resumo do grupo', icon: 'image', okText: canShare ? 'Compartilhar' : 'Baixar imagem', cancelText: 'Fechar',
          html: '<img class="gi-prev" alt="Resumo do grupo ' + escapeHtml(g.title) + '" src="' + url + '">' +
            '<p class="warn">Mande no grupo de vocês: cada um vê quanto falta.' + (canShare ? '' : ' A imagem é baixada no aparelho.') + '</p>',
          onOk: function(){
            if(canShare){
              navigator.share({files: [file], title: g.title}).catch(function(){});
            } else {
              var a = document.createElement('a');
              a.href = URL.createObjectURL(blob); a.download = fname;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
            }
            return true;
          }
        });
      }, 'image/png');
    });
  }

  // ---------- boas-vindas e começo rápido ----------
  var WELCOME_KEY = 'barnabank_welcomed', START_HIDE_KEY = 'barnabank_start_hidden';
  var welcomeOverlay = document.getElementById('welcomeOverlay');
  function appIsEmpty(){
    return !state.debts.length && !state.wallets.length && !state.transactions.length && !state.groups.length &&
      !state.bills.length && !state.cards.length && !state.goals.length;
  }
  function closeWelcome(){ welcomeOverlay.classList.remove('show'); lsSet(WELCOME_KEY, '1'); renderAll(); }
  welcomeOverlay.addEventListener('click', function(e){
    if(e.target === welcomeOverlay){ closeWelcome(); return; }
    var b = e.target.closest('[data-wl]');
    if(!b) return;
    var a = b.getAttribute('data-wl');
    closeWelcome();
    startAction(a);
  });
  function startAction(a){
    if(a === 'wallet') openWalletModal(null);
    else if(a === 'debt'){ showPage('pessoas'); openModal(null); }
    else if(a === 'bills'){ showPage('contas'); billDialog(null); }
    else if(a === 'goal'){ showPage('carteiras'); goalDialog(null); }
    else if(a === 'import') document.getElementById('btnImportJson').click();
    else if(a === 'backup') document.getElementById('btnExportJson').click();
  }
  function renderStartCard(){
    var el = document.getElementById('startCard');
    if(!el) return;
    var steps = [
      {k: 'wallet', label: 'Criar uma carteira', done: state.wallets.length > 0},
      {k: 'debt', label: 'Anotar um empréstimo ou vaquinha', done: state.debts.length > 0 || state.groups.length > 0},
      {k: 'bills', label: 'Cadastrar uma conta fixa ou cartão', done: state.bills.length > 0 || state.cards.length > 0},
      {k: 'goal', label: 'Criar uma meta de economia', done: state.goals.length > 0 || Object.keys(state.budgets).length > 0},
      {k: 'backup', label: 'Fazer o primeiro backup', done: !!lsGet(LAST_EXPORT_KEY)}
    ];
    var n = steps.filter(function(s){ return s.done; }).length;
    if(lsGet(START_HIDE_KEY) || n >= 3 || isSnapshotMode()){ el.innerHTML = ''; return; }
    el.innerHTML = '<section class="start-card"><div class="sc-head"><span class="section-title">' + ic('rocket') + ' Comece por aqui</span>' +
      '<span class="sc-count">' + n + '/' + steps.length + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-sc="hide" title="Esconder" aria-label="Esconder">' + ic('x') + '</button></div>' +
      '<div class="sc-steps">' + steps.map(function(s){
        return '<button type="button" class="sc-step' + (s.done ? ' done' : '') + '" data-sc="' + s.k + '">' + ic(s.done ? 'circle-check' : 'circle') + '<span>' + s.label + '</span>' + (s.done ? '' : ic('chevron-right')) + '</button>';
      }).join('') + '</div></section>';
  }
  document.getElementById('startCard').addEventListener('click', function(e){
    var b = e.target.closest('[data-sc]');
    if(!b) return;
    var a = b.getAttribute('data-sc');
    if(a === 'hide'){ lsSet(START_HIDE_KEY, '1'); renderStartCard(); return; }
    if(b.classList.contains('done')) return;
    startAction(a);
  });
  if(appIsEmpty() && !isSnapshotMode() && !lsGet(WELCOME_KEY)) welcomeOverlay.classList.add('show');

  // =====================================================================
  // v6: pagamento parcial, recorrentes, comprovantes, etiquetas, previsão,
  //     resumo do mês, calendário e sincronização (bot do Telegram)
  // =====================================================================

  // ---------- recebi / paguei só uma parte ----------
  function partialPayDialog(d){
    var isPay = d.kind === 'payable', s = debtSchedule(d), rem = remaining(d);
    var late = s.overdue > EPS;
    openDialog({
      title: (isPay ? 'Paguei só uma parte' : 'Recebi só uma parte') + ' · ' + firstName(d.name), icon: 'coins', okText: 'Registrar',
      html: '<p class="warn">' + (late ? 'Em atraso: <b>' + money.format(s.overdue) + '</b>' : 'Parcela da vez: <b>' + money.format(amountDueNow(d)) + '</b>') +
          ' · total em aberto ' + money.format(rem) + '. O que faltar continua ' + (late ? 'em atraso' : 'em aberto') + '.</p>' +
        '<div class="field-row"><div class="field"><label for="ppAmount">' + (isPay ? 'Quanto paguei' : 'Quanto recebi') + ' (R$)</label><input id="ppAmount" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>' +
        '<div class="field"><label for="ppDate">Data</label><input id="ppDate" type="date" value="' + todayISO() + '"></div></div>' +
        '<div class="field"><label for="ppWallet">Carteira</label><select id="ppWallet" class="select" style="width:100%;">' + walletOptions(defaultWalletId(d)) + '</select></div>' +
        '<div class="field"><label for="ppNote">Obs. (opcional)</label><input id="ppNote" type="text" maxlength="80" placeholder="Ex: o resto paga dia 20"></div>',
      onOk: function(body){
        var v = moneyVal(body.querySelector('#ppAmount'));
        if(!(v > 0)) return 'Informe o valor.';
        if(v > rem + EPS) return 'É mais do que o total em aberto (' + money.format(rem) + ').';
        var p = {id: uid(), date: body.querySelector('#ppDate').value || todayISO(), amount: round2(v), mode: 'fifo'};
        var w = body.querySelector('#ppWallet').value;
        if(w) p.walletId = w;
        var note = body.querySelector('#ppNote').value.trim();
        if(note) p.note = note;
        var left = round2(rem - v);
        addPayment(d, p, (isPay ? 'Pago ' : 'Recebido ') + money.format(v) + (isPay ? ' a ' : ' de ') + firstName(d.name) + (left > EPS ? ' · faltam ' + money.format(left) : ''));
        return true;
      }
    });
  }

  // ---------- lançamentos recorrentes ----------
  function runRecurring(){
    var today = todayISO(), nowKey = ymOf(today), made = 0;
    state.recurring.forEach(function(r){
      if(r.active === false || !r.start) return;
      if(!r.posted) r.posted = {};
      var k = r.start, guard = 0;
      while(k <= nowKey && guard++ < 36){
        if(r.end && k > r.end) break;
        var dt = dayIn(k, r.day);
        if(!r.posted[k] && dt <= today && state.wallets.some(function(w){ return w.id === r.walletId; })){
          var tx = {id: uid(), walletId: r.walletId, type: r.type, amount: r.amount, date: dt, category: r.category, note: r.note || '', auto: 'rec:' + r.id + ':' + k};
          state.transactions.push(tx);
          r.posted[k] = tx.id;
          made++;
        }
        k = ymAdd(k, 1);
      }
    });
    return made;
  }
  function recurringDialog(r){
    var editing = !!r;
    r = r || {type: 'gasto', amount: '', category: '', note: '', day: new Date().getDate(), walletId: settings.defaultWalletId || (state.wallets[0] ? state.wallets[0].id : ''), start: ymOf(todayISO())};
    if(!state.wallets.length){ showToast('Crie uma carteira primeiro.', 'wallet'); openWalletModal(null); return; }
    openDialog({
      title: editing ? 'Editar recorrente' : 'Novo lançamento recorrente', icon: 'repeat', okText: editing ? 'Salvar' : 'Criar',
      html: '<p class="warn">Entra sozinho na carteira todo mês, no dia escolhido. Diferente das contas fixas, não precisa marcar como pago.</p>' +
        '<div class="field-row"><div class="field"><label for="rcType">Tipo</label><select id="rcType" class="select" style="width:100%;">' +
          '<option value="gasto"' + (r.type !== 'entrada' ? ' selected' : '') + '>Gasto</option><option value="entrada"' + (r.type === 'entrada' ? ' selected' : '') + '>Entrada</option></select></div>' +
        '<div class="field"><label for="rcAmount">Valor (R$)</label><input id="rcAmount" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + (r.amount !== '' ? fmtMoneyInput(r.amount) : '') + '"></div></div>' +
        '<div class="field-row"><div class="field"><label for="rcCat">Categoria</label><input id="rcCat" type="text" list="categoryList" maxlength="40" placeholder="Ex: Assinaturas" value="' + escapeHtml(r.category || '') + '"></div>' +
        '<div class="field"><label for="rcDay">Todo dia</label><input id="rcDay" type="number" min="1" max="31" value="' + r.day + '"></div></div>' +
        '<div class="field-row"><div class="field"><label for="rcWallet">Carteira</label><select id="rcWallet" class="select" style="width:100%;">' +
          state.wallets.map(function(w){ return '<option value="' + escapeHtml(w.id) + '"' + (r.walletId === w.id ? ' selected' : '') + '>' + escapeHtml(walletLabel(w)) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="rcStart">A partir de</label><input id="rcStart" type="month" value="' + escapeHtml(r.start) + '"></div></div>' +
        '<div class="field"><label for="rcNote">Nota (opcional)</label><input id="rcNote" type="text" maxlength="60" placeholder="Ex: Spotify" value="' + escapeHtml(r.note || '') + '"></div>' +
        (editing ? '<button type="button" class="btn btn-danger btn-sm" id="rcDelete">' + ic('trash') + ' Excluir recorrente</button>' : ''),
      onOk: function(body){
        var amount = moneyVal(body.querySelector('#rcAmount')), day = parseInt(body.querySelector('#rcDay').value, 10);
        var cat = body.querySelector('#rcCat').value.trim();
        if(!(amount > 0)) return 'Informe o valor.';
        if(!cat) return 'Informe uma categoria.';
        if(!(day >= 1 && day <= 31)) return 'Use um dia entre 1 e 31.';
        var start = body.querySelector('#rcStart').value || ymOf(todayISO());
        if(start < ymAdd(ymOf(todayISO()), -12)) return 'Comece no máximo 12 meses atrás.';
        var data = {type: body.querySelector('#rcType').value, amount: round2(amount), category: cat, day: day, walletId: body.querySelector('#rcWallet').value, start: start, note: body.querySelector('#rcNote').value.trim()};
        if(editing) Object.keys(data).forEach(function(k){ r[k] = data[k]; });
        else { data.id = uid('r-'); data.active = true; data.posted = {}; state.recurring.push(data); }
        return true;
      }
    }).then(function(ok){
      if(!ok) return;
      var n = runRecurring();
      renderAll(); saveData();
      showToast((editing ? 'Recorrente atualizado' : 'Recorrente criado') + (n ? ' · ' + n + ' lançamento' + (n > 1 ? 's' : '') + ' criado' + (n > 1 ? 's' : '') : ''), 'repeat');
    });
    var del = document.getElementById('rcDelete');
    if(del) del.addEventListener('click', function(){
      closeDialog(false);
      var idx = state.recurring.indexOf(r);
      if(idx === -1) return;
      state.recurring.splice(idx, 1);
      renderAll(); saveData();
      showUndo('Recorrente "' + (r.note || r.category) + '" excluído (os lançamentos já feitos ficam)', function(){
        state.recurring.splice(Math.min(idx, state.recurring.length), 0, r);
        renderAll(); saveData();
      }, 'Recorrente restaurado', 'trash');
    });
  }
  function renderRecurring(){
    var el = document.getElementById('recList');
    if(!el) return;
    if(!state.recurring.length){
      el.innerHTML = '<div class="ct-empty">' + ic('repeat') + '<div><b>Nenhum recorrente.</b><br>Assinaturas, mesada, transferência pra poupança… lançados sozinhos todo mês.</div></div>';
      return;
    }
    var wn = function(id){ var w = state.wallets.find(function(x){ return x.id === id; }); return w ? w.name : 'carteira excluída'; };
    el.innerHTML = state.recurring.slice().sort(function(a, b){ return a.day - b.day; }).map(function(r){
      var isIn = r.type === 'entrada';
      return '<button type="button" class="rec-row" data-rec="' + escapeHtml(r.id) + '"><span class="wk-ic ' + (isIn ? 'in' : 'out') + '">' + ic(isIn ? 'arrow-down-left' : 'repeat') + '</span>' +
        '<span class="rr-main"><b>' + escapeHtml(r.note || r.category) + '</b><small>todo dia ' + r.day + ' · ' + escapeHtml(wn(r.walletId)) + (r.note ? ' · ' + escapeHtml(r.category) : '') + '</small></span>' +
        '<span class="wk-amt ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '−') + money.format(r.amount) + '</span></button>';
    }).join('');
  }
  document.getElementById('recList').addEventListener('click', function(e){
    var b = e.target.closest('[data-rec]');
    if(!b) return;
    var r = state.recurring.find(function(x){ return x.id === b.getAttribute('data-rec'); });
    if(r) recurringDialog(r);
  });
  document.getElementById('btnNewRec').addEventListener('click', function(){ recurringDialog(null); });

  // ---------- comprovantes (fotos ficam no IndexedDB do aparelho) ----------
  var receiptCache = {}, rcptDbPromise = null;
  function rcptDB(){
    if(!rcptDbPromise) rcptDbPromise = new Promise(function(res, rej){
      try{
        var rq = indexedDB.open('barnabank_files', 1);
        rq.onupgradeneeded = function(){ rq.result.createObjectStore('receipts'); };
        rq.onsuccess = function(){ res(rq.result); };
        rq.onerror = function(){ rej(rq.error); };
      }catch(e){ rej(e); }
    });
    return rcptDbPromise;
  }
  function rcptStore(mode, fn){
    return rcptDB().then(function(db){
      return new Promise(function(res){
        var tx = db.transaction('receipts', mode), out = fn(tx.objectStore('receipts'));
        tx.oncomplete = function(){ res(out && out.result !== undefined ? out.result : true); };
        tx.onerror = function(){ res(false); };
      });
    }).catch(function(){ return false; });
  }
  function rcptPut(id, data){ receiptCache[id] = data; return rcptStore('readwrite', function(st){ st.put(data, id); }); }
  function rcptDel(id){ delete receiptCache[id]; return rcptStore('readwrite', function(st){ st.delete(id); }); }
  function rcptLoadAll(){
    return rcptDB().then(function(db){
      return new Promise(function(res){
        var st = db.transaction('receipts').objectStore('receipts'), rq = st.openCursor();
        rq.onsuccess = function(){ var c = rq.result; if(c){ receiptCache[c.key] = c.value; c.continue(); } else res(); };
        rq.onerror = function(){ res(); };
      });
    }).catch(function(){});
  }
  function compressImage(file){
    return new Promise(function(res, rej){
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function(){
        var max = 1200, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        var c = cv.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
        c.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        res(cv.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('img')); };
      img.src = url;
    });
  }
  var rcptInput = document.getElementById('rcptFile'), rcptTarget = null;
  function pickReceipt(d, p){ rcptTarget = {d: d, p: p}; rcptInput.value = ''; rcptInput.click(); }
  rcptInput.addEventListener('change', function(){
    var f = rcptInput.files && rcptInput.files[0], t = rcptTarget;
    rcptTarget = null;
    if(!f || !t) return;
    compressImage(f).then(function(data){
      var id = t.p.receiptId || uid('rc-');
      return rcptPut(id, data).then(function(ok){
        t.p.receiptId = id;
        render();
        showToast(ok ? 'Comprovante anexado' : 'Comprovante anexado (só nesta sessão: o navegador não deixou salvar)', ok ? 'paperclip' : 'triangle-alert');
      });
    }).catch(function(){ showToast('Não consegui abrir essa imagem.', 'triangle-alert'); });
  });
  function receiptAction(d, p){
    var data = p.receiptId && receiptCache[p.receiptId];
    if(!data){ pickReceipt(d, p); return; }
    openDialog({
      title: 'Comprovante · ' + money.format(p.amount) + ' em ' + fmtDate(p.date), icon: 'paperclip', okText: 'Fechar', alert: true,
      html: '<img class="gi-prev rc-prev" alt="Comprovante" src="' + data + '">' +
        '<div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" id="rcSwap">' + ic('refresh-cw') + ' Trocar</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="rcSave">' + ic('download') + ' Baixar</button><div class="spacer"></div>' +
        '<button type="button" class="btn btn-danger btn-sm" id="rcRemove">' + ic('trash') + ' Remover</button></div>'
    });
    document.getElementById('rcSwap').addEventListener('click', function(){ closeDialog(false); pickReceipt(d, p); });
    document.getElementById('rcSave').addEventListener('click', function(){
      var a = document.createElement('a'); a.href = data; a.download = 'comprovante-' + normTxt(firstName(d.name)) + '-' + p.date + '.jpg';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    document.getElementById('rcRemove').addEventListener('click', function(){
      closeDialog(false);
      var id = p.receiptId;
      delete p.receiptId;
      render();
      showUndo('Comprovante removido', function(){ p.receiptId = id; render(); }, 'Comprovante de volta', 'paperclip');
      setTimeout(function(){ if(p.receiptId !== id){ var used = state.debts.some(function(x){ return (x.payments || []).some(function(q){ return q.receiptId === id; }); }); if(!used) rcptDel(id); } }, 9000);
    });
  }
  function receiptsForBackup(){
    var used = {}, out = {};
    state.debts.forEach(function(d){ (d.payments || []).forEach(function(p){ if(p.receiptId) used[p.receiptId] = true; }); });
    Object.keys(used).forEach(function(id){ if(receiptCache[id]) out[id] = receiptCache[id]; });
    return out;
  }
  function importReceipts(obj){
    if(!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(function(id){ if(typeof obj[id] === 'string' && /^data:image\//.test(obj[id])) rcptPut(id, obj[id]); });
  }

  // ---------- etiquetas, notas e pontualidade por pessoa ----------
  var TAG_SUGGESTIONS = ['Paga em dia', 'Atrasa', 'Prefere PIX', 'Paga em dinheiro', 'Família', 'Trabalho', 'Amigo'];
  function contactOf(key){ return state.contacts[key] || null; }
  function personReliability(key){
    var onTime = 0, late = 0, delays = [], today = todayISO();
    state.debts.forEach(function(d){
      if(nameKey(d.name) !== key || d.kind !== 'receivable') return;
      debtSchedule(d).insts.forEach(function(it){
        if(it.state === 'paga' && it.lastPayISO){
          if(it.lastPayISO <= it.dueISO) onTime++;
          else { late++; delays.push(daysBetweenISO(it.dueISO, it.lastPayISO)); }
        } else if(it.late){ late++; delays.push(daysBetweenISO(it.dueISO, today)); }
      });
    });
    var total = onTime + late;
    if(!total) return null;
    var pct = onTime / total * 100;
    return {onTime: onTime, late: late, total: total, pct: pct,
      avgDelay: delays.length ? Math.round(delays.reduce(function(s, x){ return s + x; }, 0) / delays.length) : 0,
      cls: pct >= 90 ? 'good' : pct >= 60 ? 'mid' : 'bad',
      label: pct >= 90 ? 'Paga em dia' : pct >= 60 ? 'Às vezes atrasa' : 'Costuma atrasar'};
  }
  function personExtraHtml(key){
    var c = contactOf(key) || {}, tags = c.tags || [];
    return '<div class="person-extra">' + trustHtml(key) +
      '<div class="pe-tags">' + tags.map(function(t){ return '<span class="pe-tag">' + ic('tag') + escapeHtml(t) + '</span>'; }).join('') +
        '<button type="button" class="btn btn-ghost btn-sm" id="personTagsEdit">' + ic(tags.length || c.notes ? 'pencil' : 'tag') + (tags.length || c.notes ? ' Editar' : ' Etiquetas e notas') + '</button></div>' +
      (c.notes ? '<div class="pe-notes">' + ic('sticky-note') + '<span>' + escapeHtml(c.notes) + '</span></div>' : '') +
    '</div>';
  }
  function personTagsDialog(key, name){
    var c = contactOf(key) || {}, tags = (c.tags || []).slice();
    var all = TAG_SUGGESTIONS.slice();
    tags.forEach(function(t){ if(all.indexOf(t) === -1) all.push(t); });
    Object.keys(state.contacts).forEach(function(k){ (state.contacts[k].tags || []).forEach(function(t){ if(all.indexOf(t) === -1) all.push(t); }); });
    openDialog({
      title: firstName(name) + ': etiquetas e notas', icon: 'tag', okText: 'Salvar',
      html: '<div class="field"><label>Etiquetas</label><div class="tag-pick" id="tagPick">' + all.map(function(t){
          return '<button type="button" class="tag-opt' + (tags.indexOf(t) !== -1 ? ' on' : '') + '" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label for="tagNew">Outra etiqueta</label><input id="tagNew" type="text" maxlength="24" placeholder="Ex: Vizinho"></div>' +
        '<div class="field"><label for="tagNotes">Notas sobre ' + escapeHtml(firstName(name)) + '</label><textarea id="tagNotes" maxlength="400" placeholder="Ex: recebe dia 5, cobrar depois disso">' + escapeHtml(c.notes || '') + '</textarea></div>',
      onOk: function(body){
        var sel = [];
        body.querySelectorAll('.tag-opt.on').forEach(function(b){ sel.push(b.getAttribute('data-tag')); });
        var nt = body.querySelector('#tagNew').value.trim();
        if(nt && sel.indexOf(nt) === -1) sel.push(nt);
        var cc = state.contacts[key] || (state.contacts[key] = {phone: ''});
        cc.tags = sel;
        cc.notes = body.querySelector('#tagNotes').value.trim();
        return true;
      }
    }).then(function(ok){ if(ok){ render(); showToast('Salvo', 'tag'); } });
    document.getElementById('tagPick').addEventListener('click', function(e){ var b = e.target.closest('.tag-opt'); if(b) b.classList.toggle('on'); });
  }

  // ---------- previsão do mês ----------
  function monthForecast(){
    var today = todayISO(), key = ymOf(today), y = +key.slice(0, 4), m = +key.slice(5, 7) - 1;
    var rows = [], start = round2(totalWalletsBalance());
    function add(label, v, icon){ if(Math.abs(v) > EPS) rows.push({label: label, value: round2(v), icon: icon}); }
    var rec = 0, recLate = 0, pay = 0;
    state.debts.forEach(function(d){
      if(isPaid(d)) return;
      var v = openInMonth(d, y, m);
      if(d.kind === 'payable') pay += v;
      else { rec += v; recLate += overdueAmount(d); }
    });
    add('A receber de empréstimos' + (recLate > EPS ? ' (' + money.format(recLate) + ' atrasado)' : ''), rec, 'hand-coins');
    add('Dívidas que eu pago', -pay, 'banknote-arrow-up');
    var billOut = 0, billIn = 0;
    state.bills.forEach(function(b){
      if(!billApplies(b, key) || billStatus(b, key).st === 'paga') return;
      if(b.kind === 'entrada') billIn += b.amount; else billOut += b.amount;
    });
    add('Receitas fixas que faltam', billIn, 'arrow-down-left');
    add('Contas fixas que faltam', -billOut, 'receipt');
    var inv = 0;
    state.cards.forEach(function(card){
      var all = cardInvoices(card);
      [ymAdd(key, -2), ymAdd(key, -1), key, ymAdd(key, 1)].forEach(function(k){
        var it = all.get(k);
        if(it.balance > EPS && !it.rolled && ymOf(it.due) <= key) inv += it.balance;
      });
    });
    add('Faturas do cartão', -inv, 'credit-card');
    var recIn = 0, recOut = 0;
    state.recurring.forEach(function(r){
      if(r.active === false || (r.posted && r.posted[key]) || !r.start || r.start > key || (r.end && r.end < key)) return;
      if(r.type === 'entrada') recIn += r.amount; else recOut += r.amount;
    });
    add('Recorrentes que ainda entram', recIn, 'repeat');
    add('Recorrentes que ainda saem', -recOut, 'repeat');
    // gastos do dia a dia: média dos 3 meses anteriores, proporcional aos dias que faltam
    var avg = 0, months = 0;
    for(var i = 1; i <= 3; i++){ var sp = monthSpending(ymAdd(key, -i)); if(sp.total > 0){ avg += sp.other; months++; } }
    avg = months ? avg / months : 0;
    var dim = daysInMonth(y, m), left = dim - new Date().getDate();
    var spentNow = monthSpending(key).other;
    var daily = Math.max(0, avg - spentNow) > 0 ? Math.min(avg / dim * left, Math.max(0, avg - spentNow)) : 0;
    add('Gastos do dia a dia (média)', -daily, 'shopping-bag');
    var end = round2(rows.reduce(function(s, r){ return s + r.value; }, start));
    return {start: start, rows: rows, end: end, month: MONTH_NAMES[m].toLowerCase(), avgMonths: months};
  }
  function renderForecast(){
    var el = document.getElementById('dashForecast');
    if(!el) return;
    if(!state.wallets.length){ el.innerHTML = ''; return; }
    var f = monthForecast();
    el.innerHTML = '<div class="fc-mini"><div class="fc-end ' + (f.end < 0 ? 'neg' : '') + '"><span>Previsão de ' + f.month + ': deve terminar o mês com</span><b>' + money.format(f.end) + '</b></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-fits>' + ic('scale') + ' Cabe no mês?</button></div>' +
      '<details class="fc-more"><summary>Como chegamos nisso</summary><div class="fc-rows"><div class="fc-row"><span>' + ic('wallet') + 'Saldo agora</span><b>' + money.format(f.start) + '</b></div>' +
      f.rows.map(function(r){ return '<div class="fc-row"><span>' + ic(r.icon) + escapeHtml(r.label) + '</span><b class="' + (r.value < 0 ? 'neg' : 'pos') + '">' + (r.value < 0 ? '−' : '+') + money.format(Math.abs(r.value)) + '</b></div>'; }).join('') +
      '</div></details>';
  }

  // =====================================================================
  // Início novo: saldo + agenda à esquerda; a receber, mês, orçamento e metas à direita
  // =====================================================================
  var CAT_COLORS = ['#5b9cf0', '#c9a24a', '#8b7cf6', '#57b98a', '#e2665c', '#5a6072'];
  function renderHomeSide(){
    var today = todayISO(), ym = ymOf(today);
    // resumo embaixo do saldo
    var rec = 0, pay = 0;
    state.debts.forEach(function(d){ if(isPaid(d)) return; if(d.kind === 'payable') pay += remaining(d); else rec += remaining(d); });
    var sm = document.getElementById('dashSummary');
    if(sm){
      var fEnd = state.wallets.length ? monthForecast().end : null;
      sm.innerHTML = '<span>A receber <b class="pos">' + money.format(rec) + '</b></span>' + (pay > EPS ? '<span>Eu devo <b>' + money.format(pay) + '</b></span>' : '') +
        (fEnd !== null ? '<span>Fim do mês <b>≈ ' + money.format(fEnd) + '</b></span>' : '');
    }
    var mt = document.getElementById('dashMonthTitle');
    if(mt) mt.textContent = MONTH_NAMES[+ym.slice(5, 7) - 1];
    // a receber: pessoas e grupos, atrasados primeiro
    var box = document.getElementById('dashReceive');
    if(box){
      var by = {}, list = [];
      state.debts.forEach(function(d){
        if(d.kind !== 'receivable' || isPaid(d)) return;
        var g = groupOf(d), k = g ? 'g:' + g.id : 'p:' + nameKey(d.name);
        var it = by[k];
        if(!it){ it = by[k] = {name: g ? g.title : d.name, group: g, open: 0, total: 0, paid: 0, late: 0, n: 0, debt: d}; list.push(it); }
        it.open += remaining(d); it.total += effectiveTotal(d); it.paid += Math.min(paidAmount(d), effectiveTotal(d)); it.late += overdueAmount(d); it.n++;
      });
      list.sort(function(a, b){ return (b.late > EPS) - (a.late > EPS) || b.open - a.open; });
      if(!list.length){ box.innerHTML = '<div class="sc-head"><span class="section-title">A receber</span></div><div class="wk-empty">' + ic('party-popper', 'i-ok') + ' Ninguém te deve nada.</div>'; }
      else {
        box.innerHTML = '<div class="sc-head"><span class="section-title">A receber</span><b class="pos">' + money.format(rec) + '</b></div>' +
          list.slice(0, 5).map(function(it, i){
            var pct = it.total > 0 ? Math.min(100, it.paid / it.total * 100) : 0;
            return '<button type="button" class="rc-row' + (it.late > EPS ? ' late' : '') + '" data-rc="' + i + '"><span class="rc-top"><span class="rc-n">' + escapeHtml(it.name) + '</span><span class="rc-v">' + money.format(it.open) +
              (it.late > EPS ? ' · atrasado' : it.group ? ' · faltam ' + it.n : '') + '</span></span><span class="rc-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span></button>';
          }).join('') +
          '<button type="button" class="link-btn" data-go="pessoas">Ver todas as pessoas →</button>';
        box.querySelectorAll('[data-rc]').forEach(function(b){
          b.addEventListener('click', function(){ var it = list[+b.getAttribute('data-rc')]; if(it.group) focusGroup(it.group.id); else openPerson(it.debt.name); });
        });
      }
    }
    // gastos do mês por categoria, numa barra só
    var cb = document.getElementById('dashCatBar');
    if(cb){
      var sp = monthSpending(ym), cats = Object.keys(sp.byCat).map(function(k){ return sp.byCat[k]; }).filter(function(c){ return c.amount > EPS; }).sort(function(a, b){ return b.amount - a.amount; });
      if(!cats.length){ cb.innerHTML = ''; }
      else {
        var top = cats.slice(0, 4), rest = cats.slice(4).reduce(function(s, c){ return s + c.amount; }, 0);
        if(rest > EPS) top.push({name: 'Outros', amount: rest});
        cb.innerHTML = '<div class="cat-bar">' + top.map(function(c, i){ return '<i style="flex:' + c.amount.toFixed(2) + ';background:' + CAT_COLORS[i % CAT_COLORS.length] + '" title="' + escapeHtml(c.name) + '"></i>'; }).join('') + '</div>' +
          '<div class="cat-leg">' + top.map(function(c, i){ return '<span><i style="background:' + CAT_COLORS[i % CAT_COLORS.length] + '"></i>' + escapeHtml(c.name) + ' ' + money.format(c.amount) + '</span>'; }).join('') + '</div>';
      }
    }
  }
  document.getElementById('pageDashboard').addEventListener('click', function(e){
    var g = e.target.closest('[data-go]');
    if(g && !e.target.closest('#dashPlan')) showPage(g.getAttribute('data-go'));
  });

  // ---------- calendário (página Contas) ----------
  var calState = {sel: null};
  function monthEvents(key){
    var ev = [], today = todayISO();
    state.debts.forEach(function(d){
      var isPay = d.kind === 'payable', g = groupOf(d), n = installments(d);
      debtSchedule(d).insts.forEach(function(it){
        if(ymOf(it.dueISO) !== key) return;
        var done = it.state === 'paga';
        ev.push({date: it.dueISO, title: d.name, sub: (g ? g.title : (n > 1 ? 'parcela ' + (it.i + 1) + '/' + n : (isPay ? 'eu devo' : 'empréstimo'))) + (done ? ' · ' + (isPay ? 'paga' : 'recebida') : it.late ? ' · atrasada' : ''),
          amount: done ? it.value : it.open, dir: isPay ? 'out' : 'in', done: done, late: it.late, icon: isPay ? 'banknote-arrow-up' : 'hand-coins',
          open: function(){ goToDebt(d.id); },
          act: !done && debtSchedule(d).firstOpen === it ? {label: isPay ? 'Paguei' : 'Recebi', run: function(){ quickPay(d); }} : null});
      });
    });
    state.bills.forEach(function(b){
      if(!billApplies(b, key)) return;
      var st = billStatus(b, key), isIn = b.kind === 'entrada', done = st.st === 'paga', tx = billTxOf(b, key);
      ev.push({date: st.due, title: b.name, sub: 'conta fixa' + (done ? (isIn ? ' · recebida' : ' · paga') : st.due < today ? ' · atrasada' : ''),
        amount: tx ? tx.amount : b.amount, dir: isIn ? 'in' : 'out', done: done, late: !done && st.due < today, icon: isIn ? 'arrow-down-left' : 'receipt',
        open: function(){ billDialog(b); }, act: done ? null : {label: isIn ? 'Recebi' : 'Paguei', run: function(){ payBillDialog(b, key); }}});
    });
    state.cards.forEach(function(card){
      var all = cardInvoices(card);
      [ymAdd(key, -1), key].forEach(function(k){
        var it = all.get(k);
        if(ymOf(it.due) !== key || !(it.total > EPS)) return;
        var done = it.balance <= EPS;
        ev.push({date: it.due, title: 'Fatura ' + card.name, sub: 'cartão · ' + (INV_LABEL[it.status] || ''), amount: done ? it.total : it.balance, dir: 'out', done: done, late: it.status === 'atrasada', icon: 'credit-card',
          open: function(){ scrollToSel('#cardList'); }, act: done ? null : {label: 'Pagar', run: function(){ payInvoiceDialog(card, it); }}});
      });
    });
    state.recurring.forEach(function(r){
      if(r.active === false || !r.start || r.start > key || (r.end && r.end < key)) return;
      var done = !!(r.posted && r.posted[key]), isIn = r.type === 'entrada';
      ev.push({date: dayIn(key, r.day), title: r.note || r.category, sub: 'recorrente' + (done ? ' · lançado' : ' · automático'), amount: r.amount, dir: isIn ? 'in' : 'out', done: done, late: false, icon: 'repeat',
        open: function(){ recurringDialog(r); }, act: null});
    });
    ev.sort(function(a, b){ return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return ev;
  }
  function renderCalendar(){
    var el = document.getElementById('calCard');
    if(!el) return;
    var key = contasState.key, today = todayISO();
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1, dim = daysInMonth(y, m), first = new Date(y, m, 1).getDay();
    var ev = monthEvents(key), byDay = {};
    ev.forEach(function(e){ (byDay[e.date] || (byDay[e.date] = [])).push(e); });
    if(!calState.sel || ymOf(calState.sel) !== key){
      calState.sel = ymOf(today) === key ? today : (ev.filter(function(e){ return !e.done; })[0] || ev[0] || {date: key + '-01'}).date;
    }
    var inSum = 0, outSum = 0;
    ev.forEach(function(e){ if(!e.done){ if(e.dir === 'in') inSum += e.amount; else outSum += e.amount; } });
    var cells = '';
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(function(w){ cells += '<span class="cal-wd">' + w + '</span>'; });
    for(var i = 0; i < first; i++) cells += '<span></span>';
    for(var dday = 1; dday <= dim; dday++){
      var iso = key + '-' + pad2(dday), list = byDay[iso] || [];
      var dots = '', hasIn = list.some(function(e){ return e.dir === 'in' && !e.done; }), hasOut = list.some(function(e){ return e.dir === 'out' && !e.done; });
      var hasLate = list.some(function(e){ return e.late; }), allDone = list.length && list.every(function(e){ return e.done; });
      if(hasIn) dots += '<i class="in"></i>';
      if(hasOut) dots += '<i class="out' + (hasLate ? ' late' : '') + '"></i>';
      if(allDone) dots += '<i class="done"></i>';
      cells += '<button type="button" class="cal-day' + (iso === today ? ' today' : '') + (iso === calState.sel ? ' sel' : '') + (list.length ? ' has' : '') + (iso < today ? ' past' : '') + '" data-day="' + iso + '" aria-label="' + dday + (list.length ? ', ' + list.length + ' item(ns)' : '') + '">' +
        '<span class="cd-n">' + dday + '</span><span class="cd-dots">' + dots + '</span></button>';
    }
    var sel = byDay[calState.sel] || [];
    var dsel = new Date(calState.sel + 'T00:00:00');
    var WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    el.innerHTML = '<div class="chart-head"><div class="title section-title">' + ic('calendar-days') + ' Calendário</div>' +
      '<div class="sub">' + (inSum ? '<span class="pos">entra ' + money.format(inSum) + '</span>' : '') + (inSum && outSum ? ' · ' : '') + (outSum ? 'sai ' + money.format(outSum) : '') + '</div></div>' +
      '<div class="cal-grid">' + cells + '</div>' +
      '<div class="cal-day-title">' + WD[dsel.getDay()].charAt(0).toUpperCase() + WD[dsel.getDay()].slice(1) + ', ' + dsel.getDate() + ' de ' + MONTH_NAMES[dsel.getMonth()].toLowerCase() + '</div>' +
      '<div class="cal-list" id="calList"></div>' +
      '<div class="cal-legend"><span><i class="in"></i>entra</span><span><i class="out"></i>sai</span><span><i class="out late"></i>atrasado</span><span><i class="done"></i>resolvido</span></div>';
    var box = el.querySelector('#calList');
    if(!sel.length){ box.innerHTML = '<div class="wk-empty">Nada neste dia.</div>'; }
    sel.forEach(function(it){
      var row = document.createElement('div');
      row.className = 'wk-row' + (it.late ? ' late' : '') + (it.done ? ' done' : '');
      row.innerHTML = '<span class="wk-ic ' + it.dir + '">' + ic(it.done ? 'check' : it.icon) + '</span>' +
        '<button type="button" class="wk-main"><span class="wk-title">' + escapeHtml(it.title) + '</span><span class="wk-sub">' + escapeHtml(it.sub) + '</span></button>' +
        '<span class="wk-amt ' + it.dir + '">' + (it.dir === 'out' ? '−' : '+') + money.format(it.amount) + '</span>' +
        (it.act ? '<button type="button" class="btn btn-ghost btn-sm wk-act">' + ic('check') + '<span>' + escapeHtml(it.act.label) + '</span></button>' : '<span></span>');
      row.querySelector('.wk-main').addEventListener('click', it.open);
      var a = row.querySelector('.wk-act');
      if(a) a.addEventListener('click', function(){ it.act.run(); });
      box.appendChild(row);
    });
  }
  document.getElementById('calCard').addEventListener('click', function(e){
    var b = e.target.closest('.cal-day');
    if(!b) return;
    calState.sel = b.getAttribute('data-day');
    renderCalendar();
  });

  // ---------- imagem / resumo do mês ----------
  function shareCanvas(cv, fname, title, hint){
    var url = cv.toDataURL('image/png');
    cv.toBlob(function(blob){
      var file = null;
      try{ file = new File([blob], fname, {type: 'image/png'}); }catch(e){}
      var canShare = !!(file && navigator.canShare && navigator.canShare({files: [file]}));
      openDialog({
        title: title, icon: 'image', okText: canShare ? 'Compartilhar' : 'Baixar imagem', cancelText: 'Fechar',
        html: '<img class="gi-prev" alt="' + escapeHtml(title) + '" src="' + url + '"><p class="warn">' + hint + (canShare ? '' : ' A imagem é baixada no aparelho.') + '</p>',
        onOk: function(){
          if(canShare) navigator.share({files: [file], title: title}).catch(function(){});
          else downloadBlob(blob, fname);
          return true;
        }
      });
    }, 'image/png');
  }
  function fontsReadyFor(list){
    return document.fonts && document.fonts.load
      ? Promise.all(list.map(function(f){ return document.fonts.load(f).catch(function(){}); }))
      : Promise.resolve();
  }
  function drawMonthImage(y, m){
    var key = y + '-' + pad2(m + 1);
    var sp = monthSpending(key);
    var inc = 0;
    state.transactions.forEach(function(t){ if(t.type === 'entrada' && ymOf(t.date) === key) inc += t.amount; });
    var loanIn = 0, loanOut = 0;
    state.debts.forEach(function(d){ (d.payments || []).forEach(function(p){ if(ymOf(p.date) === key){ if(d.kind === 'payable') loanOut += p.amount; else loanIn += p.amount; } }); });
    var cats = Object.keys(sp.byCat).map(function(k){ return sp.byCat[k]; }).sort(function(a, b){ return b.amount - a.amount; }).slice(0, 6);
    var buds = budgetStatus(key).slice(0, 4);
    var goals = state.goals.slice(0, 3);
    var W = 1080, P = 72;
    var H = 470 + 120 + (cats.length ? 120 + cats.length * 74 : 0) + 260 + (buds.length ? 120 + buds.length * 74 : 0) + (goals.length ? 120 + goals.length * 74 : 0) + 200;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#14171f'); bg.addColorStop(1, '#0a0c11');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    var glow = c.createRadialGradient(W, 0, 0, W, 0, 760); glow.addColorStop(0, 'rgba(87,185,138,0.14)'); glow.addColorStop(1, 'rgba(87,185,138,0)');
    c.fillStyle = glow; c.fillRect(0, 0, W, H);
    var mg = c.createLinearGradient(P, 60, P + 64, 124); mg.addColorStop(0, '#e8cd8a'); mg.addColorStop(1, '#c9a24a');
    c.fillStyle = mg; roundRect(c, P, 60, 64, 64, 16); c.fill();
    c.fillStyle = '#1b1404'; c.font = '700 34px "Baloo 2", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('B', P + 32, 94);
    c.textAlign = 'left'; c.fillStyle = '#8c92a3'; c.font = '600 28px Inter, sans-serif'; c.fillText('BarnaBank', P + 84, 94);
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#8c92a3'; c.font = '600 30px Inter, sans-serif'; c.fillText('Resumo de', P, 214);
    c.fillStyle = '#eee9da'; c.font = '700 74px "Baloo 2", sans-serif'; c.fillText(MONTH_NAMES[m] + ' ' + y, P, 290);
    // números
    var bw = (W - 2 * P - 40) / 3, yy = 340;
    [['Entradas', inc, '#57b98a'], ['Gastos', sp.total, '#e2665c'], ['Saldo', inc - sp.total, inc - sp.total >= 0 ? '#57b98a' : '#e2665c']].forEach(function(s, i){
      var x = P + i * (bw + 20);
      c.fillStyle = 'rgba(255,255,255,0.04)'; roundRect(c, x, yy, bw, 130, 22); c.fill();
      c.fillStyle = '#8c92a3'; c.font = '600 24px Inter, sans-serif'; c.fillText(s[0], x + 24, yy + 46);
      c.fillStyle = s[2]; c.font = '700 40px "Baloo 2", sans-serif'; c.fillText(fitText(c, money.format(s[1]), bw - 40), x + 24, yy + 102);
    });
    yy += 130 + 60;
    function sectionTitle(t){ c.fillStyle = '#eee9da'; c.font = '700 36px "Baloo 2", sans-serif'; c.fillText(t, P, yy); yy += 34; }
    function bar(label, valTxt, frac, col, sub){
      c.fillStyle = '#eee9da'; c.font = '600 27px Inter, sans-serif'; c.fillText(fitText(c, label, 560), P, yy + 26);
      c.textAlign = 'right'; c.fillStyle = '#8c92a3'; c.font = '600 26px Inter, sans-serif'; c.fillText(valTxt, W - P, yy + 26); c.textAlign = 'left';
      c.fillStyle = '#101319'; roundRect(c, P, yy + 40, W - 2 * P, 14, 7); c.fill();
      if(frac > 0){ c.fillStyle = col; roundRect(c, P, yy + 40, Math.max(14, (W - 2 * P) * Math.min(1, frac)), 14, 7); c.fill(); }
      yy += 74;
    }
    if(cats.length){
      sectionTitle('Para onde foi o dinheiro');
      var max = cats[0].amount;
      cats.forEach(function(ct){ bar(ct.name + (ct.card > EPS ? ' · cartão' : ''), money.format(ct.amount), ct.amount / max, '#e2665c'); });
      yy += 40;
    }
    sectionTitle('Contas, cartão e empréstimos');
    [['Contas fixas', sp.bills, '#6f9ee8'], ['Cartão', sp.card, '#b58cf0'], ['Outros gastos', sp.other, '#e2665c']].forEach(function(s, i){
      var x = P + i * (bw + 20);
      c.fillStyle = s[2]; c.beginPath(); c.arc(x + 10, yy + 18, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#8c92a3'; c.font = '600 24px Inter, sans-serif'; c.fillText(s[0], x + 30, yy + 27);
      c.fillStyle = '#eee9da'; c.font = '700 32px "Baloo 2", sans-serif'; c.fillText(money.format(s[1]), x, yy + 72);
    });
    yy += 100;
    c.fillStyle = '#8c92a3'; c.font = '600 26px Inter, sans-serif';
    c.fillText('Recebi de amigos: ', P, yy + 20);
    var lw = c.measureText('Recebi de amigos: ').width;
    c.fillStyle = '#57b98a'; c.fillText(money.format(loanIn), P + lw, yy + 20);
    c.fillStyle = '#8c92a3'; c.textAlign = 'right'; c.fillText('Paguei de dívidas: ' + money.format(loanOut), W - P, yy + 20); c.textAlign = 'left';
    yy += 90;
    if(buds.length){
      sectionTitle('Orçamento');
      buds.forEach(function(b){ bar(b.name, money.format(b.spent) + ' / ' + money.format(b.limit), b.pct / 100, b.cls === 'over' ? '#e2665c' : b.cls === 'warn' ? '#c9a24a' : '#57b98a'); });
      yy += 40;
    }
    if(goals.length){
      sectionTitle('Metas');
      goals.forEach(function(g){ var gi = goalInfo(g); bar(g.name, money.format(gi.saved) + ' / ' + money.format(g.target), gi.pct / 100, '#57b98a'); });
      yy += 40;
    }
    // recorta na altura certa e escreve o rodapé
    var H2 = Math.round(yy + 90);
    var out = document.createElement('canvas'); out.width = W; out.height = H2;
    var o = out.getContext('2d');
    o.drawImage(cv, 0, 0);
    o.fillStyle = '#252a36'; o.fillRect(P, H2 - 96, W - 2 * P, 2);
    o.fillStyle = '#5a6072'; o.font = '500 22px Inter, sans-serif'; o.textAlign = 'right';
    o.fillText('gerado em ' + fmtDate(todayISO()) + ' · compras no cartão contam no mês da parcela', W - P, H2 - 50);
    return out;
  }
  document.getElementById('btnMonthImage').addEventListener('click', function(){
    var y = relState.year, m = relState.month;
    fontsReadyFor(['700 74px "Baloo 2"', '600 28px Inter', '700 32px "Baloo 2"']).then(function(){
      shareCanvas(drawMonthImage(y, m), 'barnabank-' + y + '-' + pad2(m + 1) + '.png', 'Resumo de ' + MONTH_NAMES[m].toLowerCase(), 'Guarde para comparar os meses ou mande pra quem divide as contas com você.');
    });
  });

  // ---------- nuvem: sincronização e bot do Telegram ----------
  var CLOUD_KEY_LS = 'barnabank_cloud', cloudCfg = (function(){ try{ return JSON.parse(lsGet(CLOUD_KEY_LS) || '{}') || {}; }catch(e){ return {}; } })();
  var cloudBusy = false, cloudTimer = 0, cloudDirty = false;
  function cloudOn(){ return !!(cloudCfg && cloudCfg.url && cloudCfg.key); }
  function cloudSaveCfg(){ lsSet(CLOUD_KEY_LS, JSON.stringify(cloudCfg)); }
  function cloudUrl(path){ return cloudCfg.url.replace(/\/+$/, '') + path; }
  function cloudFetch(method, body){
    return fetch(cloudUrl('/api/state'), {
      method: method,
      headers: {'Authorization': 'Bearer ' + cloudCfg.key, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r){
      if(r.status === 401) throw new Error('Chave errada');
      if(!r.ok) throw new Error('Erro ' + r.status);
      return r.json();
    });
  }
  function cloudSnapshot(){
    var b = buildBackup();
    delete b.receipts;
    b.settings = Object.assign({}, b.settings);
    return b;
  }
  // resumo pronto para o bot responder sem precisar refazer as contas
  function cloudSummary(){
    var today = todayISO(), limit = new Date(); limit.setDate(limit.getDate() + 30);
    var items = [];
    weekSources.forEach(function(src){ items = items.concat(src(toISO(limit)) || []); });
    var people = {}, list = [];
    state.debts.forEach(function(d){
      var k = nameKey(d.name);
      if(!people[k]){ people[k] = {name: d.name, rec: 0, pay: 0, late: 0}; list.push(people[k]); }
      if(isPaid(d)) return;
      if(d.kind === 'payable') people[k].pay = round2(people[k].pay + remaining(d));
      else { people[k].rec = round2(people[k].rec + remaining(d)); people[k].late = round2(people[k].late + overdueAmount(d)); }
    });
    return {
      at: new Date().toISOString(), today: today,
      balance: round2(totalWalletsBalance()),
      wallets: state.wallets.map(function(w){ return {name: w.name, balance: round2(walletBalance(w.id))}; }),
      people: peopleStats(list),
      stats: statsSummary(),
      alerts: spendingAlerts().map(function(a){ return {key: a.key, name: a.name, cur: a.cur, avg: a.avg, text: alertText(a)}; }),
      late: lateReceivables().map(function(p){ return {name: p.name, amount: p.overdue, since: p.oldest ? toISO(p.oldest) : ''}; }),
      due: items.map(function(it){ return {date: it.date, title: it.title, sub: it.sub, amount: round2(it.amount), dir: it.dir}; }),
      budgets: budgetStatus(ymOf(today)).map(function(b){ return {name: b.name, spent: b.spent, limit: b.limit}; }),
      goals: state.goals.map(function(g){ var gi = goalInfo(g); return {name: g.name, saved: gi.saved, target: g.target, deadline: g.deadline || '', perMonth: gi.perMonth, behind: gi.behind, monthAdds: gi.monthAdds, wallet: !!g.walletId, done: gi.done, late: gi.late}; }),
      subs: typeof detectSubs === 'function' ? detectSubs().map(function(x){ return {key: x.key, name: x.name, last: x.last, prev: x.prev, raised: x.raised}; }) : [],
      forecast: state.wallets.length ? monthForecast().end : null,
      charges: chargeList(),
      week: weekSummary(),
      lastMonth: lastMonthSummary(),
      pix: settings.pixKey || '',
      owner: settings.ownerName || ''
    };
  }
  function findPeopleDebts(name, kind){
    var q = normTxt(name).trim();
    var ds = state.debts.filter(function(d){ return d.kind === kind && !isPaid(d); });
    var exact = ds.filter(function(d){ return normTxt(d.name) === q; });
    if(exact.length) return exact;
    var first = ds.filter(function(d){ return normTxt(firstName(d.name)) === q; });
    var names = {};
    first.forEach(function(d){ names[nameKey(d.name)] = true; });
    if(first.length && Object.keys(names).length === 1) return first;
    var part = ds.filter(function(d){ return normTxt(d.name).indexOf(q) !== -1; });
    names = {};
    part.forEach(function(d){ names[nameKey(d.name)] = true; });
    return Object.keys(names).length === 1 ? part : [];
  }
  function walletByName(name){
    var q = normTxt(name || '').trim();
    if(q){ var w = state.wallets.find(function(x){ return normTxt(x.name) === q; }) || state.wallets.find(function(x){ return normTxt(x.name).indexOf(q) !== -1; }); if(w) return w.id; }
    if(settings.defaultWalletId && state.wallets.some(function(x){ return x.id === settings.defaultWalletId; })) return settings.defaultWalletId;
    return state.wallets[0] ? state.wallets[0].id : '';
  }
  // aplica o que chegou pelo Telegram; devolve [{id, ok, msg}]
  function applyCloudOps(ops){
    var res = [];
    ops.forEach(function(op){
      if(state.tgLog[op.id]){ res.push({id: op.id, ok: true, skipped: true, msg: ''}); return; }
      var date = /^\d{4}-\d{2}-\d{2}$/.test(op.date || '') ? op.date : todayISO();
      var amount = round2(+op.amount || 0);
      if(op.type === 'edit'){ res.push(editLogged(op)); return; }
      if(!(amount > 0) && op.type !== 'resched'){ res.push({id: op.id, ok: false, msg: 'valor inválido'}); return; }
      if(op.type === 'debt'){
        var n = Math.max(1, Math.min(60, parseInt(op.installments, 10) || 1));
        var dueDay = parseInt(op.dueDay, 10);
        var d = {id: uid(), name: String(op.name || '').trim().slice(0, 60), principal: amount, date: date, days: n * 30, installments: n, rate: 0, interestType: 'composto',
          dueDay: dueDay >= 1 && dueDay <= 31 ? dueDay : parseInt(date.slice(8), 10), payments: [], notes: (op.note ? op.note + ' · ' : '') + 'via Telegram',
          kind: op.kind === 'payable' ? 'payable' : 'receivable', discount: 0,
          lateFeePct: op.kind === 'payable' ? 0 : (+settings.defaultLateFee || 0), lateInterestPct: op.kind === 'payable' ? 0 : (+settings.defaultLateInterest || 0)};
        if(!d.name){ res.push({id: op.id, ok: false, msg: 'sem nome'}); return; }
        var existing = state.debts.find(function(x){ return nameKey(x.name) === nameKey(d.name); });
        if(!existing){
          var fn = state.debts.filter(function(x){ return normTxt(firstName(x.name)) === normTxt(d.name); });
          var uniq = {}; fn.forEach(function(x){ uniq[nameKey(x.name)] = x.name; });
          if(Object.keys(uniq).length === 1) d.name = uniq[Object.keys(uniq)[0]];
        } else d.name = existing.name;
        var nd = migrateDebts([d])[0];
        state.debts.push(nd);
        state.tgLog[op.id] = {at: todayISO(), debt: nd.id};
        res.push({id: op.id, ok: true, msg: (d.kind === 'payable' ? 'Você deve ' : d.name + ' te deve ') + money.format(amount) + (d.kind === 'payable' ? ' a ' + d.name : '')});
      } else if(op.type === 'pay'){
        var kind = op.kind === 'payable' ? 'payable' : 'receivable';
        var byId = op.debtId ? state.debts.filter(function(x){ return x.id === op.debtId && !isPaid(x); }) : [];
        var ds = (byId.length ? byId : findPeopleDebts(op.name, kind)).sort(function(a, b){ var x = nextDueDate(a), y = nextDueDate(b); return (x ? x.getTime() : 0) - (y ? y.getTime() : 0); });
        if(!ds.length){ res.push({id: op.id, ok: false, msg: 'não achei dívida em aberto de "' + op.name + '"'}); return; }
        var left = amount, w = op.wallet ? walletByName(op.wallet) : '', made = [], firstPay = null;
        ds.forEach(function(d, i){
          if(left <= EPS) return;
          var part = i === ds.length - 1 ? left : Math.min(left, remaining(d));
          if(part <= EPS) return;
          var p = {id: uid(), date: date, amount: round2(part), mode: 'fifo', note: op.viaLink ? 'informado pelo link' : 'via Telegram'};
          var wid = w || defaultWalletId(d);
          if(wid) p.walletId = wid;
          d.payments.push(p);
          made.push({debt: d.id, pay: p.id});
          if(!firstPay) firstPay = p;
          left = round2(left - part);
        });
        invalidateSchedules();
        state.tgLog[op.id] = {at: todayISO(), pays: made};
        res.push({id: op.id, ok: true, photo: op.photo ? firstPay : null, msg: (kind === 'payable' ? 'Pago ' : 'Recebido ') + money.format(amount) + (kind === 'payable' ? ' a ' : ' de ') + ds[0].name + (op.photo ? ' 📎' : '')});
      } else if(op.type === 'tx'){
        if(op.card && op.kind !== 'entrada' && state.cards.length){
          var hint = normTxt(op.cardHint || ''), card = (hint && state.cards.find(function(c){ return normTxt(c.name).indexOf(hint) !== -1 || hint.indexOf(normTxt(c.name)) !== -1; })) || state.cards[0];
          var pcat = String(op.category || '').trim() || (op.store ? guessCategory(op.store, false) : '') || 'Outros';
          var cp = {id: uid('p-'), cardId: card.id, desc: (op.store || pcat).slice(0, 60), amount: amount, installments: Math.max(1, Math.min(24, parseInt(op.installments, 10) || 1)), date: date, category: pcat};
          state.cardPurchases.push(cp);
          state.tgLog[op.id] = {at: todayISO(), cp: cp.id};
          res.push({id: op.id, ok: true, category: pcat, card: card.name, msg: 'Compra no cartão ' + card.name + ' · ' + money.format(amount) + ' · ' + pcat});
          return;
        }
        var wid2 = walletByName(op.wallet);
        if(!wid2){ res.push({id: op.id, ok: false, msg: 'crie uma carteira no app primeiro'}); return; }
        var cat = String(op.category || '').trim().slice(0, 40) || (op.store && op.kind !== 'entrada' ? guessCategory(op.store, false) : '') || (op.kind === 'entrada' ? 'Entrada' : 'Outros');
        cat = cat.charAt(0).toUpperCase() + cat.slice(1);
        var known = knownExpenseCats().concat(state.transactions.map(function(t){ return t.category || ''; })).find(function(k){ return normTxt(k) === normTxt(cat); });
        var ntx = {id: uid(), walletId: wid2, type: op.kind === 'entrada' ? 'entrada' : 'gasto', amount: amount, date: date, category: known || cat, note: (op.note ? op.note + ' · ' : '') + 'via Telegram'};
        state.transactions.push(ntx);
        state.tgLog[op.id] = {at: todayISO(), tx: ntx.id};
        res.push({id: op.id, ok: true, category: known || cat, msg: (op.kind === 'entrada' ? 'Entrada ' : 'Gasto ') + money.format(amount) + ' · ' + (known || cat)});
      } else if(op.type === 'group'){
        var gr = createRacha(op, amount, date);
        if(gr.error){ res.push({id: op.id, ok: false, msg: gr.error}); return; }
        state.tgLog[op.id] = {at: todayISO(), group: gr.g.id, share: gr.token};
        res.push({id: op.id, ok: true, msg: 'Racha: ' + gr.g.title + ' · ' + money.format(amount), group: {title: gr.g.title, token: gr.token, due: gr.g.dueDate, myShare: gr.g.myShare,
          parts: gr.debts.map(function(d){ return {name: d.name, amount: d.principal}; })}});
      } else if(op.type === 'goal'){
        var q = normTxt(op.name || '').trim();
        var gl = state.goals.find(function(x){ return normTxt(x.name) === q; }) || state.goals.find(function(x){ return normTxt(x.name).indexOf(q) === 0 || q.indexOf(normTxt(x.name)) === 0; });
        if(!gl){ res.push({id: op.id, ok: false, msg: 'não achei a meta "' + op.name + '"'}); return; }
        if(gl.walletId){ res.push({id: op.id, ok: false, msg: 'a meta ' + gl.name + ' acompanha o saldo de uma carteira: é só lançar a entrada nela'}); return; }
        var ad = {id: uid('ga-'), date: date, amount: amount, note: 'via Telegram'};
        gl.adds = gl.adds || []; gl.adds.push(ad);
        state.tgLog[op.id] = {at: todayISO(), goal: gl.id, add: ad.id};
        var gi2 = goalInfo(gl);
        res.push({id: op.id, ok: true, msg: 'Meta ' + gl.name + ': +' + money.format(amount), goal: {name: gl.name, saved: gi2.saved, target: gl.target, pct: Math.round(gi2.pct), perMonth: gi2.perMonth, behind: gi2.behind, deadline: gl.deadline || ''}});
      } else if(op.type === 'resched'){
        var rd = op.debtId ? state.debts.filter(function(x){ return x.id === op.debtId && !isPaid(x); }) : findPeopleDebts(op.name, 'receivable');
        rd = rd.slice().sort(function(a, b){ var x = nextDueDate(a), y = nextDueDate(b); return (x ? x.getTime() : 0) - (y ? y.getTime() : 0); });
        var newDate = /^\d{4}-\d{2}-\d{2}$/.test(op.newDate || '') ? op.newDate : '';
        if(!rd.length || !newDate){ res.push({id: op.id, ok: false, msg: 'não achei a dívida para remarcar'}); return; }
        var r0 = rd[0], moved = reschedule(r0, newDate);
        if(!moved.length){ res.push({id: op.id, ok: false, msg: 'nada para remarcar'}); return; }
        invalidateSchedules();
        state.tgLog[op.id] = {at: todayISO(), resched: {debt: r0.id, moved: moved}};
        res.push({id: op.id, ok: true, msg: 'Prazo de ' + firstName(r0.name) + ' até ' + fmtDate(newDate)});
      } else res.push({id: op.id, ok: false, msg: 'tipo desconhecido'});
    });
    return res;
  }
  // "racha 120 com Bia e Caio": cria o grupo (você incluso, salvo "sem mim") e o link
  function createRacha(op, total, date){
    var names = (op.names || []).map(function(n){ return String(n || '').trim().slice(0, 60); }).filter(Boolean);
    var seen = {};
    names = names.filter(function(n){ var k = nameKey(n); if(seen[k]) return false; seen[k] = true; return true; });
    if(!names.length) return {error: 'diga com quem dividiu'};
    // nome completo de quem já está no app ("Bia" → "Bia Lima")
    names = names.map(function(n){
      var hit = state.debts.filter(function(d){ return normTxt(firstName(d.name)) === normTxt(n) || normTxt(d.name) === normTxt(n); });
      var u = {}; hit.forEach(function(d){ u[nameKey(d.name)] = d.name; });
      return Object.keys(u).length === 1 ? u[Object.keys(u)[0]] : n.replace(/(^|\s)\S/g, function(c){ return c.toUpperCase(); });
    });
    var inc = op.includeMe !== false, n = names.length + (inc ? 1 : 0);
    var each = Math.floor(total / n * 100) / 100, mine = inc ? round2(total - each * names.length) : 0;
    if(!inc){ each = Math.floor(total / names.length * 100) / 100; }
    var due = /^\d{4}-\d{2}-\d{2}$/.test(op.dueDate || '') ? op.dueDate : addDaysISO(date, 7);
    var g = {id: uid('g-'), title: String(op.title || ('Racha de ' + fmtDate(date))).slice(0, 60), kind: 'receivable', date: date, total: total,
      splitMode: 'equal', includeMe: inc, myShare: mine, dueDate: due, walletId: '', notes: 'via Telegram'};
    state.groups.push(g);
    var debts = names.map(function(nm, i){
      var amt = !inc && i === names.length - 1 ? round2(total - each * (names.length - 1)) : each;
      var d = migrateDebts([newGroupDebt(g, nm, amt)])[0];
      state.debts.push(d);
      return d;
    });
    linkGroups(state.debts, state.groups);
    var token = newShareToken();
    state.shares[token] = {type: 'group', ref: g.id, created: todayISO()};
    invalidateSchedules();
    return {g: g, debts: debts, token: token};
  }
  // "na verdade foi 45": corrige o valor (ou a categoria) do que foi lançado pelo bot
  function editLogged(op){
    var log = state.tgLog[op.target];
    if(!log || log.undone) return {id: op.id, ok: false, msg: 'esse lançamento ainda não entrou (ou foi desfeito)'};
    var amt = round2(+op.amount || 0), cat = String(op.category || '').trim(), prev = null, what = '';
    if(log.tx){
      var t = state.transactions.find(function(x){ return x.id === log.tx; });
      if(!t) return {id: op.id, ok: false, msg: 'não achei o lançamento'};
      prev = {tx: t.id, amount: t.amount, category: t.category};
      if(amt > 0) t.amount = amt;
      if(cat){ var known = knownExpenseCats().find(function(k){ return normTxt(k) === normTxt(cat); }); t.category = known || (cat.charAt(0).toUpperCase() + cat.slice(1)); }
      what = (t.type === 'entrada' ? 'Entrada ' : 'Gasto ') + money.format(t.amount) + ' · ' + t.category;
    } else if(log.cp){
      var cp = state.cardPurchases.find(function(x){ return x.id === log.cp; });
      if(!cp) return {id: op.id, ok: false, msg: 'não achei a compra'};
      prev = {cp: cp.id, amount: cp.amount, category: cp.category};
      if(amt > 0) cp.amount = amt;
      if(cat) cp.category = cat.charAt(0).toUpperCase() + cat.slice(1);
      what = 'Compra no cartão ' + money.format(cp.amount) + ' · ' + cp.category;
    } else if(log.debt){
      var d = state.debts.find(function(x){ return x.id === log.debt; });
      if(!d || !(amt > 0)) return {id: op.id, ok: false, msg: 'diga o valor certo'};
      prev = {debt: d.id, amount: d.principal};
      d.principal = amt;
      what = (d.kind === 'payable' ? 'Você deve ' : d.name + ' te deve ') + money.format(amt);
    } else if(log.pays && log.pays.length === 1){
      var pd = state.debts.find(function(x){ return x.id === log.pays[0].debt; }), pp = pd && pd.payments.find(function(x){ return x.id === log.pays[0].pay; });
      if(!pp || !(amt > 0)) return {id: op.id, ok: false, msg: 'diga o valor certo'};
      prev = {pay: log.pays[0], amount: pp.amount};
      pp.amount = amt;
      what = 'Pagamento de ' + pd.name + ': ' + money.format(amt);
    } else if(log.goal){
      var gl = state.goals.find(function(x){ return x.id === log.goal; }), ga = gl && (gl.adds || []).find(function(a){ return a.id === log.add; });
      if(!ga || !(amt > 0)) return {id: op.id, ok: false, msg: 'diga o valor certo'};
      prev = {goal: gl.id, add: ga.id, amount: ga.amount};
      ga.amount = amt;
      what = 'Meta ' + gl.name + ': ' + money.format(amt);
    } else return {id: op.id, ok: false, msg: 'esse tipo de lançamento só dá pra editar no app'};
    invalidateSchedules();
    state.tgLog[op.id] = {at: todayISO(), edit: prev};
    return {id: op.id, ok: true, msg: 'Corrigido: ' + what};
  }
  function restoreEdit(p){
    if(p.tx){ var t = state.transactions.find(function(x){ return x.id === p.tx; }); if(t){ t.amount = p.amount; t.category = p.category; } }
    if(p.cp){ var c = state.cardPurchases.find(function(x){ return x.id === p.cp; }); if(c){ c.amount = p.amount; c.category = p.category; } }
    if(p.debt){ var d = state.debts.find(function(x){ return x.id === p.debt; }); if(d) d.principal = p.amount; }
    if(p.pay){ var pd = state.debts.find(function(x){ return x.id === p.pay.debt; }), pp = pd && pd.payments.find(function(x){ return x.id === p.pay.pay; }); if(pp) pp.amount = p.amount; }
    if(p.goal){ var g = state.goals.find(function(x){ return x.id === p.goal; }), a = g && (g.adds || []).find(function(x){ return x.id === p.add; }); if(a) a.amount = p.amount; }
  }
  // remarca para newDate o que está atrasado (ou, se nada atrasou, a próxima parcela); devolve [{idx, prev}]
  function reschedule(d, newDate){
    var s = debtSchedule(d), today = todayISO(), out = [];
    var targets = s.insts.filter(function(it){ return it.open > 0 && it.dueISO < today; });
    if(!targets.length && s.firstOpen) targets = [s.firstOpen];
    targets.forEach(function(it){
      if(newDate <= it.dueISO) return;
      d.dueOverride = d.dueOverride || {};
      out.push({idx: it.i, prev: d.dueOverride[it.i] || null});
      d.dueOverride[it.i] = newDate;
    });
    return out;
  }
  // desfazer pelo Telegram algo que já tinha entrado no app
  function applyCloudUndo(list){
    var done = [];
    (list || []).forEach(function(u){
      var log = state.tgLog[u.id];
      done.push(u.id);
      if(!log || log.undone) return;
      if(log.debt) state.debts = state.debts.filter(function(d){ return d.id !== log.debt; });
      if(log.tx) state.transactions = state.transactions.filter(function(t){ return t.id !== log.tx; });
      if(log.cp) state.cardPurchases = state.cardPurchases.filter(function(x){ return x.id !== log.cp; });
      if(log.goal){ var ug = state.goals.find(function(x){ return x.id === log.goal; }); if(ug) ug.adds = (ug.adds || []).filter(function(a){ return a.id !== log.add; }); }
      if(log.group){
        var keepPaid = state.debts.filter(function(dd){ return dd.groupId === log.group && paidAmount(dd) > EPS; });
        keepPaid.forEach(function(dd){ delete dd.groupId; });
        state.debts = state.debts.filter(function(dd){ return dd.groupId !== log.group; });
        state.groups = state.groups.filter(function(gg){ return gg.id !== log.group; });
        if(log.share && state.shares) delete state.shares[log.share];
      }
      if(log.edit) restoreEdit(log.edit);
      if(log.resched){
        var rd = state.debts.find(function(dd){ return dd.id === log.resched.debt; });
        if(rd && rd.dueOverride) log.resched.moved.forEach(function(m){ if(m.prev) rd.dueOverride[m.idx] = m.prev; else delete rd.dueOverride[m.idx]; });
        if(rd && rd.dueOverride && !Object.keys(rd.dueOverride).length) delete rd.dueOverride;
      }
      (log.pays || []).forEach(function(x){
        var d = state.debts.find(function(dd){ return dd.id === x.debt; });
        if(d) d.payments = (d.payments || []).filter(function(p){ return p.id !== x.pay; });
      });
      log.undone = true;
    });
    if(done.length) invalidateSchedules();
    return done;
  }
  function fetchTgPhotos(results){
    var jobs = results.filter(function(x){ return x.ok && x.photo; }).map(function(x){
      return fetch(cloudUrl('/api/photo/' + x.id), {headers: {'Authorization': 'Bearer ' + cloudCfg.key}})
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){
          if(!j || !/^data:image\//.test(j.data || '')) return;
          var rid = 'rc-tg-' + x.id;
          return rcptPut(rid, j.data).then(function(){ x.photo.receiptId = rid; });
        }).catch(function(){});
    });
    return Promise.all(jobs);
  }
  function cloudPush(ack, undoAck){
    if(!cloudOn()) return Promise.resolve();
    cloudDirty = false;
    return cloudFetch('PUT', {snapshot: cloudSnapshot(), summary: cloudSummary(), shares: shareViews(), ack: ack || [], undoAck: undoAck || []}).then(function(r){
      cloudCfg.last = new Date().toISOString(); cloudCfg.err = '';
      if(r && r.rev) cloudCfg.rev = r.rev;
      cloudCfg.synced = hashStr(lsGet(STORAGE_KEY) || '');
      cloudSaveCfg(); renderCloudStatus();
      return r;
    }).catch(function(e){ cloudCfg.err = e.message; cloudSaveCfg(); renderCloudStatus(); cloudDirty = true; });
  }
  // a nuvem já aplica o que chega pelo bot; se este aparelho não mudou nada, é só pegar a versão de lá
  function cloudSync(opts){
    opts = opts || {};
    if(!cloudOn() || cloudBusy) return Promise.resolve();
    cloudBusy = true;
    return cloudFetch('GET').then(function(r){
      var ops = Array.isArray(r.inbox) ? r.inbox : [];
      cloudExtra.claims = Array.isArray(r.claims) ? r.claims : [];
      cloudExtra.views = r.views && typeof r.views === 'object' ? r.views : {};
      cloudExtra.friends = r.friends && typeof r.friends === 'object' ? r.friends : {};
      if(r.bot) cloudExtra.bot = r.bot;
      renderClaims();
      if(state.page === 'pessoa' && typeof renderPersonPage === 'function') renderPersonPage();
      if(r.snapshot && appIsEmpty() && !opts.noRestore){
        cloudBusy = false;
        return appConfirm('Usar os dados da nuvem?', '<p class="warn">Este aparelho está vazio e encontrei seus dados salvos na nuvem' + (r.updatedAt ? ' (de ' + fmtDate(r.updatedAt.slice(0, 10)) + ')' : '') + '. Quer usar eles aqui?</p>', {okText: 'Usar dados da nuvem', icon: 'cloud-download'})
          .then(function(ok){ if(ok){ restoreFromCloud(r.snapshot); cloudCfg.rev = r.rev; cloudCfg.synced = hashStr(lsGet(STORAGE_KEY) || ''); cloudSaveCfg(); return cloudSync({noRestore: true}); } });
      }
      var localChanged = !cloudCfg.synced || hashStr(lsGet(STORAGE_KEY) || '') !== cloudCfg.synced;
      var adopted = false;
      if(!localChanged && r.snapshot && r.rev && r.rev !== cloudCfg.rev){
        loadSnapshotData(r.snapshot);
        adopted = true;
      }
      var results = ops.length ? applyCloudOps(ops) : [];
      var fresh = results.filter(function(x){ return !x.skipped; });
      var undoneBefore = (r.undo || []).filter(function(u){ return state.tgLog[u.id] && state.tgLog[u.id].undone; }).length;
      var undone = applyCloudUndo(r.undo);
      var undoneN = (r.undo || []).filter(function(u){ return state.tgLog[u.id] && state.tgLog[u.id].undone; }).length - (adopted ? 0 : undoneBefore);
      var viaCloud = adopted ? ops.filter(function(o){ return state.tgLog[o.id] && !fresh.some(function(x){ return x.id === o.id; }); }).length : 0;
      if(adopted || fresh.length || undoneN) render();
      var okN = fresh.filter(function(x){ return x.ok; }).length + viaCloud, bad = fresh.filter(function(x){ return !x.ok; });
      if(okN) showToast('Telegram: ' + okN + (okN === 1 ? ' lançamento' : ' lançamentos') + ' no app' + (fresh.length ? ' · ' + fresh.filter(function(x){ return x.ok; }).map(function(x){ return x.msg; }).slice(0, 2).join(' · ') : ''), 'send');
      else if(adopted) showToast('Atualizado com a nuvem', 'cloud-download');
      if(undoneN > 0) showToast('Telegram: ' + undoneN + (undoneN === 1 ? ' lançamento desfeito' : ' lançamentos desfeitos'), 'undo-2');
      if(bad.length) setTimeout(function(){ appAlert('Mensagens do Telegram que não entraram', '<ul class="ad-list">' + bad.map(function(b){ var op = ops.find(function(o){ return o.id === b.id; }); return '<li>"' + escapeHtml(op && op.text || '') + '": ' + escapeHtml(b.msg) + '</li>'; }).join('') + '</ul>', 'send'); }, 600);
      return Promise.all([fetchTgPhotos(fresh), fetchMissingTgPhotos()]).then(function(){
        render();
        cloudBusy = false;
        return cloudPush(ops.map(function(o){ return o.id; }), undone);
      });
    }).catch(function(e){
      cloudBusy = false;
      cloudCfg.err = e.message; cloudSaveCfg(); renderCloudStatus();
      if(opts.loud) showToast('Nuvem: ' + e.message, 'triangle-alert');
    });
  }
  // fotos de comprovante de pagamentos que a nuvem já lançou
  function fetchMissingTgPhotos(){
    var jobs = [];
    state.debts.forEach(function(d){
      (d.payments || []).forEach(function(p){
        if(!p.receiptId || p.receiptId.indexOf('rc-tg-') !== 0 || receiptCache[p.receiptId]) return;
        var opId = p.receiptId.slice(6);
        jobs.push(fetch(cloudUrl('/api/photo/' + opId), {headers: {'Authorization': 'Bearer ' + cloudCfg.key}})
          .then(function(r){ return r.ok ? r.json() : null; })
          .then(function(j){ if(j && /^data:image\//.test(j.data || '')) return rcptPut(p.receiptId, j.data); })
          .catch(function(){}));
      });
    });
    return Promise.all(jobs);
  }
  // troca os dados pelos de um snapshot (sem mexer na tela)
  function loadSnapshotData(snap){
    state.debts = migrateDebts(snap.debts || []);
    state.groups = migrateGroups(snap.groups);
    linkGroups(state.debts, state.groups);
    state.contacts = snap.contacts || {};
    state.wallets = Array.isArray(snap.wallets) ? snap.wallets : [];
    state.transactions = Array.isArray(snap.transactions) ? snap.transactions : [];
    var fin = migrateFinance(JSON.parse(JSON.stringify(snap)));
    state.bills = fin.bills; state.cards = fin.cards; state.cardPurchases = fin.cardPurchases; state.cardPayments = fin.cardPayments;
    state.budgets = fin.budgets; state.goals = fin.goals; state.nudges = fin.nudges; state.recurring = fin.recurring; state.shares = fin.shares; state.tgLog = fin.tgLog; state.catRules = fin.catRules; state.invites = fin.invites;
    if(snap.settings && typeof snap.settings === 'object'){
      Object.keys(DEFAULT_SETTINGS).forEach(function(k){ if(snap.settings[k] !== undefined) settings[k] = snap.settings[k]; });
      saveSettings(); rebuildMoneyFormatter();
    }
    invalidateSchedules();
  }
  function restoreFromCloud(snap, doneMsg){
    if(!snap || typeof snap !== 'object') return;
    loadSnapshotData(snap);
    lsSet(WELCOME_KEY, '1');
    welcomeOverlay.classList.remove('show');
    render(); renderAll();
    showToast(doneMsg || 'Dados da nuvem carregados', doneMsg ? 'undo-2' : 'cloud-download');
  }
  // depois de salvar, manda para a nuvem (com uma pausa, para juntar várias mudanças)
  function cloudSchedule(){
    if(window.__BB_HEADLESS || !cloudOn()) return;
    cloudDirty = true;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function(){ if(!cloudBusy) cloudPush(); }, 2500);
  }
  function renderCloudStatus(){
    var el = document.getElementById('cloudStatus');
    if(!el) return;
    if(!cloudOn()){ el.textContent = 'Desligado.'; el.className = 'cloud-status'; return; }
    el.className = 'cloud-status' + (cloudCfg.err ? ' err' : ' ok');
    el.textContent = cloudCfg.err ? 'Erro: ' + cloudCfg.err
      : cloudCfg.last ? 'Sincronizado ' + relDay(cloudCfg.last.slice(0, 10)) + ' às ' + new Date(cloudCfg.last).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : 'Ligado, ainda não sincronizou.';
  }
  function openCloudSettings(){
    openDialog({
      title: 'Nuvem e bot do Telegram', icon: 'cloud', okText: 'Salvar e sincronizar',
      html: '<p class="warn">Com o bot instalado (veja o passo a passo no README do repositório), você manda mensagens como <b>"Vini me deve 50"</b> ou <b>"gastei 35 mercado"</b> e elas entram aqui. Os dados também ficam guardados na sua conta da Cloudflare.</p>' +
        '<div class="field"><label for="clUrl">Endereço do bot</label><input id="clUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://barnabank-bot.seu-nome.workers.dev" value="' + escapeHtml(cloudCfg.url || '') + '"></div>' +
        '<div class="field"><label for="clKey">Chave (SYNC_KEY)</label><input id="clKey" type="password" autocomplete="off" placeholder="a mesma que você colocou no GitHub" value="' + escapeHtml(cloudCfg.key || '') + '"></div>' +
        '<div class="cloud-status" id="cloudStatus"></div>' +
        (cloudOn() ? '<div class="card-actions"><button type="button" class="btn btn-ghost btn-sm" id="clTest">' + ic('send') + ' Testar bot</button><button type="button" class="btn btn-ghost btn-sm" id="clPull">' + ic('cloud-download') + ' Trocar pelos dados da nuvem</button><button type="button" class="btn btn-ghost btn-sm" id="clBackups">' + ic('history') + ' Backups diários</button><div class="spacer"></div><button type="button" class="btn btn-danger btn-sm" id="clOff">Desligar</button></div>' : ''),
      onOk: function(body){
        var url = body.querySelector('#clUrl').value.trim(), key = body.querySelector('#clKey').value.trim();
        if(url && !/^https:\/\/[^\s/]+/.test(url)) return 'O endereço precisa começar com https://';
        if(url && !key) return 'Informe a chave.';
        cloudCfg.url = url; cloudCfg.key = key; cloudCfg.err = '';
        cloudSaveCfg();
        if(cloudOn()) cloudSync({loud: true}).then(function(){ if(!cloudCfg.err) showToast('Nuvem conectada', 'cloud'); });
        return true;
      }
    });
    renderCloudStatus();
    var off = document.getElementById('clOff');
    if(off) off.addEventListener('click', function(){ cloudCfg = {}; cloudSaveCfg(); closeDialog(false); showToast('Nuvem desligada neste aparelho', 'cloud'); });
    var bks = document.getElementById('clBackups');
    if(bks) bks.addEventListener('click', function(){ closeDialog(false); openBackups(); });
    var test = document.getElementById('clTest');
    if(test) test.addEventListener('click', function(){ closeDialog(false); botDiagnose(); });
    var pull = document.getElementById('clPull');
    if(pull) pull.addEventListener('click', function(){
      closeDialog(false);
      cloudFetch('GET').then(function(r){
        if(!r.snapshot){ appAlert('Nada na nuvem ainda', '<p class="warn">A nuvem ainda não recebeu dados deste app.</p>', 'cloud'); return; }
        appConfirm('Trocar pelos dados da nuvem?', '<p class="warn">Os dados deste aparelho serão <b>substituídos</b> pelos da nuvem' + (r.updatedAt ? ' (salvos em ' + fmtDate(r.updatedAt.slice(0, 10)) + ')' : '') + '. Exporte um backup antes se tiver dúvida.</p>', {okText: 'Substituir', danger: true, icon: 'cloud-download'})
          .then(function(ok){ if(ok) restoreFromCloud(r.snapshot); });
      }).catch(function(e){ showToast('Nuvem: ' + e.message, 'triangle-alert'); });
    });
  }
  document.getElementById('btnCloud').addEventListener('click', function(){ closeSettings(); openCloudSettings(); });

  // diagnóstico do bot: o que está funcionando e o que não está
  function botCall(path){
    return fetch(cloudUrl(path), {headers: {'Authorization': 'Bearer ' + cloudCfg.key}}).then(function(r){
      if(r.status === 401) throw new Error('A chave (SYNC_KEY) do app não bate com a do GitHub.');
      if(r.status === 404) throw new Error('O bot está numa versão antiga. Rode o "Publicar bot do Telegram" de novo no GitHub.');
      if(!r.ok) throw new Error('O bot respondeu com erro ' + r.status + '.');
      return r.json();
    }, function(){ throw new Error('Não consegui falar com o bot. Confira o endereço (precisa ser o https://…workers.dev do resumo do GitHub).'); });
  }
  var TG_ERRORS = [
    [/ssl|certificate/i, 'o endereço *.workers.dev ainda está ganhando o certificado de segurança (pode levar alguns minutos depois de criado)'],
    [/resolve|dns|host/i, 'o endereço *.workers.dev ainda não está no ar para o Telegram (espere alguns minutos e toque em Religar)'],
    [/unauthorized|not found/i, 'o token do Telegram no GitHub (TELEGRAM_TOKEN) está errado'],
    [/timeout|timed out/i, 'o bot demorou para responder ao Telegram'],
    [/wrong response|bad gateway|5\d\d/i, 'o bot deu erro ao receber a mensagem']
  ];
  function tgReason(msg){
    for(var i = 0; i < TG_ERRORS.length; i++){ if(TG_ERRORS[i][0].test(msg || '')) return TG_ERRORS[i][1]; }
    return msg || '';
  }
  function botDiagnose(){
    openDialog({title: 'Testando o bot…', icon: 'send', alert: true, okText: 'Fechar', html: '<p class="warn">Conversando com a nuvem e com o Telegram…</p>'});
    botCall('/status').then(showDiag, function(e){ showDiagError(e.message); });
  }
  function showDiagError(msg){
    openDialog({title: 'Teste do bot', icon: 'send', alert: true, okText: 'Fechar',
      html: '<ul class="diag"><li class="bad">' + ic('x') + '<div><b>Nuvem</b><span>' + escapeHtml(msg) + '</span></div></li></ul>'});
  }
  function showDiag(st){
    function row(ok, title, txt, warn){ return '<li class="' + (ok ? 'ok' : warn ? 'warn' : 'bad') + '">' + ic(ok ? 'check' : warn ? 'circle-alert' : 'x') + '<div><b>' + title + '</b><span>' + txt + '</span></div></li>'; }
    var rows = row(true, 'Nuvem', 'respondendo, chave certa' + (st.summaryAt ? ' · dados enviados ' + relDay(st.summaryAt.slice(0, 10)) : ''));
    rows += row(st.tokenOk, 'Token do Telegram', st.tokenOk ? 'válido · ' + escapeHtml(st.bot || '') : 'o Telegram recusou o TELEGRAM_TOKEN' + (st.tokenError ? ' (' + escapeHtml(st.tokenError) + ')' : '') + '. Confira o segredo no GitHub e publique de novo.');
    var hookTxt = st.webhookOk ? 'o Telegram está entregando as mensagens para o bot'
      : st.webhookPointsElsewhere ? 'o Telegram está mandando as mensagens para outro endereço'
      : 'o Telegram ainda não sabe para onde mandar as mensagens';
    if(st.lastSetup && !st.lastSetup.ok && st.lastSetup.description) hookTxt += ' · motivo: ' + escapeHtml(tgReason(st.lastSetup.description));
    rows += row(st.webhookOk, 'Ligação com o Telegram', hookTxt);
    var recent = st.lastErrorAt && (Date.now() - new Date(st.lastErrorAt).getTime()) < 6 * 3600000;
    if(st.lastError && recent) rows += row(false, 'Entrega das mensagens', 'falhou ' + relDay(st.lastErrorAt.slice(0, 10)) + ': ' + escapeHtml(tgReason(st.lastError)) + (st.pending ? ' · ' + st.pending + ' mensagem(ns) na espera' : ''), true);
    rows += row(st.owner, 'Dono do bot', st.owner ? 'definido' : 'falta mandar /start para o bot' + (st.bot ? ' (' + escapeHtml(st.bot) + ')' : ''), true);
    if(st.botError && (Date.now() - new Date(st.botError.at).getTime()) < 24 * 3600000) rows += row(false, 'Último erro do bot', escapeHtml(String(st.botError.error).split('\n')[0]), true);
    if(st.inbox) rows += row(true, 'Mensagens', st.inbox + ' esperando para entrar no app');
    var allOk = st.tokenOk && st.webhookOk && st.owner;
    openDialog({title: allOk ? 'Bot funcionando' : 'Teste do bot', icon: 'send', okText: st.webhookOk ? 'Fechar' : 'Religar bot', cancelText: 'Fechar', alert: !!st.webhookOk,
      html: '<ul class="diag">' + rows + '</ul>' + (!st.webhookOk ? '<p class="warn">Toque em <b>Religar bot</b> para pedir de novo ao Telegram que mande as mensagens para cá.</p>' : ''),
      onOk: function(){
        if(st.webhookOk) return true;
        botCall('/setup').then(function(r){
          if(r.webhook) showToast('Bot religado ' + (r.bot ? '(' + r.bot + ')' : '') + '. Manda /start ou /resumo pra ele.', 'send');
          botCall('/status').then(showDiag, function(e){ showDiagError(e.message); });
        }, function(e){ showDiagError(e.message); });
        return true;
      }});
  }
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible' && cloudOn()) cloudSync(); });

  // ---------- inicialização ----------
  rcptLoadAll();
  if(runRecurring()) saveData();
  if(cloudOn()) setTimeout(function(){ cloudSync(); }, 400);

  // =====================================================================
  // v7: links de cobrança (pessoa e grupo) e /cobrar no bot
  // =====================================================================
  var SHARE_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newShareToken(){
    var a = new Uint8Array(22);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function(b){ return SHARE_CHARS[b % SHARE_CHARS.length]; }).join('');
  }
  function shareFor(type, ref){
    var ts = Object.keys(state.shares || {});
    for(var i = 0; i < ts.length; i++){ var sh = state.shares[ts[i]]; if(sh.type === type && sh.ref === ref) return ts[i]; }
    return null;
  }
  function shareUrl(token){ return cloudCfg && cloudCfg.url ? cloudCfg.url.replace(/\/+$/, '') + '/s/' + token : ''; }
  function shareLinkFor(type, ref){
    if(typeof cloudOn !== 'function' || !cloudOn() || !state.shares) return '';
    var t = shareFor(type, ref);
    return t ? shareUrl(t) : '';
  }
  function shortName(n){
    var p = String(n || '').trim().split(/\s+/);
    return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0];
  }
  function sortedPays(d){ return (d.payments || []).slice().sort(function(a, b){ return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).map(function(p){ return {date: p.date, amount: round2(p.amount)}; }); }
  function personShareView(key, onlyDebtId){
    var ds = state.debts.filter(function(d){ return onlyDebtId ? d.id === onlyDebtId : (nameKey(d.name) === key && d.kind === 'receivable'); });
    if(!ds.length) return null;
    var open = ds.filter(function(d){ return !isPaid(d); }), done = ds.filter(isPaid);
    var sum = function(arr, fn){ return round2(arr.reduce(function(s, d){ return s + fn(d); }, 0)); };
    return {
      type: 'person', name: firstName(ds[0].name), owner: settings.ownerName || '', pix: settings.pixKey || '', updatedAt: new Date().toISOString(),
      remaining: sum(open, remaining), late: sum(open, overdueAmount), doneCount: done.length, donePaid: sum(done, paidAmount),
      debts: open.sort(function(a, b){ return a.date < b.date ? -1 : 1; }).map(function(d){
        var s = debtSchedule(d), g = groupOf(d), n = installments(d);
        return {
          payNow: round2(s.overdue > EPS ? s.overdue : amountDueNow(d)), _id: d.id,
          title: g ? g.title : (n > 1 ? 'Empréstimo em ' + n + 'x' : 'Empréstimo'), date: d.date,
          total: round2(effectiveTotal(d)), paid: round2(Math.min(paidAmount(d), effectiveTotal(d))), remaining: round2(remaining(d)), late: round2(s.overdue),
          due: n === 1 && s.insts[0] ? s.insts[0].dueISO : '',
          insts: n > 1 ? s.insts.map(function(it){ return {n: it.i + 1, due: it.dueISO, value: round2(it.value + it.pen + it.penPaid), open: round2(it.open), state: it.state}; }) : [],
          payments: sortedPays(d)
        };
      })
    };
  }
  function groupShareView(g){
    var st = groupStats(g);
    if(!st.members.length) return null;
    return {
      type: 'group', title: g.title, date: g.date, dueDate: g.dueDate || '', total: round2(g.total), owed: round2(st.owed), paid: round2(st.paid), remaining: round2(st.remaining),
      myShare: g.includeMe ? round2(g.myShare) : 0, owner: settings.ownerName || '', pix: settings.pixKey || '', updatedAt: new Date().toISOString(),
      members: st.members.map(function(d){
        var et = effectiveTotal(d);
        return {name: shortName(d.name), total: round2(et), paid: round2(Math.min(paidAmount(d), et)), remaining: round2(remaining(d)), state: memberState(d)};
      })
    };
  }
  function shareViews(){
    var out = {};
    Object.keys(state.shares || {}).forEach(function(t){
      var sh = state.shares[t];
      var v = sh.type === 'group' ? (groupById(sh.ref) ? groupShareView(groupById(sh.ref)) : null) : sh.type === 'debt' ? personShareView(null, sh.ref) : personShareView(sh.ref);
      if(v) out[t] = decorateShare(v, sh);
    });
    return out;
  }
  // lista para o /cobrar do bot: todo mundo que te deve, com a mensagem pronta
  function chargeList(){
    var by = {}, out = [], late = {};
    lateReceivables().forEach(function(p){ late[p.key] = p; });
    state.debts.forEach(function(d){
      if(d.kind !== 'receivable' || isPaid(d)) return;
      var k = nameKey(d.name);
      (by[k] || (by[k] = {key: k, name: d.name, debts: []})).debts.push(d);
    });
    Object.keys(by).forEach(function(k){
      var p = by[k];
      var soon = p.debts.slice().sort(function(a, b){ var x = nextDueDate(a), y = nextDueDate(b); return (x ? x.getTime() : 0) - (y ? y.getTime() : 0); })[0];
      out.push({key: k, name: p.name, remaining: round2(p.debts.reduce(function(s, d){ return s + remaining(d); }, 0)), late: late[k] ? late[k].overdue : 0,
        text: late[k] ? nudgeText(late[k]) : whatsappMessage(soon), phone: whatsPhone(p.name), link: shareLinkFor('person', k), next: nextCharge(p.debts), lateSince: late[k] && late[k].oldest ? toISO(late[k].oldest) : ''});
    });
    return out.sort(function(a, b){ return (b.late - a.late) || (b.remaining - a.remaining); });
  }
  // próximo vencimento (data e quanto) de uma lista de dívidas
  function nextCharge(ds){
    var best = null;
    ds.forEach(function(d){
      var due = nextDueDate(d);
      if(!due) return;
      var iso = toISO(due), q = quickPayInfo(d), amt = round2(q ? q.amount : amountDueNow(d));
      if(!(amt > EPS)) return;
      if(!best || iso < best.date) best = {date: iso, amount: amt};
      else if(iso === best.date) best.amount = round2(best.amount + amt);
    });
    return best;
  }
  function openShareDialog(type, ref, label){
    if(!cloudOn()){
      appAlert('Precisa da nuvem', '<p class="warn">O link fica hospedado no seu bot, na sua conta da Cloudflare. Ligue em <b>Configurações → Nuvem e bot do Telegram</b> e tente de novo.</p>', 'cloud');
      return;
    }
    var token = shareFor(type, ref);
    function show(){
      var url = shareUrl(token);
      var phone = type !== 'group' ? whatsPhone(label) : '';
      var waText = type === 'group'
        ? 'Pessoal, aqui dá pra ver quem já pagou o *' + label + '* e quanto falta pra cada um: ' + url
        : 'Oi ' + firstName(label) + '! Aqui tá o resumo do que ficou em aberto comigo, com as parcelas e o PIX: ' + url;
      openDialog({
        title: type === 'group' ? 'Link do grupo' : type === 'debt' ? 'Link desta dívida · ' + firstName(label) : 'Link de cobrança · ' + firstName(label), icon: 'share-2', alert: true, okText: 'Fechar',
        html: '<p class="warn">' + (type === 'group'
            ? 'Quem abrir vê o <b>' + escapeHtml(label) + '</b>: quanto cada um já pagou e quanto falta, e o seu PIX.'
            : type === 'debt' ? 'Quem abrir vê só <b>esta dívida</b> de <b>' + escapeHtml(firstName(label)) + '</b>: parcelas, pagamentos e o seu PIX. As outras dívidas e o resto do app ficam de fora.'
            : 'Quem abrir vê só as dívidas de <b>' + escapeHtml(firstName(label)) + '</b> com você: parcelas, pagamentos e o seu PIX. Nada do resto do app.') +
          ' Atualiza sozinho quando você mexe no app.</p>' +
          '<div class="share-url"><input id="shUrl" type="text" readonly value="' + escapeHtml(url) + '"></div>' +
          '<div class="card-actions share-acts"><button type="button" class="btn btn-primary btn-sm" id="shCopy">' + ic('copy') + ' Copiar</button>' +
            '<a class="btn btn-whats btn-sm" id="shWa" target="_blank" rel="noopener" href="' + escapeHtml('https://wa.me/' + phone + '?text=' + encodeURIComponent(waText)) + '">' + ic('message-circle') + ' WhatsApp</a>' +
            '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(url) + '">' + ic('arrow-up-right') + ' Abrir</a></div>' +
          '<p class="share-views">👀 ' + escapeHtml(viewsText(token)) + '</p>' +
          (settings.pixKey ? '' : '<p class="warn">Dica: cadastre sua chave PIX em Configurações para o link mostrar o QR e o "copia e cola" com o valor certo.</p>') +
          '<div class="field" style="margin-top:12px;"><label for="shOwner">Seu nome (aparece no link)</label><input id="shOwner" type="text" maxlength="40" placeholder="Ex: João" value="' + escapeHtml(settings.ownerName || '') + '"></div>' +
          '<button type="button" class="btn btn-danger btn-sm" id="shOff">' + ic('x') + ' Desativar link</button>'
      });
      document.getElementById('shCopy').addEventListener('click', function(){
        copyText(url).then(function(ok){ showToast(ok ? 'Link copiado' : 'Não consegui copiar', ok ? 'copy' : 'triangle-alert'); });
      });
      document.getElementById('shUrl').addEventListener('click', function(e){ e.target.select(); });
      document.getElementById('shCopy').focus();
      var ow = document.getElementById('shOwner');
      ow.addEventListener('change', function(){ settings.ownerName = ow.value.trim(); saveSettings(); cloudSchedule(); });
      document.getElementById('shOff').addEventListener('click', function(){
        closeDialog(false);
        var sh = state.shares[token];
        delete state.shares[token];
        render(); saveData(); cloudPush();
        showUndo('Link desativado: quem tiver o link não vê mais nada', function(){ state.shares[token] = sh; render(); saveData(); cloudPush(); }, 'Link reativado', 'share-2');
      });
    }
    if(token){ show(); return; }
    token = newShareToken();
    state.shares[token] = {type: type, ref: ref, created: todayISO()};
    saveData();
    showToast('Criando o link…', 'share-2');
    cloudPush().then(function(){
      if(cloudCfg.err){
        delete state.shares[token]; saveData();
        appAlert('Não consegui criar o link', '<p class="warn">' + escapeHtml(cloudCfg.err) + '. Teste a conexão em Configurações → Nuvem e bot do Telegram.</p>', 'cloud');
        return;
      }
      render();
      show();
    });
  }

  // =====================================================================
  // v7b: resumo da semana (bot), histórico de alterações, importar extrato,
  //      "cabe no mês?"
  // =====================================================================

  // ---------- resumo da semana para o bot ----------
  function lastMonthSummary(){
    var ym = ymAdd(ymOf(todayISO()), -1), inc = 0, out = 0, rec = {};
    state.wallets.forEach(function(w){
      walletEvents(w.id).forEach(function(e){
        if(e.isTransfer || ymOf(e.date) !== ym) return;
        if(e.kind === 'entrada') inc += e.amount; else out += e.amount;
      });
    });
    state.debts.forEach(function(d){
      if(d.kind !== 'receivable') return;
      (d.payments || []).forEach(function(p){ if(ymOf(p.date) === ym){ var k = nameKey(d.name); rec[k] = rec[k] || {name: firstName(d.name), amount: 0}; rec[k].amount = round2(rec[k].amount + p.amount); } });
    });
    var sp = monthSpending(ym), cats = Object.keys(sp.byCat).map(function(k){ return sp.byCat[k]; }).sort(function(a, b){ return b.amount - a.amount; });
    var prev = monthSpending(ymAdd(ym, -1)).total;
    return {ym: ym, month: MONTH_NAMES[+ym.slice(5, 7) - 1], in: round2(inc), out: round2(out), spent: round2(sp.total), prevSpent: round2(prev),
      topCats: cats.slice(0, 4).map(function(c){ return {name: c.name, amount: round2(c.amount)}; }),
      received: Object.keys(rec).map(function(k){ return rec[k]; }).sort(function(a, b){ return b.amount - a.amount; }).slice(0, 5),
      late: lateReceivables().map(function(p){ return {name: firstName(p.name), amount: round2(p.overdue)}; }).slice(0, 5),
      goals: state.goals.map(function(g){ var gi = goalInfo(g); return {name: g.name, pct: Math.round(gi.pct)}; })};
  }
  function weekSummary(){
    var to = todayISO(), from = addDaysISO(to, -6), inc = 0, out = 0, cats = {}, rec = {};
    state.wallets.forEach(function(w){
      walletEvents(w.id).forEach(function(e){
        if(e.isTransfer || e.date < from || e.date > to) return;
        if(e.kind === 'entrada') inc += e.amount;
        else {
          out += e.amount;
          if(!e.isLoan && !(e.auto && /^card:/.test(e.auto))) cats[e.label] = (cats[e.label] || 0) + e.amount;
        }
      });
    });
    state.cardPurchases.forEach(function(p){ if(p.date >= from && p.date <= to){ var c = p.category || 'Cartão'; cats[c] = (cats[c] || 0) + p.amount; } });
    state.debts.forEach(function(d){
      if(d.kind !== 'receivable') return;
      (d.payments || []).forEach(function(p){ if(p.date >= from && p.date <= to) rec[d.name] = (rec[d.name] || 0) + p.amount; });
    });
    var next = {count: 0, in: 0, out: 0}, lim = addDaysISO(to, 7);
    weekSources.forEach(function(src){ (src(lim) || []).forEach(function(it){ if(it.date > to){ next.count++; next[it.dir] += it.amount; } }); });
    return {
      from: from, to: to, in: round2(inc), out: round2(out),
      topCats: Object.keys(cats).map(function(k){ return {name: k, amount: round2(cats[k])}; }).sort(function(a, b){ return b.amount - a.amount; }).slice(0, 3),
      received: Object.keys(rec).map(function(k){ return {name: k, amount: round2(rec[k])}; }).sort(function(a, b){ return b.amount - a.amount; }),
      late: lateReceivables().map(function(p){ return {name: p.name, amount: p.overdue}; }).slice(0, 8),
      next: {count: next.count, in: round2(next.in), out: round2(next.out)},
      goals: state.goals.map(function(g){ return {name: g.name, pct: Math.floor(goalInfo(g).pct)}; })
    };
  }

  // ---------- histórico de alterações (fica no aparelho, IndexedDB) ----------
  var HIST_MAX = 120, histLast = null, histTimer = 0, histLabel = '', histLabelAt = 0, histDbP = null;
  function histDB(){
    if(!histDbP) histDbP = new Promise(function(res, rej){
      try{
        var rq = indexedDB.open('barnabank_history', 1);
        rq.onupgradeneeded = function(){ rq.result.createObjectStore('h', {keyPath: 'id'}); };
        rq.onsuccess = function(){ res(rq.result); };
        rq.onerror = function(){ rej(rq.error); };
      }catch(e){ rej(e); }
    });
    return histDbP;
  }
  function histAll(){
    return histDB().then(function(db){
      return new Promise(function(res){
        var out = [], rq = db.transaction('h').objectStore('h').openCursor(null, 'prev');
        rq.onsuccess = function(){ var c = rq.result; if(c){ out.push(c.value); c.continue(); } else res(out); };
        rq.onerror = function(){ res(out); };
      });
    }).catch(function(){ return []; });
  }
  function histPut(rec){
    return histDB().then(function(db){
      return new Promise(function(res){
        var tx = db.transaction('h', 'readwrite'), st = tx.objectStore('h');
        st.put(rec);
        var rq = st.getAllKeys();
        rq.onsuccess = function(){ var keys = rq.result || []; if(keys.length > HIST_MAX) keys.slice(0, keys.length - HIST_MAX).forEach(function(k){ st.delete(k); }); };
        tx.oncomplete = function(){ res(true); };
        tx.onerror = function(){ res(false); };
      });
    }).catch(function(){ return false; });
  }
  function histNote(label){ histLabel = String(label || ''); histLabelAt = Date.now(); }
  function histSchedule(){
    clearTimeout(histTimer);
    histTimer = setTimeout(histCheckpoint, 900);
  }
  function histCheckpoint(){
    var cur = lsGet(STORAGE_KEY);
    if(!cur) return;
    if(histLast === null){ histLast = cur; return; }
    if(cur === histLast) return;
    var label = '';
    if(Date.now() - histLabelAt < 6000 && histLabel) label = histLabel;
    else { try{ label = describeChange(JSON.parse(histLast), JSON.parse(cur)); }catch(e){} }
    histLabel = '';
    histPut({id: Date.now(), at: new Date().toISOString(), label: label || 'Ajustes', before: histLast});
    histLast = cur;
  }
  function describeChange(a, b){
    var out = [];
    function byId(arr){ var m = {}; (arr || []).forEach(function(x){ if(x && x.id) m[x.id] = x; }); return m; }
    function diff(key, name, fmtNew, fmtDel, fmtEdit){
      var A = byId(a[key]), B = byId(b[key]);
      Object.keys(B).forEach(function(k){ if(!A[k]) out.push(fmtNew(B[k])); else if(fmtEdit && JSON.stringify(A[k]) !== JSON.stringify(B[k])) { var t = fmtEdit(A[k], B[k]); if(t) out.push(t); } });
      Object.keys(A).forEach(function(k){ if(!B[k]) out.push(fmtDel(A[k])); });
    }
    diff('debts', 'dívida', function(d){ return 'Nova dívida: ' + d.name + ' ' + money.format(d.principal); }, function(d){ return 'Dívida excluída: ' + d.name; }, function(x, y){
      var pa = (x.payments || []).length, pb = (y.payments || []).length;
      if(pb > pa){ var p = y.payments[pb - 1]; return 'Pagamento de ' + y.name + ' ' + money.format(p.amount); }
      if(pb < pa) return 'Pagamento removido de ' + y.name;
      return 'Dívida editada: ' + y.name;
    });
    diff('transactions', 'lançamento', function(t){ return (t.type === 'entrada' ? 'Entrada' : t.type === 'gasto' ? 'Gasto' : 'Transferência') + ' ' + money.format(t.amount) + (t.category ? ' · ' + t.category : ''); },
      function(t){ return 'Lançamento excluído: ' + (t.category || '') + ' ' + money.format(t.amount); }, function(x, y){ return 'Lançamento editado: ' + (y.category || '') + ' ' + money.format(y.amount); });
    diff('wallets', 'carteira', function(w){ return 'Nova carteira: ' + w.name; }, function(w){ return 'Carteira excluída: ' + w.name; }, function(x, y){ return 'Carteira editada: ' + y.name; });
    diff('groups', 'grupo', function(g){ return 'Novo grupo: ' + g.title; }, function(g){ return 'Grupo excluído: ' + g.title; }, function(x, y){ return 'Grupo editado: ' + y.title; });
    diff('bills', 'conta', function(x){ return 'Nova conta fixa: ' + x.name; }, function(x){ return 'Conta fixa excluída: ' + x.name; }, function(x, y){ return JSON.stringify(x.paid) !== JSON.stringify(y.paid) ? 'Conta ' + y.name + ' marcada' : 'Conta fixa editada: ' + y.name; });
    diff('cards', 'cartão', function(x){ return 'Novo cartão: ' + x.name; }, function(x){ return 'Cartão excluído: ' + x.name; }, function(x, y){ return 'Cartão editado: ' + y.name; });
    diff('cardPurchases', 'compra', function(x){ return 'Compra no cartão: ' + x.desc + ' ' + money.format(x.amount); }, function(x){ return 'Compra excluída: ' + x.desc; }, function(x, y){ return 'Compra editada: ' + y.desc; });
    diff('cardPayments', 'fatura', function(x){ return 'Fatura paga ' + money.format(x.amount); }, function(x){ return 'Pagamento de fatura desfeito'; });
    diff('goals', 'meta', function(x){ return 'Nova meta: ' + x.name; }, function(x){ return 'Meta excluída: ' + x.name; }, function(x, y){ return (y.adds || []).length !== (x.adds || []).length ? 'Meta ' + y.name + ': valor guardado/retirado' : 'Meta editada: ' + y.name; });
    diff('recurring', 'recorrente', function(x){ return 'Novo recorrente: ' + (x.note || x.category); }, function(x){ return 'Recorrente excluído: ' + (x.note || x.category); });
    if(!out.length){
      if(JSON.stringify(a.budgets) !== JSON.stringify(b.budgets)) out.push('Orçamento alterado');
      else if(JSON.stringify(a.contacts) !== JSON.stringify(b.contacts)) out.push('Contato alterado');
      else if(JSON.stringify(a.shares) !== JSON.stringify(b.shares)) out.push('Link de cobrança');
    }
    if(!out.length) return 'Ajustes';
    return out.slice(0, 2).join(' · ') + (out.length > 2 ? ' (+' + (out.length - 2) + ')' : '');
  }
  function openHistory(){
    histCheckpoint();
    histAll().then(function(list){
      if(!list.length){ appAlert('Histórico de alterações', '<p class="warn">Ainda não tem nada aqui. A partir de agora, cada mudança no app fica registrada neste aparelho e dá pra voltar atrás.</p>', 'clock'); return; }
      var byDay = {}, days = [];
      list.forEach(function(r){ var d = r.at.slice(0, 10); if(!byDay[d]){ byDay[d] = []; days.push(d); } byDay[d].push(r); });
      var html = '<p class="warn">Toque em uma alteração para voltar o app para <b>como estava antes dela</b>. Fica salvo neste aparelho (últimas ' + HIST_MAX + ').</p><div class="hist-list">' +
        days.map(function(d){
          return '<div class="hist-day">' + (d === todayISO() ? 'Hoje' : d === addDaysISO(todayISO(), -1) ? 'Ontem' : fmtDate(d)) + '</div>' +
            byDay[d].map(function(r){
              return '<button type="button" class="hist-row" data-h="' + r.id + '"><span class="hr-time">' + new Date(r.at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) + '</span>' +
                '<span class="hr-lbl">' + escapeHtml(r.label) + '</span>' + ic('undo-2') + '</button>';
            }).join('');
        }).join('') + '</div>';
      openDialog({title: 'Histórico de alterações', icon: 'clock', alert: true, okText: 'Fechar', html: html});
      document.querySelector('#adBody .hist-list').addEventListener('click', function(e){
        var b = e.target.closest('[data-h]');
        if(!b) return;
        var r = list.find(function(x){ return String(x.id) === b.getAttribute('data-h'); });
        if(!r) return;
        appConfirm('Voltar no tempo?', '<p class="warn">O app volta para como estava <b>antes de: ' + escapeHtml(r.label) + '</b> (' + fmtDate(r.at.slice(0, 10)) + ' às ' + new Date(r.at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) + ').</p><p class="warn">Tudo que você mudou depois disso também volta. Essa volta fica no histórico, então dá pra desfazer.</p>', {okText: 'Voltar', icon: 'undo-2'})
          .then(function(ok){
            if(!ok) return;
            var snap;
            try{ snap = JSON.parse(r.before); }catch(e){ showToast('Esse ponto do histórico está corrompido.', 'triangle-alert'); return; }
            histNote('Voltou para antes de: ' + r.label);
            restoreFromCloud(snap, 'Voltou para antes de: ' + r.label);
          });
      });
    });
  }
  document.getElementById('btnHistory').addEventListener('click', function(){ closeSettings(); openHistory(); });
  document.getElementById('btnHistory2').addEventListener('click', openHistory);

  // ---------- importar extrato do banco (OFX / CSV) ----------
  var CAT_RULES = [
    [/ifood|rappi|restaur|lanchon|padaria|pizz|burger|mcdonald|bk |subway|cafe|bar /, 'Alimentação'],
    [/mercado|supermerc|atacad|carrefour|assai|pao de acucar|extra |hortifr|sacolao|dia brasil/, 'Mercado'],
    [/uber|99 ?(pop|app|taxi)?|cabify|posto|shell|ipiranga|petrobras|combust|estacion|pedagio|sem parar|veloe|metro|bilhete/, 'Transporte'],
    [/netflix|spotify|disney|prime video|amazon prime|youtube|hbo|max |deezer|apple\.com|google one|icloud|globoplay|paramount/, 'Assinaturas'],
    [/farmac|drogasil|droga raia|drogaria|pague menos|panvel/, 'Saúde'],
    [/aluguel|condominio|energia|enel|light|cemig|copel|sabesp|agua|gas |claro|vivo|tim |oi |internet|net virtua/, 'Moradia'],
    [/amazon|mercado ?livre|shopee|aliexpress|magalu|magazine|americanas|shein|casas bahia/, 'Compras'],
    [/salario|folha|pagto salario|provento/, 'Salário'],
    [/rendimento|juros|cdb|tesouro|invest/, 'Investimentos'],
    [/pagamento de fatura|pgto fatura|fatura cartao/, 'Cartão de crédito']
  ];
  function ruleKey(desc){ return normTxt(desc).replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).filter(function(w){ return w.length > 2 && !/^(pix|compra|debito|credito|transf|transferencia|enviado|recebido|pagamento|para|com|de|do|da)$/.test(w); }).slice(0, 2).join(' '); }
  function guessCategory(desc, isIn){
    var k = ruleKey(desc);
    if(k && state.catRules[k]) return state.catRules[k];
    var n = ' ' + normTxt(desc) + ' ';
    for(var i = 0; i < CAT_RULES.length; i++){ if(CAT_RULES[i][0].test(n)) return CAT_RULES[i][1]; }
    if(isIn && /pix|transf|ted|doc/.test(n)) return 'Transferências';
    return isIn ? 'Entrada' : 'Outros';
  }
  function decodeText(buf){
    var t = new TextDecoder('utf-8').decode(buf);
    if(t.indexOf('�') !== -1){ try{ t = new TextDecoder('windows-1252').decode(buf); }catch(e){} }
    return t.replace(/^﻿/, '');
  }
  function parseOFX(t){
    var out = [], parts = t.split(/<STMTTRN>/i).slice(1);
    function tag(b, n){ var r = new RegExp('<' + n + '>([^<\\r\\n]*)', 'i').exec(b); return r ? r[1].trim() : ''; }
    parts.forEach(function(b){
      b = b.split(/<\/STMTTRN>/i)[0];
      var dt = tag(b, 'DTPOSTED'), amt = parseFloat(tag(b, 'TRNAMT').replace(',', '.'));
      if(!/^\d{8}/.test(dt) || isNaN(amt)) return;
      out.push({date: dt.slice(0, 4) + '-' + dt.slice(4, 6) + '-' + dt.slice(6, 8), amount: amt, desc: tag(b, 'MEMO') || tag(b, 'NAME') || tag(b, 'TRNTYPE'), fid: tag(b, 'FITID')});
    });
    return out;
  }
  function splitCSV(line, d){
    var out = [], cur = '', q = false;
    for(var i = 0; i < line.length; i++){
      var c = line[i];
      if(q){ if(c === '"'){ if(line[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
      else if(c === '"') q = true;
      else if(c === d){ out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  function parseAmt(s){
    s = String(s || '').replace(/[R$\s ]/g, '');
    if(!s) return NaN;
    var neg = /^-|^\(.*\)$|-$/.test(s);
    s = s.replace(/[()+\-]/g, '');
    if(/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    var v = parseFloat(s);
    return isNaN(v) ? NaN : (neg ? -v : v);
  }
  function parseDateAny(s){
    s = String(s || '').trim();
    var m;
    if((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s))){ var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + pad2(+m[2]) + '-' + pad2(+m[1]); }
    return '';
  }
  function parseCSVStatement(t){
    var lines = t.split(/\r?\n/).filter(function(l){ return l.trim(); });
    var hi = -1, d = ',', cols = null;
    for(var i = 0; i < Math.min(lines.length, 20); i++){
      var dd = lines[i].split(';').length > lines[i].split(',').length ? ';' : ',';
      var c = splitCSV(lines[i], dd).map(normTxt);
      if(c.some(function(x){ return /^(data|date)/.test(x); }) && c.some(function(x){ return /^(valor|amount|quantia)/.test(x); })){ hi = i; d = dd; cols = c; break; }
    }
    if(hi === -1) return null;
    var iDate = cols.findIndex(function(x){ return /^(data|date)/.test(x); });
    var iVal = cols.findIndex(function(x){ return /^(valor|amount|quantia)/.test(x); });
    var iDesc = [];
    cols.forEach(function(x, i){ if(i !== iDate && /(descri|histor|title|memo|estabelec|lancamento$|detalhe)/.test(x)) iDesc.push(i); });
    var iId = cols.findIndex(function(x){ return /^(identificador|id)$/.test(x); });
    var cardLike = cols.indexOf('title') !== -1 && cols.indexOf('amount') !== -1;
    var out = [];
    lines.slice(hi + 1).forEach(function(l){
      var c = splitCSV(l, d);
      var date = parseDateAny(c[iDate]), amt = parseAmt(c[iVal]);
      if(!date || isNaN(amt) || amt === 0) return;
      out.push({date: date, amount: amt, desc: iDesc.map(function(i){ return c[i]; }).filter(Boolean).join(' · ') || 'Lançamento', fid: iId !== -1 ? c[iId] : ''});
    });
    return {rows: out, cardLike: cardLike};
  }
  function hashStr(s){ var h = 5381; for(var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  var stmtInput = document.getElementById('stmtFile');
  document.getElementById('btnImportStatement').addEventListener('click', function(){
    if(!state.wallets.length && !state.cards.length){ showToast('Crie uma carteira (ou um cartão) primeiro.', 'wallet'); return; }
    stmtInput.value = ''; stmtInput.click();
  });
  stmtInput.addEventListener('change', function(){
    var f = stmtInput.files && stmtInput.files[0];
    if(!f) return;
    f.arrayBuffer().then(function(buf){
      var t = decodeText(buf), rows, cardLike = false;
      if(/<OFX>|OFXHEADER/i.test(t)) rows = parseOFX(t);
      else { var r = parseCSVStatement(t); rows = r ? r.rows : null; cardLike = r ? r.cardLike : false; }
      if(!rows || !rows.length){ appAlert('Não consegui ler esse arquivo', '<p class="warn">Funciona com extrato em <b>.ofx</b> (o mais garantido) ou <b>.csv</b> que tenha colunas de data e valor. No app do banco, procure "Exportar extrato".</p>', 'file-text'); return; }
      importPreview(f.name, rows, cardLike);
    });
  });
  function importPreview(fname, rows, cardLike){
    var known = {};
    state.transactions.forEach(function(t){ if(t.imp) known[t.imp] = true; });
    state.cardPurchases.forEach(function(p){ if(p.imp) known[p.imp] = true; });
    rows.sort(function(a, b){ return a.date < b.date ? 1 : -1; });
    var items = rows.slice(0, 400).map(function(r, i){
      var imp = r.fid ? 'f:' + r.fid : 'h:' + hashStr(r.date + '|' + r.amount + '|' + r.desc);
      return {i: i, date: r.date, raw: r.amount, desc: r.desc, imp: imp, dupe: !!known[imp]};
    });
    var targets = state.wallets.map(function(w){ return '<option value="w:' + escapeHtml(w.id) + '">Carteira ' + escapeHtml(walletLabel(w)) + '</option>'; })
      .concat(state.cards.map(function(c){ return '<option value="c:' + escapeHtml(c.id) + '"' + (cardLike ? ' selected' : '') + '>Cartão ' + escapeHtml(c.name) + ' (vira compra no cartão)</option>'; })).join('');
    var cats = knownExpenseCats();
    state.transactions.forEach(function(t){ if(t.type === 'entrada' && t.category && cats.indexOf(t.category) === -1) cats.push(t.category); });
    CAT_RULES.forEach(function(r){ if(cats.indexOf(r[1]) === -1) cats.push(r[1]); });
    openDialog({
      title: 'Importar extrato', icon: 'upload', okText: 'Importar',
      html: '<p class="warn"><b>' + escapeHtml(fname) + '</b> · ' + rows.length + ' lançamento(s)' + (rows.length > 400 ? ' (mostrando os 400 mais recentes)' : '') + '. Confira as categorias; o app aprende com as suas correções.</p>' +
        '<div class="field-row"><div class="field"><label for="imTarget">Para onde</label><select id="imTarget" class="select" style="width:100%;">' + targets + '</select></div></div>' +
        '<label class="check-row"><input type="checkbox" id="imFlip"' + (cardLike ? ' checked' : '') + '> Inverter sinais (marque se os gastos aparecerem como entradas)</label>' +
        '<div class="im-bar"><label class="check-row" style="margin:0;"><input type="checkbox" id="imAll" checked> Todos</label><span id="imCount"></span></div>' +
        '<div class="im-list" id="imList"></div><datalist id="imCats">' + cats.map(function(c){ return '<option value="' + escapeHtml(c) + '">'; }).join('') + '</datalist>',
      onOk: function(body){
        var tgt = body.querySelector('#imTarget').value, flip = body.querySelector('#imFlip').checked;
        var isCard = tgt.indexOf('c:') === 0, id = tgt.slice(2);
        var added = {tx: [], cp: []}, learned = 0;
        body.querySelectorAll('.im-row').forEach(function(row){
          var it = items[+row.getAttribute('data-i')];
          if(!row.querySelector('input[type=checkbox]').checked) return;
          var amt = flip ? -it.raw : it.raw, cat = row.querySelector('.im-cat').value.trim() || (amt < 0 ? 'Outros' : 'Entrada');
          if(cat !== it.guess){ var k = ruleKey(it.desc); if(k){ state.catRules[k] = cat; learned++; } }
          if(isCard){
            if(amt >= 0) return;
            var p = {id: uid('p-'), cardId: id, desc: it.desc.slice(0, 50), amount: round2(-amt), installments: 1, date: it.date, category: cat, imp: it.imp};
            state.cardPurchases.push(p); added.cp.push(p.id);
          } else {
            var t = {id: uid(), walletId: id, type: amt < 0 ? 'gasto' : 'entrada', amount: round2(Math.abs(amt)), date: it.date, category: cat, note: it.desc.slice(0, 80), imp: it.imp};
            state.transactions.push(t); added.tx.push(t.id);
          }
        });
        var n = added.tx.length + added.cp.length;
        if(!n) return 'Nenhum lançamento marcado.';
        renderAll(); saveData();
        showUndo(n + ' lançamento(s) importado(s)' + (learned ? ' · aprendi ' + learned + ' categoria(s)' : ''), function(){
          state.transactions = state.transactions.filter(function(t){ return added.tx.indexOf(t.id) === -1; });
          state.cardPurchases = state.cardPurchases.filter(function(p){ return added.cp.indexOf(p.id) === -1; });
          renderAll(); saveData();
        }, 'Importação desfeita', 'upload');
        return true;
      }
    });
    var list = document.getElementById('imList'), flipEl = document.getElementById('imFlip'), tgtEl = document.getElementById('imTarget');
    function draw(){
      var flip = flipEl.checked, isCard = tgtEl.value.indexOf('c:') === 0;
      var walletId = tgtEl.value.slice(2);
      list.innerHTML = items.map(function(it){
        var amt = flip ? -it.raw : it.raw;
        it.guess = guessCategory(it.desc, amt > 0);
        var sameDay = !isCard && state.transactions.some(function(t){ return t.walletId === walletId && t.date === it.date && Math.abs(t.amount - Math.abs(amt)) < 0.005 && !t.imp; });
        var skip = it.dupe || (isCard && amt >= 0);
        var why = it.dupe ? 'já importado' : (isCard && amt >= 0) ? 'pagamento/estorno: não entra como compra' : sameDay ? 'parece repetido' : '';
        return '<div class="im-row' + (skip ? ' skip' : '') + '" data-i="' + it.i + '"><input type="checkbox"' + (skip || sameDay ? '' : ' checked') + (skip ? ' disabled' : '') + ' aria-label="Importar">' +
          '<div class="im-main"><b>' + escapeHtml(it.desc) + '</b><small>' + fmtDate(it.date) + (why ? ' · ' + why : '') + '</small></div>' +
          '<span class="im-amt ' + (amt < 0 ? 'out' : 'in') + '">' + (amt < 0 ? '−' : '+') + money.format(Math.abs(amt)) + '</span>' +
          '<input class="im-cat" list="imCats" value="' + escapeHtml(it.guess) + '"' + (skip ? ' disabled' : '') + ' aria-label="Categoria"></div>';
      }).join('');
      count();
    }
    function count(){
      var n = list.querySelectorAll('.im-row input[type=checkbox]:checked').length;
      document.getElementById('imCount').textContent = n + ' de ' + items.length + ' marcados';
      var ok = document.querySelector('#adActions [data-ad="ok"]'); if(ok) ok.textContent = 'Importar ' + n;
    }
    flipEl.addEventListener('change', draw);
    tgtEl.addEventListener('change', draw);
    list.addEventListener('change', function(e){ if(e.target.type === 'checkbox') count(); });
    document.getElementById('imAll').addEventListener('change', function(e){
      list.querySelectorAll('.im-row:not(.skip) input[type=checkbox]').forEach(function(c){ c.checked = e.target.checked; });
      count();
    });
    draw();
  }

  // ---------- "cabe no mês?" (simular compra) ----------
  function monthPlan(key){
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1, inn = 0, out = 0;
    state.debts.forEach(function(d){ if(isPaid(d)) return; var v = openInMonth(d, y, m); if(d.kind === 'payable') out += v; else inn += v; });
    state.bills.forEach(function(b){ if(!billApplies(b, key) || billStatus(b, key).st === 'paga') return; if(b.kind === 'entrada') inn += b.amount; else out += b.amount; });
    state.cards.forEach(function(card){
      var all = cardInvoices(card);
      [ymAdd(key, -1), key].forEach(function(k){ var it = all.get(k); if(ymOf(it.due) === key && it.balance > EPS && !it.rolled) out += it.balance; });
    });
    state.recurring.forEach(function(r){
      if(r.active === false || (r.posted && r.posted[key]) || !r.start || r.start > key || (r.end && r.end < key)) return;
      if(r.type === 'entrada') inn += r.amount; else out += r.amount;
    });
    var avg = 0, n = 0, now = ymOf(todayISO());
    for(var i = 1; i <= 3; i++){ var sp = monthSpending(ymAdd(now, -i)); if(sp.total > 0){ avg += sp.other; n++; } }
    out += n ? avg / n : 0;
    return {in: inn, out: out};
  }
  function simulatePurchase(amount, n, method){
    var nowKey = ymOf(todayISO()), parcel = splitEqual(amount, n), firstKey = nowKey, card = null;
    if(method.indexOf('c:') === 0){
      card = state.cards.find(function(c){ return c.id === method.slice(2); });
      if(card) firstKey = ymOf(invoiceDates(card, invoiceKeyFor(card, todayISO())).due);
    }
    var horizon = Math.max(3, Math.min(12, ymDiff(firstKey, nowKey) + n + 1));
    var rows = [], base = monthForecast().end, extra = 0, minWith = Infinity, minKey = null;
    for(var i = 0; i < horizon; i++){
      var key = ymAdd(nowKey, i);
      if(i > 0){ var pl = monthPlan(key); base = round2(base + pl.in - pl.out); }
      var idx = ymDiff(key, firstKey), cost = idx >= 0 && idx < n ? parcel[idx] : 0;
      extra = round2(extra + cost);
      var withP = round2(base - extra);
      if(withP < minWith){ minWith = withP; minKey = key; }
      rows.push({key: key, without: base, cost: cost, with: withP});
    }
    var avgOut = monthPlan(ymAdd(nowKey, 1)).out, margin = Math.max(200, avgOut * 0.1);
    var verdict = minWith >= margin ? 'ok' : minWith >= 0 ? 'tight' : 'no';
    var limitMsg = '';
    if(card && card.limit > 0){ var avail = round2(card.limit - cardUsed(card)); if(amount > avail) { limitMsg = 'Passa do limite do ' + card.name + ': disponível ' + money.format(Math.max(0, avail)) + '.'; verdict = 'no'; } }
    return {rows: rows, verdict: verdict, minWith: minWith, minKey: minKey, limitMsg: limitMsg, parcel: parcel[0], firstKey: firstKey, card: card};
  }
  function fitsDialog(){
    if(!state.wallets.length){ showToast('Crie uma carteira primeiro: a conta usa o seu saldo.', 'wallet'); return; }
    var opts = state.cards.map(function(c){ return '<option value="c:' + escapeHtml(c.id) + '">Cartão ' + escapeHtml(c.name) + '</option>'; })
      .concat(state.wallets.map(function(w){ return '<option value="w:' + escapeHtml(w.id) + '">À vista / PIX · ' + escapeHtml(walletLabel(w)) + '</option>'; })).join('');
    openDialog({
      title: 'Cabe no meu mês?', icon: 'scale', okText: 'Registrar a compra', cancelText: 'Fechar',
      html: '<div class="field"><label for="fiDesc">O que é</label><input id="fiDesc" type="text" maxlength="50" placeholder="Ex: Celular novo"></div>' +
        '<div class="field-row"><div class="field"><label for="fiAmount">Valor total (R$)</label><input id="fiAmount" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>' +
        '<div class="field"><label for="fiN">Parcelas</label><input id="fiN" type="number" min="1" max="24" value="1"></div></div>' +
        '<div class="field"><label for="fiHow">Como vai pagar</label><select id="fiHow" class="select" style="width:100%;">' + opts + '</select></div>' +
        '<div id="fiOut" class="fi-out"><div class="wk-empty">Digite o valor para ver.</div></div>',
      onOk: function(body){
        var v = moneyVal(body.querySelector('#fiAmount')), n = parseInt(body.querySelector('#fiN').value, 10) || 1, how = body.querySelector('#fiHow').value;
        var desc = body.querySelector('#fiDesc').value.trim() || 'Compra';
        if(!(v > 0)) return 'Informe o valor.';
        if(how.indexOf('c:') === 0){
          state.cardPurchases.push({id: uid('p-'), cardId: how.slice(2), desc: desc, amount: round2(v), installments: Math.max(1, Math.min(24, n)), date: todayISO(), category: ''});
        } else {
          state.transactions.push({id: uid(), walletId: how.slice(2), type: 'gasto', amount: round2(v), date: todayISO(), category: 'Compras', note: desc});
        }
        renderAll(); saveData(); showToast('Compra registrada: ' + desc, 'shopping-bag');
        return true;
      }
    });
    var out = document.getElementById('fiOut');
    function upd(){
      var v = moneyVal(document.getElementById('fiAmount')), n = Math.max(1, Math.min(24, parseInt(document.getElementById('fiN').value, 10) || 1));
      var how = document.getElementById('fiHow').value;
      if(!(v > 0)){ out.innerHTML = '<div class="wk-empty">Digite o valor para ver.</div>'; return; }
      var r = simulatePurchase(v, n, how);
      var V = {ok: ['ok', 'circle-check', 'Cabe!'], tight: ['tight', 'circle-alert', 'Cabe, mas fica apertado'], no: ['no', 'x', 'Não cabe']}[r.verdict];
      var why = r.limitMsg || (r.verdict === 'ok' ? 'Pior mês: sobra ' + money.format(r.minWith) + ' em ' + ymShort(r.minKey) + '.'
        : r.verdict === 'tight' ? 'Em ' + ymShort(r.minKey) + ' sobra só ' + money.format(r.minWith) + '.'
        : 'Em ' + ymShort(r.minKey) + ' faltariam ' + money.format(-r.minWith) + '.');
      out.innerHTML = '<div class="fi-verdict ' + V[0] + '">' + ic(V[1]) + '<div><b>' + V[2] + '</b><span>' + (n > 1 ? n + 'x de ' + money.format(r.parcel) : money.format(v)) + (r.card ? ', 1ª parcela na fatura de ' + ymShort(r.firstKey) : '') + ' · ' + escapeHtml(why) + '</span></div></div>' +
        '<div class="fi-table"><div class="fi-h"><span>Mês</span><span>Sem a compra</span><span>Com a compra</span></div>' +
        r.rows.map(function(x){
          return '<div class="fi-r' + (x.cost ? ' has' : '') + '"><span>' + ymShort(x.key) + (x.cost ? ' <small>−' + money.format(x.cost) + '</small>' : '') + '</span><span class="' + (x.without < 0 ? 'neg' : '') + '">' + money.format(x.without) + '</span><span class="' + (x.with < 0 ? 'neg' : x.with < 200 ? 'warnc' : 'pos') + '">' + money.format(x.with) + '</span></div>';
        }).join('') + '</div>' +
        '<p class="cat-note">' + ic('info') + '<span>Saldo previsto no fim de cada mês: carteiras + o que vai receber − contas, faturas, dívidas, recorrentes e a média dos seus gastos do dia a dia.</span></p>';
    }
    ['fiAmount', 'fiN', 'fiHow'].forEach(function(id){ document.getElementById(id).addEventListener('input', upd); document.getElementById(id).addEventListener('change', upd); });
  }
  document.getElementById('btnFits').addEventListener('click', fitsDialog);
  document.getElementById('dashForecast').addEventListener('click', function(e){ if(e.target.closest('[data-fits]')) fitsDialog(); });

  // a linha de base vem depois da primeira renderização (que pode ajustar dados antigos)
  setTimeout(function(){ histLast = lsGet(STORAGE_KEY); }, 0);

  // =====================================================================
  // v8: PIX nos links, "já paguei", quem abriu o link, perguntas (dados p/ bot),
  //     comparar meses, gastos fora do padrão, placar e dividir conta
  // =====================================================================

  // ---------- chave PIX no formato do BR Code ----------
  function pixKeyFor(raw, type){
    raw = String(raw || '').trim();
    if(!raw) return '';
    var d = onlyDigits(raw);
    type = type || 'auto';
    if(type === 'auto'){
      if(raw.indexOf('@') !== -1) type = 'email';
      else if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) type = 'evp';
      else if(/^\+/.test(raw)) type = 'phone';
      else if(d.length === 14) type = 'cnpj';
      else if(d.length === 11 && /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(raw) && !/^\(?\d{2}\)?\s?9/.test(raw.replace(/\./g, ''))) type = 'cpf';
      else if(d.length === 11 && /^\(?\d{2}\)?\s?9/.test(raw)) type = /[()\s]/.test(raw) ? 'phone' : 'cpf';
      else if(d.length === 10 || (d.length === 12 || d.length === 13) && /^55/.test(d)) type = 'phone';
      else type = d.length === 11 ? 'cpf' : 'evp';
    }
    if(type === 'email') return raw.toLowerCase();
    if(type === 'evp') return raw.toLowerCase();
    if(type === 'cpf' || type === 'cnpj') return d;
    if(type === 'phone') return '+' + (/^55/.test(d) && d.length >= 12 ? d : '55' + d);
    return raw;
  }
  function pixTypeLabel(raw, type){
    var k = pixKeyFor(raw, type);
    if(!k) return '';
    if(k.indexOf('@') !== -1) return 'e-mail';
    if(/^\+/.test(k)) return 'celular ' + k;
    if(/^\d{11}$/.test(k)) return 'CPF';
    if(/^\d{14}$/.test(k)) return 'CNPJ';
    return 'chave aleatória';
  }
  function decorateShare(v, sh){
    if(!v) return v;
    v.pixInfo = settings.pixKey ? {key: pixKeyFor(settings.pixKey, settings.pixType), name: settings.ownerName || 'BarnaBank', city: settings.ownerCity || 'BRASIL'} : null;
    if(sh.type === 'group'){
      var g = groupById(sh.ref), st = g ? groupStats(g) : null;
      v._ref = {type: 'group', members: st ? st.members.map(function(d){ return {name: d.name, debtId: d.id}; }) : []};
    } else {
      var ds = sh.type === 'debt' ? state.debts.filter(function(d){ return d.id === sh.ref; }) : state.debts.filter(function(d){ return nameKey(d.name) === sh.ref && d.kind === 'receivable' && !isPaid(d); });
      v._ref = {type: sh.type, name: ds[0] ? ds[0].name : '', debtId: sh.type === 'debt' ? sh.ref : null};
      var soon = ds.filter(function(d){ return !isPaid(d); }).sort(function(a, b){ var x = nextDueDate(a), y = nextDueDate(b); return (x ? x.getTime() : 0) - (y ? y.getTime() : 0); })[0];
      v.suggest = v.late > EPS ? v.late : (soon ? round2(amountDueNow(soon)) : v.remaining);
      if(soon){ var nd = nextDueDate(soon); v.nextDue = nd ? toISO(nd) : ''; }
    }
    return v;
  }

  // ---------- pedidos "já paguei" vindos dos links ----------
  var cloudExtra = {claims: [], views: {}};
  function renderClaims(){
    ['claimsDash', 'claimsPessoas'].forEach(function(id){
      var el = document.getElementById(id);
      if(!el) return;
      var cl = cloudExtra.claims || [];
      if(!cl.length){ el.innerHTML = ''; return; }
      var nPay = cl.filter(function(c){ return c.kind !== 'prazo'; }).length, nPrazo = cl.length - nPay;
      var head = nPay && nPrazo ? cl.length + ' pedidos pelos links' : nPrazo ? (nPrazo === 1 ? 'Pediram mais prazo' : nPrazo + ' pedidos de prazo') : (nPay === 1 ? 'Alguém disse que pagou' : nPay + ' pessoas disseram que pagaram');
      el.innerHTML = '<div class="claim-box"><div class="cb-h">' + ic(nPay ? 'hand-coins' : 'calendar-clock') + '<b>' + head + '</b><span>' + (nPay ? 'confira no banco' : 'você decide') + '</span></div>' +
        cl.map(function(c){
          if(c.kind === 'prazo') return '<div class="claim-row prazo" data-claim="' + escapeHtml(c.id) + '"><div class="cr-info"><b>' + escapeHtml(c.label) + ' pediu prazo até ' + fmtDate(c.newDate) + '</b><span>' + (c.amount ? money.format(c.amount) + (c.due ? ' que venc' + (c.due < todayISO() ? 'eu' : 'e') + ' em ' + fmtDate(c.due) : '') : '') + (c.note ? ' · “' + escapeHtml(c.note) + '”' : '') + '</span></div>' +
            '<div class="cr-acts"><button type="button" class="btn btn-ghost btn-sm" data-cl="no">Recusar</button><button type="button" class="btn btn-primary btn-sm" data-cl="ok">' + ic('check') + ' Aceitar</button></div></div>';
          return '<div class="claim-row" data-claim="' + escapeHtml(c.id) + '"><div class="cr-info"><b>' + escapeHtml(c.label) + ' · ' + money.format(c.amount) + '</b><span>' + fmtDate(c.at.slice(0, 10)) + (c.note ? ' · “' + escapeHtml(c.note) + '”' : '') + (c.hasPhoto ? '' : ' · sem comprovante') + '</span></div>' +
            '<div class="cr-acts">' + (c.hasPhoto ? '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-cl="photo" title="Ver comprovante" aria-label="Ver comprovante">' + ic('image') + '</button>' : '') +
            '<button type="button" class="btn btn-ghost btn-sm" data-cl="no">Não recebi</button><button type="button" class="btn btn-primary btn-sm" data-cl="ok">' + ic('check') + ' Recebi</button></div></div>';
        }).join('') + '</div>';
    });
  }
  function claimCall(id, path, body){
    return fetch(cloudUrl('/api/claim/' + id + (path || '')), {method: body ? 'POST' : 'GET', headers: {'Authorization': 'Bearer ' + cloudCfg.key, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined})
      .then(function(r){ if(!r.ok) throw new Error('Erro ' + r.status); return r.json(); });
  }
  function onClaimClick(e){
    var b = e.target.closest('[data-cl]');
    if(!b) return;
    var id = b.closest('[data-claim]').getAttribute('data-claim'), c = (cloudExtra.claims || []).find(function(x){ return x.id === id; });
    if(!c) return;
    var a = b.getAttribute('data-cl');
    if(a === 'photo'){
      claimCall(id, '/photo').then(function(j){
        appAlert('Comprovante · ' + c.label, '<img class="gi-prev rc-prev" alt="Comprovante" src="' + j.data + '"><p class="warn">' + money.format(c.amount) + ' informado em ' + fmtDate(c.at.slice(0, 10)) + '.</p>', 'image');
      }).catch(function(){ showToast('Não consegui abrir o comprovante.', 'triangle-alert'); });
      return;
    }
    function decide(ok){
      b.disabled = true;
      claimCall(id, '', {decision: ok ? 'ok' : 'no'}).then(function(){
        cloudExtra.claims = cloudExtra.claims.filter(function(x){ return x.id !== id; });
        renderClaims();
        if(c.kind === 'prazo'){
          if(ok){ showToast('Prazo de ' + c.label + ' remarcado para ' + fmtDate(c.newDate), 'calendar-clock'); cloudSync(); }
          else showToast('Pedido recusado. A pessoa vê isso no link.', 'x');
        } else if(ok){ showToast('Confirmado: ' + c.label + ' · ' + money.format(c.amount), 'check'); cloudSync(); }
        else showToast('Marcado como não recebido. A pessoa vê isso no link.', 'x');
      }).catch(function(err){ b.disabled = false; showToast('Nuvem: ' + err.message, 'triangle-alert'); });
    }
    if(a === 'ok') decide(true);
    else if(c.kind === 'prazo') appConfirm('Recusar o pedido?', '<p class="warn">O link de ' + escapeHtml(c.label) + ' vai mostrar que o novo prazo não foi aceito. Combine com a pessoa se quiser outra data.</p>', {okText: 'Recusar', danger: true, icon: 'x'}).then(function(ok){ if(ok) decide(false); });
    else appConfirm('Não recebeu?', '<p class="warn">O link de ' + escapeHtml(c.label) + ' vai mostrar que o pagamento de ' + money.format(c.amount) + ' não foi encontrado.</p>', {okText: 'Não recebi', danger: true, icon: 'x'}).then(function(ok){ if(ok) decide(false); });
  }
  document.getElementById('claimsDash').addEventListener('click', onClaimClick);
  document.getElementById('claimsPessoas').addEventListener('click', onClaimClick);
  function viewsText(token){
    var v = cloudExtra.views && cloudExtra.views[token];
    if(!v) return 'Ainda não foi aberto.';
    var at = new Date(v.last);
    return 'Aberto ' + v.count + (v.count === 1 ? ' vez' : ' vezes') + ' · último ' + relDay(v.last.slice(0, 10)) + ' às ' + at.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
  }

  // ---------- números para as perguntas do bot ----------
  function statsSummary(){
    var today = todayISO(), key = ymOf(today), prevKey = ymAdd(key, -1), weekFrom = addDaysISO(today, -6);
    function catsOf(sp){ var o = {}; Object.keys(sp.byCat).forEach(function(k){ o[sp.byCat[k].name] = round2(sp.byCat[k].amount); }); return o; }
    var spM = monthSpending(key), spP = monthSpending(prevKey);
    function rangeCats(from, to){
      var o = {};
      state.transactions.forEach(function(t){
        if(t.type !== 'gasto' || t.date < from || t.date > to || (t.auto && /^card:/.test(t.auto))) return;
        var c = t.category || 'Outros'; o[c] = round2((o[c] || 0) + t.amount);
      });
      state.cardPurchases.forEach(function(p){ if(p.date >= from && p.date <= to){ var c = p.category || 'Cartão de crédito'; o[c] = round2((o[c] || 0) + p.amount); } });
      return o;
    }
    function income(from, to){
      var s = 0;
      state.wallets.forEach(function(w){ walletEvents(w.id).forEach(function(e){ if(!e.isTransfer && e.kind === 'entrada' && e.date >= from && e.date <= to) s += e.amount; }); });
      return round2(s);
    }
    var sum = function(o){ return round2(Object.keys(o).reduce(function(s, k){ return s + o[k]; }, 0)); };
    var cw = rangeCats(weekFrom, today), ct = rangeCats(today, today);
    return {
      cats: {month: catsOf(spM), prev: catsOf(spP), week: cw, today: ct},
      out: {month: spM.total, prev: spP.total, week: sum(cw), today: sum(ct)},
      in: {month: income(key + '-01', key + '-31'), prev: income(prevKey + '-01', prevKey + '-31'), week: income(weekFrom, today), today: income(today, today)}
    };
  }
  function peopleStats(list){
    var key = ymOf(todayISO());
    list.forEach(function(p){
      var k = nameKey(p.name), paid = 0, paidM = 0;
      state.debts.forEach(function(d){ if(nameKey(d.name) !== k || d.kind !== 'receivable') return; (d.payments || []).forEach(function(x){ paid += x.amount; if(ymOf(x.date) === key) paidM += x.amount; }); });
      p.paid = round2(paid); p.paidMonth = round2(paidM);
    });
    return list;
  }

  // ---------- 13. comparar meses ----------
  function renderCompare(y, m){
    var el = document.getElementById('relCompare');
    if(!el) return;
    var key = y + '-' + pad2(m + 1), prev = ymAdd(key, -1);
    var a = monthSpending(key), b = monthSpending(prev);
    var names = {};
    Object.keys(a.byCat).forEach(function(k){ names[k] = a.byCat[k].name; });
    Object.keys(b.byCat).forEach(function(k){ names[k] = names[k] || b.byCat[k].name; });
    var rows = Object.keys(names).map(function(k){
      var cur = a.byCat[k] ? a.byCat[k].amount : 0, old = b.byCat[k] ? b.byCat[k].amount : 0;
      return {name: names[k], cur: cur, old: old, diff: round2(cur - old)};
    }).filter(function(r){ return Math.abs(r.diff) > EPS; }).sort(function(x, y2){ return Math.abs(y2.diff) - Math.abs(x.diff); });
    document.getElementById('relCompareSub').textContent = 'vs ' + MONTH_NAMES[+prev.slice(5, 7) - 1].toLowerCase();
    if(!rows.length){ el.innerHTML = '<div class="chart-empty">Nada para comparar com o mês anterior.</div>'; return; }
    var td = round2(a.total - b.total);
    el.innerHTML = '<div class="cmp-total ' + (td > 0 ? 'up' : 'down') + '">' + ic(td > 0 ? 'trending-up' : 'trending-down') + '<span>Você gastou <b>' + money.format(Math.abs(td)) + (td > 0 ? ' a mais' : ' a menos') + '</b> que em ' + MONTH_NAMES[+prev.slice(5, 7) - 1].toLowerCase() + ' (' + money.format(b.total) + ' → ' + money.format(a.total) + ').</span></div>' +
      rows.slice(0, 8).map(function(r){
        var pct = r.old > 0 ? Math.round(r.diff / r.old * 100) : null;
        return '<div class="cmp-row"><span class="cmp-n">' + escapeHtml(r.name) + '</span><span class="cmp-v">' + money.format(r.old) + ' → <b>' + money.format(r.cur) + '</b></span>' +
          '<span class="cmp-d ' + (r.diff > 0 ? 'up' : 'down') + '">' + (r.diff > 0 ? '+' : '−') + money.format(Math.abs(r.diff)) + (pct !== null ? ' <small>' + (r.diff > 0 ? '+' : '') + pct + '%</small>' : ' <small>novo</small>') + '</span></div>';
      }).join('') + (rows.length > 8 ? '<div class="cmp-more">+ ' + (rows.length - 8) + ' categorias com variação menor</div>' : '');
  }

  // ---------- 14. gastos fora do padrão ----------
  function spendingAlerts(){
    var key = ymOf(todayISO()), sp = monthSpending(key), hist = [1, 2, 3].map(function(i){ return monthSpending(ymAdd(key, -i)); });
    var have = hist.filter(function(h){ return h.total > 0; }).length;
    if(!have) return [];
    var out = [];
    Object.keys(sp.byCat).forEach(function(k){
      var cur = sp.byCat[k].amount, avg = hist.reduce(function(s, h){ return s + (h.byCat[k] ? h.byCat[k].amount : 0); }, 0) / have;
      if(avg > EPS && cur >= avg * 1.5 && cur - avg >= 50) out.push({key: k, name: sp.byCat[k].name, cur: round2(cur), avg: round2(avg), ratio: cur / avg});
      else if(avg <= EPS && cur >= 300 && have >= 2) out.push({key: k, name: sp.byCat[k].name, cur: round2(cur), avg: 0, ratio: 0});
    });
    return out.sort(function(a, b){ return (b.cur - b.avg) - (a.cur - a.avg); });
  }
  function alertText(a){
    return a.avg > 0 ? (a.ratio >= 1.95 ? Math.round(a.ratio * 10) / 10 + 'x' : '+' + Math.round((a.ratio - 1) * 100) + '%') + ' da sua média (' + money.format(a.avg) + ')' : 'gasto novo, sem histórico';
  }
  function renderAlerts(){
    var el = document.getElementById('dashAlerts');
    if(!el) return;
    var key = ymOf(todayISO()), hidden = {};
    try{ hidden = JSON.parse(lsGet('barnabank_alerts_hide') || '{}') || {}; }catch(e){}
    var list = spendingAlerts().filter(function(a){ return hidden[key + ':' + a.key] !== 1; });
    if(!list.length){ el.innerHTML = ''; return; }
    el.innerHTML = '<section class="alert-card"><div class="ac-h">' + ic('triangle-alert') + '<b>Gastos fora do padrão em ' + MONTH_NAMES[new Date().getMonth()].toLowerCase() + '</b></div>' +
      list.slice(0, 4).map(function(a){
        return '<div class="ac-row" data-al="' + escapeHtml(a.key) + '"><div><b>' + escapeHtml(a.name) + ': ' + money.format(a.cur) + '</b><span>' + alertText(a) + '</span></div><button type="button" class="btn btn-ghost btn-sm btn-icon" data-alx title="Já sei, esconder" aria-label="Esconder">' + ic('x') + '</button></div>';
      }).join('') + '</section>';
  }
  document.getElementById('dashAlerts').addEventListener('click', function(e){
    var x = e.target.closest('[data-alx]');
    if(x){
      var hidden = {};
      try{ hidden = JSON.parse(lsGet('barnabank_alerts_hide') || '{}') || {}; }catch(err){}
      hidden[ymOf(todayISO()) + ':' + x.closest('[data-al]').getAttribute('data-al')] = 1;
      lsSet('barnabank_alerts_hide', JSON.stringify(hidden));
      renderAlerts();
      return;
    }
    if(e.target.closest('[data-al]')) showPage('relatorios');
  });

  // ---------- 15. placar dos amigos ----------
  function boardData(){
    var by = {};
    state.debts.forEach(function(d){
      if(d.kind !== 'receivable') return;
      var k = nameKey(d.name);
      var p = by[k] || (by[k] = {key: k, name: d.name, lent: 0, paid: 0, open: 0, debts: 0, done: 0});
      p.lent += d.principal; p.paid += paidAmount(d); p.open += isPaid(d) ? 0 : remaining(d); p.debts++; if(isPaid(d)) p.done++;
    });
    var list = Object.keys(by).map(function(k){ var p = by[k]; p.rel = personReliability(k); return p; });
    var medals = {};
    function give(k, m){ (medals[k] = medals[k] || []).push(m); }
    var withRel = list.filter(function(p){ return p.rel && p.rel.total >= 2; });
    if(withRel.length){
      var best = withRel.slice().sort(function(a, b){ return b.rel.pct - a.rel.pct || a.rel.avgDelay - b.rel.avgDelay; })[0];
      if(best.rel.pct >= 60) give(best.key, ['🥇', 'Mais pontual']);
      var late = withRel.slice().sort(function(a, b){ return b.rel.late - a.rel.late; })[0];
      if(late.rel.late >= 2 && late.key !== best.key) give(late.key, ['🐢', 'Rei do atraso']);
    }
    var big = list.slice().sort(function(a, b){ return b.lent - a.lent; })[0];
    if(big) give(big.key, ['💸', 'Quem mais pegou']);
    var payer = list.slice().sort(function(a, b){ return b.paid - a.paid; })[0];
    if(payer && payer.paid > 0) give(payer.key, ['💰', 'Quem mais devolveu']);
    var fiel = list.slice().sort(function(a, b){ return b.done - a.done; })[0];
    if(fiel && fiel.done >= 2) give(fiel.key, ['🤝', 'Mais dívidas quitadas']);
    list.forEach(function(p){ p.medals = medals[p.key] || []; p.score = (p.rel ? p.rel.pct : 50) + Math.min(30, p.done * 5) - Math.min(30, p.open / 100); });
    return list.sort(function(a, b){ return b.score - a.score; });
  }
  function openBoard(){
    var list = boardData();
    if(!list.length){ appAlert('Placar', '<p class="warn">Quando você emprestar para alguém, o placar aparece aqui.</p>', 'trophy'); return; }
    openDialog({title: 'Placar dos amigos', icon: 'trophy', alert: true, okText: 'Fechar',
      html: '<p class="warn">Quem paga em dia sobe; quem atrasa desce. Só você vê.</p><div class="board">' + list.map(function(p, i){
        var rel = p.rel;
        return '<div class="bd-item"><span class="bd-pos">' + (i + 1) + '</span><span class="avatar">' + escapeHtml(initials(p.name)) + '</span>' +
          '<div class="bd-info"><b>' + escapeHtml(p.name) + '</b>' +
          (p.medals.length ? '<span class="bd-medals">' + p.medals.map(function(m){ return '<span class="medal" title="' + escapeHtml(m[1]) + '">' + m[0] + ' ' + escapeHtml(m[1]) + '</span>'; }).join('') + '</span>' : '') +
          '<small>' + (rel ? 'pontualidade ' + Math.round(rel.pct) + '%' + (rel.late ? ' · atraso médio ' + rel.avgDelay + 'd' : '') + ' · ' : '') + 'pegou ' + money.format(p.lent) + ' · devolveu ' + money.format(p.paid) + (p.open > EPS ? ' · deve ' + money.format(p.open) : '') + '</small></div></div>';
      }).join('') + '</div>'});
  }
  document.getElementById('btnBoard').addEventListener('click', openBoard);

  // ---------- 16. dividir a conta por item ----------
  var split = null;
  var splitOverlay = document.getElementById('splitOverlay');
  function openSplit(){
    split = {title: '', people: ['Eu'], items: [], service: false, servicePct: 10};
    document.getElementById('spTitle').value = '';
    document.getElementById('spDue').value = addDaysISO(todayISO(), 7);
    document.getElementById('spService').checked = false;
    document.getElementById('spErr').textContent = '';
    populateFriendsList();
    drawSplit();
    splitOverlay.classList.add('show');
    setTimeout(function(){ document.getElementById('spTitle').focus(); }, 40);
  }
  function closeSplit(){ splitOverlay.classList.remove('show'); split = null; }
  function splitTotals(){
    var per = {};
    split.people.forEach(function(p){ per[p] = 0; });
    var sub = 0;
    split.items.forEach(function(it){
      var who = it.who.filter(function(w){ return split.people.indexOf(w) !== -1; });
      if(!(it.price > 0) || !who.length) return;
      var parts = splitEqual(it.price * (it.qty || 1), who.length);
      who.forEach(function(w, i){ per[w] = round2(per[w] + parts[i]); });
      sub = round2(sub + it.price * (it.qty || 1));
    });
    var svc = split.service ? round2(sub * split.servicePct / 100) : 0;
    if(svc > 0 && sub > 0){
      var acc = 0, names = split.people.filter(function(p){ return per[p] > 0; });
      names.forEach(function(p, i){ var add = i === names.length - 1 ? round2(svc - acc) : round2(svc * per[p] / sub); acc = round2(acc + add); per[p] = round2(per[p] + add); });
    }
    return {per: per, sub: sub, svc: svc, total: round2(sub + svc)};
  }
  function drawSplit(){
    var pe = document.getElementById('spPeople');
    pe.innerHTML = split.people.map(function(p){
      return '<span class="sp-chip">' + escapeHtml(p) + (p === 'Eu' && split.people.length > 1 ? '' : '<button type="button" data-sprm="' + escapeHtml(p) + '" aria-label="Tirar ' + escapeHtml(p) + '">' + ic('x') + '</button>') + '</span>';
    }).join('');
    var list = document.getElementById('spItems');
    list.innerHTML = split.items.length ? split.items.map(function(it, i){
      return '<div class="sp-item" data-i="' + i + '"><div class="sp-row1"><input class="sp-name" value="' + escapeHtml(it.name) + '" placeholder="Item" aria-label="Item">' +
        '<input class="sp-qty" type="number" min="1" max="99" value="' + (it.qty || 1) + '" aria-label="Quantidade">' +
        '<input class="sp-price money" inputmode="decimal" value="' + (it.price ? fmtMoneyInput(it.price) : '') + '" placeholder="0,00" aria-label="Preço unitário">' +
        '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-spdel aria-label="Apagar item">' + ic('trash') + '</button></div>' +
        '<div class="sp-who">' + split.people.map(function(p){ return '<button type="button" class="sp-w' + (it.who.indexOf(p) !== -1 ? ' on' : '') + '" data-w="' + escapeHtml(p) + '">' + escapeHtml(p) + '</button>'; }).join('') + '</div></div>';
    }).join('') : '<div class="wk-empty">Adicione os itens da comanda (ou leia pela foto).</div>';
    drawSplitTotals();
  }
  function drawSplitTotals(){
    var t = splitTotals();
    document.getElementById('spTotals').innerHTML = split.people.map(function(p){
      return '<div class="sp-tot' + (p === 'Eu' ? ' me' : '') + '"><span>' + escapeHtml(p) + '</span><b>' + money.format(t.per[p] || 0) + '</b></div>';
    }).join('') + '<div class="sp-sum">Itens ' + money.format(t.sub) + (t.svc ? ' + serviço ' + money.format(t.svc) : '') + ' = <b>' + money.format(t.total) + '</b></div>';
  }
  function addPeople(raw){
    String(raw || '').split(/[,;\n]+/).map(function(s){ return s.trim().replace(/\s+/g, ' '); }).filter(Boolean).forEach(function(n){
      if(/^(eu|me|mim)$/i.test(n)) n = 'Eu';
      if(split.people.some(function(p){ return nameKey(p) === nameKey(n); })) return;
      split.people.push(n);
      split.items.forEach(function(it){ if(it.allNew) it.who.push(n); });
    });
  }
  document.getElementById('spAddPerson').addEventListener('click', function(){ var i = document.getElementById('spPerson'); addPeople(i.value); i.value = ''; drawSplit(); i.focus(); });
  document.getElementById('spPerson').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('spAddPerson').click(); } });
  document.getElementById('spPeople').addEventListener('click', function(e){
    var b = e.target.closest('[data-sprm]');
    if(!b) return;
    var n = b.getAttribute('data-sprm');
    split.people = split.people.filter(function(p){ return p !== n; });
    split.items.forEach(function(it){ it.who = it.who.filter(function(w){ return w !== n; }); });
    drawSplit();
  });
  document.getElementById('spAddItem').addEventListener('click', function(){
    split.items.push({name: '', qty: 1, price: 0, who: split.people.slice(), allNew: true});
    drawSplit();
    var rows = document.querySelectorAll('#spItems .sp-name');
    if(rows.length) rows[rows.length - 1].focus();
  });
  document.getElementById('spItems').addEventListener('input', function(e){
    var row = e.target.closest('[data-i]');
    if(!row) return;
    var it = split.items[+row.getAttribute('data-i')];
    if(e.target.classList.contains('sp-name')) it.name = e.target.value;
    if(e.target.classList.contains('sp-qty')) it.qty = Math.max(1, parseInt(e.target.value, 10) || 1);
    if(e.target.classList.contains('sp-price')){ var v = moneyVal(e.target); it.price = isNaN(v) ? 0 : v; }
    drawSplitTotals();
  });
  document.getElementById('spItems').addEventListener('click', function(e){
    var row = e.target.closest('[data-i]');
    if(!row) return;
    var it = split.items[+row.getAttribute('data-i')];
    if(e.target.closest('[data-spdel]')){ split.items.splice(+row.getAttribute('data-i'), 1); drawSplit(); return; }
    var w = e.target.closest('[data-w]');
    if(w){
      var n = w.getAttribute('data-w'), at = it.who.indexOf(n);
      if(at === -1) it.who.push(n); else it.who.splice(at, 1);
      it.allNew = false;
      w.classList.toggle('on', at === -1);
      drawSplitTotals();
    }
  });
  document.getElementById('spService').addEventListener('change', function(e){ split.service = e.target.checked; drawSplitTotals(); });
  document.getElementById('spCancel').addEventListener('click', closeSplit);
  splitOverlay.addEventListener('click', function(e){ if(e.target === splitOverlay) closeSplit(); });
  // ler a comanda pela foto (OCR no próprio celular; precisa de internet na primeira vez)
  function parseReceiptText(text){
    var items = [];
    String(text || '').split(/\r?\n/).forEach(function(line){
      var l = line.replace(/\s+/g, ' ').trim();
      if(l.length < 4) return;
      var n = normTxt(l);
      if(/(sub ?total|total|taxa|servico|troco|dinheiro|cartao|credito|debito|pix|cpf|cnpj|mesa|garcom|data|hora|obrigad|couvert art|desconto|pagamento|valor a pagar)/.test(n)) return;
      var m = /^(?:(\d{1,2})\s*(?:x|un|und|\*)?\s+)?(.+?)\s*(?:r\$)?\s*(\d{1,4}[.,]\d{2})\s*$/i.exec(l);
      if(!m) return;
      var name = m[2].replace(/[.\-_*]{2,}.*$/, '').replace(/\s+\d+[.,]\d{2}$/, '').replace(/[^\wÀ-ÿ ()/+&-]/g, '').trim();
      var price = parseFloat(m[3].replace(',', '.')), qty = m[1] ? Math.max(1, parseInt(m[1], 10)) : 1;
      if(!name || !(price > 0) || price > 5000) return;
      // se a linha traz o total do item (qtd × unitário), guardamos o unitário
      items.push({name: name.slice(0, 40), qty: qty, price: qty > 1 ? round2(price / qty) : price});
    });
    return items;
  }
  function loadTesseract(){
    if(window.Tesseract) return Promise.resolve(window.Tesseract);
    return new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = function(){ window.Tesseract ? res(window.Tesseract) : rej(new Error('ocr')); };
      s.onerror = function(){ rej(new Error('ocr')); };
      document.head.appendChild(s);
    });
  }
  var spPhoto = document.getElementById('spPhoto');
  document.getElementById('spScan').addEventListener('click', function(){ spPhoto.value = ''; spPhoto.click(); });
  spPhoto.addEventListener('change', function(){
    var f = spPhoto.files && spPhoto.files[0];
    if(!f) return;
    var st = document.getElementById('spErr');
    st.textContent = 'Lendo a comanda… (a primeira vez demora um pouco)';
    loadTesseract().then(function(T){
      return T.recognize(f, 'por', {logger: function(m){ if(m.status === 'recognizing text') st.textContent = 'Lendo a comanda… ' + Math.round((m.progress || 0) * 100) + '%'; }});
    }).then(function(r){
      var found = parseReceiptText(r && r.data && r.data.text);
      if(!found.length){ st.textContent = 'Não achei itens com preço na foto. Tente uma foto mais reta e com boa luz, ou digite os itens.'; return; }
      found.forEach(function(it){ it.who = split.people.slice(); it.allNew = true; split.items.push(it); });
      st.textContent = found.length + ' itens lidos. Confira nomes e preços: a leitura pode errar.';
      drawSplit();
    }).catch(function(){ st.textContent = 'Não consegui ler a foto agora (precisa de internet na primeira vez). Digite os itens.'; });
  });
  document.getElementById('spSave').addEventListener('click', function(){
    var err = document.getElementById('spErr');
    var title = document.getElementById('spTitle').value.trim(), due = document.getElementById('spDue').value || addDaysISO(todayISO(), 7);
    var t = splitTotals();
    var others = split.people.filter(function(p){ return p !== 'Eu' && t.per[p] > EPS; });
    if(!title){ err.textContent = 'Dê um nome (ex: Bar do Zé).'; return; }
    if(!(t.total > 0)){ err.textContent = 'Adicione os itens com preço.'; return; }
    if(split.items.some(function(it){ return it.price > 0 && !it.who.length; })){ err.textContent = 'Tem item sem ninguém marcado.'; return; }
    if(!others.length){ err.textContent = 'Adicione quem vai te pagar.'; return; }
    var me = t.per['Eu'] || 0;
    var g = {id: uid('g-'), title: title, kind: 'receivable', date: todayISO(), total: t.total, splitMode: 'custom', includeMe: me > EPS, myShare: round2(me), dueDate: due, walletId: settings.defaultWalletId || '',
      notes: split.items.filter(function(it){ return it.price > 0; }).map(function(it){ return (it.qty > 1 ? it.qty + 'x ' : '') + it.name + ' ' + money.format(it.price * (it.qty || 1)) + ' (' + it.who.join(', ') + ')'; }).join('; ').slice(0, 900) + (t.svc ? '; serviço ' + money.format(t.svc) : '')};
    state.groups.push(g);
    others.forEach(function(p){ state.debts.push(newGroupDebt(g, p, t.per[p])); });
    closeSplit();
    showToast('Conta dividida: ' + others.length + (others.length === 1 ? ' pessoa' : ' pessoas') + ' te devem ' + money.format(round2(t.total - me)), 'users');
    focusGroup(g.id);
  });
  document.getElementById('btnSplit').addEventListener('click', openSplit);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && splitOverlay.classList.contains('show')) closeSplit(); });

  // =====================================================================
  // v9: backups diários na nuvem e lembretes direto para quem te deve
  // =====================================================================
  var WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  function openBackups(){
    openDialog({title: 'Backups diários', icon: 'history', alert: true, okText: 'Fechar', html: '<p class="warn">Buscando os backups na nuvem…</p>'});
    botCall('/api/backups').then(function(r){
      var list = (r && r.backups) || [];
      if(!list.length){
        openDialog({title: 'Backups diários', icon: 'history', alert: true, okText: 'Fechar',
          html: '<p class="warn">Ainda não tem backup. A nuvem guarda uma cópia por dia (a partir do primeiro dia em que algo mudar) e mantém os últimos 30 dias.</p>'});
        return;
      }
      openDialog({title: 'Backups diários', icon: 'history', alert: true, okText: 'Fechar',
        html: '<p class="warn">Uma cópia por dia, guardada na sua nuvem por 30 dias. Cada uma é como os dados estavam no <b>começo</b> daquele dia.</p>' +
          '<div class="bk-list">' + list.map(function(b){
            var dt = new Date(b.date + 'T12:00:00');
            return '<div class="bk-row"><div><b>' + WEEKDAYS_SHORT[dt.getDay()] + ', ' + fmtDate(b.date) + '</b><span>' + relDay(b.date) + (b.size ? ' · ' + Math.max(1, Math.round(b.size / 1024)) + ' KB' : '') + '</span></div>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-bk="' + escapeHtml(b.date) + '">' + ic('undo-2') + ' Restaurar</button></div>';
          }).join('') + '</div>'});
      Array.prototype.forEach.call(document.querySelectorAll('[data-bk]'), function(btn){
        btn.addEventListener('click', function(){ restoreBackup(btn.getAttribute('data-bk')); });
      });
    }, function(e){ showDiagError(e.message); });
  }
  function restoreBackup(date){
    closeDialog(false);
    botCall('/api/backups/' + encodeURIComponent(date)).then(function(r){
      if(!r || !r.snapshot) throw new Error('Backup não encontrado.');
      return appConfirm('Voltar para ' + fmtDate(date) + '?', '<p class="warn">Os dados deste aparelho (e da nuvem) voltam a ser como estavam no começo de <b>' + fmtDate(date) + '</b>. O que você fez depois disso some. Os dados de agora ficam no backup de hoje.</p>', {okText: 'Restaurar', danger: true, icon: 'history'})
        .then(function(ok){
          if(!ok) return;
          restoreFromCloud(r.snapshot, 'Backup de ' + fmtDate(date) + ' restaurado');
          saveData();
          cloudPush();
        });
    }).catch(function(e){ showToast(e.message, 'triangle-alert'); });
  }

  // ---------- lembretes para quem te deve (pelo seu bot) ----------
  function friendOf(key){
    var iv = state.invites && state.invites[key], fr = cloudExtra.friends && cloudExtra.friends[key];
    return iv && fr && fr.code === iv.code ? fr : null;
  }
  function inviteLink(iv){
    var bot = String(cloudExtra.bot || '').replace(/^@/, '');
    return bot && iv ? 'https://t.me/' + bot + '?start=' + iv.code : '';
  }
  function openTgRemind(key, name){
    if(!cloudOn()){ appAlert('Precisa da nuvem', '<p class="warn">Os lembretes saem do seu bot. Ligue em <b>Configurações → Nuvem e bot do Telegram</b>.</p>', 'cloud'); return; }
    var first = firstName(name), iv = state.invites[key];
    if(!iv){
      iv = state.invites[key] = {code: 'c' + newShareToken().slice(0, 15), on: true, created: todayISO()};
      saveData();
      cloudPush();
    }
    var fr = friendOf(key), link = inviteLink(iv);
    var rules = '<ul class="tg-rules"><li>na véspera e no dia do vencimento</li><li>se atrasar, a cada 3 dias</li><li>sempre às 9h, com o valor, o link de cobrança e o seu PIX</li></ul>';
    var html;
    if(fr){
      html = '<p class="warn">✅ <b>' + escapeHtml(first) + '</b> recebe os lembretes no Telegram' + (fr.at ? ' desde ' + fmtDate(fr.at.slice(0, 10)) : '') + '. O bot avisa:</p>' + rules +
        '<label class="tg-toggle"><input type="checkbox" id="tgOn"' + (iv.on ? ' checked' : '') + '> Mandar lembretes automáticos</label>' +
        '<p class="share-views">Pelo /cobrar no bot você também pode mandar um lembrete na hora. ' + escapeHtml(first) + ' pode sair mandando /parar.</p>' +
        '<button type="button" class="btn btn-danger btn-sm" id="tgOff">' + ic('x') + ' Desconectar</button>';
    } else {
      var waText = 'Oi ' + first + '! Pra não esquecer as datas, toca aqui e aperta "Começar": meu bot te avisa no Telegram quando for vencer o que tá em aberto comigo (com o PIX). ' + link;
      html = '<p class="warn">Mande este convite para <b>' + escapeHtml(first) + '</b>. Quando ' + escapeHtml(first) + ' abrir e tocar em <b>Começar</b> no Telegram, o seu bot passa a avisar:</p>' + rules +
        (link ? '<div class="share-url"><input id="tgUrl" type="text" readonly value="' + escapeHtml(link) + '"></div>' +
          '<div class="card-actions share-acts"><button type="button" class="btn btn-primary btn-sm" id="tgCopy">' + ic('copy') + ' Copiar</button>' +
          '<a class="btn btn-whats btn-sm" target="_blank" rel="noopener" href="' + escapeHtml('https://wa.me/' + whatsPhone(name) + '?text=' + encodeURIComponent(waText)) + '">' + ic('message-circle') + ' WhatsApp</a></div>' +
          '<p class="share-views">⏳ Ainda não entrou. Você recebe um aviso no bot quando entrar.</p>'
          : '<p class="warn">Não consegui o nome do seu bot. Sincronize de novo ou publique o bot outra vez no GitHub (versão antiga).</p>') +
        '<button type="button" class="btn btn-ghost btn-sm" id="tgNew">' + ic('refresh-cw') + ' Gerar outro convite</button>';
    }
    openDialog({title: 'Lembretes no Telegram · ' + first, icon: 'send', alert: true, okText: 'Fechar', html: html});
    var on = document.getElementById('tgOn');
    if(on) on.addEventListener('change', function(){ iv.on = on.checked; saveData(); cloudPush(); showToast(on.checked ? 'Lembretes ligados para ' + first : 'Lembretes desligados para ' + first, 'send'); });
    var off = document.getElementById('tgOff');
    if(off) off.addEventListener('click', function(){
      closeDialog(false);
      delete state.invites[key];
      saveData(); cloudPush(); render();
      showToast(first + ' não recebe mais lembretes', 'send');
    });
    var nw = document.getElementById('tgNew');
    if(nw) nw.addEventListener('click', function(){
      closeDialog(false);
      delete state.invites[key];
      openTgRemind(key, name);
    });
    var cp = document.getElementById('tgCopy');
    if(cp) cp.addEventListener('click', function(){ copyText(link).then(function(ok){ showToast(ok ? 'Convite copiado' : 'Não consegui copiar', ok ? 'copy' : 'triangle-alert'); }); });
    var u = document.getElementById('tgUrl');
    if(u) u.addEventListener('click', function(e){ e.target.select(); });
  }

  // =====================================================================
  // v10: esconder valores, prazo pelo link, nota de confiança, recibo de quitação
  // =====================================================================

  // ---------- caçador de assinaturas: gastos que se repetem todo mês ----------
  function subKeyOf(t){
    var txt = String(t.desc || t.note || '').replace(/\s*·?\s*via Telegram/i, '').replace(/\(nota fiscal\)/i, '').trim();
    return {key: normTxt(txt || t.category || '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(), name: txt || t.category || ''};
  }
  function detectSubs(){
    var today = todayISO(), from = ymAdd(ymOf(today), -6), by = {};
    function add(item, amount, date, category){
      if(!(amount > 0) || ymOf(date) < from) return;
      var k = subKeyOf(item);
      if(!k.key) return;
      var b = by[k.key] || (by[k.key] = {key: k.key, name: k.name, category: category || '', items: []});
      b.items.push({date: date, amount: round2(amount)});
    }
    state.transactions.forEach(function(t){ if(t.type === 'gasto' && !(t.auto && /^card:/.test(t.auto)) && !t.isTransfer) add(t, t.amount, t.date, t.category); });
    state.cardPurchases.forEach(function(p){ if((p.installments || 1) === 1) add(p, p.amount, p.date, p.category); });
    var out = [];
    Object.keys(by).forEach(function(k){
      var b = by[k], months = {};
      b.items.sort(function(a, c){ return a.date < c.date ? -1 : 1; });
      b.items.forEach(function(it){ var m = ymOf(it.date); (months[m] = months[m] || []).push(it); });
      var ms = Object.keys(months).sort();
      if(ms.length < 3) return;
      if(ms.some(function(m){ return months[m].length > 2; })) return; // várias vezes no mês: não é assinatura (ex.: mercado)
      var amts = b.items.map(function(x){ return x.amount; }).slice().sort(function(a, c){ return a - c; }), med = amts[Math.floor(amts.length / 2)];
      if(b.items.some(function(x){ return Math.abs(x.amount - med) > med * 0.3; })) return; // valor muda demais
      var lastIt = b.items[b.items.length - 1];
      if(daysBetweenISO(lastIt.date, today) > 40) return; // parou de cobrar
      var prevIt = b.items.length > 1 ? b.items[b.items.length - 2] : null;
      var raised = prevIt && lastIt.amount - prevIt.amount >= 1 && lastIt.amount > prevIt.amount * 1.03;
      out.push({key: k, name: b.name, category: b.category, last: lastIt.amount, lastDate: lastIt.date, prev: prevIt ? prevIt.amount : 0, raised: !!raised, months: ms.length, yearly: round2(lastIt.amount * 12)});
    });
    return out.sort(function(a, c){ return c.yearly - a.yearly; });
  }
  function renderSubs(){
    var el = document.getElementById('relSubs');
    if(!el) return;
    var list = detectSubs();
    if(!list.length){ el.innerHTML = '<div class="chart-empty">Nenhum gasto se repetindo todo mês ainda (precisa de 3 meses de histórico).</div>'; return; }
    var total = list.reduce(function(s, x){ return s + x.last; }, 0);
    el.innerHTML = '<div class="subs-total">Somando <b>' + money.format(total) + '</b> por mês, ou <b>' + money.format(total * 12) + '</b> por ano.</div>' +
      list.map(function(x){
        return '<div class="sub-row' + (x.raised ? ' up' : '') + '"><div class="sub-n"><b>' + escapeHtml(x.name) + '</b><span>' + (x.raised ? 'subiu de ' + money.format(x.prev) + ' para ' + money.format(x.last) : 'há ' + x.months + ' meses' + (x.category && normTxt(x.category) !== x.key ? ' · ' + escapeHtml(x.category) : '')) + '</span></div>' +
          '<div class="sub-v"><b>' + money.format(x.last) + '</b><span>' + money.format(x.yearly) + '/ano</span></div></div>';
      }).join('');
  }

  // ---------- olhinho: esconde os valores da tela ----------
  var PRIV_KEY = 'barnabank_hide_values', privOn = lsGet(PRIV_KEY) === '1', privObs = null, privNodes = [];
  var MONEY_RE = /R\$[\s ]*-?\d[\d.]*(?:,\d{1,2})?/g, MASK = 'R$ •••••';
  function privMaskNode(n){
    var v = n.nodeValue;
    if(!v || v.indexOf('R$') === -1) return;
    var p = n.parentNode;
    if(p && /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName)) return;
    var m = v.replace(MONEY_RE, MASK);
    if(m === v) return;
    privNodes.push({n: n, orig: v, masked: m});
    n.nodeValue = m;
  }
  function privWalk(root){
    if(root.nodeType === 3){ privMaskNode(root); return; }
    if(root.nodeType !== 1) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n;
    while((n = w.nextNode())) privMaskNode(n);
  }
  function privApply(){
    document.body.classList.toggle('hide-values', privOn);
    var btn = document.getElementById('btnPrivacy');
    if(btn){ btn.innerHTML = ic(privOn ? 'eye-off' : 'eye'); btn.title = privOn ? 'Mostrar valores' : 'Esconder valores'; btn.setAttribute('aria-pressed', privOn ? 'true' : 'false'); btn.classList.toggle('on', privOn); }
    if(privOn){
      privWalk(document.body);
      if(!privObs && window.MutationObserver){
        privObs = new MutationObserver(function(list){
          list.forEach(function(mu){
            if(mu.type === 'characterData') privMaskNode(mu.target);
            else Array.prototype.forEach.call(mu.addedNodes, privWalk);
          });
          if(privNodes.length > 3000) privNodes = privNodes.filter(function(x){ return x.n.isConnected; });
        });
        privObs.observe(document.body, {childList: true, subtree: true, characterData: true});
      }
    } else {
      if(privObs){ privObs.disconnect(); privObs = null; }
      privNodes.forEach(function(x){ if(x.n.isConnected && x.n.nodeValue === x.masked) x.n.nodeValue = x.orig; });
      privNodes = [];
    }
  }
  function togglePrivacy(){
    privOn = !privOn;
    lsSet(PRIV_KEY, privOn ? '1' : '0');
    privApply();
    showToast(privOn ? 'Valores escondidos' : 'Valores à mostra', privOn ? 'eye-off' : 'eye');
  }
  (function(){
    var acts = document.querySelector('.header-actions');
    if(!acts || document.getElementById('btnPrivacy')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost btn-icon'; b.id = 'btnPrivacy'; b.setAttribute('aria-label', 'Esconder valores');
    b.addEventListener('click', togglePrivacy);
    acts.insertBefore(b, acts.firstChild);
    privApply();
  })();

  // ---------- nota de confiança ----------
  function trustInfo(key){
    var rel = personReliability(key);
    if(!rel) return null;
    var today = todayISO(), maxDelay = 0, lateNow = 0, lateNowDays = 0, doneMax = 0, paidTotal = 0;
    state.debts.forEach(function(d){
      if(nameKey(d.name) !== key || d.kind !== 'receivable') return;
      paidTotal += paidAmount(d);
      if(isPaid(d)) doneMax = Math.max(doneMax, d.principal);
      debtSchedule(d).insts.forEach(function(it){
        var dl = it.state === 'paga' && it.lastPayISO ? daysBetweenISO(it.dueISO, it.lastPayISO) : it.late ? daysBetweenISO(it.dueISO, today) : 0;
        if(dl > maxDelay) maxDelay = dl;
        if(it.late){ lateNow += it.open; lateNowDays = Math.max(lateNowDays, daysBetweenISO(it.dueISO, today)); }
      });
    });
    // pontualidade pesa mais; atraso médio e atraso de agora tiram pontos
    var score = 100 * (0.6 * rel.pct / 100 + 0.4 * Math.max(0, 1 - rel.avgDelay / 45));
    if(lateNow > EPS) score -= 10 + Math.min(25, lateNowDays / 3);
    if(rel.total < 3) score = Math.min(score, 80); // pouco histórico: não passa de "Boa"
    score = Math.max(0, Math.min(100, Math.round(score)));
    var lvl = score >= 85 ? ['Excelente', 'great'] : score >= 70 ? ['Boa', 'good'] : score >= 50 ? ['Regular', 'mid'] : ['Arriscada', 'bad'];
    var base = doneMax || paidTotal, factor = score >= 85 ? 1.5 : score >= 70 ? 1 : score >= 50 ? 0.5 : 0;
    var limit = base > 0 && factor > 0 ? Math.max(10, Math.round(base * factor / 10) * 10) : 0;
    return {score: score, label: lvl[0], cls: lvl[1], rel: rel, maxDelay: maxDelay, lateNow: round2(lateNow), lateNowDays: lateNowDays, limit: limit, base: base, hasDone: doneMax > 0};
  }
  function trustHtml(key){
    var t = trustInfo(key);
    if(!t) return '<div class="trust none">' + ic('shield-check') + '<div><b>Confiança: sem histórico ainda</b><span>A nota aparece depois da primeira parcela vencida.</span></div></div>';
    var r = t.rel;
    var how = t.score >= 85 ? '1,5x o maior empréstimo que já quitou' : t.score >= 70 ? 'o mesmo que o maior empréstimo que já quitou' : 'metade do maior empréstimo que já quitou';
    var tip = t.limit ? 'Sugestão: emprestar até <b>' + money.format(t.limit) + '</b> (' + (t.hasDone ? how : 'com base no que já pagou') + ')'
      : t.lateNow > EPS ? 'Melhor não emprestar até acertar o atrasado.' : 'Melhor não emprestar por enquanto.';
    return '<div class="trust ' + t.cls + '"><div class="tr-score" style="--p:' + t.score + '"><span>' + t.score + '</span></div>' +
      '<div class="tr-info"><b>Confiança ' + t.label.toLowerCase() + '</b>' +
      '<span>pagou em dia ' + r.onTime + ' de ' + r.total + (r.total === 1 ? ' parcela' : ' parcelas') + (r.late ? ' · atraso médio de ' + r.avgDelay + (r.avgDelay === 1 ? ' dia' : ' dias') + ' · maior ' + t.maxDelay + (t.maxDelay === 1 ? ' dia' : ' dias') : '') +
      (t.lateNow > EPS ? ' · <em>' + money.format(t.lateNow) + ' atrasado agora</em>' : '') + '</span>' +
      '<span class="tr-tip">' + tip + '</span></div></div>';
  }
  // dica no formulário de nova dívida, ao digitar o nome
  (function(){
    if(typeof fName === 'undefined' || !fName) return;
    var hint = document.createElement('div');
    hint.className = 'trust-hint'; hint.id = 'trustHint'; hint.hidden = true;
    fName.parentNode.appendChild(hint);
    function upd(){
      var k = nameKey(fName.value || ''), known = k && state.debts.some(function(d){ return nameKey(d.name) === k && d.kind === 'receivable'; });
      var t = known && currentFormKind === 'receivable' ? trustInfo(k) : null;
      if(!t){ hint.hidden = true; return; }
      hint.hidden = false;
      hint.className = 'trust-hint ' + t.cls;
      hint.innerHTML = ic('shield-check') + '<span>Confiança <b>' + t.score + '</b> (' + t.label.toLowerCase() + ')' + (t.limit ? ' · sugerido até ' + money.format(t.limit) : t.lateNow > EPS ? ' · tem ' + money.format(t.lateNow) + ' atrasado' : '') + '</span>';
    }
    ['input', 'change'].forEach(function(ev){ fName.addEventListener(ev, upd); });
    document.addEventListener('click', function(e){ if(e.target.closest && e.target.closest('#kindToggle, [data-kind]')) setTimeout(upd, 0); });
    document.getElementById('btnNew').addEventListener('click', function(){ setTimeout(upd, 0); });
  })();

  // ---------- recibo de quitação (PDF feito aqui mesmo, sem biblioteca) ----------
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  var WIN = {'€': 128, '‚': 130, '„': 132, '…': 133, '•': 149, '–': 150, '—': 151, '‘': 145, '’': 146, '“': 147, '”': 148, '™': 153};
  function pdfStr(t){
    var out = '';
    for(var i = 0; i < t.length; i++){
      var ch = t[i], c = t.charCodeAt(i);
      if(WIN[ch]) c = WIN[ch]; else if(c === 0xa0 || c === 0x202f) c = 32; else if(c > 255) c = 63;
      if(c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
      else out += String.fromCharCode(c);
    }
    return out;
  }
  function pdfWidth(t, size, bold){
    var tb = bold ? HELVB : HELV, w = 0;
    for(var i = 0; i < t.length; i++){
      var base = t[i].normalize ? t[i].normalize('NFD').charCodeAt(0) : t.charCodeAt(i);
      w += (base >= 32 && base <= 126) ? tb[base - 32] : WIN[t[i]] ? 556 : 556;
    }
    return w * size / 1000;
  }
  function pdfWrap(t, size, bold, maxW){
    var words = t.split(/\s+/), lines = [], cur = '';
    words.forEach(function(w){ var tryL = cur ? cur + ' ' + w : w; if(pdfWidth(tryL, size, bold) > maxW && cur){ lines.push(cur); cur = w; } else cur = tryL; });
    if(cur) lines.push(cur);
    return lines;
  }
  function pdfPage(){
    var ops = [];
    function col(c){ return c.map(function(x){ return (x / 255).toFixed(3); }).join(' '); }
    return {
      text: function(x, y, size, t, o){ o = o || {}; var w = pdfWidth(t, size, o.bold); if(o.align === 'right') x -= w; else if(o.align === 'center') x -= w / 2;
        ops.push('BT ' + col(o.color || [20, 22, 28]) + ' rg /' + (o.bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + pdfStr(t) + ') Tj ET'); return w; },
      rect: function(x, y, w, h, fill){ ops.push(col(fill) + ' rg ' + x + ' ' + y + ' ' + w + ' ' + h + ' re f'); },
      line: function(x1, y1, x2, y2, c, lw){ ops.push(col(c || [200, 200, 200]) + ' RG ' + (lw || 0.8) + ' w ' + x1 + ' ' + y1 + ' m ' + x2 + ' ' + y2 + ' l S'); },
      build: function(){
        var content = ops.join('\n');
        var objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
          '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'];
        var out = '%PDF-1.4\n%âãÏÓ\n', offs = [];
        objs.forEach(function(o, i){ offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
        var xref = out.length;
        out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function(o){ return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('');
        out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info << /Producer (BarnaBank) >> >>\nstartxref\n' + xref + '\n%%EOF';
        return out;
      }
    };
  }
  // número por extenso (reais e centavos)
  function extenso(v){
    var U = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    var D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    var C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
    function ate999(n){
      if(n === 100) return 'cem';
      var c = Math.floor(n / 100), r = n % 100, parts = [];
      if(c) parts.push(C[c]);
      if(r){ if(r < 20) parts.push(U[r]); else { var dz = Math.floor(r / 10), un = r % 10; parts.push(D[dz] + (un ? ' e ' + U[un] : '')); } }
      return parts.join(' e ');
    }
    function inteiro(n){
      if(n === 0) return 'zero';
      var grupos = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil']], parts = [], rest = n;
      grupos.forEach(function(g){
        var q = Math.floor(rest / g[0]);
        if(!q) return;
        rest -= q * g[0];
        parts.push(g[0] === 1e3 && q === 1 ? 'mil' : ate999(q) + ' ' + (q === 1 ? g[1] : g[2]));
      });
      if(rest) parts.push(ate999(rest));
      // "mil e cem", "mil duzentos e trinta": usa "e" antes do último grupo quando ele é pequeno ou redondo
      if(parts.length > 1 && (rest < 100 || rest % 100 === 0) && rest) return parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
      return parts.join(', ');
    }
    var cents = Math.round(v * 100), r = Math.floor(cents / 100), c = cents % 100, out = [];
    if(r) out.push(inteiro(r) + (r >= 1e6 && r % 1e6 === 0 ? ' de' : '') + (r === 1 ? ' real' : ' reais'));
    if(c) out.push(inteiro(c) + (c === 1 ? ' centavo' : ' centavos'));
    return out.join(' e ') || 'zero reais';
  }
  var MONTHS_LOWER = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function dataExtenso(iso){ return parseInt(iso.slice(8, 10), 10) + ' de ' + MONTHS_LOWER[+iso.slice(5, 7) - 1] + ' de ' + iso.slice(0, 4); }
  function fmtFull(iso){ return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
  function receiptCode(d){ var x = d.id + '|' + JSON.stringify(d.payments || []), h = (hashStr(x) + hashStr(x + '#')).toUpperCase(); return 'BB-' + h.slice(0, 4) + '-' + h.slice(4, 8); }
  function receiptPdf(d){
    var pg = pdfPage(), L = 56, R = 539, y = 790, GOLD = [176, 138, 50], MUTED = [110, 114, 128];
    var pays = (d.payments || []).slice().sort(function(a, b){ return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var total = round2(paidAmount(d)), last = pays.length ? pays[pays.length - 1].date : todayISO(), g = groupOf(d), n = installments(d);
    var owner = (settings.ownerName || '').trim(), city = (settings.ownerCity || '').trim();
    pg.rect(0, 812, 595, 30, [20, 22, 28]);
    pg.rect(0, 809, 595, 3, GOLD);
    pg.text(L, 822, 11, 'BarnaBank', {bold: true, color: [232, 205, 138]});
    pg.text(R, 822, 9, receiptCode(d), {align: 'right', color: [200, 200, 205]});
    pg.text(L, y - 18, 22, 'RECIBO DE QUITAÇÃO', {bold: true});
    pg.text(L, y - 38, 10, 'Comprovante de que a dívida foi paga por completo.', {color: MUTED});
    y -= 70;
    pg.rect(L, y - 54, R - L, 54, [246, 241, 228]);
    pg.rect(L, y - 54, 4, 54, GOLD);
    pg.text(L + 18, y - 22, 9, 'VALOR TOTAL RECEBIDO', {bold: true, color: MUTED});
    pg.text(L + 18, y - 42, 18, money.format(total).replace(/ /g, ' '), {bold: true});
    pg.text(R - 14, y - 22, 9, 'QUITADO EM', {bold: true, color: MUTED, align: 'right'});
    pg.text(R - 14, y - 42, 14, fmtFull(last), {bold: true, align: 'right'});
    y -= 84;
    var ref = g ? 'referente à sua parte em "' + g.title + '" (' + fmtFull(g.date || d.date) + ')' : 'referente ao empréstimo feito em ' + fmtFull(d.date) + (n > 1 ? ', em ' + n + ' parcelas' : '');
    var para = (owner ? 'Eu, ' + owner + ', declaro' : 'Declaro') + ' que recebi de ' + d.name + ' a importância de ' + money.format(total).replace(/ /g, ' ') + ' (' + extenso(total) + '), ' + ref +
      ', e dou plena e total quitação desta dívida, nada mais tendo a receber a esse título.';
    pdfWrap(para, 12, false, R - L).forEach(function(ln){ pg.text(L, y, 12, ln); y -= 19; });
    if((d.discount || 0) > EPS){ y -= 4; pg.text(L, y, 10.5, 'Desconto concedido na quitação: ' + money.format(d.discount).replace(/ /g, ' ') + '.', {color: MUTED}); y -= 16; }
    y -= 18;
    pg.text(L, y, 10, 'PAGAMENTOS', {bold: true, color: MUTED}); y -= 10;
    pg.line(L, y, R, y, [220, 214, 200]); y -= 18;
    var shown = pays.slice(0, 24);
    shown.forEach(function(p, i){
      if(i % 2 === 0) pg.rect(L, y - 6, R - L, 20, [250, 248, 243]);
      pg.text(L + 10, y, 11, fmtFull(p.date));
      var w = p.walletId && state.wallets.find(function(x){ return x.id === p.walletId; });
      if(w) pg.text(L + 120, y, 10, w.name, {color: MUTED});
      pg.text(R - 10, y, 11, money.format(p.amount).replace(/ /g, ' '), {align: 'right', bold: true});
      y -= 20;
    });
    if(pays.length > shown.length){ pg.text(L + 10, y, 10, '+ ' + (pays.length - shown.length) + ' pagamentos', {color: MUTED}); y -= 20; }
    pg.line(L, y + 6, R, y + 6, [220, 214, 200]);
    pg.text(L + 10, y - 10, 11, 'Total', {bold: true});
    pg.text(R - 10, y - 10, 11, money.format(total).replace(/ /g, ' '), {bold: true, align: 'right'});
    y -= 64; if(y < 150) y = 150;
    pg.text(L, y, 11, (city ? city + ', ' : '') + dataExtenso(last) + '.');
    y -= 60;
    pg.line(L, y, L + 250, y, [60, 60, 60], 0.8);
    pg.text(L, y - 15, 11, owner || 'Assinatura de quem recebeu', {bold: !!owner, color: owner ? [20, 22, 28] : MUTED});
    pg.text(L, 40, 8.5, 'Gerado pelo BarnaBank em ' + fmtFull(todayISO()) + ' · código ' + receiptCode(d) + '. Valores conforme os pagamentos registrados.', {color: MUTED});
    return pg.build();
  }
  function receiptFileName(d){ return 'recibo-' + normTxt(firstName(d.name)).replace(/[^a-z0-9]+/g, '-') + '-' + (d.payments && d.payments.length ? d.payments.slice().sort(function(a, b){ return a.date < b.date ? 1 : -1; })[0].date : todayISO()) + '.pdf'; }
  function shareReceipt(d){
    var bin = receiptPdf(d), bytes = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 255;
    var name = receiptFileName(d), blob = new Blob([bytes], {type: 'application/pdf'});
    var file = null;
    try{ file = new File([blob], name, {type: 'application/pdf'}); }catch(e){}
    if(file && navigator.canShare && navigator.canShare({files: [file]})){
      navigator.share({files: [file], title: 'Recibo de quitação', text: 'Recibo de quitação · ' + d.name}).catch(function(){});
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    showToast('Recibo baixado: ' + name, 'receipt');
  }
  // quando alguém termina de pagar, oferece o recibo
  var paidSeen = null;
  function checkNewlyPaid(){
    var now = {};
    state.debts.forEach(function(d){ if(d.kind === 'receivable' && isPaid(d) && (d.payments || []).length) now[d.id] = true; });
    if(paidSeen){
      Object.keys(now).forEach(function(id){
        if(paidSeen[id]) return;
        var d = state.debts.find(function(x){ return x.id === id; });
        if(d) showAction(firstName(d.name) + ' quitou! 🎉', 'Recibo', function(){ shareReceipt(d); }, 'receipt');
      });
    }
    paidSeen = now;
  }
  function showAction(label, btn, fn, icon){
    var entry = {uid: 'u' + (++undoSeq), label: label, undo: fn, btn: btn, icon: icon};
    undoQueue.push(entry);
    if(undoQueue.length > 3){ var ev = undoQueue.shift(); clearTimeout(ev.timer); }
    entry.timer = setTimeout(function(){ undoQueue = undoQueue.filter(function(e){ return e.uid !== entry.uid; }); renderUndoStack(); }, 12000);
    renderUndoStack();
  }
  checkNewlyPaid();

  // ---------- modo motor: a nuvem (bot) roda estas mesmas regras, sem tela ----------
  if(window.__BB_HEADLESS){
    window.__barnaEngine = {
      load: function(snap, opts){
        cloudCfg = {url: (opts && opts.url) || '', key: 'motor'};
        Object.keys(DEFAULT_SETTINGS).forEach(function(k){ settings[k] = DEFAULT_SETTINGS[k]; });
        loadSnapshotData(snap || {});
        rebuildMoneyFormatter();
      },
      applyOps: function(ops){
        var before = {};
        state.debts.forEach(function(d){ if(isPaid(d)) before[d.id] = true; });
        var res = applyCloudOps(ops);
        res.quitou = state.debts.filter(function(d){ return d.kind === 'receivable' && isPaid(d) && !before[d.id] && (d.payments || []).length; })
          .map(function(d){ return {debtId: d.id, name: d.name, key: nameKey(d.name), total: round2(paidAmount(d))}; });
        // a foto fica na nuvem até o app baixar; o pagamento já sai marcado
        res.forEach(function(x){ if(x.ok && x.photo){ x.photo.receiptId = 'rc-tg-' + x.id; x.photo = true; } });
        return res;
      },
      undo: function(list){ return applyCloudUndo(list); },
      runRecurring: runRecurring,
      receipt: function(debtId){
        var d = state.debts.find(function(x){ return x.id === debtId; });
        if(!d || !isPaid(d)) return null;
        return {name: d.name, key: nameKey(d.name), file: receiptFileName(d), pdf: receiptPdf(d), total: round2(paidAmount(d))};
      },
      snapshot: cloudSnapshot,
      summary: cloudSummary,
      shares: shareViews
    };
    return;
  }

  render();
  renderDashboard();
  checkBackupReminder();
})();
