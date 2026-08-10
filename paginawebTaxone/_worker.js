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
  `CREATE INDEX IF NOT EXISTS idx_driver_seen ON drivers(status,is_online,last_seen_at)`
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url), db = env.taxote_db;
    const origin = request.headers.get("Origin") || "*";
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Accept,Authorization,Cookie",
      "Access-Control-Allow-Credentials": "true",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    try {
      if (!db) throw new HttpError(503, "Base de datos no vinculada.");
      await ensureSchema(db);

      const path = url.pathname.replace(/\/$/, "");
      const method = request.method;

      // MASTER RESET - PUBLIC FOR FIX PHASE
      if (path === "/api/admin/reset-database-MASTER-FORCE") {
          await db.batch([
              db.prepare("DELETE FROM driver_documents"),
              db.prepare("DELETE FROM driver_sessions"),
              db.prepare("DELETE FROM ride_rejections"),
              db.prepare("DELETE FROM ride_stops"),
              db.prepare("DELETE FROM rides"),
              db.prepare("DELETE FROM driver_deposits"),
              db.prepare("DELETE FROM chat_messages"),
              db.prepare("DELETE FROM internal_chat_messages"),
              db.prepare("DELETE FROM admin_notifications"),
              db.prepare("DELETE FROM sessions"),
              db.prepare("DELETE FROM profiles"),
              db.prepare("DELETE FROM drivers")
          ]);
          return json({ ok: true, message: "SISTEMA LIMPIO AL 100%" }, 200, headers);
      }

      // Admin Login
      if (path === "/api/admin/login" && method === "POST") {
        const body = await bodyJson(request);
        if (body.username === "TAXOTEadmin1995" && body.password === "123Taxote123@1995") {
          const token = id("ADM");
          const expires = new Date(); expires.setHours(23, 59, 59, 999);
          return json({ ok: true, token }, 200, {
            "Set-Cookie": `taxote_admin_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly; Domain=${url.hostname}; Expires=${expires.toUTCString()}`,
            ...headers
          });
        }
        throw new HttpError(401, "Admin incorrecto.");
      }

      // Check Admin Auth for restricted pages
      const adminPaths = ["/api/admin/", "/api/dispatch/", "/reports.html", "/drivers.html", "/history.html", "/conversation-history.html", "/drivers-chat.html"];
      if (adminPaths.some(p => path.startsWith(p))) {
        const cookies = parseCookies(request);
        if (!cookies.taxote_admin_session && !path.includes("reset-database")) {
          if (!path.startsWith("/api/")) return Response.redirect(`${url.origin}/admin-login.html?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
          throw new HttpError(401, "No autorizado.");
        }
      }

      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      return await handleApi(request, env, url, headers);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json({ error: error.message || "Error interno." }, status, headers);
    }
  }
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function ensureSchema(db) { if (!schemaReady) { await db.batch(CORE_SCHEMA.map(s => db.prepare(s))); schemaReady = true; } }

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", ...headers }
  });
}

async function bodyJson(req) { try { return await req.json(); } catch { throw new HttpError(400, "JSON inválido."); } }
function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split("-")[0].toUpperCase()}`; }
function clean(v) { return String(v ?? "").trim(); }
function phone(v) { let d = String(v ?? "").replace(/\D/g, ""); if (d.length === 11 && d.startsWith("1")) d = d.slice(1); return d; }

function parseCookies(req) {
  const c = {};
  const h = req.headers.get("cookie") || "";
  h.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) c[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return c;
}

async function sha256(v) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function passwordHash(p, s) { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveBits"]), b = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations: 100000 }, k, 256); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function createSession(db, t, o, idVal) { const tok = crypto.randomUUID().replaceAll("-", ""), e = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(); await db.prepare(`INSERT INTO ${t}(token_hash,${o},expires_at,created_at) VALUES(?,?,?,?)`).bind(await sha256(tok), idVal, e, nowIso()).run(); return tok; }
async function driverSession(req, db) { const t = parseCookies(req).taxote_driver_session; if (!t) return null; return db.prepare(`SELECT d.* FROM driver_sessions s JOIN drivers d ON d.id=s.driver_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(t), nowIso()).first(); }

function driverView(row, detailed = false) {
  const v = {
    id: row.public_id, name: `${row.first_name} ${row.last_name}`.trim(),
    phone: row.phone, email: row.email, vehiclePlate: row.vehicle_plate,
    vehicleBrand: row.vehicle_brand, vehicleModel: row.vehicle_model,
    vehicleColor: row.vehicle_color, vehicleType: row.vehicle_type,
    status: row.status, pointsBalance: Number(row.points_balance || 0),
    online: Boolean(row.is_online), createdAt: row.created_at
  };
  if (detailed) v.documents = {
    selfie: `/api/admin/drivers/${row.public_id}/document/selfie`,
    idFront: `/api/admin/drivers/${row.public_id}/document/idFront`,
    vehicle: `/api/admin/drivers/${row.public_id}/document/vehicle`
  };
  return v;
}

async function handleApi(request, env, url, headers) {
  const db = env.taxote_db, path = url.pathname.replace(/\/$/, ""), method = request.method;

  // --- DRIVER API ---

  if (path === "/api/driver/register" && method === "POST") {
    const body = await bodyJson(request);
    const p = phone(body.phone), e = clean(body.email).toLowerCase(), c = clean(body.cedula), pl = clean(body.vehiclePlate).toUpperCase();

    // Nuclear Fix: Remove existing pending/cancelled driver with same identifiers
    await db.prepare("DELETE FROM drivers WHERE (phone=? OR email=? OR cedula=? OR vehicle_plate=?) AND status != 'active'").bind(p, e, c, pl).run();

    const salt = crypto.randomUUID().replaceAll("-", ""), hash = await passwordHash(body.password, salt), did = id("DRV"), stamp = nowIso();
    const result = await db.prepare(`INSERT INTO drivers(public_id,first_name,last_name,email,phone,password_hash,password_salt,cedula,vehicle_type,vehicle_brand,vehicle_model,vehicle_color,vehicle_plate,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`)
      .bind(did, clean(body.firstName), clean(body.lastName), e, p, hash, salt, c, clean(body.vehicleType), clean(body.vehicleBrand), clean(body.vehicleModel), clean(body.vehicleColor), pl, stamp, stamp).run();

    const driverId = result.meta.last_row_id;
    if (body.selfiePhoto) await db.prepare("INSERT INTO driver_documents(driver_id,kind,data_url,created_at) VALUES(?,?,?,?)").bind(driverId, "selfie", body.selfiePhoto, stamp).run();
    if (body.idFront) await db.prepare("INSERT INTO driver_documents(driver_id,kind,data_url,created_at) VALUES(?,?,?,?)").bind(driverId, "idFront", body.idFront, stamp).run();
    if (body.vehiclePhoto) await db.prepare("INSERT INTO driver_documents(driver_id,kind,data_url,created_at) VALUES(?,?,?,?)").bind(driverId, "vehicle", body.vehiclePhoto, stamp).run();

    return json({ ok: true, driverId: did }, 201, headers);
  }

  if (path === "/api/driver/login" && method === "POST") {
    const body = await bodyJson(request);
    const input = clean(body.phone || body.email);
    const driver = await db.prepare(`SELECT * FROM drivers WHERE phone=? OR email=?`).bind(phone(input), input.toLowerCase()).first();
    if (!driver || await passwordHash(body.password, driver.password_salt) !== driver.password_hash) throw new HttpError(401, "Credenciales incorrectas.");
    if (driver.status !== "active") throw new HttpError(403, "Cuenta no activa.");
    const token = await createSession(db, "driver_sessions", "driver_id", driver.id);
    return json({ ok: true, driver: driverView(driver) }, 200, {
      "Set-Cookie": `taxote_driver_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly; Domain=${url.hostname}; Max-Age=${SESSION_DAYS * 86400}`,
      ...headers
    });
  }

  if ((path === "/api/driver/status" || path === "/api/driver/me") && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "Sesión expirada.");
    return json({ ok: true, driver: driverView(driver) }, 200, headers);
  }

  if (path === "/api/driver/location" && method === "POST") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const body = await bodyJson(request), stamp = nowIso();
    await db.prepare("UPDATE drivers SET current_lat=?, current_lon=?, current_bearing=?, last_seen_at=?, is_online=1, updated_at=? WHERE id=?").bind(Number(body.lat), Number(body.lon), Number(body.bearing || 0), stamp, stamp, driver.id).run();
    return json({ ok: true }, 200, headers);
  }

  // --- ADMIN API ---

  if (path === "/api/admin/driver-locations" && method === "GET") {
    const threshold = new Date(Date.now() - 5 * 60000).toISOString();
    const { results } = await db.prepare("SELECT * FROM drivers WHERE status='active' AND is_online=1 AND last_seen_at > ?").bind(threshold).all();
    return json(results.map(r => ({
      id: r.public_id, name: `${r.first_name} ${r.last_name}`.trim(),
      location: { lat: Number(r.current_lat), lon: Number(r.current_lon), bearing: Number(r.current_bearing || 0) },
      vehiclePlate: r.vehicle_plate, connectionState: 'available'
    })), 200, headers);
  }

  if (path === "/api/dispatch/rides" && method === "GET") {
    const { results } = await db.prepare("SELECT r.*, d.first_name, d.last_name FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status NOT IN ('completed','cancelled') ORDER BY r.created_at DESC").all();
    return json(results.map(r => ({
      id: r.public_id, passenger: r.passenger_name, phone: r.passenger_phone, pickup: r.pickup_address, destination: r.destination_address,
      driver: r.first_name ? `${r.first_name} ${r.last_name}` : "—", status: r.status, priceDop: Number(r.price_dop), createdAt: r.created_at
    })), 200, headers);
  }

  if (path === "/api/admin/drivers" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM drivers ORDER BY created_at DESC").all();
    return json(results.map(r => driverView(r)), 200, headers);
  }

  // --- MAP SERVICES ---

  if (path === "/api/route") {
      const coords = url.searchParams.get("coordinates");
      const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      return json(await resp.json(), 200, headers);
  }

  if (path === "/api/geocode") {
      const q = url.searchParams.get("q");
      const { results } = await db.prepare("SELECT * FROM addresses WHERE name LIKE ? LIMIT 10").bind(`%${q}%`).all();
      return json(results.map(r => ({ display_name: r.name, lat: r.lat, lon: r.lon })), 200, headers);
  }

  if (path === "/api/reverse") {
      const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
      const r = await db.prepare("SELECT * FROM addresses ORDER BY ((lat-?)*(lat-?)+(lon-?)*(lon-?)) LIMIT 1").bind(lat, lat, lon, lon).first();
      return r ? json({ display_name: r.name, lat: r.lat, lon: r.lon }, 200, headers) : json({ error: "Not found" }, 404, headers);
  }

  throw new HttpError(404, "No encontrado");
}

async function driverRideView(db, r) {
  const { results: stops } = await db.prepare("SELECT * FROM ride_stops WHERE ride_id=? ORDER BY position").bind(r.id).all();
  return { id: r.public_id, passenger: r.passenger_name, phone: r.passenger_phone, pickup: r.pickup_address, pickupLat: Number(r.pickup_lat), pickupLon: Number(r.pickup_lon), destination: r.destination_address, destinationLat: Number(r.destination_lat), destinationLon: Number(r.destination_lon), status: r.status, priceDop: Number(r.price_dop), stops: stops || [], note: r.note, createdAt: r.created_at };
}
