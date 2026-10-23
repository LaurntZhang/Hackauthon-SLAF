# Catalogue des skills Finaxys

Ce catalogue résume le rôle et les cas d'usage des skills présents dans
[SKILLS/](.). Les instructions détaillées restent dans chaque `SKILL.md`.

## Agents, architecture et orchestration

| Skill | Rôle | Cas d'utilisation |
| --- | --- | --- |
| [a2a-protocol](./a2a-protocol/) | Interopérabilité Agent2Agent | Agent Cards, tâches corrélées, coordinateur/spécialistes |
| [copilot-studio-harness-picker](./copilot-studio-harness-picker/) | Choix de harness et de forme de solution | Comparer Copilot Studio, canaux, identité, ALM et alternatives Microsoft |
| [langchain](./langchain/) | Agents, outils, middleware et RAG | Sorties Pydantic, outils bornés, recherche augmentée |
| [langgraph](./langgraph/) | Workflows d'état durables | StateGraph, routage, persistance et CLI |
| [langgraph-human-in-the-loop](./langgraph-human-in-the-loop/) | Interruptions et reprises humaines | `interrupt()`, `Command(resume=...)`, checkpointer |
| [deep-agents-core](./deep-agents-core/) | Fondations d'agents complexes | Agent borné avec contexte et outils |
| [deep-agents-memory](./deep-agents-memory/) | Mémoire d'agents | Conserver et retrouver un contexte utile |
| [deep-agents-orchestration](./deep-agents-orchestration/) | Orchestration multi-agents | Décomposer, déléguer et agréger |
| [managed-deep-agents](./managed-deep-agents/) | Agents gérés | Encadrer déploiement et exploitation d'agents |
| [handoff](./handoff/) | Passage de relais | Transférer état, mandat et contexte entre agents |
| [pattern-human-in-the-loop](./pattern-human-in-the-loop/) | Patterns de contrôle humain | Concevoir approbation et intervention explicites |

## Gouvernance, conception et qualité

| Skill | Rôle | Cas d'utilisation |
| --- | --- | --- |
| [domain-modeling](./domain-modeling/) | Modélisation métier | Définir transactions, mandats, invariants et glossaire |
| [codebase-design](./codebase-design/) | Conception de codebase | Choisir une structure cohérente avant implémentation |
| [diagnosing-bugs](./diagnosing-bugs/) | Diagnostic systématique | Isoler cause racine et boucle HITL défaillante |
| [root-cause-analysis](./root-cause-analysis/) | Analyse de cause racine | Fishbone, hypothèses, preuves et actions correctives |
| [grill-with-docs](./grill-with-docs/) | Revue exigeante appuyée par documentation | Challenger une conception avant démo |
| [tool-tracer](./tool-tracer/) | Traçage des outils | Comprendre appels, erreurs et séquences d'exécution |

## Observabilité, évaluation et LangSmith/Langfuse

| Skill | Rôle | Cas d'utilisation |
| --- | --- | --- |
| [langfuse](./langfuse/) | Observabilité et évaluation Langfuse | Traces, datasets, prompts et analyses d'erreurs |
| [migrate-to-langfuse](./migrate-to-langfuse/) | Migration vers Langfuse | Remplacer une instrumentation historique |
| [langsmith-trace](./langsmith-trace/) | Inspection de traces LangSmith | Examiner une exécution agentique |
| [langsmith-custom-apps](./langsmith-custom-apps/) | Intégration d'applications LangSmith | Relier une application aux traces et retours |
| [langsmith-dataset](./langsmith-dataset/) | Datasets d'évaluation | Créer et maintenir des jeux de cas |
| [langsmith-evaluator](./langsmith-evaluator/) | Évaluateurs LangSmith | Noter des sorties selon une fonction de qualité |
| [langsmith-online-eval-engineering](./langsmith-online-eval-engineering/) | Évaluation en ligne | Surveiller qualité et régressions en production |
| [readme-creator](./readme-creator/) | Création de README | Documenter un dépôt avec structure et qualité |
| [readme-generator](./readme-generator/) | Génération de README | Produire rapidement une documentation projet |

## Analyse quantitative, dessin et paiement

| Skill | Rôle | Cas d'utilisation |
| --- | --- | --- |
| [monte-carlo-analysis](./monte-carlo-analysis/) | Simulation probabiliste | Tester risque, latence ou scénarios financiers |
| [x402](./x402/) | Protocole de paiement HTTP 402 | Concevoir challenge, preuve et règlement |
| [quickstart-x402](./quickstart-x402/) | Démarrage rapide x402 | Monter un prototype de paiement agentique |
| [draw-io](./draw-io/) | Diagrammes draw.io | Visualiser architecture et flux de gouvernance |
| [github-actions-docs](./github-actions-docs/) | Documentation CI/CD GitHub Actions | Décrire workflows et automatisation de tests |

## Règle de choix rapide

- Besoin de **workflow avec état, pause ou reprise** : commencer par
  [langgraph](./langgraph/) et [langgraph-human-in-the-loop](./langgraph-human-in-the-loop/).
- Besoin de **modèle, outils ou RAG** : utiliser [langchain](./langchain/).
- Besoin de **traces et évaluation** : utiliser [langfuse](./langfuse/) ou les
  skills LangSmith adaptés.
- Besoin de **paiement agentique** : utiliser [x402](./x402/) ou
  [quickstart-x402](./quickstart-x402/).
- Besoin de **débogage ou décision de conception** : utiliser
  [diagnosing-bugs](./diagnosing-bugs/) ou [root-cause-analysis](./root-cause-analysis/).
- Besoin de **documentation ou architecture visuelle** : utiliser
  [readme-generator](./readme-generator/) ou [draw-io](./draw-io/).

Les skills d'un même domaine sont complémentaires : le catalogue ne remplace
pas leurs contraintes détaillées ni la vérification des versions et de la
documentation officielle.
