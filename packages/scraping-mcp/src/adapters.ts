import type { AdapterResult, MarketplaceAdapter, Platform, SearchInput } from "./contracts.js";

const RESTRICTIONS: Record<Exclude<Platform, "AUTHORIZED_FEED">, string> = {
  BLINKIT: "Blinkit's terms prohibit collection/derivative use of product listings and data-mining tools without express prior written consent.",
  ZEPTO: "Zepto's terms prohibit robots, spiders, or equivalent automated monitoring.",
  INSTAMART: "Swiggy's terms prohibit page-scraping, robots, and spiders without prior written consent.",
};

class RestrictedAdapter implements MarketplaceAdapter {
  constructor(readonly platform: Exclude<Platform, "AUTHORIZED_FEED">) {}
  async checkAvailability() {
    return { healthy: false, code: "UNSUPPORTED_WITHOUT_WRITTEN_AUTHORIZATION", message: RESTRICTIONS[this.platform] };
  }
  async searchProducts(_input: SearchInput): Promise<AdapterResult> {
    return { supported: false, code: "UNSUPPORTED_WITHOUT_WRITTEN_AUTHORIZATION", reason: RESTRICTIONS[this.platform] };
  }
}

class AuthorizedFeedAdapter implements MarketplaceAdapter {
  readonly platform = "AUTHORIZED_FEED" as const;
  async checkAvailability() {
    const configured = Boolean(process.env.AUTHORIZED_MARKETPLACE_FEED_URL && process.env.AUTHORIZED_MARKETPLACE_FEED_TOKEN);
    return { healthy: configured, code: configured ? "OK" : "PROVIDER_NOT_CONFIGURED", message: configured ? "Authorized feed configured" : "Configure an approved provider feed URL and token" };
  }
  async searchProducts(_input: SearchInput): Promise<AdapterResult> {
    // Provider request/response contracts differ. Deliberately fail closed until a
    // reviewed provider-specific client is configured; never fall back to scraping.
    return { supported: false, code: "PROVIDER_NOT_CONFIGURED", reason: "No reviewed authorized provider client is configured" };
  }
}

const adapters: Record<Platform, MarketplaceAdapter> = {
  BLINKIT: new RestrictedAdapter("BLINKIT"),
  ZEPTO: new RestrictedAdapter("ZEPTO"),
  INSTAMART: new RestrictedAdapter("INSTAMART"),
  AUTHORIZED_FEED: new AuthorizedFeedAdapter(),
};

export function getAdapter(platform: Platform): MarketplaceAdapter { return adapters[platform]; }
export function allAdapters(): MarketplaceAdapter[] { return Object.values(adapters); }
