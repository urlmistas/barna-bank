// Mesmo que tools/stamp.py, para quem não tem Python: atualiza o ?v= de app.css e app.js no index.html.
// Uso: node tools/stamp.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const name of ['app.css', 'app.js']) {
  // o hash vale pro conteúdo com quebra de linha LF, igual ao que o Git guarda
  const bytes = fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
  const h = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8);
  html = html.replace(new RegExp(name.split('.').join('[.]') + '[?]v=[0-9a-f]+'), name + '?v=' + h);
}
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('ok');
