// Gera bot/engine.js a partir do app.js: o bot passa a usar exatamente as mesmas regras do app
// (parcelas, multa, previsão, resumo, links...). Roda no GitHub Actions antes de publicar.
// Uso: node bot/build-engine.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, '..', 'app.js'), 'utf8');
if (!app.includes('window.__BB_HEADLESS')) throw new Error('app.js sem o modo motor');

const out = `// GERADO por bot/build-engine.mjs a partir de app.js. Não edite: edite o app.js.
/* eslint-disable */
const BR_OFFSET = -180; // horário de Brasília (sem horário de verão)
const RealDate = globalThis.Date;
class BRDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + BR_OFFSET * 60000); }
  static now() { return RealDate.now() + BR_OFFSET * 60000; }
}
// elemento de tela "de mentira": qualquer coisa que o app faça com a tela vira nada
function fake() {
  const store = {};
  const target = function () {};
  return new Proxy(target, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return () => {};
      if (k === 'length') return 0;
      if (k === 'classList') return store.classList = {add() {}, remove() {}, toggle() { return false; }, contains() { return false; }};
      if (k === 'style' || k === 'dataset') return store[k] = {};
      if (k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'innerText' || k === 'href' || k === 'src' || k === 'id') return '';
      if (k === 'checked' || k === 'hidden' || k === 'disabled') return false;
      if (k === 'children' || k === 'childNodes' || k === 'files' || k === 'options') return [];
      if (k === 'querySelectorAll' || k === 'getElementsByTagName' || k === 'getElementsByClassName' || k === 'getClientRects') return () => [];
      if (k === 'getBoundingClientRect') return () => ({left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0});
      if (k === 'getAttribute') return () => null;
      if (typeof k === 'string' && /^(offset|client|scroll)(Width|Height|Left|Top)$/.test(k)) return 0;
      return fake();
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return fake(); }
  });
}
let cached = null;
export function getEngine() {
  if (cached) return cached;
  const mem = new Map();
  const localStorage = {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear()};
  const document = fake();
  const window = {
    __BB_HEADLESS: true, document, localStorage, navigator: {}, location: {search: '', href: '', hash: ''},
    matchMedia: () => ({matches: false, addEventListener() {}, addListener() {}}),
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, getComputedStyle: () => fake()
  };
  (function (window, document, localStorage, navigator, location, Date, getComputedStyle, requestAnimationFrame, indexedDB, MutationObserver, ResizeObserver, Image) {
${app}
  })(window, document, localStorage, window.navigator, window.location, BRDate, window.getComputedStyle, fn => setTimeout(fn, 16), undefined, undefined, undefined, undefined);
  cached = window.__barnaEngine;
  if (!cached) throw new Error('motor do app não iniciou');
  return cached;
}
`;
fs.writeFileSync(path.join(here, 'engine.js'), out);
console.log('bot/engine.js gerado (' + Math.round(out.length / 1024) + ' KB)');
