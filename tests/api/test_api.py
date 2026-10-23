"""Contrats HTTP : nominal, 422, 404, 403, 409, 423 et reprise HITL."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from src.control.hitl import approval_message, sign
from src.models.finguard_contracts import utc_now
from tests.conftest import SECRET, proposal, signed_control


def approval_body(card: dict[str, Any], action: str = "approve", secret: str = SECRET) -> dict[str, Any]:
    timestamp = utc_now().replace(microsecond=0)
    message = approval_message(
        thread_id=card["thread_id"],
        action=action,
        approver_id="risk_officer_1",
        intent_hash=card["intent_hash"],
        timestamp=timestamp,
    )
    return {
        "action": action,
        "approver_id": "risk_officer_1",
        "signature": sign(secret, message),
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
    }


def test_root_health_and_openapi(client: TestClient) -> None:
    assert client.get("/").json()["docs"] == "/docs"
    assert client.get("/health").json() == {"status": "ok"}
    paths = client.get("/openapi.json").json()["paths"]
    for path in (
        "/transactions",
        "/approvals/{thread_id}",
        "/kill-switch",
        "/scenarios/{name}",
        "/events",
        "/audit/verify",
        "/decisions/{correlation_id}",
        "/controls/state",
    ):
        assert path in paths


def test_submit_nominal_transaction(client: TestClient) -> None:
    response = client.post("/transactions", json={"proposal": proposal()})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "executed" and body["report"]["status"] == "filled"
    assert body["intent"]["amount"] == "4000"
    assert client.get(f"/transactions/{body['thread_id']}").json()["status"] == "executed"


def test_validation_errors_return_422(client: TestClient) -> None:
    assert client.post("/transactions", json={}).status_code == 422
    assert client.post("/transactions", json={"proposal": proposal(amount="-1")}).status_code == 422
    assert (
        client.post("/transactions", json={"proposal": proposal(), "simulation": {"x": 1}}).status_code == 422
    )


def test_unknown_thread_returns_404(client: TestClient) -> None:
    response = client.get("/transactions/thr-missing")
    assert response.status_code == 404 and response.json()["rule_id"] == "THREAD_UNKNOWN"


def test_hitl_flow_over_http(client: TestClient) -> None:
    paused = client.post(
        "/transactions", json={"proposal": proposal(asset="EQ-LUMEN-SA", asset_type="equity", amount="85000")}
    ).json()
    assert paused["status"] == "awaiting_approval"
    thread_id = paused["thread_id"]
    card = client.get(f"/approvals/{thread_id}").json()
    assert card["intent_hash"] == paused["pending_approval"]["intent_hash"]
    assert any(c["thread_id"] == thread_id for c in client.get("/approvals").json())

    forged = client.post(f"/approvals/{thread_id}", json=approval_body(card, secret="forged"))
    assert forged.status_code == 403 and forged.json()["error"] == "invalid_signature"

    approved = client.post(f"/approvals/{thread_id}", json=approval_body(card))
    assert approved.status_code == 200 and approved.json()["status"] == "executed"

    again = client.post(f"/approvals/{thread_id}", json=approval_body(card))
    assert again.status_code == 409

    record = client.get(f"/decisions/{paused['correlation_id']}").json()
    assert record["final_status"] == "executed" and "human_decision" in record["path"]


def test_kill_switch_engage_blocks_and_release_requires_signature(client: TestClient) -> None:
    engage = {"action": "engage", "scope": "global", "operator_id": "ops_officer_1", "reason": "incident"}
    assert client.post("/kill-switch", json={**engage, "operator_id": "intruder"}).status_code == 403
    assert client.post("/kill-switch", json=engage).json()["global_engaged"] is True

    blocked = client.post("/transactions", json={"proposal": proposal()}).json()
    assert blocked["status"] == "blocked"

    release = {
        "action": "release",
        "scope": "global",
        "operator_id": "ops_officer_1",
        "reason": "fin d'incident",
    }
    assert client.post("/kill-switch", json=release).status_code == 403
    signed = signed_control("kill_switch.release", "global:*")
    response = client.post(
        "/kill-switch", json={**release, "signature": signed["signature"], "timestamp": signed["timestamp"]}
    )
    assert response.status_code == 200 and response.json()["global_engaged"] is False
    assert (
        client.post(
            "/kill-switch", json={**release, **{k: signed[k] for k in ("signature", "timestamp")}}
        ).status_code
        == 409
    )


def test_breaker_rearm_and_quarantine_release_via_api(client: TestClient) -> None:
    salami = client.post("/scenarios/salami").json()
    runtime_id = salami["runtime_id"]
    state = client.get("/controls/state", params={"runtime_id": runtime_id}).json()
    assert state["circuit_breaker"]["open"] is True

    rearm = client.post(
        "/controls/circuit-breaker/rearm",
        json={**signed_control("circuit_breaker.rearm", runtime_id), "runtime_id": runtime_id},
    )
    assert rearm.status_code == 200 and rearm.json()["open"] is False

    injection = client.post("/scenarios/injection").json()
    inj_runtime = injection["runtime_id"]
    body = {**signed_control("quarantine.release", "proposer"), "runtime_id": inj_runtime}
    wrong_target = {**signed_control("quarantine.release", "executor"), "runtime_id": inj_runtime}
    assert client.post("/controls/quarantine/proposer/release", json=wrong_target).status_code == 403
    released = client.post("/controls/quarantine/proposer/release", json=body)
    assert released.status_code == 200 and released.json()["quarantined"] is False


def test_scenarios_catalog_and_s2_approval_from_phone(client: TestClient) -> None:
    names = [s["name"] for s in client.get("/scenarios").json()]
    assert names == ["nominal", "veto_hitl", "tampering", "injection", "salami", "audit_tamper"]
    assert client.post("/scenarios/unknown").status_code == 404

    s2 = client.post("/scenarios/veto_hitl").json()
    assert s2["passed"] and s2["details"]["awaiting_approval"]
    thread_id = s2["details"]["thread_id"]
    card = client.get(f"/approvals/{thread_id}").json()
    assert card["runtime_id"] == s2["runtime_id"]
    assert client.post(f"/approvals/{thread_id}", json=approval_body(card)).json()["status"] == "executed"


def test_audit_verify_and_events_replay(client: TestClient) -> None:
    client.post("/transactions", json={"proposal": proposal()})
    verify = client.get("/audit/verify").json()
    assert verify["valid"] and verify["checked_lines"] > 0
    events = client.get("/audit/events", params={"limit": 3}).json()
    assert len(events) == 3

    with client.stream("GET", "/events", params={"replay": "true", "follow": "false"}) as stream:
        assert stream.headers["content-type"].startswith("text/event-stream")
        body = "".join(stream.iter_text())
    assert "event: transaction_completed" in body and "data: {" in body


def test_decision_unknown_returns_404(client: TestClient) -> None:
    assert client.get("/decisions/cor-missing").status_code == 404
