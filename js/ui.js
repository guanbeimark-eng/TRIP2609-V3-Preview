/** Today / Itinerary / Discover / Overview — Place vs Visit; V3.1 one-day. */
const TripUI = (() => {
  let data = null;
  let placeById = {};
  let activeKey = null;
  let currentTab = 'today';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function thumbOf(place) {
    const im = (place.images && place.images[0]) || null;
    return im ? im.thumb : null;
  }

  function fullOf(place) {
    const im = (place.images && place.images[0]) || null;
    return im ? { src: im.full || im.thumb, caption: im.caption || place.short_name || place.name } : null;
  }

  function visitKey(v, idx) {
    return `visit-${v.visit_id || idx}`;
  }

  function placeMarkerKey(placeId) {
    return `place-${placeId}`;
  }

  function plannedVisits() {
    return (data.visits || []).filter((v) => !v.optional).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  }

  function parseHm(hm) {
    if (!hm || typeof hm !== 'string') return null;
    const m = hm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  /** Split planned visits into NOW / NEXT / LATER by clock (Asia/Shanghai assumed by page). */
  function phaseBuckets(visits) {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    let nowIdx = -1;
    let nextIdx = -1;
    for (let i = 0; i < visits.length; i++) {
      const a = parseHm(visits[i].planned_start);
      const b = parseHm(visits[i].planned_end) ?? a;
      if (a == null) continue;
      if (mins >= a && mins <= (b ?? a)) {
        nowIdx = i;
        break;
      }
      if (mins < a) {
        nextIdx = i;
        break;
      }
    }
    if (nowIdx < 0 && nextIdx < 0) {
      // before first → NEXT = first; after last → NOW = last phase done
      if (visits.length) {
        const first = parseHm(visits[0].planned_start);
        if (first != null && mins < first) nextIdx = 0;
        else nowIdx = visits.length - 1; // day winding down: show last as "当前阶段"
      }
    }
    const laterStart = Math.max(nowIdx, nextIdx) + 1;
    return {
      nowVisit: nowIdx >= 0 ? visits[nowIdx] : null,
      nowIdx,
      nextVisit: nextIdx >= 0 ? visits[nextIdx] : (nowIdx >= 0 && nowIdx + 1 < visits.length ? visits[nowIdx + 1] : null),
      nextIdx: nextIdx >= 0 ? nextIdx : (nowIdx >= 0 && nowIdx + 1 < visits.length ? nowIdx + 1 : -1),
      later: visits.slice(Math.max(laterStart, nextIdx >= 0 ? nextIdx + 1 : (nowIdx >= 0 ? nowIdx + 2 : 0))),
    };
  }

  function openLightbox(full) {
    if (!full || !full.src) return;
    const box = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    const cap = document.getElementById('lightboxCap');
    img.src = full.src;
    img.alt = full.caption || '';
    cap.textContent = full.caption || '';
    box.hidden = false;
  }

  function bindLightbox() {
    document.getElementById('lightboxClose')?.addEventListener('click', () => {
      document.getElementById('lightbox').hidden = true;
      document.getElementById('lightboxImg').removeAttribute('src');
    });
    document.getElementById('lightbox')?.addEventListener('click', (e) => {
      if (e.target.id === 'lightbox') {
        document.getElementById('lightbox').hidden = true;
      }
    });
  }

  function cardHtml(place, visit, opts = {}) {
    const key = opts.key;
    const thumb = thumbOf(place);
    const time = visit
      ? `${visit.planned_start || ''}${visit.planned_end ? ' – ' + visit.planned_end : ''}`
      : '';
    const title = place.short_name || place.name;
    let desc = visit?.activity || place.description || place.address || '';
    let badges = '';
    if (place.hours_status === 'CLOSED_MONDAY' || place.rain_plan_b === false) {
      if (opts.discover) {
        badges = '<span class="chip chip-warn">周一闭馆</span><span class="chip">非雨天Plan B</span>';
        desc = place.opening_hours?.summary || desc;
      }
    }
    return `
      <article class="card" data-key="${esc(key)}" data-place="${esc(place.place_id)}">
        <div class="card-row">
          ${thumb ? `<img class="thumb" src="${esc(thumb)}" alt="" loading="lazy" decoding="async" data-enlarge="${esc(place.place_id)}" />` : '<div class="thumb"></div>'}
          <div class="meta">
            <div class="time">${esc(time)}</div>
            <h3>${esc(title)}</h3>
            ${badges ? `<div class="chip-row">${badges}</div>` : ''}
            <div class="desc">${esc(desc)}</div>
          </div>
        </div>
        ${NavLinks.buttonsHtml(place)}
      </article>`;
  }

  function rainCopySafe(w) {
    // Never recommend museum as rain Plan B
    const impact = w?.impact?.outdoor || '';
    const gear = w?.gear || '';
    let note = [gear, impact].filter(Boolean).join(' · ');
    // strip any museum suggestion if present
    note = note.replace(/博物馆[^·；;]*/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!note) note = '雨具随身；午后对流时优先已确认开放的室内点';
    return note + '（峰峰博物馆周一闭馆，不作今日雨备）';
  }

  function renderToday() {
    const el = document.getElementById('view-today');
    const w = data.weather || {};
    const visits = plannedVisits();
    const { nowVisit, nextVisit, later, nextIdx } = phaseBuckets(visits);
    const nowPlace = nowVisit ? placeById[nowVisit.place_id] : null;
    const nextPlace = nextVisit ? placeById[nextVisit.place_id] : null;

    // transit to next
    let transit = '';
    if (nextVisit && nextIdx > 0) {
      const prev = visits[nextIdx - 1];
      const seg = (data.routes || []).find((s) => s.from === prev.place_id && s.to === nextVisit.place_id);
      const r = prev?.route_to_next;
      if (seg || r) {
        const mode = seg?.mode || r?.mode || '前往';
        const dur = seg?.duration ?? r?.duration_min;
        const dist = seg?.distance ?? r?.distance_km;
        transit = `${mode}${dur != null ? ' · ' + dur + ' 分钟' : ''}${dist != null ? ' · ' + dist + ' km' : ''}`;
      }
    } else if (nextVisit && nextIdx === 0) {
      transit = '今日首站';
    }

    const nextThumb = nextPlace ? thumbOf(nextPlace) : null;
    const laterHtml = later.length
      ? `<details class="later-fold">
          <summary>稍后 · ${later.length} 站</summary>
          <div class="later-list">
            ${later.map((v, i) => {
              const p = placeById[v.place_id];
              if (!p) return '';
              // key resolves to place marker (deduped)
              return cardHtml(p, v, { key: placeMarkerKey(p.place_id) });
            }).join('')}
          </div>
        </details>`
      : '<p class="muted" style="font-size:12px">本日无更多计划停靠</p>';

    el.innerHTML = `
      <section class="phase phase-now" aria-label="当前">
        <div class="phase-label">NOW</div>
        <div class="hero">
          <h2>${esc(data.label || data.day)}</h2>
          <div class="muted">${esc(data.city || '')} · ${esc(data.day)} · ${esc(w.weekday || '')}</div>
          <div class="chip-row">
            <span class="chip">${esc(w.condition || '天气待定')}</span>
            ${(w.tags || []).filter((t) => t !== 'INDOOR_FALLBACK' || true).slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
          </div>
          <p class="desc" style="margin:10px 0 0;font-size:13px;color:var(--muted)">${esc(rainCopySafe(w))}</p>
          <p style="margin:10px 0 0;font-size:13px">
            <strong>当前阶段</strong>
            ${nowPlace ? esc(nowPlace.short_name || nowPlace.name) + (nowVisit ? ` · ${esc(nowVisit.planned_start || '')}–${esc(nowVisit.planned_end || '')}` : '') : '行程间隙 / 日终'}
            ${nowVisit?.activity ? ` · ${esc(nowVisit.activity)}` : ''}
          </p>
        </div>
      </section>

      <section class="phase phase-next" aria-label="下一站">
        <div class="phase-label">NEXT</div>
        ${nextPlace ? `
          <article class="card card-next" data-key="${esc(placeMarkerKey(nextPlace.place_id))}" data-place="${esc(nextPlace.place_id)}">
            <div class="card-row">
              ${nextThumb ? `<img class="thumb thumb-hero" src="${esc(nextThumb)}" alt="" loading="lazy" data-enlarge="${esc(nextPlace.place_id)}" />` : '<div class="thumb thumb-hero"></div>'}
              <div class="meta">
                <div class="time">出发 ${esc(nextVisit.planned_start || '')}${nextVisit.planned_end ? ' · 停留至 ' + esc(nextVisit.planned_end) : ''}</div>
                <h3>${esc(nextPlace.short_name || nextPlace.name)}</h3>
                <div class="desc">${esc(nextVisit.activity || '')}${transit ? ' · ' + esc(transit) : ''}</div>
              </div>
            </div>
            ${NavLinks.buttonsHtml(nextPlace)}
          </article>` : '<p class="muted">本日计划已结束</p>'}
      </section>

      <section class="phase phase-later" aria-label="稍后">
        <div class="phase-label">LATER</div>
        ${laterHtml}
      </section>`;
  }

  function renderItinerary() {
    const el = document.getElementById('view-itinerary');
    const visits = plannedVisits();
    const segs = data.routes || [];
    let html = '<div class="timeline">';
    visits.forEach((v, i) => {
      const p = placeById[v.place_id];
      if (!p) return;
      const key = visitKey(v, i);
      const thumb = thumbOf(p);
      html += `
        <div class="timeline-item" data-key="${esc(key)}" data-place="${esc(p.place_id)}" data-num="${i + 1}">
          <div class="card-row">
            ${thumb ? `<img class="thumb" src="${esc(thumb)}" alt="" loading="lazy" data-enlarge="${esc(p.place_id)}" />` : ''}
            <div class="meta">
              <div class="time">${esc(v.planned_start || '')} – ${esc(v.planned_end || '')}</div>
              <h3>${esc(p.short_name || p.name)}</h3>
              <div class="desc">${esc(v.activity || '')}</div>
            </div>
          </div>
          ${NavLinks.buttonsHtml(p)}
        </div>`;
      if (i < visits.length - 1) {
        const from = v.place_id;
        const to = visits[i + 1].place_id;
        const seg = segs.find((s) => s.from === from && s.to === to);
        const kind = (seg?.geometry_kind || 'SCHEMATIC').toUpperCase();
        const badge = kind === 'SCHEMATIC' ? ' <span class="inline-badge">示意</span>' : '';
        if (seg) {
          html += `<div class="route-gap">${esc(seg.mode || '前往')} · ${seg.duration != null ? seg.duration + ' 分钟' : ''}${seg.distance != null ? ' · ' + seg.distance + ' km' : ''}${badge}</div>`;
        } else {
          html += `<div class="route-gap">前往下一站</div>`;
        }
      }
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function renderDiscover() {
    const el = document.getElementById('view-discover');
    const ids = data.discover_place_ids || [];
    if (!ids.length) {
      el.innerHTML = '<p class="muted">暂无候选</p>';
      return;
    }
    el.innerHTML = `
      <p class="muted" style="margin-top:0">候选（未排进今天行程）。峰峰博物馆周一闭馆，不作雨天 Plan B。</p>
      ${ids.map((id) => {
        const p = placeById[id];
        if (!p) return '';
        return cardHtml(p, null, { key: `discover-${id}`, discover: true });
      }).join('')}`;
  }

  function renderOverview() {
    const el = document.getElementById('view-overview');
    const w = data.weather || {};
    el.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">总览 · ${esc(data.day)}</h3>
        <p>${esc(data.label)}</p>
        <p class="muted">计划停靠 ${plannedVisits().length} · 发现候选 ${(data.discover_place_ids || []).length}</p>
        <p class="muted">天气：${esc(w.condition || '')}</p>
        <p class="muted" style="font-size:12px">Place / Visit 分离；同 POI 一日一标；示意路线已标注。地图异步，失败进安全模式。</p>
        <p class="muted" style="font-size:12px">峰峰博物馆：CLOSED_MONDAY（2026-09-28），rain_plan_b=false。</p>
      </div>`;
  }

  function activeViewSelector() {
    return `#view-${currentTab}`;
  }

  /** Highlight timeline/card in current tab only — never steal tab. */
  function setActiveKey(key, { fromMap = false, placeId = null } = {}) {
    activeKey = key;
    const root = document.querySelector(activeViewSelector()) || document;
    // clear globally then set in current view (and matching place nodes)
    document.querySelectorAll('[data-key].active, [data-place].active').forEach((n) => n.classList.remove('active'));

    let node = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!node && placeId) {
      node = root.querySelector(`[data-place="${CSS.escape(placeId)}"]`);
    }
    // If map sent place-* key while on itinerary (visit-* rows), resolve by place
    if (!node && key.startsWith('place-')) {
      const pid = key.slice('place-'.length);
      const nodes = [...root.querySelectorAll(`[data-place="${CSS.escape(pid)}"]`)];
      node = nodes[0] || null;
    }
    if (!node && key.startsWith('discover-')) {
      node = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    }
    if (node) {
      node.classList.add('active');
      // if multiple visit rows same place on itinerary, highlight all for that place
      const pid = node.getAttribute('data-place');
      if (pid && currentTab === 'itinerary') {
        root.querySelectorAll(`[data-place="${CSS.escape(pid)}"]`).forEach((n) => n.classList.add('active'));
      }
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const mapKey = key.startsWith('visit-')
      ? placeMarkerKey(document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.getAttribute('data-place') || placeId || '')
      : key;
    const focusKey = TripMap.hasMarker?.(mapKey) ? mapKey : (TripMap.hasMarker?.(key) ? key : mapKey);

    if (!fromMap && focusKey) {
      TripMap.focus(focusKey);
    } else if (fromMap && focusKey) {
      TripMap.highlight(focusKey, { openPopup: true });
      // DO NOT switchTab — stay on current tab
    }
  }

  function bindPanelClicks() {
    document.getElementById('panel')?.addEventListener('click', (e) => {
      const enlarge = e.target.closest('[data-enlarge]');
      if (enlarge) {
        e.stopPropagation();
        const place = placeById[enlarge.getAttribute('data-enlarge')];
        if (place) openLightbox(fullOf(place));
        return;
      }
      if (e.target.closest('a.btn')) return;
      const item = e.target.closest('[data-key]');
      if (!item) return;
      const key = item.getAttribute('data-key');
      const placeId = item.getAttribute('data-place');
      // map focus uses place marker key when on today/discover
      if (currentTab === 'itinerary') {
        setActiveKey(key, { placeId });
        if (placeId) TripMap.focus(placeMarkerKey(placeId));
      } else {
        setActiveKey(key, { placeId });
      }
    });
  }

  function switchTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach((v) => {
      const on = v.id === `view-${name}`;
      v.classList.toggle('active', on);
      v.hidden = !on;
    });
    TripMap.invalidateSize();
    if (name === 'discover') {
      addDiscoverMarkers();
      TripMap.setPlannedEmphasis?.(false);
    } else {
      TripMap.clearDiscoverMarkers?.();
      TripMap.setPlannedEmphasis?.(true);
      pushPlannedStopsOnly();
    }
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });
  }

  /** One marker per place_id; popup lists all visit windows that day. */
  function buildPlannedStops() {
    const visits = plannedVisits();
    const byPlace = new Map();
    visits.forEach((v, i) => {
      const p = placeById[v.place_id];
      if (!p || !p.coordinates) return;
      if (!byPlace.has(v.place_id)) {
        byPlace.set(v.place_id, { place: p, visits: [], firstNum: i + 1 });
      }
      byPlace.get(v.place_id).visits.push(v);
    });
    const stops = [];
    byPlace.forEach((entry, placeId) => {
      const p = entry.place;
      const windows = entry.visits
        .map((v) => `${v.planned_start || '?'}-${v.planned_end || '?'} ${v.activity || ''}`.trim())
        .join('<br/>');
      stops.push({
        key: placeMarkerKey(placeId),
        placeId,
        lat: p.coordinates.lat,
        lng: p.coordinates.lng,
        title: p.short_name || p.name,
        subtitle: entry.visits.length > 1 ? `${entry.visits.length} 次停留` : (entry.visits[0].activity || ''),
        popupHtml: `<strong>${esc(p.short_name || p.name)}</strong><br/><span style="color:#64748b;font-size:12px">${windows}</span>`,
        thumb: thumbOf(p),
        num: entry.firstNum,
        kind: 'planned',
      });
    });
    return stops;
  }

  function pushPlannedStopsOnly() {
    TripMap.setStops(buildPlannedStops());
    pushRoutes();
  }

  function pushRoutes() {
    const visits = plannedVisits();
    const segs = data.routes || [];
    const segments = [];
    visits.forEach((v, i) => {
      if (i >= visits.length - 1) return;
      const seg = segs.find((s) => s.from === v.place_id && s.to === visits[i + 1].place_id);
      let latlngs = [];
      if (seg?.geometry?.coordinates?.length) {
        latlngs = seg.geometry.coordinates.map((c) => [c[1], c[0]]);
      } else {
        const a = placeById[v.place_id]?.coordinates;
        const b = placeById[visits[i + 1].place_id]?.coordinates;
        if (a && b) latlngs = [[a.lat, a.lng], [b.lat, b.lng]];
      }
      if (latlngs.length >= 2) {
        segments.push({
          latlngs,
          geometry_kind: seg?.geometry_kind || 'SCHEMATIC',
          color: seg?.style?.color || '#fbbf24',
        });
      }
    });
    TripMap.setRoutes(segments);
  }

  function pushMapLayers() {
    pushPlannedStopsOnly();
  }

  function addDiscoverMarkers() {
    const ids = data.discover_place_ids || [];
    const stops = ids.map((id) => {
      const p = placeById[id];
      if (!p || !p.coordinates) return null;
      const closed = p.hours_status === 'CLOSED_MONDAY' || p.rain_plan_b === false;
      const note = closed
        ? '周一闭馆 · 非雨天 Plan B'
        : (p.description || '');
      return {
        key: `discover-${id}`,
        placeId: id,
        lat: p.coordinates.lat,
        lng: p.coordinates.lng,
        title: p.short_name || p.name,
        subtitle: note,
        popupHtml: `<strong>${esc(p.short_name || p.name)}</strong><br/><span style="color:#f87171;font-size:12px">${esc(note)}</span>`,
        thumb: thumbOf(p),
        num: '?',
        kind: 'discover',
      };
    }).filter(Boolean);
    // keep planned subtle + add discover
    TripMap.setStops(buildPlannedStops());
    TripMap.setPlannedEmphasis?.(false);
    TripMap.addDiscoverMarkers(stops);
    pushRoutes();
    return ids;
  }

  function onMapSelect(key, stop) {
    const placeId = stop?.placeId || (key.startsWith('place-') ? key.slice(6) : key.startsWith('discover-') ? key.slice(9) : null);
    setActiveKey(key, { fromMap: true, placeId });
  }

  function mount(bundle) {
    data = bundle;
    placeById = {};
    (bundle.places || []).forEach((p) => { placeById[p.place_id] = p; });

    document.getElementById('dayLabel').textContent = `${bundle.day} · ${bundle.city || ''}`;
    const w = bundle.weather || {};
    document.getElementById('weatherChip').textContent = w.condition || '天气';

    renderToday();
    renderItinerary();
    renderDiscover();
    renderOverview();
    bindTabs();
    bindPanelClicks();
    bindLightbox();

    requestAnimationFrame(() => {
      const first = plannedVisits()[0];
      const c = first && placeById[first.place_id]?.coordinates;
      TripMap.init({
        center: c ? [c.lat, c.lng] : [36.422, 114.20],
        zoom: 13,
        onSelect: onMapSelect,
      });
      pushMapLayers();
    });
  }

  return { mount, switchTab, setActiveKey, addDiscoverMarkers };
})();
window.TripUI = TripUI;
