/** Environment configuration — secrets never in code. */
const isProduction = process.env.NODE_ENV === 'production';

function req(name:string, fallback?:string):string {
  const v = process.env[name] ?? (isProduction ? undefined : fallback);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: req('DATABASE_URL', 'postgres://companyos:companyos@localhost:5432/companyos'),
  jwtAccessSecret: req('JWT_ACCESS_SECRET', 'dev-only-access-secret'),
  jwtRefreshSecret: req('JWT_REFRESH_SECRET', 'dev-only-refresh-secret'),
  accessTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL ?? 900),
  refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL ?? 2_592_000),
  storageDir: process.env.STORAGE_DIR ?? './data/storage',
  storageProvider: process.env.STORAGE_PROVIDER ?? (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local'),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'company-documents',
  // Derived systems are rebuildable; business truth stays in PostgreSQL.
  llmProvider: process.env.LLM_PROVIDER ?? 'none',
  webOrigin: req('WEB_ORIGIN', 'http://localhost:5173'),
} as const;
