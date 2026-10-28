(function () {
  function Evented() { this._l = {}; }
  Evented.prototype.on = function (type, a, b) {
    var fn = typeof a === 'function' ? a : b, layer = typeof a === 'string' ? a : null;
    (this._l[type] = this._l[type] || []).push({ fn: fn, layer: layer });
    return this;
  };
  Evented.prototype.off = function (type, fn) { this._l[type] = (this._l[type] || []).filter(function (x) { return x.fn !== fn; }); return this; };
  Evented.prototype.fire = function (type, ev) {
    var self = this;
    (this._l[type] || []).slice().forEach(function (x) { if (!x.layer) x.fn(Object.assign({ type: type, target: self }, ev || {})); });
  };
  function baseStyle() {
    return { layers: [
      { id: 'background', type: 'background' },
      { id: 'place-city', type: 'symbol', layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'] } },
      { id: 'road-shield', type: 'symbol', layout: { 'text-field': '{ref}', 'text-font': ['Noto Sans Bold'] } },
      { id: 'poi_r1', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 16, layout: { 'text-field': '{name}', 'text-font': ['Noto Sans Regular'] } },
      { id: 'label_other', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': '{name}', 'text-font': ['Noto Sans Italic'] } }
    ] };
  }
  function Map(opts) {
    Evented.call(this);
    var self = this;
    this.calls = [];
    this.container = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'maplibregl-canvas';
    this.container.appendChild(this.canvas);
    this.center = { lng: opts.center[0], lat: opts.center[1] };
    this.zoom = opts.zoom;
    this.opts = opts;
    this.sources = {}; this.layers = []; this.images = {};
    this.style = baseStyle();
    this.touchZoomRotate = { disableRotation: function () {} };
    window.__map = this;
    setTimeout(function () { self.fire('style.load'); self.fire('load'); }, 50);
  }
  Map.prototype = Object.create(Evented.prototype);
  Map.prototype._ll = function () { var c = this.center; return { lng: c.lng, lat: c.lat, toArray: function () { return [c.lng, c.lat]; } }; };
  Map.prototype.getStyle = function () { return JSON.parse(JSON.stringify({ layers: this.style.layers.concat(this.layers) })); };
  Map.prototype.setStyle = function (s, o) { var self = this; this.calls.push(['setStyle', o]); this.sources = {}; this.layers = []; this.images = {}; this.style = baseStyle(); setTimeout(function () { self.fire('style.load'); }, 30); };
  Map.prototype.addSource = function (id, s) {
    if (this.sources[id]) throw new Error('source exists ' + id);
    this.sources[id] = { spec: s, data: s.data, setData: function (d) { this.data = d; }, getClusterExpansionZoom: function () { return Promise.resolve(12); },
      setClusterOptions: function (options) { Object.assign(this.spec, options); this.clusterUpdates = (this.clusterUpdates || 0) + 1; return Promise.resolve(); },
      getClusterLeaves: function () { return Promise.resolve(((this.data && this.data.features) || []).slice()); } };
  };
  Map.prototype.getSource = function (id) { return this.sources[id]; };
  Map.prototype._find = function (id) { return this.style.layers.concat(this.layers).filter(function (l) { return l.id === id; })[0]; };
  Map.prototype.addLayer = function (l) { if (this._find(l.id)) throw new Error('layer exists ' + l.id); if (!this.sources[l.source]) throw new Error('no source ' + l.source); this.layers.push(JSON.parse(JSON.stringify(l))); };
  Map.prototype.getLayer = function (id) { return this._find(id); };
  Map.prototype.setLayoutProperty = function (id, k, v) { var l = this._find(id); if (!l) throw new Error('no layer ' + id); (l.layout = l.layout || {})[k] = v; };
  Map.prototype.setPaintProperty = function (id, k, v) { var l = this._find(id); if (!l) throw new Error('no layer ' + id); (l.paint = l.paint || {})[k] = v; };
  Map.prototype.querySourceFeatures = function (src, o) { return (window.__qsf || []).filter(function (f) { return !o || !o.sourceLayer || f.sourceLayer === o.sourceLayer; }); };
  Map.prototype.setLayerZoomRange = function (id, lo, hi) { var l = this._find(id); if (!l) throw new Error('no layer ' + id); l.minzoom = lo; l.maxzoom = hi; };
  Map.prototype.setFilter = function (id, f) { var l = this._find(id); if (!l) throw new Error('no layer ' + id); l.filter = f; };
  Map.prototype.addImage = function (id, img, o) {
    if (this.images[id]) throw new Error('image exists ' + id);
    if (!img || !img.width || !img.data || img.data.length !== img.width * img.height * 4) throw new Error('bad image ' + id);
    this.images[id] = { w: img.width, h: img.height, pr: o && o.pixelRatio };
  };
  Map.prototype.hasImage = function (id) { return !!this.images[id]; };
  Map.prototype.setProjection = function (p) { this.projection = p; };
  Map.prototype.setSky = function (s) { this.sky = s; };
  Map.prototype._move = function (o) {
    var self = this;
    this.calls.push(['move', JSON.parse(JSON.stringify(o || {}))]);
    if (o && o.center) this.center = Array.isArray(o.center) ? { lng: o.center[0], lat: o.center[1] } : { lng: o.center.lng, lat: o.center.lat };
    if (o && o.zoom != null) this.zoom = o.zoom;
    setTimeout(function () { self.fire('zoom'); self.fire('moveend'); }, 10);
  };
  Map.prototype.flyTo = function (o) { this._move(o); };
  Map.prototype.easeTo = function (o) { this._move(o); };
  Map.prototype.jumpTo = function (o) { this._move(o); };
  Map.prototype.panBy = function (off) { this._move({ panBy: off }); };
  Map.prototype.zoomIn = function () { this._move({ zoom: this.zoom + 1 }); };
  Map.prototype.zoomOut = function () { this._move({ zoom: this.zoom - 1 }); };
  Map.prototype.getCenter = function () { return this._ll(); };
  Map.prototype.getZoom = function () { return this.zoom; };
  Map.prototype.getContainer = function () { return this.container; };
  Map.prototype.getCanvas = function () { return this.canvas; };
  Map.prototype.unproject = function () { return this._ll(); };
  /* window.__qrf 里的要素带 layer.id 时，只在查询那一层时返回 */
  Map.prototype.queryRenderedFeatures = function (pt, o) {
    var want = o && o.layers;
    return (window.__qrf || []).filter(function (f) { return !want || !f.layer || want.indexOf(f.layer.id) !== -1; });
  };
  Map.prototype.resize = function () {};
  function Marker(o) { this.el = (o && o.element) || document.createElement('div'); }
  Marker.prototype.setLngLat = function (ll) { this.ll = ll; return this; };
  Marker.prototype.addTo = function (m) { m.container.appendChild(this.el); window.__markers = (window.__markers || 0) + 1; return this; };
  Marker.prototype.remove = function () { this.el.remove(); };
  window.maplibregl = { Map: Map, Marker: Marker };
})();
