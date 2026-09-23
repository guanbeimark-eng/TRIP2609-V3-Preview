/* ===== Storage Module ===== */
const Storage = (() => {
    const STORAGE_KEY = 'easyItinerary';

    function getAll() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : { trips: [], activeTripId: null };
        } catch {
            return { trips: [], activeTripId: null };
        }
    }

    function saveAll(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        showSaveStatus();
    }

    function showSaveStatus() {
        const el = document.getElementById('saveStatus');
        if (el) {
            el.textContent = 'Saved';
            el.style.color = 'var(--success)';
        }
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    function createTrip(name = 'New Trip') {
        return {
            id: generateId(),
            name,
            startDate: '',
            endDate: '',
            notes: '',
            reservations: [],
            checklist: [],
            days: [],
            expenses: [],
            resources: [],
            budgetTotal: 0,
            budgetCurrency: 'USD',
        };
    }

    function getActiveTrip() {
        const data = getAll();
        if (!data.activeTripId || data.trips.length === 0) {
            // Create default trip
            const trip = createTrip('My Trip');
            data.trips.push(trip);
            data.activeTripId = trip.id;
            saveAll(data);
            return trip;
        }
        return data.trips.find(t => t.id === data.activeTripId) || data.trips[0];
    }

    function saveTrip(trip) {
        const data = getAll();
        const idx = data.trips.findIndex(t => t.id === trip.id);
        if (idx >= 0) {
            data.trips[idx] = trip;
        } else {
            data.trips.push(trip);
        }
        data.activeTripId = trip.id;
        saveAll(data);

        // Auto-sync to server if this trip has been shared
        if (trip.shareId) {
            syncSharedTrip(trip);
        }
    }

    // Debounced sync to avoid flooding the server on rapid edits
    let syncTimer = null;
    function syncSharedTrip(trip) {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
            try {
                const res = await fetch('/api/share', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(trip),
                });
                if (res.ok) {
                    const result = await res.json();
                    // Track our own update so polling doesn't re-download it
                    lastKnownUpdatedAt = result.updatedAt;
                }
            } catch { /* silent fail for background sync */ }
        }, 2000);
    }

    function deleteTrip(tripId) {
        const data = getAll();
        data.trips = data.trips.filter(t => t.id !== tripId);
        if (data.activeTripId === tripId) {
            data.activeTripId = data.trips.length > 0 ? data.trips[0].id : null;
        }
        saveAll(data);
        return data;
    }

    function setActiveTrip(tripId) {
        const data = getAll();
        data.activeTripId = tripId;
        saveAll(data);
    }

    function exportTrip(trip) {
        const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${trip.name.replace(/[^a-z0-9]/gi, '_')}_itinerary.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importTrip(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const trip = JSON.parse(e.target.result);
                    // Assign new ID to avoid conflicts
                    trip.id = generateId();
                    const data = getAll();
                    data.trips.push(trip);
                    data.activeTripId = trip.id;
                    saveAll(data);
                    resolve(trip);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    async function shareTrip(trip) {
        const res = await fetch('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trip),
        });
        if (!res.ok) throw new Error('Share failed');
        const result = await res.json();
        // Persist the shareId on the trip so future shares reuse the same link
        if (!trip.shareId) {
            trip.shareId = result.shareId;
            saveTrip(trip);
        }
        return result;
    }

    async function loadSharedTrip(shareId) {
        const res = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
        if (!res.ok) throw new Error('Shared trip not found');
        const data = await res.json();
        const trip = data.trip;

        // Check if we already have this shared trip locally
        const store = getAll();
        const existing = store.trips.find(t => t.shareId === shareId);
        if (existing) {
            // Update existing local copy with server data
            Object.assign(existing, trip);
            existing.shareId = shareId;
            store.activeTripId = existing.id;
            saveAll(store);
            lastKnownUpdatedAt = data.updatedAt || null;
            return existing;
        }

        // New shared trip — assign new local ID but keep shareId for syncing
        trip.id = generateId();
        trip.shareId = shareId;
        store.trips.push(trip);
        store.activeTripId = trip.id;
        saveAll(store);
        lastKnownUpdatedAt = data.updatedAt || null;
        return trip;
    }

    function checkForSharedTrip() {
        const params = new URLSearchParams(window.location.search);
        return params.get('trip');
    }

    // === Sync polling for collaborative editing ===
    let pollInterval = null;
    let lastKnownUpdatedAt = null;
    let onRemoteUpdateCallback = null;

    function startSyncPolling(trip, onRemoteUpdate) {
        stopSyncPolling();
        if (!trip.shareId) return;

        onRemoteUpdateCallback = onRemoteUpdate;

        pollInterval = setInterval(async () => {
            if (!trip.shareId) return;
            try {
                const res = await fetch(`/api/share/${encodeURIComponent(trip.shareId)}`);
                if (!res.ok) return;
                const data = await res.json();

                // Only update if the server version is newer than what we last saw
                if (data.updatedAt && data.updatedAt !== lastKnownUpdatedAt) {
                    lastKnownUpdatedAt = data.updatedAt;
                    const remoteTrip = data.trip;

                    // Preserve local ID and shareId
                    const localId = trip.id;
                    const shareId = trip.shareId;
                    Object.assign(trip, remoteTrip);
                    trip.id = localId;
                    trip.shareId = shareId;

                    // Save locally without triggering another sync upload
                    const store = getAll();
                    const idx = store.trips.findIndex(t => t.id === trip.id);
                    if (idx >= 0) store.trips[idx] = trip;
                    store.activeTripId = trip.id;
                    saveAll(store);

                    if (onRemoteUpdateCallback) {
                        onRemoteUpdateCallback(trip);
                    }
                }
            } catch {
                /* silent fail for polling */
            }
        }, 5000); // Poll every 5 seconds
    }

    function stopSyncPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    return {
        getAll,
        getActiveTrip,
        saveTrip,
        deleteTrip,
        setActiveTrip,
        createTrip,
        exportTrip,
        importTrip,
        shareTrip,
        loadSharedTrip,
        checkForSharedTrip,
        startSyncPolling,
        stopSyncPolling,
        generateId,
    };
})();
