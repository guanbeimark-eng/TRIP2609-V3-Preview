# TRIP2609 Travel Console V3 — day 2026-09-28 (Fengfeng) only

Forked from EasyItinerary (MIT). Stock sources in `vendor/easyitinerary/`. See `ATTRIBUTION.md`.

## Run

```bash
cd /workspace/trip-console/v3/trip2609 && PORT=3010 node server.js
# open http://127.0.0.1:3010/
```

## Scope (first round)

- Planned visits only on 今天 / 行程
- 发现: 峰峰博物馆 candidate
- Leaflet + Gaode/GeoQ GCJ-02 tiles (no AMap JS API on boot)
- Marker ↔ timeline sync; thumbs only until enlarge

Do **not** migrate 09-27–10-04 yet.
