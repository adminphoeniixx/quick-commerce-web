import { describe, expect, it } from "vitest";
import { getProductAdapter } from "./index";
import { suggestMapping, validateMapping, parseMapped } from "../mapping";

describe("product catalog adapter", () => {
  it("parses SKU, name, pack size, MRP, category and platform item id", () => {
    const { rows, errors } = getProductAdapter("blinkit").parse([
      { "SKU Code": "CF-1", "Product Name": "Chips 50g", "Pack Size": "50 g", "MRP": "₹20", "Category": "Snacks", "Item ID": "123" },
    ]);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ skuCode: "CF-1", name: "Chips 50g", packSize: "50 g", mrp: 20, category: "Snacks", platformProductId: "123" });
  });

  it("falls back to the platform item id when there is no SKU column", () => {
    const { rows } = getProductAdapter("zepto").parse([{ "Product ID": "Z-9", "Item Name": "Juice 1L" }]);
    expect(rows[0]).toMatchObject({ skuCode: "Z-9", name: "Juice 1L", platformProductId: "Z-9" });
  });

  it("reports rows without an id or a name", () => {
    const { rows, errors } = getProductAdapter("blinkit").parse([{ "Product Name": "No id" }, { "SKU Code": "X" }]);
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.message)).toEqual(["Missing SKU code", "Missing product name"]);
  });
});

describe("product mapping", () => {
  it("suggests, validates and parses a mapped catalog file", () => {
    const headers = ["item id", "product name", "mrp"];
    const mapping = Object.fromEntries(suggestMapping(headers, "products").map((m) => [m.source, m.target ?? ""]));
    expect(mapping).toEqual({ "item id": "platformProductId", "product name": "name", mrp: "mrp" });
    expect(validateMapping(mapping, "products")).toEqual([]);
    const { rows } = parseMapped([{ "item id": "77", "product name": "Atta 5kg", mrp: "300" }], mapping, "products", "blinkit");
    expect(rows[0]).toMatchObject({ skuCode: "77", name: "Atta 5kg", mrp: 300 });
  });

  it("requires a SKU code or item id", () => {
    expect(validateMapping({ "product name": "name" }, "products")).toContain("Map the SKU code or the platform item ID");
  });
});

describe("blinkit order-level sales summary", () => {
  it("maps Blinkit export columns, skips cancelled orders and carries catalog attributes", async () => {
    const { getAdapter } = await import("./index");
    const row = (id: string, status: string, qty: string, amt: string) => ({
      "Order Id": id, "Order Date": "2026-10-26", "Item Id": "10270514", "Product Name": "Trail Mix",
      "Business Category": "Grocery - Nuts", "Order Status": status, "Quantity": qty, "MRP (Rs)": "430", "Total Gross Bill Amount": amt,
    });
    const { rows, errors } = getAdapter("blinkit").parse([row("1", "DELIVERED", "2", "598"), row("2", "CANCELLED", "1", "299"), row("3", "DELIVERED", "1", "299")]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ skuCode: "10270514", date: "2026-10-26", gmv: 598, unitsSold: 2, productName: "Trail Mix", mrp: 430, category: "Grocery - Nuts" });
  });
});
