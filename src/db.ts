import fs from 'fs';
import path from 'path';
import { Camera, User, TrafficAlert, YoloConfig } from './types';

const DB_FILE = path.join(process.cwd(), 'database.json');

interface DatabaseSchema {
  users: User[];
  cameras: Camera[];
  alerts: TrafficAlert[];
}

const DEFAULT_YOLO_CONFIG: YoloConfig = {
  confidenceThreshold: 0.45,
  iouThreshold: 0.35,
  classesEnabled: ['car', 'motorcycle', 'truck', 'bus'],
  processingSpeed: 30,
  showBoxes: true,
  showLabels: true,
  showConfidence: true,
};

const DEFAULT_CAMERAS: Camera[] = [
  {
    id: 'cam-1',
    name: 'Camera Cầu Rồng - Đà Nẵng',
    youtubeUrl: 'https://www.youtube.com/watch?v=F076p_M9M_8',
    lat: 16.0612,
    lng: 108.2274,
    status: 'active',
    lastActive: new Date().toISOString(),
    vehicleCount: 42,
    averageSpeed: 45,
    trafficStatus: 'normal',
    yoloConfig: { ...DEFAULT_YOLO_CONFIG },
  },
  {
    id: 'cam-2',
    name: 'Camera Cầu Sông Hàn (Quay Trực Tiếp)',
    youtubeUrl: 'https://www.youtube.com/watch?v=gX6Z_GfnyP4',
    lat: 16.0721,
    lng: 108.2263,
    status: 'active',
    lastActive: new Date().toISOString(),
    vehicleCount: 68,
    averageSpeed: 38,
    trafficStatus: 'moderate',
    yoloConfig: { ...DEFAULT_YOLO_CONFIG, confidenceThreshold: 0.5 },
  },
  {
    id: 'cam-3',
    name: 'Camera Giám Sát Bạch Đằng Riverside',
    youtubeUrl: 'https://www.youtube.com/watch?v=21X5lGlDOfg',
    lat: 16.0645,
    lng: 108.2255,
    status: 'active',
    lastActive: new Date().toISOString(),
    vehicleCount: 15,
    averageSpeed: 52,
    trafficStatus: 'normal',
    yoloConfig: { ...DEFAULT_YOLO_CONFIG, confidenceThreshold: 0.4 },
  },
  {
    id: 'cam-4',
    name: 'Camera Nút Giao Nguyễn Văn Linh - Nguyễn Tri Phương',
    youtubeUrl: 'https://www.youtube.com/watch?v=H7uXq7_2mxs',
    lat: 16.0594,
    lng: 108.2045,
    status: 'active',
    lastActive: new Date().toISOString(),
    vehicleCount: 95,
    averageSpeed: 22,
    trafficStatus: 'congested',
    yoloConfig: { ...DEFAULT_YOLO_CONFIG, confidenceThreshold: 0.45 },
  },
];

const DEFAULT_ALERTS: TrafficAlert[] = [
  {
    id: 'alert-1',
    cameraId: 'cam-4',
    cameraName: 'Camera Nút Giao Nguyễn Văn Linh - Nguyễn Tri Phương',
    time: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    type: 'congestion',
    description: 'Úng ứ cục bộ rẽ vào sân bay giờ cao điểm chiều, luồng phương tiện đông.',
    severity: 'medium',
  },
  {
    id: 'alert-2',
    cameraId: 'cam-2',
    cameraName: 'Camera Cầu Sông Hàn (Quay Trực Tiếp)',
    time: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    type: 'speeding',
    description: 'Phát hiện ô tô biển số 43A-XXXX di chuyển vượt quá tốc độ cho phép (68km/h).',
    severity: 'low',
  }
];

class SQLiteJSONDatabase {
  private data: DatabaseSchema;

  constructor() {
    this.data = { users: [], cameras: [], alerts: [] };
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        // Ensure default data if empty or missing
        if (!this.data.cameras || this.data.cameras.length === 0) {
          this.data.cameras = DEFAULT_CAMERAS;
          this.save();
        }
        if (!this.data.alerts || this.data.alerts.length === 0) {
          this.data.alerts = DEFAULT_ALERTS;
          this.save();
        }
      } else {
        this.data = {
          users: [
            { id: 'user-admin', username: 'admin', fullName: 'Quản trị viên Hệ thống', role: 'admin' },
            { id: 'user-demo', username: 'user', fullName: 'Khách giám sát giao thông', role: 'user' }
          ],
          cameras: DEFAULT_CAMERAS,
          alerts: DEFAULT_ALERTS
        };
        // Also save mock credentials associated passwords in memory or config map
        this.save();
      }
    } catch (e) {
      console.error('Error loading database, setting defaults', e);
      this.data = {
        users: [
          { id: 'user-admin', username: 'admin', fullName: 'Quản trị viên Hệ thống', role: 'admin' },
          { id: 'user-demo', username: 'user', fullName: 'Khách giám sát giao thông', role: 'user' }
        ],
        cameras: DEFAULT_CAMERAS,
        alerts: DEFAULT_ALERTS
      };
      this.save();
    }
  }

  private save() {
    try {
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error writing to database.json', e);
    }
  }

  // Auth Operations (Using hardcoded demo passwords for safety and quick local start)
  public login(username: string, passwordHash: string): { success: boolean; user?: User; error?: string } {
    const found = this.data.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!found) {
      return { success: false, error: 'Tài khoản không tồn tại' };
    }
    // Simple password validation for demo: admin -> admin123, user -> 123456
    if (found.role === 'admin' && passwordHash !== 'admin123') {
      return { success: false, error: 'Mật khẩu quản trị viên không chính xác' };
    }
    if (found.role === 'user' && passwordHash !== '123456') {
      return { success: false, error: 'Mật khẩu người dùng không chính xác' };
    }
    return { success: true, user: found };
  }

  public register(username: string, fullName: string, passwordHash: string, role: 'admin' | 'user' = 'user'): { success: boolean; user?: User; error?: string } {
    const normalized = username.trim().toLowerCase();
    if (this.data.users.some(u => u.username.toLowerCase() === normalized)) {
      return { success: false, error: 'Tên đăng nhập đã tồn tại trên hệ thống sqlite' };
    }
    const newUser: User = {
      id: `user-${Date.now()}`,
      username: username.trim(),
      fullName: fullName.trim() || username,
      role: role
    };
    this.data.users.push(newUser);
    this.save();
    return { success: true, user: newUser };
  }

  // Camera Operations
  public getCameras(): Camera[] {
    this.load();
    return this.data.cameras;
  }

  public getCameraById(id: string): Camera | undefined {
    this.load();
    return this.data.cameras.find(c => c.id === id);
  }

  public addCamera(camera: Omit<Camera, 'id' | 'lastActive' | 'vehicleCount' | 'averageSpeed' | 'trafficStatus' | 'yoloConfig'>): Camera {
    this.load();
    const newCam: Camera = {
      ...camera,
      id: `cam-${Date.now()}`,
      lastActive: new Date().toISOString(),
      vehicleCount: 0,
      averageSpeed: 50,
      trafficStatus: 'normal',
      yoloConfig: { ...DEFAULT_YOLO_CONFIG }
    };
    this.data.cameras.push(newCam);
    this.save();
    return newCam;
  }

  public updateCamera(id: string, updates: Partial<Camera>): Camera | null {
    this.load();
    const index = this.data.cameras.findIndex(c => c.id === id);
    if (index === -1) return null;
    
    this.data.cameras[index] = {
      ...this.data.cameras[index],
      ...updates,
      lastActive: new Date().toISOString()
    };
    
    this.save();
    return this.data.cameras[index];
  }

  public deleteCamera(id: string): boolean {
    this.load();
    const lengthBefore = this.data.cameras.length;
    this.data.cameras = this.data.cameras.filter(c => c.id !== id);
    if (this.data.cameras.length !== lengthBefore) {
      this.save();
      return true;
    }
    return false;
  }

  // Alerts Operations
  public getAlerts(): TrafficAlert[] {
    this.load();
    return this.data.alerts;
  }

  public addAlert(alert: Omit<TrafficAlert, 'id' | 'time'>): TrafficAlert {
    this.load();
    const newAlert: TrafficAlert = {
      ...alert,
      id: `alert-${Date.now()}`,
      time: new Date().toISOString()
    };
    this.data.alerts.unshift(newAlert); // Newest first
    if (this.data.alerts.length > 50) {
      this.data.alerts.pop(); // Limit logs
    }
    this.save();
    return newAlert;
  }
}

export const dbInstance = new SQLiteJSONDatabase();
export default dbInstance;
