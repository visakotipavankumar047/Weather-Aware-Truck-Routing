# 🚛 Weather-Aware Truck Routing

> **In one sentence:** you tell the app where a truck is going and when, and it draws the possible roads on a map, checks the weather the truck will meet along each road *at the moment it gets there*, and tells you which road is the safest.

> **Safety note:** this is a decision-support prototype, not a guarantee of road safety. General routing services may not know truck-specific limits (weight, bridge height, hazardous cargo). Forecasts can be wrong. If the weather is missing, the app says **UNKNOWN**, never "safe".

---

## 📖 Table of contents

1. [The idea, explained like you're 8](#1-the-idea-explained-like-youre-8)
2. [What you can do with it](#2-what-you-can-do-with-it)
3. [Architecture (the big picture)](#3-architecture-the-big-picture)
4. [What happens when you press the button](#4-what-happens-when-you-press-the-button)
5. [The database](#5-the-database)
6. [Project structure, file by file](#6-project-structure-file-by-file)
7. [How the risk is decided](#7-how-the-risk-is-decided)
8. [How the best route is chosen](#8-how-the-best-route-is-chosen)
9. [The API](#9-the-api)
10. [Technology stack](#10-technology-stack)
11. [Outside services we borrow from](#11-outside-services-we-borrow-from)
12. [Environment variables](#12-environment-variables)
13. [Run it on your computer](#13-run-it-on-your-computer)
14. [Checking that it works (health)](#14-checking-that-it-works-health)
15. [Tests](#15-tests)
16. [Deployment](#16-deployment)
17. [Limitations](#17-limitations)

---

## 1. The idea, explained like you're 8

Imagine you drive a big truck from **Denver** to **Colorado Springs**. There are a few roads you could take. Some roads might have strong wind, heavy rain or snow *later today*, right when you'd be driving there.

This app is a **clever helper** that does the boring work for you:

| Step | What the helper does | Like in real life… |
|---|---|---|
| 1️⃣ | Asks **where** you start and finish, **when** you leave, and **how heavy** your load is | Telling a friend your plan |
| 2️⃣ | Finds up to **3 different roads** | Looking at a map |
| 3️⃣ | Puts **little flags (checkpoints)** every 10, 25 or 50 miles | Marking rest-stops on the road |
| 4️⃣ | Works out **what time you'll reach each flag** | "I'll be there at 3 pm" |
| 5️⃣ | Asks a weather service **"what's the weather there at 3 pm?"** | Calling a weather friend |
| 6️⃣ | Gives every flag a **colour: 🟢 low … 🔴 no travel** | Traffic light for weather |
| 7️⃣ | **Ranks** the roads and says "take this one" | A wise friend giving advice |

And there is a **time slider**: "what if I leave 6 hours later?" Slide it and the colours update.

---

## 2. What you can do with it

- 🔎 Type a place name and pick it from a list (search-as-you-type).
- 🕒 Choose the departure time, load weight (lb) and flag spacing (10 / 25 / 50 miles).
- 🗺️ See every route on an interactive map, with coloured checkpoints.
- 🥇 See which route is recommended **and why**.
- 🌦️ Click a checkpoint to see wind, rain, snow and the arrival time.
- ⏩ Slide the departure 0–48 hours later and watch risk change.
- 🚦 Optionally see **live traffic** (needs a free TomTom key).
- 💾 Reopen previous trips (kept in your browser).
- ⚠️ Friendly messages when something is loading, missing, or broken.

---

## 3. Architecture (the big picture)

Think of the app as a **restaurant**:

- 🧑‍🍳 the **kitchen** is the *backend* (Django) where the real work happens,
- 🍽️ the **dining room** is the *frontend* (React) that you see and touch,
- 🚚 the **suppliers** are outside services (maps, weather) that bring ingredients,
- 📒 the **recipe book / pantry** is the *database* (Supabase Postgres) that remembers things.

```mermaid
flowchart TB
    U([👤 You in the browser])

    subgraph FE["🖥️ FRONTEND — React + Vite + Leaflet  (what you see)"]
        direction TB
        FORM[Trip form] --- MAP[Interactive map] --- SLIDER[Time slider]
    end

    subgraph BE["⚙️ BACKEND — Django REST Framework  (the brain)"]
        direction TB
        API[api/ · URL router + health]
        TRIPS[trips/ · orchestrates a trip]
        ROUTING[routing/ · finds roads, makes checkpoints]
        WEATHER[weather/ · gets forecasts]
        RISK[risk_engine/ · colours + ranking]
        API --> TRIPS
        TRIPS --> ROUTING
        TRIPS --> WEATHER
        TRIPS --> RISK
    end

    DB[(🗄️ Supabase PostgreSQL)]

    subgraph EXT["🌍 OUTSIDE SERVICES"]
        ORS[OpenRouteService<br/>roads + place search]
        NOM[Nominatim<br/>backup place search]
        OM[Open-Meteo<br/>weather forecast]
        TT[TomTom<br/>live traffic]
    end

    U --> FE
    FE -- "/api/*  (JSON)" --> API
    TRIPS <--> DB
    ROUTING --> ORS
    ROUTING --> NOM
    WEATHER --> OM
    TRIPS --> TT

    classDef fe fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e;
    classDef be fill:#ede9fe,stroke:#7c3aed,color:#3b0764;
    classDef db fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef ex fill:#fef3c7,stroke:#d97706,color:#78350f;
    class FE,FORM,MAP,SLIDER fe;
    class BE,API,TRIPS,ROUTING,WEATHER,RISK be;
    class DB db;
    class EXT,ORS,NOM,OM,TT ex;
```

### The golden rules of the design

| Rule | Why (kid version) |
|---|---|
| **Outside services live behind "adapters"** (`providers.py`) | If we swap one weather service for another, only one file changes. |
| **Risk + ranking are "pure" code** (no internet, no database) | They are simple maths, so tests can check them instantly and trust them. |
| **Missing weather = UNKNOWN** | "I don't know" is never turned into "it's safe". |
| **The browser also keeps a copy of each trip** | Even if the server forgets, you can reopen your trip. |

---

## 4. What happens when you press the button

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant FE as 🖥️ React app
    participant API as ⚙️ Django API
    participant ORS as 🛣️ OpenRouteService
    participant OM as 🌦️ Open-Meteo
    participant DB as 🗄️ Supabase

    You->>FE: Fill form, click "Analyze"
    FE->>API: POST /api/trips/ (origin, destination, time, load, spacing)
    API->>ORS: "Give me up to 3 roads"
    ORS-->>API: Road shapes + distance + duration
    Note over API: Drop a checkpoint every 10/25/50 miles<br/>and work out the arrival time at each
    API->>OM: "Weather at these points and times?"
    OM-->>API: Wind / rain / snow per checkpoint
    Note over API: Colour each checkpoint (LOW…NO_TRAVEL)<br/>Rank the routes, pick the best
    API->>DB: Save trip, places, routes, checkpoints
    API-->>FE: Everything as JSON (201 Created)
    FE-->>You: Map + route cards + recommendation
    You->>FE: Drag the time slider
    FE->>API: GET /api/trips/{id}/forecast/?offset_hours=6
    API-->>FE: Same routes, re-scored for the later departure
```

If any outside service fails, the trip is **not** half-saved: the server cleans up and tells you what went wrong.

---

## 5. The database

The app uses **Supabase** (a hosted **PostgreSQL** database). The connection is set by one line in `backend/.env`:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres
```

If `DATABASE_URL` is empty, Django falls back to a local SQLite file so you can still try the app offline.

### Tables and how they are linked (foreign keys)

Instead of repeating the same information in many columns, similar data lives in **its own table** and other tables just **point** to it (that pointer is a *foreign key*).

```mermaid
erDiagram
    PLACE ||--o{ TRIP : "origin"
    PLACE ||--o{ TRIP : "destination"
    TRIP  ||--o{ ROUTE : "has 1-3"
    ROUTE ||--o{ CHECKPOINT : "has many"
    RISKLEVEL ||--o{ CHECKPOINT : "risk"
    TRIP  }o--o| ROUTE : "recommended_route"

    PLACE {
        bigint id PK
        string label
        float lat
        float lon
    }
    RISKLEVEL {
        string code PK "LOW MODERATE HIGH SEVERE NO_TRAVEL UNKNOWN"
    }
    TRIP {
        uuid id PK
        fk origin_id
        fk destination_id
        datetime departure_at
        float load_weight_lb
        int checkpoint_interval_miles
        fk recommended_route_id
        json warnings
    }
    ROUTE {
        bigint id PK
        fk trip_id
        int rank
        bool eligible
        float distance_miles
        float duration_minutes
        json geometry
        json risk_summary
    }
    CHECKPOINT {
        bigint id PK
        fk route_id
        int sequence
        float distance_miles
        float lat
        float lon
        datetime eta
        json weather
        fk risk_id
        json reasons
    }
```

| Table | What it is, simply | Why a separate table? |
|---|---|---|
| **Place** | A named spot on Earth (name + latitude + longitude) | A trip's start and end are both "places". Same place used twice is stored once. |
| **RiskLevel** | The 6 allowed risk words | The database refuses any made-up risk word. |
| **Trip** | One question you asked ("Denver → Springs at 8 am, 32,000 lb") | The top of the family tree. |
| **Route** | One road option for that trip | A trip owns 1–3 routes; deleting the trip deletes them. |
| **Checkpoint** | One flag along a route with its weather and colour | A route owns many checkpoints. |

> Tip: the migrations in `backend/trips/migrations/` are the "history book" of how these tables were built. `0003_place_risklevel.py` introduced `Place` and `RiskLevel`.

---

## 6. Project structure, file by file

```text
Weather-Aware/
├── README.md                    ← you are here
├── DEPLOY.md                    ← step-by-step Vercel deployment guide
├── vercel.json                  ← tells Vercel: frontend = "web", backend = "api"
│
├── backend/                     ← 🧑‍🍳 THE KITCHEN (Python / Django)
│   ├── manage.py                ← Django's remote control (runserver, migrate, test)
│   ├── requirements.txt         ← packages needed to RUN the backend
│   ├── requirements-dev.txt     ← extra packages for testing / linting
│   ├── .env.example             ← template for your secret settings (copy to .env)
│   ├── ruff.toml                ← code-style rules
│   │
│   ├── config/                  ← the project's control room
│   │   ├── settings.py          ← ALL settings: database, CORS, API keys, apps
│   │   ├── urls.py              ← front door: sends /api/... to the api app
│   │   ├── wsgi.py / asgi.py    ← how web servers start Django
│   │
│   ├── api/                     ← the public face of the backend
│   │   ├── urls.py              ← list of every endpoint (the menu)
│   │   ├── views.py             ← /api/health/ (checks the Supabase connection)
│   │   ├── http.py              ← one safe way to call outside APIs (timeouts, errors)
│   │   ├── traffic.py           ← live-traffic status + map tiles (TomTom)
│   │   └── tests.py
│   │
│   ├── trips/                   ← 🧠 the conductor: runs a whole trip analysis
│   │   ├── models.py            ← DB tables: Place, RiskLevel, Trip, Route, Checkpoint
│   │   ├── migrations/          ← history of database changes
│   │   ├── serializers.py       ← validates input, shapes the JSON output
│   │   ├── views.py             ← the /api/trips/... endpoints
│   │   ├── urls.py              ← trip endpoint routes
│   │   ├── services.py          ← the pipeline: fetch → sample → weather → score → save
│   │   ├── stateless.py         ← endpoints that need NO database (forecast, sweep)
│   │   ├── traffic.py           ← matches routes to TomTom live traffic
│   │   ├── admin.py             ← Django admin screens for the tables
│   │   └── tests.py, test_*.py
│   │
│   ├── routing/                 ← 🛣️ roads and places
│   │   ├── providers.py         ← OpenRouteService + Nominatim adapters, place search
│   │   ├── geometry.py          ← distance maths + "drop a checkpoint every N miles"
│   │   ├── views.py             ← /api/geocoding/search/
│   │   └── tests.py, test_*.py
│   │
│   ├── weather/                 ← 🌦️ forecasts
│   │   ├── providers.py         ← Open-Meteo adapter (one call, many points)
│   │   ├── services.py          ← matches each checkpoint's ETA to the right hour
│   │   └── tests.py
│   │
│   └── risk_engine/             ← 🚦 the rules (pure maths, no internet)
│       ├── classifiers.py       ← wind/rain/snow + load → LOW…NO_TRAVEL
│       ├── ranking.py           ← sums risky miles, orders the routes
│       └── tests.py
│
└── frontend/                    ← 🍽️ THE DINING ROOM (React / TypeScript)
    ├── index.html               ← the single web page everything mounts into
    ├── package.json             ← JS packages and scripts (dev, build, test)
    ├── vite.config.ts           ← dev server + proxy of /api to the backend
    ├── .env.example             ← VITE_API_BASE_URL
    └── src/
        ├── main.tsx             ← app starts here
        ├── index.css            ← global styling (Tailwind)
        ├── app/App.tsx          ← top-level screen: layout + state wiring
        ├── components/
        │   ├── trip/            ← TripForm.tsx, PlaceSearch.tsx (the question)
        │   ├── map/             ← RouteMap, ActiveRouteLayer, CheckpointMarker/Labels, MapPanes
        │   ├── routes/          ← RouteList.tsx, RouteRow.tsx (route comparison cards)
        │   ├── checkpoints/     ← CheckpointTimeline.tsx (the list of flags)
        │   ├── weather/         ← DepartureDock (slider), RiskBadge, RiskStrip
        │   ├── feedback/        ← ApiErrorState.tsx (friendly errors)
        │   └── layout/          ← ApiStatus.tsx ("Connected" light), icons.tsx
        ├── hooks/               ← useRouteAnalysis.ts, useGeocoding.ts (data fetching)
        ├── services/            ← apiClient.ts, trips.ts, geocoding.ts, traffic.ts (talk to /api)
        ├── types/api.ts         ← the shape of every API response
        └── utils/               ← risk.ts (colours), geometry.ts, formatters.ts,
                                    recentPlaces.ts, tripStore.ts (browser copy), utils.test.ts
```

### The four backend "departments" in plain words

| Folder | Job | One-line analogy |
|---|---|---|
| `routing/` | Find roads, find places, drop checkpoints | The **map reader** |
| `weather/` | Ask what the weather will be, at the right hour | The **weather reporter** |
| `risk_engine/` | Turn numbers into colours, rank routes | The **referee** |
| `trips/` | Call the three above in order and save the result | The **conductor** |

---

## 7. How the risk is decided

At **every checkpoint** the app looks at wind, rain and snow, finds the level of each, and uses the **worst one**.

| Hazard | 🟢 Low | 🟡 Moderate | 🟠 High | 🔴 Severe | ⛔ No travel |
|---|---:|---:|---:|---:|---:|
| **Wind** | < 25 mph | 25–34 | 35–44 | 45–54 | ≥ 55 |
| **Rain** | < 0.10 in/hr | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | > 1.00 |
| **Snow** | < 0.5 in/hr | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | > 3.0 |

**Heavy-load wind rules** (they can only make things worse, never better):

- Wind ≥ 55 mph → **No travel** for any load.
- Wind 45–54 mph **and** load > 30,000 lb → **No travel**.
- Wind 35–44 mph **and** load > 40,000 lb → **Severe**.

**Edge rules we decided on (and tested):**

- A value *exactly* on a shared border (e.g. rain = 0.25) counts as the **higher** level.
- If any weather value is missing → **UNKNOWN** (never "low").

The code lives in `backend/risk_engine/classifiers.py`.

---

## 8. How the best route is chosen

Routes are compared like a **tie-breaker contest**, one round at a time (this is *lexicographic* order, not a mushy "score"):

```mermaid
flowchart LR
    A["Any NO_TRAVEL<br/>checkpoint?"] -->|fewer is better| B["Fewest<br/>SEVERE miles"]
    B -->|tie| C["Fewest HIGH miles<br/>(UNKNOWN counts as high)"]
    C -->|tie| D["Lowest<br/>average risk"]
    D -->|tie| E["Shortest<br/>travel time"]
    E --> W(["🥇 Recommended"])
```

- A road with a **NO_TRAVEL** checkpoint is **never recommended**. If *every* road has one, the app says "no route recommended".
- **Miles** are counted by giving each stretch between two flags the risk of the *earlier* flag.
- **UNKNOWN** miles are treated as *high* when ranking, so missing data can never win.

The code lives in `backend/risk_engine/ranking.py`.

---

## 9. The API

All endpoints start with `/api`. Interactive docs: **`/api/docs/`** (Swagger).

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/api/health/` | Is the backend up **and** is Supabase reachable? |
| GET | `/api/geocoding/search/?q=…` | Turn "Denver" into coordinates |
| POST | `/api/trips/` | Analyse a trip and save it |
| GET | `/api/trips/{id}/` | Trip summary + recommendation |
| GET | `/api/trips/{id}/routes/` | Route shapes (for the map) |
| GET | `/api/trips/{id}/checkpoints/` | Checkpoint weather + risk |
| GET | `/api/trips/{id}/forecast/?offset_hours=0..48` | Re-score for a later departure |
| GET | `/api/trips/{id}/traffic/?offset_hours=` | Live traffic for a saved trip |
| POST | `/api/trips/{id}/reanalyze/` | Run the analysis again |
| POST | `/api/forecast/` | Same as above but **without** the database |
| POST | `/api/forecast/sweep/` | Many departure offsets in one go (heatmap) |
| POST | `/api/traffic/routes/` | Traffic for routes you send in |
| GET | `/api/traffic/status/` | Is traffic switched on? |
| GET | `/api/schema/`, `/api/docs/` | OpenAPI schema and Swagger UI |

### Example request

```json
{
  "origin": "Denver, CO",
  "destination": "Colorado Springs, CO",
  "departure_at": "2026-10-20T08:00:00Z",
  "load_weight_lb": 32000,
  "checkpoint_interval_miles": 25
}
```

`origin` / `destination` can be text **or** `{ "label", "lat", "lon" }` (a place you already picked, so no second lookup). `departure_at` must include a time zone. `checkpoint_interval_miles` is 10, 25 or 50.

### Example response (shortened)

```json
{
  "trip_id": "6b8f…",
  "origin_label": "Denver, Colorado, USA",
  "destination_label": "Colorado Springs, Colorado, USA",
  "recommended_route_id": 12,
  "routes": [
    {
      "id": 12, "rank": 1, "eligible": true,
      "distance_miles": 69.4, "duration_minutes": 82.0,
      "risk_summary": { "severe_miles": 0, "high_miles": 0, "average_risk": 0.4 },
      "checkpoints": [
        { "sequence": 0, "eta": "2026-10-20T08:00:00Z", "risk": "LOW", "reasons": ["all hazards below thresholds"] }
      ]
    }
  ],
  "warnings": []
}
```

---

## 10. Technology stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React, Vite, TypeScript, Tailwind | Fast, typed, modern UI |
| Map | Leaflet / React Leaflet | Free interactive maps |
| Data fetching | TanStack Query | Caching + loading/error states |
| Backend | Python 3.12, Django, Django REST Framework | Batteries-included API |
| API docs | drf-spectacular | Automatic OpenAPI / Swagger |
| HTTP client | httpx | Calls outside services |
| Database | **Supabase PostgreSQL** (SQLite fallback locally) | Durable hosted storage |
| DB driver | psycopg 3 | Django ↔ Postgres |
| Testing | Django test runner, Vitest | Backend + frontend checks |
| Hosting | Vercel (frontend + backend as two services) | One domain, no CORS pain |

---

## 11. Outside services we borrow from

| Service | Used for | Key needed? |
|---|---|---|
| **OpenRouteService** | Road shapes, distance, duration, alternatives, place search | ✅ free key |
| **Nominatim (OpenStreetMap)** | Backup place search | ❌ (must send a polite User-Agent) |
| **Open-Meteo** | Hourly wind, rain, snow forecast | ❌ |
| **TomTom** | Live traffic layer (optional) + extra route alternatives | ✅ free key, optional |
| **OpenStreetMap tiles** | The map background (show attribution) | ❌ |

Please respect each service's usage policy and rate limits. The public Nominatim server is for low-volume use only and does not allow autocomplete spam.

---

## 12. Environment variables

### Backend → copy `backend/.env.example` to `backend/.env`

```dotenv
DJANGO_SECRET_KEY=replace-with-a-long-random-secret
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1

# Supabase: Project Settings → Database → Connection string (URI)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres

CORS_ALLOWED_ORIGINS=http://localhost:5173
CSRF_TRUSTED_ORIGINS=http://localhost:5173

OPENROUTESERVICE_API_KEY=
OPENROUTESERVICE_BASE_URL=https://api.openrouteservice.org
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=WeatherAwareTruckRouting/1.0 (contact: you@example.com)
OPEN_METEO_BASE_URL=https://api.open-meteo.com/v1/forecast

TOMTOM_API_KEY=            # optional
EXTERNAL_API_TIMEOUT_SECONDS=15
```

🔒 **Never commit `.env`.** It holds passwords and keys. In production set `DJANGO_DEBUG=False` and a strong secret.

### Frontend → `frontend/.env`

```dotenv
VITE_API_BASE_URL=/api
```

Never put private keys in `VITE_*` variables: they are visible to everyone in the browser.

---

## 13. Run it on your computer

**You need:** Git, Node.js (LTS), Python 3.12.

### Step 1 · Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env        # then fill in the keys + DATABASE_URL
python manage.py migrate      # builds the tables in Supabase
python manage.py runserver    # http://127.0.0.1:8000
```

### Step 2 · Frontend (new terminal)

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev                   # http://localhost:5173
```

Open `http://localhost:5173`. The sidebar light should say **Connected**.

---

## 14. Checking that it works (health)

With the backend running, open (or `curl`) `http://localhost:8000/api/health/`.

| You see | Meaning |
|---|---|
| `{"status":"ok","database":"postgresql","connected":true,…}` (HTTP 200) | ✅ Backend up **and** Supabase reachable |
| `{"status":"error","connected":false,…}` (HTTP 503) | ❌ Backend is up, database is **not** reachable → check `DATABASE_URL` |
| `"database":"sqlite3"` | You are on the local fallback, not Supabase |

---

## 15. Tests

```powershell
# Backend
cd backend
python manage.py test            # 61 tests

# Frontend
cd frontend
npm run test
npm run build
```

> The backend tests create a throwaway database. Supabase's connection pooler doesn't allow creating one, so run them on SQLite by emptying the variable: `$env:DATABASE_URL=""` (PowerShell) before `python manage.py test`.

What the tests cover: every wind/rain/snow border value, load overrides, ranking tie-breakers, checkpoint sampling, ETA-to-hour matching, missing weather, provider errors, input validation, and the health endpoint.

---

## 16. Deployment

One **Vercel** project serves both halves (see `vercel.json` and [DEPLOY.md](DEPLOY.md)):

- `web` → `frontend/` (Vite build)
- `api` → `backend/` (Django, `config.wsgi:application`)
- `/api/*` goes to Django, everything else to React.

Add the environment variables from section 12 in Vercel (especially `DATABASE_URL` for Supabase, `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, `OPENROUTESERVICE_API_KEY`). After deploying, visit `https://<your-app>.vercel.app/api/health/`.

---

## 17. Limitations

- Normal routing APIs aren't truck-aware: they may ignore weight limits, bridge heights, and hazmat rules.
- Weather forecasts are uncertain and only reach a limited number of days ahead; further checkpoints become **UNKNOWN**.
- Open-Meteo gives hourly *amounts*, which we treat as in/hr.
- Three routes are shown only when the routing provider returns real alternatives. We never invent them.
- Free public services have rate limits.

**Ideas for later:** a truck-specific routing provider, background jobs, user accounts, and monitoring.

---

## Useful links

[OpenStreetMap](https://www.openstreetmap.org/) · [OpenRouteService](https://openrouteservice.org/dev/#/api-docs) · [Open-Meteo](https://open-meteo.com/en/docs) · [Supabase](https://supabase.com/docs) · [Django](https://docs.djangoproject.com/) · [DRF](https://www.django-rest-framework.org/) · [React](https://react.dev/) · [Vite](https://vite.dev/) · [Leaflet](https://leafletjs.com/)
