export interface YoloConfig {
  confidenceThreshold: number; // e.g. 0.45
  iouThreshold: number; // e.g. 0.35
  classesEnabled: string[]; // ['car', 'motorcycle', 'truck', 'bus']
  processingSpeed: number; // 25, 30, 45fps
  showBoxes: boolean;
  showLabels: boolean;
  showConfidence: boolean;
}

export interface Camera {
  id: string;
  name: string;
  youtubeUrl: string;
  lat: number;
  lng: number;
  status: 'active' | 'inactive';
  lastActive: string;
  vehicleCount: number;
  averageSpeed: number;
  trafficStatus: 'normal' | 'moderate' | 'congested';
  yoloConfig: YoloConfig;
  lastTelemetry?: string;
  carCount?: number;
  motorcycleCount?: number;
  truckCount?: number;
  busCount?: number;
  bicycleCount?: number;
  lastBoxes?: { id?: number; class: string; confidence: number; box: number[]; speed?: number; speeding?: boolean }[];
  detectionZone?: { x: number; y: number }[];
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'user';
}

export interface TrafficAlert {
  id: string;
  cameraId: string;
  cameraName: string;
  time: string;
  type: 'congestion' | 'speeding' | 'accident' | 'normal';
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
}
