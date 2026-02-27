# RouteForge 🗺️

A completely free, open-source navigation app using:
- **[Leaflet](https://leafletjs.com/)** — map rendering
- **[OpenRouteService](https://openrouteservice.org/)** — directions/routing
- **[Nominatim](https://nominatim.org/)** — geocoding (place name → coordinates)
- **[CartoDB Dark Matter](https://carto.com/basemaps/)** — dark map tiles (free, no key)

## Setup

### 1. Get your FREE OpenRouteService API key

1. Sign up at https://openrouteservice.org/dev/#/signup
2. Verify your email
3. Go to your dashboard → copy your API key
4. **Free tier: 2,000 requests/day, no billing info required**

### 2. Install & Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and paste your ORS API key into the "ORS API KEY" field.

### 3. Build for production

```bash
npm run build
npm run preview
```

## Features

- 🔍 **Autocomplete search** — powered by Nominatim (OpenStreetMap)
- 🗺️ **Interactive dark map** — Leaflet + CartoDB Dark tiles
- 🚗🚲🚶 **Multi-modal routing** — Drive, Cycle, Walk
- 📍 **Click-to-place** — click anywhere on map to set origin/destination
- 📍 **GPS locate** — use your current location as origin
- 🔄 **Swap** — swap origin and destination
- 📋 **Turn-by-turn directions** — full step list with distances
- 💾 **API key persistence** — saved in localStorage
- 📱 **Responsive** — works on mobile

## Tech Stack

| Service | Purpose | Cost |
|---------|---------|------|
| Leaflet | Map rendering | Free, MIT |
| CartoDB Dark Matter | Map tiles | Free, no key |
| Nominatim (OSM) | Geocoding | Free, no key |
| OpenRouteService | Directions | Free (2k req/day) |
| Vite | Build tool | Free |

## No billing required. Ever.
