const ACTIVE_RIDE_STATUSES = ["accepted", "driver_arriving", "arrived", "in_progress"];
const USER_CANCELLABLE_STATUSES = ["pending", "accepted", "driver_arriving", "arrived"];
const SESSION_DAYS = 30;
let schemaReady = false;

const CORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, house_number TEXT, street TEXT, suburb TEXT, city TEXT, province TEXT, postcode TEXT, lat REAL NOT NULL, lon REAL NOT NULL, place_id TEXT UNIQUE)`,
  `CREATE INDEX IF NOT EXISTS idx_addr_lat_lon ON addresses(lat, lon)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS addresses_fts USING fts5(name, street, suburb, city, province, content='addresses', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER IF NOT EXISTS addr_ai AFTER INSERT ON addresses BEGIN INSERT INTO addresses_fts(rowid,name,street,suburb,city,province) VALUES(new.id,new.name,new.street,new.suburb,new.city,new.province); END`,
  `CREATE TRIGGER IF NOT EXISTS addr_ad AFTER DELETE ON addresses BEGIN INSERT INTO addresses_fts(addresses_fts,rowid,name,street,suburb,city,province) VALUES('delete',old.id,old.name,old.street,old.suburb,old.city,old.province); END`,
  `CREATE TRIGGER IF NOT EXISTS addr_au AFTER UPDATE ON addresses BEGIN INSERT INTO addresses_fts(addresses_fts,rowid,name,street,suburb,city,province) VALUES('delete',old.id,old.name,old.street,old.suburb,old.city,old.province); INSERT INTO addresses_fts(rowid,name,street,suburb,city,province) VALUES(new.id,new.name,new.street,new.suburb,new.city,new.province); END`,
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
  // Use environment secrets for security
  const WHATSAPP_TOKEN = env.WHATSAPP_ACCESS_TOKEN || "EAAOmZBRfZC5DgBSFgk9mtd6b9UZAafRo1YJYCjHZBhmWta99GaXKVG7cJWQ9XrJzq1W2sTXABR5TJxsEjfxmXZA9qs8wTxdSnFYiLrZBprmHoA7DStZAXHf1G0lBQxcHVigA0kahOZBL0ZC9dyRvZCTh8gEkSfznvZCHRZBOtUsCHPUZAuyRZA432kAR8wqOSBRXfXwnQCo0XvFv9taxVMr3ZCSSf3TYbxOruikjhEJ84TGspKsl5NZB6bay";
  const PHONE_NUMBER_ID = "1220819124451791";
  const VERIFY_TOKEN = "taxote_whatsapp_verify_token";

  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) return new Response(challenge, { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method === "POST") {
    try {
      const body = await request.json();
      const db = env.taxote_db;

      if (body.object === "whatsapp_business_account") {
        const value = body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (message) {
          const from = message.from;
          const text = message.text?.body || "Mensaje de WhatsApp";
          const contactName = value?.contacts?.[0]?.profile?.name || "Usuario WhatsApp";

          await db.prepare(`INSERT INTO admin_notifications(kind,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?)`)
            .bind("whatsapp", `WhatsApp de ${contactName}`, text, "whatsapp", from, new Date().toISOString()).run();
        }
      }
      return new Response("EVENT_RECEIVED", { status: 200 });
    } catch (e) {
      return new Response("Error", { status: 500 });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.taxote_db;

    if (url.pathname === "/api/whatsapp/webhook") return postWhatsApp(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    try {
      if (!db) throw new HttpError(503, "La base de datos taxote_db no está vinculada.");
      await ensureSchema(db);

      const path = url.pathname.replace(/\/$/, "");
      const method = request.method;

      // Admin Login
      if (path === "/api/admin/login" && method === "POST") {
        const body = await bodyJson(request);
        if (body.username === "TAXOTEadmin1995" && body.password === "123Taxote123@1995") {
          const token = id("ADM");
          const expires = new Date();
          expires.setHours(23, 59, 59, 999); // Midnight expiry
          return json({ ok: true, token }, 200, {
            "Set-Cookie": `taxote_admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`
          });
        }
        throw new HttpError(401, "Usuario o contraseña de administrador incorrectos.");
      }

      // Cleanup Tasks (Midnight)
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() < 5) {
          // Automated cleanup of admin-driver chats every day
          await db.prepare("DELETE FROM chat_messages WHERE channel IN ('private', 'public')").run();
      }

      // Middleware Admin
      const adminPaths = ["/api/admin/", "/api/dispatch/", "/reports.html", "/drivers.html", "/deposits.html", "/history.html", "/drivers-chat.html", "/conversation-history.html"];
      const isHtmlPage = !path.startsWith("/api/") && (path.endsWith(".html") || path === "" || path === "/");
      const isAdminPath = adminPaths.some(p => path.startsWith(p)) || (isHtmlPage && (path === "" || path === "/" || adminPaths.some(p => path === p.replace(".html", ""))));

      if (isAdminPath) {
        const cookies = parseCookies(request);
        if (!cookies.taxote_admin_session) {
          if (!path.startsWith("/api/")) {
              const loginUrl = new URL("/admin-login.html", url.origin);
              loginUrl.searchParams.set("next", url.pathname + url.search);
              return Response.redirect(loginUrl.toString(), 302);
          }
          throw new HttpError(401, "No autorizado.");
        }
      }

      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

      return await handleApi(request, env, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error("TAXOTE API ERROR:", error);
      return json({ error: error.message || "Ocurrió un error interno." }, status);
    }
  }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(CORE_SCHEMA.map((statement) => db.prepare(statement)));
  schemaReady = true;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
    "Cache-Control": "no-store"
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", ...corsHeaders(), ...extraHeaders }
  });
}

async function bodyJson(request, maxBytes = 12 * 1024 * 1024) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new HttpError(413, "La solicitud contiene archivos demasiado grandes.");
  try { return await request.json(); }
  catch { throw new HttpError(400, "El contenido enviado no es JSON válido."); }
}

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split("-")[0].toUpperCase()}`; }
function clean(value) { return String(value ?? "").trim(); }
function phone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}
function validRdPhone(value) { return /^(809|829|849)\d{7}$/.test(phone(value)); }
function safeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new HttpError(400, `${name} no es válido.`);
  return number;
}
function validateLocation(value, name) {
  if (!value || clean(value.address).length < 2) throw new HttpError(400, `Selecciona la dirección de ${name}.`);
  const lat = safeNumber(value.lat, `La latitud de ${name}`);
  const lon = safeNumber(value.lon, `La longitud de ${name}`);
  if (lat < 17.35 || lat > 20.25 || lon < -72.2 || lon > -68.0) throw new HttpError(400, `${name} debe estar en República Dominicana.`);
  return { address: clean(value.address), lat, lon };
}
function parseCookies(request) {
  const cookies = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}
function sessionCookie(name, token, clear = false) {
  return `${name}=${clear ? "" : encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`;
}
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function sha256(value) { return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return bytesToHex(bits);
}
async function createSession(db, table, ownerColumn, ownerId) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const created = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare(`INSERT INTO ${table}(token_hash,${ownerColumn},expires_at,created_at) VALUES(?,?,?,?)`).bind(await sha256(token), ownerId, expires, created).run();
  return token;
}
async function userSession(request, db) {
  const token = parseCookies(request).taxote_user_session;
  if (!token) return null;
  return db.prepare(`SELECT p.* FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token), nowIso()).first();
}
async function driverSession(request, db, requireActive = true) {
  const token = parseCookies(request).taxote_driver_session;
  if (!token) return null;
  const driver = await db.prepare(`SELECT d.* FROM driver_sessions s JOIN drivers d ON d.id=s.driver_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token), nowIso()).first();
  if (driver && requireActive && driver.status !== "active") return null;
  return driver;
}
function profileView(row) { return { id: row.public_id, name: row.name, phone: row.phone, email: row.email || "", kind: row.kind }; }
function documentUrl(driverId, kind) { return `/api/admin/drivers/${encodeURIComponent(driverId)}/document/${encodeURIComponent(kind)}`; }
function driverView(row, detailed = false) {
  const value = {
    id: row.public_id, firstName: row.first_name, lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`.trim(), phone: row.phone, email: row.email,
    cedula: row.cedula, vehicleType: row.vehicle_type, vehicleBrand: row.vehicle_brand,
    vehicleModel: row.vehicle_model, vehicleColor: row.vehicle_color, vehiclePlate: row.vehicle_plate,
    paymentMethod: row.payment_method || "", pointsBalance: Number(row.points_balance || 0),
    status: row.status, reviewMessage: row.review_message || "", online: Boolean(row.is_online),
    is_online: Number(row.is_online || 0), is_available: Number(row.is_available || 0),
    createdAt: row.created_at, lastSeenAt: row.last_seen_at || null
  };
  if (detailed) value.documents = {
    selfie: documentUrl(row.public_id, "selfie"), idFront: documentUrl(row.public_id, "idFront"),
    idBack: documentUrl(row.public_id, "idBack"), vehicle: documentUrl(row.public_id, "vehicle"),
    vBack: documentUrl(row.public_id, "vehicleBack"), vLeft: documentUrl(row.public_id, "vehicleLeft"),
    vRight: documentUrl(row.public_id, "vehicleRight"), plate: documentUrl(row.public_id, "plate")
  };
  return value;
}

function addressView(row) {
  return {
    place_id: row.place_id || String(row.id), id: row.place_id || String(row.id),
    display_name: formatAddress(row), name: row.name || row.street || "Dirección",
    lat: Number(row.lat), lon: Number(row.lon), provider: "openstreetmap",
    address: { house_number: row.house_number, road: row.street, suburb: row.suburb, city: row.city, province: row.province, postcode: row.postcode, country: "República Dominicana" }
  };
}

function formatAddress(row) {
  const road = clean(row.street || row.name || "Calle sin nombre");
  const first = [clean(row.house_number), road].filter(Boolean).join(" ");
  return [first, clean(row.suburb), clean(row.city), clean(row.province), "República Dominicana"].filter((part, index, all) => part && all.indexOf(part) === index).join(", ");
}

async function handleApi(request, env, url) {
  const db = env.taxote_db;
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;

  if (path === "/api/health") return json({ ok: true, service: "TAXOTE Online", time: nowIso() });

  if ((path === "/api/geocode" || path === "/api/address/search") && method === "GET") {
    const query = clean(url.searchParams.get("q"));
    if (query.length < 2) return json([]);
    const tokens = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) || [];
    if (!tokens.length) return json([]);
    const expression = tokens.slice(0, 6).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
    let results = [];
    try {
      ({ results = [] } = await db.prepare(`SELECT a.* FROM addresses_fts f JOIN addresses a ON a.id=f.rowid WHERE addresses_fts MATCH ? ORDER BY rank LIMIT 6`).bind(expression).all());
    } catch {
      const like = `%${query}%`;
      ({ results = [] } = await db.prepare(`SELECT * FROM addresses WHERE name LIKE ? OR street LIKE ? OR suburb LIKE ? OR city LIKE ? OR province LIKE ? LIMIT 6`).bind(like, like, like, like, like).all());
    }
    return json(results.map(addressView));
  }

  if (path === "/api/place" && method === "GET") {
    const placeId = clean(url.searchParams.get("id"));
    const row = await db.prepare(`SELECT * FROM addresses WHERE place_id=? OR CAST(id AS TEXT)=? LIMIT 1`).bind(placeId, placeId).first();
    if (!row) throw new HttpError(404, "No se encontró esa dirección.");
    return json(addressView(row));
  }

  if ((path === "/api/reverse" || path === "/api/address/reverse") && method === "GET") {
    const lat = safeNumber(url.searchParams.get("lat"), "La latitud");
    const lon = safeNumber(url.searchParams.get("lon"), "La longitud");
    const row = await db.prepare(`SELECT *,((lat-?)*(lat-?)+(lon-?)*(lon-?)) AS proximity FROM addresses WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY proximity LIMIT 1`).bind(lat, lat, lon, lon, lat - .004, lat + .004, lon - .004, lon + .004).first();
    if (!row) throw new HttpError(404, "No se encontró una dirección cercana dentro de República Dominicana.");
    return json(addressView(row));
  }

  if (path === "/api/route" && method === "GET") {
    const coordinates = clean(url.searchParams.get("coordinates"));
    const parsed = parseCoordinates(coordinates);
    if (parsed.length < 2 || parsed.length > 5) throw new HttpError(400, "La ruta necesita entre dos y cinco puntos.");
    return json(await roadRoute(coordinates, parsed));
  }

  // Auth endpoints...
  if (path === "/api/auth/register" && method === "POST") {
    const body = await bodyJson(request);
    const name = clean(body.name), normalizedPhone = phone(body.phone), email = clean(body.email).toLowerCase(), password = String(body.password || "");
    if (name.length < 2) throw new HttpError(400, "Escribe tu nombre completo.");
    if (!validRdPhone(normalizedPhone)) throw new HttpError(400, "Usa un teléfono dominicano 809, 829 o 849.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Escribe un correo válido.");
    if (password.length < 6) throw new HttpError(400, "La contraseña debe tener al menos 6 caracteres.");
    const salt = crypto.randomUUID(), hash = await passwordHash(password, salt), stamp = nowIso();
    const result = await db.prepare(`INSERT INTO profiles(public_id,kind,name,phone,email,password_hash,password_salt,created_at,updated_at) VALUES(?,'registered',?,?,?,?,?,?,?)`).bind(id("USR"), name, normalizedPhone, email, hash, salt, stamp, stamp).run();
    const profile = await db.prepare(`SELECT * FROM profiles WHERE id=?`).bind(result.meta.last_row_id).first();
    const token = await createSession(db, "sessions", "profile_id", profile.id);
    return json({ user: profileView(profile) }, 201, { "Set-Cookie": sessionCookie("taxote_user_session", token) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await bodyJson(request);
    const profile = await db.prepare(`SELECT * FROM profiles WHERE phone=? AND kind='registered'`).bind(phone(body.phone)).first();
    if (!profile || !profile.password_hash || await passwordHash(String(body.password || ""), profile.password_salt) !== profile.password_hash) throw new HttpError(401, "Número de teléfono o contraseña incorrectos.");
    const token = await createSession(db, "sessions", "profile_id", profile.id);
    return json({ user: profileView(profile) }, 200, { "Set-Cookie": sessionCookie("taxote_user_session", token) });
  }

  if (path === "/api/auth/me" && method === "GET") {
    const profile = await userSession(request, db);
    if (!profile) throw new HttpError(401, "No hay una sesión activa.");
    return json({ user: profileView(profile), addresses: await savedAddresses(db, profile.id) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = parseCookies(request).taxote_user_session;
    if (token) await db.prepare(`DELETE FROM sessions WHERE token_hash=?`).bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("taxote_user_session", "", true) });
  }

  // Driver endpoints...
  if (path === "/api/driver/register" && method === "POST") {
    const body = await bodyJson(request);
    const firstName = clean(body.firstName), lastName = clean(body.lastName), email = clean(body.email).toLowerCase(), normalizedPhone = phone(body.phone), password = String(body.password || ""), cedula = clean(body.cedula).replace(/\D/g, "");
    const vehicleType = clean(body.vehicleType), vehicleBrand = clean(body.vehicleBrand), vehicleModel = clean(body.vehicleModel), vehicleColor = clean(body.vehicleColor), vehiclePlate = clean(body.vehiclePlate).toUpperCase();
    const salt = crypto.randomUUID(), hash = await passwordHash(password, salt), stamp = nowIso();
    const publicId = id("DRV");
    const result = await db.prepare(`INSERT INTO drivers(public_id,first_name,last_name,email,phone,password_hash,password_salt,cedula,vehicle_type,vehicle_brand,vehicle_model,vehicle_color,vehicle_plate,payment_method,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).bind(publicId,firstName,lastName,email,normalizedPhone,hash,salt,cedula,vehicleType,vehicleBrand,vehicleModel,vehicleColor,vehiclePlate,clean(body.paymentMethod),stamp,stamp).run();
    return json({ ok: true, driverId: publicId }, 201);
  }

  if (path === "/api/driver/login" && method === "POST") {
    const body = await bodyJson(request);
    const driver = await db.prepare(`SELECT * FROM drivers WHERE phone=?`).bind(phone(body.phone)).first();
    if (!driver || await passwordHash(String(body.password || ""), driver.password_salt) !== driver.password_hash) throw new HttpError(401, "Credenciales incorrectas.");
    if (driver.status !== "active") throw new HttpError(403, "Cuenta no activa.");
    const token = await createSession(db, "driver_sessions", "driver_id", driver.id);
    return json({ driver: driverView(driver) }, 200, { "Set-Cookie": sessionCookie("taxote_driver_session", token) });
  }

  if (path === "/api/driver/me" && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No autorizado.");
    return json({ driver: driverView(driver) });
  }

  if (path === "/api/driver/location" && method === "POST") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "Sesión expirada.");
    const body = await bodyJson(request), lat = safeNumber(body.lat, "Lat"), lon = safeNumber(body.lon, "Lon"), stamp = nowIso();
    await db.prepare(`UPDATE drivers SET current_lat=?,current_lon=?,current_bearing=?,last_seen_at=?,is_online=1,updated_at=? WHERE id=?`).bind(lat,lon,normalizeBearing(body.bearing),stamp,stamp,driver.id).run();
    return json({ ok: true });
  }

  // Dispatch & Admin endpoints
  if (path === "/api/dispatch/rides" && method === "GET") {
    const {results}=await db.prepare(`SELECT r.*,d.first_name driver_first,d.last_name driver_last FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status NOT IN ('completed','cancelled') ORDER BY r.created_at DESC LIMIT 500`).all();
    return json(results.map(dispatchRideView));
  }

  if (path === "/api/dispatch/rides/history" && method === "GET") {
    const {results}=await db.prepare(`SELECT r.*,d.first_name driver_first,d.last_name driver_last FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status IN ('completed','cancelled') ORDER BY COALESCE(r.closed_at,r.created_at) DESC LIMIT 1000`).all();
    return json(results.map(dispatchRideView));
  }

  if (path.startsWith("/api/dispatch/rides/") && path.endsWith("/contacted") && method === "POST") {
      const rideId = decodeURIComponent(path.split("/")[4]);
      const body = await bodyJson(request);
      await db.prepare("UPDATE rides SET contacted_at=?, contacted_by=? WHERE public_id=?").bind(nowIso(), body.adminName || "Admin", rideId).run();
      return json({ ok: true });
  }

  if (path === "/api/admin/drivers" && method === "GET") {
    const {results}=await db.prepare(`SELECT * FROM drivers ORDER BY created_at DESC`).all();
    return json(results.map((row)=>driverView(row)));
  }

  if (path.startsWith("/api/admin/drivers/") && method === "PATCH") {
      const driverId = decodeURIComponent(path.split("/")[4]);
      const body = await bodyJson(request);
      const fields = [], values = [];
      if(body.firstName) { fields.push("first_name=?"); values.push(clean(body.firstName)); }
      if(body.lastName) { fields.push("last_name=?"); values.push(clean(body.lastName)); }
      if(body.email) { fields.push("email=?"); values.push(clean(body.email).toLowerCase()); }
      if(body.phone) { fields.push("phone=?"); values.push(phone(body.phone)); }
      if(body.password) {
          const salt = crypto.randomUUID();
          const hash = await passwordHash(String(body.password), salt);
          fields.push("password_hash=?", "password_salt=?");
          values.push(hash, salt);
      }
      if(!fields.length) throw new HttpError(400, "Nada que actualizar.");
      values.push(nowIso(), driverId);
      await db.prepare(`UPDATE drivers SET ${fields.join(",")},updated_at=? WHERE public_id=?`).bind(...values).run();
      return json({ ok: true });
  }

  if (path === "/api/admin/chats" && method === "GET") {
    const {results:drivers}=await db.prepare(`SELECT * FROM drivers WHERE status='active' ORDER BY is_online DESC,first_name,last_name`).all();
    const conversations=[]; let unreadCount=0;
    for(const driver of drivers) {
      const latest=await db.prepare(`SELECT * FROM chat_messages WHERE channel='private' AND driver_id=? ORDER BY created_at DESC LIMIT 1`).bind(driver.id).first();
      const unread=await db.prepare(`SELECT COUNT(*) count FROM chat_messages WHERE channel='private' AND driver_id=? AND sender='driver' AND admin_read_at IS NULL`).bind(driver.id).first();
      unreadCount+=Number(unread.count||0);
      conversations.push({driver:driverView(driver),latestMessage:latest?messageView(latest,driver):null,unreadCount:Number(unread.count||0)});
    }
    return json({unreadCount,conversations});
  }

  if (path === "/api/admin/internal-chat" && method === "GET") {
      const {results} = await db.prepare("SELECT * FROM internal_chat_messages ORDER BY created_at ASC LIMIT 200").all();
      return json({ messages: results });
  }

  if (path === "/api/admin/internal-chat" && method === "POST") {
      const body = await bodyJson(request);
      await db.prepare("INSERT INTO internal_chat_messages(conversation_id, sender, message, created_at) VALUES(?,?,?,?)")
          .bind("admin_chat", "admin", clean(body.message), nowIso()).run();
      return json({ ok: true });
  }

  if (path === "/api/driver/reports" && method === "POST") {
      const driver = await driverSession(request, db);
      if (!driver) throw new HttpError(401, "No autorizado.");
      const body = await bodyJson(request);
      const publicId = id("REP");
      await db.prepare("INSERT INTO reports(public_id, reporter_type, reporter_id, reporter_name, category, description, photo_data, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .bind(publicId, "driver", driver.public_id, `${driver.first_name} ${driver.last_name}`, body.category, body.description, body.photo || null, nowIso(), nowIso()).run();
      await notify(db, "report", "Nuevo reporte de conductor", `${driver.first_name} reportó: ${body.category}`, "report", publicId);
      return json({ ok: true });
  }

  if (path === "/api/admin/reports" && method === "GET") {
      const {results} = await db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100").all();
      return json({ reports: results });
  }

  throw new HttpError(404,"Ruta de API no encontrada.");
}

async function rideByPublicId(db,publicId) { return db.prepare(`SELECT * FROM rides WHERE public_id=?`).bind(publicId).first(); }
async function rideById(db,rideId) { return db.prepare(`SELECT * FROM rides WHERE id=?`).bind(rideId).first(); }
async function rideStops(db,rideId) {
  const {results}=await db.prepare(`SELECT * FROM ride_stops WHERE ride_id=? ORDER BY position`).bind(rideId).all();
  return results.map((row)=>({address:row.address,lat:Number(row.lat),lon:Number(row.lon)}));
}
async function driverRideView(db,row) {
  if(!row) return null;
  let driver=null;
  if(row.driver_id) driver=await db.prepare(`SELECT * FROM drivers WHERE id=?`).bind(row.driver_id).first();
  return {
    id:row.public_id,status:row.status,priceDop:Number(row.price_dop||0),
    pickup:{address:row.pickup_address,lat:Number(row.pickup_lat),lon:Number(row.pickup_lon)},
    destination:{address:row.destination_address,lat:Number(row.destination_lat),lon:Number(row.destination_lon)},
    stops:await rideStops(db,row.id),passenger:{name:row.passenger_name,phone:row.passenger_phone},
    driver:driver?driverView(driver):null,note:row.note||"",createdAt:row.created_at,
    contactedAt:row.contacted_at,contactedBy:row.contacted_by
  };
}
function dispatchRideView(row) {
  return {
    id:row.public_id,passenger:row.passenger_name,phone:row.passenger_phone,
    pickup:row.pickup_address,destination:row.destination_address,
    driver:[row.driver_first,row.driver_last].filter(Boolean).join(" "),status:row.status,
    priceDop:Number(row.price_dop||0),createdAt:row.created_at,
    contactedAt:row.contacted_at,contactedBy:row.contacted_by
  };
}
function messageView(row,driver=null) {
  return {
    id:row.id,sender:row.sender,message:row.message||"",createdAt:row.created_at,
    driverName:driver?`${driver.first_name} ${driver.last_name}`.trim():"",
    adminReadAt:row.admin_read_at||null
  };
}
async function messagesFor(db,channel,driverId=null,rideId=null,recentOnly=false) {
  const {results}=await db.prepare(`SELECT m.* FROM chat_messages m WHERE m.channel=? ORDER BY m.created_at ASC`).bind(channel).all();
  return results.map((row)=>messageView(row));
}
