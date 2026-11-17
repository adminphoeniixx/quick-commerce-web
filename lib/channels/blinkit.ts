// Parsers for the Blinkit seller-panel exports:
//  - "Sales Summary" (order-level, header on row 1)
//  - "Product Listing" (catalog; group-header row above the real header row)
import ExcelJS from "exceljs";

export interface OrderLine {
  orderId: string; itemId: string; orderDate: string; productName: string; brandName?: string; upc?: string;
  variant?: string; categoryPath?: string; businessCategory?: string; expansionLevel?: string;
  supplyCity?: string; supplyState?: string; customerCity?: string; customerState?: string;
  status: string; hsn?: string; quantity: number; mrp?: number; sellingPrice?: number;
  igstPct?: number; cgstPct?: number; sgstPct?: number; cessPct?: number;
  igstValue?: number; cgstValue?: number; sgstValue?: number; cessValue?: number; totalTax?: number; grossAmount: number;
}

export interface CatalogProduct {
  itemId: string; productId?: string; upc?: string; name: string; brandName?: string; uom?: string;
  mrp?: number; sellingPrice?: number; status?: string; businessCategory?: string; manufacturer?: string; hsn?: string;
  gstPct?: number; commissionPct?: number; commissionValue?: number; fulfillmentFee?: number;
  /** Every exported column, grouped as in the file (order preserved; jsonb would reorder object keys). */
  details: { group: string; fields: { label: string; value: string | number | null }[] }[];
}

export interface ParseResult<T> { rows: T[]; errors: { row: number; message: string }[] }

type Cell = string | number | null;

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("text" in v) return cellValue(v.text as ExcelJS.CellValue);
    if ("richText" in v) return cellValue(v.richText.map((t) => t.text).join(""));
  }
  return String(v);
}

async function sheetMatrix(buffer: Buffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const out: Cell[] = [];
    for (let c = 1; c <= ws.columnCount; c++) out.push(cellValue(row.getCell(c).value));
    rows[n - 1] = out;
  });
  return Array.from(rows, (r) => r ?? []);
}

const norm = (s: Cell) => String(s ?? "").trim().toLowerCase();
const str = (v: Cell) => (v == null ? undefined : String(v).trim() || undefined);
/** Numbers like 299, "299", "₹50.0", "₹ 1.00 /day" → 299, 50, 1. */
export function num(v: Cell): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}
function isoDate(v: Cell): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function findHeader(matrix: Cell[][], required: string[]): number {
  return matrix.findIndex((r) => required.every((h) => r.some((c) => norm(c) === h.toLowerCase())));
}

export async function parseSalesSummary(buffer: Buffer): Promise<ParseResult<OrderLine>> {
  const m = await sheetMatrix(buffer);
  const h = findHeader(m, ["Order Id", "Item Id", "Order Date"]);
  if (h < 0) throw new Error("Not a Blinkit Sales Summary file (Order Id / Item Id / Order Date columns missing)");
  const idx = new Map(m[h].map((c, i) => [norm(c), i]));
  const get = (r: Cell[], name: string) => { const i = idx.get(name.toLowerCase()); return i == null ? null : r[i]; };
  const rows: OrderLine[] = [];
  const errors: ParseResult<OrderLine>["errors"] = [];
  m.slice(h + 1).forEach((r, i) => {
    const rowNum = h + i + 2;
    if (!r.some((c) => c != null)) return;
    const orderId = str(get(r, "Order Id")), itemId = str(get(r, "Item Id")), orderDate = isoDate(get(r, "Order Date"));
    const quantity = num(get(r, "Quantity")), grossAmount = num(get(r, "Total Gross Bill Amount"));
    if (!orderId || !itemId) return errors.push({ row: rowNum, message: "Missing order or item id" });
    if (!orderDate) return errors.push({ row: rowNum, message: "Invalid order date" });
    if (quantity == null || grossAmount == null) return errors.push({ row: rowNum, message: "Missing quantity or amount" });
    rows.push({
      orderId, itemId, orderDate, quantity: Math.round(quantity), grossAmount,
      productName: str(get(r, "Product Name")) ?? itemId,
      brandName: str(get(r, "Brand Name")), upc: str(get(r, "UPC")), variant: str(get(r, "Variant Description")),
      categoryPath: str(get(r, "Mapping on consumer app (L0, L1, L2)")), businessCategory: str(get(r, "Business Category")),
      expansionLevel: str(get(r, "Expansion Level")), supplyCity: str(get(r, "Supply City")), supplyState: str(get(r, "Supply State")),
      customerCity: str(get(r, "Customer City")), customerState: str(get(r, "Customer State")),
      status: str(get(r, "Order Status")) ?? "UNKNOWN", hsn: str(get(r, "HSN Code")),
      mrp: num(get(r, "MRP (Rs)")), sellingPrice: num(get(r, "Selling Price (Rs)")),
      igstPct: num(get(r, "IGST(%)")), cgstPct: num(get(r, "CGST(%)")), sgstPct: num(get(r, "SGST(%)")), cessPct: num(get(r, "CESS(%)")),
      igstValue: num(get(r, "IGST Value")), cgstValue: num(get(r, "CGST Value")), sgstValue: num(get(r, "SGST Value")),
      cessValue: num(get(r, "CESS Value")), totalTax: num(get(r, "Total Tax")),
    });
  });
  return { rows, errors };
}

export async function parseProductListing(buffer: Buffer): Promise<ParseResult<CatalogProduct>> {
  const m = await sheetMatrix(buffer);
  const h = findHeader(m, ["Product ID", "Item ID", "Product name"]);
  if (h < 0) throw new Error("Not a Blinkit Product Listing file (Product ID / Item ID columns missing)");
  const header = m[h].map((c) => str(c) ?? "");
  // Group labels ("Product details", "Tax details", …) sit in the row above; merged cells repeat them.
  const groups = (h > 0 ? m[h - 1] : []).map((c) => str(c));
  const col = (name: string) => header.findIndex((x) => x.toLowerCase() === name.toLowerCase());
  const at = (r: Cell[], name: string) => { const i = col(name); return i < 0 ? null : r[i]; };
  const rows: CatalogProduct[] = [];
  const errors: ParseResult<CatalogProduct>["errors"] = [];
  m.slice(h + 1).forEach((r, i) => {
    const rowNum = h + i + 2;
    if (!r.some((c) => c != null)) return;
    const itemId = str(at(r, "Item ID")), name = str(at(r, "Product name"));
    if (!itemId || !name) return errors.push({ row: rowNum, message: "Missing item id or product name" });
    const details: CatalogProduct["details"] = [];
    let group = "Details";
    header.forEach((title, c) => {
      if (!title) return;
      group = groups[c] ?? group;
      let g = details[details.length - 1];
      if (!g || g.group !== group) details.push((g = { group, fields: [] }));
      g.fields.push({ label: title, value: r[c] ?? null });
    });
    rows.push({
      itemId, name, details,
      productId: str(at(r, "Product ID")), upc: str(at(r, "UPC/EAN/UPC Exemption Code")), brandName: str(at(r, "Brand name")),
      uom: str(at(r, "UoM")), mrp: num(at(r, "MRP")), sellingPrice: num(at(r, "Selling price")),
      status: str(at(r, "Expansion level")), businessCategory: str(at(r, "Business category")),
      manufacturer: str(at(r, "Parent company (Manufacturer)")), hsn: str(at(r, "HSN")),
      gstPct: num(at(r, "New IGST (After Sept 2025 reforms)")) ?? num(at(r, "Old IGST (Before Sept 2025 reforms)")),
      commissionPct: num(at(r, "Platform commission (%)")), commissionValue: num(at(r, "Platform commission value")),
      fulfillmentFee: num(at(r, "Fulfillment fee")),
    });
  });
  return { rows, errors };
}

export interface StockLine {
  itemId: string; itemName: string; upc?: string; uom?: string;
  warehouseId: string; warehouseName: string; city: string;
  netScheduled: number; incomingScheduled: number; recalled: number;
  totalSellable: number; warehouseUnits: number; inBetweenUnits: number; darkstoreUnits: number;
  totalUnsellable: number; damaged: number; lost: number; expired: number; nearExpiry: number;
  sold7d: number; sold15d: number; sold30d: number; remarks?: string;
}

/** "Lucknow L4", "Kolkata K4 - Feeder", "Kundli Feeder" → "Lucknow", "Kolkata", "Kundli". */
export function warehouseCity(name: string): string {
  return name.split(/\s+-\s+|\s+[A-Z]\d+\b|\s+(?:Feeder|Warehouse|SR|FC|DS)\b/i)[0].trim() || name;
}

/** Inventory → Bulk reports → "Stock on Hand" (one row per item × warehouse). */
export async function parseStockOnHand(buffer: Buffer): Promise<ParseResult<StockLine> & { generatedAt?: string }> {
  const m = await sheetMatrix(buffer);
  const h = findHeader(m, ["Item ID", "Warehouse Facility ID", "Total sellable"]);
  if (h < 0) throw new Error("Not a Blinkit Stock on Hand file (Item ID / Warehouse Facility ID columns missing)");
  const header = m[h].map((c) => norm(c));
  // Two "Last N days" groups are not present, but guard against duplicate titles by taking the first.
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const n0 = (v: Cell) => Math.round(num(v) ?? 0);
  const generated = String(m[0]?.[0] ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const rows: StockLine[] = [];
  const errors: ParseResult<StockLine>["errors"] = [];
  m.slice(h + 1).forEach((r, i) => {
    const rowNum = h + i + 2;
    if (!r.some((c) => c != null)) return;
    const at = (name: string) => { const c = col(name); return c < 0 ? null : r[c]; };
    const itemId = str(at("Item ID")), warehouseId = str(at("Warehouse Facility ID")), warehouseName = str(at("Warehouse Facility Name"));
    if (!itemId || !warehouseId || !warehouseName) return errors.push({ row: rowNum, message: "Missing item or warehouse" });
    const remarks = str(at("Remarks"));
    rows.push({
      itemId, warehouseId, warehouseName, city: warehouseCity(warehouseName),
      itemName: str(at("Item Name")) ?? itemId, upc: str(at("UPC")), uom: str(at("UoM")),
      netScheduled: n0(at("Net scheduled inventory")), incomingScheduled: n0(at("Incoming scheduled inventory")), recalled: n0(at("Recalled inventory")),
      totalSellable: n0(at("Total sellable")), warehouseUnits: n0(at("Warehouse")), inBetweenUnits: n0(at("In-between")), darkstoreUnits: n0(at("Darkstore")),
      totalUnsellable: n0(at("Total unsellable")), damaged: n0(at("Damaged")), lost: n0(at("Lost")), expired: n0(at("Expired")), nearExpiry: n0(at("Near Expiry")),
      sold7d: n0(at("Last 7 days")), sold15d: n0(at("Last 15 days")), sold30d: n0(at("Last 30 days")),
      remarks: remarks && remarks !== "--" ? remarks : undefined,
    });
  });
  return { rows, errors, generatedAt: generated };
}
