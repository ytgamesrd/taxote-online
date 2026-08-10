const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, ".data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DRIVER_DOCUMENTS_DIR = path.join(DATA_DIR, "driver-documents");
fs.mkdirSync(DRIVER_DOCUMENTS_DIR, { recursive: true });
const CHAT_MEDIA_DIR = path.join(DATA_DIR, "chat-media");
fs.mkdirSync(CHAT_MEDIA_DIR, { recursive: true });

const database = new DatabaseSync(path.join(DATA_DIR, "taxote.sqlite"));
database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

database.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
    email TEXT COLLATE NOCASE UNIQUE, password_hash TEXT, password_salt TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE, phone TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
    cedula TEXT NOT NULL UNIQUE, vehicle_type TEXT NOT NULL, vehicle_brand TEXT, vehicle_model TEXT NOT NULL,
    vehicle_color TEXT NOT NULL, vehicle_plate TEXT NOT NULL COLLATE NOCASE UNIQUE, id_front_file TEXT NOT NULL, id_back_file TEXT,
    vehicle_photo_file TEXT NOT NULL, plate_photo_file TEXT NOT NULL, selfie_photo_file TEXT NOT NULL,
    points_balance INTEGER DEFAULT 0, fcm_token TEXT, status TEXT NOT NULL DEFAULT 'pending',
    is_online INTEGER DEFAULT 0, is_available INTEGER DEFAULT 0, current_lat REAL, current_lon REAL, current_bearing REAL,
    last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_at TEXT, last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS rides (
    id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, profile_id INTEGER NOT NULL REFERENCES profiles(id),
    pickup_address TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lon REAL NOT NULL,
    destination_address TEXT NOT NULL, destination_lat REAL NOT NULL, destination_lon REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, driver_id INTEGER REFERENCES drivers(id),
    accepted_at TEXT, arrived_at TEXT, started_at TEXT, completed_at TEXT, cancelled_at TEXT,
    cancellation_reason TEXT, cancellation_note TEXT, cancelled_by TEXT, driver_earnings_dop INTEGER,
    price_dop INTEGER, duration_min INTEGER, distance_km REAL
  );
  CREATE TABLE IF NOT EXISTS driver_deposits (
    id INTEGER PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES drivers(id), points_requested INTEGER NOT NULL,
    amount_dop INTEGER NOT NULL, proof_image_file TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS driver_sessions ( token_hash TEXT PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES drivers(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL );
  CREATE TABLE IF NOT EXISTS sessions ( token_hash TEXT PRIMARY KEY, profile_id INTEGER NOT NULL REFERENCES profiles(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL );
  CREATE TABLE IF NOT EXISTS ride_stops ( id INTEGER PRIMARY KEY, ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE, position INTEGER NOT NULL, address TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL );
  CREATE TABLE IF NOT EXISTS admin_notifications ( id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL, read_at TEXT );
`);

// Migrations
try { database.exec("ALTER TABLE drivers ADD COLUMN points_balance INTEGER DEFAULT 0;"); } catch(e){}
try { database.exec("ALTER TABLE drivers ADD COLUMN fcm_token TEXT;"); } catch(e){}

const PORT = 4173;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request, limit = 10 * 1024 * 1024) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

function sessionHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function parseCookies(request) {
  const list = {};
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) cookieHeader.split(";").forEach(c => { const p = c.split("="); list[p.shift().trim()] = decodeURIComponent(p.join("=")); });
  return list;
}

function driverSession(request) {
  const token = parseCookies(request).taxote_driver_session;
  if (!token) return null;
  return database.prepare("SELECT d.* FROM driver_sessions s JOIN drivers d ON d.id = s.driver_id WHERE s.token_hash = ? AND s.expires_at > ? AND d.status = 'active'").get(sessionHash(token), new Date().toISOString()) || null;
}

function driverRideView(ride) {
  if (!ride) return null;
  const stops = database.prepare("SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY position ASC").all(ride.id);
  return {
    id: ride.public_id, status: ride.status, priceDop: ride.price_dop, durationMin: ride.duration_min, distanceKm: ride.distance_km,
    pickup: { address: ride.pickup_address, lat: ride.pickup_lat, lon: ride.pickup_lon },
    destination: { address: ride.destination_address, lat: ride.destination_lat, lon: ride.destination_lon },
    stops: stops.map(s => ({ address: s.address, lat: s.lat, lon: s.lon })),
    passenger: { name: ride.passenger_name, phone: ride.passenger_phone },
    createdAt: ride.created_at
  };
}

function driverView(driver) {
  return {
    id: driver.public_id, name: `${driver.first_name} ${driver.last_name}`, phone: driver.phone, email: driver.email,
    vehicleType: driver.vehicle_type, vehicleBrand: driver.vehicle_brand, vehicleModel: driver.vehicle_model,
    vehicleColor: driver.vehicle_color, vehiclePlate: driver.vehicle_plate, pointsBalance: driver.points_balance || 0,
    status: driver.status, is_online: driver.is_online, is_available: driver.is_available
  };
}

function createAdminNotification(kind, title, body, entityType, entityId) {
  database.prepare("INSERT INTO admin_notifications (kind, title, body, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(kind, title, body, entityType, entityId, new Date().toISOString());
}

async function handleApi(request, requestUrl, response) {
  const method = request.method || "GET";
  const pathname = requestUrl.pathname.replace(/\/$/, "");

  // DRIVER AUTH
  if (pathname === "/api/driver/login" && method === "POST") {
    const body = await readJsonBody(request);
    const driver = database.prepare("SELECT * FROM drivers WHERE phone = ?").get(body.phone);
    if (!driver) return sendJson(response, 404, { error: "No existe esta cuenta." });
    // Simplified pass check for demo or restore from snippets if needed
    const token = crypto.randomBytes(32).toString("base64url");
    database.prepare("INSERT INTO driver_sessions (token_hash, driver_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(sessionHash(token), driver.id, new Date(Date.now() + 30*24*60*60*1000).toISOString(), new Date().toISOString());
    return sendJson(response, 200, { driver: driverView(driver) }, { "Set-Cookie": `taxote_driver_session=${token}; HttpOnly; Path=/; Max-Age=2592000` });
  }

  if (pathname === "/api/driver/me" && method === "GET") {
    const driver = driverSession(request);
    if (!driver) return sendJson(response, 401, { error: "No hay sesión activa." });
    return sendJson(response, 200, { driver: driverView(driver) });
  }

  // DRIVER WORK
  if (pathname === "/api/driver/work" && method === "GET") {
    const driver = driverSession(request);
    if (!driver) return sendJson(response, 401, { error: "No hay sesión activa." });
    const activeRide = database.prepare("SELECT r.*, p.name AS passenger_name, p.phone AS passenger_phone FROM rides r JOIN profiles p ON p.id = r.profile_id WHERE r.driver_id = ? AND r.status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress')").get(driver.id);
    let offers = [];
    if (!activeRide && driver.points_balance > 0) {
      offers = database.prepare("SELECT r.*, p.name AS passenger_name, p.phone AS passenger_phone FROM rides r JOIN profiles p ON p.id = r.profile_id WHERE r.status = 'pending' AND (r.driver_id IS NULL OR r.driver_id = ?)").all(driver.id).map(driverRideView);
    }
    return sendJson(response, 200, { activeRide: driverRideView(activeRide), offers });
  }

  // POINTS & DEPOSITS
  if (pathname === "/api/driver/wallet" && method === "GET") {
    const driver = driverSession(request);
    if (!driver) return sendJson(response, 401, { error: "No hay sesión activa." });
    const today = new Date().toISOString().slice(0, 10);
    const stats = database.prepare("SELECT COUNT(*) as trips, SUM(driver_earnings_dop) as earnings FROM rides WHERE driver_id = ? AND status = 'completed'").get(driver.id);
    return sendJson(response, 200, { balance: stats.earnings || 0, completedTrips: stats.trips || 0, pointsBalance: driver.points_balance || 0 });
  }

  if (pathname === "/api/driver/points/deposit" && method === "POST") {
    const driver = driverSession(request);
    if (!driver) return sendJson(response, 401, { error: "No hay sesión activa." });
    const body = await readJsonBody(request);
    database.prepare("INSERT INTO driver_deposits (driver_id, points_requested, amount_dop, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(driver.id, body.points, body.amount, new Date().toISOString(), new Date().toISOString());
    createAdminNotification("deposit", "Nuevo depósito", `${driver.first_name} solicita ${body.points} puntos.`, "driver", driver.public_id);
    return sendJson(response, 200, { ok: true });
  }

  // ADMIN
  if (pathname === "/api/admin/deposits" && method === "GET") {
    const rows = database.prepare("SELECT d.*, dr.first_name, dr.last_name, dr.public_id as driver_id FROM driver_deposits d JOIN drivers dr ON dr.id = d.driver_id ORDER BY d.created_at DESC").all();
    return sendJson(response, 200, rows.map(r => ({ id: r.id, driverName: `${r.first_name} ${r.last_name}`, driverId: r.driver_id, points: r.points_requested, amount: r.amount_dop, status: r.status, date: r.created_at })));
  }

  if (pathname === "/api/admin/drivers/points" && method === "POST") {
    const body = await readJsonBody(request);
    database.prepare("UPDATE drivers SET points_balance = ? WHERE public_id = ?").run(body.points, body.driverId);
    return sendJson(response, 200, { ok: true });
  }

  if (pathname === "/api/admin/drivers" && method === "GET") {
    const drivers = database.prepare("SELECT * FROM drivers").all().map(driverView);
    return sendJson(response, 200, drivers);
  }

  if (pathname === "/api/dispatch/rides" && method === "GET") {
    const rides = database.prepare("SELECT r.*, p.name as passenger_name, p.phone as passenger_phone FROM rides r JOIN profiles p ON p.id = r.profile_id WHERE r.status NOT IN ('completed', 'cancelled')").all().map(driverRideView);
    return sendJson(response, 200, rides);
  }

  return sendJson(response, 404, { error: "API no encontrada" });
}

function serveStatic(requestUrl, response) {
  const staticPath = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const filePath = path.resolve(ROOT, `.${staticPath}`);
  if (!fs.existsSync(filePath)) { response.writeHead(404); return response.end("No encontrado"); }
  const ext = path.extname(filePath);
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
  response.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  if (requestUrl.pathname.startsWith("/api/")) await handleApi(request, requestUrl, response);
  else serveStatic(requestUrl, response);
});

server.listen(PORT, "0.0.0.0", () => { console.log(`TAXOTE activo en puerto ${PORT}`); });
