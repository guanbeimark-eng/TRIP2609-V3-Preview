/**
 * Leaflet map module — EasyItinerary-inspired marker highlight/focus + day route.
 * China: Gaode/GeoQ GCJ-02 tiles preferred. No AMap JS API. UI must work if map fails.
 */
const TripMap = (() => {
  let map = null;
  let markers = {};
  let routeLayer = null;
  let highlightedKey = null;
  let tileOk = false;
  let onSelect = null;

  // GCJ-02-friendly China raster tiles (no AMap JS SDK)
  const TILES = [
    {
      name: 'geoq-china',
      url: 'https://map.geoq.cn/ArcGIS/rest/services/ChinaOnlineCommunity/MapServer/tile/{z}/{y}/{x}',
      attr: '&copy; GeoQ',
    },
    {
      name: 'gaode-vec',
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      options: { subdomains: '1234', maxZoom: 18 },
      attr: '&copy; 高德',
    },
    {
      name: 'osm',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19 },
      attr: '&copy; OSM',
    },
  ];

  function setStatus(text, retry) {
    const el = document.getElementById('mapStatus');
    const btn = document.getElementById('mapRetry');
    if (el) el.textContent = text;
    if (btn) btn.hidden = !retry;
  }

  function init(opts = {}) {
    onSelect = opts.onSelect || null;
    if (!window.L) {
      setStatus('地图库未加载 — 行程仍可用', true);
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
        attachTiles(0);
      });
      setStatus('地图就绪（异步）');
      return map;
    } catch (e) {
      console.warn('map init failed', e);
      setStatus('地图初始化失败 — 行程仍可用', true);
      return null;
    }
  }

  function attachTiles(idx) {
    if (!map || !TILES[idx]) {
      setStatus('瓦片不可用 — 行程仍可用', true);
      return;
    }
    const t = TILES[idx];
    const layer = L.tileLayer(t.url, {
      attribution: t.attr,
      ...(t.options || {}),
    });
    let got = false;
    const failTimer = setTimeout(() => {
      if (!got) {
        map.removeLayer(layer);
        attachTiles(idx + 1);
      }
    }, 4000);
    layer.on('load', () => {
      got = true;
      tileOk = true;
      clearTimeout(failTimer);
      setStatus(`瓦片: ${t.name}`);
    });
    layer.on('tileerror', () => {
      /* individual tile errors common; whole-layer fallback via timer */
    });
    layer.addTo(map);
  }

  function clearMarkers() {
    Object.values(markers).forEach((m) => map && map.removeLayer(m));
    markers = {};
    highlightedKey = null;
  }

  function markerIcon(thumbUrl, num) {
    const img = thumbUrl
      ? `<img src="${thumbUrl}" alt="" loading="lazy" decoding="async" />`
      : `<span style="display:grid;place-items:center;height:100%;font-weight:800;color:#fff">${num || ''}</span>`;
    return L.divIcon({
      className: '',
      html: `<div class="photo-marker" data-num="${num || ''}">${img}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -22],
    });
  }

  function addStop(stop) {
    if (!map || stop.lat == null || stop.lng == null) return;
    const key = stop.key;
    const m = L.marker([stop.lat, stop.lng], {
      icon: markerIcon(stop.thumb, stop.num),
      title: stop.title,
    }).addTo(map);
    m.bindPopup(`<strong>${escapeHtml(stop.title)}</strong><br/><span style="color:#64748b;font-size:12px">${escapeHtml(stop.subtitle || '')}</span>`, {
      maxWidth: 220,
      autoPan: false,
    });
    m.on('click', () => {
      highlight(key, { openPopup: true });
      if (onSelect) onSelect(key);
    });
    markers[key] = m;
  }

  function setStops(stops) {
    if (!map) return;
    clearMarkers();
    stops.forEach(addStop);
    fit();
  }

  function setRoute(latlngs) {
    if (!map) return;
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
    if (!latlngs || latlngs.length < 2) return;
    routeLayer = L.polyline(latlngs, {
      color: '#38bdf8',
      weight: 4,
      opacity: 0.85,
      dashArray: null,
    }).addTo(map);
  }

  function fit() {
    if (!map) return;
    const layers = Object.values(markers);
    if (routeLayer) layers.push(routeLayer);
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

  /** EasyItinerary focusMarker equivalent */
  function focus(key) {
    highlight(key, { openPopup: true, pan: true });
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 50);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, setStops, setRoute, highlight, focus, clearHighlight, invalidateSize, getMap: () => map };
})();
window.TripMap = TripMap;
