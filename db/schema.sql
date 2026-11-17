-- =============================================================
--  Quick Commerce Pulse — PostgreSQL schema
--  A quick-commerce analytics data model (dcluttr-style),
--  designed from scratch for this clone. No third-party data.
--
--  Domain: a brand sells SKUs on q-commerce platforms
--  (Blinkit / Zepto / Instamart / BigBasket). Each SKU has a
--  per-platform listing; listings produce daily metrics,
--  availability snapshots (per city), pricing, and keyword SOV.
-- =============================================================

-- ---------- tenancy ----------
CREATE TABLE organizations (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       CITEXT UNIQUE NOT NULL,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'viewer'
              CHECK (role IN ('owner','admin','analyst','viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE brands (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT,                 -- e.g. 'Food & Beverages'
  logo_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- reference dimensions ----------
CREATE TABLE platforms (
  id            SMALLSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,          -- 'Blinkit'
  slug          TEXT UNIQUE NOT NULL,   -- 'blinkit'
  brand_color   TEXT                    -- hex for UI
);

CREATE TABLE cities (
  id       SMALLSERIAL PRIMARY KEY,
  name     TEXT NOT NULL,     -- 'Delhi NCR'
  region   TEXT               -- 'North'
);

CREATE TABLE keywords (
  id         BIGSERIAL PRIMARY KEY,
  brand_id   BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  term       TEXT NOT NULL,          -- 'potato chips'
  category   TEXT,
  UNIQUE (brand_id, term)
);

CREATE TABLE competitors (
  id        BIGSERIAL PRIMARY KEY,
  category  TEXT NOT NULL,
  name      TEXT NOT NULL
);

-- ---------- catalog ----------
CREATE TABLE skus (
  id           BIGSERIAL PRIMARY KEY,
  brand_id     BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,          -- 'Masala Potato Chips 52g'
  sku_code     TEXT NOT NULL,          -- internal code 'CF-MPC52'
  pack_size    TEXT,                   -- '52g'
  mrp          NUMERIC(10,2),
  category     TEXT,
  image_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, sku_code)
);

-- a SKU's listing on one platform (the join of catalog <-> platform)
CREATE TABLE platform_listings (
  id                   BIGSERIAL PRIMARY KEY,
  sku_id               BIGINT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  platform_id          SMALLINT NOT NULL REFERENCES platforms(id),
  platform_product_id  TEXT,                 -- the platform's own product id
  listing_url          TEXT,
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','delisted','paused')),
  first_seen_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (sku_id, platform_id)
);

-- ---------- fact tables (time-series) ----------
-- daily sales/GMV per listing (partition candidate on metric_date)
CREATE TABLE daily_metrics (
  listing_id     BIGINT NOT NULL REFERENCES platform_listings(id) ON DELETE CASCADE,
  metric_date    DATE NOT NULL,
  gmv            NUMERIC(14,2) NOT NULL DEFAULT 0,  -- gross merchandise value (INR)
  units_sold     INTEGER NOT NULL DEFAULT 0,
  avg_sell_price NUMERIC(10,2),
  discount_pct   NUMERIC(5,2),
  PRIMARY KEY (listing_id, metric_date)
);

-- availability per listing per city per day
CREATE TABLE availability_snapshots (
  listing_id       BIGINT NOT NULL REFERENCES platform_listings(id) ON DELETE CASCADE,
  city_id          SMALLINT NOT NULL REFERENCES cities(id),
  snapshot_date    DATE NOT NULL,
  stores_total     INTEGER NOT NULL,
  stores_in_stock  INTEGER NOT NULL,
  availability_pct NUMERIC(5,2)
    GENERATED ALWAYS AS (
      CASE WHEN stores_total > 0
           THEN round(100.0 * stores_in_stock / stores_total, 2)
           ELSE 0 END
    ) STORED,
  is_oos           BOOLEAN GENERATED ALWAYS AS (stores_in_stock = 0) STORED,
  PRIMARY KEY (listing_id, city_id, snapshot_date)
);

-- observed price per listing per city per day
CREATE TABLE pricing_snapshots (
  listing_id     BIGINT NOT NULL REFERENCES platform_listings(id) ON DELETE CASCADE,
  city_id        SMALLINT NOT NULL REFERENCES cities(id),
  snapshot_date  DATE NOT NULL,
  selling_price  NUMERIC(10,2) NOT NULL,
  mrp            NUMERIC(10,2),
  discount_pct   NUMERIC(5,2),
  PRIMARY KEY (listing_id, city_id, snapshot_date)
);

-- share-of-voice: brand's keyword ranking on a platform per day
CREATE TABLE share_of_voice (
  brand_id       BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform_id    SMALLINT NOT NULL REFERENCES platforms(id),
  keyword_id     BIGINT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  snapshot_date  DATE NOT NULL,
  avg_rank       NUMERIC(5,2),         -- lower is better
  sov_pct        NUMERIC(5,2),         -- share of voice %
  is_sponsored   BOOLEAN DEFAULT false,
  PRIMARY KEY (brand_id, platform_id, keyword_id, snapshot_date)
);

-- ---------- data pipeline / ingestion tracking ----------
CREATE TABLE sync_jobs (
  id             BIGSERIAL PRIMARY KEY,
  platform_id    SMALLINT REFERENCES platforms(id),
  job_type       TEXT NOT NULL,        -- 'availability' | 'pricing' | 'sov' | 'sales'
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','success','failed')),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  rows_ingested  INTEGER DEFAULT 0,
  error          TEXT
);

-- ---------- indexes for dashboard queries ----------
CREATE INDEX idx_listings_platform      ON platform_listings(platform_id);
CREATE INDEX idx_daily_date             ON daily_metrics(metric_date);
CREATE INDEX idx_avail_date_city        ON availability_snapshots(snapshot_date, city_id);
CREATE INDEX idx_price_date             ON pricing_snapshots(snapshot_date);
CREATE INDEX idx_sov_brand_date         ON share_of_voice(brand_id, snapshot_date);
CREATE INDEX idx_skus_brand             ON skus(brand_id);

-- ---------- convenience views (power the dashboard cards) ----------

-- GMV + units per brand / platform / day
CREATE VIEW v_brand_platform_daily AS
SELECT s.brand_id,
       pl.platform_id,
       dm.metric_date,
       SUM(dm.gmv)         AS gmv,
       SUM(dm.units_sold)  AS units
FROM daily_metrics dm
JOIN platform_listings pl ON pl.id = dm.listing_id
JOIN skus s               ON s.id = pl.sku_id
GROUP BY s.brand_id, pl.platform_id, dm.metric_date;

-- latest availability per SKU per platform (most recent snapshot, all cities)
CREATE VIEW v_sku_availability AS
SELECT s.id AS sku_id, s.brand_id, pl.platform_id,
       a.snapshot_date,
       round(avg(a.availability_pct), 1) AS avail_pct
FROM availability_snapshots a
JOIN platform_listings pl ON pl.id = a.listing_id
JOIN skus s               ON s.id = pl.sku_id
GROUP BY s.id, s.brand_id, pl.platform_id, a.snapshot_date;
