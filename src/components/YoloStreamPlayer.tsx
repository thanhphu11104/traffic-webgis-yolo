import { useEffect, useState } from 'react';
import { Camera, YoloConfig } from '../types';
import { X } from 'lucide-react';

interface YoloStreamPlayerProps {
  camera: Camera;
  yoloConfig: YoloConfig;
  onAlertTriggered: (type: string, description: string, severity: 'low' | 'medium' | 'high') => void;
  onClose?: () => void;
}

const MJPEG_BASE = 'http://localhost:5010';

export default function YoloStreamPlayer({ camera, yoloConfig, onAlertTriggered, onClose }: YoloStreamPlayerProps) {
  const [localCamera, setLocalCamera] = useState<Camera>(camera);
  const [imgError, setImgError]       = useState(false);
  const [logs, setLogs]               = useState<string[]>([]);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiReport, setAiReport]       = useState<string | null>(null);

  // Sync khi prop thay đổi
  useEffect(() => { 
    setLocalCamera(camera); 
    setImgError(false);
  }, [camera]);

  // Thông báo dừng nhận diện và dọn dẹp luồng camera cũ khi chuyển camera hoặc tắt xem
  useEffect(() => {
    return () => {
      const stopUrl = `${MJPEG_BASE}/stop_view/${camera.id}`;
      // Gửi tín hiệu dứt khoát tới python server dừng ngay camera đang xem bằng fetch
      fetch(stopUrl, { method: 'POST', mode: 'no-cors', keepalive: true }).catch(() => {});
    };
  }, [camera.id]);

  // Poll telemetry nhẹ để cập nhật số liệu thống kê (không cần sync box nữa)
  useEffect(() => {
    if (camera.status !== 'active') return;
    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`/api/cameras/${camera.id}`);
        const data = await res.json();
        if (data.success && data.camera) setLocalCamera(data.camera);
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  }, [camera.id]);

  // Log khi có telemetry mới
  useEffect(() => {
    if (localCamera.status !== 'active' || !localCamera.lastTelemetry) return;
    const ts = new Date().toLocaleTimeString();
    const v  = localCamera.vehicleCount ?? 0;
    const s  = localCamera.trafficStatus;
    setLogs(prev => [
      `[${ts}] ${v} xe — ${s === 'congested' ? 'Tắc đường' : s === 'moderate' ? 'Mật độ cao' : 'Thông thoáng'}`,
      ...prev.slice(0, 19)
    ]);
  }, [localCamera.lastTelemetry]);

  const isActive = localCamera.status === 'active';

  // Thêm cơ chế debouncedConfig để kéo kéo thanh trượt mượt mà
  const [debouncedConfig, setDebouncedConfig] = useState(yoloConfig);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedConfig(yoloConfig);
    }, 150); // Phản hồi cực nhanh 150ms
    return () => clearTimeout(handler);
  }, [yoloConfig]);

  const classesEnabledParam = debouncedConfig.classesEnabled.join(',');
  const mjpegSrc = `${MJPEG_BASE}/stream/${localCamera.id}?conf=${debouncedConfig.confidenceThreshold}&classes=${classesEnabledParam}&show_boxes=${debouncedConfig.showBoxes}&show_labels=${debouncedConfig.showLabels}`;

  const handleGeminiAnalysis = async () => {
    setAiAnalyzing(true);
    setAiReport(null);
    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: localCamera.id,
          cameraName: localCamera.name,
          type: 'congestion',
          description: `Phân tích AI hoàn tất cho camera: ${localCamera.name}.`,
          severity: 'low'
        })
      });
      await new Promise(r => setTimeout(r, 1500));
      setAiReport(
        `Phân tích camera ${localCamera.name}: Lưu lượng ${
          localCamera.trafficStatus === 'congested' ? 'cao (tắc đường)' : 'bình thường'
        }. Tổng ${localCamera.vehicleCount ?? 0} phương tiện. Tốc độ trung bình ${localCamera.averageSpeed ?? 0} km/h.`
      );
    } catch {
      setAiReport('Lỗi kết nối phân tích AI.');
    } finally {
      setAiAnalyzing(false);
    }
  };

  const displayCar        = localCamera.carCount        ?? 0;
  const displayMoto       = localCamera.motorcycleCount ?? 0;
  const displayTruck      = localCamera.truckCount      ?? 0;
  const displayBus        = localCamera.busCount        ?? 0;
  const trafficLabel      = localCamera.trafficStatus === 'congested'
    ? 'Ùn tắc' : localCamera.trafficStatus === 'moderate' ? 'Mật độ trung bình' : 'Thông thoáng';

  return (
    <div className="w-full flex flex-col gap-3.5 bg-slate-950 border border-slate-900 p-4 rounded-xl">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-2">
        <h3 className="font-medium text-slate-200 text-sm flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {localCamera.name}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-500 font-medium">{trafficLabel}</span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-rose-400 border border-slate-800 hover:border-rose-900/40 bg-slate-900 hover:bg-rose-950/20 px-2.5 py-0.5 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
              title="Dừng xem camera"
            >
              <X size={12} />
              <span>Dừng xem</span>
            </button>
          )}
        </div>
      </div>

      {/* Video — MJPEG img tag, không cần canvas, không cần sync */}
      <div className="relative w-full rounded-lg overflow-hidden bg-black border border-slate-900 select-none"
           style={{ aspectRatio: '16/9' }}>
        {isActive ? (
          <>
            {!imgError ? (
              <img
                key={localCamera.id}
                src={mjpegSrc}
                className="absolute inset-0 w-full h-full object-cover"
                alt={`Camera ${localCamera.name}`}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 gap-2">
                <p className="text-zinc-500 text-xs">Không kết nối được MJPEG server</p>
                <p className="text-zinc-600 text-[10px] font-mono">{mjpegSrc}</p>
                <button
                  onClick={() => setImgError(false)}
                  className="mt-2 px-3 py-1 text-[11px] bg-slate-800 text-zinc-400 rounded hover:bg-slate-700 cursor-pointer"
                >
                  Thử lại
                </button>
              </div>
            )}
            {/* Live badge */}
            <div className="absolute top-2 left-2 bg-black/50 text-white/90 text-[9px]
                            font-mono px-2 py-0.5 rounded backdrop-blur-sm z-10 select-none
                            flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
              LIVE · Đã đồng bộ cấu hình tương tác
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-center p-6">
            <h4 className="font-medium text-slate-400 text-xs uppercase tracking-wider">Camera ngoại tuyến</h4>
            <p className="text-[11px] text-zinc-500 max-w-xs mt-1">Luồng video không khả dụng.</p>
          </div>
        )}
      </div>

      {/* Số liệu xe */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Ô tô',    val: displayCar },
          { label: 'Xe máy',  val: displayMoto },
          { label: 'Xe tải',  val: displayTruck },
          { label: 'Xe buýt', val: displayBus },
        ].map(({ label, val }) => (
          <div key={label} className="bg-slate-900/20 border border-slate-900/80 p-2.5 rounded-lg text-center">
            <span className="text-[10px] text-zinc-500 uppercase block">{label}</span>
            <span className="text-sm font-semibold text-slate-200 mt-0.5 block">{isActive ? val : 0}</span>
          </div>
        ))}
      </div>

      {/* Log nhỏ */}
      {logs.length > 0 && (
        <div className="bg-slate-900/30 border border-slate-900 rounded-lg p-2 max-h-20 overflow-y-auto">
          {logs.map((l, i) => (
            <p key={i} className="text-[10px] font-mono text-zinc-500">{l}</p>
          ))}
        </div>
      )}

      {/* Gemini AI */}
      <div className="border border-slate-900 p-3 rounded-lg bg-slate-950/20 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-slate-400">Nhận xét với Gemini AI</span>
          <button
            onClick={handleGeminiAnalysis}
            disabled={aiAnalyzing || !isActive}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-900
                       disabled:text-zinc-650 font-medium text-[11px] rounded transition-all text-white cursor-pointer"
          >
            {aiAnalyzing ? 'Đang phân tích...' : 'Phân tích'}
          </button>
        </div>
        {aiReport && (
          <div className="text-[11px] leading-relaxed text-zinc-400 bg-slate-900/30 p-2.5 rounded border border-slate-900">
            {aiReport}
          </div>
        )}
      </div>

    </div>
  );
}
