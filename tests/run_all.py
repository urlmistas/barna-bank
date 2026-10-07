"""Roda todos os testes do BarnaBank.

Sobe o app (http://localhost:8765) e, para cada suíte, um bot simulado novo
(Worker real em Node, com KV, Telegram e IA de mentira) em http://localhost:8787.

Uso: python3 tests/run_all.py [nome_da_suite ...]
Precisa de: Python com playwright (chromium), opencv-python-headless e numpy; Node 20+.
"""
import os, sys, subprocess, time, urllib.request, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SUITES = ['test_bb', 'test_new', 'test_group', 'test_v5', 'test_v6', 'test_v7a', 'test_v7b', 'test_v8', 'test_debtlink', 'test_diag', 'test_v9', 'test_v10', 'test_v11', 'test_v12', 'test_v13']
BOT_SUITES = {'test_v13', 'test_v12', 'test_v11', 'test_v10', 'test_v9', 'test_v6', 'test_v7a', 'test_v7b', 'test_v8', 'test_debtlink', 'test_diag'}

def wait(url, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        try:
            urllib.request.urlopen(url, timeout=2); return True
        except Exception:
            time.sleep(0.3)
    return False

def check_stamp():
    import hashlib
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    ok = True
    for name in ('app.css', 'app.js'):
        h = hashlib.sha1(open(os.path.join(ROOT, name), 'rb').read()).hexdigest()[:8]
        if (name + '?v=' + h) not in html:
            print('FAIL  ' + name + ' mudou mas o ?v= do index.html não: rode python3 tools/stamp.py'); ok = False
    return ok

def main():
    pick = sys.argv[1:] or SUITES
    if not check_stamp(): sys.exit(1)
    # o bot usa o motor gerado do app.js
    if subprocess.run(['node', os.path.join(ROOT, 'bot', 'build-engine.mjs')]).returncode: sys.exit(1)
    env = dict(os.environ)
    env.setdefault('BB_URL', 'http://localhost:8765/index.html')
    web = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait('http://localhost:8765/index.html'):
        print('não consegui subir o servidor do app'); sys.exit(2)
    total_fail, report = 0, []
    try:
        for name in pick:
            bot = None
            if name in BOT_SUITES:
                bot = subprocess.Popen(['node', os.path.join(HERE, 'botsim', 'server.mjs')], cwd=os.path.join(HERE, 'botsim'), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
                if not wait('http://localhost:8787/'):
                    print(name, ': o bot simulado não subiu\n', bot.stderr.read().decode()[-2000:]); total_fail += 1; bot.kill(); continue
            t0 = time.time()
            try:
                r = subprocess.run([sys.executable, os.path.join(HERE, name + '.py')], capture_output=True, text=True, timeout=900, env=env, cwd=HERE)
                out = r.stdout + r.stderr
            except subprocess.TimeoutExpired as e:
                out = 'TIMEOUT\n' + ((e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or ''))
                r = None
            finally:
                if bot: bot.kill(); bot.wait()
            oks = len(re.findall(r'^OK ', out, re.M))
            fails = re.findall(r'^FAIL .*$', out, re.M)
            crashed = r is None or r.returncode != 0 or not re.search(r'\d+ falha\(s\)', out)
            n = len(fails) + (1 if crashed and not fails else 0)
            total_fail += n
            report.append('%-14s %3d ok  %s (%.0fs)' % (name, oks, 'OK' if not n else '%d FALHA(S)' % n, time.time() - t0))
            print(report[-1], flush=True)
            for f in fails: print('    ' + f)
            if crashed and not fails: print('    ' + '\n    '.join(out.strip().splitlines()[-15:]))
            if os.environ.get('GITHUB_ACTIONS'):
                # aparece na página da execução (e na API), sem precisar abrir o log
                for f in fails: print('::error title=%s::%s' % (name, f[5:].replace('\n', ' ')[:300]))
                if crashed and not fails: print('::error title=%s::%s' % (name, ' | '.join(out.strip().splitlines()[-6:])[:900]))
    finally:
        web.kill()
    print('\n'.join(['', 'Resumo:'] + report))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as fh: fh.write('### Testes\n```\n' + '\n'.join(report) + '\n```\n')
    sys.exit(1 if total_fail else 0)

if __name__ == '__main__':
    main()
