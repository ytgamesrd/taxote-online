const ACTIVE_RIDE_STATUSES = ["accepted", "driver_arriving", "arrived", "in_progress"];
const OPEN_RIDE_STATUSES = ["pending", ...ACTIVE_RIDE_STATUSES];
const SESSION_DAYS = 30;
const ADMIN_USERNAME_FALLBACK = "TAXOTEadmin1995";
const ADMIN_PASSWORD_FALLBACK = "123Taxote123@1995";
const FARE_BASE_DOP = 150;
const FARE_PER_KM_DOP = 21;
const FARE_PER_MIN_DOP = 0;
const FARE_MIN_DOP = 250;
let schemaReady = false;

const CORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, house_number TEXT, street TEXT, suburb TEXT, city TEXT, province TEXT, postcode TEXT, lat REAL NOT NULL, lon REAL NOT NULL, place_id TEXT UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'guest', name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT COLLATE NOCASE UNIQUE, password_hash TEXT, password_salt TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, profile_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS drivers (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE, phone TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, cedula TEXT NOT NULL UNIQUE, vehicle_type TEXT NOT NULL, vehicle_brand TEXT NOT NULL, vehicle_model TEXT NOT NULL, vehicle_color TEXT NOT NULL, vehicle_plate TEXT NOT NULL COLLATE NOCASE UNIQUE, payment_method TEXT, points_balance INTEGER NOT NULL DEFAULT 0, fcm_token TEXT, status TEXT NOT NULL DEFAULT 'pending', review_message TEXT, is_online INTEGER NOT NULL DEFAULT 0, is_available INTEGER NOT NULL DEFAULT 0, current_lat REAL, current_lon REAL, current_accuracy REAL, current_bearing REAL, current_speed_kph REAL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_at TEXT, last_login_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS driver_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, kind TEXT NOT NULL, data_url TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(driver_id,kind))`,
  `CREATE TABLE IF NOT EXISTS driver_sessions (token_hash TEXT PRIMARY KEY, driver_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rides (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, profile_id INTEGER NOT NULL, passenger_type TEXT NOT NULL DEFAULT 'guest', passenger_name TEXT NOT NULL, passenger_phone TEXT NOT NULL, pickup_address TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lon REAL NOT NULL, destination_address TEXT NOT NULL, destination_lat REAL NOT NULL, destination_lon REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', driver_id INTEGER, note TEXT, payment_method TEXT, passenger_count INTEGER NOT NULL DEFAULT 1, scheduled_at TEXT, price_dop INTEGER NOT NULL DEFAULT 0, distance_km REAL NOT NULL DEFAULT 0, duration_min INTEGER NOT NULL DEFAULT 0, driver_earnings_dop INTEGER NOT NULL DEFAULT 0, contacted_at TEXT, contacted_by TEXT, created_at TEXT NOT NULL, accepted_at TEXT, arrived_at TEXT, started_at TEXT, completed_at TEXT, cancelled_at TEXT, closed_at TEXT, cancellation_reason TEXT, cancellation_note TEXT, cancelled_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS ride_stops (id INTEGER PRIMARY KEY AUTOINCREMENT, ride_id INTEGER NOT NULL, position INTEGER NOT NULL, address TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, UNIQUE(ride_id,position))`,
  `CREATE TABLE IF NOT EXISTS ride_rejections (id INTEGER PRIMARY KEY AUTOINCREMENT, ride_id INTEGER NOT NULL, driver_id INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(ride_id,driver_id))`,
  `CREATE TABLE IF NOT EXISTS driver_deposits (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, points_requested INTEGER NOT NULL, amount_dop INTEGER NOT NULL, proof_data TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL, read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS driver_points_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, old_points INTEGER NOT NULL, new_points INTEGER NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, source TEXT NOT NULL, ride_id INTEGER, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, ip_address TEXT, user_agent TEXT, country TEXT, city TEXT, successful INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, driver_id INTEGER, ride_id INTEGER, sender TEXT NOT NULL, message TEXT, photo_data TEXT, created_at TEXT NOT NULL, admin_read_at TEXT, driver_read_at TEXT, passenger_read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS internal_chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, sender TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, photo_data TEXT)`,
  `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, reporter_type TEXT NOT NULL, reporter_id TEXT, reporter_name TEXT NOT NULL, ride_id TEXT, category TEXT NOT NULL, description TEXT NOT NULL, photo_data TEXT, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT, resolved_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_status_created ON rides(status,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_id,status)`,
  `CREATE INDEX IF NOT EXISTS idx_driver_seen ON drivers(status,is_online,last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_channel_created ON chat_messages(channel,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_ride_created ON chat_messages(ride_id,created_at)`
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    try {
      if (!env.taxote_db) throw new HttpError(503, "Base de datos no vinculada.");
      await ensureSchema(env.taxote_db);

      const path = normalizedPath(url.pathname);
      const method = request.method.toUpperCase();

      // Un único dominio canónico: evita sesiones distintas entre www y apex.
      if (url.hostname.toLowerCase() === "www.taxote.online") {
        const canonical = new URL(request.url);
        canonical.hostname = "taxote.online";
        return Response.redirect(canonical.toString(), 308);
      }

      // Login/logout admin quedan fuera de la protección.
      if (path === "/api/admin/login" && method === "POST") return adminLogin(request, env, headers);
      if (path === "/api/admin/logout" && method === "POST") return adminLogout(request, env, headers);

      const isAdmin = await adminSession(request, env.taxote_db);
      const protectedApi = path.startsWith("/api/admin/") || path.startsWith("/api/dispatch/");
      const publicStatic = /\.(?:css|js|png|jpe?g|webp|svg|ico|mp3|wav|woff2?|map)$/i.test(path);
      const loginPage = path === "/admin-login" || path === "/admin-login.html";

      if (protectedApi && !isAdmin) throw new HttpError(401, "No autorizado.");

      // Nunca proteger la propia pantalla de login. Cloudflare Assets puede normalizar
      // /admin-login.html -> /admin-login; ambos deben ser públicos.
      if (!url.pathname.startsWith("/api/") && !loginPage && !publicStatic && !isAdmin) {
        return Response.redirect(`${url.origin}/admin-login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
      }

      // Si ya hay sesión y el usuario abre el login manualmente, vuelve a la Central.
      if (loginPage && isAdmin) return Response.redirect(`${url.origin}/`, 302);

      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      return await handleApi(request, env, url, headers);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error("TAXOTE Worker:", error);
      return json({ error: error?.message || "Error interno." }, status, headers);
    }
  }
};

function normalizedPath(pathname) {
  const cleanPath = pathname.replace(/\/+$/, "");
  return cleanPath || "/";
}
function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,Authorization,Cookie",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store"
  };
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=UTF-8", ...headers } });
}
async function bodyJson(req) { try { return await req.json(); } catch { throw new HttpError(400, "JSON inválido."); } }
function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split("-")[0].toUpperCase()}`; }
function clean(v) { return String(v ?? "").trim(); }
function phone(v) { let d = String(v ?? "").replace(/\D/g, ""); if (d.length === 11 && d.startsWith("1")) d = d.slice(1); return d.slice(0, 10); }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
async function sha256(v) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(v))));
  return [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(String(salt)), iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(CORE_SCHEMA.map(sql => db.prepare(sql)));
  // Migraciones compatibles con bases D1 existentes.
  const migrations = [
    "ALTER TABLE internal_chat_messages ADD COLUMN photo_data TEXT",
    "ALTER TABLE drivers ADD COLUMN current_accuracy REAL",
    "ALTER TABLE drivers ADD COLUMN current_speed_kph REAL",
    "ALTER TABLE admin_sessions ADD COLUMN ip_address TEXT",
    "ALTER TABLE admin_sessions ADD COLUMN user_agent TEXT",
    "ALTER TABLE admin_sessions ADD COLUMN country TEXT",
    "ALTER TABLE admin_sessions ADD COLUMN city TEXT",
     "ALTER TABLE rides ADD COLUMN offer_after_at TEXT",
    "ALTER TABLE profiles ADD COLUMN debt_dop INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE rides ADD COLUMN fine_charged_dop INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE rides ADD COLUMN driver_penalty_points INTEGER NOT NULL DEFAULT 0"
  ];
  for (const sql of migrations) { try { await db.prepare(sql).run(); } catch {} }
  schemaReady = true;
}
async function createSession(db, table, ownerColumn, ownerId) {
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare(`INSERT INTO ${table}(token_hash,${ownerColumn},expires_at,created_at) VALUES(?,?,?,?)`)
    .bind(await sha256(token), ownerId, expires, nowIso()).run();
  return token;
}
async function profileSession(req, db) {
  const token = parseCookies(req).taxote_user_session;
  if (!token) return null;
  return db.prepare(`SELECT p.* FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await sha256(token), nowIso()).first();
}
async function driverSession(req, db) {
  const token = parseCookies(req).taxote_driver_session;
  if (!token) return null;
  return db.prepare(`SELECT d.* FROM driver_sessions s JOIN drivers d ON d.id=s.driver_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await sha256(token), nowIso()).first();
}
async function adminSession(req, db) {
  const token = parseCookies(req).taxote_admin_session;
  if (!token) return false;
  const hash = await sha256(token);
  const row = await db.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash=?").bind(hash).first();
  if (!row) return false;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(hash).run();
    return false;
  }
  return true;
}
async function adminLogin(request, env, headers) {
  const db = env.taxote_db;
  const body = await bodyJson(request);
  const expectedUser = env.ADMIN_USERNAME || ADMIN_USERNAME_FALLBACK;
  const expectedPass = env.ADMIN_PASSWORD || ADMIN_PASSWORD_FALLBACK;
  const loginIp = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  const loginUa = request.headers.get("User-Agent") || "";
  const loginCountry = request.cf?.country || request.headers.get("CF-IPCountry") || "";
  const loginCity = request.cf?.city || "";
  const valid = clean(body.username) === expectedUser && String(body.password || "") === expectedPass;
  await db.prepare("INSERT INTO admin_login_attempts(username,ip_address,user_agent,country,city,successful,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(clean(body.username),loginIp,loginUa,loginCountry,loginCity,valid?1:0,nowIso()).run();
  if (!valid) {
    await notify(db,"security","Intento de acceso administrativo",`Intento fallido desde IP ${loginIp||"desconocida"}${loginCity?` · ${loginCity}`:""}.`,"security",loginIp||"unknown");
    throw new HttpError(401, "Admin incorrecto.");
  }

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare("DELETE FROM admin_sessions WHERE expires_at<=?").bind(nowIso()).run();
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  const ua = request.headers.get("User-Agent") || "";
  const country = request.cf?.country || request.headers.get("CF-IPCountry") || "";
  const city = request.cf?.city || "";
  await db.prepare("INSERT INTO admin_sessions(token_hash,username,expires_at,created_at,ip_address,user_agent,country,city) VALUES(?,?,?,?,?,?,?,?)")
    .bind(await sha256(token), expectedUser, expiresAt, nowIso(), ip, ua, country, city).run();
  await notify(db,"security","Inicio de sesión administrativo",`Sesión iniciada desde IP ${ip||"desconocida"}${city?` · ${city}`:""}.`,"security",ip||"unknown");
  return json({ ok: true }, 200, {
    "Set-Cookie": `taxote_admin_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=${SESSION_DAYS * 86400}`,
    ...headers
  });
}
async function adminLogout(request, env, headers) {
  const token = parseCookies(request).taxote_admin_session;
  if (token) await env.taxote_db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, {
    "Set-Cookie": "taxote_admin_session=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0",
    ...headers
  });
}
async function notify(db, kind, title, body, entityType = null, entityId = null) {
  await db.prepare("INSERT INTO admin_notifications(kind,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?)")
    .bind(kind, title, body, entityType, entityId, nowIso()).run();
}
function profileView(row) {
  return { id: row.public_id, name: row.name, phone: row.phone, email: row.email || "", kind: row.kind, debtDop: Number(row.debt_dop || 0) };
}
function driverView(row, detailed = false) {
  const view = {
    id: row.public_id,
    firstName: row.first_name,
    lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`.trim(),
    phone: row.phone,
    email: row.email,
    vehiclePlate: row.vehicle_plate,
    vehicleBrand: row.vehicle_brand,
    vehicleModel: row.vehicle_model,
    vehicleColor: row.vehicle_color,
    vehicleType: row.vehicle_type,
    status: row.status,
    pointsBalance: Number(row.points_balance || 0),
    online: Boolean(row.is_online),
    is_online: Boolean(row.is_online),
    is_available: Boolean(row.is_available),
    createdAt: row.created_at,
    lastSeen: row.last_seen_at
  };
  if (detailed) {
    view.cedula = row.cedula;
    const base = `/api/admin/drivers/${encodeURIComponent(row.public_id)}/document/`;
    view.documents = {
      selfie: base + "selfie",
      idFront: base + "idFront",
      idBack: base + "idBack",
      vehicle: base + "vehicle",
      vBack: base + "vBack",
      vLeft: base + "vLeft",
      vRight: base + "vRight",
      plate: base + "plate"
    };
  }
  return view;
}
async function rideStops(db, rideId) {
  const { results } = await db.prepare("SELECT address,lat,lon,position FROM ride_stops WHERE ride_id=? ORDER BY position").bind(rideId).all();
  return results || [];
}
async function rideView(db, row, forDriver = false) {
  const stops = await rideStops(db, row.id);
  const driverName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  const view = {
    id: row.public_id,
    status: row.status,
    passenger: row.passenger_name,
    phone: row.passenger_phone,
    passengerType: row.passenger_type || "guest",
    pickup: forDriver ? { address: row.pickup_address, lat: Number(row.pickup_lat), lon: Number(row.pickup_lon) } : row.pickup_address,
    destination: forDriver ? { address: row.destination_address, lat: Number(row.destination_lat), lon: Number(row.destination_lon) } : row.destination_address,
    pickupLat: Number(row.pickup_lat), pickupLon: Number(row.pickup_lon),
    destinationLat: Number(row.destination_lat), destinationLon: Number(row.destination_lon),
    driver: driverName || "Pendiente de TAXOTE Driver",
    driverId: row.driver_public_id || null,
    driverVehicle: row.vehicle_brand ? `${row.vehicle_brand} ${row.vehicle_model || ""}`.trim() : "",
    driverPlate: row.vehicle_plate || "",
    priceDop: Number(row.price_dop || 0),
    distanceKm: Number(row.distance_km || 0),
    durationMin: Number(row.duration_min || 0),
    note: row.note || "",
    paymentMethod: row.payment_method || "",
    passengerCount: Number(row.passenger_count || 1),
    scheduledAt: row.scheduled_at || null,
    contactedAt: row.contacted_at || null,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at || null,
    arrivedAt: row.arrived_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    cancelledAt: row.cancelled_at || null,
    closedAt: row.closed_at || row.completed_at || row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || "",
    cancellationNote: row.cancellation_note || "",
    cancelledBy: row.cancelled_by || "",
    fineChargedDop: Number(row.fine_charged_dop || 0),
    driverPenaltyPoints: Number(row.driver_penalty_points || 0),
    stops: stops.map(s => ({ address: s.address, lat: Number(s.lat), lon: Number(s.lon), position: Number(s.position) }))
  };
  if (forDriver) {
    view.passenger = { name: row.passenger_name, phone: row.passenger_phone };
  }
  return view;
}
async function rideRowByPublicId(db, publicId) {
  return db.prepare(`SELECT r.*, d.public_id AS driver_public_id, d.first_name, d.last_name, d.vehicle_brand, d.vehicle_model, d.vehicle_plate
    FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.public_id=?`).bind(publicId).first();
}
async function addressHistory(db, profileId) {
  const { results } = await db.prepare(`
    SELECT address,lat,lon,MAX(ts) ts FROM (
      SELECT pickup_address address,pickup_lat lat,pickup_lon lon,created_at ts FROM rides WHERE profile_id=?
      UNION ALL
      SELECT destination_address address,destination_lat lat,destination_lon lon,created_at ts FROM rides WHERE profile_id=?
    ) GROUP BY address,lat,lon ORDER BY MAX(ts) DESC LIMIT 12`).bind(profileId, profileId).all();
  return (results || []).map(r => ({ address: r.address, lat: Number(r.lat), lon: Number(r.lon) }));
}
function haversineKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const q = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(q));
}
async function estimateRoute(pickup, destination, stops = []) {
  const a = { lat: Number(pickup.lat), lon: Number(pickup.lon) };
  const b = { lat: Number(destination.lat), lon: Number(destination.lon) };
  if (![a.lat,a.lon,b.lat,b.lon].every(Number.isFinite)) throw new HttpError(400, "Coordenadas inválidas.");
  let distanceKm, durationMin;
  try {
    const pts=[a,...(Array.isArray(stops)?stops:[]).filter(s=>Number.isFinite(Number(s?.lat))&&Number.isFinite(Number(s?.lon))).map(s=>({lat:Number(s.lat),lon:Number(s.lon)})),b];
    const coords = pts.map(p=>`${p.lon},${p.lat}`).join(";");
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`);
    const data = await resp.json();
    if (resp.ok && data.routes?.[0]) {
      distanceKm = Number(data.routes[0].distance) / 1000;
      durationMin = Math.max(1, Math.ceil(Number(data.routes[0].duration) / 60));
    }
  } catch {}
  if (!Number.isFinite(distanceKm)) {
    distanceKm = Math.max(0.1, haversineKm(a,b) * 1.25);
    durationMin = Math.max(2, Math.ceil(distanceKm / 25 * 60));
  }
  const rawPrice = FARE_BASE_DOP + distanceKm * FARE_PER_KM_DOP;
  const priceDop = Math.max(FARE_MIN_DOP, Math.round(rawPrice / 50) * 50);
  return { distanceKm, durationMin, priceDop };
}
async function resolveRideProfile(request, db, body) {
  const sessionProfile = await profileSession(request, db);
  if (sessionProfile) return sessionProfile;
  const p = phone(body.phone);
  if (!/^(809|829|849)\d{7}$/.test(p)) throw new HttpError(400, "Teléfono dominicano inválido.");
  let profile = await db.prepare("SELECT * FROM profiles WHERE phone=?").bind(p).first();
  const name = clean(body.name);
  if (!profile) {
    if (name.length < 2) throw new HttpError(400, "Escribe el nombre del pasajero.");
    const stamp = nowIso(), publicId = id("USR");
    const result = await db.prepare("INSERT INTO profiles(public_id,kind,name,phone,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind(publicId, "guest", name, p, stamp, stamp).run();
    profile = await db.prepare("SELECT * FROM profiles WHERE id=?").bind(result.meta.last_row_id).first();
  } else if (profile.kind === "guest" && name && name !== profile.name) {
    await db.prepare("UPDATE profiles SET name=?,updated_at=? WHERE id=?").bind(name, nowIso(), profile.id).run();
    profile.name = name;
  }
  return profile;
}
function messageView(row, driverName = "") {
  return {
    id: Number(row.id),
    sender: row.sender,
    message: row.message || (row.photo_data ? "Foto" : ""),
    messageType: row.photo_data ? "photo" : "text",
    photoUrl: row.photo_data || null,
    createdAt: row.created_at,
    driverReadAt: row.driver_read_at || row.read_at || null,
    driverName: driverName || row.driver_name || "",
    passengerName: row.passenger_name || ""
  };
}


async function nearestAvailableDriverForRide(db, ride, excludeDriverId = null) {
  const {results}=await db.prepare(`SELECT d.* FROM drivers d
    WHERE d.status='active' AND d.is_online=1 AND d.is_available=1
      AND d.current_lat IS NOT NULL AND d.current_lon IS NOT NULL
      AND (? IS NULL OR d.id<>?)
      AND NOT EXISTS(SELECT 1 FROM rides ar WHERE ar.driver_id=d.id AND ar.status IN ('accepted','driver_arriving','arrived','in_progress'))
      AND NOT EXISTS(SELECT 1 FROM ride_rejections rr WHERE rr.ride_id=? AND rr.driver_id=d.id)`)
    .bind(excludeDriverId,excludeDriverId,ride.id).all();
  let best=null,bestKm=Infinity;
  for(const d of results||[]){
    const km=haversineKm({lat:Number(ride.pickup_lat),lon:Number(ride.pickup_lon)},{lat:Number(d.current_lat),lon:Number(d.current_lon)});
    if(km<bestKm){best=d;bestKm=km;}
  }
  return best;
}

async function handleApi(request, env, url, headers) {
  const db = env.taxote_db;
  const path = normalizedPath(url.pathname);
  const method = request.method.toUpperCase();
  const segments = path.split("/").filter(Boolean);

  // ---------- USUARIOS / PASAJEROS ----------
  if (path === "/api/auth/register" && method === "POST") {
    const body = await bodyJson(request);
    const p = phone(body.phone), name = clean(body.name), email = clean(body.email).toLowerCase();
    if (!/^(809|829|849)\d{7}$/.test(p)) throw new HttpError(400, "Teléfono dominicano inválido.");
    if (name.length < 2) throw new HttpError(400, "Nombre inválido.");
    if (!email.includes("@")) throw new HttpError(400, "Correo inválido.");
    if (String(body.password || "").length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
    if (body.password !== body.passwordConfirm) throw new HttpError(400, "Las contraseñas no coinciden.");
    const existing = await db.prepare("SELECT * FROM profiles WHERE phone=? OR email=?").bind(p,email).first();
    if (existing?.kind === "registered") throw new HttpError(409, "Ese teléfono o correo ya está registrado.");

    const salt = crypto.randomUUID().replaceAll("-", ""), hash = await passwordHash(body.password, salt), stamp = nowIso();
    let profileId;
    if (existing) {
      await db.prepare("UPDATE profiles SET kind='registered',name=?,phone=?,email=?,password_hash=?,password_salt=?,updated_at=? WHERE id=?")
        .bind(name,p,email,hash,salt,stamp,existing.id).run();
      profileId = existing.id;
    } else {
      const result = await db.prepare("INSERT INTO profiles(public_id,kind,name,phone,email,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(id("USR"),"registered",name,p,email,hash,salt,stamp,stamp).run();
      profileId = result.meta.last_row_id;
    }
    const profile = await db.prepare("SELECT * FROM profiles WHERE id=?").bind(profileId).first();
    const token = await createSession(db,"sessions","profile_id",profile.id);
    return json({ user: profileView(profile), addresses: await addressHistory(db,profile.id) }, 201, {
      "Set-Cookie": `taxote_user_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=${SESSION_DAYS*86400}`, ...headers
    });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await bodyJson(request), p = phone(body.phone);
    const profile = await db.prepare("SELECT * FROM profiles WHERE phone=? AND kind='registered'").bind(p).first();
    if (!profile || !profile.password_hash || await passwordHash(body.password, profile.password_salt) !== profile.password_hash) throw new HttpError(401,"Credenciales incorrectas.");
    const token = await createSession(db,"sessions","profile_id",profile.id);
    return json({ user: profileView(profile), addresses: await addressHistory(db,profile.id) },200,{
      "Set-Cookie": `taxote_user_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=${SESSION_DAYS*86400}`, ...headers
    });
  }

  if (path === "/api/auth/me" && method === "GET") {
    const profile = await profileSession(request,db);
    if (!profile) throw new HttpError(401,"No hay sesión activa.");
    return json({ user: profileView(profile), addresses: await addressHistory(db,profile.id) },200,headers);
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = parseCookies(request).taxote_user_session;
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ok:true},200,{"Set-Cookie":"taxote_user_session=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0",...headers});
  }

  if (path === "/api/contacts/lookup" && method === "GET") {
    const p = phone(url.searchParams.get("phone"));
    const profile = await db.prepare("SELECT * FROM profiles WHERE phone=?").bind(p).first();
    if (!profile) return json({found:false},200,headers);
    const {results:recentRows}=await db.prepare(`SELECT r.*,d.public_id driver_public_id,d.first_name,d.last_name,d.vehicle_brand,d.vehicle_model,d.vehicle_plate FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.profile_id=? ORDER BY r.created_at DESC LIMIT 10`).bind(profile.id).all();
    return json({found:true,profile:profileView(profile),addresses:await addressHistory(db,profile.id),rides:await Promise.all((recentRows||[]).map(r=>rideView(db,r,false)))},200,headers);
  }

  if (path === "/api/guest/profile" && method === "POST") {
    const body = await bodyJson(request), p = phone(body.phone), name = clean(body.name);
    if (!/^(809|829|849)\d{7}$/.test(p)) throw new HttpError(400,"Teléfono dominicano inválido.");
    if (name.length < 2) throw new HttpError(400,"Nombre inválido.");
    let profile = await db.prepare("SELECT * FROM profiles WHERE phone=?").bind(p).first();
    if (!profile) {
      const stamp=nowIso();
      const result=await db.prepare("INSERT INTO profiles(public_id,kind,name,phone,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id("USR"),"guest",name,p,stamp,stamp).run();
      profile=await db.prepare("SELECT * FROM profiles WHERE id=?").bind(result.meta.last_row_id).first();
    } else if (profile.kind === "guest") {
      await db.prepare("UPDATE profiles SET name=?,updated_at=? WHERE id=?").bind(name,nowIso(),profile.id).run();
      profile.name=name;
    }
    return json({profile:profileView(profile),addresses:await addressHistory(db,profile.id)},200,headers);
  }

  // ---------- DIRECCIONES / MAPA ----------
  if (path === "/api/geocode" && method === "GET") {
    const q=clean(url.searchParams.get("q"));
    if (q.length<2) return json([],200,headers);
    const like=`%${q}%`;
    const {results}=await db.prepare(`SELECT name,street,suburb,city,province,postcode,lat,lon,place_id FROM addresses
      WHERE name LIKE ? OR street LIKE ? OR suburb LIKE ? OR city LIKE ? ORDER BY
      CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name LIMIT 10`).bind(like,like,like,like,`${q}%`).all();
    return json((results||[]).map(r=>({
      display_name:r.name || [r.street,r.suburb,r.city,r.province].filter(Boolean).join(", "),
      name:r.name || r.street || r.suburb || "",
      lat:Number(r.lat),lon:Number(r.lon),place_id:r.place_id,
      address:{road:r.street||"",suburb:r.suburb||"",city:r.city||"",state:r.province||"",postcode:r.postcode||""}
    })),200,headers);
  }

  if (path === "/api/place" && method === "GET") {
    const placeId=clean(url.searchParams.get("id"));
    const r=await db.prepare("SELECT * FROM addresses WHERE place_id=?").bind(placeId).first();
    if (!r) throw new HttpError(404,"Dirección no encontrada.");
    return json({display_name:r.name,lat:Number(r.lat),lon:Number(r.lon),place_id:r.place_id},200,headers);
  }

  if (path === "/api/reverse" && method === "GET") {
    const lat=Number(url.searchParams.get("lat")),lon=Number(url.searchParams.get("lon"));
    if (![lat,lon].every(Number.isFinite)) throw new HttpError(400,"Coordenadas inválidas.");
    const r=await db.prepare(`SELECT * FROM addresses ORDER BY ((lat-?)*(lat-?)+(lon-?)*(lon-?)) ASC LIMIT 1`).bind(lat,lat,lon,lon).first();
    if (!r) throw new HttpError(404,"Dirección no encontrada.");
    return json({display_name:r.name,lat:Number(r.lat),lon:Number(r.lon),place_id:r.place_id},200,headers);
  }

  if (path === "/api/route" && method === "GET") {
    const coordinates=clean(url.searchParams.get("coordinates"));
    if (!coordinates) throw new HttpError(400,"Faltan coordenadas.");
    const resp=await fetch(`https://router.project-osrm.org/route/v1/driving/${encodeURI(coordinates)}?overview=full&geometries=geojson`);
    const data=await resp.json();
    return json(data,resp.ok?200:502,headers);
  }

  // ---------- VIAJES DE USUARIO / CENTRAL ----------
  if (path === "/api/rides/estimate" && method === "POST") {
    const body=await bodyJson(request);
    if (!body.pickup || !body.destination) throw new HttpError(400,"Selecciona recogida y destino.");
    const estimate=await estimateRoute(body.pickup,body.destination,body.stops||[]);
    return json({pickup:body.pickup,destination:body.destination,estimate},200,headers);
  }

  if (path === "/api/rides" && method === "POST") {
    const body=await bodyJson(request);
    if (!body.pickup || !body.destination) throw new HttpError(400,"Selecciona recogida y destino.");
    const profile=await resolveRideProfile(request,db,body);
    const estimate=await estimateRoute(body.pickup,body.destination,body.stops||[]);
    const stamp=nowIso(),rid=id("RID");
    let driverDbId=null;
    if (body.driverId) {
      const d=await db.prepare("SELECT id FROM drivers WHERE public_id=? AND status='active'").bind(clean(body.driverId)).first();
      driverDbId=d?.id||null;
    }
    const offerAfter=new Date(Date.now()+3000).toISOString();
    const result=await db.prepare(`INSERT INTO rides(public_id,profile_id,passenger_type,passenger_name,passenger_phone,pickup_address,pickup_lat,pickup_lon,destination_address,destination_lat,destination_lon,status,driver_id,note,payment_method,passenger_count,scheduled_at,price_dop,distance_km,duration_min,created_at,accepted_at,offer_after_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(rid,profile.id,profile.kind,profile.name,profile.phone,clean(body.pickup.address),Number(body.pickup.lat),Number(body.pickup.lon),clean(body.destination.address),Number(body.destination.lat),Number(body.destination.lon),"pending",driverDbId,clean(body.note),clean(body.paymentMethod),Math.max(1,Number(body.passengerCount||1)),body.scheduledAt||null,estimate.priceDop,estimate.distanceKm,estimate.durationMin,stamp,null,offerAfter).run();
    const rideId=result.meta.last_row_id;
    const stops=Array.isArray(body.stops)?body.stops:[];
    for (let i=0;i<stops.length;i++) {
      const s=stops[i]; if (!s) continue;
      await db.prepare("INSERT OR IGNORE INTO ride_stops(ride_id,position,address,lat,lon) VALUES(?,?,?,?,?)").bind(rideId,i+1,clean(s.address),Number(s.lat),Number(s.lon)).run();
    }
    await notify(db,"ride","Nuevo servicio",`${profile.name} solicitó un viaje.`,"ride",rid);
    const row=await rideRowByPublicId(db,rid);
    return json({ok:true,profile:profileView(profile),addresses:await addressHistory(db,profile.id),ride:await rideView(db,row,true)},201,headers);
  }

  if (path === "/api/rides/mine" && method === "GET") {
    let profile=await profileSession(request,db);
    if (!profile) {
      const p=phone(url.searchParams.get("phone"));
      if (!p) throw new HttpError(401,"Identifica tu teléfono.");
      profile=await db.prepare("SELECT * FROM profiles WHERE phone=?").bind(p).first();
    }
    if (!profile) return json({rides:[]},200,headers);
    const {results}=await db.prepare(`SELECT r.*,d.public_id driver_public_id,d.first_name,d.last_name FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id
      WHERE r.profile_id=? AND r.status IN ('pending','accepted','driver_arriving','arrived','in_progress') ORDER BY r.created_at DESC`).bind(profile.id).all();
    return json({rides:await Promise.all((results||[]).map(r=>rideView(db,r,true)))},200,headers);
  }

  let match=path.match(/^\/api\/rides\/([^/]+)\/cancel$/);
  if (match && method === "POST") {
    const publicId=decodeURIComponent(match[1]), body=await bodyJson(request);
    const row=await rideRowByPublicId(db,publicId);
    if (!row) throw new HttpError(404,"Viaje no encontrado.");
    if (!["pending","accepted","driver_arriving","arrived"].includes(row.status)) throw new HttpError(409,"Este viaje ya no se puede cancelar.");
    const sess=await profileSession(request,db);
    const allowed=sess?.id===row.profile_id || (!sess && phone(body.phone)===row.passenger_phone);
    if (!allowed) throw new HttpError(403,"No puedes cancelar este viaje.");
    const stamp=nowIso();
    await db.prepare("UPDATE rides SET status='cancelled',cancelled_at=?,closed_at=?,cancellation_reason=?,cancellation_note=?,cancelled_by='passenger' WHERE id=?")
      .bind(stamp,stamp,clean(body.reason),clean(body.note),row.id).run();
    await notify(db,"ride_cancelled","Servicio cancelado",`${row.passenger_name} canceló ${row.public_id}.`,"ride",row.public_id);
    return json({ok:true},200,headers);
  }

  // Chat usuario <-> conductor por viaje.
  match=path.match(/^\/api\/user\/rides\/([^/]+)\/chat$/);
  if (match) {
    const publicId=decodeURIComponent(match[1]);
    const row=await rideRowByPublicId(db,publicId);
    if (!row) throw new HttpError(404,"Viaje no encontrado.");
    const sess=await profileSession(request,db);
    const queryPhone=phone(url.searchParams.get("phone"));
    let body=null;
    if (method==="POST") body=await bodyJson(request);
    const bodyPhone=phone(body?.phone);
    const allowed=sess?.id===row.profile_id || (!sess && (queryPhone===row.passenger_phone || bodyPhone===row.passenger_phone));
    if (!allowed) throw new HttpError(403,"No autorizado.");
    if (!ACTIVE_RIDE_STATUSES.includes(row.status)) throw new HttpError(409,"El chat está disponible cuando hay un conductor asignado.");
    if (method==="GET") {
      const {results}=await db.prepare("SELECT m.*,d.first_name,d.last_name FROM chat_messages m LEFT JOIN drivers d ON d.id=m.driver_id WHERE m.channel='ride' AND m.ride_id=? ORDER BY m.created_at").bind(row.id).all();
      await db.prepare("UPDATE chat_messages SET passenger_read_at=? WHERE channel='ride' AND ride_id=? AND sender!='passenger' AND passenger_read_at IS NULL").bind(nowIso(),row.id).run();
      return json({driverName:[row.first_name,row.last_name].filter(Boolean).join(" "),messages:(results||[]).map(m=>messageView({...m,driver_name:[m.first_name,m.last_name].filter(Boolean).join(" ")}))},200,headers);
    }
    if (method==="POST") {
      const msg=clean(body.message),photo=body.photo||null;
      if (!msg && !photo) throw new HttpError(400,"Escribe un mensaje o adjunta una foto.");
      await db.prepare("INSERT INTO chat_messages(channel,driver_id,ride_id,sender,message,photo_data,created_at) VALUES('ride',?,?, 'passenger',?,?,?)")
        .bind(row.driver_id,row.id,msg||"Foto",photo,nowIso()).run();
      return json({ok:true},201,headers);
    }
  }

  if (path === "/api/user/chat/unread" && method === "GET") {
    let profile=await profileSession(request,db);
    if (!profile) {
      const p=phone(url.searchParams.get("phone"));
      profile=p?await db.prepare("SELECT * FROM profiles WHERE phone=?").bind(p).first():null;
    }
    if (!profile) return json({unreadCount:0},200,headers);
    const r=await db.prepare(`SELECT COUNT(*) n FROM chat_messages m JOIN rides r ON r.id=m.ride_id
      WHERE r.profile_id=? AND m.channel='ride' AND m.sender!='passenger' AND m.passenger_read_at IS NULL`).bind(profile.id).first();
    return json({unreadCount:Number(r?.n||0)},200,headers);
  }

  // ---------- DRIVER ----------
  if (path === "/api/driver/register" && method === "POST") {
    const body=await bodyJson(request);
    const p=phone(body.phone),email=clean(body.email).toLowerCase(),cedula=clean(body.cedula),plate=clean(body.vehiclePlate).toUpperCase();
    if (!/^(809|829|849)\d{7}$/.test(p)) throw new HttpError(400,"Teléfono dominicano inválido.");
    if (String(body.password||"").length<8) throw new HttpError(400,"Contraseña demasiado corta.");
    const activeConflict=await db.prepare("SELECT id FROM drivers WHERE (phone=? OR email=? OR cedula=? OR vehicle_plate=?) AND status='active'").bind(p,email,cedula,plate).first();
    if (activeConflict) throw new HttpError(409,"Ya existe un conductor activo con esos datos.");
    const {results:stale}=await db.prepare("SELECT id FROM drivers WHERE (phone=? OR email=? OR cedula=? OR vehicle_plate=?) AND status!='active'").bind(p,email,cedula,plate).all();
    for (const old of stale||[]) {
      await db.prepare("DELETE FROM driver_documents WHERE driver_id=?").bind(old.id).run();
      await db.prepare("DELETE FROM driver_sessions WHERE driver_id=?").bind(old.id).run();
      await db.prepare("DELETE FROM drivers WHERE id=?").bind(old.id).run();
    }
    const salt=crypto.randomUUID().replaceAll("-",""),hash=await passwordHash(body.password,salt),did=id("DRV"),stamp=nowIso();
    const result=await db.prepare(`INSERT INTO drivers(public_id,first_name,last_name,email,phone,password_hash,password_salt,cedula,vehicle_type,vehicle_brand,vehicle_model,vehicle_color,vehicle_plate,payment_method,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending',?,?)`).bind(did,clean(body.firstName),clean(body.lastName),email,p,hash,salt,cedula,clean(body.vehicleType),clean(body.vehicleBrand),clean(body.vehicleModel),clean(body.vehicleColor),plate,clean(body.paymentMethod),stamp,stamp).run();
    const driverId=result.meta.last_row_id;
    const docs=[
      ["selfie",body.selfie||body.selfiePhoto],["idFront",body.idFront],["idBack",body.idBack],["vehicle",body.vehiclePhoto||body.vehicle],
      ["vBack",body.vehicleBackPhoto],["vLeft",body.vehicleLeftPhoto],["vRight",body.vehicleRightPhoto],["plate",body.platePhoto]
    ];
    for (const [kind,data] of docs) if (data && data !== "null") await db.prepare("INSERT OR REPLACE INTO driver_documents(driver_id,kind,data_url,created_at) VALUES(?,?,?,?)").bind(driverId,kind,data,stamp).run();
    await notify(db,"registration","Nuevo Registro",`Conductor ${clean(body.firstName)} ${clean(body.lastName)} registrado.`,"driver",did);
    return json({ok:true,driverId:did},201,headers);
  }

  if (path === "/api/driver/login" && method === "POST") {
    const body=await bodyJson(request),input=clean(body.phone||body.email);
    const d=await db.prepare("SELECT * FROM drivers WHERE phone=? OR email=?").bind(phone(input),input.toLowerCase()).first();
    if (!d || await passwordHash(body.password,d.password_salt)!==d.password_hash) throw new HttpError(401,"Credenciales incorrectas.");
    if (d.status!=="active") throw new HttpError(403,`Tu cuenta está ${d.status}.`);
    const token=await createSession(db,"driver_sessions","driver_id",d.id);
    await db.prepare("UPDATE drivers SET last_login_at=?,is_online=1,updated_at=? WHERE id=?").bind(nowIso(),nowIso(),d.id).run();
    return json({ok:true,driver:driverView(d)},200,{"Set-Cookie":`taxote_driver_session=${token}; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=${SESSION_DAYS*86400}`,...headers});
  }

  if ((path === "/api/driver/me" || path === "/api/driver/status") && method === "GET") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    return json({ok:true,driver:driverView(d)},200,headers);
  }

  if (path === "/api/driver/logout" && method === "POST") {
    const token=parseCookies(request).taxote_driver_session;
    const d=await driverSession(request,db);
    if (d) await db.prepare("UPDATE drivers SET is_online=0,is_available=0,updated_at=? WHERE id=?").bind(nowIso(),d.id).run();
    if (token) await db.prepare("DELETE FROM driver_sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ok:true},200,{"Set-Cookie":"taxote_driver_session=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0",...headers});
  }

  if (path === "/api/driver/disconnect" && method === "POST") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    await db.prepare("UPDATE drivers SET is_online=0,is_available=0,updated_at=? WHERE id=?").bind(nowIso(),d.id).run();
    return json({ok:true},200,headers);
  }

  if (path === "/api/driver/location" && method === "POST") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const body=await bodyJson(request),stamp=nowIso();
    const reportedPoints=body.pointsBalance ?? body.points;
    if(reportedPoints!==undefined && Number(reportedPoints)!==Number(d.points_balance||0)){
      await notify(db,"points_alert","Posible manipulación de puntos",`${d.first_name} ${d.last_name} reportó ${Number(reportedPoints)} puntos, pero el servidor conserva ${Number(d.points_balance||0)}. El saldo NO fue modificado.`,"driver",d.public_id);
    }
    await db.prepare("UPDATE drivers SET current_lat=?,current_lon=?,current_accuracy=?,current_bearing=?,current_speed_kph=?,last_seen_at=?,is_online=1,is_available=1,updated_at=? WHERE id=?")
      .bind(Number(body.lat),Number(body.lon),Number(body.accuracy||0),Number(body.bearing||0),Number(body.speedKph||body.speed||0),stamp,stamp,d.id).run();
    return json({ok:true,pointsBalance:Number(d.points_balance||0)},200,headers);
  }

  if (path === "/api/driver/fcm-token" && method === "POST") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const body=await bodyJson(request);
    await db.prepare("UPDATE drivers SET fcm_token=?,updated_at=? WHERE id=?").bind(clean(body.token||body.fcmToken),nowIso(),d.id).run();
    return json({ok:true},200,headers);
  }

  if (path === "/api/driver/profile" && method === "POST") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const body=await bodyJson(request),email=clean(body.email).toLowerCase();
    if (!email.includes("@")) throw new HttpError(400,"Correo inválido.");
    await db.prepare("UPDATE drivers SET email=?,updated_at=? WHERE id=?").bind(email,nowIso(),d.id).run();
    return json({ok:true},200,headers);
  }

  if (path === "/api/driver/work" && method === "GET") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const active=await db.prepare(`SELECT r.*,dr.public_id driver_public_id,dr.first_name,dr.last_name FROM rides r LEFT JOIN drivers dr ON dr.id=r.driver_id
      WHERE r.driver_id=? AND r.status IN ('accepted','driver_arriving','arrived','in_progress') ORDER BY r.created_at DESC LIMIT 1`).bind(d.id).first();
    const {results:offers}=await db.prepare(`SELECT r.*,NULL driver_public_id,NULL first_name,NULL last_name FROM rides r
      WHERE r.status='pending' AND (r.scheduled_at IS NULL OR r.scheduled_at<=?) AND (r.offer_after_at IS NULL OR r.offer_after_at<=?) AND (r.driver_id IS NULL OR r.driver_id=?) AND NOT EXISTS(SELECT 1 FROM ride_rejections x WHERE x.ride_id=r.id AND x.driver_id=?)
      ORDER BY COALESCE(r.scheduled_at,r.created_at) ASC LIMIT 5`).bind(nowIso(),nowIso(),d.id,d.id).all();
    return json({activeRide:active?await rideView(db,active,true):null,offers:await Promise.all((offers||[]).map(r=>rideView(db,r,true))),queuedOffers:[]},200,headers);
  }

  match=path.match(/^\/api\/driver\/rides\/([^/]+)\/(accept|reject|release|cancel|status|chat)$/);
  if (match) {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const publicId=decodeURIComponent(match[1]),action=match[2];
    const row=await rideRowByPublicId(db,publicId); if (!row) throw new HttpError(404,"Viaje no encontrado.");

    if (action==="accept" && method==="POST") {
      if (row.status!=="pending" || (row.driver_id && row.driver_id!==d.id)) throw new HttpError(409,"Este servicio ya fue tomado.");
      const active=await db.prepare("SELECT id FROM rides WHERE driver_id=? AND status IN ('accepted','driver_arriving','arrived','in_progress') LIMIT 1").bind(d.id).first();
      if (active) throw new HttpError(409,"Ya tienes un viaje activo.");
      await db.prepare("UPDATE rides SET driver_id=?,status='accepted',accepted_at=? WHERE id=?").bind(d.id,nowIso(),row.id).run();
      const updated=await rideRowByPublicId(db,publicId);
      return json({ok:true,ride:await rideView(db,updated,true)},200,headers);
    }
    if (action==="reject" && method==="POST") {
      await db.prepare("INSERT OR IGNORE INTO ride_rejections(ride_id,driver_id,created_at) VALUES(?,?,?)").bind(row.id,d.id,nowIso()).run();
      const next=await nearestAvailableDriverForRide(db,row,d.id);
      await db.prepare("UPDATE rides SET driver_id=? WHERE id=? AND status='pending'").bind(next?.id||null,row.id).run();
      await notify(db,"ride_offer","Servicio reasignado",next?`${row.public_id} fue enviado automáticamente a ${next.first_name} ${next.last_name}.`:`${row.public_id} quedó sin conductor disponible.`,"ride",row.public_id);
      return json({ok:true,reassignedTo:next?.public_id||null},200,headers);
    }
    if (action==="release" && method==="POST") {
      if (row.driver_id===d.id && row.status==="pending") await db.prepare("UPDATE rides SET driver_id=NULL WHERE id=?").bind(row.id).run();
      return json({ok:true},200,headers);
    }
    if (action==="cancel" && method==="POST") {
      if (row.driver_id!==d.id) throw new HttpError(403,"Ese viaje no está asignado a tu cuenta.");
      if (!["accepted","driver_arriving","arrived"].includes(row.status)) throw new HttpError(409,"El viaje ya comenzó y no se puede cancelar.");
      const body=await bodyJson(request),stamp=nowIso();
      await db.prepare("UPDATE rides SET status='cancelled',cancelled_at=?,closed_at=?,cancellation_reason=?,cancelled_by='driver' WHERE id=?").bind(stamp,stamp,clean(body.reason),row.id).run();
      return json({ok:true},200,headers);
    }
    if (action==="status" && method==="POST") {
      if (row.driver_id!==d.id) throw new HttpError(403,"Ese viaje no está asignado a tu cuenta.");
      const body=await bodyJson(request),wanted=clean(body.action);
      const transitions={arrived:["accepted","driver_arriving"],start:["arrived"],complete:["in_progress"]};
      if (!(transitions[wanted]||[]).includes(row.status)) throw new HttpError(409,"Cambio de estado no permitido.");
      const stamp=nowIso();
      if (wanted==="arrived") await db.prepare("UPDATE rides SET status='arrived',arrived_at=? WHERE id=?").bind(stamp,row.id).run();
      if (wanted==="start") await db.prepare("UPDATE rides SET status='in_progress',started_at=? WHERE id=?").bind(stamp,row.id).run();
      if (wanted==="complete") {
        const profile=await db.prepare("SELECT debt_dop FROM profiles WHERE id=?").bind(row.profile_id).first();
        const fineCharge=Math.min(50,Math.max(0,Number(profile?.debt_dop||0)));
        if(fineCharge>0) await db.prepare("UPDATE profiles SET debt_dop=MAX(0,debt_dop-?),updated_at=? WHERE id=?").bind(fineCharge,stamp,row.profile_id).run();
        await db.prepare("UPDATE rides SET status='completed',completed_at=?,closed_at=?,fine_charged_dop=?,price_dop=price_dop+?,driver_earnings_dop=? WHERE id=?")
          .bind(stamp,stamp,fineCharge,fineCharge,Math.round(Number(row.price_dop||0)*0.8),row.id).run();
      }
      const updated=await rideRowByPublicId(db,publicId);
      return json({ok:true,ride:await rideView(db,updated,true)},200,headers);
    }
    if (action==="chat") {
      if (row.driver_id!==d.id) throw new HttpError(403,"Ese viaje no está asignado a tu cuenta.");
      if (method==="GET") {
        const {results}=await db.prepare("SELECT * FROM chat_messages WHERE channel='ride' AND ride_id=? ORDER BY created_at").bind(row.id).all();
        await db.prepare("UPDATE chat_messages SET driver_read_at=? WHERE channel='ride' AND ride_id=? AND sender!='driver' AND driver_read_at IS NULL").bind(nowIso(),row.id).run();
        return json({messages:(results||[]).map(m=>messageView({...m,driver_name:`${d.first_name} ${d.last_name}`}))},200,headers);
      }
      if (method==="POST") {
        const body=await bodyJson(request),msg=clean(body.message),photo=body.photo||null;
        if (!msg&&!photo) throw new HttpError(400,"Escribe un mensaje o adjunta una foto.");
        await db.prepare("INSERT INTO chat_messages(channel,driver_id,ride_id,sender,message,photo_data,created_at) VALUES('ride',?,?, 'driver',?,?,?)").bind(d.id,row.id,msg||"Foto",photo,nowIso()).run();
        return json({ok:true},201,headers);
      }
    }
  }

  if (path === "/api/driver/chat/private") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    if (method==="GET") {
      const {results}=await db.prepare("SELECT * FROM internal_chat_messages WHERE conversation_id=? ORDER BY created_at").bind(d.public_id).all();
      await db.prepare("UPDATE internal_chat_messages SET read_at=? WHERE conversation_id=? AND sender='admin' AND read_at IS NULL").bind(nowIso(),d.public_id).run();
      return json({messages:(results||[]).map(m=>messageView({...m,driver_name:`${d.first_name} ${d.last_name}`}))},200,headers);
    }
    if (method==="POST") {
      const body=await bodyJson(request),msg=clean(body.message),photo=body.photo||null;
      if (!msg&&!photo) throw new HttpError(400,"Escribe un mensaje o adjunta una foto.");
      await db.prepare("INSERT INTO internal_chat_messages(conversation_id,sender,message,photo_data,created_at) VALUES(?, 'driver',?,?,?)").bind(d.public_id,msg||"Foto",photo,nowIso()).run();
      return json({ok:true},201,headers);
    }
  }

  if (path === "/api/driver/chat/public") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    if (method==="GET") {
      const {results}=await db.prepare("SELECT m.*,dr.first_name,dr.last_name FROM chat_messages m LEFT JOIN drivers dr ON dr.id=m.driver_id WHERE m.channel='public' ORDER BY m.created_at DESC LIMIT 200").all();
      return json({messages:(results||[]).reverse().map(m=>messageView({...m,driver_name:[m.first_name,m.last_name].filter(Boolean).join(" ")}))},200,headers);
    }
    if (method==="POST") {
      const body=await bodyJson(request),msg=clean(body.message),photo=body.photo||null;
      if (!msg&&!photo) throw new HttpError(400,"Escribe un mensaje o adjunta una foto.");
      await db.prepare("INSERT INTO chat_messages(channel,driver_id,sender,message,photo_data,created_at) VALUES('public',?,'driver',?,?,?)").bind(d.id,msg||"Foto",photo,nowIso()).run();
      return json({ok:true},201,headers);
    }
  }

  if (path === "/api/driver/chat/unread" && method === "GET") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const p=await db.prepare("SELECT COUNT(*) n FROM internal_chat_messages WHERE conversation_id=? AND sender='admin' AND read_at IS NULL").bind(d.public_id).first();
    const r=await db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE driver_id=? AND channel='ride' AND sender!='driver' AND driver_read_at IS NULL").bind(d.id).first();
    return json({unreadCount:Number(p?.n||0)+Number(r?.n||0)},200,headers);
  }


  if (path === "/api/driver/points/set" && method === "POST") {
    const d=await driverSession(request,db); if(!d) throw new HttpError(401,"Sesión expirada.");
    await notify(db,"points_alert","Intento de modificar puntos",`${d.first_name} ${d.last_name} intentó modificar el saldo de puntos desde TAXOTE Driver. El saldo del servidor NO cambió.`,"driver",d.public_id);
    throw new HttpError(403,"El saldo de puntos solo puede cambiarse desde la Central.");
  }

  if (path === "/api/driver/points/deposit" && method === "POST") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const body=await bodyJson(request),points=Math.max(1,Number(body.points||0)),amount=Math.max(0,Number(body.amount||points*50)),stamp=nowIso();
    const result=await db.prepare("INSERT INTO driver_deposits(driver_id,points_requested,amount_dop,proof_data,status,created_at,updated_at) VALUES(?,?,?,?, 'pending',?,?)").bind(d.id,points,amount,body.proof||body.photo||body.proofData||null,stamp,stamp).run();
    await notify(db,"deposit","Nuevo depósito",`${d.first_name} solicita ${points} puntos.`,"driver",d.public_id);
    return json({ok:true,id:result.meta.last_row_id},201,headers);
  }

  if (path === "/api/driver/wallet" && method === "GET") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const stats=await db.prepare("SELECT COUNT(*) trips,COALESCE(SUM(driver_earnings_dop),0) earnings FROM rides WHERE driver_id=? AND status='completed'").bind(d.id).first();
    return json({balance:Number(stats?.earnings||0),completedTrips:Number(stats?.trips||0),pointsBalance:Number(d.points_balance||0)},200,headers);
  }

  if (path === "/api/driver/history" && method === "GET") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const {results}=await db.prepare(`SELECT r.*,dr.public_id driver_public_id,dr.first_name,dr.last_name FROM rides r LEFT JOIN drivers dr ON dr.id=r.driver_id WHERE r.driver_id=? AND r.status IN ('completed','cancelled') ORDER BY COALESCE(r.closed_at,r.created_at) DESC LIMIT 100`).bind(d.id).all();
    return json({rides:await Promise.all((results||[]).map(r=>rideView(db,r,true)))},200,headers);
  }

  if (path === "/api/driver/reports" && method === "POST") {
    const d=await driverSession(request,db); if (!d) throw new HttpError(401,"Sesión expirada.");
    const body=await bodyJson(request),rid=id("REP"),stamp=nowIso();
    await db.prepare("INSERT INTO reports(public_id,reporter_type,reporter_id,reporter_name,ride_id,category,description,photo_data,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'new',?,?)")
      .bind(rid,"driver",d.public_id,`${d.first_name} ${d.last_name}`,body.rideId||null,clean(body.category)||"Otro",clean(body.description),body.photo||body.photoData||null,stamp,stamp).run();
    await notify(db,"report","Nuevo reporte",`Reporte de ${d.first_name} ${d.last_name}.`,"report",rid);
    return json({ok:true,id:rid},201,headers);
  }


  // ---------- ADMIN: SESIÓN ACTUAL ----------
  if (path === "/api/admin/session-info" && method === "GET") {
    const token=parseCookies(request).taxote_admin_session;
    if(!token) throw new HttpError(401,"No autorizado.");
    const row=await db.prepare("SELECT username,created_at,expires_at,ip_address,user_agent,country,city FROM admin_sessions WHERE token_hash=?").bind(await sha256(token)).first();
    if(!row) throw new HttpError(401,"Sesión expirada.");
    return json({username:row.username,loginAt:row.created_at,expiresAt:row.expires_at,ip:row.ip_address||"",browser:row.user_agent||"",country:row.country||"",city:row.city||""},200,headers);
  }


  if (path === "/api/admin/sessions" && method === "GET") {
    const currentToken=parseCookies(request).taxote_admin_session, currentHash=currentToken?await sha256(currentToken):"";
    await db.prepare("DELETE FROM admin_sessions WHERE expires_at<=?").bind(nowIso()).run();
    const {results}=await db.prepare("SELECT token_hash,username,created_at,expires_at,ip_address,user_agent,country,city FROM admin_sessions ORDER BY created_at DESC").all();
    return json({sessions:(results||[]).map((s,i)=>({id:s.token_hash,current:s.token_hash===currentHash,username:s.username,createdAt:s.created_at,expiresAt:s.expires_at,ip:s.ip_address||"",browser:s.user_agent||"",country:s.country||"",city:s.city||""}))},200,headers);
  }
  let adminSessionMatch=path.match(/^\/api\/admin\/sessions\/([^/]+)$/);
  if(adminSessionMatch && method==="DELETE"){
    const hash=decodeURIComponent(adminSessionMatch[1]);
    const result=await db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(hash).run();
    if(!result.meta.changes) throw new HttpError(404,"Sesión no encontrada.");
    return json({ok:true},200,headers);
  }
  if (path === "/api/admin/security-events" && method === "GET") {
    const {results}=await db.prepare("SELECT id,username,ip_address,user_agent,country,city,successful,created_at FROM admin_login_attempts ORDER BY created_at DESC LIMIT 50").all();
    return json({events:(results||[]).map(r=>({id:r.id,username:r.username||"",ip:r.ip_address||"",browser:r.user_agent||"",country:r.country||"",city:r.city||"",successful:Boolean(r.successful),createdAt:r.created_at}))},200,headers);
  }

  if (path === "/api/maps-status" && method === "GET") {
    return json({googleMapsAvailable:Boolean(env.GOOGLE_MAPS_API_KEY),trafficAvailable:Boolean(env.GOOGLE_MAPS_API_KEY || env.TRAFFIC_TILE_URL),provider:env.GOOGLE_MAPS_API_KEY?"Google Maps":(env.TRAFFIC_PROVIDER||null)},200,headers);
  }
  if (path === "/api/maps-config" && method === "GET") {
    return json({googleMapsApiKey:env.GOOGLE_MAPS_API_KEY||""},200,headers);
  }
  let trafficMatch=path.match(/^\/api\/traffic\/(\d+)\/(\d+)\/(\d+)$/);
  if(trafficMatch && method==="GET"){
    if(!env.TRAFFIC_TILE_URL) throw new HttpError(503,"El tráfico en tiempo real todavía no tiene proveedor configurado.");
    const upstream=String(env.TRAFFIC_TILE_URL).replaceAll("{z}",trafficMatch[1]).replaceAll("{x}",trafficMatch[2]).replaceAll("{y}",trafficMatch[3]);
    const r=await fetch(upstream,{headers:{"User-Agent":"TAXOTE/1.0"}});
    if(!r.ok) throw new HttpError(502,"El proveedor de tráfico no respondió.");
    const h=new Headers(r.headers); h.set("Cache-Control","public, max-age=30");
    return new Response(r.body,{status:r.status,headers:h});
  }

  // ---------- ADMIN: NOTIFICACIONES ----------
  if (path === "/api/admin/notifications" && method === "GET") {
    const {results}=await db.prepare("SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 100").all();
    const notifications=(results||[]).map(r=>({id:Number(r.id),kind:r.kind,title:r.title,body:r.body,entityType:r.entity_type,entityId:r.entity_id,createdAt:r.created_at,readAt:r.read_at}));
    return json({notifications,unreadCount:notifications.filter(n=>!n.readAt).length},200,headers);
  }
  if (path === "/api/admin/notifications/read" && method === "POST") {
    const body=await bodyJson(request);
    if (Array.isArray(body.ids)&&body.ids.length) {
      for (const n of body.ids) await db.prepare("UPDATE admin_notifications SET read_at=? WHERE id=?").bind(nowIso(),Number(n)).run();
    } else {
      await db.prepare("UPDATE admin_notifications SET read_at=? WHERE read_at IS NULL").bind(nowIso()).run();
    }
    return json({ok:true},200,headers);
  }

  // ---------- ADMIN: CONDUCTORES ----------
  if (path === "/api/admin/drivers" && method === "GET") {
    const {results}=await db.prepare("SELECT * FROM drivers ORDER BY created_at DESC").all();
    return json((results||[]).map(r=>driverView(r)),200,headers);
  }
  if (path === "/api/admin/drivers/points" && method === "POST") {
    const body=await bodyJson(request);
    const points=Math.max(0,Math.floor(Number(body.points||0)));
    const drv=await db.prepare("SELECT id,points_balance,first_name,last_name FROM drivers WHERE public_id=?").bind(clean(body.driverId)).first();
    if(!drv) throw new HttpError(404,"Conductor no encontrado.");
    const oldPoints=Number(drv.points_balance||0),stamp=nowIso();
    const result=await db.prepare("UPDATE drivers SET points_balance=?,updated_at=? WHERE public_id=?").bind(points,stamp,clean(body.driverId)).run();
    await db.prepare("INSERT INTO driver_points_audit(driver_id,old_points,new_points,delta,reason,source,created_at) VALUES(?,?,?,?,?,'admin',?)")
      .bind(drv.id,oldPoints,points,points-oldPoints,clean(body.reason)||"Ajuste administrativo",stamp).run();
    if (body.depositId) {
      await db.prepare("UPDATE driver_deposits SET status='approved',updated_at=? WHERE id=?").bind(nowIso(),Number(body.depositId)).run();
    } else {
      await db.prepare(`UPDATE driver_deposits SET status='approved',updated_at=? WHERE id=(SELECT dd.id FROM driver_deposits dd JOIN drivers d ON d.id=dd.driver_id WHERE d.public_id=? AND dd.status='pending' ORDER BY dd.created_at ASC LIMIT 1)`).bind(nowIso(),clean(body.driverId)).run().catch(()=>{});
    }
    return json({ok:true,points},200,headers);
  }

  match=path.match(/^\/api\/admin\/drivers\/([^/]+)$/);
  if (match) {
    const publicId=decodeURIComponent(match[1]);
    const d=await db.prepare("SELECT * FROM drivers WHERE public_id=?").bind(publicId).first();
    if (!d) throw new HttpError(404,"Conductor no encontrado.");
    if (method==="GET") return json({driver:driverView(d,true)},200,headers);
    if (method==="PATCH") {
      const body=await bodyJson(request);
      const firstName=clean(body.firstName)||d.first_name,lastName=clean(body.lastName)||d.last_name,email=clean(body.email).toLowerCase()||d.email,p=phone(body.phone)||d.phone;
      if (body.password) {
        const salt=crypto.randomUUID().replaceAll("-",""),hash=await passwordHash(body.password,salt);
        await db.prepare("UPDATE drivers SET first_name=?,last_name=?,email=?,phone=?,password_hash=?,password_salt=?,updated_at=? WHERE id=?").bind(firstName,lastName,email,p,hash,salt,nowIso(),d.id).run();
      } else {
        await db.prepare("UPDATE drivers SET first_name=?,last_name=?,email=?,phone=?,updated_at=? WHERE id=?").bind(firstName,lastName,email,p,nowIso(),d.id).run();
      }
      return json({ok:true},200,headers);
    }
    if (method==="DELETE") {
      const active=await db.prepare("SELECT id FROM rides WHERE driver_id=? AND status IN ('accepted','driver_arriving','arrived','in_progress') LIMIT 1").bind(d.id).first();
      if (active) throw new HttpError(409,"No puedes eliminar un conductor con un viaje activo.");
      const deletedName=`${d.first_name} ${d.last_name}`.trim(),deletedAt=nowIso();
      await db.batch([
        db.prepare("DELETE FROM driver_documents WHERE driver_id=?").bind(d.id),
        db.prepare("DELETE FROM driver_sessions WHERE driver_id=?").bind(d.id),
        db.prepare("DELETE FROM ride_rejections WHERE driver_id=?").bind(d.id),
        db.prepare("DELETE FROM driver_deposits WHERE driver_id=?").bind(d.id),
        db.prepare("DELETE FROM internal_chat_messages WHERE conversation_id=?").bind(d.public_id),
        db.prepare("DELETE FROM drivers WHERE id=?").bind(d.id)
      ]);
      return json({ok:true,driverName:deletedName,deletedAt},200,headers);
    }
  }

  match=path.match(/^\/api\/admin\/drivers\/([^/]+)\/status$/);
  if (match && method==="POST") {
    const d=await db.prepare("SELECT * FROM drivers WHERE public_id=?").bind(decodeURIComponent(match[1])).first();
    if (!d) throw new HttpError(404,"Conductor no encontrado.");
    const body=await bodyJson(request),status=clean(body.status);
    if (!["pending","active","cancelled"].includes(status)) throw new HttpError(400,"Estado inválido.");
    await db.prepare("UPDATE drivers SET status=?,review_message=?,updated_at=?,reviewed_at=? WHERE id=?").bind(status,clean(body.message),nowIso(),nowIso(),d.id).run();
    return json({ok:true},200,headers);
  }

  match=path.match(/^\/api\/admin\/drivers\/([^/]+)\/document\/([^/]+)$/);
  if (match && method==="GET") {
    const d=await db.prepare("SELECT id FROM drivers WHERE public_id=?").bind(decodeURIComponent(match[1])).first();
    if (!d) throw new HttpError(404,"Conductor no encontrado.");
    const doc=await db.prepare("SELECT data_url FROM driver_documents WHERE driver_id=? AND kind=?").bind(d.id,decodeURIComponent(match[2])).first();
    if (!doc) throw new HttpError(404,"Documento no encontrado.");
    if (String(doc.data_url).startsWith("data:")) {
      const [meta,b64]=doc.data_url.split(",",2),mime=(meta.match(/^data:([^;]+)/)||[])[1]||"application/octet-stream";
      const bin=atob(b64),arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
      return new Response(arr,{headers:{"Content-Type":mime,"Cache-Control":"private, no-store"}});
    }
    return Response.redirect(doc.data_url,302);
  }


  if (path === "/api/admin/wallet" && method === "GET") {
    const {results}=await db.prepare(`SELECT d.id,d.public_id,d.first_name,d.last_name,d.points_balance,d.updated_at,
      (SELECT dd.created_at FROM driver_deposits dd WHERE dd.driver_id=d.id AND dd.status='approved' ORDER BY dd.updated_at DESC LIMIT 1) last_recharge_at,
      (SELECT dd.points_requested FROM driver_deposits dd WHERE dd.driver_id=d.id AND dd.status='approved' ORDER BY dd.updated_at DESC LIMIT 1) last_recharge_points
      FROM drivers d WHERE d.status!='cancelled' ORDER BY d.points_balance DESC,d.first_name,d.last_name`).all();
    const audits=await db.prepare(`SELECT a.*,d.public_id,d.first_name,d.last_name FROM driver_points_audit a JOIN drivers d ON d.id=a.driver_id ORDER BY a.created_at DESC LIMIT 100`).all();
    const alerts=await db.prepare("SELECT id,title,body,entity_id,created_at FROM admin_notifications WHERE kind='points_alert' ORDER BY created_at DESC LIMIT 30").all();
    return json({drivers:(results||[]).map(r=>({id:r.public_id,name:`${r.first_name} ${r.last_name}`.trim(),points:Number(r.points_balance||0),lastRechargeAt:r.last_recharge_at||null,lastRechargePoints:Number(r.last_recharge_points||0),updatedAt:r.updated_at})),audits:(audits.results||[]).map(a=>({driverId:a.public_id,driverName:`${a.first_name} ${a.last_name}`.trim(),oldPoints:Number(a.old_points),newPoints:Number(a.new_points),delta:Number(a.delta),reason:a.reason,source:a.source,createdAt:a.created_at})),alerts:(alerts.results||[]).map(a=>({id:Number(a.id),title:a.title,body:a.body,driverId:a.entity_id,createdAt:a.created_at}))},200,headers);
  }

  if (path === "/api/admin/deposits" && method === "GET") {
    const {results}=await db.prepare(`SELECT dd.*,d.public_id driver_public_id,d.first_name,d.last_name FROM driver_deposits dd JOIN drivers d ON d.id=dd.driver_id ORDER BY dd.created_at DESC LIMIT 200`).all();
    return json((results||[]).map(r=>({id:r.id,driverId:r.driver_public_id,driverName:`${r.first_name} ${r.last_name}`,points:Number(r.points_requested),amount:Number(r.amount_dop),status:r.status,date:r.created_at,proofUrl:r.proof_data||null})),200,headers);
  }

  if (path === "/api/admin/driver-locations" && method === "GET") {
    const threshold=new Date(Date.now()-5*60000).toISOString();
    const {results}=await db.prepare(`SELECT d.*,EXISTS(SELECT 1 FROM rides r WHERE r.driver_id=d.id AND r.status IN ('accepted','driver_arriving','arrived','in_progress')) busy
      FROM drivers d WHERE d.status='active' AND d.is_online=1 AND d.last_seen_at>?`).bind(threshold).all();
    return json((results||[]).filter(r=>Number.isFinite(Number(r.current_lat))&&Number.isFinite(Number(r.current_lon))).map(r=>({
      id:r.public_id,name:`${r.first_name} ${r.last_name}`.trim(),phone:r.phone,vehiclePlate:r.vehicle_plate,
      location:{lat:Number(r.current_lat),lon:Number(r.current_lon),bearing:Number(r.current_bearing||0)},connectionState:r.busy?"busy":"available"
    })),200,headers);
  }

  // ---------- ADMIN: CHATS ----------
  if (path === "/api/admin/chats" && method === "GET") {
    const {results}=await db.prepare("SELECT * FROM drivers WHERE status IN ('active','pending') ORDER BY first_name,last_name").all();
    const conversations=[];
    let totalUnread=0;
    for (const d of results||[]) {
      const latest=await db.prepare("SELECT * FROM internal_chat_messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1").bind(d.public_id).first();
      const unread=await db.prepare("SELECT COUNT(*) n FROM internal_chat_messages WHERE conversation_id=? AND sender='driver' AND read_at IS NULL").bind(d.public_id).first();
      const n=Number(unread?.n||0); totalUnread+=n;
      conversations.push({driver:driverView(d),latestMessage:latest?messageView({...latest,driver_name:`${d.first_name} ${d.last_name}`}):null,unreadCount:n});
    }
    conversations.sort((a,b)=>new Date(b.latestMessage?.createdAt||0)-new Date(a.latestMessage?.createdAt||0));
    return json({conversations,unreadCount:totalUnread},200,headers);
  }

  if (path === "/api/admin/chats/public") {
    if (method==="GET") {
      const {results}=await db.prepare("SELECT m.*,d.first_name,d.last_name FROM chat_messages m LEFT JOIN drivers d ON d.id=m.driver_id WHERE m.channel='public' ORDER BY m.created_at DESC LIMIT 200").all();
      return json({messages:(results||[]).reverse().map(m=>messageView({...m,driver_name:[m.first_name,m.last_name].filter(Boolean).join(" ")}))},200,headers);
    }
    if (method==="POST") {
      const body=await bodyJson(request),msg=clean(body.message),photo=body.photo||null;
      if (!msg&&!photo) throw new HttpError(400,"Escribe un mensaje o adjunta una foto.");
      await db.prepare("INSERT INTO chat_messages(channel,sender,message,photo_data,created_at) VALUES('public','admin',?,?,?)").bind(msg||"Foto",photo,nowIso()).run();
      return json({ok:true},201,headers);
    }
  }

  match=path.match(/^\/api\/admin\/chats\/([^/]+)\/(messages|read)$/);
  if (match) {
    const driverId=decodeURIComponent(match[1]),action=match[2];
    const d=await db.prepare("SELECT * FROM drivers WHERE public_id=?").bind(driverId).first();
    if (!d) throw new HttpError(404,"Conductor no encontrado.");
    if (action==="read" && method==="POST") {
      await db.prepare("UPDATE internal_chat_messages SET read_at=? WHERE conversation_id=? AND sender='driver' AND read_at IS NULL").bind(nowIso(),driverId).run();
      return json({ok:true},200,headers);
    }
    if (action==="messages" && method==="GET") {
      const {results}=await db.prepare("SELECT * FROM internal_chat_messages WHERE conversation_id=? ORDER BY created_at").bind(driverId).all();
      return json({messages:(results||[]).map(m=>messageView({...m,driver_name:`${d.first_name} ${d.last_name}`}))},200,headers);
    }
    if (action==="messages" && method==="POST") {
      const body=await bodyJson(request),msg=clean(body.message),photo=body.photo||null;
      if (!msg&&!photo) throw new HttpError(400,"Escribe un mensaje o adjunta una foto.");
      await db.prepare("INSERT INTO internal_chat_messages(conversation_id,sender,message,photo_data,created_at) VALUES(?,'admin',?,?,?)").bind(driverId,msg||"Foto",photo,nowIso()).run();
      return json({ok:true},201,headers);
    }
  }

  // Historial combinado: público, privado con conductores y chat de viajes.
  if (path === "/api/admin/conversation-history" && method === "GET") {
    const conversations=[];
    const pub=await db.prepare("SELECT COUNT(*) n,MAX(created_at) latest FROM chat_messages WHERE channel='public'").first();
    if (Number(pub?.n||0)>0) conversations.push({key:"public",type:"public",title:"Chat público",subtitle:"Todos los conductores",latestAt:pub.latest,messageCount:Number(pub.n)});
    const {results:priv}=await db.prepare(`SELECT conversation_id,COUNT(*) n,MAX(created_at) latest FROM internal_chat_messages GROUP BY conversation_id ORDER BY latest DESC`).all();
    for (const r of priv||[]) {
      const d=await db.prepare("SELECT first_name,last_name,phone FROM drivers WHERE public_id=?").bind(r.conversation_id).first();
      conversations.push({key:`driver:${r.conversation_id}`,type:"driver",title:d?`${d.first_name} ${d.last_name}`:"Conductor",subtitle:d?.phone||r.conversation_id,latestAt:r.latest,messageCount:Number(r.n)});
    }
    const {results:rides}=await db.prepare(`SELECT m.ride_id,COUNT(*) n,MAX(m.created_at) latest,r.public_id,r.passenger_name,r.passenger_phone,d.first_name,d.last_name
      FROM chat_messages m JOIN rides r ON r.id=m.ride_id LEFT JOIN drivers d ON d.id=r.driver_id WHERE m.channel='ride' GROUP BY m.ride_id ORDER BY latest DESC`).all();
    for (const r of rides||[]) conversations.push({key:`ride:${r.public_id}`,type:"ride",title:`Viaje ${r.public_id}`,subtitle:`${r.passenger_name} · ${[r.first_name,r.last_name].filter(Boolean).join(" ")||"Sin conductor"}`,latestAt:r.latest,messageCount:Number(r.n)});
    conversations.sort((a,b)=>new Date(b.latestAt)-new Date(a.latestAt));
    return json({conversations},200,headers);
  }

  if (path === "/api/admin/conversation-history/messages" && method === "GET") {
    const key=clean(url.searchParams.get("key"));
    if (key==="public") {
      const {results}=await db.prepare("SELECT m.*,d.first_name,d.last_name FROM chat_messages m LEFT JOIN drivers d ON d.id=m.driver_id WHERE m.channel='public' ORDER BY m.created_at").all();
      return json({title:"Chat público",messages:(results||[]).map(m=>messageView({...m,driver_name:[m.first_name,m.last_name].filter(Boolean).join(" ")}))},200,headers);
    }
    if (key.startsWith("driver:")) {
      const did=key.slice(7),d=await db.prepare("SELECT * FROM drivers WHERE public_id=?").bind(did).first();
      const {results}=await db.prepare("SELECT * FROM internal_chat_messages WHERE conversation_id=? ORDER BY created_at").bind(did).all();
      return json({title:d?`${d.first_name} ${d.last_name}`:"Conductor",messages:(results||[]).map(m=>messageView({...m,driver_name:d?`${d.first_name} ${d.last_name}`:"Conductor"}))},200,headers);
    }
    if (key.startsWith("ride:")) {
      const rid=key.slice(5),r=await rideRowByPublicId(db,rid); if(!r)throw new HttpError(404,"Viaje no encontrado.");
      const {results}=await db.prepare("SELECT m.*,d.first_name,d.last_name FROM chat_messages m LEFT JOIN drivers d ON d.id=m.driver_id WHERE m.channel='ride' AND m.ride_id=? ORDER BY m.created_at").bind(r.id).all();
      return json({title:`Viaje ${rid}`,messages:(results||[]).map(m=>messageView({...m,driver_name:[m.first_name,m.last_name].filter(Boolean).join(" "),passenger_name:r.passenger_name}))},200,headers);
    }
    throw new HttpError(400,"Conversación inválida.");
  }

  if (path === "/api/admin/conversation-history" && method === "DELETE") {
    const body=await bodyJson(request),key=clean(body.key);
    if (key==="public") await db.prepare("DELETE FROM chat_messages WHERE channel='public'").run();
    else if (key.startsWith("driver:")) await db.prepare("DELETE FROM internal_chat_messages WHERE conversation_id=?").bind(key.slice(7)).run();
    else if (key.startsWith("ride:")) {
      const r=await db.prepare("SELECT id FROM rides WHERE public_id=?").bind(key.slice(5)).first();
      if (r) await db.prepare("DELETE FROM chat_messages WHERE channel='ride' AND ride_id=?").bind(r.id).run();
    } else throw new HttpError(400,"Conversación inválida.");
    return json({ok:true},200,headers);
  }

  // ---------- ADMIN: REPORTES ----------
  if (path === "/api/admin/reports" && method === "GET") {
    const {results}=await db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 300").all();
    return json(results||[],200,headers);
  }
  match=path.match(/^\/api\/admin\/reports\/([^/]+)$/);
  if (match && method==="PATCH") {
    const body=await bodyJson(request),status=clean(body.status);
    const stamp=nowIso();
    const result=await db.prepare("UPDATE reports SET status=?,updated_at=?,resolved_at=? WHERE public_id=?").bind(status,stamp,status==="resolved"?stamp:null,decodeURIComponent(match[1])).run();
    if (!result.meta.changes) throw new HttpError(404,"Reporte no encontrado.");
    return json({ok:true},200,headers);
  }

  // ---------- DISPATCH ----------

  if (path === "/api/dispatch/customer-status" && method === "GET") {
    const p=phone(url.searchParams.get("phone")); if(!p) throw new HttpError(400,"Teléfono inválido.");
    const profile=await db.prepare("SELECT * FROM profiles WHERE phone=?").bind(p).first();
    if(!profile) return json({exists:false,debtDop:0,activeRides:[]},200,headers);
    const {results}=await db.prepare("SELECT public_id,status,created_at FROM rides WHERE profile_id=? AND status NOT IN ('completed','cancelled') ORDER BY created_at DESC").bind(profile.id).all();
    return json({exists:true,profile:profileView(profile),debtDop:Number(profile.debt_dop||0),activeRides:(results||[]).map(r=>({id:r.public_id,status:r.status,createdAt:r.created_at}))},200,headers);
  }

  if (path === "/api/dispatch/clients" && method === "GET") {
    const {results}=await db.prepare("SELECT * FROM profiles ORDER BY updated_at DESC,name LIMIT 500").all();
    const clients=[];
    for (const p of results||[]) clients.push({...profileView(p),addresses:await addressHistory(db,p.id)});
    return json(clients,200,headers);
  }
  if (path === "/api/dispatch/rides" && method === "GET") {
    const {results}=await db.prepare(`SELECT r.*,d.public_id driver_public_id,d.first_name,d.last_name,d.vehicle_brand,d.vehicle_model,d.vehicle_plate FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id
      WHERE r.status NOT IN ('completed','cancelled') ORDER BY r.created_at DESC`).all();
    return json(await Promise.all((results||[]).map(r=>rideView(db,r,false))),200,headers);
  }

  let dispatchRideAction=path.match(/^\/api\/dispatch\/rides\/([^/]+)\/(status|cancel)$/);
  if(dispatchRideAction){
    const publicId=decodeURIComponent(dispatchRideAction[1]),action=dispatchRideAction[2];
    const row=await rideRowByPublicId(db,publicId); if(!row) throw new HttpError(404,"Viaje no encontrado.");
    if(action==="status" && method==="POST"){
      const body=await bodyJson(request),wanted=clean(body.action),stamp=nowIso();
      if(wanted==="arrived"){
        if(!["accepted","driver_arriving"].includes(row.status)) throw new HttpError(409,"El viaje no puede marcarse como llegó.");
        await db.prepare("UPDATE rides SET status='arrived',arrived_at=? WHERE id=?").bind(stamp,row.id).run();
      }else if(wanted==="driver_arriving"){
        if(row.status!=="accepted") throw new HttpError(409,"El viaje no puede ponerse en camino.");
        await db.prepare("UPDATE rides SET status='driver_arriving' WHERE id=?").bind(row.id).run();
      }else throw new HttpError(400,"Acción no permitida.");
      await notify(db,"ride","Servicio actualizado",`${row.public_id}: ${wanted}.`,"ride",row.public_id);
      return json({ok:true},200,headers);
    }
    if(action==="cancel" && method==="POST"){
      if(["completed","cancelled"].includes(row.status)) throw new HttpError(409,"El viaje ya está cerrado.");
      const body=await bodyJson(request),stamp=nowIso(),actor=["dispatcher","driver","passenger"].includes(clean(body.actor))?clean(body.actor):"dispatcher";
      const reason=clean(body.reason)||"Sin motivo",note=clean(body.note);
      const acceptedMs=row.accepted_at?Date.now()-new Date(row.accepted_at).getTime():0;
      const lateAccepted=acceptedMs>4*60*1000;
      let driverPenalty=0, passengerFine=0;
      if(lateAccepted && actor==="driver" && ["Problema del vehículo","Emergencia del conductor","Otro"].includes(reason) && row.driver_id){
        const d=await db.prepare("SELECT points_balance,public_id,first_name,last_name FROM drivers WHERE id=?").bind(row.driver_id).first();
        if(d){
          const oldPoints=Number(d.points_balance||0),newPoints=Math.max(0,oldPoints-1); driverPenalty=oldPoints-newPoints;
          if(driverPenalty>0){
            await db.prepare("UPDATE drivers SET points_balance=?,updated_at=? WHERE id=?").bind(newPoints,stamp,row.driver_id).run();
            await db.prepare("INSERT INTO driver_points_audit(driver_id,old_points,new_points,delta,reason,source,ride_id,created_at) VALUES(?,?,?,?,?,'ride_cancel',?,?)")
              .bind(row.driver_id,oldPoints,newPoints,-driverPenalty,reason,row.id,stamp).run();
            await notify(db,"points_alert","Punto descontado",`${d.first_name} ${d.last_name}: -${driverPenalty} punto por cancelación después de 4 minutos.`,"driver",d.public_id);
          }
        }
      }
      if(lateAccepted && actor==="passenger" && ["El pasajero pidió cancelar","No necesita el servicio","Emergencia del pasajero","Otro"].includes(reason)){
        const pf=await db.prepare("SELECT debt_dop FROM profiles WHERE id=?").bind(row.profile_id).first();
        const oldDebt=Math.max(0,Number(pf?.debt_dop||0)); passengerFine=Math.max(0,Math.min(50,150-oldDebt));
        if(passengerFine>0){
          await db.prepare("UPDATE profiles SET debt_dop=MIN(150,COALESCE(debt_dop,0)+?),updated_at=? WHERE id=?").bind(passengerFine,stamp,row.profile_id).run();
          await notify(db,"passenger_fine","Multa de pasajero",`${row.passenger_name}: +RD$${passengerFine} por cancelación después de 4 minutos.`,"ride",row.public_id);
        }
      }
      await db.prepare("UPDATE rides SET status='cancelled',cancelled_at=?,closed_at=?,cancellation_reason=?,cancellation_note=?,cancelled_by=?,driver_penalty_points=? WHERE id=?")
        .bind(stamp,stamp,reason,note,actor,driverPenalty,row.id).run();
      await notify(db,"ride_cancelled","Servicio cancelado",`${row.public_id}: ${reason}.`,"ride",row.public_id);
      return json({ok:true,driverPenaltyPoints:driverPenalty,passengerFineDop:passengerFine},200,headers);
    }
  }

  if (path === "/api/dispatch/rides/history" && method === "GET") {
    const {results}=await db.prepare(`SELECT r.*,d.public_id driver_public_id,d.first_name,d.last_name,d.vehicle_brand,d.vehicle_model,d.vehicle_plate FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id
      WHERE r.status IN ('completed','cancelled') ORDER BY COALESCE(r.closed_at,r.created_at) DESC LIMIT 500`).all();
    return json(await Promise.all((results||[]).map(r=>rideView(db,r,false))),200,headers);
  }

  throw new HttpError(404,"API no encontrada.");
}
