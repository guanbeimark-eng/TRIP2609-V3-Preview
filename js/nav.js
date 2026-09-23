/** AMap / Apple Maps deep links (GCJ-02). Pattern from TRIP2609 nav guide. */
const NavLinks = (() => {
  function enc(s) { return encodeURIComponent(s || ''); }

  function amapMarker(place) {
    const c = place.coordinates || {};
    const lng = c.lng, lat = c.lat;
    if (lng == null || lat == null) return null;
    const name = enc(place.name || place.short_name || '');
    return `https://uri.amap.com/marker?position=${lng},${lat}&name=${name}&coordinate=gaode&callnative=1`;
  }

  function appleMaps(place) {
    const c = place.coordinates || {};
    const lng = c.lng, lat = c.lat;
    if (lng == null || lat == null) return null;
    const name = enc(place.name || place.short_name || '');
    return `https://maps.apple.com/?ll=${lat},${lng}&q=${name}&dirflg=d`;
  }

  function buttonsHtml(place) {
    const a = amapMarker(place);
    const apple = appleMaps(place);
    if (!a && !apple) return '';
    let html = '<div class="nav-btns">';
    if (a) html += `<a class="btn btn-nav" href="${a}" target="_blank" rel="noopener">高德导航</a>`;
    if (apple) html += `<a class="btn btn-ghost" href="${apple}" target="_blank" rel="noopener">Apple Maps</a>`;
    html += '</div>';
    return html;
  }

  return { amapMarker, appleMaps, buttonsHtml };
})();
window.NavLinks = NavLinks;
