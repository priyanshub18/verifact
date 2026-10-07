import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import pytest
from metrics import auroc, ece, prf, reliability_bins
from convert_liar import convert
from run_claims import verdict_to_label


def test_prf_hand_computed():
    r = prf(["a", "a", "b", "b"], ["a", "b", "b", "b"], ["a", "b"])
    assert r["a"]["precision"] == 1.0 and r["a"]["recall"] == 0.5
    assert r["b"]["precision"] == pytest.approx(2 / 3) and r["b"]["recall"] == 1.0
    assert r["accuracy"] == 0.75


def test_auroc_known_values():
    assert auroc([1, 1, 0, 0], [0.9, 0.8, 0.2, 0.1]) == 1.0
    assert auroc([1, 0], [0.5, 0.5]) == 0.5
    assert auroc([1, 1], [0.5, 0.2]) is None


def test_ece_perfectly_calibrated_and_overconfident():
    assert ece([0.5] * 4, [True, True, False, False]) == pytest.approx(0.0)
    assert ece([0.9] * 4, [True, False, False, False]) == pytest.approx(0.65)
    assert sum(b["n"] for b in reliability_bins([0.1, 0.5, 1.0], [True, False, True])) == 3


def test_liar_conversion_drops_ambiguous_labels():
    tsv = ["1.json\tfalse\tclaim one\tx", "2.json\thalf-true\tclaim two\tx", "3.json\tmostly-true\tclaim three\tx"]
    out = list(convert(tsv))
    assert [o["label"] for o in out] == ["refuted", "supported"]


def test_verdict_mapping_never_forces_a_label():
    assert verdict_to_label("Unverifiable") == verdict_to_label("Disputed") == verdict_to_label(None) == "nei"
