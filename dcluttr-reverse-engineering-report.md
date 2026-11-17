# Dcluttr: Reverse Engineering Report (REA se)

Date: 21 Oct 2026 · Tool: REA 6.7.0 (Docker + headless Chromium) · Target: https://app.dcluttr.ai, https://www.dcluttr.ai

**Scope:** sirf wahi analyze kiya jo browser ko publicly milta hai: login/sign-up pages, unke JS bundles aur public runtime config. Login nahi kiya, invitation accept nahi kiya, koi backend API call nahi ki, aur auth bypass karne ki koshish nahi ki.

Har point par label hai:
- **[Observed]**: code ya config me seedha dikha.
- **[Inferred]**: code se nikala gaya andaza.

---

## 1. Tech stack

| Layer | Kya use hota hai | Evidence |
|---|---|---|
| Web app | Next.js (App Router, Turbopack build) + React | [Observed] REA vendor fingerprint, `/_next/static/chunks/turbopack-*.js` |
| State | Redux Toolkit: 19 slices, ~85 async thunks | [Observed] `createSlice` / `createAsyncThunk` names |
| HTTP | axios: har microservice ka alag client, `Authorization: Bearer <JWT>` interceptor | [Observed] |
| UI | Radix UI primitives (shadcn-style), Framer Motion | [Observed] strings |
| Product analytics | PostHog (us.i.posthog.com), Sentry | [Observed] |
| Marketing site | Framer (www.dcluttr.ai) | [Observed] `<meta name="generator" content="Framer">` |
| Analytics engine | **Cube.js** semantic layer at `apollo.dcluttr.ai/cubejs-api/v1` | [Observed] env-config + `cube.load({measures:[...]})` |
| Hosting | Server-side middleware auth guard (307 → /log-in); HSTS `max-age=15724800` | [Observed]. Ye HSTS value ingress-nginx ka default hai, isliye backend shayad Kubernetes par hai [Inferred] |
| Runtime config | `<script id="env-config">` me JSON inject hota hai, build-time env nahi | [Observed] |

## 2. Backend architecture (microservices)

Public `env-config` se ye services mili [Observed]:

| Service | URL | Kaam |
|---|---|---|
| Auth / core API | `auth.dcluttr.ai` | login, OTP signup, org, brand, users, invitations, roles, navigation, feature toggles, product modules |
| Meta service | `meta.dcluttr.ai` | data-source connectors: Meta (FB) OAuth token exchange, ad accounts, `workflows/google`, `workflows/facebook` |
| Ads automation | `ads-automation-api.dcluttr.ai` | Blinkit/Zepto/Amazon ad campaigns, automation rules, bulk edit |
| Cube.js ("apollo") | `apollo.dcluttr.ai/cubejs-api/v1` | dashboards ke liye saare metrics |
| Rule engine | `rule-engine.dcluttr.ai` | portfolios, targets, alerts/rules |
| Report service | `report.dcluttr.ai` | reports, report portfolios |
| EDI service | `edi.dcluttr.ai` | PO / supply-chain (platforms ke saath EDI-style PO data) [Inferred] |
| Brand login service | `brand-login-service.dcluttr.ai` | brand ke platform-portal logins (Blinkit/Zepto seller/ad console) store karke unki taraf se login [Inferred] |
| Clarity (AI agent) | `clarity.dcluttr.ai` + `clarity-api.dcluttr.ai` | "Just Ask AI" chat / growth agents |
| Data quality | `data-quality.dcluttr.ai/api` (5s timeout) | data freshness/quality checks |
| MCP | `NEXT_PUBLIC_MCP_URL` (abhi empty) + `claude.ai/directory/dcluttr` | Dcluttr ka MCP connector Claude directory me listed hai; app me connection feature flag ke peeche hai [Observed config] |

### Kaam kaise hota hai [Inferred, upar ke evidence se]

```
Blinkit / Zepto / Instamart / Amazon / Flipkart Minutes / BB Now / Amazon Now / Noon
      │  (brand-login-service: brand ke portal credentials se reports/ads pull
      │   + scraping/crawl se shelf, price, rank data)
      ▼
 Ingestion "workflows" (meta service) ─── Meta Ads / Google Ads / Shopify (OAuth)
      ▼
 Data warehouse ──► Cube.js semantic layer (apollo) ──► Next.js dashboards
      │                                            └──► Clarity AI agent (chat, runs)
      ▼                                            └──► MCP server (Claude etc.)
 Rule engine + Ads automation service ──► platform ad consoles par bids/budgets/pause
```

## 3. Modules (frontend Redux slices se)

[Observed] slices: `auth, user, organization, brand, invitations, roleTemplates, navigation, featureToggle, productModules, portfolio, reports, compareSkus, crossFilterTable, metaConnect, sourceConnect, adAutomation, automationWizard, amazonEntityPicker, clarityAgent`

### 3.1 Onboarding aur multi-tenancy
- Signup flow: `/auth/signup` → OTP generate/verify/resend → `/organization/add` → `/brand` (brand details). [Observed]
- Hierarchy: **Organization → Brands → Users**. Invitations ke saath role templates aate hain. [Observed]
- **RBAC** permission strings `resource:scope:action` format me hain, wildcard `*` ke saath (e.g. `org:member:manage`, `brand:brand:write`). Permissions per brand aur **per channel** scope hoti hain. [Observed]
- **Sidebar server se aata hai:** `GET /brand/{id}/navigation`. Saath me `/product-modules/available?brandIds=` aur `/feature-toggle/brand/{id}` hain. Iska matlab har brand ko uske plan ke hisaab se modules dikhte hain (Basic/Pro/Enterprise gating). [Observed calls, Inferred purpose]

### 3.2 Auth / session
- JWT access token cookies me save hota hai: 2048-char tukdon me (`accessToken_part_0..N` + `accessToken_parts` count), 7 din ki expiry. Saath me `refreshToken` cookie hai. [Observed]
- Har service ko yahi Bearer token jaata hai, yaani sab services ka auth shared hai. [Observed]

### 3.3 Analytics (Cube.js)
- Saare numbers Cube.js queries se aate hain. Bundle me dikhe cubes [Observed]:
  - `all_stores_count.{blinkit, instamart, zepto, bbnow, fkmin, amazonnow, noonuae, noonksa}_count`. Har platform par dark stores count karta hai. **Noon UAE/KSA** bhi hai, yaani Middle East expansion ka code already live hai.
  - `amazon_ad_campaigns.*`, `amazon_ad_targeting_report.*`, `amazon_ad_advertised_product_report.*`, `amazon_ad_*_settings`. Metrics: spend, sales, ROAS, ACoS, CPC, CPM, CTR, CVR, AOV, CPA, orders.
- `crossFilterTable` slice ka matlab hai tables ek-doosre ko filter karti hain (drill-down / root-cause UI). [Observed name]
- `compareSkus` (`/api/compare-skus/config-json`) + `MAX_MR_PAIRS=25`: SKU vs competitor SKU comparison, max 25 pairs. [Observed config, Inferred meaning]
- Main dashboard route: `/dashboard/channel/quick-commerce?brand=<id>`. Store-level view: `/stores`. [Observed]

### 3.4 Ads automation (sabse detailed module)
Platforms: `BLINKIT_ADS`, `INSTAMART`, `ZEPTO`, `AMAZON_ADS`. Ek "Digital Shelf" mode bhi hai. [Observed]

- **Blinkit:** categories, category attributes, keyword attributes, suggested keywords. Campaign create/update. [Observed]
- **Zepto:** `zepto/config/login` sirf `{brand_id}` bhejta hai, password nahi. Iska matlab backend brand ke saved Zepto credentials se khud login karta hai [Inferred]. Uske baad city-wise product catalog, keyword config, targeting suggestions. [Observed]
- **Amazon:** portfolios, entity picker, keyword/product-target harvesting (`HARVEST_KEYWORD`, `HARVEST_PRODUCT_TARGET`) aur negation (`NEGATE_KEYWORD`, `NEGATE_PRODUCT`). [Observed]
- **Automation wizard (rules):** multi-step wizard. Har automation me ye hota hai [Observed]:
  - **actions** (`actionParams`)
  - har action ke **triggers** (conditions)
  - **revert** (`revert_enabled`, `revert_time`): change ko kuch der baad apne aap wapas karna. Isi se **dayparting** hoti hai, jaise peak slot me bid badhao aur baad me wapas (`dayPartingCarry`).
  - templates, entity levels (campaign / ad group / keyword), campaign types
  - `actions_and_triggers` catalog backend se aata hai
- **Schedules:** list, pause, delete, batch pause/delete. [Observed]
- **Bulk operations:** Excel template download → validate → submit, create aur edit dono ke liye. JSON bulk-edit bhi hai. Group templates bhi. [Observed]
- **Portfolios:** SKU/campaign groups (`api/portfolios/skus`, `api/portfolios/campaigns`) aur targets (`api/targets`) via rule engine. [Observed]

### 3.5 Data connectors
- Meta Ads: FB login → `meta/exchange-token` (short → long-lived token) → ad accounts list → `sources/meta`. [Observed]
- Google Ads: `workflows/google {brandId, orgId, customerId}`. Facebook: `workflows/facebook`. [Observed]
- Shopify ka zikr marketing me hai, bundle me nahi dikha. [Not observed]

### 3.6 AI agent ("Clarity" = Just Ask AI)
Endpoints [Observed]:
- `GET /api/agents`: kai named agents hain, sirf ek chatbot nahi
- `GET /api/sessions?brand…` aur `/api/sessions/{id}/messages`: brand-wise chat history
- `GET /api/runs/{runId}` aur `POST /api/runs/{runId}/cancel`

Agent **async "runs"** chalata hai: ek query kai steps lekar status deti hai aur beech me cancel ho sakti hai. Agent shayad Cube.js / warehouse par queries chalata hai (`sql` endpoint candidate bhi mila). [Inferred]

Dcluttr ka **MCP connector** Claude ki directory me listed hai, yaani Claude se seedha brand data query hota hai. [Observed config]

### 3.7 Round 2 ke naye findings (REA JS analyzer + public feature pages)
- **AI Recommendations panel** [Observed: `openRecommendationSheet`, `selectRecommendation`, `clearSelectedRecommendation`]. Agent chat ke alawa side sheet me recommendations bhi dikhata hai.
- **Dashboard UI** [Observed]:
  - Nested dashboards: modal aur sidebar me (`activateNestedModalDashboard`, `activateNestedSideBarDashboard`)
  - Card-based side drawers
  - Cross-filters with tabs
  - Compare mode (`setIsCompareOn`)
  - City-wise brand selection (`setCitiesList`, `setCityForBrand`), group-by, SKU picker, main chart selector
- **Competitor data ke algorithms** [Observed: Dcluttr ki feature pages par]:
  - *"Market share estimation algorithms"*: competitor kis locality me aage hai, ye pinpoint karta hai. Competitor revenue model se estimate hota hai, asli data nahi hai.
  - *"PSL estimation"* (Potential Sales Loss): stock-out se kitni sale gayi, uska estimate.
  - Data granularity: locality x SKU. Tracked metrics: market share, OSA, SOV, discounting.
  - "Spot new players early": naye SKU aur brands detect karta hai.
  - Cross-platform stock transfer suggestion: slow Blinkit dark store se high-conversion Zepto dark store me.
- **Day-parted SOV** [Observed: feature page]: share of voice time-slot wise track hota hai, aur isi se ads dayparting decide hoti hai. Ye code ke `revert_time` mechanism se match karta hai.
- **Pricing module** [Observed: feature page]: platforms ke beech price mismatch par alerts, aur discount ka revenue/market share par asar.
- **Amazon Intelligence** [Observed: feature page]:
  - Issues Sales, Supply Chain aur Marketing teams ko route hote hain, approval workflow aur audit trail ke saath.
  - Per-ASIN metrics: Featured Offer %, Weeks of Cover, sellable on-hand, sales velocity.
- **Naya product: ChatGPT Ads Automations** [Observed: `/chatgpt-ads-automations`]:
  - Amazon aur Google ke winning search terms ko ChatGPT Ads experiments me badalna.
  - "Profit & inventory-aware autopilot": bids margin, inventory, repeat rate aur contribution profit ke hisaab se, sirf ROAS par nahi.
  - Autonomous intent/creative/landing-page experiments.
- **Lead funnels:** "Brand Factory" cohort (`/cohort`, `/apply-now`) aur "Availability Playbook 2025" lead-magnet form.

## 4. Marketing claims vs code

| Claim (report/website) | Code me mila? |
|---|---|
| 13 channels incl. Amazon Now, Flipkart Minutes, BB Now | Haan: Cube store-count me Blinkit, Instamart, Zepto, BB Now, FK Minutes, Amazon Now, Noon UAE/KSA |
| Ad automation: best time slots, bids per slot | Haan: actions + triggers + revert = dayparting |
| "Just Ask AI" | Haan: Clarity agent service with runs/sessions |
| Root-cause drill-down | Partial: crossFilterTable aur stores view. Detailed pages login ke peeche hain |
| PO / supply chain | Partial: alag EDI service hai, uska UI code login ke peeche hai |
| Competitor intelligence, SoV, pricing | Login ke peeche ke chunks me hai, public bundle me nahi dikha |

## 5. Apna version banana ho to (blueprint)

1. **Data ingestion:**
   - Brand-authorised portal logins (headless browser + session vault) se platform reports aur ad data.
   - Pin-code-wise dark-store crawler se availability, price, rank aur SoV.
   - Meta/Google OAuth connectors.
2. **Warehouse + semantic layer:** ClickHouse/Postgres + Cube.js. Cubes: `sales`, `availability`, `keyword_rank`, `ads_campaigns`, `stores_count`.
3. **Rule engine:** trigger (metric, operator, threshold, time window) → action (bid ±%, pause, budget) → optional revert time. Ek scheduler har 15 min / hourly chalega.
4. **Ads executor:** har platform ka adapter (Blinkit / Zepto / Instamart / Amazon Ads API).
5. **AI agent:** LLM + tools (Cube query, rule create) + async runs + MCP server.
6. **Multi-tenant RBAC:** org → brand → channel scoped permissions; plan-based module gating.

Upload ki gayi Hakuhodo "E-Genie Rules" image ka rule builder (conditions, schedule Continuously/Daily/Custom, email results, bulk ops, cross-platform hub) Dcluttr ke automation wizard + bulk-edit + portfolio modules se almost 1:1 match karta hai.

## 6. Limits
- Sirf pre-login bundle (29 chunks, ~1.6 MB) dekha. Availability, SoV, pricing, competitor aur PO pages ka UI code login ke peeche hai.
- Source maps publish nahi hain.
- Backend logic (scraping method, data refresh rate, ML models) client code se nahi dikhta. Upar ki architecture inference hai.
- Agle step ke liye: aapka invitation link aapke liye hai. Aap khud apne account se login karke us browser session me REA `observe-web-session` / `analyze-web-bundle` chala sakte hain, tab dashboard modules bhi analyze ho jayenge.

## Raw evidence
`/private/tmp/claude-501/-Volumes-AmanSSD-Projects-rea-revers/05d554c4-4986-4918-ad5b-9eaddbd7e5ae/scratchpad/rea-web/out/`: `app-bundle.json`, `app-page.json`, `www-*.json`, `login.html`, `js/` (downloaded chunks)
