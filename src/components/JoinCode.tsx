'use client';

import { useState } from 'react';

/**
 * The group's join code, with a way to get it to a mate.
 *
 * It was set in small type at the end of a metadata line, which is a strange
 * place for the one string a group owner actually needs to hand out. Copy
 * falls back to a share sheet on a phone, where pasting into WhatsApp is the
 * next thing anyone does with it.
 */
export function JoinCode({ code, name }: { code: string; name: string }) {
  const [said, setSaid] = useState<string | null>(null);

  const message = `Join my Lock Your Picks group "${name}" — code ${code}\nlockyourpicks.com`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setSaid('Copied');
    } catch {
      setSaid('Press and hold to copy');
    }
    setTimeout(() => setSaid(null), 2000);
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ text: message });
      else await copy();
    } catch {
      // A cancelled share sheet is not a failure.
    }
  }

  return (
    <div className="card flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
      <div>
        <p className="label">Join code</p>
        <p className="numeric mt-0.5 text-2xl tracking-[0.2em]">{code}</p>
      </div>

      <p className="min-w-40 flex-1 text-sm text-grey-500">
        Anyone with this can join {name}.
      </p>

      <div className="flex items-center gap-2">
        <button type="button" onClick={copy} className="btn btn-outline btn-sm">
          {said ?? 'Copy'}
        </button>
        <button type="button" onClick={share} className="btn btn-lime btn-sm">
          Send to a mate
        </button>
      </div>
    </div>
  );
}
