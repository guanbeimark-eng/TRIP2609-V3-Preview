/** Boot: load only this day's bundle + weather; defer full images (lightbox only). */
(async function boot() {
  const t0 = performance.now();
  const status = (msg) => {
    const el = document.getElementById('dayLabel');
    if (el && el.textContent.includes('加载')) el.textContent = msg;
  };
  try {
    const res = await fetch('data/day-2026-09-28.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('day bundle HTTP ' + res.status);
    const bundle = await res.json();
    TripUI.mount(bundle);
    const ms = Math.round(performance.now() - t0);
    console.info('[trip2609] UI mounted in', ms, 'ms');
    window.__TRIP2609_BOOT_MS = ms;
  } catch (e) {
    console.error(e);
    status('数据加载失败');
    document.getElementById('view-today').innerHTML =
      `<div class="card"><h3>无法加载当日数据</h3><p class="muted">${String(e)}</p></div>`;
  }
})();
