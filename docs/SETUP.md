# Setup — GitHub Profile Snake (60 days)

An animated SVG snake that eats your last 60 days of GitHub contributions, regenerated daily by GitHub Actions. Pure SMIL animation — no JavaScript, no external assets — so it renders natively in a GitHub README.

## How it works

1. `scripts/generate-snake.mjs` queries the GitHub GraphQL API (`contributionsCollection.contributionCalendar`) for your daily contribution counts over the last 60 days.
2. Counts are normalized into five intensity tiers (empty → glowing neon green) relative to your busiest day in the period.
3. The script renders `assets/github-snake.svg` (dark card) and `assets/github-snake-dark.svg` (transparent, for dark backgrounds) with a snake that traverses a serpentine path and "eats" each day's apple, looping every 24 seconds.
4. A GitHub Action regenerates and commits the SVGs daily.

> Note: the numbers shown are **contributions** as reported by GitHub's contribution calendar (commits, PRs, issues, reviews) — not raw push events.

## 1. Create the profile repository

For the snake to appear on your GitHub profile, the repo must be named **exactly your username**:

- Username `jvictorlopez` → repo `jvictorlopez/jvictorlopez`
- Make it **public** and don't initialize it with a README (you're pushing one).

GitHub automatically renders this repo's `README.md` on your profile page.

## 2. Push these files

```bash
git init
git add .
git commit -m "feat: animated 60-day activity snake profile"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-username>.git
git push -u origin main
```

## 3. Enable GitHub Actions

Actions are enabled by default for new repos. If not: **Settings → Actions → General → Allow all actions**. Also confirm **Workflow permissions** is set to **Read and write permissions** (required for the workflow to commit the SVG back).

## 4. Run the workflow manually once

**Actions → Generate activity snake → Run workflow → Run workflow.**

(The `push` to `main` in step 2 also triggers it automatically, since the script and workflow files changed.)

## 5. Confirm the SVG was generated

After the run goes green, check that the bot committed updated files at `assets/github-snake.svg` and `assets/github-snake-dark.svg`.

## 6. Confirm the README displays it

Open your profile at `https://github.com/<your-username>`. The animated snake should appear under your name. If the image looks stale, GitHub's CDN (camo) can cache for a few minutes — hard-refresh or wait.

## 7. Generate locally with your own data

No dependencies needed — just Node 18+:

```bash
# With real data (token needs no special scopes for public activity;
# add read:user to include private contribution counts):
GITHUB_USERNAME=yourusername GITHUB_TOKEN=yourtoken npm run generate

# Without a token — uses deterministic sample data:
npm run generate
```

Optional env vars:

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_USERNAME` | `jvictorlopez` | Whose calendar to render |
| `GITHUB_TOKEN` | — | Enables the real GraphQL fetch |
| `OUTPUT_PATH` | `assets/github-snake.svg` | Default SVG output |
| `DARK_OUTPUT_PATH` | `assets/github-snake-dark.svg` | Transparent-background variant |

The script also writes `assets/activity-debug.json` (gitignored) with the raw per-day counts and tiers — useful for verifying the data.

**Private contributions:** the workflow's default `GITHUB_TOKEN` only sees public activity. To include private contribution counts, create a fine-grained PAT with `read:user`, save it as a repo secret named `GH_PAT`, and the workflow picks it up automatically.

## 8. Update your GitHub bio

Profile → **Edit profile** → set bio to:

```
Specco Founder & CEO
```

Optionally append: `Building AI agent infrastructure for enterprise workflows.`

## Customizing

All visual knobs live at the top of `scripts/generate-snake.mjs`: grid shape (`COLS`/`ROWS`), loop duration (`DUR`), snake length (`BODY_SEGMENTS`), cell size, and the green palette (`TIER_FILL`).
