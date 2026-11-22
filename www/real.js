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
const UA_PC="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const uaFor=u=>/musinsa\.com|onelink\.me|page\.link|app\.link/i.test(u)?UA_PC:UA;
async function getText(url){
  if(window.__testPages&&url in window.__testPages){const v=window.__testPages[url];if(v===null)throw new Error("404");return v}
  if(Http){const r=await Http.get({url,headers:{"User-Agent":uaFor(url),"Accept":"text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8","Accept-Language":"ko-KR,ko;q=0.9,ja;q=0.7,en;q=0.6"},responseType:"text",connectTimeout:15000,readTimeout:20000});
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
      const noAuto=o.is_auto_soldout==="F"||o.use_soldout==="F";const unknownN=o.stock_number==null||o.stock_number==="";
      const v=!selling?"out":(!useSt||noAuto||unknownN)?"in":(n>0?"in":"out");st[k]=st[k]==="in"?"in":v});
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
  const br=ld.brand||([].concat(ld.hasVariant||[])[0]||{}).brand;P.brand=clean(typeof br==="string"?br:br&&br.name)||meta(doc,"product:brand","og:brand");
  P.shop=meta(doc,"og:site_name");
  const imgs=[];const addI=v=>{if(!v)return;if(Array.isArray(v))return v.forEach(addI);if(typeof v==="object")return addI(v.url||v.contentUrl);const a=absUrl(v,url);if(a&&!imgs.includes(a))imgs.push(a)};
  lds.forEach(x=>addI(x.image));doc.querySelectorAll('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]').forEach(m=>addI(m.content));
  /* 상세 이미지 후보(상품 영역 큰 사진) */
  doc.querySelectorAll(".xans-product-image img, .product-image img, .product__media img, [class*=gallery] img, [class*=Gallery] img, #prdDetail img").forEach(im=>{if(imgs.length<14)addI(im.getAttribute("data-src")||im.getAttribute("src"))});
  P.images=[...new Set(imgs.filter(u=>/^https?:/.test(u)&&!/(logo|icon|sprite|blank|spacer)\b/i.test(u)).map(u=>/cafe24|poxo\.com|\/web\/product\//.test(u)?u.replace(/\/product\/(extra\/)?(small|medium|tiny)\//,"/product/$1big/"):u))];
  let offers=[];lds.forEach(x=>{const o=x.offers;if(o)offers=offers.concat(Array.isArray(o)?o:[o]);if(x.hasVariant)[].concat(x.hasVariant).forEach(v=>{if(v.offers)offers=offers.concat([].concat(v.offers).map(o=>({...o,name:o.name||v.name,size:v.size})))})});
  const o0=offers.find(o=>o.price!=null||o.lowPrice!=null)||{};
  const pr=o0.price!=null?o0.price:o0.lowPrice;P.price=pr!=null?+String(pr).replace(/[^\d.]/g,""):null;P.currency=o0.priceCurrency||"";
  if(P.price==null){const a=meta(doc,"product:price:amount","og:price:amount","product:sale_price:amount");if(a)P.price=+a.replace(/[^\d.]/g,"");P.currency=P.currency||meta(doc,"product:price:currency","og:price:currency")}
  /* 사이즈별 재고 */
  const st={};offers.forEach(o=>{const nm=o.size||o.name||o.sku||"";if(!nm||!o.availability)return;const k=sizeKey(nm);st[k]=st[k]==="in"?"in":availOf(o.availability)});
  if(Object.keys(st).length>1)P.stock=st;
  const c24=cafe24Stock(html);if(c24){if(!(P.stock&&Object.keys(P.stock).length>1))P.stock=c24;P.src.push("카페24 재고")}
  const sh=await shopifyData(url,html);if(sh){P.src.push("Shopify");P.name=P.name||sh.name;P.brand=P.brand||sh.brand;if(P.price==null&&sh.price!=null){P.price=sh.price;P.currency=sh.currency}sh.images.forEach(u=>{if(!P.images.includes(u))P.images.push(u)});if(sh.stock)P.stock=sh.stock}
  if(!P.stock&&offers.length===1&&offers[0].availability)P.whole=availOf(offers[0].availability);
  P.chart=findChart(doc);if(P.chart)P.src.push("실측표");P.htmlLen=html.length;
  if(!P.brand){try{P.brand=guessBrand(doc,html,P,ld)}catch(e){}}
  if(P.brand){const bl=P.brand.toLowerCase();P.name=P.name.replace(new RegExp("^\\s*\\[\\s*"+P.brand.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*\\]\\s*","i"),"");if(P.name.toLowerCase().startsWith(bl+" "))P.name=P.name.slice(P.brand.length+1)}
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
  let v=pickUrl($("fLink").value);
  if(!okUrl(v)){$("fetchStatus").textContent="https:// 로 시작하는 쇼핑몰 링크를 붙여넣어 주세요.";return}
  $("fetchStatus").innerHTML='<span class="spin"></span>상품 페이지 읽는 중…';$("fetchBtn").disabled=true;
  try{
    const raw=$("fLink").value;try{v=await resolveLink(v)}catch(e){}
    let termsNote="";
    if(!noFetch(v)&&NATIVE){const o=originOf(v),st0=shopStore();let t=st0.terms[o];
      if(!t){$("fetchStatus").innerHTML='<span class="spin"></span>처음 보는 쇼핑몰이에요 · 약관 확인 중…';try{t=await checkTerms(o)}catch(e){}}
      if(t&&t.result==="ban"){addSeller(v);const nm=nameFromShare(raw);if(nm&&!$("fName").value){$("fName").value=nm;$("fName").classList.add("flash")}
        $("fetchStatus").innerHTML=`⚠ 이 쇼핑몰은 약관에서 자동 수집을 금지해서 링크${nm?"와 이름":""}만 넣었어요 · 사진은 캡처해서 추가해 주세요 <button type="button" class="altshop" data-why="${escH(o)}">이유 보기</button>`;$("fLink").value="";return}
      termsNote=t&&t.result==="clear"?"약관 확인됨 · ":t&&t.result==="unknown"?"약관 페이지는 못 찾았어요 · ":""}
    if(noFetch(v)){addSeller(v);const s0=recSellers.find(x=>x.url===v);if(s0){s0.shop=noFetchShop(v)||s0.shop;renderSellers()}
      const nm=nameFromShare(raw);if(nm&&!$("fName").value){$("fName").value=nm;$("fName").classList.add("flash")}
      $("fetchStatus").textContent=`${noFetchShop(v)||"이 쇼핑몰"} 약관에서 앱이 자동으로 정보를 가져가는 걸 금지해서, 링크${nm?"와 이름":""}만 넣었어요 · 사진은 캡처해서 직접 추가해 주세요`;
      $("fLink").value="";
      if(nm&&NATIVE){setTimeout(()=>toOfficial(raw,nm),0)}
      else{askOfficial()}
      return}
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
    $("fetchStatus").textContent=(fill.length?"✓ "+termsNote+fill.join(" · ")+" 가져왔어요":"페이지에서 읽을 수 있는 정보가 없었어요 · 직접 적어주세요");
    $("fLink").value="";
  }catch(e){console.warn(e);addSeller(v);$("fetchStatus").textContent="이 쇼핑몰은 페이지를 읽지 못했어요 · 판매처만 추가했어요"+(e&&e.message?" ("+String(e.message).slice(0,40)+")":"");const nm=nameFromUrl(v);if(nm&&!$("fName").value)$("fName").value=nm}
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
  /* 화면 없이 새 출입증 받기 (이미 허락한 계정이면 창이 안 떠요) */
  try{const GA=NATIVE?plug("ArchiveGAuth"):null;if(GA){const r=await GA.silent();if(r&&r.token){G.token=r.token;G.at=Date.now();G.need=false;saveG();return G.token}}}catch(e){}
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
  if(confirm(`드라이브에 ${when} 백업이 있어요 (${Math.round((+f.size||0)/1024)}KB).\n불러올까요? 지금 폰에 있는 기록과 합쳐져요.`)){const j=await restoreFromDrive(f);toast(`불러왔어요 · 옷 ${j.items.length}개`);after&&after(true)}else after&&after(false)}
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
  const nw=$("gNow");if(nw)nw.onclick=async()=>{nw.disabled=true;toast("동기화 중…");try{await uploadBackup(true);G.err="";saveG();toast("동기화했어요")}catch(e){G.err=String(e.message||e).slice(0,120);saveG();devLog({k:"fail",host:"드라이브 백업",msg:G.err});toast("백업하지 못했어요 · "+G.err)}finally{nw.disabled=false;renderAcct()}};
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

/* ---------- 10) 다른 판매처 찾기 (내가 쓰는 몰 안에서 검색) ---------- */
const SHOPK="archive-shops";
const BIG=/(^|\.)(naver\.com|coupang\.com|musinsa\.com|29cm\.co\.kr|wconcept\.co\.kr|kream\.co\.kr|ssfshop\.com|zozo\.jp|amazon\.|rakuten\.co\.jp|google\.)/;
function shopStore(){let v;try{v=JSON.parse(localStorage.getItem(SHOPK)||"null")}catch(e){}v=v||{};v.add=v.add||[];v.off=v.off||[];v.ok=v.ok||[];v.terms=v.terms||{};return v}
function shopSave(v){try{localStorage.setItem(SHOPK,JSON.stringify(v))}catch(e){}}
const originOf=u=>{try{const x=new URL(u);return x.origin}catch(e){return ""}};
/* 후보: 내 옷의 판매처 + 직접 추가한 쇼핑몰 (큰 플랫폼 · 약관 금지 사이트 제외) */
function shopCands(excl){const st=shopStore(),set=new Set();
  ITEMS.forEach(it=>(it.sellers||[]).forEach(sl=>{const o=originOf(sl.url);if(o)set.add(o)}));
  st.add.forEach(o=>set.add(o));
  const ex=new Set((excl||[]).map(originOf));
  return [...set].filter(o=>{if(ex.has(o))return false;let h="";try{h=new URL(o).hostname}catch(e){return false}return !BIG.test(h)&&!(typeof NOFETCH!=="undefined"&&NOFETCH.test(h))})}
/* 실제로 검색하는 곳: 약관 확인 후 허용된 쇼핑몰만 */
function shopOrigins(excl){const st=shopStore();return shopCands(excl).filter(o=>st.ok.includes(o)&&!st.off.includes(o))}
/* 약관 확인: 쇼핑몰 약관 페이지를 한 번 읽고 자동 수집 금지 문구가 있는지 찾아요 */
const BAN_RE=/(크롤러|크롤링|스크래핑|스파이더|로봇\s*\(|로봇|매크로|자동화된\s*(수단|프로그램|방법|도구)|자동화\s*프로그램|데이터\s*마이닝|무단\s*수집|crawl|scrap|spider|robot|data\s*mining|automated\s*(means|access|tool|system))/i;
function termsCands(o){return [o+"/member/agreement.html",o+"/policies/terms-of-service",o+"/pages/terms-of-service",o+"/terms",o+"/agreement",o+"/policy/terms"]}
async function checkTerms(o){const st=shopStore();let res={result:"unknown",url:"",snip:"",at:Date.now()};
  const one=async u=>{const html=await getText(u);const doc=new DOMParser().parseFromString(html,"text/html");doc.querySelectorAll("script,style,noscript").forEach(n=>n.remove());
    const txt=clean(doc.body?doc.body.textContent:"");if(txt.length<400||!/(약관|이용|terms|conditions)/i.test(txt))throw new Error("약관 아님");return {u,txt}};
  /* 약관이 있을 만한 주소를 동시에 열어 보고, 먼저 찾은 것을 써요 (최대 5초) */
  const cands=termsCands(o);
  const hit=await Promise.race([
    Promise.any(cands.map(one)).catch(()=>null),
    new Promise(r=>setTimeout(()=>r(null),5000))]);
  if(hit){const m=hit.txt.match(BAN_RE);if(m){const i=Math.max(0,m.index-40);res={result:"ban",url:hit.u,snip:hit.txt.slice(i,i+120),at:Date.now()}}else res={result:"clear",url:hit.u,snip:"",at:Date.now()}}
  st.terms[o]=res;if(res.result==="ban"){st.ok=st.ok.filter(x=>x!==o)}else if(res.result==="clear"&&!st.off.includes(o)&&!st.ok.includes(o))st.ok.push(o);shopSave(st);
  devLog({k:res.result==="ban"?"fail":"ok",host:new URL(o).hostname,msg:"약관 확인: "+({ban:"자동 수집 금지 문구 있음",clear:"금지 문구 없음",unknown:"약관을 못 찾음"})[res.result]});return res}
async function prepShops(excl,onProg){const st=shopStore();const todo=shopCands(excl).filter(o=>!st.terms[o]);let d=0;
  for(const o of todo){onProg&&onProg(++d,todo.length);await checkTerms(o)}}
const normN=t=>String(t||"").toLowerCase().replace(/[^0-9a-z가-힣]+/g," ").trim();
const toks=t=>normN(t).split(" ").filter(w=>w.length>=2);
function simName(a,b){const A=toks(a),B=new Set(toks(b));if(!A.length)return 0;return A.filter(w=>B.has(w)).length/A.length}
function shortQuery(name,brand){let n=String(name||"").replace(/\(.*?\)|\[.*?\]/g," ");const bt=new Set(toks(brand));const w=toks(n).filter(x=>!bt.has(x));return w.slice(0,3).join(" ")}
async function searchShop(origin,q){const enc=encodeURIComponent(q);
  try{const t=await getText(`${origin}/search/suggest.json?q=${enc}&resources[type]=product&resources[limit]=6`);const j=JSON.parse(t);
    const ps=(((j||{}).resources||{}).results||{}).products||[];if(Array.isArray(ps))return ps.map(p=>({name:p.title,url:absUrl(String(p.url||"").split("?")[0],origin)})).filter(p=>p.url)}catch(e){}
  try{const html=await getText(`${origin}/product/search.html?keyword=${enc}`);const doc=new DOMParser().parseFromString(html,"text/html");const seen=new Set(),out=[];
    doc.querySelectorAll('a[href*="product_no="],a[href*="/product/"]').forEach(a=>{const href=a.getAttribute("href")||"";const m=href.match(/product_no=(\d+)/)||href.match(/\/product\/[^/]+\/(\d+)\//);if(!m||seen.has(m[1]))return;
      const box=a.closest("li")||a.parentElement;let nm=(box&&box.querySelector(".name,.prdName,.item_name,[class*=name]"))?box.querySelector(".name,.prdName,.item_name,[class*=name]").textContent:"";nm=clean(nm.replace(/상품명\s*:/,""))||clean(a.textContent)||((a.querySelector("img")||{}).alt||"");
      if(!nm)return;seen.add(m[1]);out.push({name:nm,url:absUrl(href,origin)})});
    return out.slice(0,10)}catch(e){}
  return []}
async function findOthers(name,brand,exclUrls,onProg){const origins=shopOrigins(exclUrls).slice(0,15);const q=shortQuery(name,brand)||normN(name);const found=[];let done=0;
  const work=async o=>{try{const list=await searchShop(o,q);let best=null;for(const c of list){const sc=simName(name,c.name);if(sc>=0.5&&(!best||sc>best.score))best={...c,score:sc}}
      if(best){let P=null;try{P=await readProduct(best.url)}catch(e){}
        found.push({url:best.url,shop:(P&&P.shop&&P.shop.length<20?P.shop:shopOf(best.url)),name:(P&&P.name)||best.name,price:P?fmtPrice(P.price,P.currency):"",stock:P?P.stock:null,score:best.score})}}
    catch(e){}finally{done++;onProg&&onProg(done,origins.length,found)}};
  const queue=[...origins];await Promise.all([0,1,2].map(async()=>{while(queue.length)await work(queue.shift())}));
  devLog({k:"ok",host:"다른 판매처 찾기",msg:`"${q}" · ${origins.length}곳 검색 · ${found.length}곳 찾음`});
  const st=shopStore(),cs=shopCands(exclUrls);
  return {origins,found:found.sort((a,b)=>b.score-a.score),q,pending:cs.filter(o=>!st.ok.includes(o)&&!st.off.includes(o)&&(!st.terms[o]||st.terms[o].result==="unknown")).length,banned:cs.filter(o=>st.terms[o]&&st.terms[o].result==="ban").length}}
function stockLine(st){return st?Object.entries(st).map(([k,v])=>k+(v==="in"?"✓":v==="out"?"✕":"?")).join(" "):""}
function altHTML(res,addedUrls){const names=res.origins.map(o=>new URL(o).hostname.replace(/^www\./,""));
  return `${res.found.length?res.found.map((f,i)=>`<div class="altr"><div class="altn"><b>${escH(f.shop)}</b><small>${escH(f.name)}</small>${f.stock?`<small class="alts">${escH(stockLine(f.stock))}</small>`:""}</div><span class="altp">${escH(f.price||"")}</span>${addedUrls.includes(f.url)?`<span class="altok">추가됨</span>`:`<button type="button" class="altadd" data-alt="${i}">＋ 추가</button>`}</div>`).join(""):`<p class="altnone">${res.origins.length?"내 몰들에서 같은 상품을 못 찾았어요":"아직 찾아볼 몰이 없어요"}</p>`}
    <p class="altfoot">찾아본 쇼핑몰 ${res.origins.length}곳${names.length?" · "+escH(names.slice(0,4).join(", "))+(names.length>4?" 외":""):""} · 검색어 "${escH(res.q)}"${res.pending?` · <b>약관 확인 필요 ${res.pending}곳</b>`:""}${res.banned?` · 약관상 제외 ${res.banned}곳`:""} <button type="button" class="altshop" data-altshop>쇼핑몰 관리</button></p>`}
function askShop(){const u=prompt("쇼핑몰 주소를 넣어주세요 (예: https://myshop.co.kr)");if(!u)return false;const o=originOf(/^https?:/.test(u)?u:"https://"+u);if(!o){toast("주소를 확인해 주세요");return false}
  const st=shopStore();if(!st.add.includes(o))st.add.push(o);st.off=(st.off||[]).filter(x=>x!==o);shopSave(st);toast("쇼핑몰을 추가했어요 · 약관 확인 뒤 검색에 써요");return true}
window.archiveFindOthers=findOthers;

/* 다른 판매처 찾기: 버튼을 눌렀을 때만, 약관 확인된 내 쇼핑몰에서만 */
function naverShopUrl(q){return "https://search.shopping.naver.com/search/all?query="+encodeURIComponent(q)}
function termsBadge(o){const st=shopStore(),t=st.terms[o];if(t&&t.result==="ban")return '<span class="tb ban">약관상 금지</span>';if(st.off.includes(o))return '<span class="tb off">안 씀</span>';if(st.ok.includes(o))return '<span class="tb ok">검색에 씀</span>';return '<span class="tb q">확인 필요</span>'}
function openShopMgr(after){openEd("쇼핑몰 관리",()=>{const paint=()=>{const st=shopStore(),cs=shopCands([]);
    $("edBody").innerHTML=`<p class="note">다른 판매처 찾기는 <b>약관에서 자동 수집을 금지하지 않은 쇼핑몰</b>에서만 해요. 약관을 읽어서 금지 문구(크롤링 · 로봇 · 매크로 · 자동화된 수단 등)가 있으면 빼요.</p>
      ${cs.length?cs.map(o=>{const t=st.terms[o],h=new URL(o).hostname.replace(/^www\./,"");return `<div class="smr"><div class="smn"><b>${escH(h)}</b> ${termsBadge(o)}${t&&t.snip?`<small>"…${escH(t.snip)}…"</small>`:t&&t.result==="unknown"?`<small>약관 페이지를 찾지 못했어요 · 직접 확인한 뒤 허용해 주세요</small>`:""}</div>
        <div class="smb"><button type="button" data-tv="${o}">약관 보기 ↗</button><button type="button" data-tc="${o}">다시 확인</button>${t&&t.result==="ban"?"":st.ok.includes(o)?`<button type="button" data-toff="${o}">빼기</button>`:`<button type="button" class="p" data-ton="${o}">허용</button>`}</div></div>`}).join(""):'<p class="note">아직 쇼핑몰이 없어요. 링크로 옷을 추가하면 그 쇼핑몰이 여기 생겨요.</p>'}
      <button type="button" class="altgo" data-altshop2>＋ 쇼핑몰 주소로 추가</button>
      <p class="note" style="margin-top:12px">무신사 · 29CM · 쿠팡 · 네이버 같은 큰 곳은 약관상 처음부터 빠져 있어요.</p>`};
    paint();
    $("edBody").onclick=async ev=>{const g=k=>{const b=ev.target.closest(`[${k}]`);return b?b.getAttribute(k):""};let o;
      if((o=g("data-tv"))){const t=shopStore().terms[o];window.open((t&&t.url)||o,"_blank","noopener");return}
      if((o=g("data-tc"))){ev.target.textContent="확인 중…";await checkTerms(o);paint();return}
      if((o=g("data-ton"))){const st=shopStore();st.off=st.off.filter(x=>x!==o);if(!st.ok.includes(o))st.ok.push(o);shopSave(st);paint();return}
      if((o=g("data-toff"))){const st=shopStore();st.ok=st.ok.filter(x=>x!==o);if(!st.off.includes(o))st.off.push(o);shopSave(st);paint();return}
      if(ev.target.closest("[data-altshop2]")){if(askShop()){const st=shopStore();const o2=st.add[st.add.length-1];await checkTerms(o2);paint()}}}},()=>{after&&after()})}
async function runFind(name,brand,urls,out){if(!NATIVE){toast("다른 판매처 찾기는 앱에서 돼요");return null}if(!name){toast("이름이 있어야 찾을 수 있어요");return null}
  out.innerHTML='<p class="altnone"><span class="spin"></span>쇼핑몰 약관 확인 중…</p>';
  await prepShops(urls,(d,t)=>{const p=out.querySelector(".altnone");if(p)p.innerHTML=`<span class="spin"></span>쇼핑몰 약관 확인 중… ${d}/${t}`});
  out.innerHTML='<p class="altnone"><span class="spin"></span>다른 판매처 찾는 중…</p>';
  return await findOthers(name,brand,urls,(d,t)=>{const p=out.querySelector(".altnone");if(p)p.innerHTML=`<span class="spin"></span>다른 판매처 찾는 중… ${d}/${t}`})}
/* 기록 화면 */
let altRes=null;
function ensureAltBox(){if($("altBox"))return;const nv=$("naverBtn");if(!nv)return;const d=document.createElement("div");d.id="altBox";d.className="altbox";
  d.innerHTML='<button type="button" class="altgo" id="altGo">🔎 내 쇼핑몰에서 다른 판매처 찾기</button><div id="altOut"></div>';nv.parentElement.insertBefore(d,nv)}
async function runAltRec(){ensureAltBox();const r=await runFind($("fName").value.trim(),$("fBrand").value.trim(),recSellers.map(x=>x.url),$("altOut"));if(!r)return;altRes=r;$("altOut").innerHTML=altHTML(altRes,recSellers.map(x=>x.url))}
document.addEventListener("click",e=>{
  if(e.target.closest("#altGo")){runAltRec();return}
  const ad=e.target.closest("#altOut [data-alt]");if(ad&&altRes){const f=altRes.found[+ad.dataset.alt];if(f&&addSeller(f.url)){const sl=recSellers.find(x=>x.url===f.url);if(sl){sl.shop=f.shop;sl.price=f.price;if(f.stock){sl.stock=f.stock;sl.checked=stamp()}}renderSellers()}$("altOut").innerHTML=altHTML(altRes,recSellers.map(x=>x.url));return}
  if(e.target.closest("#altOut [data-altshop]")){openShopMgr();return}
});
const _rs4=renderSellers;renderSellers=function(){_rs4();ensureAltBox()};
/* 상세 화면 */
document.addEventListener("click",e=>{const nb=e.target.closest("#dtNaver");if(nb){const it=ITEMS.find(x=>x.id===dtId);if(it)window.open(naverShopUrl([it.brand,it.name].filter(Boolean).join(" ")),"_blank","noopener");return}
  const b=e.target.closest("#dtAlt");if(!b)return;const it=ITEMS.find(x=>x.id===dtId);if(!it)return;if(!NATIVE){toast("다른 판매처 찾기는 앱에서 돼요");return}
  let res=null;
  openEd("다른 판매처 찾기",()=>{$("edBody").innerHTML=`<p class="note">${escH((it.brand?it.brand+" ":"")+it.name)}</p><div id="altOut2"></div>`;
    const paint=()=>{$("altOut2").innerHTML=altHTML(res,(it.sellers||[]).map(x=>x.url))};
    const run=async()=>{res=await runFind(it.name,it.brand,(it.sellers||[]).map(x=>x.url),$("altOut2"));if(res)paint()};
    $("altOut2").onclick=ev=>{const ad=ev.target.closest("[data-alt]");if(ad&&res){const f=res.found[+ad.dataset.alt];it.sellers=it.sellers||[];if(!it.sellers.some(x=>x.url===f.url)){it.sellers.push({url:f.url,shop:f.shop,price:f.price,stock:f.stock||null,checked:f.stock?stamp():""});persistAll();toast(f.shop+" 추가했어요")}paint();return}
      if(ev.target.closest("[data-altshop]")){openShopMgr(()=>{const it2=ITEMS.find(x=>x.id===dtId);if(it2)openDetail(it2.id)})}};
    run()},()=>{reDetail()})},true);
const _od2=openDetail;openDetail=function(id){_od2(id);try{const h=$("dtBody").querySelector(".st-h");if(h&&!$("dtAlt")){const b=document.createElement("button");b.type="button";b.className="st-ref";b.id="dtAlt";b.textContent="＋ 판매처 찾기";h.appendChild(b);const n=document.createElement("button");n.type="button";n.className="st-ref";n.id="dtNaver";n.textContent="네이버 ↗";h.appendChild(n)}}catch(e){}};
window.archiveShopMgr=openShopMgr;window.archiveCheckTerms=checkTerms;
document.addEventListener("click",e=>{if(e.target.closest("[data-why]"))openShopMgr()});

/* ---------- 11) 세부 카테고리 바로 추가 · 위시 순위 기본값 ---------- */
function paintSubAdd(){const sc=$("subcats");if(!sc||sc.hidden||sc.querySelector(".subadd"))return;const b=document.createElement("button");b.type="button";b.className="subadd";b.textContent="＋ 직접 추가";sc.appendChild(b)}
new MutationObserver(paintSubAdd).observe($("subcats"),{childList:true,attributes:true,attributeFilter:["hidden"]});
$("subcats").addEventListener("click",e=>{const b=e.target.closest(".subadd");if(!b)return;e.stopImmediatePropagation();const c=CATS.find(x=>x.id===recCat);if(!c)return;
  const nm=(prompt(`${c.name}에 넣을 세부 카테고리 이름`)||"").trim();if(!nm)return;let sid=c.subs.find(([,n])=>n===nm);
  if(!sid){sid=["u"+Date.now().toString(36),nm];c.subs.push(sid);savePrefs();if(typeof buildTree==="function")buildTree()}
  const sc=$("subcats");sc.innerHTML=c.subs.map(([id,n])=>`<button type="button" data-s="${id}" aria-pressed="false">${escH(n)}</button>`).join("");sc.hidden=false;
  const nb=sc.querySelector(`[data-s="${sid[0]}"]`);if(nb)nb.click();toast(`'${nm}' 추가했어요`)},true);
function rankMode(){const on=document.querySelector(".drawer .mi.on[data-c]");const w=!!on&&(on.dataset.kind==="wish"||on.dataset.c==="wish");const m=$("masonry");if(m)m.classList.toggle("ranked",w)}
["renderPins","showCat","goHome"].forEach(n=>{const f=window[n];if(typeof f==="function")window[n]=function(){const r=f.apply(this,arguments);try{rankMode()}catch(e){}return r}});
document.addEventListener("click",e=>{if(e.target.closest(".drawer .mi, #wishBtn"))setTimeout(rankMode,0)});
const _or=openRec;openRec=function(){const r=_or.apply(this,arguments);if(!editingId)document.querySelectorAll("#fPrio button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.p==="3"));return r};

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
const NTP=NATIVE?plug("ArchiveNotify"):null;
async function bgSetup(){if(!NTP)return;try{await NTP.status()}catch(e){devLog({k:"err",msg:"폰 알림 설정: "+(e.message||e)})}}
async function notifPerm(ask,openSettings){if(!NTP)return "unknown";try{const r=ask?await NTP.ask({openSettings:!!openSettings}):await NTP.status();return (r&&r.notifications)||"unknown"}catch(e){devLog({k:"err",msg:"알림 권한: "+(e.message||e)});return "unknown"}}
window.archiveNotifPerm=notifPerm;
document.addEventListener("click",e=>{if(e.target.closest('#ob [data-ob="notifyOn"]'))notifPerm(true)},true);
if(NATIVE){setTimeout(async()=>{await bgSetup();let asked=false;try{asked=localStorage.getItem("archive-notifask")==="1"}catch(e){}
  if(!asked&&onboarded){try{localStorage.setItem("archive-notifask","1")}catch(e){}notifPerm(true)}},3000)}
function addNotifRow(){const card=$("alTest")&&$("alTest").parentElement;if(!card||$("alPush"))return;
  const mk=(id,lb,sub)=>{const r=document.createElement("button");r.type="button";r.className="row";r.id=id;r.innerHTML=`<span class="lb">${lb}<small id="${id}Sub">${sub}</small></span><span class="val" id="${id}Val"></span>`;card.insertBefore(r,$("alTest"));return r};
  const row=mk("alPush","폰 알림","새 버전이 나오면 폰 알림바로 알려줘요 · 1시간마다 확인");
  if(!NTP){$("alPushVal").textContent="앱에서만";return}
  const rTest=mk("alPushTest","폰 알림 테스트","지금 알림바로 테스트 알림을 보내요");
  const rNow=mk("alPushNow","지금 새 버전 확인","마지막 확인 기록을 불러오는 중…");
  const rBat=mk("alPushBat","배터리 최적화 제외","폰이 알림 확인을 미루지 않게 해요");const rHelp=mk("alPushBatHelp","그래도 앱을 켜야 알림이 오면","갤럭시 절전 예외 앱에 넣는 방법");
  const when=t=>{if(!t)return "아직 확인 기록이 없어요";const d=new Date(t);const p=n=>String(n).padStart(2,"0");return `${d.getMonth()+1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`};
  const paint=async(ask,os)=>{let r;try{r=ask?await NTP.ask({openSettings:!!os}):await NTP.status()}catch(e){r={}}
    const v=r.notifications;$("alPushVal").textContent=v==="granted"?"켜짐":"허용하기";
    $("alPushNowSub").textContent=r.lastAt?`마지막 확인 ${when(r.lastAt)} · ${r.lastMsg||""}`:"아직 확인 기록이 없어요 · 눌러서 확인";
    $("alPushBatVal").textContent=r.battery?"제외됨":"설정하기";$("alPushBatVal").classList.toggle("warn",!r.battery);$("alPushBatSub").innerHTML=r.battery?"앱을 꺼도 알림이 와요":"<b style=\"color:#c8622d\">지금은 앱을 켜야 알림이 와요</b> · 눌러서 허용";return r};
  row.onclick=()=>paint(true,true);
  rTest.onclick=async()=>{let r={};try{r=await NTP.test()}catch(e){}if(r.sent)toast("알림바를 내려서 확인해 보세요");else{toast("알림 권한이 꺼져 있어요 · 허용해 주세요");paint(true,true)}};
  rNow.onclick=async()=>{$("alPushNowSub").textContent="확인하는 중…";try{await NTP.checkNow()}catch(e){}setTimeout(()=>paint(false),5000)};
  rBat.onclick=async()=>{try{await NTP.askBattery()}catch(e){}setTimeout(()=>paint(false),1500)};
  if(AppP)AppP.addListener("resume",()=>paint(false));
  paint(false)}
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
load().then(()=>{window.__archLoaded=true;if(typeof renderAcct==="function")renderAcct();if(NATIVE){window.__lastUpdCheck=Date.now();setTimeout(()=>checkUpdate(false),1800);setTimeout(checkAlerts,4000)}});

/* ---------- 12) 기본 사용 가이드 (시작 화면 다음에 한 번, 설정에서 다시 보기) ---------- */
const GA=(inner)=>`<svg viewBox="0 0 280 150" aria-hidden="true" font-family="Noto Sans KR,sans-serif">${inner}</svg>`;
const GUIDE=[
 {t:"링크 하나로 옷을 기록해요",art:GA(`<rect x="8" y="10" width="264" height="36" rx="10" fill="#1f2a44"/><rect x="18" y="18" width="180" height="20" rx="6" fill="#fff"/><text x="26" y="32" font-size="10" fill="#6b6a63">https://shop.com/products/…</text><rect x="206" y="18" width="56" height="20" rx="6" fill="#f0a35e"/><text x="234" y="32" font-size="10" font-weight="700" fill="#1f2a44" text-anchor="middle">가져오기</text><path d="M140 52v12" stroke="#c8622d" stroke-width="2" stroke-dasharray="3 3"/><rect x="40" y="70" width="70" height="72" rx="10" fill="#4a4f47"/><text x="75" y="111" font-size="10" fill="#e5dfcf" text-anchor="middle">사진</text><rect x="122" y="72" width="120" height="10" rx="4" fill="#1f2a44"/><rect x="122" y="90" width="70" height="8" rx="4" fill="#c8622d"/><rect x="122" y="106" width="118" height="30" rx="6" fill="#f3efe4"/><text x="181" y="125" font-size="9" fill="#6b6a63" text-anchor="middle">사이즈표 · 재고</text>`),
  li:["오른쪽 위 <b>＋</b>를 누르고 쇼핑몰 링크를 붙여넣어요","사진 · 이름 · 가격 · <b>사이즈표 · 재고</b>를 알아서 가져와요 · 무신사 · 29CM는 약관상 링크와 이름만","다른 판매처는 <b>네이버 쇼핑에서 찾아보기</b>로 직접 고르고 링크를 추가해요","산 옷은 <b>아카이브</b>, 갖고 싶은 옷은 <b>위시</b>로 골라서 저장해요"]},
 {t:"위시는 순위로 정리돼요",art:GA(`${[1,3,5].map((n,i)=>`<g transform="translate(${14+i*88} 12)"><rect width="78" height="104" rx="12" fill="${i?"#4a4f47":"#2c302b"}"/><rect x="6" y="6" width="58" height="16" rx="8" fill="#c8622d"/><text x="35" y="18" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">WISH · ${n}순위</text><rect x="4" y="112" width="50" height="8" rx="4" fill="#1f2a44"/></g>`).join("")}<text x="140" y="146" font-size="10" fill="#6b6a63" text-anchor="middle">1순위부터 차례대로 보여요</text>`),
  li:["위시를 기록할 때 <b>1~5순위</b>를 골라요 · 1순위가 제일 갖고 싶은 거예요","위시리스트는 <b>1순위부터</b> 정렬돼서 보여요","순위는 옷을 열고 <b>편집</b>에서 언제든 바꿔요","위시 옷을 사면 <b>샀어요</b>를 눌러 아카이브로 옮겨요"]},
 {t:"메뉴는 밀어서 열고 닫아요",art:GA(`<rect x="0" y="0" width="280" height="150" rx="12" fill="#f3efe4"/><rect x="0" y="0" width="150" height="150" rx="12" fill="#1f2a44"/><text x="16" y="26" font-size="11" font-weight="700" fill="#f0a35e">아카이브</text><text x="26" y="46" font-size="10" fill="#e5dfcf">상의</text><text x="26" y="64" font-size="10" fill="#e5dfcf">하의</text><text x="40" y="80" font-size="9" fill="#aab0bd">데님 · 치노 · 슬랙스</text><text x="16" y="104" font-size="11" font-weight="700" fill="#f0a35e">위시리스트</text><text x="26" y="124" font-size="10" fill="#e5dfcf">신발</text><path d="M180 75h70" stroke="#c8622d" stroke-width="2.5" marker-end="url(#ga)"/><defs><marker id="ga" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#c8622d"/></marker></defs><text x="215" y="66" font-size="10" fill="#1f2a44" text-anchor="middle">밀어서 열기</text>`),
  li:["화면을 <b>오른쪽으로 밀면</b> 메뉴가 열리고, <b>왼쪽으로 밀면</b> 닫혀요 · 왼쪽 위 ☰도 돼요","<b>아카이브</b> · <b>위시리스트</b> 아래에 카테고리가 있어요 · 큰 묶음을 닫으면 안쪽도 같이 닫혀요","기록할 때 큰 카테고리를 누르면 <b>세부</b>(데님 · 치노…)를 고를 수 있어요","원하는 세부가 없으면 <b>＋ 직접 추가</b>로 만들어요"]},
 {t:"사이즈표에 내 사이즈가 칠해져요",art:GA(`<rect x="8" y="8" width="264" height="134" rx="10" fill="#fff" stroke="#ddd5c1"/><rect x="8" y="8" width="264" height="26" rx="10" fill="#efe9da"/>${["","S","M","L"].map((s,i)=>`<text x="${40+i*64}" y="26" font-size="10" font-weight="700" fill="${i===2?"#fff":"#1f2a44"}" text-anchor="middle">${s}</text>`).join("")}<rect x="138" y="8" width="60" height="134" fill="#fdeedd"/><rect x="138" y="8" width="60" height="26" fill="#c8622d"/><text x="168" y="26" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">M</text>${[["총장",68,70,72],["가슴",54,56,58],["어깨",46,48,50],["소매",60,61,62]].map((r,j)=>`<text x="40" y="${56+j*24}" font-size="10" fill="#6b6a63" text-anchor="middle">${r[0]}</text>${r.slice(1).map((v,i)=>`<text x="${104+i*64}" y="${56+j*24}" font-size="10" fill="#1f2a44" text-anchor="middle" font-family="IBM Plex Mono,monospace">${v}</text>`).join("")}`).join("")}`),
  li:["<b>설정 › 내 사이즈</b>를 바꾸면 모든 옷의 표에 같이 반영돼요","옷마다 S · M · L이 달라서 <b>옷 안에서 내 사이즈를 따로</b> 고를 수 있어요","사이즈표의 <b>내 옷 실측과 비교하기</b>로 가진 옷과 몇 cm 차이 나는지 봐요","품절된 옷도 링크만 있으면 사이즈표를 가져와요"]},
 {t:"재입고 · 가격 알림",art:GA(`<rect x="14" y="14" width="252" height="58" rx="16" fill="#fff" stroke="#ddd5c1"/><rect x="26" y="26" width="14" height="14" rx="4" fill="#1f2a44"/><text x="33" y="37" font-size="8" font-weight="700" fill="#f3efe4" text-anchor="middle">A</text><text x="48" y="37" font-size="9" fill="#6b6a63">아카이브 · 지금</text><text x="26" y="58" font-size="12" font-weight="700" fill="#1f2a44">M 재입고 · 데님 팬츠</text><rect x="14" y="82" width="252" height="58" rx="16" fill="#fff" stroke="#ddd5c1"/><rect x="26" y="94" width="14" height="14" rx="4" fill="#1f2a44"/><text x="33" y="105" font-size="8" font-weight="700" fill="#f3efe4" text-anchor="middle">A</text><text x="48" y="105" font-size="9" fill="#6b6a63">아카이브 · 지금</text><text x="26" y="126" font-size="12" font-weight="700" fill="#1f2a44">가격이 내려갔어요 ↓</text>`),
  li:["위시 옷을 열고 <b>재입고 알림</b>을 켜면 내 사이즈 재입고 · 가격 인하를 알려줘요","알림은 <b>직접 켠 옷만</b> 와요","<b>관리 기록</b>에 세탁 · 수선 내역도 남길 수 있어요"]},
 {t:"백업과 업데이트는 알아서",art:GA(`<rect x="20" y="30" width="96" height="90" rx="14" fill="#1f2a44"/><path d="M68 58l-14 24h28z" fill="none" stroke="#f0a35e" stroke-width="3" stroke-linejoin="round"/><text x="68" y="106" font-size="9" fill="#e5dfcf" text-anchor="middle">Google 드라이브</text><path d="M124 75h32" stroke="#c8622d" stroke-width="2.5" stroke-dasharray="4 4"/><rect x="164" y="30" width="96" height="90" rx="14" fill="#fff" stroke="#ddd5c1"/><text x="212" y="62" font-size="10" font-weight="700" fill="#1f2a44" text-anchor="middle">새 버전</text><rect x="180" y="76" width="64" height="22" rx="8" fill="#1f2a44"/><text x="212" y="91" font-size="10" font-weight="700" fill="#f3efe4" text-anchor="middle">업데이트</text>`),
  li:["Google로 로그인하면 기록이 <b>드라이브에 자동 백업</b>돼요 · 폰을 바꿔도 그대로","<b>설정 › 계정 · 백업</b>에서 지금 백업하기 · 파일로 내보내기도 돼요","새 버전이 나오면 <b>폰 알림바</b>로 알려줘요 · 누르고 <b>업데이트</b>만 누르면 끝","이 가이드는 <b>설정 › 사용 가이드</b>에서 다시 볼 수 있어요"]}
];
function guideSeen(){try{return localStorage.getItem("archive-guide")==="1"}catch(e){return true}}
function openGuide(){let g=$("gd");if(!g){g=document.createElement("section");g.id="gd";g.className="gd";g.setAttribute("aria-label","사용 가이드");$("app").appendChild(g)}
  g.innerHTML=`<div class="gdwrap"><div class="gdhead"><span class="k">GUIDE</span><button type="button" class="obskip" data-g="close">닫기</button></div>
    <div class="gdtrack">${GUIDE.map((p,i)=>`<article class="gdp" data-i="${i}"><div class="gdart">${p.art}</div><h2>${p.t}</h2><ul>${p.li.map(x=>`<li>${x}</li>`).join("")}</ul></article>`).join("")}</div>
    <div class="gdbot"><div class="obdots">${GUIDE.map((_,i)=>`<i class="${i?"":"on"}"></i>`).join("")}</div><button type="button" class="obmain" data-g="next">다음</button></div></div>`;
  const tr=g.querySelector(".gdtrack"),nb=g.querySelector('[data-g="next"]');let cur=0;
  const paint=()=>{g.querySelectorAll(".gdbot .obdots i").forEach((d,i)=>d.classList.toggle("on",i===cur));nb.textContent=cur===GUIDE.length-1?"시작하기":"다음"};
  tr.addEventListener("scroll",()=>{const i=Math.round(tr.scrollLeft/Math.max(1,tr.clientWidth));if(i!==cur){cur=i;paint()}},{passive:true});
  const close=()=>{try{localStorage.setItem("archive-guide","1")}catch(e){}g.classList.add("bye");setTimeout(()=>{g.hidden=true;g.classList.remove("bye")},300)};
  g.onclick=e=>{const b=e.target.closest("[data-g]");if(!b)return;if(b.dataset.g==="close")return close();
    if(cur>=GUIDE.length-1)return close();cur++;tr.scrollTo({left:cur*tr.clientWidth,behavior:"smooth"});paint()};
  /* 가이드 안에서 밀기는 페이지 넘김이에요 · 메뉴 열기 제스처로 번지지 않게 */
  ["touchstart","touchmove","touchend"].forEach(t=>g.addEventListener(t,e=>e.stopPropagation(),{passive:true}));
  g.hidden=false;paint()}
window.archiveOpenGuide=openGuide;
$("gdAgain").onclick=()=>{if(typeof setPanel==="function")setPanel(false);setTimeout(openGuide,200)};
const _obf=obFinish;obFinish=function(){const r=_obf.apply(this,arguments);setTimeout(openGuide,380);return r};
if(onboarded&&!guideSeen())setTimeout(()=>{const ob=$("ob");if(!ob||ob.hidden)openGuide()},2600);

/* ---------- 13) 옷 상세에서 바로 카테고리 · 세부 · 갖고 싶은 순위 고르기 ---------- */
function dtPickers(it){const body=$("dtBody");if(!body)return;const dl=body.querySelector(".dsec .dlist");if(!dl)return;
  const rowOf=name=>[...dl.children].find(d=>{const t=d.querySelector("dt");return t&&t.textContent===name});
  const big=CATS.find(x=>x.id===it.c);
  const catHTML=`<dt>카테고리</dt><div class="pk big">${CATS.map(c=>`<button type="button" data-pc="${c.id}" aria-pressed="${c.id===it.c}">${escH(c.name)}</button>`).join("")}</div>
    ${big?`<span class="lbl">세부</span><div class="pk sub">${big.subs.map(([id,n])=>`<button type="button" data-ps="${id}" aria-pressed="${id===it.s}">${escH(n)}</button>`).join("")}<button type="button" class="subadd2" data-ps-add="1">＋ 직접 추가</button></div>`:""}`;
  let cr=rowOf("카테고리");if(!cr){cr=document.createElement("div");dl.insertBefore(cr,dl.firstChild)}
  cr.className="dpick";cr.innerHTML=catHTML;
  let kr=dl.querySelector(".dpick.kind");if(!kr){kr=document.createElement("div");dl.insertBefore(kr,cr)}
  kr.className="dpick kind";kr.innerHTML=`<dt>어디에 둘까요</dt><div class="pk big">${[["arc","아카이브 · 산 옷"],["wish","위시 · 갖고 싶은 옷"]].map(([k,n])=>`<button type="button" data-pk="${k}" aria-pressed="${(it.kind==="wish"?"wish":"arc")===k}">${n}</button>`).join("")}</div>`;
  if(it.kind==="wish"){let pr=rowOf("갖고 싶은 순위");if(!pr){pr=document.createElement("div");cr.after(pr)}const pn=prioNum(it.priority);
    pr.className="dpick";pr.innerHTML=`<dt>갖고 싶은 순위</dt><div class="pk prio">${[1,2,3,4,5].map(n=>`<button type="button" data-pp="${n}" aria-pressed="${n===pn}">${n}</button>`).join("")}</div><small>1순위가 제일 갖고 싶은 거예요 · 위시리스트에서 1순위부터 보여요</small>`}
}
function dtSave(it,msg){const y=($("dtBody")||{}).scrollTop||0;persistAll();if(typeof renderPins==="function")renderPins();if(typeof buildTree==="function")buildTree();
  openDetail(it.id);const b=$("dtBody");if(b)b.scrollTop=y;if(msg)toast(msg)}
$("dtBody").addEventListener("click",e=>{const it=ITEMS.find(x=>x.id===dtId);if(!it)return;
  const c=e.target.closest("[data-pc]"),s=e.target.closest("[data-ps]"),a=e.target.closest("[data-ps-add]"),p=e.target.closest("[data-pp]");
  if(c){if(c.dataset.pc===it.c)return;it.c=c.dataset.pc;it.s="";dtSave(it,"카테고리를 바꿨어요 · 세부도 골라 주세요");return}
  if(s){it.s=s.dataset.ps===it.s?"":s.dataset.ps;dtSave(it,it.s?`'${catLabel(it.c,it.s)}'(으)로 정했어요`:"세부를 뺐어요");return}
  if(a){const big=CATS.find(x=>x.id===it.c);if(!big)return;const nm=(prompt(`${big.name}에 넣을 세부 카테고리 이름`)||"").trim();if(!nm)return;
    let sid=big.subs.find(([,n])=>n===nm);if(!sid){sid=["u"+Date.now().toString(36),nm];big.subs.push(sid);savePrefs()}it.s=sid[0];dtSave(it,`'${nm}' 추가했어요`);return}
  const k=e.target.closest("[data-pk]");
  if(k){const nk=k.dataset.pk;if((it.kind==="wish"?"wish":"arc")===nk)return;it.kind=nk;if(nk==="wish"&&!it.priority)it.priority=3;dtSave(it,nk==="wish"?"위시로 옮겼어요 · 순위를 골라 주세요":"아카이브로 옮겼어요");return}
  if(p){const n=+p.dataset.pp;if(prioNum(it.priority)===n)return;it.priority=n;dtSave(it,`${n}순위로 바꿨어요`);return}
});
const _od=openDetail;openDetail=function(){const r=_od.apply(this,arguments);try{const it=ITEMS.find(x=>x.id===dtId);if(it)dtPickers(it)}catch(e){devLog&&devLog({k:"err",msg:"상세 고르기: "+(e.message||e)})}return r};

/* ---------- 14) 새 버전이 있으면 주황색 표시 (메뉴 · 설정 · 버전) ---------- */
function markUpdate(){const on=!!pendingUpd;const mb=$("menuBtn");
  if(mb){let d=mb.querySelector(".udot");if(on&&!d){d=document.createElement("i");d.className="udot";mb.appendChild(d)}if(!on&&d)d.remove()}
  const os=$("openSet");if(os){let d=os.querySelector(".udot2");if(on&&!d){d=document.createElement("i");d.className="udot2";os.firstChild.after(d)}if(!on&&d)d.remove()}
  const sb=document.querySelector("#settings .sbody");if(sb){let c=$("updCard");
    if(on){if(!c){c=document.createElement("button");c.type="button";c.id="updCard";c.className="updcard";sb.prepend(c);c.onclick=()=>showUpdate()}
      c.innerHTML=`<i class="dot"></i><span><b>새 버전 v${escH(pendingUpd.ver)}이 있어요</b><small>지금 v${escH(window.ARCHIVE_VERSION)} · 눌러서 업데이트</small></span><span class="go">업데이트</span>`}
    else if(c)c.remove()}
  const v=$("verTap");if(v){v.classList.toggle("verold",on);v.innerHTML="ARCHIVE v"+escH(window.ARCHIVE_VERSION||"0.1")+(window.ARCHIVE_DEV?" · DEV":"")+(on?` · 새 버전 v${escH(pendingUpd.ver)} 있어요`:" · 최신")+"<br>EST. 2026"}}
const _cu=checkUpdate;checkUpdate=async function(manual){let quiet=false;if(manual==="quiet"){quiet=true;manual=false}
  if(quiet){const keep=showUpdate;showUpdate=function(){};try{return await _cu(false)}finally{showUpdate=keep;markUpdate()}}
  try{return await _cu(manual)}finally{markUpdate()}};
/* 앱으로 돌아올 때마다(30분 간격) 조용히 다시 확인해서 표시만 새로 고쳐요 */
if(NATIVE&&AppP)AppP.addListener("resume",()=>{const t=+(window.__lastQuiet||0);if(Date.now()-t>30*6e4){window.__lastQuiet=Date.now();checkUpdate("quiet")}});
setTimeout(markUpdate,500);

/* ---------- 15) 앱을 꺼도 알림이 오게: 갤럭시 절전 풀기 안내 ---------- */
async function batteryNudge(force){if(!NTP)return;let r={};try{r=await NTP.status()}catch(e){return}
  if(r.battery&&!force)return;if(!force){try{if(localStorage.getItem("archive-batnudge")==="1")return}catch(e){}}
  if(r.notifications!=="granted"&&!force)return;
  let s=$("batSheet");if(s)s.remove();s=document.createElement("div");s.id="batSheet";s.className="batsheet";
  s.innerHTML=`<div role="dialog" aria-label="알림 설정"><h2>앱을 꺼도 알림이 오게 할게요</h2>
    <p>갤럭시는 배터리를 아끼려고 잘 안 여는 앱을 재워서, 앱을 켤 때만 알림이 와요.</p>
    <ol><li><b>허용하기</b>를 누르고 뜨는 창에서 <b>허용</b>을 눌러요</li><li>그래도 늦게 오면: 폰 설정 › 배터리 › 백그라운드 사용 제한 › <b>절전 예외 앱</b>에 '아카이브' 추가</li></ol>
    <div class="bb"><button type="button" class="s" data-b="later">나중에</button><button type="button" class="p" data-b="ok">${r.battery?"이미 허용됐어요":"허용하기"}</button></div></div>`;
  $("app").appendChild(s);
  s.onclick=async e=>{const b=e.target.closest("[data-b]");if(!b&&e.target!==s)return;try{localStorage.setItem("archive-batnudge","1")}catch(x){}
    if(b&&b.dataset.b==="ok"&&!r.battery){try{await NTP.askBattery()}catch(x){}}s.remove()}}
setTimeout(()=>{const ob=$("ob"),gd=$("gd");if((!ob||ob.hidden)&&(!gd||gd.hidden))batteryNudge(false)},4000);
const _bat=$("alPushBat");if(_bat){}
document.addEventListener("click",e=>{if(e.target.closest("#alPushBatHelp"))batteryNudge(true)});

/* ---------- 16) 링크로 추가한 옷의 브랜드 · 편집샵을 '브랜드 · 편집샵'에 자동으로 넣기 ---------- */
const MARKET=/(^|\.)(coupang|gmarket|11st|auction|amazon|aliexpress|ebay|temu|tmon|wemakeprice|interpark|lotteon|ssg)\./i;
function siteOf(it){const ss=it.sellers||[];const s=ss.find(x=>x.star)||ss[0];if(!s||!/^https?:/.test(s.url||""))return null;
  let u;try{u=new URL(s.url)}catch(e){return null}const host=u.hostname.replace(/^(www|m|shop|store)\./,"");
  const nm=(s.shop&&s.shop.length<30?s.shop:"")||host.split(".")[0];return{host,origin:u.origin+"/",name:nm.trim()}}
function brFind(list,name){const k=brKey(name);return list.find(x=>[x.name,(x.sub||"").split("·")[0],...(x.aka||[])].some(n=>n&&brKey(n)===k))}
function syncBR(it,say){const site=siteOf(it);if(!site)return[];const added=[];const brand=(it.brand||"").trim();
  const latin=s=>brKey(s).replace(/[^a-z0-9]/g,"");
  const official=!!brand&&(latin(brand).length>2&&(site.host.replace(/[^a-z0-9]/g,"").includes(latin(brand))||latin(site.name)===latin(brand))||brKey(site.name)===brKey(brand));
  let b=null;
  if(brand){b=brFind(BR.brands,brand);if(!b){b={id:"b"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),name:brand,sub:"",links:[],shops:[]};BR.brands.push(b);added.push(brand)}
    b.links=b.links||[];b.shops=b.shops||[];
    if(official&&!b.links.some(l=>l.url.replace(/\/$/,"")===site.origin.replace(/\/$/,"")))b.links.unshift({label:"공식몰",url:site.origin})}
  if(!official&&site.name&&!MARKET.test(site.host)){let s=brFind(BR.shops,site.name);
    if(!s){s={id:"s"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),name:site.name,sub:"",links:[{label:"홈페이지",url:site.origin}],brands:[]};BR.shops.push(s);added.push(site.name)}
    s.brands=s.brands||[];if(brand&&!s.brands.some(x=>brKey(x)===brKey(brand)))s.brands.push(brand);
    if(b&&!b.shops.some(x=>brKey(x)===brKey(s.name)))b.shops.push(s.name)}
  return added}
function syncAllBR(say){let added=[];for(const it of ITEMS){if(it.brSeen)continue;try{added=added.concat(syncBR(it))}catch(e){}if(siteOf(it))it.brSeen=1}
  if(added.length){saveBR();if(say)toast(`브랜드 · 편집샵에 ${added.slice(0,2).join(", ")}${added.length>2?` 외 ${added.length-2}곳`:""} 추가했어요`)}
  return added}
{const _rp=renderPins;renderPins=function(){const r=_rp.apply(this,arguments);try{if(syncAllBR(true).length)persistAll()}catch(e){}return r}}
setTimeout(()=>{try{if(syncAllBR(false).length)persistAll()}catch(e){}},1500);

/* ---------- 17) 지문으로 잠금 풀기 ---------- */
const BIO=NATIVE?plug("ArchiveBio"):null;let bioOK=false;
async function bioCheck(){if(!BIO)return false;try{const r=await BIO.available();bioOK=!!(r&&r.ok);return r}catch(e){bioOK=false;return null}}
function bioKey(){const k=document.querySelector('#lkPad [data-k="bio"]');if(k)k.style.visibility=(bioOK&&sec.bio&&lk.mode==="verify")?"visible":"hidden"}
let bioBusy=false;
async function bioUnlock(){if(!BIO||!bioOK||!sec.bio||bioBusy||lk.mode!=="verify"||$("lock").hidden)return;bioBusy=true;
  try{const r=await BIO.verify({title:"아카이브 잠금 해제",subtitle:"지문으로 열어요"});
    if(r&&r.ok){$("lock").hidden=true;const cb=lk.cb;lk.cb=null;cb&&cb()}}catch(e){devLog({k:"err",msg:"지문: "+(e.message||e)})}finally{bioBusy=false}}
{const _ap=askPin;askPin=function(mode){const r=_ap.apply(this,arguments);bioKey();if(mode==="verify")setTimeout(bioUnlock,250);return r}}
$("lkPad").addEventListener("click",e=>{const b=e.target.closest('[data-k="bio"]');if(!b)return;e.stopImmediatePropagation();bioUnlock()},true);
/* 설정 › 보안 › 지문으로 열기 */
function bioRow(){if($("swBio"))return;const al=$("swAppLock");if(!al)return;const row=al.closest(".row");
  const r=document.createElement("div");r.className="row";r.id="bioRow";
  r.innerHTML=`<span class="lb">지문으로 열기<small id="bioSub">잠금을 풀 때 비밀번호 대신 지문</small></span><button class="sw" type="button" role="switch" aria-checked="${!!sec.bio}" id="swBio" aria-label="지문으로 열기"></button>`;
  row.after(r);
  $("swBio").onclick=async e=>{e.stopPropagation();
    if(sec.bio){sec.bio=false;saveSec();$("swBio").setAttribute("aria-checked","false");bioKey();toast("지문 잠금 해제를 껐어요");return}
    if(!BIO){toast("지문은 폰 앱에서만 돼요");return}
    const a=await bioCheck();if(!bioOK){toast(a&&a.enrolled===false?"폰 설정에서 지문을 먼저 등록해 주세요":"이 폰에서는 지문을 쓸 수 없어요");return}
    const go=async()=>{const v=await BIO.verify({title:"지문 등록 확인",subtitle:"지금 지문을 한 번 대 주세요"});
      if(v&&v.ok){sec.bio=true;if(!sec.appLock)sec.appLock=true;saveSec();renderSec();$("swBio").setAttribute("aria-checked","true");toast("이제 지문으로 열 수 있어요")}else toast("지문 확인을 못 했어요")};
    if(!sec.pin){toast("지문이 안 될 때 쓸 비밀번호 4자리를 먼저 정해요");setPinThen(go)}else go()};
  if(!BIO){$("bioSub").textContent="폰 앱에서만 쓸 수 있어요"}}
bioRow();
bioCheck().then(()=>{bioKey();if(!$("lock").hidden&&lk.mode==="verify")bioUnlock()});
/* 앱을 1분 넘게 나갔다 오면 다시 잠그기 */
let _bgAt=0;
if(NATIVE&&AppP){AppP.addListener("pause",()=>{_bgAt=Date.now()});
  AppP.addListener("resume",()=>{if(sec.appLock&&sec.pin&&_bgAt&&Date.now()-_bgAt>60000&&$("lock").hidden)askPin("verify","비밀번호를 입력하세요",null,false);_bgAt=0})}

/* ---------- 18) 여러 폰 동기화 (옷마다 고친 시간 비교해서 합치기) ---------- */
const FP=new Map();let DELS={};try{DELS=JSON.parse(localStorage.getItem("archive-dels")||"{}")||{}}catch(e){}
const saveDels=()=>{try{localStorage.setItem("archive-dels",JSON.stringify(DELS))}catch(e){}};
function fpOf(it){const o=packItem(it);delete o.upd;delete o.brSeen;return JSON.stringify(o)}
function idTime(id){const m=/^i([0-9a-z]{6,})$/.exec(id||"");if(!m)return 1;const t=parseInt(m[1],36);return t>1e12&&t<=Date.now()+864e5?t:1}
function prefsStr(){try{return localStorage.getItem("archive-prefs")||"{}"}catch(e){return "{}"}}
function prefsUpd(){return +(localStorage.getItem("archive-prefs-upd")||0)}
function stampChanges(){const now=Date.now(),seen=new Set();
  for(const it of ITEMS){seen.add(it.id);const f=fpOf(it),old=FP.get(it.id);
    if(old===undefined){if(!it.upd)it.upd=(now-idTime(it.id)<6e4)?now:idTime(it.id)}
    else if(old!==f)it.upd=now;
    FP.set(it.id,f);if(DELS[it.id]&&DELS[it.id]<it.upd){delete DELS[it.id];saveDels()}}
  for(const id of [...FP.keys()])if(!seen.has(id)){FP.delete(id);DELS[id]=now;saveDels()}
  try{const p=prefsStr(),last=localStorage.getItem("archive-prefs-last");
    if(last===null){localStorage.setItem("archive-prefs-last",p);if(!prefsUpd())localStorage.setItem("archive-prefs-upd","1")}
    else if(last!==p){localStorage.setItem("archive-prefs-last",p);localStorage.setItem("archive-prefs-upd",String(now))}}catch(e){}}
{const _pa3=persistAll;persistAll=async function(){try{stampChanges()}catch(e){}return _pa3.apply(this,arguments)}}
/* 드라이브에 올리는 내용 (v2: 고친 시간 · 지운 기록 · 브랜드 포함) */
buildBackup=async function(){await persistAll();let prefs={};try{prefs=JSON.parse(prefsStr())}catch(e){}
  return JSON.stringify({app:"archive",v:2,at:new Date().toISOString(),items:ITEMS,dels:DELS,prefs,prefsUpd:prefsUpd(),brands:(typeof BR!=="undefined"?{brands:BR.brands,shops:BR.shops}:null)})};
function mergeBR(rb){if(!rb||typeof BR==="undefined")return false;let ch=false;
  for(const kind of ["brands","shops"])for(const x of (rb[kind]||[])){const mine=brFind(BR[kind],x.name);
    if(!mine){BR[kind].push(JSON.parse(JSON.stringify(x)));ch=true;continue}
    for(const l of (x.links||[]))if(!(mine.links=mine.links||[]).some(y=>y.url===l.url)){mine.links.push(l);ch=true}
    const tk=kind==="brands"?"shops":"brands";for(const t of (x[tk]||[]))if(!(mine[tk]=mine[tk]||[]).some(y=>brKey(y)===brKey(t))){mine[tk].push(t);ch=true}}
  if(ch){saveBR();if($("brandsPanel")&&$("brandsPanel").classList.contains("on"))renderBR()}return ch}
function mergeRemote(R){const out={added:0,changed:0,removed:0,prefs:false};if(!R||R.app!=="archive"||!Array.isArray(R.items))return out;
  stampChanges();
  for(const [id,t] of Object.entries(R.dels||{}))if(!DELS[id]||DELS[id]<t)DELS[id]=t;
  const loc=new Map(ITEMS.map(x=>[x.id,x]));const fresh=[];
  for(const r of R.items){const ru=+r.upd||0,l=loc.get(r.id);
    if(DELS[r.id]&&DELS[r.id]>=ru)continue;
    if(!l){fresh.push(r);continue}
    if(ru>(+l.upd||0)){Object.keys(l).forEach(k=>delete l[k]);Object.assign(l,r);out.changed++}}
  fresh.sort((a,b)=>(b.upd||0)-(a.upd||0));if(fresh.length){ITEMS.unshift(...fresh);out.added=fresh.length}
  for(let i=ITEMS.length-1;i>=0;i--){const it=ITEMS[i];if(DELS[it.id]&&DELS[it.id]>=(+it.upd||0)){ITEMS.splice(i,1);out.removed++}}
  for(const id of Object.keys(DELS))if(!ITEMS.some(x=>x.id===id)&&!FP.has(id)){}
  saveDels();FP.clear();ITEMS.forEach(it=>FP.set(it.id,fpOf(it)));
  if((+R.prefsUpd||0)>prefsUpd()&&R.prefs){try{const cur=JSON.parse(prefsStr());const np=JSON.stringify({...R.prefs,onboarded:cur.onboarded||R.prefs.onboarded});
    if(np!==prefsStr()){localStorage.setItem("archive-prefs",np);localStorage.setItem("archive-prefs-last",np);localStorage.setItem("archive-prefs-upd",String(R.prefsUpd));out.prefs=true}}catch(e){}}
  mergeBR(R.brands);return out}
let syncing=null;
async function syncNow(interactive){if(syncing)return syncing;syncing=(async()=>{
  let f=await findBackup(interactive);let res={added:0,changed:0,removed:0,prefs:false};
  if(f&&f.modifiedTime!==G.syncMod){const r=await drive(`drive/v3/files/${f.id}?alt=media`,{},interactive);let R=null;try{R=await r.json()}catch(e){}
    if(R){res=mergeRemote(R);if(res.added||res.changed||res.removed){if(typeof renderPins==="function")renderPins();if(typeof updateCounts==="function")updateCounts();if(typeof buildTree==="function")buildTree()}}}
  inBk=true;let json;try{json=await buildBackup()}finally{inBk=false}
  const h=hashStr(json);
  if(h!==G.lastHash||!f){
    if(!f){const r=await drive("drive/v3/files?fields=id",{method:"POST",headers:{"Content-Type":"application/json"},data:{name:BKNAME,parents:["appDataFolder"],mimeType:"application/json"}},interactive);f=await r.json();if(!f||!f.id)throw new Error("드라이브에 파일을 만들지 못했어요")}
    const u=await drive(`upload/drive/v3/files/${f.id}?uploadType=media&fields=id,size,modifiedTime`,{method:"PATCH",headers:{"Content-Type":"application/json"},data:json},interactive);
    let uj={};try{uj=await u.json()}catch(e){}G.syncMod=uj.modifiedTime||"";G.lastHash=h}
  else G.syncMod=f.modifiedTime;
  G.last=stamp();G.need=false;G.err="";saveG();
  devLog({k:"ok",host:"동기화",msg:`옷 ${ITEMS.length}개 · 받음 +${res.added} ~${res.changed} -${res.removed}`});
  if(res.added||res.changed||res.removed)toast(`다른 폰 기록을 합쳤어요 · ${[res.added&&`새 옷 ${res.added}`,res.changed&&`바뀐 옷 ${res.changed}`,res.removed&&`지운 옷 ${res.removed}`].filter(Boolean).join(" · ")}`);
  if(res.prefs)toast("다른 폰에서 바꾼 설정은 앱을 다시 열면 적용돼요");
  if(typeof renderAcct==="function"&&$("acctCard"))renderAcct();return "ok"})();
  try{return await syncing}finally{syncing=null}}
uploadBackup=syncNow;
/* 드라이브에서 불러오기도 '바꾸기' 대신 '합치기'로 (지금 폰 기록이 사라지지 않게) */
restoreFromDrive=async function(f){const r=await drive(`drive/v3/files/${f.id}?alt=media`,{},true);const R=await r.json();if(R.app!=="archive"||!Array.isArray(R.items))throw new Error("백업 파일이 아니에요");
  mergeRemote(R);G.syncMod="";saveG();if(typeof renderPins==="function")renderPins();await persistAll();return {items:ITEMS}};
window.archiveSync=syncNow;
/* 앱을 열 때 · 돌아올 때(2분 간격) 동기화 */
let lastSyncTry=0;function syncSoon(){if(!window.__archLoaded){setTimeout(syncSoon,1000);return}if(!G.on||G.auto===false||!gAvailable())return;if(Date.now()-lastSyncTry<12e4)return;lastSyncTry=Date.now();
  syncNow(false).catch(e=>{G.err=String(e.message||e).slice(0,120);saveG();devLog({k:"fail",host:"동기화",msg:G.err})})}
setTimeout(syncSoon,3500);
if(NATIVE&&AppP)AppP.addListener("resume",()=>setTimeout(syncSoon,800));
/* 계정 카드 글자: 백업 → 동기화 */
{const _ra=window.renderAcct;window.renderAcct=function(){const r=_ra.apply(this,arguments);try{const c=$("acctCard");if(c&&G.on){
  const sw=c.querySelector("#gAuto");if(sw){const lb=sw.closest(".row").querySelector(".lb");lb.innerHTML="자동 동기화<small>기록을 바꾸면 잠시 뒤 드라이브와 맞춰요 · 다른 폰도 같은 계정이면 합쳐져요</small>"}
  const nw=$("gNow");if(nw)nw.querySelector(".lb").innerHTML=`지금 동기화<small>옷 ${ITEMS.length}개 · 마지막 ${escH(G.last||"아직 없음")}</small>`;
  const st=c.querySelector(".acctme small");if(st&&!G.need)st.textContent=`● 동기화 켜짐 · 마지막 ${G.last||"아직 없음"}`;
  const n=$("acctNote");if(n)n.textContent="기록은 내 Google 드라이브의 앱 전용 공간에서 동기화돼요. 안드로이드 · 아이폰 어디서든 같은 Google 계정으로 로그인하면 옷마다 가장 최근에 고친 내용으로 합쳐져요."}}catch(e){}return r}}

/* ---------- 19) 공유 문구 · 짧은 링크 · 무신사 ---------- */
function pickUrl(t){t=String(t||"").trim();const m=t.match(/https?:\/\/[^\s<>"'`)\]]+/i);if(m)return m[0].replace(/[.,!?。]+$/,"");if(/^(www\.|m\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/i.test(t))return "https://"+t;return t}
const SHORT=/(^|\.)(onelink\.me|page\.link|app\.link|naver\.me|bit\.ly|han\.gl|me2\.kr|url\.kr|vo\.la|t\.co|lnk\.to|abr\.ge|link\.musinsa\.com|musinsa\.link|kko\.to)$/i;
function musinsaId(u){const m=String(u).match(/musinsa\.com\/(?:[a-z]{2}\/)?(?:products|app\/goods|goods)\/(\d+)/i);return m?m[1]:""}
function canon(u){const id=musinsaId(u);if(id)return "https://www.musinsa.com/products/"+id;return u}
async function resolveLink(u){u=canon(u);let host="";try{host=new URL(u).hostname}catch(e){return u}
  if(!SHORT.test(host))return u;
  let finalUrl="",body="";
  try{if(window.__testPages&&u in window.__testPages){body=window.__testPages[u]||""}
    else if(Http){const r=await Http.get({url:u,headers:{"User-Agent":UA_PC},responseType:"text",connectTimeout:15000,readTimeout:20000});finalUrl=r.url||"";body=typeof r.data==="string"?r.data:""}
    else{const r=await fetch(u);finalUrl=r.url;body=await r.text()}}catch(e){devLog({k:"fail",host,url:u,msg:"짧은 링크 풀기: "+(e.message||e)})}
  const hay=[finalUrl,body,(()=>{try{return decodeURIComponent(body)}catch(e){return ""}})()].join(" ");
  const id=musinsaId(hay);if(id)return "https://www.musinsa.com/products/"+id;
  const dp=hay.match(/af_web_dp=([^&"'\s]+)/);if(dp){try{return canon(decodeURIComponent(dp[1]))}catch(e){}}
  if(finalUrl&&/^https?:/.test(finalUrl)&&!SHORT.test(new URL(finalUrl).hostname))return canon(finalUrl);
  const og=body.match(/property=["']og:url["'][^>]*content=["']([^"']+)/i);if(og)return canon(og[1]);
  return u}
/* 약관에서 자동 수집을 금지한 사이트: 앱이 페이지에 접속하지 않아요 (링크 · 공유 문구의 이름만 저장) */
const NOFETCH=/(^|\.)(musinsa\.com|29cm\.co\.kr|msscdn\.net)$/i;
const NOFETCH_NAME={"musinsa.com":"무신사","29cm.co.kr":"29CM"};
function noFetch(u){try{return NOFETCH.test(new URL(u).hostname)}catch(e){return false}}
function noFetchShop(u){try{const h=new URL(u).hostname;for(const k in NOFETCH_NAME)if(h===k||h.endsWith("."+k))return NOFETCH_NAME[k]}catch(e){}return ""}
function nameFromShare(t){t=String(t||"");
  const clean=x=>x.replace(/^\s*\[[^\]]{1,15}\]\s*/,"").replace(/\s+/g," ").trim();
  const boiler=/^(무신사|musinsa|29cm|무신사 ?스토어)$|확인해 ?보세요|확인하세요|공유|추천|구경|앱에서|다운로드|자세히 보기|지금 바로/i;
  const ok=x=>x.length>=2&&x.length<=120&&!boiler.test(x)&&/[가-힣A-Za-z]/.test(x);
  const i=t.search(/https?:\/\//i);const pre=clean(i>0?t.slice(0,i):"");if(ok(pre))return pre;
  const parts=t.replace(/https?:\/\/\S+/gi,"\n").split(/\n+/).map(clean).filter(ok);
  return parts.sort((a,b)=>b.length-a.length)[0]||""}
{const _rp2=readProduct;readProduct=async function(url){url=canon(url);const _st=shopStore(),_o=originOf(url);if(_st.terms[_o]&&_st.terms[_o].result==="ban"){const e=new Error("이 쇼핑몰은 약관상 앱이 자동으로 읽을 수 없어요");e.noFetch=true;throw e}if(noFetch(url)){const e=new Error("이 쇼핑몰은 약관상 앱이 자동으로 읽을 수 없어요");e.noFetch=true;throw e}return _rp2(url)};window.archiveReadProduct=readProduct}
window.__pickUrl=pickUrl;window.__resolveLink=resolveLink;

/* ---------- 20) 동기화 v3: 사진은 드라이브에 따로 (목록 파일은 가볍게) ---------- */
const PHOTO_PREFIX="p_";
function buildSync(){let prefs={};try{prefs=JSON.parse(prefsStr())}catch(e){}
  return JSON.stringify({app:"archive",v:3,at:new Date().toISOString(),items:ITEMS.map(packItem),dels:DELS,prefs,prefsUpd:prefsUpd(),brands:(typeof BR!=="undefined"?{brands:BR.brands,shops:BR.shops}:null)})}
async function listPhotos(interactive){const out=new Map();let tok="";
  for(let i=0;i<20;i++){const q=encodeURIComponent(`name contains '${PHOTO_PREFIX}'`);
    const r=await drive(`drive/v3/files?spaces=appDataFolder&q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000${tok?"&pageToken="+encodeURIComponent(tok):""}`,{},interactive);const j=await r.json();
    (j.files||[]).forEach(f=>{const m=/^p_(.+)\.txt$/.exec(f.name||"");if(m)out.set(m[1],f.id)});if(!j.nextPageToken)break;tok=j.nextPageToken}
  return out}
async function putPhotoLocal(key,data){try{const t=tx("photos","readwrite");t.objectStore("photos").put(data,key);await new Promise((ok,no)=>{t.oncomplete=ok;t.onerror=()=>no(t.error)});knownPhotos.add(key);photoKey.set(data,key)}catch(e){}}
function refsIn(it){const r=[];PF.forEach(f=>{if(typeof it[f]==="string")r.push([f,null,it[f]])});(it.photos||[]).forEach((u,i)=>{if(typeof u==="string")r.push(["photos",i,u])});return r}
/* 목록에 사진 번호(idb:키)로만 있는 사진을 채워 넣기: 폰에 있으면 폰에서, 없으면 드라이브에서 */
async function resolvePhotos(remote,interactive){let got=0,miss=0;const cache=new Map();
  for(const it of ITEMS)for(const [f,i,v] of refsIn(it)){if(!v.startsWith("idb:"))continue;const k=v.slice(4);
    let d=cache.get(k);if(d===undefined){d=await getOne("photos",k).catch(()=>null);
      if(!d&&remote&&remote.has(k)){try{const r=await drive(`drive/v3/files/${remote.get(k)}?alt=media`,{raw:true},interactive);d=await r.text();if(d&&d.startsWith("data:")){await putPhotoLocal(k,d);got++}else d=null}catch(e){d=null}}
      cache.set(k,d||null)}
    if(d){photoKey.set(d,k);if(i==null)it[f]=d;else it.photos[i]=d}else miss++}
  return {got,miss}}
async function uploadPhotos(remote,interactive){let up=0;const seen=new Set();
  for(const it of ITEMS)for(const [,,v] of refsIn(it)){if(!v.startsWith("data:"))continue;let k=photoKey.get(v);if(!k){k=hashStr(v);photoKey.set(v,k)}
    if(seen.has(k)||remote.has(k))continue;seen.add(k);
    const r=await drive("drive/v3/files?fields=id",{method:"POST",headers:{"Content-Type":"application/json"},data:{name:PHOTO_PREFIX+k+".txt",parents:["appDataFolder"],mimeType:"text/plain"}},interactive);const f=await r.json();
    if(!f||!f.id)continue;await drive(`upload/drive/v3/files/${f.id}?uploadType=media`,{method:"PATCH",headers:{"Content-Type":"text/plain"},data:v},interactive);remote.set(k,f.id);up++}
  return up}
syncNow=async function(interactive){if(syncing)return syncing;syncing=(async()=>{
  let f=await findBackup(interactive);let res={added:0,changed:0,removed:0,prefs:false};let remote=null;
  if(f&&f.modifiedTime!==G.syncMod){const r=await drive(`drive/v3/files/${f.id}?alt=media`,{},interactive);let R=null;try{R=await r.json()}catch(e){}
    if(R){res=mergeRemote(R);
      if(ITEMS.some(it=>refsIn(it).some(([,,v])=>v.startsWith("idb:")))){remote=await listPhotos(interactive);const pr=await resolvePhotos(remote,interactive);if(pr.got)devLog({k:"ok",host:"동기화",msg:`사진 ${pr.got}장 받음${pr.miss?" · 못 받은 사진 "+pr.miss:""}`})}
      if(res.added||res.changed||res.removed){if(typeof renderPins==="function")renderPins();if(typeof updateCounts==="function")updateCounts();if(typeof buildTree==="function")buildTree()}}}
  inBk=true;try{await persistAll()}finally{inBk=false}
  if(!remote)remote=await listPhotos(interactive);
  const up=await uploadPhotos(remote,interactive);
  const json=buildSync();const h=hashStr(json);
  if(h!==G.lastHash||!f||up){
    if(!f){const r=await drive("drive/v3/files?fields=id",{method:"POST",headers:{"Content-Type":"application/json"},data:{name:BKNAME,parents:["appDataFolder"],mimeType:"application/json"}},interactive);f=await r.json();if(!f||!f.id)throw new Error("드라이브에 파일을 만들지 못했어요")}
    const u=await drive(`upload/drive/v3/files/${f.id}?uploadType=media&fields=id,size,modifiedTime`,{method:"PATCH",headers:{"Content-Type":"application/json"},data:json},interactive);
    let uj={};try{uj=await u.json()}catch(e){}G.syncMod=uj.modifiedTime||"";G.lastHash=h}
  else G.syncMod=f.modifiedTime;
  G.last=stamp();G.need=false;G.err="";saveG();
  devLog({k:"ok",host:"동기화",msg:`옷 ${ITEMS.length}개 · 목록 ${Math.round(json.length/1024)}KB · 사진 올림 ${up} · 받음 +${res.added} ~${res.changed} -${res.removed}`});
  if(res.added||res.changed||res.removed)toast(`다른 폰 기록을 합쳤어요 · ${[res.added&&`새 옷 ${res.added}`,res.changed&&`바뀐 옷 ${res.changed}`,res.removed&&`지운 옷 ${res.removed}`].filter(Boolean).join(" · ")}`);
  if(res.prefs)toast("다른 폰에서 바꾼 설정은 앱을 다시 열면 적용돼요");
  if(typeof renderAcct==="function"&&$("acctCard"))renderAcct();return "ok"})();
  try{return await syncing}finally{syncing=null}};
uploadBackup=syncNow;window.archiveSync=syncNow;
/* 드라이브에서 불러오기도 사진 따로 받기 */
restoreFromDrive=async function(f){const r=await drive(`drive/v3/files/${f.id}?alt=media`,{},true);const R=await r.json();if(R.app!=="archive"||!Array.isArray(R.items))throw new Error("백업 파일이 아니에요");
  mergeRemote(R);if(ITEMS.some(it=>refsIn(it).some(([,,v])=>v.startsWith("idb:")))){const rm=await listPhotos(true);await resolvePhotos(rm,true)}
  G.syncMod="";saveG();if(typeof renderPins==="function")renderPins();await persistAll();return {items:ITEMS}};

/* ---------- 21) 재입고 · 가격 알림 백그라운드 (앱이 꺼져 있어도 6시간마다) ---------- */
function watchList(){const st=shopStore();return ITEMS.filter(x=>x.kind==="wish"&&x.alert&&(x.alert.restock||x.alert.price)).map(it=>{
    const my=(typeof myCols==="function"?myCols(it).names[0]:"")||"";
    const sellers=(it.sellers||[]).filter(s=>{if(!/^https?:/.test(s.url||"")||noFetch(s.url))return false;const t=st.terms[originOf(s.url)];return !(t&&t.result==="ban")})
      .map(s=>({url:s.url,shop:s.shop||"",price:s.price||"",stock:s.stock||null}));
    return {id:it.id,title:(it.brand?it.brand+" ":"")+it.name,my,restock:!!it.alert.restock,price:!!it.alert.price,target:+(it.alert.target||0),sellers}}).filter(w=>w.sellers.length)}
let lastWatch="";
async function pushWatch(){if(!NTP||!NTP.setWatch)return;try{const j=JSON.stringify(watchList());if(j===lastWatch)return;lastWatch=j;const fr=(typeof alertCfg!=="undefined"&&+alertCfg.freq)||3;await NTP.setWatch({json:j,hours:Math.round(24/fr)})}catch(e){devLog({k:"err",msg:"알림 목록 넘기기: "+(e.message||e)})}}
async function pullWatch(){if(!NTP||!NTP.pullAlerts)return;let r;try{r=await NTP.pullAlerts()}catch(e){return}
  let ups=[];try{ups=JSON.parse(r.updates||"[]")}catch(e){}let changed=false;
  for(const u of ups){const it=ITEMS.find(x=>x.id===u.id);if(!it)continue;const s=(it.sellers||[]).find(x=>x.url===u.url);if(!s)continue;
    if(u.stock){s.stock=u.stock;changed=true}if(u.price){s.price=u.price;changed=true}s.checked=stamp()}
  if(changed){persistAll();if(typeof renderPins==="function")renderPins()}
  if(r.open){const it=ITEMS.find(x=>x.id===r.open);if(it)setTimeout(()=>openDetail(it.id),300)}
  if(r.share)setTimeout(()=>fromShare(r.share,r.shareSub||""),350);
  if(r.shareImg)setTimeout(()=>fromShot(r.shareImg),r.share?1500:350);
  if(r.lastAt){try{localStorage.setItem("archive-bgalert",JSON.stringify({at:r.lastAt,msg:r.lastMsg||""}))}catch(e){}}}
{const _pa4=persistAll;persistAll=async function(){const r=await _pa4.apply(this,arguments);pushWatch();return r}}
if(NATIVE){const go=()=>{if(!window.__archLoaded){setTimeout(go,500);return}pullWatch().then(pushWatch)};setTimeout(go,800);
  if(AppP)AppP.addListener("resume",()=>setTimeout(()=>pullWatch(),300))}
document.addEventListener("click",e=>{if(e.target.closest("#alFreq button"))setTimeout(()=>{lastWatch="";pushWatch()},100)});
/* 다른 앱에서 '공유 → 아카이브': 위시로 기록 화면을 열고 공유받은 제목 · 링크로 채워요 (공식몰이 있으면 거기서 가져와요) */
async function fromShare(text,sub){text=String(text||"");sub=String(sub||"").trim();
  const raw=sub&&!text.includes(sub)&&/https?:\/\//i.test(text)&&!nameFromShare(text)?sub+" "+text:text;
  if(!rec.classList.contains("on")){openRec();setKind("wish")}
  const u=pickUrl(raw);
  try{localStorage.setItem("archive-lastshare",JSON.stringify({text,sub,at:Date.now()}))}catch(e){}
  devLog({k:"share",msg:(sub?"제목: "+sub+" / ":"")+text.slice(0,300)});
  if(!okUrl(u)){const nm=raw.replace(/\s+/g," ").trim().slice(0,120);if(nm)$("fName").value=nm;$("fetchStatus").textContent="공유받은 글에 링크가 없어서 이름만 넣었어요";return}
  $("fLink").value=raw;await realFetch();
  if(!nameFromShare(raw)){const st=$("fetchStatus");const p=document.createElement("small");p.className="sharegot";
    p.textContent="공유로 받은 글: "+(sub?sub+" · ":"")+text.replace(/\s+/g," ").slice(0,160);st.appendChild(p)}}
window.archiveShare=fromShare;

/* 캡처 공유: 폰 안에서 글자를 읽어 브랜드 · 이름 · 가격을 채우고 공식몰에서 찾아요 (쇼핑몰 서버에는 접속하지 않아요) */
function shotLines(words,H){const W=(words||[]).map(w=>({t:String(w.t||"").trim(),x:+w.x,y:+w.y,w:+w.w,h:+w.h})).filter(w=>w.t);
  W.forEach(w=>w.cy=w.y+w.h/2);W.sort((a,b)=>a.cy-b.cy);const L=[];
  for(const w of W){const l=L[L.length-1];if(l&&Math.abs(w.cy-l.cy)<Math.min(w.h,l.ws[0].h)*0.55){l.ws.push(w);l.cy=(l.cy*(l.ws.length-1)+w.cy)/l.ws.length}else L.push({cy:w.cy,ws:[w]})}
  return L.map(l=>{l.ws.sort((a,b)=>a.x-b.x);const hs=l.ws.map(w=>w.h).sort((a,b)=>a-b);
    return {t:l.ws.map(w=>w.t).join(" ").replace(/\s+/g," ").trim(),y:Math.min(...l.ws.map(w=>w.y)),b:Math.max(...l.ws.map(w=>w.y+w.h)),h:hs[Math.floor(hs.length/2)],x:l.ws[0].x}}).filter(l=>l.y>H*0.035)}
const SHOT_NOISE=/원|%|후기|쿠폰|적립|구매|장바구니|주차|D-\d|종료|할인|LV\.|스페셜|배송|무료|리뷰|좋아요|^\s*AI\b|\d+\s*\/\s*\d+|^[\d\s.,:]+$/i;
function readShot(words,Wd,H){const L=shotLines(words,H);const out={brand:"",title:"",name:"",price:null,crop:null,lines:L.map(l=>l.t)};
  const pr=L.map(l=>{const m=l.t.replace(/\s/g,"").match(/(\d{1,3}(?:,\d{3})+)원/);return m?{l,v:+m[1].replace(/,/g,"")}:null}).filter(Boolean);
  if(pr.length){pr.sort((a,b)=>b.l.h-a.l.h||a.l.y-b.l.y);out.price=pr[0].v}
  const crumb=L.find(l=>/[>›〉]/.test(l.t)&&/\(([^()]{1,20})\)\s*$/.test(l.t));
  const cand=L.filter(l=>!SHOT_NOISE.test(l.t)&&!/[>›〉]/.test(l.t)&&/[가-힣A-Za-z]{2}/.test(l.t)&&l.t.length>=3&&l.y>H*0.12);
  const sc=l=>l.h*(/\[|\]/.test(l.t)?1.25:1)*(/[A-Z]{3}/.test(l.t)?1.1:1);
  const title=cand.slice().sort((a,b)=>sc(b)-sc(a))[0];
  if(title){out.title=title.t;out.name=title.t.replace(/^\s*\[[^\]]{1,30}\]\s*/,"").trim()||title.t}
  let bl=null;
  if(typeof BR!=="undefined"){for(const l of L){const k=brKey(l.t.replace(/[ⓘ①ⓒ©]|\(i\)/g,""));const r=BR.brands.find(r=>[r.name,...(r.aka||[])].some(n=>n&&brKey(n)===k));if(r){out.brand=r.name;bl=l;break}}}
  if(!out.brand&&crumb)out.brand=crumb.t.match(/\(([^()]{1,20})\)\s*$/)[1].trim();
  if(!out.brand&&out.title){const m=out.title.match(/^\s*\[([^\]]{1,30})\]/);if(m){const parts=m[1].split(/\s*[x×X]\s*/);out.brand=parts[parts.length-1].trim()}}
  if(out.brand&&!bl)bl=L.find(l=>l!==title&&brKey(l.t.replace(/[ⓘ①]|\(i\)/g,"")).startsWith(brKey(out.brand))&&l.t.length<=out.brand.length+12&&(!title||l.y<title.y));
  const titleWords=new Set((out.title||"").toLowerCase().split(/[^a-z0-9_]+/));
  const ens=[];const pushEn=x=>{x=String(x||"").trim();if(x&&/[A-Za-z]{3}/.test(x)&&!ens.some(e=>brKey(e)===brKey(x)))ens.push(x)};
  for(const l of L){const m=l.t.match(/\(([A-Za-z][A-Za-z0-9 ._&'\-]{2,24})\)/);if(m&&bl&&Math.abs(l.y-bl.y)<H*0.03)pushEn(m[1])}
  const ascii=(words||[]).filter(w=>/^[A-Za-z][A-Za-z0-9._\-]{2,24}$/.test(String(w.t||"").trim())).map(w=>({t:String(w.t).trim(),y:+w.y,h:+w.h}))
    .filter(w=>!titleWords.has(w.t.toLowerCase())&&!/^(ai|new|best|sale|black|white|lv|kr|us|eu|jp)$/i.test(w.t));
  ascii.sort((a,b)=>(bl?Math.abs(a.y-bl.y)-Math.abs(b.y-bl.y):0));
  for(const w of ascii.slice(0,4))pushEn(w.t);
  out.ens=ens;
  const bottom=(bl||title)?((bl&&title?Math.min(bl.y,title.y):(bl||title).y)-H*0.012):0;
  const nav=L.filter(l=>l.y<H*0.12);const top=nav.length?Math.max(...nav.map(l=>l.b))+H*0.015:H*0.08;
  if(bottom-top>H*0.2)out.crop={x:0,y:Math.round(top),w:Wd,h:Math.round(bottom-top)};
  return out}
function cropData(url,c){return new Promise(ok=>{const im=new Image();im.onload=()=>{try{const cv=document.createElement("canvas");const k=Math.min(1,1600/c.w);cv.width=Math.round(c.w*k);cv.height=Math.round(c.h*k);
  cv.getContext("2d").drawImage(im,c.x,c.y,c.w,c.h,0,0,cv.width,cv.height);ok(cv.toDataURL("image/jpeg",0.9))}catch(e){ok(url)}};im.onerror=()=>ok(url);im.src=url})}
async function fromShot(dataUrl){if(!rec.classList.contains("on")){openRec();setKind("wish")}
  const st=$("fetchStatus");
  if(!OCR){toast("캡처 글자 읽기는 폰 앱에서 돼요");return}
  st.innerHTML='<span class="spin"></span>캡처에서 글자 읽는 중…';
  let r;try{r=await OCR.read({data:dataUrl})}catch(e){st.textContent="캡처의 글자를 읽지 못했어요 · 직접 적어 주세요";return}
  const im=await new Promise(ok=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ok(null);i.src=dataUrl});
  const S=readShot(r.words,r.w||(im&&im.naturalWidth)||1080,r.h||(im&&im.naturalHeight)||2400);
  devLog({k:"share",msg:"캡처: "+JSON.stringify({brand:S.brand,title:S.title,price:S.price})});
  const got=[];
  if(S.brand&&!$("fBrand").value){$("fBrand").value=S.brand;got.push("브랜드")}
  if(S.title&&!$("fName").value){$("fName").value=S.title;$("fName").classList.add("flash");got.push("이름")}
  if(S.price&&!$("fPrice").value){$("fPrice").value=S.price.toLocaleString("ko-KR");document.querySelectorAll("#cur button").forEach(b=>b.setAttribute("aria-pressed",b.textContent==="₩"));got.push("가격")}
  const shot=S.crop?await cropData(dataUrl,S.crop):dataUrl;
  const head=got.length?"캡처에서 "+got.join(" · ")+" 읽었어요":"캡처에서 상품 이름을 못 찾았어요 · 직접 적어 주세요";
  if(S.brand&&S.name){const kno=(typeof BR!=="undefined")?BR.brands.find(x=>[x.name,...(x.aka||[])].some(n=>n&&brKey(n)===brKey(S.brand))):null;
    const en=/^[A-Za-z0-9 .&'’\-_]+$/.test(S.brand)?S.brand:(kno?[kno.name,...(kno.aka||[])].find(n=>/^[A-Za-z0-9 .&'’\-_]+$/.test(n||""))||"":"");
    try{await toOfficial(S.title,null,{ko:S.brand,en:en||(S.ens||[])[0]||"",ens:S.ens||[],name:S.name})}catch(e){}}
  if(!recCands.length&&!$("photo").classList.contains("has")){recCands=[shot];recSel=[0];applyPick();renderPicker()}
  const after=st.textContent;const okOff=/^공식몰\(/.test(after);
  st.textContent=head+(okOff?" · "+after:S.brand&&S.name?" · 공식몰에서는 못 가져와서 캡처 사진을 넣었어요"+(after&&!/찾는 중|확인 중/.test(after)?" ("+after.replace(/^무신사는 링크와 이름만 넣었어요 · /,"").replace(/ · 사진은 캡처해서 추가해 주세요/,"").replace(/ · 링크와 이름만 저장했어요/,"")+")":""):" · 캡처 사진을 넣었어요")}
window.archiveShot={read:readShot,from:fromShot};
window.archiveWatch={list:watchList,push:pushWatch,pull:pullWatch,now:()=>NTP&&NTP.alertsNow&&NTP.alertsNow()};

/* ---------- 22) 사이즈표 사진 글자 읽기 (폰 안에서) ---------- */
const OCR=NATIVE?plug("ArchiveOcr"):null;
function wordsToRows(words){const W=(words||[]).map(w=>({t:clean(w.t),x:+w.x,y:+w.y,w:+w.w,h:+w.h})).filter(w=>w.t);if(!W.length)return [];
  const hs=W.map(w=>w.h).sort((a,b)=>a-b),mh=hs[Math.floor(hs.length/2)]||10;
  W.forEach(w=>w.cy=w.y+w.h/2);W.sort((a,b)=>a.cy-b.cy);
  const rows=[];for(const w of W){const r=rows[rows.length-1];if(r&&Math.abs(w.cy-r.cy)<mh*0.6){r.ws.push(w);r.cy=(r.cy*(r.ws.length-1)+w.cy)/r.ws.length}else rows.push({cy:w.cy,ws:[w]})}
  return rows.map(r=>{r.ws.sort((a,b)=>a.x-b.x);const cells=[];let cur=null;
    for(const w of r.ws){const isNum=/^[\d.,]+$/.test(w.t);if(cur&&!isNum&&!cur.num&&w.x-(cur.x+cur.w)<mh*0.9){cur.t+=" "+w.t;cur.w=w.x+w.w-cur.x}else{cur={t:w.t,x:w.x,w:w.w,num:isNum};cells.push(cur)}}
    return cells.map(c=>c.t.replace(/^[|:·]+|[|:·]+$/g,"").trim()).filter(Boolean)})}
function chartFromRows(rows){if(rows.length<2)return null;const esc=t=>String(t).replace(/[&<>]/g,"");
  const html="<table>"+rows.map(r=>"<tr>"+r.map(c=>"<td>"+esc(c)+"</td>").join("")+"</tr>").join("")+"</table>";
  try{return findChart(new DOMParser().parseFromString(html,"text/html"))}catch(e){return null}}
async function ocrChart(dataUrl){if(!OCR){toast("사진 글자 읽기는 폰 앱에서 돼요");return}
  const st=$("ocrSt");if(st){st.hidden=false;st.innerHTML='<span class="spin"></span>사진에서 글자 읽는 중…'}
  try{const r=await OCR.read({data:dataUrl});const rows=wordsToRows(r.words);const c=chartFromRows(rows);
    if(c&&c.rows.length){recChart=c;renderChart();const ex=$("sztEx");if(ex)ex.hidden=true;if(st)st.textContent=`✓ 사진에서 표를 읽었어요 · 사이즈 ${c.cols.length}개 · 항목 ${c.rows.length}개 · 틀린 칸은 눌러서 고쳐 주세요`;devLog({k:"ok",host:"사진 글자 읽기",msg:`${c.cols.join("/")} · ${c.rows.map(x=>x[0]).join("/")}`})}
    else{if(st)st.textContent="사진에서 사이즈표 모양을 찾지 못했어요 · 표 부분만 잘라서 다시 해 보거나 직접 적어 주세요";devLog({k:"fail",host:"사진 글자 읽기",msg:(r.text||"").slice(0,120)})}}
  catch(e){if(st)st.textContent="글자를 읽지 못했어요 · "+(e.message||e)}}
function ocrBtn(){const acts=document.querySelector(".szt-acts");if(!acts||$("ocrBtn"))return;
  const b=document.createElement("button");b.type="button";b.id="ocrBtn";b.textContent="📷 사진 글자로 표 채우기";acts.appendChild(b);
  const s=document.createElement("p");s.id="ocrSt";s.className="note";s.hidden=true;s.style.margin="8px 0 0";acts.after(s);
  b.onclick=()=>{if(recChartImg){ocrChart(recChartImg);return}const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
    inp.onchange=async()=>{const f0=inp.files&&inp.files[0];if(!f0)return;let f=f0;try{if(typeof shrink==="function")f=await shrink(f0,2000)}catch(e){}
      const fr=new FileReader();fr.onload=()=>{recChartImg=fr.result;renderChart();ocrChart(recChartImg)};fr.readAsDataURL(f)};inp.click()}}
ocrBtn();
/* 사이즈표 사진을 저장하면, 표가 비어 있을 때 바로 읽어서 채워요 */
$("sztImg").addEventListener("change",()=>setTimeout(()=>{if(recChartImg&&(!recChart||!recChart.rows.some(r=>r.slice(1).some(Boolean))))ocrChart(recChartImg)},700));
window.archiveOcr={wordsToRows,chartFromRows};

/* ---------- 23) 사진 원본 화질로 저장 ---------- */
const hqOn=()=>{try{return localStorage.getItem("archive-hq")==="1"}catch(e){return false}};
{const _sh=shrink;shrink=async function(file,max){if(hqOn())return file;return _sh.apply(this,arguments)}}
function paintHQ(){const s=$("swHQ");if(!s)return;s.setAttribute("aria-checked",hqOn());$("hqSub").textContent=hqOn()?"새로 넣는 사진은 줄이지 않고 원래 화질로 저장해요 · 용량을 더 써요":"끄면 줄여서 저장해요 (용량 절약)"}
$("swHQ").addEventListener("click",e=>{e.stopPropagation();try{localStorage.setItem("archive-hq",hqOn()?"0":"1")}catch(x){}paintHQ();toast(hqOn()?"이제 사진을 원본 화질로 저장해요":"사진을 줄여서 저장해요")});
paintHQ();

/* ---------- 24) 사이즈: 어느 나라 규격으로 적어도 다른 나라 규격이 같이 (일본 포함) ---------- */
const SYS5=["KR","JP","US","UK","EU"];
function sizeKind(c){return c==="shoes"?"shoes":c==="bottom"?"bottom":(c==="top"||c==="outer")?"top":""}
const numOf=s=>{const m=String(s).match(/\d+(?:\.\d+)?/);return m?+m[0]:NaN};
function nearest(arr,v){let bi=-1,bd=1e9;arr.forEach((x,i)=>{const d=Math.abs(numOf(x)-v);if(d<bd){bd=d;bi=i}});return bd<=Math.max(2.6,v*0.012)?bi:-1}
function parseSize(kind,text){const t=String(text||"").trim().toUpperCase().replace(/\s+/g," ");if(!t||!SIZE[kind])return null;const R=SIZE[kind].rows;
  const pre=(t.match(/^(KR|JP|JPN|US|UK|EU|EUR|W)\s*/)||[])[1];const n=numOf(t);
  const pick=(sys,i)=>i>=0?{sys,idx:i}:null;
  if(kind==="shoes"){
    if(/MM/.test(t)||(!pre&&n>=200&&n<=320))return pick("KR",nearest(R.KR,n>320?n/10:n));
    if(/CM/.test(t)||pre==="JP"||pre==="JPN"||(!pre&&n>=21&&n<=32&&/\./.test(t)))return pick("JP",nearest(R.JP,n));
    if(pre==="UK")return pick("UK",nearest(R.UK,n));
    if(pre==="EU"||pre==="EUR"||(!pre&&n>=35&&n<=50))return pick("EU",nearest(R.EU,n));
    if(pre==="US"||(!pre&&n>=4&&n<=15))return pick("US",nearest(R.US,n));
    if(!pre&&n>=21&&n<=32)return pick("JP",nearest(R.JP,n));return null}
  if(kind==="top"){
    const L=t.replace(/^(US|UK|JP|JPN)\s*/,"").match(/^(3XL|XXXL|XXL|2XL|XL|XS|S|M|L)\b/);
    if(L){const v=L[1].replace("XXXL","3XL").replace("2XL","XXL");if(pre==="JP"||pre==="JPN"){const i=R.JP.findIndex(x=>x.startsWith(v+" "));return pick("JP",i)}const i=R.US.indexOf(v==="3XL"?"XXL":v);return pick(pre==="UK"?"UK":"US",i>=0?i:(v==="3XL"?5:-1))}
    if((pre==="JP"||pre==="JPN")&&n>=1&&n<=6)return pick("JP",n-1);
    if(pre==="EU"||pre==="EUR"||(!pre&&n>=42&&n<=56&&n%2===0))return pick("EU",nearest(R.EU,n));
    if(!pre&&n>=85&&n<=120)return pick("KR",nearest(R.KR,n));
    if(!pre&&n>=1&&n<=6&&/^\d$/.test(t))return pick("JP",n-1);return null}
  if(kind==="bottom"){
    if(pre==="EU"||pre==="EUR")return pick("EU",nearest(R.EU,n));
    if((pre==="JP"||pre==="JPN")&&n>=1&&n<=5){const i=R.JP.findIndex(x=>x.startsWith(n+" "));return pick("JP",i)}
    if(/^(XS|S|M|L|XL|XXL)$/.test(t)){const map={XS:0,S:1,M:2,L:4,XL:6,XXL:7};return pick("US",map[t])}
    if(n>=24&&n<=42)return pick("KR",nearest(R.KR,n));
    if(n>=60&&n<=110)return pick("KR",nearest(R.KR,n/2.54));return null}
  return null}
function convLine(kind,p){if(!p||!SIZE[kind])return "";const t=SIZE[kind];return SYS5.filter(s=>t.rows[s]).map(s=>`${CC[s]} ${t.fmt[s](t.rows[s][p.idx])}`).join(" · ")}
function sizeConvText(c,size){const k=sizeKind(c);const p=parseSize(k,size);return p?convLine(k,p):""}
/* 기록 화면: 사이즈 칸 아래에 환산 + 표에서 고르기 */
function sizeHelp(){const f=$("fSize");if(!f)return;let h=$("szConv");if(!h){h=document.createElement("div");h.id="szConv";h.className="szconv";f.closest(".fld").appendChild(h)}
  const k=sizeKind(recCat);if(!k){h.innerHTML="";return}const p=parseSize(k,f.value);
  h.innerHTML=`${p?`<p class="szline">≈ ${escH(convLine(k,p))}</p>`:f.value.trim()?`<p class="szline dim">이 사이즈는 자동 환산을 못 했어요 · 그대로 저장돼요</p>`:""}<button type="button" class="szpick" id="szPick">나라별 표에서 고르기</button>`}
function openSizePick(){const k=sizeKind(recCat);if(!k){toast("카테고리를 먼저 골라 주세요");return}const t=SIZE[k];const cur=parseSize(k,$("fSize").value);
  openEd(t.title+" · 고르기",()=>{$("edBody").innerHTML=`<p class="note" style="margin:14px 2px 0">아무 칸이나 누르면 그 줄로 골라져요. 저장은 누른 나라 규격으로 해요.</p>
    <div class="szmat"><table><tbody>${SYS5.map(s=>`<tr><th><span class="szmain">${CC[s]}</span></th>${t.rows[s].map((v,i)=>`<td><button type="button" data-s="${s}" data-i="${i}" aria-pressed="${!!cur&&cur.idx===i}">${escH(v)}</button></td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">대략적인 환산이에요. 브랜드마다 달라서 실제로 산 사이즈를 고르는 게 정확해요.</p>`;
    $("edBody").querySelector(".szmat").onclick=e=>{const b=e.target.closest("button[data-i]");if(!b)return;$("fSize").value=t.fmt[b.dataset.s](t.rows[b.dataset.s][+b.dataset.i]);sizeHelp();closeEd()}},null)}
document.addEventListener("click",e=>{if(e.target.closest("#szPick"))openSizePick()});
$("fSize").addEventListener("input",sizeHelp);
$("cats").addEventListener("click",()=>setTimeout(sizeHelp,50));
{const _or3=openRec;openRec=function(){const r=_or3.apply(this,arguments);setTimeout(sizeHelp,60);return r}}
/* 상세 화면: 사이즈 옆에 다른 나라 규격 */
{const _od4=openDetail;openDetail=function(){const r=_od4.apply(this,arguments);try{const it=ITEMS.find(x=>x.id===dtId);if(it&&it.size){const line=sizeConvText(it.c,it.size);
  if(line){const dl=$("dtBody").querySelector(".dsec .dlist");const row=dl&&[...dl.children].find(d=>{const t=d.querySelector("dt");return t&&t.textContent==="사이즈"});
    if(row&&!row.querySelector(".szline")){const p=document.createElement("small");p.className="szline";p.textContent="≈ "+line;row.querySelector("dd").appendChild(p)}}}}catch(e){}return r}}
window.archiveSize={parseSize,convLine,sizeConvText};

/* ---------- 25) 브랜드 자동 찾기 (페이지에 브랜드 칸이 없을 때) ---------- */
function guessBrand(doc,html,P,ld){
  const known=(typeof BR!=="undefined"?BR.brands:[]).flatMap(b=>[b.name,...(b.aka||[])]).filter(Boolean).sort((a,b)=>b.length-a.length);
  const hay=[P.name,meta(doc,"og:title"),doc.title].join(" ").toLowerCase();
  for(const k of known)if(k.length>1&&hay.includes(k.toLowerCase()))return k;
  const mf=ld&&(ld.manufacturer||ld.seller);if(mf){const v=clean(typeof mf==="string"?mf:mf.name);if(v)return v}
  const desc=meta(doc,"og:description","description");const m1=desc.match(/브랜드\s*[:：]\s*([^\n,|·]{2,30}?)(?:\s{2,}|\s*제품|\s*상품|$)/);if(m1)return clean(m1[1]);
  for(const th of doc.querySelectorAll("th,dt,td,li span,strong")){const lab=clean(th.textContent);if(/^(브랜드|Brand|BRAND|제조사|제조사\/수입사)\s*[:：]?$/.test(lab)){const nx=th.nextElementSibling;const v=nx&&clean(nx.textContent);if(v&&v.length<=30&&!/정보|상세/.test(v))return v}}
  const body=clean(doc.body?doc.body.textContent:"").slice(0,60000);const m2=body.match(/(?:브랜드|Brand|BRAND|제조사)\s*[:：]?\s*([A-Za-z가-힣0-9&.'’ \-]{2,30}?)(?=\s{2,}|\s(?:원산지|제조|모델|상품|가격|소재|사이즈)|$)/);if(m2&&!/정보|소개|스토리|더보기/.test(m2[1]))return clean(m2[1]);
  const bx=doc.querySelector('[class*="brand"] a,[class*="Brand"] a,.brand,.brandName,.brand_name,.prd_brand,[itemprop="brand"]');if(bx){const v=clean(bx.textContent);if(v&&v.length<=30)return v}
  const t=meta(doc,"og:title")||doc.title;const m3=t.match(/^\s*\[([^\]]{2,25})\]/)||t.match(/^([^()\[\]|]{2,25})\(([A-Za-z0-9 .&'\-]{2,30})\)\s/);if(m3)return clean(m3[1]);
  return ""}

/* ---------- 26) 무신사 · 29CM 링크 → 브랜드 공식몰에서 대신 가져오기 ---------- */
function splitBrand(nm){nm=String(nm||"").replace(/\s*-\s*사이즈\s*&\s*후기.*$/,"").replace(/\s*\|\s*(무신사|29CM).*$/i,"").trim();
  let m=nm.match(/^([^()\[\]]{1,25}?)\s*\(([A-Za-z0-9 .&'’\-]{2,30})\)\s+(.+)$/);if(m)return {ko:clean(m[1]),en:clean(m[2]),name:clean(m[3])};
  m=nm.match(/^\[([^\]]{1,25})\]\s*(.+)$/);if(m)return {ko:clean(m[1]),en:/^[A-Za-z0-9 .&'’\-]+$/.test(m[1])?clean(m[1]):"",name:clean(m[2])};
  const known=(typeof BR!=="undefined"?BR.brands:[]).flatMap(b=>[b.name,...(b.aka||[])]).filter(Boolean).sort((a,b)=>b.length-a.length);
  for(const k of known)if(nm.toLowerCase().startsWith(k.toLowerCase()+" "))return {ko:k,en:/^[A-Za-z0-9 .&'’\-]+$/.test(k)?k:"",name:clean(nm.slice(k.length))};
  return {ko:"",en:"",name:nm}}
function officialFromBR(b){if(typeof BR==="undefined")return "";const keys=[b.ko,b.en].filter(Boolean);const x=BR.brands.find(r=>[r.name,...(r.aka||[])].some(n=>n&&keys.some(k=>brKey(k)===brKey(n))));
  if(!x)return "";const l=(x.links||[]).find(l=>/공식/.test(l.label||""))||(x.links||[])[0];return l?originOf(l.url):""}
async function guessOfficial(b){if(!b.en)return "";const slug=b.en.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]/g,"");if(slug.length<3)return "";
  const cands=[`https://${slug}.co.kr`,`https://www.${slug}.co.kr`,`https://${slug}.com`,`https://www.${slug}.com`,`https://${slug}.kr`,`https://${slug}official.com`];
  const want=[b.en,b.ko].filter(Boolean).map(x=>x.toLowerCase().replace(/\s+/g,""));
  const one=async u=>{const html=await getText(u+"/");const d=new DOMParser().parseFromString(html,"text/html");const t=(meta(d,"og:site_name","og:title")+" "+(d.title||"")).toLowerCase().replace(/\s+/g,"");
    if(want.some(w=>t.includes(w)))return u;throw new Error("다른 사이트")};
  return await Promise.race([Promise.any(cands.map(one)).catch(()=>""),new Promise(r=>setTimeout(()=>r(""),6000))])}
/* 공식몰을 못 찾았을 때: 화면 안에서 주소를 받아요 (한 번 넣으면 그 브랜드는 다음부터 기억) */
function askOfficialUrl(b){const st=$("fetchStatus");const nm=b.ko||b.en;
  return new Promise(done=>{
    st.innerHTML=`<b>${escH(nm)}</b> 공식몰 주소를 자동으로 못 찾았어요. 주소를 한 번만 넣어 주면 다음부터는 이 브랜드는 바로 찾아요.
      <div class="offask"><input id="offUrl" type="url" inputmode="url" placeholder="예: monoess.com" aria-label="공식몰 주소"><button type="button" id="offUrlGo">찾기</button></div>
      <button type="button" class="altshop" id="offWeb">🌐 웹에서 '${escH(nm)} 공식몰' 검색하기</button> · <button type="button" class="altshop" id="offSkip">건너뛰기</button>`;
    const fin=v=>{document.removeEventListener("click",h,true);done(v)};
    const h=e=>{const t=e.target;
      if(t.closest("#offWeb")){window.open("https://www.google.com/search?q="+encodeURIComponent(nm+" 공식몰"),"_blank","noopener");return}
      if(t.closest("#offSkip")){fin("");return}
      if(t.closest("#offUrlGo")){const u=($("offUrl").value||"").trim();if(!u){$("offUrl").focus();return}const o=originOf(/^https?:/.test(u)?u:"https://"+u);if(!o){toast("주소를 다시 확인해 주세요");return}fin(o)}};
    document.addEventListener("click",h,true);setTimeout(()=>{const i=$("offUrl");if(i)i.focus()},150)})}
function rememberOfficial(b,o){if(typeof BR==="undefined"||!o)return;const nm=b.ko||b.en;let x=brFind(BR.brands,nm)||(b.en&&brFind(BR.brands,b.en));
  if(!x){x={id:"b"+Date.now().toString(36),name:nm,sub:"",links:[],shops:[],aka:[]};BR.brands.push(x)}x.aka=x.aka||[];if(b.en&&brKey(b.en)!==brKey(x.name)&&!x.aka.some(a=>brKey(a)===brKey(b.en)))x.aka.push(b.en);
  x.links=x.links||[];if(!x.links.some(l=>originOf(l.url)===o))x.links.unshift({label:"공식몰",url:o+"/"});saveBR()}
async function toOfficial(raw,nm,preset){const st=$("fetchStatus");const b=preset||splitBrand(nm);
  if(b.ko&&!$("fBrand").value)$("fBrand").value=b.ko;
  if(b.name&&b.name!==nm&&$("fName").value===nm)$("fName").value=b.name;
  if(!b.ko&&!b.en)return;
  st.innerHTML=`<span class="spin"></span>${escH(b.ko||b.en)} 공식몰 찾는 중…`;
  let o=officialFromBR(b);if(!o)o=await guessOfficial(b);
  for(const en of (b.ens||[])){if(o)break;if(!en||brKey(en)===brKey(b.en||""))continue;o=officialFromBR({en})||await guessOfficial({en,ko:b.ko})}
  if(!o)o=await askOfficialUrl(b);
  if(!o||noFetch(o)){st.textContent=`무신사는 링크와 이름만 넣었어요 · ${b.ko||b.en} 공식몰을 못 찾았어요 · 사진은 캡처해서 추가해 주세요`;return}
  rememberOfficial(b,o);
  st.innerHTML=`<span class="spin"></span>${escH(b.ko||b.en)} 공식몰 약관 확인 중…`;let t=shopStore().terms[o];if(!t){try{t=await checkTerms(o)}catch(e){}}
  if(t&&t.result==="ban"){st.textContent=`${b.ko||b.en} 공식몰은 약관에서 자동 수집을 금지해서 가져오지 않았어요 · 링크와 이름만 저장했어요`;return}
  st.innerHTML=`<span class="spin"></span>${escH(b.ko||b.en)} 공식몰에서 같은 상품 찾는 중…`;
  const qs=[shortQuery(b.name,b.ko)||normN(b.name),...(raw.match(/[A-Za-z][A-Za-z0-9 \-]{6,}/g)||[]).map(x=>x.trim())].filter(Boolean);let best=null;
  for(const q of qs){let list=[];try{list=await searchShop(o,q)}catch(e){}for(const c of list){const sc=Math.max(simName(b.name,c.name),simName(q,c.name));if(sc>=0.45&&(!best||sc>best.score))best={...c,score:sc}}if(best)break}
  if(!best){st.textContent=`${b.ko||b.en} 공식몰에서 같은 상품을 못 찾았어요 · 무신사 링크와 이름만 저장했어요`;return}
  $("fLink").value=best.url;await realFetch();
  const cur=$("fetchStatus").textContent;$("fetchStatus").textContent=`공식몰(${new URL(o).hostname.replace(/^www\./,"")})에서 가져왔어요 · `+cur.replace(/^✓\s*/,"")}
window.archiveOfficial={splitBrand,guessOfficial,toOfficial};

/* 무신사 링크만 붙여넣었을 때: 브랜드 · 이름을 적으면 공식몰에서 찾기 */
function askOfficial(){const st=$("fetchStatus");
  st.innerHTML=`무신사 링크만으로는 상품 이름을 알 수 없어요 (약관상 무신사 페이지를 열 수 없어요).<br><b>브랜드와 이름</b>을 적고 아래 버튼을 누르면 브랜드 공식몰에서 찾아 줘요. 브랜드는 영어로 적으면 더 잘 찾아요.<br>💡 상품 화면을 <b>캡처해서 공유 → 아카이브</b>로 보내면 브랜드 · 이름 · 가격을 자동으로 읽어요.<br><button type="button" class="altgo" id="offGo" style="margin-top:8px">🔎 공식몰에서 찾기</button>`;
  setTimeout(()=>{if(!$("fBrand").value)$("fBrand").focus();else if(!$("fName").value)$("fName").focus()},100)}
document.addEventListener("click",e=>{if(!e.target.closest("#offGo"))return;const br=$("fBrand").value.trim(),nm=$("fName").value.trim();
  if(!br||!nm){toast("브랜드와 이름을 먼저 적어 주세요");(!br?$("fBrand"):$("fName")).focus();return}
  if(!NATIVE){toast("공식몰 찾기는 폰 앱에서 돼요");return}
  const en=/^[A-Za-z0-9 .&'’\-]+$/.test(br)?br:"";const kno=(typeof BR!=="undefined")?BR.brands.find(r=>[r.name,...(r.aka||[])].some(n=>n&&brKey(n)===brKey(br))):null;
  const alias=kno?[kno.name,...(kno.aka||[])].find(n=>/^[A-Za-z0-9 .&'’\-]+$/.test(n||"")):"";
  toOfficial(nm,`${br}${(en||alias)&&(en||alias)!==br?"("+(en||alias)+")":(en?"":"")} ${nm}`,{ko:br,en:en||alias||"",name:nm})});
})();
