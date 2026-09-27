/**
 * Home page: hero + the tool grid. The grid is driven by the registry in
 * src/site/config.ts — adding a tool there adds its card here.
 */
import { For } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import {
  BoltTiny,
  BracesIcon,
  CompassIcon,
  EscapeIcon,
  type IconProps,
  KeyIcon,
  LevelIcon,
  RegexIcon,
  RulerIcon,
  ShieldTiny,
  SwapIcon,
  TimeIcon,
  TunerIcon,
  YamlIcon,
} from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { site, type ToolDef, tools } from '~/site/config';

const ICONS: Record<ToolDef['icon'], (props: IconProps) => ReturnType<typeof TunerIcon>> = {
  tuner: TunerIcon,
  braces: BracesIcon,
  swap: SwapIcon,
  yaml: YamlIcon,
  regex: RegexIcon,
  escape: EscapeIcon,
  time: TimeIcon,
  key: KeyIcon,
  compass: CompassIcon,
  ruler: RulerIcon,
  level: LevelIcon,
};

export default function Home() {
  return (
    <>
      <RouteMeta path="/" />
      <div class="hero">
        <h1>{site.tagline}</h1>
        <p class="lede">{site.description}</p>
        <div class="badge-row">
          <span class="badge">
            <ShieldTiny /> 100% client-side — nothing is uploaded
          </span>
          <span class="badge">
            <BoltTiny /> Free · no account · works offline once loaded
          </span>
        </div>
      </div>
      <div class="tool-grid">
        <For each={tools}>
          {(t) => {
            const Icon = ICONS[t.icon];
            return (
              <a class="tool-card" href={t.path}>
                <span class="tool-icon">
                  <Icon />
                </span>
                <h3>{t.label}</h3>
                <p>{t.blurb}</p>
                <span class="tool-go">Open tool →</span>
              </a>
            );
          }}
        </For>
      </div>
      <AdSlot slot="home-bottom" className="home-ad" />
    </>
  );
}
