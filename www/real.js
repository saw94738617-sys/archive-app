/* =====================================================================
   아카이브 · 실제 앱 동작 (저장 · 링크 읽기 · 재고 확인 · 백업 · 뒤로가기)
   index.html의 화면 코드 위에 얹혀서 동작해요.
   ===================================================================== */
(function(){
"use strict";
const CAP=window.Capacitor;
const NATIVE=!!(CAP&&CAP.isNativePlatform&&CAP.isNativePlatform());
const plug=n=>{try{return CAP&&CAP.registerPlugin?CAP.registerPlugin(n):(CAP&&CAP.Plugins&&CAP.Plugins[n])}catch(e){return null}};
const Http=NATIVE?plug("CapacitorHttp"):null;
const FS=NATIVE?plug("Filesystem"):null;
const Share=NATIVE?plug("Share"):null;
const AppP=NATIVE?plug("App"):null;
window.ARCHIVE_NATIVE=NATIVE;

/* ---------- 1) 저장: IndexedDB ---------- */
const DBN="archive",VER=1;let db=null;
function openDB(){return new Promise((ok,no)=>{const r=indexedDB.open(DBN,VER);
  r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("items"))d.createObjectStore("items",{keyPath:"id"});if(!d.objectStoreNames.contains("photos"))d.createObjectStore("photos");if(!d.objectStoreNames.contains("meta"))d.createObjectStore("meta")};
  r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
const tx=(st,mode)=>db.transaction(st,mode);
const reqP=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const getAll=st=>reqP(tx(st,"readonly").objectStore(st).getAll());
const getKeys=st=>reqP(tx(st,"readonly").objectStore(st).getAllKeys());
const getOne=(st,k)=>reqP(tx(st,"readonly").objectStore(st).get(k));

function hashStr(s){let h1=0xdeadbeef,h2=0x41c6ce57;const step=Math.max(1,Math.floor(s.length/4000));
  for(let i=0;i<s.length;i+=step){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return "p"+s.length.toString(36)+"_"+(4294967296*(2097151&h2)+(h1>>>0)).toString(36)}
const photoKey=new Map();            /* dataURL → 저장 키 */
const knownPhotos=new Set();         /* DB에 이미 있는 사진 키 */
const savedJson=new Map();           /* 아이템 id → 마지막 저장 JSON */
const PF=["photo","chartImg"];
function toRef(u){if(typeof u!=="string"||!u.startsWith("data:"))return u;let k=photoKey.get(u);if(!k){k=hashStr(u);photoKey.set(u,k)}return "idb:"+k}
function packItem(it){const o=JSON.parse(JSON.stringify(it,(k,v)=>k==="photo"||k==="chartImg"?undefined:k==="photos"?undefined:v));
  PF.forEach(f=>{if(it[f])o[f]=toRef(it[f])});if(Array.isArray(it.photos))o.photos=it.photos.map(toRef);return o}
let saving=null,again=false;
async function persist(){if(!db)return;if(saving){again=true;return saving}
  saving=(async()=>{try{
    const t=tx(["items","photos"],"readwrite"),IS=t.objectStore("items"),PS=t.objectStore("photos");
    const ids=new Set();
    for(const it of ITEMS){ids.add(it.id);const o=packItem(it);const j=JSON.stringify(o);if(savedJson.get(it.id)!==j){IS.put(o);savedJson.set(it.id,j)}
      const urls=[...PF.map(f=>it[f]),...(it.photos||[])].filter(u=>typeof u==="string"&&u.startsWith("data:"));
      for(const u of urls){const k=photoKey.get(u)||hashStr(u);photoKey.set(u,k);if(!knownPhotos.has(k)){PS.put(u,k);knownPhotos.add(k)}}}
    for(const id of [...savedJson.keys()])if(!ids.has(id)){IS.delete(id);savedJson.delete(id)}
    await new Promise((ok,no)=>{t.oncomplete=ok;t.onerror=()=>no(t.error);t.onabort=()=>no(t.error)});
  }catch(e){console.warn("save failed",e);if(typeof toast==="function")toast("저장 중 문제가 생겼어요 · 저장 공간을 확인해 주세요")}
  finally{saving=null;if(again){again=false;persist()}}})();return saving}
let tmr=0;function persistSoon(){clearTimeout(tmr);tmr=setTimeout(persist,250)}
window.archivePersist=persist;

async function cleanupPhotos(){try{const used=new Set();for(const it of ITEMS){[...PF.map(f=>it[f]),...(it.photos||[])].forEach(u=>{if(typeof u==="string"&&u.startsWith("data:"))used.add(photoKey.get(u))})}
  const keys=await getKeys("photos");const t=tx("photos","readwrite");keys.forEach(k=>{if(!used.has(k)){t.objectStore("photos").delete(k);knownPhotos.delete(k)}})}catch(e){}}

async function load(){
  try{db=await openDB()}catch(e){console.warn(e);toast("기록 저장소를 열지 못했어요");return}
  const seeded=await getOne("meta","seeded");
  if(!seeded){await persist();await reqP(tx("meta","readwrite").objectStore("meta").put(Date.now(),"seeded"));return}
  const rows=await getAll("items");const keys=await getKeys("photos");keys.forEach(k=>knownPhotos.add(k));
  const cache=new Map();const res=async v=>{if(typeof v!=="string"||!v.startsWith("idb:"))return v;const k=v.slice(4);if(!cache.has(k)){const d=await getOne("photos",k);cache.set(k,d||"");if(d)photoKey.set(d,k)}return cache.get(k)};
  const out=[];
  for(const r of rows){savedJson.set(r.id,JSON.stringify(r));const it={...r};for(const f of PF)if(it[f])it[f]=await res(it[f]);if(Array.isArray(it.photos))it.photos=(await Promise.all(it.photos.map(res))).filter(Boolean);out.push(it)}
  const order=(await getOne("meta","order"))||[];const pos=new Map(order.map((id,i)=>[id,i]));
  out.sort((a,b)=>(pos.has(a.id)?pos.get(a.id):-1)-(pos.has(b.id)?pos.get(b.id):-1));
  ITEMS.splice(0,ITEMS.length,...out);
  if(typeof renderPins==="function")renderPins();if(typeof updateCounts==="function")updateCounts();
  cleanupPhotos();
}
/* 순서도 저장 */
const _persist=persist;
async function persistAll(){await _persist();try{await reqP(tx("meta","readwrite").objectStore("meta").put(ITEMS.map(x=>x.id),"order"))}catch(e){}}
function hook(name){const f=window[name];if(typeof f!=="function")return;window[name]=function(){const r=f.apply(this,arguments);clearTimeout(tmr);tmr=setTimeout(persistAll,250);return r}}
["renderPins","updateCounts","openDetail","closeEd","closeRec","closeDetail"].forEach(hook);
document.addEventListener("visibilitychange",()=>{if(document.hidden)persistAll()});
window.addEventListener("pagehide",()=>persistAll());

/* ---------- 2) 링크 읽기 (앱에서만) ---------- */
const UA="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
async function getText(url){
  if(window.__testPages&&url in window.__testPages){const v=window.__testPages[url];if(v===null)throw new Error("404");return v}
  if(Http){const r=await Http.get({url,headers:{"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8","Accept-Language":"ko-KR,ko;q=0.9,ja;q=0.7,en;q=0.6"},responseType:"text",connectTimeout:15000,readTimeout:20000});
    if(r.status>=400)throw new Error("HTTP "+r.status);return typeof r.data==="string"?r.data:JSON.stringify(r.data)}
  const r=await fetch(url);if(!r.ok)throw new Error("HTTP "+r.status);return await r.text()}
async function getImageBlob(url){
  if(Http){const r=await Http.get({url,headers:{"User-Agent":UA,"Referer":url},responseType:"blob",connectTimeout:15000,readTimeout:25000});
    if(r.status>=400)throw new Error("HTTP "+r.status);const b64=typeof r.data==="string"?r.data:"";const bin=atob(b64.replace(/^data:[^,]+,/,""));const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);
    return new Blob([a],{type:(r.headers&&(r.headers["Content-Type"]||r.headers["content-type"]))||"image/jpeg"})}
  const r=await fetch(url);return await r.blob()}
const blobToDataURL=b=>new Promise(ok=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.readAsDataURL(b)});
async function imageAsDataURL(url,max){const b=await getImageBlob(url);let s=b;try{if(typeof shrink==="function")s=await shrink(b,max||1600)}catch(e){}return await blobToDataURL(s)}

const absUrl=(u,base)=>{try{return new URL(u,base).href}catch(e){return ""}};
const clean=s=>String(s||"").replace(/\s+/g," ").trim();
const CUR={KRW:"₩",JPY:"¥",USD:"$",EUR:"€",GBP:"£"};
function sizeKey(s){s=clean(s).toUpperCase();const m=s.match(/(?:^|[\s/·\-_(])((?:XX?S|XX?L|XXXL|[SML]|FREE|F|ONE ?SIZE|\d{2,3}(?:\.\d)?|\d{1,2}(?:\.5)?))(?=$|[\s/·\-_)])/);return m?m[1]:s}
function availOf(v){v=String(v||"").toLowerCase();if(/instock|in_stock|limitedavailability|presale|preorder/.test(v))return "in";if(/outofstock|out_of_stock|soldout|discontinued/.test(v))return "out";return "unk"}

function parseLD(doc){const out=[];doc.querySelectorAll('script[type="application/ld+json"]').forEach(s=>{try{const j=JSON.parse(s.textContent.trim());const walk=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(walk);if(typeof x!=="object")return;if(x["@graph"])walk(x["@graph"]);const t=x["@type"];if(t==="Product"||(Array.isArray(t)&&t.includes("Product"))||t==="ProductGroup")out.push(x);if(x.hasVariant)walk(x.hasVariant)};walk(j)}catch(e){}});return out}
function meta(doc,...names){for(const n of names){const el=doc.querySelector(`meta[property="${n}"],meta[name="${n}"],meta[itemprop="${n}"]`);if(el&&el.content)return clean(el.content)}return ""}

function findChart(doc){
  const SZ=/^(XX?S|XX?L|XXXL|[SML]|FREE|F|\d{1,3}(\.\d)?|[0-9]{2}\/[0-9]{2}|US ?\d+(\.5)?|EU ?\d+|JP ?\d+)$/i,LB=/(총장|기장|어깨|가슴|소매|허리|엉덩이|힙|허벅지|밑위|밑단|발|길이|너비|폭|높이|width|length|chest|shoulder|sleeve|waist|hip|thigh|rise|hem|inseam|着丈|総丈|肩幅|身幅|袖丈|ウエスト|ヒップ|股上|股下|ワタリ|裾幅|足長)/i;
  for(const t of doc.querySelectorAll("table")){
    const rows=[...t.querySelectorAll("tr")].map(tr=>[...tr.children].map(td=>clean(td.textContent)));if(rows.length<2)continue;
    /* 가로형: 첫 줄이 사이즈 */
    const h=rows[0];const cols=h.slice(1).filter(Boolean);
    if(cols.length>=1&&cols.every(c=>SZ.test(c))&&rows.slice(1).some(r=>LB.test(r[0]||""))){
      const body=rows.slice(1).filter(r=>r[0]&&r.slice(1).some(v=>/\d/.test(v))).map(r=>[r[0].replace(/\(cm\)/i,"").trim(),...cols.map((_,i)=>(r[i+1]||"").replace(/cm/i,"").trim())]);
      if(body.length)return {cols:cols.map(c=>c.toUpperCase()),rows:body}}
    /* 세로형: 첫 칸이 사이즈 */
    const sizesCol=rows.slice(1).map(r=>r[0]);
    if(sizesCol.length&&sizesCol.every(c=>SZ.test(c))&&h.slice(1).some(x=>LB.test(x))){
      const labels=h.slice(1);return {cols:sizesCol.map(c=>c.toUpperCase()),rows:labels.map((l,li)=>[l.replace(/\(cm\)/i,"").trim(),...rows.slice(1).map(r=>(r[li+1]||"").replace(/cm/i,"").trim())])}}
  }return null}

function cafe24Stock(html){const m=html.match(/option_stock_data\s*=\s*'((?:[^'\\]|\\.)*)'/);if(!m)return null;
  try{const lit=(new Function("return '"+m[1]+"'"))();const j=JSON.parse(lit);const st={};Object.values(j).forEach(o=>{const val=clean(o.option_value_orginal||o.option_value||o.option_name||"");if(!val)return;const parts=val.split(/[-/,]/).map(clean);const k=sizeKey(parts[parts.length-1]);
      const selling=(o.is_selling||"T")==="T"&&(o.is_display||"T")!=="F";const useSt=o.use_stock===true||o.use_stock==="T";const n=+o.stock_number;
      const v=!selling?"out":(useSt?(n>0?"in":"out"):(o.is_auto_soldout==="T"&&n<=0?"out":"in"));st[k]=st[k]==="in"?"in":v});
    return Object.keys(st).length?st:null}catch(e){return null}}

async function shopifyData(url,html){if(!/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(html))return null;
  try{const u=new URL(url);const m=u.pathname.match(/\/products\/[^/?#]+/);if(!m)return null;const j=JSON.parse(await getText(u.origin+m[0]+".js"));
    const cur=(html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)||[])[1]||meta(new DOMParser().parseFromString(html,"text/html"),"og:price:currency","product:price:currency")||"";
    const st={};(j.variants||[]).forEach(v=>{const opts=[v.option1,v.option2,v.option3].filter(Boolean);const sz=opts.find(o=>/^(XX?S|XX?L|XXXL|[SML]|FREE|F|\d{1,3}(\.\d)?|US ?\d+(\.5)?)$/i.test(clean(o)))||opts[opts.length-1]||v.title;const k=sizeKey(sz);st[k]=st[k]==="in"?"in":(v.available?"in":"out")});
    const dec=cur==="JPY"||cur==="KRW"?1:100;
    return {name:j.title,brand:j.vendor,price:j.price!=null?j.price/dec:null,currency:cur,images:(j.images||[]).map(s=>absUrl(s,url)),stock:Object.keys(st).length?st:null}}catch(e){return null}}

async function readProduct(url){
  const html=await getText(url);const doc=new DOMParser().parseFromString(html,"text/html");
  const P={url,name:"",brand:"",price:null,currency:"",images:[],stock:null,chart:null,shop:"",src:[]};
  const lds=parseLD(doc);const ld=lds[0]||{};if(lds.length)P.src.push("JSON-LD");if(meta(doc,"og:title"))P.src.push("og 태그");
  P.name=clean(ld.name)||meta(doc,"og:title","twitter:title")||clean(doc.title);
  const br=ld.brand;P.brand=clean(typeof br==="string"?br:br&&br.name)||meta(doc,"product:brand","og:brand");
  P.shop=meta(doc,"og:site_name");
  const imgs=[];const addI=v=>{if(!v)return;if(Array.isArray(v))return v.forEach(addI);if(typeof v==="object")return addI(v.url||v.contentUrl);const a=absUrl(v,url);if(a&&!imgs.includes(a))imgs.push(a)};
  lds.forEach(x=>addI(x.image));doc.querySelectorAll('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]').forEach(m=>addI(m.content));
  /* 상세 이미지 후보(상품 영역 큰 사진) */
  doc.querySelectorAll(".xans-product-image img, .product-image img, .product__media img, [class*=gallery] img, [class*=Gallery] img, #prdDetail img").forEach(im=>{if(imgs.length<14)addI(im.getAttribute("data-src")||im.getAttribute("src"))});
  P.images=imgs.filter(u=>/^https?:/.test(u)&&!/(logo|icon|sprite|blank|spacer)\b/i.test(u));
  let offers=[];lds.forEach(x=>{const o=x.offers;if(o)offers=offers.concat(Array.isArray(o)?o:[o]);if(x.hasVariant)[].concat(x.hasVariant).forEach(v=>{if(v.offers)offers=offers.concat([].concat(v.offers).map(o=>({...o,name:o.name||v.name,size:v.size})))})});
  const o0=offers.find(o=>o.price!=null||o.lowPrice!=null)||{};
  const pr=o0.price!=null?o0.price:o0.lowPrice;P.price=pr!=null?+String(pr).replace(/[^\d.]/g,""):null;P.currency=o0.priceCurrency||"";
  if(P.price==null){const a=meta(doc,"product:price:amount","og:price:amount","product:sale_price:amount");if(a)P.price=+a.replace(/[^\d.]/g,"");P.currency=P.currency||meta(doc,"product:price:currency","og:price:currency")}
  /* 사이즈별 재고 */
  const st={};offers.forEach(o=>{const nm=o.size||o.name||o.sku||"";if(!nm||!o.availability)return;const k=sizeKey(nm);st[k]=st[k]==="in"?"in":availOf(o.availability)});
  if(Object.keys(st).length>1)P.stock=st;
  const c24=cafe24Stock(html);if(c24){P.stock=c24;P.src.push("카페24 재고")}
  const sh=await shopifyData(url,html);if(sh){P.src.push("Shopify");P.name=P.name||sh.name;P.brand=P.brand||sh.brand;if(P.price==null&&sh.price!=null){P.price=sh.price;P.currency=sh.currency}sh.images.forEach(u=>{if(!P.images.includes(u))P.images.push(u)});if(sh.stock)P.stock=sh.stock}
  if(!P.stock&&offers.length===1&&offers[0].availability)P.whole=availOf(offers[0].availability);
  P.chart=findChart(doc);if(P.chart)P.src.push("실측표");P.htmlLen=html.length;
  if(P.brand&&P.name.toLowerCase().startsWith(P.brand.toLowerCase()+" "))P.name=P.name.slice(P.brand.length+1);
  P.name=P.name.replace(/\s*[|·\-–]\s*[^|·\-–]{2,30}$/,m=>P.shop&&m.includes(P.shop)?"":m).trim();
  if(!P.currency){const host=new URL(url).hostname;P.currency=/\.jp$/.test(host)?"JPY":/\.kr$|\.co\.kr$/.test(host)?"KRW":""}
  return P;
}
/* 개발자 기록 */
const LOGK="archive-devlog";
function devLog(e){try{const L=JSON.parse(localStorage.getItem(LOGK)||"[]");L.unshift({t:Date.now(),...e});localStorage.setItem(LOGK,JSON.stringify(L.slice(0,150)))}catch(x){}}
const _readProduct=readProduct;
readProduct=async function(url){const t0=Date.now();let host="";try{host=new URL(url).hostname.replace(/^www\.|^m\./,"")}catch(e){}
  try{const P=await _readProduct(url);devLog({k:"ok",host,url,ms:Date.now()-t0,msg:[P.src.join("+")||"정보 없음",P.stock?"재고 "+Object.keys(P.stock).length+"개":"",P.images.length?"사진 "+P.images.length:"",P.chart?"실측표":""].filter(Boolean).join(" · ")});return P}
  catch(e){devLog({k:"fail",host,url,ms:Date.now()-t0,msg:String(e&&e.message||e)});throw e}};
window.addEventListener("error",e=>devLog({k:"err",msg:String(e.message||e.error)+(e.filename?" @"+e.filename.split("/").pop()+":"+e.lineno:"")}));
window.addEventListener("unhandledrejection",e=>devLog({k:"err",msg:"Promise: "+String(e.reason&&e.reason.message||e.reason)}));
window.archiveReadProduct=readProduct;window.__archiveRealFetch=()=>realFetch();
function fmtPrice(p,c){if(p==null||isNaN(p))return "";const sym=CUR[c]||(c?c+" ":"₩");return sym+(c==="USD"||c==="EUR"||c==="GBP"?p.toLocaleString("en-US",{minimumFractionDigits:p%1?2:0}):Math.round(p).toLocaleString("ko-KR"))}
function stamp(){const d=new Date();return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`}

/* 기록 화면: 가져오기 */
async function realFetch(){
  const v=$("fLink").value.trim();
  if(!okUrl(v)){$("fetchStatus").textContent="https:// 로 시작하는 쇼핑몰 링크를 붙여넣어 주세요.";return}
  $("fetchStatus").innerHTML='<span class="spin"></span>상품 페이지 읽는 중…';$("fetchBtn").disabled=true;
  try{
    const P=await readProduct(v);
    addSeller(v);const s=recSellers.find(x=>x.url===v);
    if(s){s.shop=P.shop&&P.shop.length<20?P.shop:s.shop;s.price=fmtPrice(P.price,P.currency);if(P.stock){s.stock=P.stock;s.checked=stamp()}if(P.whole)s.warn=P.whole==="out"?"품절로 표시돼요":"";renderSellers()}
    const fill=[];
    if(P.name&&!$("fName").value){$("fName").value=P.name;$("fName").classList.add("flash");fill.push("이름")}
    if(P.brand&&!$("fBrand").value){$("fBrand").value=P.brand;fill.push("브랜드")}
    if(P.price!=null&&!$("fPrice").value){const sym=CUR[P.currency]||"₩";$("fPrice").value=Math.round(P.price).toLocaleString("ko-KR");document.querySelectorAll("#cur button").forEach(b=>b.setAttribute("aria-pressed",b.textContent===sym));fill.push("가격")}
    if(P.chart&&(!recChart||!recChart.rows.some(r=>r.slice(1).some(Boolean)))){recChart=P.chart;renderChart();const ex=$("sztEx");if(ex)ex.hidden=true;fill.push("사이즈표")}
    $("fetchStatus").innerHTML='<span class="spin"></span>사진 가져오는 중…';
    const urls=P.images.slice(0,9);const got=[];
    await Promise.all(urls.map(async(u,i)=>{try{got[i]=await imageAsDataURL(u,1600)}catch(e){}}));
    recCands=got.filter(Boolean);
    if(recCands.length){if(!recPhotoUrl&&!$("photo").classList.contains("has")){recSel=[0];applyPick()}else recSel=[];renderPicker();fill.push("사진 "+recCands.length+"장")}
    if(P.stock)fill.push("재고");
    $("fetchStatus").textContent=fill.length?"✓ "+fill.join(" · ")+" 가져왔어요":"페이지에서 읽을 수 있는 정보가 없었어요 · 직접 적어주세요";
    $("fLink").value="";
  }catch(e){console.warn(e);addSeller(v);$("fetchStatus").textContent="이 쇼핑몰은 페이지를 읽지 못했어요 · 판매처만 추가했어요";const nm=nameFromUrl(v);if(nm&&!$("fName").value)$("fName").value=nm}
  finally{$("fetchBtn").disabled=false}
}

/* 재고 다시 확인 */
async function refreshItem(it,quiet){
  const res=[];for(const s of (it.sellers||[])){try{const P=await readProduct(s.url);const before={...(s.stock||{})},bp=s.price;
      s.price=fmtPrice(P.price,P.currency)||s.price;if(P.stock)s.stock=P.stock;s.checked=stamp();s.warn=P.whole==="out"?"품절로 표시돼요":"";res.push({s,before,bp,ok:true})}
    catch(e){res.push({s,ok:false})}}
  if(!quiet){const ok=res.filter(r=>r.ok).length;toast(ok?`${ok}곳 확인했어요 · ${stamp()}`:"판매처 페이지를 읽지 못했어요")}
  return res}
document.addEventListener("click",async e=>{
  if(!NATIVE)return;
  if(e.target.closest("#stRefresh")){e.stopImmediatePropagation();e.preventDefault();const it=ITEMS.find(x=>x.id===dtId);if(!it)return;
    const b=e.target.closest("#stRefresh");b.disabled=true;b.textContent="확인 중…";await refreshItem(it);openDetail(it.id);persistAll();return}
},true);

/* 앱 열 때: 알림 켠 위시 확인 */
async function checkAlerts(force){
  if(!force){let ev="open";try{ev=localStorage.getItem("archive-check")||"open"}catch(e){}const last=+(localStorage.getItem("archive-lastcheck")||0),gap={open:0,"1h":36e5,"1d":864e5}[ev]||0;if(Date.now()-last<gap)return}
  try{localStorage.setItem("archive-lastcheck",String(Date.now()))}catch(e){}
  const L=ITEMS.filter(x=>x.kind==="wish"&&x.alert&&(x.alert.restock||x.alert.price));const news=[];
  for(const it of L){const my=(typeof myCols==="function"?myCols(it).names[0]:"")||"";const oldP=priceNum(it.price);
    const res=await refreshItem(it,true);
    for(const r of res){if(!r.ok)continue;
      if(it.alert.restock&&my&&r.s.stock&&r.s.stock[my]==="in"&&r.before[my]&&r.before[my]!=="in")news.push([`${my} 재입고`,`${(it.brand?it.brand+" ":"")+it.name} · ${r.s.shop} ${r.s.price||""}`,it.id]);
      const np=priceNum(r.s.price);if(it.alert.price&&np&&r.bp&&np<priceNum(r.bp)&&(!it.alert.target||np<=+it.alert.target))news.push(["가격 내려감",`${(it.brand?it.brand+" ":"")+it.name} · ${r.bp} → ${r.s.price}`,it.id])}}
  if(L.length){persistAll();if(typeof renderPins==="function")renderPins()}
  news.forEach((n,i)=>setTimeout(()=>showNotif(n[0],n[1],n[2]),1500+i*5500));
}

/* ---------- 3) 백업 ---------- */
async function buildBackup(){await persistAll();
  let prefs={};try{prefs=JSON.parse(localStorage.getItem("archive-prefs")||"{}")}catch(e){}
  return JSON.stringify({app:"archive",v:1,at:new Date().toISOString(),items:ITEMS,prefs})}
async function exportBackup(){
  try{const json=await buildBackup();const d=new Date(),name=`archive-backup-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}.json`;
    if(FS){let saved="";try{await FS.writeFile({path:"Archive/"+name,data:json,directory:"DOCUMENTS",encoding:"utf8",recursive:true});saved="문서 › Archive 폴더"}catch(e){}
      const c=await FS.writeFile({path:name,data:json,directory:"CACHE",encoding:"utf8"});
      try{localStorage.setItem("archive-lastbackup",stamp())}catch(e){}
      if(Share){try{await Share.share({title:"아카이브 백업",text:"아카이브 기록 백업 파일",files:[c.uri],dialogTitle:"백업 파일 보관할 곳"});}catch(e){}}
      toast(saved?`백업했어요 · ${saved}에도 저장했어요`:"백업 파일을 만들었어요 · 드라이브나 파일 앱에 보관해 주세요")}
    else{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));a.download=name;a.click();toast("백업 파일을 내려받았어요")}
    if(typeof renderAcct==="function")renderAcct();
  }catch(e){console.warn(e);toast("백업을 만들지 못했어요")}}
function importBackup(){const inp=document.createElement("input");inp.type="file";inp.accept="*/*";
  inp.onchange=async()=>{const f=inp.files&&inp.files[0];if(!f)return;toast("불러오는 중…");try{const txt=await f.text();let j;try{j=JSON.parse(txt.replace(/^\uFEFF/,""))}catch(e){devLog({k:"err",msg:"백업 파일 읽기: "+f.name+" "+f.size+"B"});throw e}if(j.app!=="archive"||!Array.isArray(j.items))throw 0;
      const cur=new Map(ITEMS.map(x=>[x.id,x]));let add=0,upd=0;j.items.forEach(x=>{if(cur.has(x.id)){Object.assign(cur.get(x.id),x);upd++}else{ITEMS.push(x);add++}});
      if(j.prefs&&confirm("설정(내 사이즈 · 테마 등)도 백업 때 것으로 바꿀까요?")){localStorage.setItem("archive-prefs",JSON.stringify(j.prefs))}
      await persistAll();renderPins();updateCounts();toast(`불러왔어요 · 새 기록 ${add}개, 겹친 기록 ${upd}개 갱신`);if(typeof G!=="undefined"&&G.on)setTimeout(()=>uploadBackup(true).then(()=>{toast("드라이브에도 백업했어요");if($("acctCard"))renderAcct()}).catch(()=>{}),1500);if(j.prefs)setTimeout(()=>location.reload(),1200)}
    catch(e){toast("아카이브 백업 파일이 아니에요")}};inp.click()}
window.archiveExport=exportBackup;window.archiveImport=importBackup;

/* ---------- 4) 뒤로가기 버튼 ---------- */
function onBack(){
  const on=id=>{const el=$(id);return el&&el.classList.contains("on")};const click=id=>{const b=$(id);if(b)b.click()};
  const ob=$("ob");if(ob&&!ob.hidden){if(typeof obStep!=="undefined"&&obStep>0){obStep--;obRender()}return}
  const lk=$("lock");if(lk&&!lk.hidden)return;
  if(on("ed"))return click("edBack");
  if(on("dev"))return click("devBack");
  if(on("searchPanel"))return click("srBack");
  if(on("brandsPanel"))return click("brBack");
  if(on("statsPanel"))return click("stBack");
  if(on("detail"))return click("dtBack");
  if(on("rec"))return click("recClose");
  if(on("settings"))return click("setBack");
  if(document.querySelector(".drawer.on,.drawer.open,#app.menu-open")||($("menuBtn")&&$("menuBtn").getAttribute("aria-expanded")==="true"))return setMenu(false);
  if(!$("catView").hidden)return goHome();
  if(AppP&&AppP.minimizeApp)AppP.minimizeApp();
}
if(AppP)AppP.addListener("backButton",onBack);
window.archiveBack=onBack;

/* ---------- 5) 시안 문구 → 실제 앱 문구 ---------- */
document.title="아카이브";
const ver=$("verTap");if(ver)ver.innerHTML="ARCHIVE v"+(window.ARCHIVE_VERSION||"0.1")+(window.ARCHIVE_DEV?" · DEV":"")+"<br>EST. 2026";
document.querySelectorAll('[data-later="시안이라 지울 기록이 없어요"]').forEach(b=>{b.removeAttribute("data-later");b.onclick=async()=>{if(!confirm("모든 옷 기록을 지울까요? 되돌릴 수 없어요. 먼저 백업을 권해요."))return;ITEMS.splice(0);await persistAll();renderPins();updateCounts();toast("모든 기록을 지웠어요")}});
const _toast=window.toast;window.toast=function(t){t=String(t).replace(/ · 시안이라 새로고침하면 사라져요/,"");return _toast(t)};
if(NATIVE){
  $("fetchBtn").onclick=realFetch;
  /* 상품 사진 예시 타일 대신 실제 사진만 */
  window.showPhotoPicker=function(){};
  window.fillExampleChart=function(){};
}





/* 저장 공간을 브라우저가 임의로 비우지 않게 요청 */
try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}

/* ---------- 6) 개발자 화면 (개발자 빌드에만) ---------- */
if(window.ARCHIVE_DEV){
  const ago=t=>{const s=(Date.now()-t)/1000;return s<60?"방금":s<3600?Math.floor(s/60)+"분 전":s<86400?Math.floor(s/3600)+"시간 전":Math.floor(s/86400)+"일 전"};
  const kb=n=>n>1048576?(n/1048576).toFixed(1)+"MB":Math.round(n/1024)+"KB";
  let lastTest=null;
  window.renderDev=async function(){
    let L=[];try{L=JSON.parse(localStorage.getItem(LOGK)||"[]")}catch(e){}
    const today=new Date().toDateString(),reads=L.filter(x=>(x.k==="ok"||x.k==="fail")&&new Date(x.t).toDateString()===today);
    const by={};L.filter(x=>x.k==="ok"||x.k==="fail").forEach(x=>{const b=by[x.host]||(by[x.host]={ok:0,fail:0,last:0,lastK:""});b[x.k]++;if(x.t>b.last){b.last=x.t;b.lastK=x.k}});
    let ev="open";try{ev=localStorage.getItem("archive-check")||"open"}catch(e){}
    let est={};try{est=navigator.storage&&navigator.storage.estimate?await navigator.storage.estimate():{}}catch(e){}
    let pers=false;try{pers=navigator.storage&&navigator.storage.persisted?await navigator.storage.persisted():false}catch(e){}
    const photos=ITEMS.reduce((n,x)=>n+(x.photo?1:0)+((x.photos||[]).length),0);
    const lc=+(localStorage.getItem("archive-lastcheck")||0);
    $("devBody").innerHTML=`
    <div class="dv"><h3>링크 읽기 테스트</h3>
      <div class="dvin"><input id="dvUrl" type="url" placeholder="https:// 상품 링크" inputmode="url"><button type="button" id="dvRun">읽기</button></div>
      <div id="dvOut">${lastTest||'<p class="sub" style="margin:8px 0 0">링크를 넣으면 앱이 그 페이지에서 무엇을 읽었는지 그대로 보여줘요. 저장은 안 해요.</p>'}</div></div>
    <div class="dv"><h3>오늘 쇼핑몰 확인</h3><div class="big">${reads.length}<small> 번 · 실패 ${reads.filter(x=>x.k==="fail").length}</small></div>
      <div class="sub" style="margin-top:8px">링크 가져오기 · 지금 확인 · 알림 확인을 모두 센 횟수예요 · 마지막 알림 확인 ${lc?ago(lc):"없음"}</div></div>
    <div class="dv"><h3>재고 · 가격 자동 확인 간격</h3><div class="sub">너무 자주 확인하면 쇼핑몰이 차단할 수 있어요</div>
      <div class="chips" id="ckChips">${[["open","앱 열 때마다"],["1h","1시간에 한 번"],["1d","하루에 한 번"]].map(([v,l])=>`<button type="button" data-v="${v}" aria-pressed="${ev===v}">${l}</button>`).join("")}</div></div>
    <div class="dv"><h3>쇼핑몰별 결과</h3><div class="rows">${Object.keys(by).length?Object.entries(by).sort((a,b)=>b[1].last-a[1].last).slice(0,12).map(([h,b])=>`<div><span>${escH(h)}<small>${ago(b.last)} · ${b.lastK==="ok"?"성공":"실패"}</small></span><b>${b.ok} / <span style="color:${b.fail?"#ff8a73":"inherit"}">${b.fail}</span></b></div>`).join(""):`<div><span>아직 기록 없어요</span><b></b></div>`}</div>
      <p class="sub" style="margin:8px 0 0">성공 / 실패 횟수</p></div>
    <div class="dv"><h3>최근 기록</h3><div class="dlog">${L.slice(0,25).map(x=>`<div class="${x.k}"><i>${new Date(x.t).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false})}</i><b>${x.k==="ok"?"성공":x.k==="fail"?"실패":"오류"}</b><span>${escH(x.host?x.host+" · ":"")}${escH(x.msg||"")}${x.ms?" · "+x.ms+"ms":""}</span></div>`).join("")||'<p class="sub" style="margin:0">아직 없어요</p>'}</div>
      <div class="dvbtns"><button type="button" id="dvLogCopy">기록 복사</button><button type="button" id="dvLogClear">기록 지우기</button></div></div>
    <div class="dv"><h3>저장소</h3><div class="rows">
      <div><span>옷 기록</span><b>${ITEMS.length}개 · 위시 ${ITEMS.filter(x=>x.kind==="wish").length}</b></div>
      <div><span>사진</span><b>${photos}장</b></div>
      <div><span>사용 중</span><b>${est.usage!=null?kb(est.usage):"알 수 없음"}${est.quota?" / "+kb(est.quota):""}</b></div>
      <div><span>영구 저장<small>폰이 공간 부족해도 안 지움</small></span><b style="color:${pers?"#7fc79a":"#f0a35e"}">${pers?"켜짐":"꺼짐"}</b></div></div></div>
    <div class="dv"><h3>도구</h3><div class="dvbtns col">
      <button type="button" id="dvAlert">알림 켠 위시 지금 확인</button>
      <button type="button" id="dvNotif">테스트 알림 띄우기</button>
      <button type="button" id="dvClean">안 쓰는 사진 정리</button>
      <button type="button" id="dvJson">기록 JSON 복사 (사진 빼고)</button>
      <button type="button" id="dvOb">처음 시작 화면 다시 보기</button></div></div>
    <div class="dv"><h3>앱 정보</h3><div class="rows">
      <div><span>버전</span><b>v${escH(window.ARCHIVE_VERSION||"0.1")} · DEV</b></div>
      <div><span>실행 환경</span><b>${NATIVE?"안드로이드 앱":"브라우저"}</b></div>
      <div><span>WebView</span><b>${escH((navigator.userAgent.match(/Chrome\/[\d.]+/)||[""])[0])}</b></div>
      <div><span>외부 API</span><b>없음 · 0원</b></div></div></div>
    <p class="sub" style="margin:18px 4px 0;line-height:1.6">이 화면은 내 폰용 개발자 빌드에만 있어요. 일반 빌드에는 메뉴가 없어요.</p>`;
    const cp=async t=>{try{await navigator.clipboard.writeText(t);toast("복사했어요")}catch(e){const a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove();toast("복사했어요")}};
    $("ckChips").onclick=e=>{const b=e.target.closest("button");if(!b)return;try{localStorage.setItem("archive-check",b.dataset.v)}catch(x){}renderDev();toast(b.textContent+" 확인하도록 바꿨어요")};
    $("dvRun").onclick=async()=>{const u=$("dvUrl").value.trim();if(!okUrl(u)){toast("https:// 링크를 넣어주세요");return}
      $("dvOut").innerHTML='<p class="sub" style="margin:8px 0 0">읽는 중…</p>';const t0=Date.now();
      try{const P=await readProduct(u);const ms=Date.now()-t0;
        lastTest=`<div class="rows dvres">
          <div><span>읽은 방식</span><b>${escH(P.src.join(" + ")||"없음")}</b></div>
          <div><span>이름</span><b>${escH(P.name||"–")}</b></div><div><span>브랜드</span><b>${escH(P.brand||"–")}</b></div>
          <div><span>가격</span><b>${escH(fmtPrice(P.price,P.currency)||"–")}</b></div><div><span>사진</span><b>${P.images.length}장</b></div>
          <div><span>재고</span><b>${P.stock?escH(Object.entries(P.stock).map(([k,v])=>k+(v==="in"?"✓":v==="out"?"✕":"?")).join(" ")):escH(P.whole||"–")}</b></div>
          <div><span>실측표</span><b>${P.chart?P.chart.cols.length+"사이즈 × "+P.chart.rows.length+"항목":"–"}</b></div>
          <div><span>페이지 크기 · 시간</span><b>${kb(P.htmlLen||0)} · ${ms}ms</b></div></div>
          <div class="dvbtns"><button type="button" id="dvCopyRes">결과 JSON 복사</button></div>`;
        $("dvOut").innerHTML=lastTest;window.__lastDev=P;$("dvCopyRes").onclick=()=>cp(JSON.stringify(window.__lastDev,null,2))}
      catch(e){lastTest=`<p class="sub" style="margin:8px 0 0;color:#ff8a73">실패: ${escH(String(e.message||e))} · ${Date.now()-t0}ms</p>`;$("dvOut").innerHTML=lastTest}};
    $("dvLogCopy").onclick=()=>cp(localStorage.getItem(LOGK)||"[]");
    $("dvLogClear").onclick=()=>{localStorage.removeItem(LOGK);renderDev();toast("기록을 지웠어요")};
    $("dvAlert").onclick=async()=>{toast("확인 중…");await checkAlerts(true);renderDev();toast("확인했어요")};
    $("dvNotif").onclick=()=>{const it=ITEMS.find(x=>x.kind==="wish")||ITEMS[0];if(it)showNotif("테스트 알림",(it.brand?it.brand+" ":"")+it.name,it.id)};
    $("dvClean").onclick=async()=>{await persistAll();await cleanupPhotos();renderDev();toast("정리했어요")};
    $("dvJson").onclick=()=>cp(JSON.stringify(ITEMS.map(x=>({...x,photo:x.photo?"(사진)":"",photos:(x.photos||[]).length,chartImg:x.chartImg?"(사진)":""})),null,2));
    $("dvOb").onclick=()=>{closeDev();setTimeout(()=>{if(typeof openOnboarding==="function")openOnboarding()},200)};
  };
}

/* ---------- 8) Google 로그인 · 드라이브 자동 백업 ---------- */
const GCLIENT=window.ARCHIVE_GOOGLE_CLIENT||"";
const SL=NATIVE?plug("SocialLogin"):null;
const SCOPES=["email","profile","https://www.googleapis.com/auth/drive.appdata"];
const WF=(window.CapacitorWebFetch||window.fetch).bind(window);
const BKNAME="archive-backup.json";
let G={};try{G=JSON.parse(localStorage.getItem("archive-google")||"{}")}catch(e){}
function saveG(){try{localStorage.setItem("archive-google",JSON.stringify(G))}catch(e){}}
let slReady=null;
function slInit(){if(!SL||!GCLIENT)return Promise.reject(new Error("Google 로그인 준비 안 됨"));if(!slReady)slReady=SL.initialize({google:{webClientId:GCLIENT}});return slReady}
const gAvailable=()=>!!(SL&&GCLIENT);
function takeLogin(res){const r=(res&&res.result)||res||{};const at=r.accessToken;const tok=typeof at==="string"?at:(at&&(at.token||at.accessToken));
  if(!tok)throw new Error("드라이브 권한을 받지 못했어요");const p=r.profile||{};
  G={on:true,email:p.email||G.email||"",name:p.name||p.givenName||G.name||"",img:p.imageUrl||G.img||"",token:tok,at:Date.now(),auto:G.auto!==false,last:G.last||"",lastHash:G.lastHash||"",need:false};saveG();return G}
async function gLogin(){await slInit();const res=await SL.login({provider:"google",options:{scopes:SCOPES}});return takeLogin(res)}
async function gToken(interactive){
  if(G.on&&G.token&&Date.now()-(G.at||0)<50*60*1000)return G.token;
  if(!G.on)throw new Error("로그인 필요");
  try{await slInit();if(SL.refresh){const r=await SL.refresh({provider:"google",options:{scopes:SCOPES}});if(r){try{takeLogin(r);return G.token}catch(e){}}}}catch(e){}
  if(!interactive){G.need=true;saveG();throw new Error("다시 연결 필요")}
  await slInit();const res=await SL.login({provider:"google",options:{scopes:SCOPES,filterByAuthorizedAccounts:true,autoSelectEnabled:true}});takeLogin(res);return G.token}
async function drive(path,opt={},interactive){
  const call=async tok=>{const url="https://www.googleapis.com/"+path,headers={...(opt.headers||{}),Authorization:"Bearer "+tok};
    if(Http){const r=await Http.request({url,method:opt.method||"GET",headers,data:opt.data,responseType:opt.raw?"text":"json",connectTimeout:20000,readTimeout:120000});
      return {status:r.status,ok:r.status>=200&&r.status<300,json:async()=>typeof r.data==="string"?(r.data?JSON.parse(r.data):{}):r.data,text:async()=>typeof r.data==="string"?r.data:JSON.stringify(r.data)}}
    const body=opt.data==null?undefined:typeof opt.data==="string"?opt.data:JSON.stringify(opt.data);
    const r=await WF(url,{method:opt.method||"GET",headers,body});return r};
  let r=await call(await gToken(interactive));
  if(r.status===401){G.at=0;saveG();if(interactive){r=await call(await gToken(true))}else{G.need=true;saveG();throw new Error("다시 연결 필요")}}
  if(!r.ok){let msg="";try{msg=(await r.text()).slice(0,140)}catch(e){}throw new Error("드라이브 "+r.status+(msg?" "+msg:""))}
  return r}
async function findBackup(interactive){const r=await drive(`drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${BKNAME}'`)}&fields=files(id,modifiedTime,size)&orderBy=modifiedTime desc`,{},interactive);const j=await r.json();return (j.files||[])[0]||null}
async function uploadBackup(interactive){inBk=true;let json;try{json=await buildBackup()}finally{inBk=false}const h=hashStr(json);if(h===G.lastHash&&!interactive)return "same";
  let f=await findBackup(interactive);
  if(!f){const r=await drive("drive/v3/files?fields=id",{method:"POST",headers:{"Content-Type":"application/json"},data:{name:BKNAME,parents:["appDataFolder"],mimeType:"application/json"}},interactive);f=await r.json();if(!f||!f.id)throw new Error("드라이브에 파일을 만들지 못했어요")}
  await drive(`upload/drive/v3/files/${f.id}?uploadType=media&fields=id,size`,{method:"PATCH",headers:{"Content-Type":"application/json"},data:json},interactive);
  G.last=stamp();G.lastHash=h;G.need=false;saveG();devLog({k:"ok",host:"드라이브 백업",msg:`${ITEMS.length}개 · ${Math.round(json.length/1024)}KB`});return "ok"}
async function restoreFromDrive(f){const r=await drive(`drive/v3/files/${f.id}?alt=media`,{},true);const j=await r.json();if(j.app!=="archive"||!Array.isArray(j.items))throw new Error("백업 파일이 아니에요");
  ITEMS.splice(0,ITEMS.length,...j.items);if(j.prefs){try{const cur=JSON.parse(localStorage.getItem("archive-prefs")||"{}");localStorage.setItem("archive-prefs",JSON.stringify({...j.prefs,onboarded:cur.onboarded||j.prefs.onboarded}))}catch(e){}}
  await persistAll();return j}
let autoT=0;function autoBackupSoon(){if(!G.on||G.auto===false||!gAvailable())return;clearTimeout(autoT);autoT=setTimeout(async()=>{try{await uploadBackup(false);G.err="";saveG()}catch(e){G.err=String(e.message||e).slice(0,120);saveG();devLog({k:"fail",host:"드라이브 백업",msg:G.err})}if(typeof renderAcct==="function"&&$("acctCard"))renderAcct()},20000)}
let inBk=false;const _pa=persistAll;persistAll=async function(){const r=await _pa();if(!inBk)autoBackupSoon();return r};
window.archiveGoogle={login:gLogin,upload:()=>uploadBackup(true),find:()=>findBackup(true)};
async function askRestore(after){try{const f=await findBackup(true);if(!f){after&&after(false);return}
  const when=new Date(f.modifiedTime).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
  if(confirm(`드라이브에 ${when} 백업이 있어요 (${Math.round((+f.size||0)/1024)}KB).\n불러올까요? 지금 폰에 있는 기록은 백업 내용으로 바뀌어요.`)){const j=await restoreFromDrive(f);toast(`불러왔어요 · 옷 ${j.items.length}개`);after&&after(true)}else after&&after(false)}
  catch(e){toast("백업을 확인하지 못했어요 · "+(e.message||e));after&&after(false)}}

/* 설정 › 계정·백업 */
window.renderAcct=function(){const c=$("acctCard");if(!c)return;let last="";try{last=localStorage.getItem("archive-lastbackup")||""}catch(e){}
  const localRows=`<button class="row" type="button" id="bkExport"><span class="lb">백업 파일 만들기<small>${last?"마지막 "+escH(last):"폰 · 카톡 · 드라이브에 직접 보관"} · 사진까지 한 파일로</small></span><span class="val"></span></button>
    <button class="row" type="button" id="bkImport"><span class="lb">백업 파일 불러오기<small>파일로 옮길 때</small></span><span class="val"></span></button>`;
  if(!G.on){c.innerHTML=`<div class="acct0"><b>기록이 사라지지 않게 지켜요</b><p>Google 계정으로 로그인하면 기록과 사진이 내 Google 드라이브의 앱 전용 공간에 자동으로 백업돼요. 폰을 바꾸거나 앱을 다시 깔아도 그대로 돌아와요.</p>
      ${gAvailable()?`<button type="button" class="gbtn" id="gLogin2"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Google로 로그인</button><p class="sm">회원가입 없이 Google 계정 하나로 끝나요</p>`:`<p class="sm">Google 로그인은 앱에서만 돼요</p>`}</div>${localRows}`;
    $("acctNote").textContent=`지금은 이 폰 안에만 있어요 · 옷 ${ITEMS.length}개`}
  else{c.innerHTML=`<div class="row"><span class="lb acctme">${G.img?`<img src="${escH(G.img)}" alt="" style="width:36px;height:36px;border-radius:50%">`:`<i>${escH((G.name||G.email||"G")[0].toUpperCase())}</i>`}<span>${escH(G.email||G.name)}<small class="${G.need?"":"ok"}">${G.need?"● 다시 연결이 필요해요":"● 자동 백업 켜짐"} · 마지막 ${escH(G.last||"아직 없음")}</small></span></span></div>${G.err&&!G.need?`<div class="row"><span class="lb" style="color:#c0392b">백업 실패<small style="color:#c0392b">${escH(G.err)}</small></span></div>`:""}
      ${G.need?`<button class="row" type="button" id="gRe"><span class="lb" style="color:var(--orange);font-weight:700">다시 연결하기<small>로그인이 만료됐어요 · 한 번 눌러주세요</small></span><span class="val"></span></button>`:""}
      <div class="row"><span class="lb">자동 백업<small>기록을 바꾸면 잠시 뒤 드라이브에 올려요</small></span><button class="sw" type="button" role="switch" id="gAuto" aria-checked="${G.auto!==false}" aria-label="자동 백업"></button></div>
      <button class="row" type="button" id="gNow"><span class="lb">지금 백업하기<small>옷 ${ITEMS.length}개 · 사진 ${ITEMS.filter(x=>x.photo).length}장</small></span><span class="val"></span></button>
      <button class="row" type="button" id="gRestore"><span class="lb">드라이브에서 불러오기<small>새 폰이나 다시 깔았을 때</small></span><span class="val"></span></button>
      ${localRows}
      <button class="row" type="button" id="gOut"><span class="lb">로그아웃<small>폰 안 기록은 그대로 남아요</small></span><span class="val"></span></button>`;
    $("acctNote").textContent="백업은 내 Google 드라이브의 앱 전용 공간에 저장돼요. 나만 볼 수 있고 드라이브 목록에는 안 보여요."}
  $("bkExport").onclick=exportBackup;$("bkImport").onclick=importBackup;
  const L=$("gLogin2");if(L)L.onclick=async()=>{L.disabled=true;try{await gLogin();toast("로그인했어요");renderAcct();askRestore(ok=>{if(ok)location.reload();else uploadBackup(true).then(()=>{toast("드라이브에 백업했어요");renderAcct()}).catch(e=>toast("백업 실패 · "+(e.message||e)))})}catch(e){toast("로그인하지 못했어요 · "+(e.message||e))}finally{L.disabled=false}};
  const re=$("gRe");if(re)re.onclick=async()=>{try{await gToken(true);G.need=false;saveG();await uploadBackup(true);toast("다시 연결했어요");renderAcct()}catch(e){toast("연결하지 못했어요")}};
  const au=$("gAuto");if(au)au.onclick=()=>{G.auto=!(G.auto!==false);saveG();renderAcct()};
  const nw=$("gNow");if(nw)nw.onclick=async()=>{nw.disabled=true;toast("백업 중…");try{await uploadBackup(true);G.err="";saveG();toast("드라이브에 백업했어요")}catch(e){G.err=String(e.message||e).slice(0,120);saveG();devLog({k:"fail",host:"드라이브 백업",msg:G.err});toast("백업하지 못했어요 · "+G.err)}finally{nw.disabled=false;renderAcct()}};
  const rs=$("gRestore");if(rs)rs.onclick=()=>askRestore(ok=>{if(ok)setTimeout(()=>location.reload(),800);else toast("불러오지 않았어요")});
  const out=$("gOut");if(out)out.onclick=async()=>{if(!confirm("로그아웃할까요? 폰 안 기록은 그대로 남아요."))return;try{await slInit();await SL.logout({provider:"google"})}catch(e){}G={};saveG();renderAcct();toast("로그아웃했어요")};
};
/* 앱 열 때: 하루 넘게 백업 안 됐으면 조용히 시도 */
if(NATIVE&&G.on)setTimeout(()=>{uploadBackup(false).then(()=>{G.err="";saveG();if($("acctCard"))renderAcct()}).catch(e=>{G.err=String(e.message||e).slice(0,120);saveG();devLog({k:"fail",host:"드라이브 백업",msg:G.err});if($("acctCard"))renderAcct()})},6000);

/* ---------- 9) 스와이프로 카테고리 메뉴 열고 닫기 ---------- */
(function(){const A=$("app")||document.querySelector(".app");if(!A)return;
  const isOpen=()=>A.classList.contains("open");
  const blocked=()=>["detail","settings","rec","statsPanel","brandsPanel","searchPanel","dev","ed"].some(id=>{const e=$(id);return e&&e.classList.contains("on")})||[["ob"],["updModal"],["lock"]].some(([id])=>{const e=$(id);return e&&!e.hidden&&e.offsetParent!==null});
  const inHScroll=el=>{for(let n=el;n&&n!==A;n=n.parentElement){if(n.scrollWidth>n.clientWidth+4){const o=getComputedStyle(n).overflowX;if(o==="auto"||o==="scroll")return true}}return false};
  let x0=0,y0=0,t0=0,track=false;
  A.addEventListener("touchstart",e=>{if(e.touches.length!==1){track=false;return}const t=e.touches[0];x0=t.clientX;y0=t.clientY;t0=Date.now();
    track=!blocked()&&!(isOpen()?false:inHScroll(e.target))&&!(!isOpen()&&x0<24)},{passive:true});
  A.addEventListener("touchend",e=>{if(!track)return;track=false;const t=e.changedTouches[0],dx=t.clientX-x0,dy=t.clientY-y0,dt=Date.now()-t0;
    if(Math.abs(dx)<60||Math.abs(dy)>Math.abs(dx)*0.6||dt>700)return;
    if(dx>0&&!isOpen())setMenu(true);else if(dx<0&&isOpen())setMenu(false)},{passive:true});
})();

/* ---------- 7) 앱 업데이트 확인 ---------- */
const REPO="saw94738617-sys/archive-app";
const BUILD=+(window.ARCHIVE_BUILD||0);
const Opener=NATIVE?plug("FileOpener"):null;
let pendingUpd=null;
async function latestRelease(){
  const url=`https://api.github.com/repos/${REPO}/releases/latest`;
  if(Http){const r=await Http.get({url,headers:{"Accept":"application/vnd.github+json","User-Agent":"archive-app"},responseType:"json"});if(r.status>=400)throw new Error("HTTP "+r.status);return typeof r.data==="string"?JSON.parse(r.data):r.data}
  const r=await fetch(url,{headers:{"Accept":"application/vnd.github+json"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json()}
async function checkUpdate(manual){
  if(!NATIVE&&!manual)return;
  try{const R=await latestRelease();const n=+((R.tag_name||"").match(/(\d+)$/)||[0,0])[1];
    const want=window.ARCHIVE_DEV?/^archive-dev-.*\.apk$/:/^archive-\d.*\.apk$/;
    const asset=(R.assets||[]).find(a=>want.test(a.name));
    if(n>BUILD&&asset){pendingUpd={ver:(R.tag_name||"").replace(/^v/,""),notes:R.body||"",url:asset.browser_download_url,size:asset.size,name:asset.name};showUpdate();return true}
    if(manual)toast(`최신 버전이에요 · v${window.ARCHIVE_VERSION}`);return false}
  catch(e){devLog({k:"fail",host:"업데이트 확인",msg:String(e.message||e)});if(manual)toast("업데이트를 확인하지 못했어요 · 인터넷 연결을 확인해 주세요");return false}}
function showUpdate(){if(!pendingUpd)return;let m=$("updModal");if(!m){m=document.createElement("div");m.id="updModal";m.className="updm";$("app").appendChild(m)}
  const U=pendingUpd,notes=String(U.notes).split("\n").map(x=>x.trim()).filter(x=>x&&!/^-\s*archive/.test(x)&&!/APK를 눌러|덮어 설치하면/.test(x)).slice(0,6);
  m.innerHTML=`<div class="updc" role="dialog" aria-label="업데이트"><img class="updi" src="img/icon.png" alt="">
    <b>새 버전이 있어요</b><p class="updv">v${escH(window.ARCHIVE_VERSION)} → <strong>v${escH(U.ver)}</strong>${U.size?" · "+(U.size/1048576).toFixed(1)+"MB":""}</p>
    ${notes.length?`<ul>${notes.map(x=>`<li>${escH(x.replace(/^[-*]\s*/,""))}</li>`).join("")}</ul>`:""}
    <p class="upds" id="updState">기록은 그대로 남아요</p>
    <button type="button" class="updgo" id="updGo">업데이트</button><button type="button" class="updlater" id="updLater">나중에</button></div>`;
  m.hidden=false;requestAnimationFrame(()=>m.classList.add("on"));
  $("updLater").onclick=()=>{m.classList.remove("on");setTimeout(()=>m.hidden=true,250)};
  $("updGo").onclick=installUpdate}
async function installUpdate(){const U=pendingUpd;if(!U)return;const st=$("updState"),b=$("updGo");b.disabled=true;$("updLater").disabled=true;
  try{st.textContent="받는 중… 잠깐만 기다려 주세요";await persistAll();
    if(!Http||!FS||!Opener){window.open(U.url,"_system");st.textContent="브라우저에서 받은 파일을 눌러 설치해 주세요";return}
    const r=await Http.get({url:U.url,responseType:"blob",headers:{"User-Agent":"archive-app","Accept":"application/octet-stream"},connectTimeout:20000,readTimeout:120000});
    if(r.status>=400)throw new Error("HTTP "+r.status);
    const data=String(r.data||"").replace(/^data:[^,]+,/,"");if(data.length<100000)throw new Error("파일이 너무 작아요");
    const w=await FS.writeFile({path:"update.apk",data,directory:"CACHE"});
    st.textContent="설치 화면을 여는 중…";
    await Opener.openFile({path:w.uri,mimeType:"application/vnd.android.package-archive"});
    st.textContent="설치 화면에서 '업데이트'를 눌러주세요. 처음이면 '이 출처 허용'을 켜야 해요";
  }catch(e){devLog({k:"fail",host:"업데이트 설치",msg:String(e.message||e)});st.textContent="받지 못했어요 · 다시 눌러주세요";b.disabled=false;$("updLater").disabled=false}
  finally{b.disabled=false;$("updLater").disabled=false}}
window.archiveCheckUpdate=checkUpdate;
/* 백그라운드 확인(앱이 꺼져 있어도 새 버전 나오면 폰 알림) */
const BRP=NATIVE?plug("BackgroundRunner"):null;const BRL="com.archive.myclothes.check";
async function bgSetup(){if(!BRP)return;try{await BRP.dispatchEvent({label:BRL,event:"setBuild",details:{build:BUILD,dev:!!window.ARCHIVE_DEV}})}catch(e){devLog({k:"err",msg:"백그라운드 설정: "+(e.message||e)})}}
async function notifPerm(ask){if(!BRP)return "unknown";try{const st=await BRP.checkPermissions();let v=st&&(st.notifications||st.display);if(v!=="granted"&&ask){const r=await BRP.requestPermissions({apis:["notifications"]});v=r&&(r.notifications||r.display)}return v||"unknown"}catch(e){devLog({k:"err",msg:"알림 권한: "+(e.message||e)});return "unknown"}}
window.archiveNotifPerm=notifPerm;
document.addEventListener("click",e=>{if(e.target.closest('#ob [data-ob="notifyOn"]'))notifPerm(true)},true);
if(NATIVE){setTimeout(async()=>{await bgSetup();let asked=false;try{asked=localStorage.getItem("archive-notifask")==="1"}catch(e){}
  if(!asked&&onboarded){try{localStorage.setItem("archive-notifask","1")}catch(e){}notifPerm(true)}},3000)}
function addNotifRow(){const card=$("alTest")&&$("alTest").parentElement;if(!card||$("alPush"))return;const row=document.createElement("button");row.type="button";row.className="row";row.id="alPush";
  row.innerHTML='<span class="lb">폰 알림<small id="alPushSub">새 버전이 나오면 앱을 안 열어도 알려줘요 · 3시간마다 확인</small></span><span class="val" id="alPushVal">…</span>';card.insertBefore(row,$("alTest"));
  const paint=async ask=>{const v=await notifPerm(ask);$("alPushVal").textContent=v==="granted"?"켜짐":NATIVE?"허용하기":"앱에서만";};row.onclick=()=>paint(true);paint(false)}
const _rs3=renderSettings;renderSettings=function(){_rs3();addNotifRow()};addNotifRow();
/* 설정 맨 아래 버전을 누르면 업데이트 확인 */
if(ver){ver.title="눌러서 업데이트 확인";ver.addEventListener("click",()=>checkUpdate(true))}
if(NATIVE&&AppP)AppP.addListener("resume",()=>{const t=+(window.__lastUpdCheck||0);if(Date.now()-t>6*36e5){window.__lastUpdCheck=Date.now();checkUpdate(false)}});

/* 첫 실행: Google로 시작하기(앱) · 로그인 없이 · 백업 불러오기 */
const _obRender=window.obRender;if(typeof _obRender==="function"){window.obRender=function(){_obRender();
  const g=document.querySelector('#ob [data-ob="google"]');
  if(g&&!gAvailable()){const n=g.nextElementSibling;g.remove();if(n&&n.classList.contains("obsm"))n.remove();const l=document.querySelector('#ob [data-ob="local"]');if(l){l.textContent="시작하기";l.className="gbtn"}}
  else if(g){g.setAttribute("data-ob","google-real");g.onclick=async ev=>{ev.stopPropagation();g.disabled=true;try{await gLogin();toast("로그인했어요");askRestore(ok=>{if(ok){onboarded=true;savePrefs();setTimeout(()=>location.reload(),800)}else{obStep=1;obRender();uploadBackup(true).catch(()=>{})}})}catch(e){toast("로그인하지 못했어요 · "+(e.message||e))}finally{g.disabled=false}}}
  const r=document.querySelector('#ob [data-ob="restore"]');if(r){r.textContent=gAvailable()?"예전에 쓰던 기록이 있어요 · 백업 파일 불러오기":r.textContent;r.onclick=ev=>{ev.stopPropagation();importBackup()}}}}
if($("ob")&&!$("ob").hidden&&typeof obRender==="function")obRender();
renderAcct();
/* 시작 */
load().then(()=>{if(typeof renderAcct==="function")renderAcct();if(NATIVE){window.__lastUpdCheck=Date.now();setTimeout(()=>checkUpdate(false),1800);setTimeout(checkAlerts,4000)}});
})();
