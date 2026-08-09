const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[character]));

const ACTIVE_STATUSES = new Set(["pending", "accepted", "driver_arriving", "arrived", "in_progress"]);
const CLOSED_STATUSES = new Set(["cancelled", "completed"]);
const filterControls = {
  global: $("#history-search"),
  id: $("#history-id"),
  from: $("#history-from"),
  type: $("#history-type"),
  passenger: $("#history-passenger"),
  phone: $("#history-phone"),
  driver: $("#history-driver"),
  pickup: $("#history-pickup"),
  destination: $("#history-destination"),
  status: $("#history-status"),
  price: $("#history-price"),
  distance: $("#history-distance"),
  duration: $("#history-duration"),
  to: $("#history-to"),
  reason: $("#history-reason"),
  closedBy: $("#history-closed-by")
};

let databaseHistory = [];
let databaseActive = [];
let currentFilteredHistory = [];
let toastTimer;

function showToast(message) {
  const toast = $("#history-toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3400);
}

function openMenu() {
  const overlay = $("#drawer-overlay");
  overlay.hidden = false;
  requestAnimationFrame(() => {
    $("#side-menu").classList.add("open");
    $("#menu-button").classList.add("open");
  });
  $("#side-menu").setAttribute("aria-hidden", "false");
  $("#menu-button").setAttribute("aria-expanded", "true");
  document.body.classList.add("menu-open");
  $("#close-menu").focus();
}

function closeMenu() {
  $("#side-menu").classList.remove("open");
  $("#menu-button").classList.remove("open");
  $("#side-menu").setAttribute("aria-hidden", "true");
  $("#menu-button").setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
  setTimeout(() => { $("#drawer-overlay").hidden = true; }, 280);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No fue posible cargar el historial.");
  return data;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeType(value) {
  const type = normalizeText(value);
  return type === "registered" || type === "registrado" ? "registered" : "guest";
}

function cleanDriver(value) {
  const driver = String(value || "").trim();
  return normalizeText(driver).includes("pendiente de taxote driver") ? "" : driver;
}

function readLocalTrips() {
  try {
    const trips = JSON.parse(localStorage.getItem("taxote-trips-v2") || "[]");
    return Array.isArray(trips) ? trips : [];
  } catch {
    return [];
  }
}

function normalizeLocalTrip(trip) {
  const route = Array.isArray(trip.route) ? trip.route : [];
  const status = trip.status || "pending";
  return {
    id: trip.id || "",
    passenger: trip.passenger || "",
    phone: trip.phone || "",
    passengerType: normalizeType(trip.passengerType || trip.service),
    pickup: trip.pickup || route[0] || "",
    destination: trip.destination || route[route.length - 1] || "",
    driver: cleanDriver(trip.driver),
    status,
    distanceKm: Number(trip.distanceKm || 0),
    durationMin: Number(trip.durationMin || 0),
    priceDop: Number(trip.priceDop || 0),
    createdAt: trip.createdAt || "",
    closedAt: status === "completed"
      ? (trip.completedAt || trip.closedAt || trip.createdAt || "")
      : (trip.cancelledAt || trip.closedAt || trip.createdAt || ""),
    cancellationReason: trip.cancellationReason || "",
    cancellationNote: trip.cancellationNote || "",
    cancelledBy: trip.cancelledBy || ""
  };
}

function normalizeDatabaseTrip(trip) {
  return {
    ...trip,
    id: trip.id || "",
    passenger: trip.passenger || "",
    phone: trip.phone || "",
    passengerType: normalizeType(trip.passengerType),
    pickup: trip.pickup || "",
    destination: trip.destination || "",
    driver: cleanDriver(trip.driver),
    distanceKm: Number(trip.distanceKm || 0),
    durationMin: Number(trip.durationMin || 0),
    priceDop: Number(trip.priceDop || 0),
    cancellationReason: trip.cancellationReason || "",
    cancellationNote: trip.cancellationNote || "",
    cancelledBy: trip.cancelledBy || ""
  };
}

function uniqueTrips(trips) {
  const seen = new Set();
  return trips.filter((trip) => trip.id && !seen.has(trip.id) && seen.add(trip.id));
}

function allHistoryTrips() {
  const localClosed = readLocalTrips().map(normalizeLocalTrip).filter((trip) => CLOSED_STATUSES.has(trip.status));
  return uniqueTrips([...databaseHistory.map(normalizeDatabaseTrip), ...localClosed])
    .sort((first, second) => new Date(second.closedAt || second.createdAt).getTime() - new Date(first.closedAt || first.createdAt).getTime());
}

function allActiveTrips() {
  const localActive = readLocalTrips().map(normalizeLocalTrip).filter((trip) => ACTIVE_STATUSES.has(trip.status));
  return uniqueTrips([...databaseActive.map(normalizeDatabaseTrip), ...localActive]);
}

function effectiveClosedBy(trip) {
  return trip.status === "completed" ? "driver" : (trip.cancelledBy || "dispatcher");
}

function closedByLabel(value) {
  return ({ dispatcher: "Central TAXOTE", passenger: "Pasajero", driver: "Conductor" })[value] || "Central TAXOTE";
}

function statusLabel(status) {
  return status === "completed" ? "Terminado" : "Cancelado";
}

function typeLabel(type) {
  return normalizeType(type) === "registered" ? "Registrado" : "Invitado";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = date.toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" });
  return `${day}<span class="history-cell-detail">${time}</span>`;
}

function formatPrice(value) {
  const price = Number(value || 0);
  return price > 0 ? new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP", maximumFractionDigits: 0 }).format(price) : "—";
}

function dateAtStart(value) {
  return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

function dateAtEnd(value) {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : null;
}

function tripMatchesFilters(trip) {
  const values = Object.fromEntries(Object.entries(filterControls).map(([key, control]) => [key, control.value]));
  const global = normalizeText(values.global);
  const globalDigits = onlyDigits(values.global);
  const searchable = normalizeText([
    trip.id, trip.passenger, trip.phone, trip.driver, trip.pickup, trip.destination,
    statusLabel(trip.status), typeLabel(trip.passengerType), trip.cancellationReason,
    trip.cancellationNote, closedByLabel(effectiveClosedBy(trip))
  ].join(" "));

  if (global && !searchable.includes(global) && (!globalDigits || !onlyDigits(trip.phone).includes(globalDigits))) return false;
  if (normalizeText(values.id) && !normalizeText(trip.id).includes(normalizeText(values.id))) return false;
  if (values.type && normalizeType(trip.passengerType) !== values.type) return false;
  if (normalizeText(values.passenger) && !normalizeText(trip.passenger).includes(normalizeText(values.passenger))) return false;
  if (onlyDigits(values.phone) && !onlyDigits(trip.phone).includes(onlyDigits(values.phone))) return false;
  if (normalizeText(values.driver) && !normalizeText(trip.driver).includes(normalizeText(values.driver))) return false;
  if (normalizeText(values.pickup) && !normalizeText(trip.pickup).includes(normalizeText(values.pickup))) return false;
  if (normalizeText(values.destination) && !normalizeText(trip.destination).includes(normalizeText(values.destination))) return false;
  if (values.status && trip.status !== values.status) return false;
  if (values.price !== "" && Number(trip.priceDop || 0) < Number(values.price)) return false;
  if (values.distance !== "" && Number(trip.distanceKm || 0) > Number(values.distance)) return false;
  if (values.duration !== "" && Number(trip.durationMin || 0) > Number(values.duration)) return false;
  if (normalizeText(values.reason) && !normalizeText(`${trip.cancellationReason} ${trip.cancellationNote} ${trip.status === "completed" ? "servicio terminado" : ""}`).includes(normalizeText(values.reason))) return false;
  if (values.closedBy && effectiveClosedBy(trip) !== values.closedBy) return false;

  const createdTime = new Date(trip.createdAt).getTime();
  const closedTime = new Date(trip.closedAt || trip.createdAt).getTime();
  const fromTime = dateAtStart(values.from);
  const toTime = dateAtEnd(values.to);
  if (fromTime !== null && (Number.isNaN(createdTime) || createdTime < fromTime)) return false;
  if (toTime !== null && (Number.isNaN(closedTime) || closedTime > toTime)) return false;
  return true;
}

function resultMarkup(trip) {
  const completed = trip.status === "completed";
  const outcome = completed ? "Servicio terminado" : (trip.cancellationReason || "Cancelación sin motivo registrado");
  const note = trip.cancellationNote ? `<span class="history-note">${escapeHtml(trip.cancellationNote)}</span>` : "";
  return `<tr>
    <td><span class="history-trip-id">${escapeHtml(trip.id)}</span><small class="history-cell-detail">TAXOTE</small></td>
    <td>${formatDate(trip.createdAt)}</td>
    <td>${escapeHtml(typeLabel(trip.passengerType))}</td>
    <td>${escapeHtml(trip.passenger || "—")}</td>
    <td>${escapeHtml(trip.phone || "—")}</td>
    <td>${escapeHtml(trip.driver || "—")}</td>
    <td>${escapeHtml(trip.pickup || "—")}</td>
    <td>${escapeHtml(trip.destination || "—")}</td>
    <td><span class="history-status ${trip.status}">${statusLabel(trip.status)}</span></td>
    <td><span class="history-price">${formatPrice(trip.priceDop)}</span></td>
    <td><span class="history-metric">${Number(trip.distanceKm || 0) > 0 ? `${Number(trip.distanceKm).toFixed(1)} km` : "—"}</span></td>
    <td><span class="history-metric">${Number(trip.durationMin || 0) > 0 ? `${Math.round(Number(trip.durationMin))} min` : "—"}</span></td>
    <td>${formatDate(trip.closedAt || trip.createdAt)}</td>
    <td><span class="history-reason">${escapeHtml(outcome)}</span>${note}</td>
    <td>${escapeHtml(closedByLabel(effectiveClosedBy(trip)))}</td>
  </tr>`;
}

function sameLocalDay(value, comparison = new Date()) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toDateString() === comparison.toDateString();
}

function syncFilterAppearance() {
  Object.values(filterControls).forEach((control) => control.classList.toggle("filter-active", control.value !== ""));
}

function renderHistory() {
  const history = allHistoryTrips();
  currentFilteredHistory = history.filter(tripMatchesFilters);
  $("#history-completed").textContent = history.filter((trip) => trip.status === "completed").length;
  $("#history-active").textContent = allActiveTrips().length;
  $("#history-today").textContent = history.filter((trip) => sameLocalDay(trip.closedAt || trip.createdAt)).length;
  $("#history-cancelled").textContent = history.filter((trip) => trip.status === "cancelled").length;
  $("#history-total").textContent = history.length;
  $("#history-result-count").textContent = `${currentFilteredHistory.length} ${currentFilteredHistory.length === 1 ? "resultado" : "resultados"}`;
  $("#history-table-body").innerHTML = currentFilteredHistory.length
    ? currentFilteredHistory.map(resultMarkup).join("")
    : '<tr><td colspan="15" class="history-empty">No hay viajes cerrados que coincidan con los filtros.</td></tr>';
  syncFilterAppearance();
}

async function loadHistory(announce = false) {
  const refreshButton = $("#refresh-history");
  refreshButton.disabled = true;
  try {
    if (location.protocol !== "file:") {
      [databaseHistory, databaseActive] = await Promise.all([
        fetchJson("/api/dispatch/rides/history"),
        fetchJson("/api/dispatch/rides")
      ]);
    }
    renderHistory();
    if (announce) showToast("Historial actualizado.");
  } catch (error) {
    renderHistory();
    showToast(error.message);
  } finally {
    refreshButton.disabled = false;
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCurrentHistory() {
  if (!currentFilteredHistory.length) return showToast("No hay resultados para exportar.");
  const headers = ["ID", "Fecha del viaje", "Tipo", "Pasajero", "Teléfono", "Conductor", "Dirección de recogida", "Dirección de destino", "Estado", "Precio DOP", "Distancia km", "Duración min", "Fecha de cierre", "Motivo o resultado", "Nota", "Cerrado por"];
  const rows = currentFilteredHistory.map((trip) => [
    trip.id,
    trip.createdAt,
    typeLabel(trip.passengerType),
    trip.passenger,
    trip.phone,
    trip.driver,
    trip.pickup,
    trip.destination,
    statusLabel(trip.status),
    Number(trip.priceDop || 0),
    Number(trip.distanceKm || 0),
    Number(trip.durationMin || 0),
    trip.closedAt || trip.createdAt,
    trip.status === "completed" ? "Servicio terminado" : trip.cancellationReason,
    trip.cancellationNote,
    closedByLabel(effectiveClosedBy(trip))
  ]);
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `taxote-historial-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`${currentFilteredHistory.length} viajes exportados.`);
}

$("#menu-button")?.addEventListener("click", () => {
    if($("#side-menu")?.classList.contains("open")) closeMenu();
    else openMenu();
});
$("#close-menu").addEventListener("click", closeMenu);
$("#drawer-overlay").addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#side-menu").classList.contains("open")) closeMenu();
});

Object.values(filterControls).forEach((control) => {
  control.addEventListener(control.tagName === "SELECT" ? "change" : "input", renderHistory);
});

$("#clear-history-filters").addEventListener("click", () => {
  Object.values(filterControls).forEach((control) => { control.value = ""; });
  renderHistory();
  filterControls.global.focus();
});
$("#refresh-history").addEventListener("click", () => loadHistory(true));
$("#export-history").addEventListener("click", exportCurrentHistory);

renderHistory();
loadHistory();
setInterval(loadHistory, 15000);
