import { describe, expect, it } from "vitest";
import { listingIssues } from "./ingest";

const base = {
  availabilityPct: 80, availabilityTarget: 50, storesLive: 300, storesClosed: 10, unitsPerStoreDay: 0.5, unitsTarget: 0.2,
  salesPerStoreDay: 100, salesTarget: 33, complaintPct: 0, complaintTarget: 3, descriptionLength: 400, imageCount: 6,
  missing: [] as { name: string; mandatory: boolean }[], units: 10, expansionLevel: "L4", assessmentEnd: null,
};
const codes = (o: Partial<typeof base>) => listingIssues({ ...base, ...o }).map((i) => i.code);

describe("listingIssues", () => {
  it("is clean for a healthy listing", () => expect(codes({})).toEqual([]));
  it("flags low availability and closed stores", () =>
    expect(codes({ availabilityPct: 20.21, storesLive: 307, storesClosed: 293 + 100 })).toEqual(["low_availability", "stores_closed"]));
  it("only flags expansion risk when both units and value miss target", () => {
    expect(codes({ unitsPerStoreDay: 0.05 })).toEqual([]);
    expect(codes({ unitsPerStoreDay: 0.05, salesPerStoreDay: 10 })).toEqual(["below_expansion_target"]);
  });
  it("flags content gaps", () => {
    expect(codes({ descriptionLength: 0, imageCount: 2, missing: [{ name: "Ingredients", mandatory: true }, { name: "Flavour", mandatory: false }] }))
      .toEqual(["no_description", "few_images", "missing_mandatory", "missing_attributes"]);
    expect(codes({ descriptionLength: 80 })).toEqual(["short_description"]);
  });
  it("reports only that a discontinued listing is discontinued", () =>
    expect(codes({ expansionLevel: "DISCONTINUED", availabilityPct: 0, storesLive: 0, storesClosed: 10, units: 0 })).toEqual(["discontinued"]));
  it("flags complaints at or above the limit and zero sales", () =>
    expect(codes({ complaintPct: 3, units: 0 })).toEqual(["complaints", "no_sales"]));
});
