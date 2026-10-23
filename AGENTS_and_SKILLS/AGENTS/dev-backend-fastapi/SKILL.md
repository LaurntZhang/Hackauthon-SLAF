---
name: dev-backend-fastapi
description: "Workflow de construction et de revue d'une API FastAPI fiable pour une démonstration agentique bancaire."
---

# Skill Backend FastAPI

1. Cartographier les routes, schémas, settings et exceptions existants.
2. Définir le contrat Pydantic avant l'endpoint.
3. Implémenter la route avec séparation nette entre transport et orchestration.
4. Ajouter handlers, logs structurés, documentation OpenAPI et curl.
5. Tester nominal, validation 422, absence 404, refus 403, conflit 409 et
   reprise HITL si la route concernée l'expose.

Ne jamais masquer une erreur métier dans une réponse 200 ou un `except` large.
