const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

const state = {
  mode: null,
  user: null,
  guestProfile: null,
  addresses: [],
  pendingRides: [],
  pendingEstimate: null,
  pendingRideRequest: null,
  cancelRide: null,
  chatRideId: null,
  chatPhoto: null,
  lastChatIncomingId: 0,
  lastUnreadCount: -1,
  selected: { pickup: null, destination: null }
};

const authView = $("#auth-view");
const rideView = $("#ride-view");
const loginForm = $("#login-form");
const registerForm = $("#register-form");
const guestPhone = $("#guest-phone");
const guestName = $("#guest-name");
const guestLookupStatus = $("#guest-lookup-status");
const toast = $("#user-toast");
let toastTimer;
let guestLookupTimer;
let guestLookupRequestId = 0;

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3800);
}

function formatDop(value) {
  return `RD$${new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
}

function shortAddress(address) {
  return String(address || "").split(",").slice(0, 3).join(",");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la solicitud.");
  return body;
}

function phoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function validDominicanPhone(value) {
  return /^(809|829|849)\d{7}$/.test(phoneDigits(value));
}

function formatPhoneInput(value) {
  const digits = phoneDigits(value);
  if (digits.length > 6) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  if (digits.length > 3) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return digits;
}

function bindPhoneInput(input, onComplete) {
  input.addEventListener("input", () => {
    input.value = formatPhoneInput(input.value);
    onComplete?.(validDominicanPhone(input.value));
  });
}

function setAuthTab(tab) {
  const loginActive = tab === "login";
  $("#login-tab").classList.toggle("active", loginActive);
  $("#register-tab").classList.toggle("active", !loginActive);
  $("#login-tab").setAttribute("aria-selected", String(loginActive));
  $("#register-tab").setAttribute("aria-selected", String(!loginActive));
  loginForm.hidden = !loginActive;
  registerForm.hidden = loginActive;
  (loginActive ? $("#login-phone") : $("#register-name")).focus();
}

$("#login-tab").addEventListener("click", () => setAuthTab("login"));
$("#register-tab").addEventListener("click", () => setAuthTab("register"));

function initials(name) {
  return String(name || "TU").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function resetRideSelection() {
  state.selected.pickup = null;
  state.selected.destination = null;
  $("#user-pickup").value = "";
  $("#user-destination").value = "";
  $("#ride-confirmation").hidden = true;
  updateRideSummary();
}

function openRideView(mode, data = {}) {
  state.mode = mode;
  state.user = mode === "registered" ? data.user : null;
  state.guestProfile = null;
  state.addresses = data.addresses || [];
  state.pendingRides = [];
  authView.hidden = true;
  rideView.hidden = false;
  $("#registered-summary").hidden = mode !== "registered";
  $("#guest-identity").hidden = mode !== "guest";
  $("#leave-ride-view").textContent = mode === "registered" ? "Cerrar sesión" : "Volver";
  if (mode === "registered") {
    $("#ride-greeting").textContent = `Hola, ${state.user.name.split(" ")[0]}`;
    $("#registered-name").textContent = state.user.name;
    $("#registered-contact").textContent = `${state.user.phone} · ${state.user.email}`;
    $("#registered-avatar").textContent = initials(state.user.name);
  } else {
    $("#ride-greeting").textContent = "Viaja como invitado";
    guestPhone.value = "";
    guestName.value = "";
    guestName.readOnly = false;
    guestLookupStatus.textContent = "Escribe el teléfono y toca la lupa.";
    guestLookupStatus.className = "lookup-status";
  }
  resetRideSelection();
  renderAddressHistory();
  renderPendingRides();
  if (mode === "registered") loadPendingRides();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAuthView() {
  state.mode = null;
  state.user = null;
  state.guestProfile = null;
  state.addresses = [];
  state.pendingRides = [];
  rideView.hidden = true;
  authView.hidden = false;
  renderAddressHistory();
  renderPendingRides();
  setAuthTab("login");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#guest-entry").addEventListener("click", () => openRideView("guest"));
$("#leave-ride-view").addEventListener("click", async () => {
  if (state.mode === "registered") {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  }
  openAuthView();
});

bindPhoneInput($("#login-phone"));
bindPhoneInput($("#register-phone"));
bindPhoneInput(guestPhone, (complete) => {
  clearTimeout(guestLookupTimer);
  guestLookupRequestId += 1;
  state.guestProfile = null;
  state.addresses = [];
  state.pendingRides = [];
  guestName.value = "";
  guestName.readOnly = false;
  guestLookupStatus.textContent = complete ? "Buscando si este número ya existe…" : "Completa un número 809, 829 o 849.";
  guestLookupStatus.className = "lookup-status";
  renderAddressHistory();
  renderPendingRides();
  if (complete) guestLookupTimer = setTimeout(() => lookupGuest(false), 450);
});

$(".show-password").addEventListener("click", (event) => {
  const input = $("#login-password");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  event.currentTarget.textContent = showing ? "Ver" : "Ocultar";
  event.currentTarget.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: { phone: $("#login-phone").value, password: $("#login-password").value }
    });
    openRideView("registered", data);
    showToast(`Bienvenido, ${data.user.name}.`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = registerForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: {
        name: $("#register-name").value,
        phone: $("#register-phone").value,
        email: $("#register-email").value,
        password: $("#register-password").value,
        passwordConfirm: $("#register-confirm").value
      }
    });
    registerForm.reset();
    openRideView("registered", data);
    showToast("Tu cuenta TAXOTE fue creada correctamente.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

async function lookupGuest(announce = true) {
  if (!validDominicanPhone(guestPhone.value)) {
    if (announce) showToast("Escribe un número dominicano completo.", "error");
    return;
  }
  const requestId = ++guestLookupRequestId;
  const searchedPhone = guestPhone.value;
  const button = $("#lookup-guest");
  button.disabled = true;
  try {
    const data = await api(`/api/contacts/lookup?phone=${encodeURIComponent(searchedPhone)}`);
    if (requestId !== guestLookupRequestId || searchedPhone !== guestPhone.value) return;
    if (data.found) {
      state.guestProfile = data.profile;
      state.addresses = data.addresses || [];
      guestName.value = data.profile.name;
      guestName.readOnly = true;
      guestLookupStatus.textContent = `${data.profile.name} encontrado. Puedes reutilizar sus direcciones.`;
      guestLookupStatus.className = "lookup-status found";
      if (announce) showToast("Número encontrado; cargamos el nombre y las direcciones anteriores.");
      loadPendingRides();
    } else {
      state.guestProfile = null;
      state.addresses = [];
      guestName.value = "";
      guestName.readOnly = false;
      guestLookupStatus.textContent = "Número nuevo. Escribe el nombre para guardarlo.";
      guestLookupStatus.className = "lookup-status new";
      guestName.focus();
      if (announce) showToast("Número nuevo; necesitamos el nombre del invitado.");
      state.pendingRides = [];
      renderPendingRides();
    }
    renderAddressHistory();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

$("#lookup-guest").addEventListener("click", () => lookupGuest(true));
guestName.addEventListener("blur", async () => {
  if (guestName.readOnly || !validDominicanPhone(guestPhone.value) || guestName.value.trim().length < 2) return;
  clearTimeout(guestLookupTimer);
  guestLookupRequestId += 1;
  try {
    const data = await api("/api/guest/profile", { method: "POST", body: { phone: guestPhone.value, name: guestName.value } });
    state.guestProfile = data.profile;
    state.addresses = data.addresses || [];
    guestName.value = data.profile.name;
    guestName.readOnly = true;
    guestLookupStatus.textContent = "Invitado guardado. Ya puedes elegir la ruta.";
    guestLookupStatus.className = "lookup-status found";
    renderAddressHistory();
    loadPendingRides();
  } catch (error) {
    showToast(error.message, "error");
  }
});

function renderAddressHistory() {
  const list = $("#address-history");
  const addresses = state.addresses || [];
  $("#history-count").textContent = String(addresses.length);
  $("#history-empty").hidden = addresses.length > 0;
  list.innerHTML = addresses.map((location, index) => `
    <article class="saved-address">
      <p>${escapeHtml(location.address)}</p>
      <div class="saved-address-actions">
        <button type="button" data-history-index="${index}" data-use="pickup">Usar en recogida</button>
        <button type="button" data-history-index="${index}" data-use="destination">Usar en destino</button>
      </div>
    </article>`).join("");
  list.querySelectorAll("button[data-history-index]").forEach((button) => button.addEventListener("click", () => {
    const location = addresses[Number(button.dataset.historyIndex)];
    setRideLocation(button.dataset.use, location);
    showToast(`Dirección anterior colocada como ${button.dataset.use === "pickup" ? "recogida" : "destino"}.`);
  }));
}

function pendingStatusLabel(status) {
  return ({
    pending: "PENDIENTE",
    accepted: "ACEPTADO",
    driver_arriving: "CONDUCTOR EN CAMINO",
    arrived: "EL CONDUCTOR LLEGÓ",
    in_progress: "VIAJE INICIADO"
  })[status] || "EN CURSO";
}

const CANCELLABLE_USER_RIDE_STATUSES = new Set(["pending", "accepted", "driver_arriving", "arrived"]);
const CHAT_USER_RIDE_STATUSES = new Set(["accepted", "driver_arriving", "arrived", "in_progress"]);

function renderPendingRides() {
  const list = $("#pending-rides");
  const rides = state.pendingRides || [];
  $("#pending-count").textContent = String(rides.length);
  $("#pending-empty").hidden = rides.length > 0;
  list.innerHTML = rides.map((ride) => {
    const cancelControl = CANCELLABLE_USER_RIDE_STATUSES.has(ride.status)
      ? `<button class="cancel-ride" type="button" data-cancel-ride="${escapeHtml(ride.id)}" aria-label="Cancelar servicio ${escapeHtml(ride.id)}">×</button>`
      : '<span class="ride-cancel-locked" title="El viaje ya inició">▣</span>';
    const lockNotice = ride.status === "in_progress"
      ? '<p class="ride-lock-note">Este viaje ya inició. Sólo el conductor puede terminarlo desde TAXOTE Driver.</p>'
      : "";
    const chatControl = CHAT_USER_RIDE_STATUSES.has(ride.status)
      ? `<button class="open-ride-chat" type="button" data-chat-ride="${escapeHtml(ride.id)}">CHAT CON EL CONDUCTOR</button>`
      : "";
    return `
    <article class="pending-ride ride-${escapeHtml(ride.status)}">
      <div class="pending-ride-top"><span class="pending-status">${pendingStatusLabel(ride.status)}</span><strong class="pending-price">${formatDop(ride.priceDop)}</strong></div>
      <div class="pending-route">
        <div class="pending-stop"><i></i><span title="${escapeHtml(ride.pickup.address)}">${escapeHtml(shortAddress(ride.pickup.address))}</span></div>
        <div class="pending-stop"><i></i><span title="${escapeHtml(ride.destination.address)}">${escapeHtml(shortAddress(ride.destination.address))}</span></div>
      </div>
      <p class="pending-meta">${escapeHtml(ride.id)} · ${ride.distanceKm.toFixed(1)} km · ${ride.durationMin} min</p>
      ${lockNotice}
      ${chatControl}
      ${cancelControl}
    </article>`;
  }).join("");
  list.querySelectorAll("[data-cancel-ride]").forEach((button) => button.addEventListener("click", () => {
    const ride = rides.find((item) => item.id === button.dataset.cancelRide);
    if (ride) openCancellationModal(ride);
  }));
  list.querySelectorAll("[data-chat-ride]").forEach((button) => button.addEventListener("click", () => openRideChat(button.dataset.chatRide)));
}

async function loadPendingRides() {
  if (state.mode === "guest" && !validDominicanPhone(guestPhone.value)) {
    state.pendingRides = [];
    renderPendingRides();
    return;
  }
  try {
    const suffix = state.mode === "guest" ? `?phone=${encodeURIComponent(guestPhone.value)}` : "";
    const data = await api(`/api/rides/mine${suffix}`);
    state.pendingRides = data.rides || [];
    renderPendingRides();
  } catch (error) {
    state.pendingRides = [];
    renderPendingRides();
    showToast(error.message, "error");
  }
}

function locationFromSearchResult(result) {
  return { address: result.display_name, lat: Number(result.lat), lon: Number(result.lon) };
}

const addressTargets = [
  { kind: "pickup", input: $("#user-pickup"), results: $("#user-pickup-results"), button: $("#search-user-pickup") },
  { kind: "destination", input: $("#user-destination"), results: $("#user-destination-results"), button: $("#search-user-destination") }
];

function setResultVisibility(target, visible) {
  target.results.hidden = !visible;
  target.input.setAttribute("aria-expanded", String(visible));
  if (!visible) {
    target.activeOption = -1;
    target.input.removeAttribute("aria-activedescendant");
  }
}

function addressOptionMarkup(result) {
  const main = result.name || result.address?.road || result.address?.suburb || result.display_name.split(",")[0];
  return `<span><b>${escapeHtml(main)}</b><small>${escapeHtml(result.display_name)}</small></span>`;
}

async function chooseSearchResult(target, result) {
  target.results.innerHTML = '<div class="user-address-message">Obteniendo la dirección completa…</div>';
  try {
    const resolved = result.lat !== undefined && result.lon !== undefined ? result : await api(`/api/place?id=${encodeURIComponent(result.place_id)}`);
    setRideLocation(target.kind, locationFromSearchResult(resolved));
    setResultVisibility(target, false);
  } catch (error) {
    target.results.innerHTML = `<div class="user-address-message">${escapeHtml(error.message)}</div>`;
    showToast(error.message, "error");
  }
}

function activateResult(target, index) {
  const options = [...target.results.querySelectorAll(".user-address-option")];
  if (!options.length) return;
  const active = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => option.classList.toggle("keyboard-active", optionIndex === active));
  target.activeOption = active;
  target.input.setAttribute("aria-activedescendant", options[active].id);
  options[active].scrollIntoView({ block: "nearest" });
}

async function searchAddress(target, announceShort = true) {
  const query = target.input.value.trim();
  if (query.length < 3) {
    setResultVisibility(target, false);
    if (announceShort) showToast("Escribe al menos tres letras de la dirección.", "error");
    return;
  }
  const requestId = target.requestId = (target.requestId || 0) + 1;
  target.activeOption = -1;
  target.results.innerHTML = '<div class="user-address-message">Buscando en República Dominicana…</div>';
  setResultVisibility(target, true);
  try {
    const results = (await api(`/api/geocode?q=${encodeURIComponent(query)}`)).slice(0, 6);
    if (requestId !== target.requestId) return;
    const options = results.map((result, index) => `<button id="${target.results.id}-option-${index}" class="user-address-option" type="button" data-result-index="${index}">${addressOptionMarkup(result)}</button>`).join("");
    const provider = results.some((result) => result.provider === "google") ? "Direcciones de Google Maps" : "Datos © OpenStreetMap";
    target.results.innerHTML = options ? `${options}<div class="user-address-attribution">${provider}</div>` : '<div class="user-address-message">No encontramos esa dirección. Añade sector, municipio o provincia.</div>';
    target.results.querySelectorAll(".user-address-option").forEach((button, index) => {
      button.addEventListener("mouseenter", () => activateResult(target, index));
      button.addEventListener("click", () => chooseSearchResult(target, results[Number(button.dataset.resultIndex)]));
    });
  } catch (error) {
    if (requestId !== target.requestId) return;
    target.results.innerHTML = `<div class="user-address-message">${escapeHtml(error.message)}</div>`;
  }
}

addressTargets.forEach((target) => {
  target.input.setAttribute("role", "combobox");
  target.input.setAttribute("aria-autocomplete", "list");
  target.input.setAttribute("aria-controls", target.results.id);
  target.input.setAttribute("aria-expanded", "false");
  target.results.setAttribute("role", "listbox");
  target.input.addEventListener("input", () => {
    clearTimeout(target.timer);
    target.requestId = (target.requestId || 0) + 1;
    state.selected[target.kind] = null;
    updateRideSummary();
    if (target.input.value.trim().length < 3) return setResultVisibility(target, false);
    target.results.innerHTML = '<div class="user-address-message">Espera un momento…</div>';
    setResultVisibility(target, true);
    target.timer = setTimeout(() => searchAddress(target, false), 350);
  });
  target.input.addEventListener("keydown", (event) => {
    const options = [...target.results.querySelectorAll(".user-address-option")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return searchAddress(target);
      activateResult(target, (target.activeOption ?? -1) + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!target.results.hidden && target.activeOption >= 0 && options[target.activeOption]) options[target.activeOption].click();
      else searchAddress(target);
    } else if (event.key === "Escape") setResultVisibility(target, false);
  });
  target.button.addEventListener("click", () => { clearTimeout(target.timer); searchAddress(target); });
});

document.addEventListener("pointerdown", (event) => {
  addressTargets.forEach((target) => {
    if (!target.input.closest(".user-address-field")?.contains(event.target)) setResultVisibility(target, false);
  });
});

function setRideLocation(kind, location) {
  state.selected[kind] = { address: location.address, lat: Number(location.lat), lon: Number(location.lon) };
  $(kind === "pickup" ? "#user-pickup" : "#user-destination").value = location.address;
  updateRideSummary();
}

function updateRideSummary() {
  const summary = $("#ride-summary");
  const ready = Boolean(state.selected.pickup && state.selected.destination);
  summary.classList.toggle("ready", ready);
  summary.innerHTML = ready
    ? `<span>✓</span><p>Ruta lista: ${escapeHtml(state.selected.pickup.address.split(",")[0])} → ${escapeHtml(state.selected.destination.address.split(",")[0])}</p>`
    : '<span>✦</span><p>Selecciona la recogida y el destino.</p>';
}

function rideRequestBody() {
  return {
    phone: state.mode === "guest" ? guestPhone.value : undefined,
    name: state.mode === "guest" ? guestName.value : undefined,
    pickup: state.selected.pickup,
    destination: state.selected.destination
  };
}

function setModalVisibility(modal, visible) {
  modal.hidden = !visible;
  document.body.classList.toggle("modal-open", !$("#fare-modal").hidden || !$("#cancel-modal").hidden || !$("#ride-chat-modal").hidden);
}

function closeFareModal() {
  setModalVisibility($("#fare-modal"), false);
  state.pendingEstimate = null;
  state.pendingRideRequest = null;
}

function openFareModal(data, requestBody) {
  state.pendingEstimate = data.estimate;
  state.pendingRideRequest = requestBody;
  $("#fare-pickup").textContent = data.pickup.address;
  $("#fare-destination").textContent = data.destination.address;
  $("#fare-price").textContent = formatDop(data.estimate.priceDop);
  $("#fare-distance").textContent = `${data.estimate.distanceKm.toFixed(1)} km`;
  $("#fare-duration").textContent = `${data.estimate.durationMin} min`;
  setModalVisibility($("#fare-modal"), true);
  $("#confirm-ride").focus();
}

function closeCancellationModal() {
  setModalVisibility($("#cancel-modal"), false);
  state.cancelRide = null;
  $("#cancellation-form").reset();
}

function openCancellationModal(ride) {
  state.cancelRide = ride;
  $("#cancellation-form").reset();
  setModalVisibility($("#cancel-modal"), true);
  $("#cancel-modal-title").textContent = "¿Por qué deseas cancelar?";
  $("#cancel-modal .cancel-reasons input").focus();
}

document.querySelectorAll("[data-close-modal='fare']").forEach((button) => button.addEventListener("click", closeFareModal));
document.querySelectorAll("[data-close-modal='cancel']").forEach((button) => button.addEventListener("click", closeCancellationModal));
[$("#fare-modal"), $("#cancel-modal")].forEach((modal) => modal.addEventListener("pointerdown", (event) => {
  if (event.target !== modal) return;
  if (modal.id === "fare-modal") closeFareModal();
  else closeCancellationModal();
}));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#ride-chat-modal").hidden) closeRideChat();
  else if (!$("#cancel-modal").hidden) closeCancellationModal();
  else if (!$("#fare-modal").hidden) closeFareModal();
});

$("#ride-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selected.pickup || !state.selected.destination) return showToast("Selecciona la recogida y el destino.", "error");
  if (state.mode === "guest" && (!validDominicanPhone(guestPhone.value) || guestName.value.trim().length < 2)) return showToast("Completa el teléfono y el nombre del invitado.", "error");
  const button = $("#request-ride");
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = "CALCULANDO PRECIO…";
  try {
    const requestBody = rideRequestBody();
    const data = await api("/api/rides/estimate", { method: "POST", body: requestBody });
    openFareModal(data, requestBody);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
});

$("#confirm-ride").addEventListener("click", async () => {
  if (!state.pendingRideRequest) return;
  const button = $("#confirm-ride");
  const requestBody = state.pendingRideRequest;
  button.disabled = true;
  button.textContent = "GUARDANDO SERVICIO…";
  try {
    const data = await api("/api/rides", { method: "POST", body: requestBody });
    state.addresses = data.addresses || [];
    if (state.mode === "guest") {
      state.guestProfile = data.profile;
      guestName.value = data.profile.name;
      guestName.readOnly = true;
    }
    renderAddressHistory();
    closeFareModal();
    state.pendingRides = [data.ride, ...state.pendingRides.filter((ride) => ride.id !== data.ride.id)];
    renderPendingRides();
    $("#confirmation-id").textContent = `Código ${data.ride.id} · ${formatDop(data.ride.priceDop)} · pendiente de asignación`;
    $("#ride-confirmation").hidden = false;
    showToast("Servicio confirmado. Está pendiente de un conductor TAXOTE.");
    loadPendingRides();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = "CONFIRMAR Y PEDIR <span>→</span>";
  }
});

$("#cancellation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const selectedReason = $("input[name='cancellation-reason']:checked");
  if (!selectedReason) return showToast("Selecciona por qué deseas cancelar.", "error");
  if (!state.cancelRide) return;
  const button = $("#submit-cancellation");
  const rideId = state.cancelRide.id;
  button.disabled = true;
  button.textContent = "CANCELANDO…";
  try {
    await api(`/api/rides/${encodeURIComponent(rideId)}/cancel`, {
      method: "POST",
      body: {
        phone: state.mode === "guest" ? guestPhone.value : undefined,
        reason: selectedReason.value,
        note: $("#cancellation-note").value
      }
    });
    state.pendingRides = state.pendingRides.filter((ride) => ride.id !== rideId);
    renderPendingRides();
    closeCancellationModal();
    showToast("El servicio fue cancelado correctamente.");
    loadPendingRides();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>×</span> CANCELAR SERVICIO";
  }
});

function guestChatPhone() {
  return state.mode === "guest" ? phoneDigits(guestPhone.value) : "";
}

function playUserChatAlert(message = "Tu conductor te escribió") {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = .12;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 3);
    oscillator.addEventListener("ended", () => context.close());
  } catch {}
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Nuevo mensaje TAXOTE", { body: message, icon: "favicon.svg" });
  }
}

document.addEventListener("pointerdown", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}, { once: true });

function chatUrl(rideId) {
  const phone = guestChatPhone();
  return `/api/user/rides/${encodeURIComponent(rideId)}/chat${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`;
}

function formatChatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function renderRideChat(messages = []) {
  const list = $("#ride-chat-messages");
  if (!messages.length) {
    list.innerHTML = '<p class="ride-chat-empty">Todavía no hay mensajes. Puedes escribirle al conductor.</p>';
    state.lastChatIncomingId = 0;
    return;
  }
  let newestIncomingId = 0;
  list.innerHTML = messages.map((message) => {
    const mine = message.sender === "passenger";
    if (!mine) newestIncomingId = Math.max(newestIncomingId, Number(message.id || 0));
    const author = mine ? "Tú" : message.sender === "admin" ? "Central TAXOTE" : message.driverName || "Conductor";
    const content = message.messageType === "photo" && message.photoUrl
      ? `<img src="${escapeHtml(message.photoUrl)}" alt="Foto del chat" />`
      : `<p>${escapeHtml(message.message)}</p>`;
    return `<article class="ride-chat-bubble${mine ? " mine" : ""}"><b>${escapeHtml(author)}</b>${content}<small>${escapeHtml(formatChatDate(message.createdAt))}</small></article>`;
  }).join("");
  if (state.lastChatIncomingId > 0 && newestIncomingId > state.lastChatIncomingId) playUserChatAlert();
  state.lastChatIncomingId = Math.max(state.lastChatIncomingId, newestIncomingId);
  list.scrollTop = list.scrollHeight;
}

async function loadRideChat(silent = false) {
  if (!state.chatRideId || $("#ride-chat-modal").hidden) return;
  try {
    const data = await api(chatUrl(state.chatRideId));
    $("#ride-chat-title").textContent = `Chat con ${data.driverName || "tu conductor"}`;
    renderRideChat(data.messages || []);
  } catch (error) {
    if (!silent) showToast(error.message, "error");
    closeRideChat();
    loadPendingRides();
  }
}

function openRideChat(rideId) {
  state.chatRideId = rideId;
  state.chatPhoto = null;
  state.lastChatIncomingId = 0;
  $("#ride-chat-photo").value = "";
  $("#ride-chat-photo-name").textContent = "";
  setModalVisibility($("#ride-chat-modal"), true);
  loadRideChat();
}

function closeRideChat() {
  setModalVisibility($("#ride-chat-modal"), false);
  state.chatRideId = null;
  state.chatPhoto = null;
  state.lastChatIncomingId = 0;
}

$("#close-ride-chat").addEventListener("click", closeRideChat);
$("#ride-chat-modal").addEventListener("pointerdown", (event) => { if (event.target === event.currentTarget) closeRideChat(); });

$("#ride-chat-photo").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  state.chatPhoto = null;
  $("#ride-chat-photo-name").textContent = "";
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 4 * 1024 * 1024) {
    event.target.value = "";
    return showToast("Selecciona una foto de hasta 4 MB.", "error");
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.chatPhoto = reader.result;
    $("#ride-chat-photo-name").textContent = file.name;
  };
  reader.readAsDataURL(file);
});

$("#ride-chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#ride-chat-input").value.trim();
  if (!message && !state.chatPhoto) return;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await api(chatUrl(state.chatRideId), { method: "POST", body: { message, photo: state.chatPhoto || undefined, phone: guestChatPhone() || undefined } });
    $("#ride-chat-input").value = "";
    $("#ride-chat-photo").value = "";
    $("#ride-chat-photo-name").textContent = "";
    state.chatPhoto = null;
    await loadRideChat();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

async function pollUserChatUnread() {
  if (!state.mode) return;
  try {
    const phone = guestChatPhone();
    const data = await api(`/api/user/chat/unread${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`);
    const unread = Number(data.unreadCount || 0);
    if (state.lastUnreadCount >= 0 && unread > state.lastUnreadCount) playUserChatAlert();
    state.lastUnreadCount = unread;
    if (!$("#ride-chat-modal").hidden) loadRideChat(true);
  } catch {}
}

async function restoreSession() {
  try {
    const data = await api("/api/auth/me");
    openRideView("registered", data);
  } catch {
    authView.hidden = false;
    rideView.hidden = true;
  }
}

restoreSession();
setInterval(() => {
  if (state.mode) loadPendingRides();
  pollUserChatUnread();
}, 5000);
