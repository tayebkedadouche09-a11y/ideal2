# Matrice des rôles et permissions

Source de code : `packages/domain/src/roles.ts`. Portée d'enregistrement additionnelle appliquée serveur (projets assignés, clients portail).

| Module | Owner | Accountant | Engineer | Team Leader | Worker | Storekeeper | Driver | Customer |
|---|---|---|---|---|---|---|---|---|
| dashboard | write | read | read | read | — | read | — | — |
| clients | write | read | read | — | — | — | — | — |
| suppliers | write | read | — | — | — | read | — | — |
| contracts | write | read | read | — | — | — | — | read |
| quotes | **approve** | read | read | — | — | — | — | read |
| projects | write | read | write | read | read | read | read | read |
| planning | write | — | write | write | read | — | read | — |
| stock | write | read | read | read | — | **write** | — | — |
| purchasing | **approve** | read | read | — | — | write | — | — |
| employees | write | read | read | read | — | — | — | — |
| teams | write | — | write | write | read | — | — | — |
| vehicles | write | read | read | read | — | — | **write** | — |
| equipment | write | read | read | read | — | — | — | — |
| finance | write | **write** | — | — | — | — | — | read |
| documents | write | read | write | write | — | write | — | read |
| communications | write | — | write | read | — | — | — | read |
| ai | write | read | read | read | read | read | read | — |
| reports | write | read | read | — | — | — | — | — |
| settings | write | — | — | — | — | — | — | — |
| audit | write | read | — | — | — | — | — | — |
| customer_portal | write | — | — | — | — | — | — | read |

## Tests d'acceptation critiques (spéc. §62) — couverture actuelle

| Test | Statut |
|---|---|
| Un ouvrier ne peut pas voir la finance globale | ✅ `permission matrix: worker denied finance` (unit) + RBAC serveur sur routes finance |
| Un client portail ne peut pas voir un autre client | ✅ `clientScope` + `assertClientAccess` + filtre SQL |
| Un ingénieur ne voit que ses projets autorisés | ✅ `projectScope` + `assertProjectAccess` + filtre SQL |
| Un paiement met à jour facture/dette correctement | ✅ E2E `finance acceptance` : paiement partiel → `partially_paid` + dette restante, solde → `paid` + retiré de `/debts`, trop-perçu → 409 |
| Un paiement crée un historique d'audit | ✅ E2E `finance acceptance` : lignes `audit_log` `payment` ≥ 2 ; isolation inter-sociétés (404) |
| La consommation matériaux met à jour le stock | ✅ transaction `material-consumption` + `stock_movement` |
| La consommation affecte le coût projet | ✅ `/projects/:id/profitability` (matériaux réels × prix) |
| Coûts véhicule/carburant affectés aux projets | ✅ modèle (`fuel_log.project_id`, `expense.vehicle_id`) + profitabilité |
| Les actions offline se synchronisent sans perte | ✅ E2E `offline sync` : enregistrement appareil, push idempotent (doublon → `duplicate`), conflit sur `baseVersion` obsolète, résolutions `client_wins`/`server_wins`, `row_version` incrémenté, isolation inter-sociétés |
| L'IA ne peut pas récupérer de documents non autorisés | ⏳ Phase 5 (retrieval filtré par `permission_tags`) |
| Les recommandations IA montrent preuves/hypothèses | ✅ schéma (`evidence`, `assumptions`, `confidence`) |
| n8n ne peut pas contourner les permissions API | ⏳ Phase 6 (compte de service scopé) |
| Sauvegarde restaurée avec succès | ⏳ Phase 7 |
| Les corrections financières ne suppriment pas d'historique | ✅ paiements append-only + `payment_reversal` |
