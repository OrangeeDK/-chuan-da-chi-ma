"""本机商品尺码预览：静态页面、公开链接试读、Windows OCR；不调用云端服务。"""
import argparse
import base64
import html
import io
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import time
import queue
import uuid
import unicodedata
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parent
ALLOWED = ('douyin.com', 'jinritemai.com')
OCR_LOCK = threading.Lock()
OCR_ENGINE = None
LOGIN_LOCK = threading.Lock()
LOGIN_PROCESS = None
LOGIN_REPLIES = None

def login_request(action, url=None):
    global LOGIN_PROCESS, LOGIN_REPLIES
    with LOGIN_LOCK:
        if LOGIN_PROCESS is None or LOGIN_PROCESS.poll() is not None:
            if action != 'login': raise ValueError('登录窗口已关闭，请重新点击登录抖音。')
            LOGIN_REPLIES=queue.Queue()
            LOGIN_PROCESS=subprocess.Popen(['node',str(ROOT/'product-link-worker.cjs'),'--session'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
            def receive(process, replies):
                for line in process.stdout:
                    try: replies.put(json.loads(line))
                    except json.JSONDecodeError: pass
                replies.put({'error':'登录浏览器已关闭，请重新打开。'})
            threading.Thread(target=receive,args=(LOGIN_PROCESS,LOGIN_REPLIES),daemon=True).start()
        request_id=uuid.uuid4().hex
        LOGIN_PROCESS.stdin.write(json.dumps({'id':request_id,'action':action,'url':url})+'\n')
        LOGIN_PROCESS.stdin.flush()
        deadline=time.monotonic()+50
        while True:
            try: reply=LOGIN_REPLIES.get(timeout=max(.01,deadline-time.monotonic()))
            except queue.Empty: raise ValueError('登录浏览器读取超时，请保持窗口打开后重试。')
            if reply.get('id') not in (None,request_id): continue
            if reply.get('error'): raise ValueError(reply['error'])
            return reply['data']

def classify_chart(text):
    text = unicodedata.normalize('NFKC',text)
    category = 'pants' if re.search('腰围|腰宽',text) and not re.search('胸围|胸宽',text) else 'top'
    if re.search(r'适合.*(?:胸围|腰围)|身体(?:胸围|腰围)',text): mode = 'body'
    elif re.search('胸宽|腰宽|半胸围|半腰围|单面宽度',text): mode = 'flat'
    elif re.search('成衣|衣服.*围',text) or (re.search('胸围|腰围',text) and re.search('衣长|裤长|袖长',text)): mode = 'garment'
    else: mode = ''
    unit = 'inch' if re.search('英寸|inch',text,re.I) else 'cm' if re.search('厘米|cm',text,re.I) else ''
    inferred = False
    if not unit and mode in ('garment','flat'):
        # 仅在多个独立尺寸列均有证据时推断 cm，不能把所有无单位图片默认成厘米。
        ranges = {'衣长':(35,150),'裤长':(60,140),'肩宽':(25,80),'袖长':(20,110),'胸围':(70,220),'腰围':(50,180),'胸宽':(35,110),'腰宽':(25,90)}
        lines = [re.split(r'[,，\t|;；:：\s]+',line.strip()) for line in text.splitlines() if line.strip()]
        headers = None; records = []
        for cols in lines:
            if cols and cols[0] in ('尺码','码数','size','SIZE') and any(c in ranges for c in cols):
                headers=cols;continue
            if headers and cols and re.match(r'^(?:[2-6]?X{0,3}[SML]|\d{2,3}(?:/\d{2,3}[A-Z]?)?|均码|F)$',cols[0],re.I):
                if len(cols)!=len(headers): continue
                record={}
                for key,value in zip(headers,cols):
                    if key in ranges and re.fullmatch(r'\d+(?:\.\d+)?',value): record[key]=float(value)
                records.append(record)
            elif headers and records: break
        if len(records)>=2:
            common=set(records[0])
            for record in records[1:]: common.intersection_update(record)
            has_length=bool(common.intersection(('衣长','裤长','袖长')))
            has_width=bool(common.intersection(('肩宽','胸围','腰围','胸宽','腰宽')))
            if has_length and has_width and all(ranges[key][0]<=record[key]<=ranges[key][1] for key in common for record in records):
                unit='cm';inferred=True
    return {'category':category,'mode':mode,'unit':unit,'unitInferred':inferred,'easeMin':2 if category == 'pants' else 8,'easeMax':6 if category == 'pants' else 14}

def local_model_ocr(image):
    """优先使用本机已安装的模型，避免 Windows 中文 OCR 漏识单独的尺码字母。"""
    global OCR_ENGINE
    try:
        from rapidocr_onnxruntime import RapidOCR
        import numpy as np
        from PIL import Image
        import io
    except ImportError:
        return None
    with OCR_LOCK:
        if OCR_ENGINE is None:
            OCR_ENGINE = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)
        with Image.open(io.BytesIO(image)) as source:
            result, _ = OCR_ENGINE(np.asarray(source.convert('RGB')))
    words = []
    for box,text,confidence in result or []:
        # 保留原始识别文本，不根据相邻尺码或数值猜补内容。
        x = min(point[0] for point in box); y = min(point[1] for point in box)
        words.append({'text':text, 'x':float(x), 'y':float(y), 'width':float(max(point[0] for point in box)-x), 'height':float(max(point[1] for point in box)-y)})
    return {'words':words,'engine':'local-model'}

def validate_url(url, domains=ALLOWED):
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
        raise ValueError('请使用有效的抖音商品 http/https 链接。')
    if not any(host == domain or host.endswith('.' + domain) for domain in domains):
        raise ValueError('当前仅尝试读取抖音或抖音电商域名的链接。')
    addresses = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('该链接无法作为公开商品页面读取。')
    return url

class SafeRedirect(HTTPRedirectHandler):
    def __init__(self, domains=ALLOWED):
        super().__init__()
        self.domains = domains
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl, self.domains)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class TableReader(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.tables = []
        self.rows = []
        self.cells = []
        self.cell = None
    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            if not self.depth: self.rows = []
            self.depth += 1
        if self.depth:
            if tag == 'tr': self.cells = []
            if tag in ('td', 'th'): self.cell = []
    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)
    def handle_endtag(self, tag):
        if self.depth:
            if tag in ('td', 'th') and self.cell is not None:
                self.cells.append(''.join(self.cell).strip().replace('\n', ' '))
                self.cell = None
            if tag == 'tr' and self.cells: self.rows.append('\t'.join(self.cells))
            if tag == 'table':
                self.depth -= 1
                if not self.depth: self.tables.append('\n'.join(self.rows))

def read_product(url):
    validate_url(url)
    opener = build_opener(SafeRedirect())
    with opener.open(Request(url, headers={'User-Agent':'Mozilla/5.0', 'Accept':'text/html'}), timeout=12) as response:
        final_url = validate_url(response.url)
        if 'text/html' not in response.headers.get('Content-Type', ''):
            raise ValueError('链接没有返回可读取的商品页面，请上传尺码表截图。')
        raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024: raise ValueError('页面过大，请改用尺码表截图。')
        page = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
    parser = TableReader()
    parser.feed(page)
    candidates = [table for table in parser.tables if re.search(r'尺码|码数|size', table, re.I) and re.search(r'胸围|腰围|胸宽|腰宽', table)]
    # 只返回显式 HTML 表格，不从商品名称、SKU 或无关文案推测数值。
    if len(candidates) > 1: raise ValueError('页面包含多个候选尺码表，请上传所选款式的尺码表截图。')
    text = html.unescape(candidates[0]) if candidates else ''
    if not text:
        return read_dynamic_product(final_url)
    # 单位/测量说明可能在表格附近，而不在单元格里。
    context = re.sub('<[^>]+>',' ',page)
    return {'url':final_url,'text':text,'metadata':classify_chart(text + '\n' + context)}

def valid_link_chart(text, metadata):
    if metadata['unit'] not in ('cm','inch') or metadata['mode'] not in ('body','flat','garment'):
        return False
    code = 'const p=require(process.argv[1]);try{const r=p.parseChart(process.argv[2],process.argv[3]);process.exit(r.length>=2?0:1)}catch{process.exit(1)}'
    result = subprocess.run(['node','-e',code,str(ROOT/'product-size.js'),text,metadata['category']],capture_output=True,timeout=5)
    return result.returncode == 0

def read_dynamic_product(url):
    if LOGIN_PROCESS is not None and LOGIN_PROCESS.poll() is None:
        data=login_request('read',url)
    else:
        process = subprocess.run(['node',str(ROOT/'product-link-worker.cjs'),url],capture_output=True,timeout=45)
        if process.returncode:
            raise ValueError('商品页面自动加载未完成，请稍后重试或上传尺码表截图。')
        data = json.loads(process.stdout.decode('utf-8'))
    validate_url(data['url'])
    if data.get('diagnostics'):
        print('LINK_DIAGNOSTIC '+json.dumps(data['diagnostics'],ensure_ascii=True),flush=True)
    candidates = []
    for text in data.get('tables',[]):
        meta=classify_chart(text+'\n'+data.get('text',''))
        if valid_link_chart(text,meta): candidates.append({'text':text,'metadata':meta})
    # 从商品详情图片识别尺码表，复用上传截图的同一 OCR 与表格校验。
    image_domains=('ecombdimg.com','byteimg.com','douyin.com','jinritemai.com')
    deadline=time.monotonic()+25
    for item in data.get('images',[])[:8]:
        if time.monotonic()>deadline: break
        try:
            image_url=validate_url(item['url'],image_domains)
            with build_opener(SafeRedirect(image_domains)).open(Request(image_url,headers={'User-Agent':'Mozilla/5.0'}),timeout=6) as response:
                raw=response.read(8*1024*1024+1)
            if len(raw)>8*1024*1024: continue
            from PIL import Image
            with Image.open(io.BytesIO(raw)) as image:
                if image.width*image.height>20000000: continue
                image.thumbnail((2400,2400));converted=io.BytesIO();image.convert('RGB').save(converted,format='PNG')
            chart=recognize_image(base64.b64encode(converted.getvalue()).decode())
            if valid_link_chart(chart['text'],chart['metadata']): candidates.append(chart)
        except (ValueError,OSError): continue
    unique={candidate['text'].strip():candidate for candidate in candidates}
    if len(unique)>1: raise ValueError('商品详情中发现多个尺码表，请上传你所选款式的尺码表截图。')
    if unique:
        result=next(iter(unique.values()))
        return {'url':data['url'],'text':result['text'],'metadata':result['metadata'],'source':'detail-image-or-table'}
    if data.get('requiresLogin'):
        raise ValueError('抖音详情仍要求登录。请点击登录抖音，在新窗口完成登录后重试；若已登录，可能该商品详情仍仅支持在 App 查看。')
    raise ValueError('商品页面已加载，但未找到可读取的详情尺码表。请上传商品详情中的尺码表截图。')

def recognize_image(encoded):
    try: image = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError): raise ValueError('图片数据无效，请重新上传。')
    if not image.startswith(b'\x89PNG\r\n\x1a\n') or len(image) > 8 * 1024 * 1024:
        raise ValueError('请上传不超过 8 MB 的有效截图。')
    data = local_model_ocr(image)
    if data is None:
        with tempfile.TemporaryDirectory(prefix='size-ocr-') as temp:
            image_path = Path(temp) / 'chart.png'
            image_path.write_bytes(image)
            process = subprocess.run(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'ocr.ps1'), '-ImagePath', str(image_path)], capture_output=True, timeout=35)
            if process.returncode: raise ValueError('本机文字识别未完成，请检查截图或 Windows 中文识别语言包，也可直接粘贴尺码表文字。')
            data = json.loads(process.stdout.decode('utf-8-sig'))
            data['engine'] = 'windows'
    words = sorted(data.get('words', []), key=lambda w: (w['y'] + w['height']/2, w['x']))
    lines = []
    for word in words:
        center = word['y'] + word['height']/2
        if lines and abs(center - lines[-1]['center']) < max(6, word['height'] * .45):
            lines[-1]['words'].append(word)
        else:
            lines.append({'center':center, 'words':[word]})
    def assemble(line):
        ordered = sorted(line['words'], key=lambda w:w['x'])
        text = ''
        previous = None
        for word in ordered:
            gap = word['x'] - (previous['x'] + previous['width']) if previous else 0
            # OCR 将中文和数字拆成多个词；相邻字符合并，明显的列间距保留空格。
            if previous and (data['engine'] == 'local-model' or gap > max(6, min(previous['height'],word['height']) * .55)): text += ' '
            text += word['text']
            previous = word
        return text
    text = '\n'.join(assemble(line) for line in lines)
    if not text.strip(): raise ValueError('未识别到文字，请上传更清晰的尺码表截图。')
    return {'text':text,'engine':data['engine'],'metadata':classify_chart(text)}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()
    def do_POST(self):
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        if host not in ('127.0.0.1:%s' % self.server.server_port, 'localhost:%s' % self.server.server_port) or (origin and origin not in ('http://' + host,)):
            return self.respond(403, {'error':'请从本机预览页面使用识别服务。'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > 12 * 1024 * 1024: raise ValueError('请求大小无效。')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict): raise ValueError('请求格式无效。')
            if self.path == '/api/ocr': result = recognize_image(data.get('image'))
            elif self.path == '/api/product-login': result = login_request('login')
            elif self.path == '/api/product-link':
                url = data.get('url', '')
                if not isinstance(url, str) or len(url) > 4096: raise ValueError('链接无效。')
                result = read_product(url)
            else: return self.respond(404, {'error':'不存在该接口。'})
            self.respond(200, result)
        except (ValueError, json.JSONDecodeError) as error:
            self.respond(400, {'error':str(error)})
        except Exception:
            self.respond(502, {'error':'读取未完成，页面可能需要登录或加载。请上传尺码表截图，或粘贴表格文字。'})
    def respond(self, code, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False
    def server_bind(self):
        if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        super().server_bind()

if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--port', type=int, default=8765)
    port = args.parse_args().port
    print('商品尺码预览：http://127.0.0.1:%s/index.html' % port, flush=True)
    LocalServer(('127.0.0.1', port), Handler).serve_forever()
