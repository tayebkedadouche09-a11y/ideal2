# Architecture

## Vue d'ensemble (spéc. §64)

```
WEB / ANDROID / iOS  →  CUSTOMER PORTAL  →  API (Fastify, /api/v1)
                                              │
              ┌───────────────┬───────────────┤
              ▼               ▼               ▼
        PostgreSQL       S3 Storage      Redis (cache/queue)
              │
     ┌────────┴────────┐
     ▼                 ▼
ERP OPERATIONS    AI INTELLIGENCE (RAG → outils → recommandation → décision humaine)
```

## Principes non négociables

1. **Une seule application intégrée** — phases oui, applications parallèles non. Un seul modèle d'auth, une base, un modèle de permissions, une API, un audit.
2. **Le backend est la source de vérité.** Cache mobile, index de recherche, embeddings, état n8n : dérivables et reconstruisibles.
3. **L'IA ne modifie jamais silencieusement les données critiques.** Les recommandations portent `evidence`, `assumptions`, `confidence` ; la décision humaine est tracée.
4. **n8n n'a pas d'accès direct à la base de production** — comptes de service à périmètre API, webhooks authentifiés, logs d'exécution (`workflow_execution`).

## Modèle d'autorisation — 7 couches (spéc. §38)

1. Authentification (JWT court + refresh rotatif single-use, scrypt, anti-bruteforce)
2. Permission par rôle (matrice rôle × module dans `packages/domain`, miroir en base)
3. Isolation entreprise (`company_id` partout, vérifié serveur)
4. Portée d'enregistrement (projets assignés, clients liés portail)
5. Politique d'action (endpoints de transition : approve, convert, cancel)
6. Approbation (quotes/purchases : `approved_by`, `decided_by`)
7. Audit (`audit_log` append-only : acteur, rôle, action, objet, état avant/après, request_id, IP)

## Invariants financiers

- Paiement = événement append-only ; le statut facture (`draft → approved → issued → partially_paid → paid/overdue/cancelled`) est **dérivé** des paiements, jamais stocké comme vérité indépendante.
- Correction = `payment_reversal` avec motif + auteur, jamais DELETE.
- Profitabilité opérationnelle séparée de la comptabilité légale ; mappings fiscaux configurables.

## Chaîne matériaux

`project_measurement` (m², rect, volume) → `material_rule` (couverture, couches, perte — **données**) → `calculateRequirement` (domaine) → `project_material_reservation` (stock disponible) → `project_material_consumption` (réel, écart calculé en colonne générée) → `stock_movement` (consumption) → coût projet.

## Mobile offline-first (spéc. §65)

Appareil → base locale chiffrée → outbox (ID local, device, horodatage, statut, version) → sync API → transaction serveur (succès / conflit → résolution explicite). Le serveur fait autorité ; chaque enregistrement local porte `server_id` après sync.

## Phases

Voir spéc. §68. Ce dépôt couvre Phase 0–1 et une tranche opérationnelle de Phase 2 (mesures, calcul matériaux, consommation, stock, profitabilité projet, dashboard + briefing quotidien).
