/**
 * Minimal WebGPU helpers — the "wherever possible" GPU layer of the site.
 *
 * Two renderers, both a full-screen triangle + one fragment shader
 * (no textures, no compute, tiny):
 *
 *  - `makeCompassFace`: static dial art (ring, ticks, degree marks).
 *    The moving parts (needle, cardinals) are DOM transforms so the
 *    per-frame cost is zero; the face redraws only on resize/theme change.
 *  - `makeLevelSurface`: per-frame animated bubble level; a 32-byte
 *    dynamic uniform buffer carries the tilt vector + levelness.
 *
 * Every call site feature-detects (`navigator.gpu`) and falls back to a
 * Canvas2D renderer when WebGPU is unavailable — the tools work everywhere.
 */

export interface GpuHandle {
  device: GPUDevice;
  ctx: GPUCanvasContext;
  canvas: HTMLCanvasElement;
}

let devicePromise: Promise<GPUDevice | null> | null = null;

/** Preferred canvas color format (render-pipeline target). */
function canvasFormat(): GPUTextureFormat {
  try {
    return (navigator.gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm') as GPUTextureFormat;
  } catch {
    return 'bgra8unorm';
  }
}

/** Best-effort device request (null when unsupported or failed). */
export function gpuDevice(): Promise<GPUDevice | null> {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    try {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      return await adapter.requestDevice();
    } catch {
      return null;
    }
  })();
  return devicePromise;
}

const FULLSCREEN_VERT = `
@vertex
fn vs_main(@builtin.vertex_index index: u32) -> @builtin(position) vec4<f32> {
  // Full-screen triangle (three vertices, no buffer).
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  return vec4<f32>(p[index], 0.0, 1.0);
}
`;

/** Colors as f32 triples — mirror of the design tokens (both themes). */
function makePipeline(
  handle: GpuHandle,
  fragSource: string,
  uniformSize: number,
): { pipeline: GPURenderPipeline; bindGroup: GPUBindGroup; uniform: GPUBuffer } {
  const { device } = handle;
  const format = canvasFormat();
  const module = device.createShaderModule({ code: FULLSCREEN_VERT + fragSource });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const uniform = device.createBuffer({
    size: uniformSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  });
  return { pipeline, bindGroup, uniform };
}

/** Write vec2f size + extras into a 32-byte uniform buffer. */
function writeUniform(
  uniform: GPUBuffer,
  device: GPUDevice,
  sizeX: number,
  sizeY: number,
  extra: number[] = [],
) {
  const bytes = new ArrayBuffer(32);
  const f = new Float32Array(bytes);
  f[0] = sizeX;
  f[1] = sizeY;
  for (let i = 0; i < extra.length && i < 6; i += 1) f[2 + i] = extra[i] ?? 0;
  device.queue.writeBuffer(uniform, 0, bytes);
}

/* ------------------------------------------------------------------ */
/*  Compass face (static)                                              */
/* ------------------------------------------------------------------ */

const COMPASS_FRAG = `
struct U { size: vec2<f32>, theme: f32, _pad: f32 };
@group(0) @binding(0) var<uniform> u: U;

@fragment
fn fs_main(@builtin(position) pos: vec4<f32>) -> loc0: vec4<f32> {
  let center = u.size * 0.5;
  let p = pos.xy - center;
  let r = length(p);
  let R = min(u.size.x, u.size.y) * 0.5;

  // Theme: face/ink/line colors (light: paper & warm ink; dark: near-black).
  let face = mix(vec3<f32>(0.98, 0.98, 0.97), vec3<f32>(0.09, 0.095, 0.11), u.theme);
  let ink  = mix(vec3<f32>(0.16, 0.15, 0.13), vec3<f32>(0.92, 0.92, 0.90), u.theme);
  let line = mix(vec3<f32>(0.72, 0.70, 0.63), vec3<f32>(0.30, 0.30, 0.33), u.theme);
  let accent = mix(vec3<f32>(0.427, 0.157, 0.851), vec3<f32>(0.655, 0.545, 0.980), u.theme); // measurement-group violet

  var color = face;
  var alpha = 0.0;

  // Soft outer drop ring.
  if (r < R) {
    // Outer ring band.
    if (r > R * 0.94) {
      color = mix(color, line, 0.55);
    }
    // Tick marks every 5 degrees: major (long) at 30, medium at 10.
    let ang = atan2(p.y, p.x);            // -pi..pi, 0 = +x (east)
    let deg = degrees(ang) + 90.0;        // 0 = up (north), clockwise
    let dd = mod(deg + 2.5, 5.0) - 2.5;   // distance to nearest 5° multiple
    if (r > R * 0.80 && r < R * 0.93) {
      let inTick = abs(dd) < 0.9;
      if (inTick) {
        let major = mod(deg + 15.0, 30.0) < 1.8 || mod(deg + 15.0, 30.0) > 28.2;
        let medium = mod(deg + 5.0, 10.0) < 0.9;
        if (major) {
          color = mix(color, ink, 0.9);
        } else if (medium) {
          color = mix(color, ink, 0.55);
        } else {
          color = mix(color, ink, 0.3);
        }
      }
    }
    // Cardinal dots: four small dots at the 0/90/180/270 spokes.
    let cdeg = mod(deg + 45.0, 90.0) - 45.0;
    if (abs(cdeg) < 1.6 && r > R * 0.52 && r < R * 0.585) {
      color = mix(color, ink, 0.75);
    }
    // Inner circle.
    if (abs(r - R * 0.40) < 1.5) {
      color = mix(color, line, 0.8);
    }
    // Center hub.
    if (r < R * 0.045) {
      color = ink;
    }
    // North accent wedge (a subtle accent arc just inside the ticks,
    // centered on 0° = up).
    if (r > R * 0.90 && r < R * 0.935 && abs(mod(deg + 180.0, 360.0) - 0.0) < 3.5) {
      color = accent;
    }
    alpha = 1.0;
  }

  // Rounded corner fade (the canvas is square; keep the circular face).
  if (r >= R) { alpha = 0.0; }

  return vec4<f32>(color, alpha);
}
`;

export interface CompassFace {
  /** Redraw the static face (call after resize / theme change). */
  draw: () => void;
  dispose: () => void;
  usingGpu: boolean;
}

/**
 * Draw the static compass dial. `getTheme` returns 0 (light) or 1 (dark).
 */
export async function makeCompassFace(
  canvas: HTMLCanvasElement,
  getTheme: () => number,
): Promise<CompassFace | null> {
  const device = await gpuDevice();
  if (!device) return null;
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;
  const handle: GpuHandle = { device, ctx, canvas };
  const { pipeline, bindGroup, uniform } = makePipeline(handle, COMPASS_FRAG, 32);
  let disposed = false;

  const draw = () => {
    if (disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    writeUniform(uniform, device, w, h, [getTheme(), 0]);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };

  return { draw, dispose: () => (disposed = true), usingGpu: true };
}

/* ------------------------------------------------------------------ */
/*  Level surface (per-frame)                                          */
/* ------------------------------------------------------------------ */

const LEVEL_FRAG = `
struct U {
  size: vec2<f32>,
  tilt: vec2<f32>,      // bubble offset, -1..1 in each axis
  levelness: f32,       // 0 = fully tilted, 1 = level
  theme: f32,
  _pad: f32,
};
@group(0) @binding(0) var<uniform> u: U;

@fragment
fn fs_main(@builtin(position) pos: vec4<f32>) -> loc0: vec4<f32> {
  let center = u.size * 0.5;
  let p = pos.xy - center;
  let r = length(p);
  let R = min(u.size.x, u.size.y) * 0.5;

  let face = mix(vec3<f32>(0.98, 0.98, 0.97), vec3<f32>(0.09, 0.095, 0.11), u.theme);
  let ink  = mix(vec3<f32>(0.16, 0.15, 0.13), vec3<f32>(0.92, 0.92, 0.90), u.theme);
  let line = mix(vec3<f32>(0.78, 0.76, 0.70), vec3<f32>(0.26, 0.26, 0.29), u.theme);
  let accent = mix(vec3<f32>(0.427, 0.157, 0.851), vec3<f32>(0.655, 0.545, 0.980), u.theme); // measurement-group violet
  let ok = mix(vec3<f32>(0.12, 0.48, 0.30), vec3<f32>(0.30, 0.76, 0.54), u.theme);

  var color = face;
  var alpha = 0.0;

  if (r < R) {
    // Fine grid (every ~R/8) with a stronger center crosshair.
    let gx = mod(abs(p.x), R * 0.25);
    let gy = mod(abs(p.y), R * 0.25);
    if (gx < 1.2) { color = mix(color, line, 0.5); }
    if (gy < 1.2) { color = mix(color, line, 0.5); }
    if (abs(p.x) < 1.4) { color = mix(color, ink, 0.5); }
    if (abs(p.y) < 1.4) { color = mix(color, ink, 0.5); }

    // Target ring (the "you want to be here" circle).
    let ringR = R * 0.16;
    if (abs(r - ringR) < 2.2) {
      color = mix(color, ink, 0.7);
    }
    // Ring glows ok-colored when level.
    if (abs(r - ringR) < 4.0) {
      color = mix(color, ok, u.levelness * 0.35);
    }

    // Bubble: a sphere at the tilt position, sliding inside the face.
    let travel = R * 0.72;
    let bubbleC = vec2<f32>(u.tilt.x, -u.tilt.y) * travel;
    let br = R * 0.30;
    let d = length(p - bubbleC);
    if (d < br) {
      // Body color lerps accent→ok with levelness.
      let body = mix(accent, ok, u.levelness);
      // Simple sphere shading: radial gradient + specular dot.
      let k = d / br;
      let shade = 1.0 - 0.25 * k * k;
      let spec = smoothstep(0.55, 0.0, length(p - bubbleC - vec2<f32>(-br * 0.3, -br * 0.3)) / br);
      color = body * shade + vec3<f32>(spec * 0.5);
      // Rim.
      if (k > 0.92) { color = mix(color, ink, 0.5); }
    }
    if (d < br + 3.0 && d >= br) {
      color = mix(color, ink, 0.25);
    }

    alpha = 1.0;
  }
  return vec4<f32>(color, alpha);
}
`;

export interface LevelSurface {
  /** Feed the next frame (tilt in -1..1 per axis, levelness 0..1). */
  set: (tiltX: number, tiltY: number, levelness: number) => void;
  dispose: () => void;
  usingGpu: boolean;
}

/**
 * Animated level surface. Drives its own rAF loop while alive.
 * `getTheme` returns 0 (light) or 1 (dark).
 */
export async function makeLevelSurface(
  canvas: HTMLCanvasElement,
  getTheme: () => number,
): Promise<LevelSurface | null> {
  const device = await gpuDevice();
  if (!device) return null;
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;
  const handle: GpuHandle = { device, ctx, canvas };
  const { pipeline, bindGroup, uniform } = makePipeline(handle, LEVEL_FRAG, 32);
  let disposed = false;
  let tiltX = 0;
  let tiltY = 0;
  let levelness = 0;
  let raf = 0;

  const frame = () => {
    if (disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    writeUniform(uniform, device, w, h, [tiltX, tiltY, levelness, getTheme(), 0]);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    set: (x, y, level) => {
      tiltX = Math.max(-1, Math.min(1, x));
      tiltY = Math.max(-1, Math.min(1, y));
      levelness = Math.max(0, Math.min(1, level));
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
    },
    usingGpu: true,
  };
}
