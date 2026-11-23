"""아카이브 앱 자동 테스트 — 실제로 문제가 났던 쇼핑몰 모양들을 다시 확인해요.

실행: python tests/run_tests.py   (playwright 필요: pip install playwright && python -m playwright install chromium)
쇼핑몰에 실제로 접속하지 않아요. 페이지 모양을 본뜬 가짜 페이지(window.__testPages)로만 확인해요.
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = "file://" + str(ROOT / "www" / "index.html")
fails, passes = [], 0


def check(name, got, want):
    global passes
    if got == want:
        passes += 1
        print(f"  ✓ {name}")
    else:
        fails.append(name)
        print(f"  ✗ {name}\n      기대: {json.dumps(want, ensure_ascii=False)}\n      실제: {json.dumps(got, ensure_ascii=False)}")


def words(rows):
    return [dict(t=t, x=x, y=y, w=w, h=h) for t, x, y, w, h in rows]


# ---------- 가짜 쇼핑몰 페이지 ----------
LONG = "뒷목 중심 ~ 소매 끝까지의 기장 (레글런 숄더 디테일로 인함)"
def tea_block(sz, a, b, c):
    return f'<div class="sz">{sz}</div><table><tr><td>가슴 단면</td><td>{a}</td></tr><tr><td>총장</td><td>{b}</td></tr><tr><td>{LONG}</td><td>{c}</td></tr></table>'

PAGES = {
    # 테아트리노: 사이즈마다 표가 따로
    "https://t.test/teatrino": "<html><body><h3>사이즈 정보</h3>" + tea_block(5, 59, 71, 87) + tea_block(6, 61, 73, 89) + "</body></html>",
    # 바버샵: '[ 42 ]' 괄호 사이즈
    "https://t.test/barber": '<html><body><p>Size (단위 : cm)</p><table><tr><td>Tag size</td><td>[ 42 ]</td><td>[ 44 ]</td><td>[ 46 ]</td></tr><tr><td>어깨</td><td>47</td><td>48.5</td><td>50</td></tr><tr><td>가슴</td><td>60</td><td>63</td><td>66</td></tr><tr><td>총장</td><td>68</td><td>69</td><td>70</td></tr></table></body></html>',
    # 일반 가로형
    "https://t.test/horiz": "<html><body><table><tr><td>cm</td><td>S</td><td>M</td></tr><tr><td>가슴</td><td>55</td><td>57</td></tr></table></body></html>",
    # 도큐먼트(식스샵): 옵션 '(품절)' 글자 + 표 안의 S·M은 재고가 아님
    "https://t.test/sixshop": '<html><body><table><tr><td>사이즈Size</td><td>가슴단면</td></tr><tr><td>S</td><td>63</td></tr><tr><td>M</td><td>65</td></tr></table><div class="productOption"><ul><li><span>S (품절)</span></li><li><span>M</span></li><li><span>L</span></li><li><span>XL (품절)</span></li></ul></div></body></html>',
    # 제라도(쇼피파이): 'US 8 1/2 (26.5cm)' + '환불 불가' 옵션
    "https://t.test/products/vaudeville": '<html><body><div class="shopify-section"></div></body></html>',
    "https://t.test/products/vaudeville.js": json.dumps({"title": "V", "vendor": "JELADO", "price": 109539800, "images": [], "variants": [
        {"option1": "Black", "option2": "US 8 (26cm)", "option3": "환불 불가", "available": True},
        {"option1": "Black", "option2": "US 8 1/2 (26.5cm)", "option3": "환불 불가", "available": False},
        {"option1": "Black", "option2": "US 9 (27cm)", "option3": "환불 불가", "available": True}]}),
    # 쇼피파이 색상 × 사이즈
    "https://t.test/products/chino": '<html><body><div class="shopify-section"></div></body></html>',
    "https://t.test/products/chino.js": json.dumps({"title": "CHINO", "vendor": "X", "price": 2000000, "images": [], "variants": [
        {"option1": "Khaki", "option2": "30", "available": True}, {"option1": "Khaki", "option2": "32", "available": False},
        {"option1": "Olive", "option2": "30", "available": False}, {"option1": "Olive", "option2": "32", "available": True}]}),
    # 카페24 색상-사이즈 옵션
    "https://t.test/cafe24": '''<html><head><meta property="og:title" content="WORK JACKET"><meta property="product:price:amount" content="289000"></head><body><script>var option_stock_data = '{\\"P1\\":{\\"option_value_orginal\\":\\"BLACK-M\\",\\"stock_number\\":0,\\"use_stock\\":true,\\"is_selling\\":\\"T\\"},\\"P2\\":{\\"option_value_orginal\\":\\"BLACK-L\\",\\"stock_number\\":2,\\"use_stock\\":true,\\"is_selling\\":\\"T\\"},\\"P3\\":{\\"option_value_orginal\\":\\"NAVY-M\\",\\"stock_number\\":3,\\"use_stock\\":true,\\"is_selling\\":\\"T\\"},\\"P4\\":{\\"option_value_orginal\\":\\"NAVY-L\\",\\"stock_number\\":0,\\"use_stock\\":true,\\"is_selling\\":\\"T\\"}}';</script></body></html>''',
    # 리노스토어: 카페24 옵션에 안내 문구가 섞임
    "https://t.test/rino": "<html><body><script>var option_stock_data = '" + json.dumps({"P1": {"option_value_orginal": "8-가죽제품 교환/환불 불가", "stock_number": 2, "use_stock": True, "is_selling": "T"}, "P2": {"option_value_orginal": "8 1/2-가죽제품 교환/환불 불가", "stock_number": 0, "use_stock": True, "is_selling": "T"}}, ensure_ascii=False).replace('"', '\\"') + "';</script></body></html>",
    # 코릴라: 주문 제작 문구
    "https://t.test/korilla": '<html><head><meta property="og:title" content="N1_0.1 CXL (Black)"></head><body><p>모든 제품은 주문과 동시에 제작이 되며 현재 주문시 약 18주정도 소요됩니다</p></body></html>',
    # 페이지 안 상품 데이터
    "https://t.test/script": '<html><body><script>window.__DATA__={"options":[{"name":"240","soldOut":true},{"name":"245","soldOut":false},{"name":"250","soldOut":false}],"d":"' + "x" * 300 + '"}</script></body></html>',
}


def run():
    with sync_playwright() as p:
        b = p.chromium.launch()
        errs = []

        # ---- 1) 쇼핑몰 페이지 읽기 ----
        pg = b.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script("window.__testPages=" + json.dumps(PAGES) + ";")
        pg.goto(INDEX); pg.wait_for_timeout(1200)
        rd = lambda u, expr: pg.evaluate("([u,e])=>window.archiveReadProduct(u).then(P=>(new Function('P','return '+e))(P))", [u, expr])

        print("사이즈표")
        check("테아트리노: 따로 있는 표 합치기", rd("https://t.test/teatrino", "P.chart"),
              {"cols": ["5", "6"], "rows": [["가슴 단면", "59", "61"], ["총장", "71", "73"], [LONG, "87", "89"]]})
        check("바버샵: 괄호 사이즈", rd("https://t.test/barber", "P.chart"),
              {"cols": ["42", "44", "46"], "rows": [["어깨", "47", "48.5", "50"], ["가슴", "60", "63", "66"], ["총장", "68", "69", "70"]]})
        check("가로형 표", rd("https://t.test/horiz", "P.chart"), {"cols": ["S", "M"], "rows": [["가슴", "55", "57"]]})

        print("재고")
        check("식스샵: (품절) 글자, 표 안 S·M 제외", rd("https://t.test/sixshop", "P.stock"), {"S": "out", "M": "in", "L": "in", "XL": "out"})
        check("제라도: US 8 1/2 (26.5cm) → 265mm, 환불 불가 제외", rd("https://t.test/products/vaudeville", "P.stock"), {"260": "in", "265": "out", "270": "in"})
        check("리노스토어: 카페24 옵션 안내 문구 빼기", [rd("https://t.test/rino", "P.stock"), rd("https://t.test/rino", "P.stockBy||null")], [{"8": "in", "8.5": "out"}, None])
        check("쇼피파이 색상별", rd("https://t.test/products/chino", "P.stockBy"), {"Khaki": {"30": "in", "32": "out"}, "Olive": {"30": "out", "32": "in"}})
        check("카페24 색상별", rd("https://t.test/cafe24", "P.stockBy"), {"BLACK": {"M": "out", "L": "in"}, "NAVY": {"M": "in", "L": "out"}})
        check("색상 골라 재고 보기", rd("https://t.test/cafe24", "archiveStockFor(P,'navy')"), {"M": "in", "L": "out"})
        check("페이지 안 상품 데이터", rd("https://t.test/script", "P.stock"), {"240": "out", "245": "in", "250": "in"})
        check("코릴라: 주문 제작 감지", rd("https://t.test/korilla", "[!!P.mto,!!P.closed]"), [True, False])

        print("신발 사이즈")
        A = "window.archiveChart"
        check("mm 옵션 → 나라별 표", pg.evaluate(f"{A}.shoeChart(['250','260'],true).rows.map(r=>r[0]+':'+r.slice(1).join('/'))"),
              ["발 길이(mm):250/260", "JP(cm):25/26", "US:7/8", "UK:6/7", "EU:40/41"])
        check("리노스토어 대응표 'US 8 : 260'", pg.evaluate(f"(()=>{{const P={A}.sizePairsFrom('SIZE(cm) 8 : 260 8 1/2 : 265');return {A}.shoeChart(['8','8.5'],true,P).cols}})()"), ["260", "265"])
        check("옷 사이즈를 신발로 착각 안 함", pg.evaluate(f"{A}.shoeChart(['36','38','40'],false)"), None)
        check("반 사이즈 · cm 표기", pg.evaluate(f"['US 8 1/2','US 8 1/2 (26.5cm)','US 6(24CM)','M','Medium (42)'].map({A}.sizeKey)"), ["8.5", "265", "240", "M", "42"])
        check("비긴202 '1size(예약발송)'", pg.evaluate(f"['1size(12월10일 예약발송)','2사이즈','SIZE 3'].map({A}.sizeKey)"), ["1", "2", "3"])
        txt = "<p>사이즈<br>-1사이즈 : 허리 37.5cm / 밑위 33.5cm / 허벅지 33cm / 밑단 29cm / 총장<br>107cm<br>-2사이즈 : 허리 39.5cm / 밑위 34cm / 허벅지 34cm / 밑단 30cm / 총장<br>108cm</p><p>모델 정보<br>-Height 178cm / Bust 86cm / Waist 66cm / 2사이즈</p>"
        check("글로 쓴 사이즈표 (비긴202)", pg.evaluate("(h=>{const d=new DOMParser().parseFromString(h,'text/html');const c=" + A + ".findChart(d);return c&&[c.cols,c.rows.map(r=>r.join(':'))]})", txt),
              [["1", "2"], ["허리:37.5:39.5", "밑위:33.5:34", "허벅지:33:34", "밑단:29:30", "총장:107:108"]])

        print("앱 알아보기 · 접속 안 함")
        check("캡처한 앱 알아보기", pg.evaluate("['나의 할인가 197,210원','즉시 구매가','ZARA 코트','에이블리','올리브영 오늘드림','가격 14,910원'].map(t=>window.archiveShot.detect(t))"),
              ["musinsa", "kream", "zara", "ably", "oliveyoung", None])
        check("robots.txt 규칙", pg.evaluate("[__robotsOk('User-agent: *\\nDisallow: /member/','/product/1'),__robotsOk('User-agent: *\\nDisallow: /','/p'),__robotsOk('User-agent: *\\nDisallow: /\\nAllow: /product/','/product/a')]"), [True, False, True])
        check("큰 플랫폼 링크는 접속 안 함", pg.evaluate("Promise.all(['https://www.musinsa.com/products/1','https://kream.co.kr/products/1','https://smartstore.naver.com/a/products/1','https://www.oliveyoung.co.kr/x'].map(u=>window.archiveReadProduct(u).then(()=>'읽음',e=>e.noFetch?'막음':'오류')))"),
              ["막음", "막음", "막음", "막음"])

        print("목록 카드")
        check("재고 있는 사이즈 전부 보여주기", pg.evaluate("""()=>{ITEMS.push({id:'c1',kind:'wish',c:'top',name:'S',sellers:[{url:'https://x/1',shop:'x',stock:{S:'out',M:'in',L:'in'}}]},
            {id:'c2',kind:'wish',c:'shoes',name:'B',sellers:[{url:'https://x/2',shop:'x',mto:true}]});renderPins();
            return [...document.querySelectorAll('.pst')].map(e=>e.textContent)}"""), ["재고 M · L", "✂ 주문 제작 가능"])
        check("내 사이즈 기준 위아래 한 칸", pg.evaluate("""()=>{ITEMS.length=0;ITEMS.push({id:'w1',kind:'wish',c:'shoes',name:'B',size:'270',sellers:[{url:'https://x/9',shop:'x',stock:{'250':'in','260':'in','265':'out','270':'in','275':'out','280':'in'}}]});renderPins();
            return [...document.querySelectorAll('.pst .w')].map(e=>e.textContent)}"""), ["265 품절", "270 ✓", "275 품절"])
        check("공식몰 재고 우선", pg.evaluate("""()=>{ITEMS.length=0;ITEMS.push({id:'j1',kind:'wish',c:'shoes',brand:'JELADO',name:'V',size:'270',sellers:[{url:'https://jelado.com/p',shop:'JELADO',stock:{'270':'in','275':'out'}},{url:'https://rino.test/p',shop:'rino',stock:{'280':'in'}}]});renderPins();
            return [...document.querySelectorAll('.pst')].map(e=>e.textContent)}"""), ["270 ✓275 품절"])
        pg.close()

        # ---- 2) 캡처 읽기 (폰 글자 읽기를 흉내) ----
        print("캡처")
        tea_words = words([("사이즈", 365, 670, 140, 50), ("정보", 510, 670, 90, 50), ("5", 90, 845, 20, 36), ("가슴", 205, 955, 55, 34), ("단면", 265, 955, 65, 34), ("59", 680, 955, 38, 34),
                           ("총장", 240, 1065, 58, 34), ("71", 680, 1065, 38, 34), ("6", 90, 1380, 20, 36), ("가슴", 205, 1490, 55, 34), ("단면", 265, 1490, 65, 34), ("61", 680, 1490, 38, 34),
                           ("총장", 240, 1600, 58, 34), ("73", 680, 1600, 38, 34)])
        pg = b.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script("window.__W=" + json.dumps(tea_words) + ";window.Capacitor={isNativePlatform:()=>true,Plugins:{ArchiveOcr:{read:async()=>({words:window.__W,text:window.__W.map(w=>w.t).join(' ')})}}};")
        pg.goto(INDEX); pg.wait_for_timeout(1200)
        check("사이즈표 캡처로 열린 옷 채우기", pg.evaluate("""async()=>{ITEMS.push({id:'tt',kind:'wish',c:'outer',name:'A',sellers:[]});openDetail('tt');
            await window.archiveShot.from('data:image/jpeg;base64,AAAA');return ITEMS.find(x=>x.id==='tt').chart}"""),
              {"cols": ["5", "6"], "rows": [["가슴 단면", "59", "61"], ["총장", "71", "73"]]})
        prod = words([("킥스", 200, 142, 70, 40), ("모노리스", 148, 1085, 125, 40), ("[허율x모노리스]", 44, 1382, 300, 46), ("DRAPE", 358, 1382, 130, 46), ("(BLACK)", 500, 1382, 200, 46),
                      ("304,000원", 42, 1775, 160, 30), ("15%", 42, 1828, 92, 46), ("258,400원", 148, 1828, 230, 46), ("197,210원", 76, 1960, 205, 42), ("나의", 292, 1965, 50, 30), ("할인가", 345, 1965, 100, 30)])
        r = pg.evaluate("w=>{const o=window.archiveShot.read(w,968,2376);return [o.brand,o.title,o.price]}", prod)
        check("상품 캡처: 브랜드 · 이름 · 가격", r, ["모노리스", "[허율x모노리스] DRAPE (BLACK)", 258400])
        begin = words([("BEGIN", 54, 1458, 40, 14), ("2.0.2", 96, 1458, 26, 14), ("비긴202", 148, 1448, 128, 40), ("ⓘ", 286, 1450, 30, 34), ("6.9만", 832, 1450, 78, 34),
                       ("2026년", 106, 1592, 90, 34), ("10월", 200, 1592, 60, 34), ("1주차", 270, 1592, 70, 34), ("코튼", 350, 1592, 60, 34), ("팬츠", 415, 1592, 60, 34), ("3위", 480, 1592, 40, 34),
                       ("바지", 44, 1672, 58, 34), (">", 115, 1674, 14, 30), ("코튼", 145, 1672, 60, 34), ("팬츠", 210, 1672, 60, 34), ("(비긴202)", 280, 1672, 140, 34),
                       ("엣지", 44, 1745, 80, 46), ("워크", 134, 1745, 80, 46), ("라보", 224, 1745, 80, 46), ("팬츠", 314, 1745, 80, 46), ("[카키", 404, 1745, 110, 46), ("올리브]", 524, 1745, 140, 46)])
        r = pg.evaluate("w=>{const o=window.archiveShot.read(w,968,2376);return [o.brand,o.title,(o.ens||[])[0]]}", begin)
        check("숫자 붙은 브랜드 로고 'BEGIN 2.0.2' → begin202", r, ["비긴202", "엣지 워크 라보 팬츠 [카키 올리브]", "BEGIN202"])
        pg.close()

        print("기타 화면")
        pg = b.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(INDEX); pg.wait_for_timeout(1200)
        check("순위 기본 1~3 + 칸 늘리기", pg.evaluate("""()=>{openRec();setKind('wish');const a=[...document.querySelectorAll('#fPrio [data-p]')].map(b=>b.dataset.p).join('');
            document.querySelector('#fPrio [data-p-add]').click();const c=[...document.querySelectorAll('#fPrio [data-p]')].map(b=>b.dataset.p).join('');localStorage.removeItem('archive-prio-max');return [a,c]}"""), ["123", "1234"])
        pg.evaluate("document.getElementById('gdAgain').click()"); pg.wait_for_timeout(300)
        check("가이드 7쪽", pg.evaluate("document.querySelectorAll('#gd .gdp').length"), 7)
        pg.close()

        check("화면 스크립트 오류 없음", errs, [])
        b.close()


if __name__ == "__main__":
    run()
    print(f"\n통과 {passes} · 실패 {len(fails)}")
    if fails:
        print("실패한 테스트: " + ", ".join(fails))
        sys.exit(1)
