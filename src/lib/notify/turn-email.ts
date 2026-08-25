/**
 * "It's your turn" — the same shell as the reset email.
 *
 * Inline styles and tables for the same reasons: Gmail strips <style>, and
 * Outlook renders with Word. See supabase/templates/README.md.
 */
export function turnEmail(opts: {
  name: string;
  division: string;
  league: string;
  gameweek: number;
  expiresAt: string | null;
}) {
  const deadline = opts.expiresAt
    ? new Date(opts.expiresAt).toLocaleString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London',
      })
    : null;

  const url = 'https://lockyourpicks.com/draft';
  const first = opts.name.trim().split(/\s+/)[0] || 'there';

  const text = [
    `It's your turn — gameweek ${opts.gameweek}`,
    `${opts.league} · ${opts.division}`,
    '',
    'Three fixtures. Once one is gone in your division, nobody else can have it.',
    deadline ? `Your turn ends ${deadline}.` : '',
    'Miss it and the clock picks for you.',
    '',
    url,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Three picks, gameweek ${opts.gameweek}. Miss your turn and the clock picks for you.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9f9f8;margin:0;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
  <tr><td style="background-color:#0d0d0d;padding:28px 32px;border-radius:16px 16px 0 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:10px;font-size:0;line-height:0;vertical-align:middle;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="width:14px;height:8px;border:2px solid #ff2d87;border-bottom:0;border-radius:7px 7px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="width:18px;height:12px;background-color:#ff2d87;border-radius:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td>
      <td style="vertical-align:middle;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:2.5px;color:#ff2d87;text-transform:uppercase;">You're on the clock</td>
    </tr></table>
  </td></tr>

  <tr><td style="background-color:#ffffff;padding:36px 32px 32px;border-left:1px solid #e6e6e4;border-right:1px solid #e6e6e4;">
    <h1 style="margin:0 0 14px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.6px;color:#0d0d0d;">It's your turn, ${first}</h1>
    <p style="margin:0 0 22px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#374151;">
      Gameweek ${opts.gameweek} in <span style="color:#0d0d0d;font-weight:600;">${opts.division}</span>.
      Three fixtures &mdash; and once one's gone in your division, nobody else can have it.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
      <tr><td align="center" bgcolor="#c8f135" style="border-radius:10px;">
        <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#0d0d0d;text-decoration:none;border-radius:10px;">Make your picks</a>
      </td></tr>
    </table>

    ${
      deadline
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background-color:#f9f9f8;border:1px solid #e6e6e4;border-radius:10px;">
      <tr><td style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#374151;">
        Your turn ends <strong style="color:#0d0d0d;">${deadline}</strong>. Miss it and the clock picks for you.
      </td></tr></table>`
        : ''
    }

    <p style="margin:0;padding-top:20px;border-top:1px solid #e6e6e4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b7280;">
      Don't want these? Turn them off under Appearance on your
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
    subject: `It's your turn — gameweek ${opts.gameweek}`,
    html,
    text,
  };
}
