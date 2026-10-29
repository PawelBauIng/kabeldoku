/* Kabel-Fotodoku: Fotopunkte auf dem Kabelplan. Alle Daten bleiben lokal im Browser (IndexedDB). */
(function(){
"use strict";
const APP_VERSION="1.3.0";
const FORMAT="kabel-fotodoku";
const $=id=>document.getElementById(id);
const stage=$("stage"), planEl=$("plan"), pinsEl=$("pins"), sheet=$("sheet");

/* ================= Hilfsfunktionen ================= */
const uid=()=>(crypto.randomUUID?crypto.randomUUID():"id-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10));
const now=()=>new Date().toISOString();
const round=v=>Math.round(v*1e5)/1e5;
const pad2=n=>String(n).padStart(2,"0");
const fmtNr=n=>"FP "+pad2(n);
const fmtZeit=iso=>{try{return new Date(iso).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}catch(e){return iso||""}};
const fmtDatum=iso=>{try{return new Date(iso).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}catch(e){return ""}};
const fmtUhr=iso=>{try{return new Date(iso).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}catch(e){return ""}};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fileSafe=s=>String(s||"Projekt").normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/ß/g,"ss").replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^_+|_+$/g,"").slice(0,60)||"Projekt";
const stamp=()=>{const d=new Date();return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+"_"+pad2(d.getHours())+pad2(d.getMinutes())};
const fmtSize=b=>b>1048576?(b/1048576).toFixed(1).replace(".",",")+" MB":Math.max(1,Math.round(b/1024))+" KB";

function toast(msg,ms){const t=$("toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,ms||2800)}
function busy(on,txt){$("busy").hidden=!on;if(txt)$("busyTxt").textContent=txt}
function hint(txt,cls){const h=$("hint");h.textContent=txt||"";h.className="hint"+(cls?" "+cls:"");h.hidden=!txt}
function ask(title,text,yesLabel,noLabel){return new Promise(res=>{
  $("confirmTitle").textContent=title;$("confirmText").textContent=text;$("confirmYes").textContent=yesLabel||"Ja";$("confirmNo").textContent=noLabel||"Abbrechen";$("confirmYes").className="btn "+(noLabel?"primary":"danger");
  $("confirm").hidden=false;
  const done=v=>{$("confirm").hidden=true;$("confirmYes").onclick=$("confirmNo").onclick=null;res(v)};
  $("confirmYes").onclick=()=>done(true);$("confirmNo").onclick=()=>done(false);
})}
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("Datei "+src+" nicht ladbar"));document.head.appendChild(s)})}
function blobToDataURL(b){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(b)})}
async function bitmapOf(blob){
  try{return await createImageBitmap(blob,{imageOrientation:"from-image"})}
  catch(e){return await new Promise((res,rej)=>{const i=new Image();const u=URL.createObjectURL(blob);i.onload=()=>{res(i)};i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("Bild nicht lesbar"))};i.src=u})}
}
async function toJpeg(blob,max,q){
  const src=await bitmapOf(blob);
  const w=src.width,h=src.height,k=Math.min(1,max/Math.max(w,h),Math.sqrt(16e6/(w*h)));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));
  const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);g.drawImage(src,0,0,c.width,c.height);
  if(src.close)try{src.close()}catch(e){}
  return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error("Bild konnte nicht umgewandelt werden")),"image/jpeg",q));
}
async function imgSize(blob){const b=await bitmapOf(blob);const r={w:b.width||b.naturalWidth,h:b.height||b.naturalHeight};if(b.close)try{b.close()}catch(e){}return r}

/* ================= Speicher (IndexedDB) ================= */
let dbp=null;
function idb(){
  if(dbp)return dbp;
  dbp=new Promise((res,rej)=>{
    const r=indexedDB.open("kabel-fotodoku",1);
    r.onupgradeneeded=()=>{const d=r.result;
      if(!d.objectStoreNames.contains("projekte"))d.createObjectStore("projekte",{keyPath:"id"});
      if(!d.objectStoreNames.contains("punkte")){const s=d.createObjectStore("punkte",{keyPath:"id"});s.createIndex("projektId","projektId")}
    };
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
  });
  return dbp;
}
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function tx(stores,mode,fn){
  const d=await idb();const t=d.transaction(stores,mode);
  const out=fn(t);
  await new Promise((res,rej)=>{t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error("Abgebrochen"))});
  return out instanceof Promise?await out:out;
}
const DB={
  async projekte(){const d=await idb();return await req(d.transaction("projekte").objectStore("projekte").getAll())},
  async projekt(id){const d=await idb();return await req(d.transaction("projekte").objectStore("projekte").get(id))},
  async putProjekt(p){await tx(["projekte"],"readwrite",t=>{t.objectStore("projekte").put(p)})},
  async punkte(pid){const d=await idb();return await req(d.transaction("punkte").objectStore("punkte").index("projektId").getAll(pid))},
  async putPunkt(p){await tx(["punkte"],"readwrite",t=>{t.objectStore("punkte").put(p)})},
  async putPunkte(list){await tx(["punkte"],"readwrite",t=>{const s=t.objectStore("punkte");list.forEach(p=>s.put(p))})},
  async delPunkt(id){await tx(["punkte"],"readwrite",t=>{t.objectStore("punkte").delete(id)})},
  async delProjekt(pid){
    const ids=(await DB.punkte(pid)).map(p=>p.id);
    await tx(["punkte","projekte"],"readwrite",t=>{const s=t.objectStore("punkte");ids.forEach(i=>s.delete(i));t.objectStore("projekte").delete(pid)});
  }
};
const LS={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

/* ================= Zustand ================= */
let projekt=null;       // aktuelles Projekt
let punkte=[];          // alle Punkte des Projekts
let plan=null;          // aktuell angezeigter Plan
let planUrl=null;
const fotoUrls=new Map();
const sichtbar=()=>plan?punkte.filter(p=>p.planId===plan.id):[];
const planName=id=>{const q=projekt&&projekt.plaene.find(x=>x.id===id);return q?q.name:"?"};
let view={s:1,tx:0,ty:0};
let pending=null, pendingFotos=[], noteDraft="";
let addTo=null;          // Punkt-ID, wenn Fotos zu einem bestehenden Punkt kommen
let selected=null, moving=null;

const fotosOf=p=>Array.isArray(p.fotos)?p.fotos:(p.foto?[p.foto]:[]);
function blobUrl(b){if(!b)return null;let u=fotoUrls.get(b);if(!u){u=URL.createObjectURL(b);fotoUrls.set(b,u)}return u}
function fotoUrl(p){return blobUrl(fotosOf(p)[0])}
function freeBlobs(list){for(const b of list){const u=fotoUrls.get(b);if(u){URL.revokeObjectURL(u);fotoUrls.delete(b)}}}
function clearUrls(){fotoUrls.forEach(u=>URL.revokeObjectURL(u));fotoUrls.clear();if(planUrl){URL.revokeObjectURL(planUrl);planUrl=null}}
/* Fotoleiste mit Vorschaubildern; onRemove(i) optional */
function fotoStrip(list,removable){
  if(!list.length)return "";
  return `<div class="strip">${list.map((b,i)=>`<div class="sthumb"><img src="${blobUrl(b)}" alt="Foto ${i+1}" data-i="${i}">${removable?`<button type="button" class="srm" data-rm="${i}" aria-label="Foto ${i+1} entfernen">×</button>`:""}<span class="sn">${i+1}</span></div>`).join("")}</div>`;
}
let lbList=[],lbIdx=0;
function openLightbox(list,i){lbList=list;lbIdx=i;showLb();$("lightbox").hidden=false}
function showLb(){$("lbImg").src=blobUrl(lbList[lbIdx]);$("lbCount").textContent=lbList.length>1?(lbIdx+1)+" / "+lbList.length:"";$("lbPrev").hidden=$("lbNext").hidden=lbList.length<2}
async function touchProjekt(){projekt.geaendert=now();await DB.putProjekt(projekt);updateHeader()}

/* ================= Ansicht: Zoom und Verschieben ================= */
function apply(){
  if(!plan)return;
  planEl.style.width=plan.w+"px";planEl.style.height=plan.h+"px";
  planEl.style.transform=`translate(${view.tx}px,${view.ty}px) scale(${view.s})`;
  renderPins();
}
function fit(){
  if(!plan)return;const r=stage.getBoundingClientRect();const pad=20;
  view.s=Math.min((r.width-pad*2)/plan.w,(r.height-pad*2)/plan.h);
  view.tx=(r.width-plan.w*view.s)/2;view.ty=(r.height-plan.h*view.s)/2;apply();
}
function minS(){const r=stage.getBoundingClientRect();return Math.min(r.width/plan.w,r.height/plan.h)*0.5}
function zoomAt(f,cx,cy){
  const ns=Math.max(minS(),Math.min(8,view.s*f));const k=ns/view.s;
  view.tx=cx-(cx-view.tx)*k;view.ty=cy-(cy-view.ty)*k;view.s=ns;apply();
}
const toWorld=(cx,cy)=>({x:(cx-view.tx)/view.s/plan.w,y:(cy-view.ty)/view.s/plan.h});
const toScreen=(x,y)=>({x:view.tx+x*plan.w*view.s,y:view.ty+y*plan.h*view.s});
function centerOn(x,y){
  const r=stage.getBoundingClientRect();if(view.s<0.8)view.s=1;
  const wide=window.innerWidth>=820;
  view.tx=(wide?(r.width-420)/2:r.width/2)-x*plan.w*view.s;
  view.ty=(wide?r.height/2:r.height*0.3)-y*plan.h*view.s;apply();
}
const ptrs=new Map();let gest=null;
stage.addEventListener("pointerdown",e=>{
  if(!plan||e.target.closest(".zoom,.sheet,.side,.empty,.pin"))return;
  try{stage.setPointerCapture(e.pointerId)}catch(err){}
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const r=stage.getBoundingClientRect();
  if(ptrs.size===1){gest={mode:"pan",sx:e.clientX,sy:e.clientY,tx:view.tx,ty:view.ty,moved:false,multi:false}}
  else if(ptrs.size===2){const [a,b]=[...ptrs.values()];
    gest={mode:"pinch",d0:Math.hypot(a.x-b.x,a.y-b.y)||1,mx:(a.x+b.x)/2-r.left,my:(a.y+b.y)/2-r.top,s0:view.s,tx:view.tx,ty:view.ty,multi:true,moved:true}}
});
stage.addEventListener("pointermove",e=>{
  if(!ptrs.has(e.pointerId)||!gest)return;
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const r=stage.getBoundingClientRect();
  if(gest.mode==="pinch"&&ptrs.size>=2){const [a,b]=[...ptrs.values()];
    const d=Math.hypot(a.x-b.x,a.y-b.y),mx=(a.x+b.x)/2-r.left,my=(a.y+b.y)/2-r.top;
    const ns=Math.max(minS(),Math.min(8,gest.s0*d/gest.d0));
    const wx=(gest.mx-gest.tx)/gest.s0,wy=(gest.my-gest.ty)/gest.s0;
    view.s=ns;view.tx=mx-wx*ns;view.ty=my-wy*ns;apply();
  }else if(gest.mode==="pan"){
    const dx=e.clientX-gest.sx,dy=e.clientY-gest.sy;
    if(Math.hypot(dx,dy)>7)gest.moved=true;
    if(gest.moved){view.tx=gest.tx+dx;view.ty=gest.ty+dy;apply()}
  }
});
function endPtr(e){
  if(!ptrs.has(e.pointerId))return;ptrs.delete(e.pointerId);
  if(gest&&ptrs.size===0){
    if(gest.mode==="pan"&&!gest.moved&&!gest.multi&&e.type==="pointerup"){const r=stage.getBoundingClientRect();tap(e.clientX-r.left,e.clientY-r.top)}
    gest=null;
  }else if(gest&&ptrs.size===1){const p=[...ptrs.values()][0];gest={mode:"pan",sx:p.x,sy:p.y,tx:view.tx,ty:view.ty,moved:true,multi:true}}
}
stage.addEventListener("pointerup",endPtr);
stage.addEventListener("pointercancel",endPtr);
stage.addEventListener("wheel",e=>{
  if(!plan||e.target.closest(".sheet,.side,.empty"))return;e.preventDefault();
  const r=stage.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*0.0015),e.clientX-r.left,e.clientY-r.top);
},{passive:false});
document.addEventListener("gesturestart",e=>e.preventDefault());
$("zIn").onclick=()=>{const r=stage.getBoundingClientRect();zoomAt(1.5,r.width/2,r.height/2)};
$("zOut").onclick=()=>{const r=stage.getBoundingClientRect();zoomAt(1/1.5,r.width/2,r.height/2)};
$("zFit").onclick=fit;
window.addEventListener("resize",()=>apply());

function tap(cx,cy){
  const w=toWorld(cx,cy);
  if(w.x<0||w.y<0||w.x>1||w.y>1)return;
  if(moving){finishMove(w);return}
  closeSides();selected=null;pending=w;openNewSheet();renderPins();
}

/* ================= Punkte ================= */
function renderPins(){
  if(!plan){pinsEl.innerHTML="";return}
  const frag=document.createDocumentFragment();
  for(const f of sichtbar()){
    const p=toScreen(f.x,f.y);
    const b=document.createElement("button");
    b.type="button";b.className="pin"+(selected===f.id?" sel":"")+(fotosOf(f).length?"":" nophoto");
    b.style.left=p.x+"px";b.style.top=p.y+"px";
    b.setAttribute("aria-label",fmtNr(f.nr)+(f.notiz?": "+f.notiz:""));
    b.innerHTML=`<span class="head"></span><span class="num">${pad2(f.nr)}</span>`;
    b.addEventListener("click",ev=>{ev.stopPropagation();if(moving)return;openDetail(f.id)});
    frag.appendChild(b);
  }
  if(pending&&!moving){const p=toScreen(pending.x,pending.y);const d=document.createElement("div");d.className="pending";d.style.left=p.x+"px";d.style.top=p.y+"px";d.innerHTML="<i></i>";frag.appendChild(d)}
  pinsEl.replaceChildren(frag);
  $("count").textContent=punkte.length;
}
const nextNr=()=>punkte.reduce((m,f)=>Math.max(m,f.nr||0),0)+1;

const closeIcon=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const camIcon=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>`;

function openNewSheet(){
  sheet.hidden=false;
  const n=pendingFotos.length;
  sheet.innerHTML=`
    <div class="sheet-head"><h3>${fmtNr(nextNr())}</h3><span class="meta">neu${n?" · "+n+(n>1?" Fotos":" Foto"):""}</span>
      <button class="x" type="button" id="sClose" aria-label="Abbrechen">${closeIcon}</button></div>
    ${n?fotoStrip(pendingFotos,true):`<div class="photo-ph">Noch kein Foto. Du kannst mehrere Fotos nacheinander aufnehmen. Stelle passt nicht? Einfach woanders auf den Plan tippen.</div>`}
    <div class="row" style="margin-bottom:12px">
      <button class="btn ${n?"":"primary"}" type="button" id="sCam">${camIcon}${n?"Weiteres Foto":"Foto aufnehmen"}</button>
      <button class="btn" type="button" id="sGal">Aus Dateien</button>
    </div>
    <label class="lbl" for="sNote">Notiz</label>
    <textarea id="sNote" placeholder="z. B. Muffe 3, Tiefe 0,80 m, Schutzrohr DN 110 unter Zufahrt">${esc(noteDraft)}</textarea>
    <div class="row"><button class="btn primary" type="button" id="sSave">${n?`Fotopunkt speichern (${n} ${n>1?"Fotos":"Foto"})`:"Ohne Foto speichern"}</button></div>
    <div class="status" id="sStatus"></div>`;
  $("sClose").onclick=cancelNew;
  $("sCam").onclick=()=>{addTo=null;$("camInput").click()};
  $("sGal").onclick=()=>{addTo=null;$("galInput").click()};
  $("sNote").oninput=e=>noteDraft=e.target.value;
  $("sSave").onclick=saveNew;
  sheet.querySelectorAll(".sthumb img").forEach(im=>im.onclick=()=>openLightbox(pendingFotos,+im.dataset.i));
  sheet.querySelectorAll(".srm").forEach(bt=>bt.onclick=()=>{const i=+bt.dataset.rm;freeBlobs([pendingFotos[i]]);pendingFotos.splice(i,1);openNewSheet()});
}
function clearPendingFile(){freeBlobs(pendingFotos);pendingFotos=[]}
function cancelNew(){pending=null;clearPendingFile();noteDraft="";sheet.hidden=true;renderPins()}

async function onPhotoPicked(e){
  const files=[...(e.target.files||[])];e.target.value="";if(!files.length)return;
  const ziel=addTo;addTo=null;
  const neu=[];let fehler=0;
  for(let i=0;i<files.length;i++){
    busy(true,files.length>1?`Foto ${i+1} von ${files.length} wird vorbereitet…`:"Foto wird vorbereitet…");
    try{neu.push(await toJpeg(files[i],2400,0.85))}catch(err){fehler++}
  }
  busy(false);
  if(fehler)toast(fehler+(fehler>1?" Fotos konnten":" Foto konnte")+" nicht gelesen werden. Bitte JPG oder PNG verwenden.",4000);
  if(!neu.length)return;
  if(ziel){
    const p=punkte.find(x=>x.id===ziel);if(!p)return;
    try{p.fotos=[...fotosOf(p),...neu];delete p.foto;p.geaendert=now();await DB.putPunkt(p);await touchProjekt();renderPins();openDetail(p.id);toast(neu.length>1?neu.length+" Fotos hinzugefügt":"Foto hinzugefügt")}
    catch(err){toast(storageMsg(err),5000)}
    return;
  }
  pendingFotos.push(...neu);
  if(pending)openNewSheet();
}
$("camInput").addEventListener("change",onPhotoPicked);
$("galInput").addEventListener("change",onPhotoPicked);

async function saveNew(){
  if(!pending)return;
  try{
    const t=now();
    const p={id:uid(),projektId:projekt.id,planId:plan.id,nr:nextNr(),x:round(pending.x),y:round(pending.y),notiz:noteDraft.trim(),zeit:t,geaendert:t,fotos:[...pendingFotos]};
    await DB.putPunkt(p);punkte.push(p);await touchProjekt();
    pendingFotos=[];pending=null;noteDraft="";sheet.hidden=true;selected=p.id;renderPins();
    toast(fmtNr(p.nr)+" gespeichert"+(p.fotos.length>1?" ("+p.fotos.length+" Fotos)":""));
  }catch(err){const s=$("sStatus");s.className="status err";s.textContent=storageMsg(err)}
}
function storageMsg(err){
  const n=err&&err.name;
  if(n==="QuotaExceededError")return "Der Speicher auf diesem Gerät ist voll. Projektdatei speichern, alte Projekte löschen und erneut versuchen.";
  return "Speichern hat nicht geklappt"+(err&&err.message?" ("+err.message+")":"")+".";
}

function openDetail(id){
  const f=punkte.find(x=>x.id===id);if(!f)return;
  pending=null;clearPendingFile();selected=id;closeSides();renderPins();
  const fl=fotosOf(f);
  sheet.hidden=false;
  sheet.innerHTML=`
    <div class="sheet-head"><h3>${fmtNr(f.nr)}</h3><span class="meta">${esc(fmtZeit(f.zeit))}</span>
      <button class="x" type="button" id="sClose" aria-label="Schließen">${closeIcon}</button></div>
    ${fl.length?`<img class="photo" id="dPhoto" src="${blobUrl(fl[0])}" alt="Foto 1 von ${fmtNr(f.nr)}">${fl.length>1?fotoStrip(fl,false):""}`:`<div class="photo-ph">Kein Foto vorhanden</div>`}
    ${f.notiz?`<p class="note">${esc(f.notiz)}</p>`:`<p class="note muted">Keine Notiz</p>`}
    <dl class="facts">
      <dt>Fotos</dt><dd>${fl.length}</dd>
      <dt>Aufgenommen</dt><dd>${esc(fmtZeit(f.zeit))}</dd>
      <dt>Zuletzt geändert</dt><dd>${esc(fmtZeit(f.geaendert))}</dd>
      <dt>Plan</dt><dd>${esc(planName(f.planId))}</dd>
      <dt>Lage im Plan</dt><dd>x ${Number(f.x).toFixed(3)} · y ${Number(f.y).toFixed(3)}</dd>
    </dl>
    <div class="row">
      <button class="btn" type="button" id="dMove">Verschieben</button>
      <button class="btn" type="button" id="dEdit">Notiz ändern</button>
      <button class="btn" type="button" id="dFoto">Fotos hinzufügen</button>
      ${fl.length?`<button class="btn" type="button" id="dFotoDel">Foto entfernen</button>`:""}
      <button class="btn danger" type="button" id="dDel">Löschen</button>
    </div>
    <div id="dExtra"></div>
    <div class="status" id="sStatus"></div>`;
  $("sClose").onclick=()=>{sheet.hidden=true;selected=null;renderPins()};
  if($("dPhoto"))$("dPhoto").onclick=()=>openLightbox(fl,0);
  sheet.querySelectorAll(".sthumb img").forEach(im=>im.onclick=()=>{const i=+im.dataset.i;$("dPhoto").src=blobUrl(fl[i]);$("dPhoto").onclick=()=>openLightbox(fl,i)});
  if($("dFotoDel"))$("dFotoDel").onclick=()=>{
    $("dExtra").innerHTML=`<div class="inline-confirm"><p>Welches Foto soll weg? Antippen zum Entfernen.</p>${fotoStrip(fl,true)}<div class="row"><button class="btn" type="button" id="cNo2">Fertig</button></div></div>`;
    $("cNo2").onclick=()=>$("dExtra").innerHTML="";
    $("dExtra").querySelectorAll(".srm,.sthumb img").forEach(bt=>bt.onclick=async()=>{
      const i=+(bt.dataset.rm??bt.dataset.i);
      const ok=await ask("Foto entfernen?",`Foto ${i+1} von ${fmtNr(f.nr)} wird gelöscht.`,"Entfernen");if(!ok)return;
      const weg=fl[i];f.fotos=fl.filter((_,k)=>k!==i);delete f.foto;f.geaendert=now();
      try{await DB.putPunkt(f);freeBlobs([weg]);await touchProjekt();renderPins();openDetail(id);toast("Foto entfernt")}catch(e){toast(storageMsg(e))}
    });
  };
  $("dMove").onclick=()=>{moving=id;sheet.hidden=true;hint("Neue Stelle für "+fmtNr(f.nr)+" antippen · Esc bricht ab","move");renderPins()};
  $("dFoto").onclick=()=>{
    $("dExtra").innerHTML=`<div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="fCam">${camIcon}Kamera</button><button class="btn" type="button" id="fGal">Aus Dateien</button></div>`;
    $("fCam").onclick=()=>{addTo=id;$("camInput").click()};
    $("fGal").onclick=()=>{addTo=id;$("galInput").click()};
  };
  $("dEdit").onclick=()=>{
    $("dExtra").innerHTML=`<div style="margin-top:12px"><label class="lbl" for="eNote">Notiz</label><textarea id="eNote">${esc(f.notiz||"")}</textarea><div class="row"><button class="btn primary" type="button" id="eSave">Notiz speichern</button></div></div>`;
    $("eNote").focus();
    $("eSave").onclick=async()=>{try{f.notiz=$("eNote").value.trim();f.geaendert=now();await DB.putPunkt(f);await touchProjekt();openDetail(id);toast("Notiz gespeichert")}catch(e){$("sStatus").className="status err";$("sStatus").textContent=storageMsg(e)}};
  };
  $("dDel").onclick=()=>{
    $("dExtra").innerHTML=`<div class="inline-confirm"><p>${fmtNr(f.nr)}${fl.length?` mit ${fl.length>1?fl.length+" Fotos":"Foto"}`:""} löschen? Das lässt sich nicht rückgängig machen.</p><div class="row"><button class="btn danger" type="button" id="cYes">Ja, löschen</button><button class="btn" type="button" id="cNo">Abbrechen</button></div></div>`;
    $("cNo").onclick=()=>$("dExtra").innerHTML="";
    $("cYes").onclick=async()=>{
      try{await DB.delPunkt(id);punkte=punkte.filter(p=>p.id!==id);
        projekt.geloescht=[...new Set([...(projekt.geloescht||[]),id])];await touchProjekt();
        freeBlobs(fl);
        sheet.hidden=true;selected=null;renderPins();toast(fmtNr(f.nr)+" gelöscht")}
      catch(e){$("sStatus").className="status err";$("sStatus").textContent=storageMsg(e)}
    };
  };
}
async function finishMove(w){
  const id=moving;moving=null;hint("");
  const p=punkte.find(x=>x.id===id);if(!p)return;
  p.x=round(w.x);p.y=round(w.y);p.geaendert=now();
  try{await DB.putPunkt(p);await touchProjekt();toast("Punkt verschoben")}catch(e){toast(storageMsg(e))}
  openDetail(id);
}

/* ================= Seitenleisten ================= */
function closeSides(){["list","menu","projects"].forEach(i=>$(i).hidden=true)}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).hidden=true);
$("btnList").onclick=()=>{closeSides();renderList();$("list").hidden=false};
$("btnMenu").onclick=()=>{closeSides();renderMenu();$("menu").hidden=false};
$("btnProjects").onclick=()=>{closeSides();renderProjects();$("projects").hidden=false};

function renderList(){
  const ul=$("listUl");
  if(!punkte.length){ul.innerHTML=`<li class="none">Noch keine Fotopunkte. Tippe auf den Plan, um den ersten zu setzen.</li>`;return}
  const mehr=projekt.plaene.length>1;
  ul.innerHTML=[...punkte].sort((a,b)=>a.nr-b.nr).map(f=>{const u=fotoUrl(f);return `<li><button type="button" data-id="${esc(f.id)}">
    ${u?`<img class="th" src="${u}" alt="">`:`<span class="th"></span>`}
    <span style="min-width:0"><span class="t1">${fmtNr(f.nr)}</span>${fotosOf(f).length>1?` <span class="t3">${fotosOf(f).length} Fotos</span>`:""}${mehr?` <span class="plantag">${esc(planName(f.planId))}</span>`:""}<br><span class="t2">${esc(f.notiz||"Keine Notiz")}</span><span class="t3">${esc(fmtZeit(f.zeit))}</span></span></button></li>`}).join("");
  ul.querySelectorAll("button").forEach(b=>b.onclick=async()=>{const f=punkte.find(x=>x.id===b.dataset.id);closeSides();if(f){if(f.planId!==plan.id)await showPlan(f.planId);centerOn(f.x,f.y);openDetail(f.id)}});
}

function renderMenu(){
  const body=$("menuBody");
  if(!projekt){body.innerHTML=`<div class="group"><h4>Übertragen</h4><p>Lege zuerst ein Projekt an oder öffne eine Projektdatei.</p>
    <div class="stack"><label class="btn primary">Projektdatei öffnen<input type="file" class="importInput"></label></div></div>`;bindImports(body);return}
  const unsaved=!projekt.gesichert||projekt.geaendert>projekt.gesichert;
  body.innerHTML=`
    <div class="group"><h4>Zwischen Geräten übertragen</h4>
      <p>${unsaved?"<strong>Es gibt Änderungen, die noch in keiner Projektdatei stecken.</strong> ":""}Zuletzt gespeichert: ${projekt.gesichert?esc(fmtZeit(projekt.gesichert)):"noch nie"}.</p>
      <div class="stack">
        <button class="btn primary" type="button" id="mSave">Projektdatei speichern</button>
        <label class="btn">Projektdatei öffnen und zusammenführen<input type="file" class="importInput"></label>
      </div>
      <p style="margin-top:8px">Öffnest du eine Projektdatei desselben Projekts, werden beide Stände zusammengeführt. Nichts wird überschrieben, nur neuere Änderungen übernommen.</p>
    </div>
    <div class="group"><h4>Für Planer exportieren</h4>
      <div class="stack">
        <button class="btn" type="button" id="mPdf">PDF-Bericht</button>
        <p class="hint2">Zum Drucken und Ablegen: je Plan eine Übersicht, dann je Punkt eine Seite mit Fotos, Notiz und Planausschnitt.</p>
        <button class="btn" type="button" id="mHtml">Interaktive Planansicht (HTML)</button>
        <p class="hint2">Eine Datei, die der Planer am PC im Browser öffnet: Plan zoomen, Punkt anklicken, Fotos in voller Größe. Gut bei vielen Punkten.</p>
        <button class="btn" type="button" id="mZip">Originalfotos + Excel-Liste (ZIP)</button>
        <p class="hint2">Alle Fotos in voller Auflösung als einzelne Dateien, z. B. zum Ablegen im Projektordner oder Einfügen ins CAD.</p>
      </div>
    </div>
    <div class="group"><h4>Pläne in diesem Projekt</h4>
      <p>Ein Projekt kann mehrere Pläne haben, z. B. Abschnitte oder Detailpläne. Die Nummern FP 01, FP 02 … laufen über alle Pläne durch. Umschalten über die Leiste oben.</p>
      <div class="stack">
        <button class="btn primary" type="button" id="mPlanAdd">Weiteren Plan hinzufügen</button>
      </div>
      <p style="margin-top:12px"><strong>Aktueller Plan:</strong> ${esc(plan.name)} · ${sichtbar().length} Punkte · ${plan.w}×${plan.h} px</p>
      <label class="lbl" for="mPlanName">Name des Plans</label><input type="text" id="mPlanName" value="${esc(plan.name)}">
      <div class="stack">
        <button class="btn" type="button" id="mPlanRename">Plan umbenennen</button>
        <button class="btn" type="button" id="mPlan">Plan-Datei ersetzen (Punkte bleiben an ihrer relativen Lage)</button>
        ${projekt.plaene.length>1?`<button class="btn danger" type="button" id="mPlanDel">Diesen Plan löschen</button>`:""}
      </div>
    </div>
    <div class="group"><h4>Datenschutz</h4>
      <p>Plan, Fotos und Notizen liegen nur in diesem Browser auf diesem Gerät. Die App sendet nichts ins Internet. ${persisted?"Der Speicher ist als dauerhaft markiert.":"Der Browser darf den Speicher bei Platzmangel leeren. Speichere die Projektdatei deshalb regelmäßig."}</p>
      <p class="mono">Version ${APP_VERSION}</p>
    </div>`;
  bindImports(body);
  $("mSave").onclick=()=>run(saveProjectFile);
  $("mHtml").onclick=()=>run(exportHtml);
  $("mPdf").onclick=()=>run(exportPdf);
  $("mZip").onclick=()=>run(exportFotoZip);
  $("mPlan").onclick=()=>{$("planInput").click()};
  $("mPlanAdd").onclick=()=>{$("addPlanInput").click()};
  $("mPlanRename").onclick=async()=>{const n=$("mPlanName").value.trim();if(!n)return;plan.name=n;plan.geaendert=now();await touchProjekt();renderPlanTabs();renderMenu();toast("Plan umbenannt")};
  if($("mPlanDel"))$("mPlanDel").onclick=async()=>{
    const n=sichtbar().length;
    const ok=await ask("Plan löschen?",`„${plan.name}“${n?` und die ${n} Fotopunkte darauf werden`:" wird"} gelöscht. Das lässt sich nicht rückgängig machen.`,"Löschen");
    if(!ok)return;
    const pid=plan.id;const ids=sichtbar().map(p=>p.id);
    for(const id of ids){await DB.delPunkt(id)}
    punkte=punkte.filter(p=>p.planId!==pid);
    projekt.geloescht=[...new Set([...(projekt.geloescht||[]),...ids])];
    projekt.plaeneGeloescht=[...new Set([...(projekt.plaeneGeloescht||[]),pid])];
    projekt.plaene=projekt.plaene.filter(q=>q.id!==pid);
    await touchProjekt();closeSides();await showPlan(projekt.plaene[0].id);toast("Plan gelöscht");
  };
}
async function run(fn){try{await fn()}catch(e){console.error(e);toast("Das hat nicht geklappt: "+(e&&e.message||e),5000)}finally{busy(false)}}

async function renderProjects(){
  const list=(await DB.projekte()).sort((a,b)=>(b.geaendert||"").localeCompare(a.geaendert||""));
  const body=$("projBody");
  body.innerHTML=`
    <div class="group"><h4>Auf diesem Gerät</h4>
      ${list.length?`<div class="projlist">${list.map(p=>`<button type="button" class="projitem ${projekt&&p.id===projekt.id?"cur":""}" data-id="${esc(p.id)}"><span style="min-width:0"><span class="t1">${esc(p.name)}</span><br><span class="t3">geändert ${esc(fmtZeit(p.geaendert))}</span></span>${projekt&&p.id===projekt.id?`<span class="badge">offen</span>`:""}</button>`).join("")}</div>`:`<p>Noch keine Projekte.</p>`}
    </div>
    <div class="group"><h4>Neu</h4><div class="stack">
      <button class="btn primary" type="button" id="pNew">Neues Projekt anlegen</button>
      <label class="btn">Projektdatei öffnen<input type="file" class="importInput"></label>
      <button class="btn demoBtn" type="button">Demo-Projekt mit Testplan laden</button>
    </div></div>
    ${projekt?`<div class="group"><h4>Aktuelles Projekt</h4>
      <label class="lbl" for="pName">Name</label><input type="text" id="pName" value="${esc(projekt.name)}">
      <div class="stack"><button class="btn" type="button" id="pRename">Umbenennen</button><button class="btn danger" type="button" id="pDel">Projekt von diesem Gerät löschen</button></div></div>`:""}`;
  bindImports(body);bindDemo(body);
  body.querySelectorAll(".projitem").forEach(b=>b.onclick=async()=>{closeSides();await openProject(b.dataset.id)});
  $("pNew").onclick=()=>{closeSides();showStart()};
  if(projekt){
    $("pRename").onclick=async()=>{const n=$("pName").value.trim();if(!n)return;projekt.name=n;await touchProjekt();toast("Umbenannt");renderProjects()};
    $("pDel").onclick=async()=>{
      const unsaved=!projekt.gesichert||projekt.geaendert>projekt.gesichert;
      const ok=await ask("Projekt löschen?",`„${projekt.name}“ mit ${punkte.length} Fotopunkten wird von diesem Gerät gelöscht.${unsaved?" Es gibt Änderungen, die in keiner Projektdatei gesichert sind.":""}`,"Löschen");
      if(!ok)return;await DB.delProjekt(projekt.id);closeSides();projekt=null;punkte=[];clearUrls();LS.set("kfd:last","");await boot();toast("Projekt gelöscht");
    };
  }
}

/* ================= Projekte ================= */
function updateHeader(){
  $("projName").textContent=projekt?projekt.name+" · "+punkte.length+" Punkte":"Kein Projekt";
  $("btnList").hidden=!projekt;
  renderPlanTabs();
}
function renderPlanTabs(){
  const nav=$("planTabs");
  if(!projekt){nav.hidden=true;nav.innerHTML="";return}
  nav.hidden=false;
  nav.innerHTML=projekt.plaene.map(q=>{const n=punkte.filter(p=>p.planId===q.id).length;return `<button type="button" class="ptab${plan&&q.id===plan.id?" on":""}" data-id="${esc(q.id)}" aria-pressed="${plan&&q.id===plan.id}">${esc(q.name)}<span class="pc">${n}</span></button>`}).join("")+
    `<button type="button" class="ptab add" id="tabAdd" aria-label="Weiteren Plan hinzufügen">+ Plan</button>`;
  nav.querySelectorAll(".ptab[data-id]").forEach(b=>b.onclick=()=>{if(plan&&b.dataset.id===plan.id)return;showPlan(b.dataset.id)});
  $("tabAdd").onclick=()=>$("addPlanInput").click();
  const on=nav.querySelector(".on");if(on&&on.scrollIntoView)try{on.scrollIntoView({block:"nearest",inline:"nearest"})}catch(e){}
}
async function showPlan(id){
  const q=projekt.plaene.find(x=>x.id===id)||projekt.plaene[0];if(!q)return;
  plan=q;projekt.aktivPlan=q.id;selected=null;pending=null;clearPendingFile();sheet.hidden=true;moving=null;hint("");
  try{await DB.putProjekt(projekt)}catch(e){}
  if(planUrl)URL.revokeObjectURL(planUrl);
  planUrl=URL.createObjectURL(q.blob);planEl.hidden=false;
  await new Promise(res=>{planEl.onload=res;planEl.onerror=res;planEl.src=planUrl});
  fit();updateHeader();
}
/* ältere Projekte (ein Plan) auf mehrere Pläne umstellen */
function migrate(p,pts){
  let changed=false;
  if(!Array.isArray(p.plaene)){
    p.plaene=p.plan?[{id:"haupt",name:(p.planName||"Plan 1").replace(/\.[^.]+$/,""),blob:p.plan,w:p.planW,h:p.planH,geaendert:p.planGeaendert||p.erstellt||now()}]:[];
    delete p.plan;delete p.planW;delete p.planH;delete p.planName;delete p.planGeaendert;changed=true;
  }
  if(!p.plaeneGeloescht)p.plaeneGeloescht=[];
  const fix=[];for(const q of pts){let ch=false;
    if(!q.planId){q.planId=(p.plaene[0]&&p.plaene[0].id)||"haupt";ch=true}
    if(!Array.isArray(q.fotos)){q.fotos=q.foto?[q.foto]:[];delete q.foto;ch=true}
    if(ch)fix.push(q)}
  return {changed,fix};
}
function showStart(){
  projekt=null;plan=null;punkte=[];clearUrls();sheet.hidden=true;pending=null;
  planEl.hidden=true;$("zoomCtl").hidden=true;pinsEl.innerHTML="";$("empty").hidden=false;updateHeader();
}
async function openProject(id){
  const p=await DB.projekt(id);if(!p){showStart();return}
  clearUrls();projekt=p;punkte=await DB.punkte(id);selected=null;pending=null;sheet.hidden=true;moving=null;hint("");
  const m=migrate(projekt,punkte);
  if(m.changed)await DB.putProjekt(projekt);
  if(m.fix.length)await DB.putPunkte(m.fix);
  LS.set("kfd:last",id);
  $("empty").hidden=true;$("zoomCtl").hidden=false;
  await showPlan(projekt.aktivPlan||projekt.plaene[0].id);
}
/* Liefert eine Liste von Plänen [{blob,w,h,name}]. Bei mehrseitigen PDFs wird gefragt, ob alle Seiten übernommen werden. */
async function plaeneAusDatei(file,erlaubeMehrere){
  const base=file.name.replace(/\.[^.]+$/,"")||"Plan";
  const istPdf=file.type==="application/pdf"||/\.pdf$/i.test(file.name);
  if(!istPdf){
    if(file.type&&!file.type.startsWith("image/"))throw new Error("Bitte ein PDF oder ein Bild (JPG, PNG) wählen.");
    busy(true,"Plan wird vorbereitet…");
    const blob=await toJpeg(file,7000,0.9);const s=await imgSize(blob);
    return [{blob,w:s.w,h:s.h,name:base}];
  }
  busy(true,"PDF wird geöffnet…");
  try{if(!window.pdfjsLib)await loadScript("lib/pdf.min.js")}catch(e){throw new Error("PDF-Werkzeug konnte nicht geladen werden. Einmal mit Internet öffnen, dann geht es auch offline.")}
  window.pdfjsLib.GlobalWorkerOptions.workerSrc="lib/pdf.worker.min.js";
  let pdf;
  try{pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise}
  catch(e){
    if(e&&e.name==="PasswordException")throw new Error("Das PDF ist mit einem Passwort geschützt. Bitte eine ungeschützte Fassung verwenden.");
    throw new Error("Das PDF lässt sich nicht lesen ("+(e&&e.message||e)+"). Tipp: Plan als PNG oder JPG exportieren und das Bild laden.");
  }
  let seiten=[1];
  if(pdf.numPages>1&&erlaubeMehrere){
    busy(false);
    const alle=await ask("PDF mit "+pdf.numPages+" Seiten",`Jede Seite als eigenen Plan übernehmen? Bei „Nur Seite 1“ wird nur die erste Seite geladen.`,"Alle "+pdf.numPages+" Seiten","Nur Seite 1");
    seiten=alle?Array.from({length:pdf.numPages},(_,i)=>i+1):[1];
  }
  const out=[];
  for(const n of seiten){
    busy(true,seiten.length>1?`PDF wird umgewandelt: Seite ${n} von ${seiten.length}…`:"PDF wird umgewandelt…");
    const blob=await pdfSeite(pdf,n);const s=await imgSize(blob);
    out.push({blob,w:s.w,h:s.h,name:seiten.length>1?base+" S. "+n:base});
  }
  try{pdf.destroy()}catch(e){}
  return out;
}
const istIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
async function pdfSeite(pdf,n){
  const page=await pdf.getPage(n);
  const v1=page.getViewport({scale:1});
  const maxPx=istIOS()?12e6:15.5e6;
  const scale=Math.min(7000/Math.max(v1.width,v1.height),Math.sqrt(maxPx/(v1.width*v1.height)),10);
  const vp=page.getViewport({scale});
  const c=document.createElement("canvas");c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
  const g=c.getContext("2d");if(!g)throw new Error("Der Plan ist zu groß für dieses Gerät.");
  g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);
  await page.render({canvasContext:g,viewport:vp}).promise;
  const blob=await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error("Der Plan ist zu groß für dieses Gerät.")),"image/jpeg",0.9));
  c.width=c.height=1;page.cleanup();
  return blob;
}
async function plaeneAusDateien(files){const out=[];for(const f of files)out.push(...await plaeneAusDatei(f,true));return out}
$("newPlan").addEventListener("change",async e=>{
  const files=[...(e.target.files||[])];e.target.value="";if(!files.length)return;
  const name=$("newName").value.trim()||files[0].name.replace(/\.[^.]+$/,"");
  try{
    const liste=await plaeneAusDateien(files);const t=now();
    const plaene=liste.map(x=>({id:uid(),name:x.name,blob:x.blob,w:x.w,h:x.h,geaendert:t}));
    const p={id:uid(),name,plaene,aktivPlan:plaene[0].id,erstellt:t,geaendert:t,gesichert:null,geloescht:[],plaeneGeloescht:[]};
    await DB.putProjekt(p);$("newName").value="";await openProject(p.id);toast(plaene.length>1?`Projekt mit ${plaene.length} Plänen angelegt. Umschalten über die Leiste oben.`:"Projekt angelegt. Jetzt Stelle antippen.",4000);
  }catch(err){console.error(err);toast("Plan konnte nicht geladen werden: "+(err.message||err),7000)}
  finally{busy(false)}
});
$("planInput").addEventListener("change",async e=>{
  const file=e.target.files&&e.target.files[0];e.target.value="";if(!file||!projekt)return;
  try{
    const [x]=await plaeneAusDatei(file,false);
    plan.blob=x.blob;plan.w=x.w;plan.h=x.h;plan.geaendert=now();
    await touchProjekt();closeSides();await showPlan(plan.id);toast("Plan-Datei ersetzt");
  }catch(err){toast("Plan konnte nicht geladen werden: "+(err.message||err),7000)}
  finally{busy(false)}
});
$("addPlanInput").addEventListener("change",async e=>{
  const files=[...(e.target.files||[])];e.target.value="";if(!files.length||!projekt)return;
  try{
    const liste=await plaeneAusDateien(files);const t=now();
    const neu=liste.map(x=>({id:uid(),name:x.name,blob:x.blob,w:x.w,h:x.h,geaendert:t}));
    projekt.plaene.push(...neu);await touchProjekt();closeSides();await showPlan(neu[0].id);
    toast(neu.length>1?`${neu.length} Pläne hinzugefügt`:"Plan „"+neu[0].name+"“ hinzugefügt");
  }catch(err){toast("Plan konnte nicht geladen werden: "+(err.message||err),7000)}
  finally{busy(false)}
});

/* ================= Projektdatei (Übertragen) ================= */
async function saveProjectFile(){
  busy(true,"Projektdatei wird erstellt…");
  const zip=new JSZip();
  const meta={format:FORMAT,version:2,app:APP_VERSION,gespeichert:now(),
    projekt:{id:projekt.id,name:projekt.name,erstellt:projekt.erstellt,geaendert:projekt.geaendert,geloescht:projekt.geloescht||[],plaeneGeloescht:projekt.plaeneGeloescht||[],
      plaene:projekt.plaene.map(q=>({id:q.id,name:q.name,w:q.w,h:q.h,geaendert:q.geaendert,datei:"plaene/"+q.id+".jpg"}))},
    punkte:punkte.map(p=>({id:p.id,planId:p.planId,nr:p.nr,x:p.x,y:p.y,notiz:p.notiz||"",zeit:p.zeit,geaendert:p.geaendert,fotos:fotosOf(p).map((_,i)=>"fotos/"+p.id+"_"+(i+1)+".jpg")}))};
  zip.file("projekt.json",JSON.stringify(meta,null,1));
  for(const q of projekt.plaene)zip.file("plaene/"+q.id+".jpg",q.blob);
  for(const p of punkte)fotosOf(p).forEach((b,i)=>zip.file("fotos/"+p.id+"_"+(i+1)+".jpg",b));
  zip.file("LIESMICH.txt","Projektdatei der Kabel-Fotodoku.\nNicht entpacken, sondern in der App über „Projektdatei öffnen“ laden.\n");
  const blob=await zip.generateAsync({type:"blob",compression:"STORE",mimeType:"application/zip"});
  const file=new File([blob],"Kabeldoku_"+fileSafe(projekt.name)+"_"+stamp()+".zip",{type:"application/zip"});
  projekt.gesichert=now();await DB.putProjekt(projekt);
  offerFile(file,"Projektdatei bereit",isTouch()?"Teilen → AirDrop oder „In Dateien sichern“ (z. B. OneDrive). Auf dem anderen Gerät in der App „Projektdatei öffnen“.":"Datei z. B. in OneDrive/Drive ablegen oder per AirDrop senden. Am iPad dann in der App „Projektdatei öffnen“.");
}

function bindImports(root){root.querySelectorAll(".importInput").forEach(inp=>inp.onchange=async e=>{
  const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;run(()=>importProjectFile(file));
})}
bindImports(document);
function bindDemo(root){root.querySelectorAll(".demoBtn").forEach(b=>b.onclick=()=>run(async()=>{
  busy(true,"Demo wird geladen…");
  const get=async p=>{const r=await fetch("demo/projekt/"+p);if(!r.ok)throw new Error("Demo-Datei "+p+" nicht gefunden");return r};
  const meta=await (await get("projekt.json")).json();
  const zip=new JSZip();zip.file("projekt.json",JSON.stringify(meta));zip.file("plan.jpg",await (await get("plan.jpg")).blob());
  for(const p of meta.punkte)for(const f of (p.fotos||(p.foto?[p.foto]:[])))zip.file(f,await (await get(f)).blob());
  const blob=await zip.generateAsync({type:"blob",compression:"STORE"});
  await importProjectFile(new File([blob],"Demo_Kabeldoku.zip",{type:"application/zip"}));
}))}
bindDemo(document);

/* Zusammenführen: neuere Änderung gewinnt, Löschungen bleiben gelöscht, doppelte Nummern werden neu vergeben */
function mergePunkte(local,incoming,geloescht){
  const del=new Set(geloescht);
  const map=new Map();let neu=0,akt=0;
  for(const p of local)if(!del.has(p.id))map.set(p.id,p);
  for(const p of incoming){
    if(del.has(p.id))continue;
    const l=map.get(p.id);
    if(!l){map.set(p.id,p);neu++}
    else if((p.geaendert||"")>(l.geaendert||"")){map.set(p.id,p);akt++}
  }
  const list=[...map.values()].sort((a,b)=>(a.zeit||"").localeCompare(b.zeit||"")||(a.nr-b.nr));
  const used=new Set();let renum=0;let max=list.reduce((m,p)=>Math.max(m,p.nr||0),0);
  const t=now();
  for(const p of list){if(!p.nr||used.has(p.nr)){p.nr=++max;p.geaendert=t;renum++}used.add(p.nr)}
  const removed=local.filter(p=>del.has(p.id)).length;
  return {list,neu,akt,renum,removed};
}
async function importProjectFile(file){
  busy(true,"Projektdatei wird gelesen…");
  let zip;try{zip=await JSZip.loadAsync(file)}catch(e){throw new Error("Das ist keine gültige Projektdatei (ZIP). Bitte die Datei wählen, die mit „Projektdatei speichern“ erstellt wurde.")}
  const mf=zip.file("projekt.json");if(!mf)throw new Error("In der Datei fehlt projekt.json. Ist es eine Projektdatei der Kabel-Fotodoku?");
  let meta;try{meta=JSON.parse(await mf.async("string"))}catch(e){throw new Error("projekt.json ist beschädigt.")}
  if(!meta||meta.format!==FORMAT||!meta.projekt||!meta.projekt.id)throw new Error("Unbekanntes Dateiformat.");
  const mp=meta.projekt;
  // Pläne lesen (Version 1: eine plan.jpg, Version 2: mehrere)
  let planListe=Array.isArray(mp.plaene)?mp.plaene:[{id:"haupt",name:(mp.planName||"Plan 1").replace(/\.[^.]+$/,""),w:mp.planW,h:mp.planH,geaendert:mp.planGeaendert||mp.erstellt,datei:"plan.jpg"}];
  const inPlaene=[];
  for(const q of planListe){
    const f=zip.file(q.datei||("plaene/"+q.id+".jpg"));if(!f)continue;
    inPlaene.push({id:String(q.id),name:String(q.name||"Plan"),w:Number(q.w),h:Number(q.h),geaendert:q.geaendert||now(),_f:f});
  }
  if(!inPlaene.length)throw new Error("In der Datei fehlt der Plan.");
  const defPlan=inPlaene[0].id;
  const incoming=[];
  for(const q of (meta.punkte||[])){
    if(typeof q.x!=="number"||typeof q.y!=="number"||!q.id)continue;
    const fotos=[];
    for(const fp of (Array.isArray(q.fotos)?q.fotos:(q.foto?[q.foto]:[]))){const ff=zip.file(String(fp));if(ff)fotos.push(new Blob([await ff.async("arraybuffer")],{type:"image/jpeg"}))}
    incoming.push({id:String(q.id),projektId:mp.id,planId:String(q.planId||defPlan),nr:Number(q.nr)||0,x:Math.min(1,Math.max(0,q.x)),y:Math.min(1,Math.max(0,q.y)),notiz:String(q.notiz||""),zeit:q.zeit||now(),geaendert:q.geaendert||q.zeit||now(),fotos});
  }
  const blobOf=async q=>new Blob([await q._f.async("arraybuffer")],{type:"image/jpeg"});
  const existing=await DB.projekt(mp.id);
  if(!existing){
    const plaene=[];for(const q of inPlaene)plaene.push({id:q.id,name:q.name,w:q.w,h:q.h,geaendert:q.geaendert,blob:await blobOf(q)});
    const p={id:mp.id,name:mp.name||"Projekt",plaene,aktivPlan:plaene[0].id,erstellt:mp.erstellt||now(),geaendert:mp.geaendert||now(),gesichert:meta.gespeichert||now(),
      geloescht:mp.geloescht||[],plaeneGeloescht:mp.plaeneGeloescht||[]};
    const ids=new Set(plaene.map(q=>q.id));
    const m=mergePunkte([],incoming.filter(x=>ids.has(x.planId)),p.geloescht);
    await DB.putProjekt(p);await DB.putPunkte(m.list);
    await openProject(p.id);closeSides();
    toast(`„${p.name}“ geöffnet: ${plaene.length>1?plaene.length+" Pläne, ":""}${m.list.length} Fotopunkte`,4000);return;
  }
  busy(true,"Stände werden zusammengeführt…");
  const local=await DB.punkte(mp.id);
  migrate(existing,local);
  const plGel=new Set([...(existing.plaeneGeloescht||[]),...(mp.plaeneGeloescht||[])]);
  // Pläne zusammenführen
  let planNeu=0,planAkt=0;
  const pmap=new Map(existing.plaene.map(q=>[q.id,q]));
  for(const q of inPlaene){
    if(plGel.has(q.id))continue;
    const l=pmap.get(q.id);
    if(!l){pmap.set(q.id,{id:q.id,name:q.name,w:q.w,h:q.h,geaendert:q.geaendert,blob:await blobOf(q)});planNeu++}
    else if((q.geaendert||"")>(l.geaendert||"")){l.name=q.name;l.w=q.w;l.h=q.h;l.geaendert=q.geaendert;l.blob=await blobOf(q);planAkt++}
  }
  for(const id of plGel)pmap.delete(id);
  if(!pmap.size)throw new Error("Nach dem Zusammenführen bleibt kein Plan übrig.");
  existing.plaene=[...pmap.values()];existing.plaeneGeloescht=[...plGel];
  const ids=new Set(existing.plaene.map(q=>q.id));
  const orphan=[...local,...incoming].filter(x=>!ids.has(x.planId)).map(x=>x.id);
  const geloescht=[...new Set([...(existing.geloescht||[]),...(mp.geloescht||[]),...orphan])];
  const m=mergePunkte(local,incoming,geloescht);
  if((mp.geaendert||"")>(existing.geaendert||"")&&mp.name)existing.name=mp.name;
  existing.geloescht=geloescht;existing.geaendert=now();
  if(!ids.has(existing.aktivPlan))existing.aktivPlan=existing.plaene[0].id;
  const toDelete=local.filter(p=>geloescht.includes(p.id)).map(p=>p.id);
  await tx(["punkte","projekte"],"readwrite",t=>{const s=t.objectStore("punkte");toDelete.forEach(i=>s.delete(i));m.list.forEach(p=>s.put(p));t.objectStore("projekte").put(existing)});
  await openProject(existing.id);closeSides();
  const parts=[];if(m.neu)parts.push(m.neu+" neu");if(m.akt)parts.push(m.akt+" aktualisiert");if(m.removed)parts.push(m.removed+" gelöscht");if(m.renum)parts.push(m.renum+" neu nummeriert");
  if(planNeu)parts.push(planNeu+(planNeu>1?" Pläne":" Plan")+" neu");if(planAkt)parts.push(planAkt+(planAkt>1?" Pläne":" Plan")+" aktualisiert");
  toast("Zusammengeführt: "+(parts.length?parts.join(", "):"keine Änderungen"),5000);
}

/* ================= Datei anbieten ================= */
let readyFile=null;
const isTouch=()=>navigator.maxTouchPoints>1||matchMedia("(pointer:coarse)").matches;
function offerFile(file,title,help){
  busy(false);readyFile=file;
  $("readyTitle").textContent=title;$("readyInfo").textContent=file.name+" · "+fmtSize(file.size);$("readyHelp").textContent=help||"";
  let canShare=false;try{canShare=!inClaude&&!!(navigator.canShare&&navigator.canShare({files:[file]}))}catch(e){}
  $("readyShare").hidden=!canShare;
  $("readyShare").className="btn"+(isTouch()?" primary":"");$("readyDl").className="btn"+(isTouch()&&canShare?"":" primary");
  $("ready").hidden=false;
}
$("readyShare").onclick=async()=>{try{await navigator.share({files:[readyFile],title:readyFile.name})}catch(e){if(e&&e.name!=="AbortError")toast("Teilen nicht möglich, bitte Herunterladen nutzen.")}};
const inClaude=!!(window.claude&&window.claude.use);
$("readyDl").onclick=async()=>{
  if(inClaude){
    try{const dl=await window.claude.use("downloads");if(!dl)throw {code:"unavailable"};await dl.save({filename:readyFile.name,data:readyFile});toast("Gespeichert")}
    catch(e){if(e&&e.code==="declined")return;toast("Speichern in dieser Vorschau nicht möglich"+(e&&e.code?" ("+e.code+")":"")+". In der installierten App geht es.",5000)}
    return;
  }
  const u=URL.createObjectURL(readyFile);const a=document.createElement("a");a.href=u;a.download=readyFile.name;a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),60000);toast("Download gestartet");
};
$("readyClose").onclick=()=>{$("ready").hidden=true;readyFile=null};

/* ================= Exporte für Planer ================= */
const sorted=()=>[...punkte].sort((a,b)=>a.nr-b.nr);
async function exportHtml(){
  busy(true,"Planer-Ansicht wird erstellt…");
  if(!window.KFD_VIEWER)await loadScript("viewer-template.js");
  const plaene=[];const idx=new Map();
  for(const q of projekt.plaene){
    busy(true,`Planer-Ansicht: Plan ${plaene.length+1} von ${projekt.plaene.length}…`);
    const b=q.w*q.h>36e6?await toJpeg(q.blob,6000,0.85):q.blob;
    const s=b===q.blob?{w:q.w,h:q.h}:await imgSize(b);
    idx.set(q.id,plaene.length);plaene.push({name:q.name,src:await blobToDataURL(b),w:s.w,h:s.h});
  }
  const ps=[];
  for(const p of sorted()){busy(true,`Planer-Ansicht: Foto ${ps.length+1} von ${punkte.length}…`);
    ps.push({nr:p.nr,p:idx.get(p.planId)??0,x:p.x,y:p.y,notiz:p.notiz||"",zeit:p.zeit,fotos:await Promise.all(fotosOf(p).map(async b=>blobToDataURL(await toJpeg(b,1600,0.8))))})}
  const data={projekt:projekt.name,exportiert:now(),plaene,punkte:ps};
  const json=JSON.stringify(data).replace(/</g,"\\u003c");
  const html=window.KFD_VIEWER.replace("/*__TITEL__*/",()=>esc(projekt.name)).replace("/*__DATA__*/null",()=>json);
  const file=new File([html],"Kabeldoku_Planeransicht_"+fileSafe(projekt.name)+"_"+stamp()+".html",{type:"text/html"});
  offerFile(file,"Planer-Ansicht bereit","Eine einzelne Datei mit allen Plänen und Fotos. Planer öffnen sie am PC per Doppelklick im Browser, ohne Installation und ohne Internet.");
}

async function exportFotoZip(){
  busy(true,"Fotos werden gepackt…");
  const zip=new JSZip();const rows=[["Nr","Plan","Notiz","Datum","Uhrzeit","Lage x (0-1)","Lage y (0-1)","Anzahl Fotos","Fotodateien"]];
  for(const p of sorted()){
    const fl=fotosOf(p);const namen=[];
    fl.forEach((b,i)=>{const n="FP"+pad2(p.nr)+(fl.length>1?"_"+(i+1):"")+(p.notiz?"_"+fileSafe(p.notiz).slice(0,40):"")+".jpg";namen.push(n);zip.file("Fotos/"+n,b)});
    rows.push([fmtNr(p.nr),planName(p.planId),p.notiz||"",fmtDatum(p.zeit),fmtUhr(p.zeit),String(p.x).replace(".",","),String(p.y).replace(".",","),fl.length,namen.join(", ")]);
  }
  const csv="﻿"+rows.map(r=>r.map(c=>{c=String(c);return /[;"\n\r]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c}).join(";")).join("\r\n");
  zip.file("Fotopunkte.csv",csv);
  const used=new Set();
  for(const q of projekt.plaene){let n="Plan_"+fileSafe(q.name);while(used.has(n))n+="_2";used.add(n);zip.file("Plaene/"+n+".jpg",q.blob)}
  const blob=await zip.generateAsync({type:"blob",compression:"STORE",mimeType:"application/zip"});
  offerFile(new File([blob],"Kabeldoku_Fotos_"+fileSafe(projekt.name)+"_"+stamp()+".zip",{type:"application/zip"}),"Fotos + Liste bereit","Ordner mit allen Fotos (benannt nach Fotopunkt), den Plänen und Fotopunkte.csv, die sich direkt in Excel öffnen lässt.");
}

async function exportPdf(){
  busy(true,"PDF wird erstellt…");
  if(!window.jspdf)await loadScript("lib/jspdf.umd.min.js");
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4",compress:true});
  const W=297,H=210,M=12;
  const orange=[217,83,26],ink=[30,35,40],grey=[93,101,109];
  const list=sorted();const mehr=projekt.plaene.length>1;
  let page=0;
  function header(d,n){d.setFontSize(8);d.setTextColor(...grey);d.setFont("helvetica","normal");d.text(projekt.name+"  ·  Kabel-Fotodoku",M,H-6);d.text("Seite "+n,W-M,H-6,{align:"right"})}
  // Übersicht je Plan
  for(const q of projekt.plaene){
    busy(true,`PDF: Übersicht ${q.name}…`);
    if(page>0)doc.addPage("a4","landscape");page++;header(doc,page);
    const bmp=await bitmapOf(q.blob);
    const ov=document.createElement("canvas");const k=Math.min(1,3600/Math.max(bmp.width,bmp.height));ov.width=Math.round(bmp.width*k);ov.height=Math.round(bmp.height*k);
    const og=ov.getContext("2d");og.fillStyle="#fff";og.fillRect(0,0,ov.width,ov.height);og.drawImage(bmp,0,0,ov.width,ov.height);
    if(bmp.close)try{bmp.close()}catch(e){}
    const auf=list.filter(p=>p.planId===q.id);
    const r0=Math.max(ov.width,ov.height)/75;
    for(const p of auf)drawMarker(og,p.x*ov.width,p.y*ov.height,r0,p.nr);
    doc.setFontSize(18);doc.setTextColor(...ink);doc.setFont("helvetica","bold");doc.text("Kabel-Fotodoku: "+projekt.name,M,M+8);
    doc.setFontSize(9.5);doc.setFont("helvetica","normal");doc.setTextColor(...grey);
    doc.text(`Plan: ${q.name}  ·  ${auf.length} Fotopunkte${mehr?`  ·  Plan ${projekt.plaene.indexOf(q)+1} von ${projekt.plaene.length}`:""}  ·  erstellt ${fmtZeit(now())}`,M,M+14);
    const box={x:M,y:M+19,w:W-2*M,h:H-M-19-10};
    const fk=Math.min(box.w/ov.width,box.h/ov.height);const iw=ov.width*fk,ih=ov.height*fk;
    doc.addImage(ov.toDataURL("image/jpeg",0.85),"JPEG",box.x+(box.w-iw)/2,box.y+(box.h-ih)/2,iw,ih);
    doc.setDrawColor(205,209,211);doc.rect(box.x+(box.w-iw)/2,box.y+(box.h-ih)/2,iw,ih);
  }
  // Eine Seite je Punkt
  const bmps=new Map();
  const bmpFor=async id=>{if(!bmps.has(id)){const q=projekt.plaene.find(x=>x.id===id);bmps.set(id,q?await bitmapOf(q.blob):null)}return bmps.get(id)};
  let i=0;
  for(const p of list){
    i++;busy(true,`PDF: Fotopunkt ${i} von ${list.length}…`);
    doc.addPage("a4","landscape");page++;header(doc,page);
    const colX=M+178;
    const fl=fotosOf(p);
    const fotoSeite=async(teil,x0,y0,fw,fh)=>{
      const cols=teil.length>1?2:1,rows=teil.length>2?2:1,gap=3;
      const cw=(fw-(cols-1)*gap)/cols,chh=(fh-(rows-1)*gap)/rows;
      for(let k=0;k<teil.length;k++){
        const im=await toJpeg(teil[k],teil.length>1?1200:1800,0.82);const durl=await blobToDataURL(im);const sz=await imgSize(im);
        const kk=Math.min(cw/sz.w,chh/sz.h);const cx=x0+(k%cols)*(cw+gap),cy=y0+Math.floor(k/cols)*(chh+gap);
        doc.addImage(durl,"JPEG",cx,cy,sz.w*kk,sz.h*kk);
      }
    };
    if(fl.length){
      await fotoSeite(fl.slice(0,4),M,M,170,H-2*M-10);
      if(fl.length>4)doc.setTextColor(...grey),doc.setFontSize(9),doc.text(`Weitere Fotos auf den Folgeseiten (${fl.length} insgesamt)`,M,H-M-4);
    }else{doc.setDrawColor(205,209,211);doc.setLineDashPattern([2,2],0);doc.rect(M,M,170,100);doc.setLineDashPattern([],0);doc.setTextColor(...grey);doc.setFontSize(11);doc.text("Kein Foto",M+85,M+52,{align:"center"})}
    doc.setTextColor(...orange);doc.setFont("helvetica","bold");doc.setFontSize(26);doc.text(fmtNr(p.nr),colX,M+10);
    doc.setTextColor(...grey);doc.setFont("helvetica","normal");doc.setFontSize(9.5);
    doc.text("Aufgenommen: "+fmtZeit(p.zeit),colX,M+17);
    doc.text("Plan: "+planName(p.planId),colX,M+22);
    doc.text(`Lage im Plan: x ${Number(p.x).toFixed(3)} · y ${Number(p.y).toFixed(3)}`,colX,M+27);
    doc.setTextColor(...ink);doc.setFontSize(11.5);
    const lines=doc.splitTextToSize(p.notiz||"Keine Notiz",W-M-colX);
    doc.text(lines.slice(0,13),colX,M+36);
    const bmp=await bmpFor(p.planId);
    if(bmp){
      const PW=bmp.width,PH=bmp.height;
      const cw=W-M-colX,ch=78;const aspect=cw/ch;
      let sw=Math.max(PW,PH)*0.22,sh=sw/aspect;if(sw>PW){sw=PW;sh=sw/aspect}if(sh>PH){sh=PH;sw=sh*aspect}
      let sx=p.x*PW-sw/2,sy=p.y*PH-sh/2;sx=Math.max(0,Math.min(PW-sw,sx));sy=Math.max(0,Math.min(PH-sh,sy));
      const cc=document.createElement("canvas");cc.width=1100;cc.height=Math.round(1100/aspect);
      const cg=cc.getContext("2d");cg.fillStyle="#fff";cg.fillRect(0,0,cc.width,cc.height);
      cg.drawImage(bmp,sx,sy,sw,sh,0,0,cc.width,cc.height);
      drawMarker(cg,(p.x*PW-sx)/sw*cc.width,(p.y*PH-sy)/sh*cc.height,26,p.nr);
      const cy=H-M-10-ch;
      doc.setTextColor(...grey);doc.setFontSize(8.5);doc.text("Ausschnitt "+planName(p.planId),colX,cy-2);
      doc.addImage(cc.toDataURL("image/jpeg",0.85),"JPEG",colX,cy,cw,ch);doc.setDrawColor(205,209,211);doc.rect(colX,cy,cw,ch);
    }
    for(let k=4;k<fl.length;k+=6){
      doc.addPage("a4","landscape");page++;header(doc,page);
      doc.setTextColor(...orange);doc.setFont("helvetica","bold");doc.setFontSize(16);doc.text(`${fmtNr(p.nr)}  ·  Fotos ${k+1}–${Math.min(k+6,fl.length)} von ${fl.length}`,M,M+6);
      const teil=fl.slice(k,k+6);const cols=3,rows=2,gap=4,fw=W-2*M,fh=H-2*M-20;const cw=(fw-(cols-1)*gap)/cols,chh=(fh-(rows-1)*gap)/rows;
      for(let j=0;j<teil.length;j++){const im=await toJpeg(teil[j],1200,0.82);const sz=await imgSize(im);const kk=Math.min(cw/sz.w,chh/sz.h);
        doc.addImage(await blobToDataURL(im),"JPEG",M+(j%cols)*(cw+gap),M+12+Math.floor(j/cols)*(chh+gap),sz.w*kk,sz.h*kk)}
    }
  }
  bmps.forEach(b=>{if(b&&b.close)try{b.close()}catch(e){}});
  const blob=doc.output("blob");
  offerFile(new File([blob],"Kabeldoku_Bericht_"+fileSafe(projekt.name)+"_"+stamp()+".pdf",{type:"application/pdf"}),"PDF-Bericht bereit",(mehr?"Je Plan eine Übersichtsseite mit allen Punkten. ":"Seite 1: Plan mit allen Punkten. ")+"Danach je Fotopunkt eine Seite mit Foto, Notiz und Planausschnitt.");
}
function drawMarker(g,x,y,r,nr){
  g.save();g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fillStyle="#D9531A";g.fill();g.lineWidth=Math.max(1.5,r/5);g.strokeStyle="#fff";g.stroke();
  g.fillStyle="#fff";g.font=`bold ${Math.round(r*1.05)}px Helvetica, Arial, sans-serif`;g.textAlign="center";g.textBaseline="middle";g.fillText(String(nr),x,y+r*0.05);g.restore();
}

/* ================= Sonstiges ================= */
document.addEventListener("keydown",e=>{
  if(!$("lightbox").hidden&&lbList.length>1&&(e.key==="ArrowRight"||e.key==="ArrowLeft")){(e.key==="ArrowRight"?$("lbNext"):$("lbPrev")).click();return}
  if(e.key!=="Escape")return;
  if(!$("lightbox").hidden){$("lightbox").hidden=true;return}
  if(!$("ready").hidden){$("ready").hidden=true;return}
  if(moving){const id=moving;moving=null;hint("");openDetail(id);return}
  if(["list","menu","projects"].some(i=>!$(i).hidden)){closeSides();return}
  if(!sheet.hidden){if(pending)cancelNew();else{sheet.hidden=true;selected=null;renderPins()}}
});
$("lbClose").onclick=()=>$("lightbox").hidden=true;
$("lbPrev").onclick=e=>{e.stopPropagation();lbIdx=(lbIdx-1+lbList.length)%lbList.length;showLb()};
$("lbNext").onclick=e=>{e.stopPropagation();lbIdx=(lbIdx+1)%lbList.length;showLb()};
{let sx=null;$("lightbox").addEventListener("touchstart",e=>{sx=e.touches[0].clientX},{passive:true});
 $("lightbox").addEventListener("touchend",e=>{if(sx==null||lbList.length<2)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>50){lbIdx=(lbIdx+(dx<0?1:-1)+lbList.length)%lbList.length;showLb()}})}
$("lightbox").onclick=e=>{if(e.target.id==="lightbox")$("lightbox").hidden=true};

let persisted=false;
async function boot(){
  try{if(navigator.storage&&navigator.storage.persist){persisted=await navigator.storage.persisted()||await navigator.storage.persist()}}catch(e){}
  let list=[];
  try{list=await DB.projekte()}catch(e){$("empty").hidden=false;toast("Speicher nicht verfügbar. Privates Surfen ausschalten.",6000);return}
  const last=LS.get("kfd:last");
  const pick=list.find(p=>p.id===last)||list.sort((a,b)=>(b.geaendert||"").localeCompare(a.geaendert||""))[0];
  if(pick)await openProject(pick.id);else showStart();
}
window.addEventListener("beforeunload",e=>{if(pending&&pendingFotos.length){e.preventDefault();e.returnValue=""}});
if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost")){navigator.serviceWorker.register("sw.js").catch(()=>{})}
window.__kfd={mergePunkte};
window.addEventListener("error",e=>{try{busy(false);toast("Fehler: "+(e.message||"unbekannt"),6000)}catch(x){}});
window.addEventListener("unhandledrejection",e=>{try{busy(false);toast("Fehler: "+((e.reason&&e.reason.message)||e.reason||"unbekannt"),6000)}catch(x){}});
boot();
})();
