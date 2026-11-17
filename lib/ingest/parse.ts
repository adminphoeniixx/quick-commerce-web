import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import type { RawRow } from "./contracts";

export async function parseTabular(buffer: Buffer): Promise<RawRow[]> {
  return (await parseTabularSheet(buffer)).rows;
}

export async function parseTabularSheet(buffer: Buffer, selectedSheet?: string): Promise<{ rows: RawRow[]; sheetNames: string[]; selectedSheet: string; headers: string[] }> {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) return parseWorkbook(buffer, selectedSheet);
  const matrix = parseCsv(buffer, { bom: true, relax_column_count: true, skip_empty_lines: false }) as unknown[][];
  return matrixToRows(matrix, ["CSV"], "CSV");
}

async function parseWorkbook(buffer: Buffer, selectedSheet?: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheetNames = workbook.worksheets.map(sheet => sheet.name);
  const sheetName = selectedSheet || sheetNames[0];
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : undefined;
  if (!sheetName || !sheet) throw new Error("Worksheet not found");
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, row => {
    const values: unknown[] = [];
    for (let column = 1; column <= sheet.columnCount; column++) values.push(row.getCell(column).text ?? "");
    matrix.push(values);
  });
  return matrixToRows(matrix, sheetNames, sheetName);
}

function matrixToRows(matrix: unknown[][], sheetNames: string[], selectedSheet: string) {
  const headerRow = matrix.findIndex(row => row.some(value => String(value ?? "").trim()));
  if (headerRow < 0) return { rows: [], sheetNames, selectedSheet, headers: [] };
  const headers = matrix[headerRow].map(value => String(value ?? "").trim());
  const rows: RawRow[] = [];
  for (const values of matrix.slice(headerRow + 1)) {
    if (!values.some(value => String(value ?? "").trim())) continue;
    const row: RawRow = {};
    headers.forEach((header, index) => { if (header) row[header] = String(values[index] ?? ""); });
    rows.push(row);
  }
  return { rows, sheetNames, selectedSheet, headers };
}

export function assertFileFormat(name: string, buffer: Buffer): "CSV" | "EXCEL" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("File content is not a valid XLSX workbook");
    return "EXCEL";
  }
  if (!lower.endsWith(".csv")) throw new Error("Only .csv and .xlsx files are supported");
  if (buffer.includes(0) || buffer.toString("utf8").includes("\ufffd")) throw new Error("CSV must be valid UTF-8 text");
  return "CSV";
}
