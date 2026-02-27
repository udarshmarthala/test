import './style.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocodeSearch, reverseGeocode } from './geocoding.js';
import { getRoute, formatDistance, formatDuration, getStepIcon } from './routing.js';

// ===================== STATE =====================
let map, routeLayer, originMarker, destMarker;
let origin = null, destination = null;
let activeMode = 'driving-car';
const DEFAULT_ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjZlMmQ4MTQzNjc3NzQ4ZDY5MTBhZjI3MTUwYTIyMjEyIiwiaCI6Im11cm11cjY0In0=';
let apiKey = localStorage.getItem('ors_api_key') || DEFAULT_ORS_API_KEY;
let activeSuggestions = null;

// ===================== MAP INIT =====================
function initMap() {
  map = L.map('map', {
    center: [37.7749, -122.4194],
    zoom: 12,
    zoomControl: false,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Dark tile layer using CartoDB dark matter (free, no key needed)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  // Click on map to set destination (if origin already set)
  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    try {
      const place = await reverseGeocode(lat, lng);
      if (!origin) {
        setOrigin(place);
      } else {
        setDestination(place);
      }
    } catch (err) {
      showError('Could not reverse geocode that location.');
    }
  });
}

// ===================== MARKERS =====================
function makeIcon(color, label) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:32px;height:32px;border-radius:50% 50% 50% 0;
      background:${color};border:3px solid #fff;
      transform:rotate(-45deg);
      box-shadow:0 2px 10px rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;
    ">
      <div style="transform:rotate(45deg);font-size:10px;font-weight:700;color:#000;">${label}</div>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -36],
  });
}

function setOrigin(place) {
  origin = place;
  document.getElementById('origin-input').value = place.name || place.displayName.split(',')[0];
  if (originMarker) map.removeLayer(originMarker);
  originMarker = L.marker([place.lat, place.lon], { icon: makeIcon('#47ff8e', 'A') })
    .addTo(map)
    .bindPopup(`<b>Start:</b> ${place.name || place.displayName.split(',')[0]}`);
  map.panTo([place.lat, place.lon]);
  checkReady();
}

function setDestination(place) {
  destination = place;
  document.getElementById('dest-input').value = place.name || place.displayName.split(',')[0];
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([place.lat, place.lon], { icon: makeIcon('#ff4785', 'B') })
    .addTo(map)
    .bindPopup(`<b>End:</b> ${place.name || place.displayName.split(',')[0]}`);
  map.panTo([place.lat, place.lon]);
  checkReady();
}

function checkReady() {
  const btn = document.getElementById('route-btn');
  btn.disabled = !(origin && destination && apiKey.trim());
}

// ===================== AUTOCOMPLETE =====================
let searchTimers = {};

function setupAutocomplete(inputId, suggestionsId, onSelect) {
  const input = document.getElementById(inputId);
  const suggestionsEl = document.getElementById(suggestionsId);

  input.addEventListener('input', () => {
    clearTimeout(searchTimers[inputId]);
    const q = input.value.trim();
    if (q.length < 2) {
      hideSuggestions(suggestionsEl);
      return;
    }
    searchTimers[inputId] = setTimeout(async () => {
      try {
        const results = await geocodeSearch(q);
        showSuggestions(suggestionsEl, results, (place) => {
          onSelect(place);
          hideSuggestions(suggestionsEl);
        });
      } catch (err) {
        console.error('Geocode error:', err);
      }
    }, 350);
  });

  input.addEventListener('keydown', (e) => {
    if (!suggestionsEl.classList.contains('active')) return;
    const items = suggestionsEl.querySelectorAll('.suggestion-item');
    const highlighted = suggestionsEl.querySelector('.highlighted');
    let idx = -1;
    if (highlighted) {
      items.forEach((item, i) => { if (item === highlighted) idx = i; });
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (highlighted) highlighted.classList.remove('highlighted');
      const next = items[Math.min(idx + 1, items.length - 1)];
      next.classList.add('highlighted');
      next.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (highlighted) highlighted.classList.remove('highlighted');
      const prev = items[Math.max(idx - 1, 0)];
      prev.classList.add('highlighted');
      prev.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted) highlighted.click();
    } else if (e.key === 'Escape') {
      hideSuggestions(suggestionsEl);
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => hideSuggestions(suggestionsEl), 180);
  });
}

function showSuggestions(el, results, onSelect) {
  el.innerHTML = '';
  if (!results.length) {
    el.innerHTML = '<div class="suggestion-item"><div class="main" style="color:#888">No results found</div></div>';
    el.classList.add('active');
    return;
  }
  results.forEach(place => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.innerHTML = `
      <div class="main">${place.name || place.displayName.split(',')[0]}</div>
      <div class="sub">${place.address || place.displayName.split(',').slice(1, 3).join(',')}</div>
    `;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); onSelect(place); });
    el.appendChild(item);
  });
  el.classList.add('active');
}

function hideSuggestions(el) {
  el.classList.remove('active');
}

// ===================== ROUTING =====================
async function calculateRoute() {
  if (!origin || !destination || !apiKey.trim()) return;

  const btn = document.getElementById('route-btn');
  const btnText = document.getElementById('route-btn-text');
  const btnLoader = document.getElementById('route-btn-loader');
  btnText.classList.add('hidden');
  btnLoader.classList.remove('hidden');
  btn.disabled = true;

  try {
    const route = await getRoute(apiKey.trim(), origin, destination, activeMode);

    // Draw route on map
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.polyline(route.coords, {
      color: '#e8ff47',
      weight: 4,
      opacity: 0.85,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);

    // Fit map to route
    map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });

    // Update stats
    document.getElementById('stat-distance').textContent = formatDistance(route.distance);
    document.getElementById('stat-duration').textContent = formatDuration(route.duration);

    // Update steps
    const stepsList = document.getElementById('steps-list');
    const stepsCount = document.getElementById('steps-count');
    stepsList.innerHTML = '';
    stepsCount.textContent = `${route.steps.length} STEPS`;

    route.steps.forEach((step, i) => {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.style.animationDelay = `${i * 30}ms`;
      li.innerHTML = `
        <div class="step-num">${i + 1}</div>
        <div style="flex:1">
          <div class="step-text">${step.instruction}</div>
          <div class="step-dist">${getStepIcon(step.type)} ${formatDistance(step.distance)}</div>
        </div>
      `;
      stepsList.appendChild(li);
    });

    document.getElementById('route-info').classList.remove('hidden');

    // Scroll route info into view
    document.getElementById('route-info').scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    showError(err.message || 'Failed to calculate route. Check your API key and try again.');
  } finally {
    btnText.classList.remove('hidden');
    btnLoader.classList.add('hidden');
    btn.disabled = false;
    checkReady();
  }
}

// ===================== ERROR TOAST =====================
let errorTimeout;
function showError(msg) {
  const toast = document.getElementById('error-toast');
  document.getElementById('error-msg').textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => toast.classList.add('hidden'), 6000);
}

// ===================== GEOLOCATION =====================
async function locateMe() {
  if (!navigator.geolocation) {
    showError('Geolocation not supported by your browser.');
    return;
  }
  const btn = document.getElementById('locate-btn');
  btn.textContent = '◌';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const place = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setOrigin(place);
      } catch (e) {
        showError('Could not reverse geocode your location.');
      }
      btn.textContent = '⊕';
    },
    (err) => {
      showError('Location access denied or unavailable.');
      btn.textContent = '⊕';
    }
  );
}

// ===================== MAIN =====================
document.addEventListener('DOMContentLoaded', () => {
  initMap();

  if (!localStorage.getItem('ors_api_key') && DEFAULT_ORS_API_KEY) {
    localStorage.setItem('ors_api_key', DEFAULT_ORS_API_KEY);
  }

  // API key restore
  if (apiKey) {
    document.getElementById('api-key-input').value = apiKey;
    document.getElementById('api-key-status').textContent = '✓ Key loaded from storage';
    document.getElementById('api-key-status').className = 'valid';
  }

  // Autocomplete
  setupAutocomplete('origin-input', 'origin-suggestions', setOrigin);
  setupAutocomplete('dest-input', 'dest-suggestions', setDestination);

  // Route button
  document.getElementById('route-btn').addEventListener('click', calculateRoute);

  // Locate me
  document.getElementById('locate-btn').addEventListener('click', locateMe);

  // Swap
  document.getElementById('swap-btn').addEventListener('click', () => {
    const tempOrigin = origin;
    const tempDest = destination;
    if (tempOrigin) setDestination(tempOrigin);
    if (tempDest) setOrigin(tempDest);
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    document.getElementById('route-info').classList.add('hidden');
  });

  // Travel modes
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeMode = btn.dataset.mode;
      if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
      document.getElementById('route-info').classList.add('hidden');
    });
  });

  // API key input
  const apiKeyInput = document.getElementById('api-key-input');
  apiKeyInput.addEventListener('input', () => {
    apiKey = apiKeyInput.value.trim();
    const statusEl = document.getElementById('api-key-status');
    if (apiKey.length > 10) {
      localStorage.setItem('ors_api_key', apiKey);
      statusEl.textContent = '✓ Key saved';
      statusEl.className = 'valid';
    } else if (apiKey.length > 0) {
      statusEl.textContent = '⚠ Key too short';
      statusEl.className = 'invalid';
    } else {
      statusEl.textContent = '';
      statusEl.className = '';
      localStorage.removeItem('ors_api_key');
    }
    checkReady();
  });

  // Toggle sidebar
  document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    setTimeout(() => map.invalidateSize(), 310);
  });

  // Close error toast
  document.getElementById('error-close').addEventListener('click', () => {
    document.getElementById('error-toast').classList.add('hidden');
  });
});
