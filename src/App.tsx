import React, { useEffect, useState } from 'react';
import { 
  Plus, Search, Filter, ShieldAlert, CheckCircle, LogOut, Lock, 
  User as UserIcon, Sliders, Play, Settings, Menu, Eye, Calendar,
  TrendingUp, AlertTriangle, ChevronRight, RefreshCw, Layers, Edit2, Trash2
} from 'lucide-react';
import { Camera, User, TrafficAlert, YoloConfig } from './types';
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
  const [alerts, setAlerts] = useState<TrafficAlert[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'congested'>('all');
  const [loading, setLoading] = useState(true);

  // Admin Interactions Coordinates picker
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analytics'>('dashboard');
  const [adminMode, setAdminMode] = useState(false);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Camera Form State (Add / Update)
  const [cameraForm, setCameraForm] = useState({
    name: '',
    youtubeUrl: '',
    lat: '',
    lng: '',
    status: 'active' as 'active' | 'inactive',
  });
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null);
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
    fetchAlerts();
    
    const interval = setInterval(() => {
      fetchCameras();
      fetchAlerts();
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

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      if (data.success) {
        setAlerts(data.alerts);
      }
    } catch (e) {
      console.error('Error fetching alerts', e);
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
        setCameraForm({ name: '', youtubeUrl: '', lat: '', lng: '', status: 'active' });
        setClickedCoords(null);
        setEditingCameraId(null);
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
    setClickedCoords({ lat: cam.lat, lng: cam.lng });
    setCameraForm({
      name: cam.name,
      youtubeUrl: cam.youtubeUrl,
      lat: cam.lat.toString(),
      lng: cam.lng.toString(),
      status: cam.status,
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

  // Handle auto-logs triggered from standard canvas simulated alerts
  const handleAlertTriggered = async (type: string, description: string, severity: 'low' | 'medium' | 'high' = 'low') => {
    if (!selectedCameraId) return;
    const activeCam = cameras.find(c => c.id === selectedCameraId);
    if (!activeCam) return;

    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: activeCam.id,
          cameraName: activeCam.name,
          type,
          description,
          severity
        })
      });
      fetchAlerts(); // Reload alerts log in real-time
    } catch (err) {
      console.error('Error posting alert log from simulation', err);
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

          {/* Recent System Alerts Log (Persistent in SQLite database!) */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col gap-3 flex-1 min-h-[190px]">
            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
              <h3 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                Thông báo ùn tắc gần đây
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[220px]">
              {alerts.length === 0 ? (
                <div className="text-zinc-600 text-center py-10 italic text-xs font-mono">
                  [Không ghi nhận bất thường]
                </div>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className="p-2.5 bg-slate-950 rounded border border-slate-850 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-[11px] text-slate-300 block truncate leading-tight">{alert.cameraName}</strong>
                        <span className="text-[9px] text-zinc-500 font-mono shrink-0">{new Date(alert.time).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-[11px] text-zinc-500 leading-relaxed mt-1">
                        {alert.description}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

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
                        setCameraForm({ name: '', youtubeUrl: '', lat: '', lng: '', status: 'active' });
                        setClickedCoords(null);
                      }} 
                      className="text-[10px] text-zinc-500 hover:text-white underline font-mono"
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
                        className="w-full bg-indigo-650 hover:bg-indigo-600 text-white font-medium py-1.5 rounded transition cursor-pointer text-xs"
                      >
                        <span>Xác nhận</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* YOLO live rendering Player */}
            <div className={`col-span-12 ${adminMode ? 'xl:col-span-8' : 'xl:col-span-12'}`}>
              {selectedCamera ? (
                <YoloStreamPlayer
                  camera={selectedCamera}
                  yoloConfig={yoloConfig}
                  onAlertTriggered={handleAlertTriggered}
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
