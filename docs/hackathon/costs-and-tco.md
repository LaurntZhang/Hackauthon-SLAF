# Coûts de mise en œuvre et coût de fonctionnement — ManAgent

## Objectif du document

Ce document donne un ordre de grandeur budgétaire pour transformer le prototype
ManAgent en service gouverné exploitable en production, puis pour le maintenir dans
le temps.

Les montants sont des **estimations HT**, exprimées en euros 2026. Ils ne
constituent pas un devis : le coût réel dépendra du volume de transactions, du
choix cloud/on-premise, des modèles utilisés, des exigences de conservation et du
niveau de certification attendu.

## Périmètre de référence

L'estimation couvre :

- le Control Plane FinGuard et ses règles déterministes ;
- les agents Proposer, Risk Judge, Compliance Judge, Executor et Supervisor ;
- l'API FastAPI, le dashboard et le parcours HITL ;
- les contrats Pydantic, les checkpoints et la persistance ;
- l'audit chaîné, l'observabilité et l'alerting ;
- l'intégration à un environnement bancaire simulé puis réel ;
- la sécurité, les tests, la documentation et le runbook d'exploitation.

Elle ne couvre pas :

- les licences de marché, de données financières ou de connectivité broker ;
- les coûts de conformité propres à l'établissement ;
- la construction d'un nouveau SI de gestion d'actifs ;
- une certification réglementaire complète ;
- les pertes ou coûts liés à une transaction métier.

## Hypothèses de dimensionnement

| Hypothèse | Pilote | Production initiale |
| --- | ---: | ---: |
| Fonds ou périmètre métier | 1 | 1 à 3 |
| Transactions gouvernées | 1 000 / jour | 10 000 à 50 000 / jour |
| Décisions nécessitant HITL | 5 % | 2 à 10 % |
| Agents déployés | 3 à 5 | 5 à 10 |
| Disponibilité cible | 99,5 % | 99,9 % |
| Conservation de l'audit | 90 jours chaud | 7 ans, selon politique |
| Environnements | dev, démo | dev, recette, préproduction, production |

Le coût est davantage piloté par le nombre de décisions LLM et le niveau
d'exigence opérationnelle que par le nombre de pods.

## Coût de mise en œuvre initiale

### Scénarios budgétaires

| Niveau | Délai indicatif | Équipe typique | Charge humaine indicative | Budget de mise en œuvre |
| --- | ---: | --- | ---: |
| Démonstrateur renforcé | 2 à 4 semaines | 2 personnes | 1 à 2 personnes pendant 1 mois | 15 k€ à 40 k€ |
| Pilote contrôlé | 2 à 3 mois | 3 à 5 personnes | 8 à 15 personnes-mois | 120 k€ à 300 k€ |
| Première version production | 4 à 6 mois | 5 à 8 personnes | 25 à 45 personnes-mois | 350 k€ à 800 k€ |

Ces montants incluent principalement le travail humain. Les consommations cloud
et les licences de la phase de construction sont généralement secondaires, sauf
si des données de marché ou des modèles propriétaires sont utilisés.

### Ressources humaines de construction

Le budget doit inclure les personnes qui conçoivent, construisent, valident et
mettent en exploitation la solution. Une équipe réaliste pour une première
version production est composée de :

| Rôle | Contribution principale | Charge indicative |
| --- | --- | ---: |
| Product owner / chef de projet | périmètre, priorités, coordination, arbitrages | 0,5–1 ETP |
| Référent métier / gestion d'actifs | règles de gestion, seuils, cas limites | 0,3–0,8 ETP |
| Risk / Compliance | validation des mandats, contrôles et preuves | 0,2–0,6 ETP |
| Ingénieurs backend / FinGuard | API, politiques, autorisations, exécution | 1,5–3 ETP |
| Ingénieur IA / orchestration | agents, prompts, évaluations, dérive | 1–2 ETP |
| Ingénieur frontend | dashboard, HITL, accessibilité | 0,5–1 ETP |
| DevSecOps / SRE | réseau, CI/CD, secrets, disponibilité, PRA | 0,5–1 ETP |
| QA / validation | tests, charge, sécurité, non-régression | 0,5–1 ETP |

Les mêmes personnes peuvent couvrir plusieurs rôles pendant un pilote, mais les
responsabilités de validation et d'approbation ne doivent pas être confondues
avec celles du développement. Pour convertir une charge en budget, utiliser un
coût employeur ou un taux journalier complet incluant salaire, charges,
management, locaux et prestataires. À titre de repère de chiffrage, une équipe
peut retenir **700 à 1 200 € par jour-personne** pour des profils spécialisés ;
ce repère doit être remplacé par les coûts internes ou les contrats réels.

### Décomposition d'une première version production

| Lot | Contenu | Part indicative |
| --- | --- | ---: |
| Cadrage métier et gouvernance | mandats, seuils, règles, rôles, validations conformité | 10–15 % |
| FinGuard | Policy Engine, quorum, Integrity Engine, Risk Governor, kill switch | 20–25 % |
| Agents et orchestration | LangGraph, contrats, sorties structurées, reprise HITL | 15–20 % |
| API et interfaces | API, dashboard, téléphone d'approbation, SSE | 10–15 % |
| Données et audit | PostgreSQL, audit WORM, rétention, replay | 10–15 % |
| Sécurité et plateforme | IAM, secrets, réseau, CI/CD, Kubernetes, sauvegardes | 15–20 % |
| Tests et mise en production | tests de charge, sécurité, PRA, documentation, formation | 10–15 % |

La somme des pourcentages sert à répartir l'effort ; elle ne doit pas être
additionnée à un budget séparé.

Le lot « tests et mise en production » inclut également la formation des
opérateurs, du superviseur humain et de l'équipe d'astreinte. Le temps de
validation du métier et de la conformité est une charge projet réelle, même
si elle n'est pas facturée comme une prestation technique.

## Coût récurrent mensuel

### Infrastructure et services

| Poste | Pilote | Production initiale |
| --- | ---: | ---: |
| Compute agents/API/workers | 500–2 000 € | 3 000–12 000 € |
| PostgreSQL managé et sauvegardes | 300–1 000 € | 1 000–4 000 € |
| Redis ou équivalent compteurs | 100–500 € | 500–2 000 € |
| Stockage audit immuable | 100–800 € | 500–4 000 € |
| Logs, métriques, traces | 300–1 500 € | 1 500–8 000 € |
| Réseau, WAF, certificats, secrets | 200–1 000 € | 1 000–5 000 € |
| Modèles LLM et embeddings | 500–5 000 € | 3 000–30 000 € |
| **Total technique indicatif** | **2,0–11,8 k€** | **10,5–65 k€** |

Les fourchettes sont volontairement larges. Une politique de routage peut
réduire le coût LLM : modèle local ou peu coûteux pour les tâches simples,
modèle plus capable uniquement pour les cas ambigus, et aucun LLM pour les
contrôles FinGuard.

### Exploitation humaine

Le coût technique n'est pas le coût total. Il faut prévoir une capacité
permanente pour :

- la maintenance des politiques et des mandats ;
- la revue des alertes et des décisions escaladées ;
- la surveillance des dérives et des performances ;
- la gestion des incidents et des accès ;
- la mise à jour des modèles et l'évaluation de non-régression ;
- les demandes d'audit et de conformité.

Ordre de grandeur :

| Niveau | Charge récurrente | Coût humain mensuel indicatif |
| --- | ---: | ---: |
| Pilote | 0,5 à 1 ETP | 5 k€ à 15 k€ |
| Production initiale | 1,5 à 3 ETP | 15 k€ à 40 k€ |
| Service critique multi-périmètres | 3 à 6 ETP | 35 k€ à 90 k€ |

Cette charge inclut les équipes techniques et de gouvernance. Elle ne signifie
pas que six personnes sont présentes à temps plein en permanence : elle
représente la capacité mensuelle cumulée, avec une astreinte dimensionnée
séparément si le service est critique.

### TCO mensuel : technique plus humain

| Niveau | Coût technique | Coût humain | TCO mensuel indicatif |
| --- | ---: | ---: | ---: |
| Pilote | 2,0–11,8 k€ | 5–15 k€ | **7–26,8 k€** |
| Production initiale | 10,5–65 k€ | 15–40 k€ | **25,5–105 k€** |
| Service critique multi-périmètres | à dimensionner | 35–90 k€ | **technique + 35–90 k€** |

Le TCO humain comprend le développement et la maintenance applicative, le SRE,
la sécurité, les revues de politiques, la conformité, les évaluations des
modèles et le traitement des alertes. Il comprend aussi le temps des
approbateurs humains lorsque les escalades sont fréquentes. Les coûts internes
doivent être imputés au même titre que les factures cloud.

Le coût de fonctionnement complet d'une production initiale se situe donc
approximativement entre **25,5 k€ et 105 k€ par mois** dans les hypothèses
ci-dessus, hors licences de marché et astreinte externalisée éventuelle.

## Coûts ponctuels à ne pas oublier

- intégration IAM, SSO, mTLS et gestion des rôles ;
- connecteurs broker, OMS/EMS, KYC et référentiels de marché ;
- revue juridique et conformité ;
- tests d'intrusion et audit indépendant ;
- exercice de reprise après sinistre ;
- formation des opérateurs et du superviseur humain ;
- migration et archivage des journaux existants ;
- astreinte et support éditeur/cloud.

Ces éléments peuvent ajouter **15 % à 30 %** au budget initial d'un pilote
industriel.

## Leviers de maîtrise du TCO

1. Garder les règles critiques dans FinGuard, sans appel LLM.
2. Utiliser des sorties structurées et limiter la taille du contexte envoyé aux
   modèles.
3. Mettre en cache les référentiels de lecture et versionner les prompts.
4. Router les tâches simples vers un modèle moins coûteux.
5. Conserver l'audit chaud sur une durée courte, puis archiver en stockage
   immuable moins coûteux.
6. Mesurer le coût par décision, par agent et par scénario.
7. Déployer séparément les workloads à faible criticité et les workloads
   d'exécution.
8. Prévoir une capacité fixe minimale et une capacité autoscalée pour les pics.

## Indicateurs financiers à suivre

| Indicateur | Formule ou mesure |
| --- | --- |
| Coût par décision | coûts infra + LLM + observabilité / décisions terminées |
| Coût par transaction exécutée | coûts opérationnels / transactions remplies |
| Taux d'escalade | décisions HITL / décisions totales |
| Coût d'une escalade | temps humain moyen × coût horaire |
| Coût d'un rejet | décisions rejetées + analyse opérateur + reprise éventuelle |
| Coût audit | stockage + ingestion + vérification / million d'événements |
| Disponibilité | temps disponible du control plane / temps total |

## Décision recommandée pour le projet

Pour la suite immédiate, il est préférable de présenter trois budgets :

- **MVP démontrable** : faible coût, local, sans dépendance à un LLM ;
- **pilote contrôlé** : persistance, identité, monitoring et intégration limitée ;
- **production** : haute disponibilité, audit immuable, PRA, sécurité et
  exploitation continue.

Cela évite de donner un prix artificiellement précis et montre que le coût
principal vient de la maîtrise du risque et de l'intégration, pas seulement de
l'appel à un modèle.
