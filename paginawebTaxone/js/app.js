let registeredClients = [];
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const escapeHtml = (value="") => String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

const toast=$("#toast");
const pickupInput=$("#pickup"), destinationInput=$("#destination");
const routeNotice=$("#route-notice");
const bookingForm=$("#booking-form");
const serviceType=$("#service-type"), travelTime=$("#travel-time");
const scheduleFields=$("#schedule-fields"), scheduleDate=$("#schedule-date"), scheduleTime=$("#schedule-time");
const customerInput=$("#customer"), customerResults=$("#customer-results"), selectedCustomerCard=$("#selected-customer");
const guestFields=$("#guest-fields");
const driverAssignInput=$("#driver-assign-id");
let toastTimer, selectedCustomer=null, selectedDriverId="", activeMapSelection="pickup";
let map, routeLayer, markerLayer, driverLocationLayer;
let dispatchTrips=[], connectedDrivers=[], routeStops=[], tripFilter='active';
let routeRequestId=0, previousNotificationIds=new Set(), notificationInitialized=false, previousChatUnread=0;

const selectedLocations={pickup:null,destination:null};
const defaultCenter=[18.49,-69.98], defaultZoom=11;
const notificationSound=new Audio("/mp3/clipmouse.mp3");

function showToast(message){
  if(!toast) return;
  toast.textContent=message; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove("show"),3400);
}
function fmtPrice(v){ return new Intl.NumberFormat("es-DO",{style:"currency",currency:"DOP",maximumFractionDigits:0}).format(Number(v||0)); }
function fmtDate(v){ const d=new Date(v); return Number.isNaN(d.getTime())?"—":d.toLocaleString("es-DO",{dateStyle:"short",timeStyle:"short"}); }
async function fetchJson(url,options={}){
  let response;
  try{
    response=await fetch(url,{method:options.method||"GET",credentials:"include",cache:"no-store",headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{})},body:options.body?JSON.stringify(options.body):undefined});
  }catch{throw new Error("Error de conexión con TAXOTE.");}
  const body=await response.json().catch(()=>({}));
  if(response.status===401 && !url.includes("/api/admin/login")) { location.href=`/admin-login.html?next=${encodeURIComponent(location.pathname+location.search)}`; throw new Error("Sesión expirada."); }
  if(!response.ok) throw new Error(body.error||`Error (${response.status})`);
  return body;
}

/* menú */
const menuButton=$("#menu-button"), sideMenu=$("#side-menu"), drawerOverlay=$("#drawer-overlay");
function setMenu(open){sideMenu?.classList.toggle("open",open);menuButton?.classList.toggle("open",open);if(drawerOverlay)drawerOverlay.hidden=!open;}
menuButton?.addEventListener("click",()=>setMenu(!sideMenu?.classList.contains("open")));
$("#close-menu")?.addEventListener("click",()=>setMenu(false));
drawerOverlay?.addEventListener("click",()=>setMenu(false));

/* paneles redimensionables con arrastre lateral */
const workspace=$(".workspace");
const resizeConfig={
  booking:{panel:$("#booking-panel"),handle:$("[data-resize-panel='booking']"),var:"--booking-panel-width",min:270,max:900,key:"taxote-booking-panel-width"},
  drivers:{panel:$("#drivers-panel"),handle:$("[data-resize-panel='drivers']"),var:"--drivers-panel-width",min:240,max:1200,key:"taxote-drivers-panel-width"}
};
function setPanelWidth(kind,width,persist=false){
  const c=resizeConfig[kind]; if(!c?.panel||!c.handle||!workspace)return;
  const max=Math.min(c.max,Math.max(c.min,workspace.clientWidth-(kind==="booking"?resizeConfig.drivers.panel.offsetWidth:resizeConfig.booking.panel.offsetWidth)-220));
  width=Math.max(c.min,Math.min(max,Number(width)||c.min));
  workspace.style.setProperty(c.var,`${Math.round(width)}px`);
  if(persist) try{localStorage.setItem(c.key,String(Math.round(width)));}catch{}
  map?.invalidateSize({animate:false});
}
for(const [kind,c] of Object.entries(resizeConfig)){
  if(!c.handle) continue;
  try{const saved=Number(localStorage.getItem(c.key)); if(saved)setPanelWidth(kind,saved);}catch{}
  let state=null;
  c.handle.addEventListener("pointerdown",e=>{
    if(!matchMedia("(min-width:1181px)").matches)return;
    state={id:e.pointerId,x:e.clientX,w:c.panel.offsetWidth}; c.handle.setPointerCapture(e.pointerId); c.handle.classList.add("active"); document.body.classList.add("panel-resize-active");
  });
  c.handle.addEventListener("pointermove",e=>{if(!state||e.pointerId!==state.id)return;const direction=kind==="drivers"?-1:1;setPanelWidth(kind,state.w+(e.clientX-state.x)*direction);});
  const finish=e=>{if(!state||e.pointerId!==state.id)return;setPanelWidth(kind,c.panel.offsetWidth,true);state=null;c.handle.classList.remove("active");document.body.classList.remove("panel-resize-active");};
  c.handle.addEventListener("pointerup",finish); c.handle.addEventListener("pointercancel",finish);
}

/* clientes */
async function loadRegisteredClients(){try{registeredClients=await fetchJson("/api/dispatch/clients");}catch{registeredClients=[];}}
function renderCustomerResults(q=""){
  const n=q.trim().toLowerCase();
  const matches=registeredClients.filter(c=>`${c.name} ${c.phone}`.toLowerCase().includes(n)).slice(0,8);
  if(!matches.length){customerResults.hidden=true;return;}
  customerResults.innerHTML=matches.map(c=>`<button class="customer-option" type="button" data-id="${escapeHtml(c.id)}"><span><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.phone)}</small></span></button>`).join("");
  customerResults.hidden=false;
  customerResults.querySelectorAll("[data-id]").forEach(b=>b.addEventListener("click",()=>selectCustomer(b.dataset.id)));
}
function selectCustomer(id){
  selectedCustomer=registeredClients.find(c=>c.id===id)||null;if(!selectedCustomer)return;
  customerInput.value=selectedCustomer.name;customerResults.hidden=true;
  selectedCustomerCard.innerHTML=`<b>${escapeHtml(selectedCustomer.name)}</b> <span>· ${escapeHtml(selectedCustomer.phone)}</span>`;
  selectedCustomerCard.hidden=false; $("#registered-history-search").disabled=false;
}
customerInput?.addEventListener("input",()=>{selectedCustomer=null;selectedCustomerCard.hidden=true;$("#registered-history-search").disabled=true;renderCustomerResults(customerInput.value);});
$("#clear-customer")?.addEventListener("click",()=>{selectedCustomer=null;customerInput.value="";selectedCustomerCard.hidden=true;customerResults.hidden=true;$("#registered-history-search").disabled=true;});
$("#registered-history-search")?.addEventListener("click",()=>{if(!selectedCustomer)return showToast("Selecciona un cliente.");showToast(`Direcciones recientes listas para ${selectedCustomer.name}. Usa la lupa de Recogida o Destino.`);});
$("#guest-history-search")?.addEventListener("click",async()=>{
  const p=$("#guest-phone")?.value||"";if(!p)return;
  try{const d=await fetchJson(`/api/contacts/lookup?phone=${encodeURIComponent(p)}`);if(d.found){$("#guest-name").value=d.profile.name;$("#guest-history-status").textContent=`${d.profile.name} encontrado. Sus direcciones recientes están disponibles en la lupa.`;selectedCustomer={...d.profile,addresses:d.addresses||[]};}else{$("#guest-history-status").textContent="Número nuevo.";}}catch(e){showToast(e.message);}
});
function toggleServiceFields(){const guest=serviceType?.value==="Invitado";$(".customer-picker-wrap").hidden=guest;guestFields.hidden=!guest;}
serviceType?.addEventListener("change",toggleServiceFields);
function toggleSchedule(){
  const scheduled=travelTime?.value==="scheduled"; if(scheduleFields)scheduleFields.hidden=!scheduled;
  if(scheduled){const now=new Date();scheduleDate.min=now.toISOString().slice(0,10);}
}
travelTime?.addEventListener("change",toggleSchedule);

/* mapa */
function markerIcon(kind,num=0){
  const label=kind==="stop"?`C${num}`:kind==="destination"?"B":"A";
  return L.divIcon({className:"taxote-div-icon",html:`<div class="taxote-marker-shell"><div class="taxote-marker ${kind}"><span>${label}</span></div><button class="marker-remove" type="button" title="Quitar ${label}">×</button></div>`,iconSize:[30,30],iconAnchor:[15,30]});
}
function initializeMap(){
  if(!window.L)return;
  map=L.map("live-map",{zoomControl:true}).setView(defaultCenter,defaultZoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);
  routeLayer=L.layerGroup().addTo(map);markerLayer=L.layerGroup().addTo(map);driverLocationLayer=L.layerGroup().addTo(map);
  map.on("click",e=>setPointFromMap(activeMapSelection,e.latlng));
}
async function reverseAt(lat,lon){
  try{const r=await fetchJson(`/api/reverse?lat=${lat}&lon=${lon}`);return{address:r.display_name||`${lat.toFixed(6)}, ${lon.toFixed(6)}`,lat:Number(lat),lon:Number(lon)};}
  catch{return{address:`Punto ${lat.toFixed(6)}, ${lon.toFixed(6)}`,lat:Number(lat),lon:Number(lon)};}
}
function getStop(id){return routeStops.find(s=>s.id===id);}
function setMapSelection(kind){activeMapSelection=kind;$$(".pick-on-map,.stop-map-action").forEach(b=>b.classList.remove("active"));if(kind==="pickup")$("#pick-pickup-map")?.classList.add("active");else if(kind==="destination")$("#pick-destination-map")?.classList.add("active");else getStop(kind)?.mapButton?.classList.add("active");}
async function setPointFromMap(kind,latlng){
  if(!kind)kind="pickup";
  const resolved=await reverseAt(latlng.lat,latlng.lng);
  if(kind==="pickup"){selectedLocations.pickup=resolved;pickupInput.value=resolved.address;}
  else if(kind==="destination"){selectedLocations.destination=resolved;destinationInput.value=resolved.address;}
  else{const s=getStop(kind);if(!s)return;s.location=resolved;s.input.value=resolved.address;}
  renderSelectionMarkers();calculateRoadRoute();showToast("Punto colocado exactamente donde lo marcaste.");
  if(kind==="pickup") setMapSelection("destination");
  else if(kind==="destination"){const empty=routeStops.find(s=>!s.location);if(empty)setMapSelection(empty.id);}
  else{const pos=routeStops.findIndex(s=>s.id===kind);const next=routeStops.slice(pos+1).find(s=>!s.location);if(next)setMapSelection(next.id);}
}
function removePoint(kind){
  if(kind==="pickup"){selectedLocations.pickup=null;pickupInput.value="";setMapSelection("pickup");}
  else if(kind==="destination"){selectedLocations.destination=null;destinationInput.value="";setMapSelection("destination");}
  else{const s=getStop(kind);if(s){s.location=null;s.input.value="";setMapSelection(kind);}}
  renderSelectionMarkers();calculateRoadRoute();
}
function addMarker(kind,loc,iconKind,num=0){
  if(!loc)return;
  const m=L.marker([loc.lat,loc.lon],{icon:markerIcon(iconKind,num),draggable:true}).addTo(markerLayer);
  m.on("dragend",e=>setPointFromMap(kind,e.target.getLatLng()));
  m.on("click",()=>setMapSelection(kind));
  setTimeout(()=>m.getElement()?.querySelector(".marker-remove")?.addEventListener("click",e=>{e.stopPropagation();removePoint(kind);}),0);
}
function renderSelectionMarkers(){
  if(!markerLayer)return;markerLayer.clearLayers();
  addMarker("pickup",selectedLocations.pickup,"pickup");
  routeStops.forEach((s,i)=>addMarker(s.id,s.location,"stop",i+1));
  addMarker("destination",selectedLocations.destination,"destination");
}
function routePoints(){return [selectedLocations.pickup,...routeStops.map(s=>s.location).filter(Boolean),selectedLocations.destination].filter(Boolean);}
async function calculateRoadRoute(){
  const pts=routePoints();routeLayer?.clearLayers();
  if(pts.length<2){routeNotice.textContent="Selecciona origen y destino para ver la ruta.";return;}
  const req=++routeRequestId,coords=pts.map(p=>`${p.lon},${p.lat}`).join(";");
  try{
    const data=await fetchJson(`/api/route?coordinates=${encodeURIComponent(coords)}`);if(req!==routeRequestId)return;
    if(data.routes?.[0]){const r=data.routes[0];L.polyline(r.geometry.coordinates.map(([lon,lat])=>[lat,lon]),{color:"#0b2e47",weight:5}).addTo(routeLayer);routeNotice.textContent=`Ruta lista: ${(r.distance/1000).toFixed(1)} km · ${Math.ceil(r.duration/60)} min`;}
  }catch(e){routeNotice.textContent="No se pudo calcular la ruta ahora.";}
}
function fitCurrentRoute(){
  const pts=routePoints();
  if(pts.length){map.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lon])),{padding:[55,55],maxZoom:14});}
  else map.setView(defaultCenter,defaultZoom);
}
$("#recenter")?.addEventListener("click",fitCurrentRoute);
$("#pick-pickup-map")?.addEventListener("click",()=>{setMapSelection("pickup");showToast("Haz clic donde quieras colocar A.");});
$("#pick-destination-map")?.addEventListener("click",()=>{setMapSelection("destination");showToast("Haz clic donde quieras colocar B.");});
$("#clear-pickup")?.addEventListener("click",()=>removePoint("pickup"));
$("#clear-destination")?.addEventListener("click",()=>removePoint("destination"));

/* paradas C */
let stopSeq=0;
function addRouteStop(){
  const id=`stop-${++stopSeq}`;const row=document.createElement("div");row.className="stop-row";
  row.innerHTML=`<div class="stop-address"><div class="stop-label">Parada C${routeStops.length+1}</div><div class="stop-control"><input type="search" placeholder="Dirección o selección en mapa" autocomplete="off"><button type="button">⌕</button></div><div class="address-results" hidden></div><button class="stop-map-action" type="button">● Elegir C${routeStops.length+1} en mapa</button></div><button class="remove-stop" type="button">×</button>`;
  $("#extra-stops").appendChild(row);
  const s={id,row,input:row.querySelector("input"),results:row.querySelector(".address-results"),searchButton:row.querySelector(".stop-control button"),mapButton:row.querySelector(".stop-map-action"),location:null};
  routeStops.push(s);
  s.input.addEventListener("input",()=>searchAddress(s.input.value,s.results,s.id));
  s.searchButton.addEventListener("click",()=>runAddressSearch(s.input.value,s.results,s.id));
  s.mapButton.addEventListener("click",()=>{setMapSelection(s.id);showToast("Haz clic donde quieras colocar esta parada.");});
  row.querySelector(".remove-stop").addEventListener("click",()=>{routeStops=routeStops.filter(x=>x!==s);row.remove();renumberStops();renderSelectionMarkers();calculateRoadRoute();});
  renumberStops();setMapSelection(id);
}
function renumberStops(){
  routeStops.forEach((s,i)=>{s.row.querySelector(".stop-label").textContent=`Parada C${i+1}`;s.mapButton.textContent=`● Elegir C${i+1} en mapa`;});
  if($("#stop-count-select"))$("#stop-count-select").value=String(Math.min(3,routeStops.length));
}
$("#add-stop")?.addEventListener("click",()=>{if(routeStops.length>=6)return showToast("Máximo 6 paradas.");addRouteStop();});
$("#stop-count-select")?.addEventListener("change",e=>{const n=Number(e.target.value);while(routeStops.length<n)addRouteStop();while(routeStops.length>n){const s=routeStops.pop();s.row.remove();}renumberStops();renderSelectionMarkers();calculateRoadRoute();});

/* búsqueda de direcciones + recientes */
function recentAddresses(){
  if(selectedCustomer?.addresses?.length)return selectedCustomer.addresses;
  return [];
}
function renderAddressOptions(results,container,kind){
  if(!container)return;
  container.innerHTML=results.length?results.map((r,i)=>`<button type="button" class="address-option" data-i="${i}"><b>${escapeHtml(r.display_name||r.address||"Dirección")}</b></button>`).join(""):'<div class="address-option address-search-error">No se encontraron direcciones.</div>';
  container.hidden=false;
  container.querySelectorAll("[data-i]").forEach(b=>b.addEventListener("click",()=>{
    const r=results[Number(b.dataset.i)],loc={address:r.display_name||r.address,lat:Number(r.lat),lon:Number(r.lon)};
    if(kind==="pickup"){selectedLocations.pickup=loc;pickupInput.value=loc.address;}
    else if(kind==="destination"){selectedLocations.destination=loc;destinationInput.value=loc.address;}
    else{const s=getStop(kind);if(s){s.location=loc;s.input.value=loc.address;}}
    container.hidden=true;renderSelectionMarkers();calculateRoadRoute();fitCurrentRoute();
  }));
}
async function searchAddress(query,container,kind){
  query=query.trim();if(query.length<2){container.hidden=true;return;}
  try{renderAddressOptions(await fetchJson(`/api/geocode?q=${encodeURIComponent(query)}`),container,kind);}catch(e){showToast(e.message);}
}
function runAddressSearch(query,container,kind){
  if(query.trim().length>=2)return searchAddress(query,container,kind);
  const recent=recentAddresses();
  if(recent.length)return renderAddressOptions(recent,container,kind);
  showToast("Escribe una dirección o selecciona primero un cliente con historial.");
}
pickupInput?.addEventListener("input",()=>searchAddress(pickupInput.value,$("#pickup-results"),"pickup"));
destinationInput?.addEventListener("input",()=>searchAddress(destinationInput.value,$("#destination-results"),"destination"));
$("#search-pickup")?.addEventListener("click",()=>runAddressSearch(pickupInput.value,$("#pickup-results"),"pickup"));
$("#search-destination")?.addEventListener("click",()=>runAddressSearch(destinationInput.value,$("#destination-results"),"destination"));

/* conductores */
function driverStatus(d){return d.connectionState==="busy"?"Ocupado":"Disponible";}
function updateAssignedDriverSummary(){
  const d=connectedDrivers.find(x=>x.id===selectedDriverId);driverAssignInput.value=selectedDriverId||"";
  $("#driver-assigned-summary").textContent=d?`${d.name} · ${d.vehiclePlate||""} · ${driverStatus(d)}`:"Sin asignar";
}
function selectDriver(id){
  const d=connectedDrivers.find(x=>x.id===id);if(!d)return;
  if(d.connectionState==="busy")return showToast("Ese conductor está ocupado.");
  selectedDriverId=id;updateAssignedDriverSummary();renderConnectedDrivers();$("#driver-search-results").hidden=true;$("#driver-assign-search").value=d.name;showToast(`${d.name} seleccionado para recibir el servicio.`);
}
function renderConnectedDrivers(){
  const q=($("#connected-driver-search")?.value||"").trim().toLowerCase();
  const visible=connectedDrivers.filter(d=>`${d.name} ${d.vehiclePlate}`.toLowerCase().includes(q));
  $("#connected-drivers-list").innerHTML=visible.length?visible.map((d,i)=>`<article class="driver driver-row ${d.connectionState==="busy"?"busy":""} ${d.id===selectedDriverId?"selected-driver":""}"><span class="driver-index">${i+1}</span><span class="driver-online-dot"></span><button class="driver-locate" type="button" data-locate-driver="${escapeHtml(d.id)}"><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.vehicleBrand||"")} ${escapeHtml(d.vehicleModel||"")} · ${escapeHtml(d.vehiclePlate||"")}</small></button><button class="driver-message" type="button" data-chat-driver="${escapeHtml(d.id)}" title="Mensaje privado">💬</button><span class="driver-state">${driverStatus(d)}</span></article>`).join(""):'<div style="padding:20px;text-align:center;color:#888;font-size:12px;">No hay conductores conectados.</div>';
  $("#connected-drivers-list").querySelectorAll("[data-locate-driver]").forEach(el=>el.addEventListener("click",()=>locateConnectedDriver(el.dataset.locateDriver)));
  $("#connected-drivers-list").querySelectorAll("[data-chat-driver]").forEach(el=>el.addEventListener("click",()=>openDriverQuickChat(el.dataset.chatDriver)));
}
function renderAssignSearch(){
  const q=($("#driver-assign-search")?.value||"").trim().toLowerCase(),box=$("#driver-search-results");
  if(!q){box.hidden=true;return;}
  const list=connectedDrivers.filter(d=>`${d.name} ${d.vehiclePlate}`.toLowerCase().includes(q)).slice(0,10);
  box.innerHTML=list.length?list.map(d=>`<button type="button" class="driver-choice ${d.connectionState==="busy"?"busy":""}" data-driver="${escapeHtml(d.id)}"><span><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.vehiclePlate||"")}</small></span><strong>${driverStatus(d)}</strong></button>`).join(""):'<div class="driver-choice">No encontrado</div>';
  box.hidden=false;box.querySelectorAll("[data-driver]").forEach(b=>b.addEventListener("click",()=>selectDriver(b.dataset.driver)));
}
async function loadConnectedDrivers(){
  try{connectedDrivers=await fetchJson("/api/admin/driver-locations");renderConnectedDrivers();renderDriverLocations();renderAssignSearch();}catch{}
}
function renderDriverLocations(){
  driverLocationLayer?.clearLayers();
  connectedDrivers.forEach(d=>{if(!d.location)return;L.marker([d.location.lat,d.location.lon],{icon:L.divIcon({className:"taxote-car-marker",html:`<img src="/assets/taxote-car.png" style="width:32px;height:35px;transform:rotate(${Number(d.location.bearing||0)}deg)">`})}).addTo(driverLocationLayer).bindPopup(`<b>${escapeHtml(d.name)}</b><br>${escapeHtml(d.vehiclePlate||"")}`);});
}
$("#connected-driver-search")?.addEventListener("input",renderConnectedDrivers);
let quickChatDriverId="";
function locateConnectedDriver(id){const d=connectedDrivers.find(x=>x.id===id);if(!d?.location)return showToast("Ese conductor todavía no reporta ubicación.");selectedDriverId=id;updateAssignedDriverSummary();renderConnectedDrivers();map?.setView([Number(d.location.lat),Number(d.location.lon)],16,{animate:true});showToast(`${d.name} seleccionado y ubicado.`);}
async function openDriverQuickChat(id){const d=connectedDrivers.find(x=>x.id===id);quickChatDriverId=id;$("#driver-chat-name").textContent=d?.name||"Conductor";$("#driver-chat-modal").hidden=false;try{const data=await fetchJson(`/api/admin/chats/${encodeURIComponent(id)}/messages`);$("#driver-chat-history").innerHTML=(data.messages||[]).slice(-20).map(m=>`<div class="quick-msg ${m.sender==="admin"?"mine":""}"><b>${m.sender==="admin"?"Central":escapeHtml(d?.name||"Driver")}</b><p>${escapeHtml(m.message||"")}</p></div>`).join("")||"<p>Sin mensajes todavía.</p>";}catch(e){showToast(e.message);}}
$("#driver-quick-chat-form")?.addEventListener("submit",async e=>{e.preventDefault();const input=$("#driver-quick-chat-input"),message=input.value.trim();if(!message||!quickChatDriverId)return;try{await fetchJson(`/api/admin/chats/${encodeURIComponent(quickChatDriverId)}/messages`,{method:"POST",body:{message}});input.value="";$("#driver-chat-modal").hidden=true;showToast("Mensaje enviado");}catch(err){showToast(err.message);}});
$$("[data-close-modal]").forEach(b=>b.addEventListener("click",()=>{$(`#${b.dataset.closeModal}`).hidden=true;}));
$("#driver-assign-search")?.addEventListener("input",renderAssignSearch);

/* viajes */
const statusLabels={pending:"Pendiente",accepted:"Aceptado",driver_arriving:"En camino",arrived:"Llegó",in_progress:"En viaje",completed:"Terminado",cancelled:"Cancelado"};
function tripRow(t){return `<tr><td><button class="eye-btn" data-eye="${escapeHtml(t.id)}" title="Ver detalles">👁</button></td><td>${escapeHtml(t.id)}</td><td><span class="status-chip status-${escapeHtml(t.status)}">${escapeHtml(statusLabels[t.status]||t.status)}</span></td><td>${escapeHtml(t.passenger)}</td><td>${escapeHtml(t.phone)}</td><td>${escapeHtml(t.driver)}</td><td>${t.contactedAt?"✓":"—"}</td><td>${escapeHtml(t.pickup)}</td><td>${escapeHtml(t.destination)}</td><td>${new Date(t.createdAt).toLocaleTimeString("es-DO",{hour:"2-digit",minute:"2-digit"})}</td></tr>`;}
function renderTrips(){
  const q=($("#trip-search")?.value||"").trim().toLowerCase(),counts={};dispatchTrips.forEach(t=>{if(t.driverId)counts[t.driverId]=(counts[t.driverId]||0)+1;});const now=Date.now();
  const rows=dispatchTrips.filter(t=>{const scheduled=t.scheduledAt&&new Date(t.scheduledAt).getTime()>now;const doubleRide=t.driverId&&counts[t.driverId]>1;const f=tripFilter==="scheduled"?scheduled:tripFilter==="double"?doubleRide:!scheduled;return f&&(!q||JSON.stringify(t).toLowerCase().includes(q));});
  $("#trip-table-body").innerHTML=rows.length?rows.map(tripRow).join(""):'<tr><td colspan="10" style="text-align:center;padding:22px;color:#81919a;">No hay servicios activos.</td></tr>';
  $("#current-trip-count").textContent=dispatchTrips.length;
  $("#trip-table-body").querySelectorAll("[data-eye]").forEach(b=>b.addEventListener("click",()=>viewTripDetails(b.dataset.eye)));
}
async function loadDispatchTrips(){try{dispatchTrips=await fetchJson("/api/dispatch/rides");renderTrips();}catch{}}
function viewTripDetails(id){
  const t=dispatchTrips.find(x=>x.id===id);if(!t)return;
  $("#trip-details-panel").style.display="flex";$("#booking-form-content").style.display="none";$("#details-trip-id").textContent=t.id;
  $("#trip-details-content").innerHTML=`<div class="trip-detail-grid">
    <div><b>Fecha del viaje</b><span>${escapeHtml(fmtDate(t.createdAt))}</span></div>
    <div><b>Estado</b><span>${escapeHtml(statusLabels[t.status]||t.status)}</span></div>
    <div><b>Nombre del pasajero</b><span>${escapeHtml(t.passenger)}</span></div>
    <div><b>Teléfono</b><span>${escapeHtml(t.phone)}</span></div>
    <div><b>Conductor</b><span>${escapeHtml(t.driver)}</span></div>
    <div><b>Vehículo</b><span>${escapeHtml(t.driverVehicle||"—")} ${escapeHtml(t.driverPlate||"")}</span></div>
    <div><b>Recogida</b><span>${escapeHtml(t.pickup)}</span></div>
    <div><b>Destino</b><span>${escapeHtml(t.destination)}</span></div>
    <div><b>Precio</b><span>${fmtPrice(t.priceDop)}</span></div>
    <div><b>Distancia</b><span>${Number(t.distanceKm||0).toFixed(1)} km</span></div>
    <div><b>Duración</b><span>${Number(t.durationMin||0)} min</span></div>
    <div><b>Pago</b><span>${escapeHtml(t.paymentMethod||"—")}</span></div>
    <div><b>Nota</b><span>${escapeHtml(t.note||"Sin nota")}</span></div>
  </div>`;
  if(Number.isFinite(t.pickupLat)&&Number.isFinite(t.destinationLat))map.fitBounds([[t.pickupLat,t.pickupLon],[t.destinationLat,t.destinationLon]],{padding:[55,55]});
}
window.viewTripDetails=viewTripDetails;
$("#close-trip-details")?.addEventListener("click",()=>{$("#trip-details-panel").style.display="none";$("#booking-form-content").style.display="block";renderSelectionMarkers();calculateRoadRoute();});
$("#trip-search")?.addEventListener("input",renderTrips);
$("#refresh-trips")?.addEventListener("click",loadDispatchTrips);
$$("[data-trip-filter]").forEach(b=>b.addEventListener("click",()=>{tripFilter=b.dataset.tripFilter;$$("[data-trip-filter]").forEach(x=>x.classList.toggle("active",x===b));renderTrips();}));

/* crear reserva */
function scheduledValue(){
  if(travelTime.value!=="scheduled")return null;
  if(!scheduleDate.value||!scheduleTime.value)throw new Error("Selecciona fecha y hora del viaje programado.");
  const d=new Date(`${scheduleDate.value}T${scheduleTime.value}:00`);
  if(d.getTime()<=Date.now())throw new Error("La hora programada debe ser futura.");
  return d.toISOString();
}
let pendingRidePayload=null;
bookingForm?.addEventListener("submit",async e=>{
  e.preventDefault();const guest=serviceType.value==="Invitado";const name=guest?$("#guest-name").value:selectedCustomer?.name,phone=guest?$("#guest-phone").value:selectedCustomer?.phone;
  if(!name||!phone||!selectedLocations.pickup||!selectedLocations.destination)return showToast("Completa pasajero, recogida y destino.");
  try{const scheduledAt=scheduledValue(),stops=routeStops.filter(s=>s.location).map(s=>s.location);const est=await fetchJson("/api/rides/estimate",{method:"POST",body:{pickup:selectedLocations.pickup,destination:selectedLocations.destination,stops}}),estimate=est.estimate||{};
    pendingRidePayload={phone,name,pickup:selectedLocations.pickup,destination:selectedLocations.destination,stops,driverId:selectedDriverId||undefined,note:$("#dispatch-note").value,scheduledAt,passengerCount:Number($("#passenger-count-select").value?.match(/\d+/)?.[0]||1),paymentMethod:$("#payment-method-select").value};
    $("#fare-modal-route").innerHTML=`<b>${escapeHtml(selectedLocations.pickup.address)}</b><span>→</span><b>${escapeHtml(selectedLocations.destination.address)}</b>`;$("#fare-modal-price").textContent=fmtPrice(estimate.priceDop);$("#fare-modal-distance").textContent=`${Number(estimate.distanceKm||0).toFixed(2)} km`;$("#fare-modal-duration").textContent=`${Number(estimate.durationMin||0)} min`;$("#fare-modal").hidden=false;
  }catch(err){showToast(err.message);}
});
$("#confirm-create-ride")?.addEventListener("click",async()=>{if(!pendingRidePayload)return;const b=$("#confirm-create-ride");b.disabled=true;try{const data=await fetchJson("/api/rides",{method:"POST",body:pendingRidePayload});$("#fare-modal").hidden=true;showToast(`Servicio ${data.ride?.id||""} enviado.`);pendingRidePayload=null;clearBookingForm();await loadDispatchTrips();}catch(e){showToast(e.message);}finally{b.disabled=false;}});
function clearBookingForm(){
  bookingForm?.reset();selectedCustomer=null;selectedDriverId="";selectedLocations.pickup=null;selectedLocations.destination=null;
  routeStops.forEach(s=>s.row.remove());routeStops=[];stopSeq=0;
  selectedCustomerCard.hidden=true;customerResults.hidden=true;$("#driver-search-results").hidden=true;$("#registered-history-search").disabled=true;
  updateAssignedDriverSummary();toggleServiceFields();toggleSchedule();setMapSelection("pickup");renderSelectionMarkers();routeLayer?.clearLayers();routeNotice.textContent="Selecciona origen y destino para ver la ruta.";map?.setView(defaultCenter,defaultZoom);
}
$("#clear-form")?.addEventListener("click",e=>{e.preventDefault();clearBookingForm();showToast("Formulario limpio.");});

/* controles horizontales de tabla */
function bindScrollButton(id,dir){const b=$(id),sc=$("#trip-table-scroll");if(!b||!sc)return;let timer=null;const step=()=>sc.scrollBy({left:dir*280,behavior:"smooth"});b.addEventListener("click",step);b.addEventListener("pointerdown",()=>{timer=setInterval(()=>sc.scrollBy({left:dir*45}),80);});["pointerup","pointerleave","pointercancel"].forEach(ev=>b.addEventListener(ev,()=>{clearInterval(timer);timer=null;}));}
bindScrollButton("#trip-scroll-left",-1);bindScrollButton("#trip-scroll-right",1);

/* notificaciones reales de la central */
const notificationButton=$("#notification-button"),notificationPanel=$("#notification-panel"),notificationBadge=$("#notification-badge"),notificationList=$("#notification-list");
function enableNotifications(){
  notificationSound.play().then(()=>{notificationSound.pause();notificationSound.currentTime=0;}).catch(()=>{});
  if("Notification" in window&&Notification.permission==="default")Notification.requestPermission().catch(()=>{});
}
document.addEventListener("pointerdown",enableNotifications,{once:true});
function notifDestination(n){if(n.entityType==="driver")return"/drivers.html";if(n.entityType==="ride")return"/#active-trips";if(n.kind==="deposit"||n.entityType==="deposit")return"/deposits.html";return"#";}
function renderNotifications(data){
  const list=data.notifications||[],unread=Number(data.unreadCount||0);
  notificationBadge.textContent=unread;notificationBadge.hidden=!unread;notificationButton?.classList.toggle("has-unread",!!unread);
  notificationList.innerHTML=list.length?list.map(n=>`<a class="notification-item ${n.readAt?"read":"unread"}" href="${notifDestination(n)}"><span class="notification-symbol">${n.kind==="ride_cancelled"?"×":"●"}</span><span><b>${escapeHtml(n.title)}</b><small>${escapeHtml(n.body)}</small><time>${escapeHtml(fmtDate(n.createdAt))}</time></span></a>`).join(""):'<p class="notification-empty">No tienes avisos todavía.</p>';
  const ids=new Set(list.map(n=>Number(n.id)));
  if(notificationInitialized){
    const fresh=list.find(n=>!previousNotificationIds.has(Number(n.id))&&!n.readAt);
    if(fresh){notificationSound.currentTime=0;notificationSound.play().catch(()=>{});notificationButton?.classList.add("notification-button-pulse");setTimeout(()=>notificationButton?.classList.remove("notification-button-pulse"),1800);showToast(fresh.title);if("Notification" in window&&Notification.permission==="granted")new Notification(`TAXOTE · ${fresh.title}`,{body:fresh.body});}
  }
  previousNotificationIds=ids;notificationInitialized=true;
}
async function loadNotifications(){try{renderNotifications(await fetchJson("/api/admin/notifications"));}catch{}}
notificationButton?.addEventListener("click",e=>{e.stopPropagation();notificationPanel.hidden=!notificationPanel.hidden;if(!notificationPanel.hidden)loadNotifications();});
$("#close-notifications")?.addEventListener("click",()=>notificationPanel.hidden=true);
$("#read-all-notifications")?.addEventListener("click",async()=>{try{await fetchJson("/api/admin/notifications/read",{method:"POST",body:{all:true}});await loadNotifications();}catch(e){showToast(e.message);}});
document.addEventListener("click",e=>{if(notificationPanel&&!notificationPanel.hidden&&!notificationPanel.contains(e.target)&&e.target!==notificationButton)notificationPanel.hidden=true;});

/* TAXOTE Chat privado con conductores */
let floatingChatDriverId="";
async function renderFloatingPrivateChats(){const body=$("#internal-chat-body");if(!body)return;if(!floatingChatDriverId){try{const data=await fetchJson("/api/admin/chats");body.innerHTML=`<div class="floating-driver-list">${(data.conversations||[]).map(c=>`<button type="button" data-float-driver="${escapeHtml(c.driver.id)}"><b>${escapeHtml(c.driver.name)}</b><small>${escapeHtml(c.latestMessage?.message||"Abrir conversación privada")}</small></button>`).join("")||"<p>No hay conductores.</p>"}</div>`;body.querySelectorAll("[data-float-driver]").forEach(b=>b.addEventListener("click",()=>{floatingChatDriverId=b.dataset.floatDriver;renderFloatingPrivateChats();}));}catch(e){body.textContent=e.message;}}else{try{const d=connectedDrivers.find(x=>x.id===floatingChatDriverId),data=await fetchJson(`/api/admin/chats/${encodeURIComponent(floatingChatDriverId)}/messages`);body.innerHTML=`<button class="chat-back-private" type="button">← Conductores</button>${(data.messages||[]).map(m=>`<div class="floating-chat-msg ${m.sender==="admin"?"mine":""}"><b>${m.sender==="admin"?"Central":escapeHtml(d?.name||"Driver")}</b><span>${escapeHtml(m.message||"")}</span></div>`).join("")||"<p>Sin mensajes todavía.</p>"}`;body.querySelector(".chat-back-private")?.addEventListener("click",()=>{floatingChatDriverId="";renderFloatingPrivateChats();});}catch(e){body.textContent=e.message;}}}
window.toggleChat=(kind)=>{const wp=$("#whatsapp-panel"),ip=$("#internal-chat-panel"),target=kind==="whatsapp"?wp:ip,other=kind==="whatsapp"?ip:wp;if(other)other.style.display="none";if(target)target.style.display=target.style.display==="flex"?"none":"flex";if(kind==="internal"&&target?.style.display==="flex")renderFloatingPrivateChats();};
$("#btn-whatsapp-toggle")?.addEventListener("click",()=>toggleChat("whatsapp"));$("#btn-chat-toggle")?.addEventListener("click",()=>toggleChat("internal"));
$("#send-internal-chat")?.addEventListener("click",async()=>{const input=$("#internal-chat-input"),message=input.value.trim();if(!message||!floatingChatDriverId)return showToast("Selecciona un conductor.");try{await fetchJson(`/api/admin/chats/${encodeURIComponent(floatingChatDriverId)}/messages`,{method:"POST",body:{message}});input.value="";await renderFloatingPrivateChats();showToast("Mensaje enviado");}catch(e){showToast(e.message);}});

let trafficLayer=null;
async function setupTraffic(){const toggle=$("#traffic-toggle"),status=$("#traffic-status");if(!toggle)return;try{const s=await fetchJson("/api/maps-status");status.textContent=s.trafficAvailable?`Tráfico en tiempo real${s.provider?` · ${s.provider}`:""}`:"Tráfico: proveedor no configurado";toggle.disabled=!s.trafficAvailable;toggle.addEventListener("change",()=>{if(toggle.checked){trafficLayer=L.tileLayer("/api/traffic/{z}/{x}/{y}",{opacity:.72,maxZoom:19}).addTo(map);}else if(trafficLayer){map.removeLayer(trafficLayer);trafficLayer=null;}});}catch{status.textContent="Tráfico no disponible";toggle.disabled=true;}}
async function loadAdminSessionInfo(){const box=$("#admin-session-info");if(!box)return;try{const s=await fetchJson("/api/admin/session-info"),ua=s.browser||"";let browser=ua.includes("Edg/")?"Microsoft Edge":ua.includes("Chrome/")?"Google Chrome":ua.includes("Firefox/")?"Firefox":ua.includes("Safari/")?"Safari":"Navegador";box.innerHTML=`<b>Inicio de sesión</b><span>${escapeHtml(s.city||"")} ${escapeHtml(s.country||"")}</span><span>${escapeHtml(browser)}</span><span>IP: ${escapeHtml(s.ip||"—")}</span><small>${escapeHtml(fmtDate(s.loginAt))}</small>`;}catch{box.innerHTML="<b>Sesión administrativa</b><span>Información no disponible</span>";}}

/* logout completo */
window.adminLogout=async function(){
  if(!confirm("¿Seguro que deseas cerrar completamente la sesión administrativa?"))return;
  try{await fetchJson("/api/admin/logout",{method:"POST"});}catch{}
  try{localStorage.removeItem("taxote-booking-panel-width");localStorage.removeItem("taxote-drivers-panel-width");}catch{}
  location.replace("/admin-login.html");
};

initializeMap();toggleServiceFields();toggleSchedule();setMapSelection("pickup");updateAssignedDriverSummary();
loadRegisteredClients();loadConnectedDrivers();loadDispatchTrips();loadNotifications();loadAdminSessionInfo();setupTraffic();
setInterval(loadConnectedDrivers,4000);setInterval(loadDispatchTrips,7000);setInterval(loadNotifications,4000);
