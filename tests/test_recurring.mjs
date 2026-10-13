// Dívida recorrente (assinatura no cartão de alguém) e link "do que devo".
// Uso: node bot/build-engine.mjs && node tests/test_recurring.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const {getEngine} = await import(pathToFileURL(path.join(here, '..', 'bot', 'engine.js')).href);
const E = getEngine();
const today = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const ago = m => { const d = new Date(today + 'T00:00:00'); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };
const T = {own: 'A'.repeat(22), debt: 'B'.repeat(22), person: 'C'.repeat(22)};

E.load({
  debts: [
    {id: 'r1', name: 'Carlos Amigo', kind: 'payable', principal: 39.9, rate: 0, installments: 1, date: ago(3), dueDay: 10, payments: [{id: 'p1', date: ago(2), amount: 39.9}], notes: '', recurring: {amount: 39.9, label: 'Netflix'}},
    {id: 'p2', name: 'Carlos Amigo', kind: 'payable', principal: 100, rate: 0, installments: 2, date: ago(1), dueDay: 5, payments: [], notes: ''},
    {id: 'x', name: 'Fulano', kind: 'receivable', principal: 50, rate: 0, installments: 1, date: ago(1), payments: [], notes: ''}
  ],
  shares: {[T.own]: {type: 'owe', ref: 'carlos amigo'}, [T.debt]: {type: 'debt', ref: 'r1'}, [T.person]: {type: 'person', ref: 'fulano'}},
  contacts: {}, wallets: [], transactions: []
}, {url: 'https://x'});

const sh = E.shares();
const one = sh[T.debt];
assert.equal(one.dir, 'owe', 'link da dívida a pagar é "owe"');
assert.equal(one.pixInfo, null, 'sem PIX no link do que devo');
assert.equal(one.debts[0].title, 'Netflix');
assert.equal(one.debts[0].monthly, 39.9);
assert.equal(one.debts[0].paid, 39.9, 'já pago');
assert.equal(one.remaining, 119.7, 'falta = 3 parcelas de 39,90 (2 vencidas + a próxima)');
assert.equal(one.late, 79.8);

const all = sh[T.own];
assert.equal(all.dir, 'owe');
assert.equal(all.remaining, 219.7, 'soma as duas dívidas a pagar do Carlos');
assert.equal(all.debts.length, 2);

assert.equal(sh[T.person].dir, '', 'link de quem me deve continua igual');
assert.equal(sh[T.person].remaining, 50);
console.log('ok test_recurring');
