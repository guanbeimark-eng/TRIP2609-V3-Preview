/**
 * Leaflet map — Gaode → GeoQ → safe no-map. No OSM (GCJ-02 must not plot on OSM).
 * Ready = first tileload (~2s max per provider). Attempt token ignores late tiles.
 */
const TripMap = (() => {
  let map = null;
  let markers = {};
  let routeLayers = [];
  let routeBadge = null;
  let highlightedKey = null;
  let tileOk = false;
  let onSelect = null;
  let attempt = 0;
  let currentLayer = null;
  let safeMode = false;

  const TILES = [
    {
      name: 'gaode-vec',
      label: '高德',
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      options: { subdomains: '1234', maxZoom: 18 },
      attr: '&copy; 高德',
    },
    {
      name: 'geoq-china',
      label: 'GeoQ',
      url: 'https://map.geoq.cn/ArcGIS/rest/services/ChinaOnlineCommunity/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 18 },
      attr: '&copy; GeoQ',
    },
  ];

  function setStatus(text, retry) {
    const el = document.getElementById('mapStatus');
    const btn = document.getElementById('mapRetry');
    if (el) el.textContent = text;
    if (btn) btn.hidden = !retry;
  }

  function setLegend(html, show) {
    const el = document.getElementById('mapLegend');
    if (!el) return;
    if (!show) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = html;
  }

  function init(opts = {}) {
    onSelect = opts.onSelect || null;
    if (!window.L) {
      safeMode = true;
      setStatus('无地图安全模式 — 列表/时间线可用', true);
      return null;
    }
    try {
      map = L.map('map', {
        center: opts.center || [36.422, 114.20],
        zoom: opts.zoom || 13,
        zoomControl: true,
        attributionControl: true,
      });
      attachTiles(0);
      map.whenReady(() => {
        setTimeout(() => map && map.invalidateSize(), 80);
      });
      document.getElementById('mapRetry')?.addEventListener('click', () => {
        safeMode = false;
        tileOk = false;
        attachTiles(0);
      });
      setStatus('地图加载中…');
      return map;
    } catch (e) {
      console.warn('map init failed', e);
      safeMode = true;
      setStatus('无地图安全模式 — 列表/时间线可用', true);
      return null;
    }
  }

  function attachTiles(idx) {
    if (!map) return;
    if (currentLayer) {
      try { map.removeLayer(currentLayer); } catch (_) { /* */ }
      currentLayer = null;
    }
    if (!TILES[idx]) {
      safeMode = true;
      tileOk = false;
      setStatus('无地图安全模式 — 列表/时间线可用', true);
      return;
    }
    const myAttempt = ++attempt;
    const t = TILES[idx];
    const layer = L.tileLayer(t.url, {
      attribution: t.attr,
      ...(t.options || {}),
    });
    let got = false;
    const failTimer = setTimeout(() => {
      if (myAttempt !== attempt) return;
      if (!got) {
        try { map.removeLayer(layer); } catch (_) { /* */ }
        if (currentLayer === layer) currentLayer = null;
        setStatus(`${t.label}超时 → 下一源…`);
        attachTiles(idx + 1);
      }
    }, 2000);
    layer.on('tileload', () => {
      if (myAttempt !== attempt) return;
      if (got) return;
      got = true;
      tileOk = true;
      safeMode = false;
      clearTimeout(failTimer);
      setStatus(`瓦片: ${t.label}`);
    });
    layer.on('tileerror', () => {
      /* individual tile errors common; whole-layer fallback via timer */
    });
    currentLayer = layer;
    layer.addTo(map);
    setStatus(`尝试 ${t.label}…`);
  }

  function clearMarkers() {
    Object.values(markers).forEach((m) => map && map.removeLayer(m));
    markers = {};
    highlightedKey = null;
  }

  function markerIcon(thumbUrl, num, kind) {
    const extra = kind === 'discover' ? ' photo-marker--discover' : '';
    const img = thumbUrl
      ? `<img src="${thumbUrl}" alt="" loading="lazy" decoding="async" />`
      : `<span style="display:grid;place-items:center;height:100%;font-weight:800;color:#fff">${num || '·'}</span>`;
    return L.divIcon({
      className: '',
      html: `<div class="photo-marker${extra}" data-num="${num || ''}">${img}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -22],
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addStop(stop) {
    if (!map || stop.lat == null || stop.lng == null) return;
    const key = stop.key;
    const m = L.marker([stop.lat, stop.lng], {
      icon: markerIcon(stop.thumb, stop.num, stop.kind),
      title: stop.title,
      opacity: stop.subtle ? 0.45 : 1,
      zIndexOffset: stop.kind === 'discover' ? 600 : 0,
    }).addTo(map);
    const body = stop.popupHtml || `<strong>${escapeHtml(stop.title)}</strong><br/><span style="color:#64748b;font-size:12px">${escapeHtml(stop.subtitle || '')}</span>`;
    m.bindPopup(body, { maxWidth: 260, autoPan: false });
    m.on('click', () => {
      highlight(key, { openPopup: true });
      if (onSelect) onSelect(key, stop);
    });
    markers[key] = m;
  }

  function setStops(stops) {
    if (!map) return;
    clearMarkers();
    (stops || []).forEach(addStop);
    fit();
  }

  function addDiscoverMarkers(stops) {
    if (!map) return;
    // remove prior discover markers only
    Object.keys(markers).forEach((k) => {
      if (k.startsWith('discover-')) {
        map.removeLayer(markers[k]);
        delete markers[k];
      }
    });
    (stops || []).forEach((s) => addStop({ ...s, kind: 'discover' }));
    fit();
  }

  function clearDiscoverMarkers() {
    if (!map) return;
    Object.keys(markers).forEach((k) => {
      if (k.startsWith('discover-')) {
        map.removeLayer(markers[k]);
        delete markers[k];
      }
    });
  }

  function setPlannedEmphasis(on) {
    Object.entries(markers).forEach(([k, m]) => {
      if (k.startsWith('discover-')) return;
      m.setOpacity(on ? 1 : 0.35);
    });
  }

  function clearRoutes() {
    routeLayers.forEach((l) => map && map.removeLayer(l));
    routeLayers = [];
    if (routeBadge && map) {
      map.removeLayer(routeBadge);
      routeBadge = null;
    }
  }

  /**
   * segments: [{ latlngs, geometry_kind, color }]
   * REAL_ROUTE / ROAD → solid; SCHEMATIC → dashed + 「示意」badge/legend
   */
  function setRoutes(segments) {
    if (!map) return;
    clearRoutes();
    if (!segments || !segments.length) {
      setLegend('', false);
      return;
    }
    let anySchematic = false;
    segments.forEach((seg) => {
      if (!seg.latlngs || seg.latlngs.length < 2) return;
      const kind = (seg.geometry_kind || 'SCHEMATIC').toUpperCase();
      const isSchematic = kind === 'SCHEMATIC';
      if (isSchematic) anySchematic = true;
      const layer = L.polyline(seg.latlngs, {
        color: seg.color || (isSchematic ? '#fbbf24' : '#38bdf8'),
        weight: isSchematic ? 4 : 5,
        opacity: isSchematic ? 0.9 : 0.85,
        dashArray: isSchematic ? '6 8' : null,
      }).addTo(map);
      routeLayers.push(layer);
    });
    if (anySchematic) {
      setLegend('<span class="legend-badge">示意</span> 路线为示意连线，非实测道路轨迹', true);
      // mid-point badge on first schematic segment
      const first = segments.find((s) => (s.geometry_kind || 'SCHEMATIC').toUpperCase() === 'SCHEMATIC' && s.latlngs?.length >= 2);
      if (first) {
        const mid = first.latlngs[Math.floor(first.latlngs.length / 2)];
        routeBadge = L.marker(mid, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: '',
            html: '<span class="route-schematic-badge">示意</span>',
            iconSize: [36, 18],
            iconAnchor: [18, 9],
          }),
        }).addTo(map);
      }
    } else {
      setLegend('', false);
    }
  }

  /** @deprecated use setRoutes */
  function setRoute(latlngs, opts = {}) {
    setRoutes(latlngs && latlngs.length >= 2 ? [{ latlngs, geometry_kind: opts.geometry_kind || 'SCHEMATIC', color: opts.color }] : []);
  }

  function fit() {
    if (!map) return;
    const layers = Object.values(markers);
    routeLayers.forEach((l) => layers.push(l));
    if (!layers.length) return;
    const g = L.featureGroup(layers);
    map.fitBounds(g.getBounds().pad(0.18));
  }

  function clearHighlight() {
    if (!highlightedKey || !markers[highlightedKey]) {
      highlightedKey = null;
      return;
    }
    const el = markers[highlightedKey].getElement();
    if (el) el.classList.remove('marker-highlight');
    markers[highlightedKey].closePopup();
    highlightedKey = null;
  }

  function highlight(key, { openPopup = false, pan = false } = {}) {
    clearHighlight();
    const m = markers[key];
    if (!m) return;
    highlightedKey = key;
    const el = m.getElement();
    if (el) el.classList.add('marker-highlight');
    if (openPopup) m.openPopup();
    if (pan) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
    }
  }

  function focus(key) {
    highlight(key, { openPopup: true, pan: true });
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 50);
  }

  return {
    init,
    setStops,
    setRoute,
    setRoutes,
    addDiscoverMarkers,
    clearDiscoverMarkers,
    setPlannedEmphasis,
    highlight,
    focus,
    clearHighlight,
    invalidateSize,
    getMap: () => map,
    isSafeMode: () => safeMode,
    hasMarker: (key) => !!markers[key],
  };
})();
window.TripMap = TripMap;
