from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
import time
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from ortools.sat.python import cp_model


class Faculty(BaseModel):
    id: str
    name: str
    skills: list[str] = Field(default_factory=list)
    active: bool = True
    target_minutes: int = Field(ge=0, le=10_080, default=0)
    max_minutes: int = Field(gt=0, le=10_080)
    committed_minutes: int = Field(ge=0, le=10_080, default=0)


class Duty(BaseModel):
    id: str
    event_id: str
    event_name: str
    role: str = Field(min_length=1, max_length=80)
    required_skill: str | None = None
    forced_faculty_id: str | None = None
    starts_at: datetime
    ends_at: datetime
    minutes: int = Field(gt=0, le=1_440)
    priority: int = Field(ge=0, le=3, default=1)
    preference_costs: dict[str, int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_interval(self) -> "Duty":
        if self.ends_at <= self.starts_at:
            raise ValueError("Duty end time must be after its start time")
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("Duty times must include a timezone")
        return self


class AvailabilityBlock(BaseModel):
    faculty_id: str
    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def valid_interval(self) -> "AvailabilityBlock":
        if self.ends_at <= self.starts_at:
            raise ValueError("Availability end time must be after its start time")
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("Availability times must include a timezone")
        return self


class BaselineAssignment(BaseModel):
    faculty_id: str
    duty_id: str
    protected: bool = False
    acknowledged: bool = False
    change_weight: int = Field(ge=1, le=20, default=1)


class OptimizeRequest(BaseModel):
    mode: Literal["ALLOCATE", "REPAIR", "REBALANCE"] = "ALLOCATE"
    faculty: list[Faculty]
    duties: list[Duty]
    unavailable: list[AvailabilityBlock] = Field(default_factory=list)
    baseline: list[BaselineAssignment] = Field(default_factory=list)
    rest_minutes: int = Field(ge=0, default=0)
    time_limit_seconds: float = Field(gt=0, le=30, default=3)

    @model_validator(mode="after")
    def valid_references(self) -> "OptimizeRequest":
        faculty_ids = [person.id for person in self.faculty]
        duty_ids = [duty.id for duty in self.duties]
        if len(faculty_ids) != len(set(faculty_ids)):
            raise ValueError("Faculty IDs must be unique")
        if len(duty_ids) != len(set(duty_ids)):
            raise ValueError("Duty IDs must be unique")
        faculty_id_set = set(faculty_ids)
        duty_id_set = set(duty_ids)
        if any(block.faculty_id not in faculty_id_set for block in self.unavailable):
            raise ValueError("Availability blocks must reference included faculty")
        baseline_duty_ids: set[str] = set()
        for assignment in self.baseline:
            if assignment.faculty_id not in faculty_id_set or assignment.duty_id not in duty_id_set:
                raise ValueError("Baseline assignments must reference included faculty and duties")
            if assignment.duty_id in baseline_duty_ids:
                raise ValueError("Each baseline duty can have only one assignment")
            baseline_duty_ids.add(assignment.duty_id)
        for person in self.faculty:
            if person.committed_minutes > person.max_minutes:
                raise ValueError(f"Committed workload exceeds the maximum for {person.id}")
        for duty in self.duties:
            if any(cost < 0 or cost > 20 for cost in duty.preference_costs.values()):
                raise ValueError(f"Preference costs must be between 0 and 20 for duty {duty.id}")
            if duty.forced_faculty_id and duty.forced_faculty_id not in faculty_id_set:
                raise ValueError(f"Forced faculty must reference included faculty for duty {duty.id}")
        return self


app = FastAPI(
    title="Smart Faculty Allocation Optimizer",
    version="0.1.0",
    description="CP-SAT allocation, fair workload balancing, and minimum-change repair.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def overlaps(start_a: datetime, end_a: datetime, start_b: datetime, end_b: datetime) -> bool:
    return start_a < end_b and start_b < end_a


def solve_allocation(request: OptimizeRequest) -> dict:
    model = cp_model.CpModel()
    duty_by_id = {duty.id: duty for duty in request.duties}
    blocked_by_faculty: dict[str, list[AvailabilityBlock]] = defaultdict(list)
    for block in request.unavailable:
        blocked_by_faculty[block.faculty_id].append(block)

    candidates: dict[str, list[str]] = {}
    x: dict[tuple[str, str], cp_model.IntVar] = {}
    ineligible: dict[str, dict[str, int]] = {}

    for duty in request.duties:
        candidates[duty.id] = []
        ineligible[duty.id] = {"inactive": 0, "skill": 0, "unavailable": 0}
        for person in request.faculty:
            if not person.active:
                ineligible[duty.id]["inactive"] += 1
                continue
            if duty.required_skill and duty.required_skill.casefold() not in {
                skill.casefold() for skill in person.skills
            }:
                ineligible[duty.id]["skill"] += 1
                continue
            duty_start = duty.starts_at - timedelta(minutes=request.rest_minutes)
            duty_end = duty.ends_at + timedelta(minutes=request.rest_minutes)
            if any(
                overlaps(duty_start, duty_end, block.starts_at, block.ends_at)
                for block in blocked_by_faculty[person.id]
            ):
                ineligible[duty.id]["unavailable"] += 1
                continue
            candidates[duty.id].append(person.id)
            x[(person.id, duty.id)] = model.new_bool_var(f"x_{person.id}_{duty.id}")

    # Every role is either staffed by one eligible person or explicitly left open.
    unfilled: dict[str, cp_model.IntVar] = {}
    for duty in request.duties:
        unfilled[duty.id] = model.new_bool_var(f"unfilled_{duty.id}")
        model.add(
            sum(x[(person_id, duty.id)] for person_id in candidates[duty.id])
            + unfilled[duty.id]
            == 1
        )

    # HOD-selected people are hard constraints. If they are inactive, unqualified,
    # unavailable, or conflict with another hard constraint, the proposal is infeasible.
    for duty in request.duties:
        if duty.forced_faculty_id:
            selected = x.get((duty.forced_faculty_id, duty.id))
            if selected is None:
                model.add(unfilled[duty.id] == 0)
            else:
                model.add(selected == 1)

    # A faculty member cannot serve overlapping duties (including configured rest).
    for person in request.faculty:
        eligible_duties = sorted(
            (d for d in request.duties if (person.id, d.id) in x),
            key=lambda duty: (duty.starts_at, duty.ends_at, duty.id),
        )
        for index, first in enumerate(eligible_duties):
            for second_index in range(index + 1, len(eligible_duties)):
                second = eligible_duties[second_index]
                rest = timedelta(minutes=request.rest_minutes)
                if second.starts_at >= first.ends_at + rest:
                    break
                model.add(x[(person.id, first.id)] + x[(person.id, second.id)] <= 1)

    max_possible_load = max(
        1,
        sum(duty.minutes for duty in request.duties)
        + max((person.committed_minutes for person in request.faculty), default=0),
        max((person.target_minutes for person in request.faculty), default=0),
        max((person.max_minutes for person in request.faculty), default=0),
    )
    loads: dict[str, cp_model.IntVar] = {}
    for person in request.faculty:
        terms = [
            duty_by_id[duty_id].minutes * variable
            for (faculty_id, duty_id), variable in x.items()
            if faculty_id == person.id
        ]
        load = model.new_int_var(0, max_possible_load, f"load_{person.id}")
        model.add(load == person.committed_minutes + sum(terms))
        model.add(load <= person.max_minutes)
        loads[person.id] = load

    # One disruption variable per previously scheduled duty avoids counting a
    # replacement twice when the old and new faculty IDs both change.
    change_cost = model.new_int_var(0, max(1, sum(a.change_weight for a in request.baseline)), "change_cost")
    change_terms = []
    for assignment in request.baseline:
        key = (assignment.faculty_id, assignment.duty_id)
        changed = model.new_bool_var(f"changed_{assignment.duty_id}")
        if key in x:
            model.add(changed + x[key] == 1)
        else:
            model.add(changed == 1)
        change_terms.append(assignment.change_weight * changed)
    model.add(change_cost == sum(change_terms))

    unfilled_count = model.new_int_var(0, len(request.duties), "unfilled_count")
    model.add(unfilled_count == sum(unfilled.values()))
    unfilled_priority_cost = model.new_int_var(
        0,
        max(1, sum(max(0, duty.priority) for duty in request.duties)),
        "unfilled_priority_cost",
    )
    model.add(
        unfilled_priority_cost
        == sum(max(0, duty.priority) * unfilled[duty.id] for duty in request.duties)
    )

    protected_violations: dict[str, cp_model.IntVar] = {}
    # Published assignments are kept when feasible; this indicator lets repair
    # release the smallest protected set when a new disruption makes that necessary.
    for assignment in request.baseline:
        if not assignment.protected:
            continue
        violation = model.new_bool_var(f"protected_violation_{assignment.duty_id}")
        key = (assignment.faculty_id, assignment.duty_id)
        if key in x:
            model.add(x[key] + violation >= 1)
        else:
            model.add(violation == 1)
        protected_violations[assignment.duty_id] = violation
    protected_violation_count = model.new_int_var(
        0, len(protected_violations), "protected_violation_count"
    )
    model.add(protected_violation_count == sum(protected_violations.values()))
    active_faculty = [person for person in request.faculty if person.active]
    scale = 10_000
    normalized_deviations: dict[str, cp_model.IntVar] = {}
    max_normalized_load = model.new_int_var(0, scale, "maximum_capacity_utilization")
    for person in active_faculty:
        normalized = model.new_int_var(0, scale, f"capacity_utilization_{person.id}")
        model.add_division_equality(normalized, loads[person.id] * scale, person.max_minutes)
        model.add(max_normalized_load >= normalized)
        target_ratio = min(scale, (person.target_minutes * scale) // person.max_minutes)
        deviation = model.new_int_var(0, scale, f"normalized_deviation_{person.id}")
        model.add(deviation >= normalized - target_ratio)
        model.add(deviation >= target_ratio - normalized)
        normalized_deviations[person.id] = deviation
    normalized_deviation_cost = model.new_int_var(
        0, max(1, len(active_faculty) * scale), "normalized_deviation_cost"
    )
    model.add(normalized_deviation_cost == sum(normalized_deviations.values()))
    preference_bound = sum(
        max(
            (max(0, duty.preference_costs.get(person_id, 5)) for person_id in candidates[duty.id]),
            default=0,
        )
        for duty in request.duties
    )
    preference_cost = model.new_int_var(0, max(1, preference_bound), "preference_cost")
    model.add(
        preference_cost
        == sum(
            max(0, duty.preference_costs.get(person_id, 5)) * variable
            for (person_id, duty_id), variable in x.items()
            for duty in [duty_by_id[duty_id]]
        )
    )

    objective_sequence: list[tuple[str, cp_model.IntVar]] = [
        ("unfilled_role_count", unfilled_count),
        ("unfilled_priority_cost", unfilled_priority_cost),
    ]
    if protected_violations:
        objective_sequence.append(("protected_assignment_changes", protected_violation_count))
    if request.mode != "ALLOCATE":
        objective_sequence.append(("schedule_changes", change_cost))
    objective_sequence.extend(
        [
            ("maximum_capacity_utilization_basis_points", max_normalized_load),
            ("workload_deviation_basis_points", normalized_deviation_cost),
            ("preference_cost", preference_cost),
        ]
    )

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 8
    stage_results: list[dict] = []
    final_status = cp_model.UNKNOWN
    lexicographic_complete = True
    started_at = time.monotonic()
    has_solution = False
    best_assignment_values: dict[tuple[str, str], int] = {}
    best_load_values: dict[str, int] = {}
    for objective_name, expression in objective_sequence:
        remaining_seconds = request.time_limit_seconds - (time.monotonic() - started_at)
        if remaining_seconds <= 0.05:
            lexicographic_complete = False
            final_status = cp_model.FEASIBLE if has_solution else cp_model.UNKNOWN
            break
        solver.parameters.max_time_in_seconds = remaining_seconds
        model.minimize(expression)
        stage_status = solver.solve(model)
        final_status = stage_status
        stage_name = solver.status_name(stage_status)
        if stage_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            stage_results.append({"objective": objective_name, "status": stage_name})
            if has_solution:
                final_status = cp_model.FEASIBLE
                lexicographic_complete = False
            break
        has_solution = True
        value = int(round(solver.value(expression)))
        stage_results.append(
            {"objective": objective_name, "value": value, "status": stage_name}
        )
        best_assignment_values = {
            key: int(solver.value(variable)) for key, variable in x.items()
        }
        best_load_values = {
            faculty_id: int(solver.value(variable))
            for faculty_id, variable in loads.items()
        }
        if stage_status != cp_model.OPTIMAL:
            lexicographic_complete = False
            break
        model.add(expression == value)

    status_name = solver.status_name(final_status)
    has_solution = has_solution and final_status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assignments: list[dict] = []
    if has_solution:
        for (faculty_id, duty_id), assigned in best_assignment_values.items():
            if assigned:
                assignments.append({"faculty_id": faculty_id, "duty_id": duty_id})

    assigned_duty_ids = {item["duty_id"] for item in assignments}
    uncovered = []
    if has_solution:
        for duty in request.duties:
            if duty.id in assigned_duty_ids:
                continue
            compatible = len(candidates[duty.id])
            if compatible == 0:
                reasons = []
                if duty.required_skill:
                    reasons.append(f"No active faculty with the {duty.required_skill} skill is available.")
                if ineligible[duty.id]["unavailable"]:
                    reasons.append("Otherwise-qualified faculty are unavailable during this time.")
                if not reasons:
                    reasons.append("No qualified, available faculty member can cover this role.")
                explanation = " ".join(reasons)
            else:
                explanation = "Eligible faculty are already committed to overlapping duties or have reached their workload limit."
            uncovered.append(
                {
                    "duty_id": duty.id,
                    "role": duty.role,
                    "event_name": duty.event_name,
                    "reason": explanation,
                }
            )

    faculty_loads = []
    if has_solution:
        for person in request.faculty:
            faculty_loads.append(
                {
                    "faculty_id": person.id,
                    "name": person.name,
                    "minutes": best_load_values[person.id],
                    "target_minutes": person.target_minutes,
                    "maximum_minutes": person.max_minutes,
                }
            )

    return {
        "status": status_name,
        "mode": request.mode,
        "lexicographic_complete": lexicographic_complete,
        "objective_levels": stage_results,
        "assignments": assignments,
        "uncovered": uncovered,
        "workloads": faculty_loads,
        "solver_stats": {
            "wall_time_seconds": round(solver.wall_time, 4),
            "total_wall_time_seconds": round(time.monotonic() - started_at, 4),
            "branches": solver.num_branches,
            "conflicts": solver.num_conflicts,
            "candidate_variables": len(x),
        },
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "solver": "OR-Tools CP-SAT"}


@app.post("/optimize")
def optimize(request: OptimizeRequest) -> dict:
    return solve_allocation(request)
