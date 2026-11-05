# Hound-pdf-tab (하운드 PDF 탭판) 작업 안내

자세한 기능, 판별 변경: README.md

## 하는 일
- 갤럭시 탭에서 인터넷 없이 기록철 통합기록 PDF를 보고 S펜으로 표시하는 웹앱(PWA). 정적 파일만(`app/`).
- 사용자는 한국어로 말하는 코딩 비전문가(팀장님). 하운드 공통 규칙(hound-rules) 따름.

## 꼭 지킬 것
- 바깥으로 보내는 요청 없음(서버, 분석, 글꼴 CDN 모두 금지). 파일은 탭 안에서만, 최근 파일 사본은 이 탭 IndexedDB에만.
- 의뢰인, 사건 자료(이름, 사건번호, 기록 내용)를 코드, 커밋, 시험 자료에 넣지 않는다. 시험은 `tests/make_fake.py`가 만든 가짜 통합기록.
- 원본을 잃지 않는다: [저장]으로 원래 파일을 덮기 전, 그 파일의 지금 내용을 IndexedDB `backups`에 옛 판으로(파일 이름마다 최근 3개, app.js backupBeforeOverwrite). 옛 판을 못 남기면 덮지 않고 내려받기로(2026-11-06 점검).
- 증거번호 규칙은 PC 기록철 app/evidence.py와 같게(`app/evidence.js`, 시험 `python tests/evidence_parity.py`).
- 화면 모양이 바뀌는 것은 시안 먼저.

## 판 올리기
- 앱 파일을 고치면 `app/app.js` APP_VER와 `app/sw.js` VERSION(houndpdf-tab-N)을 같이 올린다(탭이 새 판을 받음).
- 이 저장소 작업 세션은 로컬 master 커밋까지. main push와 gh-pages 공개는 총괄 세션이 한다. 다 만들면 총괄에 커밋 해시와 판 번호.
- 커밋은 한국어, 작성자 `lawhound2507 <336872960+lawhound2507@users.noreply.github.com>`. 강제 push 금지.

## 시험(PC)
- `python -m http.server 47410 --bind 127.0.0.1 --directory C:\Hound\Hound-pdf-tab` 뒤 `http://localhost:47410/app/`.
- 화면이 숨겨지면 pdf.js 그리기와 requestAnimationFrame이 멈추니 시험 전 브라우저 탭을 앞으로.
- 저장 시험은 가짜 파일 핸들(getFile, createWritable)로 save(false)를 불러 덮어쓰기와 옛 판을 확인.
