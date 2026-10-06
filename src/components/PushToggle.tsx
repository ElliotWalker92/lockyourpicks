'use client';

import { useEffect, useState, useTransition } from 'react';

import {
  removePushSubscription,
  savePushSubscription,
} from '@/lib/actions/profile';

/**
 * Turn push on for this device.
 *
 * Per device, not per account, and it says so: the permission, the
 * subscription and the keys all belong to this browser on this phone.
 * Someone who turns it on here and then opens the app on a tablet has to
 * turn it on there too, and would otherwise wonder why the tablet is
 * silent.
 *
 * On iOS none of this exists until the app is installed to the home
 * screen — Safari has no push for a tab. Rather than show a switch that
 * does nothing, that case gets the instructions instead.
 */

const b64ToBytes = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const keyToBase64 = (key: ArrayBuffer | null) =>
  key
    ? btoa(String.fromCharCode(...new Uint8Array(key)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    : '';

type State =
  | 'checking'
  | 'unsupported'
  | 'needs-install'
  | 'blocked'
  | 'off'
  | 'on';

/**
 * `serviceWorker.ready` waits for an active registration and never settles
 * if there isn't going to be one, so everything that needs it is bounded.
 * A switch stuck on "checking" forever is worse than one that admits it
 * couldn't tell.
 */
const swReady = async (ms = 5000) => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The app isn’t ready yet — reload and retry.')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
};

/**
 * Is this an iPhone or iPad?
 *
 * It matters because Apple is the only platform that refuses push to a
 * browser tab, so it's the only one where the answer to "why is there no
 * switch" is "install the app first".
 *
 * iPadOS has claimed to be a Mac since version 13, so the user agent alone
 * reports an iPad as a desktop and sends it down the "this browser can't do
 * notifications" path, which is both wrong and a dead end. A Mac with a
 * touchscreen is the thing that doesn't exist.
 */
const isApple = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // Apple's own, from before the standard one.
  ('standalone' in navigator && navigator.standalone === true);

type Detected = { state: State; apple: boolean; installed: boolean };

async function detect(): Promise<Detected> {
  const apple = isApple();
  const installed = isInstalled();
  const where = { apple, installed };

  const supported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  if (!supported) {
    // iOS gives a tab no PushManager at all; installed, it has one.
    return { state: apple && !installed ? 'needs-install' : 'unsupported', ...where };
  }

  if (Notification.permission === 'denied') return { state: 'blocked', ...where };

  try {
    const reg = await swReady();
    return {
      state: (await reg.pushManager.getSubscription()) ? 'on' : 'off',
      ...where,
    };
  } catch {
    return { state: 'off', ...where };
  }
}

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>('checking');
  const [where, setWhere] = useState({ apple: false, installed: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    detect().then((next) => {
      if (!alive) return;
      setState(next.state);
      setWhere({ apple: next.apple, installed: next.installed });
    });
    return () => {
      alive = false;
    };
  }, []);

  const enable = () => {
    setError(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'blocked' : 'off');
          return;
        }

        const reg = await swReady();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToBytes(publicKey),
        });

        const { error: saveError } = await savePushSubscription({
          endpoint: sub.endpoint,
          p256dh: keyToBase64(sub.getKey('p256dh')),
          auth: keyToBase64(sub.getKey('auth')),
          label: navigator.userAgent.slice(0, 120),
        });

        if (saveError) {
          setError(saveError);
          return;
        }
        setState('on');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const disable = () => {
    setError(null);
    startTransition(async () => {
      const reg = await swReady();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState('off');
    });
  };

  if (state === 'checking') return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">On this device</p>

      {state === 'needs-install' && (
        <div className="flex flex-col gap-2 text-sm text-grey-500">
          <p>
            Apple doesn&rsquo;t allow notifications from a Safari tab, so this
            needs the app on your home screen first:
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>Tap Share — the square with the arrow out of the top.</li>
            <li>
              Tap <span className="font-medium text-ink">Add to Home Screen</span>.
            </li>
            <li>Open Lock Your Picks from the new icon.</li>
            <li>Come back here and the switch will be waiting.</li>
          </ol>
          <p>Until then your turn reaches you by email.</p>
        </div>
      )}

      {state === 'unsupported' && (
        <p className="text-sm text-grey-500">
          This browser can&rsquo;t do notifications. Your turn will come by
          email instead.
        </p>
      )}

      {state === 'blocked' && (
        <p className="text-sm text-grey-500">
          {where.apple
            ? 'Turned off for Lock Your Picks. Open Settings, find Lock Your Picks, tap Notifications and allow them.'
            : 'Blocked for this site. Allow notifications for lockyourpicks.com in your browser settings.'}
        </p>
      )}

      {(state === 'on' || state === 'off') && (
        <>
          <p className="text-sm text-grey-500">
            {state === 'on'
              ? 'This device buzzes the moment your turn starts.'
              : 'Buzz this device the moment your turn starts. It will ask you to allow it.'}
          </p>
          <button
            type="button"
            onClick={state === 'on' ? disable : enable}
            disabled={pending}
            className={`btn btn-sm self-start ${state === 'on' ? 'btn-outline' : 'btn-lime'}`}
          >
            {pending ? 'Working…' : state === 'on' ? 'Turn off' : 'Turn on'}
          </button>
          {where.apple && !where.installed && (
            <p className="text-sm text-grey-500">
              In a Safari tab this stops when you close it — add the app to your
              home screen to keep it.
            </p>
          )}
        </>
      )}

      {error && <p className="text-sm text-loss">{error}</p>}
    </div>
  );
}
