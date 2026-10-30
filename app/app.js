// 하운드 PDF(탭): 갤럭시 탭에서 인터넷 없이 기록 보기와 S펜 표시(2026-10-30 팀장님 "테블릿에서 쓰고싶은데" … "하운드PDF가 좋다잖어").
// pdf.js 3.11.174로 보기, pdf-lib로 저장(PDF 표준 Ink 주석 + 모양 그림을 함께 넣어 PC 하운드 PDF, 다른 PDF 프로그램에서도 같게 보임).
// 사건 PDF는 이 탭 안에서만(바깥으로 보내지 않음, 기록 남기지 않음). 최근 파일은 이 탭 브라우저 저장소(IndexedDB)에만, [목록 비우기]로 지움.
"use strict";
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
  buildOutline(); buildThumbs();
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
}
function fitScale() {  // 한 쪽 = 가장 넓은 쪽을 폭에 맞춤, 두 쪽 = 가장 넓은 줄과 가장 긴 쪽이 화면에 다 들어오게(가로 쪽이 섞여도 넘치지 않게)
  const view = $("#view"), size = S.pages.map(p => p.page.getViewport({ scale: 1 }));
  if (!S.two) return Math.max(0.3, (view.clientWidth - 36) / Math.max(...size.map(v => v.width)));  // 양옆 여백(10px씩)과 세로 스크롤 막대 몫
  let s = Infinity;
  for (const g of groups(size.length)) {
    const sumW = g.reduce((a, n) => a + size[n - 1].width, 0), gap = 10 * (g.length - 1);
    s = Math.min(s, (view.clientWidth - 36 - gap) / sumW, (view.clientHeight - 20) / Math.max(...g.map(n => size[n - 1].height)));
  }
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
function drawViewBtns() {
  $("#bOne").classList.toggle("on", !S.two); $("#bTwo").classList.toggle("on", S.two);
  $("#bCover").hidden = !S.two; $("#bCover").classList.toggle("on", S.cover);
}
$("#bOne").onclick = () => setTwo(false);
$("#bTwo").onclick = () => setTwo(true);
$("#bCover").onclick = () => setCover(!S.cover);
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
async function renderPage(pg) {
  if (pg.done === S.scale) return; pg.done = S.scale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), vp = pg.page.getViewport({ scale: S.scale * dpr });
  const cv = pg.cv; cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  pg.ink.width = cv.width; pg.ink.height = cv.height; pg.dpr = dpr;
  try { await pg.page.render({ canvasContext: cv.getContext("2d"), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise; } catch (e) { /* 다시 그리기로 바뀜 */ }
  drawInk(pg);
}
function setScale(s, keepFit = false) {
  const view = $("#view"), cur = S.cur, rel = (view.scrollTop - (S.pages[cur - 1] ? S.pages[cur - 1].el.offsetTop : 0)) / (S.scale || 1);
  S.scale = Math.min(6, Math.max(0.3, s)); S.fit = keepFit;
  S.pages.forEach(pg => { pg.vp = pg.page.getViewport({ scale: S.scale }); pg.el.style.width = pg.vp.width + "px"; pg.el.style.height = pg.vp.height + "px"; pg.done = 0; });
  observe();
  if (S.pages[cur - 1]) view.scrollTop = S.pages[cur - 1].el.offsetTop + rel * S.scale;
}
function fitWidth() { if (!S.pages.length) return; setScale(fitScale(), true); }

// ---------------- 쪽 이동 ----------------
function scrollToPage(n, smooth = true) {  // 두 쪽 보기면 그 쪽이 든 줄로(줄의 쪽들은 위가 같음)
  n = Math.min(Math.max(1, n | 0), S.pages.length); const pg = S.pages[n - 1]; if (!pg) return;
  $("#view").scrollTo({ top: pg.el.offsetTop - 8, behavior: smooth ? "smooth" : "auto" }); setCur(n);
}
function setCur(n) {
  if (S.cur === n && $("#pgNo").value == n) return;
  S.cur = n; $("#pgNo").value = n;
  document.querySelectorAll(".thumb").forEach(t => t.classList.toggle("cur", +t.dataset.n === n));
  clearTimeout(setCur.t); setCur.t = setTimeout(() => recentPage(S.key, n), 800);
}
$("#view").addEventListener("scroll", () => {
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
  const end = () => {
    if (!stroke) return;
    if (!stroke.erase) { if (stroke.pts.length < 2) stroke.pts.push([stroke.pts[0][0] + 0.5, stroke.pts[0][1]]); S.undo.push({ add: stroke, n: pg.n }); markDirty(); }
    stroke = null;
  };
  c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
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
let rz; addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (pref("two", null) === null && S.two !== landscape()) return setTwo(landscape(), false);  // 고른 적이 없으면 탭을 돌릴 때 따라감
    if (S.fit) fitWidth();
  }, 200);
});

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
// 새 판: 서비스 워커가 새 앱 파일을 받으면 '새 판이 있어요 [다시 열기]' (sw.js VERSION을 올리면 생김)
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) $("#update").hidden = false; });
  navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(() => {});
}
$("#bReload").onclick = () => { if (S.dirty && !confirm("표시한 것을 저장하지 않았습니다. 그래도 다시 열까요?")) return; location.reload(); };
