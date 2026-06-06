import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dbInstance from './src/db';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON and URL-encoded body parsers
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Middleware for CORS check optionally, or headers
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
  });

  // --- API ROUTES ---

  // Auth Group
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp tài khoản và mật khẩu' });
    }
    const result = dbInstance.login(username, password);
    if (!result.success) {
      return res.status(401).json(result);
    }
    return res.json(result);
  });

  app.post('/api/auth/register', (req, res) => {
    const { username, fullName, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
    }
    const result = dbInstance.register(username, fullName || username, password, role || 'user');
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  });

  // Cameras CRUD
  app.get('/api/cameras', (req, res) => {
    try {
      const cams = dbInstance.getCameras();
      return res.json({ success: true, cameras: cams });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/cameras/:id', (req, res) => {
    const cam = dbInstance.getCameraById(req.params.id);
    if (!cam) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy camera tương đương' });
    }
    return res.json({ success: true, camera: cam });
  });

  app.post('/api/cameras', (req, res) => {
    const { name, youtubeUrl, lat, lng, status } = req.body;
    if (!name || !youtubeUrl || lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, error: 'Vui lòng điền đủ tên camera, link live Youtube và lấy toạ độ bản đồ' });
    }
    try {
      const newCam = dbInstance.addCamera({
        name,
        youtubeUrl,
        lat: Number(lat),
        lng: Number(lng),
        status: status || 'active',
      });
      return res.json({ success: true, camera: newCam, msg: 'Thêm điểm camera giao thông thành công' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/cameras/:id', (req, res) => {
    const id = req.params.id;
    try {
      const updated = dbInstance.updateCamera(id, req.body);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy camera để cập nhật' });
      }
      return res.json({ success: true, camera: updated, msg: 'Cập nhật thiết bị thành công' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Python YOLO Stream Telemetry receiver
  app.post('/api/cameras/:id/telemetry', (req, res) => {
    const id = req.params.id;
    const { 
      vehicleCount, 
      averageSpeed, 
      trafficStatus, 
      alert,
      carCount,
      motorcycleCount,
      truckCount,
      busCount,
      bicycleCount,
      boxes
    } = req.body;
    try {
      const updatedData: any = {
        vehicleCount: Number(vehicleCount),
        averageSpeed: Number(averageSpeed),
        trafficStatus: trafficStatus || 'normal',
        lastTelemetry: new Date().toISOString()
      };

      if (carCount !== undefined) updatedData.carCount = Number(carCount);
      if (motorcycleCount !== undefined) updatedData.motorcycleCount = Number(motorcycleCount);
      if (truckCount !== undefined) updatedData.truckCount = Number(truckCount);
      if (busCount !== undefined) updatedData.busCount = Number(busCount);
      if (bicycleCount !== undefined) updatedData.bicycleCount = Number(bicycleCount);
      if (boxes !== undefined) updatedData.lastBoxes = boxes;

      const updated = dbInstance.updateCamera(id, updatedData);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy camera để nhận diện' });
      }
      
      // If Python sends a custom alert
      if (alert) {
        dbInstance.addAlert({
          cameraId: id,
          cameraName: updated.name,
          type: alert.type || 'speeding',
          description: alert.description || `Phát hiện phương tiện bất thường tại ${updated.name}`,
          severity: alert.severity || 'low'
        });
      }
      
      return res.json({ success: true, camera: updated, msg: 'Cập nhật telemetry từ Python CUDA YOLOv11 thành công!' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/cameras/:id', (req, res) => {
    const id = req.params.id;
    try {
      const success = dbInstance.deleteCamera(id);
      if (!success) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy camera trên bản đồ' });
      }
      return res.json({ success: true, msg: 'Đã xoá địa điểm camera WebGIS thành công' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Alerts API
  app.get('/api/alerts', (req, res) => {
    try {
      const alerts = dbInstance.getAlerts();
      return res.json({ success: true, alerts });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/alerts', (req, res) => {
    const { cameraId, cameraName, type, description, severity } = req.body;
    if (!cameraId || !cameraName || !type || !description) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin cảnh báo' });
    }
    try {
      const newAlert = dbInstance.addAlert({
        cameraId,
        cameraName,
        type,
        description,
        severity: severity || 'low',
      });
      return res.json({ success: true, alert: newAlert });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Serve static assets / Vite files
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware loaded under development mode.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Statically serving built files in production mode.');
  }

  // Bind server listener
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running internally on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal failure running fullstack express server:', err);
});
