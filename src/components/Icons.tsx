/**
 * Icon set — small stroke icons drawn with the 24px grid, currentColor.
 */

export interface IconProps {
  class?: string;
}

function Svg(props: IconProps & { children: string; viewBox?: string; filled?: boolean }) {
  return (
    <svg
      viewBox={props.viewBox ?? '0 0 24 24'}
      fill={props.filled ? 'currentColor' : 'none'}
      stroke={props.filled ? 'none' : 'currentColor'}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <g innerHTML={props.children} />
    </svg>
  );
}

/* ---------------- brand ---------------- */

/** Tuning fork logo mark. */
export function Logo(props: IconProps) {
  return (
    <svg viewBox="0 0 64 64" class={props.class} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path
        d="M24 12v18a8 8 0 0 0 16 0V12"
        fill="none"
        stroke="#fff"
        stroke-width="5"
        stroke-linecap="round"
      />
      <path d="M32 38v12" stroke="#fff" stroke-width="5" stroke-linecap="round" />
      <circle cx="32" cy="54" r="3.5" fill="#fff" />
    </svg>
  );
}

/* ---------------- tool icons ---------------- */

/** Guitar tuner — tuning fork with a sound wave. */
export function TunerIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<path d="M9 3v8a3 3 0 0 0 6 0V3"/><path d="M12 14v5"/><circle cx="12" cy="20" r="1.4"/>'
      }
    />
  );
}

/** JSON — braces. */
export function BracesIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<path d="M8 4c-2 0-2 2-2 4s0 4-2 4c2 0 2 2 2 4s0 4 2 4M16 4c2 0 2 2 2 4s0 4 2 4c-2 0-2 2-2 4s0 4-2 4"/>'
      }
    />
  );
}

/** JSON → YAML — swap arrows. */
export function SwapIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<path d="M4 8h13l-3.5-3.5"/><path d="M20 16H7l3.5 3.5"/><path d="M20 8h-4M11 16h4"/>'
      }
    />
  );
}

/** YAML — braces with lines (doc-ish). */
export function YamlIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<path d="M7 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M9 8h7M9 12h7M9 16h4"/>'
      }
    />
  );
}

/** Regex — # in a box (hash/escape flavor). */
export function RegexIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9 8l6 8M15 8l-6 8"/><path d="M6.5 12h3M14.5 12h3"/>'
      }
    />
  );
}

/** String escape — quotes with backslashes. */
export function EscapeIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<path d="M10 9H7a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3a2 2 0 0 1 2 2z"/><path d="M17 9h3a1 1 0 0 1 1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3a2 2 0 0 0-2 2z"/><path d="M9 19l6-6"/>'
      }
    />
  );
}

/** Time — clock with a small gear tick. */
export function TimeIcon(props: IconProps) {
  return <Svg {...props} children={'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'} />;
}

/** JWT — key. */
export function KeyIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={'<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M15 7l2.5 2.5M12 10l2 2"/>'}
    />
  );
}

/** Compass — rose. */
export function CompassIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={'<circle cx="12" cy="12" r="9"/><path d="M15 9l-2.2 4.8L9 15l2.2-4.8z"/>'}
    />
  );
}

/** Ruler. */
export function RulerIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<rect x="3" y="9" width="18" height="6" rx="1.5"/><path d="M7 9v3M11 9v3M15 9v3M19 9v3"/>'
      }
    />
  );
}

/** Level — bubble circle. */
export function LevelIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'
      }
    />
  );
}

/* ---------------- UI icons ---------------- */

export function CopyIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
      }
    />
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<path d="M12 3v11m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'
      }
    />
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children={
        '<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M20 4v5h-5M4 20v-5h5"/>'
      }
    />
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props} children={'<path d="M12 3l9.5 16.5H2.5z"/><path d="M12 10v4.5M12 17.6v.4"/>'} />
  );
}

export function CheckIcon(props: IconProps) {
  return <Svg {...props} children={'<path d="M4 12.5l5 5L20 6.5"/>'} />;
}

export function ShieldTiny() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
    </svg>
  );
}

export function BoltTiny() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" class={`${props.class ?? ''} spinner`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** Small plus (used by the regex builder chips). */
export function PlusIcon(props: IconProps) {
  return <Svg {...props} children='<path d="M12 5v14M5 12h14" />' />;
}

/** Small x (error / failure marks). */
export function XIcon(props: IconProps) {
  return <Svg {...props} children='<path d="M6 6l12 12M18 6L6 18" />' />;
}

/** Microphone (tuner start button). */
export function MicIcon(props: IconProps) {
  return (
    <Svg
      {...props}
      children='<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'
    />
  );
}

/** Small chevron (nav group disclosure). */
export function ChevronDownIcon(props: IconProps) {
  return <Svg {...props} children='<path d="m6 9 6 6 6-6" />' />;
}
