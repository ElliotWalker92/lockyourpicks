'use client';

import { useState } from 'react';

import { LockIcon } from '@/components/LockIcon';
import { SLIP_ACCENTS } from '@/lib/slip-accents';
import type { Outcome } from '@/lib/types';

export type SharePick = {
  home: string;
  away: string;
  homeCrest?: string | null;
  awayCrest?: string | null;
  outcome: Outcome;
  called: string;
  /** Set once the match has a score to show. */
  homeScore?: number | null;
  awayScore?: number | null;
  result?: Outcome | null;
  /** null while unscored; 0 or 1 once the gameweek settles. */
  points?: number | null;
};

/** One player's picks. A personal slip is a single group; a division slip is one per player. */
export type SlipGroup = {
  player: string;
  picks: SharePick[];
  /** Shown beside the name on a scored slip. */
  points?: number | null;
  /** Groups the players under a heading — a division, on a whole-group slip. */
  section?: string;
};

/** Matches the outcome buttons and the model bars. */
const CARD_TONE: Record<Outcome, string> = {
  HOME: '#c8f135',
  DRAW: '#d1d5db',
  AWAY: '#3b82f6',
};

const CARD_W = 1080;
const PAD = 72;
const ROW_H = 122;
/** Room for a player's name above their picks, on a division slip. */
const GROUP_H = 76;
/** Room for a division heading above the players in it. */
const SECTION_H = 84;
const CREST = 30;

function fontStack(variable: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return v || fallback;
}

/**
 * Load a crest for drawing onto the canvas.
 *
 * `crossOrigin` matters more than it looks: without it the canvas is tainted
 * the moment a remote image is drawn, and `toBlob` then throws a security
 * error instead of producing the card. The provider sends
 * `access-control-allow-origin: *`, so anonymous is enough.
 *
 * A crest that fails to load resolves to null rather than rejecting — a
 * missing badge should cost a badge, not the whole slip.
 */
function loadCrest(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * The pick as WhatsApp should read it.
 *
 * The side you called is shouted — capitals and bold; a draw shouts both,
 * which is exactly what calling a draw means. Reading the fixture tells you
 * the call without a separate arrow and a repeated team name.
 */
export function pickText(p: SharePick): string {
  const shout = (name: string) => `*${name.toUpperCase()}*`;
  const home = p.outcome === 'AWAY' ? p.home : shout(p.home);
  const away = p.outcome === 'HOME' ? p.away : shout(p.away);

  let line = `${home} v ${away}`;

  if (p.homeScore !== null && p.homeScore !== undefined &&
      p.awayScore !== null && p.awayScore !== undefined) {
    line += `  ${p.homeScore}-${p.awayScore}`;
  }
  if (p.points !== null && p.points !== undefined) {
    line += p.points > 0 ? ' ✅' : ' ❌';
  }
  return line;
}

/**
 * Shrink until it fits, then ellipsize — a long fixture shouldn't overflow.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: (size: number) => string,
  startSize: number,
  minSize: number,
): { text: string; size: number } {
  let size = startSize;
  ctx.font = font(size);
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = font(size);
  }
  if (ctx.measureText(text).width <= maxWidth) return { text, size };

  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return { text: `${clipped}…`, size };
}

/**
 * Draw the picks as a shareable card.
 *
 * A canvas rather than a screenshot of the page: the board is a wide,
 * scrollable table that reads badly cropped into a chat, and a phone
 * screenshot would carry whatever else happened to be on screen.
 */
async function drawCard(opts: {
  groups: SlipGroup[];
  gameweek: string;
  subtitle: string;
  locked: boolean;
  scored: boolean;
  /** The division's colour — spine, masthead, names, footer. */
  accent?: string;
}): Promise<Blob> {
  const accent = opts.accent ?? '#c8f135';
  const display = fontStack('--font-display', 'system-ui, sans-serif');
  const sans = fontStack('--font-sans', 'system-ui, sans-serif');

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Fall through to whatever is loaded.
    }
  }

  // Every crest, fetched once and reused across rows.
  const urls = new Set<string>();
  for (const g of opts.groups) {
    for (const p of g.picks) {
      if (p.homeCrest) urls.add(p.homeCrest);
      if (p.awayCrest) urls.add(p.awayCrest);
    }
  }
  const crests = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    [...urls].map(async (u) => crests.set(u, await loadCrest(u))),
  );

  const grouped = opts.groups.length > 1;
  const totalPicks = opts.groups.reduce((n, g) => n + g.picks.length, 0);
  const totalPoints = opts.groups.reduce(
    (n, g) => n + (g.points ?? 0),
    0,
  );

  const sectionCount = new Set(
    opts.groups.map((g) => g.section).filter(Boolean),
  ).size;

  const headerH = 300;
  const footerH = 130;
  const bodyH =
    totalPicks * ROW_H +
    (grouped ? opts.groups.length * GROUP_H : 0) +
    sectionCount * SECTION_H;
  const height = headerH + bodyH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the card.');

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, CARD_W, height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 10, height);

  // ---- Header ----
  ctx.fillStyle = accent;
  ctx.font = `700 26px ${sans}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('LOCK YOUR PICKS', PAD, 92);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 72px ${display}`;
  ctx.letterSpacing = '-1px';
  ctx.fillText(opts.gameweek, PAD, 182);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `28px ${sans}`;
  ctx.fillText(opts.subtitle, PAD, 228);

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, headerH - 40);
  ctx.lineTo(CARD_W - PAD, headerH - 40);
  ctx.stroke();

  // ---- Picks ----
  const NUM_X = PAD;
  const FIXTURE_X = PAD + 56;
  const GAP = 24;
  const PILL_MAX = 300;
  const SCORE_W = 92;
  const MARK_W = 40;

  let y = headerH;
  let index = 0;
  let section: string | null = null;

  for (const group of opts.groups) {
    if (group.section && group.section !== section) {
      section = group.section;
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 34px ${display}`;
      ctx.letterSpacing = '-0.5px';
      ctx.fillText(section, PAD, y + 46);
      ctx.letterSpacing = '0px';

      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, y + 64);
      ctx.lineTo(CARD_W - PAD, y + 64);
      ctx.stroke();

      y += SECTION_H;
    }

    if (grouped) {
      ctx.fillStyle = accent;
      ctx.font = `700 26px ${sans}`;
      ctx.letterSpacing = '2px';
      ctx.fillText(group.player.toUpperCase(), PAD, y + 42);
      ctx.letterSpacing = '0px';

      if (group.points !== null && group.points !== undefined) {
        const label = `${group.points} PT${group.points === 1 ? '' : 'S'}`;
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 26px ${sans}`;
        ctx.fillText(label, CARD_W - PAD - ctx.measureText(label).width, y + 42);
      }
      y += GROUP_H;
    }

    group.picks.forEach((p, i) => {
      const top = y + i * ROW_H;
      const mid = top + 44;

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `500 24px ${sans}`;
      ctx.fillText(String(index + 1).padStart(2, '0'), NUM_X, mid + 6);
      index++;

      let rightEdge = CARD_W - PAD;

      // Right to left: the mark, then the score, then the call.
      if (p.points !== null && p.points !== undefined) {
        const hit = p.points > 0;
        ctx.fillStyle = hit ? '#c8f135' : '#ef4444';
        ctx.font = `700 30px ${sans}`;
        const mark = hit ? '✓' : '✗';
        ctx.fillText(mark, rightEdge - ctx.measureText(mark).width, mid + 8);
        rightEdge -= MARK_W;
      }

      const hasScore =
        p.homeScore !== null && p.homeScore !== undefined &&
        p.awayScore !== null && p.awayScore !== undefined;

      if (hasScore) {
        const score = `${p.homeScore}–${p.awayScore}`;
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 32px ${display}`;
        ctx.fillText(score, rightEdge - ctx.measureText(score).width, mid + 8);
        rightEdge -= SCORE_W;
      }

      const pillFont = (size: number) => `700 ${size}px ${sans}`;
      const label = fitText(ctx, p.called, PILL_MAX - 52, pillFont, 28, 20);
      const pillW = ctx.measureText(label.text).width + 52;
      const pillX = rightEdge - pillW;

      ctx.fillStyle = CARD_TONE[p.outcome];
      ctx.beginPath();
      ctx.roundRect(pillX, mid - 26, pillW, 52, 26);
      ctx.fill();
      ctx.fillStyle = p.outcome === 'AWAY' ? '#ffffff' : '#0d0d0d';
      ctx.font = pillFont(label.size);
      ctx.fillText(label.text, pillX + 26, mid + 9);

      // ---- Fixture, with a crest before each side ----
      const room = pillX - FIXTURE_X - GAP;
      const homeImg = p.homeCrest ? crests.get(p.homeCrest) : null;
      const awayImg = p.awayCrest ? crests.get(p.awayCrest) : null;
      const badges = (homeImg ? CREST + 10 : 0) + (awayImg ? CREST + 10 : 0);

      let size = 32;
      const measure = (s: number) => {
        ctx.font = `${s}px ${sans}`;
        return (
          ctx.measureText(p.home).width +
          ctx.measureText(' v ').width +
          ctx.measureText(p.away).width +
          badges
        );
      };
      while (measure(size) > room && size > 20) size -= 2;

      // Still too wide at the floor: shorten the names. An ellipsis marks
      // the cut, or "Sheffield Wednes v West Bromwich Al" reads as a bug
      // rather than as a name that wouldn't fit.
      const ellipsised = (full: string, cut: string) =>
        cut === full ? cut : `${cut.trimEnd()}…`;

      let homeCut = p.home;
      let awayCut = p.away;
      ctx.font = `${size}px ${sans}`;
      const widthOf = (h: string, a: string) =>
        ctx.measureText(h).width +
        ctx.measureText(' v ').width +
        ctx.measureText(a).width +
        badges;

      while (
        widthOf(ellipsised(p.home, homeCut), ellipsised(p.away, awayCut)) >
          room &&
        (homeCut.length > 8 || awayCut.length > 8)
      ) {
        if (homeCut.length >= awayCut.length) homeCut = homeCut.slice(0, -1);
        else awayCut = awayCut.slice(0, -1);
      }

      const homeName = ellipsised(p.home, homeCut);
      const awayName = ellipsised(p.away, awayCut);

      let x = FIXTURE_X;
      ctx.font = `${size}px ${sans}`;
      if (homeImg) {
        ctx.drawImage(homeImg, x, mid - CREST / 2, CREST, CREST);
        x += CREST + 10;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillText(homeName, x, mid + 9);
      x += ctx.measureText(homeName).width;

      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(' v ', x, mid + 9);
      x += ctx.measureText(' v ').width;

      if (awayImg) {
        ctx.drawImage(awayImg, x, mid - CREST / 2, CREST, CREST);
        x += CREST + 10;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillText(awayName, x, mid + 9);

      if (index < totalPicks) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD, top + ROW_H - 28);
        ctx.lineTo(CARD_W - PAD, top + ROW_H - 28);
        ctx.stroke();
      }
    });

    y += group.picks.length * ROW_H;
  }

  // ---- Footer ----
  const footY = height - 54;
  ctx.fillStyle = accent;
  ctx.font = `700 24px ${sans}`;
  ctx.letterSpacing = '1px';
  const status = opts.scored
    ? `${totalPoints} PT${totalPoints === 1 ? '' : 'S'} FROM ${totalPicks} PICKS`
    : opts.locked
      ? `${totalPicks} PICKS · LOCKED IN`
      : `${totalPicks} PICKS · NOT LOCKED IN YET`;
  if (!opts.scored && !opts.locked) ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(status, PAD, footY);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `24px ${sans}`;
  const domain = 'lockyourpicks.com';
  ctx.fillText(domain, CARD_W - PAD - ctx.measureText(domain).width, footY);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Could not build the image.')),
      'image/png',
    );
  });
}

export function SharePicks({
  groups,
  gameweek,
  subtitle,
  locked,
  heading = 'Share your picks',
  note,
}: {
  groups: SlipGroup[];
  gameweek: string;
  subtitle: string;
  locked: boolean;
  heading?: string;
  note?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // A player with nothing in contributes no lines, and a name with nothing
  // under it reads as a bug rather than as "hasn't picked".
  const filled = groups.filter((g) => g.picks.length > 0);
  const totalPicks = filled.reduce((n, g) => n + g.picks.length, 0);
  if (!totalPicks) return null;

  const grouped = filled.length > 1;
  const scored = filled.some((g) =>
    g.picks.some((p) => p.points !== null && p.points !== undefined),
  );
  const totalPoints = filled.reduce((n, g) => n + (g.points ?? 0), 0);

  const lines: string[] = [`🔒 Lock Your Picks — ${gameweek}`, subtitle, ''];
  let textSection: string | null = null;
  for (const g of filled) {
    if (g.section && g.section !== textSection) {
      textSection = g.section;
      lines.push(`— ${g.section.toUpperCase()} —`, '');
    }
    if (grouped) {
      lines.push(
        g.points !== null && g.points !== undefined
          ? `*${g.player}* — ${g.points} pt${g.points === 1 ? '' : 's'}`
          : `*${g.player}*`,
      );
    }
    for (const p of g.picks) lines.push(pickText(p));
    if (grouped) lines.push('');
  }
  if (scored) {
    lines.push(`${totalPoints} point${totalPoints === 1 ? '' : 's'} so far`);
    lines.push('');
  }
  lines.push('lockyourpicks.com');
  const text = lines.join('\n');

  const build = () =>
    drawCard({ groups: filled, gameweek, subtitle, locked, scored });

  function saveBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lock-your-picks-${gameweek.toLowerCase().replace(/\s+/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function shareNative() {
    setMessage(null);
    setBusy('share');
    try {
      const blob = await build();
      const file = new File([blob], 'lock-your-picks.png', {
        type: 'image/png',
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else {
        saveBlob(blob);
        setMessage('Image saved — attach it in WhatsApp.');
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setMessage((e as Error)?.message ?? 'Could not share.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function saveImage() {
    setMessage(null);
    setBusy('image');
    try {
      saveBlob(await build());
    } catch (e) {
      setMessage((e as Error)?.message ?? 'Could not build the image.');
    } finally {
      setBusy(null);
    }
  }

  async function copyText() {
    setMessage(null);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Copied.');
    } catch {
      setMessage('Could not copy — your browser blocked it.');
    }
  }

  return (
    <div className="mt-5 border-t border-grey-300 pt-4">
      <h3 className="label mb-2 flex items-center gap-1.5">
        <LockIcon className="h-3 w-3" />
        {heading}
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={shareNative}
          disabled={busy !== null}
          className="btn btn-lime btn-sm"
        >
          {busy === 'share' ? 'Working…' : 'Share'}
        </button>

        {/* Text only — WhatsApp's link scheme can't carry an attachment. */}
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline btn-sm"
        >
          WhatsApp
        </a>

        <button
          type="button"
          onClick={saveImage}
          disabled={busy !== null}
          className="btn btn-outline btn-sm"
        >
          {busy === 'image' ? 'Working…' : 'Save image'}
        </button>

        <button
          type="button"
          onClick={copyText}
          className="text-xs text-grey-500 underline underline-offset-2 transition hover:text-ink"
        >
          Copy as text
        </button>
      </div>

      <p className="mt-2 text-xs text-grey-500">
        {note ??
          (scored
            ? 'Scores and points are as they stand right now.'
            : locked
              ? 'Share sends the picture on a phone, or saves it to attach.'
              : 'These aren’t locked in yet — share now and they could still change.')}
      </p>

      {message && (
        <p role="status" className="mt-2 text-xs text-grey-700">
          {message}
        </p>
      )}
    </div>
  );
}


export { SLIP_ACCENTS };

export type SlipSection = {
  title: string;
  accent: string;
  groups: SlipGroup[];
};

/**
 * One card per division rather than one long one.
 *
 * A single card carrying three divisions is a poster: too tall to read in a
 * chat, and it makes somebody scroll past two divisions they aren't in to
 * find their own. Separate cards can go to separate chats, and each takes
 * its division's colour so nobody has to read the header to know which is
 * theirs.
 */
export function SlipSet({
  sections,
  gameweek,
  subtitle,
  heading = "Send each division's slip",
}: {
  sections: SlipSection[];
  gameweek: string;
  subtitle: string;
  heading?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filled = sections.filter((section) =>
    section.groups.some((g) => g.picks.length),
  );
  if (!filled.length) return null;

  const scoredOf = (section: SlipSection) =>
    section.groups.some((g) =>
      g.picks.some((p) => p.points !== null && p.points !== undefined),
    );

  const textOf = (section: SlipSection) => {
    const lines = [
      `🔒 Lock Your Picks — ${gameweek}`,
      `${subtitle} · ${section.title}`,
      '',
    ];
    for (const g of section.groups) {
      if (!g.picks.length) continue;
      lines.push(
        g.points !== null && g.points !== undefined
          ? `*${g.player}* — ${g.points} pt${g.points === 1 ? '' : 's'}`
          : `*${g.player}*`,
      );
      for (const p of g.picks) lines.push(pickText(p));
      lines.push('');
    }
    lines.push('lockyourpicks.com');
    return lines.join('\n');
  };

  const buildOne = (section: SlipSection) =>
    drawCard({
      // The card is the division, so the heading inside it would repeat.
      groups: section.groups.map((g) => ({ ...g, section: undefined })),
      gameweek,
      subtitle: `${subtitle} · ${section.title}`,
      locked: true,
      scored: scoredOf(section),
      accent: section.accent,
    });

  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const fileName = (section: SlipSection) =>
    `${gameweek} ${section.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') +
    '.png';

  async function shareOne(section: SlipSection) {
    setMessage(null);
    setBusy(section.title);
    try {
      const blob = await buildOne(section);
      const file = new File([blob], fileName(section), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: textOf(section) });
      } else {
        saveBlob(blob, fileName(section));
        setMessage(`${section.title} saved — attach it in WhatsApp.`);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setMessage((e as Error)?.message ?? 'Could not share.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function shareAll() {
    setMessage(null);
    setBusy('all');
    try {
      const files = await Promise.all(
        filled.map(async (section) =>
          new File([await buildOne(section)], fileName(section), {
            type: 'image/png',
          }),
        ),
      );
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files });
      } else {
        // No share sheet: save them all, which is the desktop path anyway.
        files.forEach((file, i) => saveBlob(file, fileName(filled[i])));
        setMessage(`${files.length} slips saved.`);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setMessage((e as Error)?.message ?? 'Could not share.');
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 border-t border-grey-300 pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="label flex items-center gap-1.5">
          <LockIcon className="h-3 w-3" />
          {heading}
        </h3>
        <button
          type="button"
          onClick={shareAll}
          disabled={busy !== null}
          className="btn btn-lime btn-sm"
        >
          {busy === 'all' ? 'Working…' : `Send all ${filled.length}`}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {filled.map((section) => {
          const picks = section.groups.reduce(
            (n, g) => n + g.picks.length,
            0,
          );
          return (
            <li
              key={section.title}
              className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
            >
              <span
                aria-hidden
                className="h-8 w-1.5 shrink-0 rounded-full"
                style={{ background: section.accent }}
              />
              <span className="min-w-32 flex-1">
                <span className="font-medium">{section.title}</span>
                <span className="ml-2 text-sm text-grey-500">
                  {picks} pick{picks === 1 ? '' : 's'}
                </span>
              </span>

              <button
                type="button"
                onClick={() => shareOne(section)}
                disabled={busy !== null}
                className="btn btn-outline btn-sm"
              >
                {busy === section.title ? 'Working…' : 'Share'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(textOf(section))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline btn-sm"
              >
                WhatsApp
              </a>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs text-grey-500">
        One card per division, each in its own colour. &ldquo;Send all&rdquo;
        puts them through the share sheet together on a phone, or saves them
        all on a desktop.
      </p>

      {message && (
        <p role="status" className="mt-2 text-xs text-grey-700">
          {message}
        </p>
      )}
    </div>
  );
}
