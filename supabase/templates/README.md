# Auth email templates

Supabase renders these, so they live in the dashboard rather than in the
build: **Authentication → Email Templates**. They're kept here so the markup
is reviewed and versioned like everything else, and so a change to the brand
has somewhere obvious to land.

| File | Template |
| --- | --- |
| `recovery.html` | Reset Password |

Paste the file's contents into the template's HTML body. Supabase substitutes
`{{ .ConfirmationURL }}` and `{{ .Email }}` when it sends.

## Why the markup looks like 2004

Because mail clients do. Gmail strips `<style>` from the head, so everything
is inline. Outlook renders with Word, so the layout is tables and the button
is a table cell rather than a styled anchor. A webfont would silently fall
back in most clients and take the letter-spacing with it, so the display face
is a system stack. The padlock is drawn with two table cells instead of an
image, so it survives a client that blocks remote content — which is most of
them, by default.

## The note about the same browser

The reset uses PKCE: requesting it stores a verifier in a cookie on that
device, and the exchange fails without it. Asking on a laptop and opening on
a phone therefore doesn't work, and the failure looks like an expired link.
That is the single most likely support question, so the email says it up
front rather than leaving people to discover it.
