'use client';

import { useState } from 'react';

import { LockIcon } from '@/components/LockIcon';
import type { Outcome } from '@/lib/types';

export type SharePick = {
  home: string;
  away: string;
  outcome: Outcome;
  called: string;
};

/** One player's picks. A personal slip is a single group; a division slip is one per player. */
export type SlipGroup = {
  player: string;
  picks: SharePick[];
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

function fontStack(variable: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return v || fallback;
}

/**
 * Shrink until it fits, then ellipsize — a long fixture shouldn't overflow.
 *
 * Returns the size it settled on as well as the text, because the caller may
 * need to re-set the font later: measuring anything else in between leaves
 * ctx.font pointing at the wrong size.
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
 * screenshot would carry whatever else happened to be on screen. Drawing it
 * means the same card whatever device sent it.
 */
async function drawCard(opts: {
  groups: SlipGroup[];
  gameweek: string;
  subtitle: string;
  locked: boolean;
}): Promise<Blob> {
  const display = fontStack('--font-display', 'system-ui, sans-serif');
  const sans = fontStack('--font-sans', 'system-ui, sans-serif');

  // Wait for the webfonts, or the card silently renders in a fallback.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Fall through to whatever is loaded.
    }
  }

  const grouped = opts.groups.length > 1;
  const totalPicks = opts.groups.reduce((n, g) => n + g.picks.length, 0);

  const headerH = 300;
  const footerH = 130;
  const bodyH =
    totalPicks * ROW_H + (grouped ? opts.groups.length * GROUP_H : 0);
  const height = headerH + bodyH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the card.');

  // ---- Background ----
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, CARD_W, height);

  // Lime spine down the left edge, echoing the app's accent.
  ctx.fillStyle = '#c8f135';
  ctx.fillRect(0, 0, 10, height);

  // ---- Header ----
  ctx.fillStyle = '#c8f135';
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
  const FIXTURE_X = PAD + 56;
  const GAP = 28;
  /** Widest the call pill may get before the fixture has nowhere to go. */
  const PILL_MAX = 340;

  let y = headerH;
  let index = 0;

  for (const group of opts.groups) {
    if (grouped) {
      ctx.fillStyle = '#ff2d87';
      ctx.font = `700 26px ${sans}`;
      ctx.letterSpacing = '2px';
      ctx.fillText(group.player.toUpperCase(), PAD, y + 42);
      ctx.letterSpacing = '0px';
      y += GROUP_H;
    }

    group.picks.forEach((p, i) => {
      const top = y + i * ROW_H;

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `500 24px ${sans}`;
      ctx.fillText(String(index + 1).padStart(2, '0'), PAD, top + 46);
      index++;

      // The pill is measured first: its real width decides how much room the
      // fixture actually has. Sizing the fixture against a guessed pill width
      // let a long call and a long fixture collide.
      const pillFont = (size: number) => `700 ${size}px ${sans}`;
      const label = fitText(ctx, p.called, PILL_MAX - 52, pillFont, 30, 20);
      const pillW = ctx.measureText(label.text).width + 52;
      const pillX = CARD_W - PAD - pillW;

      ctx.fillStyle = '#ffffff';
      const fixture = fitText(
        ctx,
        `${p.home} v ${p.away}`,
        pillX - FIXTURE_X - GAP,
        (size) => `${size}px ${sans}`,
        34,
        22,
      );
      ctx.fillText(fixture.text, FIXTURE_X, top + 48);

      ctx.fillStyle = CARD_TONE[p.outcome];
      ctx.beginPath();
      ctx.roundRect(pillX, top + 14, pillW, 52, 26);
      ctx.fill();

      ctx.fillStyle = p.outcome === 'AWAY' ? '#ffffff' : '#0d0d0d';
      ctx.font = pillFont(label.size);
      ctx.fillText(label.text, pillX + 26, top + 49);

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
  ctx.fillStyle = opts.locked ? '#c8f135' : 'rgba(255,255,255,0.45)';
  ctx.font = `700 24px ${sans}`;
  ctx.letterSpacing = '1px';
  ctx.fillText(
    opts.locked
      ? `${totalPicks} PICKS · LOCKED IN`
      : `${totalPicks} PICKS · NOT LOCKED IN YET`,
    PAD,
    footY,
  );
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

/**
 * Send picks to a WhatsApp group.
 *
 * Three routes, because no single one works everywhere: the native share
 * sheet carries the image straight into a group but only exists on mobile;
 * wa.me carries text only, on any device; saving the PNG covers the rest.
 */
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

  const totalPicks = groups.reduce((n, g) => n + g.picks.length, 0);
  if (!totalPicks) return null;

  const grouped = groups.length > 1;

  const lines: string[] = [`🔒 Lock Your Picks — ${gameweek}`, subtitle, ''];
  let n = 0;
  for (const g of groups) {
    if (grouped) lines.push(`*${g.player}*`);
    for (const p of g.picks) {
      n++;
      lines.push(`${n}. ${p.home} v ${p.away} → ${p.called}`);
    }
    if (grouped) lines.push('');
  }
  lines.push('lockyourpicks.com');
  const text = lines.join('\n');

  const build = () => drawCard({ groups, gameweek, subtitle, locked });

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
      // A cancelled share sheet throws AbortError; that isn't a failure.
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

        {/* Text only — WhatsApp's link scheme can't carry an attachment.
            Opens the app with the message ready and lets you choose the
            group. */}
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
          (locked
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
