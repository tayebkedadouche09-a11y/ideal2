# IDEAIL / Company OS — Master Product Specification
## V1 → V2 → V3 | Single Product, Multi-Device, Cloud-Ready

> **Document status:** Living master specification  
> **Repository:** `tayebkedadouche09-a11y/ideal2`  
> **Branch:** `main`  
> **Purpose:** This document is the source of product direction for human developers and coding agents. It describes what already exists, what must be completed, and the intended evolution of the same application into a cloud-connected PC + Android + iOS product.

---

## 1. Product Vision

IDEAIL / Company OS is one integrated operating system for an industrial-contractor company.

It is designed for businesses working with:
- industrial flooring and protection;
- resin / epoxy;
- coatings;
- waterproofing;
- sandblasting and surface preparation;
- decorative / technical concrete;
- construction and industrial works.

The product combines:

**ERP + field operations + documents + finance + stock + projects + communications + automation + intelligence + customer portal.**

The product is **one application**, not separate V1/V2/V3 applications.

V1, V2 and V3 are product evolution phases only.

### Final product principle

A user can use the same company account from:
- PC / Web;
- Android;
- iPhone / iPad.

The same backend, database, authentication, permissions, audit trail and business data are shared.

---

# 2. Non-Negotiable Product Rules

1. **Do not rebuild the project from zero.**
2. Existing working modules must be preserved unless a change is required and verified.
3. V1/V2/V3 are phases of the same product.
4. PostgreSQL is the source of truth.
5. Supabase is the intended managed PostgreSQL + Storage cloud layer.
6. The API is the source of authorization truth; hiding a menu in the UI is not security.
7. Every company-owned record must remain company-scoped.
8. Customer accounts must never gain access to internal ERP modules.
9. Critical financial and approval actions require explicit server-side authorization.
10. Payments remain append-only; corrections use reversal records.
11. AI/intelligence must not silently change critical business data.
12. Automation must be auditable.
13. Database migrations are additive and versioned; never casually drop production data.
14. Secrets are never committed to GitHub and never placed in client-side code.
15. Coding agents may improve the design and suggest additions, but must respect the architecture and explain breaking changes before implementing them.
16. Any proposed feature that overlaps an existing capability should extend it rather than create a duplicate system.
17. Before declaring a feature complete, run the relevant typecheck/build/tests and verify its API/database integration.

---

# 3. Current Repository / V1 Foundation

## 3.1 Current technical stack

### Backend
- Node.js / TypeScript
- Fastify 5
- PostgreSQL
- JWT authentication
- refresh-token rotation
- RBAC / permission scopes
- audit architecture
- multipart/document upload support
- rate limiting

### Frontend
- React 18
- TypeScript
- Vite
- Material UI
- React Router
- responsive web interface
- FR / AR / EN foundations
- RTL support
- DZD formatting

### Database
- PostgreSQL migrations under `database/migrations/`
- multi-tenant `company_id` isolation
- audit-oriented architecture
- business entities for ERP and operations
- migrations are cumulative and additive

### Workspace
- npm workspaces
- `packages/domain`
- `packages/i18n`
- `services/api`
- `apps/web`

---

# 4. V1 — ERP Foundation

V1 establishes the operational ERP core.

## 4.1 Authentication

Implemented foundation:
- login;
- JWT access token;
- refresh token;
- refresh rotation;
- authenticated API requests;
- role information;
- permission scopes.

## 4.2 Roles

Current role model:

- Owner / Director
- Accountant
- Engineer / Project Manager
- Team Leader
- Worker
- Storekeeper
- Driver
- Customer (portal)

The customer role is intentionally portal-only.

## 4.3 Permission model

Permissions use:

- `none`
- `read`
- `write`
- `approve`

The server must enforce:
1. authentication;
2. role/module permission;
3. company isolation;
4. record scope;
5. action policy;
6. approval policy;
7. audit.

## 4.4 Core ERP domains

The current architecture covers the foundation for:

- companies / organization;
- users;
- clients;
- suppliers;
- contracts;
- quotes;
- projects;
- measurements;
- materials;
- stock;
- purchasing;
- employees / teams;
- workforce;
- vehicles;
- equipment;
- documents;
- finance;
- invoices / payments;
- reports;
- audit.

## 4.5 Industrial project chain

The intended business chain is:

Client
→ Contract
→ Quote
→ Project
→ Measurements
→ Material calculation
→ Stock reservation
→ Material consumption
→ Planned vs actual variance
→ Workforce
→ Vehicle / fuel
→ Project profitability
→ Invoice
→ Payment
→ Audit

Material calculations are data-driven through material rules rather than hardcoded product assumptions.

---

# 5. V2 — Operations, Intelligence and Collaboration

V2 turns the ERP into a real company operating system.

## 5.1 Project 360°

A project becomes the central operational workspace.

It can bring together:
- measurements;
- tasks;
- daily reports;
- consumption;
- incidents;
- documents;
- timeline;
- captures;
- zones;
- BOQ;
- lessons learned.

## 5.2 Daily Briefing

The system can present an operational briefing including:
- active projects;
- delayed projects;
- overdue invoices;
- stock autonomy;
- fleet maintenance;
- projects requiring attention.

The briefing is decision support, not an autonomous decision-maker.

## 5.3 Universal Capture

Field workers and managers can capture information through:
- photo;
- upload;
- document;
- voice-to-work;
- contextual metadata;
- project / zone / task linkage.

The capture should preserve traceability and audit context.

## 5.4 Emergency Mode

The web application contains an emergency capture queue using IndexedDB.

Current scope:
- emergency field queue;
- local persistence;
- migration from previous local queue formats;
- automatic synchronization when the device reconnects.

Important:
This is **not yet a complete application-wide offline-first system**.

## 5.5 Company Memory

The system stores:
- knowledge items;
- lessons learned;
- project-linked knowledge;
- incidents and operational evidence.

This creates reusable company memory instead of losing experience after each project.

## 5.6 Company Brain

Current implementation is deterministic evidence retrieval.

It can:
- search company knowledge;
- search lessons learned;
- search incidents;
- filter by project;
- identify recurring categories;
- produce deterministic recommendations from available evidence.

Current mode is:

`deterministic-evidence`

It is **not yet a full autonomous LLM/RAG agent**.

Future AI must preserve evidence, assumptions and human approval.

## 5.7 Intelligence

Current intelligence foundation includes:
- comparisons;
- anomaly detection;
- forecasting;
- scenario simulation;
- Company Brain workspace.

These should evolve from descriptive analytics into explainable decision support.

## 5.8 Approval Center

Risk-sensitive actions can pass through explicit human approval.

Examples:
- purchasing decisions;
- quote decisions;
- other configured business actions.

Every decision should remain auditable.

## 5.9 Automation

The automation foundation supports event-driven rules.

Current trigger families include:
- stock low;
- invoice overdue;
- project delayed;
- incident created;
- quote accepted;
- approval needed.

Current action families include:
- notify;
- notify role;
- create purchase suggestion;
- assign task.

Automation must remain:
**Event → Context → Rule → Action → Approval when required → Execution → Notification → Audit**

## 5.10 Internal Chat

Current database architecture supports:
- project channels;
- department channels;
- private channels;
- group channels;
- company channels;
- members;
- messages;
- document references;
- structured metadata.

The final chat experience should allow controlled communication between:
- owner;
- manager / engineer;
- team leader;
- worker;
- accountant;
- storekeeper;
- other authorized users.

Chat permissions must follow the same company and role boundaries as the ERP.

## 5.11 Zones and BOQ

Projects can be decomposed into zones.

Each zone can have:
- area;
- status;
- BOQ lines;
- materials;
- measurements;
- labor;
- equipment;
- transport;
- other costs;
- waste factor;
- discount;
- unit price.

This is particularly important for resin, epoxy and industrial-flooring projects where quantities and waste affect profitability.

## 5.12 Customer Portal

Customer users are isolated from the internal ERP.

The portal is intended for:
- customer projects;
- customer invoices;
- customer documents;
- customer messages;
- controlled customer-facing information.

Customers must not access internal:
- finance;
- stock;
- employees;
- purchasing;
- settings;
- audit;
- internal AI;
- internal operations.

---

# 6. V3 — Cloud + PC + Android + iOS

V3 is the final productization phase.

The objective is not to create three different products.

The objective is:

**ONE IDEAIL PRODUCT → Web/PC + Android + iOS → ONE API → ONE DATABASE**

## 6.1 Target architecture

```
                    IDEAIL / Company OS
                            |
             +--------------+--------------+
             |                             |
        PC / Web                      Mobile Apps
             |                       Android + iOS
             |                             |
             +--------------+--------------+
                            |
                         HTTPS API
                            |
                  Auth + RBAC + Tenant
                            |
              +-------------+-------------+
              |                           |
        Supabase PostgreSQL        Supabase Storage
              |
         Audit / Business Data
```

## 6.2 Cloud responsibilities

### Vercel
Use Vercel primarily for:
- production web frontend;
- React/Vite build;
- HTTPS web delivery;
- frontend environment configuration.

### Supabase
Use Supabase for:
- managed PostgreSQL;
- production database;
- migrations;
- document/object storage;
- optional future realtime features where appropriate.

### API hosting
The current Fastify API should run on a dedicated Node/container-capable production host.

Do not assume Vercel alone can run the current Fastify server unchanged as a persistent backend.

The API host must provide:
- HTTPS;
- Node.js runtime;
- environment variables;
- access to Supabase PostgreSQL;
- access to Supabase Storage;
- logs;
- restart/recovery;
- production health endpoint.

## 6.3 One account everywhere

The same user account must work across:
- Web;
- Android;
- iOS.

The server decides:
- identity;
- company;
- role;
- scopes;
- record access;
- actions;
- approvals.

The client cannot grant itself permissions.

## 6.4 Mobile application strategy

Preferred direction:

**React Web codebase + Capacitor packaging**, while preserving the shared API/domain architecture.

This avoids maintaining three completely independent application codebases.

The mobile shell must add native capabilities where useful:
- camera;
- file picker;
- microphone;
- notifications;
- secure local storage;
- connectivity state;
- device metadata.

Native capabilities must never bypass server authorization.

## 6.5 Mobile navigation

Mobile UI should prioritize:
- Dashboard;
- My Tasks;
- My Projects;
- Capture;
- Voice-to-Work;
- Chat;
- Notifications;
- Stock actions for authorized roles;
- Approvals for authorized roles;
- Customer Portal for customer users.

The desktop can expose richer tables and administration screens.

The business rules remain shared.

---

# 7. V3 Offline Synchronization

The current emergency queue is only the beginning.

The target V3 mobile architecture is:

```
Device
  ↓
Encrypted local data
  ↓
Outbox
  ↓
Connectivity detection
  ↓
Sync API
  ↓
Server transaction
  ↓
Success / Conflict
  ↓
Explicit conflict resolution
```

## Required synchronization properties

Every offline-capable mutation should have:
- local ID;
- server ID;
- device ID;
- created timestamp;
- updated timestamp;
- sync status;
- version / revision;
- retry count;
- conflict state.

The server remains authoritative.

Never silently overwrite a newer server record.

---

# 8. V3 Push Notifications

Add a notification layer for:
- approvals;
- new assignments;
- project incidents;
- overdue invoices;
- stock alerts;
- chat messages;
- automation events;
- synchronization errors.

Notifications must respect role, company and record scope.

---

# 9. V3 Mobile Security

Target controls:

- secure token storage;
- short-lived access tokens;
- refresh rotation;
- device/session revocation;
- HTTPS only;
- server-side RBAC;
- company isolation;
- audit;
- rate limiting;
- secure upload validation;
- file size/type restrictions;
- no service-role keys in mobile or browser code.

Supabase service-role credentials are server-only.

---

# 10. V3 Document and File Architecture

Documents should use:

`company_id / object-key`

The application should support:
- upload;
- metadata;
- project linkage;
- zone linkage;
- task linkage;
- incident linkage;
- secure retrieval;
- audit;
- controlled customer access.

Supabase Storage bucket target:

`company-documents`

The production bucket must be created and verified before production uploads are considered complete.

---

# 11. Cloud Database Rules

Production database must:

1. Run all migrations in order.
2. Verify `schema_migrations`.
3. Create the production owner through a controlled bootstrap/onboarding process.
4. Contain no accidental demo/test data.
5. Have backups configured.
6. Have a recovery procedure.
7. Keep tenant isolation.
8. Keep audit history.
9. Use production secrets only through environment configuration.

Never point the application at an unrelated old Supabase project.

---

# 12. Environment Separation

Three environments are recommended:

### Development
Local PostgreSQL / development Supabase.

### Staging
Separate database and storage for testing deployments.

### Production
Dedicated production Supabase project and production API.

Never share production service-role keys with development clients.

---

# 13. Production Environment Variables

## API

Expected production configuration includes:

```
NODE_ENV=production
DATABASE_URL=...
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
WEB_ORIGIN=https://...
STORAGE_PROVIDER=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=company-documents
```

Add Redis only if the deployed runtime actually uses the queue/cache functionality requiring it.

## Web

```
VITE_API_URL=https://YOUR-PRODUCTION-API
```

Only public frontend-safe variables may use the `VITE_` prefix.

Never expose:
- database credentials;
- JWT signing secrets;
- Supabase service-role key;
- private API keys.

---

# 14. V3 PC Experience

PC/Web remains the full administration interface.

Desktop priorities:
- dashboards;
- tables;
- finance;
- projects;
- procurement;
- stock;
- fleet;
- reports;
- company settings;
- audit;
- intelligence;
- approvals;
- document management.

Responsive design must remain usable on tablets and phones.

---

# 15. V3 Customer Experience

A customer can:
1. log in;
2. see only their company/customer-linked information;
3. see authorized projects;
4. receive documents;
5. see invoices;
6. exchange authorized messages;
7. access the portal from PC or mobile.

A customer must never be able to navigate into the internal ERP by changing a URL manually.

---

# 16. AI Evolution Plan

### Current
Deterministic Company Brain based on stored evidence.

### Next
Optional semantic retrieval:
- embeddings;
- semantic search;
- richer evidence ranking.

### Later
Optional LLM assistant:
- explain project issues;
- summarize documents;
- draft messages;
- propose actions;
- explain anomalies;
- answer company knowledge questions.

### Non-negotiable AI rule

AI can recommend.

AI cannot silently:
- approve money;
- delete financial records;
- alter critical stock truth;
- change permissions;
- bypass tenant isolation;
- impersonate a user.

High-risk actions require human authorization and audit.

---

# 17. Coding-Agent Operating Rules

This section is intentionally explicit so future coding agents understand how to work on the repository.

## Before changing anything

The agent must:
1. inspect the current repository;
2. inspect relevant routes;
3. inspect database migrations;
4. inspect existing frontend pages/components;
5. identify reusable existing code;
6. identify tests;
7. understand whether the requested feature already partially exists.

## When implementing

The agent should:
- extend existing architecture;
- avoid duplicate routes;
- avoid duplicate database concepts;
- reuse domain functions;
- preserve company scoping;
- preserve role checks;
- preserve audit;
- add migrations when schema changes are needed;
- add tests;
- update documentation;
- keep TypeScript strictness intact.

## Agent creativity is allowed

An agent **may propose or implement improvements** when they are clearly beneficial.

Examples:
- better UX;
- better mobile navigation;
- better validation;
- missing indexes;
- better error handling;
- stronger security;
- better observability;
- additional useful dashboard information;
- safer synchronization;
- better notification behavior.

But before introducing a substantial new architectural concept, the agent should document:
- why it is needed;
- what it changes;
- what existing functionality it replaces or extends;
- migration/rollback implications.

## If an existing idea is weak

The agent should not blindly implement a bad design just because it appears in an old plan.

It may:
1. identify the problem;
2. explain the risk;
3. propose a better implementation;
4. preserve compatibility where possible;
5. implement the improved version if it does not violate the product rules.

## If an idea is unnecessary

The agent may mark it:
`DEFERRED`, `REPLACED`, or `NOT RECOMMENDED`

and explain why.

The product owner remains the final decision-maker.

---

# 18. Recommended V3 Execution Order

## V3-A — Production foundation

1. Finish CI.
2. Finish web production build.
3. Deploy React web to Vercel.
4. Create dedicated production Supabase project.
5. Apply migrations.
6. Create/verify storage bucket.
7. Deploy Fastify API.
8. Configure API environment variables.
9. Configure Vercel `VITE_API_URL`.
10. Verify CORS.
11. Verify health endpoint.
12. Verify production login.

## V3-B — Security and tenant verification

1. Owner login.
2. Role creation.
3. Permission verification.
4. Company isolation tests.
5. Customer isolation tests.
6. API unauthorized/forbidden tests.
7. Refresh-token tests.
8. Audit tests.
9. Upload security tests.

## V3-C — Mobile shell

1. Add Capacitor.
2. Configure Android.
3. Configure iOS.
4. Connect the same production API.
5. Implement secure token storage.
6. Implement camera/file/microphone integrations.
7. Implement connectivity state.
8. Test role-specific navigation.

## V3-D — Mobile operations

1. Field Capture.
2. Voice-to-Work.
3. My Tasks.
4. Project 360 mobile.
5. Chat.
6. Notifications.
7. Approvals.
8. Customer Portal.

## V3-E — Offline

1. Local database.
2. Outbox.
3. sync protocol.
4. retries.
5. conflict detection.
6. conflict resolution UI.
7. recovery after app restart.
8. offline security tests.

## V3-F — Store / distribution

### Android
- signed release;
- AAB;
- Play Store preparation;
- production API configuration.

### iOS
- Apple signing;
- archive;
- TestFlight;
- App Store preparation.

### Web / PC
- Vercel production deployment;
- custom domain;
- HTTPS;
- monitoring.

---

# 19. Definition of Done

The product is considered V3 production-ready only when all of the following are true:

### Web / PC
- [ ] Production URL works.
- [ ] Login works.
- [ ] Role-based navigation works.
- [ ] CRUD flows work.
- [ ] Documents work.
- [ ] Customer portal works.
- [ ] Chat works.
- [ ] Approvals work.
- [ ] Intelligence works.

### API
- [ ] Production Fastify API is deployed.
- [ ] Health endpoint works.
- [ ] CORS is restricted correctly.
- [ ] JWT secrets are production-only.
- [ ] Authorization is server-side.
- [ ] Tenant isolation is verified.
- [ ] Audit works.

### Supabase
- [ ] Production project confirmed.
- [ ] All migrations applied.
- [ ] Database schema verified.
- [ ] Storage bucket verified.
- [ ] Backups/recovery plan verified.
- [ ] No accidental demo data.

### Android
- [ ] Release build succeeds.
- [ ] Login works.
- [ ] Role restrictions work.
- [ ] Camera/file/voice work where enabled.
- [ ] Notifications work.
- [ ] Offline queue works.
- [ ] Sync works.

### iOS
- [ ] Release/TestFlight build succeeds.
- [ ] Login works.
- [ ] Role restrictions work.
- [ ] Camera/file/voice work where enabled.
- [ ] Notifications work.
- [ ] Offline queue works.
- [ ] Sync works.

### Quality
- [ ] CI green.
- [ ] Typechecks green.
- [ ] Integration tests green.
- [ ] Production smoke test completed.
- [ ] No known critical security issue.
- [ ] Documentation updated.

---

# 20. Current Reality vs Final Target

## Already implemented / substantially implemented

- ERP domain foundation;
- PostgreSQL migration architecture;
- multi-tenant model;
- roles and permissions;
- JWT authentication;
- refresh-token flow;
- audit architecture;
- React/MUI web application;
- projects;
- Project 360;
- stock;
- materials;
- quotes;
- finance;
- purchasing;
- workforce;
- fleet;
- documents;
- customer portal;
- Company Memory;
- Lessons Learned;
- deterministic Company Brain;
- intelligence views;
- Daily Briefing;
- Approval Center;
- automation engine;
- internal chat schema;
- project zones;
- BOQ;
- Universal Capture;
- Voice-to-Work;
- Emergency Mode with IndexedDB queue;
- configurable production web build;
- Vercel configuration.

## Still required for final V3

- production Supabase project verification;
- production migration execution;
- production storage bucket verification;
- production Fastify hosting;
- complete production environment configuration;
- live end-to-end authentication test;
- live CRUD smoke tests;
- production document upload test;
- mobile packaging;
- Android testing;
- iOS testing;
- full offline synchronization;
- push notifications;
- production monitoring;
- final security review;
- store distribution preparation.

---

# 21. Important Product Interpretation

The words V1, V2 and V3 must never be interpreted as:

> “Build V1, throw it away, build V2, throw it away, build V3.”

They mean:

**V1 = foundation**  
**V2 = operational intelligence and collaboration**  
**V3 = production cloud + multi-device productization**

Everything accumulates into one final product.

---

# 22. Agent Change Log Policy

Whenever a coding agent makes a meaningful architectural/product decision, it should update this document or the relevant technical document.

A change should record:

- date;
- area;
- old behavior;
- new behavior;
- reason;
- migration impact;
- tests performed.

This prevents future agents from forgetting why a decision was made.

---

# 23. Final Product Statement

IDEAIL / Company OS is intended to become a single cloud-connected business operating system where:

**Owner + Accountant + Engineer + Team Leader + Worker + Storekeeper + Driver + Customer**

can each use the same company platform while seeing only what their role and record scope allow.

The same business truth is available across:

**PC + Web + Android + iOS**

through:

**one authentication system + one API + one PostgreSQL database + one document storage layer + one audit model.**

Future agents are encouraged to improve the product, but they must evolve the existing system rather than replace it without a justified architectural decision.
