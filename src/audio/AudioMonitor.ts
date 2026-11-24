import type { BubbleFeatures, RejectReason } from '../types';

export interface BubbleWorkletMessage {
  type: 'bubble' | 'reject' | 'meter';
  t?: number;
  reason?: RejectReason;
  features?: BubbleFeatures & { spectrumVariationHz?: number };
  rms?: number;
  noiseRms?: number;
  active?: boolean;
  peakHz?: number;
}

export interface AudioMonitorHandlers {
  onMessage: (message: BubbleWorkletMessage) => void;
  onStateChange?: (state: AudioMonitorState) => void;
}

export type AudioMonitorState = 'idle' | 'requesting' | 'running' | 'denied' | 'error';

/** Thin Web Audio API wrapper; all frame-wise detection lives in AudioWorklet. */
export class AudioMonitor {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  state: AudioMonitorState = 'idle';

  constructor(private handlers: AudioMonitorHandlers) {}

  private setState(state: AudioMonitorState) {
    this.state = state;
    this.handlers.onStateChange?.(state);
  }

  async start(sensitivity: number, rejectNoise: boolean): Promise<void> {
    if (this.state === 'running' || this.state === 'requesting') return;
    this.setState('requesting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });

      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      if (this.ctx.state === 'suspended') await this.ctx.resume();

      const workletUrl = `${import.meta.env.BASE_URL}worklets/bubble-worklet.js`;
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'bubble-detector', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      this.node.port.onmessage = (event: MessageEvent<BubbleWorkletMessage>) => {
        this.handlers.onMessage(event.data);
      };
      this.node.port.postMessage({ type: 'settings', sensitivity, rejectNoise });
      this.source.connect(this.node);
      // Deliberately not connected to destination: the phone must not monitor itself/howl.
      this.setState('running');
    } catch (error) {
      console.error(error);
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        this.setState('denied');
      } else {
        this.setState('error');
      }
      this.stop();
      throw error;
    }
  }

  updateSettings(sensitivity: number, rejectNoise: boolean) {
    this.node?.port.postMessage({ type: 'settings', sensitivity, rejectNoise });
  }

  stop() {
    try {
      this.source?.disconnect();
      this.node?.port.close();
      this.node?.disconnect();
      this.stream?.getTracks().forEach((track) => track.stop());
      if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    } catch (error) {
      console.warn('停止音频监听时出错', error);
    } finally {
      this.source = null;
      this.node = null;
      this.stream = null;
      this.ctx = null;
      this.setState('idle');
    }
  }
}
