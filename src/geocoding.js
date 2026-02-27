// Nominatim geocoding — completely free, no API key needed

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export async function geocodeSearch(query) {
  if (!query || query.trim().length < 2) return [];
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'RouteForge/1.0' }
  });
  if (!res.ok) throw new Error('Nominatim error: ' + res.status);
  const data = await res.json();
  return data.map(item => ({
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    displayName: item.display_name,
    name: item.name || item.display_name.split(',')[0],
    address: item.display_name.split(',').slice(1, 3).join(',').trim(),
  }));
}

export async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lon}&format=jsonv2`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'RouteForge/1.0' }
  });
  if (!res.ok) throw new Error('Nominatim reverse error');
  const data = await res.json();
  return {
    lat, lon,
    displayName: data.display_name,
    name: data.address?.road || data.address?.suburb || data.display_name.split(',')[0],
    address: data.display_name,
  };
}
