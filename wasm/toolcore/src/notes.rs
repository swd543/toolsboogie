//! 12-tone equal temperament note math (A4 = 440 Hz reference).

/// Note names in order C, C#, D, … B.
pub const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Frequency (Hz) of a MIDI note number (69 = A4 = 440 Hz).
pub fn midi_to_hz(midi: i32) -> f64 {
    440.0 * 2f64.powf((midi as f64 - 69.0) / 12.0)
}

/// Nearest MIDI note number to a frequency, plus the deviation in cents.
/// `cents` is signed: negative = flat, positive = sharp, 0 = in tune.
/// Returns `(-1, 0.0)` when the frequency is outside a sane musical range.
pub fn nearest_midi(hz: f64) -> (i32, f32) {
    if !(hz.is_finite() && hz > 0.0) {
        return (-1, 0.0);
    }
    let midi_cont = 69.0 + 12.0 * (hz / 440.0).log2();
    let midi = midi_cont.round() as i32;
    if midi < -12 || midi > 131 {
        return (-1, 0.0);
    }
    let cents = ((midi_cont - midi_cont.round()) * 100.0).clamp(-50.0, 50.0) as f32;
    (midi, cents)
}

/// Human name of a MIDI note, e.g. 69 → "A4", 40 → "E2".
pub fn midi_name(midi: i32) -> String {
    let idx = (((midi % 12) + 12) % 12) as usize;
    let octave = midi / 12 - 1;
    format!("{}{}", NOTE_NAMES[idx], octave)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_tones() {
        assert!((midi_to_hz(69) - 440.0).abs() < 1e-9);
        assert!((midi_to_hz(40) - 82.407).abs() < 0.01); // E2
        assert!((midi_to_hz(84) - 1046.5).abs() < 0.1); // E6
    }

    #[test]
    fn nearest_and_cents() {
        let (m, c) = nearest_midi(440.0);
        assert_eq!(m, 69);
        assert!((c - 0.0).abs() < 1e-6);

        // A4 + 40 cents → still rounds to A4, +40
        let (m, c) = nearest_midi(440.0 * 2f64.powf(40.0 / 1200.0));
        assert_eq!(m, 69);
        assert!((c - 40.0).abs() < 0.1);

        // Flat B3 (246.94 → 245 Hz): rounds to B3, ~−14 cents
        let (m, c) = nearest_midi(245.0);
        assert_eq!(m, 59);
        assert!((c + 13.7).abs() < 1.0, "cents: {c}");

        assert_eq!(nearest_midi(0.0), (-1, 0.0));
        assert_eq!(nearest_midi(f64::NAN), (-1, 0.0));
    }

    #[test]
    fn names() {
        assert_eq!(midi_name(69), "A4");
        assert_eq!(midi_name(40), "E2");
        assert_eq!(midi_name(55), "G3");
        assert_eq!(midi_name(95), "B6");
        assert_eq!(midi_name(-1), "B-1");
    }
}
