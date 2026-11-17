# Data provenance

Marketplace facts must originate from a contractually authorized feed and include product URL, observation URL, location key, city, platform product identifier, and timestamp. Each ingestion creates an immutable `ScrapingRun` and separate price/availability/ranking observations.

Missing observations are `UNKNOWN`, never inferred out-of-stock. Uploaded sales remain separate and are not inferred from rank, stock, or price. No fabricated marketplace records are shipped or seeded.
