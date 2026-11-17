# QCP seller-panel agent

A GPT agent (LangGraph + OpenAI) drives a dedicated Chrome window where you are
logged in to your seller panels. It uses its own MCP server (`browser_mcp.py`,
Playwright over CDP). Every report it downloads is uploaded straight to the QCP
database through `/api/imports`. No Chrome extension is needed.

```
run.py (LangGraph + GPT) ──stdio MCP──► browser_mcp.py ──CDP 127.0.0.1:9222──► agent Chrome (your logins)
                                              └── download ──► agent/downloads ──► QCP /api/imports ──► DB
```

## One-time setup

1. `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (Python 3.12+).
2. `cp .env.example .env`, then fill in:
   - `OPENAI_API_KEY`
   - your QCP login (`QCP_EMAIL`, `QCP_PASSWORD`)
   - `QCP_BRAND_ID`
3. `./start_chrome.sh` opens a separate Chrome profile (`~/.qcp-agent-chrome`).
   Log in to Blinkit and the other seller panels in that window once. The logins stay saved in that profile.

## Run

Keep the agent Chrome open, then:

```bash
.venv/bin/python run.py                                   # Blinkit: sales report, last 7 days (also creates products)
.venv/bin/python run.py --task "Download the inventory report for yesterday"
```

## Blinkit notes

- Performance → Sales Performance → **Reports** downloads `sales_summary.xlsx`. It is order-level: QCP
  sums it per item per day, skips cancelled/returned orders and creates missing products from it.
- Re-importing the same period is idempotent (totals are replaced, not doubled).
- If Chrome saves the file to ~/Downloads instead of agent/downloads, the MCP server picks it up from there.

## Blinkit Brands (brands.blinkit.com, Blinkit Ads)

Login works with an email sign-in link, not a password or OTP:

```bash
.venv/bin/python run.py --platform blinkit-brands --email you@brand.com
#  → requests the sign-in link, then asks you to paste the URL from the email (hidden input)
.venv/bin/python run.py --platform blinkit-brands --task "Campaign-wise spend and ROAS for yesterday"
```

- "Keep me signed in" is ticked, so the session stays in the agent Chrome profile. After that, runs skip the login.
- The pasted URL goes straight to the MCP tool. It is never sent to GPT, saved, or printed.
- `blinkit_ads_sync(mode="recent"|"full")` pulls the logged-in ad account into the QCP admin:
  wallet, campaigns, daily performance and keywords. It posts to `/api/ads/import` and the data
  shows under **Blinkit Ads** in the sidebar. It runs the same read-only collector as the server
  connector (`services/browser/blinkit_ads.py`).
- Files downloaded with `data_type=ads` are only saved to `agent/downloads`.
- From Claude Code, the `qcp-browser` MCP server in `../.mcp.json` exposes the same tools. Call
  `blinkit_brands_request_login_link`, then give Claude the URL for `blinkit_brands_login_magic_link`.

## MCP tools

| Tool | What it does |
|------|------|
| `browser_list_tabs` | List open seller-panel tabs |
| `browser_open` | Open an allowed seller-panel URL |
| `blinkit_brands_request_login_link` | Enter your email on brands.blinkit.com and request the sign-in link |
| `blinkit_brands_login_magic_link` | Open the sign-in URL from the email (it is never stored or returned) |
| `blinkit_ads_sync` | Pull Blinkit Ads (wallet, campaigns, daily, keywords) into the QCP admin |
| `browser_snapshot` | Return page text, interactive elements and block/captcha/login flags |
| `browser_click` | Click an element |
| `browser_fill` | Fill an input or choose a select option |
| `browser_wait` | Wait for the page |
| `browser_click_download` | Click the download element, save the file and upload it to QCP |

## Guardrails

- At most 2 runs per 24h (`--force` overrides).
- Only allow-listed seller domains can be opened or touched.
- The agent never logs in and never fills password or OTP fields.
- It stops when a page looks blocked, shows a captcha or asks for login.
- Chrome remote debugging listens on 127.0.0.1 only.
