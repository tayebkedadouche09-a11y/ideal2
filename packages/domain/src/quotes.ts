/**
 * Quote domain — configurable fiscal computation (spec §71: rates never
 * hardcoded; the rate is supplied per request from DB/config) and lifecycle
 * policy (§11: Draft → Review → Approved → Sent → Accepted/Rejected → Converted).
 */
export const QUOTE_TRANSITIONS: Record<string, string[]> = {
  draft: ['review', 'cancelled'],
  review: ['approved', 'draft'],
  approved: ['sent'],
  sent: ['accepted', 'rejected'],
  accepted: ['converted'],
  rejected: ['draft'],
  converted: [],
};

export function canTransitionQuote(from: string, to: string): boolean {
  return (QUOTE_TRANSITIONS[from] ?? []).includes(to);
}

export interface QuoteLineInput {
  quantity: number;
  unitPrice: number;
  /** Optional per-line discount, percent. */
  discountPercent?: number;
}

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
}

/** round2 everywhere — money never carries sub-centime drift. */
export function computeQuoteTotals(lines: QuoteLineInput[], taxRatePercent: number): QuoteTotals {
  if (taxRatePercent < 0 || taxRatePercent > 100) throw new Error('Tax rate must be between 0 and 100');
  let subtotal = 0;
  let discount = 0;
  for (const l of lines) {
    const gross = l.quantity * l.unitPrice;
    const disc = gross * ((l.discountPercent ?? 0) / 100);
    subtotal += gross;
    discount += disc;
  }
  const net = subtotal - discount;
  const taxAmount = net * (taxRatePercent / 100);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { subtotal: r2(subtotal), discount: r2(discount), taxAmount: r2(taxAmount), total: r2(net + taxAmount) };
}
