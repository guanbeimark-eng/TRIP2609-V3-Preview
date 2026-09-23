/* ===== Weather Module ===== */
const Weather = (() => {
    let currentTrip = null;
    let cache = {};       // YYYY-MM-DD → WeatherData (includes tzOffset)
    let fetchPending = false;

    // WMO weather interpretation codes
    const WMO = {
        0:  { icon: '☀️',  label: 'Clear sky' },
        1:  { icon: '🌤',  label: 'Mainly clear' },
        2:  { icon: '⛅',  label: 'Partly cloudy' },
        3:  { icon: '☁️',  label: 'Overcast' },
        45: { icon: '🌫',  label: 'Fog' },
        48: { icon: '🌫',  label: 'Icy fog' },
        51: { icon: '🌦',  label: 'Light drizzle' },
        53: { icon: '🌦',  label: 'Drizzle' },
        55: { icon: '🌧',  label: 'Heavy drizzle' },
        61: { icon: '🌧',  label: 'Light rain' },
        63: { icon: '🌧',  label: 'Rain' },
        65: { icon: '🌧',  label: 'Heavy rain' },
        71: { icon: '❄️',  label: 'Light snow' },
        73: { icon: '❄️',  label: 'Snow' },
        75: { icon: '❄️',  label: 'Heavy snow' },
        77: { icon: '❄️',  label: 'Snow grains' },
        80: { icon: '🌦',  label: 'Light showers' },
        81: { icon: '🌦',  label: 'Showers' },
        82: { icon: '🌧',  label: 'Heavy showers' },
        85: { icon: '🌨',  label: 'Snow showers' },
        86: { icon: '🌨',  label: 'Heavy snow showers' },
        95: { icon: '⛈',  label: 'Thunderstorm' },
        96: { icon: '⛈',  label: 'Thunderstorm w/ hail' },
        99: { icon: '⛈',  label: 'Heavy thunderstorm' },
    };

    function wmoIcon(code) {
        if (code == null) return '';
        if (WMO[code]) return WMO[code].icon;
        if (code <= 3)  return '⛅';
        if (code <= 48) return '🌫';
        if (code <= 67) return '🌧';
        if (code <= 77) return '❄️';
        if (code <= 82) return '🌦';
        if (code <= 86) return '🌨';
        return '⛈';
    }

    function wmoLabel(code) {
        return WMO[code]?.label || '';
    }

    // ===== Sunrise/sunset via NOAA astronomical algorithm =====
    // Returns UTC minutes from midnight for sunrise and sunset, or null for polar day/night.
    function solarTimesUTC(lat, lng, dateStr) {
        const D = Math.PI / 180;
        const [y, m, d] = dateStr.split('-').map(Number);

        const jd = 367*y - Math.floor(7*(y + Math.floor((m+9)/12))/4)
                 + Math.floor(275*m/9) + d + 1721013.5;
        const t  = (jd - 2451545) / 36525;

        const L0 = (280.46646 + t*(36000.76983 + t*0.0003032)) % 360;
        const M  = 357.52911 + t*(35999.05029 - t*0.0001537);
        const C  = Math.sin(M*D)*(1.914602 - t*(0.004817 + 0.000014*t))
                 + Math.sin(2*M*D)*(0.019993 - 0.000101*t)
                 + Math.sin(3*M*D)*0.000289;

        const om = 125.04 - 1934.136*t;
        const lm = (L0 + C) - 0.00569 - 0.00478*Math.sin(om*D);
        const e0 = 23 + (26 + (21.448 - t*(46.815 + t*(0.00059 - t*0.001813)))/60)/60;
        const e  = e0 + 0.00256*Math.cos(om*D);

        const sinDec = Math.sin(e*D) * Math.sin(lm*D);
        const dec    = Math.asin(sinDec);

        const y2  = Math.tan(e*D/2) ** 2;
        const eqt = 4/D * (y2*Math.sin(2*L0*D) - 2*0.016708634*Math.sin(M*D)
                  + 4*0.016708634*y2*Math.sin(M*D)*Math.cos(2*L0*D)
                  - 0.5*y2**2*Math.sin(4*L0*D)
                  - 1.25*0.016708634**2*Math.sin(2*M*D));

        const cosHA = (Math.cos(90.833*D) - Math.sin(lat*D)*sinDec)
                    / (Math.cos(lat*D)*Math.cos(dec));
        if (cosHA < -1 || cosHA > 1) return null;

        const ha   = Math.acos(cosHA) / D;
        const noon = 720 - 4*lng - eqt;
        return { rise: noon - 4*ha, set: noon + 4*ha };
    }

    function utcMinsToHHMM(utcMins, offsetSecs) {
        const local = ((utcMins + offsetSecs / 60) % 1440 + 1440) % 1440;
        return `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(Math.floor(local % 60)).padStart(2, '0')}`;
    }

    // Best coordinates for a specific day
    function getDayCoords(day) {
        if (day.lodgingDeparture?.lat) return { lat: +day.lodgingDeparture.lat, lng: +day.lodgingDeparture.lng };
        if (day.lodgingReturn?.lat)    return { lat: +day.lodgingReturn.lat,    lng: +day.lodgingReturn.lng };
        const act = (day.activities || []).find(a => a.lat && a.lng);
        if (act) return { lat: +act.lat, lng: +act.lng };
        return null;
    }

    // Centroid of all trip coordinates (fallback when a day has no coords)
    function getTripCoords() {
        if (!currentTrip) return null;
        const pts = [];
        (currentTrip.resources || []).forEach(r => {
            if (r.lat && r.lng) pts.push([+r.lat, +r.lng]);
        });
        (currentTrip.days || []).forEach(d => {
            (d.activities || []).forEach(a => { if (a.lat && a.lng) pts.push([+a.lat, +a.lng]); });
            if (d.lodgingDeparture?.lat) pts.push([+d.lodgingDeparture.lat, +d.lodgingDeparture.lng]);
        });
        if (!pts.length) return null;
        const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        return { lat: parseFloat(lat.toFixed(4)), lng: parseFloat(lng.toFixed(4)) };
    }

    // Group days by per-day coordinates, rounded to ~0.5° (~50 km) to batch nearby days
    function groupDaysByCoords(days, fallbackCoords) {
        const groups = {}; // rounded-key → { lat, lng, dates }
        days.forEach(day => {
            const c = getDayCoords(day) || fallbackCoords;
            if (!c) return;
            const key = `${Math.round(c.lat * 2) / 2},${Math.round(c.lng * 2) / 2}`;
            if (!groups[key]) groups[key] = { lat: c.lat, lng: c.lng, dates: [] };
            groups[key].dates.push(day.date);
        });
        return Object.values(groups);
    }

    function partitionDates(dates) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoff = new Date(today);
        cutoff.setDate(today.getDate() + 15);
        const forecast = [], historical = [];
        dates.forEach(d => {
            (new Date(d + 'T00:00:00') <= cutoff ? forecast : historical).push(d);
        });
        return { forecast, historical };
    }

    async function fetchForecast(lat, lng, dates) {
        if (!dates.length) return;
        const sorted = [...dates].sort();
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
            `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunshine_duration` +
            `&timezone=auto&start_date=${sorted[0]}&end_date=${sorted[sorted.length - 1]}`;
        try {
            const r = await fetch(url);
            if (!r.ok) return;
            const data = await r.json();
            if (!data.daily?.time) return;
            const tzOffset = data.utc_offset_seconds ?? null;
            data.daily.time.forEach((date, i) => {
                if (!dates.includes(date)) return;
                cache[date] = {
                    tempMax:       Math.round(data.daily.temperature_2m_max[i] ?? 0),
                    tempMin:       Math.round(data.daily.temperature_2m_min[i] ?? 0),
                    code:          data.daily.weathercode[i] ?? 0,
                    precipProb:    data.daily.precipitation_probability_max?.[i] ?? null,
                    sunshineHours: data.daily.sunshine_duration?.[i] != null
                        ? Math.round(data.daily.sunshine_duration[i] / 3600 * 10) / 10
                        : null,
                    tzOffset,
                    historical: false,
                };
            });
        } catch (e) {
            console.warn('[Weather] Forecast fetch failed:', e.message);
        }
    }

    function getHistoricalRanges(histYear, mds) {
        if (!mds.length) return [];
        const first = mds[0], last = mds[mds.length - 1];
        if (first <= last) {
            return [[`${histYear}-${first}`, `${histYear}-${last}`]];
        }
        return [
            [`${histYear}-${first}`,   `${histYear}-12-31`],
            [`${histYear + 1}-01-01`,  `${histYear + 1}-${last}`],
        ];
    }

    async function fetchHistoricalAverages(lat, lng, dates) {
        if (!dates.length) return;
        const mds = [...new Set(dates.map(d => d.slice(5)))].sort();
        const curYear = new Date().getFullYear();

        const acc = {};
        mds.forEach(md => { acc[md] = { tMaxSum: 0, tMinSum: 0, sunSum: 0, count: 0, codes: [], tzOffset: null }; });

        for (const offset of [1, 2, 3]) {
            const histYear = curYear - offset;
            const ranges = getHistoricalRanges(histYear, mds);
            for (const [start, end] of ranges) {
                try {
                    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
                        `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration` +
                        `&timezone=auto&start_date=${start}&end_date=${end}`;
                    const r = await fetch(url);
                    if (!r.ok) continue;
                    const data = await r.json();
                    if (!data.daily?.time) continue;
                    const tz = data.utc_offset_seconds ?? null;
                    data.daily.time.forEach((date, i) => {
                        const md = date.slice(5);
                        const a = acc[md];
                        if (!a) return;
                        const tmax = data.daily.temperature_2m_max[i];
                        if (tmax == null) return;
                        a.tMaxSum += tmax;
                        a.tMinSum += (data.daily.temperature_2m_min[i] ?? tmax);
                        const sd = data.daily.sunshine_duration?.[i];
                        if (sd != null) a.sunSum += sd;
                        a.count++;
                        const code = data.daily.weathercode[i];
                        if (code != null) a.codes.push(code);
                        if (a.tzOffset == null && tz != null) a.tzOffset = tz;
                    });
                } catch (e) {
                    console.warn('[Weather] Historical fetch failed:', e.message);
                }
            }
        }

        dates.forEach(date => {
            const md = date.slice(5);
            const a = acc[md];
            if (!a || a.count === 0) return;
            const freq = {};
            a.codes.forEach(c => freq[c] = (freq[c] || 0) + 1);
            const code = parseInt(Object.entries(freq).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '0');
            cache[date] = {
                tempMax:       Math.round(a.tMaxSum / a.count),
                tempMin:       Math.round(a.tMinSum / a.count),
                sunshineHours: a.count > 0 ? Math.round(a.sunSum / a.count / 3600 * 10) / 10 : null,
                code,
                tzOffset:  a.tzOffset,
                historical: true,
            };
        });
    }

    function renderAll() {
        if (!currentTrip) return;
        const tripCoords = getTripCoords();

        (currentTrip.days || []).forEach(day => {
            if (!day.date) return;

            const coords = getDayCoords(day) || tripCoords;
            const w = cache[day.date];

            // Sunrise/sunset — formula using per-day coords + DST-aware offset from API
            let sunriseStr = null, sunsetStr = null;
            if (coords) {
                const solar = solarTimesUTC(coords.lat, coords.lng, day.date);
                if (solar) {
                    // Prefer API-provided DST-aware offset for this date; fall back to lng estimate
                    const offset = w?.tzOffset ?? (Math.round(coords.lng / 15) * 3600);
                    sunriseStr = utcMinsToHHMM(solar.rise, offset);
                    sunsetStr  = utcMinsToHHMM(solar.set,  offset);
                }
            }

            // Day tile — compact, just weather icon + temp range
            const tile = document.querySelector(`.day-plan-tile[data-weather-date="${day.date}"]`);
            if (tile) {
                const el = tile.querySelector('.dpt-weather');
                if (el && w) {
                    el.textContent = `${wmoIcon(w.code)} ${w.tempMin}–${w.tempMax}°`;
                    el.title = `${wmoLabel(w.code)}${w.historical ? ' (climate avg)' : ''}`;
                }
            }

            // Day card header — weather + sunshine hours + sunrise/sunset
            const dayEl = document.querySelector(`.day-weather[data-weather-date="${day.date}"]`);
            if (dayEl) {
                const weatherPart = w
                    ? `${wmoIcon(w.code)}\u202f${w.tempMin}–${w.tempMax}°${w.sunshineHours != null ? `\u2002☀\u202f${w.sunshineHours}h` : ''}`
                    : '';
                const sunPart = (sunriseStr && sunsetStr)
                    ? `\u2002🌅\u202f${sunriseStr}\u2002🌇\u202f${sunsetStr}`
                    : '';
                const histBadge = w?.historical ? '\u2002<span class="weather-hist-tag">avg</span>' : '';
                const approxNote = (!w?.tzOffset) && coords ? ' (approx. local time)' : '';

                if (weatherPart || sunPart) {
                    dayEl.innerHTML = `${weatherPart}${sunPart}${histBadge}`;
                    const wTitle = w
                        ? `${wmoLabel(w.code)}${w.sunshineHours != null ? ` · ${w.sunshineHours}h sunshine` : ''}${w.historical ? ' · Climate average' : ''}`
                        : '';
                    const sTitle = sunriseStr ? `Sunrise ${sunriseStr} · Sunset ${sunsetStr}${approxNote}` : '';
                    dayEl.title = [wTitle, sTitle].filter(Boolean).join(' · ');
                }
            }
        });
    }

    async function fetchAndRender() {
        if (!currentTrip || fetchPending) return;

        const days = (currentTrip.days || []).filter(d => d.date);
        if (!days.length) return;

        // Render immediately — sun times show without waiting for weather API
        renderAll();

        const needed = days.filter(d => !cache[d.date]);
        if (!needed.length) return;

        fetchPending = true;
        try {
            const fallback = getTripCoords();
            // Group uncached days by per-day location (~50km buckets) so each
            // location gets its own API call rather than using a single centroid
            const groups = groupDaysByCoords(needed, fallback);
            for (const group of groups) {
                const { forecast, historical } = partitionDates(group.dates);
                await fetchForecast(group.lat, group.lng, forecast);
                await fetchHistoricalAverages(group.lat, group.lng, historical);
            }
            renderAll();
        } finally {
            fetchPending = false;
        }
    }

    function init(trip) {
        currentTrip = trip;
        cache = {};
        fetchPending = false;
        fetchAndRender();
    }

    function update(trip) {
        currentTrip = trip;
        fetchAndRender();
    }

    function renderOnly() {
        renderAll();
    }

    return { init, update, renderOnly };
})();
