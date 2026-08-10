const $ = (selector) => document.querySelector(selector);
let deposits = [];
let toastTimer;

function toast(message) {
  const element = $("#admin-toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3200);
}
async function fetchJson(url, options={}) {
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      credentials: "include",
      headers: { Accept:"application/json", ...(options.body ? {"Content-Type":"application/json"} : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch { throw new Error("No se pudo conectar con TAXOTE."); }
  const body = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(body.error || "No se pudo procesar la solicitud.");
  return body;
}
function openMenu(){ $("#side-menu")?.classList.add("open"); $("#menu-button")?.classList.add("open"); $("#drawer-overlay").hidden=false; }
function closeMenu(){ $("#side-menu")?.classList.remove("open"); $("#menu-button")?.classList.remove("open"); $("#drawer-overlay").hidden=true; }
$("#menu-button")?.addEventListener("click",()=>$("#side-menu")?.classList.contains("open")?closeMenu():openMenu());
$("#close-menu")?.addEventListener("click",closeMenu);
$("#drawer-overlay")?.addEventListener("click",closeMenu);

function formatDate(value){
  if(!value) return "—";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?"—":d.toLocaleString("es-DO",{dateStyle:"short",timeStyle:"short"});
}
function renderDeposits(){
  const body=$("#deposits-container");
  $("#deposits-empty").hidden = deposits.length > 0;
  if(!deposits.length){
    body.innerHTML='<tr><td colspan="8" style="text-align:center;padding:32px;color:#7b8e99;">No hay depósitos registrados.</td></tr>';
    return;
  }
  body.innerHTML=deposits.map(d=>`<tr>
    <td><b>${escapeHtml(d.driverName)}</b></td>
    <td>${escapeHtml(d.driverId)}</td>
    <td><b>${Number(d.points||0)} puntos</b></td>
    <td>RD$ ${Number(d.amount||0).toLocaleString("es-DO")}</td>
    <td>${d.proofUrl?`<img class="proof-thumb" src="${escapeHtml(d.proofUrl)}" alt="Comprobante" data-proof="${escapeHtml(d.proofUrl)}">`:"Sin imagen"}</td>
    <td class="status-${escapeHtml(d.status)}">${d.status==="pending"?"Pendiente":d.status==="approved"?"Aprobado":escapeHtml(d.status)}</td>
    <td>${formatDate(d.date)}</td>
    <td>${d.status==="pending"?`<button class="approve-deposit" data-driver="${escapeHtml(d.driverId)}" data-points="${Number(d.points||0)}" data-deposit="${Number(d.id)}">✓ Aprobar</button>`:"—"}</td>
  </tr>`).join("");
  body.querySelectorAll("[data-proof]").forEach(img=>img.addEventListener("click",()=>window.open(img.dataset.proof,"_blank")));
  body.querySelectorAll(".approve-deposit").forEach(btn=>btn.addEventListener("click",()=>approveDeposit(btn.dataset.driver,Number(btn.dataset.points),Number(btn.dataset.deposit))));
}
function escapeHtml(value=""){return String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
async function loadDeposits(announce=false){
  const button=$("#refresh-deposits"); if(button) button.disabled=true;
  try{ deposits=await fetchJson("/api/admin/deposits"); renderDeposits(); if(announce) toast("Lista actualizada."); }
  catch(error){ toast(error.message); }
  finally{ if(button) button.disabled=false; }
}
async function approveDeposit(driverId,points,depositId){
  if(!confirm(`¿Aprobar este depósito y sumar ${points} puntos?`)) return;
  try{
    const {driver}=await fetchJson(`/api/admin/drivers/${encodeURIComponent(driverId)}`);
    const newTotal=Number(driver.pointsBalance||0)+points;
    await fetchJson("/api/admin/drivers/points",{method:"POST",body:{driverId,points:newTotal,depositId}});
    toast("Depósito aprobado y puntos asignados.");
    await loadDeposits();
  }catch(error){toast(error.message);}
}
$("#refresh-deposits")?.addEventListener("click",()=>loadDeposits(true));
loadDeposits();
