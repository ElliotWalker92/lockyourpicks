/**
 * "Everyone's picks are in" — the same shell as the turn email.
 *
 * Inline styles and tables for the same reasons: Gmail strips <style>, and
 * Outlook renders with Word. See supabase/templates/README.md.
 *
 * Goes to one person, the owner of the group, and says the one thing they
 * can't get without opening the board and counting: nobody is still owed.
 */
export function roundEmail(opts: {
  name: string;
  league: string;
  gameweek: number;
  divisions: number;
  players: number;
}) {
  const url = `https://lockyourpicks.com/results?gw=${opts.gameweek}&scope=group`;
  const first = opts.name.trim().split(/\s+/)[0] || 'there';
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;

  // "11 players across 4 divisions", or just "11 players" for a group
  // that has only ever had the one.
  const tally =
    opts.divisions > 1
      ? `${plural(opts.players, 'player')} across ${plural(opts.divisions, 'division')}`
      : plural(opts.players, 'player');

  const text = [
    `Gameweek ${opts.gameweek} is in — ${opts.league}`,
    '',
    `Every pick is locked in: ${tally}. Nobody is still owed one.`,
    '',
    url,
  ].join('\n');

  const html = `
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Every pick is in for gameweek ${opts.gameweek} — ${tally}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9f9f8;margin:0;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
  <tr><td style="background-color:#0d0d0d;padding:28px 32px;border-radius:16px 16px 0 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:10px;font-size:0;line-height:0;vertical-align:middle;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="width:14px;height:8px;border:2px solid #c8f135;border-bottom:0;border-radius:7px 7px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="width:18px;height:12px;background-color:#c8f135;border-radius:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td>
      <td style="vertical-align:middle;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:2.5px;color:#c8f135;text-transform:uppercase;">Everyone&rsquo;s in</td>
    </tr></table>
  </td></tr>

  <tr><td style="background-color:#ffffff;padding:36px 32px 32px;border-left:1px solid #e6e6e4;border-right:1px solid #e6e6e4;">
    <h1 style="margin:0 0 14px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.6px;color:#0d0d0d;">Gameweek ${opts.gameweek} is in, ${first}</h1>
    <p style="margin:0 0 22px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#374151;">
      Every pick is locked in across <span style="color:#0d0d0d;font-weight:600;">${opts.league}</span> &mdash; ${tally}. Nobody is still owed one.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
      <tr><td align="center" bgcolor="#c8f135" style="border-radius:10px;">
        <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#0d0d0d;text-decoration:none;border-radius:10px;">See the card</a>
      </td></tr>
    </table>

    <p style="margin:0;padding-top:20px;border-top:1px solid #e6e6e4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b7280;">
      You get this because you run this group. Turn it off under Notifications on your
      <a href="https://lockyourpicks.com/profile" style="color:#6b7280;">profile</a>.
    </p>
  </td></tr>

  <tr><td style="background-color:#ffffff;padding:20px 32px 26px;border:1px solid #e6e6e4;border-top:0;border-radius:0 0 16px 16px;">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#9ca3af;">
      ${opts.league} &mdash; Lock Your Picks<br />
      <a href="https://lockyourpicks.com" style="color:#9ca3af;">lockyourpicks.com</a>
    </p>
  </td></tr>
</table>
</td></tr></table>`.trim();

  return {
    subject: `Gameweek ${opts.gameweek} is in — ${opts.league}`,
    html,
    text,
  };
}
