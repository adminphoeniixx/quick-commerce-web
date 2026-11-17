import { describe, expect, it } from "vitest";
import { deterministicMatch, normalizeTitle, parsePackSize } from "../src/normalize";

describe("marketplace normalization", () => {
  it("normalizes punctuation and case", () => expect(normalizeTitle("  Coca-Cola® Zero ")).toBe("coca cola zero"));
  it("parses pack size", () => expect(parsePackSize("1 pack (500 ml)")).toEqual({ amount: 500, unit: "ml" }));
  it("never matches incompatible pack sizes", () => expect(deterministicMatch({ title: "Milk", brand: "A", packSize: "500 ml" }, { title: "Milk", brand: "A", packSize: "1 l" })).toBe(0));
});
