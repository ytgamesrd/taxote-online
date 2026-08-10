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
  `CREATE TABLE IF NOT EXISTS rides (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, profile_id INTEGER NOT NULL, passenger_type TEXT NOT NULL DEFAULT 'guest', passenger_name TEXT NOT NULL, passenger_phone TEXT NOT NULL, pickup_address TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lon REAL NOT NULL, destination_address TEXT NOT NULL, destination_lat REAL NOT NULL, destination_lon REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', driver_id INTEGER, note TEXT, payment_method TEXT, passenger_count INTEGER NOT NULL DEFAULT 1, scheduled_at TEXT, price_dop INTEGER NOT NULL DEFAULT 0, distance_km REAL NOT NULL DEFAULT 0, duration_min INTEGER NOT NULL DEFAULT 0, driver_earnings_dop INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, accepted_at TEXT, arrived_at TEXT, started_at TEXT, completed_at TEXT, cancelled_at TEXT, closed_at TEXT, cancellation_reason TEXT, cancellation_note TEXT, cancelled_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS ride_stops (id INTEGER PRIMARY KEY AUTOINCREMENT, ride_id INTEGER NOT NULL, position INTEGER NOT NULL, address TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, UNIQUE(ride_id,position))`,
  `CREATE TABLE IF NOT EXISTS ride_rejections (id INTEGER PRIMARY KEY AUTOINCREMENT, ride_id INTEGER NOT NULL, driver_id INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(ride_id,driver_id))`,
  `CREATE TABLE IF NOT EXISTS driver_deposits (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, points_requested INTEGER NOT NULL, amount_dop INTEGER NOT NULL, proof_data TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL, read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, driver_id INTEGER, ride_id INTEGER, sender TEXT NOT NULL, message TEXT, photo_data TEXT, created_at TEXT NOT NULL, admin_read_at TEXT, driver_read_at TEXT, passenger_read_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_status_created ON rides(status,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_id,status)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_phone_created ON rides(passenger_phone,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_driver_seen ON drivers(status,is_online,last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_driver ON chat_messages(channel,driver_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id,created_at)`
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (!env.taxote_db) throw new HttpError(503, "La base de datos taxote_db no está vinculada a este proyecto.");
      await ensureSchema(env.taxote_db);
      return await handleApi(request, env, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error("TAXOTE API", request.method, url.pathname, error);
      return json({ error: status === 500 ? "Ocurrió un error interno en TAXOTE." : error.message }, status);
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
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
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

function formatAddress(row) {
  const road = clean(row.street || row.name || "Calle sin nombre");
  const first = [clean(row.house_number), road].filter(Boolean).join(" ");
  return [first, clean(row.suburb), clean(row.city), clean(row.province), "República Dominicana"].filter((part, index, all) => part && all.indexOf(part) === index).join(", ");
}
function addressView(row) {
  return {
    place_id: row.place_id || String(row.id), id: row.place_id || String(row.id),
    display_name: formatAddress(row), name: row.name || row.street || "Dirección",
    lat: Number(row.lat), lon: Number(row.lon), provider: "openstreetmap",
    address: { house_number: row.house_number, road: row.street, suburb: row.suburb, city: row.city, province: row.province, postcode: row.postcode, country: "República Dominicana" }
  };
}

async function handleApi(request, env, url) {
  const db = env.taxote_db;
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;

  if (path === "/api/health") return json({ ok: true, service: "TAXOTE Online", time: nowIso() });
  if (path === "/api/maps-status") return json({ googleConfigured: false, fallback: false, provider: "OpenStreetMap RD" });

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

  if (path === "/api/auth/register" && method === "POST") {
    const body = await bodyJson(request);
    const name = clean(body.name);
    const normalizedPhone = phone(body.phone);
    const email = clean(body.email).toLowerCase();
    const password = String(body.password || "");
    if (name.length < 2) throw new HttpError(400, "Escribe tu nombre completo.");
    if (!validRdPhone(normalizedPhone)) throw new HttpError(400, "Usa un teléfono dominicano 809, 829 o 849.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Escribe un correo válido.");
    if (password.length < 6) throw new HttpError(400, "La contraseña debe tener al menos 6 caracteres.");
    if (password !== String(body.passwordConfirm || "")) throw new HttpError(400, "Las contraseñas no coinciden.");
    const existing = await db.prepare(`SELECT * FROM profiles WHERE phone=? OR email=?`).bind(normalizedPhone, email).first();
    if (existing?.kind === "registered") throw new HttpError(409, "Ese teléfono o correo ya está registrado.");
    const salt = crypto.randomUUID();
    const hash = await passwordHash(password, salt);
    const stamp = nowIso();
    let profile;
    if (existing) {
      await db.prepare(`UPDATE profiles SET kind='registered',name=?,phone=?,email=?,password_hash=?,password_salt=?,updated_at=? WHERE id=?`).bind(name, normalizedPhone, email, hash, salt, stamp, existing.id).run();
      profile = await db.prepare(`SELECT * FROM profiles WHERE id=?`).bind(existing.id).first();
    } else {
      const publicId = id("USR");
      const result = await db.prepare(`INSERT INTO profiles(public_id,kind,name,phone,email,password_hash,password_salt,created_at,updated_at) VALUES(?,'registered',?,?,?,?,?,?,?)`).bind(publicId, name, normalizedPhone, email, hash, salt, stamp, stamp).run();
      profile = await db.prepare(`SELECT * FROM profiles WHERE id=?`).bind(result.meta.last_row_id).first();
    }
    const token = await createSession(db, "sessions", "profile_id", profile.id);
    return json({ user: profileView(profile), addresses: await savedAddresses(db, profile.id) }, 201, { "Set-Cookie": sessionCookie("taxote_user_session", token) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await bodyJson(request);
    const profile = await db.prepare(`SELECT * FROM profiles WHERE phone=? AND kind='registered'`).bind(phone(body.phone)).first();
    if (!profile || !profile.password_hash || await passwordHash(String(body.password || ""), profile.password_salt) !== profile.password_hash) throw new HttpError(401, "Número de teléfono o contraseña incorrectos.");
    const token = await createSession(db, "sessions", "profile_id", profile.id);
    return json({ user: profileView(profile), addresses: await savedAddresses(db, profile.id) }, 200, { "Set-Cookie": sessionCookie("taxote_user_session", token) });
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

  if (path === "/api/guest/profile" && method === "POST") {
    const body = await bodyJson(request);
    const profile = await upsertGuest(db, body.phone, body.name);
    return json({ profile: profileView(profile), addresses: await savedAddresses(db, profile.id) });
  }

  if (path === "/api/contacts/lookup" && method === "GET") {
    const normalizedPhone = phone(url.searchParams.get("phone"));
    if (!validRdPhone(normalizedPhone)) throw new HttpError(400, "Escribe un teléfono dominicano válido.");
    const profile = await db.prepare(`SELECT * FROM profiles WHERE phone=?`).bind(normalizedPhone).first();
    if (!profile) return json({ found: false, addresses: [], rides: [] });
    const { results } = await db.prepare(`SELECT * FROM rides WHERE profile_id=? ORDER BY created_at DESC LIMIT 10`).bind(profile.id).all();
    const rides = [];
    for (const row of results) rides.push(await driverRideView(db, row));
    return json({ found: true, profile: profileView(profile), addresses: await savedAddresses(db, profile.id), rides });
  }

  if (path === "/api/dispatch/clients" && method === "GET") {
    const { results } = await db.prepare(`SELECT * FROM profiles WHERE kind='registered' ORDER BY name LIMIT 500`).all();
    return json(results.map(profileView));
  }

  if (path === "/api/driver/register" && method === "POST") {
    const body = await bodyJson(request);
    const firstName = clean(body.firstName), lastName = clean(body.lastName);
    const email = clean(body.email).toLowerCase(), normalizedPhone = phone(body.phone);
    const password = String(body.password || ""), cedula = clean(body.cedula).replace(/\D/g, "");
    const vehicleType = clean(body.vehicleType), vehicleBrand = clean(body.vehicleBrand);
    const vehicleModel = clean(body.vehicleModel), vehicleColor = clean(body.vehicleColor);
    const vehiclePlate = clean(body.vehiclePlate).toUpperCase();
    if (firstName.length < 2 || lastName.length < 2) throw new HttpError(400, "Escribe tu nombre y apellido.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Escribe un correo válido.");
    if (!validRdPhone(normalizedPhone)) throw new HttpError(400, "Usa un teléfono dominicano 809, 829 o 849.");
    if (password.length < 6 || password !== String(body.passwordConfirm || "")) throw new HttpError(400, "Confirma una contraseña de al menos 6 caracteres.");
    if (cedula.length < 11) throw new HttpError(400, "Escribe una cédula válida.");
    if (![vehicleType, vehicleBrand, vehicleModel, vehicleColor, vehiclePlate].every((value) => value.length > 0)) throw new HttpError(400, "Completa la información del vehículo.");
    const documents = {
      idFront: body.idFront, idBack: body.idBack, plate: body.platePhoto, vehicle: body.vehiclePhoto,
      vehicleBack: body.vehicleBackPhoto, vehicleLeft: body.vehicleLeftPhoto,
      vehicleRight: body.vehicleRightPhoto, selfie: body.selfiePhoto
    };
    for (const required of ["idFront", "plate", "vehicle", "selfie"]) if (!validDataUrl(documents[required])) throw new HttpError(400, "Faltan fotos obligatorias del registro.");
    for (const data of Object.values(documents)) if (data && data !== null && String(data).length > 1450000) throw new HttpError(413, "Cada foto debe pesar menos de 1 MB.");
    const existing = await db.prepare(`SELECT * FROM drivers WHERE phone=? OR email=? OR cedula=? OR vehicle_plate=?`).bind(normalizedPhone, email, cedula, vehiclePlate).first();
    if (existing && existing.status === "active") throw new HttpError(409, "Ya existe una cuenta activa con esos datos.");
    if (existing && ![normalizedPhone, email, cedula, vehiclePlate].includes(existing.phone) && existing.phone !== normalizedPhone) throw new HttpError(409, "Uno de los datos ya pertenece a otro conductor.");
    const salt = crypto.randomUUID(), hash = await passwordHash(password, salt), stamp = nowIso();
    let driverId, publicId;
    if (existing) {
      driverId = existing.id; publicId = existing.public_id;
      await db.prepare(`UPDATE drivers SET first_name=?,last_name=?,email=?,phone=?,password_hash=?,password_salt=?,cedula=?,vehicle_type=?,vehicle_brand=?,vehicle_model=?,vehicle_color=?,vehicle_plate=?,payment_method=?,status='pending',review_message=NULL,is_online=0,is_available=0,updated_at=? WHERE id=?`).bind(firstName,lastName,email,normalizedPhone,hash,salt,cedula,vehicleType,vehicleBrand,vehicleModel,vehicleColor,vehiclePlate,clean(body.paymentMethod),stamp,driverId).run();
      await db.prepare(`DELETE FROM driver_documents WHERE driver_id=?`).bind(driverId).run();
    } else {
      publicId = id("DRV");
      const result = await db.prepare(`INSERT INTO drivers(public_id,first_name,last_name,email,phone,password_hash,password_salt,cedula,vehicle_type,vehicle_brand,vehicle_model,vehicle_color,vehicle_plate,payment_method,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).bind(publicId,firstName,lastName,email,normalizedPhone,hash,salt,cedula,vehicleType,vehicleBrand,vehicleModel,vehicleColor,vehiclePlate,clean(body.paymentMethod),stamp,stamp).run();
      driverId = result.meta.last_row_id;
    }
    const documentStatements = Object.entries(documents).filter(([, data]) => validDataUrl(data)).map(([kind, data]) => db.prepare(`INSERT INTO driver_documents(driver_id,kind,data_url,created_at) VALUES(?,?,?,?)`).bind(driverId,kind,String(data),stamp));
    if (documentStatements.length) await db.batch(documentStatements);
    await notify(db, "driver_registration", "Conductor pendiente de activación", `${firstName} ${lastName} envió su registro.`, "driver", publicId);
    return json({ ok: true, driverId: publicId, message: "Registro recibido. La cuenta aún no está activada." }, 201);
  }

  if (path === "/api/driver/login" && method === "POST") {
    const body = await bodyJson(request);
    const driver = await db.prepare(`SELECT * FROM drivers WHERE phone=?`).bind(phone(body.phone)).first();
    if (!driver) throw new HttpError(404, "No existe esta cuenta.");
    if (await passwordHash(String(body.password || ""), driver.password_salt) !== driver.password_hash) throw new HttpError(401, "Número de teléfono o contraseña incorrectos.");
    if (driver.status === "pending") throw new HttpError(403, "Esta cuenta aún no está activada por TAXOTE.");
    if (driver.status !== "active") throw new HttpError(403, driver.review_message || "Esta cuenta fue rechazada. Actualiza tus datos de registro.");
    const token = await createSession(db, "driver_sessions", "driver_id", driver.id);
    const stamp = nowIso();
    await db.prepare(`UPDATE drivers SET is_online=1,is_available=1,last_login_at=?,last_seen_at=?,updated_at=? WHERE id=?`).bind(stamp, stamp, stamp, driver.id).run();
    const refreshed = await db.prepare(`SELECT * FROM drivers WHERE id=?`).bind(driver.id).first();
    return json({ driver: driverView(refreshed) }, 200, { "Set-Cookie": sessionCookie("taxote_driver_session", token) });
  }

  if (path === "/api/driver/me" && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa o la cuenta no está activada.");
    return json({ driver: driverView(driver) });
  }

  if (path === "/api/driver/disconnect" && method === "POST") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    await db.prepare(`UPDATE drivers SET is_online=0,is_available=0,updated_at=? WHERE id=?`).bind(nowIso(), driver.id).run();
    return json({ ok: true });
  }

  if (path === "/api/driver/logout" && method === "POST") {
    const token = parseCookies(request).taxote_driver_session;
    const driver = await driverSession(request, db, false);
    if (driver) await db.prepare(`UPDATE drivers SET is_online=0,is_available=0,updated_at=? WHERE id=?`).bind(nowIso(), driver.id).run();
    if (token) await db.prepare(`DELETE FROM driver_sessions WHERE token_hash=?`).bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("taxote_driver_session", "", true) });
  }

  if (path === "/api/driver/location" && method === "POST") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "La sesión del conductor expiró.");
    const body = await bodyJson(request);
    const lat = safeNumber(body.lat, "La latitud"), lon = safeNumber(body.lon, "La longitud");
    if (lat < 17.0 || lat > 20.5 || lon < -72.5 || lon > -67.5) throw new HttpError(400, "La ubicación está fuera de República Dominicana.");
    const active = await db.prepare(`SELECT id FROM rides WHERE driver_id=? AND status IN ('accepted','driver_arriving','arrived','in_progress') LIMIT 1`).bind(driver.id).first();
    const stamp = nowIso();
    await db.prepare(`UPDATE drivers SET current_lat=?,current_lon=?,current_accuracy=?,current_bearing=?,current_speed_kph=?,last_seen_at=?,is_online=1,is_available=?,updated_at=? WHERE id=?`).bind(lat,lon,Number(body.accuracyM||0),normalizeBearing(body.bearing),Math.max(0,Number(body.speedKph||0)),stamp,active?0:1,stamp,driver.id).run();
    return json({ ok: true, connectionState: active ? "busy" : "available", updatedAt: stamp });
  }

  if (path === "/api/driver/fcm-token" && method === "POST") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    const body = await bodyJson(request);
    await db.prepare(`UPDATE drivers SET fcm_token=?,updated_at=? WHERE id=?`).bind(clean(body.token),nowIso(),driver.id).run();
    return json({ ok: true });
  }

  if (path === "/api/driver/work" && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    const active = await db.prepare(`SELECT * FROM rides WHERE driver_id=? AND status IN ('accepted','driver_arriving','arrived','in_progress') ORDER BY created_at LIMIT 1`).bind(driver.id).first();
    let offers = [];
    if (!active) {
      const { results } = await db.prepare(`SELECT r.* FROM rides r WHERE r.status='pending' AND (r.scheduled_at IS NULL OR r.scheduled_at<=?) AND (r.driver_id=? OR r.driver_id IS NULL) AND NOT EXISTS(SELECT 1 FROM ride_rejections rr WHERE rr.ride_id=r.id AND rr.driver_id=?) ORDER BY CASE WHEN r.driver_id=? THEN 0 ELSE 1 END,r.created_at LIMIT 5`).bind(nowIso(),driver.id,driver.id,driver.id).all();
      for (const row of results) offers.push(await driverRideView(db, row));
    }
    return json({ activeRide: active ? await driverRideView(db, active) : null, offers });
  }

  let match = path.match(/^\/api\/driver\/rides\/([^/]+)\/(accept|reject|cancel|status|chat)$/);
  if (match && method === "POST") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    const ride = await rideByPublicId(db, decodeURIComponent(match[1]));
    if (!ride) throw new HttpError(404, "El servicio ya no existe.");
    const action = match[2];
    if (action === "accept") return acceptRide(db, driver, ride);
    if (action === "reject") {
      if (ride.status !== "pending") throw new HttpError(409, "Este servicio ya no está pendiente.");
      await db.prepare(`INSERT OR IGNORE INTO ride_rejections(ride_id,driver_id,created_at) VALUES(?,?,?)`).bind(ride.id,driver.id,nowIso()).run();
      if (ride.driver_id === driver.id) await db.prepare(`UPDATE rides SET driver_id=NULL WHERE id=? AND status='pending'`).bind(ride.id).run();
      await notify(db,"ride_rejected","Servicio rechazado",`${driver.first_name} ${driver.last_name} rechazó ${ride.public_id}.`,"ride",ride.public_id);
      return json({ ok: true });
    }
    if (action === "cancel") {
      if (!["accepted","driver_arriving","arrived"].includes(ride.status) || ride.driver_id !== driver.id) throw new HttpError(409, "Este servicio ya no se puede cancelar desde la app.");
      const body = await bodyJson(request);
      const stamp = nowIso();
      await db.prepare(`UPDATE rides SET status='cancelled',cancelled_at=?,closed_at=?,cancellation_reason=?,cancelled_by='driver' WHERE id=?`).bind(stamp,stamp,clean(body.reason)||"Cancelado por el conductor",ride.id).run();
      await db.prepare(`UPDATE drivers SET is_available=1,updated_at=? WHERE id=?`).bind(stamp,driver.id).run();
      await notify(db,"cancellation","Servicio cancelado por conductor",`${driver.first_name} ${driver.last_name} canceló ${ride.public_id}.`,"ride",ride.public_id);
      return json({ ok: true, ride: await driverRideView(db, await rideById(db, ride.id)) });
    }
    if (action === "status") {
      const body = await bodyJson(request);
      return updateRideStatus(db, driver, ride, clean(body.action));
    }
    if (action === "chat") return postRideChat(request, db, driver, ride, "driver");
  }

  match = path.match(/^\/api\/driver\/rides\/([^/]+)\/chat$/);
  if (match && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    const ride = await rideByPublicId(db, decodeURIComponent(match[1]));
    if (!ride || ride.driver_id !== driver.id || !ACTIVE_RIDE_STATUSES.includes(ride.status)) throw new HttpError(403, "Este chat de viaje no está disponible.");
    await db.prepare(`UPDATE chat_messages SET driver_read_at=? WHERE ride_id=? AND sender!='driver' AND driver_read_at IS NULL`).bind(nowIso(),ride.id).run();
    return json({ messages: await messagesFor(db,"ride",driver.id,ride.id) });
  }

  if (path === "/api/driver/wallet" && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    const stats = await db.prepare(`SELECT COUNT(*) trips,COALESCE(SUM(driver_earnings_dop),0) earnings FROM rides WHERE driver_id=? AND status='completed'`).bind(driver.id).first();
    return json({ balance:Number(stats.earnings||0),completedTrips:Number(stats.trips||0),pointsBalance:Number(driver.points_balance||0) });
  }

  if (path === "/api/driver/history" && method === "GET") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    const { results } = await db.prepare(`SELECT * FROM rides WHERE driver_id=? AND status IN ('completed','cancelled') ORDER BY COALESCE(closed_at,created_at) DESC LIMIT 200`).bind(driver.id).all();
    const rides=[]; for(const row of results) rides.push(await driverRideView(db,row));
    return json({ rides });
  }

  if (path === "/api/driver/points/deposit" && method === "POST") {
    const driver = await driverSession(request, db);
    if (!driver) throw new HttpError(401, "No hay una sesión activa.");
    const body = await bodyJson(request);
    const points=Math.max(1,Math.round(Number(body.points||0))), amount=Math.max(1,Math.round(Number(body.amount||0)));
    if (!Number.isFinite(points)||!Number.isFinite(amount)) throw new HttpError(400,"Escribe puntos y monto válidos.");
    if (body.photo && String(body.photo).length>1450000) throw new HttpError(413,"El comprobante debe pesar menos de 1 MB.");
    const stamp=nowIso();
    await db.prepare(`INSERT INTO driver_deposits(driver_id,points_requested,amount_dop,proof_data,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)`).bind(driver.id,points,amount,body.photo||null,stamp,stamp).run();
    await notify(db,"deposit","Nuevo depósito",`${driver.first_name} ${driver.last_name} solicita ${points} puntos.`,"deposit",driver.public_id);
    return json({ok:true});
  }

  if (path === "/api/driver/chat/unread" && method === "GET") {
    const driver=await driverSession(request,db); if(!driver) throw new HttpError(401,"No hay una sesión activa.");
    const row=await db.prepare(`SELECT COUNT(*) count FROM chat_messages WHERE sender='admin' AND driver_read_at IS NULL AND ((channel='private' AND driver_id=?) OR (channel='ride' AND driver_id=?))`).bind(driver.id,driver.id).first();
    return json({unreadCount:Number(row.count||0)});
  }
  if ((path==="/api/driver/chat/public"||path==="/api/driver/chat/private") && method==="GET") {
    const driver=await driverSession(request,db); if(!driver) throw new HttpError(401,"No hay una sesión activa.");
    const channel=path.endsWith("public")?"public":"private";
    if(channel==="private") await db.prepare(`UPDATE chat_messages SET driver_read_at=? WHERE channel='private' AND driver_id=? AND sender='admin' AND driver_read_at IS NULL`).bind(nowIso(),driver.id).run();
    return json({messages:await messagesFor(db,channel,driver.id,null,true)});
  }
  if ((path==="/api/driver/chat/public"||path==="/api/driver/chat/private") && method==="POST") {
    const driver=await driverSession(request,db); if(!driver) throw new HttpError(401,"No hay una sesión activa.");
    const channel=path.endsWith("public")?"public":"private", body=await bodyJson(request);
    await addMessage(db,channel,driver.id,null,"driver",body,channel==="public"?nowIso():null,null,null);
    return json({ok:true},201);
  }

  if (path === "/api/rides/estimate" && method === "POST") {
    const body=await bodyJson(request);
    const pickup=validateLocation(body.pickup,"recogida"), destination=validateLocation(body.destination,"destino");
    const stops=(Array.isArray(body.stops)?body.stops:[]).slice(0,3).map((stop,index)=>validateLocation(stop,`parada C${index+1}`));
    const calculated=await calculateEstimate([pickup,...stops,destination]);
    return json({pickup,destination,stops,estimate:calculated});
  }

  if (path === "/api/rides" && method === "POST") {
    const body=await bodyJson(request);
    const pickup=validateLocation(body.pickup,"recogida"), destination=validateLocation(body.destination,"destino");
    const stops=(Array.isArray(body.stops)?body.stops:[]).slice(0,3).map((stop,index)=>validateLocation(stop,`parada C${index+1}`));
    let profile=await userSession(request,db);
    if(!profile) profile=await upsertGuest(db,body.phone,body.name);
    const estimate=await calculateEstimate([pickup,...stops,destination]);
    let assignedDriver=null;
    if(clean(body.driverId)) {
      assignedDriver=await db.prepare(`SELECT * FROM drivers WHERE public_id=? AND status='active'`).bind(clean(body.driverId)).first();
      if(!assignedDriver) throw new HttpError(400,"El conductor seleccionado no está activo.");
    } else assignedDriver=await nearestAvailableDriver(db,pickup);
    const scheduledAt=clean(body.scheduledAt)||null;
    if(scheduledAt && !Number.isFinite(Date.parse(scheduledAt))) throw new HttpError(400,"La fecha programada no es válida.");
    const publicId=id("TX"), stamp=nowIso();
    const result=await db.prepare(`INSERT INTO rides(public_id,profile_id,passenger_type,passenger_name,passenger_phone,pickup_address,pickup_lat,pickup_lon,destination_address,destination_lat,destination_lon,status,driver_id,note,payment_method,passenger_count,scheduled_at,price_dop,distance_km,duration_min,driver_earnings_dop,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?)`).bind(publicId,profile.id,profile.kind,profile.name,profile.phone,pickup.address,pickup.lat,pickup.lon,destination.address,destination.lat,destination.lon,assignedDriver?.id||null,clean(body.note),clean(body.paymentMethod),Math.max(1,Number(body.passengerCount||1)),scheduledAt,estimate.priceDop,estimate.distanceKm,estimate.durationMin,Math.round(estimate.priceDop*.8),stamp).run();
    const rideId=result.meta.last_row_id;
    if(stops.length) await db.batch(stops.map((stop,index)=>db.prepare(`INSERT INTO ride_stops(ride_id,position,address,lat,lon) VALUES(?,?,?,?,?)`).bind(rideId,index+1,stop.address,stop.lat,stop.lon)));
    const created=await rideById(db,rideId);
    await notify(db,"new_ride","Nuevo servicio",`${publicId}: ${profile.name} solicita un viaje.`,"ride",publicId);
    return json({ride:await driverRideView(db,created),profile:profileView(profile),addresses:await savedAddresses(db,profile.id)},201);
  }

  if (path === "/api/rides/mine" && method === "GET") {
    let profile=await userSession(request,db);
    if(!profile && url.searchParams.get("phone")) profile=await db.prepare(`SELECT * FROM profiles WHERE phone=?`).bind(phone(url.searchParams.get("phone"))).first();
    if(!profile) throw new HttpError(401,"Identifica el teléfono del pasajero.");
    const {results}=await db.prepare(`SELECT * FROM rides WHERE profile_id=? AND status IN ('pending','accepted','driver_arriving','arrived','in_progress') ORDER BY created_at DESC`).bind(profile.id).all();
    const rides=[]; for(const row of results) rides.push(await driverRideView(db,row));
    return json({rides});
  }

  let rideMatch=path.match(/^\/api\/rides\/([^/]+)\/cancel$/);
  if(rideMatch && method==="POST") {
    const ride=await rideByPublicId(db,decodeURIComponent(rideMatch[1]));
    if(!ride) throw new HttpError(404,"El servicio no existe.");
    if(!USER_CANCELLABLE_STATUSES.includes(ride.status)) throw new HttpError(409,"El viaje ya inició y solo el conductor puede terminarlo.");
    const body=await bodyJson(request), session=await userSession(request,db);
    if(!session && phone(body.phone)!==ride.passenger_phone) throw new HttpError(403,"El teléfono no corresponde a este servicio.");
    if(session && session.id!==ride.profile_id) throw new HttpError(403,"Este servicio pertenece a otro usuario.");
    await cancelRide(db,ride,clean(body.reason)||"Cancelado por el pasajero",clean(body.note),"passenger");
    return json({ok:true});
  }

  if (path === "/api/dispatch/rides" && method === "GET") {
    const {results}=await db.prepare(`SELECT r.*,d.first_name driver_first,d.last_name driver_last FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status NOT IN ('completed','cancelled') ORDER BY r.created_at DESC LIMIT 500`).all();
    return json(results.map(dispatchRideView));
  }
  if (path === "/api/dispatch/rides/history" && method === "GET") {
    const {results}=await db.prepare(`SELECT r.*,d.first_name driver_first,d.last_name driver_last FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status IN ('completed','cancelled') ORDER BY COALESCE(r.closed_at,r.created_at) DESC LIMIT 2000`).all();
    return json(results.map(dispatchRideView));
  }
  rideMatch=path.match(/^\/api\/dispatch\/rides\/([^/]+)\/cancel$/);
  if(rideMatch && method==="POST") {
    const ride=await rideByPublicId(db,decodeURIComponent(rideMatch[1]));
    if(!ride) throw new HttpError(404,"El servicio no existe.");
    if(!USER_CANCELLABLE_STATUSES.includes(ride.status)) throw new HttpError(409,"El viaje ya inició y no se puede cancelar desde la Central.");
    const body=await bodyJson(request);
    await cancelRide(db,ride,clean(body.reason)||"Cancelado desde la Central",clean(body.note),"dispatcher");
    return json({ok:true});
  }

  if (path === "/api/admin/drivers" && method === "GET") {
    const {results}=await db.prepare(`SELECT * FROM drivers ORDER BY created_at DESC`).all();
    return json(results.map((row)=>driverView(row)));
  }
  if (path === "/api/admin/drivers/points" && method === "POST") {
    const body=await bodyJson(request),points=Math.max(0,Math.round(Number(body.points||0)));
    if(!Number.isFinite(points)) throw new HttpError(400,"La cantidad de puntos no es válida.");
    const result=await db.prepare(`UPDATE drivers SET points_balance=?,updated_at=? WHERE public_id=?`).bind(points,nowIso(),clean(body.driverId)).run();
    if(!result.meta.changes) throw new HttpError(404,"No se encontró el conductor.");
    return json({ok:true,points});
  }
  let driverMatch=path.match(/^\/api\/admin\/drivers\/([^/]+)$/);
  if(driverMatch && method==="GET") {
    const driver=await db.prepare(`SELECT * FROM drivers WHERE public_id=?`).bind(decodeURIComponent(driverMatch[1])).first();
    if(!driver) throw new HttpError(404,"No se encontró el conductor.");
    const detailed=driverView(driver,true);
    const {results:docs}=await db.prepare(`SELECT kind FROM driver_documents WHERE driver_id=?`).bind(driver.id).all();
    const kinds=new Set(docs.map((item)=>item.kind));
    for(const [key,kind] of Object.entries({selfie:"selfie",idFront:"idFront",idBack:"idBack",vehicle:"vehicle",vBack:"vehicleBack",vLeft:"vehicleLeft",vRight:"vehicleRight",plate:"plate"})) if(!kinds.has(kind)) detailed.documents[key]=null;
    return json({driver:detailed});
  }
  if(driverMatch && method==="DELETE") {
    const driver=await db.prepare(`SELECT * FROM drivers WHERE public_id=?`).bind(decodeURIComponent(driverMatch[1])).first();
    if(!driver) throw new HttpError(404,"No se encontró el conductor.");
    const active=await db.prepare(`SELECT id FROM rides WHERE driver_id=? AND status IN ('accepted','driver_arriving','arrived','in_progress')`).bind(driver.id).first();
    if(active) throw new HttpError(409,"No puedes eliminar un conductor con un servicio activo.");
    await db.batch([
      db.prepare(`DELETE FROM driver_documents WHERE driver_id=?`).bind(driver.id),
      db.prepare(`DELETE FROM driver_sessions WHERE driver_id=?`).bind(driver.id),
      db.prepare(`DELETE FROM ride_rejections WHERE driver_id=?`).bind(driver.id),
      db.prepare(`DELETE FROM drivers WHERE id=?`).bind(driver.id)
    ]);
    return json({ok:true});
  }
  driverMatch=path.match(/^\/api\/admin\/drivers\/([^/]+)\/status$/);
  if(driverMatch && method==="POST") {
    const body=await bodyJson(request),status=clean(body.status);
    if(!["active","pending","cancelled"].includes(status)) throw new HttpError(400,"Estado de conductor no válido.");
    const stamp=nowIso();
    const result=await db.prepare(`UPDATE drivers SET status=?,review_message=?,reviewed_at=?,is_online=CASE WHEN ?='active' THEN is_online ELSE 0 END,is_available=CASE WHEN ?='active' THEN is_available ELSE 0 END,updated_at=? WHERE public_id=?`).bind(status,clean(body.message)||null,stamp,status,status,stamp,decodeURIComponent(driverMatch[1])).run();
    if(!result.meta.changes) throw new HttpError(404,"No se encontró el conductor.");
    await notify(db,"driver_status",status==="active"?"Conductor activado":"Registro de conductor actualizado",`La cuenta ${decodeURIComponent(driverMatch[1])} cambió a ${status}.`,"driver",decodeURIComponent(driverMatch[1]));
    return json({ok:true,status});
  }
  driverMatch=path.match(/^\/api\/admin\/drivers\/([^/]+)\/document\/([^/]+)$/);
  if(driverMatch && method==="GET") {
    const driver=await db.prepare(`SELECT id FROM drivers WHERE public_id=?`).bind(decodeURIComponent(driverMatch[1])).first();
    if(!driver) throw new HttpError(404,"No se encontró el conductor.");
    const doc=await db.prepare(`SELECT data_url FROM driver_documents WHERE driver_id=? AND kind=?`).bind(driver.id,decodeURIComponent(driverMatch[2])).first();
    if(!doc) throw new HttpError(404,"La foto no está disponible.");
    return dataUrlResponse(doc.data_url);
  }

  if ((path === "/api/admin/connected-drivers" || path === "/api/admin/driver-locations") && method === "GET") {
    const includeOffline=path.endsWith("driver-locations");
    const threshold=new Date(Date.now()-5*60000).toISOString();
    const sql=includeOffline?`SELECT * FROM drivers WHERE status='active' AND current_lat IS NOT NULL ORDER BY last_seen_at DESC`:`SELECT * FROM drivers WHERE status='active' AND is_online=1 AND last_seen_at>? ORDER BY last_seen_at DESC`;
    const response=includeOffline?await db.prepare(sql).all():await db.prepare(sql).bind(threshold).all();
    const output=[];
    for(const row of response.results||[]) output.push(await connectedDriverView(db,row,threshold));
    return json(output);
  }

  if (path === "/api/admin/notifications" && method === "GET") {
    const {results}=await db.prepare(`SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 100`).all();
    const unread=results.filter((item)=>!item.read_at).length;
    return json({unreadCount:unread,notifications:results.map((item)=>({id:item.id,kind:item.kind,title:item.title,body:item.body,entityType:item.entity_type,entityId:item.entity_id,createdAt:item.created_at,readAt:item.read_at}))});
  }
  if (path === "/api/admin/notifications/read" && method === "POST") {
    const body=await bodyJson(request),stamp=nowIso();
    if(body.all) await db.prepare(`UPDATE admin_notifications SET read_at=? WHERE read_at IS NULL`).bind(stamp).run();
    else if(Array.isArray(body.ids)&&body.ids.length) {
      const ids=body.ids.map(Number).filter(Number.isFinite).slice(0,100);
      if(ids.length) await db.prepare(`UPDATE admin_notifications SET read_at=? WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(stamp,...ids).run();
    }
    return json({ok:true});
  }

  if (path === "/api/admin/deposits" && method === "GET") {
    const {results}=await db.prepare(`SELECT p.*,d.public_id driver_public,d.first_name,d.last_name FROM driver_deposits p JOIN drivers d ON d.id=p.driver_id ORDER BY p.created_at DESC`).all();
    return json(results.map((row)=>({id:row.id,driverId:row.driver_public,driverName:`${row.first_name} ${row.last_name}`,points:Number(row.points_requested),amount:Number(row.amount_dop),status:row.status,date:row.created_at,proofUrl:row.proof_data?`/api/admin/deposits/${row.id}/proof`:null})));
  }
  let depositMatch=path.match(/^\/api\/admin\/deposits\/(\d+)\/proof$/);
  if(depositMatch&&method==="GET") {
    const row=await db.prepare(`SELECT proof_data FROM driver_deposits WHERE id=?`).bind(Number(depositMatch[1])).first();
    if(!row?.proof_data) throw new HttpError(404,"No hay comprobante.");
    return dataUrlResponse(row.proof_data);
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
    conversations.sort((a,b)=>Date.parse(b.latestMessage?.createdAt||0)-Date.parse(a.latestMessage?.createdAt||0));
    return json({unreadCount,conversations});
  }
  if (path === "/api/admin/chats/public" && method === "GET") return json({messages:await messagesFor(db,"public",null,null,true)});
  if (path === "/api/admin/chats/public" && method === "POST") {
    const body=await bodyJson(request); await addMessage(db,"public",null,null,"admin",body,nowIso(),null,null); return json({ok:true},201);
  }
  let chatMatch=path.match(/^\/api\/admin\/chats\/([^/]+)\/(read|messages)$/);
  if(chatMatch) {
    const driver=await db.prepare(`SELECT * FROM drivers WHERE public_id=?`).bind(decodeURIComponent(chatMatch[1])).first();
    if(!driver) throw new HttpError(404,"No se encontró el conductor.");
    if(chatMatch[2]==="read"&&method==="POST") {
      await db.prepare(`UPDATE chat_messages SET admin_read_at=? WHERE channel='private' AND driver_id=? AND sender='driver' AND admin_read_at IS NULL`).bind(nowIso(),driver.id).run();
      return json({ok:true});
    }
    if(chatMatch[2]==="messages"&&method==="GET") return json({messages:await messagesFor(db,"private",driver.id,null,true)});
    if(chatMatch[2]==="messages"&&method==="POST") {
      const body=await bodyJson(request); await addMessage(db,"private",driver.id,null,"admin",body,nowIso(),null,null); return json({ok:true},201);
    }
  }

  if (path === "/api/admin/conversation-history" && method === "GET") return json({conversations:await conversationHistory(db)});
  if (path === "/api/admin/conversation-history" && method === "DELETE") {
    const body=await bodyJson(request),key=clean(body.key);
    await deleteConversation(db,key); return json({ok:true});
  }
  if (path === "/api/admin/conversation-history/messages" && method === "GET") return json(await conversationMessages(db,clean(url.searchParams.get("key"))));

  let mediaMatch=path.match(/^\/api\/media\/message\/(\d+)$/);
  if(mediaMatch&&method==="GET") {
    const row=await db.prepare(`SELECT photo_data FROM chat_messages WHERE id=?`).bind(Number(mediaMatch[1])).first();
    if(!row?.photo_data) throw new HttpError(404,"La foto ya no está disponible.");
    return dataUrlResponse(row.photo_data);
  }

  let userChatMatch=path.match(/^\/api\/user\/rides\/([^/]+)\/chat$/);
  if(userChatMatch) {
    const ride=await rideByPublicId(db,decodeURIComponent(userChatMatch[1]));
    if(!ride||!ACTIVE_RIDE_STATUSES.includes(ride.status)||!ride.driver_id) throw new HttpError(403,"El chat se activa cuando un conductor acepta el servicio.");
    const profile=await userSession(request,db), queryPhone=phone(url.searchParams.get("phone"));
    if((profile&&profile.id!==ride.profile_id)||(!profile&&queryPhone!==ride.passenger_phone&&method==="GET")) throw new HttpError(403,"Este chat pertenece a otro pasajero.");
    if(method==="GET") {
      await db.prepare(`UPDATE chat_messages SET passenger_read_at=? WHERE ride_id=? AND sender!='passenger' AND passenger_read_at IS NULL`).bind(nowIso(),ride.id).run();
      const driver=await db.prepare(`SELECT * FROM drivers WHERE id=?`).bind(ride.driver_id).first();
      return json({driverName:driver?`${driver.first_name} ${driver.last_name}`:"Conductor TAXOTE",messages:await messagesFor(db,"ride",ride.driver_id,ride.id)});
    }
    if(method==="POST") {
      const body=await bodyJson(request);
      if(!profile&&phone(body.phone)!==ride.passenger_phone) throw new HttpError(403,"El teléfono no corresponde al servicio.");
      return postRideChat(request,db,null,ride,"passenger",body);
    }
  }
  if (path === "/api/user/chat/unread" && method === "GET") {
    const profile=await userSession(request,db), queryPhone=phone(url.searchParams.get("phone"));
    if(!profile&&!validRdPhone(queryPhone)) return json({unreadCount:0});
    const ownerCondition=profile?"r.profile_id=?":"r.passenger_phone=?";
    const ownerValue=profile?profile.id:queryPhone;
    const row=await db.prepare(`SELECT COUNT(*) count FROM chat_messages m JOIN rides r ON r.id=m.ride_id WHERE m.channel='ride' AND m.sender!='passenger' AND m.passenger_read_at IS NULL AND ${ownerCondition}`).bind(ownerValue).first();
    return json({unreadCount:Number(row.count||0)});
  }

  throw new HttpError(404,"Ruta de API no encontrada.");
}

async function upsertGuest(db, rawPhone, rawName) {
  const normalizedPhone = phone(rawPhone);
  const name = clean(rawName);
  if (!validRdPhone(normalizedPhone)) throw new HttpError(400, "Usa un teléfono dominicano 809, 829 o 849.");
  let profile = await db.prepare(`SELECT * FROM profiles WHERE phone=?`).bind(normalizedPhone).first();
  if (profile) return profile;
  if (name.length < 2) throw new HttpError(400, "Escribe el nombre del invitado.");
  const stamp = nowIso();
  const result = await db.prepare(`INSERT INTO profiles(public_id,kind,name,phone,created_at,updated_at) VALUES(?,'guest',?,?,?,?)`).bind(id("GST"), name, normalizedPhone, stamp, stamp).run();
  return db.prepare(`SELECT * FROM profiles WHERE id=?`).bind(result.meta.last_row_id).first();
}

async function savedAddresses(db, profileId) {
  const { results } = await db.prepare(`SELECT pickup_address,pickup_lat,pickup_lon,destination_address,destination_lat,destination_lon,created_at FROM rides WHERE profile_id=? ORDER BY created_at DESC LIMIT 20`).bind(profileId).all();
  const seen = new Set();
  const addresses = [];
  for (const row of results) {
    for (const item of [
      { address: row.pickup_address, lat: row.pickup_lat, lon: row.pickup_lon },
      { address: row.destination_address, lat: row.destination_lat, lon: row.destination_lon }
    ]) {
      const key = clean(item.address).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); addresses.push(item);
      if (addresses.length >= 10) return addresses;
    }
  }
  return addresses;
}

function parseCoordinates(value) {
  return clean(value).split(";").map((pair)=>pair.split(",").map(Number)).filter((pair)=>pair.length===2&&pair.every(Number.isFinite));
}
function haversine(lat1,lon1,lat2,lon2) {
  const rad=(value)=>value*Math.PI/180,earth=6371;
  const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return earth*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
async function roadRoute(coordinateString, parsed) {
  try {
    const response=await fetch(`https://router.project-osrm.org/route/v1/driving/${encodeURI(coordinateString)}?overview=full&geometries=geojson&steps=false`,{headers:{"User-Agent":"TAXOTE/1.0"},cf:{cacheTtl:30,cacheEverything:true}});
    if(response.ok) {
      const data=await response.json();
      if(data.routes?.length) return data;
    }
  } catch {}
  let distanceKm=0;
  for(let index=1;index<parsed.length;index++) distanceKm+=haversine(parsed[index-1][1],parsed[index-1][0],parsed[index][1],parsed[index][0]);
  distanceKm*=1.28;
  return {code:"Fallback",routes:[{distance:distanceKm*1000,duration:distanceKm/28*3600,geometry:{type:"LineString",coordinates:parsed}}]};
}
async function calculateEstimate(locations) {
  const coordinates=locations.map((location)=>`${location.lon},${location.lat}`).join(";");
  const data=await roadRoute(coordinates,parseCoordinates(coordinates));
  const route=data.routes[0],distanceKm=Math.max(.1,Number(route.distance||0)/1000),durationMin=Math.max(1,Math.round(Number(route.duration||0)/60));
  const priceDop=Math.max(200,Math.round((150+distanceKm*45+Math.max(0,locations.length-2)*50)/25)*25);
  return {distanceKm:Number(distanceKm.toFixed(2)),durationMin,priceDop};
}
function normalizeBearing(value) { const number=Number(value||0); return Number.isFinite(number)?((number%360)+360)%360:0; }
function validDataUrl(value) { return typeof value==="string"&&/^data:image\/(png|jpe?g|webp);base64,/i.test(value); }
function dataUrlResponse(dataUrl) {
  const match=String(dataUrl||"").match(/^data:([^;,]+);base64,(.+)$/s);
  if(!match) throw new HttpError(415,"El archivo guardado no es válido.");
  const binary=atob(match[2]),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
  return new Response(bytes,{headers:{"Content-Type":match[1],"Cache-Control":"private, max-age=300","X-Content-Type-Options":"nosniff"}});
}
async function notify(db,kind,title,body,entityType,entityId) {
  await db.prepare(`INSERT INTO admin_notifications(kind,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?)`).bind(kind,title,body,entityType||null,entityId||null,nowIso()).run();
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
    id:row.public_id,status:row.status,priceDop:Number(row.price_dop||0),driverEarningsDop:Number(row.driver_earnings_dop||0),
    durationMin:Number(row.duration_min||0),distanceKm:Number(row.distance_km||0),
    pickup:{address:row.pickup_address,lat:Number(row.pickup_lat),lon:Number(row.pickup_lon)},
    destination:{address:row.destination_address,lat:Number(row.destination_lat),lon:Number(row.destination_lon)},
    stops:await rideStops(db,row.id),passenger:{name:row.passenger_name,phone:row.passenger_phone},
    passengerType:row.passenger_type,driver:driver?driverView(driver):null,note:row.note||"",scheduledAt:row.scheduled_at||null,
    createdAt:row.created_at,acceptedAt:row.accepted_at||null,arrivedAt:row.arrived_at||null,startedAt:row.started_at||null,
    completedAt:row.completed_at||null,cancelledAt:row.cancelled_at||null,closedAt:row.closed_at||null,
    cancellationReason:row.cancellation_reason||"",cancellationNote:row.cancellation_note||"",cancelledBy:row.cancelled_by||""
  };
}
function dispatchRideView(row) {
  return {
    id:row.public_id,passenger:row.passenger_name,phone:row.passenger_phone,passengerType:row.passenger_type,
    pickup:row.pickup_address,destination:row.destination_address,
    driver:[row.driver_first,row.driver_last].filter(Boolean).join(" "),status:row.status,
    distanceKm:Number(row.distance_km||0),durationMin:Number(row.duration_min||0),priceDop:Number(row.price_dop||0),
    createdAt:row.created_at,scheduledAt:row.scheduled_at||null,closedAt:row.closed_at||null,
    cancellationReason:row.cancellation_reason||"",cancellationNote:row.cancellation_note||"",cancelledBy:row.cancelled_by||""
  };
}
async function nearestAvailableDriver(db,pickup) {
  const threshold=new Date(Date.now()-3*60000).toISOString();
  const {results}=await db.prepare(`SELECT d.* FROM drivers d WHERE d.status='active' AND d.is_online=1 AND d.last_seen_at>? AND d.current_lat IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rides r WHERE r.driver_id=d.id AND r.status IN ('accepted','driver_arriving','arrived','in_progress'))`).bind(threshold).all();
  return results.sort((a,b)=>haversine(pickup.lat,pickup.lon,a.current_lat,a.current_lon)-haversine(pickup.lat,pickup.lon,b.current_lat,b.current_lon))[0]||null;
}
async function acceptRide(db,driver,ride) {
  if(ride.status!=="pending") throw new HttpError(409,"Otro conductor ya tomó este servicio.");
  const active=await db.prepare(`SELECT public_id FROM rides WHERE driver_id=? AND status IN ('accepted','driver_arriving','arrived','in_progress') LIMIT 1`).bind(driver.id).first();
  if(active) throw new HttpError(409,"Termina tu servicio actual antes de aceptar otro.");
  if(ride.driver_id&&ride.driver_id!==driver.id) throw new HttpError(409,"Este servicio fue asignado a otro conductor.");
  const stamp=nowIso();
  const result=await db.prepare(`UPDATE rides SET driver_id=?,status='accepted',accepted_at=? WHERE id=? AND status='pending' AND (driver_id IS NULL OR driver_id=?)`).bind(driver.id,stamp,ride.id,driver.id).run();
  if(!result.meta.changes) throw new HttpError(409,"Otro conductor ya tomó este servicio.");
  await db.prepare(`UPDATE drivers SET is_available=0,is_online=1,updated_at=? WHERE id=?`).bind(stamp,driver.id).run();
  await notify(db,"ride_accepted","Servicio aceptado",`${driver.first_name} ${driver.last_name} aceptó ${ride.public_id}.`,"ride",ride.public_id);
  return json({ride:await driverRideView(db,await rideById(db,ride.id))});
}
async function updateRideStatus(db,driver,ride,action) {
  if(ride.driver_id!==driver.id) throw new HttpError(403,"Este servicio no pertenece a tu cuenta.");
  const stamp=nowIso(); let status,column;
  if(action==="arrived"&&["accepted","driver_arriving"].includes(ride.status)) { status="arrived"; column="arrived_at"; }
  else if(action==="start"&&ride.status==="arrived") { status="in_progress"; column="started_at"; }
  else if(action==="complete"&&ride.status==="in_progress") { status="completed"; column="completed_at"; }
  else throw new HttpError(409,"Ese cambio no corresponde al estado actual del servicio.");
  if(status==="completed") {
    await db.prepare(`UPDATE rides SET status='completed',completed_at=?,closed_at=? WHERE id=? AND status='in_progress'`).bind(stamp,stamp,ride.id).run();
    await db.prepare(`UPDATE drivers SET is_available=1,updated_at=? WHERE id=?`).bind(stamp,driver.id).run();
    await notify(db,"ride_completed","Servicio terminado",`${driver.first_name} ${driver.last_name} terminó ${ride.public_id}.`,"ride",ride.public_id);
  } else {
    await db.prepare(`UPDATE rides SET status=?,${column}=? WHERE id=?`).bind(status,stamp,ride.id).run();
    await notify(db,"ride_status","Servicio actualizado",`${ride.public_id}: ${status}.`,"ride",ride.public_id);
  }
  return json({ride:await driverRideView(db,await rideById(db,ride.id))});
}
async function cancelRide(db,ride,reason,note,cancelledBy) {
  const stamp=nowIso();
  const result=await db.prepare(`UPDATE rides SET status='cancelled',cancelled_at=?,closed_at=?,cancellation_reason=?,cancellation_note=?,cancelled_by=? WHERE id=? AND status IN ('pending','accepted','driver_arriving','arrived')`).bind(stamp,stamp,reason,note||null,cancelledBy,ride.id).run();
  if(!result.meta.changes) throw new HttpError(409,"El servicio ya no se puede cancelar.");
  if(ride.driver_id) {
    const other=await db.prepare(`SELECT id FROM rides WHERE driver_id=? AND id!=? AND status IN ('accepted','driver_arriving','arrived','in_progress')`).bind(ride.driver_id,ride.id).first();
    if(!other) await db.prepare(`UPDATE drivers SET is_available=1,updated_at=? WHERE id=?`).bind(stamp,ride.driver_id).run();
  }
  await notify(db,"cancellation","Servicio cancelado",`${ride.public_id}: ${reason}.`,"ride",ride.public_id);
}
async function connectedDriverView(db,row,onlineThreshold) {
  const active=await db.prepare(`SELECT * FROM rides WHERE driver_id=? AND status IN ('accepted','driver_arriving','arrived','in_progress') ORDER BY created_at LIMIT 1`).bind(row.id).first();
  const online=Boolean(row.is_online)&&row.last_seen_at&&row.last_seen_at>onlineThreshold;
  const connectionState=!online?"offline":active?"busy":"available";
  let etaToPickupMin=null;
  if(active&&Number.isFinite(Number(row.current_lat))&&Number.isFinite(Number(row.current_lon))) etaToPickupMin=Math.max(1,Math.round(haversine(row.current_lat,row.current_lon,active.pickup_lat,active.pickup_lon)/25*60));
  const selfie=await db.prepare(`SELECT id FROM driver_documents WHERE driver_id=? AND kind='selfie'`).bind(row.id).first();
  return {...driverView(row),connectionState,activeRideStatus:active?.status||null,activeRideId:active?.public_id||null,etaToPickupMin,profilePhotoUrl:selfie?documentUrl(row.public_id,"selfie"):null,location:Number.isFinite(Number(row.current_lat))?{lat:Number(row.current_lat),lon:Number(row.current_lon),bearing:Number(row.current_bearing||0),speedKph:Number(row.current_speed_kph||0),accuracyM:Number(row.current_accuracy||0),updatedAt:row.last_seen_at}:null};
}

async function addMessage(db,channel,driverId,rideId,sender,body,adminReadAt,driverReadAt,passengerReadAt) {
  const message=clean(body.message),photo=body.photo?String(body.photo):null;
  if(!message&&!photo) throw new HttpError(400,"Escribe un mensaje o selecciona una foto.");
  if(message.length>2000) throw new HttpError(400,"El mensaje es demasiado largo.");
  if(photo&&(!validDataUrl(photo)||photo.length>1450000)) throw new HttpError(413,"La foto debe pesar menos de 1 MB.");
  const stamp=nowIso();
  const result=await db.prepare(`INSERT INTO chat_messages(channel,driver_id,ride_id,sender,message,photo_data,created_at,admin_read_at,driver_read_at,passenger_read_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(channel,driverId||null,rideId||null,sender,message||null,photo,stamp,adminReadAt,driverReadAt,passengerReadAt).run();
  return result.meta.last_row_id;
}
async function postRideChat(request,db,driver,ride,sender,providedBody=null) {
  if(!ACTIVE_RIDE_STATUSES.includes(ride.status)||!ride.driver_id) throw new HttpError(403,"El chat del servicio ya no está disponible.");
  if(sender==="driver"&&ride.driver_id!==driver.id) throw new HttpError(403,"Este servicio pertenece a otro conductor.");
  const body=providedBody||await bodyJson(request);
  await addMessage(db,"ride",ride.driver_id,ride.id,sender,body,sender==="driver"?null:nowIso(),sender==="driver"?nowIso():null,sender==="passenger"?nowIso():null);
  return json({ok:true},201);
}
function messageView(row,driver=null) {
  return {
    id:row.id,sender:row.sender,message:row.message||"",messageType:row.photo_data?"photo":"text",
    photoUrl:row.photo_data?`/api/media/message/${row.id}`:null,createdAt:row.created_at,
    driverName:driver?`${driver.first_name} ${driver.last_name}`.trim():[row.driver_first,row.driver_last].filter(Boolean).join(" "),
    passengerName:row.passenger_name||"",driverReadAt:row.driver_read_at||null,
    adminReadAt:row.admin_read_at||null,passengerReadAt:row.passenger_read_at||null
  };
}
async function messagesFor(db,channel,driverId=null,rideId=null,recentOnly=false) {
  const values=[channel]; let where=`m.channel=?`;
  if(channel==="private") { where+=` AND m.driver_id=?`; values.push(driverId); }
  if(channel==="ride") { where+=` AND m.ride_id=?`; values.push(rideId); }
  if(recentOnly) { where+=` AND m.created_at>?`; values.push(new Date(Date.now()-24*3600000).toISOString()); }
  const {results}=await db.prepare(`SELECT m.*,d.first_name driver_first,d.last_name driver_last,r.passenger_name FROM chat_messages m LEFT JOIN drivers d ON d.id=m.driver_id LEFT JOIN rides r ON r.id=m.ride_id WHERE ${where} ORDER BY m.created_at ASC LIMIT 500`).bind(...values).all();
  return results.map((row)=>messageView(row));
}
async function conversationRows(db) {
  const {results}=await db.prepare(`SELECT m.*,d.public_id driver_public,d.first_name driver_first,d.last_name driver_last,d.phone driver_phone,r.public_id ride_public,r.passenger_name,r.passenger_phone FROM chat_messages m LEFT JOIN drivers d ON d.id=m.driver_id LEFT JOIN rides r ON r.id=m.ride_id ORDER BY m.created_at ASC`).all();
  return results;
}
function conversationKey(row) {
  if(row.channel==="public") return "public";
  if(row.channel==="private") return `driver:${row.driver_public||row.driver_id}`;
  return `ride:${row.ride_public||row.ride_id}`;
}
async function conversationHistory(db) {
  const rows=await conversationRows(db),groups=new Map();
  for(const row of rows) {
    const key=conversationKey(row);
    if(!groups.has(key)) {
      const type=row.channel==="public"?"public":row.channel==="private"?"driver":"ride";
      groups.set(key,{key,type,title:type==="public"?"Chat público":type==="driver"?[row.driver_first,row.driver_last].filter(Boolean).join(" "):`Servicio ${row.ride_public||""}`,subtitle:type==="public"?"Todos los conductores":type==="driver"?(row.driver_phone||""):`${row.passenger_name||"Pasajero"} · ${row.passenger_phone||""}`,latestAt:row.created_at,messageCount:0});
    }
    const item=groups.get(key); item.messageCount+=1; item.latestAt=row.created_at;
  }
  return [...groups.values()].sort((a,b)=>Date.parse(b.latestAt)-Date.parse(a.latestAt));
}
async function conversationMessages(db,key) {
  if(!key) throw new HttpError(400,"Selecciona una conversación.");
  const rows=await conversationRows(db); const selected=rows.filter((row)=>conversationKey(row)===key);
  if(!selected.length) throw new HttpError(404,"La conversación no existe.");
  const row=selected[0],type=row.channel==="public"?"public":row.channel==="private"?"driver":"ride";
  const title=type==="public"?"Chat público":type==="driver"?[row.driver_first,row.driver_last].filter(Boolean).join(" "):`Servicio ${row.ride_public||""}`;
  return {key,title,messages:selected.map((item)=>messageView(item))};
}
async function deleteConversation(db,key) {
  if(key==="public") { await db.prepare(`DELETE FROM chat_messages WHERE channel='public'`).run(); return; }
  if(key.startsWith("driver:")) {
    const driver=await db.prepare(`SELECT id FROM drivers WHERE public_id=? OR CAST(id AS TEXT)=?`).bind(key.slice(7),key.slice(7)).first();
    if(!driver) throw new HttpError(404,"La conversación no existe.");
    await db.prepare(`DELETE FROM chat_messages WHERE channel='private' AND driver_id=?`).bind(driver.id).run(); return;
  }
  if(key.startsWith("ride:")) {
    const ride=await db.prepare(`SELECT id FROM rides WHERE public_id=? OR CAST(id AS TEXT)=?`).bind(key.slice(5),key.slice(5)).first();
    if(!ride) throw new HttpError(404,"La conversación no existe.");
    await db.prepare(`DELETE FROM chat_messages WHERE channel='ride' AND ride_id=?`).bind(ride.id).run(); return;
  }
  throw new HttpError(400,"La conversación indicada no es válida.");
}
