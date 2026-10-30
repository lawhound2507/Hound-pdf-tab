// 하운드 PDF(탭): 갤럭시 탭에서 인터넷 없이 기록 보기와 S펜 표시(2026-10-30 팀장님 "테블릿에서 쓰고싶은데" … "하운드PDF가 좋다잖어").
// pdf.js 3.11.174로 보기, pdf-lib로 저장(PDF 표준 Ink 주석 + 모양 그림을 함께 넣어 PC 하운드 PDF, 다른 PDF 프로그램에서도 같게 보임).
// 사건 PDF는 이 탭 안에서만(바깥으로 보내지 않음, 기록 남기지 않음). 최근 파일은 이 탭 브라우저 저장소(IndexedDB)에만, [목록 비우기]로 지움.
"use strict";
const APP_VER = 11;  // 화면에 보이는 판 번호(sw.js VERSION houndpdf-tab-N과 같이 올림). 처음 화면과 [보기] 창 아래에 '판 N'
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
const $ = s => document.querySelector(s);
const S = { pdf: null, bytes: null, name: "", handle: null, scale: 1, fit: true, pages: [], strokes: {}, undo: [],
  tool: "", color: { pen: "#1F2D52", hl: "#FFE14D", ul: "#E53935" }, dirty: false, cur: 1, key: "" };
const COLORS = { pen: ["#1F2D52", "#E53935", "#1E88E5", "#22252E"], hl: ["#FFE14D", "#9BE38B", "#FFB3C7", "#9FD3FF"], ul: ["#E53935", "#1E88E5", "#22252E"] };
const STYLE = { pen: { w: 1.6, op: 1, subj: "하운드 펜" }, hl: { w: 12, op: 0.35, subj: "하운드 형광펜" }, ul: { w: 1.8, op: 1, subj: "하운드 밑줄" } };

function toast(t, ms = 2500) { const e = $("#toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove("show"), ms); }

// ---------------- 최근 파일(이 탭 안 IndexedDB만) ----------------
function idb() {
  return new Promise((ok, no) => { const r = indexedDB.open("houndpdf-tab", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "key" }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
}
async function dbDo(mode, fn) { const db = await idb(); return new Promise((ok, no) => { const tx = db.transaction("files", mode); const st = tx.objectStore("files"); const r = fn(st); tx.oncomplete = () => ok(r && r.result); tx.onerror = () => no(tx.error); }); }
async function recentList() { try { return ((await dbDo("readonly", st => st.getAll())) || []).sort((a, b) => b.at - a.at); } catch (e) { return []; } }
async function recentPut(rec) {
  try { await dbDo("readwrite", st => st.put(rec));
    const all = await recentList(); for (const x of all.slice(8)) await dbDo("readwrite", st => st.delete(x.key)); } catch (e) { /* 저장소를 못 쓰면 최근 목록만 없음 */ }
}
async function recentPage(key, page) { try { const all = await recentList(); const r = all.find(x => x.key === key); if (r) { r.page = page; await dbDo("readwrite", st => st.put(r)); } } catch (e) { /* 무시 */ } }
async function drawRecent() {
  const ul = $("#recent"), all = await recentList();
  ul.innerHTML = all.length ? "" : '<li style="color:#7A808C;padding:12px 4px">아직 없습니다</li>';
  for (const r of all) {
    const li = document.createElement("li"), b = document.createElement("button");
    const d = new Date(r.at); b.innerHTML = `<span class="n"></span><span class="w">${d.getMonth() + 1}. ${d.getDate()}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</span>`;
    b.querySelector(".n").textContent = r.name; b.title = r.name;
    b.onclick = () => openBytes(r.bytes, r.name, null, r.page || 1);
    li.appendChild(b); ul.appendChild(li);
  }
}

// ---------------- 열기 ----------------
async function pickFile() {
  if (window.showOpenFilePicker) {  // 덮어쓰기가 되는 브라우저(PC 크롬 등)
    try { const [h] = await showOpenFilePicker({ types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
      const f = await h.getFile(); return openBytes(await f.arrayBuffer(), f.name, h); } catch (e) { if (e.name === "AbortError") return; }
  }
  $("#file").value = ""; $("#file").click();
}
$("#file").onchange = async e => { const f = e.target.files[0]; if (f) openBytes(await f.arrayBuffer(), f.name, null); };

async function openBytes(buf, name, handle, page = 1) {
  if (S.dirty && !confirm("표시한 것을 저장하지 않았습니다. 그래도 다른 파일을 열까요?")) return;
  let pdf;
  try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise; }
  catch (e) { toast("이 PDF를 열 수 없습니다(망가졌거나 암호가 걸린 파일)", 4000); return; }
  if (S.pdf) S.pdf.destroy();
  Object.assign(S, { pdf, bytes: buf.slice(0), name, handle, strokes: {}, undo: [], dirty: false, key: name + "|" + buf.byteLength, cur: page, fit: true });
  $("#title").textContent = name; document.title = name + " - 하운드 PDF";
  $("#home").hidden = true;
  await layout();
  scrollToPage(page, false);
  buildOutline(); buildThumbs(); S.evReady = buildEvIndex(); closePeek(); S.back = []; drawBack();
  recentPut({ key: S.key, name, bytes: buf.slice(0), at: Date.now(), page });
}

// ---------------- 두 쪽 보기 (2026-10-30 팀장님 "왜 두쪽보기가 안되지") ----------------
// [한 쪽][두 쪽](PC 하운드 PDF '쪽 보기'와 같은 이름). 고른 적이 없으면 가로 화면 = 두 쪽, 세로 = 한 쪽. 고르면 이 탭에 기억.
// '첫 쪽 따로'(표지): 두 쪽 보기에서 1쪽만 한 줄, 그다음 2-3, 4-5 … (기본 켬, 기억).
// 쪽마다 따로 그리고 펜 좌표도 그 쪽 상자로 계산하므로(toPdf) 두 쪽 보기에서도 표시와 저장 좌표가 그대로.
function pref(k, d) { try { const v = localStorage.getItem("hpt." + k); return v === null ? d : v === "1"; } catch (e) { return d; } }
function setPref(k, v) { try { localStorage.setItem("hpt." + k, v ? "1" : "0"); } catch (e) { /* 저장소를 못 쓰면 이번만 */ } }
function landscape() { return innerWidth > innerHeight; }
function wantTwo() { return pref("two", null) === null ? landscape() : pref("two", false); }
S.two = wantTwo(); S.cover = pref("cover", true);
// 넘기기 [쪽 넘김][스크롤](PC 하운드 PDF와 같은 이름, 기본 쪽 넘김, 고르면 기억): 쪽 넘김은 지금 줄만 화면에 맞춰 보여 줌
S.paged = pref("paged", true);
function groups(n) {  // 한 줄에 들어갈 쪽 번호들
  const out = [];
  if (!S.two) { for (let i = 1; i <= n; i++) out.push([i]); return out; }
  let i = 1;
  if (S.cover) { out.push([1]); i = 2; }
  for (; i <= n; i += 2) out.push(i + 1 <= n ? [i, i + 1] : [i]);
  return out;
}
function arrange() {  // 쪽 상자들을 줄(.spread)에 다시 담음(그린 것, 펜 표시는 그대로)
  const box = $("#pages"); box.innerHTML = "";
  for (const g of groups(S.pages.length)) {
    const row = document.createElement("div"); row.className = "spread";
    for (const n of g) row.appendChild(S.pages[n - 1].el);
    box.appendChild(row);
  }
  drawViewBtns();
  showSpread();
}
function showSpread() {  // 쪽 넘김: 지금 쪽이 든 줄만 보임 / 스크롤: 모두
  const rows = [...document.querySelectorAll("#pages .spread")], i = S.paged ? spreadOf(S.cur) : -1;
  rows.forEach((r, k) => { r.style.display = !S.paged || k === i ? "" : "none"; });
  document.body.classList.toggle("paged", S.paged);
  markZoom();
}
function zoomed() { return !!S.pages.length && S.scale > fitScale() * 1.02; }
function markZoom() { document.body.classList.toggle("zoomed", S.paged && zoomed()); }
function setPaged(on) {
  setPref("paged", on);
  if (S.paged === on) return drawViewBtns();
  S.paged = on;
  if (!S.pages.length) return drawViewBtns();
  const cur = S.cur; drawViewBtns(); showSpread();
  if (S.fit) setScale(fitScale(), true); else observe();
  scrollToPage(cur, false);
}
function fitScale() {  // 높이 맞춤(PC 하운드 PDF와 같게, 2026-10-30 팀장님 "켜면 높이맞추기로 안되있어서 너무 작고"): 한 줄(한 쪽, 두 쪽)이 화면 높이에, 폭도 넘지 않게
  const view = $("#view"), size = S.pages.map(p => p.page.getViewport({ scale: 1 }));
  // 가장 많은 쪽 크기 기준(가로 사진 한 장 때문에 모든 쪽이 작아지지 않게). 그 크기 쪽 한 줄(두 쪽이면 둘)이 화면 높이에, 폭도 넘지 않게
  const cnt = {}; let w0 = 0, h0 = 0, best = 0;
  for (const v of size) { const k = Math.round(v.width) + "x" + Math.round(v.height); cnt[k] = (cnt[k] || 0) + 1; if (cnt[k] > best) { best = cnt[k]; w0 = v.width; h0 = v.height; } }
  const k = S.two && size.length > 1 ? 2 : 1;
  const s = Math.min((view.clientWidth - 36 - 10 * (k - 1)) / (k * w0), (view.clientHeight - 20) / h0);
  return Math.max(0.3, s);
}
function setTwo(on, user = true) {
  if (user) setPref("two", on);
  if (S.two === on) return drawViewBtns();
  S.two = on;
  if (!S.pages.length) return drawViewBtns();
  const cur = S.cur; arrange();
  if (S.fit) setScale(fitScale(), true); else observe();
  scrollToPage(cur, false);
}
function setCover(on) {
  setPref("cover", on); S.cover = on;
  if (!S.pages.length) return drawViewBtns();
  const cur = S.cur; arrange(); observe(); scrollToPage(cur, false);
}
const ICON = {  // 가는 선 그림(글자 대신, 자리를 적게)
  one: '<svg viewBox="0 0 24 24"><rect x="7" y="4" width="10" height="16" rx="1"/></svg>',
  two: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="8.5" height="14" rx="1"/><rect x="13" y="5" width="8.5" height="14" rx="1"/></svg>',
  paged: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="11" height="16" rx="1"/><path d="M18 9l3 3-3 3"/></svg>',
  scroll: '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="11" height="9" rx="1"/><rect x="5" y="13" width="11" height="9" rx="1"/><path d="M19.5 8v8M17.5 14l2 2 2-2"/></svg>'
};
function drawViewBtns() {
  const two = $("#bTwoT"), pg = $("#bPagedT");
  if (two) { two.innerHTML = S.two ? ICON.two : ICON.one; two.title = two.dataset.tip = S.two ? "지금 두 쪽 보기 (누르면 한 쪽)" : "지금 한 쪽 보기 (누르면 두 쪽)"; }
  if (pg) { pg.innerHTML = S.paged ? ICON.paged : ICON.scroll; pg.title = pg.dataset.tip = S.paged ? "지금 쪽 넘김 (누르면 스크롤)" : "지금 스크롤 (누르면 쪽 넘김)"; }
  $("#bPaged").classList.toggle("on", S.paged); $("#bScroll").classList.toggle("on", !S.paged);
  $("#bOne").classList.toggle("on", !S.two); $("#bTwo").classList.toggle("on", S.two);
  $("#bCover").hidden = !S.two; $("#bCover").classList.toggle("on", S.cover);
}
$("#bOne").onclick = () => setTwo(false);
$("#bTwo").onclick = () => setTwo(true);
$("#bCover").onclick = () => setCover(!S.cover);
$("#bPaged").onclick = () => setPaged(true);
$("#bScroll").onclick = () => setPaged(false);
// 쪽 넘김에서 손가락으로 옆으로 밀거나 화면 왼쪽, 오른쪽 끝(15%)을 누르면 앞, 다음(확대했을 때는 밀기 = 화면 이동, 넘기지 않음)
// 실제 갤럭시 탭(안드로이드 크롬)에서 터치 이벤트만으로는 반응이 없어(2026-10-30 팀장님 "쪽넘기기로 하면 아예 반응이 없어")
// 포인터 이벤트로 받고, 쪽 넘김(확대 안 함)에서는 CSS touch-action: none으로 브라우저가 손동작을 가져가지 않게 함. 끊기면(pointercancel) 마지막 자리로 판단
let swipe = null, nTouch = 0;
$("#view").addEventListener("pointerdown", e => {
  if (e.pointerType !== "touch") return;
  nTouch = e.isPrimary ? 1 : nTouch + 1;
  swipe = S.paged && nTouch === 1 ? { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: Date.now(), id: e.pointerId } : null;
});
$("#view").addEventListener("pointermove", e => { if (swipe && e.pointerId === swipe.id) { swipe.lx = e.clientX; swipe.ly = e.clientY; } });
const swipeEnd = (e, cancel) => {
  if (e.pointerType !== "touch") return;
  nTouch = Math.max(0, nTouch - 1);
  if (!swipe || e.pointerId !== swipe.id || pinch) { if (!nTouch) swipe = null; return; }
  const s = swipe; swipe = null;
  const x = cancel ? s.lx : e.clientX, y = cancel ? s.ly : e.clientY, dx = x - s.x, dy = y - s.y;
  if (zoomed()) return;
  if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { stepSpread(dx < 0 ? 1 : -1); return; }
  if (!cancel && Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - s.t < 450) edgeTap(x);
};
$("#view").addEventListener("pointerup", e => swipeEnd(e, false));
$("#view").addEventListener("pointercancel", e => swipeEnd(e, true));
$("#view").addEventListener("click", e => { if (S.paged && !S.tool && e.pointerType === "mouse") edgeTap(e.clientX); });
function edgeTap(x) {
  const r = $("#view").getBoundingClientRect(), f = (x - r.left) / r.width;
  if (f < 0.15) stepSpread(-1); else if (f > 0.85) stepSpread(1);
}
function spreadOf(n) { return groups(S.pages.length).findIndex(g => g.includes(n)); }
function stepSpread(d) {  // 두 쪽 보기면 두 쪽씩 넘김
  const gs = groups(S.pages.length), i = spreadOf(S.cur), j = Math.min(Math.max(0, i + d), gs.length - 1);
  scrollToPage(gs[j][0]);
}

// ---------------- 쪽 배치, 그리기 ----------------
async function layout() {
  S.pages = [];
  const first = await S.pdf.getPage(1);
  for (let i = 1; i <= S.pdf.numPages; i++) {
    const p = i === 1 ? first : await S.pdf.getPage(i);
    const el = document.createElement("div"); el.className = "page"; el.dataset.n = i;
    const cv = document.createElement("canvas"), ink = document.createElement("canvas"); ink.className = "ink";
    el.append(cv, ink);
    const pg = { n: i, page: p, vp: null, el, cv, ink, done: 0 };
    S.pages.push(pg); hookInk(pg);
  }
  arrange();
  if (S.fit) S.scale = fitScale();
  S.pages.forEach(pg => { pg.vp = pg.page.getViewport({ scale: S.scale }); pg.el.style.width = pg.vp.width + "px"; pg.el.style.height = pg.vp.height + "px"; });
  $("#pgN").textContent = S.pdf.numPages;
  observe();
}
let io = null;
function observe() {
  if (io) io.disconnect();
  io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) renderPage(S.pages[+e.target.dataset.n - 1]); }), { root: $("#view"), rootMargin: "800px 0px" });
  S.pages.forEach(p => io.observe(p.el));
}
// 한 캔버스에 그리기가 겹치면 pdf.js가 반쯤 그린 상태에서 캔버스를 다시 잡아 쪽이 뒤집혀 보임(2026-10-30 탭 세로 화면 '갑 제2호증'이 거꾸로).
// 새로 그리기 전에 그리던 것을 멈추고 끝나기를 기다림. 그사이 더 새 요청이 오면 이번 것은 그리지 않음(false)
async function paint(h, page, cv, vp, sized) {
  const my = h.paintSeq = (h.paintSeq || 0) + 1;
  if (h.paintTask) { h.paintTask.cancel(); try { await h.paintTask.promise; } catch (e) { /* 멈춤 */ } }
  if (h.paintSeq !== my) return false;
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  if (sized) sized();
  const t = h.paintTask = page.render({ canvasContext: cv.getContext("2d"), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE });
  try { await t.promise; return h.paintSeq === my; } catch (e) { return false; } finally { if (h.paintTask === t) h.paintTask = null; }
}
async function renderPage(pg) {
  if (pg.done === S.scale) return; pg.done = S.scale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), vp = pg.page.getViewport({ scale: S.scale * dpr });
  const ok = await paint(pg, pg.page, pg.cv, vp, () => { pg.ink.width = pg.cv.width; pg.ink.height = pg.cv.height; pg.dpr = dpr; });
  if (!ok) return;  // 더 새 그리기가 이어받음
  drawInk(pg);
  if (!pg.hotsDrawn) { pg.hotsDrawn = true; drawHots(pg); }  // 증거번호 밑줄(쪽 비율이라 확대해도 그대로)
}
function setScale(s, keepFit = false) {
  const view = $("#view"), cur = S.cur, rel = (view.scrollTop - (S.pages[cur - 1] ? S.pages[cur - 1].el.offsetTop : 0)) / (S.scale || 1);
  S.scale = Math.min(6, Math.max(0.3, s)); S.fit = keepFit;
  S.pages.forEach(pg => { pg.vp = pg.page.getViewport({ scale: S.scale }); pg.el.style.width = pg.vp.width + "px"; pg.el.style.height = pg.vp.height + "px"; pg.done = 0; });
  observe();
  if (S.paged) { markZoom(); return; }  // 쪽 넘김: 확대했을 때만 화면 이동
  if (S.pages[cur - 1]) view.scrollTop = S.pages[cur - 1].el.offsetTop + rel * S.scale;
}
function fitWidth() { if (!S.pages.length) return; setScale(fitScale(), true); }

// ---------------- 쪽 이동 ----------------
function scrollToPage(n, smooth = true) {  // 두 쪽 보기면 그 쪽이 든 줄로(줄의 쪽들은 위가 같음)
  n = Math.min(Math.max(1, n | 0), S.pages.length); const pg = S.pages[n - 1]; if (!pg) return;
  if (S.paged) { setCur(n); showSpread(); $("#view").scrollTo({ top: 0, left: 0 }); return; }  // 쪽 넘김: 그 줄만 보임
  $("#view").scrollTo({ top: pg.el.offsetTop - 8, behavior: smooth ? "smooth" : "auto" }); setCur(n);
}
function setCur(n) {
  if (S.cur === n && $("#pgNo").value == n) return;
  S.cur = n; $("#pgNo").value = n;
  document.querySelectorAll(".thumb").forEach(t => t.classList.toggle("cur", +t.dataset.n === n));
  clearTimeout(setCur.t); setCur.t = setTimeout(() => recentPage(S.key, n), 800);
}
$("#view").addEventListener("scroll", () => {
  if (S.paged) return;  // 쪽 넘김에서는 지금 쪽이 넘김으로만 바뀜
  const top = $("#view").scrollTop + $("#view").clientHeight / 3;
  let n = 1, rowTop = -1;  // 두 쪽 보기: 줄의 왼쪽 쪽 번호
  for (const pg of S.pages) { const t = pg.el.offsetTop; if (t > top) break; if (t !== rowTop) { n = pg.n; rowTop = t; } }
  setCur(n);
}, { passive: true });
$("#pgNo").addEventListener("change", e => scrollToPage(+e.target.value));

// ---------------- 책갈피, 쪽 그림 ----------------
async function buildOutline() {
  const box = $("#marks"); box.innerHTML = "";
  const ol = await S.pdf.getOutline();
  if (!ol || !ol.length) { box.innerHTML = '<div style="padding:12px;color:#7A808C">책갈피가 없습니다</div>'; showSide("thumbs"); return; }
  const add = async (items, lv) => {
    for (const it of items) {
      const b = document.createElement("button"); b.className = "mk"; b.textContent = it.title; b.title = it.title;
      b.style.paddingLeft = (10 + lv * 16) + "px";
      b.onclick = async () => { const n = await destPage(it.dest); if (n) { scrollToPage(n); if (innerWidth <= 900) $("#side").classList.add("hide"); } };
      box.appendChild(b);
      if (it.items && it.items.length) await add(it.items, lv + 1);
    }
  };
  await add(ol, 0);
  showSide("marks");
  if (innerWidth <= 900) $("#side").classList.add("hide");  // 세로 화면은 목록을 닫고 시작([목록]으로 엶)
}
async function destPage(dest) {
  try {
    let d = typeof dest === "string" ? await S.pdf.getDestination(dest) : dest;
    if (!d) return 0;
    const ref = d[0];
    return typeof ref === "number" ? ref + 1 : (await S.pdf.getPageIndex(ref)) + 1;
  } catch (e) { return 0; }
}
function buildThumbs() {
  const box = $("#thumbs"); box.innerHTML = "";
  const tio = new IntersectionObserver(es => es.forEach(async e => {
    if (!e.isIntersecting || e.target.dataset.done) return; e.target.dataset.done = 1;
    const pg = S.pages[+e.target.dataset.n - 1], vp = pg.page.getViewport({ scale: 1 }), k = 120 / vp.width, v2 = pg.page.getViewport({ scale: k * 2 });
    const cv = e.target.querySelector("canvas"); cv.width = v2.width; cv.height = v2.height; cv.style.width = "120px"; cv.style.height = (vp.height * k) + "px";
    pg.page.render({ canvasContext: cv.getContext("2d"), viewport: v2 });
  }), { root: box, rootMargin: "400px 0px" });
  for (const pg of S.pages) {
    const t = document.createElement("div"); t.className = "thumb"; t.dataset.n = pg.n;
    const vp = pg.page.getViewport({ scale: 1 }), cv = document.createElement("canvas"); cv.style.width = "120px"; cv.style.height = (vp.height * 120 / vp.width) + "px";
    const s = document.createElement("span"); s.textContent = pg.n;
    t.append(cv, s); t.onclick = () => { scrollToPage(pg.n); if (innerWidth <= 900) $("#side").classList.add("hide"); };
    box.appendChild(t); tio.observe(t);
  }
}
function showSide(which) {
  document.querySelectorAll(".st").forEach(b => b.classList.toggle("on", b.dataset.s === which));
  $("#marks").hidden = which !== "marks"; $("#thumbs").hidden = which !== "thumbs";
}
document.querySelectorAll(".st").forEach(b => b.onclick = () => showSide(b.dataset.s));
$("#bSide").onclick = () => $("#side").classList.toggle("hide");
$("#view").addEventListener("pointerdown", () => { if (innerWidth <= 900) $("#side").classList.add("hide"); });  // 좁은 화면: 바깥을 누르면 목록 닫힘

// ---------------- 증거번호 누르면 옆에 (2026-10-30 팀장님 "갑1호증 누르면 옆에 보여지는거") ----------------
// 쪽마다: ① PDF에 이미 들어 있는 링크(기록철이 만든 갑 제N호증 → 증거 쪽) ② 글자에서 증거 표기 찾기(PC 기록철 evidence.py와 같은 규칙, evidence.js)
// 증거 쪽은 책갈피 제목('갑 제1호증의1 …')으로 찾음. 누르면 가로 화면 = 오른쪽 반, 세로 = 아래 반에 그 쪽(앞 쪽, 다음 쪽, 확대, 이 쪽으로, 닫기).
// 밑줄은 보이기만(누름은 펜 층에서 손가락, 마우스 짧게 누름으로 판단: S펜 그리기를 막지 않게).
const CHAR_W = c => (c >= "가" && c <= "힣") || (c >= "一" && c <= "鿿") ? 1 : ".,:;'\"!|()[]·".includes(c) ? 0.3 : 0.55;
async function buildEvIndex() {  // 증거 키 → 쪽 (책갈피 제목)
  S.ev = new Map(); S.sideStart = 0; S.evTitle = new Map();  // evTitle: 쪽 → 증거 책갈피 제목(번호를 못 읽은 제목도 옆 창 이름으로)
  const walk = async items => { for (const it of items || []) {
    if (/^나란히 보기/.test(it.title || "") && !S.sideStart) S.sideStart = await destPage(it.dest);  // 기록철 '나란히 보기 (가로 화면용)' 구간 시작
    const k = Evid.firstLabel(it.title || "", true);
    if (k && !S.ev.has(k)) { const n = await destPage(it.dest); if (n) S.ev.set(k, n); }
    if (/^\s*[갑을]\s*(?:가|나|다)?\s*제?\s*\d+\s*호/.test(it.title || "")) { const n = await destPage(it.dest); if (n && !S.evTitle.has(n)) S.evTitle.set(n, (it.title.match(/^\s*[갑을][^\d]*\d+\s*호증(?:의\s*\d+)?/) || [it.title])[0].trim()); }
    await walk(it.items);
  } };
  try { await walk(await S.pdf.getOutline()); } catch (e) { /* 책갈피가 없으면 링크만 */ }
}
async function pageHots(pg) {  // 이 쪽의 누를 곳 [{r:[x0,y0,x1,y1](쪽 기본 크기 비율), key|page, label}]
  if (pg.hots) return pg.hots;
  await S.evReady;
  const v1 = pg.page.getViewport({ scale: 1 }), hots = [], refs = [];
  try {  // ① 이미 있는 링크
    for (const a of await pg.page.getAnnotations()) {
      if (a.subtype !== "Link" || !a.dest) continue;
      const n = await destPage(a.dest); if (!n) continue;
      const [x0, y0] = v1.convertToViewportPoint(a.rect[0], a.rect[3]), [x1, y1] = v1.convertToViewportPoint(a.rect[2], a.rect[1]);
      hots.push({ r: [Math.min(x0, x1) / v1.width, Math.min(y0, y1) / v1.height, Math.max(x0, x1) / v1.width, Math.max(y0, y1) / v1.height], page: n, link: true });
    }
  } catch (e) { /* 링크를 못 읽으면 글자만 */ }
  try {  // ② 글자에서 증거 표기
    const tc = await pg.page.getTextContent(); let text = ""; const own = [];
    tc.items.forEach((it, i) => {
      if (!it.str) { if (it.hasEOL) { text += "\n"; own.push(null); } return; }
      if (text) { text += it.hasEOL ? "" : " "; own.push(null); }
      for (let k = 0; k < it.str.length; k++) own.push([i, k]);
      text += it.str;
      if (it.hasEOL) { text += "\n"; own.push(null); }
    });
    const boxOf = (i, a, b) => {  // 글자 범위 → 비율 사각형(글자 폭을 한글 넓게, 숫자 좁게 나눔)
      const it = tc.items[i], t = pdfjsLib.Util.transform(v1.transform, it.transform), h = Math.hypot(t[2], t[3]) || 10;
      const cum = [0]; for (const c of it.str) cum.push(cum[cum.length - 1] + CHAR_W(c));
      const w = it.width * v1.scale, k = w / (cum[cum.length - 1] || 1);
      return [(t[4] + k * cum[a]) / v1.width, (t[5] - h) / v1.height, (t[4] + k * cum[b]) / v1.width, (t[5] + h * 0.15) / v1.height];
    };
    for (const f of Evid.findRefs(text)) {
      for (const [key, a, b] of f.refs) {
        const cover = new Map();
        for (let i = a; i < Math.min(b, own.length); i++) { const o = own[i]; if (!o) continue; const c = cover.get(o[0]) || [o[1], o[1] + 1]; cover.set(o[0], [Math.min(c[0], o[1]), Math.max(c[1], o[1] + 1)]); }
        for (const [i, [x, y]] of cover) {
          const r = boxOf(i, x, y);
          refs.push({ r, key });
          if (hots.some(h => h.link && r[0] < h.r[2] && r[2] > h.r[0] && r[1] < h.r[3] && r[3] > h.r[1])) continue;  // 링크와 겹치면 링크
          hots.push({ r, key, label: Evid.labelKey(key) });
        }
      }
    }
  } catch (e) { /* 글자 층이 없는 쪽(사진 등) */ }
  // 기록철이 본문 줄 오른쪽 여백에 넣은 '두 칸' 표시: 맨 뒤 나란히 보기 짝 쪽 [이 쪽 사본 | 증거]으로 가는 링크라 그대로 열면 같은 쪽이 뜸
  // (2026-10-30 팀장님 "오른쪽에 있는 걸 누르면 … 동일 페이지가 팝업으로 보여") → 같은 줄의 증거번호로 원래 증거 쪽을 엶, 못 찾으면 짝의 오른쪽 쪽
  // 같은 줄의 기록철 본문 링크(파란 증거번호 → 증거 쪽)가 먼저, 없으면 같은 줄 글자의 증거번호, 그것도 못 찾으면 짝의 오른쪽 쪽(증거 사본)
  const isSide = h => h.link && S.sideStart && h.page >= S.sideStart && pg.n < S.sideStart;
  const onLine = (h, x) => { const cy = (h.r[1] + h.r[3]) / 2; return x.r[1] - 0.004 <= cy && cy <= x.r[3] + 0.004; };
  for (const h of hots) {
    if (!isSide(h)) continue;
    const links = [...new Set(hots.filter(x => x.link && x.fallback === undefined && x.page && !isSide(x) && x.page !== pg.n && onLine(h, x)).sort((a, b) => a.r[0] - b.r[0]).map(x => x.page))];
    const keys = [...new Set(refs.filter(x => onLine(h, x)).sort((a, b) => a.r[0] - b.r[0]).map(x => x.key))];
    h.fallback = Math.min(h.page + 1, S.pages.length);
    if (links.length) { delete h.page; h.pages = links; }
    else if (keys.length) { delete h.page; h.keys = keys; h.label = keys.map(Evid.labelKey).join(", "); }
    else h.page = h.fallback;
  }
  pg.hots = hots;
  return hots;
}
async function drawHots(pg) {
  const hots = await pageHots(pg);
  pg.el.querySelectorAll(".evref").forEach(e => e.remove());
  for (const h of hots) {
    const d = document.createElement("div"); d.className = "evref";
    d.style.left = (h.r[0] * 100) + "%"; d.style.top = (h.r[1] * 100) + "%"; d.style.width = ((h.r[2] - h.r[0]) * 100) + "%"; d.style.height = ((h.r[3] - h.r[1]) * 100) + "%";
    pg.el.appendChild(d);
  }
}
function hotAt(pg, e) {
  const r = pg.ink.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height, pad = 0.006;
  return (pg.hots || []).find(h => fx >= h.r[0] - pad && fx <= h.r[2] + pad && fy >= h.r[1] - pad && fy <= h.r[3] + pad);
}
function resolveHot(h) {  // → {pages:[{n, label}]} 가지번호가 여럿이면 고르기
  if (h.pages) return h.pages.flatMap(n => resolveHot({ page: n }));
  if (h.keys) { const out = []; for (const key of h.keys) for (const it of resolveHot({ key })) if (!out.some(x => x.n === it.n)) out.push(it); return out.length ? out : resolveHot({ page: h.fallback }); }
  if (h.page) return [{ n: h.page, label: S.ev && [...S.ev].find(([, n]) => n === h.page)?.[0] ? Evid.labelKey([...S.ev].find(([, n]) => n === h.page)[0]) : (S.evTitle && S.evTitle.get(h.page)) || h.page + "쪽" }];
  const ev = S.ev || new Map(), [side, num, sub] = Evid.parseKey(h.key);
  if (ev.has(h.key)) return [{ n: ev.get(h.key), label: Evid.labelKey(h.key) }];
  if (sub) { const base = Evid.makeKey(side, num); if (ev.has(base)) return [{ n: ev.get(base), label: Evid.labelKey(base) }]; }
  const subs = [...ev].filter(([k]) => k.startsWith(`${side}-${String(num).padStart(4, "0")}-`)).sort((a, b) => a[0] < b[0] ? -1 : 1);
  return subs.map(([k, n]) => ({ n, label: Evid.labelKey(k) }));
}
const PK = { n: 0, scale: 0, list: [] };
function openPeek(h) {
  const list = resolveHot(h);
  if (!list.length) return toast(`책갈피에 없는 증거입니다 (${h.label || "링크"})`);
  if (!landscape()) return jumpTo(list[0].n);  // 세로 화면: 아래 창 대신 그 증거 쪽으로 바로 이동, 뒤로가기로 보던 쪽(2026-10-30 팀장님)
  PK.list = list;
  const pick = $("#pkPick"); pick.innerHTML = "";
  if (list.length > 1) for (const it of list) {  // 가지번호 고르기
    const b = document.createElement("button"); b.className = "tb"; b.textContent = it.label.replace(/^.* 제\d+호증의 /, "의 ");
    b.title = it.label; b.onclick = () => showPeek(it); pick.appendChild(b);
  }
  openSplit();
  showPeek(list[0]);
}
// 세로 화면 증거 이동과 뒤로가기(2026-10-30 팀장님 "갑호증 눌렀을때 그 갑호증으로 이동했다가, 뒤로가기 누르면 보던 쪽으로 돌아오게"):
// 이동마다 보던 자리(쪽, 확대, 스크롤)를 쌓고 history에 한 칸. 안드로이드 뒤로가기(popstate)나 [보던 쪽으로]를 누를 때마다 한 단계씩 돌아옴.
// 돌아갈 곳이 없을 때 뒤로가기는 앱을 닫지 않고 '한 번 더 누르면 닫힙니다', 2초 안에 또 누르면 닫힘
S.back = [];
function viewSpot() { const v = $("#view"); return { n: S.cur, scale: S.scale, fit: S.fit, top: v.scrollTop, left: v.scrollLeft }; }
function jumpTo(n) {
  if (!S.pages.length || n === S.cur) return;
  S.back.push(viewSpot());
  try { history.pushState({ hpt: "jump", d: S.back.length }, ""); } catch (e) { /* 기록을 못 남겨도 [보던 쪽으로]는 됨 */ }
  scrollToPage(n, false); drawBack();
}
function goBack() {
  const b = S.back.pop(); drawBack(); if (!b) return;
  if (b.fit) setScale(fitScale(), true); else if (Math.abs(b.scale - S.scale) > 1e-6) setScale(b.scale);
  scrollToPage(b.n, false);
  setTimeout(() => { const v = $("#view"); v.scrollTop = b.top; v.scrollLeft = b.left; setCur(b.n); }, 30);  // 크기 바꾼 뒤 자리 잡히면 같은 위치로
}
function drawBack() {
  const b = $("#bBack"), last = S.back[S.back.length - 1];
  b.hidden = !last; if (last) b.querySelector("span").textContent = `보던 쪽으로 (${last.n}쪽)`;
}
$("#bBack").onclick = () => { if (S.back.length) history.back(); };  // 기록과 맞추려고 뒤로가기와 같은 길로
let lastExit = 0;
try { if (!history.state || history.state.hpt !== "guard") history.pushState({ hpt: "guard" }, ""); } catch (e) { /* 지원 안 함 */ }
addEventListener("popstate", () => {
  if (S.back.length) return goBack();
  if (Date.now() - lastExit < 2000) { history.back(); return; }  // 2초 안에 두 번이면 닫기
  lastExit = Date.now(); toast("한 번 더 누르면 닫힙니다");
  try { history.pushState({ hpt: "guard" }, ""); } catch (e) { /* 지원 안 함 */ }
});
// 증거 창이 열려 있을 때 본문을 짧게 한 번 누르면 닫힘(2026-10-30 팀장님 "닫기 버튼 말고, 보던 페이지 누르면 창 닫히게 해").
// 증거 표시를 누르면 그 증거로 바뀌고, 밀기, 두 손가락, 쪽 넘김 양 끝 누르기, S펜 그리기는 닫지 않음
(() => {
  let t0 = null, n = 0;
  $("#view").addEventListener("pointerdown", e => {
    if (e.pointerType === "pen") { t0 = null; return; }
    n = e.isPrimary ? 1 : n + 1;
    t0 = n === 1 && (e.pointerType === "touch" || !S.tool) ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
  });
  $("#view").addEventListener("pointerup", e => {
    if (e.pointerType === "pen") return;
    n = Math.max(0, n - 1);
    const s = t0; t0 = null;
    if (!s || $("#peek").hidden || Date.now() - (S.hotTapAt || 0) < 600) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12 || Date.now() - s.t > 450) return;
    const r = $("#view").getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
    if (S.paged && !zoomed() && (f < 0.15 || f > 0.85)) return;  // 양 끝 = 쪽 넘기기
    setTimeout(() => { if (Date.now() - (S.hotTapAt || 0) >= 600) closePeek(); }, 0);
  });
  $("#view").addEventListener("pointercancel", () => { t0 = null; n = 0; });
})();
// 가로 화면: 증거 옆 창은 덮개가 아니라 화면을 반반 나눔(2026-10-30 팀장님 "창을 가려버리니까 두개를 나란히 못봐").
// 열 때 책갈피 칸이 열려 있으면 접고 두 쪽 보기면 한 쪽으로(닫으면 원래대로), 본문과 옆 창 모두 높이 맞춤. 가운데 경계를 끌어 나누는 비율 조절(이 탭에 기억)
const PKS = { side: false, two: false, on: false };
function pkWidth(f) { $("#main").style.setProperty("--pkw", Math.round(f * 1000) / 10 + "%"); }
try { const w = parseFloat(localStorage.getItem("hpt.pkw")); if (w > 0.2 && w < 0.8) pkWidth(w); } catch (e) { /* 기본 반반 */ }
function openSplit() {
  const was = !$("#peek").hidden;
  $("#peek").hidden = false; $("#pkSplit").hidden = !landscape(); document.body.classList.add("peeking");
  if (was) return;
  PKS.on = true;
  PKS.side = !$("#side").classList.contains("hide"); if (PKS.side) $("#side").classList.add("hide");  // 세로 화면에서도 책갈피 칸은 접음(본문을 가리지 않게)
  PKS.two = false;
  if (!landscape()) return;
  PKS.two = S.two; if (S.two) setTwo(false, false);
  S.fit = true;  // 본문은 왼쪽 칸에 높이 맞춤(칸 크기가 바뀌면 다시 맞춤)
}
function closePeek() {
  $("#peek").hidden = true; $("#pkSplit").hidden = true; document.body.classList.remove("peeking");
  if (!PKS.on) return;
  PKS.on = false;
  if (PKS.side) $("#side").classList.remove("hide");
  if (PKS.two && !S.two) setTwo(true, false);
}
(() => {  // 가운데 경계 끌기
  const bar = $("#pkSplit"); let drag = false;
  bar.addEventListener("pointerdown", e => { drag = true; try { bar.setPointerCapture(e.pointerId); } catch (err) { /* 붙잡기 없이도 됨 */ } e.preventDefault(); });
  bar.addEventListener("pointermove", e => {
    if (!drag) return;
    const r = $("#main").getBoundingClientRect(), f = Math.min(0.75, Math.max(0.25, (r.right - e.clientX) / r.width));
    pkWidth(f); try { localStorage.setItem("hpt.pkw", String(f)); } catch (err) { /* 이번만 */ }
  });
  const end = () => { drag = false; };
  bar.addEventListener("pointerup", end); bar.addEventListener("pointercancel", end);
  let t; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!$("#peek").hidden && PK.n && !PK.zoomed) showPeek({ n: PK.n, label: $("#pkTitle").textContent }); }, 150); }).observe($("#pkBody"));
})();
async function showPeek(it, keepScale) {
  PK.n = it.n; $("#pkTitle").textContent = it.label || (it.n + "쪽"); $("#pkTitle").title = $("#pkTitle").textContent;
  $("#pkPick").querySelectorAll(".tb").forEach(b => b.classList.toggle("on", b.title === it.label));
  const page = await S.pdf.getPage(it.n), v1 = page.getViewport({ scale: 1 }), body = $("#pkBody");
  if (!keepScale) PK.zoomed = false;
  // 가로(오른쪽 칸) = 높이 맞춤, 세로(아래 칸, 낮고 넓음) = 폭 맞춤(위아래로 밀어 읽기). 2026-10-30 팀장님 "왜 사이즈 줄고 …"
  const fitW = (body.clientWidth - 24) / v1.width, fitH = (body.clientHeight - 24) / v1.height;
  if (!keepScale || !PK.scale) PK.scale = Math.max(0.2, landscape() ? Math.min(fitW, fitH) : fitW);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), vp = page.getViewport({ scale: PK.scale * dpr }), cv = $("#pkCanvas");
  $("#pkNo").textContent = it.n + " / " + S.pages.length;
  await paint(PK, page, cv, vp, () => { cv.style.width = (vp.width / dpr) + "px"; cv.style.height = (vp.height / dpr) + "px"; });
}
function peekStep(d) { const n = Math.min(Math.max(1, PK.n + d), S.pages.length); if (n !== PK.n) showPeek({ n, label: n + "쪽" }, true); }
$("#pkPrev").onclick = () => peekStep(-1);
$("#pkNext").onclick = () => peekStep(1);
$("#pkIn").onclick = () => { PK.scale *= 1.25; PK.zoomed = true; showPeek({ n: PK.n, label: $("#pkTitle").textContent }, true); };
$("#pkOut").onclick = () => { PK.scale /= 1.25; PK.zoomed = true; showPeek({ n: PK.n, label: $("#pkTitle").textContent }, true); };
$("#pkGo").onclick = () => { const n = PK.n; closePeek(); scrollToPage(n); };
$("#pkClose").onclick = closePeek;

// ---------------- 펜(손가락은 넘기기, 펜은 그리기) ----------------
function isPenEvent(e) { return e.pointerType === "pen" || (e.pointerType === "mouse" && S.tool); }
function hookInk(pg) {
  const c = pg.ink; let stroke = null;
  // S펜으로 누르면 화면이 밀리지 않게(손가락은 그대로 넘기기)
  c.addEventListener("touchstart", e => { if (S.tool && [...e.touches].some(t => t.touchType === "stylus")) e.preventDefault(); }, { passive: false });
  c.addEventListener("touchmove", e => { if (stroke) e.preventDefault(); }, { passive: false });
  c.addEventListener("pointerdown", e => {
    if (!S.tool || !isPenEvent(e)) return;
    e.preventDefault();
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* 붙잡기를 못 해도 그리기는 됨 */ }
    const pt = toPdf(pg, e);
    if (S.tool === "erase") { eraseAt(pg, pt); stroke = { erase: true }; return; }
    stroke = { tool: S.tool, color: S.color[S.tool], pts: [pt] };
    (S.strokes[pg.n] = S.strokes[pg.n] || []).push(stroke);
    drawInk(pg);
  });
  c.addEventListener("pointermove", e => {
    if (!stroke || !isPenEvent(e)) return;
    const pt = toPdf(pg, e);
    if (stroke.erase) { eraseAt(pg, pt); return; }
    if (stroke.tool === "ul") stroke.pts = [stroke.pts[0], [pt[0], stroke.pts[0][1]]];  // 밑줄은 곧은 가로선
    else stroke.pts.push(pt);
    drawInk(pg);
  });
  const end = e => {
    if (!stroke) return;
    if (!stroke.erase && penTap(pg, stroke, e)) { stroke = null; return; }
    if (!stroke.erase) { if (stroke.pts.length < 2) stroke.pts.push([stroke.pts[0][0] + 0.5, stroke.pts[0][1]]); S.undo.push({ add: stroke, n: pg.n }); markDirty(); }
    stroke = null;
  };
  c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
  c.addEventListener("pointerdown", e => { if (stroke) { stroke.t0 = Date.now(); stroke.x0 = e.clientX; stroke.y0 = e.clientY; } });
  // 증거번호 누르기: 손가락 짧게 누름, 또는 도구가 꺼진 마우스 클릭(S펜 그리기와 겹치지 않게)
  let tap = null;
  c.addEventListener("pointerdown", e => { tap = (e.pointerType === "touch" || (e.pointerType === "mouse" && !S.tool)) ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }, true);
  c.addEventListener("pointerup", e => {
    if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10 || Date.now() - tap.t > 500) { tap = null; return; }
    tap = null; const h = hotAt(pg, e); if (h) { swipe = null; S.hotTapAt = Date.now(); openPeek(h); }  // swipe = null: 보기 칸의 넘기기 판단을 건너뜀(손가락 수 세기는 그대로)
  });
}
// S펜으로 짧게 누름(거의 안 움직임): 증거 글자면 옆에 보기, 쪽 넘김 화면 양 끝이면 넘기기(점을 찍지 않음). 그은 것은 그대로 그리기
function penTap(pg, stroke, e) {
  if (!e || e.type !== "pointerup" || e.pointerType !== "pen" || stroke.t0 === undefined) return false;
  if (Date.now() - stroke.t0 > 350 || Math.hypot(e.clientX - stroke.x0, e.clientY - stroke.y0) > 6) return false;
  const h = hotAt(pg, e), r = $("#view").getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
  const edge = S.paged && !zoomed() && (f < 0.15 || f > 0.85);
  if (!h && !edge && !$("#peek").hidden) { const a = S.strokes[pg.n] || [], i = a.indexOf(stroke); if (i >= 0) a.splice(i, 1); drawInk(pg); closePeek(); return true; }
  if (!h && !edge) return false;
  const a = S.strokes[pg.n] || [], i = a.indexOf(stroke); if (i >= 0) a.splice(i, 1);
  drawInk(pg);
  if (h) { S.hotTapAt = Date.now(); openPeek(h); } else edgeTap(e.clientX);
  return true;
}
function toPdf(pg, e) {
  const r = pg.ink.getBoundingClientRect(), x = (e.clientX - r.left) * (pg.vp.width / r.width), y = (e.clientY - r.top) * (pg.vp.height / r.height);
  return pg.vp.convertToPdfPoint(x, y);
}
function drawInk(pg) {
  const c = pg.ink, g = c.getContext("2d"), k = pg.dpr || 1;
  g.clearRect(0, 0, c.width, c.height);
  for (const s of S.strokes[pg.n] || []) {
    const st = STYLE[s.tool]; g.save(); g.globalAlpha = st.op; g.strokeStyle = s.color; g.lineWidth = st.w * S.scale * k; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath();
    s.pts.forEach((p, i) => { const [x, y] = pg.vp.convertToViewportPoint(p[0], p[1]); i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k); });
    g.stroke(); g.restore();
  }
}
function eraseAt(pg, pt) {
  const list = S.strokes[pg.n] || [], tol = 8 / S.scale + 4;
  const hit = list.filter(s => s.pts.some((p, i) => i && segDist(pt, s.pts[i - 1], p) < tol + STYLE[s.tool].w / 2));
  if (!hit.length) return;
  S.strokes[pg.n] = list.filter(s => !hit.includes(s)); S.undo.push({ del: hit, n: pg.n }); markDirty(); drawInk(pg);
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
$("#bUndo").onclick = () => {
  const u = S.undo.pop(); if (!u) return toast("되돌릴 것이 없습니다");
  if (u.add) S.strokes[u.n] = (S.strokes[u.n] || []).filter(s => s !== u.add); else S.strokes[u.n] = (S.strokes[u.n] || []).concat(u.del);
  drawInk(S.pages[u.n - 1]); markDirty(S.undo.length > 0 || Object.values(S.strokes).some(l => l.length));
};
function markDirty(on = true) { S.dirty = on; $("#title").textContent = (on ? "* " : "") + S.name; }
function setTool(t) {
  S.tool = S.tool === t ? "" : t;
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("on", b.dataset.tool === S.tool));
  document.body.classList.toggle("drawing", !!S.tool);
  const box = $("#colors"); box.innerHTML = "";
  for (const col of COLORS[S.tool] || []) {
    const b = document.createElement("button"); b.className = "sw" + (S.color[S.tool] === col ? " on" : ""); b.style.background = col; b.title = "색";
    b.onclick = () => { S.color[S.tool] = col; useTool(S.tool, true); }; box.appendChild(b);
  }
}
function useTool(t, redraw) { if (S.tool !== t || redraw) { S.tool = ""; setTool(t); } }  // 켜기만(이미 켜져 있으면 그대로)
document.querySelectorAll(".tool").forEach(b => b.onclick = () => setTool(b.dataset.tool));

// ---------------- 손가락 두 개로 확대 ----------------
let pinch = null;
$("#view").addEventListener("touchstart", e => {
  if (e.touches.length === 2 && ![...e.touches].some(t => t.touchType === "stylus")) {
    pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), s: S.scale, k: 1 };
  }
}, { passive: true });
$("#view").addEventListener("touchmove", e => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  pinch.k = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / pinch.d;
  $("#pages").style.transform = `scale(${pinch.k})`;
}, { passive: false });
$("#view").addEventListener("touchend", e => {
  if (!pinch || e.touches.length) return;
  $("#pages").style.transform = ""; const s = pinch.s * pinch.k; pinch = null; setScale(s);
});
$("#bZoomIn").onclick = () => setScale(S.scale * 1.25);
$("#bZoomOut").onclick = () => setScale(S.scale / 1.25);
$("#bFit").onclick = fitWidth;
$("#bTwoT").onclick = () => setTwo(!S.two);
$("#bPagedT").onclick = () => setPaged(!S.paged);
// 길게 누르면 이름 풍선(터치에서는 title이 안 보여서)
document.querySelectorAll(".ib").forEach(b => { let t; b.addEventListener("pointerdown", () => { t = setTimeout(() => toast(b.dataset.tip || b.title), 500); }); ["pointerup", "pointerleave", "pointercancel"].forEach(k => b.addEventListener(k, () => clearTimeout(t))); });
// [보기]: 쪽 보기, 첫 쪽 따로, 넘기기를 작은 창 하나에(단추 줄이 탭 가로 화면을 넘지 않게). 바깥을 누르면 닫힘
$("#bView").onclick = e => {
  const p = $("#viewPop"), r = e.currentTarget.getBoundingClientRect();
  if (!p.hidden) { p.hidden = true; return; }
  p.hidden = false; p.style.top = (r.bottom + 4) + "px"; p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + "px";
};
document.addEventListener("pointerdown", e => { const p = $("#viewPop"); if (!p.hidden && !p.contains(e.target) && e.target.id !== "bView") p.hidden = true; });
let rz; addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (pref("two", null) === null && !PKS.on && S.two !== landscape()) return setTwo(landscape(), false);  // 고른 적이 없으면 탭을 돌릴 때 따라감
    if (S.fit) fitWidth();
  }, 200);
});
// 목록 칸을 열고 닫아 보기 칸 크기가 바뀌어도 높이 맞춤을 다시(창 크기는 그대로일 때)
let vw0 = 0, vh0 = 0, rz2; new ResizeObserver(() => {
  const v = $("#view"); if (Math.abs(v.clientWidth - vw0) < 8 && Math.abs(v.clientHeight - vh0) < 8) return;
  vw0 = v.clientWidth; vh0 = v.clientHeight; clearTimeout(rz2); rz2 = setTimeout(() => { if (S.fit && S.pages.length) fitWidth(); }, 150);
}).observe($("#view"));

// ---------------- 저장(PDF 표준 Ink 주석 + 모양 그림) ----------------
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
const num = v => Math.round(v * 100) / 100;
async function buildPdf() {
  const { PDFDocument, PDFName, PDFHexString, PDFString } = PDFLib;
  const doc = await PDFDocument.load(S.bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context, pages = doc.getPages(), now = new Date();
  const stamp = "D:" + now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
  let n = 0;
  for (const [pn, list] of Object.entries(S.strokes)) {
    const page = pages[+pn - 1];
    for (const s of list) {
      const st = STYLE[s.tool], c = rgb(s.color), pad = st.w;
      const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
      const rect = [num(Math.min(...xs) - pad), num(Math.min(...ys) - pad), num(Math.max(...xs) + pad), num(Math.max(...ys) + pad)];
      const path = s.pts.map((p, i) => `${num(p[0])} ${num(p[1])} ${i ? "l" : "m"}`).join(" ");
      const content = `q /G0 gs ${c.map(num).join(" ")} RG ${st.w} w 1 J 1 j ${path} S Q`;
      const ap = ctx.register(ctx.stream(content, { Type: "XObject", Subtype: "Form", BBox: rect,
        Resources: { ExtGState: { G0: { Type: "ExtGState", CA: st.op, ca: st.op } } } }));
      const annot = ctx.obj({ Type: "Annot", Subtype: "Ink", Rect: rect, InkList: [s.pts.flatMap(p => [num(p[0]), num(p[1])])],
        C: c.map(num), CA: st.op, BS: { W: st.w, S: "S" }, F: 4, AP: { N: ap } });
      annot.set(PDFName.of("T"), PDFHexString.fromText("하운드 PDF 탭"));
      annot.set(PDFName.of("Subj"), PDFHexString.fromText(st.subj));
      annot.set(PDFName.of("NM"), PDFString.of("hpt-" + now.getTime() + "-" + (n++)));
      annot.set(PDFName.of("M"), PDFString.of(stamp));
      page.node.addAnnot(ctx.register(annot));
    }
  }
  return await doc.save({ useObjectStreams: false });
}
async function save(asNew) {
  if (!S.pdf) return toast("먼저 PDF를 여세요");
  let out;
  try { out = await buildPdf(); } catch (e) { return toast("저장하지 못했습니다: " + e.message, 5000); }
  let name = S.name;
  if (asNew) { const v = prompt("새 파일 이름", S.name.replace(/\.pdf$/i, "") + "_표시"); if (!v) return; name = v.replace(/\.pdf$/i, "") + ".pdf"; }
  const blob = new Blob([out], { type: "application/pdf" });
  let how = "down";
  if (!asNew && S.handle && S.handle.createWritable) {  // 덮어쓰기가 되는 브라우저
    try { const w = await S.handle.createWritable(); await w.write(blob); await w.close(); how = "over"; } catch (e) { how = "down"; }
  } else if (asNew && window.showSaveFilePicker) {
    try { const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close(); how = "new"; S.handle = h; } catch (e) { if (e.name === "AbortError") return; how = "down"; }
  }
  if (how === "down") { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  window.__lastSaved = out;  // 시험용(바깥으로 보내지 않음)
  const page = S.cur; S.dirty = false;
  await openBytes(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), name, how === "down" ? null : S.handle, page);
  toast(how === "over" ? "저장했습니다(원래 파일에 덮어씀)" : how === "new" ? "새 파일로 저장했습니다" : `'${name}'로 내려받았습니다(다운로드 폴더)`, 4000);
}
$("#bSave").onclick = () => save(false);
$("#bSaveAs").onclick = () => save(true);
$("#bOpen").onclick = pickFile; $("#bOpen2").onclick = pickFile;
$("#bClear").onclick = async () => { if (!confirm("최근 연 파일 목록과 이 탭에 저장해 둔 사본을 지울까요?")) return; try { await dbDo("readwrite", st => st.clear()); } catch (e) { /* 무시 */ } drawRecent(); };
addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
addEventListener("keydown", e => {
  if (e.target && e.target.tagName === "INPUT") return;
  if (e.key === "PageDown" || e.key === "ArrowRight") stepSpread(1);
  if (e.key === "PageUp" || e.key === "ArrowLeft") stepSpread(-1);
});

setTool("pen");
drawViewBtns();
drawRecent();
document.querySelectorAll(".ver").forEach(e => e.textContent = "판 " + APP_VER);
// 새 판: 서비스 워커가 새 앱 파일을 받으면 '새 판이 있어요 [다시 열기]' (sw.js VERSION을 올리면 생김)
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) $("#update").hidden = false; });
  navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(() => {});
}
$("#bReload").onclick = () => { if (S.dirty && !confirm("표시한 것을 저장하지 않았습니다. 그래도 다시 열까요?")) return; location.reload(); };
