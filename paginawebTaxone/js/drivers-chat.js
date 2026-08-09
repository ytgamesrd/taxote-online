const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
let conversations = [];
let selectedChannel = "public";
let selectedDriverId = null;
let currentMessagesFingerprint = "";
let previousUnreadTotal = null;
let notificationAudioContext = null;

async function api(url, options = {}) {
  const response = await fetch(url, { method: options.method || "GET", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: options.body ? JSON.stringify(options.body) : undefined, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

function toast(message) {
  const element = $("#chat-toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 2800);
}

function enableChatAlerts() {
  if (!notificationAudioContext) notificationAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (notificationAudioContext.state === "suspended") notificationAudioContext.resume();
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function playIncomingMessageAlert() {
  if (notificationAudioContext?.state === "running") {
    const oscillator = notificationAudioContext.createOscillator();
    const gain = notificationAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, notificationAudioContext.currentTime);
    gain.gain.setValueAtTime(.0001, notificationAudioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.16, notificationAudioContext.currentTime + .04);
    gain.gain.setValueAtTime(.16, notificationAudioContext.currentTime + 2.7);
    gain.gain.exponentialRampToValueAtTime(.0001, notificationAudioContext.currentTime + 3);
    oscillator.connect(gain).connect(notificationAudioContext.destination);
    oscillator.start(); oscillator.stop(notificationAudioContext.currentTime + 3);
  }
  if ("Notification" in window && Notification.permission === "granted") new Notification("Nuevo mensaje de conductor", { body: "Un conductor escribió a la Central." });
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 4 * 1024 * 1024) return reject(new Error("La foto debe pesar menos de 4 MB."));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la foto."));
    reader.readAsDataURL(file);
  });
}

function initials(driver) { return `${driver.firstName?.[0] || ""}${driver.lastName?.[0] || ""}`.toUpperCase(); }
function timeLabel(value) { return value ? new Date(value).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : ""; }

function renderConversations() {
  const query = $("#conversation-search").value.trim().toLocaleLowerCase("es");
  const visible = conversations.filter((item) => !query || `${item.driver.name} ${item.driver.phone} ${item.driver.vehicleBrand} ${item.driver.vehicleModel}`.toLocaleLowerCase("es").includes(query));
  $("#conversation-empty").hidden = visible.length !== 0;
  $("#conversation-list").innerHTML = visible.map((item) => `
    <button class="conversation-card ${selectedDriverId === item.driver.id ? "active" : ""}" type="button" data-driver-id="${escapeHtml(item.driver.id)}">
      <span class="conversation-avatar">${escapeHtml(initials(item.driver))}</span>
      <span><b>${escapeHtml(item.driver.name)}</b><small>${escapeHtml(item.latestMessage?.message || `${item.driver.vehicleBrand} ${item.driver.vehicleModel}`)}</small></span>
      ${item.unreadCount ? `<span class="unread-badge">${item.unreadCount}</span>` : ""}
    </button>`).join("");
  $("#conversation-list").querySelectorAll("[data-driver-id]").forEach((button) => button.addEventListener("click", () => selectPrivate(button.dataset.driverId)));
}

async function loadConversations() {
  try {
    const data = await api("/api/admin/chats");
    conversations = data.conversations || [];
    if (previousUnreadTotal !== null && data.unreadCount > previousUnreadTotal) playIncomingMessageAlert();
    previousUnreadTotal = Number(data.unreadCount || 0);
    renderConversations();
  } catch (error) { toast(error.message); }
}

function selectPublic() {
  selectedChannel = "public";
  selectedDriverId = null;
  $("#public-conversation").classList.add("active");
  $("#current-avatar").textContent = "▤";
  $("#current-kicker").textContent = "CANAL GENERAL";
  $("#current-name").textContent = "Chat público";
  $("#current-status").textContent = "Visible para todos los conductores";
  renderConversations();
  loadMessages(true);
}

async function selectPrivate(driverId) {
  const item = conversations.find((conversation) => conversation.driver.id === driverId);
  if (!item) return;
  selectedChannel = "private";
  selectedDriverId = driverId;
  $("#public-conversation").classList.remove("active");
  $("#current-avatar").textContent = initials(item.driver);
  $("#current-kicker").textContent = "CONVERSACIÓN PRIVADA";
  $("#current-name").textContent = item.driver.name;
  $("#current-status").textContent = `${item.driver.online ? "Conectado" : "Desconectado"} · ${item.driver.vehicleBrand} ${item.driver.vehicleModel}`;
  await api(`/api/admin/chats/${encodeURIComponent(driverId)}/read`, { method: "POST" }).catch(() => {});
  await loadConversations();
  await loadMessages(true);
}

function renderMessages(messages, forceScroll = false) {
  const fingerprint = messages.map((message) => `${message.id}:${message.driverReadAt || ""}`).join("|");
  if (fingerprint === currentMessagesFingerprint && !forceScroll) return;
  const list = $("#message-list");
  const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  currentMessagesFingerprint = fingerprint;
  list.innerHTML = messages.length ? messages.map((message) => `
    <div class="message-row ${message.sender === "admin" ? "admin" : "driver"}"><div class="message-bubble"><b>${escapeHtml(message.sender === "admin" ? "Administrador" : message.driverName)}</b>${message.photoUrl ? `<img class="chat-photo" src="${escapeHtml(message.photoUrl)}" alt="Foto enviada en el chat" />` : ""}${message.message && message.message !== "Foto" ? `<p>${escapeHtml(message.message)}</p>` : ""}<time>${escapeHtml(timeLabel(message.createdAt))}</time></div></div>
  `).join("") : '<div class="messages-empty"><span>▤</span><b>La conversación está lista</b><small>Sé el primero en escribir un mensaje.</small></div>';
  if (forceScroll || wasAtBottom) list.scrollTop = list.scrollHeight;
}

async function loadMessages(forceScroll = false) {
  const selectedAtStart = `${selectedChannel}:${selectedDriverId || ""}`;
  const url = selectedChannel === "public" ? "/api/admin/chats/public" : `/api/admin/chats/${encodeURIComponent(selectedDriverId)}/messages`;
  try {
    const data = await api(url);
    if (selectedAtStart !== `${selectedChannel}:${selectedDriverId || ""}`) return;
    renderMessages(data.messages || [], forceScroll);
  } catch (error) { toast(error.message); }
}

$("#message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#message-input");
  const message = input.value.trim();
  const photoInput = $("#message-photo");
  const photoFile = photoInput.files?.[0] || null;
  if (!message && !photoFile) return;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const url = selectedChannel === "public" ? "/api/admin/chats/public" : `/api/admin/chats/${encodeURIComponent(selectedDriverId)}/messages`;
    await api(url, { method: "POST", body: { message, photo: await fileAsDataUrl(photoFile) } });
    input.value = "";
    photoInput.value = "";
    $("#photo-name").hidden = true;
    await loadMessages(true);
    await loadConversations();
  } catch (error) { toast(error.message); } finally { button.disabled = false; input.focus(); }
});

$("#public-conversation").addEventListener("click", selectPublic);
$("#conversation-search").addEventListener("input", renderConversations);
$("#message-photo").addEventListener("change", (event) => {
  enableChatAlerts();
  const file = event.target.files?.[0];
  const label = $("#photo-name");
  label.textContent = file ? `📷 ${file.name}` : "";
  label.hidden = !file;
});
document.addEventListener("pointerdown", enableChatAlerts, { once: true });
loadConversations().then(selectPublic);
setInterval(() => { loadConversations(); loadMessages(); }, 3000);
