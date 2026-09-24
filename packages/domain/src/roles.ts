/**
 * System roles — spec §39 (Role and permission system).
 */
export const ROLES = [
  'owner',
  'accountant',
  'engineer',
  'team_leader',
  'worker',
  'storekeeper',
  'driver',
  'customer',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, { en: string; fr: string; ar: string }> = {
  owner: { en: 'Owner / Director', fr: 'Propriétaire / Direction', ar: 'المالك / المدير' },
  accountant: { en: 'Accountant', fr: 'Comptable', ar: 'محاسب' },
  engineer: { en: 'Engineer / Project Manager', fr: 'Ingénieur / Chef de projet', ar: 'مهندس / مدير مشروع' },
  team_leader: { en: 'Team Leader', fr: 'Chef d’équipe', ar: 'رئيس فريق' },
  worker: { en: 'Worker', fr: 'Ouvrier', ar: 'عامل' },
  storekeeper: { en: 'Storekeeper', fr: 'Magasinier', ar: 'أمين المخزن' },
  driver: { en: 'Driver', fr: 'Chauffeur', ar: 'سائق' },
  customer: { en: 'Customer (portal)', fr: 'Client (portail)', ar: 'عميل (بوابة)' },
};

/**
 * Permissions — spec §54 Main navigation mapped to modules.
 * Scopes: read | write | approve | none
 */
export type PermissionScope = 'read' | 'write' | 'approve' | 'none';

export const MODULES = [
  'dashboard',
  'clients',
  'suppliers',
  'contracts',
  'quotes',
  'projects',
  'planning',
  'stock',
  'purchasing',
  'employees',
  'teams',
  'vehicles',
  'equipment',
  'finance',
  'documents',
  'communications',
  'ai',
  'reports',
  'settings',
  'audit',
  'customer_portal',
  'field',
] as const;

export type Module = (typeof MODULES)[number];

/**
 * Role → module scope matrix. Record-scope narrowing (e.g. engineer only sees
 * authorized projects, customer only sees own records) is enforced server-side
 * in addition to this matrix (spec §38 authorization layer 4).
 */
export const PERMISSION_MATRIX: Record<Role, Record<Module, PermissionScope>> = {
  owner: Object.fromEntries(MODULES.map((m) => [m, m === 'quotes' || m === 'purchasing' ? 'approve' : 'write'])) as Record<Module, PermissionScope>,
  accountant: {
    dashboard: 'read', clients: 'read', suppliers: 'read', contracts: 'read', quotes: 'read',
    projects: 'read', planning: 'none', stock: 'read', purchasing: 'read', employees: 'read',
    teams: 'none', vehicles: 'read', equipment: 'read', finance: 'write', documents: 'read',
    communications: 'none', ai: 'read', reports: 'read', settings: 'none', audit: 'read',
    customer_portal: 'none', field: 'read',
  },
  engineer: {
    dashboard: 'read', clients: 'read', suppliers: 'none', contracts: 'read', quotes: 'read',
    projects: 'write', planning: 'write', stock: 'read', purchasing: 'read', employees: 'read',
    teams: 'write', vehicles: 'read', equipment: 'read', finance: 'none', documents: 'write',
    communications: 'write', ai: 'read', reports: 'read', settings: 'none', audit: 'none',
    customer_portal: 'none', field: 'write',
  },
  team_leader: {
    dashboard: 'read', clients: 'none', suppliers: 'none', contracts: 'none', quotes: 'none',
    projects: 'read', planning: 'write', stock: 'read', purchasing: 'none', employees: 'read',
    teams: 'write', vehicles: 'read', equipment: 'read', finance: 'none', documents: 'write',
    communications: 'read', ai: 'read', reports: 'none', settings: 'none', audit: 'none',
    customer_portal: 'none', field: 'write',
  },
  worker: {
    dashboard: 'none', clients: 'none', suppliers: 'none', contracts: 'none', quotes: 'none',
    projects: 'read', planning: 'read', stock: 'none', purchasing: 'none', employees: 'none',
    teams: 'read', vehicles: 'none', equipment: 'none', finance: 'none', documents: 'none',
    communications: 'none', ai: 'read', reports: 'none', settings: 'none', audit: 'none',
    customer_portal: 'none', field: 'write',
  },
  storekeeper: {
    dashboard: 'read', clients: 'none', suppliers: 'read', contracts: 'none', quotes: 'none',
    projects: 'read', planning: 'none', stock: 'write', purchasing: 'write', employees: 'none',
    teams: 'none', vehicles: 'none', equipment: 'none', finance: 'none', documents: 'write',
    communications: 'none', ai: 'read', reports: 'none', settings: 'none', audit: 'none',
    customer_portal: 'none', field: 'write',
  },
  driver: {
    dashboard: 'none', clients: 'none', suppliers: 'none', contracts: 'none', quotes: 'none',
    projects: 'read', planning: 'read', stock: 'none', purchasing: 'none', employees: 'none',
    teams: 'none', vehicles: 'write', equipment: 'none', finance: 'none', documents: 'none',
    communications: 'none', ai: 'read', reports: 'none', settings: 'none', audit: 'none',
    customer_portal: 'none', field: 'write',
  },
  customer: {
    // Customer accounts are portal-only; internal ERP APIs remain closed.
    dashboard: 'none', clients: 'none', suppliers: 'none', contracts: 'none', quotes: 'none',
    projects: 'none', planning: 'none', stock: 'none', purchasing: 'none', employees: 'none',
    teams: 'none', vehicles: 'none', equipment: 'none', finance: 'none', documents: 'none',
    communications: 'none', ai: 'none', reports: 'none', settings: 'none', audit: 'none',
    customer_portal: 'read', field: 'none',
  },
};

export function scope(role: Role, module: Module): PermissionScope {
  return PERMISSION_MATRIX[role][module];
}

export function can(role: Role, module: Module, needed: Exclude<PermissionScope, 'none'>): boolean {
  const order: Record<PermissionScope, number> = { none: 0, read: 1, write: 2, approve: 3 };
  return order[PERMISSION_MATRIX[role][module]] >= order[needed];
}
