# Contributing to BarnaBank

Thanks for helping! This guide covers how to run the project, how to test it and how pull requests
should look. AI agents also follow [AGENTS.md](AGENTS.md), which uses the same rules.

## Running locally

The app is static, so any web server works:

```bash
python3 -m http.server 8765    # then open http://localhost:8765
```

The Telegram bot (`bot/`) is a Cloudflare Worker. See [bot/README.md](bot/README.md) for setup and
deployment. `bot/engine.js` is generated from `app.js` (`node bot/build-engine.mjs`) and is not committed.

## Tests

```bash
python3 tests/run_all.py              # every suite (starts the app and a simulated bot by itself)
python3 tests/run_all.py test_v15     # just one or more suites
node tests/test_recurring.mjs         # recurring-debt engine
```

You need Python with `playwright` (Chromium), `opencv-python-headless` and `numpy`, plus Node 20+ and
`pdftotext` (poppler-utils). The same suites run in CI on every pull request (`.github/workflows/testes.yml`).

If you change `app.js` or `app.css`, run `python3 tools/stamp.py`. It updates the `?v=` cache stamps in
`index.html`, and the test run fails if you forget.

## Pull request titles

Titles must follow `type: description` or `type(scope): description`. Write them in English, and keep them
short and specific.

| Type | Use for |
|---|---|
| `feat` | new feature |
| `fix` | bug fix |
| `devex` | developer experience improvement |
| `refactor` | code change that neither adds a feature nor fixes a bug |
| `style` | formatting-only changes |
| `docs` | documentation-only changes |
| `chore` | maintenance that does not modify source or test files |
| `revert` | revert a previous change |
| `perf` | performance improvement |
| `test` | add or correct tests |
| `build` | build system or dependency changes |
| `ci` | CI configuration or script changes |

The scope is optional and names the area that changed, e.g. `bot`, `app`, `reports`, `share-link`.

**Valid**

- `feat: add order tracking`
- `fix: correct payment webhook validation`
- `test: cover payment confirmation`
- `docs: update installation instructions`
- `feat(checkout): add payment status display`

**Invalid**

| Title | Problem |
|---|---|
| `Add order tracking` | no type |
| `feature: add order tracking` | unknown type |
| `Feat: add order tracking` | types are lowercase |
| `feat:add order tracking` | missing space after the colon |
| `feat:` / `feat: ` | no description |
| `feat(): add order tracking` | empty scope |
| `feat!: drop old export format` | the `!` marker is not accepted |

## Pull request descriptions

The PR template (`.github/pull_request_template.md`) is filled in automatically when you open a PR.

- **Summary:** what was added, updated or fixed, and why.
- **Changes:** the main changes, plus any context reviewers need.
- **Testing:** the commands you ran and their real results, including what you could not test.
- **Issue reference:** `Fixes #123` closes the issue when the PR is merged; `Refs #123` only links it.
- **Checklist:** tests run, docs updated where needed, and no unrelated changes.

Keep each PR focused on one change. Put unrelated fixes in a separate PR.

## Automatic title check

The **PR title** workflow (`.github/workflows/pr-title.yml`) runs
[`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request) whenever
a pull request is opened, reopened, edited or gets new commits.

- It accepts only the 12 types above, with an optional scope, `: ` and a non-empty description.
- If the check fails, edit the PR title. The check runs again by itself, with no new commit needed.
- It only reads the title and uses the default `GITHUB_TOKEN` with read-only access. It needs no secrets.

To block merging until the title is valid, a repository admin can mark **Validate PR title** as a
required status check (Settings → Branches → branch protection rule for `main`).
