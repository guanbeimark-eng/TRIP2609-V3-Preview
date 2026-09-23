/* ===== Itinerary Module ===== */
const Itinerary = (() => {
    let currentTrip = null;
    let editingActivity = null; // { dayIdx, actIdx } or null
    let dragState = null;

    function init(trip) {
        currentTrip = trip;
        render();
        bindEvents();
    }

    function bindEvents() {
        document.getElementById('btnAddDay').addEventListener('click', addDay);
        document.getElementById('btnSaveActivity').addEventListener('click', saveActivity);
        document.getElementById('activityCost').addEventListener('input', (e) => {
            const row = document.getElementById('activityExcludeBudgetRow');
            if (row) row.style.display = parseFloat(e.target.value) > 0 ? '' : 'none';
        });
        document.getElementById('btnPickLocation').addEventListener('click', () => {
            MapModule.enablePickMode((lat, lng) => {
                document.getElementById('activityLat').value = lat.toFixed(6);
                document.getElementById('activityLng').value = lng.toFixed(6);
            });
        });

        // Resource picker for activities (initialized after DOM ready via initPicker)
    }

    let activityPicker = null;

    function initPicker() {
        activityPicker = ResourcePicker.init(
            document.getElementById('activityResourcePicker'),
            document.getElementById('activityLinkedResource'),
            {
                getTrip: () => currentTrip,
                onSelect: (_id, res) => {
                    if (!res) return;
                    if (!document.getElementById('activityTitle').value.trim()) {
                        document.getElementById('activityTitle').value = res.title;
                    }
                    if (res.url && !document.getElementById('activityLink').value.trim()) {
                        document.getElementById('activityLink').value = res.url;
                    }
                    if (res.notes && !document.getElementById('activityDescription').value.trim()) {
                        document.getElementById('activityDescription').value = res.notes;
                    }
                    if (res.lat && !document.getElementById('activityLat').value) {
                        document.getElementById('activityLat').value = res.lat;
                    }
                    if (res.lng && !document.getElementById('activityLng').value) {
                        document.getElementById('activityLng').value = res.lng;
                    }
                    const catMap = { restaurant: 'food', hotel: 'lodging', sightseeing: 'sightseeing', transport: 'transport', activity: 'activity', shopping: 'shopping' };
                    if (catMap[res.category]) {
                        document.getElementById('activityCategory').value = catMap[res.category];
                    }
                },
            }
        );
    }

    function populateActivityResources() {
        if (!activityPicker) initPicker();
        activityPicker.renderList();
    }

    function generateDaysFromDates() {
        if (!currentTrip.startDate || !currentTrip.endDate) return;
        const [sy, sm, sd] = currentTrip.startDate.split('-').map(Number);
        const [ey, em, ed] = currentTrip.endDate.split('-').map(Number);
        const start = new Date(sy, sm - 1, sd);
        const end = new Date(ey, em - 1, ed);
        if (start > end) return;

        const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

        // Index existing days by their stored date so we can preserve activities
        const daysByDate = {};
        currentTrip.days.forEach(day => {
            if (day.date) daysByDate[day.date] = day;
        });

        // Count activities that will be dropped (days outside the new range)
        let droppedActivities = 0;
        currentTrip.days.forEach(day => {
            if (!day.date || !day.activities?.length) return;
            const [dy, dm, dd] = day.date.split('-').map(Number);
            const dayD = new Date(dy, dm - 1, dd);
            if (dayD < start || dayD > end) droppedActivities += day.activities.length;
        });

        // Rebuild days array covering exactly the new date range
        const newDays = [];
        for (let i = 0; i < totalDays; i++) {
            const d = new Date(sy, sm - 1, sd + i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            newDays.push(daysByDate[dateStr] || { date: dateStr, label: '', activities: [] });
        }

        currentTrip.days = newDays;
        Storage.saveTrip(currentTrip);
        render();
        App.updateStats();

        if (droppedActivities > 0) {
            showToast(`${droppedActivities} activit${droppedActivities === 1 ? 'y' : 'ies'} on removed days were dropped.`);
        }
    }

    function addDay() {
        const lastDay = currentTrip.days[currentTrip.days.length - 1];
        let nextDate = '';
        if (lastDay && lastDay.date) {
            const [ly, lm, ld] = lastDay.date.split('-').map(Number);
            const d = new Date(ly, lm - 1, ld + 1);
            nextDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } else if (currentTrip.startDate) {
            nextDate = currentTrip.startDate;
        }

        currentTrip.days.push({
            date: nextDate,
            label: '',
            activities: [],
        });
        Storage.saveTrip(currentTrip);
        render();
    }

    function removeDay(dayIdx) {
        if (!confirm('Delete this day and all its activities?')) return;
        currentTrip.days.splice(dayIdx, 1);
        Storage.saveTrip(currentTrip);
        render();
        App.updateStats();
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
    }

    function openActivityModal(dayIdx, actIdx) {
        editingActivity = { dayIdx, actIdx };
        const modal = document.getElementById('activityModal');
        const title = document.getElementById('activityModalTitle');

        populateActivityResources();

        if (actIdx !== null && actIdx !== undefined) {
            title.textContent = 'Edit Activity';
            const act = currentTrip.days[dayIdx].activities[actIdx];
            document.getElementById('activityTitle').value = act.title || '';
            document.getElementById('activityCategory').value = act.category || 'sightseeing';
            document.getElementById('activityStartTime').value = act.startTime || '';
            document.getElementById('activityEndTime').value = act.endTime || '';
            document.getElementById('activityCost').value = act.cost || '';
            document.getElementById('activityExcludeBudget').checked = !!act.excludeFromBudget;
            document.getElementById('activityDescription').value = act.description || '';
            document.getElementById('activityLink').value = act.link || '';
            document.getElementById('activityAddress').value = act.address || '';
            document.getElementById('activityLat').value = act.lat || '';
            document.getElementById('activityLng').value = act.lng || '';
            activityPicker.setValue(act.linkedResourceId || act.linkedResourceIdx || '');
        } else {
            title.textContent = 'Add Activity';
            document.getElementById('activityTitle').value = '';
            document.getElementById('activityCategory').value = 'sightseeing';
            document.getElementById('activityStartTime').value = '';
            document.getElementById('activityEndTime').value = '';
            document.getElementById('activityCost').value = '';
            document.getElementById('activityExcludeBudget').checked = false;
            document.getElementById('activityDescription').value = '';
            document.getElementById('activityLink').value = '';
            document.getElementById('activityAddress').value = '';
            document.getElementById('activityLat').value = '';
            document.getElementById('activityLng').value = '';
            activityPicker.clear();
        }

        // Show/hide exclude-from-budget checkbox based on whether cost is set
        const excludeRow = document.getElementById('activityExcludeBudgetRow');
        const costVal = parseFloat(document.getElementById('activityCost').value);
        if (excludeRow) excludeRow.style.display = costVal > 0 ? '' : 'none';

        // Show nudge toward resource linking only when adding a new activity
        // and there are shortlisted resources available to link
        const nudge = document.getElementById('activityResourceNudge');
        if (nudge) {
            const hasResources = (currentTrip.resources || []).some(r => (r.status || 'selected') === 'selected');
            nudge.style.display = (actIdx === null && hasResources) ? '' : 'none';
        }

        modal.classList.add('open');
    }

    function saveActivity() {
        if (!editingActivity) return;
        const { dayIdx, actIdx } = editingActivity;
        const title = document.getElementById('activityTitle').value.trim();
        if (!title) {
            document.getElementById('activityTitle').focus();
            return;
        }

        const activity = {
            id: (actIdx !== null && actIdx !== undefined) ? currentTrip.days[dayIdx].activities[actIdx].id : Storage.generateId(),
            title,
            category: document.getElementById('activityCategory').value,
            startTime: document.getElementById('activityStartTime').value,
            endTime: document.getElementById('activityEndTime').value,
            cost: parseFloat(document.getElementById('activityCost').value) || 0,
            excludeFromBudget: document.getElementById('activityExcludeBudget').checked,
            description: document.getElementById('activityDescription').value,
            link: document.getElementById('activityLink').value,
            address: document.getElementById('activityAddress').value,
            lat: parseFloat(document.getElementById('activityLat').value) || null,
            lng: parseFloat(document.getElementById('activityLng').value) || null,
            linkedResourceId: document.getElementById('activityLinkedResource').value || null,
        };

        if (actIdx !== null && actIdx !== undefined) {
            currentTrip.days[dayIdx].activities[actIdx] = activity;
        } else {
            currentTrip.days[dayIdx].activities.push(activity);
        }

        // Sort activities by start time (activities without time go to end)
        sortActivitiesByTime(currentTrip.days[dayIdx].activities);

        Storage.saveTrip(currentTrip);
        document.getElementById('activityModal').classList.remove('open');
        editingActivity = null;
        render();
        App.updateStats();
        Budget.update(currentTrip);
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
    }

    function buildTimelineBar(activities, dep, ret) {
        const timed = activities.filter(a => a.startTime);
        // Include endpoints in timing
        const endpointTimes = [];
        if (dep && dep.time) endpointTimes.push(dep.time);
        if (ret && ret.time) endpointTimes.push(ret.time);
        if (timed.length === 0 && endpointTimes.length === 0) return '';

        // Find day range from earliest start to latest end
        const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        let earliest = 24 * 60, latest = 0;
        timed.forEach(a => {
            const s = toMin(a.startTime);
            const e = a.endTime ? toMin(a.endTime) : s + 30;
            if (s < earliest) earliest = s;
            if (e > latest) latest = e;
        });
        endpointTimes.forEach(t => {
            const m = toMin(t);
            if (m < earliest) earliest = m;
            if (m > latest) latest = m;
        });

        // Snap to hour boundaries with padding
        earliest = Math.floor(earliest / 60) * 60;
        latest = Math.ceil(latest / 60) * 60;
        if (latest <= earliest) latest = earliest + 60;
        const span = latest - earliest;

        // Hour labels
        const hours = [];
        for (let m = earliest; m <= latest; m += 60) {
            const pct = ((m - earliest) / span) * 100;
            const h = Math.floor(m / 60);
            hours.push(`<span class="tbar-hour" style="left:${pct}%">${h}:00</span>`);
        }

        // Activity blocks
        const blocks = timed.map(a => {
            const s = toMin(a.startTime);
            const e = a.endTime ? toMin(a.endTime) : s + 30;
            const left = ((s - earliest) / span) * 100;
            const width = Math.max(((e - s) / span) * 100, 1.5);
            const cat = a.category || 'other';
            return `<div class="tbar-block ${cat}" style="left:${left}%;width:${width}%" title="${escapeHtml(a.title)}  ${a.startTime}${a.endTime ? '–' + a.endTime : ''}"></div>`;
        }).join('');

        // Endpoint markers on timeline
        let endpointMarkers = '';
        if (dep && dep.time) {
            const pct = ((toMin(dep.time) - earliest) / span) * 100;
            endpointMarkers += `<div class="tbar-endpoint departure" style="left:${pct}%" title="Depart ${dep.time}"></div>`;
        }
        if (ret && ret.time) {
            const pct = ((toMin(ret.time) - earliest) / span) * 100;
            endpointMarkers += `<div class="tbar-endpoint return" style="left:${pct}%" title="Return ${ret.time}"></div>`;
        }

        return `
            <div class="timeline-bar">
                <div class="tbar-track">
                    ${hours.join('')}
                    ${blocks}
                    ${endpointMarkers}
                </div>
            </div>
        `;
    }

    function sortActivitiesByTime(activities) {
        activities.sort((a, b) => {
            // Activities with start time come first, sorted by time
            // Activities without start time keep their relative order at the end
            if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
            if (a.startTime && !b.startTime) return -1;
            if (!a.startTime && b.startTime) return 1;
            return 0;
        });
    }

    function deleteActivity(dayIdx, actIdx) {
        if (!confirm('Delete this activity?')) return;
        currentTrip.days[dayIdx].activities.splice(actIdx, 1);
        Storage.saveTrip(currentTrip);
        render();
        App.updateStats();
        Budget.update(currentTrip);
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    // ===== Geographic utilities =====

    function haversineKm(lat1, lng1, lat2, lng2) {
        const R = 6371, rad = Math.PI / 180;
        const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.asin(Math.sqrt(a));
    }

    function daySpreadKm(activities) {
        const pts = activities.filter(a => a.lat && a.lng);
        if (pts.length < 2) return 0;
        const lats = pts.map(a => a.lat), lngs = pts.map(a => a.lng);
        return haversineKm(
            Math.min(...lats), Math.min(...lngs),
            Math.max(...lats), Math.max(...lngs)
        );
    }

    function dayLoadLevel(activities) {
        if (!activities.length) return '';
        const count = activities.length;
        const spread = daySpreadKm(activities);
        if (count >= 7 || spread >= 15) return 'red';
        if (count >= 4 || spread >= 5)  return 'amber';
        return 'green';
    }

    function formatDistance(km) {
        return km < 1 ? `${Math.round(km * 1000)}\u00a0m` : `${km.toFixed(1)}\u00a0km`;
    }

    // ===== OSRM routing =====
    const osrmCache = {};
    let osrmLastFetch = 0;
    const OSRM_MIN_INTERVAL = 300; // ms between requests to respect demo server

    async function fetchOsrmSegment(lat1, lng1, lat2, lng2) {
        const key = `${lat1},${lng1}|${lat2},${lng2}`;
        if (osrmCache[key]) return osrmCache[key];

        // Rate limit: wait if last request was too recent
        const now = Date.now();
        const wait = OSRM_MIN_INTERVAL - (now - osrmLastFetch);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        osrmLastFetch = Date.now();

        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
            const r = await fetch(url);
            if (!r.ok) { console.warn(`[OSRM] ${r.status} for ${url}`); return null; }
            const data = await r.json();
            const route = data.routes && data.routes[0];
            if (!route) return null;
            const result = { duration: route.duration, distance: route.distance };
            osrmCache[key] = result;
            return result;
        } catch (e) {
            console.warn('[OSRM] fetch failed:', e.message);
            return null;
        }
    }

    function formatOsrmGap(result, walkingHint) {
        const distKm = result.distance / 1000;
        const distStr = formatDistance(distKm);
        const mins = walkingHint
            ? Math.round((distKm / 5) * 60)   // 5 km/h walking estimate
            : Math.round(result.duration / 60); // OSRM driving duration
        if (mins < 1) return distStr;
        return `${distStr} · ~${mins}\u00a0min`;
    }

    async function updateOsrmGaps(dayIdx, activities, dep, ret) {
        // Build flat list of segments: { lat1, lng1, lat2, lng2, gapId }
        const segments = [];

        // Collect waypoints with their gap element IDs
        // dep → first act: data-gap="${dayIdx}-dep"
        // act[i] → act[i+1]: data-gap="${dayIdx}-i"
        // last act → ret: data-gap="${dayIdx}-ret"

        const validActs = activities.map((a, i) => ({ lat: a.lat, lng: a.lng, idx: i, valid: !!(a.lat && a.lng) }));

        if (dep && dep.lat && dep.lng) {
            const first = validActs.find(a => a.valid);
            if (first) segments.push({ lat1: dep.lat, lng1: dep.lng, lat2: first.lat, lng2: first.lng, gapId: `${dayIdx}-dep` });
        }

        for (let i = 0; i < activities.length - 1; i++) {
            const a = activities[i], b = activities[i + 1];
            if (!a.lat || !a.lng || !b.lat || !b.lng) continue;
            segments.push({ lat1: a.lat, lng1: a.lng, lat2: b.lat, lng2: b.lng, gapId: `${dayIdx}-${i}` });
        }

        if (ret && ret.lat && ret.lng) {
            const last = [...validActs].reverse().find(a => a.valid);
            if (last) segments.push({ lat1: last.lat, lng1: last.lng, lat2: ret.lat, lng2: ret.lng, gapId: `${dayIdx}-ret` });
        }

        const day = currentTrip.days[dayIdx];
        const overrides = day.gapOverrides || {};

        for (const seg of segments) {
            const el = document.querySelector(`.activity-gap[data-gap="${seg.gapId}"]`);
            if (!el) continue;

            // If user has set a manual time override, show it without fetching OSRM
            if (overrides[seg.gapId] !== undefined) {
                renderGapOverride(el, seg.gapId, dayIdx, overrides[seg.gapId]);
                continue;
            }

            const straightKm = haversineKm(seg.lat1, seg.lng1, seg.lat2, seg.lng2);
            if (straightKm > 800) continue; // skip — likely a flight, no meaningful driving route
            const isWalkable = straightKm < 2;
            // OSRM demo server only supports driving — use it for routing distance,
            // then estimate walk time from road distance for short segments
            const result = await fetchOsrmSegment(seg.lat1, seg.lng1, seg.lat2, seg.lng2);
            if (!result) continue;
            const distKm = result.distance / 1000;
            const cls = distKm >= 8 ? 'red' : distKm >= 2 ? 'amber' : '';
            const icon = isWalkable
                ? '<i class="fa-solid fa-person-walking"></i>'
                : '<i class="fa-solid fa-car"></i>';
            el.className = `activity-gap ${cls}`;
            el.innerHTML = `${icon} ${formatOsrmGap(result, isWalkable)} <button class="gap-edit-btn" title="Override travel time" onclick="Itinerary.promptGapOverride(${dayIdx},'${seg.gapId}',${Math.round(isWalkable ? (result.distance/1000/5*60) : result.duration/60)})"><i class="fa-solid fa-pen-to-square"></i></button>`;
        }
    }

    function renderGapOverride(el, gapId, dayIdx, minutes) {
        el.className = 'activity-gap gap-overridden';
        el.innerHTML = `<i class="fa-solid fa-person-walking"></i> ~${minutes}\u00a0min <span class="gap-override-tag">custom</span><button class="gap-edit-btn" title="Edit override" onclick="Itinerary.promptGapOverride(${dayIdx},'${gapId}',${minutes})"><i class="fa-solid fa-pen-to-square"></i></button><button class="gap-edit-btn gap-clear-btn" title="Clear override" onclick="Itinerary.clearGapOverride(${dayIdx},'${gapId}')"><i class="fa-solid fa-xmark"></i></button>`;
    }

    function promptGapOverride(dayIdx, gapId, currentMins) {
        const input = prompt('Travel time in minutes:', currentMins ?? '');
        if (input === null) return;
        const mins = parseInt(input);
        if (isNaN(mins) || mins < 0) return;
        const day = currentTrip.days[dayIdx];
        if (!day.gapOverrides) day.gapOverrides = {};
        day.gapOverrides[gapId] = mins;
        Storage.saveTrip(currentTrip);
        const el = document.querySelector(`.activity-gap[data-gap="${gapId}"]`);
        if (el) renderGapOverride(el, gapId, dayIdx, mins);
    }

    function clearGapOverride(dayIdx, gapId) {
        const day = currentTrip.days[dayIdx];
        if (day.gapOverrides) delete day.gapOverrides[gapId];
        Storage.saveTrip(currentTrip);
        // Re-render so OSRM fetches again
        render();
    }

    function getCategoryIcon(cat) {
        const icons = {
            sightseeing: 'fa-camera',
            food: 'fa-utensils',
            transport: 'fa-plane',
            lodging: 'fa-bed',
            activity: 'fa-person-hiking',
            shopping: 'fa-bag-shopping',
            other: 'fa-ellipsis',
        };
        return icons[cat] || 'fa-location-dot';
    }

    function getLodgingForDay(dayDate) {
        if (!dayDate || !currentTrip.reservations) return [];
        return currentTrip.reservations.filter(r => {
            if (r.type !== 'hotel') return false;
            if (r.checkIn && r.checkOut) {
                return dayDate >= r.checkIn && dayDate <= r.checkOut;
            }
            // Fall back to single date
            return r.date === dayDate;
        });
    }

    function render() {
        const container = document.getElementById('itineraryDays');
        if (!currentTrip || currentTrip.days.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-calendar-plus"></i>
                    <p>No days planned yet. Set your trip dates in Overview to auto-generate days.</p>
                    <button class="btn btn-small" onclick="Itinerary.addDay()"><i class="fa-solid fa-plus"></i> Add Day</button>
                </div>
            `;
            updateDayFilter();
            return;
        }

        let activityCounter = 1;
        container.innerHTML = currentTrip.days.map((day, dayIdx) => {
            const actCount = day.activities.length;

            // Find lodging reservations that span this day
            const lodgings = getLodgingForDay(day.date);
            const dep = day.lodgingDeparture || null;
            const ret = day.lodgingReturn || null;

            const lodgingHtml = lodgings.map(res => {
                const resIdx = currentTrip.reservations.indexOf(res);
                const nights = (res.checkIn && res.checkOut) ? Math.ceil((new Date(res.checkOut) - new Date(res.checkIn)) / (1000*60*60*24)) : 0;
                const isCheckIn = res.checkIn === day.date;
                const isCheckOut = res.checkOut === day.date;
                let label = '';
                if (isCheckIn && res.checkInTime) label = `Check-in ${res.checkInTime}`;
                else if (isCheckIn) label = 'Check-in';
                else if (isCheckOut && res.checkOutTime) label = `Check-out ${res.checkOutTime}`;
                else if (isCheckOut) label = 'Check-out';
                const lodgingCity = getLodgingCity(res);
                const isDep = dep && dep.reservationIdx === resIdx;
                const isRet = ret && ret.reservationIdx === resIdx;
                return `
                    <div class="lodging-banner"${res.linkedResourceId ? ` data-marker-key="res-${res.linkedResourceId}"` : ''}>
                        <i class="fa-solid fa-bed"></i>
                        <div class="lodging-banner-info">
                            <span class="lodging-banner-title">${escapeHtml(res.title)}${lodgingCity ? `<span class="location-label"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(lodgingCity)}</span>` : ''}</span>
                            ${label ? `<span class="lodging-banner-label">${label}</span>` : ''}
                            ${res.provider ? `<span class="lodging-banner-provider">${escapeHtml(res.provider)}</span>` : ''}
                        </div>
                        ${nights > 0 ? `<span class="lodging-banner-nights">${nights}n</span>` : ''}
                        <div class="lodging-day-actions">
                            <button class="lodging-toggle ${isDep ? 'active' : ''}" title="Depart from here" onclick="event.stopPropagation(); Itinerary.setLodgingEndpoint(${dayIdx}, ${resIdx}, 'departure')"><i class="fa-solid fa-right-from-bracket"></i></button>
                            ${isDep ? `<input type="time" class="lodging-time-input" value="${dep.time || ''}" title="Departure time" onchange="Itinerary.setLodgingTime(${dayIdx}, 'departure', this.value)" onclick="event.stopPropagation()" />` : ''}
                            <button class="lodging-toggle ${isRet ? 'active' : ''}" title="Return here" onclick="event.stopPropagation(); Itinerary.setLodgingEndpoint(${dayIdx}, ${resIdx}, 'return')"><i class="fa-solid fa-right-to-bracket"></i></button>
                            ${isRet ? `<input type="time" class="lodging-time-input" value="${ret.time || ''}" title="Return time" onchange="Itinerary.setLodgingTime(${dayIdx}, 'return', this.value)" onclick="event.stopPropagation()" />` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            let activitiesHtml = '';
            const gapOverrides = day.gapOverrides || {};
            // Gap from lodging departure to first activity
            const firstAct = day.activities[0];
            if (dep && dep.lat && dep.lng && firstAct && firstAct.lat && firstAct.lng) {
                const gapId = `${dayIdx}-dep`;
                if (gapOverrides[gapId] !== undefined) {
                    activitiesHtml += `<div class="activity-gap gap-overridden" data-gap="${gapId}"><i class="fa-solid fa-person-walking"></i> ~${gapOverrides[gapId]}\u00a0min <span class="gap-override-tag">custom</span><button class="gap-edit-btn" title="Edit override" onclick="Itinerary.promptGapOverride(${dayIdx},'${gapId}',${gapOverrides[gapId]})"><i class="fa-solid fa-pen-to-square"></i></button><button class="gap-edit-btn gap-clear-btn" title="Clear override" onclick="Itinerary.clearGapOverride(${dayIdx},'${gapId}')"><i class="fa-solid fa-xmark"></i></button></div>`;
                } else {
                    const km = haversineKm(dep.lat, dep.lng, firstAct.lat, firstAct.lng);
                    const cls = km >= 8 ? 'red' : km >= 2 ? 'amber' : '';
                    activitiesHtml += `<div class="activity-gap ${cls}" data-gap="${gapId}"><i class="fa-solid fa-arrow-down"></i>${formatDistance(km)}</div>`;
                }
            }
            day.activities.forEach((act, actIdx) => {
                activityCounter++;
                const timeStr = act.startTime ? `${act.startTime}${act.endTime ? ' - ' + act.endTime : ''}` : '';
                const city = getCity(act);
                activitiesHtml += `
                    <div class="activity-card" draggable="true" data-day="${dayIdx}" data-act="${actIdx}" data-marker-key="act-${dayIdx}-${actIdx}">
                        ${act.startTime ? `<span class="activity-time-label">${act.startTime}</span>` : ''}
                        <div class="activity-marker ${act.category}"><i class="fa-solid ${getCategoryIcon(act.category)}"></i></div>
                        <div class="activity-top-row">
                            <span class="activity-title-group">
                                <span class="activity-title">${escapeHtml(act.title)}</span>
                                ${city ? `<span class="location-label"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(city)}</span>` : ''}
                            </span>
                            <span class="activity-time">${timeStr}</span>
                        </div>
                        <div class="activity-details">
                            ${act.description ? `<div>${escapeHtml(act.description)}</div>` : ''}
                            ${act.address ? `<div class="activity-address"><i class="fa-solid fa-location-dot"></i>${escapeHtml(act.address)}</div>` : ''}
                        </div>
                        <div class="activity-bottom-row">
                            <div class="activity-tags">
                                <span class="activity-tag ${act.category}">${act.category}</span>
                                ${act.cost ? `<span class="activity-tag other">${getCurrencySymbol(currentTrip.budgetCurrency)}${act.cost}</span>` : ''}
                            </div>
                            <div class="activity-actions">
                                ${act.lat && act.lng ? `<button title="Show on map" onclick="Itinerary.showOnMap(${act.lat}, ${act.lng})"><i class="fa-solid fa-map-location-dot"></i></button>` : ''}
                                ${act.link ? `<button title="Open link" onclick="window.open('${escapeHtml(act.link)}', '_blank')"><i class="fa-solid fa-external-link"></i></button>` : ''}
                                <button title="Edit" onclick="Itinerary.openActivityModal(${dayIdx}, ${actIdx})"><i class="fa-solid fa-pen"></i></button>
                                <button class="btn-delete" title="Delete" onclick="Itinerary.deleteActivity(${dayIdx}, ${actIdx})"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                    </div>
                `;
                // Gap to next activity (haversine shown immediately, OSRM updates async)
                const next = day.activities[actIdx + 1];
                if (next && act.lat && act.lng && next.lat && next.lng) {
                    const gapId = `${dayIdx}-${actIdx}`;
                    if (gapOverrides[gapId] !== undefined) {
                        activitiesHtml += `<div class="activity-gap gap-overridden" data-gap="${gapId}"><i class="fa-solid fa-person-walking"></i> ~${gapOverrides[gapId]}\u00a0min <span class="gap-override-tag">custom</span><button class="gap-edit-btn" title="Edit override" onclick="Itinerary.promptGapOverride(${dayIdx},'${gapId}',${gapOverrides[gapId]})"><i class="fa-solid fa-pen-to-square"></i></button><button class="gap-edit-btn gap-clear-btn" title="Clear override" onclick="Itinerary.clearGapOverride(${dayIdx},'${gapId}')"><i class="fa-solid fa-xmark"></i></button></div>`;
                    } else {
                        const km = haversineKm(act.lat, act.lng, next.lat, next.lng);
                        const cls = km >= 8 ? 'red' : km >= 2 ? 'amber' : '';
                        activitiesHtml += `<div class="activity-gap ${cls}" data-gap="${gapId}"><i class="fa-solid fa-arrow-down"></i>${formatDistance(km)}</div>`;
                    }
                }
                // Gap from last activity back to lodging return point
                if (actIdx === day.activities.length - 1 && ret && ret.lat && ret.lng && act.lat && act.lng) {
                    const gapId = `${dayIdx}-ret`;
                    if (gapOverrides[gapId] !== undefined) {
                        activitiesHtml += `<div class="activity-gap gap-overridden" data-gap="${gapId}"><i class="fa-solid fa-person-walking"></i> ~${gapOverrides[gapId]}\u00a0min <span class="gap-override-tag">custom</span><button class="gap-edit-btn" title="Edit override" onclick="Itinerary.promptGapOverride(${dayIdx},'${gapId}',${gapOverrides[gapId]})"><i class="fa-solid fa-pen-to-square"></i></button><button class="gap-edit-btn gap-clear-btn" title="Clear override" onclick="Itinerary.clearGapOverride(${dayIdx},'${gapId}')"><i class="fa-solid fa-xmark"></i></button></div>`;
                    } else {
                        const km = haversineKm(act.lat, act.lng, ret.lat, ret.lng);
                        const cls = km >= 8 ? 'red' : km >= 2 ? 'amber' : '';
                        activitiesHtml += `<div class="activity-gap ${cls}" data-gap="${gapId}"><i class="fa-solid fa-arrow-down"></i>${formatDistance(km)}</div>`;
                    }
                }
            });

            return `
                <div class="day-card" data-day="${dayIdx}">
                    <div class="day-header" onclick="Itinerary.toggleDay(${dayIdx})">
                        <div class="day-header-left">
                            <i class="fa-solid fa-chevron-down"></i>
                            <div>
                                <div class="day-title">Day ${dayIdx + 1}${day.label ? ' — ' + escapeHtml(day.label) : ''}</div>
                                <div class="day-date">${formatDate(day.date)} <span class="day-summary">${actCount} ${actCount === 1 ? 'activity' : 'activities'}${(() => { const lvl = dayLoadLevel(day.activities); const spread = daySpreadKm(day.activities); return lvl ? `<span class="day-load-badge ${lvl}" title="${actCount} activities, ${spread > 0 ? formatDistance(spread) + ' spread' : 'no location data'}"></span>` : ''; })()}</span></div>
                                ${day.date ? `<div class="day-weather" data-weather-date="${day.date}"></div>` : ''}
                            </div>
                        </div>
                        <div class="day-header-actions">
                            <button title="Show day on map" onclick="event.stopPropagation(); Itinerary.filterMapToDay(${dayIdx})"><i class="fa-solid fa-map"></i></button>
                            <button title="Delete day" onclick="event.stopPropagation(); Itinerary.removeDay(${dayIdx})"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="day-body">
                        ${lodgingHtml}
                        ${buildTimelineBar(day.activities, dep, ret)}
                        <div class="activity-timeline" data-day="${dayIdx}">
                            ${buildEndpointHtml(dep, 'departure')}
                            ${activitiesHtml}
                            ${buildEndpointHtml(ret, 'return')}
                        </div>
                        <button class="add-activity-btn" onclick="Itinerary.openActivityModal(${dayIdx}, null)">
                            <i class="fa-solid fa-plus"></i> Add activity
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        updateDayFilter();
        updateDayScroll();
        if (typeof Weather !== 'undefined') Weather.renderOnly();
        setupDragAndDrop();

        // Async OSRM travel time — run days sequentially to avoid bursting the demo server
        (async () => {
            for (let dayIdx = 0; dayIdx < currentTrip.days.length; dayIdx++) {
                const day = currentTrip.days[dayIdx];
                const dep = day.lodgingDeparture || null;
                const ret = day.lodgingReturn || null;
                const hasGaps = day.activities.length > 1
                    || (dep && dep.lat && day.activities[0]?.lat)
                    || (ret && ret.lat && day.activities[day.activities.length - 1]?.lat);
                if (hasGaps) await updateOsrmGaps(dayIdx, day.activities, dep, ret);
            }
        })();

        // Lodging banner + endpoint hover/click to highlight/focus marker
        document.querySelectorAll('.lodging-banner[data-marker-key], .lodging-endpoint[data-marker-key]').forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('mouseenter', () => {
                MapModule.highlightMarker(el.dataset.markerKey);
            });
            el.addEventListener('mouseleave', () => {
                MapModule.clearHighlight();
            });
            el.addEventListener('click', (e) => {
                if (e.target.closest('.lodging-day-actions')) return;
                MapModule.focusMarker(el.dataset.markerKey);
            });
        });
    }

    function toggleDay(dayIdx) {
        const card = document.querySelector(`.day-card[data-day="${dayIdx}"]`);
        if (card) card.classList.toggle('collapsed');
    }

    let dayScrollObserver = null;

    function updateDayScroll() {
        const sidebar = document.getElementById('dayScroll');
        if (!sidebar) return;

        if (!currentTrip || !currentTrip.days.length) {
            sidebar.innerHTML = '';
            return;
        }

        sidebar.innerHTML = currentTrip.days.map((day, idx) => {
            let dateHtml = '';
            if (day.date) {
                const [y, m, d] = day.date.split('-').map(Number);
                const dt = new Date(y, m - 1, d);
                const mon = dt.toLocaleString('default', { month: 'short' });
                dateHtml = `<span class="dsi-mon">${mon}</span><span class="dsi-day">${d}</span>`;
            }
            return `<div class="day-scroll-item" data-scroll-day="${idx}" title="Day ${idx + 1}${day.date ? ' — ' + day.date : ''}" onclick="Itinerary.scrollToDay(${idx})">
                <span class="dsi-num">${idx + 1}</span>
                ${dateHtml}
            </div>`;
        }).join('');

        // Disconnect previous observer
        if (dayScrollObserver) dayScrollObserver.disconnect();

        const panelContent = document.querySelector('.panel-content');
        if (!panelContent) return;

        dayScrollObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const dayIdx = entry.target.dataset.day;
                const pill = sidebar.querySelector(`[data-scroll-day="${dayIdx}"]`);
                if (pill) pill.classList.toggle('in-view', entry.isIntersecting);
            });
        }, { root: panelContent, threshold: 0.1 });

        document.querySelectorAll('#itineraryDays .day-card').forEach(card => {
            dayScrollObserver.observe(card);
        });
    }

    function scrollToDay(idx) {
        const card = document.querySelector(`#itineraryDays .day-card[data-day="${idx}"]`);
        if (!card) return;
        if (card.classList.contains('collapsed')) card.classList.remove('collapsed');
        const panelContent = document.querySelector('.panel-content');
        if (panelContent) {
            const containerRect = panelContent.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            panelContent.scrollTo({
                top: panelContent.scrollTop + (cardRect.top - containerRect.top) - 8,
                behavior: 'smooth',
            });
        }
    }

    function showOnMap(lat, lng) {
        MapModule.panTo(lat, lng, 16);
    }

    function filterMapToDay(dayIdx) {
        const select = document.getElementById('mapDayFilter');
        // Toggle: if already filtering this day, go back to all
        select.value = select.value === String(dayIdx) ? 'all' : String(dayIdx);
        select.dispatchEvent(new Event('change'));
    }

    function updateDayFilter() {
        const select = document.getElementById('mapDayFilter');
        const currentValue = select.value;
        select.innerHTML = '<option value="all">All Days</option>';
        if (currentTrip) {
            currentTrip.days.forEach((day, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = `Day ${idx + 1}${day.date ? ' — ' + day.date : ''}`;
                select.appendChild(opt);
            });
        }
        select.value = currentValue;
    }

    function setupDragAndDrop() {
        document.querySelectorAll('.activity-card[draggable]').forEach(card => {
            // Hover-to-highlight marker on map
            card.addEventListener('mouseenter', () => {
                const key = card.dataset.markerKey;
                if (key) MapModule.highlightMarker(key);
            });
            card.addEventListener('mouseleave', () => {
                MapModule.clearHighlight();
            });
            // Click to zoom into marker (ignore clicks on action buttons)
            card.addEventListener('click', (e) => {
                if (e.target.closest('.activity-actions')) return;
                const key = card.dataset.markerKey;
                if (key) MapModule.focusMarker(key);
            });

            card.addEventListener('dragstart', (e) => {
                dragState = {
                    dayIdx: parseInt(card.dataset.day),
                    actIdx: parseInt(card.dataset.act),
                };
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                document.querySelectorAll('.activity-card.drag-over').forEach(el => el.classList.remove('drag-over'));
                dragState = null;
            });

            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                card.classList.add('drag-over');
            });

            card.addEventListener('dragleave', () => {
                card.classList.remove('drag-over');
            });

            card.addEventListener('drop', (e) => {
                e.preventDefault();
                card.classList.remove('drag-over');
                if (!dragState) return;

                const toDayIdx = parseInt(card.dataset.day);
                const toActIdx = parseInt(card.dataset.act);
                const { dayIdx: fromDayIdx, actIdx: fromActIdx } = dragState;

                if (fromDayIdx === toDayIdx && fromActIdx === toActIdx) return;

                // Remove from source
                const [activity] = currentTrip.days[fromDayIdx].activities.splice(fromActIdx, 1);
                // Insert at target
                currentTrip.days[toDayIdx].activities.splice(toActIdx, 0, activity);

                Storage.saveTrip(currentTrip);
                render();
                MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
            });
        });
    }

    function buildEndpointHtml(endpoint, type) {
        if (!endpoint) return '';
        // Always read title fresh from the reservation (source of truth)
        let title = endpoint.title || 'Hotel';
        if (endpoint.reservationIdx !== undefined && currentTrip.reservations[endpoint.reservationIdx]) {
            title = currentTrip.reservations[endpoint.reservationIdx].title || title;
        }
        const icon = type === 'departure' ? 'fa-right-from-bracket' : 'fa-right-to-bracket';
        const label = type === 'departure' ? 'Depart' : 'Return';
        const markerKey = endpoint.resourceId ? `res-${endpoint.resourceId}` : '';
        return `
            <div class="lodging-endpoint ${type}"${markerKey ? ` data-marker-key="${markerKey}"` : ''}>
                <div class="endpoint-marker lodging"><i class="fa-solid ${icon}"></i></div>
                <div class="endpoint-info">
                    <span class="endpoint-label">${label}</span>
                    <span class="endpoint-title">${escapeHtml(title)}</span>
                    ${endpoint.time ? `<span class="endpoint-time">${endpoint.time}</span>` : ''}
                </div>
            </div>
        `;
    }

    function setLodgingEndpoint(dayIdx, reservationIdx, type) {
        const day = currentTrip.days[dayIdx];
        const key = type === 'departure' ? 'lodgingDeparture' : 'lodgingReturn';
        if (day[key] && day[key].reservationIdx === reservationIdx) {
            // Toggle off
            delete day[key];
        } else {
            const reservation = currentTrip.reservations[reservationIdx];
            const endpoint = { reservationIdx, time: '' };
            if (reservation) {
                endpoint.title = reservation.title;
                let resource = null;
                // Try linked resource first
                if (reservation.linkedResourceId) {
                    resource = (currentTrip.resources || []).find(r => r.id === reservation.linkedResourceId);
                }
                // Fallback: find resource by matching title
                if (!resource || !resource.lat) {
                    resource = (currentTrip.resources || []).find(r =>
                        r.lat && r.lng && r.title && reservation.title &&
                        (r.title.includes(reservation.title) || reservation.title.includes(r.title))
                    );
                }
                if (resource && resource.lat && resource.lng) {
                    endpoint.lat = resource.lat;
                    endpoint.lng = resource.lng;
                    endpoint.resourceId = resource.id;
                }
            }
            day[key] = endpoint;
        }
        Storage.saveTrip(currentTrip);
        render();
        MapModule.updateMarkers(currentTrip, document.getElementById('mapDayFilter').value);
    }

    function setLodgingTime(dayIdx, type, time) {
        const day = currentTrip.days[dayIdx];
        const key = type === 'departure' ? 'lodgingDeparture' : 'lodgingReturn';
        if (day[key]) {
            day[key].time = time;
            Storage.saveTrip(currentTrip);
            render();
        }
    }

    function autoAssignLodgingEndpoints(reservation) {
        if (reservation.type !== 'hotel') return 0;
        if (!reservation.checkIn || !reservation.checkOut) return 0;

        // Resolve coordinates from linked resource (or title match)
        let lat = null, lng = null, resourceId = null;
        let resource = null;
        if (reservation.linkedResourceId) {
            resource = (currentTrip.resources || []).find(r => r.id === reservation.linkedResourceId);
        }
        if (!resource || !resource.lat) {
            resource = (currentTrip.resources || []).find(r =>
                r.lat && r.lng && r.title && reservation.title &&
                (r.title.includes(reservation.title) || reservation.title.includes(r.title))
            );
        }
        if (resource && resource.lat && resource.lng) {
            lat = resource.lat;
            lng = resource.lng;
            resourceId = resource.id;
        }

        const resIdx = currentTrip.reservations.indexOf(reservation);
        let assigned = 0;

        currentTrip.days.forEach(day => {
            if (!day.date) return;
            if (day.date < reservation.checkIn || day.date > reservation.checkOut) return;

            const isCheckIn  = day.date === reservation.checkIn;
            const isCheckOut = day.date === reservation.checkOut;

            // Check-in day: set return only (arriving at hotel in evening)
            // Check-out day: set departure only (leaving hotel in morning)
            // Intermediate days: set both
            const setDep = !isCheckIn;   // depart from hotel unless it's arrival day
            const setRet = !isCheckOut;  // return to hotel unless it's departure day

            const endpoint = { reservationIdx: resIdx, title: reservation.title, time: '' };
            if (lat) { endpoint.lat = lat; endpoint.lng = lng; endpoint.resourceId = resourceId; }

            let changed = false;
            if (setDep && !day.lodgingDeparture) { day.lodgingDeparture = { ...endpoint }; changed = true; }
            if (setRet && !day.lodgingReturn)    { day.lodgingReturn    = { ...endpoint }; changed = true; }
            if (changed) assigned++;
        });

        return assigned;
    }

    function getLodgingCity(res) {
        if (res.linkedResourceId && currentTrip.resources) {
            const linked = currentTrip.resources.find(r => r.id === res.linkedResourceId);
            if (linked && linked.city) return linked.city;
        }
        return '';
    }

    function getCity(act) {
        // Try linked resource first
        if (act.linkedResourceId && currentTrip.resources) {
            const res = currentTrip.resources.find(r => r.id === act.linkedResourceId);
            if (res && res.city) return res.city;
        }
        // Fall back to extracting from address (last meaningful part)
        if (act.address) {
            const parts = act.address.split(',').map(p => p.trim()).filter(Boolean);
            if (parts.length >= 2) return parts[parts.length - 2];
        }
        return '';
    }

    function getCurrencySymbol(code) {
        const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'Fr', CAD: '$', AUD: '$', THB: '฿' };
        return symbols[code] || code + ' ';
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

    return {
        init,
        update,
        render,
        generateDaysFromDates,
        addDay,
        removeDay,
        openActivityModal,
        saveActivity,
        deleteActivity,
        toggleDay,
        scrollToDay,
        showOnMap,
        filterMapToDay,
        setLodgingEndpoint,
        setLodgingTime,
        autoAssignLodgingEndpoints,
        promptGapOverride,
        clearGapOverride,
    };
})();
