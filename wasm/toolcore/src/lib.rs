//! WASM core for the browser tool suite.
//!
//! One small module, three families of operations, each exposed to the app
//! behind a thin TS wrapper (`src/lib/wasm.ts`):
//!
//! * [`json`] — format / minify JSON with exact error positions
//!   (serde_json, insertion- or sorted-key order).
//! * [`yaml`] — YAML ↔ JSON conversion and YAML re-formatting
//!   (serde_yaml on top of libyaml).
//! * [`pitch`] — FFT-based pitch detection for the guitar tuner:
//!   autocorrelation peak-picking with parabolic interpolation for the
//!   note, plus a log-spaced magnitude spectrum for the visualizer.
//!
//! Deliberately kept tiny and dependency-light. The `rlib` crate type
//! lets the same code run under `cargo test` on the host target.

mod json;
mod notes;
mod pitch;
mod yaml;

pub use json::{json_format, json_minify};
pub use notes::{midi_name, midi_to_hz, nearest_midi};
pub use pitch::pitch_detect;
pub use yaml::{json_to_yaml, yaml_format, yaml_to_json};
