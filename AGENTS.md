# Instructions for AI agents

These rules apply to any AI agent (Claude, Copilot, Codex, Cursor, etc.) working in this repository.
Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md), which has the same pull request rules.

## Project at a glance

- **App:** a static site served by GitHub Pages: `index.html`, `app.css` and `app.js`. `app.js` is a single
  ES5 IIFE, with no build step and no framework. Data lives in the browser's `localStorage`.
- **Bot:** a Cloudflare Worker in `bot/` (`bot/worker.js`). `bot/engine.js` is **generated** from `app.js` by
  `node bot/build-engine.mjs`. It is gitignored, so never edit or commit it. `.github/workflows/bot.yml` deploys
  the bot when `main` changes.
- **Tests:** Python + Playwright suites in `tests/`, plus a simulated bot in `tests/botsim/`.
- **Language:** the UI, code comments and the bot's messages are in Brazilian Portuguese, so keep them that way.
  Pull request titles and descriptions are in English (see below).

## Working rules

- Follow the conventions already in the code: ES5 in `app.js`, the existing naming and the existing
  CSS tokens. Don't add frameworks, bundlers or dependencies without a reason.
- Run the tests that are relevant to your change:
  - `python3 tests/run_all.py` runs every suite. You can also pass suite names, e.g.
    `python3 tests/run_all.py test_v15`.
  - `node tests/test_recurring.mjs` covers the recurring-debt engine.
  - The suites need Python with `playwright` (Chromium), `opencv-python-headless` and `numpy`, plus
    Node 20+ and `pdftotext` (poppler-utils).
- After changing `app.js` or `app.css`, run `python3 tools/stamp.py`. `run_all.py` fails if the `?v=` stamps
  in `index.html` are stale.
- New behavior gets a test: add a suite in `tests/` and list it in `SUITES` in `tests/run_all.py`.
- **Never say tests passed without running them.** Report exactly what you ran, what passed, what failed,
  and what you could not run.
- Keep the change focused on the task: no drive-by refactors, reformatting or unrelated fixes. Mention
  those separately instead.
- Don't modify configuration, secrets or environment files unless the task requires it. That covers
  `bot/wrangler.toml`, workflow secrets and anything holding tokens. Never commit tokens or keys.
- Commits use the GitHub noreply address of the repository owner, never a personal email. Don't put
  links to AI chat sessions in commit messages or PR descriptions.

## Pull request titles (required)

Every PR title must start with one of these prefixes, then a colon and a space:

| Prefix | Use for |
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

- Format: `prefix: description` or `prefix(scope): description`. The scope is optional, e.g. `bot`, `app`,
  `reports`.
- Write titles in English, and make them descriptive and objective.
- Valid: `feat: add order tracking` · `fix: correct payment webhook validation` ·
  `test: cover payment confirmation` · `docs: update installation instructions` ·
  `feat(checkout): add payment status display`
- Invalid: `Add order tracking` (no prefix) · `feature: add tracking` (unknown prefix) · `feat:` (no description) ·
  `feat:add tracking` (no space) · `Feat: add tracking` (uppercase prefix) · `feat!: drop old API` (`!` is not
  accepted)

The `PR title` workflow (`.github/workflows/pr-title.yml`) checks this on every PR.

## Pull request descriptions (required)

Fill in `.github/pull_request_template.md`:

- **Summary:** what was added, updated or fixed, and why.
- **Changes:** the main changes, with any context reviewers need.
- **Testing:** the commands you ran and their real results.
- **Issue reference:** use `Fixes #123` when the PR should close the issue, or `Refs #123` to only link it.
- **Checklist:** tick only what is actually true.
