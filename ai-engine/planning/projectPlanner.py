"""
Project planning module.

Turns a guide-authored project title + description into a structured plan:
modules, development phases, tasks with dependencies, milestones and a
logical (not random) first-pass task assignment across the invited students.

IMPORTANT — per the current project requirements, this is deliberately
rule-based/deterministic (keyword + heuristic driven), NOT machine learning.
There is no trained model and no dataset here, and this module does not
pretend otherwise. It is structured so a real ML/LLM step could later
replace `_detect_domain` / `_build_modules` without touching the Flask route,
the output schema, or anything downstream (the Node backend, the frontend,
or the other analyzers) — see the "swap point" note above each function.
"""
from __future__ import annotations

import re
from typing import Any

from utils.helpers import dedupe, now, parse_date

MIN_DESCRIPTION_WORDS = 8

# ---------------------------------------------------------------------------
# Domain / keyword detection
#
# SWAP POINT: `_detect_domain` is the natural place to later plug in a real
# NLP/LLM call (e.g. "classify this project description into a domain and
# extract its key capabilities") instead of keyword matching. Its output
# contract (a domain label + a set of triggered module keys) is what the
# rest of this file consumes, so nothing else would need to change.
# ---------------------------------------------------------------------------

# Each entry: keywords -> (module_key, module_name, module_description, tech, priority)
DOMAIN_MODULES = [
    (
        {"ocr", "scan", "extract text", "document processing", "digitiz"},
        "ocr",
        "Document Processing / OCR",
        "Extract text and structured data from uploaded documents/images.",
        ["Tesseract / cloud OCR API", "PDF/image preprocessing"],
        "high",
    ),
    (
        {"nlp", "natural language", "summar", "text analysis", "sentiment", "language model"},
        "nlp",
        "NLP & Text Analysis",
        "Process extracted or user-entered text to summarize, classify or analyse it.",
        ["Python NLP libraries (spaCy / NLTK / transformers)"],
        "high",
    ),
    (
        {"predict", "anomaly", "detect", "classification", "machine learning", "ai model", "recommend"},
        "ml",
        "AI / Prediction Model",
        "Train or apply a model that predicts, classifies or flags anomalies from project data.",
        ["Python (scikit-learn / TensorFlow / PyTorch depending on scope)"],
        "high",
    ),
    (
        {"chat", "real-time", "realtime", "collaboration", "messaging", "notification"},
        "realtime",
        "Real-time Communication",
        "Live chat/notifications between users using sockets or a pub-sub layer.",
        ["Socket.IO / WebSockets"],
        "medium",
    ),
    (
        {"upload", "file sharing", "manage records", "storage", "attachment", "document management"},
        "files",
        "File Management",
        "Upload, store, list and retrieve project files/records securely.",
        ["Object storage / server file system", "Multer or equivalent"],
        "medium",
    ),
    (
        {"secure", "security", "encrypt", "privacy", "compliance", "access control", "permission"},
        "security",
        "Security & Access Control",
        "Role-based access, encryption and audit logging for sensitive data.",
        ["JWT / OAuth", "Field-level encryption where data is sensitive"],
        "high",
    ),
    (
        {"mobile app", "android", "ios", " app "},
        "mobile",
        "Mobile Application",
        "Native or cross-platform mobile client for end users.",
        ["React Native / Flutter"],
        "medium",
    ),
    (
        {"iot", "sensor", "embedded", "device", "arduino", "raspberry"},
        "iot",
        "IoT / Device Integration",
        "Collect and relay data from connected devices/sensors.",
        ["MQTT", "Microcontroller firmware"],
        "medium",
    ),
    (
        {"blockchain", "smart contract", "ledger", "crypto"},
        "blockchain",
        "Blockchain / Ledger",
        "Immutable record-keeping or smart-contract logic.",
        ["Solidity / a permissioned ledger framework"],
        "medium",
    ),
    (
        {"payment", "checkout", "transaction", "billing"},
        "payments",
        "Payments",
        "Handle transactions and billing securely.",
        ["A PCI-compliant payment gateway"],
        "medium",
    ),
    (
        {"dashboard", "analytics", "report", "visualiz", "insight", "chart"},
        "analytics",
        "Analytics & Reporting Dashboard",
        "Aggregate and visualize project/domain data for end users.",
        ["Charting library (Recharts/Chart.js)"],
        "medium",
    ),
]

BASE_MODULES = [
    (
        "frontend",
        "Frontend / UI",
        "User-facing screens, navigation and state management.",
        ["React (matches the existing TeamSync AI frontend stack)"],
        "high",
    ),
    (
        "backend",
        "Backend / API",
        "REST APIs, business logic and integration with the database and other modules.",
        ["Node.js / Express (matches the existing TeamSync AI backend stack)"],
        "high",
    ),
    (
        "database",
        "Database Design",
        "Schema/data modelling and persistence for all core entities.",
        ["MongoDB (matches the existing TeamSync AI stack)"],
        "high",
    ),
    (
        "auth",
        "Authentication & Users",
        "Sign-up/login and per-role permissions for the people using the system.",
        ["JWT-based auth"],
        "high",
    ),
]

TESTING_MODULE = (
    "testing",
    "Testing & QA",
    "Verify each module works correctly and catch regressions before submission.",
    ["Manual test plan", "Unit tests where practical"],
    "medium",
)

DEPLOY_MODULE = (
    "deployment",
    "Deployment & Documentation",
    "Ship the working system and document setup/usage for evaluation.",
    ["README", "Basic deployment (local or a free-tier host)"],
    "medium",
)


def _detect_domain(text: str) -> tuple[str, list[dict]]:
    """Returns (domain_label, triggered_domain_modules)."""
    low = f" {text.lower()} "
    triggered = []
    for keywords, key, name, desc, tech, priority in DOMAIN_MODULES:
        if any(kw in low for kw in keywords):
            triggered.append(
                {"key": key, "name": name, "description": desc, "technologies": tech, "priority": priority}
            )

    if not triggered:
        domain = "General Software Project"
    else:
        domain = ", ".join(dedupe([m["name"] for m in triggered][:3]))
    return domain, triggered


# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------


def _build_modules(domain_modules: list[dict]) -> list[dict]:
    modules = []
    for key, name, desc, tech, priority in BASE_MODULES:
        modules.append({"key": key, "name": name, "description": desc, "technologies": tech, "priority": priority})
    modules.extend(domain_modules)
    key, name, desc, tech, priority = TESTING_MODULE
    modules.append({"key": key, "name": name, "description": desc, "technologies": tech, "priority": priority})
    key, name, desc, tech, priority = DEPLOY_MODULE
    modules.append({"key": key, "name": name, "description": desc, "technologies": tech, "priority": priority})
    return modules


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------


def _split_days(total_days: int | None, weights: list[float]) -> list[int]:
    """Distributes total_days across phases by relative weight, or falls
    back to the weights themselves (as day counts) if no deadline is set."""
    if not total_days or total_days <= 0:
        return [max(1, round(w)) for w in weights]
    weight_sum = sum(weights) or 1
    days = [max(1, round(total_days * (w / weight_sum))) for w in weights]
    # nudge the rounding so the phases still add up to roughly total_days
    diff = total_days - sum(days)
    if days:
        days[-1] = max(1, days[-1] + diff)
    return days


def _build_phases(modules: list[dict], total_days: int | None) -> list[dict]:
    # Fixed relative weight per phase type — a small college/team project's
    # SDLC shape: planning is short, core build is the bulk of the time,
    # testing/deployment wraps up at the end.
    core_modules = [m for m in modules if m["key"] not in {"testing", "deployment"}]
    layout = [
        ("Requirement Analysis & Planning", "Finalize scope, confirm the modules below and set up the repo/boards.", 1.0),
        ("Design", "Design the database schema, API contracts and UI screens.", 1.5),
        ("Core Module Development", "Build " + ", ".join(m["name"] for m in core_modules) + ".", 4.0),
        ("Integration", "Connect frontend, backend and any domain-specific modules end-to-end.", 1.5),
        ("Testing & QA", "Test each module and fix defects found.", 1.0),
        ("Deployment & Documentation", "Deploy the working system and finalize documentation.", 1.0),
    ]
    weights = [w for *_ignore, w in layout]
    days = _split_days(total_days, weights)

    phases = []
    for index, ((name, desc, _weight), day_count) in enumerate(zip(layout, days), start=1):
        phases.append({"phase": index, "name": name, "description": desc, "estimatedDays": day_count})
    return phases


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

# Per-module-key representative task templates:
# (title, description, days, depends_on_keys, what_to_do, expected_output, deliverable_type, criteria)
TASK_TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "database": [
        {
            "title": "Design database schema",
            "description": "Model the core entities, relationship schemas, and constraints needed by the project.",
            "days": 2,
            "deps": [],
            "what_to_do": "1. Analyze domain entities and relationships. 2. Define schema models with validation and indexing. 3. Verify relations and seed mock test records.",
            "expected_output": "Mongoose schema models, entity relationship documentation, and seed scripts.",
            "deliverable_type": "database",
            "criteria": ["Schemas include field validations", "Indexes created on primary search fields", "Sample records persist without error"],
        },
    ],
    "auth": [
        {
            "title": "Implement authentication",
            "description": "Sign-up/login, JWT token management, and role-based access control for team members and guides.",
            "days": 2,
            "deps": ["database"],
            "what_to_do": "1. Set up password hashing and JWT token issuance. 2. Implement login and registration endpoints. 3. Add auth middleware to protect API routes.",
            "expected_output": "Authentication API endpoints, auth middleware, and token refresh utilities.",
            "deliverable_type": "backend",
            "criteria": ["Passwords securely hashed using bcrypt", "Protected routes reject unauthorized requests", "Role-based authorization enforced"],
        },
    ],
    "backend": [
        {
            "title": "Build core backend APIs",
            "description": "REST endpoints for the main entities identified in the project description.",
            "days": 3,
            "deps": ["database"],
            "what_to_do": "1. Create Express controllers and route handlers for primary entities. 2. Implement request validation and error handling. 3. Document API specifications.",
            "expected_output": "REST API controllers, Express routes, and input validation middleware.",
            "deliverable_type": "backend",
            "criteria": ["All CRUD endpoints functional", "Input errors return standardized JSON responses", "Routes adhere to REST conventions"],
        },
        {
            "title": "Integrate domain-specific backend logic",
            "description": "Wire the domain modules into the backend APIs and connect business logic workflows.",
            "days": 2,
            "deps": ["backend"],
            "what_to_do": "1. Connect domain services to API controllers. 2. Implement background processing or state transitions. 3. Write integration test cases.",
            "expected_output": "Domain service integrations and business logic workflow handlers.",
            "deliverable_type": "backend",
            "criteria": ["Domain workflows execute end-to-end", "Service errors handled gracefully", "API responses reflect domain state"],
        },
    ],
    "frontend": [
        {
            "title": "Build core UI screens",
            "description": "Screens for the main user flows described in the project with responsive design and clear state handling.",
            "days": 3,
            "deps": ["auth"],
            "what_to_do": "1. Construct layout, navigation, and core feature views in React. 2. Implement responsive styling and accessibility states. 3. Build UI feedback for loading and error states.",
            "expected_output": "React components, responsive page views, and interactive UI widgets.",
            "deliverable_type": "frontend",
            "criteria": ["Views render cleanly on desktop and mobile", "Navigation works smoothly", "Loading and empty states properly handled"],
        },
        {
            "title": "Connect frontend to backend APIs",
            "description": "Wire the UI up to real API responses, handle asynchronous queries, and manage local application state.",
            "days": 2,
            "deps": ["frontend", "backend"],
            "what_to_do": "1. Configure API client methods. 2. Connect React components to live backend responses. 3. Implement optimistic updates and error notifications.",
            "expected_output": "API service integration hooks, state management wiring, and notification feedback.",
            "deliverable_type": "frontend",
            "criteria": ["UI renders live data from database", "Network errors display user-friendly toasts", "Form submissions persist to backend"],
        },
    ],
    "ocr": [
        {
            "title": "Build document upload + OCR pipeline",
            "description": "Accept uploaded documents/images and extract structured text/data via OCR processing.",
            "days": 3,
            "deps": ["backend"],
            "what_to_do": "1. Configure document upload endpoint. 2. Connect OCR parser/library. 3. Structure and store extracted document text.",
            "expected_output": "Document upload handler, OCR parser integration, and parsed document records.",
            "deliverable_type": "backend",
            "criteria": ["Uploaded images/PDFs parsed accurately", "Extracted text indexed for search", "Invalid file formats rejected"],
        },
    ],
    "nlp": [
        {
            "title": "Build NLP analysis step",
            "description": "Process and analyze text data to generate summaries, classifications, and domain insights.",
            "days": 3,
            "deps": ["ocr", "backend"],
            "what_to_do": "1. Implement text pre-processing and tokenization. 2. Apply NLP summarization or classification logic. 3. Expose analysis results via API.",
            "expected_output": "NLP analysis service, text extraction pipelines, and classification outputs.",
            "deliverable_type": "backend",
            "criteria": ["Summaries generated reliably", "Classification confidence scores calculated", "Results stored and retrievable via API"],
        },
    ],
    "ml": [
        {
            "title": "Build prediction/anomaly-detection module",
            "description": "Apply or train an AI/ML model over the project's core data to provide automated predictions or anomaly detection.",
            "days": 4,
            "deps": ["backend"],
            "what_to_do": "1. Prepare and preprocess domain dataset. 2. Implement model training or inference pipeline. 3. Expose prediction endpoints to backend.",
            "expected_output": "Trained ML model or rule-based inference pipeline with prediction API endpoints.",
            "deliverable_type": "code",
            "criteria": ["Model generates predictions within latency targets", "Features normalized and validated", "Fallback provided for edge cases"],
        },
    ],
    "realtime": [
        {
            "title": "Build real-time updates",
            "description": "Live messaging, notifications, and socket updates for collaborative project workflows.",
            "days": 2,
            "deps": ["backend"],
            "what_to_do": "1. Set up Socket.IO event listeners and emitters. 2. Implement room-based group isolation. 3. Connect frontend socket listeners to UI feeds.",
            "expected_output": "WebSocket event handlers, real-time message relays, and UI live listeners.",
            "deliverable_type": "backend",
            "criteria": ["Messages deliver in real-time without polling", "Socket connections reconnect on drop", "Group isolation strictly enforced"],
        },
    ],
    "files": [
        {
            "title": "Build file management module",
            "description": "Upload, list, download, and secure project files and media attachments with role validation.",
            "days": 2,
            "deps": ["backend"],
            "what_to_do": "1. Implement secure file storage handler. 2. Add validation for file MIME types and size limits. 3. Build UI file browser with download links.",
            "expected_output": "File upload endpoints, storage adapters, and UI file management components.",
            "deliverable_type": "backend",
            "criteria": ["Files uploaded with validated MIME types", "Access permissions strictly verified", "Downloads stream securely"],
        },
    ],
    "security": [
        {
            "title": "Harden access control & data protection",
            "description": "Enforce strict role checks, input sanitization, sensitive data protection, and audit logging.",
            "days": 2,
            "deps": ["auth"],
            "what_to_do": "1. Implement input sanitization and rate limiting. 2. Add audit logging for sensitive operations. 3. Review role-based permission boundaries.",
            "expected_output": "Security middleware, audit log records, and access validation suite.",
            "deliverable_type": "backend",
            "criteria": ["Unauthorized role escalations blocked", "Audit trails capture critical actions", "Input sanitization prevents injection"],
        },
    ],
    "mobile": [
        {
            "title": "Build mobile client",
            "description": "Cross-platform mobile screens and components mirroring core web application workflows.",
            "days": 4,
            "deps": ["backend"],
            "what_to_do": "1. Initialize React Native / mobile client architecture. 2. Implement auth and main navigation views. 3. Connect to backend REST endpoints.",
            "expected_output": "Mobile application screens, native navigation controllers, and API client adapters.",
            "deliverable_type": "frontend",
            "criteria": ["Mobile app authenticates and loads user data", "Touch interactions and responsive layouts verified", "Offline handling implemented"],
        },
    ],
    "iot": [
        {
            "title": "Build device/sensor integration",
            "description": "Ingest, parse, and relay telemetry data from connected hardware devices and sensors.",
            "days": 3,
            "deps": ["backend"],
            "what_to_do": "1. Configure MQTT / HTTP ingestion bridge. 2. Parse sensor telemetry packets and validate checksums. 3. Store time-series metrics.",
            "expected_output": "Device telemetry ingestion bridge, packet parser, and sensor data models.",
            "deliverable_type": "code",
            "criteria": ["Sensor payloads ingested reliably", "Malformed telemetry packets flagged", "Live sensor readings viewable in UI"],
        },
    ],
    "blockchain": [
        {
            "title": "Build ledger/smart-contract logic",
            "description": "Implement immutable transaction logging, smart contracts, and cryptographic verification.",
            "days": 4,
            "deps": ["backend"],
            "what_to_do": "1. Write smart contract logic or ledger schema. 2. Deploy to local/test network. 3. Expose transaction verification API.",
            "expected_output": "Smart contracts / ledger integration, deployment artifacts, and verification endpoints.",
            "deliverable_type": "backend",
            "criteria": ["Transactions cryptographically signed and logged", "Smart contract unit tests pass", "State changes immutable"],
        },
    ],
    "payments": [
        {
            "title": "Integrate payment/billing flow",
            "description": "Secure transaction processing, checkout sessions, and webhook reconciliation via payment gateway.",
            "days": 2,
            "deps": ["backend"],
            "what_to_do": "1. Set up payment gateway client (e.g. Stripe). 2. Implement checkout session creation. 3. Handle webhook signatures and receipts.",
            "expected_output": "Payment gateway service, checkout API routes, and webhook handler.",
            "deliverable_type": "backend",
            "criteria": ["Checkout sessions created securely", "Webhook signatures verified cryptographically", "Transactions logged in database"],
        },
    ],
    "analytics": [
        {
            "title": "Build analytics dashboard",
            "description": "Aggregate and visualize project metrics, performance charts, and key progress indicators for users.",
            "days": 2,
            "deps": ["backend", "frontend"],
            "what_to_do": "1. Implement aggregation queries for project metrics. 2. Build interactive charting widgets in React. 3. Add date-range filters.",
            "expected_output": "Analytics aggregation endpoints, chart components, and dashboard view.",
            "deliverable_type": "frontend",
            "criteria": ["Metrics aggregate accurately from real data", "Charts render smoothly with responsive layouts", "Filters update metrics in real-time"],
        },
    ],
    "testing": [
        {
            "title": "Test each module end-to-end",
            "description": "Verify every module works correctly, run integration tests, and resolve functional regressions.",
            "days": 2,
            "deps": ["frontend", "backend"],
            "what_to_do": "1. Create integration test suites for core user journeys. 2. Execute regression and API endpoint checks. 3. Document test results.",
            "expected_output": "Automated test scripts, QA test report, and bug fix patches.",
            "deliverable_type": "documentation",
            "criteria": ["All automated tests pass", "Core user workflows function end-to-end", "No critical bugs remain open"],
        },
    ],
    "deployment": [
        {
            "title": "Deploy and finalize documentation",
            "description": "Deploy the working build to production environment, verify uptime, and complete technical documentation.",
            "days": 1,
            "deps": ["testing"],
            "what_to_do": "1. Configure build scripts and environment variables. 2. Deploy application services. 3. Write comprehensive setup guide.",
            "expected_output": "Deployed application build, environment configs, and system documentation.",
            "deliverable_type": "documentation",
            "criteria": ["Production deployment runs without crashes", "Health check endpoints return status 200", "Documentation explains setup clearly"],
        },
    ],
}


def _build_tasks(modules: list[dict], project_title: str = "", project_description: str = "") -> list[dict]:
    present_keys = {m["key"] for m in modules}
    by_key_name = {m["key"]: m["name"] for m in modules}
    priority_by_key = {m["key"]: m["priority"] for m in modules}

    tasks = []
    seen_titles = set()
    cleaned_project = project_title.strip() if project_title else ""

    for module in modules:
        key = module["key"]
        for tmpl in TASK_TEMPLATES.get(key, []):
            title = tmpl["title"]
            if title in seen_titles:
                continue
            seen_titles.add(title)

            deps = tmpl.get("deps", [])
            dep_titles = []
            for dep_key in deps:
                for dep_tmpl in TASK_TEMPLATES.get(dep_key, []):
                    dep_title = dep_tmpl["title"]
                    if dep_key in present_keys and dep_title != title:
                        dep_titles.append(dep_title)
                        break

            # Contextualize description with project title if available
            base_desc = tmpl["description"]
            if cleaned_project and cleaned_project.lower() not in base_desc.lower():
                desc = f"{base_desc} Customized for {cleaned_project}."
            else:
                desc = base_desc

            what_to_do = tmpl.get("what_to_do", "")
            if cleaned_project and cleaned_project.lower() not in what_to_do.lower():
                what_to_do = f"{what_to_do} Ensure alignment with {cleaned_project} requirements."

            tasks.append(
                {
                    "title": title,
                    "description": desc,
                    "whatToDo": what_to_do,
                    "expectedOutput": tmpl.get("expected_output", f"Deliverable for {title}"),
                    "deliverableType": tmpl.get("deliverable_type", "Task Deliverable"),
                    "completionCriteria": tmpl.get("criteria", ["Task completed as specified"]),
                    "module": by_key_name.get(key, module["name"]),
                    "moduleKey": key,
                    "priority": priority_by_key.get(key, "medium"),
                    "estimatedDays": tmpl.get("days", 2),
                    "dependencies": dedupe(dep_titles),
                }
            )
    return tasks


# ---------------------------------------------------------------------------
# Deadlines — topological finish offset scaled across project timeline
# ---------------------------------------------------------------------------


def _calculate_task_deadlines(tasks: list[dict], deadline, total_days: int | None) -> None:
    if not tasks:
        return

    finish_cache: dict[str, int] = {}
    by_title = {t["title"].lower(): t for t in tasks}

    def get_finish(title: str, guard: set | None = None) -> int:
        if guard is None:
            guard = set()
        key = title.lower()
        if key in finish_cache:
            return finish_cache[key]
        task = by_title.get(key)
        if not task or key in guard:
            return 0
        guard.add(key)
        max_dep = 0
        for dep in task.get("dependencies", []):
            max_dep = max(max_dep, get_finish(dep, guard))
        finish = max_dep + max(1, task.get("estimatedDays", 1))
        finish_cache[key] = finish
        return finish

    max_finish = 1
    for t in tasks:
        f = get_finish(t["title"])
        max_finish = max(max_finish, f)

    start = now()
    if deadline and deadline > start:
        span_days = max(1.0, (deadline - start).total_seconds() / 86400.0)
    else:
        span_days = float(max(21, (total_days if total_days and total_days > 0 else max_finish * 2)))

    for t in tasks:
        finish = get_finish(t["title"])
        offset_days = (finish / max_finish) * span_days
        due_days = max(1, round(offset_days))
        due_dt = start + __import__("datetime").timedelta(days=due_days)
        iso_date = due_dt.date().isoformat()
        t["dueDate"] = iso_date
        t["due"] = iso_date


# ---------------------------------------------------------------------------
# Assignment — logical, not random.
#
# Groups tasks by module, then hands each *module* to one student (so a
# student's work stays coherent, e.g. "Bhavani -> Frontend") using a simple
# priority order (core modules first) and round-robins modules across
# students when there are more modules than students, or splits a module's
# tasks across students when there are more students than modules.
# Every task is assigned to a real member and includes student info directly.
# ---------------------------------------------------------------------------

MODULE_ASSIGN_ORDER = [
    "frontend", "backend", "database", "ml", "nlp", "ocr", "mobile", "auth",
    "realtime", "files", "security", "iot", "blockchain", "payments",
    "analytics", "testing", "deployment",
]


def _assign_tasks(tasks: list[dict], members: list[dict]) -> list[dict]:
    if not members or not tasks:
        return []

    # Group tasks by module, in a stable, sensible priority order.
    by_module: dict[str, list[dict]] = {}
    for t in tasks:
        by_module.setdefault(t["moduleKey"], []).append(t)
    ordered_modules = sorted(
        by_module.keys(), key=lambda k: MODULE_ASSIGN_ORDER.index(k) if k in MODULE_ASSIGN_ORDER else 99
    )

    assignments = []
    member_count = len(members)

    if len(ordered_modules) >= member_count:
        # More (or equal) modules than students — round-robin whole modules
        # per student so each person's work stays coherent.
        for index, module_key in enumerate(ordered_modules):
            member = members[index % member_count]
            module_name = by_module[module_key][0]["module"]
            member_id = member.get("id") or member.get("_id") or member.get("userId")
            member_name = member.get("name") or member.get("email")
            member_email = member.get("email")

            for task in by_module[module_key]:
                reason = (
                    f"{member_name} is assigned the {module_name} module "
                    f"(module {index + 1} of {len(ordered_modules)}, distributed round-robin across "
                    f"{member_count} student(s))."
                )
                task["assigneeId"] = member_id
                task["assignedTo"] = {
                    "id": member_id,
                    "name": member_name,
                    "email": member_email,
                }
                task["assignmentReason"] = reason

                assignments.append(
                    {
                        "studentId": member_id,
                        "studentName": member_name,
                        "studentEmail": member_email,
                        "taskTitle": task["title"],
                        "reason": reason,
                        "estimatedDays": task["estimatedDays"],
                        "dueDate": task.get("dueDate"),
                    }
                )
    else:
        # More students than modules — distribute every student across the
        # modules (round robin, so nobody is left with zero work) and split
        # each module's tasks among the students allotted to it.
        module_count = len(ordered_modules)
        module_groups: list[list[dict]] = [[] for _ in ordered_modules]
        for i, member in enumerate(members):
            module_groups[i % module_count].append(member)

        for module_key, module_members in zip(ordered_modules, module_groups):
            if not module_members:
                continue
            module_name = by_module[module_key][0]["module"]
            module_tasks = by_module[module_key]
            for i, task in enumerate(module_tasks):
                member = module_members[i % len(module_members)]
                member_id = member.get("id") or member.get("_id") or member.get("userId")
                member_name = member.get("name") or member.get("email")
                member_email = member.get("email")

                reason = (
                    f"{member_name} is one of {len(module_members)} "
                    f"student(s) covering the {module_name} module."
                )
                task["assigneeId"] = member_id
                task["assignedTo"] = {
                    "id": member_id,
                    "name": member_name,
                    "email": member_email,
                }
                task["assignmentReason"] = reason

                assignments.append(
                    {
                        "studentId": member_id,
                        "studentName": member_name,
                        "studentEmail": member_email,
                        "taskTitle": task["title"],
                        "reason": reason,
                        "estimatedDays": task["estimatedDays"],
                        "dueDate": task.get("dueDate"),
                    }
                )

    return assignments


# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------


def _build_milestones(phases: list[dict], deadline) -> list[dict]:
    milestones = []
    running_days = 0
    for phase in phases:
        running_days += phase["estimatedDays"]
        milestones.append(
            {
                "title": f"{phase['name']} complete",
                "description": phase["description"],
                "targetDate": None,  # filled in below once we know total span
                "_cumulativeDays": running_days,
            }
        )

    total_days = running_days or 1
    if deadline:
        start = now()
        span = (deadline - start).total_seconds() / 86400 if deadline > start else total_days
        span = span or total_days
        for m in milestones:
            offset_days = (m["_cumulativeDays"] / total_days) * span
            target = start + __import__("datetime").timedelta(days=offset_days)
            m["targetDate"] = target.date().isoformat()
            del m["_cumulativeDays"]
    else:
        for m in milestones:
            del m["_cumulativeDays"]

    return milestones


# ---------------------------------------------------------------------------
# Technology suggestions
# ---------------------------------------------------------------------------


def _technology_suggestions(modules: list[dict]) -> list[str]:
    tech = []
    for m in modules:
        tech.extend(m.get("technologies", []))
    return dedupe(tech)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def generate_project_plan(payload: dict) -> dict:
    title = str(payload.get("projectTitle") or "").strip()
    description = str(payload.get("projectDescription") or "").strip()
    deadline = parse_date(payload.get("deadline"))
    members = [
        m for m in (payload.get("members") or [])
        if isinstance(m, dict) and (m.get("name") or m.get("email") or m.get("id") or m.get("_id"))
    ]

    if not title and not description:
        return {
            "insufficient_data": True,
            "insufficientDataReasons": [
                "Both projectTitle and projectDescription are missing — the AI engine has nothing to plan from."
            ],
            "projectUnderstanding": None,
            "technologySuggestions": [],
            "projectStructure": [],
            "modules": [],
            "tasks": [],
            "suggestedAssignments": [],
            "milestones": [],
            "engine": "rule-based-planner-v1",
            "generatedAt": now().isoformat(),
        }

    word_count = len(re.findall(r"\w+", description))
    description_thin = word_count < MIN_DESCRIPTION_WORDS

    domain, domain_modules = _detect_domain(f"{title} {description}")
    modules = _build_modules(domain_modules)
    total_days = int((deadline - now()).total_seconds() // 86400) if deadline else None
    if total_days is not None and total_days < 1:
        total_days = None  # deadline already passed / today — fall back to default weighting
    phases = _build_phases(modules, total_days)
    tasks = _build_tasks(modules, title, description)
    _calculate_task_deadlines(tasks, deadline, total_days)
    milestones = _build_milestones(phases, deadline)
    technology_suggestions = _technology_suggestions(modules)

    reasons = []
    if description_thin:
        reasons.append(
            f"Project description is only {word_count} word(s) — too short to reliably infer scope beyond the "
            "generic modules below. Add detail about specific features, data sources and user workflows for a "
            "more accurate module/task breakdown."
        )
    if not members:
        reasons.append("No team members were provided, so tasks cannot be assigned to anyone yet.")

    assignments = _assign_tasks(tasks, members) if members else []
    insufficient = bool(reasons)

    main_goal = description.split(".")[0].strip() if description else title
    return {
        "projectUnderstanding": {
            "summary": description or f"No description provided beyond the title \"{title}\".",
            "mainGoal": main_goal or title,
            "expectedOutcome": (
                f"A working {domain.lower() if domain != 'General Software Project' else 'software'} system "
                f"covering: {', '.join(m['name'] for m in modules if m['key'] not in {'testing', 'deployment'})}."
            ),
            "detectedDomain": domain,
        },
        "technologySuggestions": technology_suggestions,
        "projectStructure": phases,
        "modules": [
            {"name": m["name"], "description": m["description"], "priority": m["priority"], "moduleKey": m["key"]}
            for m in modules
        ],
        "tasks": tasks,
        "suggestedAssignments": assignments,
        "milestones": milestones,
        "insufficient_data": insufficient,
        "insufficientDataReasons": reasons,
        "engine": "rule-based-planner-v1",
        "generatedAt": now().isoformat(),
    }
