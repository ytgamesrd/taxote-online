// Esta lista se sincroniza con las cuentas creadas en TAXOTE User.
let registeredClients = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

const toast = $("#toast");
const pickupInput = $("#pickup");
const destinationInput = $("#destination");
const routeNotice = $("#route-notice");
const bookingForm = $("#booking-form");
const menuButton = $("#menu-button");
const closeMenuButton = $("#close-menu");
const sideMenu = $("#side-menu");
const drawerOverlay = $("#drawer-overlay");
const serviceType = $("#service-type");
const travelTime = $("#travel-time");
const scheduleFields = $("#schedule-fields");
const scheduleDate = $("#schedule-date");
const scheduleTime = $("#schedule-time");
const customerInput = $("#customer");
const customerResults = $("#customer-results");
const selectedCustomerCard = $("#selected-customer");
const guestFields = $("#guest-fields");
const addressProviderStatus = $("#address-provider-status");
const driverAssignInput = $("#driver-assign-id");
const bookingConfirmationModal = $("#booking-confirmation-modal");
const bookingConfirmationPickup = $("#booking-confirmation-pickup");
const bookingConfirmationDestination = $("#booking-confirmation-destination");
const bookingConfirmationStops = $("#booking-confirmation-stops");
const bookingConfirmationDriver = $("#booking-confirmation-driver");
const bookingConfirmationTime = $("#booking-confirmation-time");
const bookingConfirmationPrice = $("#booking-confirmation-price");
const bookingConfirmationCustomer = $("#booking-confirmation-customer");
const bookingConfirmationPassengers = $("#booking-confirmation-passengers");
const bookingConfirmationPayment = $("#booking-confirmation-payment");
const bookingConfirmationNote = $("#booking-confirmation-note");
const bookingConfirmationConfirmButton = $("#confirm-booking");
const bookingConfirmationCancelButton = $("#cancel-booking");
const bookingConfirmationClose = $("#close-booking-confirmation");

let toastTimeout;
let stopCount = 0;
let routeRequestId = 0;
let selectedCustomer = null;
let activeMapSelection = "pickup";
let selectedDriverId = "";
let pendingBookingConfirmation = null;
let map;
let routeLayer;
let markerLayer;
let driverLocationLayer;
const driverLocationMarkers = new Map();
let dispatchTrips = [];
const selectedLocations = { pickup: null, destination: null };
const routeStops = [];

const notificationSound = new Audio('/mp3/clipmouse.mp3');

function playCancelSound() {
  notificationSound.currentTime = 0;
  notificationSound.play().catch(e => console.error("Audio error:", e));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3400);
}

function formatPriceDop(amount) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP", maximumFractionDigits: 0 }).format(amount || 0);
}

function renderDriverAssignOptions() {
  if (!driverAssignInput) return;
  driverAssignInput.value = selectedDriverId || "";
  updateAssignedDriverSummary();
}

function updateAssignedDriverSummary() {
  const summary = $("#driver-assigned-summary");
  if (!summary) return;
  const driver = connectedDrivers.find((item) => item.id === selectedDriverId);
  summary.textContent = driver
    ? `${driver.name} · ${driver.vehicleBrand} ${driver.vehicleModel} · ${driver.connectionState === "busy" ? "Ocupado" : "Disponible"}`
    : "Sin conductor asignado";
}

function closeBookingConfirmationModal() {
  if (!bookingConfirmationModal) return;
  bookingConfirmationModal.hidden = true;
  document.body.classList.remove("dispatch-modal-open");
  pendingBookingConfirmation = null;
}

function openBookingConfirmationModal(details) {
  if (!bookingConfirmationModal) return;
  const selectedDriver = details.driverId ? connectedDrivers.find((driver) => driver.id === details.driverId) : null;
  bookingConfirmationPickup.textContent = details.pickup.address;
  bookingConfirmationDestination.textContent = details.destination.address;
  bookingConfirmationStops.innerHTML = details.stops.length
    ? details.stops.map((stop) => `<li>${escapeHtml(stop.address)}</li>`).join("")
    : "<li>Sin paradas intermedias.</li>";
  bookingConfirmationDriver.textContent = selectedDriver
    ? `${selectedDriver.name} · ${driverStatusLabel(selectedDriver)}`
    : "Sin conductor asignado";
  bookingConfirmationTime.textContent = details.travelTime;
  bookingConfirmationPassengers.textContent = details.passengerInfo;
  bookingConfirmationPayment.textContent = details.paymentInfo || "No especificado";
  bookingConfirmationPrice.textContent = `${details.distanceKm.toFixed(1)} km · ${details.durationMin} min · ${formatPriceDop(details.priceDop)}`;
  bookingConfirmationCustomer.textContent = `${details.customerName} · ${details.customerPhone}`;
  bookingConfirmationNote.textContent = details.note || "Sin nota";
  pendingBookingConfirmation = details;
  bookingConfirmationConfirmButton.disabled = false;
  bookingConfirmationConfirmButton.innerHTML = "<span>✓</span> CONFIRMAR RESERVA";
  bookingConfirmationModal.hidden = false;
  document.body.classList.add("dispatch-modal-open");
}

function clearBookingForm() {
  selectedCustomer = null;
  selectedDriverId = "";
  if (driverAssignInput) driverAssignInput.value = "";
  updateAssignedDriverSummary();
  $("#registered-history-search").disabled = true;
  selectedCustomerCard.hidden = true;
  customerResults.hidden = true;
  selectedLocations.pickup = null;
  selectedLocations.destination = null;
  setMapSelection("pickup");
  routeStops.splice(0).forEach((stop) => stop.row?.remove());
  stopCount = 0;
  renderSelectionMarkers();
  calculateRoadRoute();
  toggleServiceFields();
}

async function submitConfirmedBooking() {
  if (!pendingBookingConfirmation) return;
  const confirmButton = bookingConfirmationConfirmButton;
  confirmButton.disabled = true;
  confirmButton.innerHTML = "GUARDANDO…";
  try {
    const data = await fetchJson("/api/rides", {
      method: "POST",
      body: {
        phone: pendingBookingConfirmation.phone,
        name: pendingBookingConfirmation.name,
        pickup: pendingBookingConfirmation.pickup,
        destination: pendingBookingConfirmation.destination,
        stops: pendingBookingConfirmation.stops,
        driverId: pendingBookingConfirmation.driverId || undefined,
        note: pendingBookingConfirmation.note || undefined,
        scheduledAt: pendingBookingConfirmation.scheduledAt || undefined,
        passengerCount: pendingBookingConfirmation.passengerCount || 1,
        paymentMethod: pendingBookingConfirmation.paymentInfo || undefined
      }
    });
    closeBookingConfirmationModal();
    clearBookingForm();
    await loadDispatchTrips();
    showToast(`Tx-${data.ride.id} creado correctamente.`);
  } catch (error) {
    showToast(error.message);
    confirmButton.disabled = false;
    confirmButton.innerHTML = "<span>✓</span> CONFIRMAR RESERVA";
  }
}

function openMenu() {
  drawerOverlay.hidden = false;
  sideMenu.classList.add("open");
  menuButton.classList.add("open");
}

function closeMenu() {
  sideMenu.classList.remove("open");
  menuButton.classList.remove("open");
  setTimeout(() => { drawerOverlay.hidden = true; }, 300);
}

menuButton?.addEventListener("click", () => sideMenu.classList.contains("open") ? closeMenu() : openMenu());
closeMenuButton?.addEventListener("click", closeMenu);
drawerOverlay?.addEventListener("click", closeMenu);

function renderCustomerResults(query = "") {
  const normalized = query.trim().toLocaleLowerCase("es");
  const matches = registeredClients.filter((client) => `${client.name} ${client.phone}`.toLocaleLowerCase("es").includes(normalized)).slice(0, 6);
  if (!registeredClients.length || (!matches.length && !normalized)) {
    customerResults.hidden = true;
    return;
  }
  customerResults.innerHTML = matches.map((client) => `
    <button class="customer-option" type="button" data-client-id="${client.id}">
      <span><b>${escapeHtml(client.name)}</b><small>${escapeHtml(client.phone)}</small></span>
    </button>`).join("");
  customerResults.hidden = false;
  $$('.customer-option').forEach((button) => button.addEventListener("click", () => selectCustomer(button.dataset.clientId)));
}

function selectCustomer(clientId) {
  selectedCustomer = registeredClients.find((client) => client.id === clientId) || null;
  if (!selectedCustomer) return;
  customerInput.value = selectedCustomer.name;
  customerResults.hidden = true;
  selectedCustomerCard.innerHTML = `<b>${escapeHtml(selectedCustomer.name)}</b> <span>· ${escapeHtml(selectedCustomer.phone)}</span>`;
  selectedCustomerCard.hidden = false;
  $("#registered-history-search").disabled = false;
}

customerInput?.addEventListener("input", () => {
    selectedCustomer = null;
    $("#registered-history-search").disabled = true;
    selectedCustomerCard.hidden = true;
    renderCustomerResults(customerInput.value);
});

function toggleServiceFields() {
  const isGuest = serviceType.value === "Invitado";
  $(".customer-picker-wrap").hidden = isGuest;
  guestFields.hidden = !isGuest;
}

serviceType?.addEventListener("change", toggleServiceFields);

async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch { throw new Error("Error de conexión."); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Error (${response.status})`);
  return body;
}

async function loadRegisteredClients() {
  try { registeredClients = await fetchJson("/api/dispatch/clients"); } catch { registeredClients = []; }
}
loadRegisteredClients();

function markerIcon(kind, stopNumber = 0) {
  const label = kind === "stop" ? `C${stopNumber}` : (kind === "destination" ? "B" : "A");
  return L.divIcon({
    className: "taxote-div-icon",
    html: `<div class="taxote-marker ${kind}"><span>${label}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30]
  });
}

function initializeMap() {
  if (!window.L) return;
  map = L.map("live-map").setView([18.505, -69.94], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  driverLocationLayer = L.layerGroup().addTo(map);
  map.on("click", (event) => {
    const kind = !selectedLocations.pickup ? "pickup" : (!selectedLocations.destination ? "destination" : null);
    if (kind) setPointFromMap(kind, event.latlng);
  });
}
initializeMap();

async function reverseGeocode(lat, lon) {
  const result = await fetchJson(`/api/reverse?lat=${lat}&lon=${lon}`);
  return { address: result.display_name, lat: Number(result.lat), lon: Number(result.lon) };
}

async function setPointFromMap(kind, latlng) {
  try {
    const resolved = await reverseGeocode(latlng.lat, latlng.lng);
    selectedLocations[kind] = resolved;
    if (kind === "pickup") pickupInput.value = resolved.address;
    else destinationInput.value = resolved.address;
    renderSelectionMarkers();
    calculateRoadRoute();
  } catch (e) { showToast(e.message); }
}

function renderSelectionMarkers() {
  markerLayer.clearLayers();
  if (selectedLocations.pickup) L.marker([selectedLocations.pickup.lat, selectedLocations.pickup.lon], { icon: markerIcon("pickup") }).addTo(markerLayer);
  if (selectedLocations.destination) L.marker([selectedLocations.destination.lat, selectedLocations.destination.lon], { icon: markerIcon("destination") }).addTo(markerLayer);
}

async function calculateRoadRoute() {
  if (!selectedLocations.pickup || !selectedLocations.destination) return;
  const coords = `${selectedLocations.pickup.lon},${selectedLocations.pickup.lat};${selectedLocations.destination.lon},${selectedLocations.destination.lat}`;
  try {
    const data = await fetchJson(`/api/route?coordinates=${coords}`);
    routeLayer.clearLayers();
    if (data.routes?.length) {
      const latLngs = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      L.polyline(latLngs, { color: "#0b2e47", weight: 6 }).addTo(routeLayer);
      routeNotice.textContent = `Ruta lista: ${(data.routes[0].distance/1000).toFixed(1)} km`;
    }
  } catch {}
}

const statusLabels = { pending: "Pendiente", accepted: "Aceptado", driver_arriving: "En camino", arrived: "Llegó", in_progress: "En viaje", completed: "Terminado", cancelled: "Cancelado" };

function tripRowMarkup(trip) {
  return `<tr>
    <td style="display:flex;gap:5px;justify-content:center;">
        <button class="eye-btn" onclick="viewTripDetails('${trip.id}')" title="Ver detalles">👁</button>
        <button class="call-btn" onclick="markTripContacted('${trip.id}')" title="Contactado">📞</button>
    </td>
    <td>${escapeHtml(trip.id)}</td>
    <td><span class="status-chip status-${trip.status}">${statusLabels[trip.status] || trip.status}</span></td>
    <td>${escapeHtml(trip.passenger)}</td>
    <td>${escapeHtml(trip.phone)}</td>
    <td>${escapeHtml(trip.driver)}</td>
    <td>${trip.contactedAt ? "✓" : "—"}</td>
    <td><span class="trip-address">${escapeHtml(trip.pickup)}</span></td>
    <td><span class="trip-address">${escapeHtml(trip.destination)}</span></td>
    <td>${new Date(trip.createdAt).toLocaleTimeString("es-DO", {hour:'2-digit', minute:'2-digit'})}</td>
  </tr>`;
}

async function loadDispatchTrips() {
  try {
    const rides = await fetchJson("/api/dispatch/rides");
    dispatchTrips = rides;
    $("#trip-table-body").innerHTML = rides.length ? rides.map(tripRowMarkup).join("") : '<tr><td colspan="10" style="text-align:center;padding:20px;color:#888;">No hay servicios activos.</td></tr>';
    $("#current-trip-count").textContent = rides.length;
  } catch {}
}
loadDispatchTrips();
setInterval(loadDispatchTrips, 10000);

let connectedDrivers = [];
async function loadConnectedDrivers() {
  try {
    const drivers = await fetchJson("/api/admin/driver-locations");
    connectedDrivers = drivers;
    renderDriverLocations(drivers);
    $("#connected-drivers-list").innerHTML = drivers.length ? drivers.map(d => `
      <article class="driver ${d.connectionState === 'busy' ? 'busy' : ''}" onclick="focusDriverOnMap('${d.id}')">
        <b>${escapeHtml(d.name)}</b><br><small>${escapeHtml(d.vehiclePlate)} · ${d.connectionState === 'busy' ? 'Ocupado' : 'Disponible'}</small>
      </article>
    `).join("") : '<div style="padding:20px;text-align:center;color:#888;font-size:12px;">No hay conductores conectados.</div>';
  } catch {}
}

function driverStatusLabel(d) {
    return d.connectionState === 'busy' ? 'Ocupado' : 'Disponible';
}

function renderDriverLocations(drivers) {
  driverLocationLayer.clearLayers();
  drivers.forEach(d => {
    if (d.location) {
      L.marker([d.location.lat, d.location.lon], {
        icon: L.divIcon({
            className:'taxote-car-marker',
            html: `<img src="/assets/taxote-car.png" style="width:32px;height:35px;transform:rotate(${d.location.bearing || 0}deg);">`
        })
      }).addTo(driverLocationLayer).bindPopup(`<b>${d.name}</b><br>${d.vehiclePlate}`);
    }
  });
}

function focusDriverOnMap(id) {
    const d = connectedDrivers.find(x => x.id === id);
    if (d && d.location) map.flyTo([d.location.lat, d.location.lon], 16);
}
loadConnectedDrivers();
setInterval(loadConnectedDrivers, 5000);

window.viewTripDetails = (id) => {
    const trip = dispatchTrips.find(t => t.id === id);
    if (!trip) return;
    $("#trip-details-panel").style.display = "flex";
    $("#booking-form-content").style.display = "none";
    $("#details-trip-id").textContent = id;
    $("#trip-details-content").innerHTML = `
        <div style="display:flex; flex-direction:column; gap:15px;">
            <div style="background:#f8f9fa; padding:15px; border-radius:12px; border:1px solid #eee;">
                <small style="color:#888; font-weight:bold; text-transform:uppercase; font-size:10px;">Cliente</small>
                <div style="font-size:18px; font-weight:800; color:#0b2e47; margin-top:5px;">${escapeHtml(trip.passenger)}</div>
                <div style="font-size:14px; color:#64748b;">📞 ${escapeHtml(trip.phone)}</div>
            </div>
            <div>
                <small style="display:block; font-size:10px; font-weight:800; color:#aaa;">RECOGIDA (A)</small>
                <div style="font-size:13px; margin-top:3px;">${escapeHtml(trip.pickup)}</div>
            </div>
            <div>
                <small style="display:block; font-size:10px; font-weight:800; color:#aaa;">DESTINO (B)</small>
                <div style="font-size:13px; margin-top:3px;">${escapeHtml(trip.destination)}</div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                <div style="background:#e8f5e9; padding:12px; border-radius:10px;">
                    <small style="color:#2e7d32; font-weight:bold; font-size:9px;">PRECIO</small>
                    <div style="font-size:18px; font-weight:800; color:#1b5e20;">${formatPriceDop(trip.priceDop)}</div>
                </div>
                <div style="background:#f1f5f9; padding:12px; border-radius:10px;">
                    <small style="color:#64748b; font-weight:bold; font-size:9px;">ESTADO</small>
                    <div style="font-size:14px; font-weight:800; color:#334155;">${statusLabels[trip.status] || trip.status}</div>
                </div>
            </div>
        </div>
    `;
    if (trip.pickupLat) {
        markerLayer.clearLayers();
        L.marker([trip.pickupLat, trip.pickupLon], {icon: markerIcon("pickup")}).addTo(markerLayer);
        L.marker([trip.destinationLat, trip.destinationLon], {icon: markerIcon("destination")}).addTo(markerLayer);
        map.fitBounds([[trip.pickupLat, trip.pickupLon], [trip.destinationLat, trip.destinationLon]], {padding:[50,50]});
    }
};

$("#close-trip-details")?.addEventListener("click", () => {
    $("#trip-details-panel").style.display = "none";
    $("#booking-form-content").style.display = "block";
    renderSelectionMarkers();
    calculateRoadRoute();
});

window.markTripContacted = (id) => showToast("Marcado como contactado.");

bookingForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const isGuest = serviceType.value === "Invitado";
  const name = isGuest ? $("#guest-name").value : selectedCustomer?.name;
  const phone = isGuest ? $("#guest-phone").value : selectedCustomer?.phone;

  if (!name || !phone || !selectedLocations.pickup || !selectedLocations.destination) {
    showToast("Por favor complete todos los campos.");
    return;
  }

  const details = {
    phone, name, customerName: name, customerPhone: phone,
    pickup: selectedLocations.pickup, destination: selectedLocations.destination,
    stops: [], travelTime: "Viajar ahora", distanceKm: 5.2, durationMin: 15, priceDop: 250,
    note: $("#dispatch-note")?.value, driverId: selectedDriverId
  };
  openBookingConfirmationModal(details);
});

bookingConfirmationConfirmButton?.addEventListener("click", submitConfirmedBooking);
bookingConfirmationCancelButton?.addEventListener("click", closeBookingConfirmationModal);
bookingConfirmationClose?.addEventListener("click", closeBookingConfirmationModal);

async function searchAddress(query, resultsId, kind) {
    if (query.length < 3) return $(resultsId).hidden = true;
    try {
        const results = await fetchJson(`/api/geocode?q=${encodeURIComponent(query)}`);
        $(resultsId).innerHTML = results.map(r => `
            <button type="button" class="address-option" onclick="selectAddress('${resultsId}', '${kind}', '${escapeHtml(r.display_name)}', ${r.lat}, ${r.lon})">
                ${escapeHtml(r.display_name)}
            </button>
        `).join("");
        $(resultsId).hidden = false;
    } catch {}
}

window.selectAddress = (resultsId, kind, address, lat, lon) => {
    $(resultsId).hidden = true;
    selectedLocations[kind] = { address, lat, lon };
    if (kind === 'pickup') pickupInput.value = address;
    else destinationInput.value = address;
    renderSelectionMarkers();
    calculateRoadRoute();
};

pickupInput?.addEventListener("input", (e) => searchAddress(e.target.value, "#pickup-results", "pickup"));
destinationInput?.addEventListener("input", (e) => searchAddress(e.target.value, "#destination-results", "destination"));

async function adminLogout() {
    document.cookie = "taxote_admin_session=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0";
    location.href = "/admin-login.html";
}
