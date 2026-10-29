// 测试用的假 Supabase：内存里的表 + 和数据库一样的可见性规则（RLS）。
// 测试里用 window.__sb 看表里的数据，用 window.__sbLogin / __sbLogout 模拟登录。
(function () {
  var seed = window.__sbSeed || {};
  var db = {
    profiles: (seed.profiles || []).slice(),
    places: (seed.places || []).slice(),
    visits: (seed.visits || []).slice(),
    wishlist: (seed.wishlist || []).slice(),
    homes: (seed.homes || []).slice(),
    poi: (seed.poi || window.__poi || []).slice()
  };
  var files = {}, types = {};
  var session = null, listeners = [], calls = [];
  window.__sb = { db: db, files: files, types: types, calls: calls };

  function uid() { return session ? session.user.id : null; }
  function newId() { return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); }
  function visibleVisit(v) { return v.visibility === 'public' || v.user_id === uid(); }
  function visible(table, row) {
    if (table === 'visits') return visibleVisit(row);
    if (table === 'places') return row.created_by === uid() || db.visits.some(function (v) { return v.place_id === row.id && visibleVisit(v); }) ||
      db.wishlist.some(function (w) { return w.place_id === row.id && w.user_id === uid(); });
    if (table === 'wishlist') return row.user_id === uid();
    if (table === 'homes') return row.is_public || row.user_id === uid();
    return true;
  }
  function canWrite(table, row) {
    if (!uid()) return false;
    if (table === 'visits' || table === 'homes') return row.user_id === uid();
    // 只能收藏看得见的地点
    if (table === 'wishlist') return row.user_id === uid() && db.places.some(function (p) { return p.id === row.place_id && visible('places', p); });
    if (table === 'places') return row.created_by === uid();
    if (table === 'profiles') return row.id === uid();
    return false;
  }
  function err(msg) { return { data: null, error: { message: msg } }; }

  function Query(table) {
    this.table = table; this.op = 'select'; this.filters = []; this.wantRows = true; this.one = null; this.payload = null; this.embed = null;
  }
  Query.prototype.select = function (cols) {
    if (this.op === 'select' || cols) {
      var m = /(\w+):profiles\(/.exec(cols || '');
      if (m) this.embed = m[1];
    }
    this.wantRows = true;
    return this;
  };
  Query.prototype.insert = function (row) { this.op = 'insert'; this.payload = row; this.wantRows = false; return this; };
  Query.prototype.upsert = function (row) { this.op = 'upsert'; this.payload = row; this.wantRows = false; return this; };
  Query.prototype.update = function (row) { this.op = 'update'; this.payload = row; this.wantRows = false; return this; };
  Query.prototype.delete = function () { this.op = 'delete'; this.wantRows = false; return this; };
  Query.prototype.eq = function (k, v) { this.filters.push([k, v, 'eq']); return this; };
  Query.prototype.in = function (k, v) { this.filters.push([k,v,'in']); return this; };
  Query.prototype.gte = function (k, v) { this.filters.push([k, v, 'gte']); return this; };
  Query.prototype.lte = function (k, v) { this.filters.push([k, v, 'lte']); return this; };
  Query.prototype.order = function () { return this; };
  Query.prototype.limit = function () { return this; };
  Query.prototype.single = function () { this.one = 'single'; this.wantRows = true; return this; };
  Query.prototype.maybeSingle = function () { this.one = 'maybe'; this.wantRows = true; return this; };
  Query.prototype.match = function (row) {
    return this.filters.every(function (f) { return f[2] === 'in' ? f[1].indexOf(row[f[0]]) !== -1 : f[2] === 'gte' ? row[f[0]] >= f[1] : f[2] === 'lte' ? row[f[0]] <= f[1] : row[f[0]] === f[1]; });
  };
  Query.prototype.run = function () {
    var self = this, t = db[this.table], rows, now = new Date().toISOString();
    calls.push([this.table, this.op]);
    if (this.table === 'visits' && this.op === 'update' && window.__sbFailVisibility && this.payload && Object.keys(this.payload).length === 1 && this.payload.visibility) return err('test visibility unavailable');
    if (this.table === 'visits' && this.op === 'insert' && window.__sbFailVisit) return err('test visit unavailable');
    if (this.op === 'upsert') {
      // 只有 homes 用：按 user_id 覆盖；和数据库触发器一样把位置取整到 0.1 度
      var up = Object.assign({}, this.payload, { updated_at: now });
      up.lat = Math.round(up.lat * 10) / 10; up.lng = Math.round(up.lng * 10) / 10;
      if (!canWrite(this.table, up)) return err('new row violates row-level security policy');
      db[this.table] = t.filter(function (r) { return r.user_id !== up.user_id; });
      db[this.table].push(up);
      window.__sb.db = db;
      rows = [up];
    } else if (this.op === 'insert') {
      var row = Object.assign({}, this.payload);
      if (this.table !== 'profiles' && !('user_id' in row) && this.table !== 'places') row.user_id = uid();
      if (this.table === 'places' && !('created_by' in row)) row.created_by = uid();
      if (this.table !== 'wishlist' && !row.id) row.id = newId();
      row.created_at = row.created_at || now;
      if (this.table === 'visits') { row.photos = row.photos || []; if (row.rating != null && (row.rating < 0 || row.rating > 5 || row.rating * 2 % 1)) return err('rating out of range'); }
      if (!canWrite(this.table, row)) return err('new row violates row-level security policy');
      t.push(row);
      rows = [row];
    } else {
      rows = t.filter(function (r) { return visible(self.table, r) && self.match(r); });
      if (this.op === 'update') {
        rows = rows.filter(function (r) { return canWrite(self.table, r); });
        rows.forEach(function (r) { Object.assign(r, self.payload, { updated_at: now }); });
      } else if (this.op === 'delete') {
        rows = rows.filter(function (r) { return canWrite(self.table, r); });
        db[this.table] = t.filter(function (r) { return rows.indexOf(r) === -1; });
        if (this.table === 'visits' || this.table === 'wishlist') {
          // 和数据库里的 drop_empty_place 触发器一样：没人记录、也没人想去了才删地点
          rows.forEach(function (v) {
            var used = function (x) { return x.place_id === v.place_id; };
            if (!db.visits.some(used) && !db.wishlist.some(used)) db.places = db.places.filter(function (p) { return p.id !== v.place_id; });
          });
        }
        window.__sb.db = db;
      }
    }
    var out = rows.map(function (r) {
      var o = JSON.parse(JSON.stringify(r));
      if (self.embed) o[self.embed] = db.profiles.filter(function (p) { return p.id === r.user_id; })[0] || null;
      return o;
    });
    if (!this.wantRows) return { data: null, error: null };
    if (this.one === 'single') return out.length === 1 ? { data: out[0], error: null } : err('expected one row, got ' + out.length);
    if (this.one === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, error: null };
  };
  Query.prototype.then = function (a, b) {
    var self = this;
    if (window.__holdDbReads && self.op === 'select') return new Promise(function (resolve) { (window.__resumeDbReads || (window.__resumeDbReads = [])).push(function () { resolve(self.run()); }); }).then(a,b);
    return new Promise(function (resolve) { setTimeout(function () { resolve(self.run()); }, 5); }).then(a, b);
  };

  function emit(event) { listeners.forEach(function (fn) { fn(event, session); }); }
  window.__sbLogin = function (id, email) {
    session = { user: { id: id, email: email } };
    if (!db.profiles.some(function (p) { return p.id === id; })) db.profiles.push({ id: id, name: '', country: '', region: '', city: '', district: '' });
    emit('SIGNED_IN');
  };
  window.__sbLogout = function () { session = null; emit('SIGNED_OUT'); };

  window.supabase = {
    createClient: function (url, key) {
      window.__sb.url = url; window.__sb.key = key;
      return {
        from: function (table) { return new Query(table); },
        /* 地点库搜索：名字里包含关键词就算搜到 */
        rpc: function (name, args) {
          calls.push(['rpc', name, args]);
          if (name !== 'search_poi') return Promise.resolve(err('no such function'));
          var q = String(args.q || '').toLowerCase();
          var rows = (window.__poi || []).filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1; });
          return new Promise(function (resolve) { setTimeout(function () { resolve({ data: rows, error: null }); }, 5); });
        },
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
          onAuthStateChange: function (fn) { listeners.push(fn); setTimeout(function () { fn('INITIAL_SESSION', session); }, 0); return { data: { subscription: { unsubscribe: function () {} } } }; },
          signInWithOtp: function (o) { calls.push(['otp', o.email, o.options && o.options.emailRedirectTo]); return Promise.resolve({ data: {}, error: null }); },
          signInWithOAuth: function (o) { calls.push(['oauth', o.provider]); return Promise.resolve({ data: {}, error: null }); },
          signOut: function () { window.__sbLogout(); return Promise.resolve({ error: null }); },
          signInAnonymously: function () {
            calls.push(['anon']);
            if (window.__sbNoAnon) return Promise.resolve(err('Anonymous sign-ins are disabled'));
            var id = 'eeeeeeee-0000-4000-8000-00000000' + String(Date.now() % 10000).padStart(4, '0');
            window.__sbLogin(id, '');
            session.user.is_anonymous = true;
            return Promise.resolve({ data: { session: session }, error: null });
          },
          linkIdentity: function (o) { calls.push(['link', o.provider]); return Promise.resolve({ data: {}, error: null }); }
        },
        storage: {
          from: function (bucket) {
            return {
              upload: function (path, blob, opts) {
                if (!uid() || path.split('/')[0] !== uid()) return Promise.resolve(err('not allowed'));
                calls.push(['upload', path]);
                return Promise.resolve(window.__sbUploadGate ? window.__sbUploadGate(path) : null).then(function () {
                  files[path] = blob.size; types[path] = opts && opts.contentType; return { data: { path: path }, error: null };
                });
              },
              remove: function (paths) { paths.forEach(function (p) { delete files[p]; }); return Promise.resolve({ data: [], error: null }); },
              getPublicUrl: function (path) { return { data: { publicUrl: 'https://example.invalid/storage/v1/object/public/' + bucket + '/' + path } }; }
            };
          }
        }
      };
    }
  };
})();
