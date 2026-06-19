# ScanToTrans — Kế hoạch kiến trúc

App desktop dịch thuật: chụp vùng màn hình (kiểu ShareX) → OCR → dịch bằng API AI → hiển thị qua tooltip. Mục tiêu phản hồi **< 5s**.

---

## 1. Quyết định công nghệ

| Hạng mục | Lựa chọn | Lý do |
|---|---|---|
| Khung app | **Electron + Vite** | Theo yêu cầu. Vite cho HMR nhanh, dev tiện. Dùng `electron-vite` để gộp main/preload/renderer |
| OCR | **Tesseract.js** (local, WASM) — provider duy nhất | Miễn phí tuyệt đối, offline, 100+ ngôn ngữ, tải traineddata theo nhu cầu. Khớp "free + OCR local OK + không AI local" |
| Dịch | **Google Gemini API** (Gemini Flash) | Free tier rộng, nhanh, rẻ. Người dùng tự nhập key. Kiến trúc provider để mở rộng sau |
| Ngôn ngữ | **Bắt buộc chọn ngôn ngữ nguồn thủ công trước khi OCR** | **KHÔNG auto-detect / KHÔNG multi-lang.** Xem mục 4 — auto-detect làm chậm + giảm chính xác |
| Bảo mật key | Lưu local, mã hóa bằng `safeStorage` (Electron) | Key người dùng không rời máy trừ khi gọi API |

**Nguyên tắc tốc độ:** OCR **chỉ vùng người dùng khoanh**, KHÔNG OCR toàn màn hình. Ảnh nhỏ → Tesseract 0.5–2s + Gemini Flash 1–2s = tổng < 5s.

---

## 2. Luồng người dùng (UX)

1. Người dùng nhấn **global hotkey** (vd `Ctrl+Alt+T`).
2. App mở **overlay toàn màn hình trong suốt** (giống ShareX) → người dùng kéo chọn vùng.
3. App chụp vùng đó → crop ảnh.
4. OCR vùng ảnh → text nguồn.
5. Gọi Gemini dịch → text đích.
6. Hiển thị **tooltip** gần vùng đã chọn (nguồn + bản dịch). Esc để đóng.

Trạng thái loading hiển thị ngay (spinner trong tooltip) để cảm giác phản hồi nhanh.

---

## 3. Kiến trúc kỹ thuật (Electron)

### Tiến trình Main
- Đăng ký global shortcut (`globalShortcut`).
- Quản lý cửa sổ: overlay chụp + tooltip (đều `frame:false, transparent:true, alwaysOnTop:true`).
- Chụp màn hình: `desktopCapturer` (lấy nguồn screen) hoặc native screenshot rồi crop theo toạ độ vùng chọn.
- Lưu/đọc cấu hình + API key (mã hóa `safeStorage`).
- Là nơi gọi HTTP tới Gemini / OCR.space (tránh CORS, giấu key khỏi renderer DOM).

### Preload
- `contextBridge` expose API an toàn: `captureRegion()`, `ocr(image, lang)`, `translate(text, opts)`, `get/setConfig()`.
- `contextIsolation: true`, `nodeIntegration: false`.

### Renderer (Vite + UI)
- UI overlay chọn vùng (canvas / div kéo thả).
- UI tooltip kết quả.
- UI settings: nhập API key, chọn provider OCR, chọn ngôn ngữ nguồn/đích, quản lý traineddata đã tải.
- Tesseract.js có thể chạy ở renderer (worker) HOẶC trong utility process — xem mục rủi ro.

### Module OCR (abstraction)
```
interface OcrProvider {
  recognize(imageBuffer, sourceLang): Promise<{ text, confidence }>
}
```
- `TesseractProvider` (mặc định) — quản lý tải `*.traineddata` theo ngôn ngữ, cache local.
- `OcrSpaceProvider` (tùy chọn) — gọi API, cần key.
Cho phép đổi provider trong settings.

### Module Translate (abstraction)
```
interface TranslateProvider {
  translate(text, { from, to }): Promise<string>
}
```
- `GeminiProvider` đầu tiên. Thiết kế interface để thêm OpenAI/Claude sau mà không sửa luồng chính.

---

## 4. Quản lý ngôn ngữ OCR (Tesseract) — KHÔNG auto-detect

**Quyết định chốt: bỏ auto-detect, người dùng BẮT BUỘC chọn ngôn ngữ nguồn trước khi OCR.**

Lý do (đã phân tích):
- Tesseract.js **không có auto-detect ngôn ngữ đúng nghĩa**. Cái gần nhất là nạp nhiều ngôn ngữ cùng lúc (`eng+jpn+...`) → **chậm 2–4x + tốn RAM + giảm chính xác** vì engine "phân vân". Đi ngược mục tiêu < 5s.
- OSD/script detection của Tesseract gốc không được Tesseract.js hỗ trợ đầy đủ, và vẫn là một pass thêm tốn thời gian.
- Người dùng chọn 1 ngôn ngữ → engine chạy **nhanh nhất + chính xác nhất**.

Quản lý traineddata:
- Không bundle sẵn mọi traineddata (sẽ phình app). Tải từ CDN khi chọn ngôn ngữ lần đầu, cache vào userData.
- Settings hiển thị danh sách ngôn ngữ đã tải + nút xóa.
- Preset phổ biến: `eng`, `vie`, `jpn`, `chi_sim`, `chi_tra`, `kor`.

**UX để việc "bắt buộc chọn ngôn ngữ" không phiền:**
- Nhớ ngôn ngữ nguồn/đích đã chọn lần trước (mặc định khi mở lại).
- Selector ngôn ngữ nguồn luôn hiển thị trên overlay chụp (đổi nhanh trước khi kéo chọn vùng).
- Hotkey preset đổi ngôn ngữ nhanh (vd `Ctrl+Alt+1/2/3`) — giai đoạn sau.

> Hybrid PaddleOCR cho CJK: **chỉ cân nhắc SAU** khi đo thực tế Tesseract CJK không đạt. Không cam kết Paddle ở giai đoạn này (chi phí đóng gói Python/ONNX lớn). Interface `OcrProvider` đã sẵn cho việc thêm sau.

---

## 5. Mục tiêu hiệu năng < 5s

- OCR chỉ vùng crop nhỏ.
- Khởi tạo Tesseract worker **một lần** (warm), tái sử dụng — tránh cold start mỗi lần.
- Giữ traineddata đã load trong worker giữa các lần dùng cùng ngôn ngữ.
- Gemini: dùng model Flash, prompt ngắn gọn, stream nếu cần cảm giác nhanh.
- Hiện spinner tooltip ngay khi bắt đầu để che latency.

---

## 6. Rủi ro & điểm cần xác minh (TODO trước khi code)

- [ ] **Tesseract.js trong Electron:** chạy ở renderer worker hay utility process? Cần kiểm tra đường dẫn `worker`/`wasm`/`lang` khi đóng gói (asar). Đây là điểm dễ vỡ nhất.
- [ ] **Chất lượng OCR CJK của Tesseract** đủ dùng không, hay cần preprocessing (upscale, threshold) ảnh trước OCR.
- [ ] **Đa màn hình + DPI scaling** khi chụp vùng (toạ độ phải đúng trên màn hình HiDPI).
- [ ] Xác nhận chính sách & giới hạn free tier Gemini hiện tại + model id chính xác.
- [ ] Xác nhận giới hạn thực tế OCR.space free (engine, ngôn ngữ) nếu làm fallback.
- [ ] Đóng gói: code signing / SmartScreen trên Windows (không bắt buộc giai đoạn đầu).

---

## 7. Lộ trình đề xuất (MVP → hoàn thiện)

**MVP (chứng minh luồng chạy được):**
1. Scaffold `electron-vite`.
2. Global hotkey → overlay chọn vùng → chụp + crop.
3. Tesseract.js OCR (1 ngôn ngữ: eng) → in ra text.
4. Gemini dịch → hiển thị tooltip.

**Giai đoạn 2:**
5. Settings: nhập/mã hóa Gemini key, chọn ngôn ngữ nguồn/đích.
6. Quản lý traineddata đa ngôn ngữ (tải theo nhu cầu).
7. Tối ưu hiệu năng (warm worker, preprocessing ảnh).

**Giai đoạn 3:**
8. OCR.space fallback tùy chọn.
9. Provider dịch bổ sung (OpenAI/Claude).
10. Đóng gói & phát hành (electron-builder).
