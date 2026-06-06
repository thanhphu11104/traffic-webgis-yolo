"""
YOLOv11 MJPEG Stream — Simple Edition with Client-Side Dynamic Rendering
========================================================================
Kiến trúc kết hợp hiệu năng: 
- Thread/camera chạy phát hiện vật thể YOLO mộc (background)
- Flask render khung hình (boxes, labels, confidence) động theo từng yêu cầu client.
"""

import os
import cv2
import time
import threading
import requests
import numpy as np
from flask import Flask, Response, request

import torch
from ultralytics import YOLO
from vidgear.gears import CamGear

# ══════════════════════════════════════════════════════════════════════════════
#  Config — chỉnh ở đây
# ══════════════════════════════════════════════════════════════════════════════
BASE_API_URL  = "http://localhost:3000/api"
MJPEG_PORT    = 5010
JPEG_QUALITY  = 75
FRAME_W       = 1280
FRAME_H       = 720
DETECT_SKIP   = 2          # chạy YOLO mỗi N frame
MODEL_PATH    = "best.engine"

# Tự động tìm kiếm "best.pt" nếu "best.engine" không khả dụng
if not os.path.exists(MODEL_PATH) and os.path.exists("best.pt"):
    MODEL_PATH = "best.pt"

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

BOX_COLORS = {
    "car":        (246, 130,  59), # BGR format
    "motorcycle": (129, 185,  16),
    "truck":      (11,  158, 245),
    "bus":        (153,  72, 236),
    "bicycle":    (22,  204, 132),
}

# ══════════════════════════════════════════════════════════════════════════════
#  Global model (load 1 lần dùng chung)
# ══════════════════════════════════════════════════════════════════════════════
_model = None
_model_lock = threading.Lock()

def get_model():
    global _model
    with _model_lock:
        if _model is None:
            print(f"[*] Đang nạp model {MODEL_PATH} trên {DEVICE}...")
            _model = YOLO(MODEL_PATH)
            if MODEL_PATH.endswith(".pt"):
                _model.to(DEVICE)
            print(f"[+] Model OK: {list(_model.names.values())}")
    return _model


# ══════════════════════════════════════════════════════════════════════════════
#  Helper
# ══════════════════════════════════════════════════════════════════════════════
def classify_name(name: str, cls_id: int, total_classes: int) -> str | None:
    name = name.lower()
    if any(k in name for k in ["motorcycle", "moto", "scooter"]): return "motorcycle"
    if any(k in name for k in ["truck", "lorry"]):                return "truck"
    if any(k in name for k in ["bus"]):                           return "bus"
    if any(k in name for k in ["bicycle", "bike"]):               return "bicycle"
    if any(k in name for k in ["car"]):                           return "car"
    if total_classes == 5:
        return {0:"bicycle",1:"bus",2:"car",3:"motorcycle",4:"truck"}.get(cls_id)
    if total_classes >= 80:
        return {1:"bicycle",2:"car",3:"motorcycle",5:"bus",7:"truck"}.get(cls_id)
    return None

def draw_boxes(frame, detections, conf_threshold=0.25, enabled_classes=None, show_boxes=True, show_labels=True):
    if not show_boxes:
        return frame
    h, w = frame.shape[:2]
    for det in detections:
        conf = det["conf"]
        cls = det["class"]
        
        # Lọc theo thanh trượt Confidence của Client
        if conf < conf_threshold:
            continue
            
        # Lọc theo các Class được bật tắt của Client
        if enabled_classes is not None and cls not in enabled_classes:
            continue
            
        x1, y1, x2, y2 = (int(det["box"][i] * (w if i%2==0 else h)) for i in range(4))
        color = BOX_COLORS.get(cls, (160, 160, 160))
        
        # Vẽ bounding box
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        
        if show_labels:
            label = f"{cls} {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            ty = y1 - 4 if y1 > 20 else y1 + th + 6
            cv2.rectangle(frame, (x1, ty-th-2), (x1+tw+4, ty+2), color, -1)
            cv2.putText(frame, label, (x1+2, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255,255,255), 1, cv2.LINE_AA)
    return frame

def send_telemetry(camera_id, data):
    try:
        requests.post(f"{BASE_API_URL}/cameras/{camera_id}/telemetry",
                      json=data, timeout=2)
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════════
#  CamThread — 1 thread per camera
# ══════════════════════════════════════════════════════════════════════════════
class CamThread(threading.Thread):
    def __init__(self, camera_id, camera_name, video_url):
        super().__init__(daemon=True)
        self.camera_id   = camera_id
        self.camera_name = camera_name
        self.video_url   = video_url
        self.stop_event  = threading.Event()
        self.cap         = None

        # Lưu trữ ảnh gốc (raw) và nhận diện mọc để Flask render động
        self._raw_frame  = None
        self._last_detections = []
        self._state_lock = threading.Lock()

    def get_latest_data(self):
        with self._state_lock:
            if self._raw_frame is None:
                return None, []
            return self._raw_frame.copy(), list(self._last_detections)

    def _set_latest_data(self, frame, detections):
        with self._state_lock:
            self._raw_frame = frame.copy() if frame is not None else None
            self._last_detections = list(detections)

    def stop(self):
        self.stop_event.set()
        if self.cap:
            try:
                self.cap.stop()
            except Exception:
                pass
            self.cap = None

    def run(self):
        model = get_model()
        n_cls = len(model.names)
        frame_count = 0
        last_detections = []

        print(f"[+] CamThread '{self.camera_name}' khởi động: {self.video_url}")

        while not self.stop_event.is_set():
            # ── Mở stream ────────────────────────────────────────────────────
            self.cap = None
            try:
                self.cap = CamGear(source=self.video_url,
                                   stream_mode=True, logging=False).start()
            except Exception as e:
                print(f"[!] {self.camera_name}: Lỗi mở stream: {e}, thử lại 5s")
                time.sleep(5)
                continue

            if self.cap is None:
                print(f"[!] {self.camera_name}: cap is None, thử lại 5s")
                time.sleep(5)
                continue

            print(f"[+] {self.camera_name}: Stream mở OK")
            error_count = 0

            # ── Frame loop ───────────────────────────────────────────────────
            while not self.stop_event.is_set():
                frame = self.cap.read()
                if frame is None:
                    error_count += 1
                    if error_count > 20:
                        print(f"[!] {self.camera_name}: Mất stream, restart...")
                        break
                    time.sleep(0.05)
                    continue
                error_count = 0

                # Resize
                if frame.shape[1] != FRAME_W or frame.shape[0] != FRAME_H:
                    frame = cv2.resize(frame, (FRAME_W, FRAME_H))

                frame_count += 1

                # ── YOLO mỗi DETECT_SKIP frame ───────────────────────────────
                if frame_count % DETECT_SKIP == 0:
                    try:
                        # Chạy predict mộc trên khung hình raw
                        results = model.predict(
                            frame, device=DEVICE, verbose=False,
                            conf=0.15, imgsz=640, # conf thấp để client thoải mái drag lọc lên cao
                            half=(DEVICE == "cuda")
                        )
                        detections = []
                        if results:
                            h, w = frame.shape[:2]
                            for box in results[0].boxes:
                                cls_id = int(box.cls[0].item())
                                conf   = float(box.conf[0].item())
                                name   = model.names[cls_id]
                                cls    = classify_name(name, cls_id, n_cls)
                                if not cls:
                                    continue
                                xyxy = box.xyxy[0].tolist()
                                detections.append({
                                    "class": cls,
                                    "conf":  conf,
                                    "box":   [xyxy[0]/w, xyxy[1]/h,
                                              xyxy[2]/w, xyxy[3]/h],
                                })
                        last_detections = detections

                        # Telemetry gửi thống kê cho WebGIS
                        counts = {}
                        for d in detections:
                            counts[d["class"]] = counts.get(d["class"], 0) + 1
                        total = sum(counts.values())
                        status = ("congested" if total > 28
                                  else "moderate" if total > 14 else "normal")
                        threading.Thread(
                            target=send_telemetry,
                            args=(self.camera_id, {
                                "vehicleCount": total,
                                "trafficStatus": status,
                                **{f"{k}Count": v for k, v in counts.items()}
                            }),
                            daemon=True
                        ).start()

                    except Exception as e:
                        print(f"[!] {self.camera_name} YOLO lỗi: {e}")

                # Cập nhật khung hình Raw và danh sách nhận dạng mới nhất
                self._set_latest_data(frame, last_detections)

            # ── Cleanup ───────────────────────────────────────────────────────
            try:
                if self.cap:
                    self.cap.stop()
            except Exception:
                pass
            self.cap = None

            if not self.stop_event.is_set():
                print(f"[*] {self.camera_name}: Restart sau 3s...")
                time.sleep(3)

        print(f"[-] CamThread '{self.camera_name}' dừng")


# ══════════════════════════════════════════════════════════════════════════════
#  Flask MJPEG
# ══════════════════════════════════════════════════════════════════════════════
flask_app    = Flask(__name__)
cam_workers  = {}   # camera_id → CamThread
workers_lock = threading.Lock()

# Placeholder JPEG khi chưa có frame
_placeholder = None
def get_placeholder(camera_id):
    global _placeholder
    if _placeholder is None:
        f = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
        cv2.putText(f, f"Camera {camera_id} -- dang ket noi...",
                    (40, FRAME_H//2), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (160, 160, 160), 1)
        _, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 70])
        _placeholder = buf.tobytes()
    return _placeholder


def generate_mjpeg(camera_id, conf_threshold=0.25, enabled_classes=None, show_boxes=True, show_labels=True):
    conn_id = f"conn_{camera_id}_{threading.get_ident()}_{int(time.time()*1000)}"
    register_connection(camera_id, conn_id)

    try:
        while True:
            # Cập nhật ping của kết nối này để chứng minh socket vẫn active
            update_connection_ping(camera_id, conn_id)

            raw_frame = None
            detections = []
            worker = None
            
            with workers_lock:
                worker = cam_workers.get(camera_id)
                
            if worker is None or worker.stop_event.is_set():
                print(f"[*] Worker camera {camera_id} đã bị dừng hoặc không tồn tại. Thoát stream generator.")
                break

            raw_frame, detections = worker.get_latest_data()

            if raw_frame is None:
                jpeg = get_placeholder(camera_id)
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                       + jpeg + b"\r\n")
                time.sleep(0.2)
                continue
            else:
                # Copy frame gốc để vẽ tự do theo thông số Client gửi lên
                annotated = raw_frame.copy()
                draw_boxes(annotated, detections, conf_threshold, enabled_classes, show_boxes, show_labels)

                # Đếm số xe thực đạt chuẩn điều kiện của Client
                active_count = sum(1 for d in detections if d["conf"] >= conf_threshold and (enabled_classes is None or d["class"] in enabled_classes))
                count_txt = f"{active_count} xe duoc loc"
                
                cv2.putText(annotated, f"{worker.camera_name} | {count_txt}",
                            (8, 22), cv2.FONT_HERSHEY_SIMPLEX,
                            0.55, (255, 255, 255), 1, cv2.LINE_AA)

                ret, buf = cv2.imencode(
                    ".jpg", annotated,
                    [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                )
                if ret:
                    jpeg = buf.tobytes()
                else:
                    jpeg = get_placeholder(camera_id)
                    
                time.sleep(0.033)  # giới hạn ~30fps

            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                   + jpeg + b"\r\n")

    except GeneratorExit:
        print(f"[*] Generator {conn_id} đã bị ngắt bởi Flask/Client.")
    except Exception as e:
        print(f"[!] Generator {conn_id} lỗi: {e}")
    finally:
        unregister_connection(camera_id, conn_id)


# ══════════════════════════════════════════════════════════════════════════════
#  On-Demand Stream Management (Quản lý luồng theo yêu cầu)
# ══════════════════════════════════════════════════════════════════════════════
db_cameras_cache = {}
db_cache_lock = threading.Lock()

# Quản lý nhịp tim tương tác của từng kết nối
# Cấu trúc: { camera_id: { conn_id: last_ping_time } }
active_connections = {}
conn_lock = threading.Lock()

def get_camera_info(camera_id):
    with db_cache_lock:
        if camera_id in db_cameras_cache:
            return db_cameras_cache[camera_id]
    
    # Nhánh dự phòng: Truy vấn API chính trực tiếp
    try:
        r = requests.get(f"{BASE_API_URL}/cameras/{camera_id}", timeout=3)
        if r.status_code == 200 and r.json().get("success"):
            return r.json().get("camera")
    except Exception as e:
        print(f"[!] Lỗi truy vấn thông tin camera {camera_id}: {e}")
    return None

def start_worker_if_needed(camera_id):
    with workers_lock:
        # Lấy thông tin camera mới nhất từ DB/cache
        cam_info = get_camera_info(camera_id)
        if not cam_info:
            print(f"[!] Không tìm thấy cấu hình camera_id {camera_id} để khởi động luồng")
            return False

        current_url  = cam_info.get("youtubeUrl", "")
        if not current_url:
            print(f"[!] Camera {camera_id} không cấu hình URL luồng phát (youtubeUrl)")
            return False

        if camera_id in cam_workers:
            existing_worker = cam_workers[camera_id]
            # Nếu URL của camera bị thay đổi so với URL luồng đang chạy -> Buộc dừng luồng cũ để khởi tạo luồng mới với URL mới!
            if existing_worker.video_url != current_url:
                print(f"[*] Phát hiện URL camera {camera_id} thay đổi: {existing_worker.video_url} -> {current_url}. Khởi động lại worker!")
                existing_worker.stop()
                try:
                    del cam_workers[camera_id]
                except KeyError:
                    pass
            elif not existing_worker.stop_event.is_set():
                return True
            else:
                # Dọn dẹp luồng cũ bị treo hoặc đã set dừng
                try:
                    cam_workers[camera_id].stop()
                except Exception:
                    pass
                del cam_workers[camera_id]

        name = cam_info.get("name", str(camera_id))
        print(f"[*] KHỞI CHẠY LUỒNG NHẬN DIỆN CAMERA ON-DEMAND: {name} | URL: {current_url}")
        w = CamThread(camera_id, name, current_url)
        cam_workers[camera_id] = w
        w.start()
        return True

def register_connection(camera_id, conn_id):
    with conn_lock:
        if camera_id not in active_connections:
            active_connections[camera_id] = {}
        active_connections[camera_id][conn_id] = time.time()
        print(f"[+] Đăng ký kết nối: {conn_id}. Hiện tại cho '{camera_id}': {len(active_connections[camera_id])}")

def update_connection_ping(camera_id, conn_id):
    with conn_lock:
        if camera_id in active_connections and conn_id in active_connections[camera_id]:
            active_connections[camera_id][conn_id] = time.time()

def unregister_connection(camera_id, conn_id):
    with conn_lock:
        if camera_id in active_connections and conn_id in active_connections[camera_id]:
            del active_connections[camera_id][conn_id]
            count = len(active_connections[camera_id])
            print(f"[-] Hủy đăng ký kết nối: {conn_id}. Còn lại: {count}")
            # Nếu thật sự không còn ai xem nữa, tắt worker camera sau khoảng trễ ngắn
            if count == 0:
                threading.Thread(
                    target=stop_worker_after_delay,
                    args=(camera_id,),
                    daemon=True
                ).start()

def stop_worker_after_delay(camera_id):
    # Để phòng trường hợp người dùng chỉnh thanh trượt slider đổi conf (gây ngắt kết nối rồi mở lại ngay lập tức)
    # Ta trì hoãn 1.5 giây trước khi thực sự ngắt stream
    time.sleep(1.5)
    with conn_lock:
        still_has_viewers = camera_id in active_connections and len(active_connections[camera_id]) > 0
    
    if not still_has_viewers:
        with workers_lock:
            if camera_id in cam_workers:
                print(f"[*] GIẢI PHÓNG CAMERA {camera_id}: Không hoạt động")
                cam_workers[camera_id].stop()
                try:
                    del cam_workers[camera_id]
                except KeyError:
                    pass

def connection_cleaner_loop():
    """Luồng dọn dẹp các kết nối bị sập socket không thể gửi tín hiệu unmount"""
    print("[*] Khởi động Luồng dọn dẹp kết nối mồ côi (Connection Heartbeat Cleaner)...")
    while True:
        time.sleep(2)
        now = time.time()
        cameras_to_cleanup = []
        
        with conn_lock:
            for camera_id, conns in list(active_connections.items()):
                for conn_id, last_time in list(conns.items()):
                    # Nếu hơn 5 giây không cập nhật ping (bị sập/đóng tab/mất mạng) -> tự động dọn dẹp
                    if now - last_time > 5.0:
                        print(f"[!] Tự dọn dẹp kết nối chết: {conn_id} (đã 5 giây không hoạt động)")
                        del conns[conn_id]
                
                if len(conns) == 0:
                    cameras_to_cleanup.append(camera_id)
        
        # Ngắt các worker thật sự rảnh
        for camera_id in cameras_to_cleanup:
            with workers_lock:
                if camera_id in cam_workers:
                    print(f"[*] AUTO CLEANUP GIẢI PHÓNG CAMERA {camera_id}: Không thấy phản hồi nào cập nhật nhịp tim.")
                    cam_workers[camera_id].stop()
                    try:
                        del cam_workers[camera_id]
                    except KeyError:
                        pass


@flask_app.route("/stream/<camera_id>")
def video_feed(camera_id):
    # Khởi chạy luồng OpenCV + YOLO cho camera này khi có người yêu cầu xem
    if not start_worker_if_needed(camera_id):
        return Response("Camera stream không khả dụng", status=404)

    conf = request.args.get("conf", default=0.25, type=float)
    classes_raw = request.args.get("classes", default="car,motorcycle,truck,bus,bicycle", type=str)
    show_boxes = request.args.get("show_boxes", default="true", type=str).lower() == "true"
    show_labels = request.args.get("show_labels", default="true", type=str).lower() == "true"
    
    enabled_classes = [c.strip() for c in classes_raw.split(",") if c.strip()]
    
    return Response(generate_mjpeg(camera_id, conf, enabled_classes, show_boxes, show_labels),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


@flask_app.route("/stop_view/<camera_id>", methods=["GET", "POST", "OPTIONS"])
def stop_view(camera_id):
    if request.method == "OPTIONS":
        res = flask_app.make_response(("", 200))
        res.headers["Access-Control-Allow-Origin"] = "*"
        res.headers["Access-Control-Allow-Headers"] = "*"
        res.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return res

    print(f"[*] NHẬN ĐƯỢC TÍN HIỆU DỪNG XEM CHỦ ĐỘNG CHO CAMERA {camera_id}")
    
    with conn_lock:
        if camera_id in active_connections:
            print(f"[*] Xóa sạch các phiên active của camera {camera_id}: {list(active_connections[camera_id].keys())}")
            active_connections[camera_id].clear()

    # Bàn giao việc dọn dẹp cho unregister_connection hoặc connection_cleaner để tránh race condition
    with workers_lock:
        if camera_id in cam_workers:
            print(f"[*] DỪNG LUỒNG NHẬN DIỆN CAMERA NGAY LẬP TỨC CHỦ ĐỘNG: {camera_id}")
            cam_workers[camera_id].stop()
            try:
                del cam_workers[camera_id]
            except KeyError:
                pass

    res = flask_app.make_response(({"success": True, "message": f"Dừng stream {camera_id}"}, 200))
    res.headers["Access-Control-Allow-Origin"] = "*"
    res.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return res


@flask_app.route("/health")
def health():
    with workers_lock:
        cams = list(cam_workers.keys())
    return {"status": "ok", "cameras": cams, "device": DEVICE}


# ══════════════════════════════════════════════════════════════════════════════
#  Sync camera từ DB
# ══════════════════════════════════════════════════════════════════════════════
def sync_cameras():
    global db_cameras_cache
    try:
        r = requests.get(f"{BASE_API_URL}/cameras", timeout=3)
        if r.status_code != 200 or not r.json().get("success"):
            return
        cameras = r.json().get("cameras", [])
        db_ids  = {cam["id"] for cam in cameras}

        # Lưu trữ danh sách camera vào cache local
        with db_cache_lock:
            db_cameras_cache = {cam["id"]: cam for cam in cameras}

        with workers_lock:
            # Chỉ dọn dẹp máy trạm camera không còn tồn tại trong Cơ sở dữ liệu
            for cid in list(cam_workers):
                if cid not in db_ids:
                    print(f"[-] Camera {cid} đã bị xóa từ DB chính. Giải phóng worker...")
                    cam_workers[cid].stop()
                    del cam_workers[cid]

    except Exception as e:
        print(f"[!] sync_cameras: {e}")


# ══════════════════════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════════════════════
def main():
    print("=" * 55)
    print("  YOLOv11 MJPEG Stream — Simple Edition with Client-Side Dynamic Rendering")
    print(f"  Device : {DEVICE}")
    print(f"  Port   : {MJPEG_PORT}")
    print(f"  Model  : {MODEL_PATH}")
    print(f"  Skip   : YOLO mỗi {DETECT_SKIP} frame")
    print(f"  JPEG   : {JPEG_QUALITY}% @ {FRAME_W}x{FRAME_H}")
    print("=" * 55)

    get_model()  # load model trước

    # Khởi chạy luồng dọn dẹp các kết nối lỗi/mồ côi chạy ẩn
    cleaner_thread = threading.Thread(
        target=connection_cleaner_loop,
        daemon=True
    )
    cleaner_thread.start()

    flask_thread = threading.Thread(
        target=lambda: flask_app.run(
            host="0.0.0.0", port=MJPEG_PORT,
            threaded=True, use_reloader=False
        ),
        daemon=True
    )
    flask_thread.start()
    print(f"[OK] Stream: http://localhost:{MJPEG_PORT}/stream/<camera_id>")
    print(f"[OK] Health: http://localhost:{MJPEG_PORT}/health\n")

    try:
        while True:
            sync_cameras()
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n[*] Đang tắt...")
        with workers_lock:
            for w in cam_workers.values():
                w.stop()


if __name__ == "__main__":
    main()
