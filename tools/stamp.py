"""Atualiza o ?v= de app.css e app.js no index.html (evita o navegador usar versão velha em cache).
Uso: python3 tools/stamp.py   (o teste tests/test_stamp.py falha se esquecer)"""
import hashlib, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
for name in ('app.css', 'app.js'):
    h = hashlib.sha1((root / name).read_bytes()).hexdigest()[:8]
    html = re.sub(re.escape(name) + r'\?v=[0-9a-f]+', name + '?v=' + h, html)
(root / 'index.html').write_text(html, encoding='utf-8')
print('ok')
