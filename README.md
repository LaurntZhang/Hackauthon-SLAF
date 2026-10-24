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
FastAPI + SSE · pytest · Langfuse (optionnel). L'API est purement JSON ; l'ancien front HTML v1 a été retiré.

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

## Lancer le projet (après clonage)

Prérequis : Python 3.13+. Toutes les commandes se lancent depuis la racine du projet.

**1. Créer le fichier d'environnement** (il n'est pas versionné ; copie du modèle fourni) :

```powershell
Copy-Item .env.example .env          # bash/macOS : cp .env.example .env
```

Par défaut `.env` démarre en mode hors ligne (`FINGUARD_LLM=off`, sans clé API). Pour activer les agents
Mistral, éditer `.env` : mettre `FINGUARD_LLM=on` et renseigner `MISTRAL_API_KEY`.

**2. Installer les dépendances.** Avec [uv](https://docs.astral.sh/uv/) (recommandé) :

```bash
uv sync --extra llm                  # crée .venv et installe l'intégration Mistral (omettre --extra llm pour le mode hors ligne seul)
```

Sans uv, avec `venv` + `pip` :

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m ensurepip --upgrade        # si pip absent du venv
.venv\Scripts\python.exe -m pip install -e ".[llm]"    # bash : .venv/bin/python -m pip install -e ".[llm]"
```

**3. Lancer l'API** depuis la racine. Le script `scripts.serve` charge `.env` avant uvicorn :

```powershell
# avec uv
uv run python -m scripts.serve --host 127.0.0.1 --port 8000
# ou directement via le venv
.venv\Scripts\python.exe -m scripts.serve --host 127.0.0.1 --port 8000
```

> Ne pas utiliser `uvicorn --reload` directement : le reloader relance un sous-process qui ne recharge
> pas le `.env` (ni la clé Mistral, ni le secret HITL). Toujours passer par `scripts.serve`.

**Vérifier** (facultatif) : `uv run pytest -q` (148 tests) ou `uv run python -m scripts.run_demo`
(scénarios S1 à S6 en CLI, hors ligne).

Ouvrir `http://127.0.0.1:8000` renvoie les métadonnées de l'API (version, `/docs`, `/health`) : le
back-end est désormais une API pure. L'interface est le front React Native v2 (`src/front`, voir plus
bas), qui consomme les routes REST et le flux SSE. Il expose la tour de contrôle et la carte HITL
(Approuver / Rejeter / Rapport) ; la décision est signée par le serveur après saisie du PIN. Les
approbations et commandes signées utilisent le PIN de démonstration `1234` par défaut, configurable avec
`FINGUARD_DEMO_PIN`. Ce parcours est réservé à la démo locale : il ne constitue pas une authentification
adaptée à la production. Le mode démonstration fonctionne sans réseau ni clé API (`FINGUARD_LLM=off` par défaut).

> **Scénarios S1–S6 :** les lancer avec `FINGUARD_LLM=off` (mode déterministe reproductible). Avec
> `FINGUARD_LLM=on`, les agents Mistral peuvent faire dévier un scénario figé. Garder `on` pour les
> transactions en langage naturel, où le LLM apporte de la valeur.

**4. Lancer le front Expo v2 sur le web**, dans un second terminal :

```powershell
cd src/front
npm ci
$env:EXPO_PUBLIC_MANAGENT_API = "http://127.0.0.1:8000"   # omettre pour rester en simulation locale
npm run web
```

Le front est alors servi sur `http://localhost:8081` (routes `/`, `/salle`, `/gerant`).

Le transport live v2 utilise REST et SSE. Le mode live est pris en charge sur Expo Web ; la cible native reste en
simulation tant qu'un transport SSE natif n'est pas ajouté. Pour un front servi sur une autre origine, définir
`FINGUARD_CORS_ORIGINS` avec une liste d'origines autorisées séparées par des virgules.

Pour vérifier le transport live, l'hydratation, le rejeu SSE et le parcours HITL sur une API jetable
(le script crée des transactions et modifie son journal), lancer depuis la racine :
`node src/front/scripts/check-live.cjs http://127.0.0.1:8000`.

**Validation front v2 (24/10/2026) :**

- **Vérifié :** `npm run typecheck` et `npm run export:web` passent sous Node 24.22.1. L'API répond sur `/health` ; Expo Web
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
- **Retest d'intégration (24/10/2026) :** `node src/front/scripts/check-live.cjs` passe contre une API temporaire
  (hydratation, rejeu/déduplication SSE, S1, S2/HITL par PIN, commandes opérateur, chaîne d'audit). Le parcours S2
  a aussi été exécuté dans Expo Web : la décision signée reprend l'opération, qui s'exécute ; la preuve reste valide
  sur 17 événements. L'export web passe avec et sans `EXPO_PUBLIC_MANAGENT_API`.

**Smoke test après merge sur `dev` (24/10/2026) :** le HEAD testé est le commit de merge `0644170`.
`npm run typecheck` et `npm run export:web` passent sous Node 25.4. L'export produit les routes `/`, `/salle`
et `/gerant`. Le premier essai d'export a été bloqué par une permission d'écriture sur l'état Expo du profil ;
il a réussi après redirection d'`EXPO_HOME` vers un répertoire temporaire. Les 7 tests de scénarios S1–S6 passent
avec l'environnement Python disponible. Les tests HTTP/API n'ont pas terminé et ont été interrompus après blocage.
Le contrôle manuel post-merge communiqué ensuite confirme `/health` OK sur `:8017` et `/audit/verify` valide sur
1 459 lignes, sans ligne invalide ni erreur, hash final
`db8c307ed4b64d776f0d1226bdc4a54054880bc8c0ac48817727ea8b7a4e8268`, journal `v2-integration-test.jsonl`.
Aucun scénario métier en serveur ni audit/checkpoint de démo n'a été modifié pendant le smoke test.
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
| `FINGUARD_LLM` / `FINGUARD_LLM_MODEL` | `off` / `mistral:mistral-small-latest` | agents LLM Mistral optionnels (`uv sync --extra llm`) |
| `MISTRAL_API_KEY` | absente | clé API Mistral si `FINGUARD_LLM=on` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | absentes | export Langfuse optionnel (`uv sync --extra langfuse`) |

Signer une approbation pour curl ou le front :
`uv run python -m scripts.sign approval --thread <thread_id> --action approve --approver risk_officer_1 --intent-hash <intent_hash>`.

## Limites assumées

- Le marché, la biométrie et les données sont **simulés**. Les contrôles, le quorum, l'intégrité, la
  validation humaine et l'audit sont **réels** et testés.
- En production, il faudrait une identité forte (OIDC/mTLS), des compteurs partagés (Redis), un stockage
  d'audit immuable (WORM) et une intégration SIEM avant toute action réelle.
