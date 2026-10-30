"""JS 증거번호 인식(app/evidence.js)이 PC 기록철 evidence.py와 같은 결과인지 비교. python tests/evidence_parity.py"""
import json
import os
import subprocess
import sys

sys.path.insert(0, r"C:\Hound\Hound-casefile\app")
import evidence as ev  # noqa: E402

SAMPLES = [
    "원고는 피고에게 돈을 빌려주었습니다(갑 제1호증).",
    "갑제1호증의2, 갑 제1호증의 1 내지 3을 보면",
    "갑 제1호증 내지 제3호증", "갑 제1, 2호증", "을 제2호증의 1", "(갑 1-2)", "갑 1 내지 5", "[갑 3]",
    "을가 제1호증, 을나 제2호증의 3", "갑 제4호증의 1 내지 갑 제4호증의 3", "갑 제1호중의 2", "갑 재1호층", "갑 제l호증",
    "갑 2년 동안", "병 제3호증", "갑 제1호증의 1, 2", "을 제5호증 및 제6호증", "갑 제10호증 ~ 제12호증", "갑제 1 호증",
    "줄이\n바뀐 갑 제7\n호증", "갑 1년", "증거: 갑 3", "(을 2-1, 2-3)",
]


def py_refs(s):
    return [[r[0] for r in f["refs"]] for f in ev.find_refs(s)]


def main():
    js = r"""
const Evid = require(process.argv[1]);
const xs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(JSON.stringify(xs.map(s => Evid.findRefs(s).map(f => f.refs.map(r => r[0])))));
"""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "evidence.js")
    out = subprocess.run(["node", "-e", js, path], input=json.dumps(SAMPLES), capture_output=True, text=True, encoding="utf-8")
    if out.returncode:
        print(out.stderr)
        sys.exit(1)
    got = json.loads(out.stdout)
    bad = 0
    for s, j in zip(SAMPLES, got):
        p = py_refs(s)
        if p != j:
            bad += 1
            print("다름:", repr(s), "py", p, "js", j)
    print("같음 %d / %d" % (len(SAMPLES) - bad, len(SAMPLES)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
