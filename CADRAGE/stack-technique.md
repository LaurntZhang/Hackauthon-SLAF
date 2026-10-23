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
| **React Native** (+ Expo, React Native Web) | Une seule base de code pour la tour de contrôle (web) et la carte d'approbation (mobile) | Cœur |

Écrans : fil de discussion des agents, alertes, scores de confiance, timeline rejouable, carte
**Approuver / Rejeter / Rapport**. Le front consomme uniquement l'API et le flux SSE, avec les types dérivés des
contrats Pydantic (OpenAPI).

## Qualité et arbitrages
- **pytest** (un test par invariant et par scénario S1 à S6), **Ruff** et **mypy** (style, typage strict).
- **Hackathon :** SQLite + HTML statique suffisent pour la démo ; PostgreSQL et React Native sont le cap cible, hors
  chemin critique avant la fin de L3. LangSmith et CrewAI ne sont pas requis.
