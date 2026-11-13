import React, { useEffect, useRef } from 'react';
import { OrientationAngles, SpatialHeatmapNode } from '../types/sensor';

interface ARHeatmapCanvasProps {
  nodes: SpatialHeatmapNode[];
  currentOrientation: OrientationAngles;
  currentMagnitude: number;
  isSweeping: boolean;
  projectionMode: '2D' | '3D';
  onManualScanMove?: (deltaAlpha: number, deltaBeta: number) => void;
}

// Shortest signed angle difference in degrees [-180, 180]
function angleDiffDeg(target: number, current: number): number {
  return ((target - current + 540) % 360) - 180;
}

export const ARHeatmapCanvas: React.FC<ARHeatmapCanvasProps> = ({
  nodes,
  currentOrientation,
  currentMagnitude,
  isSweeping,
  projectionMode,
  onManualScanMove,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerDownRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const render = (time: number) => {
      resizeCanvas();
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      // Angular Field-of-View mapping (approx 56° horizontal, 70° vertical FOV)
      const pxPerDegX = width / 56;
      const pxPerDegY = height / 70;

      // Draw Pseudo-AR Spatial Grid anchored to world orientation
      const gridStepDeg = 5;
      const offsetAlphaPx = ((currentOrientation.alpha % gridStepDeg) + gridStepDeg) % gridStepDeg * pxPerDegX;
      const offsetBetaPx = ((currentOrientation.beta % gridStepDeg) + gridStepDeg) % gridStepDeg * pxPerDegY;

      ctx.strokeStyle = 'rgba(14, 165, 233, 0.12)';
      ctx.lineWidth = 1;

      for (let x = offsetAlphaPx; x < width; x += gridStepDeg * pxPerDegX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = offsetBetaPx; y < height; y += gridStepDeg * pxPerDegY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Project recorded nodes to current camera viewport coordinates
      const projectedNodes: Array<{
        node: SpatialHeatmapNode;
        screenX: number;
        screenY: number;
      }> = [];

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        // Delta alpha (yaw) & gamma (roll tilt compensation)
        const dAlpha = angleDiffDeg(currentOrientation.alpha, node.alpha);
        const dGamma = (node.gamma - currentOrientation.gamma) * 0.35;
        const dBeta = node.beta - currentOrientation.beta;

        const screenX = cx + (dAlpha + dGamma) * pxPerDegX;
        const screenY = cy + dBeta * pxPerDegY;

        // Cull off-screen nodes with generous margin for large thermal radii
        if (screenX >= -120 && screenX <= width + 120 && screenY >= -120 && screenY <= height + 120) {
          projectedNodes.push({ node, screenX, screenY });
        }
      }

      // Connect nearby anomaly/elevated nodes with vector flux lines
      ctx.lineWidth = 1.25;
      for (let i = 0; i < projectedNodes.length; i++) {
        const a = projectedNodes[i];
        if (a.node.magnitude < 45) continue;
        for (let j = i + 1; j < projectedNodes.length; j++) {
          const b = projectedNodes[j];
          if (b.node.magnitude < 45) continue;
          const dist = Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY);
          if (dist < 85) {
            const alpha = (1 - dist / 85) * 0.45;
            ctx.strokeStyle =
              a.node.magnitude > 60 && b.node.magnitude > 60
                ? `rgba(239, 68, 68, ${alpha + 0.25})`
                : `rgba(245, 158, 11, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.screenX, a.screenY);
            ctx.lineTo(b.screenX, b.screenY);
            ctx.stroke();
          }
        }
      }

      // Render each spatial node (normal first, then elevated, then strong anomalies on top)
      const sortedNodes = [...projectedNodes].sort((a, b) => a.node.magnitude - b.node.magnitude);

      for (const { node, screenX, screenY } of sortedNodes) {
        const mag = node.magnitude;
        const isAnomaly = mag > 60;
        const isElevated = mag >= 45 && mag <= 60;

        // Radius scales with magnetic field strength
        const baseRadius = isAnomaly
          ? Math.min(64, 34 + (mag - 60) * 0.45)
          : isElevated
          ? 28
          : 22;

        // 3D Elevation spike height when in 3D AR mode
        const elevationZ = projectionMode === '3D' ? Math.min(90, Math.max(6, (mag - 25) * 1.15)) : 0;
        const topY = screenY - elevationZ;

        // 1. Soft radial thermal field glow
        const grad = ctx.createRadialGradient(screenX, screenY, 2, screenX, screenY, baseRadius);
        if (isAnomaly) {
          // Merah menyala tebal (> 60 µT)
          grad.addColorStop(0, 'rgba(239, 68, 68, 0.92)');
          grad.addColorStop(0.45, 'rgba(220, 38, 38, 0.58)');
          grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        } else if (isElevated) {
          // Kuning (45 - 60 µT)
          grad.addColorStop(0, 'rgba(250, 204, 21, 0.82)');
          grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.42)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        } else {
          // Hijau transparan (30 - 45 µT / normal)
          grad.addColorStop(0, 'rgba(16, 185, 129, 0.36)');
          grad.addColorStop(0.6, 'rgba(16, 185, 129, 0.16)');
          grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(screenX, screenY, baseRadius, 0, Math.PI * 2);
        ctx.fill();

        // 2. 3D Volumetric Column & Wireframe Ring if projectionMode === '3D'
        if (projectionMode === '3D') {
          ctx.strokeStyle = isAnomaly
            ? 'rgba(248, 113, 113, 0.85)'
            : isElevated
            ? 'rgba(251, 191, 36, 0.7)'
            : 'rgba(52, 211, 153, 0.45)';
          ctx.lineWidth = isAnomaly ? 2.5 : 1.5;

          // Base ellipse on wall plane
          ctx.beginPath();
          ctx.ellipse(screenX, screenY, baseRadius * 0.45, baseRadius * 0.22, 0, 0, Math.PI * 2);
          ctx.stroke();

          // Vertical 3D vector pillar
          ctx.beginPath();
          ctx.moveTo(screenX, screenY);
          ctx.lineTo(screenX, topY);
          ctx.stroke();

          // Elevated apex node
          ctx.fillStyle = isAnomaly ? '#EF4444' : isElevated ? '#FACC15' : '#10B981';
          ctx.beginPath();
          ctx.arc(screenX, topY, isAnomaly ? 5.5 : 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // 3. Core Node & Tactical Reticle for Strong Anomalies (> 60 µT)
        if (isAnomaly) {
          const pulse = (Math.sin(time * 0.008) + 1) * 0.5;
          ctx.save();
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 3.2; // Merah menyala tebal
          ctx.shadowColor = '#EF4444';
          ctx.shadowBlur = 14;

          ctx.beginPath();
          ctx.arc(screenX, topY, 10 + pulse * 5, 0, Math.PI * 2);
          ctx.stroke();

          // Inner solid glowing red core
          ctx.fillStyle = '#FEE2E2';
          ctx.beginPath();
          ctx.arc(screenX, topY, 4.5, 0, Math.PI * 2);
          ctx.fill();

          // Target corner brackets
          const brk = 16;
          ctx.lineWidth = 2;
          ctx.beginPath();
          // Top-left
          ctx.moveTo(screenX - brk, topY - brk + 5);
          ctx.lineTo(screenX - brk, topY - brk);
          ctx.lineTo(screenX - brk + 5, topY - brk);
          // Top-right
          ctx.moveTo(screenX + brk - 5, topY - brk);
          ctx.lineTo(screenX + brk, topY - brk);
          ctx.lineTo(screenX + brk, topY - brk + 5);
          // Bottom-left
          ctx.moveTo(screenX - brk, topY + brk - 5);
          ctx.lineTo(screenX - brk, topY + brk);
          ctx.lineTo(screenX - brk + 5, topY + brk);
          // Bottom-right
          ctx.moveTo(screenX + brk - 5, topY + brk);
          ctx.lineTo(screenX + brk, topY + brk);
          ctx.lineTo(screenX + brk, topY + brk - 5);
          ctx.stroke();

          // Numeric anomaly tag
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#FCA5A5';
          ctx.fillText(`${mag.toFixed(0)}µT`, screenX + 18, topY - 6);
          ctx.restore();
        } else if (isElevated) {
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(screenX, topY, 6, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#FACC15';
          ctx.beginPath();
          ctx.arc(screenX, topY, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.55)';
          ctx.beginPath();
          ctx.arc(screenX, topY, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw Center Tactical HUD Bore-Sight Crosshair
      if (isSweeping) {
        const isCurrAnomaly = currentMagnitude > 60;
        const isCurrElevated = currentMagnitude >= 45 && currentMagnitude <= 60;
        const reticleColor = isCurrAnomaly
          ? 'rgba(239, 68, 68, 0.9)'
          : isCurrElevated
          ? 'rgba(250, 204, 21, 0.85)'
          : 'rgba(6, 182, 212, 0.65)';

        ctx.save();
        ctx.strokeStyle = reticleColor;
        ctx.lineWidth = isCurrAnomaly ? 2.5 : 1.5;

        // Outer bore-sight circle
        const boreRadius = isCurrAnomaly ? 46 : 38;
        ctx.beginPath();
        ctx.arc(cx, cy, boreRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshair ticks
        const tickInner = boreRadius - 8;
        const tickOuter = boreRadius + 10;
        ctx.beginPath();
        ctx.moveTo(cx - tickOuter, cy);
        ctx.lineTo(cx - tickInner, cy);
        ctx.moveTo(cx + tickInner, cy);
        ctx.lineTo(cx + tickOuter, cy);
        ctx.moveTo(cx, cy - tickOuter);
        ctx.lineTo(cx, cy - tickInner);
        ctx.moveTo(cx, cy + tickInner);
        ctx.lineTo(cx, cy + tickOuter);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [nodes, currentOrientation, currentMagnitude, isSweeping, projectionMode]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownRef.current = {
      active: true,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerDownRef.current.active || !onManualScanMove) return;
    const dx = e.clientX - pointerDownRef.current.lastX;
    const dy = e.clientY - pointerDownRef.current.lastY;
    pointerDownRef.current.lastX = e.clientX;
    pointerDownRef.current.lastY = e.clientY;
    // Allow interactive touch/drag scanning across the wall
    onManualScanMove(dx * 0.18, dy * 0.18);
  };

  const handlePointerUp = () => {
    pointerDownRef.current.active = false;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="absolute inset-0 w-full h-full z-10 cursor-crosshair touch-none"
    />
  );
};
