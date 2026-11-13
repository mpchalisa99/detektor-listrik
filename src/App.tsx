/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  Compass,
  Crosshair,
  Layers,
  Play,
  Radio,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ARHeatmapCanvas } from './components/ARHeatmapCanvas';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import {
  AnomalyLevel,
  Magnetometer,
  MagneticVector,
  OrientationAngles,
  SensorErrorEvent,
  SensorStatusState,
  SpatialHeatmapNode,
} from './types/sensor';
import { tacticalAudio } from './utils/audioAlert';

function getAnomalyLevel(magnitude: number): AnomalyLevel {
  if (magnitude > 60) return 'ANOMALY';
  if (magnitude >= 45) return 'ELEVATED';
  return 'NORMAL';
}

// Angular distance helper for deciding when to plot a new spatial node
function angularDistance(a: OrientationAngles, b: OrientationAngles): number {
  const dAlpha = ((a.alpha - b.alpha + 540) % 360) - 180;
  const dBeta = a.beta - b.beta;
  const dGamma = a.gamma - b.gamma;
  return Math.sqrt(dAlpha * dAlpha + dBeta * dBeta + dGamma * dGamma * 0.25);
}

// Simulated wall anomaly hotspots (paku baja, jalur kabel, alat penyadap) for Field Emulation mode
const SIMULATED_WALL_HOTSPOTS = [
  { alpha: 172, beta: 76, radiusDeg: 7.5, peakUt: 88.4, label: 'Alat Penyadap / Neodymium Core' },
  { alpha: 186, beta: 82, radiusDeg: 6.0, peakUt: 68.2, label: 'Paku Baja / Rangka Kolom' },
  { alpha: 164, beta: 85, radiusDeg: 8.0, peakUt: 54.6, label: 'Jalur Kabel Listrik AC' },
  { alpha: 194, beta: 72, radiusDeg: 6.5, peakUt: 79.5, label: 'Anomali Feromagnetik Kuat' },
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const magSensorRef = useRef<Magnetometer | null>(null);
  const simIntervalRef = useRef<number | null>(null);

  // Check HTTPS or localhost requirement on mount
  const isSecureEnv =
    typeof window !== 'undefined' &&
    (window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');

  const [isSweeping, setIsSweeping] = useState(false);
  const [projectionMode, setProjectionMode] = useState<'2D' | '3D'>('2D');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [simulationActive, setSimulationActive] = useState(false);

  const [sensorStatus, setSensorStatus] = useState<SensorStatusState>({
    camera: 'OFF',
    magnetometer: 'OFF',
    gyroscope: 'OFF',
    isSecureContext: isSecureEnv,
  });

  const [errorNotifications, setErrorNotifications] = useState<string[]>([]);
  const [magnetic, setMagnetic] = useState<MagneticVector>({
    x: 18.4,
    y: -24.2,
    z: 26.8,
    magnitude: 40.5,
    timestamp: Date.now(),
  });

  const [orientation, setOrientation] = useState<OrientationAngles>({
    alpha: 180.0,
    beta: 78.0,
    gamma: 0.0,
  });

  const [nodes, setNodes] = useState<SpatialHeatmapNode[]>([]);
  const [peakMagnitude, setPeakMagnitude] = useState<number>(40.5);

  const orientationRef = useRef<OrientationAngles>(orientation);
  const lastRecordedRef = useRef<{ orientation: OrientationAngles; magnitude: number } | null>(null);

  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);

  const addErrorNotification = useCallback((msg: string) => {
    setErrorNotifications((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
  }, []);

  // Record spatial heatmap node when smartphone moves or magnetic value spikes
  const recordSpatialReading = useCallback(
    (magVec: MagneticVector, currentOri: OrientationAngles) => {
      const last = lastRecordedRef.current;
      const dist = last ? angularDistance(currentOri, last.orientation) : 999;
      const magDelta = last ? Math.abs(magVec.magnitude - last.magnitude) : 999;

      // Record node if device rotated >= 1.35 degrees or magnetic field shifted >= 3.5 µT
      if (dist >= 1.35 || magDelta >= 3.5) {
        const newNode: SpatialHeatmapNode = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          alpha: currentOri.alpha,
          beta: currentOri.beta,
          gamma: currentOri.gamma,
          magnitude: magVec.magnitude,
          x: magVec.x,
          y: magVec.y,
          z: magVec.z,
          level: getAnomalyLevel(magVec.magnitude),
          timestamp: Date.now(),
        };

        lastRecordedRef.current = {
          orientation: { ...currentOri },
          magnitude: magVec.magnitude,
        };

        setNodes((prev) => {
          // Keep up to 420 spatial nodes for smooth 60fps AR canvas rendering
          const updated = prev.length >= 420 ? prev.slice(prev.length - 419) : prev;
          return [...updated, newNode];
        });
      }
    },
    []
  );

  // DeviceOrientation (Gyroscope) handler
  const handleDeviceOrientation = useCallback((event: DeviceOrientationEvent) => {
    if (event.alpha === null && event.beta === null && event.gamma === null) {
      return;
    }
    const nextOri: OrientationAngles = {
      alpha: event.alpha ?? orientationRef.current.alpha,
      beta: event.beta ?? orientationRef.current.beta,
      gamma: event.gamma ?? orientationRef.current.gamma,
    };
    orientationRef.current = nextOri;
    setOrientation(nextOri);
    setSensorStatus((prev) => (prev.gyroscope === 'ON' ? prev : { ...prev, gyroscope: 'ON' }));
  }, []);

  // Stop all active streams and sensors cleanly
  const stopSweeping = useCallback(() => {
    setIsSweeping(false);
    setSimulationActive(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (magSensorRef.current) {
      try {
        magSensorRef.current.stop();
      } catch {
        // Ignore stop error
      }
      magSensorRef.current = null;
    }
    if (simIntervalRef.current) {
      window.clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }

    window.removeEventListener('deviceorientation', handleDeviceOrientation, true);

    setSensorStatus((prev) => ({
      ...prev,
      camera: 'OFF',
      magnetometer: 'OFF',
      gyroscope: 'OFF',
    }));
  }, [handleDeviceOrientation]);

  // Start Field Emulation / Calibration Simulator (for testing when hardware Magnetometer is unavailable)
  const startFieldSimulation = useCallback(() => {
    if (simIntervalRef.current) {
      window.clearInterval(simIntervalRef.current);
    }
    setSimulationActive(true);
    setSensorStatus((prev) => ({
      ...prev,
      magnetometer: 'SIMULATED',
      gyroscope: prev.gyroscope === 'ON' ? 'ON' : 'SIMULATED',
    }));

    let phase = 0;
    simIntervalRef.current = window.setInterval(() => {
      phase += 0.065;
      const currOri = orientationRef.current;

      // If no physical gyroscope movement, gently sweep around center or follow manual drag
      const simAlpha = currOri.alpha;
      const simBeta = currOri.beta;

      // Baseline geomagnetic field in Indonesia / Equatorial region (~38 µT)
      let bx = 21.5 + Math.sin(phase * 1.7) * 1.4;
      let by = -24.0 + Math.cos(phase * 1.3) * 1.4;
      let bz = 20.2 + Math.sin(phase * 2.1) * 1.2;

      // Add contribution from simulated hidden wall anomalies (steel nails, AC conduit, bugging transmitter)
      for (const spot of SIMULATED_WALL_HOTSPOTS) {
        const dA = ((simAlpha - spot.alpha + 540) % 360) - 180;
        const dB = simBeta - spot.beta;
        const dist = Math.hypot(dA, dB);
        if (dist < spot.radiusDeg * 1.8) {
          const factor = Math.exp(-(dist * dist) / (2 * (spot.radiusDeg * 0.55) ** 2));
          const extra = (spot.peakUt - 38) * factor;
          bx += extra * 0.58;
          by += extra * 0.48;
          bz += extra * 0.66;
        }
      }

      const totalMagnitude = Math.sqrt(bx * bx + by * by + bz * bz);
      const reading: MagneticVector = {
        x: Number(bx.toFixed(2)),
        y: Number(by.toFixed(2)),
        z: Number(bz.toFixed(2)),
        magnitude: Number(totalMagnitude.toFixed(1)),
        timestamp: Date.now(),
      };

      setMagnetic(reading);
      setPeakMagnitude((prev) => Math.max(prev, reading.magnitude));
      tacticalAudio.updateFieldReading(reading.magnitude, audioEnabled);
      recordSpatialReading(reading, currOri);
    }, 80);
  }, [audioEnabled, recordSpatialReading]);

  // Main "Start Sweeping" handler: requests Camera, Magnetometer, and Gyroscope permissions
  const startSweeping = async () => {
    setErrorNotifications([]);

    // 1. Verify Secure Context (HTTPS or localhost)
    if (!isSecureEnv) {
      addErrorNotification(
        'KONTEKS TIDAK AMAN: Generic Sensor API & Kamera memerlukan protokol HTTPS atau localhost.'
      );
      return;
    }

    setIsSweeping(true);

    // 2. Request Rear Camera (<video autoPlay playsInline>)
    try {
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch {
        // Fallback to any available video camera (e.g. laptop webcam)
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
      setSensorStatus((prev) => ({ ...prev, camera: 'ON' }));
    } catch (camErr) {
      const errMsg = camErr instanceof Error ? camErr.message : 'Izin ditolak';
      setSensorStatus((prev) => ({ ...prev, camera: 'ERROR' }));
      addErrorNotification(
        `KAMERA GAGAL DIAKSES (${errMsg}): Pastikan izin kamera diizinkan pada browser perangkat Anda.`
      );
    }

    // 3. Request Gyroscope (deviceorientation)
    try {
      const DevOriEvent = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (typeof DevOriEvent.requestPermission === 'function') {
        const permState = await DevOriEvent.requestPermission();
        if (permState === 'granted') {
          window.addEventListener('deviceorientation', handleDeviceOrientation, true);
          setSensorStatus((prev) => ({ ...prev, gyroscope: 'ON' }));
        } else {
          addErrorNotification('IZIN GYROSCOPE DITOLAK: Pelacakan orientasi ruang AR dinonaktifkan.');
        }
      } else {
        window.addEventListener('deviceorientation', handleDeviceOrientation, true);
        setSensorStatus((prev) => ({ ...prev, gyroscope: 'ON' }));
      }
    } catch {
      addErrorNotification('GYROSCOPE ERROR: Gagal menginisialisasi event deviceorientation.');
    }

    // 4. Request Generic Sensor API Magnetometer (X, Y, Z in µT)
    if (typeof window.Magnetometer === 'undefined') {
      setSensorStatus((prev) => ({ ...prev, magnetometer: 'UNSUPPORTED' }));
      addErrorNotification(
        'SENSOR MAGNETOMETER TIDAK DIDUKUNG BROWSER: Pada Chrome Android (POCO X8 Pro), aktifkan flag chrome://flags/#enable-generic-sensor-extra-classes lalu relaunch browser. Mode Simulasi Taktis diaktifkan otomatis agar Anda tetap dapat menguji AR Heatmap.'
      );
      startFieldSimulation();
      return;
    }

    try {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({
            name: 'magnetometer' as PermissionName,
          });
          if (result.state === 'denied') {
            setSensorStatus((prev) => ({ ...prev, magnetometer: 'DENIED' }));
            addErrorNotification(
              'IZIN MAGNETOMETER DITOLAK: Mohon izinkan akses sensor gerak/magnetometer di pengaturan situs browser.'
            );
            return;
          }
        } catch {
          // Some browsers don't support querying 'magnetometer' permission name directly; proceed to instantiate
        }
      }

      const sensor = new window.Magnetometer({ frequency: 30 });
      magSensorRef.current = sensor;

      sensor.onactivate = () => {
        setSensorStatus((prev) => ({ ...prev, magnetometer: 'ON' }));
      };

      sensor.onreading = () => {
        const x = sensor.x ?? 0;
        const y = sensor.y ?? 0;
        const z = sensor.z ?? 0;
        // Calculate total magnetic magnitude: µT = sqrt(X² + Y² + Z²)
        const totalUt = Math.sqrt(x * x + y * y + z * z);

        const reading: MagneticVector = {
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
          z: Number(z.toFixed(2)),
          magnitude: Number(totalUt.toFixed(1)),
          timestamp: Date.now(),
        };

        setMagnetic(reading);
        setPeakMagnitude((prev) => Math.max(prev, reading.magnitude));
        setSensorStatus((prev) => (prev.magnetometer === 'ON' ? prev : { ...prev, magnetometer: 'ON' }));
        tacticalAudio.updateFieldReading(reading.magnitude, audioEnabled);
        recordSpatialReading(reading, orientationRef.current);
      };

      sensor.onerror = (event: SensorErrorEvent) => {
        if (event.error.name === 'NotAllowedError') {
          setSensorStatus((prev) => ({ ...prev, magnetometer: 'DENIED' }));
          addErrorNotification(
            'IZIN MAGNETOMETER DITOLAK (NotAllowedError): Akses ke sensor Magnetometer diblokir oleh pengguna atau kebijakan browser.'
          );
        } else if (event.error.name === 'NotReadableError') {
          setSensorStatus((prev) => ({ ...prev, magnetometer: 'UNSUPPORTED' }));
          addErrorNotification(
            'HARDWARE SENSOR ERROR (NotReadableError): Sensor Magnetometer pada perangkat tidak dapat dibaca. Mengaktifkan Mode Simulasi Kalibrasi.'
          );
          startFieldSimulation();
        } else {
          setSensorStatus((prev) => ({ ...prev, magnetometer: 'UNSUPPORTED' }));
          addErrorNotification(`MAGNETOMETER ERROR (${event.error.name}): ${event.error.message}`);
        }
      };

      sensor.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSensorStatus((prev) => ({ ...prev, magnetometer: 'UNSUPPORTED' }));
      addErrorNotification(
        `INISIALISASI MAGNETOMETER GAGAL: ${message}. Pastikan Generic Sensor API diizinkan.`
      );
      startFieldSimulation();
    }
  };

  // Reset AR Heatmap nodes and peak counter
  const handleResetMap = () => {
    setNodes([]);
    setPeakMagnitude(magnetic.magnitude);
    lastRecordedRef.current = null;
  };

  // Manual touch/mouse drag on canvas adjusts orientation so users can sweep across walls on any device
  const handleManualScanMove = useCallback(
    (deltaAlpha: number, deltaBeta: number) => {
      if (!isSweeping) return;
      const updated: OrientationAngles = {
        alpha: (orientationRef.current.alpha + deltaAlpha + 360) % 360,
        beta: Math.max(-90, Math.min(180, orientationRef.current.beta - deltaBeta)),
        gamma: orientationRef.current.gamma,
      };
      orientationRef.current = updated;
      setOrientation(updated);
      recordSpatialReading(magnetic, updated);
    },
    [isSweeping, magnetic, recordSpatialReading]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSweeping();
    };
  }, [stopSweeping]);

  const currentLevel = getAnomalyLevel(magnetic.magnitude);
  // Percentage for horizontal signal bar (0 to 120 µT scale)
  const barPercent = Math.min(100, Math.max(2, (magnetic.magnitude / 120) * 100));

  const anomalyCount = nodes.filter((n) => n.level === 'ANOMALY').length;
  const elevatedCount = nodes.filter((n) => n.level === 'ELEVATED').length;

  return (
    <div className="relative w-screen h-dvh bg-[#060B14] text-slate-100 overflow-hidden select-none flex flex-col justify-between">
      {/* LAYER 1: Full-screen Rear Camera Feed (<video autoPlay playsInline>) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover z-0 bg-[#050911]"
      />

      {/* Tactical Dark Blue Scrim & Grid Backdrop when camera is off or for HUD contrast */}
      <div
        className={`absolute inset-0 pointer-events-none z-[1] transition-opacity duration-300 ${
          sensorStatus.camera === 'ON'
            ? 'bg-gradient-to-b from-[#060B14]/80 via-transparent to-[#060B14]/90'
            : 'bg-[#060B14] tactical-grid-bg'
        }`}
      />

      {/* LAYER 2: Transparent AR Heatmap Canvas Overlay */}
      <ARHeatmapCanvas
        nodes={nodes}
        currentOrientation={orientation}
        currentMagnitude={magnetic.magnitude}
        isSweeping={isSweeping}
        projectionMode={projectionMode}
        onManualScanMove={handleManualScanMove}
      />

      {/* LAYER 3: TOP TACTICAL HEADER & SENSOR TELEMETRY BAR */}
      <header className="relative z-20 w-full bg-[#060B14]/90 backdrop-blur-md border-b border-cyan-500/25 px-3 sm:px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-col gap-2">
          {/* Top Row: Command Title + Sub-unit + PWA Install & Mode Actions */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Radio
                  className={`w-4 h-4 shrink-0 ${
                    currentLevel === 'ANOMALY'
                      ? 'text-red-500'
                      : currentLevel === 'ELEVATED'
                      ? 'text-amber-400'
                      : 'text-cyan-400'
                  }`}
                />
                <h1 className="font-mono text-xs sm:text-sm md:text-base font-bold tracking-wider text-slate-100 truncate">
                  TACTICAL AR MAGNETIC SWEEPER
                </h1>
              </div>
              <p className="font-mono text-[10px] sm:text-xs tracking-widest text-cyan-400/90 font-semibold truncate">
                KASUBDISRUDAL DISKOMLEKAU
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setProjectionMode((m) => (m === '2D' ? '3D' : '2D'))}
                className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#0F1A2E] hover:bg-slate-800 border border-cyan-500/30 text-cyan-200 font-mono text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Ubah Visualisasi AR Heatmap 2D / 3D"
              >
                <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>AR: {projectionMode}</span>
              </button>

              <button
                onClick={() => setAudioEnabled((a) => !a)}
                className={`min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-lg border font-mono text-xs flex items-center justify-center transition-colors cursor-pointer ${
                  audioEnabled
                    ? 'bg-[#0F1A2E] border-cyan-500/30 text-cyan-300 hover:bg-slate-800'
                    : 'bg-slate-900/70 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
                title={audioEnabled ? 'Matikan Audio Sonar Anomali' : 'Aktifkan Audio Sonar Anomali'}
                aria-label="Toggle Audio Sonar"
              >
                {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>

              <PWAInstallButton />
            </div>
          </div>

          {/* Sensor Connectivity & Security Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1.5 border-t border-slate-800/80 font-mono text-[11px] text-slate-300">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <Camera className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-400">Camera:</span>
                <strong
                  className={
                    sensorStatus.camera === 'ON'
                      ? 'text-emerald-400'
                      : sensorStatus.camera === 'ERROR'
                      ? 'text-red-400'
                      : 'text-slate-400'
                  }
                >
                  {sensorStatus.camera === 'ON' ? 'ON' : 'OFF'}
                </strong>
              </span>

              <span className="text-slate-700" aria-hidden="true">
                ·
              </span>

              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-400">Magnetometer:</span>
                <strong
                  className={
                    sensorStatus.magnetometer === 'ON'
                      ? 'text-emerald-400'
                      : sensorStatus.magnetometer === 'SIMULATED'
                      ? 'text-amber-400'
                      : sensorStatus.magnetometer === 'DENIED' ||
                        sensorStatus.magnetometer === 'UNSUPPORTED'
                      ? 'text-red-400'
                      : 'text-slate-400'
                  }
                >
                  {sensorStatus.magnetometer === 'ON'
                    ? 'ON'
                    : sensorStatus.magnetometer === 'SIMULATED'
                    ? 'ON (SIM)'
                    : 'OFF'}
                </strong>
              </span>

              <span className="text-slate-700 hidden sm:inline" aria-hidden="true">
                ·
              </span>

              <span className="hidden sm:flex items-center gap-1.5 whitespace-nowrap">
                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-400">Gyro:</span>
                <strong
                  className={
                    sensorStatus.gyroscope === 'ON' || sensorStatus.gyroscope === 'SIMULATED'
                      ? 'text-emerald-400'
                      : 'text-slate-400'
                  }
                >
                  {sensorStatus.gyroscope === 'OFF' ? 'OFF' : 'ON'}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {sensorStatus.isSecureContext ? (
                <span className="flex items-center gap-1 text-emerald-400 whitespace-nowrap">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>HTTPS/SECURE</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-400 whitespace-nowrap">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>INSECURE HTTP</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ERROR & DIAGNOSTIC NOTIFICATIONS BANNER */}
      {errorNotifications.length > 0 && (
        <div className="relative z-20 mx-auto w-full max-w-3xl px-3 pt-2 space-y-1.5">
          {errorNotifications.map((err, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between gap-3 rounded-lg bg-red-950/90 border border-red-500/60 px-3.5 py-2.5 text-xs font-mono text-red-100 shadow-lg backdrop-blur-md"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{err}</p>
              </div>
              <button
                onClick={() =>
                  setErrorNotifications((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))
                }
                className="text-red-300 hover:text-white px-1.5 py-0.5 text-xs font-bold shrink-0 cursor-pointer"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* LAYER 4: CENTER HEADS-UP DISPLAY (HUD) - REAL-TIME MAGNITUDE (µT) */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center pointer-events-none px-4">
        <div className="w-full max-w-md rounded-2xl bg-[#060B14]/70 backdrop-blur-md border border-cyan-500/25 p-4 sm:p-5 shadow-2xl">
          {/* Status Classification Header */}
          <div className="flex items-center justify-between text-xs font-mono mb-2">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
              <span>MAGNETIC FLUX DENSITY</span>
            </span>
            <span
              className={`font-bold tracking-wider ${
                currentLevel === 'ANOMALY'
                  ? 'text-red-400'
                  : currentLevel === 'ELEVATED'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {currentLevel === 'ANOMALY'
                ? '▲ ANOMALI LOGAM KUAT'
                : currentLevel === 'ELEVATED'
                ? '◆ MEDAN MENINGKAT'
                : '● NORMAL (30-45 µT)'}
            </span>
          </div>

          {/* Center Large Real-Time Magnitude Readout */}
          <div className="flex items-baseline justify-center my-2">
            <span
              className={`font-mono text-5xl sm:text-6xl font-bold tracking-tight tabular-nums transition-colors ${
                currentLevel === 'ANOMALY'
                  ? 'text-red-500 drop-shadow-[0_0_18px_rgba(239,68,68,0.65)]'
                  : currentLevel === 'ELEVATED'
                  ? 'text-amber-400 drop-shadow-[0_0_14px_rgba(250,204,21,0.45)]'
                  : 'text-emerald-400'
              }`}
            >
              {magnetic.magnitude.toFixed(1)}
            </span>
            <span className="font-mono text-lg sm:text-xl font-semibold text-slate-400 ml-2">
              µT
            </span>
          </div>

          {/* Horizontal Bar Graph Indicator for Magnetic Signal Strength */}
          <div className="mt-3">
            <div className="flex justify-between font-mono text-[10px] text-slate-400 mb-1">
              <span>0 µT</span>
              <span className="text-emerald-400">30-45 µT</span>
              <span className="text-amber-400">45-60 µT</span>
              <span className="text-red-400">&gt;60 µT</span>
            </div>

            <div className="relative h-3.5 w-full rounded-md bg-[#0A1324] border border-slate-800 overflow-hidden">
              {/* Threshold marker lines at 30µT (25%), 45µT (37.5%), 60µT (50%) */}
              <div className="absolute top-0 bottom-0 left-[25%] w-px bg-slate-700 z-10" />
              <div className="absolute top-0 bottom-0 left-[37.5%] w-px bg-amber-500/50 z-10" />
              <div className="absolute top-0 bottom-0 left-[50%] w-px bg-red-500/60 z-10" />

              <div
                className={`h-full transition-all duration-100 ${
                  currentLevel === 'ANOMALY'
                    ? 'bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500'
                    : currentLevel === 'ELEVATED'
                    ? 'bg-gradient-to-r from-emerald-500 to-amber-400'
                    : 'bg-emerald-500/80'
                }`}
                style={{ width: `${barPercent}%` }}
              />
            </div>
          </div>

          {/* 3-Axis Magnetometer (X, Y, Z) & Gyroscope Orientation Coordinates */}
          <div className="mt-3.5 pt-3 border-t border-slate-800/90 grid grid-cols-2 gap-3 font-mono text-[11px]">
            <div className="space-y-1">
              <div className="text-[10px] text-slate-400">VEKTOR MAGNETIK (µT)</div>
              <div className="text-slate-200 tabular-nums">
                X: <span className="text-cyan-300">{magnetic.x.toFixed(1)}</span> · Y:{' '}
                <span className="text-cyan-300">{magnetic.y.toFixed(1)}</span> · Z:{' '}
                <span className="text-cyan-300">{magnetic.z.toFixed(1)}</span>
              </div>
            </div>

            <div className="space-y-1 text-right">
              <div className="text-[10px] text-slate-400">ORIENTASI GYRO (°)</div>
              <div className="text-slate-200 tabular-nums">
                α:{orientation.alpha.toFixed(0)}° · β:{orientation.beta.toFixed(0)}° · γ:
                {orientation.gamma.toFixed(0)}°
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* LAYER 5: BOTTOM TACTICAL CONTROL DECK */}
      <footer className="relative z-20 w-full bg-[#060B14]/92 backdrop-blur-md border-t border-cyan-500/25 px-3 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Spatial Heatmap Legend & Recorded Nodes Telemetry */}
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-x-4 gap-y-1 font-mono text-xs text-slate-300">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60 border border-emerald-400 inline-block" />
                <span>Normal (30-45)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                <span>Naik (45-60): {elevatedCount}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-red-400/50 inline-block" />
                <span className="text-red-300 font-semibold">Anomali (&gt;60): {anomalyCount}</span>
              </span>
            </div>

            <span className="text-slate-500 hidden md:inline" aria-hidden="true">
              ·
            </span>

            <span className="text-slate-400 tabular-nums">
              Nodes: <strong className="text-slate-200">{nodes.length}</strong> · Peak:{' '}
              <strong className="text-cyan-300">{peakMagnitude.toFixed(1)} µT</strong>
            </span>
          </div>

          {/* Primary Action Buttons: Start Sweeping & Reset Map */}
          <div className="flex items-center gap-2.5">
            {!isSweeping ? (
              <button
                onClick={startSweeping}
                className="flex-1 sm:flex-initial min-h-[44px] px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:scale-[0.99] text-slate-950 font-mono text-xs sm:text-sm font-bold tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer whitespace-nowrap"
              >
                <Play className="w-4 h-4 fill-current shrink-0" />
                <span>Start Sweeping</span>
              </button>
            ) : (
              <button
                onClick={stopSweeping}
                className="flex-1 sm:flex-initial min-h-[44px] px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-[0.99] text-white font-mono text-xs sm:text-sm font-bold tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-red-600/25 transition-all cursor-pointer whitespace-nowrap"
              >
                <Square className="w-4 h-4 fill-current shrink-0" />
                <span>Stop Sweeping</span>
              </button>
            )}

            <button
              onClick={handleResetMap}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0F1A2E] hover:bg-slate-800 active:scale-[0.99] border border-slate-700 text-slate-200 font-mono text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Reset Map</span>
            </button>

            {isSweeping && sensorStatus.magnetometer !== 'ON' && (
              <button
                onClick={() => {
                  // Trigger synthetic sweep step so desktop testers can immediately see heatmap nodes
                  const nextAlpha = 162 + ((orientationRef.current.alpha - 158 + 3.2) % 36);
                  const nextBeta = 72 + Math.sin(nextAlpha * 0.25) * 10;
                  handleManualScanMove(nextAlpha - orientationRef.current.alpha, orientationRef.current.beta - nextBeta);
                }}
                className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 font-mono text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
                title="Simulasikan sapuan sensor ke tembok (untuk pengujian tanpa giroskop fisik)"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden sm:inline">Test Pulse</span>
              </button>
            )}
          </div>
        </div>
      </footer>

      <OfflineIndicator />
    </div>
  );
}
