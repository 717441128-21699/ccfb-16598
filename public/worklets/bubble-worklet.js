/*
 * Airlock bubble detector running inside AudioWorklet.
 *
 * The audio graph calls process() in 128-sample blocks. Blocks are accumulated
 * into 1024-sample analysis frames (~21 ms at 48 kHz). Each frame gets an RMS
 * level, band ratios and FFT spectral features. A short onset -> resonance ->
 * decay state machine then decides whether a complete "咕嘟" is present.
 *
 * This file is intentionally plain JavaScript because AudioWorklet loads its
 * own module scope at runtime.
 */

const ANALYSIS_FRAME = 1024;
const MIN_FREQ = 120;
const MAX_FREQ = 3200;

function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j += 1) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + half] * cwr - im[i + j + half] * cwi;
        const vi = re[i + j + half] * cwi + im[i + j + half] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

function minnaertVolumeMl(peakHz) {
  if (!peakHz || peakHz <= 0) return 0;
  const radiusCm = 326 / peakHz; // 3260 / f gives mm; /10 gives cm
  return (4 / 3) * Math.PI * radiusCm ** 3;
}

class BubbleDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameBuffer = new Float32Array(ANALYSIS_FRAME);
    this.offset = 0;
    this.frameIndex = 0;
    this.sensitivity = 0.62;
    this.rejectNoise = true;

    this.noiseRms = 0.008;
    this.noiseSpectrum = null;
    this.state = 'idle'; // idle | active
    this.activeFrames = [];
    this.peakRms = 0;
    this.quietFrames = 0;
    this.cooldownFrames = 0;
    this.lastFeatures = null;

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'settings') {
        if (Number.isFinite(msg.sensitivity)) this.sensitivity = msg.sensitivity;
        if (typeof msg.rejectNoise === 'boolean') this.rejectNoise = msg.rejectNoise;
      }
    };
  }

  calculateFeatures(frame) {
    const n = frame.length;
    const sampleRate = globalThis.sampleRate || 48000;
    let sumSq = 0;
    let zeroCrossings = 0;
    let prev = frame[0] || 0;

    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = frame[i];
      sumSq += x * x;
      if (i > 0 && ((prev >= 0 && x < 0) || (prev < 0 && x >= 0))) zeroCrossings += 1;
      prev = x;
      // Hann window reduces FFT leakage.
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re[i] = x * window;
    }

    const rms = Math.sqrt(sumSq / n);
    fftRadix2(re, im);

    const binHz = sampleRate / n;
    const maxBin = Math.floor(n / 2);
    let lowEnergy = 1e-12;
    let midEnergy = 1e-12;
    let highEnergy = 1e-12;
    let totalEnergy = 1e-12;
    let weightedFreqSum = 0;
    let magnitudeSum = 1e-9;
    let logMagnitudeSum = 0;
    let logCount = 0;
    let peakPower = 0;
    let peakBin = -1;
    let meanPowerInSearch = 0;
    let searchBins = 0;

    for (let bin = 1; bin < maxBin; bin += 1) {
      const hz = bin * binHz;
      const power = re[bin] * re[bin] + im[bin] * im[bin];
      const mag = Math.sqrt(power);
      totalEnergy += power;
      magnitudeSum += mag;
      weightedFreqSum += hz * mag;

      if (hz >= 60 && hz <= 8000 && mag > 1e-7) {
        logMagnitudeSum += Math.log(mag + 1e-8);
        logCount += 1;
      }

      if (hz < 260) lowEnergy += power;
      else if (hz < 2500) midEnergy += power;
      else highEnergy += power;

      if (hz >= MIN_FREQ && hz <= MAX_FREQ) {
        meanPowerInSearch += power;
        searchBins += 1;
        if (power > peakPower) {
          peakPower = power;
          peakBin = bin;
        }
      }
    }

    const bandTotal = lowEnergy + midEnergy + highEnergy;
    const centroidHz = weightedFreqSum / magnitudeSum;
    const geometricMean = Math.exp(logMagnitudeSum / Math.max(1, logCount));
    const arithmeticMean = magnitudeSum / maxBin;
    const flatness = Math.min(1, geometricMean / Math.max(1e-9, arithmeticMean));

    let peakHz = peakBin > 0 ? peakBin * binHz : 0;
    // Parabolic interpolation around the FFT peak.
    if (peakBin > 1 && peakBin < maxBin - 1) {
      const y0 = Math.log(Math.sqrt(re[peakBin - 1] ** 2 + im[peakBin - 1] ** 2) + 1e-12);
      const y1 = Math.log(Math.sqrt(peakPower) + 1e-12);
      const y2 = Math.log(Math.sqrt(re[peakBin + 1] ** 2 + im[peakBin + 1] ** 2) + 1e-12);
      const denom = y0 - 2 * y1 + y2;
      const delta = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
      if (Number.isFinite(delta) && Math.abs(delta) < 1) peakHz = (peakBin + delta) * binHz;
    }

    let bandwidthPower = 0;
    let bandwidthWeight = 0;
    for (let bin = 1; bin < maxBin; bin += 1) {
      const hz = bin * binHz;
      const mag = Math.sqrt(re[bin] ** 2 + im[bin] ** 2);
      bandwidthPower += ((hz - centroidHz) ** 2) * mag;
      bandwidthWeight += mag;
    }
    const bandwidthHz = Math.sqrt(bandwidthPower / Math.max(1e-9, bandwidthWeight));

    meanPowerInSearch /= Math.max(1, searchBins);
    const peakToMean = peakPower / Math.max(1e-12, meanPowerInSearch);
    const tonalConfidence = Math.max(0, Math.min(1, Math.log10(peakToMean + 1) / 2.2));

    return {
      rms,
      peakHz,
      centroidHz,
      bandwidthHz,
      flatness,
      lowRatio: lowEnergy / bandTotal,
      midRatio: midEnergy / bandTotal,
      highRatio: highEnergy / bandTotal,
      zcr: zeroCrossings / n,
      tonalConfidence,
      peakToMean,
      minnaertVolumeMl: minnaertVolumeMl(peakHz),
    };
  }

  onsetThreshold() {
    // sensitivity 0..1 -> ratio about 2.78 at 0.62.
    return 3.6 - this.sensitivity * 2.35;
  }

  startCandidate(features) {
    this.state = 'active';
    this.activeFrames = [{ ...features, frameIndex: this.frameIndex }];
    this.peakRms = features.rms;
    this.quietFrames = 0;
  }

  finishCandidate(reasonOverride = null) {
    const frames = this.activeFrames;
    this.state = 'idle';
    this.activeFrames = [];
    this.cooldownFrames = 3;

    if (frames.length === 0) return;
    const sampleRate = globalThis.sampleRate || 48000;
    const frameMs = (ANALYSIS_FRAME / sampleRate) * 1000;
    const durationMs = frames.length * frameMs;

    let weightSum = 0;
    const avg = {
      rms: 0,
      peakHz: 0,
      centroidHz: 0,
      bandwidthHz: 0,
      flatness: 0,
      lowRatio: 0,
      midRatio: 0,
      highRatio: 0,
      zcr: 0,
      tonalConfidence: 0,
      peakToMean: 0,
      minnaertVolumeMl: 0,
    };
    let peakFrameIndex = frames[0].frameIndex;
    let peakRms = 0;
    let spectrumVariation = 0;
    let previousCentroid = frames[0].centroidHz;

    for (const f of frames) {
      const w = Math.max(0.001, f.rms);
      weightSum += w;
      for (const key of Object.keys(avg)) avg[key] += f[key] * w;
      if (f.rms > peakRms) {
        peakRms = f.rms;
        peakFrameIndex = f.frameIndex;
      }
      spectrumVariation += Math.abs(f.centroidHz - previousCentroid);
      previousCentroid = f.centroidHz;
    }
    for (const key of Object.keys(avg)) avg[key] /= weightSum;

    const firstIndex = frames[0].frameIndex;
    const attackFrames = Math.max(0, peakFrameIndex - firstIndex);
    const attackMs = attackFrames * frameMs;
    const decayMs = Math.max(0, durationMs - attackMs);
    const variationPerFrame = spectrumVariation / Math.max(1, frames.length - 1);

    const features = {
      ...avg,
      durationMs,
      attackMs,
      decayMs,
      spectrumVariationHz: variationPerFrame,
    };

    let rejectReason = reasonOverride;
    if (!rejectReason) {
      if (durationMs < 38) rejectReason = 'too_short';
      else if (durationMs > 430 && (features.lowRatio > 0.42 || features.flatness > 0.28)) {
        rejectReason = 'too_long_sustained';
      } else if (features.lowRatio > 0.58 && features.centroidHz < 300) {
        rejectReason = 'low_frequency_hum';
      } else if (features.flatness > 0.43 || features.tonalConfidence < 0.16) {
        rejectReason = 'broadband_noise';
      } else if (
        durationMs > 270 &&
        (variationPerFrame > 260 || features.tonalConfidence < 0.28)
      ) {
        rejectReason = 'speech_modulation';
      } else if (
        features.peakHz < 190 ||
        features.peakHz > 2600 ||
        features.midRatio < 0.34 ||
        features.peakToMean < 3.2
      ) {
        rejectReason = 'no_narrow_resonance';
      }
    }

    const accepted = this.rejectNoise ? !rejectReason : true;
    this.port.postMessage({
      type: accepted ? 'bubble' : 'reject',
      t: currentTime,
      reason: rejectReason,
      features,
    });
  }

  analyzeFrame(frame) {
    const features = this.calculateFeatures(frame);
    this.frameIndex += 1;

    // Slow noise-floor adaptation; freeze while a candidate is ringing.
    if (this.state === 'idle') {
      this.noiseRms = this.noiseRms * 0.985 + features.rms * 0.015;
      this.noiseRms = Math.max(0.0015, Math.min(0.08, this.noiseRms));
    }

    if (this.cooldownFrames > 0) this.cooldownFrames -= 1;

    this.port.postMessage({
      type: 'meter',
      t: currentTime,
      rms: features.rms,
      noiseRms: this.noiseRms,
      active: this.state === 'active',
      peakHz: features.peakHz,
    });

    if (this.state === 'idle') {
      const threshold = Math.max(
        this.noiseRms * this.onsetThreshold(),
        0.0045 + (1 - this.sensitivity) * 0.012,
      );
      const isOnset =
        this.cooldownFrames === 0 &&
        features.rms > threshold &&
        features.midRatio > 0.28 &&
        features.peakHz >= MIN_FREQ &&
        features.peakHz <= MAX_FREQ;
      if (isOnset) this.startCandidate(features);
      return;
    }

    // Active candidate.
    this.activeFrames.push(features);
    this.peakRms = Math.max(this.peakRms, features.rms);
    const releaseThreshold = Math.max(this.noiseRms * 1.25, this.peakRms * 0.11);
    if (features.rms < releaseThreshold) this.quietFrames += 1;
    else this.quietFrames = 0;

    const maxFrames = Math.ceil(520 / ((ANALYSIS_FRAME / (globalThis.sampleRate || 48000)) * 1000));
    if (this.quietFrames >= 2 || this.activeFrames.length >= maxFrames) {
      let forcedReason = null;
      if (this.activeFrames.length >= maxFrames) forcedReason = 'too_long_sustained';
      this.finishCandidate(forcedReason);
    }
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    let sourceOffset = 0;
    while (sourceOffset < channel.length) {
      const remaining = ANALYSIS_FRAME - this.offset;
      const copyCount = Math.min(remaining, channel.length - sourceOffset);
      this.frameBuffer.set(
        channel.subarray(sourceOffset, sourceOffset + copyCount),
        this.offset,
      );
      this.offset += copyCount;
      sourceOffset += copyCount;

      if (this.offset === ANALYSIS_FRAME) {
        // Copy because frameBuffer is reused.
        this.analyzeFrame(this.frameBuffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('bubble-detector', BubbleDetectorProcessor);
