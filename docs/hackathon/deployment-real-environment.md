# Déploiement en environnement réel — ManAgent

## Objectif

Décrire une trajectoire de déploiement réaliste pour passer du simulateur
offline au service de gouvernance multi-agents d'un établissement financier.

Le prototype actuel démontre les règles et le parcours HITL avec des données
synthétiques. Il ne doit pas être connecté directement à un marché réel sans
les contrôles, l'identité, la persistance et les procédures décrites ci-dessous.

## Principes non négociables

1. **FinGuard reste indépendant des agents.** Aucun agent ne possède de
   credential permettant de toucher directement au marché.
2. **La décision et l'exécution sont séparées.** Une intention approuvée devient
   une autorisation bornée ; l'exécuteur ne peut pas modifier ses paramètres.
3. **Fail closed.** Une panne d'un LLM, du registre, de l'audit ou d'un
   référentiel bloque ou escalade l'action ; elle ne l'autorise jamais par défaut.
4. **Toute décision est traçable.** Le journal contient l'identité, l'action,
   l'heure UTC, la justification, les règles appliquées, le statut et le lien
   de corrélation.
5. **L'humain garde le dernier mot.** Le kill switch global et la levée d'une
   quarantaine ne sont pas délégués à un agent.

## Architecture cible

```text
Utilisateur / OMS
        |
   API Gateway + WAF
        |
  API ManAgent / SSE
        |
  Orchestrateur LangGraph
   /       |        \
Proposer  Juges   Supervisor
   \       |        /
       FinGuard
  Firewall / Policy / Quorum
  Authorization / Integrity
  Risk Governor / Kill switch
        |
 Passerelle d'exécution unique
        |
   OMS / Broker / Marché

FinGuard --> PostgreSQL (état, mandats, autorisations)
FinGuard --> Audit WORM (journal immuable)
Tous services --> Observabilité --> SIEM / alerting
```

Les agents peuvent être remplacés ou mis à jour sans modifier les règles de
contrôle. La passerelle d'exécution est le seul composant autorisé à appeler
l'OMS, le broker ou le marché.

## Séparation des environnements

| Environnement | Données | Objectif | Accès |
| --- | --- | --- | --- |
| Développement | synthétiques | développer et tester | équipe projet |
| Recette | synthétiques anonymisées | valider les règles métier | métier, conformité |
| Préproduction | flux simulés ou sandbox broker | tester intégration et charge | équipe restreinte |
| Production | données réelles | exécuter sous mandat | opérateurs autorisés |

Chaque environnement doit avoir ses propres comptes, secrets, bases et clés.
Une donnée ou une autorisation de production ne doit pas être réutilisée dans
un environnement inférieur.

## Socle de plateforme

### Compute

- Kubernetes managé ou plateforme équivalente ;
- namespaces séparés pour API, orchestration, FinGuard, workers et observabilité ;
- au moins deux instances pour les composants stateless en production ;
- autoscaling borné et dimensionné sur la file d'attente, la latence et le
  nombre de décisions en attente ;
- images minimales, non-root, signées et scannées avant déploiement.

### Données

- PostgreSQL haute disponibilité pour mandats, intentions, autorisations,
  checkpoints et états métier ;
- Redis ou service équivalent pour compteurs rapides et circuit breaker ;
- stockage objet avec rétention verrouillée/WORM pour l'audit ;
- sauvegardes chiffrées, testées et restaurables ;
- chiffrement en transit et au repos ;
- horloge synchronisée sur tous les nœuds.

### Accès externe

- API Gateway/WAF devant l'API ;
- réseau privé pour PostgreSQL, Redis et le broker ;
- egress contrôlé pour les appels LLM et référentiels ;
- mTLS ou mécanisme équivalent entre services sensibles ;
- aucun accès entrant direct vers les workers d'agents.

## Identité, secrets et autorisations

- SSO/OIDC pour les opérateurs humains ;
- MFA obligatoire pour les approbations sensibles ;
- rôles séparés : opérateur, approbateur, conformité, administrateur,
  auditeur ;
- comptes de service distincts pour chaque agent ;
- coffre de secrets avec rotation automatique ;
- credentials du broker uniquement dans la passerelle d'exécution ;
- approbation liée à `intent_hash`, à l'identité de l'approbateur et à une
  expiration courte ;
- révocation immédiate d'un mandat, d'un agent ou d'une autorisation ;
- journalisation de chaque opération administrative.

## Déploiement applicatif

### Pipeline CI/CD

1. Vérification du formatage, du typage et des tests unitaires.
2. Tests des invariants de gouvernance et des contrats Pydantic.
3. Tests d'intégration avec des services simulés.
4. Analyse des dépendances et scan d'image.
5. Évaluation des prompts et tests de non-régression des agents.
6. Validation humaine de la version des politiques.
7. Déploiement en recette, puis promotion signée vers la production.

Une version de politique, de mandat ou de prompt doit être identifiable et
rejouable. Une modification de règle ne doit pas écraser la version précédente.

### Stratégie de mise en production

- commencer en **shadow mode** : les agents proposent, mais aucune exécution
  réelle n'est autorisée ;
- comparer les décisions avec les règles existantes ;
- activer ensuite un périmètre limité, avec montants plafonnés ;
- élargir progressivement les actifs, contreparties et budgets ;
- conserver un kill switch testé avant chaque élargissement ;
- utiliser un canary ou une activation par mandat pour les nouvelles versions.

## Contrôles de sécurité et de gouvernance

### Avant exécution

- validation du schéma et de la provenance des entrées ;
- détection d'injection dans les documents externes ;
- contrôle de mandat, d'actif, de contrepartie et de montant ;
- quorum et gestion des abstentions/vetos ;
- contrôle de l'expiration et de la révocation ;
- comparaison de l'ordre avec le hash de l'intention ;
- vérification du budget cumulé et de la fréquence ;
- vérification du kill switch et du circuit breaker.

### Pendant l'exécution

- idempotence par `transaction_id` et `order_id` ;
- timeouts et retries bornés ;
- aucun retry automatique après une réponse ambiguë du broker sans
  réconciliation ;
- journalisation de la requête, de la réponse et du statut ;
- verrouillage contre la double exécution ;
- suspension automatique en cas d'anomalie de séquence.

### Après l'exécution

- rapprochement avec l'OMS et le broker ;
- émission de l'`ExecutionReport` ;
- vérification de la chaîne d'audit ;
- notification des anomalies ;
- archivage selon la politique de conservation ;
- replay périodique d'échantillons.

## Observabilité et exploitation

Les métriques minimales sont :

- latence par nœud et par décision ;
- taux d'ALLOW, ESCALATE et BLOCK ;
- taux d'approbation et de rejet humain ;
- erreurs LLM et dépassements de timeout ;
- coût et nombre de tokens par agent ;
- nombre de tentatives hors mandat ;
- score de confiance et agents en quarantaine ;
- état du circuit breaker et du kill switch ;
- profondeur de file HITL ;
- intégrité et retard d'ingestion de l'audit.

Les alertes critiques doivent être routées vers l'astreinte et le SIEM :

- chaîne d'audit rompue ;
- tentative d'accès direct au broker ;
- modification d'une intention autorisée ;
- dépassement de budget ou fréquence ;
- augmentation anormale des rejets ;
- indisponibilité de FinGuard ou du stockage d'audit ;
- utilisation d'un secret hors du service attendu.

## Résilience et reprise

### Objectifs à fixer avec le métier

| Élément | Cible initiale |
| --- | ---: |
| RTO du control plane | 30 à 60 minutes |
| RPO de l'état métier | inférieur à 5 minutes |
| RPO de l'audit | zéro perte acceptée |
| Disponibilité production | 99,9 % |

En cas d'indisponibilité de PostgreSQL, de l'audit, du référentiel de
contreparties ou du broker, le système doit suspendre les nouvelles exécutions.
Les transactions déjà envoyées doivent être réconciliées avant toute reprise.

Un exercice PRA doit vérifier :

- restauration de la base ;
- continuité de la chaîne d'audit ;
- réconciliation des ordres ;
- réactivation contrôlée du circuit breaker ;
- validation du kill switch ;
- traçabilité de la décision de reprise.

## Plan de déploiement par étapes

### Étape 1 — Durcissement du prototype

- remplacer les composants de démonstration par des services persistants ;
- formaliser les contrats et les politiques versionnées ;
- ajouter l'identité et les secrets ;
- compléter les tests des scénarios S1 à S6.

### Étape 2 — Pilote sans effet de marché

- déployer en recette puis en shadow mode ;
- brancher les données et référentiels de test ;
- mesurer latence, escalades, faux positifs et coût par décision ;
- faire valider les règles par le métier et la conformité.

### Étape 3 — Production limitée

- activer un seul périmètre et des plafonds bas ;
- imposer l'approbation humaine pour les cas sensibles ;
- surveiller quotidiennement l'audit et les rapprochements ;
- réaliser un rollback applicatif et un exercice kill switch.

### Étape 4 — Extension maîtrisée

- ajouter progressivement actifs, contreparties et agents ;
- recalibrer les seuils sur des données observées ;
- effectuer une revue de sécurité et de conformité à chaque changement majeur.

## Responsabilités opérationnelles

| Responsabilité | Équipe principale |
| --- | --- |
| Politiques et seuils | Métier + Risk + Compliance |
| Mandats et autorisations | Compliance + administrateur FinGuard |
| Modèles, prompts et évaluations | Équipe IA |
| FinGuard et API | Équipe plateforme/backend |
| Infrastructure et secrets | SRE/Cloud |
| Approbations sensibles | Superviseur humain habilité |
| Audit et conservation | Sécurité, conformité et data governance |
| Incident et kill switch | SRE + responsable métier habilité |

## Conditions de go-live

Le système ne doit pas passer en production tant que les points suivants ne
sont pas prouvés :

- aucun chemin d'exécution ne contourne FinGuard ;
- un ordre modifié après approbation est bloqué ;
- un rejet n'atteint pas la passerelle ;
- le kill switch coupe effectivement l'exécution ;
- une ligne d'audit modifiée est détectée ;
- les sauvegardes et la restauration ont été testées ;
- les rôles humains et la MFA sont opérationnels ;
- les runbooks d'incident et de reprise sont approuvés ;
- le coût par décision et la capacité maximale sont connus ;
- le mode dégradé reste fail closed.
