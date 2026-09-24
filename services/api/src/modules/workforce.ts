import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope, assertProjectAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

const ROLES = new Set(['engineer', 'team_leader', 'worker', 'driver', 'storekeeper', 'other']);

interface EmployeeBody {
  first_name?: string; last_name?: string; code?: string; national_id?: string; phone?: string;
  role?: string; skills?: string[]; daily_cost?: number; hourly_cost?: number; hired_at?: string; user_id?: string;
}

export function workforceRoutes(app: FastifyInstance): void {
  app.get('/employees', async (req) => {
    requireScope(req, 'employees', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(`SELECT * FROM employee WHERE company_id = $1 ORDER BY last_name, first_name`, [auth.companyId]);
    return { employees: res.rows };
  });

  app.post('/employees', async (req, reply) => {
    requireScope(req, 'employees', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as EmployeeBody;
    if (!b.first_name || !b.last_name || !b.role) throw new HttpError(400, 'first_name, last_name, role are required');
    if (!ROLES.has(b.role)) throw new HttpError(400, `role must be one of ${[...ROLES].join(', ')}`);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO employee (company_id, user_id, code, first_name, last_name, national_id, phone, role, skills, daily_cost, hourly_cost, hired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [auth.companyId, b.user_id ?? null, b.code ?? null, b.first_name, b.last_name, b.national_id ?? null,
       b.phone ?? null, b.role, b.skills ?? null, b.daily_cost ?? null, b.hourly_cost ?? null, b.hired_at ?? null],
    );
    await audit(req, 'create', 'employee', res.rows[0]!.id, { first_name: b.first_name, last_name: b.last_name, role: b.role });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.patch('/employees/:id', async (req) => {
    requireScope(req, 'employees', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as EmployeeBody & { active?: boolean };
    const fields = ['code', 'phone', 'role', 'skills', 'daily_cost', 'hourly_cost', 'active', 'user_id'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const f of fields) {
      if ((b as Record<string, unknown>)[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push((b as Record<string, unknown>)[f]); }
    }
    if (sets.length === 0) throw new HttpError(400, 'No fields to update');
    vals.push(id, auth.companyId);
    const res = await pool.query(`UPDATE employee SET ${sets.join(', ')} WHERE id = $${i++} AND company_id = $${i} RETURNING id`, vals);
    if (res.rowCount === 0) throw new HttpError(404, 'Employee not found');
    await audit(req, 'update', 'employee', id, b);
    return { ok: true };
  });

  app.get('/teams', async (req) => {
    requireScope(req, 'teams', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT t.*, e.first_name || ' ' || e.last_name AS leader_name
         FROM team t LEFT JOIN employee e ON e.id = t.leader_employee_id
        WHERE t.company_id = $1 ORDER BY t.name`, [auth.companyId],
    );
    const members = await pool.query(
      `SELECT tm.team_id, tm.employee_id, e.first_name, e.last_name, e.role
         FROM team_member tm JOIN employee e ON e.id = tm.employee_id
         JOIN team t ON t.id = tm.team_id
        WHERE t.company_id = $1`, [auth.companyId],
    );
    return { teams: res.rows.map((t) => ({ ...t, members: members.rows.filter((m) => m.team_id === t.id) })) };
  });

  app.post('/teams', async (req, reply) => {
    requireScope(req, 'teams', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { name?: string; leader_employee_id?: string; member_ids?: string[] };
    if (!b.name) throw new HttpError(400, 'name is required');
    const id = await pool.connect().then(async (c) => {
      try {
        await c.query('BEGIN');
        const t = await c.query<{ id: string }>(
          `INSERT INTO team (company_id, name, leader_employee_id) VALUES ($1,$2,$3) RETURNING id`,
          [auth.companyId, b.name, b.leader_employee_id ?? null],
        );
        const teamId = t.rows[0]!.id;
        for (const m of b.member_ids ?? []) {
          await c.query(
            `INSERT INTO team_member (team_id, employee_id) SELECT $1, x FROM (VALUES ($2::uuid)) v(x)
              WHERE EXISTS (SELECT 1 FROM employee e WHERE e.id = $2 AND e.company_id = $3)`,
            [teamId, m, auth.companyId],
          );
        }
        await c.query('COMMIT');
        return teamId;
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    });
    await audit(req, 'create', 'team', id, b);
    return reply.code(201).send({ id });
  });

  app.post('/teams/:id/assign', async (req, reply) => {
    requireScope(req, 'teams', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { project_id?: string; start_date?: string; end_date?: string; mission?: string };
    if (!b.project_id) throw new HttpError(400, 'project_id is required');
    assertProjectAccess(req, b.project_id);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO team_assignment (company_id, team_id, project_id, start_date, end_date, mission)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [auth.companyId, id, b.project_id, b.start_date ?? null, b.end_date ?? null, b.mission ?? null],
    );
    await audit(req, 'create', 'team_assignment', res.rows[0]!.id, b);
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.get('/attendance', async (req) => {
    requireScope(req, 'employees', 'read');
    const auth = requireAuth(req);
    const { date } = req.query as { date?: string };
    const res = await pool.query(
      `SELECT a.*, e.first_name, e.last_name, p.code AS project_code
         FROM attendance a JOIN employee e ON e.id = a.employee_id
         LEFT JOIN project p ON p.id = a.project_id
        WHERE a.company_id = $1 AND ($2::date IS NULL OR a.date = $2::date)
        ORDER BY a.date DESC LIMIT 200`,
      [auth.companyId, date ?? null],
    );
    return { attendance: res.rows };
  });

  app.post('/attendance', async (req, reply) => {
    requireScope(req, 'employees', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { employee_id?: string; date?: string; kind?: string; project_id?: string };
    if (!b.employee_id || !b.date || !b.kind) throw new HttpError(400, 'employee_id, date, kind are required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO attendance (company_id, employee_id, date, kind, project_id, recorded_by)
       VALUES ($1,$2,$3,$4::attendance_kind,$5,$6)
       ON CONFLICT (employee_id, date) DO UPDATE SET kind = $4::attendance_kind, project_id = $5, recorded_by = $6
       RETURNING id`,
      [auth.companyId, b.employee_id, b.date, b.kind, b.project_id ?? null, auth.userId],
    );
    await audit(req, 'create', 'attendance', res.rows[0]!.id, b);
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.get('/projects/:id/work-logs', async (req) => {
    requireScope(req, 'projects', 'read');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const res = await pool.query(
      `SELECT w.*, e.first_name, e.last_name FROM work_log w JOIN employee e ON e.id = w.employee_id
        WHERE w.project_id = $1 ORDER BY w.work_date DESC LIMIT 200`, [id],
    );
    return { workLogs: res.rows };
  });

  app.post('/projects/:id/work-logs', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as {
      employee_id?: string; work_date?: string; start_time?: string; end_time?: string; task?: string;
      work_performed?: string; quantity_done?: number; quantity_unit?: string; problems?: string;
    };
    if (!b.employee_id || !b.work_date) throw new HttpError(400, 'employee_id and work_date are required');
    const res = await pool.query<{ id: string }>(
      `INSERT INTO work_log (company_id, project_id, employee_id, work_date, start_time, end_time, task, work_performed, quantity_done, quantity_unit, problems)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [auth.companyId, id, b.employee_id, b.work_date, b.start_time ?? null, b.end_time ?? null,
       b.task ?? null, b.work_performed ?? null, b.quantity_done ?? null, b.quantity_unit ?? null, b.problems ?? null],
    );
    await audit(req, 'create', 'work_log', res.rows[0]!.id, { project_id: id, employee_id: b.employee_id });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });
}
