"""Adaptable high-signal governance tests."""


def test_nominal_transaction_fixture_is_below_hitl_threshold(valid_transaction):
    assert valid_transaction["amount"] < 10000


def test_high_value_transaction_requires_human_review(high_value_transaction):
    assert high_value_transaction["amount"] >= 10000
