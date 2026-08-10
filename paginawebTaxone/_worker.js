const ACTIVE_RIDE_STATUSES = ["accepted", "driver_arriving", "arrived", "in_progress"];
const USER_CANCELLABLE_STATUSES = ["pending", "accepted", "driver_arriving", "arrived"];
const SESSION_DAYS = 30;
let schemaReady = false;

const CORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, house_number TEXT, street TEXT, suburb TEXT, city TEXT, province TEXT, postcode TEXT, lat REAL NOT NULL, lon REAL NOT NULL, place_id TEXT UNIQUE)`,
  `CREATE INDEX IF NOT EXISTS idx_addr_lat_lon ON addresses(lat, lon)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS addresses_fts USING fts5(name, street, suburb, city, province, content='addresses', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'guest', name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT COLLATE NOCASE UNIQUE, password_hash TEXT, password_salt TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, profile_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS drivers (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE, phone TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, cedula TEXT NOT NULL UNIQUE, vehicle_type TEXT NOT NULL, vehicle_brand TEXT NOT NULL, vehicle_model TEXT NOT NULL, vehicle_color TEXT NOT NULL, vehicle_plate TEXT NOT NULL COLLATE NOCASE UNIQUE, payment_method TEXT, points_balance INTEGER NOT NULL DEFAULT 0, fcm_token TEXT, status TEXT NOT NULL DEFAULT 'pending', review_message TEXT, is_online INTEGER NOT NULL DEFAULT 0, is_available INTEGER NOT NULL DEFAULT 0, current_lat REAL, current_lon REAL, current_accuracy REAL, current_bearing REAL, current_speed_kph REAL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_at TEXT, last_login_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS driver_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, kind TEXT NOT NULL, data_url TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(driver_id,kind))`,
  `CREATE TABLE IF NOT EXISTS driver_sessions (token_hash TEXT PRIMARY KEY, driver_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rides (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, profile_id INTEGER NOT NULL, passenger_type TEXT NOT NULL DEFAULT 'guest', passenger_name TEXT NOT NULL, passenger_phone TEXT NOT NULL, pickup_address TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lon REAL NOT NULL, destination_address TEXT NOT NULL, destination_lat REAL NOT NULL, destination_lon REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', driver_id INTEGER, note TEXT, payment_method TEXT, passenger_count INTEGER NOT NULL DEFAULT 1, scheduled_at TEXT, price_dop INTEGER NOT NULL DEFAULT 0, distance_km REAL NOT NULL DEFAULT 0, duration_min INTEGER NOT NULL DEFAULT 0, driver_earnings_dop INTEGER NOT NULL DEFAULT 0, contacted_at TEXT, contacted_by TEXT, created_at TEXT NOT NULL, accepted_at TEXT, arrived_at TEXT, started_at TEXT, completed_at TEXT, cancelled_at TEXT, closed_at TEXT, cancellation_reason TEXT, cancellation_note TEXT, cancelled_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS ride_stops (id INTEGER PRIMARY KEY AUTOINCREMENT, ride_id INTEGER NOT NULL, position INTEGER NOT NULL, address TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, UNIQUE(ride_id,position))`,
  `CREATE TABLE IF NOT EXISTS ride_rejections (id INTEGER PRIMARY KEY AUTOINCREMENT, ride_id INTEGER NOT NULL, driver_id INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(ride_id,driver_id))`,
  `CREATE TABLE IF NOT EXISTS driver_deposits (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, points_requested INTEGER NOT NULL, amount_dop INTEGER NOT NULL, proof_data TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL, read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, driver_id INTEGER, ride_id INTEGER, sender TEXT NOT NULL, message TEXT, photo_data TEXT, created_at TEXT NOT NULL, admin_read_at TEXT, driver_read_at TEXT, passenger_read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS internal_chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, sender TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, reporter_type TEXT NOT NULL, reporter_id TEXT, reporter_name TEXT NOT NULL, ride_id TEXT, category TEXT NOT NULL, description TEXT NOT NULL, photo_data TEXT, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT, resolved_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_status_created ON rides(status,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_id,status)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_phone_created ON rides(passenger_phone,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_driver_seen ON drivers(status,is_online,last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_driver ON chat_messages(channel,driver_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id,created_at)`
];

async function postWhatsApp(request, env) {
  const WHATSAPP_TOKEN = env.WHATSAPP_ACCESS_TOKEN || "EAAOmZBRfZC5DgBSFgk9mtd6b9UZAafRo1YJYCjHZBhmWta99GaXKVG7cJWQ9XrJzq1W2sTXABR5TJxsEjfxmXZA9qs8wTxdSnFYiLrZBprmHoA7DStZAXHf1G0lBQxcHVigA0kahOZBL0ZC9dyRvZCTh8gEkSfznvZCHRZBOtUsCHPUZAuyRZA432kAR8wqOSBRXfXwnQCo0XvFv9taxVMr3ZCSSf3TYbxOruikjhEJ84TGspKsl5NZB6bay";
  if (request.method === "GET") {
    const url = new URL(request.url), mode = url.searchParams.get("hub.mode"), token = url.searchParams.get("hub.verify_token"), challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === "taxote_whatsapp_verify_token") return new Response(challenge, { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method === "POST") {
    try {
      const body = await request.json(), db = env.taxote_db;
      if (body.object === "whatsapp_business_account") {
        const value = body.entry?.[0]?.changes?.[0]?.value, message = value?.messages?.[0];
        if (message) {
          const from = message.from, text = message.text?.body || "Mensaje de WhatsApp", name = value?.contacts?.[0]?.profile?.name || "Usuario WhatsApp";
          await db.prepare(`INSERT INTO admin_notifications(kind,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?)`).bind("whatsapp", `WhatsApp de ${name}`, text, "whatsapp", from, new Date().toISOString()).run();
        }
      }
      return new Response("EVENT_RECEIVED", { status: 200 });
    } catch (e) { return new Response("Error", { status: 500 }); }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), db = env.taxote_db;
    if (url.pathname === "/api/whatsapp/webhook") return postWhatsApp(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    try {
      if (!db) throw new HttpError(503, "La base de datos taxote_db no está vinculada.");
      await ensureSchema(db);
      const path = url.pathname.replace(/\/$/, ""), method = request.method;

      // Admin Login
      if (path === "/api/admin/login" && method === "POST") {
        const body = await bodyJson(request);
        if (body.username === "TAXOTEadmin1995" && body.password === "123Taxote123@1995") {
          const token = id("ADM"), expires = new Date(); expires.setHours(23, 59, 59, 999);
          return json({ ok: true, token }, 200, { "Set-Cookie": `taxote_admin_session=${token}; Path=/; Secure; SameSite=Lax; Expires=${expires.toUTCString()}` });
        }
        throw new HttpError(401, "Usuario o contraseña de administrador incorrectos.");
      }

      // Midnight cleanup
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() < 2) await db.prepare("DELETE FROM chat_messages WHERE channel IN ('private', 'public')").run();

      // Middleware
      const adminPaths = ["/api/admin/", "/api/dispatch/", "/reports.html", "/drivers.html", "/deposits.html", "/history.html", "/drivers-chat.html", "/conversation-history.html"];
      const isHtml = !path.startsWith("/api/") && (path.endsWith(".html") || path === "" || path === "/");
      const isAdmin = adminPaths.some(p => path.startsWith(p)) || (isHtml && (path === "" || path === "/" || adminPaths.some(p => path === p.replace(".html", ""))));
      if (isAdmin) {
        const cookies = parseCookies(request);
        if (!cookies.taxote_admin_session) {
          if (!path.startsWith("/api/")) return Response.redirect(`${url.origin}/admin-login.html?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
          throw new HttpError(401, "No autorizado.");
        }
      }

      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      return await handleApi(request, env, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error("TAXOTE API ERROR:", error);
      return json({ error: error.message || "Error interno." }, status);
    }
  }
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function ensureSchema(db) { if (!schemaReady) { await db.batch(CORE_SCHEMA.map(s => db.prepare(s))); schemaReady = true; } }
function corsHeaders() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Accept", "Cache-Control": "no-store" }; }
function json(data, status = 200, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=UTF-8", ...corsHeaders(), ...extra } }); }
async function bodyJson(req) { try { return await req.json(); } catch { throw new HttpError(400, "JSON inválido."); } }
function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split("-")[0].toUpperCase()}`; }
function clean(v) { return String(v ?? "").trim(); }
function phone(v) { let d = String(v ?? "").replace(/\D/g, ""); if (d.length === 11 && d.startsWith("1")) d = d.slice(1); return d; }
function validRdPhone(v) { return /^(809|829|849)\d{7}$/.test(phone(v)); }
function safeNumber(v, n) { const num = Number(v); if (!Number.isFinite(num)) throw new HttpError(400, `${n} inválido.`); return num; }
function validateLocation(v, n) { if (!v || clean(v.address).length < 2) throw new HttpError(400, `Selecciona ${n}.`); const lat = safeNumber(v.lat, `Lat de ${n}`), lon = safeNumber(v.lon, `Lon de ${n}`); return { address: clean(v.address), lat, lon }; }
function parseCookies(req) { const c = {}; (req.headers.get("cookie") || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) c[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return c; }
function sessionCookie(n, t, cl = false) { return `${n}=${cl ? "" : encodeURIComponent(t)}; Path=/; Secure; SameSite=Lax; Max-Age=${cl ? 0 : SESSION_DAYS * 86400}`; }
function bytesToHex(b) { return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function sha256(v) { return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))); }
async function passwordHash(p, s) { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveBits"]), b = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations: 100000 }, k, 256); return bytesToHex(b); }
async function createSession(db, t, o, idVal) { const tok = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""), c = nowIso(), e = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(); await db.prepare(`INSERT INTO ${t}(token_hash,${o},expires_at,created_at) VALUES(?,?,?,?)`).bind(await sha256(tok), idVal, e, c).run(); return tok; }
async function userSession(req, db) { const t = parseCookies(req).taxote_user_session; if (!t) return null; return db.prepare(`SELECT p.* FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(t), nowIso()).first(); }
async function driverSession(req, db) { const t = parseCookies(req).taxote_driver_session; if (!t) return null; return db.prepare(`SELECT d.* FROM driver_sessions s JOIN drivers d ON d.id=s.driver_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(t), nowIso()).first(); }

function profileView(row) { return { id: row.public_id, name: row.name, phone: row.phone, email: row.email || "", kind: row.kind }; }
function documentUrl(idVal, k) { return `/api/admin/drivers/${encodeURIComponent(idVal)}/document/${encodeURIComponent(k)}`; }
function driverView(row, detailed = false) {
  const v = { id: row.public_id, name: `${row.first_name} ${row.last_name}`.trim(), phone: row.phone, email: row.email, vehiclePlate: row.vehicle_plate, vehicleBrand: row.vehicle_brand, vehicleModel: row.vehicle_model, vehicleColor: row.vehicle_color, vehicleType: row.vehicle_type, status: row.status, online: Boolean(row.is_online), points: Number(row.points_balance || 0), createdAt: row.created_at };
  if (detailed) v.documents = { selfie: documentUrl(row.public_id, "selfie"), idFront: documentUrl(row.public_id, "idFront"), vehicle: documentUrl(row.public_id, "vehicle") };
  return v;
}
function addressView(row) { return { display_name: formatAddress(row), lat: Number(row.lat), lon: Number(row.lon) }; }
function formatAddress(row) { return [row.house_number, row.street, row.suburb, row.city].filter(Boolean).join(", "); }

async function handleApi(request, env, url) {
  const db = env.taxote_db, path = url.pathname.replace(/\/$/, ""), method = request.method;
  if (path === "/api/health") return json({ ok: true });
  if (path === "/api/maps-status") return json({ googleConfigured: false, provider: "OSM" });

  if (path === "/api/geocode" && method === "GET") {
    const q = clean(url.searchParams.get("q")); if (q.length < 2) return json([]);
    const { results } = await db.prepare("SELECT * FROM addresses WHERE name LIKE ? OR street LIKE ? LIMIT 10").bind(`%${q}%`, `%${q}%`).all();
    return json(results.map(addressView));
  }
  if (path === "/api/reverse" && method === "GET") {
    const lat = safeNumber(url.searchParams.get("lat"), "Lat"), lon = safeNumber(url.searchParams.get("lon"), "Lon");
    const row = await db.prepare("SELECT * FROM addresses ORDER BY ((lat-?)*(lat-?)+(lon-?)*(lon-?)) LIMIT 1").bind(lat, lat, lon, lon).first();
    return row ? json(addressView(row)) : json({ error: "No encontrada" }, 404);
  }

  // Auth User
  if (path === "/api/auth/register" && method === "POST") {
    const body = await bodyJson(request);
    const salt = crypto.randomUUID(), hash = await passwordHash(body.password, salt), stamp = nowIso(), publicId = id("USR");
    const result = await db.prepare(`INSERT INTO profiles(public_id,kind,name,phone,email,password_hash,password_salt,created_at,updated_at) VALUES(?,'registered',?,?,?,?,?,?,?)`).bind(publicId, clean(body.name), phone(body.phone), clean(body.email).toLowerCase(), hash, salt, stamp, stamp).run();
    const profile = await db.prepare(`SELECT * FROM profiles WHERE id=?`).bind(result.meta.last_row_id).first();
    const token = await createSession(db, "sessions", "profile_id", profile.id);
    return json({ user: profileView(profile) }, 201, { "Set-Cookie": sessionCookie("taxote_user_session", token) });
  }
  if (path === "/api/auth/login" && method === "POST") {
    const body = await bodyJson(request);
    const profile = await db.prepare(`SELECT * FROM profiles WHERE phone=? AND kind='registered'`).bind(phone(body.phone)).first();
    if (!profile || await passwordHash(body.password, profile.password_salt) !== profile.password_hash) throw new HttpError(401, "Credenciales incorrectas.");
    const token = await createSession(db, "sessions", "profile_id", profile.id);
    return json({ user: profileView(profile) }, 200, { "Set-Cookie": sessionCookie("taxote_user_session", token) });
  }
  if (path === "/api/auth/me" && method === "GET") {
    const profile = await userSession(request, db);
    if (!profile) throw new HttpError(401, "No hay sesión.");
    return json({ user: profileView(profile) });
  }

  // Driver Endpoints
  if (path === "/api/driver/register" && method === "POST") {
    const body = await bodyJson(request);
    const salt = crypto.randomUUID(), hash = await passwordHash(body.password, salt), stamp = nowIso(), publicId = id("DRV");
    await db.prepare(`INSERT INTO drivers(public_id,first_name,last_name,email,phone,password_hash,password_salt,cedula,vehicle_type,vehicle_brand,vehicle_model,vehicle_color,vehicle_plate,payment_method,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).bind(publicId, clean(body.firstName), clean(body.lastName), clean(body.email).toLowerCase(), phone(body.phone), hash, salt, clean(body.cedula), clean(body.vehicleType), clean(body.vehicleBrand), clean(body.vehicleModel), clean(body.vehicleColor), clean(body.vehiclePlate).toUpperCase(), clean(body.paymentMethod), stamp, stamp).run();
    return json({ ok: true, driverId: publicId }, 201);
  }
  if (path === "/api/driver/login" && method === "POST") {
    const body = await bodyJson(request);
    const driver = await db.prepare(`SELECT * FROM drivers WHERE phone=?`).bind(phone(body.phone)).first();
    if (!driver || await passwordHash(body.password, driver.password_salt) !== driver.password_hash) throw new HttpError(401, "Credenciales incorrectas.");
    if (driver.status !== "active") throw new HttpError(403, "Cuenta no activa.");
    const token = await createSession(db, "driver_sessions", "driver_id", driver.id);
    return json({ driver: driverView(driver) }, 200, { "Set-Cookie": sessionCookie("taxote_driver_session", token) });
  }
  if (path === "/api/driver/location" && method === "POST") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const body = await bodyJson(request), lat = safeNumber(body.lat, "Lat"), lon = safeNumber(body.lon, "Lon"), stamp = nowIso();
    await db.prepare("UPDATE drivers SET current_lat=?, current_lon=?, current_bearing=?, last_seen_at=?, is_online=1, updated_at=? WHERE id=?").bind(lat, lon, Number(body.bearing || 0), stamp, stamp, driver.id).run();
    return json({ ok: true });
  }
  if (path === "/api/driver/work" && method === "GET") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const active = await db.prepare("SELECT * FROM rides WHERE driver_id=? AND status NOT IN ('completed','cancelled') LIMIT 1").bind(driver.id).first();
    const { results: offers } = await db.prepare("SELECT * FROM rides WHERE status='pending' AND (driver_id IS NULL OR driver_id=?) LIMIT 5").bind(driver.id).all();
    return json({ activeRide: active ? await driverRideView(db, active) : null, offers: await Promise.all(offers.map(o => driverRideView(db, o))) });
  }

  // Admin Endpoints
  if (path === "/api/admin/drivers" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM drivers ORDER BY created_at DESC").all();
    return json(results.map(driverView));
  }
  if (path === "/api/admin/connected-drivers" && method === "GET") {
    const threshold = new Date(Date.now() - 5 * 60000).toISOString();
    const { results } = await db.prepare("SELECT * FROM drivers WHERE status='active' AND is_online=1 AND last_seen_at > ?").bind(threshold).all();
    return json(results.map(r => ({ ...driverView(r), id: r.public_id, location: { lat: r.current_lat, lon: r.current_lon, bearing: r.current_bearing }, connectionState: 'available' })));
  }
  if (path === "/api/dispatch/rides" && method === "GET") {
    const { results } = await db.prepare("SELECT r.*, d.first_name, d.last_name FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status NOT IN ('completed','cancelled') ORDER BY r.created_at DESC").all();
    return json(results.map(r => ({ ...dispatchRideView(r), id: r.public_id, pickupLat: r.pickup_lat, pickupLon: r.pickup_lon, destinationLat: r.destination_lat, destinationLon: r.destination_lon })));
  }
  if (path.startsWith("/api/dispatch/rides/") && path.endsWith("/contacted") && method === "POST") {
    const rideId = path.split("/")[4], body = await bodyJson(request);
    await db.prepare("UPDATE rides SET contacted_at=?, contacted_by=? WHERE public_id=?").bind(nowIso(), body.adminName || "Admin", rideId).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/internal-chat" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM internal_chat_messages ORDER BY created_at ASC LIMIT 100").all();
    return json({ messages: results });
  }
  if (path === "/api/admin/internal-chat" && method === "POST") {
    const body = await bodyJson(request);
    await db.prepare("INSERT INTO internal_chat_messages(conversation_id, sender, message, created_at) VALUES(?,?,?,?)").bind("admin", "admin", clean(body.message), nowIso()).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/chats" && method === "GET") {
    const { results } = await db.prepare("SELECT id FROM chat_messages WHERE admin_read_at IS NULL").all();
    return json({ unreadCount: results.length });
  }
  if (path === "/api/admin/notifications" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM admin_notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT 50").all();
    return json({ unreadCount: results.length, notifications: results });
  }
  if (path === "/api/route" && method === "GET") {
    const coordinates = url.searchParams.get("coordinates");
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`);
    return new Response(response.body, response);
  }

  throw new HttpError(404, "API No encontrada");
}

async function driverRideView(db, r) {
  const stops = await db.prepare("SELECT * FROM ride_stops WHERE ride_id=? ORDER BY position").bind(r.id).all();
  return { id: r.public_id, passenger: r.passenger_name, phone: r.passenger_phone, pickup: r.pickup_address, pickupLat: r.pickup_lat, pickupLon: r.pickup_lon, destination: r.destination_address, destinationLat: r.destination_lat, destinationLon: r.destination_lon, status: r.status, priceDop: r.price_dop, stops: stops.results, note: r.note, createdAt: r.created_at };
}

function dispatchRideView(r) {
    return { id: r.public_id, passenger: r.passenger_name, phone: r.passenger_phone, pickup: r.pickup_address, destination: r.destination_address, driver: r.first_name ? `${r.first_name} ${r.last_name}` : "—", status: r.status, priceDop: r.price_dop, createdAt: r.created_at, contactedAt: r.contacted_at, contactedBy: r.contacted_by };
}
