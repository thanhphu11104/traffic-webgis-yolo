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
import logging
from flask import Flask, Response, request

import torch
from ultralytics import YOLO
from vidgear.gears import CamGear

# Cấu hình tắt hoàn toàn cảnh báo/warning từ VidGear để làm sạch console log
logging.getLogger("vidgear").setLevel(logging.ERROR)

# ══════════════════════════════════════════════════════════════════════════════
#  Config — chỉnh ở đây
# ══════════════════════════════════════════════════════════════════════════════
BASE_API_URL  = "http://127.0.0.1:3000/api"
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
_predict_lock = threading.Lock()

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
        # Để tránh block luồng gọi (ví dụ Flask), tắt CamGear trong một luồng phụ độc lập
        cap_to_stop = self.cap
        self.cap = None
        if cap_to_stop:
            def _close_cap():
                try:
                    cap_to_stop.stop()
                except Exception:
                    pass
            threading.Thread(target=_close_cap, daemon=True).start()

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
                if self.stop_event.is_set():
                    break
                
                # Mở stream bằng một biến tạm để tránh race condition nếu bị stop() gọi giữa chừng
                temp_cap = CamGear(source=self.video_url, stream_mode=True, logging=False).start()
                
                if self.stop_event.is_set():
                    # Nếu bị dừng ngay lúc đang mở đầu, lập tức ngắt stream để dọn dẹp
                    if temp_cap is not None:
                        try:
                            temp_cap.stop()
                        except Exception:
                            pass
                    break
                
                self.cap = temp_cap
            except Exception as e:
                print(f"[!] {self.camera_name}: Lỗi mở stream: {e}, thử lại 5s")
                self.stop_event.wait(5)
                continue

            if self.cap is None:
                print(f"[!] {self.camera_name}: cap is None, thử lại 5s")
                self.stop_event.wait(5)
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
                        # Chạy predict mộc trên khung hình raw với khóa ghim tranh chấp TensorRT
                        with _predict_lock:
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
                        telemetry_detections = list(detections)
                        
                        # Nếu camera có cấu hình vùng nhận diện, lọc thống kê gửi đi theo vùng ROI
                        cam_info = get_camera_info(self.camera_id)
                        detection_zone = cam_info.get("detectionZone") if cam_info else None
                        if detection_zone and len(detection_zone) >= 3:
                            pts = np.array([[int(p['x'] * FRAME_W), int(p['y'] * FRAME_H)] for p in detection_zone], dtype=np.int32)
                            filtered_telemetry = []
                            for d in telemetry_detections:
                                cx = int((d["box"][0] + d["box"][2]) / 2 * FRAME_W)
                                cy = int((d["box"][1] + d["box"][3]) / 2 * FRAME_H)
                                inside = cv2.pointPolygonTest(pts, (cx, cy), False) >= 0
                                if inside:
                                    filtered_telemetry.append(d)
                            telemetry_detections = filtered_telemetry

                        counts = {"car": 0, "motorcycle": 0, "truck": 0, "bus": 0, "bicycle": 0}
                        for d in telemetry_detections:
                            cls = d["class"]
                            if cls in counts:
                                counts[cls] += 1
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
                self.stop_event.wait(3)

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


def generate_mjpeg(camera_id, conf_threshold=0.25, enabled_classes=None, show_boxes=True, show_labels=True, use_roi=True):
    conn_id = f"conn_{camera_id}_{threading.get_ident()}_{int(time.time()*1000)}"
    register_connection(camera_id, conn_id)
    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + get_placeholder(camera_id) + b"\r\n"
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

                # Kiểm tra và áp dụng bộ lọc ROI và vẽ đa giác lên khung hình
                cam_info = get_camera_info(camera_id)
                detection_zone = cam_info.get("detectionZone") if cam_info else None
                
                if use_roi and detection_zone and len(detection_zone) >= 3:
                    pts = np.array([[int(p['x'] * FRAME_W), int(p['y'] * FRAME_H)] for p in detection_zone], dtype=np.int32)
                    
                    # Vẽ đa giác chỉ dẫn màu vàng cam quyến rũ
                    cv2.polylines(annotated, [pts], isClosed=True, color=(14, 185, 246), thickness=2)
                    
                    # Ghim text trạng thái vùng ROI hoạt động
                    cv2.putText(annotated, "ROI FILTER ACTIVE", (FRAME_W - 180, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (14, 185, 246), 1, cv2.LINE_AA)
                    
                    # Lọc các bounding box nằm ngoài đa giác
                    filtered_detections = []
                    for d in detections:
                        cx = int((d["box"][0] + d["box"][2]) / 2 * FRAME_W)
                        cy = int((d["box"][1] + d["box"][3]) / 2 * FRAME_H)
                        inside = cv2.pointPolygonTest(pts, (cx, cy), False) >= 0
                        if inside:
                            filtered_detections.append(d)
                    detections = filtered_detections

                draw_boxes(annotated, detections, conf_threshold, enabled_classes, show_boxes, show_labels)

                # Đếm số xe thực đạt chuẩn điều kiện của Client
                active_count = sum(1 for d in detections if d["conf"] >= conf_threshold and (enabled_classes is None or d["class"] in enabled_classes))
                count_txt = f"{active_count} xe duoc loc"
                if use_roi and detection_zone and len(detection_zone) >= 3:
                    count_txt += " (vung ROI)"
                
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

active_connections = {}
conn_lock = threading.Lock()

def get_camera_info_from_sqlite(camera_id):
    import sqlite3
    import json
    db_paths = [
        "database.sqlite",
        "../database.sqlite",
        os.path.join(os.path.dirname(__file__), "database.sqlite"),
        os.path.join(os.path.dirname(__file__), "..", "database.sqlite")
    ]
    db_path = None
    for p in db_paths:
        if os.path.exists(p):
            db_path = p
            break
    if not db_path:
        return None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, youtubeUrl, yoloConfig, detectionZone FROM cameras WHERE id = ?", (camera_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            try:
                yolo_cfg = json.loads(row[3]) if row[3] else {}
            except Exception:
                yolo_cfg = {}
            try:
                det_zone = json.loads(row[4]) if row[4] else []
            except Exception:
                det_zone = []
            return {
                "id": row[0],
                "name": row[1],
                "youtubeUrl": row[2],
                "yoloConfig": yolo_cfg,
                "detectionZone": det_zone
            }
    except Exception as e:
        print(f"[!] Fallback SQLite query error for camera {camera_id}: {e}")
    return None


def get_camera_info(camera_id):
    with db_cache_lock:
        if camera_id in db_cameras_cache:
            return db_cameras_cache[camera_id]
    
    if camera_id == "temp":
        return None

    # Nhánh dự phòng: Truy vấn SQLite trực tiếp (Cực kỳ mạnh mẽ và không lo nghẽn mạng)
    sqlite_cam = get_camera_info_from_sqlite(camera_id)
    if sqlite_cam:
        with db_cache_lock:
            db_cameras_cache[camera_id] = sqlite_cam
        return sqlite_cam

    # Nhánh dự phòng phụ: Truy vấn API chính trực tiếp
    try:
        r = requests.get(f"{BASE_API_URL}/cameras/{camera_id}", timeout=1)
        if r.status_code == 200 and r.json().get("success"):
            return r.json().get("camera")
    except Exception:
        pass

    return None


def start_worker_if_needed(camera_id):
    with workers_lock:
        cam_info = get_camera_info(camera_id)
        if not cam_info:
            print(f"[!] Không tìm thấy cấu hình camera_id {camera_id} để khởi động luồng")
            return False

        current_url  = cam_info.get("youtubeUrl", "")
        if not current_url:
            print(f"[!] Camera {camera_id} không cấu hình URL luồng phát (youtubeUrl)")
            return False

        current_name = cam_info.get("name", f"Camera {camera_id}")

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
            elif existing_worker.is_alive() and not existing_worker.stop_event.is_set():
                return True
            else:
                try:
                    existing_worker.stop()
                except Exception:
                    pass
                try:
                    del cam_workers[camera_id]
                except KeyError:
                    pass

        print(f"[*] KHỞI CHẠY LUỒNG NHẬN DIỆN CAMERA: {current_name} | URL: {current_url}")
        w = CamThread(camera_id, current_name, current_url)
        cam_workers[camera_id] = w
        w.start()
        return True


def register_connection(camera_id, conn_id):
    with conn_lock:
        if camera_id not in active_connections:
            active_connections[camera_id] = set()
        active_connections[camera_id].add(conn_id)
        print(f"[+] Đăng ký kết nối: {conn_id}. Hiện tại cho '{camera_id}': {len(active_connections[camera_id])}")


def update_connection_ping(camera_id, conn_id):
    pass  # Không cần ping nữa vì unmount đóng cổng trực tiếp


def unregister_connection(camera_id, conn_id):
    with conn_lock:
        if camera_id in active_connections and conn_id in active_connections[camera_id]:
            active_connections[camera_id].remove(conn_id)
            count = len(active_connections[camera_id])
            print(f"[-] Hủy đăng ký kết nối: {conn_id}. Còn lại: {count}")
            # Nếu thật sự không còn ai xem nữa, tắt worker camera ngay lập tức hoặc sau 1 giây cực ngắn
            if count == 0:
                threading.Thread(
                    target=stop_worker_if_unused,
                    args=(camera_id,),
                    daemon=True
                ).start()


def stop_worker_if_unused(camera_id):
    time.sleep(1.0)
    with conn_lock:
        active_count = len(active_connections.get(camera_id, set()))
    if active_count == 0:
        with workers_lock:
            if camera_id in cam_workers:
                print(f"[*] NGỪNG NHẬN DIỆN CAMERA {camera_id}: Không còn kết nối hoạt động")
                worker = cam_workers[camera_id]
                worker.stop()
                try:
                    del cam_workers[camera_id]
                except KeyError:
                    pass


@flask_app.route("/stream/<camera_id>")
def video_feed(camera_id):
    url = request.args.get("url")
    name = request.args.get("name")
    roi_raw = request.args.get("roi")

    # Cập nhật cache từ query parameters của request nếu có
    with db_cache_lock:
        if camera_id not in db_cameras_cache:
            db_cameras_cache[camera_id] = {}
        if url:
            db_cameras_cache[camera_id]["youtubeUrl"] = url
        if name:
            db_cameras_cache[camera_id]["name"] = name
        if roi_raw:
            try:
                import json
                db_cameras_cache[camera_id]["detectionZone"] = json.loads(roi_raw)
            except Exception:
                pass
        elif "detectionZone" not in db_cameras_cache[camera_id]:
            db_cameras_cache[camera_id]["detectionZone"] = []

    if not start_worker_if_needed(camera_id):
        return Response("Camera stream không khoa dung", status=404)

    conf = request.args.get("conf", default=0.25, type=float)
    classes_raw = request.args.get("classes", default="car,motorcycle,truck,bus,bicycle", type=str)
    show_boxes = request.args.get("show_boxes", default="true", type=str).lower() == "true"
    show_labels = request.args.get("show_labels", default="true", type=str).lower() == "true"
    use_roi = request.args.get("use_roi", default="true", type=str).lower() == "true"
    
    enabled_classes = [c.strip() for c in classes_raw.split(",") if c.strip()]
    
    return Response(generate_mjpeg(camera_id, conf, enabled_classes, show_boxes, show_labels, use_roi),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


@flask_app.route("/stop_view/<camera_id>", methods=["GET", "POST", "OPTIONS"])
def stop_view(camera_id):
    if request.method == "OPTIONS":
        res = flask_app.make_response(("", 200))
        res.headers["Access-Control-Allow-Origin"] = "*"
        res.headers["Access-Control-Allow-Headers"] = "*"
        res.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return res

    res = flask_app.make_response(({"success": True, "message": "Ignored. Managed automatically via socket closure"}, 200))
    res.headers["Access-Control-Allow-Origin"] = "*"
    res.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return res


@flask_app.route("/health")
def health():
    with workers_lock:
        cams = list(cam_workers.keys())
    return {"status": "ok", "cameras": cams, "device": DEVICE}


def capture_single_frame(video_url):
    print(f"[*] ĐANG CHỤP ẢNH TĨNH TỰ ĐỘNG TỪ NGUỒN: {video_url}")
    cap = None
    try:
        cap = CamGear(source=video_url, stream_mode=True, logging=False).start()
        for _ in range(40):
            frame = cap.read()
            if frame is not None:
                if len(frame.shape) == 3 and frame.shape[0] > 0 and frame.shape[1] > 0:
                    return frame
            time.sleep(0.05)
    except Exception as e:
        print(f"[!] Lỗi chụp nhanh ảnh tĩnh từ {video_url}: {e}")
    finally:
        if cap is not None:
            try:
                cap.stop()
            except Exception:
                pass
    return None


@flask_app.route("/snapshot/<camera_id>", methods=["GET", "OPTIONS"])
def snapshot(camera_id):
    if request.method == "OPTIONS":
        res = flask_app.make_response(("", 200))
        res.headers["Access-Control-Allow-Origin"] = "*"
        res.headers["Access-Control-Allow-Headers"] = "*"
        res.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        return res

    worker_active = False
    with workers_lock:
        if camera_id in cam_workers:
            worker = cam_workers[camera_id]
            if worker.is_alive() and not worker.stop_event.is_set():
                worker_active = True

    if worker_active:
        with workers_lock:
            worker = cam_workers[camera_id]
        raw_frame, _ = worker.get_latest_data()
        if raw_frame is not None:
            ret, buf = cv2.imencode(".jpg", raw_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ret:
                res = flask_app.make_response((buf.tobytes(), 200))
                res.headers["Content-Type"] = "image/jpeg"
                res.headers["Access-Control-Allow-Origin"] = "*"
                return res

    if camera_id == "temp":
        url = request.args.get("url") or request.args.get("youtubeUrl")
    else:
        cam_info = get_camera_info(camera_id)
        url = cam_info.get("youtubeUrl", "") if cam_info else ""

    if not url:
        f = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
        cv2.putText(f, "Khong tim thay URL camera",
                    (50, FRAME_H//2), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (0, 0, 255), 2)
        _, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 80])
        res = flask_app.make_response((buf.tobytes(), 200))
        res.headers["Content-Type"] = "image/jpeg"
        res.headers["Access-Control-Allow-Origin"] = "*"
        return res

    raw_frame = capture_single_frame(url)

    if raw_frame is None:
        f = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
        cv2.putText(f, "Khong the chup anh tu nguon-tinh (timeout)",
                    (50, FRAME_H//2), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (0, 0, 255), 2)
        _, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 80])
        res = flask_app.make_response((buf.tobytes(), 200))
        res.headers["Content-Type"] = "image/jpeg"
        res.headers["Access-Control-Allow-Origin"] = "*"
        return res

    ret, buf = cv2.imencode(".jpg", raw_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ret:
        res = flask_app.make_response(("Encoder error", 500))
        res.headers["Access-Control-Allow-Origin"] = "*"
        return res

    res = flask_app.make_response((buf.tobytes(), 200))
    res.headers["Content-Type"] = "image/jpeg"
    res.headers["Access-Control-Allow-Origin"] = "*"
    return res


# ══════════════════════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════════════════════
def main():
    print("=" * 55)
    print("  YOLOv11 MJPEG Stream — Simple On-Demand Connection Edition")
    print(f"  Device : {DEVICE}")
    print(f"  Port   : {MJPEG_PORT}")
    print(f"  Model  : {MODEL_PATH}")
    print(f"  Skip   : YOLO moi {DETECT_SKIP} frame")
    print(f"  JPEG   : {JPEG_QUALITY}% @ {FRAME_W}x{FRAME_H}")
    print("=" * 55)

    get_model()  # load model trước

    print(f"[OK] Stream: http://localhost:{MJPEG_PORT}/stream/<camera_id>")
    print(f"[OK] Health: http://localhost:{MJPEG_PORT}/health\n")

    try:
        flask_app.run(
            host="0.0.0.0", port=MJPEG_PORT,
            threaded=True, use_reloader=False
        )
    except KeyboardInterrupt:
        print("\n[*] Dang tat...")
    finally:
        with workers_lock:
            for w in list(cam_workers.values()):
                w.stop()


if __name__ == "__main__":
    main()
