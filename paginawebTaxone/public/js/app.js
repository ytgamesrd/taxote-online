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
let savedTrips = readSavedTrips();
let dispatchTrips = [];
const selectedLocations = { pickup: null, destination: null };
const routeStops = [];

let cancelAudio = null;

function playCancelSound() {
  try {
    if (!cancelAudio) {
      // Create a simple, sharp double beep sound
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

// Resume audio context on first click to bypass browser blocks
document.addEventListener('click', () => {
    if (dispatchAudioContext && dispatchAudioContext.state === 'suspended') {
        dispatchAudioContext.resume();
    }
}, { once: true });

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
  routeStops.splice(0).forEach((stop) => stop.row.remove());
  stopCount = 0;
  syncStopCountSelect();
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

async function redirectFilePageToTaxote() {
  if (location.protocol !== "file:") return;
  const taxoteUrl = new URL("http://127.0.0.1:4173/");
  try {
    const savedMapView = localStorage.getItem("taxote-map-view-v1");
    if (savedMapView) taxoteUrl.searchParams.set("mapView", savedMapView);
  } catch {
    // La redirección puede continuar aunque no exista una vista guardada.
  }
  try {
    await fetch("http://127.0.0.1:4173/api/maps-status", { mode: "no-cors", cache: "no-store" });
    location.replace(taxoteUrl.href);
  } catch {
    showToast("Para usar direcciones, abre INICIAR-TAXOTE.bat y vuelve a esta página.");
  }
}

redirectFilePageToTaxote();

function openMenu() {
  drawerOverlay.hidden = false;
  requestAnimationFrame(() => {
    sideMenu.classList.add("open");
    menuButton.classList.add("open");
  });
  sideMenu.setAttribute("aria-hidden", "false");
  menuButton.setAttribute("aria-expanded", "true");
  document.body.classList.add("menu-open");
  closeMenuButton.focus();
}

function closeMenu() {
  sideMenu.classList.remove("open");
  menuButton.classList.remove("open");
  sideMenu.setAttribute("aria-hidden", "true");
  menuButton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
  setTimeout(() => { drawerOverlay.hidden = true; }, 280);
}

menuButton.addEventListener("click", () => sideMenu.classList.contains("open") ? closeMenu() : openMenu());
closeMenuButton.addEventListener("click", closeMenu);
drawerOverlay.addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
$$('.side-navigation a').forEach((link) => link.addEventListener("click", closeMenu));

function setDriverPanelSide(side) {
  const moveLeft = side === "left";
  document.body.classList.toggle("drivers-left", moveLeft);
  if (driverSideToggle) {
    driverSideToggle.title = moveLeft ? "Mover panel al lado derecho" : "Mover panel de conductores al lado izquierdo";
    driverSideToggle.setAttribute("aria-label", driverSideToggle.title);
    driverSideToggle.setAttribute("aria-pressed", String(moveLeft));
  }
  try { localStorage.setItem("taxote-driver-side", moveLeft ? "left" : "right"); } catch {}
}

let initialDriverSide = "right";
try { initialDriverSide = localStorage.getItem("taxote-driver-side") === "left" ? "left" : "right"; } catch {}
setDriverPanelSide(initialDriverSide);
if (driverSideToggle) {
  driverSideToggle.addEventListener("click", () => setDriverPanelSide(document.body.classList.contains("drivers-left") ? "right" : "left"));
}

const workspace = $(".workspace");
const panelResizeConfig = {
  booking: { panel: $("#booking-panel"), handle: $("[data-resize-panel='booking']"), variable: "--booking-panel-width", storage: "taxote-booking-panel-width", minimum: 270, defaultWidth: 355 },
  drivers: { panel: $("#drivers-panel"), handle: $("[data-resize-panel='drivers']"), variable: "--drivers-panel-width", storage: "taxote-drivers-panel-width", minimum: 240, defaultWidth: 300 }
};

function availablePanelMaximum(kind) {
  const workspaceWidth = workspace.getBoundingClientRect().width;
  const otherKind = kind === "booking" ? "drivers" : "booking";
  const otherWidth = panelResizeConfig[otherKind].panel.getBoundingClientRect().width;
  const absoluteMaximum = kind === "booking" ? 900 : 1200;
  const minimumMapWidth = 220;
  return Math.max(panelResizeConfig[kind].minimum, Math.min(absoluteMaximum, workspaceWidth - otherWidth - minimumMapWidth));
}

function setPanelWidth(kind, requestedWidth, persist = false) {
  const config = panelResizeConfig[kind];
  const width = Math.round(Math.max(config.minimum, Math.min(availablePanelMaximum(kind), requestedWidth)));
  workspace.style.setProperty(config.variable, `${width}px`);
  config.handle.setAttribute("aria-valuemin", String(config.minimum));
  config.handle.setAttribute("aria-valuemax", String(Math.round(availablePanelMaximum(kind))));
  config.handle.setAttribute("aria-valuenow", String(width));
  if (persist) {
    try { localStorage.setItem(config.storage, String(width)); } catch {}
  }
  if (map) map.invalidateSize({ animate: false });
  return width;
}

function restorePanelWidths() {
  Object.entries(panelResizeConfig).forEach(([kind, config]) => {
    let savedWidth = config.defaultWidth;
    try {
      const stored = Number(localStorage.getItem(config.storage));
      if (Number.isFinite(stored) && stored > 0) savedWidth = stored;
    } catch {}
    setPanelWidth(kind, savedWidth);
  });
}

function enablePanelResize(kind) {
  const config = panelResizeConfig[kind];
  let resizeState = null;
  let animationFrame = 0;

  const drawWidth = () => {
    animationFrame = 0;
    if (!resizeState) return;
    setPanelWidth(kind, resizeState.nextWidth);
  };

  const finishResize = (event) => {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    setPanelWidth(kind, resizeState.nextWidth, true);
    resizeState = null;
    config.panel.classList.remove("panel-resizing");
    config.handle.classList.remove("active");
    document.body.classList.remove("panel-resize-active");
    try { config.handle.releasePointerCapture(event.pointerId); } catch {}
  };

  config.handle.addEventListener("pointerdown", (event) => {
    if (!window.matchMedia("(min-width: 1181px)").matches) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const driversAreLeft = document.body.classList.contains("drivers-left");
    const direction = kind === "drivers" && !driversAreLeft ? -1 : 1;
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: config.panel.getBoundingClientRect().width,
      direction,
      nextWidth: config.panel.getBoundingClientRect().width
    };
    config.panel.classList.add("panel-resizing");
    config.handle.classList.add("active");
    document.body.classList.add("panel-resize-active");
    try { config.handle.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });

  config.handle.addEventListener("pointermove", (event) => {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    resizeState.nextWidth = resizeState.startWidth + (event.clientX - resizeState.startX) * resizeState.direction;
    if (!animationFrame) animationFrame = requestAnimationFrame(drawWidth);
    event.preventDefault();
  });

  config.handle.addEventListener("pointerup", finishResize);
  config.handle.addEventListener("pointercancel", finishResize);
  config.handle.addEventListener("dblclick", () => setPanelWidth(kind, config.defaultWidth, true));
  config.handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !window.matchMedia("(min-width: 1181px)").matches) return;
    const driversAreLeft = document.body.classList.contains("drivers-left");
    const direction = kind === "drivers" && !driversAreLeft ? -1 : 1;
    const cursorDelta = event.key === "ArrowRight" ? 12 : -12;
    setPanelWidth(kind, config.panel.getBoundingClientRect().width + cursorDelta * direction, true);
    event.preventDefault();
  });
}

restorePanelWidths();
enablePanelResize("booking");
enablePanelResize("drivers");
window.addEventListener("resize", () => {
  if (!window.matchMedia("(min-width: 1181px)").matches) return;
  setPanelWidth("booking", panelResizeConfig.booking.panel.getBoundingClientRect().width);
  setPanelWidth("drivers", panelResizeConfig.drivers.panel.getBoundingClientRect().width);
});

function renderCustomerResults(query = "") {
  const normalized = query.trim().toLocaleLowerCase("es");
  const matches = registeredClients.filter((client) => `${client.name} ${client.phone}`.toLocaleLowerCase("es").includes(normalized)).slice(0, 6);
  if (!registeredClients.length || (!matches.length && !normalized)) {
    customerResults.hidden = true;
    customerResults.innerHTML = "";
    return;
  }
  customerResults.innerHTML = matches.map((client) => `
    <button class="customer-option" type="button" data-client-id="${client.id}">
      <span class="mini-avatar">${client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
      <span><b>${escapeHtml(client.name)}</b><small>${escapeHtml(client.phone)} · ${client.id}</small></span>
    </button>`).join("") || '<div class="address-searching">No hay clientes que coincidan con esta búsqueda.</div>';
  customerResults.hidden = false;
  customerInput.setAttribute("aria-expanded", "true");
  $$('.customer-option').forEach((button) => button.addEventListener("click", () => selectCustomer(button.dataset.clientId)));
}

function closeCustomerResults() {
  customerResults.hidden = true;
  customerInput.setAttribute("aria-expanded", "false");
}

function selectCustomer(clientId) {
  selectedCustomer = registeredClients.find((client) => client.id === clientId) || null;
  if (!selectedCustomer) return;
  customerInput.value = selectedCustomer.name;
  customerResults.hidden = true;
  selectedCustomerCard.innerHTML = `<b>${escapeHtml(selectedCustomer.name)}</b> <span>· ${escapeHtml(selectedCustomer.phone)} · ${selectedCustomer.id}</span>`;
  selectedCustomerCard.hidden = false;
  $("#registered-history-search").disabled = false;
}

customerInput.addEventListener("focus", () => renderCustomerResults(customerInput.value));
customerInput.addEventListener("input", () => {
  selectedCustomer = null;
  $("#registered-history-search").disabled = true;
  selectedCustomerCard.hidden = true;
  renderCustomerResults(customerInput.value);
});
customerInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCustomerResults();
});
customerInput.addEventListener("blur", () => {
  setTimeout(() => {
    if (!$(".customer-picker-wrap").contains(document.activeElement)) closeCustomerResults();
  }, 120);
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".customer-picker-wrap")) closeCustomerResults();
});
$("#clear-customer").addEventListener("click", () => {
  selectedCustomer = null;
  $("#registered-history-search").disabled = true;
  customerInput.value = "";
  selectedCustomerCard.hidden = true;
  customerInput.focus();
  closeCustomerResults();
});

function toggleServiceFields() {
  const isGuest = serviceType.value === "Invitado";
  $(".customer-picker-wrap").hidden = isGuest;
  if (isGuest) closeCustomerResults();
  selectedCustomerCard.hidden = isGuest || !selectedCustomer;
  guestFields.hidden = !isGuest;
  guestFields.classList.toggle("visible", isGuest);
}

function syncScheduleFields() {
  const scheduled = travelTime?.value === "scheduled";
  if (scheduleFields) scheduleFields.hidden = !scheduled;
  if (scheduleDate) scheduleDate.required = scheduled;
  if (scheduleTime) scheduleTime.required = scheduled;
  if (scheduled && scheduleDate && !scheduleDate.value) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    scheduleDate.value = tomorrow.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  }
}

serviceType.addEventListener("change", toggleServiceFields);
travelTime?.addEventListener("change", syncScheduleFields);
toggleServiceFields();
syncScheduleFields();
$("#guest-phone").addEventListener("input", (event) => {
  const digits = event.target.value.replace(/\D/g, "").slice(0, 10);
  event.target.value = digits.length > 6 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
  if ($("#guest-name").readOnly) $("#guest-name").value = "";
  $("#guest-name").readOnly = false;
  $("#guest-history-status").textContent = "Escribe el teléfono y toca la lupa.";
  $("#guest-history-status").className = "guest-history-status";
});

let recentPhoneRides = [];

function validGuestPhone() {
  return /^(809|829|849)\d{7}$/.test($("#guest-phone").value.replace(/\D/g, ""));
}

function closePhoneHistoryModal() {
  $("#phone-history-modal").hidden = true;
  document.body.classList.remove("dispatch-modal-open");
}

function recentRideDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString("es-DO")} ${date.toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" })}`;
}

function renderPhoneHistory(profile, rides) {
  recentPhoneRides = Array.isArray(rides) ? rides.slice(0, 10) : [];
  $("#phone-history-person").textContent = `${profile.name} · ${profile.phone}`;
  $("#phone-history-count").textContent = `${recentPhoneRides.length} ${recentPhoneRides.length === 1 ? "viaje" : "viajes"}`;
  $("#phone-history-body").innerHTML = recentPhoneRides.length
    ? recentPhoneRides.map((ride, index) => `<tr>
        <td>${escapeHtml(recentRideDate(ride.createdAt))}</td>
        <td>${escapeHtml(profile.phone)}</td>
        <td>${escapeHtml(ride.pickup?.address || "—")}</td>
        <td>${escapeHtml(ride.destination?.address || "—")}</td>
        <td><button class="phone-history-use" type="button" data-reuse-ride="${index}">USAR RUTA</button></td>
      </tr>`).join("")
    : '<tr><td colspan="5" class="phone-history-empty">Este teléfono está guardado, pero todavía no tiene viajes anteriores.</td></tr>';
  $("#phone-history-body").querySelectorAll("[data-reuse-ride]").forEach((button) => button.addEventListener("click", () => {
    const ride = recentPhoneRides[Number(button.dataset.reuseRide)];
    if (!ride?.pickup || !ride?.destination) return;
    setAddressTarget(pickupTarget, ride.pickup);
    setAddressTarget(destinationTarget, ride.destination);
    closePhoneHistoryModal();
    focusRouteBounds();
    showToast("Recogida y destino cargados desde el historial del pasajero.");
  }));
}

async function searchGuestPhoneHistory() {
  if (!validGuestPhone()) {
    showToast("Escribe un teléfono válido de RD: 809, 829 o 849.");
    $("#guest-phone").focus();
    return;
  }
  const button = $("#guest-history-search");
  const status = $("#guest-history-status");
  button.disabled = true;
  status.textContent = "Buscando pasajero y viajes anteriores…";
  status.className = "guest-history-status";
  try {
    const data = await fetchJson(`/api/contacts/lookup?phone=${encodeURIComponent($("#guest-phone").value)}`);
    if (!data.found) {
      $("#guest-name").readOnly = false;
      status.textContent = "Número nuevo. Escribe el nombre para guardarlo al añadir el viaje.";
      status.className = "guest-history-status new";
      $("#guest-name").focus();
      showToast("Este teléfono todavía no tiene servicios guardados.");
      return;
    }
    $("#guest-name").value = data.profile.name;
    $("#guest-name").readOnly = true;
    status.textContent = `${data.profile.name} encontrado · ${Math.min(10, data.rides?.length || 0)} viajes recientes.`;
    status.className = "guest-history-status found";
    renderPhoneHistory(data.profile, data.rides || []);
    $("#phone-history-modal").hidden = false;
    document.body.classList.add("dispatch-modal-open");
    $("#close-phone-history").focus();
  } catch (error) {
    status.textContent = "No se pudo consultar el historial.";
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

$("#guest-history-search").addEventListener("click", searchGuestPhoneHistory);
$("#registered-history-search").addEventListener("click", async () => {
  if (!selectedCustomer) return showToast("Selecciona primero un cliente registrado.");
  const button = $("#registered-history-search");
  button.disabled = true;
  try {
    const data = await fetchJson(`/api/contacts/lookup?phone=${encodeURIComponent(selectedCustomer.phone)}`);
    if (!data.found) throw new Error("No se encontró el historial de este cliente.");
    renderPhoneHistory(data.profile, data.rides || []);
    $("#phone-history-modal").hidden = false;
    document.body.classList.add("dispatch-modal-open");
    $("#close-phone-history").focus();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = !selectedCustomer;
  }
});
$("#close-phone-history").addEventListener("click", closePhoneHistoryModal);
$("#dismiss-phone-history").addEventListener("click", closePhoneHistoryModal);
$("#phone-history-modal").addEventListener("pointerdown", (event) => {
  if (event.target === $("#phone-history-modal")) closePhoneHistoryModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#phone-history-modal").hidden) closePhoneHistoryModal();
});

function markerIcon(kind, stopNumber = 0) {
  const isDestination = kind === "destination";
  const isStop = kind === "stop";
  const label = isStop ? `C${stopNumber}` : (isDestination ? "B" : "A");
  return L.divIcon({
    className: "taxote-div-icon",
    html: `<div class="taxote-marker-shell"><div class="taxote-marker ${isStop ? "stop" : (isDestination ? "destination" : "origin")}"><span>${label}</span></div><button class="marker-remove" type="button" aria-label="Quitar punto ${label}" title="Quitar punto ${label}">×</button></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30]
  });
}

function locationFromResult(result) {
  return { address: result.display_name, lat: Number(result.lat), lon: Number(result.lon) };
}

async function fetchJson(url, options = {}) {
  if (location.protocol === "file:" && String(url).startsWith("/api/")) {
    throw new Error("Abre INICIAR-TAXOTE.bat para activar el mapa y las direcciones.");
  }
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new Error("No se pudo conectar con TAXOTE. Abre INICIAR-TAXOTE.bat e inténtalo nuevamente.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Solicitud fallida (${response.status})`);
  return body;
}

async function updateAddressProviderStatus() {
  if (location.protocol === "file:") {
    addressProviderStatus.classList.add("not-configured");
    addressProviderStatus.querySelector("span").textContent = "Abre INICIAR-TAXOTE.bat para activar las direcciones";
    return;
  }
  try {
    const status = await fetchJson("/api/maps-status");
    addressProviderStatus.classList.remove("not-configured");
    addressProviderStatus.classList.toggle("fallback-provider", status.fallback);
    addressProviderStatus.querySelector("i").textContent = status.googleConfigured ? "G" : "RD";
    addressProviderStatus.querySelector("span").textContent = status.googleConfigured
      ? "Direcciones de Google Maps · República Dominicana"
      : "Direcciones reales de República Dominicana activas";
  } catch {
    addressProviderStatus.classList.add("not-configured");
    addressProviderStatus.querySelector("span").textContent = "No se pudo verificar Google Maps";
  }
}

updateAddressProviderStatus();

async function loadRegisteredClients() {
  if (location.protocol === "file:") return;
  try {
    registeredClients = await fetchJson("/api/dispatch/clients");
    if (!customerResults.hidden) renderCustomerResults(customerInput.value);
  } catch {
    registeredClients = [];
  }
}

loadRegisteredClients();
setInterval(loadRegisteredClients, 15000);

function addressResultMarkup(result) {
  const main = result.name || result.address?.road || result.address?.suburb || result.display_name.split(",")[0];
  return `<span><b>${escapeHtml(main)}</b><small>${escapeHtml(result.display_name)}</small></span>`;
}

function setAddressResultsVisibility(target, visible) {
  target.results.hidden = !visible;
  target.input.setAttribute("aria-expanded", String(visible));
  if (!visible) {
    target.activeOption = -1;
    target.input.removeAttribute("aria-activedescendant");
  }
}

function setActiveAddressOption(target, index) {
  const options = [...target.results.querySelectorAll(".address-option")];
  if (!options.length) return;
  const normalizedIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    option.classList.toggle("keyboard-active", optionIndex === normalizedIndex);
    option.setAttribute("aria-selected", String(optionIndex === normalizedIndex));
  });
  target.activeOption = normalizedIndex;
  target.input.setAttribute("aria-activedescendant", options[normalizedIndex].id);
  options[normalizedIndex].scrollIntoView({ block: "nearest" });
}

function handleAddressKeydown(target, event) {
  const options = [...target.results.querySelectorAll(".address-option")];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (target.results.hidden || !options.length) {
      clearTimeout(target.searchTimer);
      searchAddress(target);
      return;
    }
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setActiveAddressOption(target, (target.activeOption ?? -1) + direction);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!target.results.hidden && target.activeOption >= 0 && options[target.activeOption]) options[target.activeOption].click();
    else {
      clearTimeout(target.searchTimer);
      searchAddress(target);
    }
    return;
  }
  if (event.key === "Escape") setAddressResultsVisibility(target, false);
}

async function selectAddressResult(target, result) {
  target.input.setAttribute("aria-busy", "true");
  target.results.innerHTML = '<div class="address-searching">Obteniendo la dirección completa…</div>';
  try {
    const resolved = result.lat !== undefined && result.lon !== undefined
      ? result
      : await fetchJson(`/api/place?id=${encodeURIComponent(result.place_id)}`);
    setAddressTarget(target, locationFromResult(resolved));
  } catch (error) {
    setAddressResultsVisibility(target, true);
    target.results.innerHTML = `<div class="address-searching address-search-error">${escapeHtml(error.message)}</div>`;
  } finally {
    target.input.removeAttribute("aria-busy");
  }
}

async function searchAddress(target, announceShortQuery = true) {
  const query = target.input.value.trim();
  if (query.length < 2) {
    setAddressResultsVisibility(target, false);
    if (announceShortQuery) showToast("Escribe al menos dos letras de la dirección.");
    target.input.focus();
    return;
  }
  const requestId = target.requestId = (target.requestId || 0) + 1;
  target.activeOption = -1;
  setAddressResultsVisibility(target, true);
  target.results.innerHTML = '<div class="address-searching">Buscando direcciones en República Dominicana…</div>';
  target.input.setAttribute("aria-busy", "true");
  try {
    const results = (await fetchJson(`/api/geocode?q=${encodeURIComponent(query)}`)).slice(0, 6);
    if (requestId !== target.requestId) return;
    const options = results.map((result, index) => `<button id="${target.results.id}-option-${index}" class="address-option" type="button" role="option" aria-selected="false" data-result-index="${index}">${addressResultMarkup(result)}</button>`).join("");
    const usesGoogle = results.some((result) => result.provider === "google");
    target.results.innerHTML = options
      ? `${options}<div class="map-data-attribution">${usesGoogle ? "Direcciones de <b>Google Maps</b>" : "Datos de direcciones © OpenStreetMap"}</div>`
      : '<div class="address-searching">No se encontró la dirección. Prueba incluyendo calle, sector, municipio o provincia.</div>';
    target.results.querySelectorAll(".address-option").forEach((button, index) => {
      button.addEventListener("mouseenter", () => setActiveAddressOption(target, index));
      button.addEventListener("click", () => selectAddressResult(target, results[Number(button.dataset.resultIndex)]));
    });
  } catch (error) {
    if (requestId !== target.requestId) return;
    const message = location.protocol === "file:"
      ? "Abre TAXOTE con INICIAR-TAXOTE.bat para buscar direcciones. No abras index.html directamente."
      : error.message;
    target.results.innerHTML = `<div class="address-searching address-search-error">${escapeHtml(message)}</div>`;
  } finally {
    if (requestId === target.requestId) target.input.removeAttribute("aria-busy");
  }
}

const pickupTarget = { kind: "pickup", input: pickupInput, results: $("#pickup-results") };
const destinationTarget = { kind: "destination", input: destinationInput, results: $("#destination-results") };
const addressTargets = [];

function setAddressTarget(target, locationData) {
  if (serviceType.value === "Invitado" && !validGuestPhone()) {
    target.input.value = "";
    setAddressResultsVisibility(target, false);
    showToast("Escribe primero el teléfono dominicano del invitado.");
    $("#guest-phone").focus();
    return;
  }
  if (serviceType.value === "Registrado" && !selectedCustomer) {
    target.input.value = "";
    setAddressResultsVisibility(target, false);
    showToast("Selecciona primero el cliente registrado.");
    customerInput.focus();
    return;
  }
  if (target.kind === "destination" && !selectedLocations.pickup) {
    target.input.value = "";
    setAddressResultsVisibility(target, false);
    setMapSelection("pickup");
    showToast("Selecciona primero el punto A de recogida.");
    return;
  }
  if (target.kind === "stop" && (!selectedLocations.pickup || !selectedLocations.destination)) {
    target.input.value = "";
    setAddressResultsVisibility(target, false);
    setMapSelection(!selectedLocations.pickup ? "pickup" : "destination");
    showToast("Selecciona los puntos A y B antes de añadir una parada C.");
    return;
  }
  target.mapRequestId = (target.mapRequestId || 0) + 1;
  target.input.value = locationData.address;
  setAddressResultsVisibility(target, false);
  let mapPointKind = null;
  if (target.kind === "pickup" || target.kind === "destination") {
    selectedLocations[target.kind] = locationData;
    mapPointKind = target.kind;
  } else {
    target.stop.location = locationData;
    mapPointKind = `stop:${target.stop.id}`;
  }
  if (mapPointKind) {
    advanceMapSelection(mapPointKind);
    renderSelectionMarkers();
    showSelectedRouteArea(mapPointKind);
  }
  calculateRoadRoute();
  if (target.kind === "pickup" || target.kind === "destination") {
    focusRouteBounds();
  }
}

function clearAddressTarget(target) {
  target.mapRequestId = (target.mapRequestId || 0) + 1;
  if (target.kind === "pickup" || target.kind === "destination") selectedLocations[target.kind] = null;
  else target.stop.location = null;
  if (target.results) setAddressResultsVisibility(target, false);
  renderSelectionMarkers();
  calculateRoadRoute();
}

function focusRouteBounds() {
  const routeLocations = getRouteLocations();
  if (!routeLocations || routeLocations.length < 2 || !map) return;
  const bounds = L.latLngBounds(routeLocations.map((location) => [location.lat, location.lon]));
  map.fitBounds(bounds, { padding: [70, 70], maxZoom: 15, animate: true, duration: 1.4, easeLinearity: 0.3 });
}

function bindAddressAutocomplete(target) {
  addressTargets.push(target);
  target.activeOption = -1;
  target.input.setAttribute("role", "combobox");
  target.input.setAttribute("aria-autocomplete", "list");
  target.input.setAttribute("aria-controls", target.results.id);
  target.input.setAttribute("aria-expanded", "false");
  target.results.setAttribute("role", "listbox");
  target.input.addEventListener("input", () => {
    clearTimeout(target.searchTimer);
    target.requestId = (target.requestId || 0) + 1;
    clearAddressTarget(target);
    if (target.input.value.trim().length < 2) return;
    setAddressResultsVisibility(target, true);
    target.results.innerHTML = '<div class="address-searching">Espera un momento…</div>';
    target.searchTimer = setTimeout(() => searchAddress(target, false), 350);
  });
  target.input.addEventListener("keydown", (event) => handleAddressKeydown(target, event));
  target.input.addEventListener("focus", () => {
    if (target.input.value.trim().length >= 2 && !target.results.querySelector(".address-option")) {
      clearTimeout(target.searchTimer);
      target.searchTimer = setTimeout(() => searchAddress(target, false), 150);
    }
  });
}

[pickupTarget, destinationTarget].forEach(bindAddressAutocomplete);
document.addEventListener("pointerdown", (event) => {
  addressTargets.forEach((target) => {
    if (!target.input.closest(".address-field, .stop-address")?.contains(event.target)) setAddressResultsVisibility(target, false);
  });
});
$("#search-pickup").addEventListener("click", () => { clearTimeout(pickupTarget.searchTimer); searchAddress(pickupTarget); });
$("#search-destination").addEventListener("click", () => { clearTimeout(destinationTarget.searchTimer); searchAddress(destinationTarget); });

function setMapSelection(kind) {
  activeMapSelection = kind;
}

function advanceMapSelection(completedKind) {
  if (completedKind === "pickup") {
    setMapSelection("destination");
    return;
  }
  setMapSelection("auto-next");
}

function mapSelectionForNextClick() {
  if (!selectedLocations.pickup) return "pickup";
  if (!selectedLocations.destination) return "destination";
  if (activeMapSelection !== "auto-next") return activeMapSelection;
  const emptyStop = routeStops.find((stop) => !stop.location);
  if (emptyStop) return `stop:${emptyStop.id}`;
  showToast(routeStops.length >= 3
    ? "Ya agregaste el máximo de tres paradas C."
    : "Pulsa el botón + antes de seleccionar una parada C en el mapa.");
  return null;
}

$("#pick-pickup-map").addEventListener("click", () => { setMapSelection("pickup"); $("#map-card").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("#pick-destination-map").addEventListener("click", () => { setMapSelection("destination"); $("#map-card").scrollIntoView({ behavior: "smooth", block: "center" }); });

async function reverseGeocode(lat, lon) {
  const result = await fetchJson(`/api/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  return locationFromResult(result);
}

function stopFromMapSelection(kind) {
  if (!String(kind).startsWith("stop:")) return null;
  const stopId = String(kind).slice(5);
  return routeStops.find((stop) => String(stop.id) === stopId) || null;
}

function targetFromMapSelection(kind) {
  const stop = stopFromMapSelection(kind);
  if (stop) return stop.target;
  if (kind === "pickup") return pickupTarget;
  if (kind === "destination") return destinationTarget;
  return null;
}

function assignMapPoint(kind, locationData) {
  const stop = stopFromMapSelection(kind);
  if (stop) {
    stop.location = locationData;
    return stop.target;
  }
  if (kind !== "pickup" && kind !== "destination") return null;
  selectedLocations[kind] = locationData;
  return kind === "pickup" ? pickupTarget : destinationTarget;
}

function closeMarkerRemoveButtons() {
  document.querySelectorAll(".taxote-marker-shell.remove-visible").forEach((element) => element.classList.remove("remove-visible"));
}

function removeMapPoint(selectionKind) {
  closeMarkerRemoveButtons();
  const stop = stopFromMapSelection(selectionKind);
  if (stop) {
    const stopNumber = routeStops.indexOf(stop) + 1;
    removeRouteStop(stop);
    setMapSelection("auto-next");
    showToast(`Parada C${stopNumber} eliminada.`);
    return;
  }
  const target = targetFromMapSelection(selectionKind);
  if (!target) return;
  target.mapRequestId = (target.mapRequestId || 0) + 1;
  target.input.value = "";
  setAddressResultsVisibility(target, false);
  selectedLocations[selectionKind] = null;
  setMapSelection(selectionKind);
  renderSelectionMarkers();
  calculateRoadRoute();
  showToast(`${selectionKind === "pickup" ? "Punto A" : "Punto B"} eliminado.`);
}

async function setPointFromMap(kind, latlng, options = {}) {
  const target = assignMapPoint(kind, { address: "Buscando dirección…", lat: latlng.lat, lon: latlng.lng });
  if (!target) return;
  const mapRequestId = target.mapRequestId = (target.mapRequestId || 0) + 1;
  target.input.value = "Buscando dirección…";
  if (!options.keepMapFixed) advanceMapSelection(kind);
  renderSelectionMarkers();
  try {
    const resolvedLocation = await reverseGeocode(latlng.lat, latlng.lng);
    if (target.mapRequestId !== mapRequestId) return;
    assignMapPoint(kind, resolvedLocation);
    target.input.value = resolvedLocation.address;
    renderSelectionMarkers();
    if (!options.keepMapFixed) showSelectedRouteArea(kind);
    calculateRoadRoute();
    const pointName = target.kind === "stop" ? `Parada C${routeStops.indexOf(target.stop) + 1}` : (kind === "pickup" ? "Recogida" : "Destino");
    showToast(`${pointName} seleccionado en el mapa.`);
  } catch (error) {
    if (target.mapRequestId !== mapRequestId) return;
    assignMapPoint(kind, null);
    target.input.value = "";
    if (!options.keepMapFixed) setMapSelection(kind);
    renderSelectionMarkers();
    calculateRoadRoute();
    showToast(error.message || "No se encontró una dirección escrita para ese punto.");
  }
}

function renderSelectionMarkers() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  originMarker = null;
  destinationMarker = null;
  const createMarker = (selectionKind, markerKind, locationData, label, stopNumber = 0) => {
    if (!locationData) return null;
    const marker = L.marker([locationData.lat, locationData.lon], { icon: markerIcon(markerKind, stopNumber), draggable: true }).addTo(markerLayer);
    const markerShell = marker.getElement()?.querySelector(".taxote-marker-shell");
    const removeButton = markerShell?.querySelector(".marker-remove");
    const revealRemoveButton = () => {
      closeMarkerRemoveButtons();
      markerShell?.classList.add("remove-visible");
    };
    markerShell?.addEventListener("mouseenter", revealRemoveButton);
    markerShell?.addEventListener("mouseleave", () => markerShell.classList.remove("remove-visible"));
    marker.on("click", (event) => {
      if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      revealRemoveButton();
    });
    if (removeButton) {
      L.DomEvent.disableClickPropagation(removeButton);
      removeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeMapPoint(selectionKind);
      });
    }
    marker.on("dragstart", () => {
      closeMarkerRemoveButtons();
      const target = targetFromMapSelection(selectionKind);
      if (target) target.mapRequestId = (target.mapRequestId || 0) + 1;
    });
    marker.on("dragend", (event) => setPointFromMap(selectionKind, event.target.getLatLng(), { keepMapFixed: true }));
    return marker;
  };
  originMarker = createMarker("pickup", "pickup", selectedLocations.pickup, "Punto A · Recogida");
  routeStops.forEach((stop, index) => {
    stop.marker = createMarker(`stop:${stop.id}`, "stop", stop.location, `Parada C${index + 1}`, index + 1);
  });
  destinationMarker = createMarker("destination", "destination", selectedLocations.destination, "Punto B · Destino");
}

function showSelectedRouteArea(lastSelectedKind) {
  if (!map) return;
  const selectedPoints = [selectedLocations.pickup, ...routeStops.map((stop) => stop.location), selectedLocations.destination].filter(Boolean);
  const selectedStop = stopFromMapSelection(lastSelectedKind);
  const selectedPoint = selectedStop?.location || selectedLocations[lastSelectedKind] || selectedPoints[0];
  if (selectedPoint) map.panTo([selectedPoint.lat, selectedPoint.lon], { animate: true, duration: 1.0, easeLinearity: 0.3 });
}

function readSavedMapView() {
  const defaultView = { lat: 18.505, lon: -69.94, zoom: 11 };
  try {
    const importedMapView = new URLSearchParams(location.search).get("mapView");
    const savedView = JSON.parse(importedMapView || localStorage.getItem("taxote-map-view-v1") || "null");
    const lat = Number(savedView?.lat);
    const lon = Number(savedView?.lon);
    const zoom = Number(savedView?.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) return defaultView;
    if (lat < 17 || lat > 21 || lon < -73 || lon > -67 || zoom < 7 || zoom > 19) return defaultView;
    if (importedMapView) {
      localStorage.setItem("taxote-map-view-v1", JSON.stringify({ lat, lon, zoom }));
      history.replaceState({}, "", `${location.pathname}${location.hash}`);
    }
    return { lat, lon, zoom };
  } catch {
    return defaultView;
  }
}

function saveCurrentMapView() {
  if (!map) return;
  const center = map.getCenter();
  try {
    localStorage.setItem("taxote-map-view-v1", JSON.stringify({
      lat: Number(center.lat.toFixed(6)),
      lon: Number(center.lng.toFixed(6)),
      zoom: map.getZoom()
    }));
  } catch {
    // El mapa sigue funcionando aunque el navegador bloquee el almacenamiento local.
  }
}

function scheduleMapViewSave() {
  clearTimeout(mapViewSaveTimer);
  mapViewSaveTimer = setTimeout(saveCurrentMapView, 180);
}

function getRouteLocations() {
  const stopLocations = routeStops.map((stop) => stop.location);
  if (stopLocations.some((locationData) => !locationData)) return null;
  return [selectedLocations.pickup, ...stopLocations, selectedLocations.destination].filter(Boolean);
}

async function calculateRoadRoute() {
  const requestId = ++routeRequestId;
  if (routeLayer) routeLayer.clearLayers();
  if (!selectedLocations.pickup || !selectedLocations.destination) {
    routeNotice.className = "notice";
    routeNotice.innerHTML = "<span>✦</span> Selecciona en el mapa o busca la recogida y el destino.";
    return;
  }
  const routeLocations = getRouteLocations();
  if (!routeLocations) {
    routeNotice.className = "notice";
    routeNotice.innerHTML = "<span>✦</span> Busca y selecciona la dirección de cada parada intermedia.";
    return;
  }
  routeNotice.className = "notice route-loading";
  routeNotice.innerHTML = "<span>⌁</span> Calculando la mejor ruta por las calles de República Dominicana…";
  const coordinates = routeLocations.map((locationData) => `${locationData.lon},${locationData.lat}`).join(";");
  try {
    const data = await fetchJson(`/api/route?coordinates=${encodeURIComponent(coordinates)}`);
    if (requestId !== routeRequestId || !data.routes?.length) return;
    const route = data.routes[0];
    const latLngs = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (routeLayer) {
      L.polyline(latLngs, { color: "#ffffff", weight: 10, opacity: .92, interactive: false, className: "leaflet-routing-line" }).addTo(routeLayer);
      L.polyline(latLngs, { color: "#f4c400", weight: 6, opacity: .98, interactive: false, className: "leaflet-routing-line" }).addTo(routeLayer);
    }
    const distance = (route.distance / 1000).toFixed(1);
    const duration = Math.max(1, Math.round(route.duration / 60));
    routeNotice.className = "notice route-ready";
    routeNotice.innerHTML = `<span>✓</span> Ruta por carretera: ${distance} km · aproximadamente ${duration} min${routeStops.length ? ` · ${routeStops.length} parada(s)` : ""}.`;
  } catch {
    if (requestId !== routeRequestId) return;
    routeNotice.className = "notice route-error";
    routeNotice.innerHTML = `<span>!</span> ${location.protocol === "file:" ? "Abre TAXOTE con INICIAR-TAXOTE.bat para calcular la ruta." : "No se pudo calcular la ruta por carretera. Intenta nuevamente."}`;
  }
}

function initializeMap() {
  const mapElement = $("#live-map");
  if (!window.L) {
    mapElement.innerHTML = '<div class="map-loading-error">No se pudo cargar el mapa. Comprueba tu conexión a Internet y vuelve a abrir la página.</div>';
    return;
  }
  const savedMapView = readSavedMapView();
  map = L.map("live-map", { zoomControl: true, scrollWheelZoom: true, minZoom: 7 }).setView([savedMapView.lat, savedMapView.lon], savedMapView.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  driverLocationLayer = L.layerGroup().addTo(map);
  map.on("click", (event) => {
    closeMarkerRemoveButtons();
    const selectionKind = mapSelectionForNextClick();
    if (selectionKind) setPointFromMap(selectionKind, event.latlng);
  });
  map.on("moveend", scheduleMapViewSave);
  const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
  resizeObserver.observe(mapElement);
  setTimeout(() => map.invalidateSize({ pan: false }), 350);
}

initializeMap();

function syncStopCountSelect() {
  $("#stop-count-select").value = String(stopCount);
  routeStops.forEach((stop, index) => {
    const number = index + 1;
    stop.row.querySelector(".stop-label").textContent = `Parada C${number}`;
    stop.row.querySelector(".stop-input").placeholder = `Dirección de parada C${number}`;
    stop.row.querySelector(".search-stop").setAttribute("aria-label", `Buscar parada C${number}`);
    stop.row.querySelector(".pick-stop-map").innerHTML = `<i></i> Elegir parada C${number} en el mapa`;
  });
  renderSelectionMarkers();
}

function addRouteStop(showMessage = true) {
  if (!selectedLocations.pickup || !selectedLocations.destination) {
    setMapSelection(!selectedLocations.pickup ? "pickup" : "destination");
    showToast("Selecciona primero los puntos A y B para añadir una parada C.");
    return false;
  }
  if (stopCount >= 3) {
    showToast("Puedes agregar un máximo de tres paradas.");
    return false;
  }
  stopCount += 1;
  const stop = { id: Date.now() + stopCount, location: null, row: null };
  const row = document.createElement("div");
  row.className = "stop-row";
  row.innerHTML = `
    <div class="stop-address">
      <div class="stop-label">Parada C${stopCount}</div>
      <div class="address-control"><input class="stop-input" type="search" placeholder="Dirección de parada C${stopCount}" autocomplete="off" /><button class="search-stop" type="button" aria-label="Buscar parada C${stopCount}">⌕</button></div>
      <div id="stop-results-${stop.id}" class="address-results" hidden></div>
      <button class="pick-on-map stop-pick pick-stop-map" type="button"><i></i> Elegir parada C${stopCount} en el mapa</button>
    </div>
    <button class="remove-stop" type="button" aria-label="Quitar parada">×</button>`;
  stop.row = row;
  routeStops.push(stop);
  const target = { kind: "stop", input: row.querySelector(".stop-input"), results: row.querySelector(".address-results"), stop };
  stop.target = target;
  row.querySelector(".search-stop").addEventListener("click", () => { clearTimeout(target.searchTimer); searchAddress(target); });
  row.querySelector(".pick-stop-map").addEventListener("click", () => {
    setMapSelection(`stop:${stop.id}`);
    $("#map-card").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  bindAddressAutocomplete(target);
  row.querySelector(".remove-stop").addEventListener("click", () => removeRouteStop(stop));
  $("#extra-stops").appendChild(row);
  syncStopCountSelect();
  setMapSelection(`stop:${stop.id}`);
  calculateRoadRoute();
  if (showMessage) showToast(`Parada C${routeStops.indexOf(stop) + 1} añadida. Búscala o selecciónala en el mapa.`);
  return true;
}

function removeRouteStop(stop) {
  if (stop.target) stop.target.mapRequestId = (stop.target.mapRequestId || 0) + 1;
  clearTimeout(stop.target?.searchTimer);
  const targetIndex = addressTargets.indexOf(stop.target);
  if (targetIndex >= 0) addressTargets.splice(targetIndex, 1);
  stop.row.remove();
  const index = routeStops.indexOf(stop);
  if (index >= 0) routeStops.splice(index, 1);
  if (activeMapSelection === `stop:${stop.id}`) setMapSelection("pickup");
  stopCount = routeStops.length;
  syncStopCountSelect();
  calculateRoadRoute();
}

$("#add-stop").addEventListener("click", () => addRouteStop());
$("#stop-count-select").addEventListener("change", (event) => {
  const requestedStops = Number(event.target.value);
  while (stopCount < requestedStops) {
    if (!addRouteStop(false)) break;
  }
  while (stopCount > requestedStops) removeRouteStop(routeStops[routeStops.length - 1]);
  syncStopCountSelect();
});

$("#recenter").addEventListener("click", () => {
  if (map) map.setView([18.505, -69.94], 11, { animate: true });
  showToast("Mapa centrado cerca de Santo Domingo.");
});
$("#map-standard").addEventListener("change", () => $("#live-map").classList.remove("light-map", "dark-map"));
$("#map-light")?.addEventListener("change", () => $("#live-map").classList.add("light-map"));
$("#map-dark")?.addEventListener("change", () => {
  $("#live-map").classList.remove("light-map");
  $("#live-map").classList.add("dark-map");
});

function readSavedTrips() {
  try {
    const stored = JSON.parse(localStorage.getItem("taxote-trips-v2") || "[]");
    const fallbackDate = new Date().toISOString();
    return Array.isArray(stored) ? stored.map((trip) => ({
      ...trip,
      route: Array.isArray(trip.route) ? trip.route : [],
      pickup: trip.pickup || trip.route?.[0] || "",
      destination: trip.destination || trip.route?.[trip.route.length - 1] || "",
      status: trip.status || "pending",
      driver: trip.driver || "Pendiente de TAXOTE Driver",
      createdAt: trip.createdAt || fallbackDate,
      source: "local"
    })) : [];
  } catch {
    return [];
  }
}

function normalizeDispatchTrip(ride) {
  return {
    id: ride.id,
    service: ride.passengerType === "registered" ? "Registrado" : "Invitado",
    passenger: ride.passenger || "Pasajero TAXOTE",
    phone: ride.phone || "",
    route: [ride.pickup, ride.destination],
    pickup: ride.pickup || "",
    destination: ride.destination || "",
    driver: ride.driver || "Pendiente de TAXOTE Driver",
    status: ride.status || "pending",
    time: ride.createdAt ? new Date(ride.createdAt).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" }) : "--",
    createdAt: ride.createdAt || new Date().toISOString(),
    priceDop: Number(ride.priceDop || 0),
    source: "database"
  };
}

const CANCELLABLE_TRIP_STATUSES = new Set(["pending", "accepted", "driver_arriving", "arrived"]);
const ACTIVE_TRIP_STATUSES = new Set(["pending", "accepted", "driver_arriving", "arrived", "in_progress"]);

function tripRowMarkup(trip, isNew = false) {
  const statusLabels = {
    pending: "Pendiente",
    accepted: "Aceptado",
    driver_arriving: "Conductor en camino",
    arrived: "Conductor llegó",
    in_progress: "En viaje",
    completed: "Completado",
    cancelled: "Cancelado"
  };
  const status = statusLabels[trip.status] ? trip.status : "pending";
  const createdAt = new Date(trip.createdAt);
  const dateLabel = Number.isNaN(createdAt.getTime())
    ? escapeHtml(trip.time || "--")
    : `${createdAt.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric" })}<small>${createdAt.toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" })}</small>`;
  const cancelAction = CANCELLABLE_TRIP_STATUSES.has(status)
    ? `<button class="trip-cancel-action" type="button" data-cancel-trip="${escapeHtml(trip.id)}" aria-label="Cancelar servicio ${escapeHtml(trip.id)}" title="Cancelar servicio">×</button>`
    : status === "in_progress"
      ? '<span class="trip-cancel-lock" title="Servicio iniciado: sólo el conductor puede terminarlo">▣</span>'
      : `<span class="trip-cancel-finished" title="${status === "completed" ? "Servicio terminado" : "Servicio cancelado"}">${status === "completed" ? "✓" : "—"}</span>`;
  return `<tr class="${isNew ? "new-trip" : ""}">
    <td>${cancelAction}</td>
    <td>${escapeHtml(trip.id)}<small>${escapeHtml(trip.service || "TAXOTE User")}</small></td>
    <td><span class="status-chip status-${status}">${statusLabels[status]}</span></td>
    <td>${escapeHtml(trip.passenger || "--")}</td>
    <td>${escapeHtml(trip.phone || "--")}</td>
    <td>${escapeHtml(trip.driver || "Pendiente de TAXOTE Driver")}</td>
    <td><span class="trip-address">${escapeHtml(trip.pickup || trip.route?.[0] || "--")}</span></td>
    <td><span class="trip-address">${escapeHtml(trip.destination || trip.route?.[trip.route.length - 1] || "--")}</span></td>
    <td class="trip-date">${dateLabel}</td>
  </tr>`;
}

const tripFilterControls = {
  global: $("#trip-search"),
  id: $("#filter-trip-id"),
  status: $("#filter-trip-status"),
  passenger: $("#filter-trip-passenger"),
  phone: $("#filter-trip-phone"),
  driver: $("#filter-trip-driver"),
  pickup: $("#filter-trip-pickup"),
  destination: $("#filter-trip-destination"),
  date: $("#filter-trip-date")
};
let selectedTripForCancellation = null;

function normalizeFilterText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

function allTrips() {
  const seen = new Set();
  return [...dispatchTrips, ...savedTrips]
    .filter((trip) => trip?.id && ACTIVE_TRIP_STATUSES.has(trip.status) && !seen.has(trip.id) && seen.add(trip.id))
    .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());
}

function tripDateMatches(createdAt, filter) {
  if (!filter) return true;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (filter === "today") return date.toDateString() === now.toDateString();
  const days = filter === "7days" ? 7 : 30;
  return date.getTime() >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function tripMatchesFilters(trip) {
  const values = Object.fromEntries(Object.entries(tripFilterControls).map(([key, control]) => [key, normalizeFilterText(control.value)]));
  const searchable = normalizeFilterText([
    trip.id, trip.status, trip.service, trip.passenger, trip.phone, trip.driver,
    trip.pickup, trip.destination, ...(trip.route || [])
  ].join(" "));
  const phoneDigits = String(trip.phone || "").replace(/\D/g, "");
  const globalDigits = String(tripFilterControls.global.value || "").replace(/\D/g, "");
  const requestedPhone = String(tripFilterControls.phone.value || "").replace(/\D/g, "");
  const globalMatches = !values.global || searchable.includes(values.global) || (globalDigits.length >= 3 && phoneDigits.includes(globalDigits));
  return globalMatches
    && (!values.id || normalizeFilterText(trip.id).includes(values.id))
    && (!values.status || trip.status === values.status)
    && (!values.passenger || normalizeFilterText(trip.passenger).includes(values.passenger))
    && (!requestedPhone || phoneDigits.includes(requestedPhone))
    && (!values.driver || normalizeFilterText(trip.driver).includes(values.driver))
    && (!values.pickup || normalizeFilterText(trip.pickup || trip.route?.[0]).includes(values.pickup))
    && (!values.destination || normalizeFilterText(trip.destination || trip.route?.[trip.route.length - 1]).includes(values.destination))
    && tripDateMatches(trip.createdAt, tripFilterControls.date.value);
}

function filtersAreActive() {
  return Object.values(tripFilterControls).some((control) => control.value.trim() !== "");
}

function syncTripFilterAppearance() {
  Object.values(tripFilterControls).forEach((control) => control.classList.toggle("filter-active", control.value.trim() !== ""));
  $("#clear-trip-filters").disabled = !filtersAreActive();
}

function updateTripCounters(trips, filteredTrips) {
  const today = new Date().toDateString();
  const active = trips.filter((trip) => !["completed", "cancelled"].includes(trip.status)).length;
  const createdToday = trips.filter((trip) => new Date(trip.createdAt).toDateString() === today).length;
  $("#current-trip-count").textContent = active;
  $("#today-trip-count").textContent = createdToday;
  $("#filtered-trip-count").textContent = filtersAreActive()
    ? `${filteredTrips.length} de ${trips.length}`
    : `${trips.length} ${trips.length === 1 ? "resultado" : "resultados"}`;
}

function closeDispatchCancellationModal() {
  $("#dispatch-cancel-modal").hidden = true;
  document.body.classList.remove("dispatch-modal-open");
  selectedTripForCancellation = null;
  $("#dispatch-cancel-form").reset();
}

function openDispatchCancellationModal(trip) {
  if (!CANCELLABLE_TRIP_STATUSES.has(trip.status)) {
    showToast(trip.status === "in_progress"
      ? "El servicio ya inició. Sólo el conductor puede terminarlo desde TAXOTE Driver."
      : "Este servicio ya no se puede cancelar.");
    return;
  }
  selectedTripForCancellation = trip;
  $("#dispatch-cancel-form").reset();
  $("#dispatch-cancel-trip").textContent = `${trip.id} · ${trip.passenger} · ${trip.status === "arrived" ? "Conductor llegó" : "Cancelación permitida"}`;
  $("#dispatch-cancel-modal").hidden = false;
  document.body.classList.add("dispatch-modal-open");
  $("#dispatch-cancel-form input").focus();
}

function renderTrips(newTripId = "") {
  const trips = allTrips();
  const filteredTrips = trips.filter(tripMatchesFilters);
  const body = $("#trip-table-body");
  body.innerHTML = filteredTrips.length
    ? filteredTrips.map((trip) => tripRowMarkup(trip, trip.id === newTripId)).join("")
    : `<tr id="empty-trips-row"><td colspan="9" class="empty-trips">${trips.length ? "No hay viajes que coincidan con estos filtros." : "Los viajes nuevos aparecerán aquí cuando sean creados."}</td></tr>`;
  body.querySelectorAll("[data-cancel-trip]").forEach((button) => button.addEventListener("click", () => {
    const trip = trips.find((item) => item.id === button.dataset.cancelTrip);
    if (trip) openDispatchCancellationModal(trip);
  }));
  updateTripCounters(trips, filteredTrips);
  syncTripFilterAppearance();
}

async function loadDispatchTrips(announce = false) {
  if (location.protocol === "file:") return renderTrips();
  const refreshButton = $("#refresh-trips");
  refreshButton.disabled = true;
  try {
    const rides = await fetchJson(`/api/dispatch/rides?t=${Date.now()}`);
    dispatchTrips = rides.map(normalizeDispatchTrip);
    renderTrips();
    if (announce) showToast("Lista de viajes actualizada.");
  } catch (error) {
    if (announce) showToast(error.message);
  } finally {
    refreshButton.disabled = false;
  }
}

Object.values(tripFilterControls).forEach((control) => {
  control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => renderTrips());
});
$("#clear-trip-filters").addEventListener("click", () => {
  Object.values(tripFilterControls).forEach((control) => { control.value = ""; });
  renderTrips();
  tripFilterControls.global.focus();
});
$("#refresh-trips").addEventListener("click", () => loadDispatchTrips(true));
$("#close-dispatch-cancel").addEventListener("click", closeDispatchCancellationModal);
$("#back-dispatch-cancel").addEventListener("click", closeDispatchCancellationModal);
$("#dispatch-cancel-modal").addEventListener("pointerdown", (event) => {
  if (event.target === $("#dispatch-cancel-modal")) closeDispatchCancellationModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#dispatch-cancel-modal").hidden) closeDispatchCancellationModal();
});
$("#dispatch-cancel-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const selectedReason = $("input[name='dispatch-cancel-reason']:checked");
  if (!selectedReason) return showToast("Selecciona el motivo de cancelación.");
  if (!selectedTripForCancellation) return;
  const trip = selectedTripForCancellation;
  const button = $("#confirm-dispatch-cancel");
  button.disabled = true;
  button.textContent = "CANCELANDO…";
  try {
    if (trip.source === "database") {
      await fetchJson(`/api/dispatch/rides/${encodeURIComponent(trip.id)}/cancel`, {
        method: "POST",
        body: { reason: selectedReason.value, note: $("#dispatch-cancel-note").value }
      });
      playCancelSound();
      await loadDispatchTrips();
    } else {
      const localTrip = savedTrips.find((item) => item.id === trip.id);
      if (!localTrip || !CANCELLABLE_TRIP_STATUSES.has(localTrip.status)) {
        throw new Error(localTrip?.status === "in_progress"
          ? "El servicio ya inició. Sólo el conductor puede terminarlo desde TAXOTE Driver."
          : "Este servicio ya no se puede cancelar.");
      }
      localTrip.status = "cancelled";
      localTrip.cancelledAt = new Date().toISOString();
      localTrip.cancellationReason = selectedReason.value;
      localTrip.cancellationNote = $("#dispatch-cancel-note").value.trim();
      localTrip.cancelledBy = "dispatcher";
      try { localStorage.setItem("taxote-trips-v2", JSON.stringify(savedTrips)); } catch {}
      renderTrips();
    }
    closeDispatchCancellationModal();
    showToast(`${trip.id} fue cancelado correctamente.`);
  } catch (error) {
    showToast(error.message);
    if (trip.source === "database") await loadDispatchTrips();
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>×</span> CANCELAR SERVICIO";
  }
});

renderTrips();
loadDispatchTrips();
setInterval(loadDispatchTrips, 3000);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedLocations.pickup || !selectedLocations.destination) {
    showToast("Selecciona la recogida y el destino usando la búsqueda o el mapa.");
    return;
  }
  if (routeStops.some((stop) => !stop.location)) {
    showToast("Busca y selecciona la dirección de cada parada.");
    return;
  }
  const isGuest = serviceType.value === "Invitado";
  const guestName = $("#guest-name").value.trim();
  const guestPhoneDigits = $("#guest-phone").value.replace(/\D/g, "");
  if (!isGuest && !selectedCustomer) {
    showToast("Selecciona un cliente registrado de la lista.");
    customerInput.focus();
    return;
  }
  if (isGuest && (!guestName || !/^(809|829|849)\d{7}$/.test(guestPhoneDigits))) {
    showToast("Escribe el nombre y un teléfono válido de RD: 809, 829 o 849.");
    return;
  }
  const selectedDriver = selectedDriverId || "";
  const passengerSelection = $("#passenger-count-select")?.value || "1 pasajero";
  const paymentSelection = $("#payment-method-select")?.value || "";
  const noteText = $("#dispatch-note").value.trim();
  let scheduledAt = null;
  if (travelTime.value === "scheduled") {
    if (!scheduleDate?.value || !scheduleTime?.value) {
      showToast("Selecciona la fecha y la hora programada de República Dominicana.");
      return;
    }
    scheduledAt = new Date(`${scheduleDate.value}T${scheduleTime.value}:00-04:00`).toISOString();
    if (Date.parse(scheduledAt) <= Date.now() + 60_000) {
      showToast("El viaje programado debe tener una hora futura.");
      return;
    }
  }
  const confirmationDetails = {
    phone: isGuest ? $("#guest-phone").value : selectedCustomer.phone,
    name: isGuest ? guestName : selectedCustomer.name,
    pickup: selectedLocations.pickup,
    destination: selectedLocations.destination,
    stops: routeStops.map((stop) => stop.location).filter(Boolean),
    driverId: selectedDriver || null,
    note: noteText,
    customerName: isGuest ? guestName : selectedCustomer.name,
    customerPhone: isGuest ? $("#guest-phone").value : selectedCustomer.phone,
    travelTime: travelTime.value === "scheduled"
      ? `Programado: ${new Date(scheduledAt).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" })}`
      : "Viajar ahora",
    scheduledAt,
    passengerCount: Number.parseInt(passengerSelection, 10) || 1,
    passengerInfo: passengerSelection,
    paymentInfo: paymentSelection
  };
  try {
    const estimate = await fetchJson("/api/rides/estimate", {
      method: "POST",
      body: {
        pickup: confirmationDetails.pickup,
        destination: confirmationDetails.destination,
        stops: confirmationDetails.stops
      }
    });
    openBookingConfirmationModal({
      ...confirmationDetails,
      distanceKm: estimate.estimate.distanceKm,
      durationMin: estimate.estimate.durationMin,
      priceDop: estimate.estimate.priceDop
    });
  } catch (error) {
    showToast(error.message);
  }
});

$("#clear-form").addEventListener("click", () => {
  setTimeout(clearBookingForm, 0);
});
// Conductores reales conectados desde la aplicación Android TAXOTE Driver.
const connectedDriverSearch = $("#connected-driver-search");
const driverAssignSearch = $("#driver-assign-search");
const connectedDriversList = $("#connected-drivers-list");
const connectedDriversEmpty = $("#connected-drivers-empty");
const availableDriverCount = $("#available-driver-count");
const busyDriverCount = $("#busy-driver-count");
const driverAppStatus = $("#driver-app-status");
let connectedDrivers = [];

function renderConnectedDrivers() {
  if (!connectedDriversList) return;
  const assignRawQuery = (driverAssignSearch?.value || "").trim();
  const assignQuery = normalizeFilterText(assignRawQuery);
  const connectedRawQuery = (connectedDriverSearch?.value || "").trim();
  const connectedQuery = normalizeFilterText(connectedRawQuery);
  const driverSearchResults = $("#driver-search-results");
  const showAssignSearchResults = driverSearchResults && assignRawQuery.length >= 2;
  const visibleConnectedDrivers = connectedDrivers.filter((driver) => {
    if (!connectedQuery) return true;
    const statusText = driver.connectionState === "busy" ? "ocupado" : "disponible";
    const text = `${driver.name} ${driver.vehicleBrand} ${driver.vehicleModel} ${driver.vehicleColor} ${driver.vehiclePlate} ${statusText}`;
    return normalizeFilterText(text).includes(connectedQuery);
  });
  const visibleAssignDrivers = showAssignSearchResults
    ? connectedDrivers.filter((driver) => {
        const statusText = driver.connectionState === "busy" ? "ocupado" : "disponible";
        const text = `${driver.name} ${driver.vehicleBrand} ${driver.vehicleModel} ${driver.vehicleColor} ${driver.vehiclePlate} ${statusText}`;
        return normalizeFilterText(text).includes(assignQuery);
      })
    : [];
  availableDriverCount.textContent = connectedDrivers.filter((driver) => driver.connectionState === "available").length;
  if (busyDriverCount) busyDriverCount.textContent = connectedDrivers.filter((driver) => driver.connectionState === "busy").length;
  connectedDriversList.hidden = visibleConnectedDrivers.length === 0;
  connectedDriversEmpty.hidden = visibleConnectedDrivers.length !== 0;
  const html = visibleConnectedDrivers.map((driver) => {
    const avatarMarkup = driver.profilePhotoUrl
      ? `<span class="driver-avatar driver-avatar-photo"><img src="${escapeHtml(driver.profilePhotoUrl)}" alt="${escapeHtml(driver.name)}" loading="lazy" /></span>`
      : `<span class="driver-avatar">${escapeHtml(`${driver.firstName?.[0] || ""}${driver.lastName?.[0] || ""}`.toUpperCase())}</span>`;
    return `
      <article class="driver ${driver.connectionState === "busy" ? "driver-busy" : ""}" data-driver-id="${escapeHtml(driver.id)}" role="button" tabindex="0" aria-label="Centrar mapa en ${escapeHtml(driver.name)}">
        ${avatarMarkup}
        <div class="driver-info"><b>${escapeHtml(driver.name)}</b><small>${escapeHtml(`${driver.vehicleBrand} ${driver.vehicleModel} · ${driver.vehicleColor}`)}</small></div>
        <span class="eta ${driver.connectionState === "busy" ? "busy" : ""}">${escapeHtml(driverStatusLabel(driver))}</span>
      </article>
    `;
  }).join("");
  connectedDriversList.innerHTML = html;
  if (driverSearchResults) {
    if (showAssignSearchResults) {
      driverSearchResults.hidden = false;
      driverSearchResults.innerHTML = visibleAssignDrivers.length > 0
        ? visibleAssignDrivers.map((driver) => {
            const avatarMarkup = driver.profilePhotoUrl
              ? `<span class="driver-avatar driver-avatar-photo"><img src="${escapeHtml(driver.profilePhotoUrl)}" alt="${escapeHtml(driver.name)}" loading="lazy" /></span>`
              : `<span class="driver-avatar">${escapeHtml(`${driver.firstName?.[0] || ""}${driver.lastName?.[0] || ""}`.toUpperCase())}</span>`;
            return `
              <article class="driver ${driver.connectionState === "busy" ? "driver-busy" : ""}" data-driver-id="${escapeHtml(driver.id)}" role="button" tabindex="0" aria-label="Centrar mapa en ${escapeHtml(driver.name)}">
                ${avatarMarkup}
                <div class="driver-info"><b>${escapeHtml(driver.name)}</b><small>${escapeHtml(`${driver.vehicleBrand} ${driver.vehicleModel} · ${driver.vehicleColor}`)}</small></div>
                <span class="eta ${driver.connectionState === "busy" ? "busy" : ""}">${escapeHtml(driverStatusLabel(driver))}</span>
              </article>
            `;
          }).join("")
        : `<div class="driver-search-empty">No se encontraron conductores para «${escapeHtml(assignRawQuery)}».</div>`;
    } else {
      driverSearchResults.hidden = false;
      driverSearchResults.innerHTML = `<div class="driver-search-prompt">Escribe al menos 2 letras para buscar conductores.</div>`;
    }
  }
  [connectedDriversList, $("#driver-search-results")].forEach((container) => {
    if (!container) return;
    container.querySelectorAll("[data-driver-id]").forEach((card) => {
      const focus = () => {
        selectedDriverId = card.dataset.driverId;
        renderDriverAssignOptions();
        focusDriverOnMap(card.dataset.driverId);
      };
      card.addEventListener("click", focus);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(); }
      });
    });
  });
  renderDriverAssignOptions();
  driverAppStatus.classList.toggle("connected", connectedDrivers.length > 0);
  driverAppStatus.innerHTML = connectedDrivers.length > 0
    ? `<i></i> ${connectedDrivers.length === 1 ? "1 conductor conectado" : `${connectedDrivers.length} conductores conectados`}`
    : "<i></i> Esperando conexión con TAXOTE Driver";
}

function driverStatusLabel(driver) {
  if (driver.connectionState !== "busy") return "Disponible";
  if (["accepted", "driver_arriving"].includes(driver.activeRideStatus) && Number.isFinite(Number(driver.etaToPickupMin))) {
    return `Llega en ${Math.max(1, Number(driver.etaToPickupMin))} min`;
  }
  if (driver.activeRideStatus === "arrived") return "En recogida";
  if (driver.activeRideStatus === "in_progress") return "En viaje";
  return "En servicio";
}

function focusDriverOnMap(driverId) {
  const driver = connectedDrivers.find((item) => item.id === driverId);
  if (!driver?.location || !map) return showToast("Este conductor aún no ha compartido una ubicación válida.");
  const coordinates = [Number(driver.location.lat), Number(driver.location.lon)];
  map.flyTo(coordinates, Math.max(map.getZoom(), 16), { animate: true, duration: 1.4, easeLinearity: 0.3 });
  const marker = driverLocationMarkers.get(driverId);
  if (marker) setTimeout(() => marker.openPopup(), 1400);
  document.querySelector("#map-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadConnectedDrivers() {
  if (!connectedDriversList) return;
  try {
    const response = await fetch("/api/admin/connected-drivers", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo actualizar la flota");
    connectedDrivers = await response.json();
    renderConnectedDrivers();
    renderDriverAssignOptions();
  } catch {
    driverAppStatus.classList.remove("connected");
    driverAppStatus.innerHTML = "<i></i> Sin conexión con TAXOTE Driver";
    renderDriverAssignOptions();
  }
}

connectedDriverSearch?.addEventListener("input", () => {
  renderConnectedDrivers();
});
driverAssignSearch?.addEventListener("input", () => {
  renderConnectedDrivers();
});
if (driverAssignSearch) {
  driverAssignSearch.addEventListener("input", () => {
    renderConnectedDrivers();
  });
}
if (bookingConfirmationConfirmButton) {
  bookingConfirmationConfirmButton.addEventListener("click", submitConfirmedBooking);
}
if (bookingConfirmationCancelButton) {
  bookingConfirmationCancelButton.addEventListener("click", closeBookingConfirmationModal);
}
if (bookingConfirmationClose) {
  bookingConfirmationClose.addEventListener("click", closeBookingConfirmationModal);
}
if (bookingConfirmationModal) {
  bookingConfirmationModal.addEventListener("pointerdown", (event) => {
    if (event.target === bookingConfirmationModal) closeBookingConfirmationModal();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && bookingConfirmationModal && !bookingConfirmationModal.hidden) {
    closeBookingConfirmationModal();
  }
});
loadConnectedDrivers();
setInterval(loadConnectedDrivers, 3000);

function driverLocationIcon(driver) {
  const state = ["available", "busy", "offline"].includes(driver.connectionState) ? driver.connectionState : "offline";
  const bearing = Number(driver.location?.bearing || 0);
  return L.divIcon({
    className: "taxote-driver-car-wrapper",
    html: `<span class="taxote-driver-car ${state}" title="${state === "busy" ? "Conductor en servicio" : state === "available" ? "Conductor disponible" : "Última ubicación"}" style="transform:rotate(${bearing + 135}deg)"><img src="/assets/taxote-car.png" alt="" /></span>`,
    iconSize: [28, 31],
    iconAnchor: [14, 16]
  });
}

function driverLocationPopup(driver) {
  const state = driver.connectionState === "busy" ? "En servicio" : driver.connectionState === "available" ? "Disponible" : "Desconectado · última ubicación";
  const updated = driver.location?.updatedAt ? new Date(driver.location.updatedAt).toLocaleString("es-DO") : "Sin hora";
  return `<strong>${escapeHtml(driver.name)}</strong><br>${escapeHtml(`${driver.vehicleBrand} ${driver.vehicleModel} · ${driver.vehicleColor}`)}<br><b>${escapeHtml(state)}</b><br><small>Actualizado: ${escapeHtml(updated)}</small>`;
}

function renderDriverLocations(drivers) {
  if (!map || !driverLocationLayer || !window.L) return;
  const currentIds = new Set();
  drivers.forEach((driver) => {
    const locationData = driver.location;
    if (!locationData || !Number.isFinite(Number(locationData.lat)) || !Number.isFinite(Number(locationData.lon))) return;
    currentIds.add(driver.id);
    let marker = driverLocationMarkers.get(driver.id);
    const latLng = [Number(locationData.lat), Number(locationData.lon)];
    if (!marker) {
      marker = L.marker(latLng, { icon: driverLocationIcon(driver), zIndexOffset: driver.connectionState === "busy" ? 1200 : 900 }).addTo(driverLocationLayer);
      driverLocationMarkers.set(driver.id, marker);
    } else {
      marker.setLatLng(latLng);
      marker.setIcon(driverLocationIcon(driver));
      marker.setZIndexOffset(driver.connectionState === "busy" ? 1200 : 900);
    }
    marker.bindPopup(driverLocationPopup(driver));
  });
  for (const [id, marker] of driverLocationMarkers) {
    if (currentIds.has(id)) continue;
    driverLocationLayer.removeLayer(marker);
    driverLocationMarkers.delete(id);
  }
}

async function loadDriverLocations() {
  try {
    const response = await fetch("/api/admin/driver-locations", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("No se pudieron actualizar las ubicaciones");
    renderDriverLocations(await response.json());
  } catch {
    // Conserva la última posición conocida si la conexión falla momentáneamente.
  }
}

loadDriverLocations();
setInterval(loadDriverLocations, 3000);

// Avisos administrativos y mensajes reales de TAXOTE Driver.
const notificationButton = $("#notification-button");
const notificationPanel = $("#notification-panel");
const notificationList = $("#notification-list");
const notificationBadge = $("#notification-badge");
const headerChatBadge = $("#header-chat-badge");
let latestNotificationId = 0;
let previousHeaderChatUnread = null;
let dispatchAudioContext = null;

function enableDispatchSounds() {
  if (!dispatchAudioContext) dispatchAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (dispatchAudioContext.state === "suspended") dispatchAudioContext.resume();
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function playDispatchChatAlert() {
  if (dispatchAudioContext?.state === "running") {
    const oscillator = dispatchAudioContext.createOscillator();
    const gain = dispatchAudioContext.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(.0001, dispatchAudioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.16, dispatchAudioContext.currentTime + .04);
    gain.gain.setValueAtTime(.16, dispatchAudioContext.currentTime + 2.7);
    gain.gain.exponentialRampToValueAtTime(.0001, dispatchAudioContext.currentTime + 3);
    oscillator.connect(gain).connect(dispatchAudioContext.destination);
    oscillator.start(); oscillator.stop(dispatchAudioContext.currentTime + 3);
  }
  if ("Notification" in window && Notification.permission === "granted") new Notification("Nuevo mensaje de conductor", { body: "Abre el Chat de conductores para responder." });
}

function notificationDestination(notification) {
  if (notification.entityType === "driver") return `/drivers.html?driver=${encodeURIComponent(notification.entityId || "")}`;
  if (notification.entityType === "ride") return `/history.html?ride=${encodeURIComponent(notification.entityId || "")}`;
  if (notification.entityType === "deposit") return `/deposits.html`;
  return "#";
}

function renderNotifications(data) {
  const notifications = data.notifications || [];
  notificationBadge.textContent = data.unreadCount || 0;
  notificationBadge.hidden = !data.unreadCount;
  notificationButton.classList.toggle("has-unread", Boolean(data.unreadCount));
  notificationList.innerHTML = notifications.length ? notifications.map((item) => `
    <a class="notification-item ${item.readAt ? "read" : "unread"}" href="${notificationDestination(item)}" data-notification-id="${item.id}">
      <span class="notification-symbol ${item.kind === "cancellation" ? "cancel" : "driver"}">${item.kind === "cancellation" ? "×" : "♙"}</span>
      <span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.body)}</small><time>${escapeHtml(formatRelativeNotificationTime(item.createdAt))}</time></span>
    </a>
  `).join("") : '<p class="notification-empty">No tienes avisos todavía.</p>';
  notificationList.querySelectorAll("[data-notification-id]").forEach((link) => {
    link.addEventListener("click", () => markNotificationsRead([Number(link.dataset.notificationId)]));
  });
  const newest = notifications[0];
  if (latestNotificationId && newest && newest.id > latestNotificationId && !newest.readAt) showToast(newest.title);
  latestNotificationId = Math.max(latestNotificationId, ...notifications.map((item) => Number(item.id || 0)));

  if (newest && newest.id > latestNotificationId && !newest.readAt && newest.kind === "cancellation") {
      playCancelSound();
  }
if (newest && newest.id > latestNotificationId && newest.kind === "cancellation") {
      playCancelSound();
  }
}

function formatRelativeNotificationTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Ahora";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return new Date(timestamp).toLocaleDateString("es-DO");
}

async function markNotificationsRead(ids, all = false) {
  try {
    await fetchJson("/api/admin/notifications/read", { method: "POST", body: all ? { all: true } : { ids } });
    await loadAdminNotifications();
  } catch (error) { showToast(error.message); }
}

async function loadAdminNotifications() {
  if (!notificationList) return;
  try { renderNotifications(await fetchJson("/api/admin/notifications")); } catch { /* conserva el último estado visible */ }
}

async function loadChatUnreadCount() {
  if (!headerChatBadge) return;
  try {
    const data = await fetchJson("/api/admin/chats");
    headerChatBadge.textContent = data.unreadCount || 0;
    headerChatBadge.hidden = !data.unreadCount;
    if (previousHeaderChatUnread !== null && data.unreadCount > previousHeaderChatUnread) playDispatchChatAlert();
    previousHeaderChatUnread = Number(data.unreadCount || 0);
  } catch { /* reintenta en la próxima actualización */ }
}

notificationButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = notificationPanel.hidden;
  notificationPanel.hidden = !willOpen;
  notificationButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) loadAdminNotifications();
});
$("#read-all-notifications")?.addEventListener("click", () => markNotificationsRead([], true));
document.addEventListener("click", (event) => {
  if (!notificationPanel?.hidden && !notificationPanel.contains(event.target) && event.target !== notificationButton) {
    notificationPanel.hidden = true;
    notificationButton?.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("pointerdown", enableDispatchSounds, { once: true });

loadAdminNotifications();
loadChatUnreadCount();
setInterval(loadAdminNotifications, 30_000);
setInterval(loadChatUnreadCount, 5_000);
