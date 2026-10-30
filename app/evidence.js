// 증거번호 인식, 정규화: PC 기록철 Hound-casefile/app/evidence.py를 그대로 옮김(2026-10-30, 팀장님 "갑1호증 누르면 옆에 보여지는거").
// 인식: 갑 제1호증 / 갑제1호증의2 / 갑 제1호증의 1 내지 3 / 갑 제1호증 내지 제3호증 / 갑 제1, 2호증 / 을 제2호증의 1 / (갑 1-2) / 을가 제1호증
// OCR 오인식(호중, 호층, 재1, l, I, |는 1, O는 0)과 공백, 줄바꿈을 허용. 정규화 키 '갑-0001-002'(가지번호 없으면 -000).
"use strict";
const Evid = (() => {
  const SIDE_PAT = "(?:갑|을|병)[가나다라마바사]?";
  const FIX = [
    [/호\s*[중층종즘]/g, m => m.slice(0, -1) + "증"],
    [/재(?=\s*\d)/g, () => "제"],
    [/(?<=\d)[lI|](?=\d|\s|호|의|$)|(?<=제)[lI|]|(?<=\s)[lI|](?=\s*호)/g, () => "1"],
    [/(?<=\d)[oO](?=\d|호|의)/g, () => "0"],
    [/[–—‐−]/g, () => "-"],
  ];
  const fixOcr = s => FIX.reduce((t, [rx, fn]) => t.replace(rx, fn), s);  // 같은 길이로만 바꿈(글자 위치 유지)
  const makeKey = (side, num, sub) => `${side}-${String(num).padStart(4, "0")}-${String(sub || 0).padStart(3, "0")}`;
  const parseKey = k => { const [s, n, b] = k.split("-"); return [s, +n, +b || null]; };
  const label = (side, num, sub) => `${side} 제${num}호증` + (sub ? `의 ${sub}` : "");
  const labelKey = k => label(...parseKey(k));
  const TOK = new RegExp("\\s*(?:(제)|(\\d{1,3})|(호\\s*증)|(의)|(-)|(,|·|및|과|와)|(내지|~|부터)|(" + SIDE_PAT + "))", "y");

  function parseAfter(s, pos, side) {
    const items = []; let prev = null, pendingRange = false, hasMarker = false, dash = false, je = false, end = pos, i = pos;
    for (;;) {
      TOK.lastIndex = i; const m = TOK.exec(s); if (!m) break;
      let kind = 0; for (let k = 1; k <= 8; k++) if (m[k] !== undefined) { kind = k; break; }
      const tstart = m.index + m[0].length - m[kind].length, mend = m.index + m[0].length;
      if (kind === 1) { je = true; hasMarker = true; }
      else if (kind === 2) {
        const n = +m[2];
        if ((prev === "의" || prev === "-") && items.length && items[items.length - 1].sub === null) {
          const it = items[items.length - 1]; it.sub = n; it.end = mend; if (prev === "-") dash = true;
        } else if ((prev === "의" || prev === "-") && items.length && pendingRange) {
          const it = items[items.length - 1]; it.subTo = n; it.end = mend;
        } else {
          if (prev === "num") break;  // 숫자가 연달아: 다른 문맥
          items.push({ num: n, sub: null, start: tstart, end: mend, je, ho: false, rangeFromPrev: pendingRange && items.length > 0 });
          pendingRange = false; je = false;
        }
        prev = "num"; end = mend; i = mend; continue;
      } else if (kind === 3) { if (!items.length) break; items[items.length - 1].ho = true; items[items.length - 1].end = mend; hasMarker = true; end = mend; }
      else if (kind >= 4 && kind <= 6) { if (!items.length) break; }
      else if (kind === 7) { if (!items.length) break; pendingRange = true; }
      else if (kind === 8) { if (!(prev === "range" || prev === "sep") || m[8] !== side) break; }
      prev = { 1: "je", 3: "ho", 4: "의", 5: "-", 6: "sep", 7: "range", 8: "side" }[kind];
      i = mend;
    }
    for (let k = 1; k < items.length; k++) {  // '갑 제1호증의 1, 2' → 두 번째 숫자는 1의 2
      const a = items[k - 1], b = items[k];
      if (a.sub !== null && b.sub === null && !b.je && !b.ho && !b.rangeFromPrev) { b.sub = b.num; b.num = a.num; }
    }
    return { items, end, hasMarker, dash };
  }

  function expand(side, items) {  // → [[key, start, end, inRange]], '내지'는 펼침(최대 200개)
    const out = [];
    items.forEach((it, idx) => {
      if (it.rangeFromPrev && out.length) {
        const a = items[idx - 1], b = it, bMarker = b.je || b.ho;
        if (a.sub !== null && b.sub !== null && b.num === a.num) {
          for (let s = a.sub + 1; s < Math.min(b.sub, a.sub + 200); s++) out.push([makeKey(side, a.num, s), a.start, b.end, 1]);
          out.push([makeKey(side, b.num, b.sub), b.start, b.end, 0]); return;
        }
        if (a.sub !== null && b.sub === null && !bMarker && b.num > a.sub) {
          for (let s = a.sub + 1; s < Math.min(b.num, a.sub + 200); s++) out.push([makeKey(side, a.num, s), a.start, b.end, 1]);
          out.push([makeKey(side, a.num, b.num), b.start, b.end, 0]); return;
        }
        for (let n = a.num + 1; n < Math.min(b.num, a.num + 200); n++) out.push([makeKey(side, n), a.start, b.end, 1]);
        out.push([makeKey(side, b.num, b.sub), b.start, b.end, 0]); return;
      }
      if (it.subTo && it.sub !== null) {
        for (let s = it.sub; s <= Math.min(it.subTo, it.sub + 200); s++) out.push([makeKey(side, it.num, s), it.start, it.end, s === it.sub ? 0 : 1]);
        return;
      }
      out.push([makeKey(side, it.num, it.sub), it.start, it.end, 0]);
    });
    return out;
  }

  const SIDE_RX = new RegExp("(?<![가-힣])(" + SIDE_PAT + ")(?=\\s*(?:제|\\d))", "g");
  function findRefs(text, allowBare = false) {  // → [{raw, start, end, side, refs:[[key, start, end, inRange]]}]
    const s = fixOcr(text), found = []; let lastEnd = -1, m;
    SIDE_RX.lastIndex = 0;
    while ((m = SIDE_RX.exec(s))) {
      if (m.index < lastEnd) continue;
      const side = m[1], r = parseAfter(s, m.index + m[0].length, side);
      if (!r.items.length) continue;
      const before = s.slice(Math.max(0, m.index - 1), m.index);
      const bareOk = allowBare || "([「【<〔".includes(before) && before !== "" || r.dash;
      if (!r.hasMarker && !bareOk) continue;
      const tail = s.slice(r.end, r.end + 1);
      if (!r.hasMarker && tail && "년월일원명개시분층동호".includes(tail)) continue;  // 단위 오인 방지
      r.items[0].start = m.index;  // 첫 번호의 범위에 '갑'까지
      const refs = expand(side, r.items); lastEnd = r.end;
      if (refs.length) found.push({ raw: text.slice(m.index, r.end), start: m.index, end: r.end, side, refs });
    }
    return found;
  }
  function firstLabel(text, allowBare = false) {  // 책갈피 제목 등: 가장 먼저 나온 단일 번호
    for (const f of findRefs(text, allowBare)) return f.refs.length === 1 ? f.refs[0][0] : null;
    return null;
  }
  return { fixOcr, makeKey, parseKey, label, labelKey, findRefs, firstLabel };
})();
if (typeof module !== "undefined") module.exports = Evid;  // node 시험용
