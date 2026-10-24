# Hackauthon-SLAF — ManAgent

**ManAgent** : garder la maîtrise lorsque plusieurs agents IA interagissent et prennent des décisions.
Hackathon Finaxys « Build What's Next » (23–24 octobre 2026), thème 04 — *Gouvernance multi-agents*.

> Les agents proposent, les règles décident, l'humain tranche, et tout est prouvé.

## Le problème

Dans la gestion d'actifs, plusieurs agents IA peuvent se contredire, dépasser leur mandat, se faire
manipuler par un document piégé, ou dériver progressivement. Il faut un système qui empêche une
décision non autorisée et qui permet de reconstituer chaque décision a posteriori.

## La solution

ManAgent se compose de deux parties :

- **Les agents IA (bleu)** : un *Proposer* émet une intention de transaction ; deux *juges* (Risque et
  Conformité) votent ; un *Exécuteur* prépare l'ordre ; un *Superviseur* méta-agent observe et peut
  demander un arrêt. Aucun agent ne parle directement à un autre.
- **Le module FinGuard (vert)** : un plan de contrôle **déterministe, sans LLM**, placé entre les agents
  et le marché. Il applique le Firewall, le Policy Engine (ALLOW / ESCALATE / BLOCK), le quorum pondéré,
  le registre d'autorisations, l'Integrity Engine, le Risk Governor, la passerelle d'exécution unique, le
  kill switch et le journal d'audit chaîné par hash. Une validation humaine (HITL) signée intervient sur
  les cas sensibles.

Le module FinGuard est agnostique : il ne voit que des contrats Pydantic et des mandats. Un nouvel agent
se branche en déclarant son mandat.

**Cas d'usage :** gestion d'actifs du fonds « Alpha » (obligations, actions, monétaire), avec limites
chiffrées et données synthétiques. Le marché est simulé.

## Architecture

| Document | Contenu |
| --- | --- |
| [CADRAGE/CADRAGE-MANAGENT.md](../CADRAGE/CADRAGE-MANAGENT.md) | Référence unique : règles, contrats, API, scénarios de démo, lots de travail |
| [CADRAGE/managent-1-architecture-logique.drawio](../CADRAGE/managent-1-architecture-logique.drawio) | Où sont les agents IA, et ce qu'apporte le contrôle |
| [CADRAGE/managent-2-architecture-technique.drawio](../CADRAGE/managent-2-architecture-technique.drawio) | Ce qui est construit : API, graphe LangGraph, modules |
| [CADRAGE/managent-use-cases.drawio](../CADRAGE/managent-use-cases.drawio) | Cas d'utilisation du fonds Alpha |
| [CADRAGE/solution-managent-synthese.md](../CADRAGE/solution-managent-synthese.md) | Synthèse d'une page |

**Stack :** front Expo / React Native / React Native Web (`src/front`) ; back Python 3.13 · LangGraph · Pydantic v2 ·
FastAPI + SSE · pytest · Langfuse (optionnel). Le front HTML v1 reste servi par FastAPI.

## Contrat de données partagé

Le schéma commun aux agents, au module FinGuard, à l'API et au dashboard est figé dans
[src/models/finguard_contracts.py](../src/models/finguard_contracts.py) et testé dans
[tests/test_finguard_contracts.py](../tests/test_finguard_contracts.py). Toute modification passe par
l'équipe : on ajoute des champs optionnels, on ne renomme pas.

## Démonstration

Six scénarios, chacun associé à un test (détail dans le cadrage, §9) :

| # | Scénario | Résultat attendu |
| --- | --- | --- |
| S1 | Achat de 4 000 € d'obligations | Exécuté sans pause |
| S2 | Achat de 85 000 € d'actions | Veto du juge Risque → validation humaine signée → exécuté |
| S3 | Ordre modifié après approbation | Bloqué par l'Integrity Engine |
| S4 | Document piégé | Injection détectée, outil interdit bloqué, quarantaine |
| S5 | 12 ordres de 900 € | Circuit breaker ouvert |
| S6 | Ligne d'audit altérée | Vérification de la chaîne en échec |

## Lancer le projet

Prérequis : Python 3.13 et [uv](https://docs.astral.sh/uv/).

```bash
uv sync                                   # crée .venv et installe les dépendances
uv run pytest -q                          # 146 tests : invariants, scénarios S1 à S6, API
uv run python -m scripts.run_demo         # plan B : S1 à S6 en CLI, hors ligne
uv run uvicorn src.api.main:app --reload  # interface sur :8000, API sur :8000/docs
```

Ouvrir `http://127.0.0.1:8000` affiche la tour de contrôle en simulation locale. Ajouter `?mode=live`
active le transport FastAPI : lancement des scénarios et transactions par REST, chargement de l'état,
des approbations en attente et de l'audit, puis réception des événements par SSE. La carte HITL est
disponible sur `/approval.html?mode=live` ; elle charge les demandes en attente et transmet la décision
signée par le serveur après saisie du PIN. Les approbations et commandes signées utilisent le PIN de
démonstration `1234` par défaut, configurable avec
`FINGUARD_DEMO_PIN`. Ce parcours est réservé à la démo locale : il ne constitue pas une authentification
adaptée à la production. Le mode démonstration fonctionne sans réseau ni clé API (`FINGUARD_LLM=off` par défaut).

Pour lancer le front Expo v2 sur le web, dans un second terminal :

```powershell
cd src/front
npm ci
$env:EXPO_PUBLIC_MANAGENT_API = "http://127.0.0.1:8000" # omettre pour rester en simulation
npm run web
```

Le transport live v2 utilise REST et SSE. Le mode live est pris en charge sur Expo Web ; la cible native reste en
simulation tant qu'un transport SSE natif n'est pas ajouté. Pour un front servi sur une autre origine, définir
`FINGUARD_CORS_ORIGINS` avec une liste d'origines autorisées séparées par des virgules.

**Validation front v2 (24/10/2026) :**

- **Vérifié :** `npm ci` réussi depuis `package-lock.json` sous Node 24.22.1 (minimum Expo SDK 58 : Node 22.13.x) ;
  `npm run typecheck` passe après ajout de `setConnection()` au contrat `Store`. L'API répond sur `/health` ; Expo Web
  démarre avec `EXPO_PUBLIC_MANAGENT_API=http://127.0.0.1:8017` sur `http://localhost:8081`. Dans le navigateur,
  le mode indique `API live · connecté` et le flux `GET /events` est indiqué connecté. S1 apparaît exécuté ; le
  compteur affiché passe de 1 412 à 1 427 événements, avec zéro rejet du contrat AuditEvent. S2 affiche la demande
  HITL sur le dashboard et `/gerant` ; l'approbation par PIN 1234 est signée, le traitement reprend et l'interface
  montre l'opération de 85 000 € exécutée. Le compteur affiché atteint 1 444 événements.
- **Cause vérifiée (24/10/2026) :** deux API locales répondaient sur des ports différents. `127.0.0.1:8000` sert
  le journal par défaut `logs/audit.jsonl` : 220 événements valides, dernier dossier `cor-947ba37fa7d1`, hash final
  `67c46e1b3b5ea46bb49238c14733726ad08848529bd0f5078152c3ec4b995888`. `127.0.0.1:8017`, lancé depuis
  `.integration-worktree`, sert `logs/v2-integration-test.jsonl` : 1 444 événements valides, dont S1
  `cor-1df4d7dedf08` (séquences 1413–1427) et S2 `cor-9ba191447c6f` (1428–1444), hash final
  `d04941bb452597c8a411aa2dd72dd3ac0cef6bb32d18a126b9e566cd26550b12`. Le contrôle avait été fait sur le port
  8000 tandis que le front v2 utilisait le port 8017. Les deux chaînes sont intègres ; aucun défaut de code ni de
  persistance n'est constaté.
- **Résultat :** écart résolu en consultant le même port que le front (`8017`). Les deux chaînes sont valides ;
  aucun nouveau scénario n'est nécessaire.
- **Lint :** `expo lint` reste non validé ; faute de configuration ESLint, Expo CLI a proposé d'ajouter ESLint et
  `eslint-config-expo`. Cette installation automatique a été interrompue pour conserver le manifeste et le lockfile.

Le retest live documenté ci-dessous concerne le front v1.

**Retest manuel front/back v1 (24/10/2026, mode live) :** connexion FastAPI et flux SSE actifs ; S1 exécuté ;
S2 affiché sur le dashboard et la carte HITL, approuvé par PIN puis exécuté. Le contrôle d'audit a indiqué une
chaîne intègre de 220 événements, sans rejet. Les tests automatisés n'ont pas été relancés pendant ce retest.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `FINGUARD_HITL_SECRET` | secret de démo (alerte au démarrage) | clé HMAC des approbations et commandes d'opérateur |
| `FINGUARD_AUDIT_PATH` | `logs/audit.jsonl` | journal d'audit chaîné |
| `FINGUARD_CHECKPOINT_DB` | `data/checkpoints.sqlite` (`memory` possible) | checkpoints LangGraph pour la reprise HITL |
| `FINGUARD_CORS_ORIGINS` | origines locales Expo Web | origines additionnelles autorisées pour l'API navigateur |
| `FINGUARD_LLM` / `FINGUARD_LLM_MODEL` | `off` / `openai:gpt-4.1-mini` | agents LLM optionnels (`uv sync --extra llm`) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | absentes | export Langfuse optionnel (`uv sync --extra langfuse`) |

Signer une approbation pour curl ou le front :
`uv run python -m scripts.sign approval --thread <thread_id> --action approve --approver risk_officer_1 --intent-hash <intent_hash>`.

## Limites assumées

- Le marché, la biométrie et les données sont **simulés**. Les contrôles, le quorum, l'intégrité, la
  validation humaine et l'audit sont **réels** et testés.
- En production, il faudrait une identité forte (OIDC/mTLS), des compteurs partagés (Redis), un stockage
  d'audit immuable (WORM) et une intégration SIEM avant toute action réelle.
