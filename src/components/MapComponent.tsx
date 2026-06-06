import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Camera } from '../types';

interface MapComponentProps {
  cameras: Camera[];
  selectedCameraId: string | null;
  onSelectCamera: (id: string) => void;
  adminMode: boolean;
  clickedCoords: { lat: number; lng: number } | null;
  onMapClick: (lat: number, lng: number) => void;
}

export default function MapComponent({
  cameras,
  selectedCameraId,
  onSelectCamera,
  adminMode,
  clickedCoords,
  onMapClick,
}: MapComponentProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  
  // Keep arrays of markers & layers to manage dynamically
  const markersRef = useRef<{ [id: string]: L.Marker }>({});
  const tempMarkerRef = useRef<L.Marker | null>(null);

  // Cache unstable callbacks to completely prevent Leaflet map teardowns
  const onMapClickRef = useRef(onMapClick);
  const onSelectCameraRef = useRef(onSelectCamera);
  const camerasRef = useRef(cameras);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onSelectCameraRef.current = onSelectCamera;
  }, [onSelectCamera]);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center on Da Nang, Vietnam
    const mapObj = L.map(mapContainerRef.current, {
      center: [16.068, 108.22],
      zoom: 14,
      zoomControl: true,
      attributionControl: false,
    });

    // Clean, vivid Light Theme Map tiles from CartoDB Voyager
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
    }).addTo(mapObj);

    mapRef.current = mapObj;
    setMap(mapObj);

    // Force map size recalibration on render to prevent partial loading grey sections
    setTimeout(() => {
      mapObj.invalidateSize();
    }, 200);

    // Handle clicks for Admin Mode
    mapObj.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMap(null);
      }
    };
  }, []);

  // Handle markers rendering and updates dynamically to prevent Leaflet map stutters
  useEffect(() => {
    if (!map) return;

    // Force Leaflet map to recalibrate size so markers render perfectly (fixes missing marker on initial load)
    map.invalidateSize();

    const currentCameraIds = new Set(cameras.map((c) => c.id));

    // Remove any markers that are no longer in the cameras list
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentCameraIds.has(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    });

    // Add or update markers based on dynamic cameras list
    cameras.forEach((camera) => {
      // Determine color based on traffic density
      let markerColorClass = 'bg-emerald-500';
      let borderPulseClass = 'custom-green-pulse';
      let statusLabel = 'Đang tốt';

      if (camera.trafficStatus === 'congested') {
        markerColorClass = 'bg-rose-500';
        borderPulseClass = 'custom-radar-pulse';
        statusLabel = 'Tắc nghẽn';
      } else if (camera.trafficStatus === 'moderate') {
        markerColorClass = 'bg-amber-500';
        borderPulseClass = 'custom-radar-pulse';
        statusLabel = 'Đông đúc';
      }

      if (camera.status === 'inactive') {
        markerColorClass = 'bg-slate-500';
        borderPulseClass = '';
        statusLabel = 'Mất kết nối';
      }

      // Check if this marker is selected
      const isSelected = camera.id === selectedCameraId;
      const borderClass = isSelected ? 'ring-4 ring-offset-2 ring-blue-400 scale-125 z-[1000]' : 'ring-1 ring-white/20';

      const htmlContent = `
        <div class="relative group cursor-pointer transition-all duration-300 ${borderClass}">
          <div class="w-10 h-10 rounded-full ${markerColorClass} border-2 border-white flex items-center justify-center text-white font-bold shadow-[0_0_15px_rgba(0,0,0,0.5)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-video text-white"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
          </div>
          <!-- Tooltip -->
          <div class="absolute bottom-12 left-1/2 transform -translate-x-1/2 bg-slate-900 border border-slate-700 text-slate-100 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[9999]">
            <div class="font-bold text-center">${camera.name}</div>
            <div class="text-[10px] text-zinc-400 mt-0.5 text-center">Lưu lượng: ${camera.vehicleCount} xe | ${statusLabel}</div>
          </div>
        </div>
      `;

      const existingMarker = markersRef.current[camera.id];

      if (existingMarker) {
        // Just update location and icon representation safely
        existingMarker.setLatLng([camera.lat, camera.lng]);
        
        const newIcon = L.divIcon({
          className: `custom-marker-icon ${borderPulseClass}`,
          html: htmlContent,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
        existingMarker.setIcon(newIcon);
      } else {
        // Instantiate a brand new marker
        const customIcon = L.divIcon({
          className: `custom-marker-icon ${borderPulseClass}`,
          html: htmlContent,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });

        const marker = L.marker([camera.lat, camera.lng], { icon: customIcon });
        
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectCameraRef.current(camera.id);
        });

        marker.addTo(map);
        markersRef.current[camera.id] = marker;
      }
    });
  }, [map, cameras, selectedCameraId]);

  // Handle clickedCoords (Temporary Marker for Admin Add Camera)
  useEffect(() => {
    if (!map) return;

    if (tempMarkerRef.current) {
      map.removeLayer(tempMarkerRef.current);
      tempMarkerRef.current = null;
    }

    if (adminMode && clickedCoords) {
      const pinIcon = L.divIcon({
        className: 'custom-temp-marker',
        html: `
          <div class="flex flex-col items-center animate-bounce">
            <div class="bg-blue-500 text-white font-bold text-[10px] px-2 py-0.5 rounded shadow-lg uppercase tracking-wider mb-1 whitespace-nowrap">Điểm Mới</div>
            <div class="w-8 h-8 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center text-white shadow-xl">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.74a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
          </div>
        `,
        iconSize: [120, 50],
        iconAnchor: [60, 50],
      });

      const tempMarker = L.marker([clickedCoords.lat, clickedCoords.lng], { icon: pinIcon }).addTo(map);
      tempMarkerRef.current = tempMarker;

      // Pan map smoothly to the designated coordinate
      map.panTo([clickedCoords.lat, clickedCoords.lng]);
    }
  }, [map, adminMode, clickedCoords]);

  // Center on selected camera ONLY when selection actually changes, not on telemetry updates
  useEffect(() => {
    if (!map) return;
    
    map.invalidateSize();
    
    if (!selectedCameraId) return;

    const selectedCam = camerasRef.current.find((c) => c.id === selectedCameraId);
    if (selectedCam) {
      map.setView([selectedCam.lat, selectedCam.lng], 16, {
        animate: true,
        duration: 1.0,
      });
    }
  }, [map, selectedCameraId]);

  return (
    <div className="w-full h-full relative rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      <div ref={mapContainerRef} className="w-full h-full min-h-[480px] z-10" />
      
      {/* Visual Instruction Overlay */}
      <div className="absolute bottom-4 left-4 z-20 bg-slate-950/90 border border-slate-855 p-3 rounded max-w-xs text-xs pointer-events-none space-y-1.5 text-slate-400">
        <div className="font-semibold text-slate-200 mb-1">
          Trạng thái lưu lượng
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
          <span>Thông thoáng</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
          <span>Đông đúc</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
          <span>Tắc nghẽn / Ùn ứ xe</span>
        </div>
      </div>
    </div>
  );
}
