import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../db.js';
import { requireScope, assertProjectAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

interface VehicleBody {
  registration?: string; model?: string; type?: string; driver_employee_id?: string;
  insurance_expiry?: string; inspection_expiry?: string;
}
interface FuelBody { date?: string; mileage?: number; quantity_l?: number; price_per_l?: number; station?: string; project_id?: string }
interface MaintenanceBody {
  vehicle_id?: string; equipment_id?: string; kind?: string; date?: string; mileage?: number; hours?: number;
  description?: string; parts_cost?: number; labor_cost?: number; supplier_id?: string;
  next_due_date?: string; next_due_mileage?: number;
}

export function fleetRoutes(app: FastifyInstance): void {
  app.get('/vehicles', async (req) => {
    requireScope(req, 'vehicles', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(`SELECT * FROM vehicle WHERE company_id = $1 ORDER BY registration`, [auth.companyId]);
    return { vehicles: res.rows };
  });

  app.post('/vehicles', async (req, reply) => {
    requireScope(req, 'vehicles', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as VehicleBody;
    if (!b.registration) throw new HttpError(400, 'registration is required');
    const qr = `VQR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO vehicle (company_id, registration, model, type, driver_employee_id, insurance_expiry, inspection_expiry, qr_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [auth.companyId, b.registration, b.model ?? null, b.type ?? null, b.driver_employee_id ?? null,
       b.insurance_expiry ?? null, b.inspection_expiry ?? null, qr],
    );
    await audit(req, 'create', 'vehicle', res.rows[0]!.id, { registration: b.registration });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.get('/vehicles/:id', async (req) => {
    requireScope(req, 'vehicles', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(`SELECT * FROM vehicle WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (res.rowCount === 0) throw new HttpError(404, 'Vehicle not found');
    const [fuel, maint, tires, assignments] = await Promise.all([
      pool.query(`SELECT * FROM fuel_log WHERE vehicle_id = $1 ORDER BY date DESC LIMIT 50`, [id]),
      pool.query(`SELECT * FROM maintenance WHERE vehicle_id = $1 ORDER BY date DESC`, [id]),
      pool.query(`SELECT * FROM tire WHERE vehicle_id = $1`, [id]),
      pool.query(`SELECT * FROM vehicle_assignment WHERE vehicle_id = $1 AND active = true`, [id]),
    ]);
    const totalFuelCost = fuel.rows.reduce((s, f) => s + Number(f.quantity_l) * Number(f.price_per_l), 0);
    return { vehicle: res.rows[0], fuel: fuel.rows, maintenance: maint.rows, tires: tires.rows, assignments: assignments.rows, totalFuelCost };
  });

  app.post('/vehicles/:id/assign', async (req, reply) => {
    requireScope(req, 'vehicles', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { project_id?: string; driver_employee_id?: string; assigned_from?: string };
    if (b.project_id) assertProjectAccess(req, b.project_id);
    const assignment = await tx(async (c) => {
      await c.query(`UPDATE vehicle_assignment SET active = false WHERE vehicle_id = $1`, [id]);
      const r = await c.query<{ id: string }>(
        `INSERT INTO vehicle_assignment (vehicle_id, project_id, driver_employee_id, assigned_from, active)
         VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [id, b.project_id ?? null, b.driver_employee_id ?? null, b.assigned_from ?? null],
      );
      await c.query(
        `UPDATE vehicle SET status = CASE WHEN $2::uuid IS NULL THEN 'available' ELSE 'assigned' END WHERE id = $1`,
        [id, b.project_id ?? null],
      );
      return r.rows[0]!.id;
    });
    await audit(req, 'create', 'vehicle_assignment', assignment, b);
    return reply.code(201).send({ id: assignment });
  });

  app.post('/vehicles/:id/fuel', async (req, reply) => {
    requireScope(req, 'vehicles', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as FuelBody;
    if (!b.date || !b.mileage || !b.quantity_l || !b.price_per_l) {
      throw new HttpError(400, 'date, mileage, quantity_l, price_per_l are required');
    }
    if (b.project_id) assertProjectAccess(req, b.project_id);
    const out = await tx(async (c) => {
      const v = await c.query<{ current_mileage: number }>(`SELECT current_mileage FROM vehicle WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
      if (v.rowCount === 0) throw new HttpError(404, 'Vehicle not found');
      if (b.mileage! < v.rows[0]!.current_mileage) throw new HttpError(409, 'Mileage lower than current');
      const f = await c.query<{ id: string }>(
        `INSERT INTO fuel_log (company_id, vehicle_id, date, mileage, quantity_l, price_per_l, station, project_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.companyId, id, b.date, b.mileage, b.quantity_l, b.price_per_l, b.station ?? null, b.project_id ?? null, auth.userId],
      );
      await c.query(`UPDATE vehicle SET current_mileage = $2 WHERE id = $1`, [id, b.mileage]);
      return f.rows[0]!.id;
    });
    await audit(req, 'create', 'fuel_log', out, { vehicle_id: id, quantity_l: b.quantity_l });
    return reply.code(201).send({ id: out });
  });

  app.post('/vehicles/:id/maintenance', async (req, reply) => {
    requireScope(req, 'vehicles', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as MaintenanceBody;
    if (!b.kind || !b.date) throw new HttpError(400, 'kind and date are required');
    const total = Math.round(((b.parts_cost ?? 0) + (b.labor_cost ?? 0)) * 100) / 100;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO maintenance (company_id, vehicle_id, kind, date, mileage, hours, description, parts_cost, labor_cost, total_cost, supplier_id, next_due_date, next_due_mileage, created_by)
       VALUES ($1,$2,$3::maintenance_kind,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [auth.companyId, id, b.kind, b.date, b.mileage ?? null, b.hours ?? null, b.description ?? null,
       b.parts_cost ?? 0, b.labor_cost ?? 0, total, b.supplier_id ?? null, b.next_due_date ?? null, b.next_due_mileage ?? null, auth.userId],
    );
    await audit(req, 'create', 'maintenance', res.rows[0]!.id, { vehicle_id: id, kind: b.kind, total });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.post('/vehicles/:id/tires', async (req, reply) => {
    requireScope(req, 'vehicles', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { reference?: string; position?: string; condition?: string; cost?: number; installed_at?: string; installed_mileage?: number };
    if (!b.reference) throw new HttpError(400, 'reference is required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO tire (company_id, vehicle_id, reference, position, condition, cost, installed_at, installed_mileage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [auth.companyId, id, b.reference, b.position ?? null, b.condition ?? 'new', b.cost ?? null, b.installed_at ?? null, b.installed_mileage ?? null],
    );
    await audit(req, 'create', 'tire', res.rows[0]!.id, { vehicle_id: id, reference: b.reference });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.get('/equipment', async (req) => {
    requireScope(req, 'equipment', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(`SELECT * FROM equipment WHERE company_id = $1 ORDER BY name`, [auth.companyId]);
    return { equipment: res.rows };
  });

  app.post('/equipment', async (req, reply) => {
    requireScope(req, 'equipment', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { name?: string; serial_number?: string; kind?: string; responsible_employee_id?: string };
    if (!b.name) throw new HttpError(400, 'name is required');
    const qr = `EQR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO equipment (company_id, name, serial_number, kind, responsible_employee_id, qr_code)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [auth.companyId, b.name, b.serial_number ?? null, b.kind ?? null, b.responsible_employee_id ?? null, qr],
    );
    await audit(req, 'create', 'equipment', res.rows[0]!.id, { name: b.name });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.post('/equipment/:id/usage', async (req, reply) => {
    requireScope(req, 'equipment', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { date?: string; hours?: number; project_id?: string };
    if (!b.date || !b.hours) throw new HttpError(400, 'date and hours are required');
    if (b.project_id) assertProjectAccess(req, b.project_id);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO equipment_usage (equipment_id, project_id, date, hours) VALUES ($1,$2,$3,$4) RETURNING id`,
      [id, b.project_id ?? null, b.date, b.hours],
    );
    await pool.query(`UPDATE equipment SET usage_hours = usage_hours + $2 WHERE id = $1`, [id, b.hours]);
    await audit(req, 'create', 'equipment_usage', res.rows[0]!.id, { equipment_id: id, hours: b.hours });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });
}
