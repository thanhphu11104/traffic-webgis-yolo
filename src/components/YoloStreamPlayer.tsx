import { useEffect, useState } from 'react';
import { Camera, YoloConfig } from '../types';
import { X } from 'lucide-react';

interface YoloStreamPlayerProps {
  camera: Camera;
  yoloConfig: YoloConfig;
  onClose?: () => void;
}

const MJPEG_BASE = '/mjpeg';

export default function YoloStreamPlayer({ camera, yoloConfig, onClose }: YoloStreamPlayerProps) {
  const [localCamera, setLocalCamera] = useState<Camera>(camera);
  const [imgError, setImgError]       = useState(false);
  const [logs, setLogs]               = useState<string[]>([]);
  const [useRoi, setUseRoi]           = useState(true);

  // Sync khi prop thay đổi
  useEffect(() => { 
    setLocalCamera(camera); 
    setImgError(false);
  }, [camera]);



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
  const encodedUrl = encodeURIComponent(localCamera.youtubeUrl || '');
  const encodedName = encodeURIComponent(localCamera.name || '');
  const encodedZone = encodeURIComponent(JSON.stringify(localCamera.detectionZone || []));
  const mjpegSrc = `${MJPEG_BASE}/stream/${localCamera.id}?url=${encodedUrl}&name=${encodedName}&roi=${encodedZone}&conf=${debouncedConfig.confidenceThreshold}&classes=${classesEnabledParam}&show_boxes=${debouncedConfig.showBoxes}&show_labels=${debouncedConfig.showLabels}&use_roi=${useRoi}`;

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
            <div className="absolute top-2 left-2 bg-black/40 text-rose-500 text-[9px]
                            font-mono px-1.5 py-0.5 rounded-md backdrop-blur-sm z-10 select-none
                            flex items-center gap-1 border border-rose-500/10">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse inline-block" />
              LIVE
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-center p-6">
            <h4 className="font-medium text-slate-400 text-xs uppercase tracking-wider">Camera ngoại tuyến</h4>
            <p className="text-[11px] text-zinc-500 max-w-xs mt-1">Luồng video không khả dụng.</p>
          </div>
        )}
      </div>

      {/* ROI Detection Zone toggle checkbox if a zone exists */}
      {isActive && localCamera.detectionZone && localCamera.detectionZone.length >= 3 && (
        <div className="flex items-center gap-2 p-2.5 bg-slate-900/45 border border-slate-900 rounded-lg select-none">
          <input
            id="use_roi_toggle"
            type="checkbox"
            checked={useRoi}
            onChange={(e) => setUseRoi(e.target.checked)}
            className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-800 accent-indigo-500 cursor-pointer"
          />
          <label htmlFor="use_roi_toggle" className="text-[11px] text-zinc-300 font-medium cursor-pointer flex-1">
            Chỉ nhận diện trong vùng chọn đa giác (Bộ lọc ROI hoạt động)
          </label>
          <span className="text-[10px] bg-indigo-950 text-indigo-350 border border-indigo-900/40 px-1.5 py-0.5 rounded font-mono font-bold">
            ROI ACTIVE
          </span>
        </div>
      )}

      {/* Số liệu xe — Thống kê tối giản dạng bar ngang */}
      <div className="flex justify-between items-center bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-900 divide-x divide-slate-900/40 text-[11px] font-mono">
        {[
          { label: 'Ô tô',    val: displayCar },
          { label: 'Xe máy',  val: displayMoto },
          { label: 'Xe tải',  val: displayTruck },
          { label: 'Xe buýt', val: displayBus },
        ].map(({ label, val }, i) => (
          <div key={label} className={`flex-1 flex justify-center items-center gap-1.5 ${i > 0 ? 'pl-1' : ''}`}>
            <span className="text-zinc-500">{label}:</span>
            <span className="font-semibold text-slate-300">{isActive ? val : 0}</span>
          </div>
        ))}
      </div>

      {/* Log nhỏ */}
      {logs.length > 0 && (
        <div className="bg-slate-950/40 border border-slate-900 rounded-lg p-2 max-h-16 overflow-y-auto divide-y divide-slate-900/40">
          {logs.map((l, i) => (
            <p key={i} className="text-[9px] font-mono text-zinc-500 py-0.5 first:pt-0 last:pb-0">{l}</p>
          ))}
        </div>
      )}

    </div>
  );
}
