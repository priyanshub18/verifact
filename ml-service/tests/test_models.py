"""Needs torch + network to fetch weights. Run: pytest -m models"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.models
client = TestClient(app)


def test_rerank_prefers_relevant():
    r = client.post("/rerank", json={"query": "How tall is the Eiffel Tower?", "passages": [
        "Cats are small carnivorous mammals kept as pets.", "The Eiffel Tower is 330 metres tall including antennas."]})
    assert r.status_code == 200, r.text
    s = r.json()["scores"]
    assert s[1] > s[0]


def test_nli_entailment_vs_contradiction():
    r = client.post("/nli", json={"pairs": [
        {"premise": "The Eiffel Tower is located in Paris, France.", "hypothesis": "The Eiffel Tower is in Paris."},
        {"premise": "The Eiffel Tower is located in Paris, France.", "hypothesis": "The Eiffel Tower is in Rome."}]})
    assert r.status_code == 200, r.text
    a, b = r.json()["results"]
    assert a["entailment"] > a["contradiction"]
    assert b["contradiction"] > b["entailment"]
