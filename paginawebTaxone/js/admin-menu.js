
(() => {
  const q=s=>document.querySelector(s);
  const menu=q("#side-menu")||q("#chat-side-menu");
  if(!menu)return;
  const trigger=q("#menu-button")||q("#menu-toggle")||q("#chat-menu-button");
  const overlay=q("#drawer-overlay")||q("#chat-drawer-overlay");
  const close=q("#close-menu")||q("#chat-close-menu");
  const path=location.pathname.replace(/\.html$/,"")||"/";
  const links=[
    ["/","＋","Nueva reserva"],
    ["/drivers","♙","Conductores"],
    ["/deposits","💰","Depósitos"],
    ["/wallet","◈","Billetera"],
    ["/history","◷","Historial de viajes"],
    ["/drivers-chat","▤","Chat de conductores"],
    ["/conversation-history","▧","Historial de conversación"],
    ["/reports","▦","Reportes"]
  ];
  let nav=menu.querySelector(".side-navigation")||menu.querySelector(".taxote-universal-nav");
  if(!nav){
    nav=document.createElement("nav");
    const head=menu.querySelector(".side-menu-head")||menu.querySelector("#chat-close-menu");
    if(head?.after) head.after(nav); else menu.appendChild(nav);
  }
  nav.className="side-navigation taxote-universal-nav";
  nav.innerHTML=links.map(([href,icon,label])=>{
    const hp=href==="/" ? "/" : href;
    const active=hp==="/" ? path==="/" : path===hp || path===`${hp}/`;
    return `<a class="${active?"active":""}" href="${href}"><span>${icon}</span><b>${label}</b></a>`;
  }).join("")+`<hr><a href="#" id="universal-admin-logout" class="logout-link"><span>×</span><b>Cerrar sesión</b></a>`;

  // Remove old loose chat drawer links/buttons to avoid duplicates.
  [...menu.children].forEach(el=>{
    if(el!==nav && !el.classList.contains("side-menu-head") && !el.classList.contains("side-menu-footer") && el.id!=="chat-close-menu" && el.tagName==="A") el.remove();
    if(el!==nav && el.id==="chat-logout") el.remove();
  });

  let info=menu.querySelector("#universal-session-info");
  if(!info){
    info=document.createElement("section");
    info.id="universal-session-info";
    info.className="universal-session-info";
    const footer=menu.querySelector(".side-menu-footer");
    if(footer) footer.before(info); else menu.appendChild(info);
  }
  info.innerHTML=`<b>Seguridad de la sesión</b><span>Cargando IP y sesiones…</span>`;

  const openMenu=()=>{
    menu.classList.add("open");menu.setAttribute("aria-hidden","false");
    if(overlay)overlay.hidden=false;
    trigger?.setAttribute("aria-expanded","true");
    loadSessionInfo();
  };
  const closeMenu=()=>{
    menu.classList.remove("open");menu.setAttribute("aria-hidden","true");
    if(overlay)overlay.hidden=true;
    trigger?.setAttribute("aria-expanded","false");
  };
  trigger?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();menu.classList.contains("open")?closeMenu():openMenu();});
  close?.addEventListener("click",closeMenu);
  overlay?.addEventListener("click",closeMenu);

  q("#universal-admin-logout")?.addEventListener("click",async e=>{
    e.preventDefault();
    if(!confirm("¿Seguro que deseas cerrar la sesión administrativa?"))return;
    try{await fetch("/api/admin/logout",{method:"POST",credentials:"include"});}catch{}
    location.replace("/admin-login");
  });

  function browserName(ua=""){
    if(ua.includes("Edg/"))return"Microsoft Edge";
    if(ua.includes("Chrome/"))return"Google Chrome";
    if(ua.includes("Firefox/"))return"Firefox";
    if(ua.includes("Safari/"))return"Safari";
    return"Navegador";
  }
  async function loadSessionInfo(){
    try{
      const [r1,r2]=await Promise.all([
        fetch("/api/admin/session-info",{credentials:"include"}),
        fetch("/api/admin/sessions",{credentials:"include"})
      ]);
      if(r1.status===401||r2.status===401){location.replace("/admin-login");return;}
      const s=await r1.json(),all=await r2.json();
      const sessions=all.sessions||[];
      info.innerHTML=`<b>Seguridad de la sesión</b>
        <div class="session-main"><strong>IP: ${escapeHtml(s.ip||"No disponible")}</strong><span>${escapeHtml(browserName(s.browser||""))}</span><span>${escapeHtml([s.city,s.country].filter(Boolean).join(", ")||"Ubicación no disponible")}</span><small>Inicio: ${escapeHtml(s.loginAt?new Date(s.loginAt).toLocaleString("es-DO"):"—")}</small></div>
        <div class="session-count">Sesiones activas: <b>${sessions.length}</b></div>
        <div class="other-sessions">${sessions.filter(x=>!x.current).map(x=>`<article><div><strong>${escapeHtml(x.ip||"IP no disponible")}</strong><small>${escapeHtml([x.city,x.country].filter(Boolean).join(", "))}</small></div><button type="button" data-close-session="${escapeHtml(x.id)}">Cerrar</button></article>`).join("")||"<small>No hay otra sesión activa.</small>"}</div>`;
      info.querySelectorAll("[data-close-session]").forEach(b=>b.addEventListener("click",async()=>{
        if(!confirm("¿Cerrar esta otra sesión administrativa?"))return;
        try{
          const r=await fetch(`/api/admin/sessions/${encodeURIComponent(b.dataset.closeSession)}`,{method:"DELETE",credentials:"include"});
          if(!r.ok)throw new Error("No se pudo cerrar.");
          loadSessionInfo();
        }catch(e){alert(e.message);}
      }));
    }catch{
      info.innerHTML="<b>Seguridad de la sesión</b><span>No se pudo cargar la información.</span>";
    }
  }
  function escapeHtml(v=""){return String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
})();
