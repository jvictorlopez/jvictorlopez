#!/usr/bin/env node
/**
 * generate-snake.mjs
 *
 * Renders the last 60 days of GitHub activity as a self-contained animated SVG:
 * a serpentine grid of "contribution apples" that a snake eats on an endless loop.
 *
 * Data source: GitHub GraphQL API (contributionsCollection.contributionCalendar).
 * Falls back to deterministic sample data when no token is available, so local
 * runs always produce output.
 *
 * Pure SMIL animation — no JavaScript inside the SVG, no external assets/fonts —
 * so it renders inside a GitHub README via plain Markdown image syntax.
 *
 * Env:
 *   GITHUB_TOKEN     - token with public profile read access (optional locally)
 *   GITHUB_USERNAME  - target user (default: jvictorlopez)
 *   OUTPUT_PATH      - light/default SVG path (default: assets/github-snake.svg)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DAYS = 60;
const USERNAME = process.env.GITHUB_USERNAME || "jvictorlopez";
const TOKEN = process.env.GITHUB_TOKEN || "";
const OUTPUT_PATH = process.env.OUTPUT_PATH || "assets/github-snake.svg";
const DARK_OUTPUT_PATH =
  process.env.DARK_OUTPUT_PATH || join(dirname(OUTPUT_PATH), "github-snake-dark.svg");
const DEBUG_PATH = join(dirname(OUTPUT_PATH), "activity-debug.json");

// Layout: a 60-day timeline wrapped into 4 serpentine rows of 15 cells.
const COLS = 15;
const ROWS = 4;
const WIDTH = 900;
const HEIGHT = 276;
const X0 = 86; // center of first column
const Y0 = 86; // center of first row
const PITCH_X = 52;
const PITCH_Y = 46;
const TURN_R = PITCH_Y / 2;
const CELL_R = 13;

// Animation timing / snake geometry.
const DUR = 24; // seconds per full loop
const BODY_SEGMENTS = 8;
const SEGMENT_GAP_PX = 20;
const LEAD_IN = 130; // off-screen run-up before the first cell
const LEAD_OUT = LEAD_IN + BODY_SEGMENTS * SEGMENT_GAP_PX + 40; // room for the tail to exit

const ROW_LEN = (COLS - 1) * PITCH_X;
const TURN_LEN = Math.PI * TURN_R;
const TOTAL_LEN = LEAD_IN + ROWS * ROW_LEN + (ROWS - 1) * TURN_LEN + LEAD_OUT;

// GitHub-dark contribution palette, low → extreme.
const TIER_FILL = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

const THEMES = {
  default: { card: "#0d1117", cardTop: "#121a26", border: "#21262d", title: "#e6edf3", muted: "#7d8590" },
  dark: { card: "none", cardTop: "none", border: "#21262d", title: "#e6edf3", muted: "#7d8590" },
};

const fmt = (n) => Number(n.toFixed(2));

// ---------------------------------------------------------------------------
// Data: GitHub GraphQL with sample-data fallback
// ---------------------------------------------------------------------------

const CONTRIBUTIONS_QUERY = `
  query ($username: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $username) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              color
            }
          }
        }
      }
    }
  }
`;

async function fetchContributions(username, token) {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (DAYS - 1));
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "github-profile-snake-60d",
    },
    body: JSON.stringify({
      query: CONTRIBUTIONS_QUERY,
      variables: { username, from: from.toISOString(), to: to.toISOString() },
    }),
  });

  if (!res.ok) throw new Error(`GraphQL request failed: HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.errors?.length) throw new Error(`GraphQL error: ${payload.errors[0].message}`);

  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error(`No contribution calendar returned for "${username}"`);

  // Flatten weeks into chronological days and keep exactly the last 60.
  const days = calendar.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DAYS)
    .map((d) => ({ date: d.date, count: d.contributionCount }));

  // Defensive: pad sparse calendars (brand-new accounts) with leading zero days.
  while (days.length < DAYS) {
    const first = new Date(`${days[0]?.date ?? from.toISOString().slice(0, 10)}T00:00:00Z`);
    first.setUTCDate(first.getUTCDate() - 1);
    days.unshift({ date: first.toISOString().slice(0, 10), count: 0 });
  }

  return { days, source: "github-graphql" };
}

/** Deterministic sample data so the generator works with no token. */
function sampleContributions() {
  let seed = 0x5eccc0;
  const rand = () => {
    // mulberry32 — tiny seeded PRNG, stable output across runs
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const today = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (DAYS - 1 - i));
    const wave = Math.sin(i / 5.5) * 4 + 5; // ship-cycle rhythm
    const burst = rand() > 0.86 ? rand() * 14 : 0; // occasional launch-day spike
    const rest = rand() < 0.14 ? -20 : 0; // a few zero days
    const count = Math.max(0, Math.round(wave + rand() * 4 + burst + rest));
    return { date: d.toISOString().slice(0, 10), count };
  });
  return { days, source: "sample-fallback" };
}

async function loadActivity() {
  if (TOKEN && USERNAME) {
    try {
      const data = await fetchContributions(USERNAME, TOKEN);
      console.log(`✓ Fetched contribution calendar for @${USERNAME} via GraphQL`);
      return data;
    } catch (err) {
      console.warn(`! GraphQL fetch failed (${err.message}) — using sample data`);
    }
  } else {
    console.warn("! GITHUB_TOKEN not set — using deterministic sample data");
  }
  return sampleContributions();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Cell center for chronological day index (serpentine: even rows L→R, odd R→L). */
function cellPos(i) {
  const row = Math.floor(i / COLS);
  const k = i % COLS;
  const col = row % 2 === 0 ? k : COLS - 1 - k;
  return { x: X0 + col * PITCH_X, y: Y0 + row * PITCH_Y, row };
}

/** Arc length along the snake path from the path start to day i's cell center. */
function arcToCell(i) {
  const row = Math.floor(i / COLS);
  return LEAD_IN + row * (ROW_LEN + TURN_LEN) + (i % COLS) * PITCH_X;
}

/** Serpentine motion path with smooth half-circle turns and off-screen leads. */
function snakePathD() {
  const xR = X0 + (COLS - 1) * PITCH_X;
  let d = `M ${X0 - LEAD_IN} ${Y0}`;
  for (let row = 0; row < ROWS; row++) {
    const y = Y0 + row * PITCH_Y;
    d += row % 2 === 0 ? ` L ${xR} ${y}` : ` L ${X0} ${y}`;
    if (row < ROWS - 1) {
      // Right-edge turns are clockwise (sweep=1), left-edge counterclockwise.
      d +=
        row % 2 === 0
          ? ` A ${TURN_R} ${TURN_R} 0 0 1 ${xR} ${y + PITCH_Y}`
          : ` A ${TURN_R} ${TURN_R} 0 0 0 ${X0} ${y + PITCH_Y}`;
    }
  }
  d += ` L ${X0 - LEAD_OUT} ${Y0 + (ROWS - 1) * PITCH_Y}`;
  return d;
}

/** Map a contribution count to a 0–4 intensity tier relative to the period max. */
function tierFor(count, max) {
  if (count <= 0) return 0;
  if (max < 4) return Math.min(count, 4); // tiny calendars: count maps directly
  return Math.min(4, Math.ceil((4 * count) / max));
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

function renderCells(days, max) {
  // The snake fully exits the viewBox by this loop fraction; cells regrow after it.
  const lastArc = arcToCell(DAYS - 1);
  const tailClearFrac =
    (lastArc + LEAD_IN + BODY_SEGMENTS * SEGMENT_GAP_PX) / TOTAL_LEN;
  const restoreStart = fmt(Math.min(0.988, tailClearFrac + 0.01));

  return days
    .map((day, i) => {
      const { x, y } = cellPos(i);
      const tier = tierFor(day.count, max);
      const fill = TIER_FILL[tier];

      // Loop fraction at which the snake head reaches this apple.
      const tf = arcToCell(i) / TOTAL_LEN;
      const keyTimes = `0;${fmt(tf - 0.005)};${fmt(tf + 0.007)};${restoreStart};1`;
      const eaten = tier === 0 ? 0.25 : 0.12;

      const halo =
        tier >= 3
          ? `<circle cx="${x}" cy="${y}" r="${CELL_R + 2}" fill="${fill}" opacity="0">
        <animate attributeName="opacity" values="${tier === 4 ? "0.4;0.08;0.4" : "0.22;0.05;0.22"}" dur="2.8s" begin="${fmt((i % 7) * 0.35)}s" repeatCount="indefinite"/>
        <animate attributeName="r" values="${CELL_R + 1};${CELL_R + 5};${CELL_R + 1}" dur="2.8s" begin="${fmt((i % 7) * 0.35)}s" repeatCount="indefinite"/>
      </circle>`
          : "";

      const glint =
        tier > 0
          ? `<ellipse cx="${x - 4}" cy="${y - 4.5}" rx="3.4" ry="2.2" fill="#ffffff" opacity="${0.1 + tier * 0.04}"/>`
          : "";

      return `<g>
      <animate attributeName="opacity" values="1;1;${eaten};${eaten};1" keyTimes="${keyTimes}" dur="${DUR}s" repeatCount="indefinite"/>
      ${halo}
      <circle cx="${x}" cy="${y}" r="${tier === 0 ? CELL_R - 2.5 : CELL_R}" fill="${fill}"${tier === 0 ? ' stroke="#21262d" stroke-width="1"' : ""}>
        <animate attributeName="r" values="${CELL_R};${CELL_R};4;4;${CELL_R}" keyTimes="${keyTimes}" dur="${DUR}s" repeatCount="indefinite"/>
      </circle>
      ${glint}
    </g>`;
    })
    .join("\n    ");
}

function renderSnake(pathD) {
  const segments = [];

  // Body: drawn tail-first so the head renders on top. Each segment follows the
  // same motion path, phase-shifted by a fixed time gap (negative begin keeps
  // every segment animating from t=0).
  for (let s = BODY_SEGMENTS; s >= 1; s--) {
    const lag = fmt((s * SEGMENT_GAP_PX * DUR) / TOTAL_LEN);
    const t = s / BODY_SEGMENTS;
    const r = fmt(8.6 - t * 4.2);
    const light = Math.round(58 - t * 30);
    segments.push(`<circle r="${r}" fill="hsl(142 72% ${light}%)" opacity="${fmt(0.95 - t * 0.35)}">
      <animateMotion dur="${DUR}s" begin="-${lag}s" repeatCount="indefinite" path="${pathD}"/>
    </circle>`);
  }

  // Head: glowing, with eyes; rotate="auto" keeps the face pointing along the path.
  segments.push(`<g filter="url(#headGlow)">
      <animateMotion dur="${DUR}s" begin="0s" repeatCount="indefinite" rotate="auto" path="${pathD}"/>
      <circle r="9.5" fill="url(#headFill)"/>
      <circle cx="3.4" cy="-3.6" r="1.9" fill="#04150b"/>
      <circle cx="3.4" cy="3.6" r="1.9" fill="#04150b"/>
      <circle cx="4" cy="-4.1" r="0.6" fill="#d7ffe9"/>
      <circle cx="4" cy="3.1" r="0.6" fill="#d7ffe9"/>
    </g>`);

  return segments.join("\n    ");
}

function renderSVG(days, totalContributions, themeName) {
  const theme = THEMES[themeName];
  const max = Math.max(...days.map((d) => d.count));
  const pathD = snakePathD();
  const fontStack = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
  const dateLabel = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  const card =
    theme.card === "none"
      ? `<rect x="1.5" y="1.5" width="${WIDTH - 3}" height="${HEIGHT - 3}" rx="16" fill="none" stroke="${theme.border}" stroke-width="1"/>`
      : `<rect x="1.5" y="1.5" width="${WIDTH - 3}" height="${HEIGHT - 3}" rx="16" fill="url(#cardFill)" stroke="${theme.border}" stroke-width="1"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Snake animation eating the last 60 days of GitHub activity">
  <defs>
    <radialGradient id="cardFill" cx="50%" cy="0%" r="120%">
      <stop offset="0%" stop-color="${theme.cardTop}"/>
      <stop offset="60%" stop-color="${theme.card}"/>
    </radialGradient>
    <radialGradient id="headFill" cx="35%" cy="35%" r="80%">
      <stop offset="0%" stop-color="#a7ffce"/>
      <stop offset="55%" stop-color="#39d353"/>
      <stop offset="100%" stop-color="#1f8b3d"/>
    </radialGradient>
    <filter id="headGlow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  ${card}

  <text x="${X0 - CELL_R}" y="44" font-family="${fontStack}" font-size="14" font-weight="600" letter-spacing="0.4" fill="${theme.title}">Last 60 Days of GitHub Activity</text>
  <text x="${X0 + (COLS - 1) * PITCH_X + CELL_R}" y="44" text-anchor="end" font-family="${fontStack}" font-size="12" font-weight="600" fill="#39d353">${totalContributions} contributions</text>

  <g>
    ${renderCells(days, max)}
  </g>

  <g>
    ${renderSnake(pathD)}
  </g>

  <text x="${X0 - CELL_R}" y="${HEIGHT - 12}" font-family="${fontStack}" font-size="10" fill="${theme.muted}">${dateLabel(days[0].date)}</text>
  <text x="${X0 + (COLS - 1) * PITCH_X + CELL_R}" y="${HEIGHT - 12}" text-anchor="end" font-family="${fontStack}" font-size="10" fill="${theme.muted}">${dateLabel(days[days.length - 1].date)} · today</text>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { days, source } = await loadActivity();
const totalContributions = days.reduce((sum, d) => sum + d.count, 0);
const max = Math.max(...days.map((d) => d.count));

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, renderSVG(days, totalContributions, "default"));
await writeFile(DARK_OUTPUT_PATH, renderSVG(days, totalContributions, "dark"));
await writeFile(
  DEBUG_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      username: USERNAME,
      source,
      totalContributions,
      days: days.map((d) => ({ ...d, tier: tierFor(d.count, max) })),
    },
    null,
    2,
  ),
);

console.log(`✓ ${OUTPUT_PATH} (${source}, ${totalContributions} contributions over ${DAYS} days)`);
console.log(`✓ ${DARK_OUTPUT_PATH}`);
console.log(`✓ ${DEBUG_PATH} (debug, gitignored)`);
