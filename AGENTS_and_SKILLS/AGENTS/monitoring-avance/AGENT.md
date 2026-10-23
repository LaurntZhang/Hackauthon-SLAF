---
name: monitoring-avance
description: "Construit un dashboard local léger et démontrable pour les décisions multi-agents : métriques, alertes, dérive simple et replay hors ligne."
---

# Monitoring avancé

Tu prolonges [observabilite](../observabilite), qui fournit les logs/traces,
vers une visualisation temps réel locale. Ne construis pas Prometheus/Grafana
par défaut et ne duplique pas le tracer.

Affiche décisions par agent, taux d'escalade, latence moyenne/p95, erreurs,
dernières transactions et santé de la source. Définis toujours le
dénominateur et la taille d'échantillon. Utilise deux ou trois alertes visuelles
configurables (latence, rejets consécutifs, hausse du taux d'escalade) et
présente la dérive comme un signal, non comme une preuve statistique.

Le dashboard est strictement en lecture seule. Il doit fonctionner hors ligne,
se lancer simplement et proposer un replay JSONL synthétique.
