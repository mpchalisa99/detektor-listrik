// Tactical Acoustic Feedback Synthesizer (Web Audio API)

class TacticalAudioEngine {
  private ctx: AudioContext | null = null;
  private lastPingTime = 0;

  private ensureContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public updateFieldReading(magnitude: number, enabled: boolean) {
    if (!enabled || magnitude < 45) return;

    const now = performance.now();
    // Interval shortens as magnetic field increases from 45 µT to 120+ µT
    const clamped = Math.min(140, Math.max(45, magnitude));
    const intervalMs = magnitude > 60
      ? Math.max(95, 340 - (clamped - 60) * 3.2)
      : Math.max(360, 750 - (clamped - 45) * 24);

    if (now - this.lastPingTime < intervalMs) return;
    this.lastPingTime = now;

    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const isAnomaly = magnitude > 60;
      osc.type = isAnomaly ? 'sawtooth' : 'sine';
      const baseFreq = isAnomaly ? 880 + Math.min(900, (magnitude - 60) * 12) : 520 + (magnitude - 45) * 14;

      osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);
      gain.gain.setValueAtTime(isAnomaly ? 0.08 : 0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + (isAnomaly ? 0.075 : 0.055));

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + (isAnomaly ? 0.08 : 0.06));
    } catch {
      // Ignore audio errors if user hasn't interacted yet
    }
  }
}

export const tacticalAudio = new TacticalAudioEngine();
