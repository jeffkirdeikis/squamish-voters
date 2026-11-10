// Flood map on flood stories (Leaflet + OpenStreetMap): the province's designated floodplain polygons, alluvial fans,
// Squamish Valley Road and the river gauge with its live reading. The text beside it says the same, so it works without the map.
(function () {
  var el = document.getElementById('flood-map');
  if (!el || !window.L) return;
  var map = L.map(el, { scrollWheelZoom: false, tap: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap contributors · Floodplain: Province of BC' }).addTo(map);
  fetch('/news/data/squamish-flood-map.json').then(function (r) { return r.json(); }).then(function (g) {
    var gauge = null;
    var layer = L.geoJSON(g, {
      style: function (f) {
        var k = f.properties.kind;
        if (k === 'gauge') return { radius: 8, color: '#fff', weight: 2.5, fillColor: '#c23a2b', fillOpacity: 1 };
        if (k === 'road') return { color: '#a3222b', weight: 4, opacity: .95 };
        if (k === 'fan') return { color: '#c27800', weight: 1.5, dashArray: '4 4', fillColor: '#e0a640', fillOpacity: .3 };
        return { color: '#1f5fa3', weight: 1.2, fillColor: '#3f7fb8', fillOpacity: .32 };
      },
      pointToLayer: function (f, ll) { gauge = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2.5, fillColor: '#c23a2b', fillOpacity: 1 }); return gauge; },
      onEachFeature: function (f, l) {
        var p = f.properties;
        if (p.kind === 'road') l.bindTooltip('Squamish Valley Road: the only road in and out of the Upper Squamish Valley', { sticky: true });
        else if (p.kind === 'fan') l.bindTooltip((p.FLOODPLAIN_NAME || '') + ' (alluvial fan)', { sticky: true });
        else if (p.kind === 'floodplain') l.bindTooltip(p.FLOODPLAIN_NAME + ' floodplain, designated ' + (p.DESIGNATION_DATE || '').replace(/^(\d\d)\/(\d\d)$/, function (m, y, mo) { return ['January','February','March','April','May','June','July','August','September','October','November','December'][+mo - 1] + ' 19' + y; }), { sticky: true });
      },
    }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [8, 8] });
    [['Upper Squamish Valley', 49.875, -123.275], ['Paradise Valley', 49.832, -123.165], ['Brackendale', 49.772, -123.142], ['Downtown', 49.700, -123.152]].forEach(function (t) {
      L.marker([t[1], t[2]], { icon: L.divIcon({ className: 'fm-label', html: t[0], iconSize: null }), interactive: false, keyboard: false }).addTo(map);
    });
    if (gauge) {
      gauge.bindPopup('<b>River gauge near Brackendale</b><br>Loading the newest reading…');
      fetch('/api/flood/').then(function (r) { return r.json(); }).then(function (d) {
        var n = function (x) { return Math.round(x).toLocaleString('en-CA'); };
        gauge.setPopupContent('<b>River gauge near Brackendale</b><br>Now: <b>' + (d.gauge ? n(d.gauge.flow) : '?') + '</b> cubic metres per second' + (d.forecast ? '<br>Most likely peak: <b>' + n(d.forecast.peak.flow) + '</b>' : ''));
      }).catch(function () {});
    }
  }).catch(function () { el.innerHTML = '<p class="fm-fail">The map did not load. The list of who is exposed below says the same thing.</p>'; });
})();
