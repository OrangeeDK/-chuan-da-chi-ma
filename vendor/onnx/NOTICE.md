# Browser OCR dependencies

- ONNX Runtime Web 1.30.0, Microsoft, MIT License. Downloaded from the official npm package onnxruntime-web.
- Chinese PP-OCRv4 detection and recognition models, PaddlePaddle / PaddleOCR, Apache-2.0. Copied from rapidocr-onnxruntime 1.4.4 model distribution.
- Character dictionary extracted from the recognition model metadata, with CTC blank and space entries.
- Preprocessing and CTC decoding follow RapidOCR / PaddleOCR (Apache-2.0); browser implementation uses axis-aligned connected components for upright screenshots.

See bundled license files. All models and runtime files are served from this website; user screenshots are processed locally in the browser.
