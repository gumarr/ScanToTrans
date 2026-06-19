# ScanToTrans

App desktop: chụp vùng màn hình (kiểu ShareX) → OCR (Tesseract.js, local) → dịch bằng Google Gemini → hiển thị tooltip.

Xem [docs/PLAN.md](docs/PLAN.md) để biết quyết định kiến trúc.

## Chạy

```bash
npm install
npm run dev       # dev (HMR)
# hoặc
npm run build && npm run preview   # bản build production
```

Lần đầu mở app sẽ hiện cửa sổ **Settings** — nhập Gemini API key (lấy free tại https://aistudio.google.com/apikey) và chọn ngôn ngữ nguồn/đích.

### Dịch & fallback theo tầng
1. **Gemini** (chất lượng cao nhất). Có thể nhập **nhiều key** (mỗi dòng 1 key, mỗi key 1 Google project) → app tự xoay vòng khi 1 key gặp 429.
2. Cạn hết key Gemini → **Google Cloud Translation** (fallback, free 500k ký tự/tháng — cần bật API + billing, nhập key trong Settings).
3. Sang ngày mới (giờ Pacific — Gemini reset quota nửa đêm PT) → app tự về lại Gemini.

Tooltip hiển thị provider đang dùng (Gemini / Google Translate) để biết khi nào đã fallback.

## Hotkey

- `Ctrl+Alt+T` — chụp vùng & dịch
- `Ctrl+Alt+S` — mở Settings

## Trạng thái: PoC / MVP

Đã chạy được luồng: hotkey → overlay chọn vùng → crop → Tesseract OCR → Gemini dịch → tooltip.

### Lưu ý môi trường
Nếu shell có biến `ELECTRON_RUN_AS_NODE=1`, Electron sẽ chạy như Node thuần và app crash
(`Cannot read properties of undefined (reading 'handle')`). Script `npm run dev/preview` đã
tự xóa biến này qua [scripts/run.mjs](scripts/run.mjs).

### Việc còn lại (xem PLAN.md mục 7)
- Tải traineddata đa ngôn ngữ theo nhu cầu + quản lý trong Settings.
- Preprocessing ảnh (upscale/binarize) cải thiện OCR, đặc biệt CJK.
- Xử lý đa màn hình / DPI khi chụp vùng.
- Tối ưu warm worker, đo thời gian thực tế < 5s.
- Đóng gói electron-builder.
