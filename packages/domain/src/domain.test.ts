import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRequirement, calculateProjectRequirement, availableStock, consumptionVariance } from './materials.js';
import { projectProfitability, invoiceStatus, outstanding } from './finance.js';
import { canTransitionQuote, computeQuoteTotals } from './quotes.js';
import { can, scope } from './roles.js';

test('resin coverage: 1250 m2, 2 layers at 1.5 kg/m2, 5% loss', () => {
  const r = calculateRequirement(
    { kind: 'area', areaSqm: 1250 },
    { coverageRatePerLayer: 1.5, coverageUnit: 'kg_per_m2', numberOfLayers: 2, lossPercent: 5, referenceThicknessMm: 0 },
  );
  assert.equal(r.baseQuantity, 3750);
  assert.equal(r.lossQuantity, 187.5);
  assert.equal(r.totalQuantity, 3937.5);
  assert.equal(r.unit, 'kg');
});

test('thickness-scaled liquid epoxy', () => {
  const r = calculateRequirement(
    { kind: 'volume', areaSqm: 500, thicknessMm: 2 },
    { coverageRatePerLayer: 1.1, coverageUnit: 'l_per_m2', numberOfLayers: 2, lossPercent: 10, referenceThicknessMm: 1 },
  );
  assert.equal(r.baseQuantity, 2200);
  assert.equal(r.totalQuantity, 2420);
});

test('rect measurement derives area from length x width', () => {
  const r = calculateRequirement(
    { kind: 'rect', lengthM: 50, widthM: 20 },
    { coverageRatePerLayer: 1.0, coverageUnit: 'kg_per_m2', numberOfLayers: 1, lossPercent: 0, referenceThicknessMm: 0 },
  );
  assert.equal(r.totalQuantity, 1000);
});

test('multi-zone aggregation sums across measurements', () => {
  const rs = calculateProjectRequirement(
    [
      { kind: 'area', areaSqm: 1000 },
      { kind: 'rect', lengthM: 30, widthM: 10 },
    ],
    { coverageRatePerLayer: 1.5, coverageUnit: 'kg_per_m2', numberOfLayers: 2, lossPercent: 5, referenceThicknessMm: 0 },
  );
  assert.equal(rs.totalQuantity, 4095);
});

test('rejects invalid measurement and layer counts', () => {
  assert.throws(() =>
    calculateRequirement(
      { kind: 'area', areaSqm: 0 },
      { coverageRatePerLayer: 1, coverageUnit: 'kg_per_m2', numberOfLayers: 1, lossPercent: 0, referenceThicknessMm: 0 },
    ),
  );
  assert.throws(() =>
    calculateRequirement(
      { kind: 'area', areaSqm: 100 },
      { coverageRatePerLayer: 1, coverageUnit: 'kg_per_m2', numberOfLayers: 0, lossPercent: 0, referenceThicknessMm: 0 },
    ),
  );
});

test('available stock = physical minus reserved', () => {
  assert.equal(availableStock({ physical: 500, reserved: 120 }), 380);
  assert.equal(availableStock({ physical: 100, reserved: 150 }), -50);
});

test('variance flags abnormal consumption above plus/minus 10%', () => {
  const v = consumptionVariance(500, 620);
  assert.equal(v.variance, 120);
  assert.equal(v.variancePercent, 24);
  assert.equal(v.abnormal, true);
  assert.equal(consumptionVariance(500, 520).abnormal, false);
});

test('project profitability: margin and at-risk detection', () => {
  const res = projectProfitability({
    revenue: 10_000_000,
    planned: { materials: 3_000_000, labor: 2_000_000, transport: 200_000, vehicles: 300_000, equipment: 100_000, subcontracting: 0, other: 400_000 },
    actual: { materials: 3_600_000, labor: 1_900_000, fuel: 150_000, vehicleCosts: 280_000, equipment: 120_000, subcontracting: 0, otherExpenses: 450_000 },
  });
  assert.equal(res.plannedCost, 6_000_000);
  assert.equal(res.actualCost, 6_500_000);
  assert.equal(res.operationalMargin, 3_500_000);
  assert.equal(res.marginPercent, 35);
  assert.equal(res.costVariance, 500_000);
  assert.equal(res.atRisk, false);
});

test('project at risk when margin under 10% or variance over 15%', () => {
  const low = projectProfitability({
    revenue: 1_000_000,
    planned: { materials: 700_000, labor: 100_000, transport: 0, vehicles: 0, equipment: 0, subcontracting: 0, other: 0 },
    actual: { materials: 850_000, labor: 100_000, fuel: 0, vehicleCosts: 0, equipment: 0, subcontracting: 0, otherExpenses: 0 },
  });
  assert.equal(low.atRisk, true);

  const highVariance = projectProfitability({
    revenue: 1_000_000,
    planned: { materials: 500_000, labor: 100_000, transport: 0, vehicles: 0, equipment: 0, subcontracting: 0, other: 0 },
    actual: { materials: 750_000, labor: 100_000, fuel: 0, vehicleCosts: 0, equipment: 0, subcontracting: 0, otherExpenses: 0 },
  });
  assert.equal(highVariance.atRisk, true);

  const healthy = projectProfitability({
    revenue: 1_000_000,
    planned: { materials: 700_000, labor: 100_000, transport: 0, vehicles: 0, equipment: 0, subcontracting: 0, other: 0 },
    actual: { materials: 700_000, labor: 100_000, fuel: 0, vehicleCosts: 0, equipment: 0, subcontracting: 0, otherExpenses: 0 },
  });
  assert.equal(healthy.atRisk, false);
});

test('invoice status transitions with payments and due date', () => {
  const now = new Date('2026-09-24');
  assert.equal(invoiceStatus(100000, 0, new Date('2026-09-01'), now), 'overdue');
  assert.equal(invoiceStatus(100000, 0, new Date('2026-10-01'), now), 'issued');
  assert.equal(invoiceStatus(100000, 40000, new Date('2026-10-01'), now), 'partially_paid');
  assert.equal(invoiceStatus(100000, 100000, new Date('2026-09-01'), now), 'paid');
  assert.equal(invoiceStatus(0, 0, null, now), 'draft');
});

test('outstanding never negative', () => {
  assert.equal(outstanding(100000, 40000), 60000);
  assert.equal(outstanding(100000, 150000), 0);
});

test('quote lifecycle allows only legal transitions', () => {
  assert.equal(canTransitionQuote('draft', 'review'), true);
  assert.equal(canTransitionQuote('review', 'approved'), true);
  assert.equal(canTransitionQuote('approved', 'sent'), true);
  assert.equal(canTransitionQuote('sent', 'accepted'), true);
  assert.equal(canTransitionQuote('accepted', 'converted'), true);
  assert.equal(canTransitionQuote('draft', 'approved'), false);
  assert.equal(canTransitionQuote('sent', 'converted'), false);
  assert.equal(canTransitionQuote('converted', 'draft'), false);
  assert.equal(canTransitionQuote('rejected', 'draft'), true);
});

test('quote totals: discount then configurable tax, centime-accurate', () => {
  const t = computeQuoteTotals(
    [
      { quantity: 1250, unitPrice: 2000, discountPercent: 5 },
      { quantity: 3, unitPrice: 50000 },
    ],
    19,
  );
  // 2,500,000 - 125,000 disc = 2,375,000; +150,000 = 2,525,000 net; tax 479,750; total 3,004,750
  assert.equal(t.subtotal, 2_650_000);
  assert.equal(t.discount, 125_000);
  assert.equal(t.taxAmount, 479_750);
  assert.equal(t.total, 3_004_750);
});

test('quote totals reject out-of-range tax rates', () => {
  assert.throws(() => computeQuoteTotals([{ quantity: 1, unitPrice: 100 }], 150));
  assert.throws(() => computeQuoteTotals([{ quantity: 1, unitPrice: 100 }], -1));
});

test('permission matrix: worker denied finance, owner approves quotes, customer portal-scoped', () => {
  assert.equal(can('worker', 'finance', 'read'), false);
  assert.equal(can('owner', 'quotes', 'approve'), true);
  assert.equal(can('accountant', 'finance', 'write'), true);
  assert.equal(can('accountant', 'settings', 'read'), false);
  assert.equal(can('customer', 'customer_portal', 'read'), true);
  assert.equal(scope('engineer', 'projects'), 'write');
});

import { computeBoqTotals, ruleMatches } from './automation.js';

test('BOQ totals: material waste applied to quantity, discount after waste', () => {
  const t = computeBoqTotals([
    { kind: 'material', quantity: 100, unit_price: 2000, waste_factor_percent: 10, discount_percent: 5 },
    { kind: 'labor', quantity: 8, unit_price: 1500, waste_factor_percent: 50 }, // waste ignored for labor
  ]);
  // material: 100 * 1.10 = 110 kg * 2000 = 220,000; -5% => 209,000
  assert.equal(t.lines[0]!.quantity_with_waste, 110);
  assert.equal(t.lines[0]!.line_total, 209000);
  // labor: waste ignored => 8 * 1500 = 12,000
  assert.equal(t.lines[1]!.line_total, 12000);
  assert.equal(t.subtotal, 221000);
  assert.equal(t.discount_total, 11000);
});

test('automation rule: trigger equality, primitive and comparator conditions', () => {
  const rule = { trigger_type: 'invoice_overdue', conditions: { severity: 'critical', days_overdue: { gte: 5 } } };
  assert.equal(ruleMatches(rule, { trigger_type: 'invoice_overdue', severity: 'critical', days_overdue: 7 }), true);
  assert.equal(ruleMatches(rule, { trigger_type: 'invoice_overdue', severity: 'critical', days_overdue: 2 }), false);
  assert.equal(ruleMatches(rule, { trigger_type: 'invoice_overdue', severity: 'high', days_overdue: 9 }), false);
  assert.equal(ruleMatches(rule, { trigger_type: 'stock_low', severity: 'critical', days_overdue: 9 }), false);
  const any = { trigger_type: 'incident_created', conditions: {} };
  assert.equal(ruleMatches(any, { trigger_type: 'incident_created', severity: 'low' }), true);
  assert.equal(ruleMatches(any, { trigger_type: 'quote_accepted' }), false);
});
