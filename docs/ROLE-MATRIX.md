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
| Un paiement met à jour facture/dette correctement | ⏳ endpoints finance Phase 1 (statut dérivé des paiements, logique testée dans domain) |
| Un paiement crée un historique d'audit | ⏳ même phase |
| La consommation matériaux met à jour le stock | ✅ transaction `material-consumption` + `stock_movement` |
| La consommation affecte le coût projet | ✅ `/projects/:id/profitability` (matériaux réels × prix) |
| Coûts véhicule/carburant affectés aux projets | ✅ modèle (`fuel_log.project_id`, `expense.vehicle_id`) + profitabilité |
| Les actions offline se synchronisent sans perte | ⏳ Phase 3 (outbox + sync API) |
| L'IA ne peut pas récupérer de documents non autorisés | ⏳ Phase 5 (retrieval filtré par `permission_tags`) |
| Les recommandations IA montrent preuves/hypothèses | ✅ schéma (`evidence`, `assumptions`, `confidence`) |
| n8n ne peut pas contourner les permissions API | ⏳ Phase 6 (compte de service scopé) |
| Sauvegarde restaurée avec succès | ⏳ Phase 7 |
| Les corrections financières ne suppriment pas d'historique | ✅ paiements append-only + `payment_reversal` |
