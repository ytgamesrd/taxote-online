const ACTIVE_RIDE_STATUSES = ["accepted", "driver_arriving", "arrived", "in_progress"];
const SESSION_DAYS = 30;
let schemaReady = false;

const CORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, house_number TEXT, street TEXT, suburb TEXT, city TEXT, province TEXT, postcode TEXT, lat REAL NOT NULL, lon REAL NOT NULL, place_id TEXT UNIQUE)`,
  `CREATE INDEX IF NOT EXISTS idx_addr_lat_lon ON addresses(lat, lon)`,
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
    const headers = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    try {
      if (!db) throw new HttpError(503, "Base de datos no vinculada.");
      await ensureSchema(db);

      const path = url.pathname.replace(/\/$/, "");
      const method = request.method;

      // Public Admin Login
      if (path === "/api/admin/login" && method === "POST") {
        const body = await bodyJson(request);
        if (body.username === "TAXOTEadmin1995" && body.password === "123Taxote123@1995") {
          const token = id("ADM");
          return json({ ok: true, token }, 200, {
            "Set-Cookie": `taxote_admin_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly`,
            ...headers
          });
        }
        throw new HttpError(401, "Admin incorrecto.");
      }

      // Admin Auth Check
      const adminPaths = ["/api/admin/", "/api/dispatch/", "/reports.html", "/drivers.html", "/history.html", "/conversation-history.html", "/drivers-chat.html"];
      if (adminPaths.some(p => path.startsWith(p))) {
        const cookies = parseCookies(request);
        if (!cookies.taxote_admin_session) throw new HttpError(401, "No autorizado.");
      }

      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      return await handleApi(request, env, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error(error);
      return json({ error: error.message || "Error interno." }, status, corsHeaders(request));
    }
  }
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function ensureSchema(db) { if (!schemaReady) { await db.batch(CORE_SCHEMA.map(s => db.prepare(s))); schemaReady = true; } }

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,Authorization,Cookie",
    "Cache-Control": "no-store"
  };
  if (origin !== "*") {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Credentials"] = "true";
  } else {
    h["Access-Control-Allow-Origin"] = "*";
  }
  return h;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", ...extraHeaders }
  });
}

async function bodyJson(req) { try { return await req.json(); } catch { throw new HttpError(400, "JSON inválido."); } }
function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split("-")[0].toUpperCase()}`; }
function clean(v) { return String(v ?? "").trim(); }
function phone(v) { let d = String(v ?? "").replace(/\D/g, ""); if (d.length === 11 && d.startsWith("1")) d = d.slice(1); return d; }

function parseCookies(req) {
  const c = {};
  const cookieHeader = req.headers.get("cookie") || "";
  cookieHeader.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) {
      const key = p.slice(0, i).trim();
      const val = p.slice(i + 1).trim();
      c[key] = decodeURIComponent(val);
    }
  });
  return c;
}

async function sha256(v) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function passwordHash(p, s) { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveBits"]), b = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations: 100000 }, k, 256); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function createSession(db, t, o, idVal) { const tok = crypto.randomUUID().replaceAll("-", ""), e = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(); await db.prepare(`INSERT INTO ${t}(token_hash,${o},expires_at,created_at) VALUES(?,?,?,?)`).bind(await sha256(tok), idVal, e, nowIso()).run(); return tok; }
async function driverSession(req, db) { const t = parseCookies(req).taxote_driver_session; if (!t) return null; return db.prepare(`SELECT d.* FROM driver_sessions s JOIN drivers d ON d.id=s.driver_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(t), nowIso()).first(); }

function driverView(row) {
  return { id: row.public_id, firstName: row.first_name, lastName: row.last_name, name: `${row.first_name} ${row.last_name}`.trim(), phone: row.phone, email: row.email, vehiclePlate: row.vehicle_plate, vehicleBrand: row.vehicle_brand, vehicleModel: row.vehicle_model, vehicleColor: row.vehicle_color, vehicleType: row.vehicle_type, status: row.status, pointsBalance: row.points_balance, online: Boolean(row.is_online), available: Boolean(row.is_available) };
}

async function driverRideView(db, r) {
  const { results: stops } = await db.prepare("SELECT * FROM ride_stops WHERE ride_id=? ORDER BY position").bind(r.id).all();
  return { id: r.public_id, passenger: r.passenger_name, phone: r.passenger_phone, pickup: r.pickup_address, pickupLat: Number(r.pickup_lat), pickupLon: Number(r.pickup_lon), destination: r.destination_address, destinationLat: Number(r.destination_lat), destinationLon: Number(r.destination_lon), status: r.status, priceDop: Number(r.price_dop), distanceKm: Number(r.distance_km || 0), durationMin: Number(r.duration_min || 0), stops: stops || [], note: r.note, createdAt: r.created_at, acceptedAt: r.accepted_at, arrivedAt: r.arrived_at, startedAt: r.started_at, completedAt: r.completed_at };
}

function dispatchRideView(r) {
  return { id: r.public_id, passenger: r.passenger_name, phone: r.passenger_phone, pickup: r.pickup_address, destination: r.destination_address, driver: r.first_name ? `${r.first_name} ${r.last_name}` : "—", status: r.status, priceDop: Number(r.price_dop), createdAt: r.created_at, contactedAt: r.contacted_at, contactedBy: r.contacted_by };
}

function messageView(m) {
  return { id: m.id, sender: m.sender, message: m.message, photo: m.photo_data, createdAt: m.created_at, adminRead: m.admin_read_at, driverRead: m.driver_read_at };
}

async function notify(db, kind, title, body, entityType, entityId) {
  await db.prepare("INSERT INTO admin_notifications(kind,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?)").bind(kind, title, body, entityType, entityId, nowIso()).run();
}

async function handleApi(request, env, url) {
  const db = env.taxote_db, path = url.pathname.replace(/\/$/, ""), method = request.method;
  const headers = corsHeaders(request);

  // --- DRIVER AUTH ---

  if (path === "/api/driver/register" && method === "POST") {
    const body = await bodyJson(request);
    const p = phone(body.phone), e = clean(body.email).toLowerCase(), c = clean(body.cedula);
    if (!p || !e || !body.password || !c) throw new HttpError(400, "Faltan datos requeridos.");

    const salt = crypto.randomUUID().replaceAll("-", "");
    const hash = await passwordHash(body.password, salt);
    const did = id("DRV"), stamp = nowIso();

    try {
      const res = await db.prepare(`INSERT INTO drivers(public_id,first_name,last_name,email,phone,password_hash,password_salt,cedula,vehicle_type,vehicle_brand,vehicle_model,vehicle_color,vehicle_plate,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(did, clean(body.firstName), clean(body.lastName), e, p, hash, salt, c, clean(body.vehicleType), clean(body.vehicleBrand), clean(body.vehicleModel), clean(body.vehicleColor), clean(body.vehiclePlate).toUpperCase(), "pending", stamp, stamp).run();

      const driver = await db.prepare("SELECT id FROM drivers WHERE public_id=?").bind(did).first();

      // Store documents
      if (body.documents && Array.isArray(body.documents)) {
        for (const doc of body.documents) {
          if (doc.kind && doc.data) {
            await db.prepare("INSERT OR REPLACE INTO driver_documents(driver_id,kind,data_url,created_at) VALUES(?,?,?,?)").bind(driver.id, doc.kind, doc.data, stamp).run();
          }
        }
      }

      await notify(db, "driver_registration", "Nuevo conductor", `${body.firstName} ${body.lastName} se ha registrado.`, "driver", did);
      return json({ ok: true, driverId: did }, 201, headers);
    } catch (err) {
      if (err.message.includes("UNIQUE")) throw new HttpError(409, "El teléfono, email o cédula ya están registrados.");
      throw err;
    }
  }

  if (path === "/api/driver/login" && method === "POST") {
    const body = await bodyJson(request);
    const input = clean(body.phone || body.email);
    const p = phone(input), e = input.toLowerCase();
    const driver = await db.prepare(`SELECT * FROM drivers WHERE phone=? OR email=?`).bind(p, e).first();
    if (!driver || await passwordHash(body.password, driver.password_salt) !== driver.password_hash) throw new HttpError(401, "Credenciales incorrectas.");
    if (driver.status !== "active") throw new HttpError(403, `Tu cuenta está ${driver.status === "pending" ? "en revisión" : "suspendida"}.`);

    const token = await createSession(db, "driver_sessions", "driver_id", driver.id);
    await db.prepare("UPDATE drivers SET last_login_at=?, is_online=1, updated_at=? WHERE id=?").bind(nowIso(), nowIso(), driver.id).run();

    return json({ ok: true, driver: driverView(driver) }, 200, {
      "Set-Cookie": `taxote_driver_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly`,
      ...headers
    });
  }

  if (path === "/api/driver/logout" && method === "POST") {
    const t = parseCookies(request).taxote_driver_session;
    if (t) await db.prepare("DELETE FROM driver_sessions WHERE token_hash=?").bind(await sha256(t)).run();
    return json({ ok: true }, 200, {
      "Set-Cookie": `taxote_driver_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly`,
      ...headers
    });
  }

  if ((path === "/api/driver/status" || path === "/api/driver/me") && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "Sesión expirada.");
    return json({ ok: true, driver: driverView(driver) }, 200, headers);
  }

  // --- DRIVER ACTIONS ---

  if (path === "/api/driver/location" && method === "POST") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const body = await bodyJson(request), stamp = nowIso();
    const online = body.isOnline !== undefined ? (body.isOnline ? 1 : 0) : driver.is_online;
    const available = body.isAvailable !== undefined ? (body.isAvailable ? 1 : 0) : driver.is_available;

    await db.prepare("UPDATE drivers SET current_lat=?, current_lon=?, current_accuracy=?, current_bearing=?, current_speed_kph=?, is_online=?, is_available=?, last_seen_at=?, updated_at=? WHERE id=?")
      .bind(Number(body.lat), Number(body.lon), Number(body.accuracy || 0), Number(body.bearing || 0), Number(body.speed || 0), online, available, stamp, stamp, driver.id).run();
    return json({ ok: true }, 200, headers);
  }

  if (path === "/api/driver/work" && method === "GET") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const active = await db.prepare("SELECT * FROM rides WHERE driver_id=? AND status NOT IN ('completed','cancelled') LIMIT 1").bind(driver.id).first();
    const { results: offers } = await db.prepare("SELECT * FROM rides WHERE status='pending' AND (driver_id IS NULL OR driver_id=?) ORDER BY created_at DESC LIMIT 10").bind(driver.id).all();
    return json({
      activeRide: active ? await driverRideView(db, active) : null,
      offers: await Promise.all(offers.map(o => driverRideView(db, o)))
    }, 200, headers);
  }

  const rideMatch = path.match(/^\/api\/driver\/rides\/([^\/]+)\/(accept|status|cancel|chat)$/);
  if (rideMatch) {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const rideId = rideMatch[1], action = rideMatch[2];
    const ride = await db.prepare("SELECT * FROM rides WHERE public_id=?").bind(rideId).first();
    if (!ride) throw new HttpError(404, "Viaje no encontrado.");

    if (action === "accept" && method === "POST") {
      if (ride.status !== "pending") throw new HttpError(400, "El viaje ya no está disponible.");
      await db.prepare("UPDATE rides SET status='accepted', driver_id=?, accepted_at=? WHERE id=?").bind(driver.id, nowIso(), ride.id).run();
      await db.prepare("UPDATE drivers SET is_available=0 WHERE id=?").bind(driver.id).run();
      return json({ ok: true }, 200, headers);
    }

    if (action === "status" && method === "POST") {
      if (ride.driver_id !== driver.id) throw new HttpError(403, "No autorizado.");
      const body = await bodyJson(request), s = body.status, stamp = nowIso();
      let query = "UPDATE rides SET status=?, updated_at=?";
      if (s === "arrived") query += ", arrived_at=?";
      else if (s === "in_progress") query += ", started_at=?";
      else if (s === "completed") query += ", completed_at=?, closed_at=?";

      const params = [s, stamp];
      if (s === "arrived" || s === "in_progress") params.push(stamp);
      else if (s === "completed") { params.push(stamp); params.push(stamp); }
      params.push(ride.id);

      await db.prepare(query + " WHERE id=?").bind(...params).run();
      if (s === "completed") await db.prepare("UPDATE drivers SET is_available=1 WHERE id=?").bind(driver.id).run();
      return json({ ok: true }, 200, headers);
    }

    if (action === "cancel" && method === "POST") {
      const body = await bodyJson(request);
      await db.prepare("UPDATE rides SET status='cancelled', cancelled_at=?, cancelled_by='driver', cancellation_reason=? WHERE id=?").bind(nowIso(), body.reason || "Conductor canceló", ride.id).run();
      await db.prepare("UPDATE drivers SET is_available=1 WHERE id=?").bind(driver.id).run();
      return json({ ok: true }, 200, headers);
    }

    if (action === "chat") {
      if (method === "GET") {
        const { results } = await db.prepare("SELECT * FROM chat_messages WHERE ride_id=? ORDER BY created_at ASC").bind(ride.id).all();
        await db.prepare("UPDATE chat_messages SET driver_read_at=? WHERE ride_id=? AND sender='passenger'").bind(nowIso(), ride.id).run();
        return json(results.map(messageView), 200, headers);
      }
      if (method === "POST") {
        const body = await bodyJson(request), stamp = nowIso();
        await db.prepare("INSERT INTO chat_messages(channel,driver_id,ride_id,sender,message,photo_data,created_at) VALUES(?,?,?,?,?,?,?)")
          .bind("ride", driver.id, ride.id, "driver", body.message || "", body.photo || null, stamp).run();
        return json({ ok: true }, 201, headers);
      }
    }
  }

  // --- WALLET & HISTORY ---

  if (path === "/api/driver/wallet" && method === "GET") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const { results: deposits } = await db.prepare("SELECT * FROM driver_deposits WHERE driver_id=? ORDER BY created_at DESC LIMIT 20").bind(driver.id).all();
    return json({ balance: driver.points_balance, deposits }, 200, headers);
  }

  if (path === "/api/driver/history" && method === "GET") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const { results } = await db.prepare("SELECT * FROM rides WHERE driver_id=? AND status='completed' ORDER BY created_at DESC LIMIT 50").bind(driver.id).all();
    return json(await Promise.all(results.map(r => driverRideView(db, r))), 200, headers);
  }

  if (path === "/api/driver/points/deposit" && method === "POST") {
    const driver = await driverSession(request, db); if (!driver) throw new HttpError(401, "Sesión expirada.");
    const body = await bodyJson(request), stamp = nowIso();
    await db.prepare("INSERT INTO driver_deposits(driver_id,points_requested,amount_dop,proof_data,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .bind(driver.id, Number(body.points), Number(body.amount), body.proofData || "", "pending", stamp, stamp).run();
    await notify(db, "deposit_request", "Solicitud de Recarga", `${driver.first_name} solicita ${body.points} puntos.`, "driver", driver.public_id);
    return json({ ok: true }, 201, headers);
  }

  // --- ADMIN & DISPATCH ---

  if (path === "/api/admin/driver-locations" && method === "GET") {
    const threshold = new Date(Date.now() - 5 * 60000).toISOString();
    const { results } = await db.prepare("SELECT * FROM drivers WHERE status='active' AND is_online=1 AND last_seen_at > ?").bind(threshold).all();
    return json(results.map(r => ({
      id: r.public_id, name: `${r.first_name} ${r.last_name}`.trim(), phone: r.phone,
      location: { lat: Number(r.current_lat), lon: Number(r.current_lon), bearing: Number(r.current_bearing || 0) },
      vehiclePlate: r.vehicle_plate, vehicleBrand: r.vehicle_brand, vehicleModel: r.vehicle_model, vehicleColor: r.vehicle_color,
      connectionState: r.is_available ? 'available' : 'busy'
    })), 200, headers);
  }

  if (path === "/api/dispatch/rides" && method === "GET") {
    const { results } = await db.prepare("SELECT r.*, d.first_name, d.last_name FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status NOT IN ('completed','cancelled') ORDER BY r.created_at DESC").all();
    return json(results.map(r => ({ ...dispatchRideView(r), pickupLat: Number(r.pickup_lat), pickupLon: Number(r.pickup_lon), destinationLat: Number(r.destination_lat), destinationLon: Number(r.destination_lon) })), 200, headers);
  }

  if (path === "/api/dispatch/clients" && method === "GET") {
    const { results } = await db.prepare("SELECT DISTINCT passenger_phone as phone, passenger_name as name FROM rides ORDER BY created_at DESC LIMIT 100").all();
    return json(results, 200, headers);
  }

  if (path === "/api/rides/estimate" && method === "POST") {
    const body = await bodyJson(request);
    // Logic for distance/price estimation
    const dist = Number(body.distanceKm || 5);
    const price = Math.max(150, Math.round(dist * 50));
    return json({ distanceKm: dist, priceDop: price, durationMin: Math.round(dist * 3) }, 200, headers);
  }

  if (path === "/api/rides" && method === "POST") {
    const body = await bodyJson(request), rid = id("RID"), stamp = nowIso(), p = phone(body.phone), n = clean(body.name);
    await db.prepare(`INSERT INTO rides(public_id,passenger_name,passenger_phone,pickup_address,pickup_lat,pickup_lon,destination_address,destination_lat,destination_lon,status,driver_id,note,price_dop,distance_km,duration_min,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(rid, n, p, clean(body.pickup.address), Number(body.pickup.lat), Number(body.pickup.lon), clean(body.destination.address), Number(body.destination.lat), Number(body.destination.lon), "pending", null, clean(body.note), Number(body.priceDop || 200), Number(body.distanceKm || 0), Number(body.durationMin || 0), stamp).run();
    return json({ ok: true, rideId: rid }, 201, headers);
  }

  if (path === "/api/contacts/lookup" && method === "GET") {
    const q = url.searchParams.get("q");
    const { results } = await db.prepare("SELECT DISTINCT passenger_name as name, passenger_phone as phone FROM rides WHERE passenger_phone LIKE ? OR passenger_name LIKE ? LIMIT 5").bind(`%${q}%`, `%${q}%`).all();
    return json(results, 200, headers);
  }

  // --- MAP SERVICES ---
  if (path === "/api/route") {
    const coords = url.searchParams.get("coordinates");
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    return new Response(resp.body, { status: resp.status, headers: { ...headers, "Content-Type": "application/json" } });
  }

  throw new HttpError(404, `No encontrado: ${method} ${path}`);
}
