# Lecteur de documentation

Cet agent répond aux questions de syntaxe à partir des cheat sheets locales du
projet. Il est conçu pour rester utile sans connexion internet pendant le
hackathon.

## Utilisation

Demander par exemple :

- « Comment reprendre un graphe LangGraph après `interrupt()` ? »
- « Donne un modèle Pydantic v2 avec un validator de montant. »
- « Quelle structure minimale pour un endpoint FastAPI qui renvoie 402 ? »
- « Comment instrumenter un nœud avec Langfuse sans bloquer le mode offline ? »

L'agent cite le fichier consulté et sépare les éléments confirmés des points à
vérifier selon la version installée.

## Sources

Les fiches sont dans [`docs/cheatsheets/`](../../docs/cheatsheets/). Les
références officielles complémentaires sont dans
[`docs/cheatsheets/README.md`](../../docs/cheatsheets/README.md).
