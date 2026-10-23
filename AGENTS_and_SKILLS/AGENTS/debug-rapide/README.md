# Debug Rapide

Agent d'intervention minimale pour analyser une traceback, isoler la cause
racine et appliquer un correctif ciblé. Il refuse les refactorings opportunistes
et vérifie le retour au vert avec le test le plus proche.

`scripts/triage_traceback.py` extrait les emplacements Python d'une trace afin
de préparer le diagnostic.
