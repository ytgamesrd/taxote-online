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
const driverSideToggle = $("#driver-side-toggle");
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
let mapViewSaveTimer = null;
let selectedCustomer = null;
let activeMapSelection = "pickup";
let selectedDriverId = "";
let pendingBookingConfirmation = null;
let map;
let routeLayer;
let markerLayer;
let driverLocationLayer;
const driverLocationMarkers = new Map();
let originMarker;
let destinationMarker;
let dispatchTrips = [];
const selectedLocations = { pickup: null, destination: null };
const routeStops = [];

let cancelAudio = null;

function playCancelSound() {
  try {
    if (!cancelAudio) {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const playBeep = (freq, start, duration) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + start);
        osc.stop(audioCtx.currentTime + start + duration);
      };
      playBeep(600, 0, 0.15);
      playBeep(400, 0.2, 0.2);
    }
  } catch (e) { console.error("Error de audio:", e); }
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
    showToast(`${data.ride.id} creado y guardado correctamente.`);
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
}

customerInput?.addEventListener("input", () => renderCustomerResults(customerInput.value));

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
    <td style="display:flex;gap:5px;">
        <button onclick="viewTripDetails('${trip.id}')" title="Ver detalles">👁</button>
        <button onclick="markTripContacted('${trip.id}')" title="Llamar">📞</button>
    </td>
    <td>${escapeHtml(trip.id)}</td>
    <td><span class="status-chip status-${trip.status}">${statusLabels[trip.status] || trip.status}</span></td>
    <td>${escapeHtml(trip.passenger)}</td>
    <td>${escapeHtml(trip.phone)}</td>
    <td>${escapeHtml(trip.driver)}</td>
    <td>${trip.contactedAt ? "✓" : "—"}</td>
    <td>${escapeHtml(trip.pickup)}</td>
    <td>${escapeHtml(trip.destination)}</td>
    <td>${new Date(trip.createdAt).toLocaleTimeString()}</td>
  </tr>`;
}

async function loadDispatchTrips() {
  try {
    const rides = await fetchJson("/api/dispatch/rides");
    dispatchTrips = rides;
    $("#trip-table-body").innerHTML = rides.map(tripRowMarkup).join("");
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
    $("#connected-drivers-list").innerHTML = drivers.map(d => `
      <div class="driver" onclick="focusDriverOnMap('${d.id}')">
        <b>${escapeHtml(d.name)}</b><br><small>${escapeHtml(d.vehiclePlate)}</small>
      </div>
    `).join("");
  } catch {}
}

function renderDriverLocations(drivers) {
  driverLocationLayer.clearLayers();
  drivers.forEach(d => {
    if (d.location) {
      L.marker([d.location.lat, d.location.lon], {
        icon: L.divIcon({ className:'taxote-car', html: '<img src="/assets/taxote-car.png" style="width:32px;height:35px;">' })
      }).addTo(driverLocationLayer).bindPopup(d.name);
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
        <div style="padding:15px; background:#f5f5f5; border-radius:8px;">
            <p><b>Pasajero:</b> ${escapeHtml(trip.passenger)}</p>
            <p><b>Teléfono:</b> ${escapeHtml(trip.phone)}</p>
            <p><b>Recogida:</b> ${escapeHtml(trip.pickup)}</p>
            <p><b>Destino:</b> ${escapeHtml(trip.destination)}</p>
            <p><b>Conductor:</b> ${escapeHtml(trip.driver)}</p>
            <p><b>Estado:</b> ${escapeHtml(trip.status)}</p>
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

window.markTripContacted = (id) => showToast("Llamando al pasajero del viaje " + id);

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
    stops: routeStops.map(s => s.location).filter(Boolean),
    driverId: $("#driver-assign-id")?.value,
    note: $("#dispatch-note")?.value,
    travelTime: "Viajar ahora", distanceKm: 5.2, durationMin: 15, priceDop: 250
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
    else if (kind === 'destination') destinationInput.value = address;
    renderSelectionMarkers();
    calculateRoadRoute();
};

pickupInput?.addEventListener("input", (e) => searchAddress(e.target.value, "#pickup-results", "pickup"));
destinationInput?.addEventListener("input", (e) => searchAddress(e.target.value, "#destination-results", "destination"));
