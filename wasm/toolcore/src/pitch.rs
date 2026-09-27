//! Pitch detection for the guitar tuner.
//!
//! Pipeline (runs on each ~2048-sample audio frame in the main thread —
//! cheap enough to keep out of an AudioWorklet):
//!
//! 1. RMS gate: silence below `NOISE_FLOOR` reports "no tone".
//! 2. **YIN** (de Cheveigné & Kawahara, 2002): windowed difference
//!    function `d[τ] = Σ(y[i] − y[i+τ])²`, cumulative-mean-normalized to
//!    `D̂[τ] = τ·d[τ] / Σⱼ d[j]`. Periodic audio drives `D̂` sharply toward
//!    0 at the fundamental period (and its multiples) while noise stays
//!    near 1, so the *first* local minimum below the absolute threshold
//!    is the fundamental — no octave jumps, even with strong harmonics.
//! 3. Parabolic interpolation around the minimum → fractional period → Hz.
//! 4. Log-spaced magnitude spectrum (real FFT via rustfft, exact
//!    even/odd recombination `X[k] = E[k] + e^{−iθₖ}O[k]`) for the bars.
//!
//! Deliberately portable scalar code: `wasm32-unknown-unknown` SIMD lanes
//! require a nightly `wasm_simd` feature, so the core targets stable and
//! keeps the hot loops allocation-free; the heavy lifting (the FFT) is
//! rustfft's optimized radix plan.

use crate::notes;
use rustfft::FftPlanner;
use wasm_bindgen::prelude::*;

/// Log-spaced spectrum bins for the visualizer (55 Hz – 9 kHz).
pub const SPECTRUM_BINS: usize = 48;
const SPECTRUM_F_MIN: f64 = 55.0;
const SPECTRUM_F_MAX: f64 = 9000.0;

/// Minimum RMS to consider a frame musical at all (≈ −50 dBFS full scale).
const NOISE_FLOOR: f64 = 0.0008;
/// YIN absolute threshold on D̂: below this a local minimum is a tone.
const YIN_THRESHOLD: f64 = 0.1;
/// Fallback: global minimum accepted as a tone when it is below this.
const YIN_SOFT: f64 = 0.3;

/// Search window bounds (Hz). Covers standard guitar range E2–E5 plus
/// harmonics and margin for bass/ukulele-ish tones.
const F_MIN: f64 = 55.0;
const F_MAX: f64 = 1200.0;

/// Result of one pitch analysis frame.
#[wasm_bindgen]
pub struct PitchResult {
    /// Detected frequency in Hz; 0.0 when no confident pitch.
    freq: f64,
    /// Nearest MIDI note number; -1 when no confident pitch.
    midi: i32,
    /// Cents deviation from the nearest note (−50…+50); 0 when no pitch.
    cents: f32,
    /// Note name (e.g. "A4"); empty when no confident pitch.
    note: String,
    /// Frame RMS (full scale 0..1) for level metering.
    rms: f32,
    /// Log-spaced magnitude spectrum, SPECTRUM_BINS values, 0..1.
    spectrum: Vec<f32>,
}

#[wasm_bindgen(getter)]
impl PitchResult {
    pub fn freq(&self) -> f64 {
        self.freq
    }
    pub fn midi(&self) -> i32 {
        self.midi
    }
    pub fn cents(&self) -> f32 {
        self.cents
    }
    pub fn note(&self) -> String {
        self.note.clone()
    }
    pub fn rms(&self) -> f32 {
        self.rms
    }
    /// Log-spaced spectrum magnitudes, normalized 0..1.
    pub fn spectrum(&self) -> Vec<f32> {
        self.spectrum.clone()
    }
}

/// Analyze one frame of audio (mono, 32-bit float, native sample rate).
///
/// `samples` is typically 2048+ frames from the AudioWorklet ring buffer.
#[wasm_bindgen(js_name = pitchDetect)]
pub fn pitch_detect(samples: &[f32], sample_rate: f32) -> PitchResult {
    let n = samples.len();
    let spectrum = spectrum(samples, sample_rate as f64);

    if n < 1024 || !(sample_rate > 8000.0) {
        return no_tone(0.0, spectrum);
    }

    // Mean-removed, Hann-windowed frame (YIN wants both: no DC bias in the
    // difference function, tapering so edges don't create phantom minima).
    let two_pi_over_n = 2.0 * std::f64::consts::PI / n as f64;
    let mut y = vec![0f64; n];
    let mut sum = 0.0;
    for i in 0..n {
        sum += samples[i] as f64;
    }
    let mean = sum / n as f64;
    let mut rms_sq = 0.0;
    for i in 0..n {
        let d = (samples[i] as f64) - mean;
        rms_sq += d * d;
        y[i] = d * 0.5 * (1.0 - (two_pi_over_n * i as f64).cos());
    }
    let rms = (rms_sq / n as f64).sqrt() as f32;

    if (rms_sq / (n as f64)) < NOISE_FLOOR * NOISE_FLOOR {
        return no_tone(rms, spectrum);
    }

    let sr = sample_rate as f64;
    let lag_min = (sr / F_MAX).round() as usize;
    let lag_max = ((sr / F_MIN).min(n as f64 / 2.0)).round() as usize;
    if lag_max <= lag_min {
        return no_tone(rms, spectrum);
    }

    // --- YIN ---------------------------------------------------------
    // d[τ] over the search window, then the cumulative-mean-normalized
    // difference. O(n · lag_max) ≈ a couple of million ops for 2048 @ 48 kHz.
    let mut d = vec![0f64; lag_max + 1];
    for tau in 1..=lag_max {
        let mut acc = 0.0;
        let end = n - tau;
        for i in 0..end {
            let diff = y[i] - y[i + tau];
            acc += diff * diff;
        }
        d[tau] = acc;
    }

    let mut hat = vec![0f64; lag_max + 1];
    let mut cum = 0.0;
    for tau in 1..=lag_max {
        cum += d[tau];
        hat[tau] = if cum > 1e-12 {
            (d[tau] * tau as f64) / cum
        } else {
            1.0
        };
    }

    // First *local minimum* below the absolute threshold (YIN rule: the
    // crossing happens on the descending slope, the minimum is the period).
    // If none, the global minimum (accepted only under the soft threshold).
    let mut best_tau: Option<usize> = None;
    let mut best_hat = f64::INFINITY;
    let mut tau = lag_min;
    while tau <= lag_max {
        if hat[tau] < YIN_THRESHOLD {
            // Descend to the bottom of this basin and take the minimum.
            let mut min_tau = tau;
            let mut min_hat = hat[tau];
            while tau < lag_max && hat[tau + 1] <= hat[tau] {
                tau += 1;
                if hat[tau] < min_hat {
                    min_hat = hat[tau];
                    min_tau = tau;
                }
            }
            best_tau = Some(min_tau);
            best_hat = min_hat;
            break;
        }
        // Above the threshold: skip straight past any local maximum basin.
        if tau < lag_max && hat[tau + 1] > hat[tau] {
            while tau < lag_max && hat[tau + 1] >= hat[tau] {
                tau += 1;
            }
        }
        tau += 1;
    }
    if best_tau.is_none() {
        for t in lag_min..=lag_max {
            if hat[t] < best_hat {
                best_hat = hat[t];
                best_tau = Some(t);
            }
        }
    }
    let Some(tau0) = best_tau else {
        return no_tone(rms, spectrum);
    };
    if best_hat > YIN_SOFT {
        return no_tone(rms, spectrum);
    }

    // Parabolic interpolation around the minimum for a fractional lag.
    let mut tau_f = tau0 as f64;
    if tau0 > lag_min && tau0 < lag_max {
        let ym1 = hat[tau0 - 1];
        let y0 = hat[tau0];
        let yp1 = hat[tau0 + 1];
        let denom = ym1 - 2.0 * y0 + yp1;
        if denom > 1e-12 {
            let delta = 0.5 * (ym1 - yp1) / denom;
            tau_f = (tau0 as f64 + delta).clamp((tau0 as f64) - 1.0, (tau0 as f64) + 1.0);
        }
    }

    let freq = sr / tau_f;
    let (midi, cents) = notes::nearest_midi(freq);
    let note = if midi >= 0 { notes::midi_name(midi) } else { String::new() };

    PitchResult {
        freq,
        midi,
        cents,
        note,
        rms,
        spectrum,
    }
}

fn no_tone(rms: f32, spectrum: Vec<f32>) -> PitchResult {
    PitchResult {
        freq: 0.0,
        midi: -1,
        cents: 0.0,
        note: String::new(),
        rms,
        spectrum,
    }
}

/// Log-spaced magnitude spectrum (SPECTRUM_BINS, 0..1) for the visualizer.
///
/// Exact real-FFT recombination: the real frame is packed even/odd into a
/// complex half-size FFT (Z = E + iO), then X[k] = E[k] + e^{−iθₖ}O[k]
/// with θₖ = 2πk/n.
fn spectrum(samples: &[f32], sample_rate: f64) -> Vec<f32> {
    let n = samples.len();
    let mut out = vec![0f32; SPECTRUM_BINS];
    if n < 512 || !(sample_rate > 8000.0) {
        return out;
    }
    let half = n / 2;

    // Pack real input into complex (even/odd).
    let mut buf: Vec<rustfft::num_complex::Complex64> = Vec::with_capacity(half);
    for k in 0..half {
        buf.push(rustfft::num_complex::Complex64::new(
            samples[2 * k] as f64,
            samples[2 * k + 1] as f64,
        ));
    }
    let mut planner = FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(half);
    fft.process(&mut buf);

    // Recombine into magnitudes |X[k]| for k = 1..half/2.
    let bin_hz = sample_rate / n as f64;
    let mut mags = vec![0f64; half / 2 + 1];
    for k in 1..=half / 2 {
        let ek = buf[k].re; // E[k]
        let ok = buf[k].im; // O[k]
        let theta = 2.0 * std::f64::consts::PI * k as f64 / n as f64;
        let re = ek * theta.cos() + ok * theta.sin();
        let im = ok * theta.cos() - ek * theta.sin();
        mags[k] = (re * re + im * im).sqrt();
    }

    // Map FFT bins onto the log-spaced output bins.
    let bin_edges: Vec<f64> = (0..=SPECTRUM_BINS)
        .map(|i| SPECTRUM_F_MIN * (SPECTRUM_F_MAX / SPECTRUM_F_MIN).powf(i as f64 / SPECTRUM_BINS as f64))
        .collect();
    let mut sums = vec![0f64; SPECTRUM_BINS];
    let mut counts = vec![0usize; SPECTRUM_BINS];
    for k in 1..=half / 2 {
        let f = k as f64 * bin_hz;
        if f < SPECTRUM_F_MIN {
            continue;
        }
        if f > SPECTRUM_F_MAX {
            break;
        }
        let idx = (0..SPECTRUM_BINS).find(|b| f <= bin_edges[b + 1]);
        if let Some(b) = idx {
            sums[b] += mags[k];
            counts[b] += 1;
        }
    }
    let mut max = 1e-12f64;
    for b in 0..SPECTRUM_BINS {
        if counts[b] > 0 {
            let v = (sums[b] / counts[b] as f64) as f32;
            out[b] = v;
            if v as f64 > max {
                max = v as f64;
            }
        }
    }
    // Convert to a 60 dB-scaled range so quiet bins stay visible.
    for b in 0..SPECTRUM_BINS {
        let v = out[b] as f64;
        if v <= 1e-12 {
            out[b] = 0.0;
            continue;
        }
        let db = (20.0 * (v / max).log10()).max(-60.0);
        out[b] = ((db + 60.0) / 60.0).clamp(0.0, 1.0) as f32;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(hz: f64, sr: f32, n: usize, gain: f64) -> Vec<f32> {
        (0..n)
            .map(|i| (gain * (2.0 * std::f64::consts::PI * hz * i as f64 / sr as f64).sin()) as f32)
            .collect()
    }

    fn mixed(hz: f64, sr: f32, n: usize, gain: f64, harm2: f64) -> Vec<f32> {
        (0..n)
            .map(|i| {
                let t = 2.0 * std::f64::consts::PI * i as f64 / sr as f64;
                (gain * (hz * t).sin() + harm2 * (2.0 * hz * t).sin()) as f32
            })
            .collect()
    }

    fn noise(n: usize, seed: u64) -> Vec<f32> {
        let mut state = seed;
        (0..n)
            .map(|_| {
                // xorshift — enough for a noise bed
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                ((state & 0xff) as f32 / 127.5 - 1.0) * 0.05
            })
            .collect()
    }

    const SR: f32 = 48_000.0;

    #[test]
    fn detects_pure_tones_across_guitar_range() {
        for (hz, want) in [
            (82.407, 40), (110.0, 45), (146.83, 50), (196.0, 55), (246.94, 59),
            (329.63, 64), (440.0, 69), (659.25, 76),
        ] {
            let frame = sine(hz, SR, 8192, 0.5);
            let r = pitch_detect(&frame, SR);
            assert!(
                r.midi() == want,
                "wanted MIDI {want}, got {} ({}) at {} Hz",
                r.midi(),
                r.note(),
                r.freq()
            );
            assert!(r.cents().abs() < 5.0, "cents off: {}", r.cents());
        }
    }

    #[test]
    fn second_harmonic_does_not_jump_an_octave() {
        // Strong 2nd harmonic (a real plucked string): the fundamental must
        // win, not the octave above.
        let frame = mixed(196.0, SR, 8192, 0.5, 0.35);
        let r = pitch_detect(&frame, SR);
        assert_eq!(r.midi(), 55, "note {} at {} Hz", r.note(), r.freq());

        // Even with a very strong 2nd harmonic relative to the fundamental.
        let frame = mixed(82.407, SR, 8192, 0.3, 0.45);
        let r = pitch_detect(&frame, SR);
        assert_eq!(r.midi(), 40, "note {} at {} Hz", r.note(), r.freq());
    }

    #[test]
    fn tone_plus_noise() {
        // A tone at −20 dB above a noise bed should still be found.
        let mut frame = sine(146.83, SR, 8192, 0.3);
        let bed = noise(8192, 0x9e3779b9);
        for (i, v) in bed.iter().enumerate() {
            frame[i] += *v;
        }
        let r = pitch_detect(&frame, SR);
        assert_eq!(r.midi(), 50, "note {} at {} Hz", r.note(), r.freq());
    }

    #[test]
    fn silence_and_noise_report_no_tone() {
        let frame = vec![0.0001f32; 4096];
        let r = pitch_detect(&frame, SR);
        assert_eq!(r.midi(), -1);
        assert!(r.note().is_empty());

        let r = pitch_detect(&noise(8192, 42), SR);
        assert_eq!(r.midi(), -1, "noise must not produce a note");
    }

    #[test]
    fn spectrum_is_normalized_and_in_range() {
        let frame = sine(440.0, SR, 8192, 0.5);
        let r = pitch_detect(&frame, SR);
        let spec = r.spectrum();
        assert_eq!(spec.len(), SPECTRUM_BINS);
        assert!(spec.iter().all(|v| *v >= 0.0 && *v <= 1.0));
        // The 440 Hz peak must sit in the 300–600 Hz region: find the
        // strongest bin and check its center frequency.
        let (max_i, _) = spec
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap();
        let ratio = SPECTRUM_F_MAX / SPECTRUM_F_MIN;
        let center = SPECTRUM_F_MIN * ratio.powf((max_i as f64 + 0.5) / SPECTRUM_BINS as f64);
        assert!(
            (300.0..600.0).contains(&center),
            "strongest bin at ~{center} Hz, expected 440 Hz"
        );
    }
}
