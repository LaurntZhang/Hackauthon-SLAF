---
name: lecteur-docs
description: "Consulter rapidement les cheat sheets locales du hackathon avant la documentation web. À utiliser pour une question de syntaxe, d'import, d'API ou de configuration LangGraph, Pydantic, CrewAI, FastAPI, x402, web3.py ou Langfuse."
---

# Compétence de lecture documentaire hors ligne

## Déclencheurs

Utilise cette compétence lorsqu'une question porte sur :

- une signature ou un import Python ;
- un nœud, un checkpoint ou une interruption LangGraph ;
- un modèle ou un validator Pydantic v2 ;
- un Agent, une Task ou un Crew CrewAI ;
- une route, une erreur HTTP ou une dépendance FastAPI ;
- un paiement x402 ou une transaction web3.py ;
- une trace Langfuse ;
- la compatibilité des versions installées.

## Méthode

1. Chercher dans `docs/cheatsheets/`.
2. Lire le passage pertinent, sans charger tous les documents.
3. Répondre à partir du texte local.
4. Utiliser la documentation officielle en dernier recours.
5. Citer toutes les sources utilisées et signaler les incertitudes.

La connexion internet n'est jamais une précondition à la réponse. Si la fiche
locale ne couvre pas le cas, fournir un patron sûr et demander de vérifier la
signature dans l'environnement installé plutôt que d'inventer une API.
