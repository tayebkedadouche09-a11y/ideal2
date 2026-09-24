/**
 * Material calculation engine — spec §19 (Industrial measurements) and §20
 * (Material calculation engine).
 *
 * RULES ARE DATA, NOT CODE: coverage rates, layers, loss percentages and
 * densities come from material_rule configuration (DB table material_rule).
 * The engine only applies them.
 */

export interface AreaMeasurement {
  kind: 'area';
  /** m² */
  areaSqm: number;
}

export interface RectMeasurement {
  kind: 'rect';
  lengthM: number;
  widthM: number;
}

export interface VolumeMeasurement {
  kind: 'volume';
  areaSqm: number;
  /** m */
  thicknessMm: number;
}

export type Measurement = AreaMeasurement | RectMeasurement | VolumeMeasurement;

export interface TechnicalRule {
  /** kg/m² per layer at reference thickness, or L/m² for liquid-by-volume */
  coverageRatePerLayer: number;
  coverageUnit: 'kg_per_m2' | 'l_per_m2';
  numberOfLayers: number;
  /** % loss/wastage (site conditions, application method) */
  lossPercent: number;
  /** mm of wet film the coverage rate refers to; 0 for per-layer products */
  referenceThicknessMm: number;
}

export interface CalculatedRequirement {
  baseQuantity: number;
  lossQuantity: number;
  totalQuantity: number;
  unit: string;
}

function normalizeArea(m: Measurement): number {
  switch (m.kind) {
    case 'area':
      return m.areaSqm;
    case 'rect':
      return m.lengthM * m.widthM;
    case 'volume':
      return m.areaSqm;
  }
}

/** Compute required quantity of a product for a measurement. */
export function calculateRequirement(measurement: Measurement, rule: TechnicalRule): CalculatedRequirement {
  const area = normalizeArea(measurement);
  if (area <= 0) throw new Error('Measurement area must be positive');
  if (rule.numberOfLayers <= 0) throw new Error('Number of layers must be positive');

  let base: number;
  if (rule.coverageUnit === 'kg_per_m2') {
    base = area * rule.coverageRatePerLayer * rule.numberOfLayers;
  } else {
    // Liquid volumetric: litres scaled by thickness relative to reference
    const thicknessFactor =
      rule.referenceThicknessMm > 0
        ? (measurement.kind === 'volume' ? measurement.thicknessMm : rule.referenceThicknessMm) /
          rule.referenceThicknessMm
        : 1;
    base = area * rule.coverageRatePerLayer * rule.numberOfLayers * thicknessFactor;
  }

  const loss = base * (rule.lossPercent / 100);
  return {
    baseQuantity: round3(base),
    lossQuantity: round3(loss),
    totalQuantity: round3(base + loss),
    unit: rule.coverageUnit === 'kg_per_m2' ? 'kg' : 'L',
  };
}

/** Aggregate multi-zone measurements for one product. */
export function calculateProjectRequirement(
  measurements: Measurement[],
  rule: TechnicalRule,
): CalculatedRequirement {
  return measurements.reduce<CalculatedRequirement>(
    (acc, m) => {
      const r = calculateRequirement(m, rule);
      return {
        baseQuantity: round3(acc.baseQuantity + r.baseQuantity),
        lossQuantity: round3(acc.lossQuantity + r.lossQuantity),
        totalQuantity: round3(acc.totalQuantity + r.totalQuantity),
        unit: r.unit,
      };
    },
    { baseQuantity: 0, lossQuantity: 0, totalQuantity: 0, unit: rule.coverageUnit === 'kg_per_m2' ? 'kg' : 'L' },
  );
}

export interface StockLevels {
  physical: number;
  reserved: number;
}

/** Available = physical − reserved (spec §22: distinguish physical/reserved/available). */
export function availableStock(s: StockLevels): number {
  return round3(s.physical - s.reserved);
}

/** Variance analysis — spec §20. Ratio > threshold flags abnormal consumption. */
export function consumptionVariance(planned: number, actual: number): {
  variance: number;
  variancePercent: number;
  abnormal: boolean;
} {
  const variance = round3(actual - planned);
  const variancePercent = planned > 0 ? Math.round((variance / planned) * 1000) / 10 : 0;
  return { variance, variancePercent, abnormal: Math.abs(variancePercent) > 10 };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
