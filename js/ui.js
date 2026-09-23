/** Today / Itinerary / Discover / Overview — Place vs Visit separated. */
const TripUI = (() => {
  let data = null;
  let placeById = {};
  let activeKey = null;

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

  function plannedVisits() {
    return (data.visits || []).filter((v) => !v.optional).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
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
    const desc = visit?.activity || place.description || place.address || '';
    return `
      <article class="card" data-key="${esc(key)}" data-place="${esc(place.place_id)}">
        <div class="card-row">
          ${thumb ? `<img class="thumb" src="${esc(thumb)}" alt="" loading="lazy" decoding="async" data-enlarge="${esc(place.place_id)}" />` : '<div class="thumb"></div>'}
          <div class="meta">
            <div class="time">${esc(time)}</div>
            <h3>${esc(title)}</h3>
            <div class="desc">${esc(desc)}</div>
          </div>
        </div>
        ${NavLinks.buttonsHtml(place)}
      </article>`;
  }

  function renderToday() {
    const el = document.getElementById('view-today');
    const w = data.weather || {};
    const visits = plannedVisits();
    const nowLabel = visits[0] ? (placeById[visits[0].place_id]?.short_name || '') : '';
    const next = visits[1];
    const nextLabel = next ? (placeById[next.place_id]?.short_name || '') : '—';
    el.innerHTML = `
      <div class="hero">
        <h2>${esc(data.label || data.day)}</h2>
        <div class="muted">${esc(data.city || '')} · ${esc(data.day)}</div>
        <div class="chip-row">
          <span class="chip">${esc(w.condition || '天气待定')}</span>
          ${(w.tags || []).slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
        </div>
        <p class="desc" style="margin:10px 0 0;font-size:13px;color:var(--muted)">${esc(w.gear || '')}${w.impact?.outdoor ? ' · ' + esc(w.impact.outdoor) : ''}</p>
        <p style="margin:10px 0 0;font-size:13px"><strong>当前/首站</strong> ${esc(nowLabel)} → <strong>下一站</strong> ${esc(nextLabel)}</p>
      </div>
      ${visits.map((v, i) => {
        const p = placeById[v.place_id];
        if (!p) return '';
        return cardHtml(p, v, { key: visitKey(v, i) });
      }).join('')}`;
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
        <div class="timeline-item" data-key="${esc(key)}" data-num="${i + 1}">
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
        if (seg) {
          html += `<div class="route-gap">${esc(seg.mode || '前往')} · ${seg.duration != null ? seg.duration + ' 分钟' : ''}${seg.distance != null ? ' · ' + seg.distance + ' km' : ''}</div>`;
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
      <p class="muted" style="margin-top:0">候选（未排进今天行程）· 雨天室内备选</p>
      ${ids.map((id) => {
        const p = placeById[id];
        if (!p) return '';
        return cardHtml(p, null, { key: `discover-${id}` });
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
        <p class="muted" style="font-size:12px">Place / Visit 分离；首屏仅当日数据。地图异步，失败不阻塞行程。</p>
      </div>`;
  }

  function setActiveKey(key, { fromMap = false } = {}) {
    activeKey = key;
    document.querySelectorAll('[data-key]').forEach((n) => {
      n.classList.toggle('active', n.getAttribute('data-key') === key);
    });
    if (!fromMap && key) {
      TripMap.focus(key);
    } else if (fromMap && key) {
      TripMap.highlight(key, { openPopup: true });
      const node = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        // ensure parent tab shows timeline/today
        const tab = node.closest('.view')?.id?.replace('view-', '');
        if (tab) switchTab(tab);
      }
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
      setActiveKey(item.getAttribute('data-key'));
    });
  }

  function switchTab(name) {
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
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });
  }

  function pushMapLayers() {
    const visits = plannedVisits();
    const stops = [];
    visits.forEach((v, i) => {
      const p = placeById[v.place_id];
      if (!p || !p.coordinates) return;
      stops.push({
        key: visitKey(v, i),
        lat: p.coordinates.lat,
        lng: p.coordinates.lng,
        title: p.short_name || p.name,
        subtitle: `${v.planned_start || ''} ${v.activity || ''}`.trim(),
        thumb: thumbOf(p),
        num: i + 1,
      });
    });
    // Discover markers deferred — only show when Discover tab? Spec: defer candidates.
    // Still allow discover focus when user opens card; add lightly with lower emphasis when on discover tab only.
    TripMap.setStops(stops);

    // Route: use segment geometries (GCJ-02 [lng,lat] → Leaflet [lat,lng])
    const latlngs = [];
    const segs = data.routes || [];
    visits.forEach((v, i) => {
      if (i >= visits.length - 1) return;
      const seg = segs.find((s) => s.from === v.place_id && s.to === visits[i + 1].place_id);
      if (seg?.geometry?.coordinates?.length) {
        seg.geometry.coordinates.forEach((c) => latlngs.push([c[1], c[0]]));
      } else {
        const a = placeById[v.place_id]?.coordinates;
        const b = placeById[visits[i + 1].place_id]?.coordinates;
        if (a && b) {
          if (!latlngs.length) latlngs.push([a.lat, a.lng]);
          latlngs.push([b.lat, b.lng]);
        }
      }
    });
    TripMap.setRoute(latlngs);
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

    // Map async — does not block UI
    requestAnimationFrame(() => {
      const first = plannedVisits()[0];
      const c = first && placeById[first.place_id]?.coordinates;
      TripMap.init({
        center: c ? [c.lat, c.lng] : [36.422, 114.20],
        zoom: 13,
        onSelect: (key) => setActiveKey(key, { fromMap: true }),
      });
      pushMapLayers();
    });
  }

  function addDiscoverMarkers() {
    // optional: call when switching to discover
    const ids = data.discover_place_ids || [];
    // For v1 day slice we keep map focused on planned stops only (perf).
    return ids;
  }

  return { mount, switchTab, setActiveKey, addDiscoverMarkers };
})();
window.TripUI = TripUI;
