const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let drivers = [];
let statusFilter = "pending";
let selectedDriverId = null;
let toastTimer;

const statusLabels = { pending: "Pendiente", active: "Activo", cancelled: "Cancelado" };
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[character]));
const initials = (driver) => `${driver.firstName?.[0] || driver.name?.[0] || "D"}${driver.lastName?.[0] || ""}`.toUpperCase();
const dateLabel = (value) => value ? new Date(value).toLocaleString("es-DO", { dateStyle:"medium", timeStyle:"short" }) : "—";

function setHidden(selector, hidden) {
    const el = $(selector);
    if (el) el.hidden = hidden;
}

function toast(message) {
    const element = $("#admin-toast");
    if(!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 3500);
}

async function fetchJson(url, options={}) {
    try {
        const response = await fetch(url, {
            method: options.method || "GET",
            headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
            body: options.body ? JSON.stringify(options.body) : undefined,
            credentials: 'include'
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Error en la petición.");
        return body;
    } catch (e) { throw new Error("Error de conexión con la nube: " + e.message); }
}

function updateCounts(){
    if($("#pending-count")) $("#pending-count").textContent = drivers.filter(d=>d.status==="pending").length;
    if($("#active-count")) $("#active-count").textContent = drivers.filter(d=>d.status==="active").length;
    if($("#cancelled-count")) $("#cancelled-count").textContent = drivers.filter(d=>d.status==="cancelled").length;
    if($("#total-count")) $("#total-count").textContent = drivers.length;
}

function renderDrivers(){
    updateCounts();
    const visible = filteredDrivers();
    if($("#result-count")) $("#result-count").textContent = `${visible.length} resultados`;
    setHidden("#drivers-empty", visible.length !== 0);

    const body = $("#drivers-body");
    if(!body) return;

    body.innerHTML = visible.map(driver => `
        <tr data-driver-id="${escapeHtml(driver.id)}">
            <td><div class="driver-cell"><span class="table-avatar">${escapeHtml(initials(driver))}</span><div><b>${escapeHtml(driver.name)}</b><small>${escapeHtml(driver.id)}</small></div></div></td>
            <td>${escapeHtml(driver.phone)}</td>
            <td><span class="vehicle-cell"><b>${escapeHtml(driver.vehicleBrand)} ${escapeHtml(driver.vehicleModel)}</b></span></td>
            <td><span class="plate-chip">${escapeHtml(driver.vehiclePlate)}</span></td>
            <td><span class="status-badge status-${driver.status}">${statusLabels[driver.status] || driver.status}</span></td>
            <td>${escapeHtml(dateLabel(driver.createdAt))}</td>
            <td style="display:flex;gap:5px;align-items:center;">
                <button class="view-driver" type="button" onclick="event.stopPropagation(); openDriver('${escapeHtml(driver.id)}')">Ver</button>
                <button class="view-driver" type="button" style="background:#0b2e47;color:#fff;" onclick="event.stopPropagation(); editDriver('${escapeHtml(driver.id)}')">Editar</button>
                <a href="/drivers-chat.html?driver=${encodeURIComponent(driver.id)}" style="text-decoration:none;font-size:18px;" title="Chatear con ${escapeHtml(driver.name)}">💬</a>
            </td>
        </tr>
    `).join("");

    $$("#drivers-body tr").forEach(row => row.addEventListener("click", () => openDriver(row.dataset.driverId)));
}

async function editDriver(id) {
    selectedDriverId = id;
    try {
        const { driver } = await fetchJson(`/api/admin/drivers/${encodeURIComponent(id)}`);
        $("#edit-first-name").value = driver.firstName || "";
        $("#edit-last-name").value = driver.lastName || "";
        $("#edit-email").value = driver.email || "";
        $("#edit-phone").value = driver.phone || "";
        $("#edit-password").value = "";
        setHidden("#driver-edit-modal", false);
        document.body.style.overflow = "hidden";
    } catch (error) { toast(error.message); }
}

$("#edit-driver-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
        firstName: $("#edit-first-name").value,
        lastName: $("#edit-last-name").value,
        email: $("#edit-email").value,
        phone: $("#edit-phone").value
    };
    const password = $("#edit-password").value;
    if (password) body.password = password;

    try {
        await fetchJson(`/api/admin/drivers/${encodeURIComponent(selectedDriverId)}`, {
            method: "PATCH",
            body
        });
        toast("Conductor actualizado.");
        setHidden("#driver-edit-modal", true);
        document.body.style.overflow = "";
        loadDrivers();
    } catch (error) { toast(error.message); }
});

$("#close-driver-edit")?.addEventListener("click", () => {
    setHidden("#driver-edit-modal", true);
    document.body.style.overflow = "";
});

function filteredDrivers(){
    const query = $("#driver-search")?.value.trim().toLocaleLowerCase("es") || "";
    return drivers.filter(driver => (statusFilter === "all" || driver.status === statusFilter) && (!query || [driver.name, driver.phone, driver.vehicleBrand, driver.vehiclePlate].join(" ").toLocaleLowerCase("es").includes(query)));
}

function setGalleryImage(itemId, imgId, url) {
    const item = $(itemId);
    if (!item) return;
    if (!url) { item.style.display = "none"; return; }
    item.style.display = "block";
    const img = $(imgId);
    if (img) {
        img.src = `${url}?v=${Date.now()}`;
        if (img.parentElement.tagName === "A") img.parentElement.href = url;
    }
}

async function openDriver(id){
    selectedDriverId = id;
    try {
        const { driver } = await fetchJson(`/api/admin/drivers/${encodeURIComponent(id)}`);
        if($("#detail-avatar")) $("#detail-avatar").textContent = initials(driver);
        if($("#detail-id")) $("#detail-id").textContent = `EXPEDIENTE ${driver.id}`;
        if($("#detail-name")) $("#detail-name").textContent = driver.name;
        if($("#detail-date")) $("#detail-date").textContent = `Registrado ${dateLabel(driver.createdAt)}`;
        const badge = $("#detail-status");
        if(badge) {
            badge.textContent = statusLabels[driver.status] || driver.status;
            badge.className = `status-badge status-${driver.status}`;
        }
        if($("#detail-email")) $("#detail-email").textContent = driver.email || "No especificado";
        if($("#detail-phone")) $("#detail-phone").textContent = driver.phone;
        if($("#detail-cedula")) $("#detail-cedula").textContent = driver.cedula || "—";
        if($("#detail-vehicle-brand")) $("#detail-vehicle-brand").textContent = driver.vehicleBrand;
        if($("#detail-vehicle-model")) $("#detail-vehicle-model").textContent = driver.vehicleModel;
        if($("#detail-plate")) $("#detail-plate").textContent = driver.vehiclePlate;
        if($("#detail-points")) $("#detail-points").textContent = driver.pointsBalance || 0;
        const docs = driver.documents || {};
        setGalleryImage("#item-selfie", "#detail-selfie", docs.selfie);
        setGalleryImage("#item-id-front", "#detail-id-front", docs.idFront);
        setGalleryImage("#item-id-back", "#detail-id-back", docs.idBack);
        setGalleryImage("#item-vehicle", "#detail-vehicle-photo", docs.vehicle);
        setGalleryImage("#item-v-back", "#detail-v-back", docs.vBack);
        setGalleryImage("#item-v-left", "#detail-v-left", docs.vLeft);
        setGalleryImage("#item-v-right", "#detail-v-right", docs.vRight);
        setGalleryImage("#item-plate", "#detail-plate-photo", docs.plate);
        setHidden("#activate-driver", driver.status === "active");
        setHidden("#cancel-driver", driver.status === "cancelled");
        setHidden("#driver-detail-modal", false);
        document.body.style.overflow = "hidden";
    } catch(error) { toast(error.message); }
}

async function loadDrivers(announce=false){
    const button = $("#refresh-drivers");
    if(button) button.disabled = true;
    try {
        drivers = await fetchJson("/api/admin/drivers");
        renderDrivers();
        if(announce) toast("Lista actualizada.");
    } catch(error){ toast(error.message); }
    finally { if(button) button.disabled = false; }
}

function openMenu(){
    $("#side-menu")?.classList.add("open");
    $("#menu-button")?.classList.add("open");
    $("#drawer-overlay").hidden=false;
}
function closeMenu(){
    $("#side-menu")?.classList.remove("open");
    $("#menu-button")?.classList.remove("open");
    $("#drawer-overlay").hidden=true;
}

// --- EVENTOS ---
$("#menu-button")?.addEventListener("click", () => {
    if($("#side-menu")?.classList.contains("open")) closeMenu();
    else openMenu();
});
$("#close-menu")?.addEventListener("click", closeMenu);
$("#drawer-overlay")?.addEventListener("click", closeMenu);
$("#driver-search")?.addEventListener("input", renderDrivers);
$("#refresh-drivers")?.addEventListener("click", () => loadDrivers(true));
$("#close-driver-detail")?.addEventListener("click", () => {
    setHidden("#driver-detail-modal", true);
    document.body.style.overflow = "";
});

$$('[data-status-filter]').forEach(button => {
    button.addEventListener("click", () => {
        statusFilter = button.dataset.statusFilter;
        $$('[data-status-filter]').forEach(item => item.classList.toggle("selected", item === button));
        renderDrivers();
    });
});

$("#save-points")?.addEventListener("click", async () => {
    if(!selectedDriverId) return;
    const points = Number($("#edit-points-input")?.value || 0);
    try {
        await fetchJson(`/api/admin/drivers/points`, { method: "POST", body: { driverId: selectedDriverId, points } });
        toast("Puntos actualizados.");
        openDriver(selectedDriverId);
        loadDrivers();
    } catch(e) { toast(e.message); }
});

$("#activate-driver")?.addEventListener("click", async () => {
    if(!selectedDriverId) return;
    try {
        await fetchJson(`/api/admin/drivers/${encodeURIComponent(selectedDriverId)}/status`, { method: "POST", body: { status: "active" } });
        toast("Conductor activado.");
        openDriver(selectedDriverId);
        loadDrivers();
    } catch(e) { toast(e.message); }
});

$("#cancel-driver")?.addEventListener("click", async () => {
    if(!selectedDriverId) return;
    try {
        await fetchJson(`/api/admin/drivers/${encodeURIComponent(selectedDriverId)}/status`, { method: "POST", body: { status: "cancelled" } });
        toast("Cuenta cancelada.");
        openDriver(selectedDriverId);
        loadDrivers();
    } catch(e) { toast(e.message); }
});

$("#delete-driver")?.addEventListener("click", () => {
    if(!selectedDriverId) return;
    const d=drivers.find(x=>x.id===selectedDriverId);
    $("#delete-confirm-name").textContent=d?.name||selectedDriverId;
    setHidden("#driver-delete-confirm", false);
});
function closeDeleteConfirm(){setHidden("#driver-delete-confirm", true);}
$("#close-delete-confirm")?.addEventListener("click",closeDeleteConfirm);
$("#delete-confirm-no")?.addEventListener("click",closeDeleteConfirm);
$("#delete-confirm-yes")?.addEventListener("click", async () => {
    if(!selectedDriverId) return;
    try {
        const result=await fetchJson(`/api/admin/drivers/${encodeURIComponent(selectedDriverId)}`, { method: "DELETE" });
        closeDeleteConfirm();setHidden("#driver-detail-modal", true);
        $("#deleted-driver-name").textContent=result.driverName||"Conductor";
        $("#deleted-driver-date").textContent=`Fecha de eliminación: ${dateLabel(result.deletedAt)}`;
        setHidden("#driver-delete-success", false);
        await loadDrivers();
    } catch(e) { toast(e.message); }
});
$("#deleted-driver-ok")?.addEventListener("click",()=>{setHidden("#driver-delete-success", true);document.body.style.overflow="";});

loadDrivers();
