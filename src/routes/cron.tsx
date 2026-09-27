/**
 * Cron builder & explainer.
 *
 * Paste a cron expression to get a plain-English description, a per-field
 * breakdown and the next fire times (in your local timezone); or pick
 * options to build one. Classic Vixie/cronie semantics: lists, ranges,
 * steps, `N/step` = `N-max/step`, month/weekday names, dow 0/7 = Sunday,
 * and the day-of-month / day-of-week union when both are restricted.
 * 5-field and 6-field (leading seconds) expressions plus the common
 * `@`-aliases are supported. Pure TypeScript — no server, no WASM.
 */
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CheckIcon, CopyIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import {
  buildCron,
  type CronBuildOptions,
  DOW_NAMES,
  explainCron,
  fieldPlainText,
  formatNextRun,
  MONTH_NAMES,
  nextRuns,
  parseCron,
  timeZoneName,
} from '~/features/cron/logic';
import { copyText } from '~/lib/clipboard';

const PRESETS: { label: string; expr: string }[] = [
  { label: 'Every minute', expr: '* * * * *' },
  { label: 'Every 15 minutes', expr: '*/15 * * * *' },
  { label: 'Hourly', expr: '@hourly' },
  { label: 'Daily 00:00', expr: '@daily' },
  { label: 'Weekdays 09:00', expr: '0 9 * * 1-5' },
  { label: 'Sundays 02:30', expr: '30 2 * * 0' },
  { label: '1st of month 00:00', expr: '@monthly' },
  { label: 'Yearly 00:00', expr: '@yearly' },
];

const DOW_CHIPS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  value: d,
  label: DOW_NAMES[d]!.slice(0, 3),
}));

type Mode = CronBuildOptions['mode'];
const MODES: { id: Mode; label: string }[] = [
  { id: 'minute', label: 'Every N minutes' },
  { id: 'hourly', label: 'Hourly, at minute M' },
  { id: 'daily', label: 'Daily at H:MM' },
  { id: 'weekly', label: 'Weekly on chosen days' },
  { id: 'monthly', label: 'Monthly on day D' },
  { id: 'yearly', label: 'Yearly on M/D' },
  { id: 'custom', label: 'Custom expression' },
];

export default function CronPage() {
  const [expr, setExpr] = createSignal('0 9 * * 1-5');
  const [copied, setCopied] = createSignal(false);

  const parsed = createMemo(() => parseCron(expr()));
  /** Parsed schedule (or null while the expression is invalid). */
  const cron = createMemo(() => {
    const r = parsed();
    return r.ok ? r.parsed : null;
  });
  const errorText = createMemo(() => {
    const r = parsed();
    return r.ok ? null : r.error;
  });
  const sentence = createMemo(() => (cron() ? explainCron(cron()!) : ''));
  const rows = createMemo(() => (cron() ? fieldPlainText(cron()!) : []));

  // Keep "next runs" fresh: recompute once a minute (client only).
  const [tick, setTick] = createSignal(0);
  if (typeof window !== 'undefined') {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    onCleanup(() => window.clearInterval(id));
  }
  const runs = createMemo(() => {
    const r = parsed();
    if (!r.ok) return null;
    void tick(); // track the per-minute tick
    return nextRuns(r.parsed, new Date(), 5);
  });

  const copyExpr = async () => {
    try {
      await copyText(expr());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the expression is visible */
    }
  };

  /* ---------- builder state ---------- */
  const [mode, setMode] = createSignal<Mode>('minute');
  const [everyMinutes, setEveryMinutes] = createSignal(15);
  const [minuteOfHour, setMinuteOfHour] = createSignal(0);
  const [hour, setHour] = createSignal(9);
  const [minute, setMinute] = createSignal(0);
  const [days, setDays] = createSignal<number[]>([1, 2, 3, 4, 5]);
  const [dayOfMonth, setDayOfMonth] = createSignal(1);
  const [month, setMonth] = createSignal(1);

  const toggleDay = (d: number) =>
    setDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b),
    );

  const applyBuild = () => {
    const o: CronBuildOptions =
      mode() === 'custom'
        ? { mode: 'custom', custom: expr() }
        : {
            mode: mode(),
            everyMinutes: everyMinutes(),
            minuteOfHour: minuteOfHour(),
            hour: hour(),
            minute: minute(),
            days: days(),
            dayOfMonth: dayOfMonth(),
            month: month(),
          };
    setExpr(buildCron(o));
  };

  const numInput = (
    value: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    label: string,
  ) => (
    <input
      type="number"
      class="cron-num"
      min={min}
      max={max}
      value={value()}
      aria-label={label}
      onInput={(e) => set(parseInt(e.currentTarget.value || '0', 10))}
    />
  );

  return (
    <>
      <RouteMeta path="/cron" />
      <ToolPage
        tone="dev"
        title="Cron builder & explainer"
        lede="Turn cron schedules into plain English - and build them back. Paste an expression to see what it does and when it fires next (in your timezone), or pick options to generate one. Handles 5-field and 6-field (seconds) cron plus @-aliases. 100% in your browser."
        related={[
          { path: '/time', label: 'Date & time' },
          { path: '/regex', label: 'Regex' },
          { path: '/string-escape', label: 'String escape' },
        ]}
      >
        <ToolColumns
          aside={
            <div>
              <div class="opt-group">
                <span class="opt-label">Builder</span>
                <div class="field">
                  <select value={mode()} onChange={(e) => setMode(e.currentTarget.value as Mode)}>
                    <For each={MODES}>{(m) => <option value={m.id}>{m.label}</option>}</For>
                  </select>
                </div>

                <Show when={mode() === 'minute'}>
                  <div class="cron-build-row">
                    <span>every</span>
                    {numInput(everyMinutes, setEveryMinutes, 1, 59, 'Every N minutes')}
                    <span>minutes</span>
                  </div>
                </Show>
                <Show when={mode() === 'hourly'}>
                  <div class="cron-build-row">
                    <span>at minute</span>
                    {numInput(minuteOfHour, setMinuteOfHour, 0, 59, 'Minute of hour')}
                    <span>of every hour</span>
                  </div>
                </Show>
                <Show when={mode() === 'daily'}>
                  <div class="cron-build-row">
                    <span>daily at</span>
                    {numInput(hour, setHour, 0, 23, 'Hour')}
                    <span>:</span>
                    {numInput(minute, setMinute, 0, 59, 'Minute')}
                  </div>
                </Show>
                <Show when={mode() === 'weekly'}>
                  <div class="flag-row" style="margin-bottom: 8px">
                    <For each={DOW_CHIPS}>
                      {(d) => (
                        <button
                          type="button"
                          class={`chip ${days().includes(d.value) ? 'is-on' : ''}`}
                          aria-pressed={days().includes(d.value)}
                          onClick={() => toggleDay(d.value)}
                        >
                          {d.label}
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="cron-build-row">
                    <span>at</span>
                    {numInput(hour, setHour, 0, 23, 'Hour')}
                    <span>:</span>
                    {numInput(minute, setMinute, 0, 59, 'Minute')}
                  </div>
                </Show>
                <Show when={mode() === 'monthly'}>
                  <div class="cron-build-row">
                    <span>on day</span>
                    {numInput(dayOfMonth, setDayOfMonth, 1, 31, 'Day of month')}
                    <span>at</span>
                    {numInput(hour, setHour, 0, 23, 'Hour')}
                    <span>:</span>
                    {numInput(minute, setMinute, 0, 59, 'Minute')}
                  </div>
                </Show>
                <Show when={mode() === 'yearly'}>
                  <div class="cron-build-row">
                    <span>on</span>
                    <select
                      value={String(month())}
                      aria-label="Month"
                      onChange={(e) => setMonth(parseInt(e.currentTarget.value, 10))}
                    >
                      <For each={MONTH_NAMES}>{(m, i) => <option value={i() + 1}>{m}</option>}</For>
                    </select>
                    <span>,</span>
                    <span>day</span>
                    {numInput(dayOfMonth, setDayOfMonth, 1, 31, 'Day of month')}
                    <span>at</span>
                    {numInput(hour, setHour, 0, 23, 'Hour')}
                    <span>:</span>
                    {numInput(minute, setMinute, 0, 59, 'Minute')}
                  </div>
                </Show>
                <Show when={mode() !== 'custom'}>
                  <button type="button" class="btn btn-sm" onClick={applyBuild}>
                    Apply to expression
                  </button>
                </Show>
                <p class="opt-hint">
                  Building sets the expression on the left - edit it freely afterwards; it is
                  re-parsed live.
                </p>
              </div>

              <div class="opt-group">
                <span class="opt-label">Quick presets</span>
                <div class="chip-row">
                  <For each={PRESETS}>
                    {(p) => (
                      <button
                        type="button"
                        class="chip"
                        title={p.expr}
                        onClick={() => setExpr(p.expr)}
                      >
                        {p.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <div class="opt-group">
                <span class="opt-label">Field reference</span>
                <p class="opt-hint">
                  <code>
                    minute 0-59 · hour 0-23 · day-of-month 1-31 · month 1-12 (JAN-DEC) · day-of-week
                    0-7 (0 and 7 = Sunday; SUN-SAT)
                  </code>
                </p>
                <p class="opt-hint">
                  A 6th leading field is treated as seconds. <code>@hourly</code>,{' '}
                  <code>@daily</code>, <code>@midnight</code>, <code>@weekly</code>,{' '}
                  <code>@monthly</code>, <code>@yearly</code> and <code>@reboot</code> are
                  recognised.
                </p>
                <p class="opt-hint">
                  When both day-of-month and day-of-week are restricted, the schedule fires when
                  <i> either</i> matches (the classic cron union rule).
                </p>
                <p class="opt-hint">
                  Times are wall-clock in your local timezone. On DST change days a non-existent
                  time is skipped and a repeated time fires once - like system crons.
                </p>
              </div>
            </div>
          }
        >
          <div class="panel">
            <div class="panel-title">Cron expression</div>
            <div class="regex-pattern-row">
              <input
                class="code-inline"
                value={expr()}
                spellcheck={false}
                aria-label="Cron expression"
                onInput={(e) => setExpr(e.currentTarget.value)}
              />
              <button type="button" class="btn btn-sm btn-ghost" onClick={copyExpr}>
                <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>

          <Show when={errorText() !== null}>
            <div class="error-card">
              <AlertIcon />
              <div>
                <b>Invalid cron expression</b>
                <p>{errorText()}</p>
              </div>
            </div>
          </Show>

          <Show when={cron() !== null}>
            <div class="panel">
              <div class="panel-title">What it means</div>
              <p class="cron-sentence">{sentence()}</p>
              <Show when={cron()!.alias}>
                <p class="opt-hint">
                  Alias <code>{cron()!.alias}</code> - expanded to its standard equivalent.
                </p>
              </Show>
              <div class="cron-fields">
                <For each={rows()}>
                  {(row) => (
                    <div class="cron-field-row">
                      <span class="cron-field-name">{row.field}</span>
                      <code class="cron-field-raw">{row.raw}</code>
                      <span class="cron-field-text">{row.text}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class="panel">
              <div class="panel-title">Next runs - {timeZoneName()}</div>
              <Show
                when={runs() !== null}
                fallback={
                  <p class="opt-hint">
                    This schedule never matches a real calendar time (for example, day 30 in
                    February) - or it is not a clock schedule.
                  </p>
                }
              >
                <ul class="cron-run-list">
                  <For each={runs()}>
                    {(d) => (
                      <li>
                        <CheckIcon /> {formatNextRun(d!)}
                      </li>
                    )}
                  </For>
                </ul>
                <p class="opt-hint">
                  Computed in {timeZoneName()}; shown as wall-clock local time.
                </p>
              </Show>
            </div>
          </Show>
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );
}
