/* ===== Resources Module ===== */
const Resources = (() => {
    let currentTrip = null;
    let editingIdx = null;
    let activeFilter = 'all';
    let activeStatus = 'selected';
    let activeSearch = '';

    const categoryIcons = {
        restaurant: 'fa-utensils',
        hotel: 'fa-bed',
        sightseeing: 'fa-camera',
        transport: 'fa-plane',
        activity: 'fa-person-hiking',
        shopping: 'fa-bag-shopping',
        general: 'fa-link',
    };

    function init(trip) {
        currentTrip = trip;
        bindEvents();
        render();
    }

    function bindEvents() {
        document.getElementById('btnAddResource').addEventListener('click', () => openModal(null));
        document.getElementById('btnSaveResource').addEventListener('click', saveResource);
        document.getElementById('btnFetchFromUrl').addEventListener('click', fetchFromUrl);
        document.getElementById('btnPickResourceLocation').addEventListener('click', () => {
            // Close modal temporarily so user can interact with map
            document.getElementById('resourceModal').classList.remove('open');
            MapModule.enablePickMode((lat, lng) => {
                document.getElementById('resourceLat').value = lat.toFixed(6);
                document.getElementById('resourceLng').value = lng.toFixed(6);
                // Re-open modal
                document.getElementById('resourceModal').classList.add('open');
                showToast('Location picked!');
                // Fetch place details in background
                fetchPlaceDetails(lat, lng).then(details => {
                    if (details) applyPlaceDetails(details);
                });
            });
        });

        // Auto-detect Google Maps URL on paste
        document.getElementById('resourceUrl').addEventListener('paste', () => {
            setTimeout(() => {
                const val = document.getElementById('resourceUrl').value.trim();
                const hint = document.getElementById('resourceUrlHint');
                if (isGoogleMapsUrl(val)) {
                    hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Google Maps link detected — click <strong>Fetch</strong> to extract location data';
                    hint.classList.add('visible');
                } else if (/^https?:\/\//i.test(val)) {
                    hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> URL detected — click <strong>Fetch</strong> to extract details';
                    hint.classList.add('visible');
                } else {
                    hint.classList.remove('visible');
                }
            }, 50);
        });

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeFilter = btn.dataset.filter;
                render();
            });
        });

        document.querySelectorAll('.status-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.status-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeStatus = btn.dataset.status;
                render();
            });
        });

        const searchInput = document.getElementById('resourceSearch');
        const clearBtn = document.getElementById('btnClearResourceSearch');
        searchInput.addEventListener('input', () => {
            activeSearch = searchInput.value.trim().toLowerCase();
            clearBtn.style.display = activeSearch ? '' : 'none';
            render();
        });
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            activeSearch = '';
            clearBtn.style.display = 'none';
            searchInput.focus();
            render();
        });
    }

    function openModal(idx, skipClear) {
        editingIdx = idx;
        pendingDetails = null;
        const modal = document.getElementById('resourceModal');
        document.getElementById('resourceUrlHint').classList.remove('visible');
        document.getElementById('resourceUrlHint').innerHTML = '';

        if (idx !== null && idx !== undefined) {
            const res = currentTrip.resources[idx];
            document.getElementById('resourceTitle').value = res.title || '';
            document.getElementById('resourceUrl').value = res.url || '';
            document.getElementById('resourceCategory').value = res.category || 'general';
            document.getElementById('resourceNotes').value = res.notes || '';
            document.getElementById('resourceLat').value = res.lat || '';
            document.getElementById('resourceLng').value = res.lng || '';
            document.getElementById('resourceCity').value = res.city || '';
        } else if (!skipClear) {
            document.getElementById('resourceTitle').value = '';
            document.getElementById('resourceUrl').value = '';
            document.getElementById('resourceCategory').value = 'general';
            document.getElementById('resourceNotes').value = '';
            document.getElementById('resourceLat').value = '';
            document.getElementById('resourceLng').value = '';
            document.getElementById('resourceCity').value = '';
        }
        modal.classList.add('open');
    }

    function isGoogleMapsUrl(url) {
        return /google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url);
    }

    /* ===== Fetch location data from URL or plain-text place name ===== */
    async function fetchFromUrl() {
        let url = document.getElementById('resourceUrl').value.trim();
        if (!url) {
            showToast('Enter a URL or place name first');
            return;
        }

        const hint = document.getElementById('resourceUrlHint');
        hint.classList.add('visible');

        // Plain-text query — not a URL — run name-based geocoding pipeline
        if (!/^https?:\/\//i.test(url)) {
            const query = url;
            hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching for place...';

            const tripCoords = (() => {
                const pts = [
                    ...(currentTrip.resources || []).filter(r => r.lat && r.lng).map(r => ({ lat: r.lat, lng: r.lng })),
                    ...(currentTrip.days || []).flatMap(d => d.activities.filter(a => a.lat && a.lng).map(a => ({ lat: a.lat, lng: a.lng }))),
                ];
                if (!pts.length) return null;
                return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
            })();

            let found = null;
            try {
                const bias = tripCoords ? `&lat=${tripCoords.lat.toFixed(4)}&lon=${tripCoords.lng.toFixed(4)}` : '';
                const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en${bias}`);
                const d = await r.json();
                const f = d.features?.[0];
                if (f) found = { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name: f.properties?.name };
            } catch {}

            if (!found) {
                try {
                    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
                        headers: { 'Accept-Language': 'en', 'User-Agent': 'EasyItinerary/1.0' },
                    });
                    const d = await r.json();
                    if (d.length) found = { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), name: d[0].display_name?.split(',')[0] };
                } catch {}
            }

            if (found) {
                document.getElementById('resourceLat').value = found.lat.toFixed(6);
                document.getElementById('resourceLng').value = found.lng.toFixed(6);
                if (!document.getElementById('resourceTitle').value.trim() && found.name) {
                    document.getElementById('resourceTitle').value = found.name;
                }
                hint.innerHTML = `<i class="fa-solid fa-check"></i> Found: <strong>${escapeHtml(found.name || query)}</strong>`;
                fetchPlaceDetails(found.lat, found.lng).then(details => { if (details) applyPlaceDetails(details); });
                return;
            }

            // Geocoding failed — try POI server with a Google Search URL as the query
            if (poiServerAvailable) {
                const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
                document.getElementById('resourceUrl').value = searchUrl;
                if (!document.getElementById('resourceTitle').value.trim()) {
                    document.getElementById('resourceTitle').value = query;
                }
                hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching with AI...';
                try {
                    const submitRes = await fetch('/api/poi', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: searchUrl }),
                    });
                    const { jobId } = await submitRes.json();
                    const res = (currentTrip.resources || []).find(r => r.id === document.getElementById('resourceUrl').dataset.editingId);
                    if (res) {
                        res.pendingPoiJobId = jobId;
                        Storage.saveTrip(currentTrip);
                        startPoiPolling();
                    }
                    hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> AI is searching — save now, details will fill in automatically.';
                } catch {
                    hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> Not found — try a more specific name or add a country/city.';
                }
                setTimeout(() => hint.classList.remove('visible'), 6000);
            } else {
                hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> Not found — try adding a city name, or use Pick on Map.';
                setTimeout(() => hint.classList.remove('visible'), 5000);
            }
            return;
        }

        hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extracting location data...';

        // Resolve short URLs (goo.gl/maps, maps.app.goo.gl) server-side
        if (/goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url)) {
            hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resolving short link...';
            try {
                const r = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`);
                if (r.ok) {
                    const resolved = await r.json();
                    // Strip tracking query params — everything useful is in the path + data= segment
                    url = resolved.url.includes('google.') ? resolved.url.split('?')[0] : resolved.url;
                    document.getElementById('resourceUrl').value = url;
                } else {
                    hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> Could not expand short link — try pasting the full Google Maps URL instead.';
                    setTimeout(() => hint.classList.remove('visible'), 5000);
                    return;
                }
            } catch {
                hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> Short link resolution requires the server. Open via <code>node server.js</code>.';
                setTimeout(() => hint.classList.remove('visible'), 5000);
                return;
            }
            hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extracting location data...';
        }

        // Extract from Google Maps URL
        if (isGoogleMapsUrl(url)) {
            const data = extractGoogleMapsData(url);
            if (data.lat && data.lng) {
                document.getElementById('resourceLat').value = data.lat;
                document.getElementById('resourceLng').value = data.lng;

                if (data.name && !document.getElementById('resourceTitle').value.trim()) {
                    document.getElementById('resourceTitle').value = data.name;
                }

                // Show success immediately — user can save right away
                const displayName = data.name || 'Location';
                hint.innerHTML = `<i class="fa-solid fa-check"></i> Found: <strong>${escapeHtml(displayName)}</strong>`;

                // Enrich in background via OSM
                if (!data.name) {
                    reverseGeocode(data.lat, data.lng).then(info => {
                        if (info && !document.getElementById('resourceTitle').value.trim()) {
                            document.getElementById('resourceTitle').value = info.name || info.display_name.split(',')[0];
                        }
                    });
                }
                fetchPlaceDetails(data.lat, data.lng).then(details => {
                    if (details) applyPlaceDetails(details);
                });
                return;
            }

            // URL has a place name but no coordinates (CID-based URL from mobile share)
            if (data.name) {
                hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching for location...';
                if (!document.getElementById('resourceTitle').value.trim()) {
                    document.getElementById('resourceTitle').value = data.name;
                }

                // Derive a location bias from existing trip resources/activities
                const tripCoords = (() => {
                    const pts = [
                        ...(currentTrip.resources || []).filter(r => r.lat && r.lng).map(r => ({ lat: r.lat, lng: r.lng })),
                        ...(currentTrip.days || []).flatMap(d => d.activities.filter(a => a.lat && a.lng).map(a => ({ lat: a.lat, lng: a.lng }))),
                    ];
                    if (!pts.length) return null;
                    return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
                })();

                // Photon: place-name geocoder with optional location bias — better than Nominatim for ambiguous names
                const photonGeocode = async (q) => {
                    const bias = tripCoords ? `&lat=${tripCoords.lat.toFixed(4)}&lon=${tripCoords.lng.toFixed(4)}` : '';
                    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=en${bias}`);
                    const d = await r.json();
                    const f = d.features?.[0];
                    if (!f) return null;
                    return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
                };

                // Nominatim: more reliable for structured addresses
                const nominatimGeocode = async (q) => {
                    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`, {
                        headers: { 'Accept-Language': 'en', 'User-Agent': 'EasyItinerary/1.0' },
                    });
                    const d = await r.json();
                    if (!d.length) return null;
                    return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
                };

                let found = null;
                try { found = await photonGeocode(data.name); } catch {}
                if (!found) { try { found = await nominatimGeocode(data.name); } catch {} }

                if (found) {
                    document.getElementById('resourceLat').value = found.lat.toFixed(6);
                    document.getElementById('resourceLng').value = found.lng.toFixed(6);
                    hint.innerHTML = `<i class="fa-solid fa-check"></i> Found: <strong>${escapeHtml(data.name)}</strong>${tripCoords ? ' (location bias applied)' : ''}`;
                    fetchPlaceDetails(found.lat, found.lng).then(details => {
                        if (details) applyPlaceDetails(details);
                    });
                    return;
                }

                hint.innerHTML = poiServerAvailable
                    ? '<i class="fa-solid fa-circle-info"></i> Save this resource then use <i class="fa-solid fa-wand-magic-sparkles"></i> Enhance — AI will find the coordinates.'
                    : '<i class="fa-solid fa-circle-info"></i> Could not locate automatically — use Pick on Map to add coordinates.';
                setTimeout(() => hint.classList.remove('visible'), 6000);
                return;
            }
        }

        // Non-Google URL — guide user based on what's available
        if (poiServerAvailable) {
            hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> No map link detected. Save this resource then click <i class="fa-solid fa-wand-magic-sparkles"></i> to extract details with AI.';
        } else {
            hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> No location data found. Use "Pick on Map" to add coordinates.';
        }
        setTimeout(() => hint.classList.remove('visible'), 6000);
    }

    /* ===== Enhanced Google Maps extraction ===== */
    function extractGoogleMapsData(url) {
        const result = { lat: null, lng: null, name: null };

        // Extract place name from URL path: /place/Place+Name/@lat,lng
        const placeNameMatch = url.match(/\/place\/([^/@]+)/);
        if (placeNameMatch) {
            result.name = decodeURIComponent(placeNameMatch[1].replace(/\+/g, ' '));
        }

        // Extract coordinates — !3d!4d is the pinned POI location, @lat,lng is just the viewport center
        const coordPatterns = [
            /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,       // !3dlat!4dlng — actual POI pin (highest priority)
            /place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/,      // place/lat,lng
            /q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,           // q=lat,lng
            /ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/,          // ll=lat,lng
            /center=(-?\d+\.?\d*),(-?\d+\.?\d*)/,      // center=lat,lng
            /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,            // @lat,lng — viewport center (fallback only)
        ];

        for (const pattern of coordPatterns) {
            const match = url.match(pattern);
            if (match) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[2]);
                // Sanity check coordinates
                if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    result.lat = lat.toFixed(6);
                    result.lng = lng.toFixed(6);
                    break;
                }
            }
        }

        // Try extracting search query as name fallback
        if (!result.name) {
            const searchMatch = url.match(/[?&]q=([^&@]+)/);
            if (searchMatch) {
                const decoded = decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));
                // Only use if it's not just coordinates
                if (!/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(decoded)) {
                    result.name = decoded;
                }
            }
        }

        return result;
    }

    function extractGoogleMapsCoords(url) {
        const data = extractGoogleMapsData(url);
        if (data.lat && data.lng) {
            return { lat: parseFloat(data.lat), lng: parseFloat(data.lng) };
        }
        return null;
    }

    /* ===== Reverse geocode via Nominatim ===== */
    function reverseGeocode(lat, lng) {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        return fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`, {
            headers: { 'Accept-Language': 'en' },
            signal: controller.signal,
        })
        .then(res => res.json())
        .catch(() => null);
    }

    /* ===== Resolve city from coordinates (fallback) ===== */
    function resolveCityFromCoords(lat, lng) {
        return reverseGeocode(lat, lng).then(data => {
            if (!data || !data.address) return '';
            const a = data.address;
            return a.city || a.town || a.village || a.municipality || a.county || '';
        });
    }

    function resolveMissingCities() {
        if (!currentTrip || !currentTrip.resources) return;
        const pending = currentTrip.resources.filter(r => r.lat && r.lng && !r.city);
        if (pending.length === 0) return;
        // Resolve sequentially with small delay to respect Nominatim rate limits
        let i = 0;
        function next() {
            if (i >= pending.length) return;
            const res = pending[i++];
            resolveCityFromCoords(res.lat, res.lng).then(city => {
                if (city) {
                    res.city = city;
                    Storage.saveTrip(currentTrip);
                    render();
                    Itinerary.render();
                }
                setTimeout(next, 1100); // Nominatim: max 1 req/s
            });
        }
        next();
    }

    /* ===== AI enhance — background polling ===== */
    let poiServerAvailable = false;
    let poiPollInterval = null;
    const poiPollFailures = {}; // jobId -> consecutive failure count
    const POI_MAX_FAILURES = 30; // ~5 minutes of failures before giving up

    async function applyPOIResult(res, poi) {
        const catMap = { food: 'restaurant', restaurant: 'restaurant', hotel: 'hotel', lodging: 'hotel', sightseeing: 'sightseeing', shopping: 'shopping' };
        if (poi.name) res.title = poi.name;
        if (poi.address) res.notes = poi.address;
        if (poi.city) res.city = poi.city;
        if (poi.phone) res.phone = poi.phone;
        if (poi.opening_hours) res.openingHours = poi.opening_hours;
        if (poi.cuisine) res.cuisine = poi.cuisine;
        if (poi.rating) res.stars = poi.rating + (poi.review_count ? ` (${poi.review_count})` : '');
        if (poi.website && !res.url.includes('google')) res.url = poi.website;
        if (poi.category) {
            const mapped = catMap[poi.category];
            if (mapped && (!res.category || res.category === 'general')) res.category = mapped;
        }
        // Apply coordinates if the AI found them and the resource doesn't already have them
        if (poi.lat && poi.lng && !res.lat) {
            const lat = parseFloat(poi.lat), lng = parseFloat(poi.lng);
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                res.lat = parseFloat(lat.toFixed(6));
                res.lng = parseFloat(lng.toFixed(6));
            }
        }
        // If still no coordinates but we have an address, geocode it — far more reliable than name search
        if (!res.lat && poi.address) {
            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(poi.address)}&format=json&limit=1`, {
                    headers: { 'Accept-Language': 'en', 'User-Agent': 'EasyItinerary/1.0' },
                });
                const results = await r.json();
                if (results.length) {
                    res.lat = parseFloat(parseFloat(results[0].lat).toFixed(6));
                    res.lng = parseFloat(parseFloat(results[0].lon).toFixed(6));
                }
            } catch {}
        }
        delete res.pendingPoiJobId;
    }

    async function pollPendingJobs() {
        if (!currentTrip) return;
        const pending = (currentTrip.resources || []).filter(r => r.pendingPoiJobId);

        // Nothing left — stop the interval
        if (pending.length === 0) {
            clearInterval(poiPollInterval);
            poiPollInterval = null;
            return;
        }

        let changed = false;
        for (const res of pending) {
            const jobId = res.pendingPoiJobId;
            try {
                const r = await fetch(`/api/poi/${jobId}`);
                if (!r.ok) {
                    // Count failures — clear stuck jobs after too many (e.g. server restarted, job lost)
                    poiPollFailures[jobId] = (poiPollFailures[jobId] || 0) + 1;
                    if (poiPollFailures[jobId] >= POI_MAX_FAILURES) {
                        console.warn('[POI] Giving up on job', jobId, 'after too many failures');
                        delete res.pendingPoiJobId;
                        delete poiPollFailures[jobId];
                        changed = true;
                        showToast(`AI extraction timed out for: ${res.title}`);
                    }
                    continue;
                }
                poiPollFailures[jobId] = 0; // reset on success
                const data = await r.json();
                if (data.status === 'done' && data.result) {
                    await applyPOIResult(res, data.result);
                    delete poiPollFailures[jobId];
                    changed = true;
                    showToast(`Enhanced: ${res.title}`);
                } else if (data.status === 'error') {
                    console.warn('[POI] Job failed:', jobId, data.error);
                    delete res.pendingPoiJobId;
                    delete poiPollFailures[jobId];
                    changed = true;
                    showToast(`AI extraction failed for: ${res.title}`);
                }
                // queued/running — leave pendingPoiJobId, try again next tick
            } catch (e) {
                console.warn('[POI] Poll error:', e);
            }
        }

        if (changed) {
            Storage.saveTrip(currentTrip);
            render();
        }
    }

    function startPoller() {
        if (poiPollInterval) return; // already running
        pollPendingJobs(); // fire immediately, don't wait for first interval tick
        poiPollInterval = setInterval(pollPendingJobs, 10000);
    }

    // On init: check if POI server is available, show buttons + resume any pending jobs
    fetch('/api/poi/health').then(r => r.ok ? r.json() : null).then(d => {
        if (d && d.status === 'ok') {
            poiServerAvailable = true;
            if (currentTrip) render();
            // Resume polling for any jobs pending before a page refresh
            if ((currentTrip?.resources || []).some(r => r.pendingPoiJobId)) startPoller();
        }
    }).catch(() => {});

    async function enhanceWithAI(idx) {
        const res = currentTrip.resources[idx];
        if (!res || !res.url) return;
        if (res.pendingPoiJobId) { showToast('Already extracting...'); return; }

        try {
            const submitRes = await fetch('/api/poi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: res.url, lat: res.lat || null, lng: res.lng || null }),
            });
            if (!submitRes.ok) throw new Error();
            const { jobId } = await submitRes.json();
            res.pendingPoiJobId = jobId;
            Storage.saveTrip(currentTrip);
            render(); // shows spinner on button immediately
            startPoller();
        } catch {
            showToast('POI server unavailable');
        }
    }

    /* ===== Fetch place details from Overpass (OSM tags) ===== */
    function fetchPlaceDetails(lat, lng) {
        // Query nearby POIs within ~30m radius for tags like opening_hours, phone, cuisine, etc.
        const radius = 30;
        const query = `
            [out:json][timeout:10];
            (
                nwr(around:${radius},${lat},${lng})["name"];
            );
            out tags center 1;
        `;
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 8000); // 8s timeout
        return fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal,
        })
        .then(res => res.json())
        .then(data => {
            if (!data.elements || data.elements.length === 0) return null;
            // Pick the most relevant element (prefer the one with the most tags)
            const best = data.elements.reduce((a, b) =>
                Object.keys(b.tags || {}).length > Object.keys(a.tags || {}).length ? b : a
            );
            const t = best.tags || {};
            return {
                phone: t.phone || t['contact:phone'] || '',
                website: t.website || t['contact:website'] || '',
                openingHours: t.opening_hours || '',
                cuisine: t.cuisine ? t.cuisine.replace(/;/g, ', ') : '',
                address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ')
                    + (t['addr:city'] ? ', ' + t['addr:city'] : ''),
                stars: t.stars || '',
                internetAccess: t.internet_access || '',
                wheelchair: t.wheelchair || '',
                osmType: t.tourism || t.amenity || t.shop || '',
                city: t['addr:city'] || '',
            };
        })
        .catch(() => null);
    }

    function applyPlaceDetails(details) {
        if (!details) return;
        const hint = document.getElementById('resourceUrlHint');
        const parts = [];
        if (details.cuisine) parts.push(`<i class="fa-solid fa-utensils"></i> ${escapeHtml(details.cuisine)}`);
        if (details.openingHours) parts.push(`<i class="fa-regular fa-clock"></i> ${escapeHtml(details.openingHours)}`);
        if (details.phone) parts.push(`<i class="fa-solid fa-phone"></i> ${escapeHtml(details.phone)}`);
        if (details.stars) parts.push(`<i class="fa-solid fa-star"></i> ${escapeHtml(details.stars)} stars`);
        if (details.website && !document.getElementById('resourceUrl').value.trim()) {
            document.getElementById('resourceUrl').value = details.website;
        }
        if (details.address && !document.getElementById('resourceNotes').value.trim()) {
            document.getElementById('resourceNotes').value = details.address;
        }
        if (details.city && !document.getElementById('resourceCity').value.trim()) {
            document.getElementById('resourceCity').value = details.city;
        } else if (!details.city && !document.getElementById('resourceCity').value.trim()) {
            // Fallback: reverse geocode to get city from coordinates
            const lat = parseFloat(document.getElementById('resourceLat').value);
            const lng = parseFloat(document.getElementById('resourceLng').value);
            if (lat && lng) {
                resolveCityFromCoords(lat, lng).then(city => {
                    if (city && !document.getElementById('resourceCity').value.trim()) {
                        document.getElementById('resourceCity').value = city;
                        if (pendingDetails) pendingDetails.city = city;
                    }
                });
            }
        }
        // Auto-detect category from OSM type
        if (document.getElementById('resourceCategory').value === 'general' && details.osmType) {
            const cat = guessCategoryFromOsm(details.osmType);
            if (cat) document.getElementById('resourceCategory').value = cat;
        }
        if (parts.length > 0) {
            hint.innerHTML = `<div class="place-details-preview">${parts.join('<span class="detail-sep">·</span>')}</div>`;
            hint.classList.add('visible');
        }
        // Store on a temp property so saveResource can grab it
        pendingDetails = details;
    }

    let pendingDetails = null;

    function guessCategoryFromOsm(osmType) {
        const map = {
            restaurant: 'restaurant', cafe: 'restaurant', bar: 'restaurant', pub: 'restaurant', fast_food: 'restaurant',
            hotel: 'hotel', hostel: 'hotel', guest_house: 'hotel', motel: 'hotel',
            museum: 'sightseeing', attraction: 'sightseeing', viewpoint: 'sightseeing', artwork: 'sightseeing',
            supermarket: 'shopping', clothes: 'shopping', mall: 'shopping',
        };
        return map[osmType] || null;
    }

    function saveResource() {
        const title = document.getElementById('resourceTitle').value.trim();
        if (!title) {
            document.getElementById('resourceTitle').focus();
            return;
        }

        const url = document.getElementById('resourceUrl').value.trim();
        let lat = parseFloat(document.getElementById('resourceLat').value) || null;
        let lng = parseFloat(document.getElementById('resourceLng').value) || null;

        // Try to extract coords from Google Maps URL
        if (url && !lat && !lng) {
            const coords = extractGoogleMapsCoords(url);
            if (coords) {
                lat = coords.lat;
                lng = coords.lng;
            }
        }

        const resource = {
            id: editingIdx !== null ? currentTrip.resources[editingIdx].id : Storage.generateId(),
            title,
            url,
            category: document.getElementById('resourceCategory').value,
            notes: document.getElementById('resourceNotes').value,
            lat,
            lng,
            status: editingIdx !== null ? (currentTrip.resources[editingIdx].status || 'selected') : activeStatus,
            city: document.getElementById('resourceCity').value || (editingIdx !== null ? currentTrip.resources[editingIdx].city || '' : ''),
        };

        // Merge in place details if we fetched them
        if (pendingDetails) {
            if (pendingDetails.phone) resource.phone = pendingDetails.phone;
            if (pendingDetails.openingHours) resource.openingHours = pendingDetails.openingHours;
            if (pendingDetails.cuisine) resource.cuisine = pendingDetails.cuisine;
            if (pendingDetails.stars) resource.stars = pendingDetails.stars;
            pendingDetails = null;
        } else if (editingIdx !== null) {
            // Preserve existing details on edit
            const existing = currentTrip.resources[editingIdx];
            if (existing.phone) resource.phone = existing.phone;
            if (existing.openingHours) resource.openingHours = existing.openingHours;
            if (existing.cuisine) resource.cuisine = existing.cuisine;
            if (existing.stars) resource.stars = existing.stars;
        }

        if (editingIdx !== null) {
            currentTrip.resources[editingIdx] = resource;
        } else {
            currentTrip.resources.push(resource);
        }

        Storage.saveTrip(currentTrip);
        document.getElementById('resourceModal').classList.remove('open');
        editingIdx = null;

        // Propagate changes to linked activities, reservations, endpoints
        syncFromResources();

        render();
        App.updateStats();
        Itinerary.render();
        App.renderReservations();
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);

        // Resolve city in background if missing
        if (resource.lat && resource.lng && !resource.city) {
            resolveCityFromCoords(resource.lat, resource.lng).then(city => {
                if (city) {
                    resource.city = city;
                    Storage.saveTrip(currentTrip);
                    render();
                    Itinerary.render();
                }
            });
        }
    }

    function syncFromResources() {
        if (!currentTrip) return;
        const resources = currentTrip.resources || [];
        let changed = false;

        // Sync activities linked to resources
        (currentTrip.days || []).forEach(day => {
            (day.activities || []).forEach(act => {
                if (!act.linkedResourceId) return;
                const res = resources.find(r => r.id === act.linkedResourceId);
                if (!res) return;
                if (res.title && act.title !== res.title) { act.title = res.title; changed = true; }
                if (res.lat && act.lat !== res.lat) { act.lat = res.lat; changed = true; }
                if (res.lng && act.lng !== res.lng) { act.lng = res.lng; changed = true; }
                if (res.notes && act.address !== res.notes) { act.address = res.notes; changed = true; }
                if (res.url && act.link !== res.url) { act.link = res.url; changed = true; }
            });

            // Sync lodging endpoints
            ['lodgingDeparture', 'lodgingReturn'].forEach(key => {
                const ep = day[key];
                if (!ep || !ep.resourceId) return;
                const res = resources.find(r => r.id === ep.resourceId);
                if (!res) return;
                if (res.lat && ep.lat !== res.lat) { ep.lat = res.lat; changed = true; }
                if (res.lng && ep.lng !== res.lng) { ep.lng = res.lng; changed = true; }
            });
        });

        // Sync reservations linked to resources
        (currentTrip.reservations || []).forEach(rev => {
            if (!rev.linkedResourceId) return;
            const res = resources.find(r => r.id === rev.linkedResourceId);
            if (!res) return;
            if (res.title && rev.title !== res.title) { rev.title = res.title; changed = true; }
        });

        // Also sync lodging endpoint titles from their reservations
        (currentTrip.days || []).forEach(day => {
            ['lodgingDeparture', 'lodgingReturn'].forEach(key => {
                const ep = day[key];
                if (!ep || ep.reservationIdx === undefined) return;
                const rev = currentTrip.reservations[ep.reservationIdx];
                if (rev && ep.title !== rev.title) { ep.title = rev.title; changed = true; }
            });
        });

        if (changed) {
            Storage.saveTrip(currentTrip);
        }
        return changed;
    }

    function deleteResource(idx) {
        if (!confirm('Delete this link?')) return;
        currentTrip.resources.splice(idx, 1);
        Storage.saveTrip(currentTrip);
        render();
        App.updateStats();
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
    }

    function toggleStatus(idx) {
        const res = currentTrip.resources[idx];
        if (!res) return;
        res.status = (res.status || 'selected') === 'selected' ? 'potential' : 'selected';
        Storage.saveTrip(currentTrip);
        render();
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
    }

    function getResourceDays(resId) {
        if (!currentTrip.days || !resId) return [];
        return currentTrip.days
            .map((day, i) => ({ idx: i, label: day.label ? `Day ${i + 1} — ${day.label}` : `Day ${i + 1}` }))
            .filter((_, i) => (currentTrip.days[i].activities || []).some(a => a.linkedResourceId === resId));
    }

    function addResourceToDay(resIdx, dayIdx) {
        const res = currentTrip.resources[resIdx];
        const day = currentTrip.days?.[dayIdx];
        if (!res || !day) return;
        if ((day.activities || []).some(a => a.linkedResourceId === res.id)) {
            showToast(`Already in Day ${dayIdx + 1}`); return;
        }
        if (!day.activities) day.activities = [];
        day.activities.push({
            title: res.title,
            category: res.category || 'general',
            lat: res.lat || null,
            lng: res.lng || null,
            link: res.url || '',
            address: res.address || '',
            description: res.notes || '',
            linkedResourceId: res.id || null,
        });
        Storage.saveTrip(currentTrip);
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
        render();
        showToast(`Added "${res.title}" to Day ${dayIdx + 1}`);
    }

    function render() {
        const container = document.getElementById('resourcesList');
        let resources = currentTrip.resources || [];

        // Filter by status
        resources = resources.filter(r => (r.status || 'selected') === activeStatus);

        if (activeFilter !== 'all') {
            resources = resources.filter(r => r.category === activeFilter);
        }

        if (activeSearch) {
            resources = resources.filter(r =>
                (r.title || '').toLowerCase().includes(activeSearch) ||
                (r.notes || '').toLowerCase().includes(activeSearch) ||
                (r.city  || '').toLowerCase().includes(activeSearch)
            );
        }

        // Update tab counts
        const allResources = currentTrip.resources || [];
        const selectedCount = allResources.filter(r => (r.status || 'selected') === 'selected').length;
        const potentialCount = allResources.filter(r => r.status === 'potential').length;
        document.querySelectorAll('.status-tab').forEach(tab => {
            const count = tab.dataset.status === 'selected' ? selectedCount : potentialCount;
            const label = tab.dataset.status === 'selected' ? 'Selected' : 'Potentials';
            const icon = tab.dataset.status === 'selected' ? '<i class="fa-solid fa-check-circle"></i>' : '<i class="fa-regular fa-lightbulb"></i>';
            tab.innerHTML = `${icon} ${label} <span class="status-count">${count}</span>`;
        });

        if (resources.length === 0) {
            const emptyMsg = activeStatus === 'potential'
                ? 'No potential resources yet. Add places you\'re considering.'
                : (activeFilter === 'all' ? 'No selected resources yet.' : 'No selected resources in this category.');
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-bookmark"></i>
                    <p>${emptyMsg}</p>
                    <button class="btn btn-small" onclick="Resources.openModal(null)"><i class="fa-solid fa-plus"></i> Add Link</button>
                </div>
            `;
            return;
        }

        const isPotential = activeStatus === 'potential';
        container.innerHTML = resources.map((res) => {
            const realIdx = currentTrip.resources.indexOf(res);
            const iconClass = categoryIcons[res.category] || 'fa-link';
            let urlDisplay = '';
            try { urlDisplay = res.url ? new URL(res.url).hostname : ''; } catch(e) { urlDisplay = res.url || ''; }
            const detailTags = [];
            if (res.cuisine) detailTags.push(`<span class="resource-detail"><i class="fa-solid fa-utensils"></i> ${escapeHtml(res.cuisine)}</span>`);
            if (res.openingHours) detailTags.push(`<span class="resource-detail"><i class="fa-regular fa-clock"></i> ${escapeHtml(res.openingHours)}</span>`);
            if (res.phone) detailTags.push(`<span class="resource-detail"><i class="fa-solid fa-phone"></i> ${escapeHtml(res.phone)}</span>`);
            if (res.stars) detailTags.push(`<span class="resource-detail"><i class="fa-solid fa-star"></i> ${escapeHtml(res.stars)} stars</span>`);

            const statusBtn = isPotential
                ? `<button title="Move to selected" onclick="Resources.toggleStatus(${realIdx})"><i class="fa-solid fa-check-circle"></i></button>`
                : `<button title="Move to potentials" onclick="Resources.toggleStatus(${realIdx})"><i class="fa-regular fa-lightbulb"></i></button>`;

            const linkedDays = getResourceDays(res.id);
            const dayBadge = linkedDays.length
                ? `<span class="day-plan-badge"><i class="fa-solid fa-calendar-check"></i> ${linkedDays.map(d => d.label).join(', ')}</span>`
                : '';

            const addToDayControl = !isPotential && currentTrip.days?.length
                ? `<select class="add-to-day-select" title="Add to day plan" onchange="Resources.addResourceToDay(${realIdx}, parseInt(this.value)); this.value=''">
                    <option value="">&#128197; Add to day…</option>
                    ${(currentTrip.days).map((d, i) => `<option value="${i}">Day ${i + 1}${d.label ? ' — ' + escapeHtml(d.label) : ''}</option>`).join('')}
                   </select>`
                : '';

            return `
                <div class="resource-card ${isPotential ? 'potential' : ''}" data-marker-key="${res.id ? 'res-' + res.id : ''}">
                    <div class="resource-icon ${res.category}">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                    <div class="resource-info">
                        <h4>${res.url ? `<a href="${escapeHtml(res.url)}" target="_blank">${escapeHtml(res.title)}</a>` : escapeHtml(res.title)}${res.city ? `<span class="location-label"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(res.city)}</span>` : ''}</h4>
                        ${res.url ? `<span class="resource-url">${escapeHtml(urlDisplay)}</span>` : ''}
                        ${detailTags.length ? `<div class="resource-details">${detailTags.join('')}</div>` : ''}
                        ${res.notes ? `<div class="resource-notes">${escapeHtml(res.notes)}</div>` : ''}
                        ${dayBadge}
                    </div>
                    <div class="resource-actions">
                        ${statusBtn}
                        ${res.lat && res.lng ? `<button title="Show on map" onclick="MapModule.panTo(${res.lat}, ${res.lng}, 16)"><i class="fa-solid fa-map-location-dot"></i></button>` : ''}
                        ${poiServerAvailable && res.url ? (res.pendingPoiJobId
                            ? `<button class="poi-enhance-btn" title="Extracting..." disabled><i class="fa-solid fa-spinner fa-spin"></i></button>`
                            : `<button class="poi-enhance-btn" title="Enhance with AI" onclick="Resources.enhanceWithAI(${realIdx})"><i class="fa-solid fa-wand-magic-sparkles"></i></button>`
                        ) : ''}
                        ${res.url ? `<button title="Copy URL" onclick="Resources.copyUrl('${escapeHtml(res.url)}')"><i class="fa-solid fa-copy"></i></button>` : ''}
                        <button title="Edit" onclick="Resources.openModal(${realIdx})"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn-delete" title="Delete" onclick="Resources.deleteResource(${realIdx})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    ${addToDayControl ? `<div class="add-to-day-row">${addToDayControl}</div>` : ''}
                </div>
            `;
        }).join('');

        // Wire hover-to-highlight and click-to-focus for resource cards
        container.querySelectorAll('.resource-card[data-marker-key]').forEach(card => {
            card.addEventListener('mouseenter', () => {
                const key = card.dataset.markerKey;
                if (key) MapModule.highlightMarker(key);
            });
            card.addEventListener('mouseleave', () => {
                MapModule.clearHighlight();
            });
            card.addEventListener('click', (e) => {
                if (e.target.closest('.resource-actions') || e.target.closest('a')) return;
                const key = card.dataset.markerKey;
                if (key) MapModule.focusMarker(key);
            });
        });
    }

    function copyUrl(url) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('URL copied to clipboard');
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/'/g, '&#39;');
    }

    function update(trip) {
        currentTrip = trip;
        render();
    }

    function fetchAndApplyDetails(lat, lng) {
        // Background fetch — no spinner, just enriches if found
        fetchPlaceDetails(lat, lng).then(details => {
            if (details) applyPlaceDetails(details);
        });
    }

    return {
        init,
        update,
        render,
        openModal,
        saveResource,
        deleteResource,
        copyUrl,
        fetchAndApplyDetails,
        toggleStatus,
        resolveMissingCities,
        syncFromResources,
        enhanceWithAI,
        addResourceToDay,
    };
})();
