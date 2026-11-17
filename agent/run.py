"""QCP seller-panel agent.

GPT (via LangGraph) drives the dedicated, logged-in agent Chrome (start_chrome.sh)
through the local browser_mcp.py MCP server. Report downloads are uploaded
straight to the QCP database. The agent never logs in, never types passwords
or OTPs, and stops on block / captcha / login pages.

Usage:  .venv/bin/python run.py [--platform blinkit] [--task "..."] [--force]
"""
import argparse
import asyncio
import getpass
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

HERE = Path(__file__).resolve().parent
RUNS_FILE = HERE / ".runs.json"
MAX_RUNS_PER_DAY = 2

PANELS = {
    "blinkit": "https://seller.blinkit.com/dashboard/performance?performance=sales_performance",
    "blinkit-brands": "https://brands.blinkit.com/",
}

# What we know about each panel; the agent still verifies everything with snapshots.
HINTS = {
    "blinkit": """- Info popups (e.g. "Be cautious of third parties") block the page: close them with "Got it".
- Sales report: on the Performance > Sales Performance page, the "Reports" button
  (actionId performance:sales_analytics:download_sales_report) downloads sales_summary.xlsx for the
  selected date range (default "Last 7 days"). Use browser_click_download on it with data_type=sales.
  The file is order-level and also creates the products in QCP, so no separate catalog download is needed.
- Do not open product pages or "Edit" anything.""",
    "blinkit-brands": """- This is Blinkit Ads (Brand Central). run.py has already logged in; if snapshot.flags.loginPage is
  true anyway, STOP and say the session expired. Never call the blinkit_brands_login_* tools yourself.
- Read campaign/performance data from read-only report and analytics pages. If the page has a
  Download/Export, use browser_click_download with data_type=ads (saved locally, not imported).
  Otherwise summarise the numbers shown on the page (from browser_snapshot text) in your final answer.
- Never create, pause, edit or fund campaigns, and never change budgets, bids, products or brand settings.""",
}
DEFAULT_TASKS = {
    "blinkit": "Download the sales report for the last 7 days.",
    "blinkit-brands": "Get the ad campaign performance (spend, impressions, clicks, sales, ROAS) for the last 7 days.",
}


def tool_text(result) -> str:
    text = "".join(getattr(c, "text", "") for c in result.content)
    if result.isError:
        sys.exit(f"Blinkit Brands login failed: {text}")
    return text


async def brands_login(session, email: str | None) -> None:
    """Email magic-link login. The pasted URL goes straight to the MCP tool, never to the LLM."""
    email = email or os.getenv("BLINKIT_BRANDS_EMAIL") or input("Blinkit Brands login email: ").strip()
    res = json.loads(tool_text(await session.call_tool("blinkit_brands_request_login_link", {"email": email})))
    if res.get("alreadyLoggedIn"):
        print("Blinkit Brands: already logged in.")
        return
    print(f"Blinkit says: {res.get('pageSays', '')[:200]}")
    link = getpass.getpass("Paste the sign-in URL from the Blinkit email (input hidden): ").strip()
    res = json.loads(tool_text(await session.call_tool("blinkit_brands_login_magic_link", {"magic_link": link})))
    if not res.get("loggedIn"):
        sys.exit(f"Blinkit Brands login failed: {res.get('reason')}")
    print("Blinkit Brands: logged in.")

SYSTEM = """You operate a Chrome window where the user is already logged in to their
quick-commerce seller panels. Your job: download the reports they asked for; each
download made with browser_click_download is uploaded to the QCP database automatically.

Rules (never break these):
- Start with browser_list_tabs; reuse an open seller tab. Only use browser_open for the panel URL given.
- After every navigation or important click, call browser_snapshot and act on what it shows.
- If snapshot.flags.blocked, flags.captcha or flags.loginPage is true: STOP immediately and report it.
  Never try to log in, never type passwords or OTPs, never try to get around a block or captcha.
- Prefer the panel's own report/export features (Reports, Downloads, Export, Download CSV/Excel).
- Choose CSV or Excel when there is a choice. For date ranges use the last 7 days unless told otherwise.
- Use browser_click (not browser_click_download) for menus, tabs, filters and "Generate" buttons.
  Use browser_click_download only on the element that actually starts the file download, with the
  right data_type: sales | availability (inventory/stock) | pricing | visibility | products (catalog).
- Some panels generate reports asynchronously: generate, browser_wait, snapshot again, then download
  from the report list once it is ready.
- Download the product list (products) BEFORE sales/inventory: sales rows only import for SKUs that exist.
- Report the result of every browser_click_download exactly (file, uploaded, qcp import id or reason).
- Do each report once. Do not repeat downloads, and keep the total number of actions small.
- Finish with a short summary: which reports were downloaded, upload results, and anything that needs the user.
"""


def check_rate_limit(force: bool) -> None:
    runs = json.loads(RUNS_FILE.read_text()) if RUNS_FILE.exists() else []
    runs = [t for t in runs if time.time() - t < 86400]
    if len(runs) >= MAX_RUNS_PER_DAY and not force:
        sys.exit(f"Limit reached: {MAX_RUNS_PER_DAY} runs in the last 24h (use --force to override).")
    RUNS_FILE.write_text(json.dumps(runs + [time.time()]))


async def main() -> None:
    load_dotenv(HERE / ".env")
    p = argparse.ArgumentParser()
    p.add_argument("--platform", default="blinkit", choices=sorted(PANELS))
    p.add_argument("--task")
    p.add_argument("--email", help="Blinkit Brands login email (or BLINKIT_BRANDS_EMAIL in .env)")
    p.add_argument("--force", action="store_true")
    args = p.parse_args()
    args.task = args.task or DEFAULT_TASKS[args.platform]

    for key in ("OPENAI_API_KEY", "QCP_EMAIL", "QCP_PASSWORD", "QCP_BRAND_ID"):
        if not os.getenv(key):
            sys.exit(f"{key} is missing in agent/.env")
    check_rate_limit(args.force)

    client = MultiServerMCPClient({
        "browser": {
            "transport": "stdio",
            "command": sys.executable,
            "args": [str(HERE / "browser_mcp.py")],
            "cwd": str(HERE),
            "env": dict(os.environ),
        }
    })

    # One persistent MCP session, so the Chrome connection and tab ids live for the whole run.
    async with client.session("browser") as session:
        if args.platform == "blinkit-brands":
            await brands_login(session, args.email)
        # The LLM never gets the login tools: logging in is the user's step, done above.
        tools = [t for t in await load_mcp_tools(session) if not t.name.startswith("blinkit_brands_login")
                 and t.name != "blinkit_brands_request_login_link"]
        model = ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4.1"), base_url=os.getenv("OPENAI_BASE_URL") or None)
        agent = create_react_agent(model, tools, prompt=SYSTEM)
        task = (f"Platform: {args.platform}. Panel URL: {PANELS[args.platform]}\n"
                f"Known about this panel:\n{HINTS.get(args.platform, '-')}\nTask: {args.task}")
        async for step in agent.astream({"messages": [("user", task)]}, {"recursion_limit": 80}, stream_mode="updates"):
            for node, update in step.items():
                for msg in update.get("messages", []):
                    for call in getattr(msg, "tool_calls", None) or []:
                        print(f"→ {call['name']} {json.dumps(call['args'])[:200]}", flush=True)
                    if node == "tools":
                        print(f"  ← {str(msg.content)[:300]}", flush=True)
                    elif msg.content:
                        print(f"\n{msg.content}\n", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
