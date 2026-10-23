# Catalogue des agents Finaxys

Ce catalogue a été établi à partir des `AGENT.md`, `SKILL.md`, `README.md` et
`metadata.json` présents dans chaque dossier agent. Les fichiers exécutables
Copilot correspondants se trouvent dans [`.github/agents/`](../.github/agents/).

## Vue d'ensemble

| Agent | Rôle | Utilité principale |
| --- | --- | --- |
| [agent-evaluation-designer](./agent-evaluation-designer/) | Concepteur d'évaluation d'agents | Définir des critères, jeux de tests et verdict go/no-go |
| [agent-performance-triage](./agent-performance-triage/) | Analyste de performance opérationnelle | Transformer analytics et transcripts en backlog priorisé |
| [agent-red-team](./agent-red-team/) | Red team d'agents | Tester injections, fuites et détournements |
| [architecte-solution](./architecte-solution/) | Architecte multi-agents BFI | Concevoir une architecture simple, gouvernée et démontrable |
| [chef-hackathon](./chef-hackathon/) | Responsable scope et livraison | Protéger le MVP et décider quoi couper |
| [copilot-studio-harness-picker](./copilot-studio-harness-picker/) | Conseiller de choix de plateforme | Comparer harness, canal, identité et forme de solution |
| [debug-rapide](./debug-rapide/) | Débogueur d'urgence | Appliquer un correctif minimal à partir d'une traceback |
| [demo-coach](./demo-coach/) | Coach de pitch et de démo | Construire une démonstration de cinq minutes |
| [deploy-rapide](./deploy-rapide/) | DevOps de démonstration | Rendre le démarrage reproductible et stable |
| [dev-backend-fastapi](./dev-backend-fastapi/) | Spécialiste de frontière API | Construire routes, contrats, erreurs et OpenAPI |
| [dev-langgraph](./dev-langgraph/) | Développeur d'orchestration | Construire StateGraph, nœuds, routage et HITL |
| [designer-interface](./designer-interface/) | Designer d'interfaces distinctives | Concevoir et implémenter des interfaces finance/fintech humaines, accessibles et éloignées de l'esthétique générique IA |
| [enterprise-agent-design-authority](./enterprise-agent-design-authority/) | Autorité de design entreprise | Revoir sécurité, scalabilité et exploitabilité |
| [explicabilite-decisions](./explicabilite-decisions/) | Spécialiste XAI de gouvernance | Produire des fiches de décision factuelles et auditables |
| [git-hackathon](./git-hackathon/) | Gardien du workflow Git | Préserver un historique propre et une version démo stable |
| [gouvernance-conformite](./gouvernance-conformite/) | Auditeur prudentiel | Vérifier mandat, 4 yeux, HITL, audit trail et XAI |
| [microsoft-ai-platform-advisor](./microsoft-ai-platform-advisor/) | Conseiller plateforme Microsoft | Comparer les options Microsoft selon contraintes réelles |
| [mock-data-generator](./mock-data-generator/) | Générateur de données synthétiques | Préparer transactions fictives et scénarios de démo |
| [monitoring-avance](./monitoring-avance/) | Spécialiste dashboard local | Visualiser métriques, alertes, statuts et replay |
| [observabilite](./observabilite/) | Ingénieur traces et télémétrie | Produire logs JSON, Langfuse et visualisation de traces |
| [paiement-agentique](./paiement-agentique/) | Spécialiste paiements x402 | Prototyper un flow 402 sécurisé et simulable |
| [prompt-engineer-agents](./prompt-engineer-agents/) | Optimiseur de prompts internes | Fiabiliser rôles, sorties structurées et escalades |
| [securite-agentique](./securite-agentique/) | Auditeur de sécurité LLM | Examiner injections, agence excessive et cascades |
| [security-quick-audit](./security-quick-audit/) | Auditeur sécurité applicative | Chercher secrets, injections, SSRF et fuites de logs |
| [testeur-qa](./testeur-qa/) | QA des graphes multi-agents | Tester chemins nominaux, limites, boucles et reprises |
| [lecteur-docs](./lecteur-docs/) | Lecteur de documentation offline-first | Répondre depuis les cheat sheets locales avant le web |
| [ui-ux-pro-max](./ui-ux-pro-max/) | Concepteur UI/UX | Concevoir interfaces, design systems, interactions et audits d'accessibilité |

## Fiches d'utilisation

### Évaluation, qualité et exploitation

- **agent-evaluation-designer** — Définit ce que signifie « bon », choisit le
  bon mode de grading et conclut par un go/no-go. Cas : comparer deux prompts
  d'analyste, vérifier une régression de décision, préparer une gate avant démo.
- **agent-performance-triage** — Analyse analytics, transcripts et symptômes
  opérationnels pour prioriser les améliorations. Cas : latence qui augmente,
  taux d'escalade anormal, conversations sans réponse.
- **agent-red-team** — Conduit une revue adversariale d'un agent possédé par
  l'équipe. Cas : prompt injection, oversharing, fuite de données, mauvais
  appel d'outil.
- **testeur-qa** — Construit des tests pytest à fort signal pour les états et
  nœuds. Cas : transaction nominale, seuil exact, conflit analyste/validateur,
  boucle, reprise après `interrupt()`.

### Architecture et livraison

- **architecte-solution** — Produit schéma Mermaid/ASCII, flux de données,
  contrôles de mandat, HITL, audit et arbitrage MVP/production. Cas : cadrer le
  graphe Finaxys avant de coder, décider MemorySaver versus persistance cible.
- **enterprise-agent-design-authority** — Challenge une conception d'agent
  selon sécurité, gouvernance, scalabilité et opération. Cas : revue d'une
  architecture Copilot Studio, préparation d'un dossier de mise en production.
- **copilot-studio-harness-picker** — Sépare harness, modèle, canal et forme
  de solution pour choisir une cible Microsoft. Cas : agent interne Teams,
  assistant public, workflow avec action privilégiée.
- **microsoft-ai-platform-advisor** — Compare les composants de la plateforme
  Microsoft et leurs compromis. Cas : choisir entre Copilot Studio, Azure AI,
  workflow et agent pour une contrainte d'identité ou d'ALM.
- **chef-hackathon** — Classe les tâches en « doit », « utile » et « nice to
  have », avec dépendances et gel de scope. Cas : arbitrer UI contre tests,
  préparer le freeze à une heure de la démo.
- **git-hackathon** — Sécurise commits, branches, merges et checkpoint de
  démonstration. Cas : créer `demo-stable`, résoudre un conflit, détecter un
  `.env` avant commit.
- **deploy-rapide** — Prépare Docker, Compose, healthcheck et démarrage
  reproductible. Cas : lancer l'API sur le poste du jury, prévoir un démarrage
  Windows et un plan de secours.

### Développement applicatif

- **dev-backend-fastapi** — Possède uniquement la frontière HTTP : routes REST,
  Pydantic, codes d'erreur, async, CORS et OpenAPI. Cas : endpoint de
  soumission, reprise HITL, handler `MandateViolationError`.
- **dev-langgraph** — Construit des graphes modernes avec état typé, nœuds
  purs, routage nommé, checkpointer et mocks hors ligne. Cas : analyse ->
  validation -> interruption -> exécution.
- **debug-rapide** — Lit une trace, formule la cause racine et applique un
  patch de 1 à 5 lignes. Cas : clé d'état absente, `NoneType`, import ou
  erreur de reprise.
- **paiement-agentique** — Scaffolde le protocole x402 avec contrats et
  simulation testnet. Cas : réponse 402, contrôle de budget d'agent, preuve
  de paiement simulée.
- **mock-data-generator** — Génère des fixtures fictives sans données réelles.
  Cas : flux nominal, dépassement de seuil, fraude simulée, payload invalide.
- **lecteur-docs** — Consulte les cheat sheets locales avant les sources web.
  Cas : retrouver une signature LangGraph, un validator Pydantic, un endpoint
  402 ou un patron de trace Langfuse sans dépendre du réseau.

### Gouvernance, sécurité et explicabilité

- **gouvernance-conformite** — Vérifie séparation décision/exécution, mandat,
  audit trail, HITL et justification. Cas : audit pré-démo, revue d'un agent
  qui tente d'exécuter une action hors scope.
- **security-quick-audit** — Cherche vulnérabilités techniques classiques.
  Cas : secret en dur, injection SQL/shell, SSRF, dépendance risquée, log
  contenant une donnée sensible.
- **securite-agentique** — Examine les risques propres à l'autonomie LLM.
  Cas : contenu documentaire injecté dans un prompt, outil de paiement exposé
  à un analyste, sortie non validée propagée à l'exécuteur.
- **prompt-engineer-agents** — Durcit les prompts internes des agents métier,
  avec sortie Pydantic et comportement d'incertitude. Cas : prompt d'analyste,
  seuil frontière, données contradictoires ou tentative d'injection.
- **explicabilite-decisions** — Produit résumé humain, facteurs ordonnés,
  incertitudes et trace technique. Cas : expliquer une escalade à 10 001 €,
  justifier un rejet, afficher une fiche au jury.

### Démonstration et observabilité

- **observabilite** — Instrumente nœuds et transitions en JSONL/Langfuse avec
  fallback local. Cas : tracer un workflow, afficher une piste d'audit sans
  Internet, diagnostiquer une latence.
- **monitoring-avance** — Ajoute dashboard lecture seule, métriques, alertes
  et replay au-dessus des traces. Cas : afficher escalades et latences en
  temps réel, rejouer un scénario si le réseau tombe.
- **demo-coach** — Transforme la valeur technique en script de cinq minutes.
  Cas : accroche métier, cas nominal contrasté avec HITL, réponses aux
  questions du jury et plan B.
