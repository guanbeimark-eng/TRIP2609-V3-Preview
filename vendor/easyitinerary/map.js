/* ===== Map Module ===== */
const MapModule = (() => {
    let map = null;
    let markers = [];
    let searchMarkers = [];
    let pickMode = false;
    let pickCallback = null;
    let searchTimeout = null;
    let currentTileLayer = null;
    let routeLine = null;
    let routeEnabled = false;
    let showPotentials = false;
    let markerLookup = {};  // key → Leaflet marker, for hover highlighting
    let highlightedKey = null;

    const tileSets = {
        dark: {
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        },
        light: {
            url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        },
        nord: {
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        },
        warm: {
            url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        },
    };

    const categoryIcons = {
        sightseeing: 'fa-camera',
        food: 'fa-utensils',
        transport: 'fa-plane',
        lodging: 'fa-bed',
        activity: 'fa-person-hiking',
        shopping: 'fa-bag-shopping',
        other: 'fa-location-dot',
        restaurant: 'fa-utensils',
        hotel: 'fa-bed',
        general: 'fa-link',
        resource: 'fa-bookmark',
    };

    function init() {
        map = L.map('map', {
            center: [48.8566, 2.3522],
            zoom: 3,
            zoomControl: true,
        });

        // Map tiles — set based on current theme
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        setTileLayer(theme);

        // Click handler for pick-on-map
        map.on('click', (e) => {
            if (pickMode && pickCallback) {
                pickCallback(e.latlng.lat, e.latlng.lng);
                pickMode = false;
                pickCallback = null;
                map.getContainer().style.cursor = '';
            }
        });

        // Ensure map renders correctly after layout
        setTimeout(() => map.invalidateSize(), 100);

        // Initialize search
        initSearch();
    }

    /* ===== Search via Nominatim (OpenStreetMap) ===== */
    function initSearch() {
        const input = document.getElementById('mapSearchInput');
        const clearBtn = document.getElementById('mapSearchClear');
        const resultsEl = document.getElementById('mapSearchResults');

        input.addEventListener('input', () => {
            const query = input.value.trim();
            clearBtn.style.display = query ? 'flex' : 'none';
            if (query.length < 3) {
                resultsEl.innerHTML = '';
                resultsEl.classList.remove('open');
                clearSearchMarkers();
                return;
            }
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => searchPlaces(query), 400);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                input.value = '';
                resultsEl.innerHTML = '';
                resultsEl.classList.remove('open');
                clearBtn.style.display = 'none';
                clearSearchMarkers();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = input.value.trim();
                if (query.length >= 3) searchPlaces(query);
            }
        });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            resultsEl.innerHTML = '';
            resultsEl.classList.remove('open');
            clearBtn.style.display = 'none';
            clearSearchMarkers();
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.map-search-wrapper')) {
                resultsEl.classList.remove('open');
            }
        });

        // Re-open results when focusing input if there are results
        input.addEventListener('focus', () => {
            if (resultsEl.children.length > 0) {
                resultsEl.classList.add('open');
            }
        });
    }

    function searchPlaces(query) {
        const resultsEl = document.getElementById('mapSearchResults');
        resultsEl.innerHTML = '<div class="search-loading"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
        resultsEl.classList.add('open');

        // Photon (by Komoot) — better fuzzy/multilingual search than Nominatim, same OSM data.
        const bounds = map.getBounds();
        const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=en&bbox=${bbox}`;

        fetch(photonUrl)
        .then(res => res.json())
        .then(data => {
            const features = data.features || [];
            // Normalize Photon GeoJSON to our internal format
            const results = features.map(f => {
                const p = f.properties || {};
                const coords = f.geometry.coordinates; // [lng, lat]
                const parts = [p.name, p.street, p.city || p.town || p.village, p.state, p.country].filter(Boolean);
                return {
                    lat: coords[1],
                    lon: coords[0],
                    name: p.name || parts[0] || 'Unknown',
                    display_name: parts.join(', '),
                    type: p.osm_value || '',
                    class: p.osm_key || '',
                    city: p.city || p.town || p.village || '',
                    country: p.country || '',
                };
            });

            if (results.length === 0) {
                // Fallback to Nominatim if Photon found nothing
                return searchNominatim(query);
            }
            displaySearchResults(results);
        })
        .catch(() => {
            // Fallback to Nominatim on Photon failure
            searchNominatim(query);
        });
    }

    function searchNominatim(query) {
        const resultsEl = document.getElementById('mapSearchResults');
        const bounds = map.getBounds();
        const viewbox = `${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}`;
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8&addressdetails=1&viewbox=${viewbox}&bounded=1`;

        fetch(url, { headers: { 'Accept-Language': 'en' } })
        .then(res => res.json())
        .then(results => {
            const normalized = results.map(r => ({
                lat: parseFloat(r.lat),
                lon: parseFloat(r.lon),
                name: r.display_name.split(',')[0],
                display_name: r.display_name,
                type: r.type || '',
                class: r.class || '',
                city: (r.address && (r.address.city || r.address.town || r.address.village)) || '',
                country: (r.address && r.address.country) || '',
            }));
            if (normalized.length === 0) {
                resultsEl.innerHTML = '<div class="search-no-results">No places found</div>';
                return;
            }
            displaySearchResults(normalized);
        })
        .catch(() => {
            resultsEl.innerHTML = '<div class="search-no-results">Search failed — check your connection</div>';
        });
    }

    function displaySearchResults(results) {
        const resultsEl = document.getElementById('mapSearchResults');
        clearSearchMarkers();

        resultsEl.innerHTML = results.map((r, i) => {
            const typeLabel = formatPlaceType(r.type, r.class);
            const addressParts = [r.city, r.country].filter(Boolean).join(', ') || r.display_name.split(',').slice(1, 3).join(',').trim();
            return `
                <div class="search-result-item" data-idx="${i}">
                    <div class="search-result-icon"><i class="fa-solid ${getSearchIcon(r.type, r.class)}"></i></div>
                    <div class="search-result-info">
                        <div class="search-result-name">${escapeHtml(r.name)}</div>
                        <div class="search-result-address">${escapeHtml(addressParts)}</div>
                        ${typeLabel ? `<span class="search-result-type">${escapeHtml(typeLabel)}</span>` : ''}
                    </div>
                    <div class="search-result-actions">
                        <button class="btn btn-sm" title="Add as resource" data-action="add-resource" data-idx="${i}"><i class="fa-solid fa-bookmark"></i></button>
                        <button class="btn btn-sm" title="Show on map" data-action="goto" data-idx="${i}"><i class="fa-solid fa-location-crosshairs"></i></button>
                    </div>
                </div>
            `;
        }).join('');

        // Add search markers to map
        results.forEach((r, i) => {
            const lat = parseFloat(r.lat);
            const lng = parseFloat(r.lon);
            const icon = L.divIcon({
                className: '',
                html: `<div class="search-marker">${i + 1}</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
                popupAnchor: [0, -14],
            });
            const marker = L.marker([lat, lng], { icon }).addTo(map);
            marker.bindPopup(`
                <h4>${escapeHtml(r.name)}</h4>
                <p>${escapeHtml(r.display_name.split(',').slice(1, 3).join(',').trim())}</p>
                <p style="margin-top:6px">
                    <a href="#" onclick="MapModule.addSearchResultAsResource(${i}); return false;">
                        <i class="fa-solid fa-bookmark"></i> Save as resource
                    </a>
                </p>
            `);
            searchMarkers.push(marker);
        });

        // Fit map to search results
        if (searchMarkers.length > 0) {
            const group = L.featureGroup(searchMarkers);
            map.fitBounds(group.getBounds().pad(0.2));
        }

        // Store results for actions
        resultsEl._searchResults = results;

        // Bind click handlers
        resultsEl.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                const result = results[idx];
                if (btn.dataset.action === 'goto') {
                    map.setView([parseFloat(result.lat), parseFloat(result.lon)], 16);
                    searchMarkers[idx]?.openPopup();
                } else if (btn.dataset.action === 'add-resource') {
                    addSearchResultAsResource(idx);
                }
            });
        });

        // Click on result row = go to location
        resultsEl.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.search-result-actions')) return;
                const idx = parseInt(item.dataset.idx);
                const result = results[idx];
                map.setView([parseFloat(result.lat), parseFloat(result.lon)], 16);
                searchMarkers[idx]?.openPopup();
            });
        });
    }

    function addSearchResultAsResource(idx) {
        const resultsEl = document.getElementById('mapSearchResults');
        const results = resultsEl._searchResults;
        if (!results || !results[idx]) return;

        const r = results[idx];
        const category = guessCategory(r.type, r.class);

        // Pre-fill the resource modal
        document.getElementById('resourceTitle').value = r.name || r.display_name.split(',')[0];
        document.getElementById('resourceUrl').value = '';
        document.getElementById('resourceCategory').value = category;
        document.getElementById('resourceNotes').value = r.display_name;
        document.getElementById('resourceLat').value = parseFloat(r.lat).toFixed(6);
        document.getElementById('resourceLng').value = parseFloat(r.lon).toFixed(6);
        document.getElementById('resourceCity').value = r.city || '';

        // Open modal and fetch place details
        Resources.openModal(null, true); // true = skip clearing fields
        Resources.fetchAndApplyDetails(parseFloat(r.lat), parseFloat(r.lon));
        resultsEl.classList.remove('open');
    }

    function clearSearchMarkers() {
        searchMarkers.forEach(m => map.removeLayer(m));
        searchMarkers = [];
    }

    function getSearchIcon(type, cls) {
        if (cls === 'tourism' || type === 'attraction' || type === 'museum') return 'fa-camera';
        if (cls === 'amenity' && (type === 'restaurant' || type === 'cafe' || type === 'fast_food' || type === 'bar' || type === 'pub')) return 'fa-utensils';
        if (type === 'hotel' || type === 'hostel' || type === 'guest_house' || type === 'motel') return 'fa-bed';
        if (cls === 'shop') return 'fa-bag-shopping';
        if (cls === 'highway' || type === 'bus_station' || type === 'railway') return 'fa-train';
        if (type === 'aerodrome' || type === 'airport') return 'fa-plane';
        return 'fa-location-dot';
    }

    function formatPlaceType(type, cls) {
        const labels = {
            restaurant: 'Restaurant', cafe: 'Cafe', bar: 'Bar', pub: 'Pub', fast_food: 'Fast Food',
            hotel: 'Hotel', hostel: 'Hostel', guest_house: 'Guest House', motel: 'Motel',
            museum: 'Museum', attraction: 'Attraction', viewpoint: 'Viewpoint',
            park: 'Park', beach: 'Beach', garden: 'Garden',
            bus_station: 'Bus Station', airport: 'Airport', aerodrome: 'Airport',
            city: 'City', town: 'Town', village: 'Village', suburb: 'Suburb',
        };
        return labels[type] || (cls === 'shop' ? 'Shop' : cls === 'tourism' ? 'Tourism' : '');
    }

    function guessCategory(type, cls) {
        if (type === 'restaurant' || type === 'cafe' || type === 'bar' || type === 'pub' || type === 'fast_food') return 'restaurant';
        if (type === 'hotel' || type === 'hostel' || type === 'guest_house' || type === 'motel') return 'hotel';
        if (cls === 'highway' || type === 'bus_station' || type === 'railway' || type === 'aerodrome' || type === 'airport') return 'transport';
        if (cls === 'tourism' || type === 'museum' || type === 'attraction' || type === 'viewpoint') return 'sightseeing';
        if (cls === 'shop') return 'shopping';
        if (cls === 'leisure' || type === 'park' || type === 'garden' || type === 'beach') return 'activity';
        return 'general';
    }

    /* ===== Core marker functions ===== */
    function createMarkerIcon(category, number) {
        if (number !== undefined && number !== null) {
            return L.divIcon({
                className: '',
                html: `<div class="numbered-marker" style="background: var(--cat-${category}, var(--accent))">${number}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13],
                popupAnchor: [0, -16],
            });
        }
        const iconClass = categoryIcons[category] || 'fa-location-dot';
        return L.divIcon({
            className: '',
            html: `<div class="custom-marker ${category}"><i class="fa-solid ${iconClass}"></i></div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -18],
        });
    }

    function clearMarkers() {
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        markerLookup = {};
        highlightedKey = null;
    }

    function popupUrlDisplay(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'link'; }
    }

    function popupTruncate(str, max) {
        return str && str.length > max ? str.slice(0, max) + '…' : str;
    }

    function addMarker(lat, lng, popupHtml, category, number, opacity, key) {
        const icon = createMarkerIcon(category || 'other', number);
        const marker = L.marker([lat, lng], { icon, opacity: opacity ?? 1 }).addTo(map);
        if (popupHtml) {
            marker.bindPopup(popupHtml, { maxWidth: 280, autoPan: false });
        }
        markers.push(marker);
        if (key) markerLookup[key] = marker;
        return marker;
    }

    function updateMarkers(trip, dayFilter, skipFitBounds) {
        clearMarkers();
        removeRouteLine();
        if (!trip) return;

        // Add activity markers
        let activityNum = 1;
        trip.days.forEach((day, dayIdx) => {
            if (dayFilter !== 'all' && dayFilter !== String(dayIdx)) return;
            day.activities.forEach((act, actIdx) => {
                if (act.lat && act.lng) {
                    const timeStr = act.startTime ? `<p><i class="fa-regular fa-clock"></i> ${act.startTime}${act.endTime ? ' – ' + act.endTime : ''}</p>` : '';
                    const linkStr = act.link ? `<p><a href="${escapeHtml(act.link)}" target="_blank">${escapeHtml(popupUrlDisplay(act.link))} ↗</a></p>` : '';
                    const dayLabel = dayFilter === 'all' ? `<p style="font-size:11px;color:var(--text-muted)">Day ${dayIdx + 1}</p>` : '';
                    const descStr = act.description ? `<p>${escapeHtml(popupTruncate(act.description, 100))}</p>` : '';
                    const popup = `
                        <h4>${escapeHtml(act.title)}</h4>
                        ${dayLabel}
                        ${timeStr}
                        ${descStr}
                        ${act.address ? `<p><i class="fa-solid fa-location-dot"></i> ${escapeHtml(act.address)}</p>` : ''}
                        ${linkStr}
                    `;
                    addMarker(act.lat, act.lng, popup, act.category, activityNum, undefined, `act-${dayIdx}-${actIdx}`);
                    activityNum++;
                }
            });
        });

        // Add lodging endpoint markers (departure/return)
        trip.days.forEach((day, dayIdx) => {
            if (dayFilter !== 'all' && dayFilter !== String(dayIdx)) return;
            const endpoints = [
                { data: day.lodgingDeparture, label: 'Depart', icon: 'fa-right-from-bracket' },
                { data: day.lodgingReturn, label: 'Return', icon: 'fa-right-to-bracket' },
            ];
            endpoints.forEach(({ data, label, icon }) => {
                if (!data || !data.lat || !data.lng) return;
                // Read title fresh from reservation
                let rawTitle = data.title || 'Hotel';
                if (data.reservationIdx !== undefined && trip.reservations && trip.reservations[data.reservationIdx]) {
                    rawTitle = trip.reservations[data.reservationIdx].title || rawTitle;
                }
                const title = escapeHtml(rawTitle);
                const timeStr = data.time ? `<p><i class="fa-regular fa-clock"></i> ${data.time}</p>` : '';
                const popup = `
                    <h4><i class="fa-solid ${icon}"></i> ${label}</h4>
                    <p>${title}</p>
                    ${timeStr}
                `;
                const key = data.resourceId ? `res-${data.resourceId}` : null;
                addMarker(data.lat, data.lng, popup, 'lodging', null, undefined, key);
            });
        });

        // Add resource markers (only when showing all days)
        if (dayFilter === 'all') {
            trip.resources.forEach((res) => {
                const isPotential = res.status === 'potential';
                if (isPotential && !showPotentials) return;
                if (res.lat && res.lng) {
                    const statusLabel = isPotential ? '<p style="font-size:11px;color:var(--text-muted);font-style:italic">Potential</p>' : '';
                    const cityStr = res.city ? `<span style="font-size:11px;color:var(--text-muted)"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(res.city)}</span>` : '';
                    const starsStr = res.stars ? `<p><i class="fa-solid fa-star" style="color:#f5a623"></i> ${escapeHtml(res.stars)}</p>` : '';
                    const cuisineStr = res.cuisine ? `<p><i class="fa-solid fa-utensils"></i> ${escapeHtml(res.cuisine)}</p>` : '';
                    const hoursStr = res.openingHours ? `<p><i class="fa-regular fa-clock"></i> ${escapeHtml(popupTruncate(res.openingHours, 60))}</p>` : '';
                    const phoneStr = res.phone ? `<p><i class="fa-solid fa-phone"></i> ${escapeHtml(res.phone)}</p>` : '';
                    const notesStr = res.notes ? `<p style="color:var(--text-muted);font-size:11px">${escapeHtml(popupTruncate(res.notes, 80))}</p>` : '';
                    const linkStr = res.url ? `<p><a href="${escapeHtml(res.url)}" target="_blank">${escapeHtml(popupUrlDisplay(res.url))} ↗</a></p>` : '';
                    const popup = `
                        <h4>${escapeHtml(res.title)}</h4>
                        ${statusLabel}
                        ${cityStr}
                        ${starsStr}
                        ${cuisineStr}
                        ${hoursStr}
                        ${phoneStr}
                        ${notesStr}
                        ${linkStr}
                    `;
                    addMarker(res.lat, res.lng, popup, res.category, null, isPotential ? 0.45 : undefined, `res-${res.id}`);
                }
            });
        }

        // Draw route line if enabled
        if (routeEnabled) {
            drawRouteLine(trip, dayFilter);
        }

        if (!skipFitBounds) {
            fitBounds();
        }
    }

    function fitBounds() {
        if (markers.length === 0) return;
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }

    function enablePickMode(callback) {
        pickMode = true;
        pickCallback = callback;
        map.getContainer().style.cursor = 'crosshair';
        showToast('Click on the map to pick a location');
    }

    function panTo(lat, lng, zoom) {
        map.setView([lat, lng], zoom || 15);
    }

    function invalidateSize() {
        if (map) map.invalidateSize();
    }

    /* ===== Route line ===== */
    let routeAnimation = null;

    function drawRouteLine(trip, dayFilter) {
        removeRouteLine();
        if (!trip) return;

        const points = [];
        trip.days.forEach((day, dayIdx) => {
            if (dayFilter !== 'all' && dayFilter !== String(dayIdx)) return;
            // Departure point at start of day
            if (day.lodgingDeparture && day.lodgingDeparture.lat && day.lodgingDeparture.lng) {
                points.push([day.lodgingDeparture.lat, day.lodgingDeparture.lng]);
            }
            day.activities.forEach(act => {
                if (act.lat && act.lng) {
                    points.push([act.lat, act.lng]);
                }
            });
            // Return point at end of day
            if (day.lodgingReturn && day.lodgingReturn.lat && day.lodgingReturn.lng) {
                points.push([day.lodgingReturn.lat, day.lodgingReturn.lng]);
            }
        });

        if (points.length < 2) return;

        const theme = document.documentElement.getAttribute('data-theme') || 'warm';
        const colors = { dark: '#4f8cff', light: '#3b6de0', nord: '#88c0d0', warm: '#d97b3d' };
        const color = colors[theme] || '#4f8cff';

        // Base line (faint static trail)
        routeLine = L.polyline(points, {
            color: color,
            weight: 3,
            opacity: 0.25,
        }).addTo(map);

        // Animated overlay with marching dashes
        const animatedLine = L.polyline(points, {
            color: color,
            weight: 3,
            opacity: 0.8,
            dashArray: '12, 16',
            dashOffset: '0',
            className: 'route-line-animated',
        }).addTo(map);

        // Store reference for cleanup
        routeLine._animatedOverlay = animatedLine;

        // Animate dash offset
        let offset = 0;
        routeAnimation = setInterval(() => {
            offset -= 1;
            animatedLine.getElement()?.setAttribute('stroke-dashoffset', offset);
        }, 40);
    }

    function removeRouteLine() {
        if (routeAnimation) {
            clearInterval(routeAnimation);
            routeAnimation = null;
        }
        if (routeLine) {
            if (routeLine._animatedOverlay) {
                map.removeLayer(routeLine._animatedOverlay);
            }
            map.removeLayer(routeLine);
            routeLine = null;
        }
    }

    function toggleRoute() {
        routeEnabled = !routeEnabled;
        const btn = document.getElementById('btnToggleRoute');
        btn.classList.toggle('active', routeEnabled);
        // Re-render markers to add/remove route
        const filter = document.getElementById('mapDayFilter').value;
        const trip = getCurrentTrip();
        if (trip) {
            if (routeEnabled) {
                drawRouteLine(trip, filter);
            } else {
                removeRouteLine();
            }
        }
    }

    function togglePotentials() {
        showPotentials = !showPotentials;
        const btn = document.getElementById('btnTogglePotentials');
        btn.classList.toggle('active', showPotentials);
        const filter = document.getElementById('mapDayFilter').value;
        const trip = getCurrentTrip();
        if (trip) updateMarkers(trip, filter);
    }

    function getCurrentTrip() {
        // Get from Storage since we don't store trip ref in MapModule
        return Storage.getActiveTrip();
    }

    function setTileLayer(theme) {
        const tiles = tileSets[theme] || tileSets.dark;
        if (currentTileLayer) {
            map.removeLayer(currentTileLayer);
        }
        currentTileLayer = L.tileLayer(tiles.url, {
            attribution: tiles.attribution,
            maxZoom: 19,
        }).addTo(map);
    }

    function getMap() {
        return map;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/'/g, '&#39;');
    }

    function highlightMarker(key) {
        clearHighlight();
        const marker = markerLookup[key];
        if (!marker) return;
        highlightedKey = key;
        const el = marker.getElement();
        if (el) el.classList.add('marker-highlight');
        // Only open popup if marker is in view (no panning on hover)
        const latlng = marker.getLatLng();
        if (map.getBounds().contains(latlng)) {
            marker.openPopup();
        }
    }

    function focusMarker(key) {
        const marker = markerLookup[key];
        if (!marker) return;

        // On mobile, expand map if minimized
        const mapPanel = document.querySelector('.right-panel');
        if (mapPanel && mapPanel.classList.contains('map-minimized')) {
            mapPanel.classList.remove('map-minimized');
            const toggle = document.getElementById('mobileMapToggle');
            if (toggle) {
                toggle.classList.remove('flipped');
                toggle.querySelector('span').textContent = 'Map';
            }
            setTimeout(() => {
                invalidateSize();
                map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
                marker.openPopup();
            }, 350);
        }

        clearHighlight();
        highlightedKey = key;
        const el = marker.getElement();
        if (el) el.classList.add('marker-highlight');
        const latlng = marker.getLatLng();
        map.setView(latlng, Math.max(map.getZoom(), 15), { animate: true });
        marker.openPopup();
    }

    function clearHighlight() {
        if (highlightedKey) {
            const prev = markerLookup[highlightedKey];
            if (prev) {
                const el = prev.getElement();
                if (el) el.classList.remove('marker-highlight');
                prev.closePopup();
            }
            highlightedKey = null;
        }
    }

    return {
        init,
        updateMarkers,
        fitBounds,
        clearMarkers,
        addMarker,
        enablePickMode,
        panTo,
        invalidateSize,
        addSearchResultAsResource,
        setTileLayer,
        getMap,
        toggleRoute,
        togglePotentials,
        highlightMarker,
        clearHighlight,
        focusMarker,
    };
})();
