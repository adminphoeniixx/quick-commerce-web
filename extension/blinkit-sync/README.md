# QCP Blinkit Sync (Chrome extension)

Sends report files you download from the Blinkit seller panel straight to
Quick Commerce Pulse's `/api/imports`. It runs inside your own Chrome, using
your own Blinkit login (OTP and all). There is no stealth, proxy or captcha
handling. If Blinkit blocks or logs you out, stop and handle it manually.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose this folder.
2. Log in to QCP in the same Chrome (default `http://localhost:3000`, change in Settings).
3. Log in to the Blinkit seller panel yourself.
4. Open the extension popup → pick the **Brand**.

## Two ways to use it

**Capture mode (works today).** With "Auto-upload Blinkit downloads" on, every
`.csv`/`.xlsx` you download from `*.blinkit.com` is uploaded to QCP. The data
type is taken from the file name using the rules in Settings. Files that match
no rule, or that fail to upload, go to **Pending** in the popup, where you pick
the type and upload by hand. The normal download to your disk still happens.

**Run all reports (needs config).** Opens each configured report page in the
Blinkit tab and runs its steps to trigger the download. Capture mode then
uploads the files. Runs are capped at **2 per 24h**, with a fixed pause between
reports.

## Report config format (Settings → Reports)

```json
[
  {
    "name": "Sales – last 7 days",
    "url": "https://seller.blinkit.com/<reports-page>",
    "steps": [
      { "action": "click",   "text": "Sales Report" },
      { "action": "fill",    "selector": "input[name=startDate]", "value": "{{daysAgo:7}}" },
      { "action": "fill",    "selector": "input[name=endDate]",   "value": "{{yesterday}}" },
      { "action": "click",   "text": "Download" },
      { "action": "wait",    "ms": 3000 }
    ]
  }
]
```

| action | fields | does |
|--------|--------|------|
| `click` | `text` or `selector` | waits for the element and clicks it |
| `fill` | `text`/`selector`, `value` | sets an input (React-safe) |
| `select` | `selector`, `value` | sets a `<select>` |
| `waitFor` | `text` or `selector` | waits until it appears |
| `wait` | `ms` | fixed pause |

Optional fields on any step: `timeout` (ms, default 20000) and `after` (pause in
ms after the step, default 800). Date tokens are `{{today}}`, `{{yesterday}}`
and `{{daysAgo:N}}`. A format can follow a pipe, e.g. `{{yesterday|DD/MM/YYYY}}`.

The real URLs, button texts and selectors depend on the seller panel's report
screens and still need to be filled in.

## Notes

- QCP auth reuses the QCP login cookies (with the CSRF header) and refreshes the
  session once on a 401.
- QCP currently imports four data types: `sales`, `availability`, `pricing`
  and `visibility`. Other Blinkit reports stay in Pending until an adapter exists.
- Upload limit is 10 MB per file (server side).
