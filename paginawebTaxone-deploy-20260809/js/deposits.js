const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let deposits = [];
let toastTimer;

function toast(message) { const element=$("#admin-toast"); element.textContent=message; element.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>element.classList.remove("show"),3200); }
async function fetchJson(url, options={}) { let response; try { response=await fetch(url,{method:options.method||"GET",headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{})},body:options.body?JSON.stringify(options.body):undefined}); } catch { throw new Error("No se pudo conectar con TAXOTE."); } const body=await response.json().catch(()=>({})); if(!response.ok) throw new Error(body.error||"No se pudo procesar la solicitud."); return body; }

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
$("#menu-button")?.addEventListener("click", () => {
    if($("#side-menu")?.classList.contains("open")) closeMenu();
    else openMenu();
});
$("#close-menu")?.addEventListener("click", closeMenu); $("#drawer-overlay")?.addEventListener("click", closeMenu);

async function loadDeposits(announce=false){
    const button=$("#refresh-deposits"); button.disabled=true;
    try {
        deposits = await fetchJson("/api/admin/deposits");
        renderDeposits();
        if(announce) toast("Lista de depósitos actualizada.");
    } catch(error){ toast(error.message); } finally { button.disabled=false; }
}

function renderDeposits(){
    const container = $("#deposits-container");
    $("#deposits-empty").hidden = deposits.length > 0;

    container.innerHTML = deposits.map(d => `
        <div class="deposit-card">
            <div class="deposit-header">
                <div>
                    <b>${d.driverName}</b><br>
                    <small>${d.driverId}</small>
                </div>
                <span class="deposit-status status-${d.status}">${d.status === 'pending' ? 'Pendiente' : 'Completado'}</span>
            </div>
            <div class="deposit-points">${d.points} PUNTOS</div>
            <div class="deposit-amount">RD$ ${d.amount}</div>

            <div style="margin-top:15px">
                <small>Comprobante:</small><br>
                ${d.proofUrl ? `<img src="${d.proofUrl}" class="proof-img" onclick="window.open('${d.proofUrl}', '_blank')">` : 'Sin imagen'}
            </div>

            <div class="deposit-actions">
                <button onclick="approveDeposit('${d.driverId}', ${d.points}, ${d.id})" class="view-driver" style="background:#2e7d32; color:#fff;">✓ Aprobar y Sumar</button>
            </div>
        </div>
    `).join("");
}

async function approveDeposit(driverId, points, depositId){
    if(!confirm(`¿Aprobar este depósito y sumar ${points} puntos al conductor?`)) return;
    try {
        // 1. Fetch current driver points
        const {driver} = await fetchJson(`/api/admin/drivers/${encodeURIComponent(driverId)}`);
        const newTotal = (driver.pointsBalance || 0) + points;

        // 2. Update points
        await fetchJson(`/api/admin/drivers/points`, {method: "POST", body: {driverId, points: newTotal}});

        // 3. Mark deposit as processed (optional but good for UX)
        // For now just reload
        toast("Puntos asignados correctamente.");
        await loadDeposits();
    } catch(error) { toast(error.message); }
}

$("#refresh-deposits").addEventListener("click", () => loadDeposits(true));
loadDeposits();
