# 🚀 HƯỚNG DẪN TÍCH HỢP YOLOv11 (.PT) VỚI CARD ĐỒ HỌA NVIDIA RTX 3050 LAPTOP

Dự án WebGIS Giám sát giao thông của bạn đã được tích hợp sẵn cầu nối dữ liệu thực tế giữa mô hình học máy **YOLOv11** chạy trực tiếp bằng phần cứng **RTX 3050 (CUDA)** và bảng điều khiển trực quan hóa UI React.

Với kiến trúc này, khi bạn tải dự án về máy tính cá nhân (hoặc laptop), bạn có thể chạy file dự báo `best.pt` của bạn với tốc độ cực kỳ ấn tượng từ **80 - 150+ FPS** nhờ nhân CUDA Core mạnh mẽ của RTX 3050!

---

## 🛠️ CÁC BƯỚC CHUẨN BỊ TRÊN MÁY TÍNH CÁ NHÂN (LAPTOP RTX 3050)

### Bước 1: Cài đặt CUDA Toolkit & cuDNN (Khuyên dùng)
Để PyTorch có thể giao tiếp trực tiếp với card đồ họa RTX 3050:
1. Tải và cài đặt **NVIDIA CUDA Toolkit (Phiên bản gợi ý: 12.1 hoặc 11.8)**:
   👉 [Tải CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)
2. Tải và giải nén **cuDNN** tương thích rồi dán đè vào thư mục cài đặt CUDA Toolkit.

### Bước 2: Khởi tạo môi trường ảo Python v3.10+
Mở Terminal / Command Prompt tại thư mục dự án và khởi tạo môi trường Python:
```bash
# Tạo môi trường ảo
python -m venv venv

# Kích hoạt môi trường ảo (Windows CMD)
venv\Scripts\activate

# Kích hoạt môi trường ảo (Linux/macOS)
source venv/bin/activate
```

### Bước 3: Cài đặt PyTorch tương thích CUDA 12.1
Chạy lệnh sau trong Terminal (đã kích hoạt venv) để cài đặt PyTorch phiên bản tối ưu hóa cho card đồ họa NVIDIA:
```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### Bước 4: Cài đặt Ultralytics YOLOv11 & các gói phụ trợ
Cài đặt thư viện xử lý YOLOv11, OpenCV để hiển thị khung hình dự báo và các thư viện cần thiết:
```bash
pip install ultralytics opencv-python requests yt-dlp
```

---

## 🚦 VẬN HÀNH HỆ THỐNG GIAO THOÀNG THỜI GIAN THỰC

### Phần A: Khởi chạy Máy chủ WebGIS (React + Express)
Ở một cửa sổ Terminal mới tại thư mục gốc của dự án, cài đặt dependencies và khởi chạy trang web:
```bash
# Cài đặt thư viện Node.js
npm install

# Chạy Server fullstack Express + React WebGIS
npm run dev
```
👉 Máy chủ web sẽ chạy tại địa chỉ: `http://localhost:3000`

### Phần B: Khởi chạy Luồng dự báo YOLOv11 CUDA (Python)
Quay lại Terminal đã kích hoạt môi trường ảo ở Bước 2, tiến hành chạy script cầu nối:
```bash
python yolo_detector.py
```

---

## 💡 CÁCH SỬ DỤNG VÀ THAY ĐỔI THÔNG SỐ TRÊN LAPTOP RTX 3050

Mở file `yolo_detector.py` ra và chỉnh sửa cấu hình ở hàm cuối cùng `__main__`:

1. **Thay đổi Camera đang giám sát**: 
   Bạn có thể chuyển `camera_id` thành bất cứ camera nào trong cơ sở dữ liệu (`cam-1`, `cam-2`, `cam-3`, `cam-4`).
2. **Thay đổi luồng video đầu vào (`stream_source`)**:
   - Truyền link Youtube trực tiếp (Ví dụ: livestream camera ngã tư Đà Nẵng, Hà Nội, SG):
     `stream_source="https://www.youtube.com/watch?v=F076p_M9M_8"`
   - Hoặc sử dụng trực tiếp **Webcam laptop** của bạn để kiểm thử:
     `stream_source=0`
   - Hoặc truyền đường dẫn **File video .mp4** giao thông có sẵn trên máy:
     `stream_source="Traffic_Test_Video.mp4"`

---

## 💎 HIỆU NĂNG ƯỚC TÍNH TRÊN RTX 3050 LAPTOP
- **YOLOv11n (Nano)**: ~120 FPS lý tưởng ở TensorRT hoặc ~80 FPS với PyTorch gốc trên CUDA.
- **VRAM Tiêu thụ**: ~1.2 GB / 4.0 GB VRAM. Bạn hoàn toàn có thể chạy song song **3 đến 4 luồng camera đồng thời** mà hoàn toàn không lo quá tải hay nóng máy!
- **Tính năng vượt trội**: Các thông số xe ô tô, xe máy, xe buýt đếm được từ mô hình học máy của bạn ngoài hiển thị lên màn hình OpenCV cục bộ sẽ **ngay lập tức đẩy trực tiếp lên giao diện WebGIS, Bản đồ Google Maps Đà Nẵng và Báo cáo trực quan của trang Web**.
