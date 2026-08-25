"""Temporary inert fixture used to keep Warden analysis busy during cancellation testing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Request:
    actor_id: int
    organization_id: int
    payload: dict[str, Any]


@dataclass(frozen=True)
class Project:
    id: int
    organization_id: int
    name: str
    enabled: bool = True


class ProjectStore:
    def __init__(self, projects: list[Project]) -> None:
        self._projects = {project.id: project for project in projects}

    def get_for_organization(self, project_id: int, organization_id: int) -> Project | None:
        project = self._projects.get(project_id)
        if project is None or project.organization_id != organization_id:
            return None
        return project

    def list_for_organization(self, organization_id: int) -> list[Project]:
        return [
            project
            for project in self._projects.values()
            if project.organization_id == organization_id
        ]


def normalize_name(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("name must be a string")
    normalized = " ".join(value.split()).strip()
    if not normalized or len(normalized) > 80:
        raise ValueError("name must contain between 1 and 80 characters")
    return normalized


def parse_project_id(value: object) -> int:
    if isinstance(value, bool):
        raise ValueError("project id must be an integer")
    try:
        project_id = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("project id must be an integer") from error
    if project_id <= 0:
        raise ValueError("project id must be positive")
    return project_id


def serialize_project(project: Project) -> dict[str, object]:
    return {
        "id": project.id,
        "name": project.name,
        "enabled": project.enabled,
    }


def get_project(request: Request, store: ProjectStore) -> dict[str, object]:
    project_id = parse_project_id(request.payload.get("project_id"))
    project = store.get_for_organization(project_id, request.organization_id)
    if project is None:
        return {"status": 404, "error": "project not found"}
    return {"status": 200, "project": serialize_project(project)}


def list_projects(request: Request, store: ProjectStore) -> dict[str, object]:
    projects = store.list_for_organization(request.organization_id)
    return {
        "status": 200,
        "projects": [serialize_project(project) for project in projects],
    }


def update_project_name(request: Request, store: ProjectStore) -> dict[str, object]:
    project_id = parse_project_id(request.payload.get("project_id"))
    project = store.get_for_organization(project_id, request.organization_id)
    if project is None:
        return {"status": 404, "error": "project not found"}
    name = normalize_name(request.payload.get("name"))
    updated = Project(
        id=project.id,
        organization_id=project.organization_id,
        name=name,
        enabled=project.enabled,
    )
    return {"status": 200, "project": serialize_project(updated)}


def set_project_enabled(request: Request, store: ProjectStore) -> dict[str, object]:
    project_id = parse_project_id(request.payload.get("project_id"))
    project = store.get_for_organization(project_id, request.organization_id)
    if project is None:
        return {"status": 404, "error": "project not found"}
    enabled = request.payload.get("enabled")
    if not isinstance(enabled, bool):
        raise ValueError("enabled must be a boolean")
    updated = Project(
        id=project.id,
        organization_id=project.organization_id,
        name=project.name,
        enabled=enabled,
    )
    return {"status": 200, "project": serialize_project(updated)}


def summarize_projects(request: Request, store: ProjectStore) -> dict[str, object]:
    projects = store.list_for_organization(request.organization_id)
    enabled_count = sum(project.enabled for project in projects)
    return {
        "status": 200,
        "total": len(projects),
        "enabled": enabled_count,
        "disabled": len(projects) - enabled_count,
    }


def search_projects(request: Request, store: ProjectStore) -> dict[str, object]:
    query = request.payload.get("query")
    if not isinstance(query, str):
        raise ValueError("query must be a string")
    normalized_query = query.casefold().strip()
    if len(normalized_query) > 80:
        raise ValueError("query is too long")
    projects = store.list_for_organization(request.organization_id)
    matches = [
        serialize_project(project)
        for project in projects
        if normalized_query in project.name.casefold()
    ]
    return {"status": 200, "projects": matches}


def bulk_get_projects(request: Request, store: ProjectStore) -> dict[str, object]:
    raw_ids = request.payload.get("project_ids")
    if not isinstance(raw_ids, list) or len(raw_ids) > 20:
        raise ValueError("project_ids must be a list with at most 20 items")
    projects: list[dict[str, object]] = []
    for raw_id in raw_ids:
        project = store.get_for_organization(
            parse_project_id(raw_id), request.organization_id
        )
        if project is not None:
            projects.append(serialize_project(project))
    return {"status": 200, "projects": projects}


def project_status(request: Request, store: ProjectStore) -> dict[str, object]:
    project_id = parse_project_id(request.payload.get("project_id"))
    project = store.get_for_organization(project_id, request.organization_id)
    if project is None:
        return {"status": 404, "error": "project not found"}
    return {
        "status": 200,
        "project_id": project.id,
        "state": "enabled" if project.enabled else "disabled",
    }


def validate_request(request: Request) -> None:
    if request.actor_id <= 0:
        raise ValueError("actor_id must be positive")
    if request.organization_id <= 0:
        raise ValueError("organization_id must be positive")
    if not isinstance(request.payload, dict):
        raise ValueError("payload must be an object")


def dispatch(operation: str, request: Request, store: ProjectStore) -> dict[str, object]:
    validate_request(request)
    handlers = {
        "get": get_project,
        "list": list_projects,
        "rename": update_project_name,
        "enable": set_project_enabled,
        "summary": summarize_projects,
        "search": search_projects,
        "bulk_get": bulk_get_projects,
        "status": project_status,
    }
    handler = handlers.get(operation)
    if handler is None:
        return {"status": 400, "error": "unknown operation"}
    return handler(request, store)
