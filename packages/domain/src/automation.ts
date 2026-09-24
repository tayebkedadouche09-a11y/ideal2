/**
 * Domain — BOQ totals + automation rule matching (spec §9, §44, §65).
 * Pure functions, no DB access; unit-tested.
 */

// ---------- BOQ (Bill of Quantities) ----------

export const BOQ_LINE_KINDS = ['measurement', 'material', 'labor', 'equipment', 'transport', 'other'] as const;
export type BoqLineKind = (typeof BOQ_LINE_KINDS)[number];

export interface BoqLineInput {
  kind: string;
  quantity: number;
  unit_price: number;
  waste_factor_percent?: number | null;
  discount_percent?: number | null;
}

export interface BoqTotals {
  lines: { quantity_with_waste: number; line_total: number }[];
  subtotal: number;
  discount_total: number;
}

/** Round to the precision used by the DB (quantity NUMERIC(14,3), money NUMERIC(14,2)). */
function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/**
 * BOQ line math (spec §65): material lines get waste applied to the quantity,
 * then price; non-material lines ignore waste. Discount applies after waste.
 * Rounded to the same precision as the database columns.
 */
export function computeBoqTotals(lines: BoqLineInput[]): BoqTotals {
  let subtotal = 0;
  let discountTotal = 0;
  const out = lines.map((l) => {
    const qty = Number(l.quantity) || 0;
    const price = Number(l.unit_price) || 0;
    const wastePct = l.kind === 'material' ? Math.max(0, Number(l.waste_factor_percent) || 0) : 0;
    const qtyWithWaste = qty * (1 + wastePct / 100);
    const gross = qtyWithWaste * price;
    const discPct = Math.max(0, Number(l.discount_percent) || 0);
    const discount = gross * (discPct / 100);
    const qtyRounded = roundTo(qtyWithWaste, 3);
    const lineTotal = roundTo(gross - discount, 2);
    subtotal += lineTotal;
    discountTotal += roundTo(discount, 2);
    return { quantity_with_waste: qtyRounded, line_total: lineTotal };
  });
  return { lines: out, subtotal: roundTo(subtotal, 2), discount_total: roundTo(discountTotal, 2) };
}

// ---------- Automation rule matching (spec §44) ----------

export interface RuleTriggerContext {
  trigger_type: string;
  [key: string]: unknown;
}

export interface RuleDefinition {
  trigger_type: string;
  conditions: Record<string, unknown>;
}

/**
 * A rule matches when trigger_type is equal and every condition entry matches
 * the event context. Condition values support:
 *   - primitive equality (string/number/boolean)
 *   - { gte: n } / { lte: n } numeric comparators (e.g. days_overdue)
 * Unknown condition keys never match. Empty conditions = match any event of
 * that trigger type.
 */
export function ruleMatches(rule: RuleDefinition, ctx: RuleTriggerContext): boolean {
  if (rule.trigger_type !== ctx.trigger_type) return false;
  const conditions = rule.conditions ?? {};
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = ctx[key];
    if (actual === undefined || actual === null) return false;
    if (typeof expected === 'object' && expected !== null) {
      const op = expected as { gte?: number; lte?: number };
      const num = Number(actual);
      if (Number.isNaN(num)) return false;
      if (op.gte !== undefined && !(num >= Number(op.gte))) return false;
      if (op.lte !== undefined && !(num <= Number(op.lte))) return false;
    } else if (String(actual) !== String(expected)) {
      return false;
    }
  }
  return true;
}
