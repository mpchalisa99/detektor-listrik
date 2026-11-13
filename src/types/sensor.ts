// W3C Generic Sensor API TypeScript Definitions for Magnetometer

export interface SensorOptions {
  frequency?: number;
  referenceFrame?: 'device' | 'screen';
}

export interface SensorErrorEvent extends Event {
  readonly error: DOMException;
}

export declare class Magnetometer extends EventTarget {
  constructor(options?: SensorOptions);
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly activated: boolean;
  readonly hasReading: boolean;
  readonly timestamp: number | null;
  start(): void;
  stop(): void;
  onreading: ((this: Magnetometer, ev: Event) => unknown) | null;
  onactivate: ((this: Magnetometer, ev: Event) => unknown) | null;
  onerror: ((this: Magnetometer, ev: SensorErrorEvent) => unknown) | null;
}

declare global {
  interface Window {
    Magnetometer?: typeof Magnetometer;
  }
}

export interface MagneticVector {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  timestamp: number;
}

export interface OrientationAngles {
  alpha: number; // Compass yaw [0, 360)
  beta: number;  // Front-to-back pitch [-180, 180]
  gamma: number; // Left-to-right roll [-90, 90]
}

export type AnomalyLevel = 'NORMAL' | 'ELEVATED' | 'ANOMALY';

export interface SpatialHeatmapNode {
  id: string;
  alpha: number;
  beta: number;
  gamma: number;
  magnitude: number;
  x: number;
  y: number;
  z: number;
  level: AnomalyLevel;
  timestamp: number;
}

export interface SensorStatusState {
  camera: 'ON' | 'OFF' | 'ERROR';
  magnetometer: 'ON' | 'OFF' | 'SIMULATED' | 'UNSUPPORTED' | 'DENIED';
  gyroscope: 'ON' | 'OFF' | 'SIMULATED';
  isSecureContext: boolean;
}
