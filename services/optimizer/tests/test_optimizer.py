from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from main import OptimizeRequest, app, solve_allocation


client = TestClient(app)
BASE = datetime(2026, 11, 5, 9, tzinfo=timezone.utc)


def faculty(fid: str, skills: list[str], max_minutes: int = 600) -> dict:
    return {
        "id": fid,
        "name": fid,
        "skills": skills,
        "target_minutes": 120,
        "max_minutes": max_minutes,
    }


def duty(did: str, role: str, start: datetime = BASE, minutes: int = 60, skill: str | None = None) -> dict:
    return {
        "id": did,
        "event_id": "event-1",
        "event_name": "Assessment",
        "role": role,
        "required_skill": skill,
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(minutes=minutes)).isoformat(),
        "minutes": minutes,
    }


def solve(payload: dict) -> dict:
    return solve_allocation(OptimizeRequest.model_validate(payload))


def test_assigns_one_qualified_person_per_duty_without_overlap() -> None:
    result = solve(
        {
            "mode": "ALLOCATE",
            "faculty": [faculty("a", ["coordination", "invigilation"]), faculty("b", ["invigilation"])],
            "duties": [
                duty("d1", "Coordinator", skill="coordination"),
                duty("d2", "Invigilator", skill="invigilation"),
            ],
        }
    )
    assert result["status"] == "OPTIMAL"
    assert {item["duty_id"] for item in result["assignments"]} == {"d1", "d2"}
    assert len({item["faculty_id"] for item in result["assignments"]}) == 2


def test_repair_keeps_unchanged_assignment_when_possible() -> None:
    result = solve(
        {
            "mode": "REPAIR",
            "faculty": [faculty("a", ["invigilation"]), faculty("b", ["invigilation"])],
            "duties": [duty("d1", "Invigilator", skill="invigilation")],
            "baseline": [{"faculty_id": "a", "duty_id": "d1", "change_weight": 5}],
        }
    )
    assert result["status"] == "OPTIMAL"
    assert result["assignments"] == [{"faculty_id": "a", "duty_id": "d1"}]
    assert result["objective_levels"][1]["value"] == 0


def test_unavailability_causes_reassignment_and_explanation_is_returned_if_open() -> None:
    result = solve(
        {
            "mode": "REPAIR",
            "faculty": [faculty("a", ["invigilation"]), faculty("b", ["invigilation"])],
            "duties": [duty("d1", "Invigilator", skill="invigilation")],
            "unavailable": [
                {
                    "faculty_id": "a",
                    "starts_at": (BASE - timedelta(minutes=1)).isoformat(),
                    "ends_at": (BASE + timedelta(hours=2)).isoformat(),
                }
            ],
            "baseline": [{"faculty_id": "a", "duty_id": "d1"}],
        }
    )
    assert result["assignments"] == [{"faculty_id": "b", "duty_id": "d1"}]
    assert result["uncovered"] == []


def test_unstaffable_role_is_reported_instead_of_hidden() -> None:
    result = solve(
        {
            "mode": "ALLOCATE",
            "faculty": [faculty("a", ["invigilation"])],
            "duties": [duty("d1", "Coordinator", skill="coordination")],
        }
    )
    assert result["status"] == "OPTIMAL"
    assert result["assignments"] == []
    assert result["uncovered"][0]["duty_id"] == "d1"
    assert "coordination" in result["uncovered"][0]["reason"]


def test_maximum_workload_is_a_hard_limit() -> None:
    result = solve(
        {
            "mode": "ALLOCATE",
            "faculty": [faculty("a", ["invigilation"], max_minutes=60)],
            "duties": [duty("d1", "Invigilator", minutes=90, skill="invigilation")],
        }
    )
    assert result["assignments"] == []
    assert result["uncovered"][0]["duty_id"] == "d1"


def test_http_health_and_optimizer_contract() -> None:
    assert client.get("/health").json()["solver"] == "OR-Tools CP-SAT"
    response = client.post(
        "/optimize",
        json={"faculty": [faculty("a", ["invigilation"])], "duties": [duty("d1", "Invigilator", skill="invigilation")]},
    )
    assert response.status_code == 200
    assert response.json()["assignments"][0]["faculty_id"] == "a"


def test_demo_scale_covers_overlapping_roles_with_50_faculty() -> None:
    people = [
        faculty(f"f{index:02d}", ["invigilation", "coordination"] if index < 10 else ["invigilation"], max_minutes=480)
        for index in range(50)
    ]
    duties = []
    for event_index in range(12):
        starts_at = BASE + timedelta(days=event_index % 8, hours=2 * (event_index % 3))
        duties.extend(
            [
                duty(f"coord-{event_index}", "Coordinator", starts_at, 120, "coordination"),
                duty(f"inv-a-{event_index}", "Invigilator", starts_at, 120, "invigilation"),
                duty(f"inv-b-{event_index}", "Invigilator", starts_at, 120, "invigilation"),
            ]
        )

    result = solve(
        {
            "mode": "ALLOCATE",
            "faculty": people,
            "duties": duties,
            "time_limit_seconds": 5,
        }
    )

    assert result["status"] == "OPTIMAL"
    assert len(result["assignments"]) == 36
    assert result["solver_stats"]["candidate_variables"] > 1000
