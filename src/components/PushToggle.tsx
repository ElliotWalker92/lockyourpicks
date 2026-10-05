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

async function detect(): Promise<State> {
  const supported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  if (!supported) {
    // iOS gives a tab no PushManager at all; installed, it has one.
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const installed = window.matchMedia('(display-mode: standalone)').matches;
    return iOS && !installed ? 'needs-install' : 'unsupported';
  }

  if (Notification.permission === 'denied') return 'blocked';

  try {
    const reg = await swReady();
    return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    detect().then((next) => {
      if (alive) setState(next);
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
      <p className="font-medium">Notify me on this device</p>

      {state === 'needs-install' && (
        <p className="text-sm text-grey-500">
          iPhones only allow this once the app is on your home screen. Tap
          Share, then <span className="font-medium">Add to Home Screen</span>,
          open it from there, and this switch appears.
        </p>
      )}

      {state === 'unsupported' && (
        <p className="text-sm text-grey-500">
          This browser doesn&rsquo;t do notifications. Turn emails will still
          reach you.
        </p>
      )}

      {state === 'blocked' && (
        <p className="text-sm text-grey-500">
          Notifications are blocked for this site. Allow them in your
          browser&rsquo;s settings for lockyourpicks.com, then come back.
        </p>
      )}

      {(state === 'on' || state === 'off') && (
        <>
          <p className="text-sm text-grey-500">
            {state === 'on'
              ? 'This device buzzes when it’s your turn. Emails stop — one nudge is enough.'
              : 'A notification the moment the turn reaches you, instead of an email that might sit in junk.'}
          </p>
          <button
            type="button"
            onClick={state === 'on' ? disable : enable}
            disabled={pending}
            className={`btn btn-sm self-start ${state === 'on' ? 'btn-outline' : 'btn-lime'}`}
          >
            {pending
              ? 'Working…'
              : state === 'on'
                ? 'Turn off on this device'
                : 'Turn on'}
          </button>
        </>
      )}

      {error && <p className="text-sm text-loss">{error}</p>}
    </div>
  );
}
