"""Contrats nécessaires au front Expo sans modifier le parcours HTML v1."""
from fastapi.testclient import TestClient

from src.api.main import create_app
from src.control.hitl import DEMO_SECRET
from src.graph.graph_runtime import FinGuardSystem


def test_expo_cors_preflight(client):
    response = client.options("/transactions", headers={
        "Origin": "http://localhost:8081",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    denied = client.options("/transactions", headers={
        "Origin": "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
    })
    assert denied.status_code == 400


def test_demo_rearm_targets_scenario_runtime(make_shared):
    system = FinGuardSystem(make_shared(hitl_secret=DEMO_SECRET))
    with TestClient(create_app(system)) as client:
        scenario = client.post("/scenarios/salami").json()
        runtime_id = scenario["runtime_id"]
        before = client.get("/controls/state", params={"runtime_id": runtime_id}).json()
        assert before["circuit_breaker"]["open"]
        denied = client.post("/controls/demo", json={
            "action": "rearm_breaker", "pin": "0000", "runtime_id": runtime_id,
        })
        assert denied.status_code == 403
        response = client.post("/controls/demo", json={
            "action": "rearm_breaker", "pin": "1234", "runtime_id": runtime_id,
        })
        assert response.status_code == 200
        assert response.json()["runtime_id"] == runtime_id
        assert not response.json()["open"]
