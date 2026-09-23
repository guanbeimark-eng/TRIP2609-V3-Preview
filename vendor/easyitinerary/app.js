/* ===== Main App Module ===== */
const App = (() => {
    let currentTrip = null;

    async function init() {
        // Apply saved theme before anything renders
        initTheme();

        // Check for shared trip in URL
        const shareId = Storage.checkForSharedTrip();
        if (shareId) {
            try {
                currentTrip = await Storage.loadSharedTrip(shareId);
                showToast(`Joined shared trip: ${currentTrip.name}`);
                // Keep ?trip= in URL so refresh reconnects
            } catch {
                showToast('Shared trip not found');
                currentTrip = Storage.getActiveTrip();
            }
        } else {
            currentTrip = Storage.getActiveTrip();
        }

        // Start sync polling if this trip is shared
        if (currentTrip.shareId) {
            Storage.startSyncPolling(currentTrip, (updatedTrip) => {
                currentTrip = updatedTrip;
                reloadAll();
                showToast('Trip updated by collaborator');
            });
        }

        // Init all modules
        MapModule.init();
        Itinerary.init(currentTrip);
        Budget.init(currentTrip);
        Resources.init(currentTrip);
        Weather.init(currentTrip);

        // Populate UI
        populateTripSelector();
        loadTripData();
        setupNavigation();
        setupOverview();
        setupTopBar();
        setupModals();
        setupThemePicker();
        anchorDateInputsToTrip();
        updateStats();
        MapModule.updateMarkers(currentTrip, 'all');

        // Resolve missing city labels in background
        Resources.resolveMissingCities();

        // Auto-save on input changes in overview
        setupAutoSave();
    }

    // ===== Theme =====
    function initTheme() {
        const saved = localStorage.getItem('easyitinerary-theme') || 'warm';
        applyTheme(saved);
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('easyitinerary-theme', theme);

        // Update map tiles if map is initialized
        if (typeof MapModule !== 'undefined' && MapModule.setTileLayer) {
            try { MapModule.setTileLayer(theme); } catch(e) { /* map not ready yet */ }
        }

        // Update active state in dropdown
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    }

    function setupThemePicker() {
        const btn = document.getElementById('btnTheme');
        const dropdown = document.getElementById('themeDropdown');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        document.querySelectorAll('.theme-option').forEach(option => {
            option.addEventListener('click', () => {
                applyTheme(option.dataset.theme);
                dropdown.classList.remove('open');
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.theme-picker')) {
                dropdown.classList.remove('open');
            }
        });

        // Mark current theme as active
        const current = localStorage.getItem('easyitinerary-theme') || 'dark';
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === current);
        });
    }

    // ===== Navigation =====
    function setupNavigation() {
        document.querySelectorAll('.section-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const section = tab.dataset.section;
                switchSection(section);
            });
        });

        // Summary card shortcuts
        document.querySelectorAll('.summary-card[data-goto]').forEach(card => {
            card.addEventListener('click', () => {
                switchSection(card.dataset.goto);
            });
        });

        // Map day filter
        document.getElementById('mapDayFilter').addEventListener('change', (e) => {
            MapModule.updateMarkers(currentTrip, e.target.value, false);
        });

        // Route toggle
        document.getElementById('btnToggleRoute').addEventListener('click', () => {
            MapModule.toggleRoute();
        });
        document.getElementById('btnTogglePotentials').addEventListener('click', () => {
            MapModule.togglePotentials();
        });

        // Toggle location labels
        // Fit map button
        document.getElementById('btnFitMap').addEventListener('click', () => {
            MapModule.fitBounds();
        });

        // Toggle panel (desktop)
        document.getElementById('btnTogglePanel').addEventListener('click', () => {
            const panel = document.querySelector('.left-panel');
            panel.classList.toggle('collapsed');
            setTimeout(() => MapModule.invalidateSize(), 300);
        });

        // Mobile map toggle (3 states: default 35vh → minimized → expanded 70vh → default)
        document.getElementById('mobileMapToggle').addEventListener('click', (e) => {
            if (e.target.closest('#btnExpandMap')) return; // handled separately
            const mapPanel = document.querySelector('.right-panel');
            const toggle = document.getElementById('mobileMapToggle');
            // If map is expanded, collapse back to normal first
            if (document.body.classList.contains('map-expanded')) {
                document.body.classList.remove('map-expanded');
                document.getElementById('btnExpandMap').querySelector('i').className = 'fa-solid fa-expand';
            }
            if (mapPanel.classList.contains('map-minimized')) {
                mapPanel.classList.remove('map-minimized');
                toggle.classList.remove('flipped');
                toggle.querySelector('span').textContent = 'Map';
            } else {
                mapPanel.classList.add('map-minimized');
                toggle.classList.add('flipped');
                toggle.querySelector('span').textContent = 'Show Map';
            }
            setTimeout(() => MapModule.invalidateSize(), 350);
        });

        document.getElementById('btnExpandMap').addEventListener('click', (e) => {
            e.stopPropagation();
            const mapPanel = document.querySelector('.right-panel');
            const isExpanded = document.body.classList.toggle('map-expanded');
            const expandIcon = document.getElementById('btnExpandMap').querySelector('i');
            if (isExpanded) {
                // Ensure map is visible when expanding
                mapPanel.classList.remove('map-minimized');
                document.getElementById('mobileMapToggle').classList.remove('flipped');
                document.getElementById('mobileMapToggle').querySelector('span').textContent = 'Map';
                expandIcon.className = 'fa-solid fa-compress';
            } else {
                expandIcon.className = 'fa-solid fa-expand';
            }
            setTimeout(() => MapModule.invalidateSize(), 350);
        });
    }

    function switchSection(name) {
        document.querySelectorAll('.section-tab').forEach(t => t.classList.toggle('active', t.dataset.section === name));
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        const sectionMap = {
            overview: 'sectionOverview',
            itinerary: 'sectionItinerary',
            budget: 'sectionBudget',
            resources: 'sectionResources',
        };
        const el = document.getElementById(sectionMap[name]);
        if (el) el.classList.add('active');
        const panel = document.querySelector('.panel-content');
        if (panel) panel.scrollTop = 0;
    }

    // ===== Top Bar =====
    function setupTopBar() {
        document.getElementById('btnNewTrip').addEventListener('click', () => {
            const name = prompt('Trip name:', 'New Trip');
            if (!name) return;
            const trip = Storage.createTrip(name);
            Storage.saveTrip(trip);
            currentTrip = trip;
            reloadAll();
            showToast('New trip created');
        });

        document.getElementById('btnDeleteTrip').addEventListener('click', () => {
            if (!confirm(`Delete "${currentTrip.name}"? This cannot be undone.`)) return;
            Storage.deleteTrip(currentTrip.id);
            currentTrip = Storage.getActiveTrip();
            reloadAll();
            showToast('Trip deleted');
        });

        document.getElementById('tripSelector').addEventListener('change', (e) => {
            Storage.setActiveTrip(e.target.value);
            currentTrip = Storage.getActiveTrip();
            reloadAll();
        });

        // Hide share button if server API is unavailable (e.g. GitHub Pages)
        fetch('/api/share/test').then(r => {
            // Server returns JSON with error — API is available
            if (r.headers.get('content-type')?.includes('application/json')) return;
            // Got back HTML (e.g. GitHub Pages 404 page) — no API
            document.getElementById('btnShare').style.display = 'none';
        }).catch(() => {
            document.getElementById('btnShare').style.display = 'none';
        });

        document.getElementById('btnShare').addEventListener('click', async () => {
            try {
                const result = await Storage.shareTrip(currentTrip);
                const shareUrl = `${window.location.origin}${result.url}`;
                await navigator.clipboard.writeText(shareUrl);
                // Update URL to include share param
                window.history.replaceState({}, '', result.url);
                // Start sync polling if not already running
                Storage.startSyncPolling(currentTrip, (updatedTrip) => {
                    currentTrip = updatedTrip;
                    reloadAll();
                    showToast('Trip updated by collaborator');
                });
                showToast('Share link copied! Trip is now synced.');
            } catch (err) {
                showToast('Failed to share trip');
            }
        });

        document.getElementById('btnExport').addEventListener('click', () => {
            Storage.exportTrip(currentTrip);
            showToast('Trip exported');
        });

        document.getElementById('btnImport').addEventListener('click', () => {
            document.getElementById('importFile').click();
        });

        document.getElementById('importFile').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const trip = await Storage.importTrip(file);
                currentTrip = trip;
                reloadAll();
                showToast('Trip imported successfully');
            } catch {
                showToast('Failed to import trip');
            }
            e.target.value = '';
        });
    }

    function populateTripSelector() {
        const select = document.getElementById('tripSelector');
        const data = Storage.getAll();
        select.innerHTML = data.trips.map(t =>
            `<option value="${t.id}" ${t.id === currentTrip.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
        ).join('');
    }

    // ===== Overview =====
    function setupOverview() {
        // Collapsible sections
        document.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('collapsed');
            });
        });

        // Reservations
        document.getElementById('btnAddReservation').addEventListener('click', () => openReservationModal(null));
        document.getElementById('btnSaveReservation').addEventListener('click', saveReservation);
        document.getElementById('reservationType').addEventListener('change', () => {
            toggleReservationFields();
            populateReservationResources();
        });
        initReservationPicker();

        // Checklist
        document.getElementById('btnAddChecklist').addEventListener('click', addChecklistItem);
        document.getElementById('checklistInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addChecklistItem();
        });
    }

    function loadTripData() {
        document.getElementById('tripName').value = currentTrip.name || '';
        document.getElementById('tripStartDate').value = currentTrip.startDate || '';
        document.getElementById('tripEndDate').value = currentTrip.endDate || '';
        document.getElementById('tripNotes').value = currentTrip.notes || '';
        updateTripDuration();
        renderReservations();
        renderChecklist();
    }

    function setupAutoSave() {
        // Trip name
        document.getElementById('tripName').addEventListener('input', (e) => {
            currentTrip.name = e.target.value;
            Storage.saveTrip(currentTrip);
            populateTripSelector();
        });

        // Dates
        document.getElementById('tripStartDate').addEventListener('change', (e) => {
            currentTrip.startDate = e.target.value;
            Storage.saveTrip(currentTrip);
            updateTripDuration();
            Itinerary.generateDaysFromDates();
        });
        document.getElementById('tripEndDate').addEventListener('change', (e) => {
            currentTrip.endDate = e.target.value;
            Storage.saveTrip(currentTrip);
            updateTripDuration();
            Itinerary.generateDaysFromDates();
        });

        // Notes
        document.getElementById('tripNotes').addEventListener('input', (e) => {
            currentTrip.notes = e.target.value;
            Storage.saveTrip(currentTrip);
        });
    }

    function updateTripDuration() {
        const el = document.getElementById('tripDuration');
        if (currentTrip.startDate && currentTrip.endDate) {
            const start = new Date(currentTrip.startDate);
            const end = new Date(currentTrip.endDate);
            const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            if (days > 0) {
                el.textContent = `(${days} day${days !== 1 ? 's' : ''})`;
            } else {
                el.textContent = '';
            }
        } else {
            el.textContent = '';
        }
    }

    // ===== Reservations =====
    let editingReservationIdx = null;

    let reservationPicker = null;

    function initReservationPicker() {
        reservationPicker = ResourcePicker.init(
            document.getElementById('reservationResourcePicker'),
            document.getElementById('reservationLinkedResource'),
            {
                getTrip: () => currentTrip,
                onSelect: (_id, res) => {
                    if (!res) return;
                    const catToType = { hotel: 'hotel', transport: 'flight', restaurant: 'other', activity: 'other', general: 'other' };
                    if (catToType[res.category]) {
                        document.getElementById('reservationType').value = catToType[res.category];
                        toggleReservationFields();
                    }
                    if (!document.getElementById('reservationTitle').value.trim()) {
                        document.getElementById('reservationTitle').value = res.title;
                    }
                    if (res.url && !document.getElementById('reservationLink').value.trim()) {
                        document.getElementById('reservationLink').value = res.url;
                    }
                    if (res.notes && !document.getElementById('reservationNotes').value.trim()) {
                        document.getElementById('reservationNotes').value = res.notes;
                    }
                },
            }
        );
    }

    function populateReservationResources() {
        if (!reservationPicker) return;
        // Auto-filter to matching category based on reservation type
        const type = document.getElementById('reservationType').value;
        const typeToCategory = { hotel: 'hotel', flight: 'transport', train: 'transport', bus: 'transport', rental: 'transport' };
        reservationPicker.setFilter(typeToCategory[type] || 'all');
    }

    function toggleReservationFields() {
        const type = document.getElementById('reservationType').value;
        document.getElementById('flightFieldsRow').style.display = type === 'flight' ? '' : 'none';
        document.getElementById('transportFieldsRow').style.display = (type === 'train' || type === 'bus') ? '' : 'none';
        document.getElementById('hotelFieldsRow').style.display = type === 'hotel' ? '' : 'none';
        document.getElementById('genericDateRow').style.display = (type === 'rental' || type === 'other') ? '' : 'none';
    }

    function openReservationModal(idx) {
        editingReservationIdx = idx;
        const modal = document.getElementById('reservationModal');
        const title = document.getElementById('reservationModalTitle');

        // All field IDs for easy clearing
        const fields = [
            'reservationType', 'reservationTitle', 'reservationProvider', 'reservationConfirmation',
            'reservationDate', 'reservationTime', 'reservationCost', 'reservationNotes', 'reservationLink',
            'reservationCheckIn', 'reservationCheckOut', 'reservationCheckInTime', 'reservationCheckOutTime',
            'reservationDepAirport', 'reservationArrAirport', 'reservationFlightNo', 'reservationSeat',
            'reservationTerminal', 'reservationDepTime', 'reservationArrTime',
            'reservationDepStation', 'reservationArrStation', 'reservationTransDepTime', 'reservationTransArrTime',
            'reservationServiceNo',
        ];

        if (idx !== null && idx !== undefined) {
            title.textContent = 'Edit Reservation';
            const res = currentTrip.reservations[idx];
            document.getElementById('reservationType').value = res.type || 'other';
            document.getElementById('reservationTitle').value = res.title || '';
            document.getElementById('reservationProvider').value = res.provider || '';
            document.getElementById('reservationConfirmation').value = res.confirmation || '';
            document.getElementById('reservationDate').value = res.date || '';
            document.getElementById('reservationTime').value = res.time || '';
            document.getElementById('reservationCost').value = res.cost || '';
            document.getElementById('reservationNotes').value = res.notes || '';
            document.getElementById('reservationLink').value = res.link || '';
            // Hotel fields
            document.getElementById('reservationCheckIn').value = res.checkIn || '';
            document.getElementById('reservationCheckOut').value = res.checkOut || '';
            document.getElementById('reservationCheckInTime').value = res.checkInTime || '';
            document.getElementById('reservationCheckOutTime').value = res.checkOutTime || '';
            // Flight fields
            document.getElementById('reservationDepAirport').value = res.depAirport || '';
            document.getElementById('reservationArrAirport').value = res.arrAirport || '';
            document.getElementById('reservationFlightNo').value = res.flightNo || '';
            document.getElementById('reservationSeat').value = res.seat || '';
            document.getElementById('reservationTerminal').value = res.terminal || '';
            document.getElementById('reservationDepTime').value = res.depTime || '';
            document.getElementById('reservationArrTime').value = res.arrTime || '';
            // Transport fields
            document.getElementById('reservationDepStation').value = res.depStation || '';
            document.getElementById('reservationArrStation').value = res.arrStation || '';
            document.getElementById('reservationTransDepTime').value = res.transDepTime || '';
            document.getElementById('reservationTransArrTime').value = res.transArrTime || '';
            document.getElementById('reservationServiceNo').value = res.serviceNo || '';
            reservationPicker.setValue(res.linkedResourceId || res.linkedResourceIdx || '');
        } else {
            title.textContent = 'Add Reservation';
            // Clear all fields
            fields.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = el.tagName === 'SELECT' ? el.options[0].value : '';
            });
            document.getElementById('reservationType').value = 'flight';
            document.getElementById('reservationCheckIn').value = currentTrip.startDate || '';
            document.getElementById('reservationCheckOut').value = currentTrip.endDate || '';
            document.getElementById('reservationDate').value = currentTrip.startDate || '';
            reservationPicker.clear();
        }
        populateReservationResources();
        toggleReservationFields();

        const nudge = document.getElementById('reservationResourceNudge');
        if (nudge) {
            const hasResources = (currentTrip.resources || []).some(r => (r.status || 'selected') === 'selected');
            nudge.style.display = (idx === null && hasResources) ? '' : 'none';
        }

        modal.classList.add('open');
    }

    function saveReservation() {
        const title = document.getElementById('reservationTitle').value.trim();
        if (!title) {
            document.getElementById('reservationTitle').focus();
            return;
        }

        const type = document.getElementById('reservationType').value;
        const reservation = {
            id: editingReservationIdx !== null ? currentTrip.reservations[editingReservationIdx].id : Storage.generateId(),
            type,
            title,
            provider: document.getElementById('reservationProvider').value,
            confirmation: document.getElementById('reservationConfirmation').value,
            cost: parseFloat(document.getElementById('reservationCost').value) || 0,
            notes: document.getElementById('reservationNotes').value,
            link: document.getElementById('reservationLink').value,
            linkedResourceId: document.getElementById('reservationLinkedResource').value || null,
        };

        // Type-specific fields
        if (type === 'flight') {
            reservation.depAirport = document.getElementById('reservationDepAirport').value;
            reservation.arrAirport = document.getElementById('reservationArrAirport').value;
            reservation.flightNo = document.getElementById('reservationFlightNo').value;
            reservation.seat = document.getElementById('reservationSeat').value;
            reservation.terminal = document.getElementById('reservationTerminal').value;
            reservation.depTime = document.getElementById('reservationDepTime').value;
            reservation.arrTime = document.getElementById('reservationArrTime').value;
            // Derive date from departure for sorting
            reservation.date = reservation.depTime ? reservation.depTime.split('T')[0] : '';
        } else if (type === 'hotel') {
            reservation.checkIn = document.getElementById('reservationCheckIn').value;
            reservation.checkOut = document.getElementById('reservationCheckOut').value;
            reservation.checkInTime = document.getElementById('reservationCheckInTime').value;
            reservation.checkOutTime = document.getElementById('reservationCheckOutTime').value;
            reservation.date = reservation.checkIn || '';
        } else if (type === 'train' || type === 'bus') {
            reservation.depStation = document.getElementById('reservationDepStation').value;
            reservation.arrStation = document.getElementById('reservationArrStation').value;
            reservation.transDepTime = document.getElementById('reservationTransDepTime').value;
            reservation.transArrTime = document.getElementById('reservationTransArrTime').value;
            reservation.serviceNo = document.getElementById('reservationServiceNo').value;
            reservation.date = reservation.transDepTime ? reservation.transDepTime.split('T')[0] : '';
        } else {
            reservation.date = document.getElementById('reservationDate').value;
            reservation.time = document.getElementById('reservationTime').value;
        }

        if (editingReservationIdx !== null) {
            currentTrip.reservations[editingReservationIdx] = reservation;
        } else {
            currentTrip.reservations.push(reservation);
        }

        Storage.saveTrip(currentTrip);

        // Auto-assign hotel as lodging endpoint for days not already set
        if (reservation.type === 'hotel') {
            const assigned = Itinerary.autoAssignLodgingEndpoints(reservation);
            if (assigned > 0) {
                Storage.saveTrip(currentTrip);
                showToast(`Lodging auto-set as endpoint for ${assigned} day${assigned === 1 ? '' : 's'}`);
            }
        }

        document.getElementById('reservationModal').classList.remove('open');
        editingReservationIdx = null;
        renderReservations();
        Budget.update(currentTrip);
        updateStats();
    }

    function deleteReservation(idx) {
        if (!confirm('Delete this reservation?')) return;
        currentTrip.reservations.splice(idx, 1);
        Storage.saveTrip(currentTrip);
        renderReservations();
        Budget.update(currentTrip);
        updateStats();
    }

    function renderReservations() {
        const container = document.getElementById('reservationsList');
        if (!currentTrip.reservations || currentTrip.reservations.length === 0) {
            container.innerHTML = `<div class="empty-state">
                <i class="fa-solid fa-suitcase-rolling"></i>
                <p>No reservations added yet.</p>
                <button class="btn btn-small" onclick="App.openReservationModal(null)"><i class="fa-solid fa-plus"></i> Add Reservation</button>
            </div>`;
            return;
        }

        const typeIcons = {
            flight: { icon: 'fa-plane', class: 'flight' },
            hotel: { icon: 'fa-bed', class: 'hotel' },
            rental: { icon: 'fa-car', class: 'rental' },
            train: { icon: 'fa-train', class: 'train' },
            bus: { icon: 'fa-bus', class: 'bus' },
            other: { icon: 'fa-ellipsis', class: 'other' },
        };

        // Sort by effective date/time across all reservation types
        function getSortKey(r) {
            if (r.type === 'flight' && r.depTime) return r.depTime;
            if ((r.type === 'train' || r.type === 'bus') && r.transDepTime) return r.transDepTime;
            if (r.type === 'hotel' && r.checkIn) return r.checkIn + 'T' + (r.checkInTime || '23:59');
            return (r.date || '') + 'T' + (r.time || '00:00');
        }
        const sorted = currentTrip.reservations
            .map((res, idx) => ({ ...res, _idx: idx }))
            .sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)));

        container.innerHTML = sorted.map((res) => {
            const idx = res._idx;
            const t = typeIcons[res.type] || typeIcons.other;
            const sym = Budget.getCurrencySymbol(currentTrip.budgetCurrency);

            // Build type-specific detail lines
            let detailsHtml = '';

            if (res.type === 'flight') {
                const route = (res.depAirport || res.arrAirport)
                    ? `<span><i class="fa-solid fa-route"></i> ${escapeHtml(res.depAirport || '?')} → ${escapeHtml(res.arrAirport || '?')}</span>` : '';
                const flightNo = res.flightNo ? `<span><i class="fa-solid fa-hashtag"></i> ${escapeHtml(res.flightNo)}</span>` : '';
                const depArr = formatDepArr(res.depTime, res.arrTime);
                const seat = res.seat ? `<span><i class="fa-solid fa-chair"></i> ${escapeHtml(res.seat)}</span>` : '';
                const terminal = res.terminal ? `<span><i class="fa-solid fa-signs-post"></i> ${escapeHtml(res.terminal)}</span>` : '';
                detailsHtml = [route, flightNo, depArr, seat, terminal].filter(Boolean).join('');
            } else if (res.type === 'hotel') {
                const nights = (res.checkIn && res.checkOut) ? Math.ceil((new Date(res.checkOut) - new Date(res.checkIn)) / (1000*60*60*24)) : 0;
                const dates = (res.checkIn && res.checkOut)
                    ? `<span><i class="fa-regular fa-calendar"></i> ${res.checkIn} → ${res.checkOut}${nights > 0 ? ` (${nights}n)` : ''}</span>` : '';
                const ciTime = res.checkInTime ? `<span><i class="fa-solid fa-right-to-bracket"></i> Check-in ${res.checkInTime}</span>` : '';
                const coTime = res.checkOutTime ? `<span><i class="fa-solid fa-right-from-bracket"></i> Check-out ${res.checkOutTime}</span>` : '';
                detailsHtml = [dates, ciTime, coTime].filter(Boolean).join('');
            } else if (res.type === 'train' || res.type === 'bus') {
                const route = (res.depStation || res.arrStation)
                    ? `<span><i class="fa-solid fa-route"></i> ${escapeHtml(res.depStation || '?')} → ${escapeHtml(res.arrStation || '?')}</span>` : '';
                const serviceNo = res.serviceNo ? `<span><i class="fa-solid fa-hashtag"></i> ${escapeHtml(res.serviceNo)}</span>` : '';
                const depArr = formatDepArr(res.transDepTime, res.transArrTime);
                detailsHtml = [route, serviceNo, depArr].filter(Boolean).join('');
            } else {
                const dateDisplay = res.date ? `<span><i class="fa-regular fa-calendar"></i> ${res.date}</span>` : '';
                const timeDisplay = res.time ? `<span><i class="fa-regular fa-clock"></i> ${res.time}</span>` : '';
                detailsHtml = [dateDisplay, timeDisplay].filter(Boolean).join('');
            }

            const resCity = getReservationCity(res);
            const resMarkerKey = getReservationMarkerKey(res);
            return `
                <div class="reservation-card"${resMarkerKey ? ` data-marker-key="${resMarkerKey}"` : ''}>
                    <div class="reservation-icon ${t.class}"><i class="fa-solid ${t.icon}"></i></div>
                    <div class="reservation-info">
                        <h4>${escapeHtml(res.title)}${resCity ? `<span class="location-label"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(resCity)}</span>` : ''}</h4>
                        <div class="reservation-meta">
                            ${res.provider ? `<span>${escapeHtml(res.provider)}</span>` : ''}
                            ${detailsHtml}
                            ${res.cost ? `<span>${sym}${res.cost}</span>` : ''}
                        </div>
                        ${res.confirmation ? `<span class="reservation-confirmation" onclick="navigator.clipboard.writeText('${escapeHtml(res.confirmation)}'); showToast('Copied')" title="Click to copy"><i class="fa-solid fa-copy"></i> ${escapeHtml(res.confirmation)}</span>` : ''}
                    </div>
                    <div class="reservation-actions">
                        ${res.link ? `<button onclick="window.open('${escapeHtml(res.link)}', '_blank')" title="Open link"><i class="fa-solid fa-external-link"></i></button>` : ''}
                        <button onclick="App.openReservationModal(${idx})" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="App.deleteReservation(${idx})" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        }).join('');

        // Wire hover + click-to-focus for reservation cards
        container.querySelectorAll('.reservation-card[data-marker-key]').forEach(card => {
            card.addEventListener('mouseenter', () => {
                MapModule.highlightMarker(card.dataset.markerKey);
            });
            card.addEventListener('mouseleave', () => {
                MapModule.clearHighlight();
            });
            card.addEventListener('click', (e) => {
                if (e.target.closest('.reservation-actions') || e.target.closest('.reservation-confirmation')) return;
                MapModule.focusMarker(card.dataset.markerKey);
            });
        });
    }

    // ===== Checklist =====
    function addChecklistItem() {
        const input = document.getElementById('checklistInput');
        const text = input.value.trim();
        if (!text) return;

        currentTrip.checklist.push({ text, checked: false });
        Storage.saveTrip(currentTrip);
        input.value = '';
        renderChecklist();
    }

    function toggleChecklistItem(idx) {
        currentTrip.checklist[idx].checked = !currentTrip.checklist[idx].checked;
        Storage.saveTrip(currentTrip);
        renderChecklist();
    }

    function deleteChecklistItem(idx) {
        currentTrip.checklist.splice(idx, 1);
        Storage.saveTrip(currentTrip);
        renderChecklist();
    }

    function renderChecklist() {
        const container = document.getElementById('checklistItems');
        if (!currentTrip.checklist || currentTrip.checklist.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = currentTrip.checklist.map((item, idx) => `
            <div class="checklist-item ${item.checked ? 'checked' : ''}">
                <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="App.toggleChecklistItem(${idx})" />
                <span>${escapeHtml(item.text)}</span>
                <button onclick="App.deleteChecklistItem(${idx})" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `).join('');
    }

    // ===== Stats =====
    function updateStats() {
        const totalDays = currentTrip.days.length;
        const totalActivities = currentTrip.days.reduce((sum, d) => sum + d.activities.length, 0);
        const sym = Budget.getCurrencySymbol(currentTrip.budgetCurrency);
        const spent = Budget.getTotalSpent();
        const totalLinks = (currentTrip.resources || []).length;

        document.getElementById('statDays').textContent = totalDays;
        document.getElementById('statActivities').textContent = totalActivities;
        document.getElementById('statBudget').textContent = `${sym}${spent.toFixed(spent % 1 === 0 ? 0 : 2)}`;
        document.getElementById('statLinks').textContent = totalLinks;

        renderDayPlanStrip();
        Weather.update(currentTrip);
    }

    // ===== Day Plan Strip =====
    function renderDayPlanStrip() {
        const section = document.getElementById('dayPlanSection');
        const container = document.getElementById('dayPlanStrip');
        if (!section || !container) return;

        const days = currentTrip.days || [];
        if (days.length === 0) {
            section.style.display = 'none';
            return;
        }
        section.style.display = '';

        // Build date → anchor map from reservations
        const anchors = {}; // 'YYYY-MM-DD' → { flight, hotel, transit }
        (currentTrip.reservations || []).forEach(res => {
            const hits = [];
            if (res.type === 'flight') {
                if (res.depTime) hits.push({ d: res.depTime.split('T')[0], k: 'flight' });
                if (res.arrTime) hits.push({ d: res.arrTime.split('T')[0], k: 'flight' });
            } else if (res.type === 'hotel') {
                if (res.checkIn && res.checkOut) {
                    const [cy, cm, cd] = res.checkIn.split('-').map(Number);
                    const [oy, om, od] = res.checkOut.split('-').map(Number);
                    const cur = new Date(cy, cm - 1, cd);
                    const end = new Date(oy, om - 1, od);
                    while (cur <= end) {
                        const mm = String(cur.getMonth() + 1).padStart(2, '0');
                        const dd = String(cur.getDate()).padStart(2, '0');
                        hits.push({ d: `${cur.getFullYear()}-${mm}-${dd}`, k: 'hotel' });
                        cur.setDate(cur.getDate() + 1);
                    }
                } else {
                    if (res.checkIn)  hits.push({ d: res.checkIn,  k: 'hotel' });
                    if (res.checkOut) hits.push({ d: res.checkOut, k: 'hotel' });
                }
            } else if (res.type === 'train' || res.type === 'bus') {
                if (res.transDepTime) hits.push({ d: res.transDepTime.split('T')[0], k: 'transit' });
                if (res.transArrTime) hits.push({ d: res.transArrTime.split('T')[0], k: 'transit' });
            } else {
                if (res.date) hits.push({ d: res.date, k: 'other' });
            }
            hits.forEach(({ d, k }) => {
                if (!d) return;
                if (!anchors[d]) anchors[d] = {};
                anchors[d][k] = true;
            });
        });

        container.innerHTML = days.map((day, idx) => {
            const count = (day.activities || []).length;

            // Use the day's stored date as the authoritative calendar date
            const dayDate = day.date || null;

            const anchor = dayDate ? (anchors[dayDate] || {}) : {};
            const hasFlight  = !!anchor.flight;
            const hasHotel   = !!anchor.hotel;
            const hasTransit = !!anchor.transit;
            const hasOther   = !!anchor.other;
            const hasAnyAnchor = hasFlight || hasHotel || hasTransit || hasOther;

            // Short label: "Jan\n5" or "D1"
            let label;
            if (dayDate) {
                const [ly, lm, ld] = dayDate.split('-').map(Number);
                const d = new Date(ly, lm - 1, ld);
                const mon = d.toLocaleString('default', { month: 'short' });
                label = `${mon}<br>${d.getDate()}`;
            } else {
                label = `D${idx + 1}`;
            }

            // Derive a location name for this day
            let dayLocation = '';
            // 1. Day label after "—" (e.g. "Day 1 — Florence" → "Florence")
            if (day.label && day.label.includes('—')) {
                dayLocation = day.label.split('—').slice(1).join('—').trim();
            } else if (day.label && !/^day\s*\d+$/i.test(day.label.trim())) {
                dayLocation = day.label.trim();
            }
            // 2. Most common city across activities (via linked resource or address)
            if (!dayLocation) {
                const cities = (day.activities || []).map(a => {
                    if (a.linkedResourceId) {
                        const res = (currentTrip.resources || []).find(r => r.id === a.linkedResourceId);
                        if (res && res.city) return res.city;
                    }
                    if (a.address) {
                        const parts = a.address.split(',').map(p => p.trim()).filter(Boolean);
                        if (parts.length >= 2) return parts[parts.length - 2];
                    }
                    return '';
                }).filter(Boolean);
                if (cities.length) {
                    const freq = {};
                    cities.forEach(c => freq[c] = (freq[c] || 0) + 1);
                    dayLocation = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
                }
            }
            // 3. Lodging city from reservations spanning this day
            if (!dayLocation && dayDate) {
                const lodging = (currentTrip.reservations || []).find(r =>
                    r.type === 'hotel' && r.checkIn <= dayDate && r.checkOut >= dayDate
                );
                if (lodging && lodging.linkedResourceId) {
                    const res = (currentTrip.resources || []).find(r => r.id === lodging.linkedResourceId);
                    if (res && res.city) dayLocation = res.city;
                }
            }
            // Truncate to keep tiles compact
            const locationStr = dayLocation.length > 12 ? dayLocation.slice(0, 11) + '…' : dayLocation;

            // Status
            let status;
            if (count === 0 && !hasAnyAnchor) status = 'empty';
            else if (count === 0 && hasAnyAnchor) status = 'anchored';
            else if (count <= 2) status = 'sparse';
            else status = 'good';

            const anchorIcons =
                (hasFlight  ? '<i class="fa-solid fa-plane"></i>' : '') +
                (hasHotel   ? '<i class="fa-solid fa-bed"></i>'   : '') +
                (hasTransit && !hasFlight ? '<i class="fa-solid fa-train"></i>' : '') +
                (hasOther   && !hasFlight && !hasHotel && !hasTransit ? '<i class="fa-solid fa-bookmark"></i>' : '');

            let countDisplay;
            if (count > 0) {
                countDisplay = count;
            } else if (hasAnyAnchor) {
                countDisplay = '~';
            } else {
                countDisplay = '—';
            }

            const fullLabel = (day.label || `Day ${idx + 1}`).replace(/"/g, '&quot;');
            const actWord = count !== 1 ? 'activities' : 'activity';
            const anchorNote = hasAnyAnchor ? ' · reservation' : '';
            return `<div class="day-plan-tile status-${status}" data-weather-date="${dayDate || ''}" onclick="App.jumpToDay(${idx})" title="${fullLabel}: ${count} ${actWord}${anchorNote}${dayLocation ? ' · ' + dayLocation : ''}">
                <span class="dpt-label">${label}</span>
                <span class="dpt-count">${countDisplay}</span>
                ${locationStr ? `<span class="dpt-loc">${escapeHtml(locationStr)}</span>` : '<span class="dpt-loc"></span>'}
                <span class="dpt-weather"></span>
                <span class="dpt-anchors">${anchorIcons}</span>
            </div>`;
        }).join('');
    }

    function jumpToDay(idx) {
        switchSection('itinerary');
        setTimeout(() => {
            const dayEls = document.querySelectorAll('#itineraryDays .day-card');
            if (dayEls[idx]) {
                dayEls[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Brief highlight
                dayEls[idx].classList.add('day-card-flash');
                setTimeout(() => dayEls[idx].classList.remove('day-card-flash'), 800);
            }
        }, 60);
    }

    // ===== Modals =====
    function setupModals() {
        // Close buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = document.getElementById(btn.dataset.close);
                if (modal) modal.classList.remove('open');
            });
        });

        // Click outside to close
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('open');
            });
        });

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
            }
        });
    }

    // ===== Reload =====
    function reloadAll() {
        populateTripSelector();
        loadTripData();
        Itinerary.update(currentTrip);
        Budget.update(currentTrip);
        Resources.update(currentTrip);
        Weather.init(currentTrip);
        updateStats();
        MapModule.updateMarkers(currentTrip, 'all');
    }

    // ===== Helpers =====
    function anchorDateInputsToTrip() {
        // For any date input inside a modal that is empty, temporarily set value
        // to trip start date on focus so the picker opens to the right month,
        // then clear it on blur if unchanged.
        document.querySelectorAll('.modal input[type="date"]').forEach(input => {
            if (input._dateAnchored) return;
            input._dateAnchored = true;

            input.addEventListener('focus', () => {
                if (!input.value) {
                    // For check-out, use check-in date as anchor if available
                    let anchor = currentTrip.startDate || '';
                    if (input.id === 'reservationCheckOut') {
                        const checkIn = document.getElementById('reservationCheckIn').value;
                        if (checkIn) anchor = checkIn;
                    }
                    if (anchor) {
                        input._wasEmpty = true;
                        input._anchorValue = anchor;
                        input.value = anchor;
                    }
                } else {
                    input._wasEmpty = false;
                }
            });

            input.addEventListener('blur', () => {
                if (input._wasEmpty && input.value === input._anchorValue) {
                    input.value = '';
                }
                input._wasEmpty = false;
            });
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/'/g, '&#39;');
    }

    // Format departure/arrival datetime-local values into a readable string
    function getReservationMarkerKey(res) {
        const resources = currentTrip.resources || [];
        let linked = null;
        if (res.linkedResourceId) {
            linked = resources.find(r => r.id === res.linkedResourceId);
        }
        if (!linked || !linked.lat) {
            linked = resources.find(r =>
                r.lat && r.lng && r.title && res.title &&
                (r.title.includes(res.title) || res.title.includes(r.title))
            );
        }
        return linked ? `res-${linked.id}` : '';
    }

    function getReservationCity(res) {
        const resources = currentTrip.resources || [];
        let linked = null;
        if (res.linkedResourceId) {
            linked = resources.find(r => r.id === res.linkedResourceId);
        }
        if (!linked || !linked.city) {
            linked = resources.find(r =>
                r.city && r.title && res.title &&
                (r.title.includes(res.title) || res.title.includes(r.title))
            );
        }
        return linked && linked.city ? linked.city : '';
    }

    function formatDepArr(dep, arr) {
        if (!dep && !arr) return '';
        const fmt = (dt) => {
            if (!dt) return '?';
            // datetime-local is "YYYY-MM-DDThh:mm"
            const [date, time] = dt.split('T');
            if (!time) return date;
            return `${date} ${time}`;
        };
        return `<span><i class="fa-regular fa-clock"></i> ${fmt(dep)} → ${fmt(arr)}</span>`;
    }

    return {
        init,
        updateStats,
        switchSection,
        openReservationModal,
        deleteReservation,
        renderReservations,
        toggleChecklistItem,
        deleteChecklistItem,
        jumpToDay,
    };
})();

// ===== Toast =====
function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== Resource Picker (shared component) =====
const ResourcePicker = (() => {
    const categoryIcons = {
        restaurant: 'fa-utensils', hotel: 'fa-bed', sightseeing: 'fa-camera',
        transport: 'fa-plane', activity: 'fa-person-hiking', shopping: 'fa-bag-shopping', general: 'fa-link',
    };

    function init(pickerEl, hiddenInput, { onSelect, getTrip }) {
        const searchInput = pickerEl.querySelector('.resource-picker-search');
        const clearBtn = pickerEl.querySelector('.resource-picker-clear');
        const listEl = pickerEl.querySelector('.resource-picker-list');
        const filterBtns = pickerEl.querySelectorAll('.rpf-btn');
        let activeFilter = 'all';

        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeFilter = btn.dataset.cat;
                renderList();
            });
        });

        searchInput.addEventListener('input', () => renderList());
        searchInput.addEventListener('focus', () => {
            listEl.style.display = '';
            renderList();
        });

        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            hiddenInput.value = '';
            searchInput.value = '';
            searchInput.placeholder = 'Search resources...';
            clearBtn.style.display = 'none';
            listEl.style.display = '';
            renderList();
        });

        // Close list when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.resource-picker') || !pickerEl.contains(e.target)) {
                listEl.style.display = 'none';
            }
        });

        function renderList() {
            const trip = getTrip();
            const resources = trip?.resources || [];
            const query = searchInput.value.toLowerCase().trim();

            let filtered = resources.filter(r => (r.status || 'selected') === 'selected');
            if (activeFilter !== 'all') {
                filtered = filtered.filter(r => r.category === activeFilter);
            }
            if (query) {
                filtered = filtered.filter(r =>
                    (r.title || '').toLowerCase().includes(query) ||
                    (r.category || '').toLowerCase().includes(query) ||
                    (r.notes || '').toLowerCase().includes(query) ||
                    (r.cuisine || '').toLowerCase().includes(query)
                );
            }

            if (filtered.length === 0) {
                listEl.innerHTML = '<div class="rp-empty">No matching resources</div>';
                listEl.style.display = '';
                return;
            }

            listEl.innerHTML = filtered.map(res => {
                const icon = categoryIcons[res.category] || 'fa-link';
                const selected = hiddenInput.value === res.id;
                return `
                    <div class="rp-item ${selected ? 'selected' : ''}" data-id="${res.id}">
                        <i class="fa-solid ${icon} rp-item-icon ${res.category}"></i>
                        <div class="rp-item-info">
                            <span class="rp-item-title">${escapeHtml(res.title)}</span>
                            ${res.cuisine ? `<span class="rp-item-detail">${escapeHtml(res.cuisine)}</span>` : ''}
                            ${res.openingHours ? `<span class="rp-item-detail"><i class="fa-regular fa-clock"></i> ${escapeHtml(res.openingHours)}</span>` : ''}
                        </div>
                        <span class="rp-item-cat">${res.category || 'general'}</span>
                    </div>
                `;
            }).join('');
            listEl.style.display = '';

            // Bind click events
            listEl.querySelectorAll('.rp-item').forEach(item => {
                item.addEventListener('click', () => {
                    const id = item.dataset.id;
                    hiddenInput.value = id;
                    const res = resources.find(r => r.id === id);
                    if (res) {
                        searchInput.value = res.title;
                        clearBtn.style.display = '';
                    }
                    listEl.style.display = 'none';
                    if (onSelect) onSelect(id, res);
                });
            });
        }

        function escapeHtml(str) {
            if (!str) return '';
            const d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML.replace(/'/g, '&#39;');
        }

        return {
            renderList,
            setValue(id) {
                const trip = getTrip();
                const res = (trip?.resources || []).find(r => r.id === id);
                if (res) {
                    hiddenInput.value = id;
                    searchInput.value = res.title;
                    clearBtn.style.display = '';
                } else {
                    hiddenInput.value = '';
                    searchInput.value = '';
                    clearBtn.style.display = 'none';
                }
            },
            clear() {
                hiddenInput.value = '';
                searchInput.value = '';
                searchInput.placeholder = 'Search resources...';
                clearBtn.style.display = 'none';
            },
            setFilter(cat) {
                filterBtns.forEach(b => b.classList.remove('active'));
                const match = [...filterBtns].find(b => b.dataset.cat === cat);
                if (match) match.classList.add('active');
                else filterBtns[0]?.classList.add('active');
                activeFilter = cat || 'all';
                renderList();
            },
        };
    }

    return { init };
})();

// ===== Init on DOM ready =====
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
