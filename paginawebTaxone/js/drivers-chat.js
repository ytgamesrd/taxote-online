const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
let conversations = [];
let selectedChannel = "private";
let selectedDriverId = null;
let currentMessagesFingerprint = "";
let previousUnreadTotal = null;
let notificationAudioContext = null;
const chatSound = new Audio('/mp3/clipmouse.mp3');

function enableChatAlerts() {
  if (notificationAudioContext && notificationAudioContext.state === "suspended") {
    notificationAudioContext.resume();
  }
  // Desbloqueo de sonido MP3
  chatSound.play().then(() => {
      chatSound.pause();
      chatSound.currentTime = 0;
  }).catch(() => { /* Bloqueo esperado */ });

  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function playIncomingMessageAlert() {
  chatSound.currentTime = 0;
  chatSound.play().catch(e => console.error("Error al sonar chat MP3:", e));

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
  const visible = [...conversations].sort((a,b)=>new Date(b.latestMessage?.createdAt||0)-new Date(a.latestMessage?.createdAt||0)).filter((item) => !query || `${item.driver.name} ${item.driver.phone} ${item.driver.vehicleBrand} ${item.driver.vehicleModel}`.toLocaleLowerCase("es").includes(query));
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



async function selectPrivate(driverId) {
  const item = conversations.find((conversation) => conversation.driver.id === driverId);
  if (!item) return;
  selectedChannel = "private";
  selectedDriverId = driverId;
  $("#public-conversation")?.classList.remove("active");
  $("#current-avatar").textContent = initials(item.driver);
  $("#current-kicker").textContent = "CONVERSACIÓN PRIVADA";
  $("#current-name").textContent = "Conversar con " + item.driver.name;
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
  if(!selectedDriverId)return toast("Selecciona un conductor."); const url = `/api/admin/chats/${encodeURIComponent(selectedDriverId)}/messages`;
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
    if(!selectedDriverId)return toast("Selecciona un conductor."); const url = `/api/admin/chats/${encodeURIComponent(selectedDriverId)}/messages`;
    await api(url, { method: "POST", body: { message, photo: await fileAsDataUrl(photoFile) } });
    input.value = "";
    photoInput.value = "";
    $("#photo-name").hidden = true;
    await loadMessages(true);
    await loadConversations();
  } catch (error) { toast(error.message); } finally { button.disabled = false; input.focus(); }
});


$("#conversation-search").addEventListener("input", renderConversations);
$("#message-photo").addEventListener("change", (event) => {
  enableChatAlerts();
  const file = event.target.files?.[0];
  const label = $("#photo-name");
  label.textContent = file ? `📷 ${file.name}` : "";
  label.hidden = !file;
});
document.addEventListener("pointerdown", enableChatAlerts, { once: true });
loadConversations();
setInterval(() => { loadConversations(); loadMessages(); }, 3000);

const chatMenu=$("#chat-side-menu"),chatOverlay=$("#chat-drawer-overlay");$("#chat-menu-button")?.addEventListener("click",()=>{chatMenu?.classList.add("open");if(chatOverlay)chatOverlay.hidden=false;});$("#chat-close-menu")?.addEventListener("click",()=>{chatMenu?.classList.remove("open");if(chatOverlay)chatOverlay.hidden=true;});chatOverlay?.addEventListener("click",()=>{chatMenu?.classList.remove("open");chatOverlay.hidden=true;});$("#chat-logout")?.addEventListener("click",async()=>{try{await api("/api/admin/logout",{method:"POST"});}catch{}location.replace("/admin-login");});
