import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { Camera, User, TrafficAlert, YoloConfig } from './types';

const DB_PATH = path.join(process.cwd(), 'database.sqlite');

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
    type: 'congestion',
    description: 'Lưu lượng di chuyển chậm qua cầu Sông Hàn ghi nhận mật độ giao thông tăng mạnh.',
    severity: 'low',
  }
];

function parseCamera(row: any): Camera {
  if (!row) return row;
  return {
    ...row,
    yoloConfig: typeof row.yoloConfig === 'string' ? JSON.parse(row.yoloConfig) : row.yoloConfig,
    detectionZone: typeof row.detectionZone === 'string' ? JSON.parse(row.detectionZone) : row.detectionZone,
    lastBoxes: typeof row.lastBoxes === 'string' ? JSON.parse(row.lastBoxes) : row.lastBoxes,
  };
}

class SQLiteDatabase {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening SQLite database:', err);
      } else {
        console.log('Connected to SQLite database at:', DB_PATH);
        this.initializeSchema();
      }
    });
  }

  private run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  private get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  private async initializeSchema() {
    try {
      // 1. Create table users
      await this.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE,
          fullName TEXT,
          role TEXT,
          passwordHash TEXT
        )
      `);

      // 2. Create table cameras
      await this.run(`
        CREATE TABLE IF NOT EXISTS cameras (
          id TEXT PRIMARY KEY,
          name TEXT,
          youtubeUrl TEXT,
          lat REAL,
          lng REAL,
          status TEXT,
          lastActive TEXT,
          vehicleCount INTEGER,
          averageSpeed INTEGER,
          trafficStatus TEXT,
          yoloConfig TEXT,
          detectionZone TEXT,
          lastTelemetry TEXT,
          carCount INTEGER,
          motorcycleCount INTEGER,
          truckCount INTEGER,
          busCount INTEGER,
          bicycleCount INTEGER,
          lastBoxes TEXT
        )
      `);

      // 3. Create table alerts
      await this.run(`
        CREATE TABLE IF NOT EXISTS alerts (
          id TEXT PRIMARY KEY,
          cameraId TEXT,
          cameraName TEXT,
          time TEXT,
          type TEXT,
          description TEXT,
          severity TEXT
        )
      `);

      // Seed initial data if tables are empty
      const usersCheck = await this.get(`SELECT COUNT(*) as count FROM users`);
      const usersCount = usersCheck ? usersCheck.count : 0;
      if (usersCount === 0) {
        await this.run(`
          INSERT INTO users (id, username, fullName, role, passwordHash) VALUES 
          ('user-admin', 'admin', 'Quản trị viên Hệ thống', 'admin', 'admin123'),
          ('user-demo', 'user', 'Khách giám sát giao thông', 'user', '123456')
        `);
        console.log('[SQLite] Seeded users table');
      }

      const camerasCheck = await this.get(`SELECT COUNT(*) as count FROM cameras`);
      const camerasCount = camerasCheck ? camerasCheck.count : 0;
      if (camerasCount === 0) {
        for (const cam of DEFAULT_CAMERAS) {
          await this.run(`
            INSERT INTO cameras (
              id, name, youtubeUrl, lat, lng, status, lastActive, 
              vehicleCount, averageSpeed, trafficStatus, yoloConfig, detectionZone,
              carCount, motorcycleCount, truckCount, busCount, bicycleCount, lastBoxes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            cam.id,
            cam.name,
            cam.youtubeUrl,
            cam.lat,
            cam.lng,
            cam.status,
            cam.lastActive,
            cam.vehicleCount,
            cam.averageSpeed,
            cam.trafficStatus,
            JSON.stringify(cam.yoloConfig),
            JSON.stringify(cam.detectionZone || []),
            0, 0, 0, 0, 0,
            JSON.stringify([])
          ]);
        }
        console.log('[SQLite] Seeded cameras table');
      }

      const alertsCheck = await this.get(`SELECT COUNT(*) as count FROM alerts`);
      const alertsCount = alertsCheck ? alertsCheck.count : 0;
      if (alertsCount === 0) {
        for (const alert of DEFAULT_ALERTS) {
          await this.run(`
            INSERT INTO alerts (id, cameraId, cameraName, time, type, description, severity) VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            alert.id,
            alert.cameraId,
            alert.cameraName,
            alert.time,
            alert.type,
            alert.description,
            alert.severity
          ]);
        }
        console.log('[SQLite] Seeded alerts table');
      }
    } catch (err) {
      console.error('Error during SQLite setup schema initialization:', err);
    }
  }

  // Auth Operations
  public async login(username: string, passwordHash: string): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const found = await this.get(`SELECT * FROM users WHERE LOWER(username) = ?`, [username.trim().toLowerCase()]);
      if (!found) {
        return { success: false, error: 'Tài khoản không tồn tại trên hệ thống SQLite' };
      }
      if (found.role === 'admin' && passwordHash !== 'admin123') {
        return { success: false, error: 'Mật khẩu quản trị viên không chính xác' };
      }
      if (found.role === 'user' && passwordHash !== '123456') {
        return { success: false, error: 'Mật khẩu người dùng không chính xác' };
      }
      return { 
        success: true, 
        user: { id: found.id, username: found.username, fullName: found.fullName, role: found.role as 'admin' | 'user' } 
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  public async register(username: string, fullName: string, passwordHash: string, role: 'admin' | 'user' = 'user'): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const normalized = username.trim().toLowerCase();
      const existing = await this.get(`SELECT * FROM users WHERE LOWER(username) = ?`, [normalized]);
      if (existing) {
        return { success: false, error: 'Tên đăng nhập đã tồn tại trên hệ thống SQLite' };
      }
      const newUser: User = {
        id: `user-${Date.now()}`,
        username: username.trim(),
        fullName: fullName.trim() || username,
        role: role
      };
      await this.run(
        `INSERT INTO users (id, username, fullName, role, passwordHash) VALUES (?, ?, ?, ?, ?)`,
        [newUser.id, newUser.username, newUser.fullName, newUser.role, passwordHash]
      );
      return { success: true, user: newUser };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // Camera Operations
  public async getCameras(): Promise<Camera[]> {
    try {
      const rows = await this.all(`SELECT * FROM cameras`);
      return rows.map(parseCamera);
    } catch (e) {
      console.error('Error fetching cameras from SQLite:', e);
      return [];
    }
  }

  public async getCameraById(id: string): Promise<Camera | undefined> {
    try {
      const row = await this.get(`SELECT * FROM cameras WHERE id = ?`, [id]);
      return row ? parseCamera(row) : undefined;
    } catch (e) {
      console.error(`Error fetching camera ${id} from SQLite:`, e);
      return undefined;
    }
  }

  public async addCamera(camera: Omit<Camera, 'id' | 'lastActive' | 'vehicleCount' | 'averageSpeed' | 'trafficStatus' | 'yoloConfig'>): Promise<Camera> {
    const id = `cam-${Date.now()}`;
    const lastActive = new Date().toISOString();
    const yoloConfig = { ...DEFAULT_YOLO_CONFIG };
    const detectionZone = camera.detectionZone || [];
    
    await this.run(`
      INSERT INTO cameras (
        id, name, youtubeUrl, lat, lng, status, lastActive, 
        vehicleCount, averageSpeed, trafficStatus, yoloConfig, detectionZone,
        carCount, motorcycleCount, truckCount, busCount, bicycleCount, lastBoxes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      camera.name,
      camera.youtubeUrl,
      camera.lat,
      camera.lng,
      camera.status,
      lastActive,
      0, 50, 'normal',
      JSON.stringify(yoloConfig),
      JSON.stringify(detectionZone),
      0, 0, 0, 0, 0,
      JSON.stringify([])
    ]);

    return {
      ...camera,
      id,
      lastActive,
      vehicleCount: 0,
      averageSpeed: 50,
      trafficStatus: 'normal',
      yoloConfig,
      detectionZone
    };
  }

  public async updateCamera(id: string, updates: Partial<Camera>): Promise<Camera | null> {
    const current = await this.getCameraById(id);
    if (!current) return null;

    const fieldsToUpdate: string[] = [];
    const params: any[] = [];

    const keys = Object.keys(updates) as (keyof Camera)[];
    for (const key of keys) {
      if (key === 'id') continue;
      
      let val: any = updates[key];
      if (key === 'yoloConfig' || key === 'detectionZone' || key === 'lastBoxes') {
        val = JSON.stringify(val);
      }
      
      fieldsToUpdate.push(`${key} = ?`);
      params.push(val);
    }

    if (fieldsToUpdate.length > 0) {
      fieldsToUpdate.push(`lastActive = ?`);
      params.push(new Date().toISOString());
      
      params.push(id);
      await this.run(`
        UPDATE cameras 
        SET ${fieldsToUpdate.join(', ')} 
        WHERE id = ?
      `, params);
    }

    const updated = await this.getCameraById(id);
    return updated || null;
  }

  public async deleteCamera(id: string): Promise<boolean> {
    const res = await this.run(`DELETE FROM cameras WHERE id = ?`, [id]);
    return res.changes > 0;
  }

  // Alerts Operations
  public async getAlerts(): Promise<TrafficAlert[]> {
    try {
      const rows = await this.all(`SELECT * FROM alerts ORDER BY time DESC LIMIT 50`);
      return rows;
    } catch (e) {
      console.error('Error fetching alerts from SQLite:', e);
      return [];
    }
  }

  public async addAlert(alert: Omit<TrafficAlert, 'id' | 'time'>): Promise<TrafficAlert> {
    const id = `alert-${Date.now()}`;
    const time = new Date().toISOString();
    
    await this.run(`
      INSERT INTO alerts (id, cameraId, cameraName, time, type, description, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      alert.cameraId,
      alert.cameraName,
      time,
      alert.type,
      alert.description,
      alert.severity
    ]);

    return {
      ...alert,
      id,
      time
    };
  }
}

export const dbInstance = new SQLiteDatabase();
export default dbInstance;
