"""公网部署入口：只提供页面和截图识别，不提供本地登录/链接测试接口。"""
import base64
import io
import json
import struct
import threading
from pathlib import Path
from urllib.parse import urlparse

from server import ROOT, recognize_image

OCR_SLOT = threading.BoundedSemaphore(1)
ASSETS = {'/': 'index.html', '/index.html': 'index.html', '/product-size.js': 'product-size.js', '/browser-ocr.js': 'browser-ocr.js'}
ASSETS['/assets/orange-watercolor.png'] = 'assets/orange-watercolor.png'
ASSETS['/assets/orange-cartoon-a.png'] = 'assets/orange-cartoon-a.png'
ASSETS.update({'/' + name: name for name in ('glass-layout.js', 'glass-theme.css', 'dark-theme.css')})
ASSETS.update({'/' + p.relative_to(ROOT).as_posix(): p.relative_to(ROOT).as_posix()
               for p in (ROOT / 'assets').rglob('*')
               if p.is_file() and p.suffix in ('.png', '.webp', '.ttf', '.woff2', '.txt')})
ASSETS.update({'/vendor/onnx/' + p.name: 'vendor/onnx/' + p.name
               for p in (ROOT / 'vendor/onnx').glob('*')
               if p.is_file() and p.suffix in ('.js', '.mjs', '.wasm', '.onnx', '.json')})


def application(environ, start_response):
    def respond(status, data, content_type='application/json; charset=utf-8'):
        body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode('utf-8')
        start_response(status, [('Content-Type', content_type), ('Content-Length', str(len(body))),
                                ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff')])
        return [body]

    path = environ.get('PATH_INFO', '/')
    method = environ.get('REQUEST_METHOD', 'GET')
    if method == 'GET' and path in ASSETS:
        suffix = Path(ASSETS[path]).suffix
        mime = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
                '.mjs': 'application/javascript; charset=utf-8', '.wasm': 'application/wasm',
                '.json': 'application/json; charset=utf-8', '.png': 'image/png',
                '.woff2': 'font/woff2', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf',
                '.txt': 'text/plain; charset=utf-8'}.get(suffix, 'application/octet-stream')
        return respond('200 OK', (ROOT / ASSETS[path]).read_bytes(), mime)
    if method == 'GET' and path == '/health':
        return respond('200 OK', {'status': 'ok'})
    if path != '/api/ocr':
        return respond('404 Not Found', {'error': '不存在该接口。'})
    if method != 'POST':
        return respond('405 Method Not Allowed', {'error': '请通过上传截图使用识别。'})
    origin = environ.get('HTTP_ORIGIN')
    if origin and urlparse(origin).netloc != environ.get('HTTP_HOST'):
        return respond('403 Forbidden', {'error': '请从当前网站上传截图。'})
    try:
        length = int(environ.get('CONTENT_LENGTH') or 0)
        if length <= 0 or length > 12 * 1024 * 1024:
            return respond('413 Payload Too Large', {'error': '请选择不超过 8 MB 的截图。'})
        data = json.loads(environ['wsgi.input'].read(length))
        if not isinstance(data, dict) or not isinstance(data.get('image'), str):
            raise ValueError('图片数据无效，请重新上传。')
        raw = base64.b64decode(data['image'], validate=True)
        if len(raw) > 8 * 1024 * 1024 or not raw.startswith(b'\x89PNG\r\n\x1a\n') or len(raw) < 24:
            raise ValueError('图片数据无效，请重新上传。')
        width, height = struct.unpack('>II', raw[16:24])
        if not (0 < width <= 2400 and 0 < height <= 2400):
            raise ValueError('图片尺寸过大，请通过页面上传截图。')
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as image:
            image.verify()
        if not OCR_SLOT.acquire(blocking=False):
            return respond('429 Too Many Requests', {'error': '正在处理另一张截图，请稍后再试。'})
        try:
            result = recognize_image(data['image'])
        finally:
            OCR_SLOT.release()
        return respond('200 OK', result)
    except (ValueError, OSError, struct.error):
        return respond('400 Bad Request', {'error': '图片未完整识别，请换一张清晰的尺码表截图重试。'})
    except Exception:
        return respond('503 Service Unavailable', {'error': '识别服务暂时不可用，请稍后重试。'})


if __name__ == '__main__':
    # 本机检查部署入口；线上由 Docker 中的 Gunicorn 启动。
    from wsgiref.simple_server import make_server
    make_server('127.0.0.1', 8766, application).serve_forever()
