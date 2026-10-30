"""시험용 가짜 통합기록 PDF(책갈피 3단계, 8쪽, 가로 쪽 하나). 실제 사건 자료 아님. python tests/make_fake.py <저장할 PDF>"""
import sys

import pymupdf as fitz

FONT = r"C:\Windows\Fonts\malgun.ttf"
out = sys.argv[1]
d = fitz.open()
for i in range(8):
    w, h = (842, 595) if i == 5 else (595, 842)
    p = d.new_page(width=w, height=h)
    p.insert_font(fontname="mg", fontfile=FONT)
    p.insert_text((60, 80), "가짜 통합기록 %d쪽" % (i + 1), fontname="mg", fontsize=20)
    for k in range(20):
        p.insert_text((60, 130 + k * 28), "가짜 본문 줄 %d. 원고는 피고에게 금 1,000만 원을 빌려주었습니다(갑 제%d호증)." % (k + 1, k % 3 + 1), fontname="mg", fontsize=11)
d.set_toc([[1, "목차", 1], [1, "본안 기록", 2], [2, "2026. 3. 5. 소장 (원고)", 2], [3, "소장", 2], [3, "갑 제1호증", 3],
           [4, "갑 제1호증의1 (가짜 등기부등본)", 3], [4, "갑 제1호증의2 (가짜 계산서)", 4], [2, "2026. 4. 10. 답변서 (피고)", 5],
           [1, "갑호증", 6], [2, "갑 제2호증 가짜 사진", 6], [1, "나란히 보기 (가로 화면용)", 8]])
d.subset_fonts()  # 맑은 고딕을 통째로 넣지 않게(파일 작게)
d.save(out, garbage=3, deflate=True)
print(out)
