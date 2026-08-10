const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
let conversations = [];
let openedKey = null;
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, { method: options.method || "GET", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la solicitud.");
  return body;
}

function showToast(message) {
  const toast = $("#archive-toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderConversations() {
  const query = $("#archive-search").value.trim().toLocaleLowerCase("es");
  const filtered = conversations.filter((item) => !query || `${item.title} ${item.subtitle} ${item.key}`.toLocaleLowerCase("es").includes(query));
  $("#archive-count").textContent = `${filtered.length} ${filtered.length === 1 ? "conversación" : "conversaciones"}`;
  $("#archive-body").innerHTML = filtered.length ? filtered.map((item) => `<tr>
    <td><button class="archive-view" type="button" data-view="${escapeHtml(item.key)}">VER CONVERSACIÓN</button></td>
    <td><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.type === "ride" ? "Conductor y pasajero" : item.type === "driver" ? "Privado con la Central" : "Canal público")}</small></td>
    <td>${escapeHtml(item.subtitle)}</td><td>${escapeHtml(formatDate(item.latestAt))}</td><td>${Number(item.messageCount || 0)}</td>
    <td><button class="archive-delete" type="button" data-delete="${escapeHtml(item.key)}">ELIMINAR</button></td></tr>`).join("") : '<tr><td colspan="6" class="archive-empty">No hay conversaciones archivadas que coincidan.</td></tr>';
  $("#archive-body").querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => openConversation(button.dataset.view)));
  $("#archive-body").querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteConversation(button.dataset.delete)));
}

async function loadConversations() {
  try {
    const data = await api("/api/admin/conversation-history");
    conversations = data.conversations || [];
    renderConversations();
  } catch (error) {
    $("#archive-body").innerHTML = `<tr><td colspan="6" class="archive-empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

function messageAuthor(message) {
  if (message.sender === "admin") return "Central TAXOTE";
  if (message.sender === "passenger") return message.passengerName || "Pasajero";
  return message.driverName || "Conductor";
}

async function openConversation(key) {
  try {
    const data = await api(`/api/admin/conversation-history/messages?key=${encodeURIComponent(key)}`);
    openedKey = key;
    $("#conversation-modal-title").textContent = data.title;
    $("#conversation-messages").innerHTML = (data.messages || []).map((message) => {
      const content = message.messageType === "photo" && message.photoUrl ? `<img src="${escapeHtml(message.photoUrl)}" alt="Foto archivada" />` : `<p>${escapeHtml(message.message)}</p>`;
      return `<article class="conversation-message${message.sender === "admin" ? " admin" : ""}"><b>${escapeHtml(messageAuthor(message))}</b>${content}<small>${escapeHtml(formatDate(message.createdAt))}</small></article>`;
    }).join("") || '<p class="archive-empty">Esta conversación no tiene mensajes.</p>';
    $("#conversation-modal").hidden = false;
    document.body.style.overflow = "hidden";
    const list = $("#conversation-messages"); list.scrollTop = list.scrollHeight;
  } catch (error) { showToast(error.message); }
}

function closeConversation() {
  $("#conversation-modal").hidden = true;
  document.body.style.overflow = "";
  openedKey = null;
}

async function deleteConversation(key) {
  const item = conversations.find((conversation) => conversation.key === key);
  if (!confirm(`¿Seguro que deseas eliminar permanentemente la conversación “${item?.title || key}”? Esta acción no se puede deshacer.`)) return;
  try {
    await api("/api/admin/conversation-history", { method: "DELETE", body: { key } });
    if (openedKey === key) closeConversation();
    showToast("Conversación eliminada permanentemente.");
    await loadConversations();
  } catch (error) { showToast(error.message); }
}

function setDrawer(open) {
  $("#archive-drawer").classList.toggle("open", open);
  $("#archive-drawer").setAttribute("aria-hidden", String(!open));
  $("#archive-drawer-overlay").hidden = !open;
}

$("#archive-menu-button").addEventListener("click", () => setDrawer(true));
$("#archive-close-menu").addEventListener("click", () => setDrawer(false));
$("#archive-drawer-overlay").addEventListener("click", () => setDrawer(false));
$("#archive-search").addEventListener("input", renderConversations);
$("#archive-refresh").addEventListener("click", loadConversations);
$("#close-conversation-modal").addEventListener("click", closeConversation);
$("#dismiss-conversation-modal").addEventListener("click", closeConversation);
$("#delete-open-conversation").addEventListener("click", () => openedKey && deleteConversation(openedKey));
$("#conversation-modal").addEventListener("pointerdown", (event) => { if (event.target === event.currentTarget) closeConversation(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if (!$("#conversation-modal").hidden) closeConversation(); else setDrawer(false); } });
loadConversations();
