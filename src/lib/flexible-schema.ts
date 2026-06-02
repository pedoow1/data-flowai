import { z } from "zod";

// ── Flexible cell type (core building block) ────────────────────────────────
export const CellSchema = z.object({
  v: z.string(),           // Extracted value
  c: z.number().min(0).max(100), // Confidence 0-100
});

export type Cell = z.infer<typeof CellSchema>;

// ── Flexible row: any string keys mapped to Cell values ───────────────────
export const FlexibleRowSchema = z.record(z.string(), CellSchema);
export type FlexibleRow = z.infer<typeof FlexibleRowSchema>;

// ── Multi-row schema for batch extraction ──────────────────────────────────
export const FlexibleMultiRowSchema = z.array(FlexibleRowSchema);

// ── Validation helpers ─────────────────────────────────────────────────────

export function isValidCell(x: unknown): x is Cell {
  return CellSchema.safeParse(x).success;
}

export function isValidRow(x: unknown): x is FlexibleRow {
  return FlexibleRowSchema.safeParse(x).success;
}

export function isValidRows(x: unknown): x is FlexibleRow[] {
  return FlexibleMultiRowSchema.safeParse(x).success;
}

// ── Normalize row: fill missing standard fields with placeholders ──────────
// This ensures compatibility with existing UI while accepting flexible fields
const STANDARD_FIELDS = ["invoiceNumber", "client", "date", "amount", "tax", "total"];

export function normalizeRow(row: FlexibleRow): FlexibleRow {
  const normalized: FlexibleRow = { ...row };
  
  // Ensure all standard fields exist (with "—" placeholder if missing)
  for (const field of STANDARD_FIELDS) {
    if (!(field in normalized)) {
      normalized[field] = { v: "—", c: 0 };
    }
  }
  
  return normalized;
}

// ── Extract column names from rows (for dynamic UI) ────────────────────────
export function extractColumnNames(rows: FlexibleRow[]): string[] {
  const columns = new Set<string>();
  
  // Add standard fields first (maintain order)
  for (const field of STANDARD_FIELDS) {
    columns.add(field);
  }
  
  // Add any additional fields found
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columns.add(key);
    }
  }
  
  return Array.from(columns);
}

// ── Format column name for display ────────────────────────────────────────
export function formatColumnName(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1") // camelCase to space-separated
    .replace(/^./, (c) => c.toUpperCase()) // Capitalize first letter
    .trim();
}
