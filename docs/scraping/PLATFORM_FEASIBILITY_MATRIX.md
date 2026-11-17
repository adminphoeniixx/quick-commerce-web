# Marketplace collection feasibility

Reviewed 2026-10-28 from each platform's published terms. Capability means permitted, verified automated collection—not merely that a consumer UI displays the field.

| Platform | Discovery | Prices | Availability | Keywords | Sponsored | Live verified |
|---|---|---|---|---|---|---|
| Blinkit | Blocked without express written consent | Blocked | Blocked | Blocked | Blocked | No |
| Zepto | Prohibited by published terms | Blocked | Blocked | Blocked | Blocked | No |
| Swiggy Instamart | Blocked without prior written consent | Blocked | Blocked | Blocked | Blocked | No |
| Authorized provider feed | Adapter boundary available | Contract-dependent | Contract-dependent | Contract-dependent | Contract-dependent | No provider configured |

## Directly observed

- Blinkit's terms disallow commercial/derivative collection of product listings, descriptions, or prices and use of data-mining/robot tools without express prior written consent.
- Zepto's terms disallow robots, spiders, or equivalent automated monitoring/acquisition.
- Swiggy's terms disallow page-scraping, robots, spiders, or equivalent automated access without prior written consent.
- Public consumer pages can display titles, prices, pack sizes, and availability, but visibility is not authorization to automate collection.

## Implementation decision

The three adapters fail closed with `UNSUPPORTED_WITHOUT_WRITTEN_AUTHORIZATION`. No CAPTCHA bypass, private API reverse engineering, session sharing, or anti-bot evasion is implemented. An approved provider or written platform authorization is required before live collection can be enabled.
