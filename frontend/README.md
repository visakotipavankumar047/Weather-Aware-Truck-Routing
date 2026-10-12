# Weather-Aware Truck Routing: frontend

React 19 + Vite + TypeScript + Tailwind v4 + Leaflet + TanStack Query. All data comes from the Django API; the browser holds no provider keys and no risk logic.

## Run

```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle
npm test           # vitest
```

The backend must be running on `http://127.0.0.1:8000`. In dev the app calls it directly (CORS allows `http://localhost:5173`). Set `VITE_API_BASE_URL` (see `.env.example`) for any other API location; production default is `/api`.

## Design

A map-first tool in the manner of Google Maps: a fixed 400 px sidebar (search, route list, details), the map filling the rest, and a departure-time dock under the map. On phones the map is on top, then the dock, then the sidebar content.

- **Type:** IBM Plex Sans for UI, IBM Plex Mono for every number a dispatcher compares (times, miles, wind, rain).
- **Colour:** cool neutral ramp, one accent blue, one semantic risk scale. Every risk also carries a letter (L M H S X ?), so colour is never the only cue.
- **Shape language:** rectangles with 4-8 px radii and hairline borders. Shadows only on things that float over the map (labels, controls, popups).
- **Route reading:** the route line is the *traffic* channel (blue = flowing, orange/red = congestion from TomTom). The wide glow around it is the *weather* channel (colour = risk at the checkpoint that stretch belongs to).
- **Route time labels:** rectangular call-outs with a tail. The selected route shows its full time; alternatives show the difference ("+7 min"). Each label carries the route's worst weather level as a coloured letter.
- **Departure dock:** the risk heat strip is the slider track. Drag across it to see every route re-scored for that departure; "Calmest" jumps to the best window found.

## What each part does

| Area | Files | Backend endpoints used |
|---|---|---|
| Place search (debounced, keyboard combobox, recents) | `components/trip/PlaceSearch.tsx`, `hooks/useGeocoding.ts` | `GET /geocoding/search/` |
| Trip form + validation | `components/trip/TripForm.tsx` | `POST /trips/` |
| Map, route labels, controls, legend | `components/map/RouteMap.tsx` | trip routes/checkpoints |
| Active route (weather glow + traffic line) | `components/map/ActiveRouteLayer.tsx`, `utils/geometry.ts` | checkpoints, `GET /trips/{id}/traffic/` |
| Checkpoint markers and popups | `components/map/CheckpointMarker.tsx` | checkpoint weather/risk |
| Route list + "why" explanation | `components/routes/RouteList.tsx`, `RouteRow.tsx`, `utils/risk.ts` | recommendation + risk summaries |
| Checkpoint timeline | `components/checkpoints/CheckpointTimeline.tsx` | checkpoint weather/risk |
| Departure dock (slider + heat strip) | `components/weather/DepartureDock.tsx`, `hooks/useRouteAnalysis.ts` | `GET /trips/{id}/forecast/?offset_hours=` |
| Live traffic tiles + toggle | `components/map/RouteMap.tsx`, `services/traffic.ts` | `GET /traffic/status/`, `GET /traffic/tiles/{z}/{x}/{y}.png` |
| Traffic delay per route | `components/routes/RouteRow.tsx`, `hooks/useRouteAnalysis.ts` | `GET /trips/{id}/traffic/?offset_hours=` |
| Saved trips + reload from DB | `app/App.tsx`, `services/trips.ts` | `GET /trips/{id}/`, `/routes/`, `/checkpoints/` |
| Refresh analysis | `app/App.tsx` | `POST /trips/{id}/reanalyze/` |
| API status | `components/layout/ApiStatus.tsx` | `GET /health/` |

## Behaviour worth knowing

- **Search:** results appear after a 700 ms pause (3+ characters) or on Enter, are cached for an hour, and must be picked from the list so the backend receives exact coordinates. This respects Nominatim's no-autocomplete policy.
- **Corridor:** the selected route is split at checkpoint distances and each piece is coloured by the checkpoint it starts at, the same rule the backend uses to count risk miles. Unknown pieces are dashed grey.
- **Forecast slider:** each offset (0-48 h) is a backend request that re-scores and re-ranks routes; the heat strip prefetches +3 h steps in the background.
- **Not colour-only:** every risk shows a letter code and a label (L, M, H, S, X, ?).
- **Persistence:** every analysis is stored by the backend. The last trip id and a list of recent trips are kept in `localStorage` and reopened from the database on load.
- **Errors:** validation (400), rate limits (429/503), provider failures (5xx) and network errors each get a message; "Try again" only appears for transient failures.
