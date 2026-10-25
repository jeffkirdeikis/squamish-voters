// Neighbourhood maps (Leaflet + OpenStreetMap). The page lists everything in text too, so it works without the map.
(function () {
  var el = document.getElementById('hoodmap'), dataEl = document.getElementById('hoodmap-data');
  if (!el || !dataEl || !window.L) return;
  var D = JSON.parse(dataEl.textContent), one = el.getAttribute('data-mode') === 'one', slug = el.getAttribute('data-slug');
  var flip = function (ring) { return ring.map(function (p) { return [p[1], p[0]]; }); };
  var map = L.map(el, { scrollWheelZoom: false, tap: true, zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
  var COL = { 'Under review': '#c77700', Approved: '#0f6b4f', 'Application received': '#2457a6' };
  var bounds = [];
  D.hoods.forEach(function (h) {
    if (!h.outline || !h.outline.length) return;
    var me = one && h.slug === slug;
    var poly = L.polygon(h.outline.map(flip), {
      color: one && !me ? '#5d6661' : '#0f4c3a', weight: me ? 3 : (one ? 1.2 : 2), fillColor: '#0f4c3a', fillOpacity: me ? 0.08 : (one ? 0.03 : 0.16), dashArray: one && !me ? '4 4' : null,
    }).addTo(map);
    poly.bindTooltip(h.name, { sticky: true, className: 'hd-label' });
    poly.on('click', function () { if (!me) location.href = h.url; });
    if (!one || me) h.outline.forEach(function (r) { bounds = bounds.concat(flip(r)); });
  });
  if (one) {
    D.devs.forEach(function (d) {
      var c = COL[d.status] || '#5d6661';
      (d.shape || []).forEach(function (r) { L.polygon(flip(r), { color: c, weight: 2, fillColor: c, fillOpacity: 0.35 }).addTo(map).bindPopup('<b>' + d.name + '</b><br>' + d.type + ': ' + d.status.toLowerCase() + (d.homes ? '<br>' + d.homes + ' homes planned' : '')); });
      if (d.centre) bounds.push(d.centre);
    });
  }
  if (one && bounds.length) map.fitBounds(bounds, { padding: [18, 18] });
  else map.setView([49.722, -123.138], el.clientWidth > 600 ? 13 : 12); // the whole town
})();
