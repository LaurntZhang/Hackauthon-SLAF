# ManAgent — synthèse de la solution (sujet 04)

**Message :** *les agents proposent, les règles décident, l'humain tranche, et tout est prouvé.*
**Thèse :** la gouvernance ne repose pas sur la bonne volonté des agents. Une couche de contrôle
indépendante, fondée sur des règles fixes, se place entre les agents IA et les actions financières réelles.

## Architecture en 3 couches
1. **Agents (LangGraph)** : un **Proposer** (LLM, créatif, sans accès aux API d'exécution) émet une
   intention de transaction. Les **juges Risque et Conformité** (LLM température 0, sortie structurée)
   l'évaluent et votent. L'**Exécuteur** prépare l'ordre sans rien décider. Aucun agent ne parle
   directement à un autre : tout passe par ManAgent sous forme de contrats Pydantic.
2. **Control Plane FinGuard (règles fixes, sans LLM)** :
   - **Agent Firewall** : les données externes sont isolées des instructions ; les injections sont détectées.
   - **Policy Engine** : chaque action reçoit l'un de trois verdicts, ALLOW / ESCALATE / BLOCK, selon le mandat.
   - **Quorum pondéré** : 2 votes sur 2 au-dessus de 1 000 €, sinon majorité pondérée > 70 %
     (poids = score de confiance) ; veto, abstention ou montant > 10 000 € ⇒ validation humaine.
   - **Registre d'autorisations** et **passerelle d'exécution** : seule la passerelle touche le marché.
   - **Integrity Engine** : l'approbation est liée au hash de l'intention ; si l'ordre a changé, il est bloqué.
   - **Risk Governor** : budget, fréquence et cumul surveillés ; coupure automatique (circuit breaker)
     et arrêt d'urgence (kill switch).
   - **Score de confiance** : un mauvais comportement réduit les droits de l'agent, jusqu'à la quarantaine.
3. **Supervision** : un **superviseur** (méta-agent) détecte les dérives et les explique ; il peut
   demander l'arrêt mais ne décide jamais. Tout arrêt est journalisé, seul un humain lève une quarantaine. **Validation humaine (HITL) depuis un téléphone**, signée.
   **Tour de contrôle** : dashboard en fil de discussion. **Audit chaîné** par hash, rejouable.

## Problème → réponse
| Problème | Réponse FinGuard |
| --- | --- |
| Agents trop autonomes | Policy Engine + mandats (moindre privilège) |
| Agents contradictoires | Quorum pondéré par la confiance + escalade humaine |
| Décision incompréhensible | Fiche explicative + audit chaîné + replay |
| Agent manipulé | Firewall zero-trust + quarantaine |
| Approbation détournée | Integrity Engine (hash de l'intention) |
| Dérive progressive | Risk Governor + coupure automatique + kill switch |

## Démo en 5 min (fonctionne hors ligne, sans LLM)
1. **Cas nominal** : 4 000 € d'obligations, exécution automatique (FinGuard reste invisible).
2. **Veto du juge Risque** sur 85 000 € → validation humaine sur téléphone → approbation signée.
3. **Exécuteur compromis** qui remplace l'actif A par l'actif B → bloqué : « une approbation n'est pas un chèque en blanc ».
4. **Document piégé** → appel d'outil interdit bloqué → agent mis en quarantaine.
5. **12 ordres de 900 €**, chacun sous le seuil → coupure automatique : « leur somme ne l'était pas ».
6. **Preuve** : replay de la timeline, puis une ligne d'audit modifiée en direct est détectée ❌.

**Stack :** LangGraph · Pydantic v2 · FastAPI avec dashboard temps réel (SSE) · pytest (un test par scénario) · Langfuse en option.
**Réglementation :** AI Act (art. 12 journalisation, art. 14 contrôle humain) · MiFID II RTS 6 (kill switch) · DORA · principe des 4 yeux.
