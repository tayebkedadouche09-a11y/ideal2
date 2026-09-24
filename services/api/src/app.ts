import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { authGuard } from './auth/guard.js';
import { authRoutes } from './auth/routes.js';
import { clientRoutes } from './modules/clients.js';
import { projectRoutes } from './modules/projects.js';
import { stockRoutes } from './modules/stock.js';
import { dashboardRoutes } from './modules/dashboard.js';
import { quoteRoutes } from './modules/quotes.js';
import { financeRoutes } from './modules/finance.js';
import { materialRoutes } from './modules/materials.js';
import { purchasingRoutes } from './modules/purchasing.js';
import { workforceRoutes } from './modules/workforce.js';
import { fleetRoutes } from './modules/fleet.js';
import { orgRoutes } from './modules/org.js';
import { documentRoutes } from './modules/documents.js';
import { commsRoutes } from './modules/comms.js';
import { portalRoutes } from './modules/portal.js';
import { intelligenceRoutes } from './modules/intelligence.js';
import { automationRoutes } from './modules/automation.js';
import { chatRoutes } from './modules/chat.js';
import { engineeringRoutes } from './modules/engineering.js';
import { fieldRoutes } from './modules/field.js';
import { HttpError } from './auth/rbac.js';
export function createApp() {
const app = Fastify({
  logger: true,
  requestIdHeader: 'x-request-id',
  trustProxy: true,
});

await app.register(jwt, { secret: config.jwtAccessSecret });
await app.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
});

// app.config declaration merged via module augmentation
declare module 'fastify' {
  interface FastifyInstance {
    config: typeof config;
    jwtVerify<T extends object = object>(options?: object): Promise<T & { sub: string; typ: string }>;
  }
}

app.decorate('config', config);

authGuard(app);
authRoutes(app);
clientRoutes(app);
projectRoutes(app);
stockRoutes(app);
dashboardRoutes(app);
quoteRoutes(app);
financeRoutes(app);
materialRoutes(app);
purchasingRoutes(app);
workforceRoutes(app);
fleetRoutes(app);
orgRoutes(app);
documentRoutes(app);
commsRoutes(app);
portalRoutes(app);
intelligenceRoutes(app);
automationRoutes(app);
chatRoutes(app);
  engineeringRoutes(app);
fieldRoutes(app);

app.get('/health', { onRequest: [] }, async () => ({ status: 'ok', time: new Date().toISOString() }));

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if ((err as { statusCode?: number }).statusCode === 401) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if ((err as { statusCode?: number }).statusCode === 429) {
    return reply.code(429).send({ error: 'Too many requests' });
  }
  req.log.error(err);
  // Never leak internals to clients (spec §38 input validation posture)
  return reply.code(500).send({ error: 'Internal server error' });
});


return app;
}
