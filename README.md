# Company OS — Système d'Exploitation d'Entreprise

Système unifié **ERP + Opérations + Automatisation + Intelligence** pour une entreprise de travaux industriels (sablage, résine époxy, revêtements industriels, protection des sols, étanchéité).

## Document maître

La direction produit et l'architecture d'évolution V1 → V2 → V3 sont centralisées dans `docs/IDEAIL_MASTER_PRODUCT_SPEC.md`.

Ce document est destiné aux développeurs et coding agents. Il décrit ce qui est réellement présent, V1 (fondation ERP), V2 (opérations, intelligence et collaboration), V3 (cloud + PC + Android + iOS), architecture Supabase/Vercel/API, rôles et permissions, sécurité, offline/synchronisation, chat, Company Brain, définition de Done et règles permettant aux agents de proposer de nouvelles idées ou d'améliorer une idée existante sans reconstruire le produit.

**Règle centrale : V1/V2/V3 sont des phases du même produit, pas trois applications.**

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
| Automation + Chat + Zones/BOQ | ✅ foundation | `services/api/src/modules/automation.ts`, `chat.ts`, `engineering.ts` |
| Deterministic Company Brain | ✅ | `services/api/src/modules/intelligence.ts` |
| Emergency offline queue | ✅ | IndexedDB in `apps/web/src/pages/FieldOps.tsx` |
| Full application-wide mobile offline sync | 📋 V3 | voir le document maître |
| Android / iOS packaging | 📋 V3 | voir le document maître |
| Production Cloud deployment | 📋 V3 | voir le document maître |

## Démarrage

```bash
npm install
docker compose up -d postgres redis
cp .env.example .env
npm run db:migrate
npm run db:bootstrap
npm run build && npm test
npm run typecheck:api && npm run typecheck:web
npm run dev:api
npm run dev:web
```

> **Aucune donnée de démo** : le système démarre vide. `npm run db:bootstrap` crée uniquement l'entreprise et le compte propriétaire ; les clients, chantiers, employés, matériels et factures sont saisis dans l'application ou via l'API.

## Chaîne métier couverte

Client → Contrat → Devis → Projet → Mesures → Calcul matériaux → Réservation stock → Consommation réelle → Écart planifié/réel → Main-d'œuvre → Véhicules/Carburant → Rentabilité → Facture → Paiement → Audit.

## Règles d'architecture

- **Le backend est la source de vérité.**
- **L'IA n'est pas la source de vérité** : recommandations avec preuves/hypothèses et décision humaine.
- **Isolation multi-tenant** : `company_id` est vérifié serveur.
- **Permissions** : le rôle seul ne suffit pas ; l'accès aux enregistrements et aux actions est également contrôlé côté serveur.
- **Paiements append-only** : correction via `payment_reversal`, jamais de suppression silencieuse.
- **Capture terrain** : photos, documents et Voice-to-Work sont liés au chantier avec métadonnées/audit.
- **Company Memory** : connaissances et leçons sont persistées et recherchables.
- **Approval Center** : les actions à risque passent par une décision humaine explicite.
- **Secrets** : jamais dans GitHub ni dans le frontend.
- **Production** : Vercel sert le web ; l'API Fastify doit disposer d'un runtime backend adapté ; Supabase fournit PostgreSQL/Storage.

## État V3

Le projet n'est **pas déclaré production-ready simplement parce que le code est présent**. La définition de Done dans le document maître exige une vérification réelle de l'API, de Supabase, des migrations, du stockage, de l'authentification, des permissions, des uploads, puis Android/iOS et offline sync.
