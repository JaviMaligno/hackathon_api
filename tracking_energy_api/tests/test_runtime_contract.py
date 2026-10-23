"""Real Flask routes with providers replaced before application import."""

import importlib.util
import socket
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask_pymongo import PyMongo as RealPyMongo


@pytest.fixture(autouse=True)
def offline(monkeypatch, request):
    original_connect = socket.socket.connect
    internal_self_pipes = []

    def guarded_connect(sock, address):
        caller = sys._getframe(1).f_code
        # Windows asyncio uses this stdlib fallback to construct its control pair.
        # Only that exact caller and literal loopback address may connect.
        if (
            sys.platform == "win32"
            and caller.co_name == "_fallback_socketpair"
            and caller.co_filename == socket.__file__
            and isinstance(address, tuple)
            and address[0] in {"127.0.0.1", "::1"}
        ):
            internal_self_pipes.append(caller.co_name)
            return original_connect(sock, address)
        raise AssertionError(
            "Offline Flask contracts must not connect to network services"
        )

    def deny_connection(*args, **kwargs):
        raise AssertionError(
            "Offline Flask contracts must not create provider connections"
        )

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket, "create_connection", deny_connection)
    yield
    if sys.platform == "win32" and request.node.name.startswith("test_async_"):
        assert internal_self_pipes, (
            "Expected only stdlib Windows event-loop control pairs"
        )


@pytest.fixture
def api(monkeypatch):
    calls = []
    records = [{"ssiId": "fixture", "name": "Synthetic player", "position": "GK"}]

    class Collection:
        def find(self, query, projection):
            calls.append(("find", query, projection))
            return records

        def update_one(self, query, update, upsert):
            calls.append(("update", query, update, upsert))
            return SimpleNamespace(modified_count=1)

    database = SimpleNamespace(players_info=Collection(), tracking=Collection())
    mongo = types.ModuleType("flask_pymongo")

    class FakePyMongo:
        def __init__(self, app, uri):
            assert uri == "mongodb://synthetic.invalid/offline"
            self.db = database

    mongo.PyMongo = FakePyMongo
    connection = types.ModuleType("mongo_connection")
    connection.uri = "mongodb://synthetic.invalid/offline"
    calculator = types.ModuleType("energy_calculator")

    def energy(db, player, date, **kwargs):
        assert db is database
        calls.append(("energy", player, date, kwargs))
        return [0.9, 0.75] if kwargs.get("cum") else 0.75

    def history(db, player, date, period, minute, **kwargs):
        calls.append(("history", player, date, period, minute))
        return 0.35

    calculator.energy_level_of_player_in_game = energy
    calculator.energy_history_of_player_in_game = history
    calculator.predict_time_to_threshold = lambda levels, threshold: 12.8
    calculator.predict_energy_after_minutes = lambda levels, minutes: 0.6
    for name, module in {
        "flask_pymongo": mongo,
        "mongo_connection": connection,
        "energy_calculator": calculator,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)
    app_path = Path(__file__).resolve().parents[1] / "api" / "app.py"
    spec = importlib.util.spec_from_file_location(
        "offline_tracking_application", app_path
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.app.config.update(TESTING=True)
    return module.app.test_client(), calls


def test_async_energy_and_history_preserve_query_conversion(api):
    client, calls = api
    response = client.get("/energy?ssiId=fixture&date=2026-01-01")
    assert response.status_code == 200
    assert response.get_json() == 0.75
    assert calls[0][1:3] == ("fixture", "2026-01-01")
    response = client.get(
        "/energy/history?ssiId=fixture&date=2026-01-01&period=1&minute=12.5"
    )
    assert response.get_json() == 0.35
    assert calls[-1] == ("history", "fixture", "2026-01-01", 1, 12.5)


def test_async_predictions_preserve_json_shapes(api):
    client, _ = api
    assert client.get(
        "/energy/predict/minutes?ssiId=fixture&threshold=0.5"
    ).get_json() == {"minutes": 12}
    assert (
        client.get("/energy/predict/energy-level?ssiId=fixture&minutes=10").get_json()
        == 0.6
    )
    assert (
        client.get("/energy/predict/energy-level?minutes=invalid").get_json()
        == "Please introduce a number of minutes"
    )


def test_async_player_list_and_cors_preserve_response(api):
    client, calls = api
    response = client.get(
        "/players/fixture-team", headers={"Origin": "http://localhost:3000"}
    )
    assert response.status_code == 200
    assert response.get_json()["team"] == "fixture-team"
    assert response.get_json()["players"][0]["ssiId"] == "fixture"
    assert calls[-1][1] == {"team": "fixture-team"}
    assert response.headers["Access-Control-Allow-Origin"] in {
        "*",
        "http://localhost:3000",
    }

    denied_origin = client.get(
        "/energy?ssiId=fixture", headers={"Origin": "https://untrusted.invalid"}
    )
    assert "Access-Control-Allow-Origin" not in denied_origin.headers


def test_tracking_json_is_forwarded_only_to_synthetic_collection(api):
    # The actual updated adapter imports under Flask3 without creating a client.
    assert RealPyMongo().cx is None
    client, calls = api
    response = client.post(
        "/tracking",
        json={
            "date": "2026-01-01",
            "period": 1,
            "gameClock": 60,
            "homePlayers": [{"playerId": "fixture", "speed": 1.5}],
            "awayPlayers": [],
        },
    )
    assert response.status_code == 200
    assert response.get_json() == "1 modified documents"
    assert calls[-1] == (
        "update",
        {"ssiId": "fixture", "match_date": "2026-01-01"},
        {"$push": {"speeds.period_1": {"time": 60, "speed": 1.5}}},
        True,
    )
