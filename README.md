# Company OS — Système d'Exploitation d'Entreprise

Système unifié **ERP + Opérations + Automatisation + Intelligence IA** pour une entreprise de travaux industriels (sablage, résine époxy, revêtements industriels, protection des sols, étanchéité).

## Ce qui est implémenté dans ce dépôt

| Couche | Statut | Emplacement |
|---|---|---|
| Schéma PostgreSQL complet (47+ tables, multi-tenant, audit append-only) | ✅ | `database/migrations/` |
| Domaine : matrice de permissions par rôle, moteur de calcul matériaux, coût/profitabilité projet | ✅ testé | `packages/domain` |
| i18n FR / AR (RTL) / EN, formatage DZD | ✅ testé | `packages/i18n` |
| API REST (Fastify + JWT + refresh rotation + RBAC + audit) | ✅ | `services/api` |
| Web React + MUI : login, shell par rôle, devis, Project 360°, achats, stock, flotte, documents, portail client | ✅ | `apps/web` |
| Universal Capture + Voice-to-Work | ✅ | `services/api/src/modules/field.ts` + `apps/web/src/pages/FieldOps.tsx` |
| Company Memory + Lessons Learned | ✅ | `knowledge_item` + `/knowledge` |
| Human Approval Center + Event Spine | ✅ | `approval_request` + `business_event` |
| n8n, mobile offline-first, RAG/IA, OCR | 📋 Phase 3–5 | voir `docs/ARCHITECTURE.md` |

## Démarrage

```bash
npm install
docker compose up -d postgres redis      # PostgreSQL 16 + Redis 7 (port 5432)
cp .env.example .env
npm run db:migrate                       # applique les migrations (suivi schema_migrations)
npm run db:bootstrap                     # crée l'entreprise + owner (compte RÉEL, demandé dans le terminal)
npm run build && npm test                # domaine + i18n (node:test) — 20 tests
npm run typecheck:api && npm run typecheck:web
npm run dev:api                          # API sur :4000 (tsx watch)
npm run dev:web                          # Web sur :5173 (proxy /api/v1)
```

> **PostgreSQL local existant ?** Si un serveur tourne déjà sur 5432 avec d'autres identifiants, adaptez `DATABASE_URL` dans `.env` (et créez la base `companyos`), ou utilisez le Postgres du `docker compose` sur un port libre en modifiant `docker-compose.yml`.

> **Aucune donnée de démo** : le système démarre vide. `npm run db:bootstrap` crée uniquement l'entreprise et le compte propriétaire ; clients, chantiers, employés, matériel et factures sont saisis dans l'application (ou via l'API). Pour donner l'accès portail à un client : créez le `client`, puis un utilisateur avec le rôle `customer` lié à ce client.

## Chaîne métier couverte

Client → Contrat → Devis → Projet (chantier) → Mesures → Calcul matériaux (règles en base, jamais codées en dur) → Réservation stock → Consommation réelle → Écart planifié/réel → Main-d'œuvre (work_log) → Véhicules/Carburant → Rentabilité opérationnelle → Facture → Paiement (append-only) → Audit.

## Règles d'architecture respectées

- **Le backend est la source de vérité** (PostgreSQL). Cache, index, IA, n8n sont dérivables.
- **L'IA n'est pas la source de vérité** : recommandations avec preuves + hypothèses, décision humaine (`ai_recommendation.status`).
- **Isolation multi-tenant** : `company_id` sur chaque enregistrement, vérifié serveur.
- **Portée d'enregistrement** : ingénieur/ouvrier → projets assignés uniquement ; client portail → ses clients liés uniquement.
- **Paiements append-only** : correction via `payment_reversal`, jamais de suppression silencieuse.
- **Capture terrain** : photos, documents et Voice-to-Work sont liés au chantier et persistés avec métadonnées/audit.
- **Company Memory** : les connaissances et leçons sont persistées, recherchables et liées aux projets.
- **Approval Center** : les actions à risque passent par une décision humaine explicite, avec audit.
- **Règles fiscales configurables** (`tax_rate` en base), jamais de taux codé en dur — à valider avec un expert-comptable algérien avant production (spéc. §71).
