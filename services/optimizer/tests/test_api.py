from fastapi.testclient import TestClient

from gbsoft_optimizer.app import app


client = TestClient(app)


def test_health_exposes_solver_version():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["solverVersion"].startswith("slot-cp-")
