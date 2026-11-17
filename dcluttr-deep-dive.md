# Dcluttr: Deep Dive (clone banane ke liye)

Har round ki findings yahan append hoti hain. Har point ke saath **source/tool** aur **confidence** likha hai.
- **[Observed]**: code ya data me seedha dikha.
- **[Inferred]**: evidence se nikala gaya andaza.

Scope: sirf publicly available cheezein. Login, auth bypass ya fuzzing nahi kiya gaya.

## Tools jo is analysis me use hue

| Tool | Kis kaam ke liye |
|---|---|
| REA 6.7.0 (Docker) `list-browser-targets`, `inspect-web-page`, `analyze-web-bundle` | live page, scripts, endpoints, vendor fingerprint |
| REA `analyze-javascript-application` | 29 bundles ka semantic graph (actions, state, calls) |
| Headless Chromium (CDP :9222) | REA ka browser backend |
| curl / jq / python | public chunks download, env-config read, text extraction |
| apkeep (EFF) | APK download attempt (APKPure par app nahi mila) |
| DNS (`dig`), crt.sh (Certificate Transparency) | subdomains / infra |
| Web search / WebFetch | job posts, press, tech stack OSINT |
| App Store / Play Store / Framer images + Pillow | screenshots se UI aur metrics |
| MCP `.well-known` discovery | MCP server ka auth setup |
| GitHub search API + git clone (read-only) | hiring briefs, employee repos |

---

## Round 1: Frontend code se poora API contract
**Tools:** REA `analyze-javascript-application` (29 files, 361,925 AST nodes, 907 findings, 0 parse failures) + `calls.py`/`ctx.py` (har HTTP call site aur uske payload ka extractor). **Confidence:** sab [Observed].

### 1.1 Response envelope convention
- Ads service ke responses `{ success: bool, data, message }` shape me hain. Core API `{ status: "success", data, message, errors }` use karta hai. Validation error par **HTTP 422 + `detail`** aata hai, jo FastAPI ka signature hai. Isliye ads-automation-service shayad **Python FastAPI** me hai [Inferred].
- Paginated list ka shape: `{ results: [], meta: { total_items, page, page_size, total_pages } }`.
- Query params snake_case me hain (`brand_id`, `page_size`, `order_by=created_at:desc`). Report service camelCase (`brandId`) use karta hai. Dono alag teams/stacks lagte hain [Inferred].

### 1.2 Auth service (`auth.dcluttr.ai`)
| Method | Path | Body / params |
|---|---|---|
| POST | `/auth/login` | `{email, password}` |
| POST | `/auth/signup` | multipart: `file` (logo) + `signUpRequest` = JSON `{...form, mobile, invitationId?}` |
| POST | `/auth/otp/generate` / `verify` / `resend` | `{email}` / `{email, otp}` |
| POST | `/auth/logout` | `{refreshToken}`, timeout 3s |
| GET/POST | `/user/me`, `/user/me/update` | profile |
| POST | `/organization/add` | multipart: `file, name, organizationType, website` |
| GET | `/organization/my`, `/organization/{id}`, `/organization/{id}/users` | |
| POST | `/organization/update`, `/organization/{org}/remove-user/{user}`, `/organization/{org}/modify-access/{user}` | |
| POST | `/brand` | multipart: `file, name, monthlyAdSpend, website, orgId` |
| GET/POST | `/brand/{id}`, `/brand/update`, `/brand/{id}/navigation` | |
| POST | `/invitations` · GET `/invitations/{id}` · POST `/invitations/{id}/accept` · POST `/invitations/mine` · POST `/invitations/{id}/resend/{x}` | |
| GET | `/role/templates`, `/product-modules`, `/product-modules/available?brandIds=`, `/feature-toggle/brand/{id}` | |

**Signup flow:** step 1 form → OTP → step 2 verify → step 3 organization. Invitation ho to OTP verify ke turant baad auto-accept hota hai. Agar signup response me `accessToken` aa jaye to OTP skip ho jaata hai.

### 1.3 Ads automation service (`ads-automation-api.dcluttr.ai`)
| Method | Path | Body / params |
|---|---|---|
| GET | `/ads_automation_service/ad_automations` | `brand_id, page, page_size, order_by, status, name, platform[], input_value, input_type, action_type` |
| POST / PATCH | `/ads_automation_service/ad_automations[/{id}]` | `{...automationData, brand_id}` |
| DELETE | same | `{automation_ids:[], operation:"DELETE"\|"PAUSE"\|"UNPAUSE", actor:"USER"}` |
| GET | `/entity_levels?platform=`, `/campaign_types`, `/actions_and_triggers`, `/templates` | rule-builder ka catalog server se aata hai |
| POST | `/blinkit/config/suggested_keywords` | `{brand_id, product_ids}` |
| POST | `/blinkit/config/keyword_attributes` | `{brand_id, keywords, campaign_type, campaign_id}` |
| POST | `/blinkit/config/categories`, `category-attributes`, `categories-with-attributes` | `{brand_id, product_ids \| category_ids, campaign_type, campaign_id, city_ids, platform:"BLINKIT_ADS"}` |
| POST | `/zepto/config/login` | `{brand_id}`. Credentials server par stored hain. |
| POST | `/zepto/config/products` | `{brand_id, city_ids, limit, offset}` |
| POST | `/zepto/config/keyword-config` | `{brand_id, keywords}` |
| POST | `/zepto/config/targetings` | `{brand_id, product_variant_ids, targeting_type, campaign_name, keywords}` |
| PUT | `/campaigns?brand_id&platform=BLINKIT_ADS` | campaign update |
| GET | `/campaigns/bulk-create/template`, `/campaigns/bulk-edit/template?campaign_ids=` | Excel blob |
| POST/PUT | `/campaigns/bulk-create/validate`, `/campaigns/bulk-edit/validate[/json]` | multipart file ya JSON rows; `response_format=file` par annotated Excel wapas aata hai |
| PUT | `/campaigns/bulk-edit[/json]` | commit |
| GET/POST/DELETE | `/campaigns/group-templates` | `{brand_id, platform, sku_groups?, city_groups?, keyword_groups?}`; `group_type` filter |
| CRUD | `/ads_automation_service/portfolios` | `{name, description, brand_id, platform, campaign_ids, rules?}` |

**Automation wizard ka data model (Redux):**
```
automation = {
  brand_id, platform, type: "CAMPAIGN" (templateAutomationType), template?,
  actions: [{
     id, actionParams: {...},            // e.g. bid/budget change
     triggers: [{ id, ... }],            // conditions
     revert_enabled: bool, revert_time   // auto-undo → dayparting
  }]
}
```
Special Amazon IDs: `HARVEST_KEYWORD = "-1001"`, `HARVEST_PRODUCT_TARGET = "-1002"`.

### 1.4 Portfolio rule DSL (report service)
```json
{ "brandId": "..", "platforms": ["blinkit"], "name": "..", "description": "..",
  "entity_join_operator": "AND",
  "blocks": [{
     "entity_type": "campaign",            // dusre blocks: sku, ...
     "group_join_operator": "OR",
     "rule_join_operator": "AND",
     "definition": {
        "manual_ids": ["123"],
        "groups": [{ "rules": [{ "field": "name", "operator": "contains", "value": "protein" }] }]
     }
  }]
}
```
Server `ids` (resolved campaign IDs) return karta hai. Operators: `contains, equals, in, gt, gte, lt, lte, between`.

### 1.5 Report service (`report.dcluttr.ai`)
- `reports/catalog/{a}/{b}/{c}`, `reports/list`, `reports/details`, `POST reports/generate/...`, `reports/history`, `reports/status/...`, `reports/download/...`. Async report generation hai: generate → status poll → download.
- `api/report/reports[/{id}]`, `POST api/report/reports/{id}/execute`, `POST api/report/reports/{id}/tables/{tableId}/execute`. Configurable reports hain, har report me kai tables.
- `api/portfolios/skus`, `api/portfolios/campaigns`.
- **Targets (monthly goals):** `GET api/targets?brandId&month&platforms`, `PUT api/targets {brandId, month, cells:[{portfolio_id, platform[], metric, value}]}`. Har portfolio x metric ka monthly target set hota hai.

### 1.6 Cube.js query protocol
- `POST {apollo}/cubejs-api/v1/load`, headers `Authorization: Bearer <jwt>` + **`brandid: <id>`** (multi-tenant security context).
- Body: `{query, queryType:"multi", cache:"no-cache"}`. Agar response `{"error":"Continue wait"}` aaye to har 3s par poll (Cube ka standard long-query behaviour).
- `@cubejs-client/core` me `castNumerics: true`.
- Cube filter operators: `equals, contains, notSet, measureFilter`, aur `AND`/`OR` groups.

### 1.7 Meta (Facebook) Ads connector (meta service)
- Graph API **v19.0**, scopes `ads_read, pages_read_engagement, public_profile`. OAuth state `dcluttr-meta-oauth`, callback `/meta/callback`.
- UI states: `INTRO → EXCHANGING → PICK_ACCOUNTS → SUBMITTING`.
- Connection lifecycle: `NOT_CONNECTED, CONNECTING, FAILED, NEEDS_REAUTH, FIRST_SYNC, SYNC_RETRYING, SYNC_FAILED, SYNC_CANCELLED, AWAITING_DATA`.
- History backfill options: **3 / 6 / 12 / 24 months** (`sources/meta {accessToken, accountIds, months}`).
- Calls: `meta/exchange-token {userAccessToken}` → `meta/connect/accounts` → `sources/meta` → `PATCH sources/meta/access-token` (re-auth). Status poll ~20 min window (`12e5` ms), 15s interval [Inferred from constants].
- Google: `workflows/google {brandId, orgId, customerId}`. Facebook: `workflows/facebook {accountId}`.

### 1.8 AI agent (clarity)
`GET /api/agents` · `GET /api/sessions?brandId=` · `GET /api/sessions/{id}/messages` · `GET /api/runs/{id}` · `POST /api/runs/{id}/cancel`. Agents list ek in-memory promise me cache hoti hai. Message bhejne wala endpoint (stream) dashboard chunk me hai, public me nahi mila.

## Round 2: UI screens aur metrics dictionary (login ke peeche wale screens)
**Tools:** App Store (8 screenshots), Play Store (listing + screenshots), dcluttr.ai ki 74 Framer images (Pillow se contact sheets banake dekhi). **Confidence:** [Observed] screenshots me. Values marketing ke liye dummy ho sakti hain, lekin columns aur metric naam real product ke hain.

### 2.1 Mobile app (iOS/Android), "AI copilot for e-com brands"
- **Bottom nav:** `Overview · D2C · Creatives · Qcomm · Account`. D2C (Meta/Google) aur ad **creatives** ka alag tab hai.
- **Top bar:** brand logo + date range (`Last 30 Days`). Module dropdown: `Overview / Availability / Pricing / ...`. Platform tabs: `All · Blinkit · Zepto · Instamart`.
- **Freshness badges:** "Data across **3200 dark stores**", "**Updated 15s ago**". Store-store marketing claim: "Manage availability across **20,000 pincodes**".
- **Overview cards:** Top cities (donut: New Delhi/Mumbai/Bengaluru/Others, value + share% + delta), Top selling SKUs (units), Top selling categories (₹), KPI tiles: **Total sales, Total items sold, DRR (30) = Daily Run Rate, Max. Sales**, aur "Product Insights: analytics for all your SKUs".
- **Market Share card:** category-wise (e.g. "Chips & Munchies") `You` vs `Competitor Benchmark` line chart. "Competitor Market Share" table: Brand → Sales, Out of Stock %, with deltas.
- **Availability:** OSA % overall + per platform bars, "OSA (Top selling SKUs)".
- **Pricing:** Discount (₹) trend with Filters(3), tooltip per day, SKU chips, product card (image, price, MRP). Ye card customer app se scrape kiya hua product data lagta hai.
- **Recommendations card** (AI). Examples:
  - "Increase your CPM bid by ₹30 for 'banana chips'" [Zepto]: *Low visibility in 3 cities across 50 pincodes, dip in SOV…*
  - "Fulfil POs for 5 warehouses on Blinkit" [Blinkit]: *Low inventory detected in 12 dark stores, **DOI (Days of Inventory) < 15 days**…*
  - "Optimise availability for 10 SKUs: Move 1,203 units from Blinkit's DLF Phase 1 to Zepto's Koramangala… Zepto DRR 125 units, 300% higher". Matlab recommendation = **rule template + computed numbers + action link**.

### 2.2 Web dashboard layout (tablet screenshot)
- **Far-left rail:** brand switcher (multiple brand logos + "+"). **Icon sidebar:** Home, Chat (AI), Products/Box, Creatives/Image, Users, Help, Settings.
- **Main chart:** `Primary Metric ▾` + `Secondary Metric ▾` (dual-axis), granularity `Daily ▾`, SKU chips compare (1. Protein Bar 100g, 2. Chocolate Bar 100g), `SKU | Category` toggle, export button.
- **Competitor Insights table** ("Performance of your top competitors for the selected category and locality"): `Brand · Est. Market Share · Assortment · Wt. OSA% · Wt. OSA% in LS · DS Listing`, aur har brand ke liye "Show SKUs" drill-down.

### 2.3 Metrics dictionary (clone me ye sab calculate karne honge)
| Metric | Meaning | Kaise banta hai [Inferred] |
|---|---|---|
| **Est. Market Share** | category me brand ka estimated sales share | model: crawled signals se estimated sales / category total |
| **Category Share / Cat. Imp Share** | category impressions/listing share | search/category page par brand ki positions ka weighted share |
| **Assortment** | brand ke kitne SKUs listed hain | unique SKU count |
| **OSA %** | On-Shelf Availability | in-stock observations / total (store x SKU x time) |
| **Wt. OSA %** | sales-weighted OSA | OSA weighted by SKU/store sales importance |
| **Wt. OSA % in LS** | OSA sirf un stores me jahan SKU **Listed** hai | denominator = listed stores |
| **DS Listing %** | Dark-store listing coverage | listed dark stores / total dark stores |
| **Overall / Organic / Ad SOV** | Share of Voice (search results) | top-N results me brand ke slots (sponsored vs organic) |
| **Keyword Day-parted SOV** | SOV time slot wise | slots: `6-10am, 10am-2pm, 2-6pm, 6-10pm, 10pm+` |
| **Wt. Disc %** | weighted discount % | (MRP − SP)/MRP, sales-weighted |
| **Wt. PPU (x100)** | weighted Price Per Unit (per 100g/ml) | SP / pack size x 100 |
| **DRR** | Daily Run Rate (units/day) | 30-day average |
| **DOI** | Days of Inventory | inventory / DRR |
| **PSL** | Potential Sales Loss | OOS hours x DRR (estimate) |
| **Impact (locality)** | locality par sales impact score | PSL / market-share gap |
| Offtake, Units sold, Max Disc, Guardrail | pricing chart series / alert thresholds | |

### 2.4 Competition, Pricing aur SOV screens (website images)
- **Competition Overview** ("13 competitors"): Brand Name, Top SKUs, ... | **Competition Trends** (multi-brand line chart) | **Competition** table with Category Share ▲▼.
- **Platform comparison grid:** `Instamart · Blinkit · Zepto · BB Now · FK Mins` rows.
- **Brands table:** Sales, Out of Stock, Total Inventory (sortable, checkbox select → chart).
- **SKU → "Show Localities" popover:** Top Localities (Mayur Vihar, Saket, Dwarka, …) with Impact bars. Locality level data hai.
- **City → locality drill-down:** Bangalore → BTM Stage II 0% / DLF Phase 1 33% / Koramangala 70% OSA.
- **Keywords table:** Cat. Imp Share, Overall SOV, Org. SOV, Ad. SOV; keyword groups (Generic KW, …), per-keyword "Top Competition" popover.
- **Cross Platform Alerts:** SKU rows × columns `Guardrail · Blinkit · Zepto · Instamart · Max. Disc`, aur "Pricing mismatch" badge. Ek price guardrail set hota hai aur kisi platform par price uske bahar jaaye to alert aata hai.
- **Key Insights:** Brand → SKU expand with Wt. Disc%, Wt. PPU.
- **Discounting chart:** series toggle `Offtake · Market Share · Discount % · Unit Sold`. Discount ka market share par asar (price elasticity view).
- Customer logos me **Superyou** dikha (web dashboard screenshot me bhi).

## Round 3: Infrastructure aur internal tool stack
**Tools:** Certificate Transparency (crt.sh / certspotter: 76 hostnames), `dig` (CNAME/A/MX/TXT), har public service ke root par sirf ek GET (headers + error format). Koi scanning, path-guessing ya admin panel access nahi kiya.

### 3.1 Hosting
- **Har cheez AWS `ap-south-1` (Mumbai) par hai, ek hi ELB ke peeche** [Observed: sab subdomains ek ELB par CNAME hain]. Ek NetBird LB ka naam `k8s-netbird-…elb` hai, jo AWS Load Balancer Controller ka pattern hai. Isliye platform **Kubernetes (EKS)** par hai aur ingress-nginx ek shared ingress hai [Inferred; HSTS value bhi ingress-nginx default se match karti hai].
- **Marketing site:** Framer (`sites.framer.app`).
- **WhatsApp linking app:** `wa.dcluttr.ai` → **Railway** (Singapore edge), title "Connect your Dcluttr account". Isse WhatsApp alerts/bot ke liye account linking hoti hai.
- **Email:** Google Workspace (MX `smtp.google.com`), DMARC `p=none`.

### 3.2 Discovered services (CT logs) aur unka matlab
| Hostname | Tool / role | Clone ke liye matlab |
|---|---|---|
| `airbyte`, `airbyte-v2` | **Airbyte**: ELT connectors | Meta/Google/Shopify/Amazon data ingestion. `meta` service ke "workflows/sources" isi ko trigger karte hain [Inferred] |
| `argo-workflow`, `orchestrator`, `flow` | **Argo Workflows** on K8s | scraping/ETL jobs ka scheduling (har pin code crawl = ek workflow/pod) [Inferred] |
| `automq` | **AutoMQ** (S3-backed Kafka) | event streaming: scraper output → warehouse |
| `rabbitmq-v2` | **RabbitMQ** | task queue (ads actions, report generation, alerts) |
| `redisinsight` | **Redis** (+ RedisInsight GUI) | cache / locks / rate limit |
| `elastico`, `kibana` | **Elasticsearch + Kibana** | logs/observability (ya product search) |
| `metabase` | **Metabase** | internal BI |
| `s3`, `console.s3` | **MinIO** (self-hosted S3 + console) | raw scrape dumps, report files |
| `apollo`, `apollo-dev` | **Cube.js** (Express, production mode) | semantic layer [Observed: root page "Cube.js server is running in production mode"] |
| `monitor`, `firstwatch` | monitoring / alerting | |
| `netbird` | **NetBird** VPN (WireGuard) | internal tools ka private access |
| `deploy`, `launchpad` | deployment tooling (Argo CD jaisa) [Inferred] | |
| `ads-automation-scraper` | ad-console scraper | Blinkit/Zepto ad consoles se data aur action (unke paas public ads API nahi hai) |
| `brand-login-service` | brand portal session manager | health `{"status":"ok"}` |
| `edi`, `edi-app` | PO/EDI service + UI | FastAPI [Observed: `{"detail":"Not Found"}`] |
| `mcp` | MCP server (live) | `{"error":"NOT_FOUND"}` JSON |
| `clarity`, `clarity-api`, `clarity-harness.dev` | AI agent + **eval harness** | agent ke liye evaluation/test harness bhi hai |
| `vecna`, `vecna-api` (dev) | naya internal project (codename) | |
| `custom-dashboards-*` (dev) | **Custom dashboards** feature (alag auth service) | dev me hai |
| `toggle-sub-city-insights-dcluttr-ui.dev` | PR preview: **sub-city insights** toggle | upcoming feature |
| `exports-enh-dcluttr-ui.dev` | PR preview: exports enhancement | |
| `ui-np`…`ui-np-5`, `*-dev-v2..v5`, `smoke-test-*`, `preview-*`, `test-preview-*` | **Per-branch preview environments + smoke tests** | mature CI/CD: har PR ka apna K8s environment |
| `learn` | docs/learning portal | |

### 3.3 Backend language fingerprints (error formats se)
| Service | Response | Likely stack |
|---|---|---|
| auth | `{"status":"error","message":"…reference no:…"}`, multipart `@RequestPart`-style signup | Java Spring Boot ya Node, custom handler [Inferred, low] |
| ads-automation-api, brand-login-service | `{"status":"ok"}` health, 422 + `detail` | **Python FastAPI** [Inferred, medium] |
| edi | `{"detail":"Not Found"}` | **FastAPI** [Observed signature] |
| rule-engine | `{"status":"error","statusCode":404,"message":"Not found"}` | Node (NestJS/Express custom) [Inferred] |
| clarity / clarity-api | `404 Not Found` text/plain | Node/Bun (Hono-style) ya Go [Inferred, low] |
| apollo | `X-Powered-By: Express` + Cube banner | **Cube.js (Node)** [Observed] |
| meta, report, data-quality | `401` + `WWW-Authenticate: Bearer` | JWT-protected root |

## Round 4: OSINT (job posts, press, MCP discovery)
**Tools:** WebSearch/WebFetch (job boards, press), MCP ki standard `.well-known` discovery (wahi jo koi bhi MCP client padhta hai).

### 4.1 Hiring signals [Observed: third-party job boards. Posting purani ho sakti hai.]
- **Senior Data Engineer (Bengaluru):**
  - **ClickHouse** production experience, MergeTree, partitioning, **materialized views**, TTL, replication/sharding.
  - Advanced SQL (window functions, tuning). Batch + streaming, **Kafka** ya similar.
  - **Java preferred**, Python acceptable. **TB-scale** datasets.
  - Role: "analytics layer jo AI-driven decision systems ko feed karti hai". Source: [bebee listing](https://bebee.com/in/jobs/senior-data-engineer-dcluttr-bengaluru--talent-8d9f1548be89), search summary ke through.
- **Python Developer (Gurugram):**
  - Backend/distributed systems, **Airflow ya Temporal** workflow orchestration.
  - **Production me LLM-based systems**, microservices (REST / gRPC / event-driven).
  - Source: [weekday.works](https://jobs.weekday.works/python-developer-at-dcluttr-4398726594). Page ab sirf title dikhata hai; details search summary se hain.
- Ek engineer ke LinkedIn par React/Node/MongoDB hai. Lagta hai MongoDB bhi kisi service me use hota hai [low].
- **Conclusion:** Warehouse = **ClickHouse**, streaming = **Kafka (AutoMQ)**, orchestration = **Argo Workflows + Airflow/Temporal**, ingestion = **Airbyte** + custom scrapers, semantic layer = **Cube.js**, backend = **Python (FastAPI)** + Java/Node, frontend = Next.js.

### 4.2 MCP server (`mcp.dcluttr.ai`) [Observed]
- Protected resource: `https://mcp.dcluttr.ai/mcp`, `resource_name: "Dcluttr"`.
- OAuth 2.1 authorization server built-in: `/authorize`, `/token`, `/revoke`, **`/register` (Dynamic Client Registration)**, PKCE `S256`, grants `authorization_code` + `refresh_token`.
- Unauthenticated `initialize` call par `401 invalid_token` aata hai, saath me `resource_metadata` pointer. Endpoints ka layout MCP TypeScript SDK ke auth router jaisa hai [Inferred].
- Claude connector directory me listed hai (`claude.ai/directory/dcluttr`). Tools ki list login ke baad hi dikhti hai; ise access nahi kiya.

### 4.3 Founders / company context
- Co-founders Satwik Bhardwaj (ex-Walmart Global Tech omnichannel, AccioJob growth) aur Ritvik Nagpal. Dono pehle **SuperCrew** (D2C growth-marketing firm) chalate the. Isliye product ka focus "growth marketing + ads automation" par hai. Source: [The Week / Campus Fund](https://www.theweek.in/wire-updates/business/2025/09/01/dcm82-campus-fund.html).

---

## FINAL: Same tool kaise banayein (architecture blueprint)

Ye upar ke Observed + Inferred evidence se reconstruct kiya gaya hai.

```
                     ┌────────────── DATA SOURCES ──────────────┐
 (A) Customer-app crawl   (B) Brand portals        (C) Ad platforms        (D) D2C
  Blinkit/Zepto/Instamart  seller/ads consoles      Blinkit/Zepto ads UI    Meta/Google/Shopify
  per-pincode location     (brand-login-service:    (ads-automation-scraper) (Airbyte connectors)
  search, category, PDP    stored creds + sessions)
        │                        │                         │                   │
        └──────────── Argo Workflows / Airflow / Temporal (K8s jobs) ─────────┘
                                   │  raw JSON → MinIO (S3)
                                   ▼
                       Kafka (AutoMQ) topics  ──►  ClickHouse (MergeTree + MVs)
                                   │                     │
                         RabbitMQ (tasks)        Cube.js semantic layer (multi-tenant via brandid)
                                   │                     │
     ┌──────────── Rule engine ◄───┤        ┌────────────┼──────────────┬──────────────┐
     │  triggers → actions →       │     Next.js web   RN/Flutter app   AI agent       MCP server
     │  revert (dayparting)        │     dashboards    (Overview/Qcomm) (clarity:      (OAuth 2.1,
     ▼                             │                                     agents/runs)   DCR)
  Ads executor (Blinkit/Zepto/Amazon)   Alerts: WhatsApp (wa app), Slack, Email
  PO/EDI service                        Recommendations = rule templates + computed numbers
```

### Build order (MVP → full)
1. **Dark-store / pin-code master:**
   - Har platform ke dark stores aur unke serviceable pin codes ki table (`all_stores_count` jaisa).
   - Ye sab cheezon ki foundation hai. Unke paas ~3,200 dark stores aur 20,000 pin codes hain.
2. **Crawler fleet** (Python + Playwright/HTTP clients, K8s jobs via Argo):
   - Har (platform, store/pincode) ke liye keyword search, category listing aur PDP crawl.
   - Har observation record karo: `ts, platform, store_id, pincode, keyword, rank, is_sponsored, sku_id, brand, mrp, sp, in_stock, max_cart_qty`.
   - Day-parted SOV ke liye kam se kam 5 slots/day chahiye: 6-10am, 10am-2pm, 2-6pm, 6-10pm, 10pm+.
3. **Warehouse:**
   - ClickHouse me raw observations aur materialized views: OSA, Wt. OSA, DS Listing, SOV (overall/org/ad), Wt. Disc%, Wt. PPU.
4. **Estimation models:**
   - Competitor sales / Est. Market Share: rank + availability + stock-depletion signals se, aur brand ke apne actual sales se calibrate karke.
   - PSL = OOS duration × DRR.
5. **Brand data:**
   - Portal connectors (session vault, OTP handling), Airbyte ke through Meta/Google/Amazon Ads.
   - DRR, DOI aur PO data (EDI) inhi se aata hai.
6. **Semantic layer:** Cube.js cubes, `brandid` header se tenant isolation.
7. **Product UI:**
   - Overview, Availability, Visibility (keywords/SOV), Pricing (guardrails/mismatch alerts), Competition, Ads, Reports, Targets (monthly portfolio × metric goals).
   - Har jagah drill-down: city → locality → SKU.
8. **Ads automation:**
   - Platform adapters, rule engine (`actions[] { params, triggers[], revert_time }`), bulk Excel/JSON validate→commit, keyword harvest/negate.
9. **AI layer:**
   - Recommendations: rules + LLM wording.
   - Agent with tools (Cube query, rule create, report), async runs + cancel, aur eval harness.
   - MCP server with OAuth 2.1 + DCR.
10. **Platform:**
    - Org → Brand → User RBAC (`resource:scope:action`, channel-scoped), plan-based module gating, feature toggles, per-PR preview envs.

### Jo abhi bhi unknown hai (honest gaps)
- ~~Market-share model ka formula~~: Round 5 me inventory-delta method confirm hua.
- Exact anti-bot handling / proxy setup aur production me har platform ka exact endpoint.
- Data refresh cadence: "Updated 15s ago" ek UI claim hai.
- Login ke peeche wale dashboard pages ka code.
- Mobile app ka code: APK chahiye (REA `pull-adb-package`).

---

## Round 5: GitHub OSINT (sabse gehri findings)
**Tools:** GitHub search API (`dcluttr` query: 62 repos), `git clone --depth 1` (sirf padhne ke liye, kuch bhi run nahi kiya), grep.

> ⚠️ **Legal/ethics note:** `amit-dcluttr/dcluttr-flow` aur `dcluttr-flow-ui` ek Dcluttr employee ke public repos hain. Inme **koi license nahi hai**, yaani ye proprietary code hai jo shayad galti se public ho gaya.
> - Neeche sirf **architecture/design ideas** likhe hain. Ideas copyrightable nahi hote, code hota hai.
> - Apne product me **is repo ka code copy mat karna**.
> - `application.properties` me DB/S3/API-secret fields hain. Unki **values maine nahi dekhi aur use nahi ki**.
>
> Hiring-assignment repos candidates ke apne hain. Unme Dcluttr ke task briefs hain, jo candidates ko public share kiye gaye the.

### 5.1 Competitor data: confirmed method (Dcluttr ke apne hiring briefs se) [Observed]
**Task 1, "BlinkIt Category Scraping":**
- "When a user visits any subcategory page on BlinkIt, all the data displayed on the frontend is fetched via a **public API**. Identify the exact endpoint."
- Inputs: **latitude/longitude** + `l1_category_id` / `l2_category_id`.
- Candidates ne endpoint `POST /v1/layout/listing_widgets` bataya hai. Isme location query/cookie se jaati hai, aur session headers (`auth_key`, `device_id`, cookie) chahiye. Agar cookie ki location aur request ki lat/lon match na karein to `"location not serviceable"` aata hai. Matlab har location ke liye alag session chahiye. (Ye candidate ka observation hai.)

**Scraped stream ka schema (`all_blinkit_category_scraping_stream`):**
```
date, l1_category, l1_category_id, l2_category, l2_category_id,
store_id, variant_id, variant_name, group_id,
selling_price, mrp, in_stock, inventory, is_sponsored,
image_url, brand_id, brand
```
- `store_id` = dark store. Lat/lon resolve hokar ek dark store par map hota hai.
- **`inventory` = customer app me dikhne wali available quantity.**
- `is_sponsored` = ad slot (isi se SOV aur ad SOV banta hai).
- Data din me kai time slots par aata hai (examples: 6 PM, 12 AM).

**Task 2: derived table `blinkit_city_insights`** (inputs: scraping stream + `blinkit_categories` + `blinkit_city_map` (~1,023 Blinkit dark stores → city)):
```
date, brand_id, brand, image_url, city_name, sku_id, sku_name,
category_id, category_name, sub_category_id, sub_category_name,
est_qty_sold, est_sales_sp, est_sales_mrp,
listed_ds_count, ds_count, wt_osa, wt_osa_ls, mrp, sp, discount
```
**Formulas** (Dcluttr ke brief + candidate solutions se):
| Column | Logic |
|---|---|
| `est_qty_sold` | Har (SKU, store) ke liye do lagataar time slots compare karo. **Inventory ghati → difference = sold**. **Inventory badhi (restock) → pichhle X slots ka average sold**. |
| `est_sales_sp` / `est_sales_mrp` | Σ est_qty_sold × selling_price / mrp |
| `ds_count` | city ke total dark stores |
| `listed_ds_count` | jitne stores me SKU listed mila |
| `wt_osa` | in-stock stores / `ds_count` |
| `wt_osa_ls` | in-stock stores / `listed_ds_count` (OSA in Listed Stores) |
| `discount` | (mode MRP − mode SP) / mode MRP |

**Matlab "competitor market share" aise banta hai:**
1. Har competitor SKU ka `est_qty_sold` customer-app inventory ke ghatne se nikaalo.
2. Use `est_sales` me badlo.
3. Category total se divide karo.

Isliye ye ek **estimate** hai, asli sales data nahi.

### 5.2 Brand ka apna data: confirmed streams (`dcluttr-flow` seed data) [Observed]
Platform-wise report types jo ingest hote hain:
| Platform | Streams |
|---|---|
| **Blinkit** | `sales`, `sales_sellerhub`, `inventory`, `inventory_sellerhub`, `purchase_orders`, `invoice`, `debit_notes`, ads: `banner_listing`, `product_listing`, `product_recommendation`, `story`, `masthead`, `product_shelf`, `brand_booster` |
| **Zepto** | `sales`, `sales_f`, `inventory`, `purchase_orders`, `purchase_orders_lifecycle`, ads: `{display, products, brands}` × `{campaigns, cities, keywords, products}` |
| **Instamart** | `sales`, `inventory`, `ads`, `purchase_orders`, `pod_stock`, `invoice` |
| **BB Now** | `sales`, `inventory` |
| **Flipkart Minutes** | `sales`, `inventory`, `ads` |
| **Amazon Now** | `sales`, `inventory` |
| **Noon UAE / KSA** | `sales` |

Ye sab **seller-hub / brand-portal ke CSV/Excel reports** hain. `brand-login-service` inhe brand ke login se download karta hai, ya brand khud upload karta hai (`POST /upload/{connectionId}`, `fileUploadTypes[]`).

**Zepto analyst task ka official derived-table spec (`zepto_dark_store_insights`):**
| Field | Definition |
|---|---|
| qty_sold | Σ zepto_sales.units_sold |
| sales_mrp | gmv / sales_quantity × qty (Sales_Overview export se) |
| drr_7 / drr_14 | last 7 / 14 din ka avg qty_sold (sku × city × dark store) |
| dark_store_inv_qty | stock_on_hand.quantity jahan `store_type = RETAIL_STORE` (WAREHOUSE alag) |
| days_of_inventory_drr_14 (DOH) | dark_store_inv_qty / drr_14 |
| month_to_date_sales | MTD Σ sales_mrp |

Raw Zepto report columns: `Sales_Date, SKU_Name, SKU_ID, EAN, Vendor_ID, Vendor_Name, City, Brand_Name, Manufacturer_ID, Manufacturer_Name, Store_Name, SKU_Category, Quantity`, aur stock-on-hand me `Store_Type, Total_Quantity`.

### 5.3 `dcluttr-flow`: unka apna ELT engine (Airbyte replacement) [Observed: DESIGN.md]
- **Stack:** Java 21, Spring Boot 3.3, PostgreSQL 15 (control plane, Flyway migrations), AWS S3, ClickHouse (clickhouse-jdbc), Apache POI (Excel), opencsv, **Temporal** (job queue / workers).
- **Flow 1 (Upload):** file upload → stream definition ki **ordered pipeline steps** → S3.
  - Har step blocking (fail par upload abort) ya non-blocking (warning) hota hai.
  - 17 step types: `TRIM_TOP_ROWS, EXTRACT_SHEET, PIVOT_CSV, STRIP_BOM, STRIP_WHITESPACE, NORMALIZE_COLUMN, ADD_COLUMN, COLUMN_EXISTS(_ANY), EMPTY_CHECK, CELL_EMPTY_CHECK, FILE_FORMAT, STREAM_RULES, SKU_LOOKUP, CITY_LOOKUP, WAREHOUSE_LOOKUP, CONDITIONAL_LOOKUP`.
  - Matlab har platform ki messy Excel report ko config-driven tareeke se saaf karke standard banaya jaata hai.
- **Flow 2 (Sync):** S3 → ClickHouse.
  - **SQL pushdown** mode: ClickHouse ka native `s3()` table function `INSERT … SELECT` me use hota hai, data app se hokar nahi guzarta.
  - **APP** mode: 1000-row batches, Java field mapping ke saath.
  - Incremental cursor: processed S3 URLs ki JSON list.
  - **Schema drift detection:** header diff → `schema_history`.
- Credentials ek alag "connection resolver" service se aate hain, jo **HMAC-signed** calls aur cache TTL use karti hai.
- **Control-plane tables:** `sources, destinations, stream_definition, streams, upload_pipeline_steps, stream_transformations, sync_jobs, schema_history`.
- **`dcluttr-flow-ui`** (React + Vite + TS): Sources, Destinations, Connections (Streams / Schema / Transform / Runs tabs), Stream Definitions, Upload, Runs pages. Ye ek internal admin console hai (`flow.dcluttr.ai`). Repo me `CLAUDE.md` bhi hai, yaani team AI coding tools use karti hai.

### 5.4 Purana product (co-founder ka repo `ritviknagpal48/dcluttr`, May 2025)
- Landing page assets: `Overview, Creatives, attribution, journeys, know_your_profits, integrations`. Shuruaat me Dcluttr ek **D2C attribution / profit analytics** tool tha (Shopify + Meta). Isi wajah se mobile app me abhi bhi "D2C" aur "Creatives" tabs hain.

### 5.5 Clone ke liye iska matlab
1. **Competitor engine:**
   - Har platform ki customer-app/web listing API ko har dark-store location ke session se scrape karo, din me N slots.
   - Columns `inventory, in_stock, is_sponsored, sp, mrp` store karo.
   - **Inventory-delta model** se `est_qty_sold`.
   - Isse OSA, Wt. OSA, OSA-LS, discount aur market share banta hai.
2. **Brand engine:**
   - Platform report types (upar ki table) ko download/upload karo.
   - Config-driven cleaning steps → S3 → ClickHouse (`s3()` pushdown).
3. **Metrics:** DRR(7/14), DOH = inventory/DRR, MTD, PSL.
4. **Calibration:** brand ke actual sales (5.2) vs estimated (5.1) compare karke estimation model tune karo. Ye unka sabse bada edge ho sakta hai [Inferred].
