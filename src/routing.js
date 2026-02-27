// OpenRouteService — free tier: 2000 requests/day, no billing required
// Sign up at https://openrouteservice.org/dev/#/signup

const ORS_BASE = 'https://api.openrouteservice.org';

export async function getRoute(apiKey, origin, destination, profile = 'driving-car') {
  const url = `${ORS_BASE}/v2/directions/${profile}`;
  const body = {
    coordinates: [
      [origin.lon, origin.lat],
      [destination.lon, destination.lat],
    ],
    instructions: true,
    language: 'en',
    units: 'mi',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json, application/geo+json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = `ORS error ${res.status}`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson?.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await res.json();
  const route = data.routes[0];
  const summary = route.summary;
  const segments = route.segments;

  // Decode polyline (ORS returns encoded polyline)
  const geometry = data.routes[0].geometry;
  const coords = decodePolyline(geometry);

  // Collect all steps
  const steps = [];
  segments.forEach(seg => {
    seg.steps.forEach(step => {
      steps.push({
        instruction: step.instruction,
        distance: step.distance,
        duration: step.duration,
        type: step.type,
        name: step.name,
      });
    });
  });

  return {
    distance: summary.distance,     // miles
    duration: summary.duration,     // seconds
    coords,                          // [[lat, lon], ...]
    steps,
    bbox: data.bbox,
  };
}

// ORS uses Google's polyline encoding (precision 5)
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
}

export function formatDistance(miles) {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(1)} mi`;
}

export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

// Map ORS instruction type numbers to arrow icons
export function getStepIcon(type) {
  const icons = {
    0: '⬆', 1: '↗', 2: '→', 3: '↘', 4: '⬇', 5: '↙', 6: '←', 7: '↖',
    8: '⬆', 9: '↻', 10: '↺', 11: '↗', 12: '↗', 13: '🏁'
  };
  return icons[type] || '⬆';
}
