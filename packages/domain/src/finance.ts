/**
 * Project cost model — spec §49. Operational profitability is separate from
 * statutory accounting (spec §34 note; fiscal mappings live in finance config).
 */

export interface PlannedCostBreakdown {
  materials: number;
  labor: number;
  transport: number;
  vehicles: number;
  equipment: number;
  subcontracting: number;
  other: number;
}

export interface ActualCostBreakdown {
  materials: number;
  labor: number;
  fuel: number;
  vehicleCosts: number;
  equipment: number;
  subcontracting: number;
  otherExpenses: number;
}

export function plannedCost(b: PlannedCostBreakdown): number {
  return round2(b.materials + b.labor + b.transport + b.vehicles + b.equipment + b.subcontracting + b.other);
}

export function actualCost(b: ActualCostBreakdown): number {
  return round2(b.materials + b.labor + b.fuel + b.vehicleCosts + b.equipment + b.subcontracting + b.otherExpenses);
}

export interface ProfitabilityInput {
  revenue: number;
  planned: PlannedCostBreakdown;
  actual: ActualCostBreakdown;
}

export interface ProfitabilityResult {
  revenue: number;
  plannedCost: number;
  actualCost: number;
  operationalMargin: number;
  marginPercent: number;
  costVariance: number;
  variancePercent: number;
  atRisk: boolean;
}

/** Revenue − actual cost = operational margin; variance = actual − planned. */
export function projectProfitability(input: ProfitabilityInput): ProfitabilityResult {
  const pc = plannedCost(input.planned);
  const ac = actualCost(input.actual);
  const margin = round2(input.revenue - ac);
  const variance = round2(ac - pc);
  const marginPercent = input.revenue > 0 ? Math.round((margin / input.revenue) * 1000) / 10 : 0;
  const variancePercent = pc > 0 ? Math.round((variance / pc) * 1000) / 10 : 0;
  return {
    revenue: round2(input.revenue),
    plannedCost: pc,
    actualCost: ac,
    operationalMargin: margin,
    marginPercent,
    costVariance: variance,
    variancePercent,
    atRisk: marginPercent < 10 || variancePercent > 15,
  };
}

export type InvoiceStatus = 'draft' | 'approved' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

/** Derive invoice status from payments (authoritative backend, spec §35). */
export function invoiceStatus(total: number, paid: number, dueDate: Date | null, now = new Date()): InvoiceStatus {
  if (total <= 0) return 'draft';
  if (paid >= total) return 'paid';
  if (paid > 0) return dueDate && dueDate < now ? 'overdue' : 'partially_paid';
  return dueDate && dueDate < now ? 'overdue' : 'issued';
}

/** Outstanding debt on an invoice. */
export function outstanding(total: number, paid: number): number {
  return round2(Math.max(0, total - paid));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
