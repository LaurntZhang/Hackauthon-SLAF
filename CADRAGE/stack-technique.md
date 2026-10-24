# Stack technique — ManAgent

Rôle de chaque outil. Référence : [CADRAGE-MANAGENT.md](../../CADRAGE/CADRAGE-MANAGENT.md).
**Règle d'or :** la démo tourne sans réseau ni clé API ; un outil marqué *option* ne doit jamais bloquer le graphe.

## Agents et orchestration
| Outil | Rôle | Statut |
| --- | --- | --- |
| **LangGraph** | Orchestre le graphe d'états (12 nœuds), les pauses humaines (`interrupt`) et la reprise (`Command`, checkpointer) | Cœur |
| **LangChain** | Appels LLM des agents (`init_chat_model`), sorties structurées Pydantic, outils en lecture seule | Cœur |
| **CrewAI** | Alternative pour le *Proposer* seul si une équipe d'agents de recherche est utile ; non utilisé dans le chemin de contrôle | Option |
| **Pydantic v2** | Contrats de données figés entre agents, FinGuard, API et front | Cœur |

LangGraph et LangChain se combinent : LangGraph pilote le flux, LangChain appelle les modèles. Les contrôles
du module FinGuard n'utilisent aucun LLM.

## Observabilité et monitoring
| Outil | Rôle | Statut |
| --- | --- | --- |
| **Langfuse** | Traces des agents (appels LLM, latence, tokens, coût), scores et rejeu ; reçoit les `AuditEvent` | Option, auto-hébergeable |
| **LangSmith** | Alternative à Langfuse pour inspecter les traces et évaluer les agents ; un seul des deux en production | Option |
| **Journal d'audit chaîné** | Preuve vérifiable (hash) de chaque décision ; source de vérité, indépendante de Langfuse | Cœur |
| **SSE (FastAPI)** | Flux temps réel des événements vers la tour de contrôle | Cœur |

Langfuse sert à *comprendre* le comportement des agents ; le journal chaîné sert à *prouver* les décisions.

## Back-end et données
| Outil | Rôle | Statut |
| --- | --- | --- |
| **FastAPI** | API REST (transactions, approbations, kill switch, scénarios, audit) et flux SSE | Cœur |
| **PostgreSQL** | Stockage durable : checkpoints LangGraph, mandats, autorisations, journal d'audit, compteurs du Risk Governor | Cœur en cible ; SQLite en démo |
| **Uvicorn** | Serveur ASGI de l'API | Cœur |

PostgreSQL remplace le SQLite du diagramme technique pour la version cible : même schéma, seule la chaîne de
connexion change (`SqliteSaver` → `PostgresSaver`). Le journal d'audit reste en insertion seule, avec `prev_hash`
et `hash` sur chaque ligne.

## Front-end
| Outil | Rôle | Statut |
| --- | --- | --- |
| **React Native** (+ Expo, React Native Web) | Front v2 actuel dans `src/front` ; simulateur par défaut, transport REST/SSE via `EXPO_PUBLIC_MANAGENT_API` sur Expo Web | Après merge sur `dev` (`0644170`), typecheck/export réussis sous Node 25.4 ; routes `/`, `/salle`, `/gerant` produites ; 7 tests S1–S6 passent. Contrôle manuel post-merge : `/health` OK et audit `:8017` valide sur 1 459 lignes. Tests HTTP/API automatisés interrompus avant résultat |
| **HTML/CSS/JavaScript statique** | Front v1 servi par FastAPI dans `src/api/static` ; parcours live S1/S2 retesté manuellement le 24/10/2026 | Référence live éprouvée |

Écrans : fil de discussion des agents, alertes, scores de confiance, timeline rejouable, carte
**Approuver / Rejeter / Rapport**. Le front v2 web charge l'état et l'audit par REST, suit les événements par SSE
et transmet la décision HITL avec le PIN à l'API, qui crée la signature. L'origine Expo Web est autorisée par CORS
pour le développement local. La cible native reste en simulation ; elle nécessitera un transport SSE compatible.
Les journaux vérifiés le 24/10/2026 sont deux chaînes valides distinctes : l'API `:8000` sert `logs/audit.jsonl`
(220 événements) et l'API `:8017` sert `.integration-worktree/logs/v2-integration-test.jsonl` (1 444 événements,
dont les S1/S2 du retest). Consulter les endpoints `/audit/*` sur le port `:8017` pour voir le résultat du parcours v2.

## Qualité et arbitrages
- **pytest** (un test par invariant et par scénario S1 à S6), **Ruff** et **mypy** (style, typage strict).
- **Hackathon :** SQLite + HTML statique suffisent pour la démo ; PostgreSQL et React Native sont le cap cible, hors
  chemin critique avant la fin de L3. LangSmith et CrewAI ne sont pas requis.
