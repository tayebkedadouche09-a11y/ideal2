import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { requireScope, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth, type AuthContext } from '../auth/context.js';
import { ruleMatches, computeBoqTotals, type RuleDefinition, type RuleTriggerContext } from '@company-os/domain';

export const TRIGGER_TYPES = [
  'stock_low', 'invoice_overdue', 'project_delayed', 'incident_created', 'quote_accepted', 'approval_needed',
] as const;
export const ACTION_TYPES = ['notify', 'notify_role', 'create_purchase_suggestion', 'assign_task'] as const;

interface RuleBody {
  name?: string;
  trigger_type?: string;
  conditions?: Record<string, unknown>;
  action_type?: string;
  action_params?: Record<string, unknown>;
  enabled?: boolean;
}

interface TriggerContext {
  trigger_type: string;
  severity?: string;
  entity_type?: string;
  entity_id?: string;
  project_id?: string;
  material_id?: string;
  title?: string;
  body?: string;
  [key: string]: unknown;
}

/**
 * Emit an automation event: evaluate every enabled rule of this company for
 * the trigger type, run matching actions, and persist an automation_run row
 * per rule (success / no_match / failed) for traceability (spec §44, §54).
 * Never throws — failures are recorded, not propagated to the caller.
 */
export async function emitAutomationEvent(req: FastifyRequest, ctx: TriggerContext): Promise<number> {
  try {
    const auth = requireAuth(req);
    const rules = await pool.query<{ id: string; name: string; conditions: Record<string, unknown>; action_type: string; action_params: Record<string, unknown> }>(
      `SELECT id, name, conditions, action_type, action_params FROM automation_rule
        WHERE company_id = $1 AND enabled = true AND trigger_type = $2`,
      [auth.companyId, ctx.trigger_type],
    );
    let executed = 0;
    for (const rule of rules.rows) {
      const def: RuleDefinition = { trigger_type: ctx.trigger_type, conditions: rule.conditions ?? {} };
      const { trigger_type: _triggerType, ...ctxWithoutTriggerType } = ctx;
      const ruleCtx: RuleTriggerContext = { trigger_type: ctx.trigger_type, ...ctxWithoutTriggerType };
      const matched = ruleMatches(def, ruleCtx);
      let status: string = matched ? 'success' : 'no_match';
      let output: Record<string, unknown> | null = null;
      let error: string | null = null;
      if (matched) {
        try {
          output = await executeAction(rule.id, rule.name, rule.action_type, rule.action_params ?? {}, auth, ctx);
          executed++;
        } catch (e) {
          status = 'failed';
          error = e instanceof Error ? e.message : String(e);
        }
      }
      await pool.query(
        `INSERT INTO automation_run (rule_id, company_id, status, trigger_payload, action_output, error, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [rule.id, auth.companyId, status, ctx, output, error, auth.userId],
      );
      if (error) req.log.warn({ rule: rule.id, error }, 'automation action failed');
    }
    return executed;
  } catch (e) {
    req.log.error(e, 'emitAutomationEvent failed');
    return 0;
  }
}

/** 60-minute notification dedup per (kind, entity, title) — events may fire repeatedly. */
async function notificationExists(companyId: string, entityType: string | null, entityId: string | null, title: string): Promise<boolean> {
  const dup = await pool.query(
    `SELECT 1 FROM notification WHERE company_id = $1 AND kind = 'automation'
       AND entity_type IS NOT DISTINCT FROM $2 AND entity_id IS NOT DISTINCT FROM $3
       AND title = $4 AND created_at > now() - interval '60 minutes'`,
    [companyId, entityType, entityId, title],
  );
  return dup.rowCount !== null && dup.rowCount > 0;
}

async function executeAction(
  ruleId: string,
  ruleName: string,
  actionType: string,
  params: Record<string, unknown>,
  auth: AuthContext,
  ctx: TriggerContext,
): Promise<Record<string, unknown>> {
  const title = String(params.title ?? ctx.title ?? `Automation: ${ruleName}`);
  const bodyText = String(params.body ?? ctx.body ?? JSON.stringify(ctx).slice(0, 500));
  const entityType = ctx.entity_type ?? null;
  const entityId = ctx.entity_id ?? null;
  const severity = String(ctx.severity ?? 'info');

  switch (actionType) {
    case 'notify': {
      if (await notificationExists(auth.companyId, entityType, entityId, title)) return { skipped: 'dedup' };
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
         VALUES ($1,'automation',$2,$3,$4,$5,$6) RETURNING id`,
        [auth.companyId, severity, title, bodyText, entityType, entityId],
      );
      return { notification_id: ins.rows[0]!.id };
    }
    case 'notify_role': {
      const roleKey = String(params.role ?? 'owner');
      const users = await pool.query<{ user_id: string }>(
        `SELECT ur.user_id FROM user_role ur JOIN role r ON r.id = ur.role_id
          WHERE r.company_id = $1 AND r.key = $2`,
        [auth.companyId, roleKey],
      );
      if (users.rowCount === 0) {
        if (await notificationExists(auth.companyId, entityType, entityId, title)) return { skipped: 'dedup' };
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO notification (company_id, kind, severity, title, body, entity_type, entity_id)
           VALUES ($1,'automation',$2,$3,$4,$5,$6) RETURNING id`,
          [auth.companyId, severity, title, bodyText, entityType, entityId],
        );
        return { notification_id: ins.rows[0]!.id, fallback: 'company_wide' };
      }
      const ids: string[] = [];
      for (const u of users.rows) {
        if (await notificationExists(auth.companyId, entityType, entityId, title)) continue;
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO notification (company_id, user_id, kind, severity, title, body, entity_type, entity_id)
           VALUES ($1,$2,'automation',$3,$4,$5,$6,$7) RETURNING id`,
          [auth.companyId, u.user_id, severity, title, bodyText, entityType, entityId],
        );
        ids.push(ins.rows[0]!.id);
      }
      return { notified_users: ids.length };
    }
    case 'create_purchase_suggestion': {
      const materialId = String(params.material_id ?? ctx.material_id ?? '');
      if (!materialId) throw new Error('material_id required for purchase suggestion');
      const level = await pool.query<{ name: string; physical: string; min_stock: string; unit: string }>(
        `SELECT m.name, COALESCE(SUM(sl.physical),0) AS physical, m.min_stock, m.unit
           FROM material m LEFT JOIN stock_level sl ON sl.material_id = m.id
          WHERE m.id = $1 AND m.company_id = $2 GROUP BY m.id, m.name, m.min_stock, m.unit`,
        [materialId, auth.companyId],
      );
      const s = level.rows[0];
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO ai_recommendation (company_id, kind, severity, title, analysis, evidence, status)
         VALUES ($1,'restock',$2,$3,$4,$5,'open') RETURNING id`,
        [auth.companyId, severity, title,
         s ? `Stock ${s.physical} ${s.unit} (seuil ${s.min_stock}). Suggestion d'achat générée par la règle "${ruleName}".`
           : `Suggestion d'achat générée par la règle "${ruleName}".`,
         { rule_id: ruleId, rule_name: ruleName, trigger: ctx, stock: s ?? null }],
      );
      return { recommendation_id: ins.rows[0]!.id };
    }
    case 'assign_task': {
      const projectId = String(params.project_id ?? ctx.project_id ?? '');
      if (!projectId) throw new Error('project_id required for assign_task');
      const p = await pool.query(`SELECT 1 FROM project WHERE id = $1 AND company_id = $2`, [projectId, auth.companyId]);
      if (p.rowCount === 0) throw new Error('Project not found in this company');
      const assignee = params.assignee_employee_id ? String(params.assignee_employee_id) : null;
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO project_task (project_id, title, description, status, assignee_employee_id)
         VALUES ($1,$2,$3,'todo',$4) RETURNING id`,
        [projectId, title, bodyText, assignee],
      );
      return { task_id: ins.rows[0]!.id };
    }
    default:
      throw new Error(`Unknown action type ${actionType}`);
  }
}

export function automationRoutes(app: FastifyInstance): void {
  // Rules are configuration of company workflows — settings scope (owner only).
  app.get('/automation/rules', async (req) => {
    requireScope(req, 'settings', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT r.*, (SELECT count(*) FROM automation_run run WHERE run.rule_id = r.id AND run.status = 'success') AS run_count
         FROM automation_rule r WHERE r.company_id = $1 ORDER BY r.created_at DESC`, [auth.companyId],
    );
    return { rules: res.rows };
  });

  app.post('/automation/rules', async (req, reply) => {
    requireScope(req, 'settings', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as RuleBody;
    if (!b.name || !b.trigger_type || !b.action_type) throw new HttpError(400, 'name, trigger_type, action_type are required');
    if (!(TRIGGER_TYPES as readonly string[]).includes(b.trigger_type)) throw new HttpError(400, `trigger_type must be one of ${TRIGGER_TYPES.join('|')}`);
    if (!(ACTION_TYPES as readonly string[]).includes(b.action_type)) throw new HttpError(400, `action_type must be one of ${ACTION_TYPES.join('|')}`);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO automation_rule (company_id, name, trigger_type, conditions, action_type, action_params, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [auth.companyId, b.name, b.trigger_type, b.conditions ?? {}, b.action_type, b.action_params ?? {}, auth.userId],
    );
    await audit(req, 'create', 'automation_rule', res.rows[0]!.id, { name: b.name, trigger: b.trigger_type });
    return reply.code(201).send({ id: res.rows[0]!.id });
  });

  app.patch('/automation/rules/:id', async (req) => {
    requireScope(req, 'settings', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as RuleBody;
    const updates: string[] = [];
    const params: unknown[] = [];
    if (b.name !== undefined) { params.push(b.name); updates.push(`name = $${params.length}`); }
    if (b.conditions !== undefined) { params.push(JSON.stringify(b.conditions)); updates.push(`conditions = $${params.length}::jsonb`); }
    if (b.action_params !== undefined) { params.push(JSON.stringify(b.action_params)); updates.push(`action_params = $${params.length}::jsonb`); }
    if (b.enabled !== undefined) { params.push(b.enabled); updates.push(`enabled = $${params.length}`); }
    if (updates.length === 0) throw new HttpError(400, 'Nothing to update');
    params.push(auth.companyId); params.push(id);
    const res = await pool.query(
      `UPDATE automation_rule SET ${updates.join(', ')}, updated_at = now()
        WHERE id = $${params.length} AND company_id = $${params.length - 1} RETURNING id`,
      params,
    );
    if (res.rowCount === 0) throw new HttpError(404, 'Rule not found');
    await audit(req, 'update', 'automation_rule', id, b);
    return { ok: true };
  });

  app.delete('/automation/rules/:id', async (req) => {
    requireScope(req, 'settings', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await pool.query(`DELETE FROM automation_rule WHERE id = $1 AND company_id = $2 RETURNING id`, [id, auth.companyId]);
    if (res.rowCount === 0) throw new HttpError(404, 'Rule not found');
    await audit(req, 'delete', 'automation_rule', id, {});
    return { ok: true };
  });

  // Derived triggers evaluated from real state (cron-friendly, also callable by owner).
  app.post('/automation/tick', async (req) => {
    requireScope(req, 'dashboard', 'read');
    const auth = requireAuth(req);
    let executed = 0;
    const details: Record<string, number> = {};

    // 1. Overdue invoices — real due dates from issued/partially_paid invoices
    const overdue = await pool.query<{ id: string; number: string; days: number }>(
      `SELECT id, number, (CURRENT_DATE - due_date) AS days FROM invoice
        WHERE company_id = $1 AND status IN ('issued','partially_paid') AND due_date < CURRENT_DATE`,
      [auth.companyId],
    );
    for (const inv of overdue.rows) {
      executed += await emitAutomationEvent(req, {
        trigger_type: 'invoice_overdue',
        severity: inv.days >= 30 ? 'critical' : 'warning',
        entity_type: 'invoice',
        entity_id: inv.id,
        title: `Facture en retard: ${inv.number}`,
        body: `En retard de ${inv.days} jour(s).`,
        days_overdue: inv.days,
      });
    }
    details.invoice_overdue = overdue.rowCount ?? 0;

    // 2. Low stock — real levels vs configurable min_stock
    const low = await pool.query<{ id: string; name: string; physical: string; min_stock: string; unit: string }>(
      `SELECT m.id, m.name, sl.physical, m.min_stock, m.unit
         FROM stock_level sl JOIN material m ON m.id = sl.material_id
        WHERE sl.company_id = $1 AND sl.physical <= m.min_stock`,
      [auth.companyId],
    );
    for (const m of low.rows) {
      executed += await emitAutomationEvent(req, {
        trigger_type: 'stock_low',
        severity: Number(m.physical) === 0 ? 'critical' : 'warning',
        entity_type: 'material',
        entity_id: m.id,
        material_id: m.id,
        title: `Stock bas: ${m.name}`,
        body: `${m.physical} ${m.unit} restants (seuil ${m.min_stock}).`,
        quantity: Number(m.physical),
      });
    }
    details.stock_low = low.rowCount ?? 0;

    // 3. Delayed projects
    const delayed = await pool.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM project
        WHERE company_id = $1 AND delayed = true AND status = 'in_progress'`,
      [auth.companyId],
    );
    for (const p of delayed.rows) {
      executed += await emitAutomationEvent(req, {
        trigger_type: 'project_delayed',
        severity: 'warning',
        entity_type: 'project',
        entity_id: p.id,
        project_id: p.id,
        title: `Chantier en retard: ${p.code}`,
        body: p.name,
      });
    }
    details.project_delayed = delayed.rowCount ?? 0;

    await audit(req, 'export', 'automation_run', null, { executed, ...details });
    return { executed, evaluated: details };
  });

  // Manual emission (integration hooks, n8n, tests) — write scope on settings.
  app.post('/automation/events', async (req, reply) => {
    requireScope(req, 'settings', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as TriggerContext;
    if (!b.trigger_type || !(TRIGGER_TYPES as readonly string[]).includes(b.trigger_type)) {
      throw new HttpError(400, `trigger_type must be one of ${TRIGGER_TYPES.join('|')}`);
    }
    const executed = await emitAutomationEvent(req, b);
    return reply.code(201).send({ executed });
  });

  app.get('/automation/runs', async (req) => {
    requireScope(req, 'settings', 'read');
    const auth = requireAuth(req);
    const res = await pool.query(
      `SELECT run.*, r.name AS rule_name, r.trigger_type, r.action_type
         FROM automation_run run JOIN automation_rule r ON r.id = run.rule_id
        WHERE run.company_id = $1 ORDER BY run.created_at DESC LIMIT 100`,
      [auth.companyId],
    );
    return { runs: res.rows };
  });
}

// BOQ totals re-exported for API contract tests
export { computeBoqTotals };
