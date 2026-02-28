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

// Live tracking state
let isLiveTracking = false;
let liveTrackingWatchId = null;
let lastUpdateLocation = null;
const ROUTE_UPDATE_THRESHOLD_METERS = 50; // Recalculate route after moving 50+ meters

// Navigation state
let currentRoute = null;
let currentStepIndex = -1;
let userLocation = null;

// Navigation marker state
let navigationMarker = null;
let currentHeading = 0;
let lastPosition = null;
let traveledRouteLayer = null;
let remainingRouteLayer = null;
let deviceOrientationSupported = false;
let isNavigating = false;
let previousPositions = [];  // Store recent positions for heading calculation
const HEADING_SMOOTHING_POSITIONS = 3;  // Number of positions to average for smooth heading

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

// Blue navigation marker with direction arrow (like Google Maps)
function makeNavigationIcon(heading = 0) {
  return L.divIcon({
    className: 'navigation-marker',
    html: `
      <div class="nav-marker-container" style="transform: rotate(${heading}deg);">
        <div class="nav-marker-arrow"></div>
        <div class="nav-marker-dot"></div>
        <div class="nav-marker-pulse"></div>
      </div>
    `,
    iconSize: [60, 60],
    iconAnchor: [30, 30],
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

    // Store current route for navigation tracking
    currentRoute = {
      distance: route.distance,
      duration: route.duration,
      coords: route.coords,
      steps: route.steps.map(step => ({
        ...step,
        coordCount: 1  // Placeholder - will refine this
      }))
    };

    // Clear any existing route layers
    if (routeLayer) map.removeLayer(routeLayer);
    if (traveledRouteLayer) {
      map.removeLayer(traveledRouteLayer);
      traveledRouteLayer = null;
    }
    if (remainingRouteLayer) {
      map.removeLayer(remainingRouteLayer);
      remainingRouteLayer = null;
    }

    // If live tracking is active, use navigation mode
    if (isLiveTracking) {
      isNavigating = true;
      // Draw route with Google Maps-style blue
      routeLayer = L.polyline(route.coords, {
        color: '#4285F4',  // Google Maps blue
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map);
      
      // Store bounds before updateRouteVisualization potentially removes routeLayer
      const routeBounds = routeLayer.getBounds();
      
      // Immediately update route visualization
      if (userLocation) {
        updateRouteVisualization();
      }
      
      // Fit map to route using stored bounds
      map.fitBounds(routeBounds, { padding: [60, 60] });
    } else {
      // Normal route display (yellow)
      routeLayer = L.polyline(route.coords, {
        color: '#e8ff47',
        weight: 4,
        opacity: 0.85,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map);
      
      // Fit map to route
      map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
    }

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
      li.dataset.stepIndex = i;
      stepsList.appendChild(li);
    });

    document.getElementById('route-info').classList.remove('hidden');

    // Show/hide start navigation button based on tracking state
    const startNavBtn = document.getElementById('start-navigation-btn');
    if (isLiveTracking && isNavigating) {
      // Already navigating, hide the button
      startNavBtn.classList.add('hidden');
    } else {
      // Show button to start navigation
      startNavBtn.classList.remove('hidden');
    }

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

// Start navigation mode (auto-start live tracking with route)
function startNavigation() {
  if (!currentRoute) {
    showError('Please calculate a route first.');
    return;
  }
  
  isNavigating = true;
  
  // Set initial heading based on route direction
  if (currentRoute.coords && currentRoute.coords.length >= 2) {
    const start = currentRoute.coords[0];
    const next = currentRoute.coords[Math.min(3, currentRoute.coords.length - 1)];
    currentHeading = calculateBearing(start[0], start[1], next[0], next[1]);
  }
  
  // Start live tracking if not already started
  if (!isLiveTracking) {
    startLiveTracking();
  } else if (userLocation) {
    // If already tracking, update marker with route heading
    const routeHeading = getRouteHeading(userLocation.lat, userLocation.lon);
    if (routeHeading !== null) {
      currentHeading = routeHeading;
    }
    updateNavigationMarker(userLocation.lat, userLocation.lon, currentHeading);
  }
  
  // Hide start button
  const startNavBtn = document.getElementById('start-navigation-btn');
  if (startNavBtn) {
    startNavBtn.classList.add('hidden');
  }
  
  // Convert route to navigation style (blue)
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = L.polyline(currentRoute.coords, {
      color: '#4285F4',
      weight: 6,
      opacity: 0.9,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);
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

// Calculate distance between two coordinates in meters
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Start live location tracking and auto-update route
function startLiveTracking() {
  if (!navigator.geolocation) {
    showError('Geolocation not supported by your browser.');
    return;
  }

  if (isLiveTracking) {
    stopLiveTracking();
    return;
  }

  isLiveTracking = true;
  isNavigating = currentRoute !== null;
  
  const trackingBtn = document.getElementById('live-tracking-btn');
  const coordsDisplay = document.getElementById('coordinates-display');
  
  if (trackingBtn) {
    trackingBtn.classList.add('active');
    trackingBtn.textContent = '⊙ Live';
  }
  if (coordsDisplay) {
    coordsDisplay.classList.remove('hidden');
  }

  // Try to use device orientation for compass heading
  if (window.DeviceOrientationEvent) {
    // Request permission on iOS 13+
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(permission => {
          if (permission === 'granted') {
            // Use absolute orientation if available (better compass)
            if ('ondeviceorientationabsolute' in window) {
              window.addEventListener('deviceorientationabsolute', handleDeviceOrientation);
            } else {
              window.addEventListener('deviceorientation', handleDeviceOrientation);
            }
            deviceOrientationSupported = true;
          }
        })
        .catch(console.error);
    } else {
      // Non-iOS: try absolute first, fall back to regular
      if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', handleDeviceOrientation);
      } else {
        window.addEventListener('deviceorientation', handleDeviceOrientation);
      }
      deviceOrientationSupported = true;
    }
  }

  liveTrackingWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude, heading: deviceHeading, speed } = pos.coords;
      const newPosition = { lat: latitude, lon: longitude, timestamp: Date.now() };

      // Update coordinates display
      document.getElementById('coord-lat').textContent = latitude.toFixed(6);
      document.getElementById('coord-lon').textContent = longitude.toFixed(6);

      // Determine heading using multiple sources (priority order)
      // Skip if device orientation (compass) is actively providing heading
      let newHeading = currentHeading;
      let useDeviceOrientation = deviceOrientationSupported && isNavigating;
      
      if (!useDeviceOrientation) {
        // 1. Use GPS heading if available and moving
        if (deviceHeading !== null && deviceHeading !== undefined && !isNaN(deviceHeading)) {
          newHeading = deviceHeading;
        }
        // 2. Calculate from movement if we have previous position
        else if (lastPosition) {
          const distanceMoved = getDistanceInMeters(
            lastPosition.lat, lastPosition.lon,
            latitude, longitude
          );
          if (distanceMoved > 1) {  // More than 1 meter
            const movementHeading = calculateBearing(
              lastPosition.lat, lastPosition.lon,
              latitude, longitude
            );
            previousPositions.push({ heading: movementHeading, timestamp: Date.now() });
            if (previousPositions.length > HEADING_SMOOTHING_POSITIONS) {
              previousPositions.shift();
            }
            newHeading = calculateSmoothedHeading();
          }
        }
        
        // 3. If navigating AND (no movement detected OR stationary), use route heading
        if (currentRoute && isNavigating) {
          const routeHeading = getRouteHeading(latitude, longitude);
          if (routeHeading !== null) {
            // If we have movement heading, blend it with route heading
            // Otherwise just use route heading
            if (previousPositions.length > 0 && Math.abs(newHeading - routeHeading) < 45) {
              // Movement roughly aligned with route, keep movement heading
            } else {
              // No movement or movement not aligned, use route heading
              newHeading = routeHeading;
            }
          }
        }
        
        currentHeading = newHeading;
      }

      lastPosition = newPosition;

      // Update or create origin with live location
      if (!origin) {
        try {
          const place = await reverseGeocode(latitude, longitude);
          origin = { ...place, lat: latitude, lon: longitude };
          lastUpdateLocation = { lat: latitude, lon: longitude };
        } catch (e) {
          origin = { name: 'My Location', lat: latitude, lon: longitude };
          lastUpdateLocation = { lat: latitude, lon: longitude };
        }
      } else {
        const distance = getDistanceInMeters(
          origin.lat, origin.lon,
          latitude, longitude
        );

        origin.lat = latitude;
        origin.lon = longitude;

        // Recalculate route if moved more than threshold and we have a destination
        if (destination && (!lastUpdateLocation || distance > ROUTE_UPDATE_THRESHOLD_METERS)) {
          lastUpdateLocation = { lat: latitude, lon: longitude };
          
          // Show that we're recalculating
          if (currentRoute && !document.getElementById('route-btn').disabled) {
            await calculateRoute();
          }
        }
      }

      // Store user location for navigation
      userLocation = { lat: latitude, lon: longitude };

      // Update navigation marker (blue arrow)
      updateNavigationMarker(latitude, longitude, currentHeading);

      // Update route visualization (traveled vs remaining)
      if (currentRoute && isNavigating) {
        updateRouteVisualization();
      }

      // Update navigation panel if route exists
      updateNavigationPanel();
    },
    (err) => {
      console.error('Geolocation error:', err);
      showError('Location access error: ' + err.message);
      stopLiveTracking();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    }
  );
}

// Handle device orientation for compass heading
function handleDeviceOrientation(event) {
  if (event.alpha !== null) {
    // alpha is the compass heading (0-360 degrees)
    // On iOS, webkitCompassHeading is more accurate
    let heading = event.webkitCompassHeading !== undefined ? event.webkitCompassHeading : (360 - event.alpha);
    
    // Normalize heading
    heading = (heading + 360) % 360;
    
    currentHeading = heading;
    deviceOrientationSupported = true;
    
    // Instantly update navigation marker rotation using CSS transform
    if (userLocation && navigationMarker) {
      // Direct DOM update for instant rotation
      const markerElement = navigationMarker.getElement();
      if (markerElement) {
        const container = markerElement.querySelector('.nav-marker-container');
        if (container) {
          container.style.transform = `rotate(${heading}deg)`;
        }
      }
    }
  }
}

// Calculate smoothed heading from recent positions
function calculateSmoothedHeading() {
  if (previousPositions.length === 0) return currentHeading;
  if (previousPositions.length === 1) return previousPositions[0].heading;
  
  // Weight recent headings more heavily
  let totalWeight = 0;
  
  // Convert headings to unit vectors, average them, then convert back
  let sinSum = 0;
  let cosSum = 0;
  
  previousPositions.forEach((pos, i) => {
    const weight = i + 1;  // More recent = higher weight
    const rad = pos.heading * Math.PI / 180;
    sinSum += Math.sin(rad) * weight;
    cosSum += Math.cos(rad) * weight;
    totalWeight += weight;
  });
  
  sinSum /= totalWeight;
  cosSum /= totalWeight;
  
  let avgHeading = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
  return (avgHeading + 360) % 360;
}

// Get heading based on route direction (point towards next waypoint)
function getRouteHeading(lat, lon) {
  if (!currentRoute || !currentRoute.coords || currentRoute.coords.length < 2) {
    return null;
  }
  
  // Find closest point on route
  const closest = findClosestPointOnRoute(lat, lon);
  if (closest.index === -1) return null;
  
  // Get next point on route (look ahead)
  const lookAheadIndex = Math.min(closest.index + 3, currentRoute.coords.length - 1);
  const nextPoint = currentRoute.coords[lookAheadIndex];
  
  if (!nextPoint) return null;
  
  // Calculate bearing to next point
  return calculateBearing(lat, lon, nextPoint[0], nextPoint[1]);
}

// Update navigation marker position and rotation
function updateNavigationMarker(lat, lon, heading) {
  if (navigationMarker) {
    navigationMarker.setLatLng([lat, lon]);
    // Update rotation via CSS for smooth updates
    const markerElement = navigationMarker.getElement();
    if (markerElement) {
      const container = markerElement.querySelector('.nav-marker-container');
      if (container) {
        container.style.transform = `rotate(${heading}deg)`;
      }
    }
  } else {
    const icon = makeNavigationIcon(heading);
    navigationMarker = L.marker([lat, lon], { 
      icon: icon,
      zIndexOffset: 1000  // Keep navigation marker on top
    }).addTo(map);
  }

  // If navigating, remove the origin marker (we use navigation marker instead)
  if (isNavigating && originMarker) {
    map.removeLayer(originMarker);
    originMarker = null;
  }

  // Smoothly pan map to follow user (with slight offset for navigation view)
  if (isNavigating) {
    // Calculate offset point in the direction of travel (look ahead)
    const offsetDistance = 0.0005;  // About 50m
    const headingRad = heading * Math.PI / 180;
    const offsetLat = lat + offsetDistance * Math.cos(headingRad);
    const offsetLon = lon + offsetDistance * Math.sin(headingRad);
    
    map.panTo([lat, lon], { animate: true, duration: 0.5 });
  } else {
    map.panTo([lat, lon], { animate: true, duration: 0.3 });
  }
}

// Update route visualization showing traveled vs remaining portions
function updateRouteVisualization() {
  if (!currentRoute || !userLocation) return;

  const closest = findClosestPointOnRoute(userLocation.lat, userLocation.lon);
  if (closest.index === -1) return;

  const coords = currentRoute.coords;
  const closestIndex = closest.index;

  // Split route into traveled and remaining
  const traveledCoords = coords.slice(0, closestIndex + 1);
  const remainingCoords = coords.slice(closestIndex);

  // Add current user position to connect the paths
  if (traveledCoords.length > 0) {
    traveledCoords.push([userLocation.lat, userLocation.lon]);
  }
  if (remainingCoords.length > 0) {
    remainingCoords.unshift([userLocation.lat, userLocation.lon]);
  }

  // Remove old route layers
  if (traveledRouteLayer) map.removeLayer(traveledRouteLayer);
  if (remainingRouteLayer) map.removeLayer(remainingRouteLayer);
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  // Draw traveled portion (dimmed)
  if (traveledCoords.length >= 2) {
    traveledRouteLayer = L.polyline(traveledCoords, {
      color: '#666680',  // Dimmed gray-blue
      weight: 6,
      opacity: 0.5,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);
  }

  // Draw remaining portion (bright blue like Google Maps)
  if (remainingCoords.length >= 2) {
    remainingRouteLayer = L.polyline(remainingCoords, {
      color: '#4285F4',  // Google Maps blue
      weight: 6,
      opacity: 0.9,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);
  }
}

function stopLiveTracking() {
  if (liveTrackingWatchId !== null) {
    navigator.geolocation.clearWatch(liveTrackingWatchId);
    liveTrackingWatchId = null;
  }
  
  // Remove device orientation listener
  if (deviceOrientationSupported) {
    window.removeEventListener('deviceorientation', handleDeviceOrientation);
    window.removeEventListener('deviceorientationabsolute', handleDeviceOrientation);
    deviceOrientationSupported = false;
  }
  
  isLiveTracking = false;
  isNavigating = false;
  previousPositions = [];
  
  // Remove navigation marker
  if (navigationMarker) {
    map.removeLayer(navigationMarker);
    navigationMarker = null;
  }
  
  // Remove split route layers
  if (traveledRouteLayer) {
    map.removeLayer(traveledRouteLayer);
    traveledRouteLayer = null;
  }
  if (remainingRouteLayer) {
    map.removeLayer(remainingRouteLayer);
    remainingRouteLayer = null;
  }
  
  document.getElementById('navigation-panel').classList.add('hidden');
  const trackingBtn = document.getElementById('live-tracking-btn');
  const coordsDisplay = document.getElementById('coordinates-display');
  
  if (trackingBtn) {
    trackingBtn.classList.remove('active');
    trackingBtn.textContent = '⊕ Live';
  }
  if (coordsDisplay) {
    coordsDisplay.classList.add('hidden');
  }
}

// ===================== NAVIGATION TRACKING =====================
// Find the closest point on the route to user's current location
function findClosestPointOnRoute(userLat, userLon) {
  if (!currentRoute || !currentRoute.coords || currentRoute.coords.length === 0) {
    return { index: -1, distance: Infinity };
  }

  let minDistance = Infinity;
  let closestIndex = 0;

  currentRoute.coords.forEach((coord, idx) => {
    const dist = getDistanceInMeters(userLat, userLon, coord[0], coord[1]);
    if (dist < minDistance) {
      minDistance = dist;
      closestIndex = idx;
    }
  });

  return { index: closestIndex, distance: minDistance };
}

// Determine which step the user is currently on
function findCurrentStep(routeCoordIndex) {
  if (!currentRoute || !currentRoute.steps) return -1;

  let cumulativeCoordCount = 0;
  for (let i = 0; i < currentRoute.steps.length; i++) {
    const step = currentRoute.steps[i];
    const stepCoordCount = step.coordCount || 1;
    if (routeCoordIndex < cumulativeCoordCount + stepCoordCount) {
      return i;
    }
    cumulativeCoordCount += stepCoordCount;
  }
  return currentRoute.steps.length - 1;
}

// Calculate distance remaining on the route
function calculateRemainingDistance(routeCoordIndex) {
  if (!currentRoute || !currentRoute.coords) return 0;

  const remainingCoords = currentRoute.coords.slice(routeCoordIndex);
  let distance = 0;

  for (let i = 0; i < remainingCoords.length - 1; i++) {
    distance += getDistanceInMeters(
      remainingCoords[i][0], remainingCoords[i][1],
      remainingCoords[i + 1][0], remainingCoords[i + 1][1]
    );
  }

  return distance;
}

// Calculate bearing/direction between two points
function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon * Math.PI / 180);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

// Update navigation panel with current step info
function updateNavigationPanel() {
  if (!currentRoute || !isLiveTracking || !userLocation) {
    document.getElementById('navigation-panel').classList.add('hidden');
    return;
  }

  const navPanel = document.getElementById('navigation-panel');
  navPanel.classList.remove('hidden');

  const closest = findClosestPointOnRoute(userLocation.lat, userLocation.lon);
  const stepIdx = findCurrentStep(closest.index);
  currentStepIndex = stepIdx;

  if (stepIdx === -1) {
    navPanel.classList.add('hidden');
    return;
  }

  const totalSteps = currentRoute.steps.length;
  const currentStep = currentRoute.steps[stepIdx];
  const nextStep = stepIdx < totalSteps - 1 ? currentRoute.steps[stepIdx + 1] : null;

  // Update step counter
  document.getElementById('nav-current-step').textContent = stepIdx + 1;
  document.getElementById('nav-total-steps').textContent = totalSteps;

  // Calculate progress
  const remainingDistance = calculateRemainingDistance(closest.index);
  const totalDistance = currentRoute.distance * 1609.34; // Convert miles to meters
  const progress = Math.max(0, Math.min(100, ((totalDistance - remainingDistance) / totalDistance) * 100));
  document.getElementById('nav-progress-bar').style.width = progress + '%';

  // Get arrow icon for current instruction
  const arrowIcon = getStepIcon(currentStep.type);
  document.getElementById('nav-arrow').textContent = arrowIcon;

  // Update current instruction
  document.getElementById('nav-instruction').textContent = currentStep.instruction;
  
  // Calculate distance to next instruction
  let distanceToNext = 0;
  if (nextStep) {
    // Distance from current position to start of next step
    const nextStepDistance = formatDistance(nextStep.distance || 0);
    document.getElementById('nav-distance-to-next').textContent = nextStepDistance + ' to next turn';
  } else {
    document.getElementById('nav-distance-to-next').textContent = 'Approaching destination';
  }

  // Update upcoming instruction
  if (nextStep) {
    document.getElementById('nav-upcoming-instruction').textContent = nextStep.instruction;
  } else {
    document.getElementById('nav-upcoming-instruction').textContent = 'You\'ve reached your destination!';
  }

  // Highlight current step in the list
  document.querySelectorAll('.step-item').forEach((item, idx) => {
    item.classList.remove('active', 'completed', 'upcoming');
    if (idx === stepIdx) {
      item.classList.add('active');
      // Auto-scroll current step into view
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (idx < stepIdx) {
      item.classList.add('completed');
    } else {
      item.classList.add('upcoming');
    }
  });
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

  // Live tracking
  document.getElementById('live-tracking-btn').addEventListener('click', startLiveTracking);

  // Start navigation button
  document.getElementById('start-navigation-btn').addEventListener('click', startNavigation);

  // Swap
  document.getElementById('swap-btn').addEventListener('click', () => {
    stopLiveTracking();
    const tempOrigin = origin;
    const tempDest = destination;
    if (tempOrigin) setDestination(tempOrigin);
    if (tempDest) setOrigin(tempDest);
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    if (traveledRouteLayer) { map.removeLayer(traveledRouteLayer); traveledRouteLayer = null; }
    if (remainingRouteLayer) { map.removeLayer(remainingRouteLayer); remainingRouteLayer = null; }
    document.getElementById('route-info').classList.add('hidden');
    document.getElementById('start-navigation-btn').classList.add('hidden');
    currentRoute = null;
  });

  // Travel modes
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopLiveTracking();
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeMode = btn.dataset.mode;
      if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
      if (traveledRouteLayer) { map.removeLayer(traveledRouteLayer); traveledRouteLayer = null; }
      if (remainingRouteLayer) { map.removeLayer(remainingRouteLayer); remainingRouteLayer = null; }
      document.getElementById('route-info').classList.add('hidden');
      document.getElementById('start-navigation-btn').classList.add('hidden');
      currentRoute = null;
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
