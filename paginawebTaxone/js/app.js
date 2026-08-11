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
let map, routeLayer, markerLayer, driverLocationLayer, baseTileLayer, darkTileLayer, mapEngine="leaflet", googleTrafficLayer=null, googleRoutePolyline=null, googleSelectionMarkers=[], googleDriverMarkers=[];
let dispatchTrips=[], connectedDrivers=[], routeStops=[], tripFilter='active';
let routeRequestId=0, previousNotificationIds=new Set(), notificationInitialized=false, previousChatUnread=0, detailTripId="", etaTimer=null, suppressOwnRideSoundUntil=0;

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


async function loadRecentPhones(){
  const list=$("#recent-phone-list"),chips=$("#recent-phone-chips");if(!list||!chips)return;
  try{
    const data=await fetchJson("/api/dispatch/recent-phones"),phones=data.phones||[];
    list.innerHTML=phones.map(p=>`<option value="${escapeHtml(p.phone)}">${escapeHtml(p.name)}</option>`).join("");
    chips.innerHTML=phones.map(p=>`<button type="button" data-recent-phone="${escapeHtml(p.phone)}" title="${escapeHtml(p.name)}">${escapeHtml(p.phone)}</button>`).join("");
    chips.querySelectorAll("[data-recent-phone]").forEach(b=>b.addEventListener("click",async()=>{$("#guest-phone").value=b.dataset.recentPhone;await getCustomerStatus(b.dataset.recentPhone,true);$("#guest-history-search")?.click();}));
  }catch{}
}

/* mapa */
function markerIcon(kind,num=0){
  const label=kind==="stop"?`C${num}`:kind==="destination"?"B":"A";
  return L.divIcon({className:"taxote-div-icon",html:`<div class="taxote-marker-shell"><div class="taxote-marker ${kind}"><span>${label}</span></div><button class="marker-remove" type="button" title="Quitar ${label}">×</button></div>`,iconSize:[30,30],iconAnchor:[15,30]});
}
async function initializeMap(){
  const cfg=await fetchJson("/api/maps-config").catch(()=>({}));
  if(cfg.googleMapsApiKey){
    try{
      if(!window.google?.maps)await new Promise((resolve,reject)=>{const s=document.createElement("script");s.async=true;s.defer=true;s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.googleMapsApiKey)}&libraries=places&language=es&region=DO&v=weekly`;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
      mapEngine="google";map=new google.maps.Map(document.getElementById("live-map"),{center:{lat:defaultCenter[0],lng:defaultCenter[1]},zoom:defaultZoom,mapTypeId:"roadmap",streetViewControl:false,mapTypeControl:false,fullscreenControl:false,gestureHandling:"greedy"});map.addListener("click",e=>setPointFromMap(activeMapSelection,{lat:e.latLng.lat(),lng:e.latLng.lng()}));return;
    }catch(e){console.warn("Google Maps no disponible; usando fallback.",e);}
  }
  mapEngine="leaflet";map=L.map("live-map",{zoomControl:true}).setView(defaultCenter,defaultZoom);baseTileLayer=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(map);darkTileLayer=L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{maxZoom:20,attribution:"© OpenStreetMap © CARTO"});routeLayer=L.layerGroup().addTo(map);markerLayer=L.layerGroup().addTo(map);driverLocationLayer=L.layerGroup().addTo(map);map.on("click",e=>setPointFromMap(activeMapSelection,e.latlng));
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
function markerLabel(iconKind,num=0){return iconKind==="pickup"?"A":iconKind==="destination"?"B":`C${num}`;}
function clearSelectionMarkers(){if(mapEngine==="google"){googleSelectionMarkers.forEach(m=>m.setMap(null));googleSelectionMarkers=[];}else markerLayer?.clearLayers();}
function addMarker(kind,loc,iconKind,num=0){if(!loc)return;if(mapEngine==="google"){const label=markerLabel(iconKind,num),m=new google.maps.Marker({position:{lat:Number(loc.lat),lng:Number(loc.lon)},map,draggable:!String(kind).startsWith("detail-"),label:{text:label,color:"#fff",fontWeight:"700"},title:`Punto ${label}`});if(!String(kind).startsWith("detail-")){m.addListener("dragend",e=>setPointFromMap(kind,{lat:e.latLng.lat(),lng:e.latLng.lng()}));m.addListener("click",()=>setMapSelection(kind));}googleSelectionMarkers.push(m);}else{const m=L.marker([loc.lat,loc.lon],{icon:markerIcon(iconKind,num),draggable:!String(kind).startsWith("detail-")}).addTo(markerLayer);if(!String(kind).startsWith("detail-")){m.on("dragend",e=>setPointFromMap(kind,e.target.getLatLng()));m.on("click",()=>setMapSelection(kind));setTimeout(()=>m.getElement()?.querySelector(".marker-remove")?.addEventListener("click",e=>{e.stopPropagation();removePoint(kind);}),0);}}}
function renderSelectionMarkers(){clearSelectionMarkers();addMarker("pickup",selectedLocations.pickup,"pickup");routeStops.forEach((s,i)=>addMarker(s.id,s.location,"stop",i+1));addMarker("destination",selectedLocations.destination,"destination");}
function routePoints(){return [selectedLocations.pickup,...routeStops.map(s=>s.location).filter(Boolean),selectedLocations.destination].filter(Boolean);}
function clearRouteVisual(){if(mapEngine==="google"){if(googleRoutePolyline){googleRoutePolyline.setMap(null);googleRoutePolyline=null;}}else routeLayer?.clearLayers();}
function drawPolyline(coords,color="#0b2e47"){clearRouteVisual();if(mapEngine==="google"){googleRoutePolyline=new google.maps.Polyline({path:coords.map(([lon,lat])=>({lat,lng:lon})),strokeColor:color,strokeOpacity:1,strokeWeight:5,map});}else L.polyline(coords.map(([lon,lat])=>[lat,lon]),{color,weight:5}).addTo(routeLayer);}
async function drawRouteForPoints(pts,notice=true){clearRouteVisual();if(pts.length<2){if(notice)routeNotice.textContent="Selecciona origen y destino para ver la ruta.";return;}const req=++routeRequestId,coords=pts.map(p=>`${p.lon},${p.lat}`).join(";");try{const data=await fetchJson(`/api/route?coordinates=${encodeURIComponent(coords)}`);if(req!==routeRequestId)return;if(data.routes?.[0]){const r=data.routes[0];drawPolyline(r.geometry.coordinates);if(notice)routeNotice.textContent=`Ruta lista: ${(r.distance/1000).toFixed(1)} km · ${Math.ceil(r.duration/60)} min`;}}catch(e){if(notice)routeNotice.textContent="No se pudo calcular la ruta ahora.";}}
async function calculateRoadRoute(){return drawRouteForPoints(routePoints(),true);}
function fitPoints(pts){if(!pts.length){if(mapEngine==="google"){map.setCenter({lat:defaultCenter[0],lng:defaultCenter[1]});map.setZoom(defaultZoom);}else map.setView(defaultCenter,defaultZoom);return;}if(mapEngine==="google"){const b=new google.maps.LatLngBounds();pts.forEach(p=>b.extend({lat:Number(p.lat),lng:Number(p.lon)}));map.fitBounds(b,55);}else map.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lon])),{padding:[55,55],maxZoom:14});}
function fitCurrentRoute(){fitPoints(routePoints());}
$("#recenter")?.addEventListener("click",()=>detailTripId?showTripOnMap(detailTripId,true):fitCurrentRoute());
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
function renderDriverLocations(){if(mapEngine==="google"){googleDriverMarkers.forEach(m=>m.setMap(null));googleDriverMarkers=[];connectedDrivers.forEach(d=>{if(!d.location)return;const m=new google.maps.Marker({position:{lat:Number(d.location.lat),lng:Number(d.location.lon)},map,title:d.name,icon:{url:"/assets/taxote-car.png",scaledSize:new google.maps.Size(28,32)}});m.addListener("click",()=>locateConnectedDriver(d.id));googleDriverMarkers.push(m);});}else{driverLocationLayer?.clearLayers();connectedDrivers.forEach(d=>{if(!d.location)return;L.marker([d.location.lat,d.location.lon],{icon:L.divIcon({className:"taxote-car-marker",html:`<img src="/assets/taxote-car.png" style="width:32px;height:35px;transform:rotate(${Number(d.location.bearing||0)}deg)">`})}).addTo(driverLocationLayer).bindPopup(`<b>${escapeHtml(d.name)}</b><br>${escapeHtml(d.vehiclePlate||"")}`);});}}
$("#connected-driver-search")?.addEventListener("input",renderConnectedDrivers);
let quickChatDriverId="";
function locateConnectedDriver(id){const d=connectedDrivers.find(x=>x.id===id);if(!d?.location)return showToast("Ese conductor todavía no reporta ubicación.");selectedDriverId=id;updateAssignedDriverSummary();renderConnectedDrivers();if(mapEngine==="google"){map.panTo({lat:Number(d.location.lat),lng:Number(d.location.lon)});map.setZoom(16);}else map?.setView([Number(d.location.lat),Number(d.location.lon)],16,{animate:true});showToast(`${d.name} seleccionado y ubicado.`);}
async function openDriverQuickChat(id){const d=connectedDrivers.find(x=>x.id===id);quickChatDriverId=id;$("#driver-chat-name").textContent=d?.name||"Conductor";$("#driver-chat-modal").hidden=false;try{const data=await fetchJson(`/api/admin/chats/${encodeURIComponent(id)}/messages`);$("#driver-chat-history").innerHTML=(data.messages||[]).slice(-20).map(m=>`<div class="quick-msg ${m.sender==="admin"?"mine":""}"><b>${m.sender==="admin"?"Central":escapeHtml(d?.name||"Driver")}</b><p>${escapeHtml(m.message||"")}</p></div>`).join("")||"<p>Sin mensajes todavía.</p>";}catch(e){showToast(e.message);}}
$("#driver-quick-chat-form")?.addEventListener("submit",async e=>{e.preventDefault();const input=$("#driver-quick-chat-input"),message=input.value.trim();if(!message||!quickChatDriverId)return;try{await fetchJson(`/api/admin/chats/${encodeURIComponent(quickChatDriverId)}/messages`,{method:"POST",body:{message}});input.value="";$("#driver-chat-modal").hidden=true;showToast("Mensaje enviado");}catch(err){showToast(err.message);}});
$$("[data-close-modal]").forEach(b=>b.addEventListener("click",()=>{$(`#${b.dataset.closeModal}`).hidden=true;if(b.dataset.closeModal==="eta-modal"){clearInterval(etaTimer);etaTimer=null;}}));
$("#driver-assign-search")?.addEventListener("input",renderAssignSearch);

/* viajes */
const statusLabels={pending:"NUEVO",accepted:"Aceptado",driver_arriving:"En camino",arrived:"Llegó",in_progress:"En viaje",completed:"Terminado",cancelled:"Cancelado"};
function tripRow(t){const canCancel=!["completed","cancelled"].includes(t.status),canArrive=["accepted","driver_arriving"].includes(t.status),hasDriver=!!t.driverId;return `<tr><td class="trip-actions-cell">${canCancel?`<button class="trip-cancel-btn" data-cancel-trip="${escapeHtml(t.id)}" title="Cancelar">×</button>`:""}<button class="eye-btn" data-eye="${escapeHtml(t.id)}" title="Ver detalles">👁</button>${hasDriver?`<button class="trip-eta-btn" data-eta-trip="${escapeHtml(t.id)}" title="Tiempo de llegada">⏱</button>`:""}${canArrive?`<button class="trip-arrived-btn" data-arrived-trip="${escapeHtml(t.id)}" title="Marcar llegó">✓ Llegó</button>`:""}</td><td>${escapeHtml(t.id)}</td><td><span class="status-chip status-${escapeHtml(t.status)}">${escapeHtml(statusLabels[t.status]||t.status)}</span></td><td>${escapeHtml(t.passenger)}</td><td>${escapeHtml(t.phone)}</td><td>${escapeHtml(t.driver)}</td><td>${t.contactedAt?"✓":"—"}</td><td>${escapeHtml(t.pickup)}</td><td>${escapeHtml(t.destination)}</td><td>${new Date(t.createdAt).toLocaleTimeString("es-DO",{hour:"2-digit",minute:"2-digit"})}</td></tr>`;}
function renderTrips(){
  const q=($("#trip-search")?.value||"").trim().toLowerCase(),counts={};dispatchTrips.forEach(t=>{if(t.driverId)counts[t.driverId]=(counts[t.driverId]||0)+1;});const now=Date.now();
  const rows=dispatchTrips.filter(t=>{const scheduled=t.scheduledAt&&new Date(t.scheduledAt).getTime()>now;const doubleRide=t.driverId&&counts[t.driverId]>1;const f=tripFilter==="scheduled"?scheduled:tripFilter==="double"?doubleRide:!scheduled;return f&&(!q||JSON.stringify(t).toLowerCase().includes(q));});
  $("#trip-table-body").innerHTML=rows.length?rows.map(tripRow).join(""):'<tr><td colspan="10" style="text-align:center;padding:22px;color:#81919a;">No hay servicios activos.</td></tr>';
  $("#current-trip-count").textContent=dispatchTrips.length;
  $("#trip-table-body").querySelectorAll("[data-eye]").forEach(b=>b.addEventListener("click",()=>viewTripDetails(b.dataset.eye)));
  $("#trip-table-body").querySelectorAll("[data-cancel-trip]").forEach(b=>b.addEventListener("click",()=>openCancelRide(b.dataset.cancelTrip)));
  $("#trip-table-body").querySelectorAll("[data-eta-trip]").forEach(b=>b.addEventListener("click",()=>openEta(b.dataset.etaTrip)));
  $("#trip-table-body").querySelectorAll("[data-arrived-trip]").forEach(b=>b.addEventListener("click",()=>markArrived(b.dataset.arrivedTrip)));
}
async function loadDispatchTrips(){try{dispatchTrips=await fetchJson("/api/dispatch/rides");renderTrips();}catch{}}
async function showTripOnMap(id,fit=true){const t=dispatchTrips.find(x=>x.id===id);if(!t)return;clearSelectionMarkers();const pts=[{address:t.pickup,lat:Number(t.pickupLat),lon:Number(t.pickupLon)},...(t.stops||[]).map(s=>({address:s.address,lat:Number(s.lat),lon:Number(s.lon)})),{address:t.destination,lat:Number(t.destinationLat),lon:Number(t.destinationLon)}].filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));if(pts[0])addMarker("detail-a",pts[0],"pickup");(t.stops||[]).forEach((s,i)=>addMarker(`detail-c-${i}`,{lat:Number(s.lat),lon:Number(s.lon)},"stop",i+1));if(pts.length>1)addMarker("detail-b",pts[pts.length-1],"destination");await drawRouteForPoints(pts,false);if(fit)fitPoints(pts);}
function viewTripDetails(id){const t=dispatchTrips.find(x=>x.id===id);if(!t)return;detailTripId=id;$("#trip-details-panel").style.display="flex";$("#booking-form-content").style.display="none";$("#details-trip-id").textContent=t.id;$("#trip-details-content").innerHTML=`<div class="trip-detail-grid compact"><div><b>Fecha</b><span>${escapeHtml(fmtDate(t.createdAt))}</span></div><div><b>Estado</b><span>${escapeHtml(statusLabels[t.status]||t.status)}</span></div><div><b>Pasajero</b><span>${escapeHtml(t.passenger)}</span></div><div><b>Teléfono</b><span>${escapeHtml(t.phone)}</span></div><div><b>Conductor</b><span>${escapeHtml(t.driver)}</span></div><div><b>Vehículo</b><span>${escapeHtml(t.driverVehicle||"—")} ${escapeHtml(t.driverPlate||"")}</span></div><div><b>Recogida A</b><span>${escapeHtml(t.pickup)}</span></div><div><b>Destino B</b><span>${escapeHtml(t.destination)}</span></div>${(t.stops||[]).map((s,i)=>`<div><b>Parada C${i+1}</b><span>${escapeHtml(s.address)}</span></div>`).join("")}<div><b>Precio</b><span>${fmtPrice(t.priceDop)}</span></div><div><b>Distancia</b><span>${Number(t.distanceKm||0).toFixed(1)} km</span></div><div><b>Duración</b><span>${Number(t.durationMin||0)} min</span></div><div><b>Pago</b><span>${escapeHtml(t.paymentMethod||"—")}</span></div><div><b>Nota</b><span>${escapeHtml(t.note||"Sin nota")}</span></div></div><div class="detail-actions">${!["completed","cancelled"].includes(t.status)?`<button class="button button-danger" onclick="openCancelRide('${escapeHtml(t.id)}')">× Cancelar</button>`:""}${t.driverId?`<button class="button button-light" onclick="openEta('${escapeHtml(t.id)}')">⏱ Tiempo</button>`:""}${["accepted","driver_arriving"].includes(t.status)?`<button class="button button-primary" onclick="markArrived('${escapeHtml(t.id)}')">✓ Llegó</button>`:""}</div>`;showTripOnMap(id,true);}
window.viewTripDetails=viewTripDetails;
$("#close-trip-details")?.addEventListener("click",()=>{detailTripId="";$("#trip-details-panel").style.display="none";$("#booking-form-content").style.display="block";renderSelectionMarkers();calculateRoadRoute();});
$("#trip-search")?.addEventListener("input",renderTrips);
$("#refresh-trips")?.addEventListener("click",loadDispatchTrips);
$$("[data-trip-filter]").forEach(b=>b.addEventListener("click",()=>{tripFilter=b.dataset.tripFilter;$$("[data-trip-filter]").forEach(x=>x.classList.toggle("active",x===b));renderTrips();}));

/* cancelar / llegó / ETA */
const CANCEL_REASONS={dispatcher:["Error del Dispatcher","Viaje duplicado","Cancelar y enviar de nuevo","El pasajero pidió cancelar","No hay conductores aceptando el viaje","Otro"],driver:["Problema del vehículo","Emergencia del conductor","No puede llegar a la recogida","El pasajero pidió cancelar","Otro"],passenger:["El pasajero pidió cancelar","No necesita el servicio","Emergencia del pasajero","Otro"]};
let cancelRideId="",cancelActor="dispatcher";
function renderCancelReasons(){const box=$("#cancel-reasons");if(!box)return;box.innerHTML=(CANCEL_REASONS[cancelActor]||[]).map((r,i)=>`<label><input type="radio" name="cancel-reason" value="${escapeHtml(r)}" ${i===0?"checked":""}> ${escapeHtml(r)}</label>`).join("");}
function openCancelRide(id){cancelRideId=id;cancelActor="dispatcher";$$("[data-cancel-actor]").forEach(b=>b.classList.toggle("active",b.dataset.cancelActor==="dispatcher"));renderCancelReasons();$("#cancel-note").value="";if($("#cancel-copy-ride"))$("#cancel-copy-ride").checked=false;$("#cancel-ride-title").textContent=`Cancelar ${id}`;$("#cancel-ride-modal").hidden=false;}window.openCancelRide=openCancelRide;
$$("[data-cancel-actor]").forEach(b=>b.addEventListener("click",()=>{cancelActor=b.dataset.cancelActor;$$("[data-cancel-actor]").forEach(x=>x.classList.toggle("active",x===b));renderCancelReasons();}));
$("#confirm-cancel-ride")?.addEventListener("click",async()=>{
  const reason=$('input[name="cancel-reason"]:checked')?.value,note=$("#cancel-note").value.trim();if(!cancelRideId||!reason)return;
  if(reason==="Otro"&&!note)return showToast("Escribe la nota para explicar el motivo.");
  const original=dispatchTrips.find(x=>x.id===cancelRideId),copyRide=$("#cancel-copy-ride")?.checked;
  try{
    const result=await fetchJson(`/api/dispatch/rides/${encodeURIComponent(cancelRideId)}/cancel`,{method:"POST",body:{actor:cancelActor,reason,note}});
    $("#cancel-ride-modal").hidden=true;detailTripId="";$("#trip-details-panel").style.display="none";$("#booking-form-content").style.display="block";
    await loadDispatchTrips();
    if(copyRide&&original)await restoreRideToForm(original);else{renderSelectionMarkers();calculateRoadRoute();}
    const extra=result.driverPenaltyPoints?` Se descontó ${result.driverPenaltyPoints} punto al conductor.`:result.passengerFineDop?` Se agregó una multa de RD$${result.passengerFineDop} al pasajero.`:"";
    showToast("Servicio cancelado."+extra);
  }catch(e){showToast(e.message);}
});
async function markArrived(id){try{await fetchJson(`/api/dispatch/rides/${encodeURIComponent(id)}/status`,{method:"POST",body:{action:"arrived"}});showToast("Conductor marcado como: Llegó.");await loadDispatchTrips();if(detailTripId===id)viewTripDetails(id);}catch(e){showToast(e.message);}}window.markArrived=markArrived;
async function refreshEta(id){const t=dispatchTrips.find(x=>x.id===id),d=connectedDrivers.find(x=>x.id===t?.driverId);if(!t||!d?.location){$("#eta-live").textContent="Ubicación del conductor no disponible";return;}try{const coords=`${Number(d.location.lon)},${Number(d.location.lat)};${Number(t.pickupLon)},${Number(t.pickupLat)}`,data=await fetchJson(`/api/route?coordinates=${encodeURIComponent(coords)}`),r=data.routes?.[0];if(!r)throw new Error();$("#eta-live").textContent=`Llega en ${Math.max(1,Math.ceil(r.duration/60))} min`;$("#eta-updated").textContent=`Actualizado ${new Date().toLocaleTimeString("es-DO")}`;}catch{$("#eta-live").textContent="No se pudo calcular ahora.";}}
function openEta(id){clearInterval(etaTimer);const t=dispatchTrips.find(x=>x.id===id);$("#eta-driver-name").textContent=t?.driver||"Conductor";$("#eta-modal").hidden=false;refreshEta(id);etaTimer=setInterval(()=>refreshEta(id),5000);}window.openEta=openEta;


async function restoreRideToForm(t){
  clearBookingForm();
  serviceType.value=t.passengerType==="registered"?"Registrado":"Invitado";toggleServiceFields();
  if(serviceType.value==="Invitado"){
    $("#guest-phone").value=t.phone||"";$("#guest-name").value=t.passenger||"";
  }else{
    let c=registeredClients.find(x=>x.phone===t.phone);if(!c){await loadRegisteredClients();c=registeredClients.find(x=>x.phone===t.phone);}
    if(c)selectCustomer(c.id);
  }
  selectedLocations.pickup={address:t.pickup,lat:Number(t.pickupLat),lon:Number(t.pickupLon)};pickupInput.value=t.pickup||"";
  selectedLocations.destination={address:t.destination,lat:Number(t.destinationLat),lon:Number(t.destinationLon)};destinationInput.value=t.destination||"";
  for(const s of (t.stops||[])){addRouteStop();const rs=routeStops[routeStops.length-1];rs.location={address:s.address,lat:Number(s.lat),lon:Number(s.lon)};rs.input.value=s.address;}
  $("#dispatch-note").value=t.note||"";$("#payment-method-select").value=t.paymentMethod||"Efectivo";
  if(t.driverId&&connectedDrivers.some(d=>d.id===t.driverId&&d.connectionState!=="busy")){selectedDriverId=t.driverId;updateAssignedDriverSummary();$("#driver-assign-search").value=connectedDrivers.find(d=>d.id===t.driverId)?.name||"";}
  renderSelectionMarkers();await calculateRoadRoute();fitCurrentRoute();setMapSelection("pickup");showToast("Viaje copiado al formulario.");
}
let lastCustomerStatusPhone="",duplicateResolver=null;
async function getCustomerStatus(phoneValue,showDebt=true){
  const p=String(phoneValue||"").trim();if(p.replace(/\D/g,"").length<7)return null;
  try{
    const s=await fetchJson(`/api/dispatch/customer-status?phone=${encodeURIComponent(p)}`);
    if(showDebt&&s.exists&&Number(s.debtDop||0)>0&&p!==lastCustomerStatusPhone){
      lastCustomerStatusPhone=p;$("#customer-status-title").textContent=`${s.profile?.name||"Cliente"} tiene una multa pendiente`;
      $("#customer-status-content").innerHTML=`<div class="debt-highlight">RD$${Number(s.debtDop).toLocaleString("es-DO")}</div><p>Se cobrarán hasta RD$50 adicionales en cada servicio terminado hasta saldar la multa.</p>`;
      $("#customer-status-modal").hidden=false;
    }
    return s;
  }catch{return null;}
}
function confirmDuplicateRide(status){
  if(!status?.activeRides?.length)return Promise.resolve(true);
  $("#duplicate-ride-text").textContent=`Este número tiene ${status.activeRides.length} servicio(s) activo(s). ¿Deseas enviar otro servicio?`;
  $("#duplicate-ride-modal").hidden=false;
  return new Promise(resolve=>{duplicateResolver=resolve;});
}
$("#duplicate-yes")?.addEventListener("click",()=>{$("#duplicate-ride-modal").hidden=true;duplicateResolver?.(true);duplicateResolver=null;});
$("#duplicate-no")?.addEventListener("click",()=>{$("#duplicate-ride-modal").hidden=true;duplicateResolver?.(false);duplicateResolver=null;});$("#duplicate-x")?.addEventListener("click",()=>{$("#duplicate-ride-modal").hidden=true;duplicateResolver?.(false);duplicateResolver=null;});
$("#guest-phone")?.addEventListener("blur",()=>getCustomerStatus($("#guest-phone").value,true));

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
  const customerStatus=await getCustomerStatus(phone,false);if(customerStatus?.activeRides?.length&&!await confirmDuplicateRide(customerStatus))return;
  try{const scheduledAt=scheduledValue(),stops=routeStops.filter(s=>s.location).map(s=>s.location);const est=await fetchJson("/api/rides/estimate",{method:"POST",body:{pickup:selectedLocations.pickup,destination:selectedLocations.destination,stops,passengerCount:Number($("#passenger-count-select").value||1)}}),estimate=est.estimate||{};
    pendingRidePayload={phone,name,pickup:selectedLocations.pickup,destination:selectedLocations.destination,stops,driverId:selectedDriverId||undefined,note:$("#dispatch-note").value,scheduledAt,passengerCount:Math.min(4,Math.max(1,Number($("#passenger-count-select").value||1))),paymentMethod:$("#payment-method-select").value};
    $("#fare-modal-route").innerHTML=`<b>${escapeHtml(selectedLocations.pickup.address)}</b><span>→</span><b>${escapeHtml(selectedLocations.destination.address)}</b>`;$("#fare-modal-price").textContent=fmtPrice(estimate.priceDop);$("#fare-modal-distance").textContent=`${Number(estimate.distanceKm||0).toFixed(2)} km`;$("#fare-modal-duration").textContent=`${Number(estimate.durationMin||0)} min`;const fee=Number(estimate.passengerSurchargeDop||0);$("#fare-modal-distance").title=fee?`Incluye RD$${fee} por ${Number(estimate.passengerCount||1)} pasajeros`:"Sin cargo adicional por pasajeros";$("#fare-modal").hidden=false;
  }catch(err){showToast(err.message);}
});
$("#confirm-create-ride")?.addEventListener("click",async()=>{if(!pendingRidePayload)return;const b=$("#confirm-create-ride");b.disabled=true;try{suppressOwnRideSoundUntil=Date.now()+8000;const data=await fetchJson("/api/rides",{method:"POST",body:pendingRidePayload});$("#fare-modal").hidden=true;showToast(`Servicio ${data.ride?.id||""} enviado.`);pendingRidePayload=null;clearBookingForm();await Promise.all([loadDispatchTrips(),loadRecentPhones()]);}catch(e){showToast(e.message);}finally{b.disabled=false;}});
function clearBookingForm(){
  bookingForm?.reset();selectedCustomer=null;selectedDriverId="";selectedLocations.pickup=null;selectedLocations.destination=null;
  routeStops.forEach(s=>s.row.remove());routeStops=[];stopSeq=0;
  selectedCustomerCard.hidden=true;customerResults.hidden=true;$("#driver-search-results").hidden=true;$("#registered-history-search").disabled=true;
  updateAssignedDriverSummary();toggleServiceFields();toggleSchedule();setMapSelection("pickup");renderSelectionMarkers();routeLayer?.clearLayers();routeNotice.textContent="Selecciona origen y destino para ver la ruta.";map?.setView(defaultCenter,defaultZoom);
}
$("#clear-form")?.addEventListener("click",e=>{e.preventDefault();clearBookingForm();showToast("Formulario limpio.");});
$("#passenger-count-select")?.addEventListener("change",()=>{const n=Number($("#passenger-count-select").value||1);if(n>=3&&!selectedDriverId)showToast(`${n} pasajeros: TAXOTE buscará automáticamente vehículos SUV disponibles.`);});

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
    if(fresh){const ownRideSuppressed=fresh.kind==="ride"&&Date.now()<suppressOwnRideSoundUntil;if(!ownRideSuppressed){notificationSound.currentTime=0;notificationSound.play().catch(()=>{});}notificationButton?.classList.add("notification-button-pulse");setTimeout(()=>notificationButton?.classList.remove("notification-button-pulse"),1800);if(!ownRideSuppressed)showToast(fresh.title);if(!ownRideSuppressed&&"Notification" in window&&Notification.permission==="granted")new Notification(`TAXOTE · ${fresh.title}`,{body:fresh.body});}
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
const GOOGLE_DARK_STYLES=[{elementType:"geometry",stylers:[{color:"#d8e0e5"}]},{elementType:"labels.text.fill",stylers:[{color:"#344955"}]},{elementType:"labels.text.stroke",stylers:[{color:"#f4f7f8"}]},{featureType:"road",elementType:"geometry",stylers:[{color:"#b9c6cc"}]},{featureType:"road",elementType:"labels.text.fill",stylers:[{color:"#253c49"}]},{featureType:"water",elementType:"geometry",stylers:[{color:"#8bb4c7"}]},{featureType:"poi",elementType:"geometry",stylers:[{color:"#cad6cd"}]}];
function applyMapStyle(mode){if(mapEngine==="google")map.setOptions({styles:mode==="dark"?GOOGLE_DARK_STYLES:null});else if(map){if(baseTileLayer)map.removeLayer(baseTileLayer);if(darkTileLayer)map.removeLayer(darkTileLayer);(mode==="dark"?darkTileLayer:baseTileLayer)?.addTo(map);}}
$$('input[name="map-style"]').forEach(r=>r.addEventListener("change",()=>{if(r.checked)applyMapStyle(r.value);}));
async function setupTraffic(){const toggle=$("#traffic-toggle"),status=$("#traffic-status");if(!toggle)return;try{const s=await fetchJson("/api/maps-status");status.textContent=s.trafficAvailable?`Tráfico en tiempo real · ${s.provider||"proveedor"}`:"Tráfico: proveedor no configurado";toggle.disabled=!s.trafficAvailable;toggle.addEventListener("change",()=>{if(mapEngine==="google"&&window.google?.maps){if(!googleTrafficLayer)googleTrafficLayer=new google.maps.TrafficLayer();googleTrafficLayer.setMap(toggle.checked?map:null);}else{if(toggle.checked){trafficLayer=L.tileLayer("/api/traffic/{z}/{x}/{y}",{opacity:.72,maxZoom:19}).addTo(map);}else if(trafficLayer){map.removeLayer(trafficLayer);trafficLayer=null;}}});}catch{status.textContent="Tráfico no disponible";toggle.disabled=true;}}
async function loadAdminSessionInfo(){const box=$("#admin-session-info");if(!box)return;try{const s=await fetchJson("/api/admin/session-info"),ua=s.browser||"";let browser=ua.includes("Edg/")?"Microsoft Edge":ua.includes("Chrome/")?"Google Chrome":ua.includes("Firefox/")?"Firefox":ua.includes("Safari/")?"Safari":"Navegador";box.innerHTML=`<b>Inicio de sesión</b><span>${escapeHtml(s.city||"")} ${escapeHtml(s.country||"")}</span><span>${escapeHtml(browser)}</span><span>IP: ${escapeHtml(s.ip||"—")}</span><small>${escapeHtml(fmtDate(s.loginAt))}</small>`;}catch{box.innerHTML="<b>Sesión administrativa</b><span>Información no disponible</span>";}}


async function loadSecurityPanel(){
  const sessionsBox=$("#security-sessions"),eventsBox=$("#security-events");if(!sessionsBox||!eventsBox)return;
  try{
    const [s,e]=await Promise.all([fetchJson("/api/admin/sessions"),fetchJson("/api/admin/security-events")]);
    sessionsBox.innerHTML=(s.sessions||[]).map(x=>`<article class="security-row ${x.current?"current":""}"><div><b>${x.current?"Esta sesión":"Otra sesión"} · ${escapeHtml(x.ip||"IP no disponible")}</b><span>${escapeHtml(x.city||"")} ${escapeHtml(x.country||"")}</span><small>${escapeHtml(fmtDate(x.createdAt))}</small></div>${x.current?"<em>Actual</em>":`<button data-kill-session="${escapeHtml(x.id)}">Cerrar sesión</button>`}</article>`).join("")||"<p>No hay sesiones.</p>";
    eventsBox.innerHTML=(e.events||[]).slice(0,12).map(x=>`<article class="security-row ${x.successful?"":"failed"}"><div><b>${x.successful?"Inicio correcto":"Intento fallido"} · ${escapeHtml(x.ip||"IP no disponible")}</b><span>${escapeHtml(x.city||"")} ${escapeHtml(x.country||"")}</span><small>${escapeHtml(fmtDate(x.createdAt))}</small></div></article>`).join("");
    sessionsBox.querySelectorAll("[data-kill-session]").forEach(b=>b.addEventListener("click",async()=>{try{await fetchJson(`/api/admin/sessions/${encodeURIComponent(b.dataset.killSession)}`,{method:"DELETE"});showToast("Sesión cerrada.");loadSecurityPanel();}catch(err){showToast(err.message);}}));
  }catch(err){showToast(err.message);}
}
$("#open-security")?.addEventListener("click",e=>{e.preventDefault();$("#security-modal").hidden=false;loadSecurityPanel();});

/* logout completo */
window.adminLogout=async function(){
  if(!confirm("¿Seguro que deseas cerrar completamente la sesión administrativa?"))return;
  try{await fetchJson("/api/admin/logout",{method:"POST"});}catch{}
  try{localStorage.removeItem("taxote-booking-panel-width");localStorage.removeItem("taxote-drivers-panel-width");}catch{}
  location.replace("/admin-login.html");
};

initializeMap().then(()=>setupTraffic()).catch(()=>{});toggleServiceFields();toggleSchedule();setMapSelection("pickup");updateAssignedDriverSummary();
loadRegisteredClients();loadConnectedDrivers();loadDispatchTrips();loadNotifications();loadAdminSessionInfo();loadRecentPhones();
setInterval(loadConnectedDrivers,4000);setInterval(loadDispatchTrips,7000);setInterval(loadNotifications,4000);
