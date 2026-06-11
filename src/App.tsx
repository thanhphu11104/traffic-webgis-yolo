import React, { useEffect, useState } from 'react';
import { 
  Plus, Search, Filter, ShieldAlert, CheckCircle, LogOut, Lock, 
  User as UserIcon, Sliders, Play, Settings, Menu, Eye, Calendar,
  TrendingUp, AlertTriangle, ChevronRight, RefreshCw, Layers, Edit2, Trash2
} from 'lucide-react';
import { Camera, User, YoloConfig } from './types';
import MapComponent from './components/MapComponent';
import YoloStreamPlayer from './components/YoloStreamPlayer';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  
  // Auth Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Core Data States
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'congested'>('all');
  const [loading, setLoading] = useState(true);

  // Admin Interactions Coordinates picker
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analytics'>('dashboard');
  const [adminMode, setAdminMode] = useState(false);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Camera Form State (Add / Update)
  const [cameraForm, setCameraForm] = useState<{
    name: string;
    youtubeUrl: string;
    lat: string;
    lng: string;
    status: 'active' | 'inactive';
    detectionZone?: { x: number; y: number }[];
  }>({
    name: '',
    youtubeUrl: '',
    lat: '',
    lng: '',
    status: 'active',
    detectionZone: [],
  });
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null);
  const [showRoiEditor, setShowRoiEditor] = useState(false);
  const [confirmedUrlForDrawing, setConfirmedUrlForDrawing] = useState('');
  const [snapshotTimestamp, setSnapshotTimestamp] = useState<number>(Date.now());
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);
  const [formMsg, setFormMsg] = useState<{ success: boolean; text: string } | null>(null);

  // Global YOLO configuration state (Interactive sliding panel controls)
  const [yoloConfig, setYoloConfig] = useState<YoloConfig>({
    confidenceThreshold: 0.45,
    iouThreshold: 0.35,
    classesEnabled: ['car', 'motorcycle', 'truck', 'bus'],
    processingSpeed: 30,
    showBoxes: true,
    showLabels: true,
    showConfidence: true,
  });

  // Fetch initial data & poll at interval to get live details from Python YOLO in SQLite
  useEffect(() => {
    fetchCameras();
    
    const interval = setInterval(() => {
      fetchCameras();
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchCameras = async () => {
    try {
      const res = await fetch('/api/cameras');
      const data = await res.json();
      if (data.success) {
        setCameras(data.cameras);
      }
    } catch (e) {
      console.error('Error fetching cameras', e);
    } finally {
      setLoading(false);
    }
  };

  // Auth Operations
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    if (!username || !password) {
      setAuthError('Vui lòng điền đủ tên tài khoản và mật khẩu.');
      setAuthLoading(false);
      return;
    }

    try {
      const endpoint = isRegistering ? '/api/auth/register' : '/api/auth/login';
      const body = isRegistering 
        ? { username, fullName, password, role: username.includes('admin') ? 'admin' : 'user' }
        : { username, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setUsername('');
        setPassword('');
        setFullName('');
        setAuthError('');
        // Toggle Admin Mode automatically if they log in as systems admin
        if (data.user?.role === 'admin') {
          setAdminMode(true);
        }
      } else {
        setAuthError(data.error || 'Có lỗi xảy ra, vui lòng thử lại.');
      }
    } catch (err) {
      setAuthError('Không thể kết nối máy chủ dữ liệu SQLite.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setAdminMode(false);
    setClickedCoords(null);
  };

  // Handle map click for picking coords
  const handleMapClick = (lat: number, lng: number) => {
    if (!adminMode) return;
    setClickedCoords({ lat, lng });
    setCameraForm(prev => ({
      ...prev,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6)
    }));
    setFormMsg({ success: true, text: `Đã chọn toạ độ từ bản đồ: [${lat.toFixed(4)}, ${lng.toFixed(4)}]` });
  };

  // Handle drawing mouse click on canvas view relative to image boundaries for polygonal ROI setting
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const boundedX = Number(Math.max(0, Math.min(1, x)).toFixed(4));
    const boundedY = Number(Math.max(0, Math.min(1, y)).toFixed(4));
    setCameraForm(prev => ({
      ...prev,
      detectionZone: [...(prev.detectionZone || []), { x: boundedX, y: boundedY }]
    }));
  };

  // Insert or Update Camera Form Handler
  const handleCameraFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg(null);

    const { name, youtubeUrl, lat, lng, status } = cameraForm;
    if (!name || !youtubeUrl || !lat || !lng) {
      setFormMsg({ success: false, text: 'Vui lòng điền đầy đủ các thông số hoặc bấm chọn toạ độ trên bản đồ.' });
      return;
    }

    try {
      const payload = {
        name,
        youtubeUrl,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        status,
        detectionZone: cameraForm.detectionZone,
      };

      const url = editingCameraId ? `/api/cameras/${editingCameraId}` : '/api/cameras';
      const method = editingCameraId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        setFormMsg({ success: true, text: data.msg || 'Xử lý hoàn thành thành công.' });
        // Refresh Camera list
        fetchCameras();
        // Clear form
        setCameraForm({ name: '', youtubeUrl: '', lat: '', lng: '', status: 'active', detectionZone: [] });
        setClickedCoords(null);
        setEditingCameraId(null);
        setShowRoiEditor(false);
      } else {
        setFormMsg({ success: false, text: data.error || 'Có lỗi xảy ra khi lưu.' });
      }
    } catch (e: any) {
      setFormMsg({ success: false, text: 'Lỗi truyền nhận máy chủ SQLite: ' + e.message });
    }
  };

  // Load Existing Camera parameters to edit
  const handleEditClick = (cam: Camera) => {
    setEditingCameraId(cam.id);
    setShowRoiEditor(false);
    setConfirmedUrlForDrawing(cam.youtubeUrl);
    setSnapshotTimestamp(Date.now());
    setClickedCoords({ lat: cam.lat, lng: cam.lng });
    setCameraForm({
      name: cam.name,
      youtubeUrl: cam.youtubeUrl,
      lat: cam.lat.toString(),
      lng: cam.lng.toString(),
      status: cam.status,
      detectionZone: cam.detectionZone || [],
    });
    setFormMsg({ success: true, text: `Đang chỉnh sửa dữ liệu Camera: ${cam.name}` });
  };

  // Delete specific target camera
  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa điểm camera WebGIS này không?')) return;
    try {
      const res = await fetch(`/api/cameras/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setFormMsg({ success: true, text: 'Đã xóa camera thành công!' });
        fetchCameras();
        if (selectedCameraId === id) {
          setSelectedCameraId(null);
        }
      } else {
        setFormMsg({ success: false, text: data.error || 'Có lỗi xảy ra khi xóa.' });
      }
    } catch (e: any) {
      setFormMsg({ success: false, text: 'Lỗi kết nối xóa camera: ' + e.message });
    }
  };

  // Filter cameras
  const filteredCameras = cameras.filter(cam => {
    const matchesSearch = cam.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (statusFilter === 'all') return matchesSearch;
    if (statusFilter === 'active') return matchesSearch && cam.status === 'active';
    if (statusFilter === 'inactive') return matchesSearch && cam.status === 'inactive';
    if (statusFilter === 'congested') return matchesSearch && cam.trafficStatus === 'congested';
    return matchesSearch;
  });

  const selectedCamera = cameras.find(c => c.id === selectedCameraId);

  // Mock analytics charts structure
  const realTimeTrafficData = [
    { name: '08:00', 'Lưu lượng xe': 340, 'Vượt tốc độ': 15 },
    { name: '10:00', 'Lưu lượng xe': 520, 'Vượt tốc độ': 24 },
    { name: '12:00', 'Lưu lượng xe': 680, 'Vượt tốc độ': 32 },
    { name: '14:00', 'Lưu lượng xe': 410, 'Vượt tốc độ': 11 },
    { name: '16:00', 'Lưu lượng xe': 740, 'Vượt tốc độ': 45 },
    { name: '18:00', 'Lưu lượng xe': 920, 'Vượt tốc độ': 58 },
    { name: '20:00', 'Lưu lượng xe': 610, 'Vượt tốc độ': 29 },
  ];

  const classMetersData = [
    { name: 'Ô tô', 'Số Phương tiện': cameras.reduce((acc, c) => acc + (c.status === 'active' ? 25 : 0), 120), fill: '#3b82f6' },
    { name: 'Xe máy', 'Số Phương tiện': cameras.reduce((acc, c) => acc + (c.status === 'active' ? 85 : 0), 380), fill: '#10b981' },
    { name: 'Xe tải', 'Số Phương tiện': cameras.reduce((acc, c) => acc + (c.status === 'active' ? 8 : 0), 45), fill: '#f59e0b' },
    { name: 'Xe buýt', 'Số Phương tiện': cameras.reduce((acc, c) => acc + (c.status === 'active' ? 5 : 0), 22), fill: '#ec4899' },
  ];

  // Render Login state first
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative font-sans">
        
        <div className="w-full max-w-sm bg-slate-900 border border-slate-850 p-8 rounded-xl flex flex-col relative">
          
          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold text-slate-100 tracking-tight">
              Giám sát giao thông Đà Nẵng
            </h1>
            <p className="text-xs text-zinc-500 mt-1">Phát hiện và nhận diện phương tiện thời gian thực</p>
          </div>

          {authError && (
            <div className="bg-rose-950/20 border border-rose-900/40 text-rose-300 text-xs px-3.5 py-2 rounded-lg mb-4 text-center leading-snug">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            
            {isRegistering && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Họ & Tên</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-slate-950 text-slate-100 text-xs px-3 py-2 rounded-lg border border-slate-800 focus:border-indigo-500 outline-none transition"
                    placeholder="Nguyễn Văn A"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Tên Đăng Nhập</label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-950 text-slate-100 text-xs px-3 py-2 rounded-lg border border-slate-800 focus:border-indigo-500 outline-none transition"
                  placeholder="admin hoặc user"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Mật khẩu</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 text-slate-100 text-xs px-3 py-2 rounded-lg border border-slate-800 focus:border-indigo-500 outline-none transition"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 bg-indigo-650 hover:bg-indigo-600 text-xs font-medium text-white rounded-lg transition cursor-pointer disabled:opacity-50"
            >
              {authLoading ? 'Đang xác minh...' : isRegistering ? 'Đăng ký' : 'Đăng nhập'}
            </button>
          </form>

          {/* Quick info credentials blocks */}
          <div className="mt-5 p-3.5 bg-slate-950 border border-slate-850 rounded-lg space-y-1.5">
            <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Tài Khoản Demo (SQLite):</div>
            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <p className="text-zinc-400 font-medium font-sans">Quản trị viên (Admin)</p>
                <code className="block bg-slate-900 border border-slate-800/80 px-1.5 py-0.5 rounded text-zinc-300 mt-1 font-mono">
                  admin / admin123
                </code>
              </div>
              <div>
                <p className="text-zinc-400 font-medium font-sans">Giám sát viên (User)</p>
                <code className="block bg-slate-900 border border-slate-800/80 px-1.5 py-0.5 rounded text-zinc-300 mt-1 font-mono">
                  user / 123456
                </code>
              </div>
            </div>
          </div>

          <div className="mt-5 text-center text-xs">
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-indigo-400 hover:underline font-medium"
            >
              {isRegistering ? 'Đã có tài khoản? Đăng nhập ngay' : 'Chưa có tài khoản? Đăng ký tại đây'}
            </button>
          </div>

        </div>
      </div>
    );
  }

  // Render Dashboard
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Dynamic Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 sticky top-0 z-[1001] flex flex-col sm:flex-row items-center justify-between gap-4">
        
        <div>
          <h1 className="text-md font-semibold tracking-tight text-slate-100 uppercase">
            Bản đồ giao thông Đà Nẵng
          </h1>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Phát hiện phương tiện thời gian thực qua YOLOv11
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <span className="text-xs text-zinc-400 bg-slate-950 border border-slate-850 px-2.5 py-1 rounded">
            {user.fullName} ({user.role === 'admin' ? 'Quản lý' : 'Giám sát'})
          </span>

          <button
            onClick={() => {
              if (user.role !== 'admin') {
                alert('Chỉ tài khoản admin mới có thể cấu hình thông số YOLO!');
                return;
              }
              setAdminMode(!adminMode);
            }}
            className={`px-3 py-1.5 text-xs rounded font-medium flex items-center gap-1.5 cursor-pointer transition-colors border ${
              adminMode 
                ? 'bg-amber-600 border-amber-500 text-white' 
                : 'bg-slate-850 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Cấu hình: {adminMode ? 'Quản trị' : 'Giám sát'}</span>
          </button>

          <button
            onClick={handleLogout}
            className="px-2.5 py-1.5 text-zinc-400 hover:text-white bg-slate-850 border border-slate-800 rounded cursor-pointer transition text-xs"
          >
            Thoát
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 p-6">
        
        {/* LEFT COLUMN */}
        <div className="xl:col-span-4 flex flex-col gap-6">

          {/* Navigation Controls tabs */}
          <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded transition cursor-pointer ${activeTab === 'dashboard' ? 'bg-indigo-650 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              Giám sát
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded transition cursor-pointer ${activeTab === 'analytics' ? 'bg-indigo-650 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              Thống kê lưu lượng
            </button>
          </div>

          {activeTab === 'dashboard' ? (
            <>
              {/* CCTV Cameras List */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                    Danh sách camera ({filteredCameras.length})
                  </h2>
                </div>

                {/* Search and Filters */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Tìm kiếm camera..."
                      className="w-full bg-slate-950 border border-slate-850 pl-8 pr-3 py-1.5 rounded text-xs outline-none focus:border-indigo-500 text-slate-200 transition"
                    />
                  </div>
                  
                  {/* Status sorting options */}
                  <select
                     value={statusFilter}
                     onChange={(e: any) => setStatusFilter(e.target.value)}
                     className="bg-slate-950 border border-slate-850 text-xs text-zinc-400 px-2.5 py-1.5 rounded outline-none cursor-pointer focus:border-indigo-500"
                  >
                    <option value="all">Tất cả</option>
                    <option value="active">Trực tuyến</option>
                    <option value="inactive">Ngoại tuyến</option>
                    <option value="congested">Có ùn ứ xe</option>
                  </select>
                </div>

                {/* Grid Lists items */}
                <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
                  {loading ? (
                    <div className="text-center py-6 text-xs text-zinc-500">Đang tải biểu mẫu...</div>
                  ) : filteredCameras.length === 0 ? (
                    <div className="text-center py-8 text-xs text-zinc-500">Không có dữ liệu camera.</div>
                  ) : (
                    filteredCameras.map((cam) => {
                      const isSelected = cam.id === selectedCameraId;
                      let statusBadgeClass = 'text-emerald-450 border-emerald-950/30 bg-emerald-950/20';
                      let statusStringDecimal = 'Thông thoáng';

                      if (cam.status === 'inactive') {
                        statusBadgeClass = 'text-slate-450 border-slate-900 bg-slate-900/50';
                        statusStringDecimal = 'Mất kết nối';
                      } else if (cam.trafficStatus === 'congested') {
                        statusBadgeClass = 'text-rose-450 border-rose-950/30 bg-rose-955/20';
                        statusStringDecimal = 'Tắc nghẽn';
                      } else if (cam.trafficStatus === 'moderate') {
                        statusBadgeClass = 'text-amber-450 border-amber-950/30 bg-amber-955/20';
                        statusStringDecimal = 'Đông đúc';
                      }

                      return (
                        <div
                          key={cam.id}
                          className={`p-2.5 rounded border transition cursor-pointer flex flex-col gap-1 ${
                            isSelected 
                              ? 'bg-indigo-950/10 border-indigo-500' 
                              : 'bg-slate-950 border-slate-850 hover:bg-slate-900/50 hover:border-slate-800'
                          }`}
                          onClick={() => setSelectedCameraId(cam.id)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${cam.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                                <h4 className="text-xs font-semibold text-slate-300 truncate group-hover:text-indigo-400">{cam.name}</h4>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {cam.status === 'active' ? (
                                <span className="text-[9px] bg-emerald-950/40 text-emerald-400 px-1 py-0.5 rounded border border-emerald-900/20 uppercase tracking-wider font-semibold font-mono">LIVE</span>
                              ) : (
                                <span className="text-[9px] bg-slate-900 text-slate-500 px-1 py-0.5 rounded border border-slate-800 uppercase tracking-wider font-semibold font-mono">OFF</span>
                              )}
                              
                              <span className={`text-[9px] px-1.5 py-0.2 border rounded-full font-medium ${statusBadgeClass}`}>
                                {statusStringDecimal}
                              </span>
                              
                              {/* Admin actions inside cards */}
                              {adminMode && (
                                <div className="flex gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditClick(cam);
                                    }}
                                    className="p-1 bg-slate-800 hover:bg-slate-700 text-blue-400 rounded cursor-pointer border border-slate-700"
                                    title="Chỉnh sửa"
                                  >
                                    <Edit2 size={10} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteClick(cam.id);
                                    }}
                                    className="p-1 bg-slate-800 hover:bg-slate-700 text-rose-400 rounded cursor-pointer border border-slate-700"
                                    title="Xoá"
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Simplified traffic text status */}
                          {cam.status === 'active' && cam.vehicleCount !== undefined && (
                            <div className="text-[10px] text-zinc-500 flex justify-between items-center mt-1 border-t border-slate-900/40 pt-1 pointer-events-none">
                              <span>Số xe ước lượng: {cam.vehicleCount} xe</span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Dynamic YOLOv11 Config Sliders Panel */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                <div className="border-b border-slate-850 pb-2">
                  <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                    Cấu hình bộ lọc xe (YOLO)
                  </span>
                </div>

                <div className="space-y-3.5">
                  {/* Confidence thresh */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-zinc-500 font-medium">Độ tin cậy tối thiểu (Confidence):</span>
                      <span className="font-bold text-zinc-300 font-mono">{Math.round(yoloConfig.confidenceThreshold * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="0.9"
                      step="0.05"
                      value={yoloConfig.confidenceThreshold}
                      onChange={(e) => setYoloConfig(prev => ({ ...prev, confidenceThreshold: parseFloat(e.target.value) }))}
                      className="w-full accent-indigo-500 bg-slate-950 h-1 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Enabled classes toggles */}
                  <div>
                    <span className="block text-[11px] font-medium text-zinc-500 mb-2">Loại phương tiện giám sát:</span>
                    <div className="grid grid-cols-2 gap-2">
                      {['car', 'motorcycle', 'truck', 'bus', 'bicycle'].map((cls) => {
                        const dict = { car: 'Ô tô', motorcycle: 'Xe máy', truck: 'Xe tải', bus: 'Xe buýt', bicycle: 'Xe đạp' };
                        const isEnabled = yoloConfig.classesEnabled.includes(cls);

                        return (
                          <button
                            key={cls}
                            onClick={() => {
                              const updated = isEnabled 
                                ? yoloConfig.classesEnabled.filter(c => c !== cls)
                                : [...yoloConfig.classesEnabled, cls];
                              setYoloConfig(prev => ({ ...prev, classesEnabled: updated }));
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded border text-left cursor-pointer transition ${
                              isEnabled 
                                ? 'bg-indigo-950/20 border-indigo-500 text-indigo-300' 
                                : 'bg-slate-950 border-slate-850 text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {dict[cls as 'car' | 'motorcycle' | 'truck' | 'bus' | 'bicycle']}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Rendering toggles */}
                  <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-800/60 text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer text-zinc-500 hover:text-slate-300">
                      <input
                        type="checkbox"
                        checked={yoloConfig.showBoxes}
                        onChange={(e) => setYoloConfig(prev => ({ ...prev, showBoxes: e.target.checked }))}
                        className="rounded accent-indigo-500 w-3 h-3 bg-slate-950 border-slate-850"
                      />
                      <span>Khung phát hiện (Box)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-zinc-500 hover:text-slate-300">
                      <input
                        type="checkbox"
                        checked={yoloConfig.showLabels}
                        onChange={(e) => setYoloConfig(prev => ({ ...prev, showLabels: e.target.checked }))}
                        className="rounded accent-indigo-500 w-3 h-3 bg-slate-950 border-slate-850"
                      />
                      <span>Nhãn phân loại (Label)</span>
                    </label>
                  </div>
                </div>
              </div>
            </>
          ) : (
            // Statistics Panel Layout
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
              <h3 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase border-b border-slate-850 pb-2">
                Thống kê lưu lượng phủ rộng
              </h3>

              <div className="space-y-4">
                {/* Traffic levels indicators */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-950 border border-slate-850 p-3 rounded">
                    <span className="text-[10px] text-zinc-500 uppercase">Camera hoạt động</span>
                    <h4 className="text-xl font-bold text-slate-200 mt-1">
                      {cameras.filter(c => c.status === 'active').length} / {cameras.length}
                    </h4>
                  </div>
                  <div className="bg-slate-950 border border-slate-850 p-3 rounded">
                    <span className="text-[10px] text-zinc-500 uppercase">Điểm ùn ứ xe</span>
                    <h4 className="text-xl font-bold text-rose-450 mt-1">
                      {cameras.filter(c => c.trafficStatus === 'congested').length} điểm
                    </h4>
                  </div>
                </div>

                {/* Analytical Mini graphs bar */}
                <div className="bg-slate-950 border border-slate-850 p-3 rounded">
                  <span className="text-[10px] text-zinc-500 uppercase block mb-2">Tỉ lệ phân bố xe</span>
                  <div className="h-[120px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={classMetersData}>
                        <XAxis dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} />
                        <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                        <Tooltip />
                        <Bar dataKey="Số Phương tiện" fill="#6366f1" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* MIDDLE COLUMN: WebGIS Map & Coordinates Drawer for Adding/Editing camera */}
        <div className="xl:col-span-8 flex flex-col gap-6">
          
          {/* Main Visual GIS Interface */}
          <div className="flex-1 min-h-[460px] flex flex-col bg-slate-900 border border-slate-800 p-4 rounded-xl relative shadow-md">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                  Bản đồ trực quan
                </h2>
              </div>

              {/* Edit Guidance Badge */}
              {adminMode && (
                <div className="text-amber-400 text-[10px] font-medium font-sans">
                  Click bản đồ để lấy toạ độ vẽ camera mới
                </div>
              )}
            </div>

            <div className="flex-1 h-[420px]">
              <MapComponent
                cameras={cameras}
                selectedCameraId={selectedCameraId}
                onSelectCamera={(id) => {
                  setSelectedCameraId(id);
                  // Clear coords if selecting camera
                  setClickedCoords(null);
                  setEditingCameraId(null);
                }}
                adminMode={adminMode}
                clickedCoords={clickedCoords}
                onMapClick={handleMapClick}
              />
            </div>
          </div>

          {/* Underlay split layout: Admin Form drawer & Live YOLO Stream Video */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Camera Management form (Shown if Admin Mode is online OR Form is editing) */}
            {adminMode && (
              <div className="lg:col-span-12 xl:col-span-4 bg-slate-900 border border-amber-600/35 p-5 rounded-xl flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase">
                    {editingCameraId ? 'Cập nhật camera' : 'Thêm camera'}
                  </h3>
                  {editingCameraId && (
                    <button 
                      onClick={() => {
                        setEditingCameraId(null);
                        setCameraForm({ name: '', youtubeUrl: '', lat: '', lng: '', status: 'active', detectionZone: [] });
                        setClickedCoords(null);
                        setShowRoiEditor(false);
                      }} 
                      className="text-[10px] text-zinc-500 hover:text-white underline font-mono cursor-pointer"
                    >
                      Huỷ bỏ
                    </button>
                  )}
                </div>

                {formMsg && (
                  <div className={`text-[11px] px-3 py-1.5 rounded leading-snug font-sans ${formMsg.success ? 'bg-indigo-950/40 border border-indigo-900/60 text-indigo-300' : 'bg-rose-955/20 border border-rose-900/40 text-rose-300'}`}>
                    {formMsg.text}
                  </div>
                )}

                <form onSubmit={handleCameraFormSubmit} className="space-y-3 text-xs w-full">
                  <div>
                    <label className="block text-[11px] text-zinc-500 mb-1">Tên điểm camera:</label>
                    <input
                      type="text"
                      required
                      value={cameraForm.name}
                      onChange={(e) => setCameraForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Cầu Rồng"
                      className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 outline-none focus:border-indigo-500 text-slate-200 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-500 mb-1">Luồng phát YouTube Live:</label>
                    <input
                      type="url"
                      required
                      value={cameraForm.youtubeUrl}
                      onChange={(e) => setCameraForm(prev => ({ ...prev, youtubeUrl: e.target.value }))}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 outline-none focus:border-indigo-500 text-slate-200 transition font-mono text-[11px]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-zinc-550 mb-1">Latitude:</label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={cameraForm.lat}
                        onChange={(e) => setCameraForm(prev => ({ ...prev, lat: e.target.value }))}
                        placeholder="Vĩ độ"
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1.5 outline-none focus:border-indigo-500 text-slate-200 transition font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-550 mb-1">Longitude:</label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={cameraForm.lng}
                        onChange={(e) => setCameraForm(prev => ({ ...prev, lng: e.target.value }))}
                        placeholder="Kinh độ"
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1.5 outline-none focus:border-indigo-500 text-slate-200 transition font-mono text-xs"
                      />
                    </div>
                  </div>

                  {/* Polygonal ROI Setup Section Indicator in Sidebar Form */}
                  <div className="border border-slate-850 rounded p-3 bg-slate-950/65 space-y-2 mt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-slate-200">Khoanh vùng nhận diện đa giác (ROI)</span>
                        <span className="text-[9px] text-zinc-500">Giới hạn khu vực luồng phân tích xe cộ</span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                        Đã chấm: {cameraForm.detectionZone?.length || 0} điểm
                      </span>
                    </div>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSnapshotTimestamp(Date.now());
                          setConfirmedUrlForDrawing(cameraForm.youtubeUrl);
                          setShowRoiEditor(true);
                        }}
                        className={`w-full py-2 px-3 rounded text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 border ${
                          showRoiEditor 
                            ? 'bg-indigo-950/40 border-indigo-500 text-indigo-300' 
                            : 'bg-indigo-650 hover:bg-indigo-600 border-indigo-700 text-white shadow-sm'
                        }`}
                      >
                        <Settings className="w-3.5 h-3.5 animate-pulse" />
                        {showRoiEditor ? 'Đang mở trình vẽ ROI bên phải...' : 'Bấm để Thiết lập & Vẽ ROI ở cột phải ↗'}
                      </button>
                    </div>

                    {cameraForm.detectionZone && cameraForm.detectionZone.length > 0 && (
                      <div className="flex items-center justify-between text-[9.5px] text-zinc-400 pt-1 border-t border-slate-900">
                        <span className={cameraForm.detectionZone.length < 3 ? 'text-amber-400 font-medium' : 'text-emerald-400 font-medium'}>
                          {cameraForm.detectionZone.length < 3 ? '⚠️ Cần tối thiểu 3 điểm' : '✓ Vùng ROI khép kín hợp lệ'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCameraForm(prev => ({ ...prev, detectionZone: [] }))}
                          className="text-rose-400 hover:text-rose-300 underline cursor-pointer"
                        >
                          Xoá vùng vẽ cũ
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">Trạng thái:</label>
                      <select
                        value={cameraForm.status}
                        onChange={(e: any) => setCameraForm(prev => ({ ...prev, status: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1.5 outline-none focus:border-indigo-500 text-slate-350 cursor-pointer text-xs"
                      >
                        <option value="active">Hoạt động</option>
                        <option value="inactive">Ngoại tuyến</option>
                      </select>
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="w-full bg-indigo-650 hover:bg-indigo-600 text-white font-semibold py-1.5 rounded transition cursor-pointer text-xs shadow-md"
                      >
                        <span>Xác nhận lưu camera</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* YOLO live rendering Player OR Spatially Rich ROI Interactive Canvas */}
            <div className={`col-span-12 ${adminMode ? 'xl:col-span-8' : 'xl:col-span-12'}`}>
              {showRoiEditor ? (
                <div className="bg-slate-900 border border-indigo-500/50 p-5 rounded-xl shadow-xl space-y-4 relative">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
                        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide">
                          THIẾT LẬP VÙNG ROI CAMERA: {cameraForm.name || 'CAMERA MỚI'}
                        </h3>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Chấm các điểm lên màn hình dưới đây để tạo vùng đa giác khép kín (bản đồ lớp phủ YOLO sẽ phân tích phương tiện bên trong ranh giới này).
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowRoiEditor(false)}
                      className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-350 px-3 py-1.5 rounded-md font-medium cursor-pointer transition border border-slate-700"
                    >
                      Đóng trình vẽ ROI ✕
                    </button>
                  </div>

                  {/* Mode Selector for Snapshot in Editor */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-slate-850 gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-400">Chế độ vẽ:</span>
                      <span className="text-[11px] font-semibold text-indigo-400 bg-indigo-950/40 border border-indigo-900 px-2 py-0.5 rounded">Ảnh chụp tĩnh (độ phân giải cao)</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={async () => {
                          setRefreshingSnapshot(true);
                          setConfirmedUrlForDrawing(cameraForm.youtubeUrl);
                          setSnapshotTimestamp(Date.now());
                          setTimeout(() => setRefreshingSnapshot(false), 950);
                        }}
                        disabled={refreshingSnapshot}
                        className="text-[11px] flex items-center gap-1.5 text-emerald-400 hover:text-emerald-350 font-semibold disabled:opacity-50 transition cursor-pointer bg-slate-900/60 border border-slate-800 px-2.5 py-1 rounded-md"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshingSnapshot ? 'animate-spin' : ''}`} />
                        {refreshingSnapshot ? 'Đang đồng bộ...' : 'Chụp ảnh tĩnh mới'}
                      </button>

                      <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 px-2.5 py-1 rounded-md text-[11px] font-mono text-slate-300">
                        <span>Đã chấm:</span>
                        <strong className="text-yellow-400">{cameraForm.detectionZone?.length || 0}</strong>
                        <span>điểm</span>
                      </div>
                    </div>
                  </div>

                  {/* Main Drawing Area - Highly responsive canvas with aspect-video */}
                  <div
                    onClick={handleCanvasClick}
                    className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-950 border-2 border-indigo-500/25 cursor-crosshair select-none group shadow-inner"
                  >
                    {/* Synchronizing Overlay */}
                    {refreshingSnapshot && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-20 gap-3">
                        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
                        <span className="text-xs text-zinc-400 font-semibold tracking-wider font-sans uppercase font-mono">Đang đồng bộ ảnh tĩnh mới từ URL trực tiếp...</span>
                      </div>
                    )}

                    {/* Guard warning if no Stream URL is provided for a new camera */}
                    {!editingCameraId && !confirmedUrlForDrawing && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-10 p-6 text-center">
                        <AlertTriangle className="w-8 h-8 text-amber-500 mb-2 animate-pulse" />
                        <span className="text-sm font-semibold text-slate-200">CHƯA PHÁT HIỆN ĐƯỜNG DẪN STREAM CAMERA</span>
                        <p className="text-xs text-zinc-400 mt-1.5 max-w-sm font-sans leading-relaxed">
                          Vui lòng nhập <strong className="text-indigo-400">Luồng phát YouTube Live</strong> ở khung bên trái trước để hệ thống đồng bộ hóa luồng hình ảnh trực tiếp giúp bạn vẽ ROI.
                        </p>
                      </div>
                    )}

                    <img
                      src={
                        editingCameraId
                          ? `/mjpeg/snapshot/${editingCameraId}?t=${snapshotTimestamp}`
                          : confirmedUrlForDrawing
                            ? `/mjpeg/snapshot/temp?url=${encodeURIComponent(confirmedUrlForDrawing)}&t=${snapshotTimestamp}`
                            : 'https://images.unsplash.com/photo-1494783367193-14bc9b40fc80?auto=format&fit=crop&w=1280&q=80'
                      }
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1494783367193-14bc9b40fc80?auto=format&fit=crop&w=1280&q=80';
                      }}
                      className="absolute inset-0 w-full h-full object-cover opacity-85 transition duration-300"
                      alt="ROI Snapshot Stream Source"
                    />

                    {/* SVG representation for responsive scaling */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                      {cameraForm.detectionZone && cameraForm.detectionZone.length > 0 && (
                        <>
                          {cameraForm.detectionZone.length > 1 && (
                            <polygon
                              points={cameraForm.detectionZone.map(p => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                              fill="rgba(99, 102, 241, 0.28)"
                              stroke="#6366F1"
                              strokeWidth="5"
                              strokeDasharray="6, 4"
                            />
                          )}
                          {cameraForm.detectionZone.map((p, i) => (
                            <g key={i}>
                              <circle
                                cx={p.x * 1000}
                                cy={p.y * 1000}
                                r="15"
                                fill="#F59E0B"
                                stroke="#FFFFFF"
                                strokeWidth="4"
                              />
                              <text
                                x={p.x * 1000}
                                y={p.y * 1000 + 5}
                                fill="#000000"
                                fontSize="13"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                {i + 1}
                              </text>
                            </g>
                          ))}
                        </>
                      )}
                    </svg>

                    {/* Canvas Help Badge */}
                    {(!cameraForm.detectionZone || cameraForm.detectionZone.length === 0) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-6 text-center">
                        <div className="max-w-md space-y-2">
                          <p className="text-sm font-semibold text-slate-200">
                            Chấm trực tiếp lên màn hình trên để xác định vùng vẽ
                          </p>
                          <p className="text-xs text-zinc-400">
                            Hãy click chuột tại các góc đỉnh của góc cua/vùng đường cần phân tích. Nên chấm tuần tự tạo thành đa giác khép kín hợp lệ.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions Bar of ROI Editor Box */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-slate-850">
                    <div className="flex items-center gap-1 text-[11.5px]">
                      <span className="text-zinc-400">Trạng thái ranh giới:</span>
                      {cameraForm.detectionZone && cameraForm.detectionZone.length > 0 && cameraForm.detectionZone.length < 3 ? (
                        <span className="text-amber-500 font-semibold bg-amber-950/20 border border-amber-900/40 px-2.5 py-0.5 rounded ml-1">
                          ⚠️ Cần tối thiểu 3 điểm để tạo đa giác khép kín
                        </span>
                      ) : cameraForm.detectionZone && cameraForm.detectionZone.length >= 3 ? (
                        <span className="text-emerald-400 font-semibold bg-emerald-950/20 border border-emerald-900/40 px-2 py-0.5 rounded ml-1 flex items-center gap-1">
                          ✓ Đa giác đã khép kín (% ranh giới hợp lệ)
                        </span>
                      ) : (
                        <span className="text-zinc-500 italic ml-1">Chưa chấm điểm nào</span>
                      )}
                    </div>

                    <div className="flex gap-2 self-end">
                      <button
                        type="button"
                        onClick={() => setCameraForm(prev => ({ ...prev, detectionZone: (prev.detectionZone || []).slice(0, -1) }))}
                        disabled={!cameraForm.detectionZone || cameraForm.detectionZone.length === 0}
                        className="text-xs px-3.5 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-slate-305 cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Hoàn tác điểm
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Bạn có thực sự muốn xoá tất cả điểm ranh giới vừa vẽ?')) {
                            setCameraForm(prev => ({ ...prev, detectionZone: [] }));
                          }
                        }}
                        disabled={!cameraForm.detectionZone || cameraForm.detectionZone.length === 0}
                        className="text-xs px-3.5 py-1.5 bg-slate-900 border border-slate-800 hover:border-rose-900/80 rounded-lg text-rose-300 hover:text-rose-450 cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Xoá tất cả vùng vẽ
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRoiEditor(false)}
                        className="text-xs px-4 py-1.5 bg-indigo-650 hover:bg-indigo-600 text-white font-semibold rounded-lg shadow cursor-pointer transition flex items-center gap-1"
                      >
                        Xác nhận vùng vẽ
                      </button>
                    </div>
                  </div>
                </div>
              ) : selectedCamera ? (
                <YoloStreamPlayer
                  camera={selectedCamera}
                  yoloConfig={yoloConfig}
                  onClose={() => setSelectedCameraId(null)}
                />
              ) : (
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl text-center text-zinc-500 shadow py-14">
                  <h4 className="font-semibold text-slate-300">CHƯA LỰA CHỌN CAMERA GIÁM SÁT</h4>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
                    Bấm chọn một địa điểm camera trên bản đồ WebGIS hoặc chọn luồng bên trái để theo dõi.
                  </p>
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

      {/* Control center footer */}
      <footer className="mt-auto bg-slate-900 border-t border-slate-850 p-4 text-center text-xs text-slate-500 font-mono">
        <div>© 2026 Bản đồ Giao thông Đà Nẵng • YOLOv11 Vehicle Analyzer</div>
      </footer>

    </div>
  );
}
