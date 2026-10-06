/**
 * The guided tour, as a list.
 *
 * Kept apart from the component that draws it so the copy can be read and
 * argued about on its own — it is the actual product here; the spotlight is
 * just chrome.
 *
 * Each step names the page it belongs to and the thing it points at. The
 * target is a `data-tour` attribute rather than a class or a structural
 * selector, so restyling a card can't quietly break the tour: the attribute
 * is a promise that the element is pointed at from here.
 *
 * A step whose target isn't on the page is skipped, not waited for. Half of
 * these only exist in the right circumstances — there is no lock-in button
 * when it isn't your turn, no clock when the draft hasn't opened — and a
 * tour that stalls on a missing element is worse than one that is a step
 * shorter.
 */

export type TourStep = {
  id: string;
  /** The route this step lives on. The tour navigates there if it has to. */
  path: string;
  /** `data-tour` value of the element to spotlight. Absent means centre screen. */
  target?: string;
  title: string;
  body: string;
};

export const TOUR: TourStep[] = [
  {
    id: 'welcome',
    path: '/dashboard',
    target: 'heading',
    title: 'Here’s how it works',
    body: 'Nine players, three divisions, three picks each a week. This is the gameweek you’re on — thirty seconds and you’ll know your way around.',
  },
  {
    id: 'clock',
    path: '/dashboard',
    target: 'clock',
    title: 'Whose turn it is',
    body: 'You draft in turn, so this says whether the clock is on you and how long is left. Miss it and a pick is made for you, so it’s worth not missing.',
  },
  {
    id: 'stats',
    path: '/dashboard',
    target: 'stats',
    title: 'Where you stand',
    body: 'Your place in your division and across the whole league, your points, and how last round went. Top of a division goes up, bottom goes down.',
  },
  {
    id: 'my-picks',
    path: '/dashboard',
    target: 'my-picks',
    title: 'This week’s picks',
    body: 'Your three, with the score beside each one as the games go off. A tick is a point.',
  },
  {
    id: 'board',
    path: '/draft',
    target: 'available',
    title: 'The board',
    body: 'Every fixture still available, in league order. Once somebody takes one it leaves this list — nobody else in your division can have it.',
  },
  {
    id: 'fixture',
    path: '/draft',
    target: 'fixture',
    title: 'Tap a match for the numbers',
    body: 'Tapping the teams opens the model’s read on that game: recent form, where they sit in the table, the rating gap, and how the other divisions called it.',
  },
  {
    id: 'pick',
    path: '/draft',
    target: 'pick-buttons',
    title: 'Making the call',
    body: 'Home win, draw or away win. One point if you’re right, nothing if you’re not. You get three a week.',
  },
  {
    id: 'slip',
    path: '/draft',
    target: 'slip',
    title: 'The slip',
    body: 'Your division’s picks for the week, yours marked. It fills as people take their turns, and the scores land here too.',
  },
  {
    id: 'lock-in',
    path: '/draft',
    target: 'lock-in',
    title: 'Locking in',
    body: 'Change your mind as often as you like until you lock in. After that they’re set and the turn passes on.',
  },
  {
    id: 'table',
    path: '/table',
    target: 'table',
    title: 'Division or whole league',
    body: 'This switches the table between your own division and everyone. Promotion and relegation come off the division one.',
  },
  {
    id: 'tabs',
    path: '/table',
    target: 'tabs',
    title: 'That’s everything',
    body: 'The five tabs are the whole app. You can run this again any time from your profile.',
  },
];
