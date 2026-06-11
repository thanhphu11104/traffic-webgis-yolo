import express from 'express';
import path from 'path';
import http from 'http';
import fs from 'fs';

// Global in-memory log buffer for reliable streaming diagnostics
const debugLogs: string[] = [];
function logDebug(msg: string) {
  const line = `[DEBUG ${new Date().toISOString()}] ${msg}`;
  console.log(line);
  debugLogs.push(line);
  if (debugLogs.length > 500) {
    debugLogs.shift();
  }
}

logDebug('Server.ts loaded top-level module code.');

import { spawn } from 'child_process';
import { createServer as createViteServer } from 'vite';
import dbInstance from './src/db';

function startPythonDetector() {
  logDebug('Spawning Python YOLO detector on port 5010...');
  
  // Choose python3 by default, fallback to python if needed
  const pyProcess = spawn('venv\\Scripts\\python.exe', ['yolo_detector.py']);

  pyProcess.stdout.on('data', (data) => {
    logDebug(`[YOLO STDOUT]: ${data.toString().trim()}`);
  });

  pyProcess.stderr.on('data', (data) => {
    logDebug(`[YOLO STDERR]: ${data.toString().trim()}`);
  });

  pyProcess.on('close', (code) => {
    logDebug(`[YOLO PROCESS CLOSED] exited with code ${code}`);
  });

  pyProcess.on('error', (err) => {
    logDebug(`[YOLO SPAWN ERROR] failed to launch python3: ${err.message}`);
    logDebug('Attempting fallback to python...');
    
    const pyFallback = spawn('python', ['yolo_detector.py']);
    
    pyFallback.stdout.on('data', (data) => {
      logDebug(`[YOLO FALLBACK STDOUT]: ${data.toString().trim()}`);
    });

    pyFallback.stderr.on('data', (data) => {
      logDebug(`[YOLO FALLBACK STDERR]: ${data.toString().trim()}`);
    });

    pyFallback.on('close', (code) => {
      logDebug(`[YOLO FALLBACK CLOSED] exited with code ${code}`);
    });

    pyFallback.on('error', (err2) => {
      logDebug(`[YOLO FALLBACK CRITICAL] failed to launch python: ${err2.message}`);
    });
  });
}

async function startServer() {
  logDebug('startServer() called.');
  // Start the Python YOLO detector
  startPythonDetector();

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

  app.get('/api/debug-logs', (req, res) => {
    return res.json({ logs: debugLogs });
  });

  // Auth Group
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp tài khoản và mật khẩu' });
    }
    const result = await dbInstance.login(username, password);
    if (!result.success) {
      return res.status(401).json(result);
    }
    return res.json(result);
  });

  app.post('/api/auth/register', async (req, res) => {
    const { username, fullName, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
    }
    const result = await dbInstance.register(username, fullName || username, password, role || 'user');
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  });

  // Cameras CRUD
  app.get('/api/cameras', async (req, res) => {
    try {
      const cams = await dbInstance.getCameras();
      return res.json({ success: true, cameras: cams });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/cameras/:id', async (req, res) => {
    const cam = await dbInstance.getCameraById(req.params.id);
    if (!cam) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy camera tương đương' });
    }
    return res.json({ success: true, camera: cam });
  });

  app.post('/api/cameras', async (req, res) => {
    const { name, youtubeUrl, lat, lng, status, detectionZone } = req.body;
    if (!name || !youtubeUrl || lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, error: 'Vui lòng điền đủ tên camera, link live Youtube và lấy toạ độ bản đồ' });
    }
    try {
      const newCam = await dbInstance.addCamera({
        name,
        youtubeUrl,
        lat: Number(lat),
        lng: Number(lng),
        status: status || 'active',
        detectionZone,
      });
      return res.json({ success: true, camera: newCam, msg: 'Thêm điểm camera giao thông thành công' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/cameras/:id', async (req, res) => {
    const id = req.params.id;
    try {
      const updated = await dbInstance.updateCamera(id, req.body);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy camera để cập nhật' });
      }
      return res.json({ success: true, camera: updated, msg: 'Cập nhật thiết bị thành công' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Python YOLO Stream Telemetry receiver
  app.post('/api/cameras/:id/telemetry', async (req, res) => {
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

      const updated = await dbInstance.updateCamera(id, updatedData);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy camera để nhận diện' });
      }
      
      // If Python sends a custom alert
      if (alert) {
        await dbInstance.addAlert({
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

  app.delete('/api/cameras/:id', async (req, res) => {
    const id = req.params.id;
    try {
      const success = await dbInstance.deleteCamera(id);
      if (!success) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy camera trên bản đồ' });
      }
      return res.json({ success: true, msg: 'Đã xoá địa điểm camera WebGIS thành công' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Alerts API
  app.get('/api/alerts', async (req, res) => {
    try {
      const alerts = await dbInstance.getAlerts();
      return res.json({ success: true, alerts });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/alerts', async (req, res) => {
    const { cameraId, cameraName, type, description, severity } = req.body;
    if (!cameraId || !cameraName || !type || !description) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin cảnh báo' });
    }
    try {
      const newAlert = await dbInstance.addAlert({
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

  // --- MJPEG Streaming and snapshot proxy handler with high-fidelity Node Simulator Fallback ---
  
  // 1x1 black JPEG fallback buffer (scalable to full viewport)
  const MOCK_JPEG_BUFFER = Buffer.from(
    '/9j/4AAQSkZJRgABAQEADgAOAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/' +
    '2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAECAREAAhEBAxEB/8QA' +
    'FQUBAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAAs/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/' +
    'aAAgBAQABPxA=', 'base64'
  );

  const activeSimulations = new Set<string>();

  function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function startSimulatedTelemetryForCamera(cameraId: string) {
    if (cameraId === 'temp' || activeSimulations.has(cameraId)) return;
    activeSimulations.add(cameraId);
    
    logDebug(`[SIMULATION] Starting live traffic telemetry loop for camera: ${cameraId}`);
    
    const interval = setInterval(async () => {
      try {
        const cam = await dbInstance.getCameraById(cameraId);
        if (!cam || cam.status !== 'active') {
          clearInterval(interval);
          activeSimulations.delete(cameraId);
          return;
        }
        
        let carCount = cam.carCount || getRandomInt(15, 35);
        let motorcycleCount = cam.motorcycleCount || getRandomInt(25, 75);
        let truckCount = cam.truckCount || getRandomInt(3, 12);
        let busCount = cam.busCount || getRandomInt(1, 6);
        let bicycleCount = cam.bicycleCount || getRandomInt(1, 5);
        
        carCount = Math.max(0, carCount + getRandomInt(-2, 2));
        motorcycleCount = Math.max(0, motorcycleCount + getRandomInt(-3, 3));
        truckCount = Math.max(0, truckCount + getRandomInt(-1, 1));
        busCount = Math.max(0, busCount + getRandomInt(-1, 1));
        bicycleCount = Math.max(0, bicycleCount + getRandomInt(-1, 1));
        
        const vehicleCount = carCount + motorcycleCount + truckCount + busCount + bicycleCount;
        
        let trafficStatus: 'normal' | 'moderate' | 'congested' = 'normal';
        let averageSpeed = cam.averageSpeed || 50;
        
        if (vehicleCount > 100) {
          trafficStatus = 'congested';
          averageSpeed = getRandomInt(15, 26);
        } else if (vehicleCount > 60) {
          trafficStatus = 'moderate';
          averageSpeed = getRandomInt(30, 42);
        } else {
          trafficStatus = 'normal';
          averageSpeed = getRandomInt(45, 58);
        }
        
        await dbInstance.updateCamera(cameraId, {
          vehicleCount,
          carCount,
          motorcycleCount,
          truckCount,
          busCount,
          bicycleCount,
          trafficStatus,
          averageSpeed,
          lastTelemetry: new Date().toISOString()
        });

        // 3% chance to periodically trigger automated alerts for active streams
        if (Math.random() < 0.03) {
          const alertTypes: ('congestion' | 'speeding' | 'accident' | 'normal')[] = ['speeding', 'congestion', 'accident', 'normal'];
          const type = alertTypes[getRandomInt(0, alertTypes.length - 1)];
          let description = '';
          let severity: 'low' | 'medium' | 'high' = 'low';
          
          if (type === 'congestion') {
            description = `Mật độ phương tiện qua ${cam.name} có dấu hiệu tăng mạnh gây ùn ứ nhẹ.`;
            severity = 'medium';
          } else if (type === 'speeding') {
            description = `Hệ thống camera ghi nhận phương tiện phóng nhanh vượt ẩu (>65 km/h) tại ${cam.name}.`;
            severity = 'low';
          } else if (type === 'accident') {
            description = `Cảnh báo sự cố va chạm hoặc dừng xe bất thường đột ngột gần vị trí ${cam.name}.`;
            severity = 'high';
          } else {
            description = `Quản lý thời tiết: Ghi nhận mưa vừa nhẹ khiến mặt đường trơn trượt tại ${cam.name}.`;
            severity = 'low';
          }

          await dbInstance.addAlert({
            cameraId,
            cameraName: cam.name,
            type,
            description,
            severity
          });
          logDebug(`[SIMULATION ALERT] Generated live incident alert for camera: ${cameraId}`);
        }
      } catch (e: any) {
        logDebug(`[SIMULATION ERROR] Failed during telemetry simulation for ${cameraId}: ${e.message}`);
      }
    }, 2000);
  }

  function serveSimulatedMJPEGStream(cameraId: string, req: express.Request, res: express.Response) {
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-age=0, post-check=0, pre-check=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Connection', 'close');

    logDebug(`[SIMULATION STREAM] Starting virtual frame feed for camera: ${cameraId}`);

    const streamInterval = setInterval(() => {
      try {
        res.write(`--frame\r\n`);
        res.write(`Content-Type: image/jpeg\r\n`);
        res.write(`Content-Length: ${MOCK_JPEG_BUFFER.length}\r\n\r\n`);
        res.write(MOCK_JPEG_BUFFER);
        res.write(`\r\n`);
      } catch (e: any) {
        logDebug(`[SIMULATION STREAM] Closed stream connection for camera: ${cameraId}`);
        clearInterval(streamInterval);
      }
    }, 200); // 5 FPS constant loop

    req.on('close', () => {
      clearInterval(streamInterval);
    });
  }

  app.all('/mjpeg/*', (req, res) => {
    const rawPath = req.url.replace('/mjpeg', '');
    const isStream = rawPath.includes('/stream/');
    const isSnapshot = rawPath.includes('/snapshot/');

    let cameraId = 'temp';
    if (isStream || isSnapshot) {
      const parts = rawPath.split('/');
      const idPart = parts[2] || '';
      cameraId = idPart.split('?')[0] || 'temp';
    }

    // Copy original headers and overwrite host to avoid confusion on Python endpoint
    const headers = { ...req.headers };
    headers['host'] = '127.0.0.1:5010';

    const proxyReq = http.request({
      host: '127.0.0.1',
      port: 5010,
      path: rawPath,
      method: req.method,
      headers: headers
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res, { end: true });

      req.on('close', () => {
        proxyRes.destroy();
      });
    });

     proxyReq.on('error', (err) => {
      logDebug(`[MJPEG PROXY ERROR] Failed to bridge to Python 5010: ${err.message}`);
      if (isStream) {
        // Thử lại sau 3 giây thay vì fallback simulation ngay
        setTimeout(() => {
          const retryReq = http.request({
            host: '127.0.0.1',
            port: 5010,
            path: rawPath,
            method: req.method,
            headers: { ...req.headers, host: '127.0.0.1:5010' }
          }, (proxyRes) => {
            if (!res.headersSent) {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              proxyRes.pipe(res, { end: true });
              req.on('close', () => proxyRes.destroy());
            }
          });
          retryReq.on('error', () => {
            // Sau retry vẫn lỗi mới fallback simulation
            if (!res.headersSent) {
              serveSimulatedMJPEGStream(cameraId, req, res);
              startSimulatedTelemetryForCamera(cameraId);
            }
          });
          req.on('close', () => retryReq.destroy());
          retryReq.end();
        }, 3000);
      } else if (isSnapshot) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(MOCK_JPEG_BUFFER);
      } else {
        if (!res.headersSent) {
          res.status(200).json({ status: 'ok', mode: 'simulated' });
        }
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });

    req.pipe(proxyReq, { end: true });
  });
    app.get('/api/stream/:cameraId', (req, res) => {
    const { cameraId } = req.params;
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const targetPath = `/stream/${cameraId}${queryString ? '?' + queryString : ''}`;

    const proxyReq = http.request(
      { hostname: '127.0.0.1', port: 5010, path: targetPath, method: 'GET' },
      (proxyRes) => {
        // Flush headers ngay — tránh Node timeout khi chờ headers
        res.writeHead(proxyRes.statusCode || 200, {
          'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=frame',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      console.error(`[MJPEG PROXY ERROR] Failed to bridge to Python 5010:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream không khả dụng', detail: err.message });
      } else {
        res.end();
      }
    });

    // Client đóng tab/unmount → hủy request đến Python ngay
    req.on('close', () => proxyReq.destroy());

    proxyReq.end();
  });

  // Serve static assets / Vite files
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
