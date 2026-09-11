'use client';
import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import {
  Activity,
  ArrowUpRight,
  RotateCcw,
  Scan,
  Layers3,
  Move,
  ChevronRight,
  Focus,
  Info,
  Columns2,
  Bone,
  Zap,
  CircleDot,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SpineView, { type CameraLink } from '@/components/spine-view';
import {
  LEVELS,
  DEFAULT_SCENARIO,
  NEUTRAL_SCENARIO,
  validateScenario,
} from '@/lib/scenarios.js';
type Scenario = {
  bulge: number;
  compression: number;
  direction: number;
  spread: number;
};
const regions = [
  { name: 'Cervical', prefix: 'C', sub: 'Neck', count: '7 vertebrae' },
  { name: 'Thoracic', prefix: 'T', sub: 'Mid-back', count: '12 vertebrae' },
  { name: 'Lumbar', prefix: 'L', sub: 'Lower back', count: '5 vertebrae' },
];
function Parameter({
  label,
  value,
  max = 100,
  min = 0,
  unit = ' / 100',
  onChange,
  low,
  high,
}: {
  label: string;
  value: number;
  max?: number;
  min?: number;
  unit?: string;
  onChange: (v: number) => void;
  low: string;
  high: string;
}) {
  return (
    <div className="parameter">
      <div className="parameter-label">
        <span>{label}</span>
        <output>
          {value}
          <small>{unit}</small>
        </output>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
      <div className="range-ends">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}
export default function Home() {
  const [level, setLevel] = useState('L4–L5'),
    [region, setRegion] = useState('L'),
    [scenarios, setScenarios] = useState<Record<string, Scenario>>({
      'L4–L5': { ...DEFAULT_SCENARIO },
    });
  const [focus, setFocus] = useState(true),
    [tissueSection, setTissueSection] = useState(false),
    [motionTick, setMotionTick] = useState(0),
    [separation, setSeparation] = useState(0),
    [panMode, setPanMode] = useState(false),
    [cutaway, setCutaway] = useState(false),
    [view, setView] = useState('oblique'),
    [cameraCommand, setCameraCommand] = useState('oblique'),
    [viewTick, setViewTick] = useState(0),
    [compare, setCompare] = useState(false),
    [about, setAbout] = useState(false);
  const [layers, setLayers] = useState({
    bones: true,
    discs: true,
    nerves: true,
    boneOpacity: 100,
  });
  const selected = scenarios[level] || NEUTRAL_SCENARIO;
  function choose(next: string) {
    setLevel(next);
    setRegion(next[0]);
  }
  function change(key: keyof Scenario, value: number) {
    setScenarios((prev) => ({
      ...prev,
      [level]: { ...(prev[level] || NEUTRAL_SCENARIO), [key]: value },
    }));
  }
  function camera(next: string) {
    if (next === 'axial') setFocus(true);
    setCameraCommand(next);
    if (!next.startsWith('zoom-')) setView(next);
    setViewTick((t) => t + 1);
  }
  const cameraLink = useRef<CameraLink>({ listeners: new Set() });
  const current = useRef({ level, scenarios, focus });
  current.current = { level, scenarios, focus };
  useEffect(() => {
    const registry = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!registry?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: 'read_disc_scenario',
        description:
          'Read the currently selected disc and its illustrative deformation parameters.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => ({
          level: current.current.level,
          scenario:
            current.current.scenarios[current.current.level] ||
            NEUTRAL_SCENARIO,
          focus: current.current.focus,
        }),
      },
      {
        name: 'configure_disc_scenario',
        description:
          'Select a disc and set its educational geometry controls. Does not calculate medical outcomes.',
        inputSchema: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: LEVELS },
            bulge: { type: 'number', minimum: 0, maximum: 100 },
            compression: { type: 'number', minimum: 0, maximum: 60 },
            direction: { type: 'number', enum: [-35, 0, 35] },
            spread: { type: 'number', minimum: 12, maximum: 65 },
          },
          required: ['level', 'bulge', 'compression', 'direction', 'spread'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => {
          const value = input as Record<string, unknown>;
          const valid = validateScenario(value);
          if (
            !value ||
            typeof value.level !== 'string' ||
            !LEVELS.includes(value.level) ||
            !valid ||
            ![-35, 0, 35].includes(valid.direction)
          )
            throw new Error('Invalid disc or scenario parameters');
          const next = value.level;
          flushSync(() => {
            choose(next);
            setFocus(true);
            setScenarios((p) => ({ ...p, [next]: valid }));
          });
          return { level: next, scenario: valid };
        },
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(
          registry.registerTool(tool, { signal: lifecycle.signal }),
        ).catch((error) =>
          console.warn('Optional model tool registration failed', error),
        );
      } catch (error) {
        console.warn('Optional model tool registration unavailable', error);
      }
    }
    return () => lifecycle.abort();
  }, []);
  const sceneProps = {
    level,
    scenarios,
    layers,
    focus,
    cutaway,
    separation,
    tissueSection,
    motionTick,
    panMode,
    view,
    viewTick,
    cameraCommand,
    onSelect: choose,
    cameraLink: cameraLink.current,
  };
  return (
    <main className="spinelab">
      <header className="app-header">
        <a className="brand" href="/" aria-label="SpineLab home">
          <span className="brand-icon">
            <Activity size={23} />
          </span>
          <span>
            spine<span className="brand-light">lab</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <div className="header-center">
          <span className="status-dot" />
          ANATOMY ATLAS <span className="version">01</span>
        </div>
        <button
          className="quiet-button"
          onClick={() => {
            setAbout(!about);
            if (!about)
              requestAnimationFrame(() =>
                document
                  .getElementById('model-notes')
                  ?.scrollIntoView({ behavior: 'smooth' }),
              );
          }}
        >
          <Info size={16} />
          <span>About the model</span>
        </button>
      </header>
      <div className="medical-notice" role="note">
        <strong>Educational model — not medical advice.</strong> Anatomy and
        simulations may be inaccurate or wrong. Do not use this app for
        diagnosis or treatment decisions.
        <button
          onClick={() => {
            setAbout(true);
            requestAnimationFrame(() =>
              document
                .getElementById('model-notes')
                ?.scrollIntoView({ behavior: 'smooth' }),
            );
          }}
        >
          Read disclaimer
        </button>
      </div>
      <div className="workspace">
        <aside className="anatomy-panel">
          <div className="panel-title">
            <span className="eyebrow">THE HUMAN SPINE</span>
            <span className="tiny-tag">3D</span>
          </div>
          <h1>Spinal column</h1>
          <p className="intro">BodyParts3D · Reference anatomy</p>
          <div className="section-label">
            REGIONS <span>01—03</span>
          </div>
          <div className="region-list">
            {regions.map((r) => (
              <button
                key={r.prefix}
                className={`region-button ${region === r.prefix ? 'active' : ''}`}
                onClick={() => {
                  setRegion(r.prefix);
                  choose(
                    r.prefix === 'C'
                      ? 'C5–C6'
                      : r.prefix === 'T'
                        ? 'T7–T8'
                        : 'L4–L5',
                  );
                }}
              >
                <span className={'region-mark ' + r.prefix}>{r.prefix}</span>
                <span>
                  <strong>{r.name}</strong>
                  <small>{r.sub}</small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <div className="section-label level-heading">
            DISC LEVEL{' '}
            <span>{regions.find((r) => r.prefix === region)?.count}</span>
          </div>
          <div className="level-grid">
            {LEVELS.filter((l: string) => l.startsWith(region)).map(
              (l: string) => (
                <button
                  key={l}
                  className={`level-button ${level === l ? 'active' : ''}`}
                  aria-pressed={level === l}
                  onClick={() => choose(l)}
                >
                  {l}
                  {scenarios[l]?.bulge > 0 && <span className="modified-dot" />}
                </button>
              ),
            )}
          </div>
          <div className="anatomy-note">
            <CircleDot size={17} />
            <p>Select a disc in the model or choose a level above.</p>
          </div>
          <div className="layer-section">
            <div className="section-label">
              ANATOMY LAYERS <Layers3 size={15} />
            </div>
            {(
              [
                { id: 'bones', name: 'Vertebrae', icon: Bone },
                { id: 'discs', name: 'Intervertebral discs', icon: CircleDot },
                { id: 'nerves', name: 'Neural structures', icon: Zap },
              ] as const
            ).map((l) => (
              <div className="layer-row" key={l.id}>
                <label htmlFor={'layer-' + l.id}>
                  <l.icon size={15} />
                  {l.name}
                </label>
                <Switch
                  id={'layer-' + l.id}
                  checked={layers[l.id]}
                  onCheckedChange={(v) =>
                    setLayers((p) => ({ ...p, [l.id]: v }))
                  }
                />
              </div>
            ))}
            <div className="opacity-control">
              <span>Bone opacity</span>
              <Slider
                aria-label="Bone opacity"
                value={[layers.boneOpacity]}
                min={15}
                max={100}
                onValueChange={(v) =>
                  setLayers((p) => ({
                    ...p,
                    boneOpacity: Array.isArray(v) ? v[0] : v,
                  }))
                }
              />
            </div>
          </div>
          <div className="left-footer">
            <span className="status-dot" />
            Reference model · Not your MRI
          </div>
        </aside>
        <section className="viewport" aria-label="Anatomy workspace">
          <div className="viewport-top">
            <div className="breadcrumb">
              Spine <ChevronRight size={13} />
              {regions.find((r) => r.prefix === region)?.name}
              <ChevronRight size={13} />
              <strong>{level}</strong>
            </div>
            <div className="mode-toggle">
              <button
                className={!focus ? 'active' : ''}
                onClick={() => {
                  setFocus(false);
                  setCutaway(false);
                }}
              >
                Whole spine
              </button>
              <button
                className={focus ? 'active' : ''}
                onClick={() => setFocus(true)}
              >
                Disc detail
              </button>
            </div>
          </div>
          <div className={'scene-area ' + (compare ? 'comparison' : '')}>
            {compare && (
              <div className="comparison-scene">
                <span className="scene-caption">
                  A <span>Neutral reference</span>
                </span>
                <SpineView {...sceneProps} scenarios={{}} />
              </div>
            )}
            <div className="comparison-scene">
              <span className="scene-caption">
                {compare ? 'B' : 'LIVE VIEW'}{' '}
                <span>
                  {compare
                    ? 'Your scenario'
                    : focus
                      ? level + ' · Functional segment'
                      : 'Cervical to sacrum'}
                </span>
              </span>
              <SpineView {...sceneProps} />
            </div>

            <div className="viewport-label">
              <span className="selected-line" />
              <div>
                <small>SELECTED DISC</small>
                <strong>{level}</strong>
                <button onClick={() => setFocus(!focus)}>
                  {focus ? 'See whole spine' : 'Inspect segment'}{' '}
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="camera-bar">
            <div className="camera-presets">
              {[
                { id: 'oblique', name: '3D' },
                { id: 'posterior', name: 'Back' },
                { id: 'side', name: 'Side' },
                { id: 'axial', name: 'Top' },
              ].map((v) => (
                <button
                  key={v.id}
                  className={view === v.id ? 'active' : ''}
                  onClick={() => camera(v.id)}
                >
                  {v.id === 'oblique' && <Scan size={15} />} {v.name}
                </button>
              ))}
            </div>
            <div className="camera-actions">
              <button
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => camera('zoom-in')}
              >
                +
              </button>
              <button
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => camera('zoom-out')}
              >
                −
              </button>
              <button
                aria-label="Pan camera"
                title="Toggle drag to pan"
                aria-pressed={panMode}
                onClick={() => setPanMode(!panMode)}
              >
                <Move size={17} />
              </button>
              <button
                title="Reset camera"
                aria-label="Reset camera"
                onClick={() => camera('oblique')}
              >
                <RotateCcw size={17} />
              </button>
              <button
                title="Focus selected disc"
                aria-label="Focus selected disc"
                onClick={() => {
                  setFocus(true);
                  camera('oblique');
                }}
              >
                <Focus size={18} />
              </button>
            </div>
          </div>
          <div className="viewport-bottom">
            <a
              className="source-credit"
              href="/anatomy/ATTRIBUTION.txt"
              target="_blank"
              rel="noreferrer"
            >
              Anatomy: BodyParts3D / DBCLS
            </a>
            <span>
              <Move size={13} /> Drag anatomy to rotate · Drag background to pan
              · Pinch to zoom
            </span>
            <div className="legend">
              <span>
                <i className="disc-swatch" />
                Disc
              </span>
              <span>
                <i className="hernia-swatch" />
                Herniation
              </span>
              <span>
                <i className="nerve-swatch" />
                Nerves (schematic)
              </span>
            </div>
          </div>
        </section>
        <aside className="scenario-panel">
          <div className="panel-title">
            <span className="eyebrow">DISC PARAMETERS</span>
            <span className="live-badge">
              <span className="status-dot" />
              LIVE
            </span>
          </div>
          <div className="selected-heading" aria-live="polite">
            <h2>{level}</h2>
            <span>{regions.find((r) => r.prefix === region)?.sub}</span>
          </div>
          <p className="scenario-intro">Illustrative disc deformation</p>
          <div className="control-shortcuts">
            <button
              onClick={() =>
                document
                  .getElementById('compression-control')
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }
            >
              Disc tightness
            </button>
            <span>Scroll this panel for all controls ↓</span>
          </div>
          <Parameter
            label="Herniation size"
            value={selected.bulge}
            onChange={(v) => change('bulge', v)}
            low="None"
            high="Larger"
          />
          <div id="compression-control">
            <Parameter
              label="Disc tightness / compression"
              value={selected.compression}
              max={60}
              unit="%"
              onChange={(v) => change('compression', v)}
              low="Less tight"
              high="More compressed"
            />
          </div>
          <div className="direction-field">
            <label id="direction-label">Herniation direction</label>
            <Select
              value={String(selected.direction)}
              onValueChange={(v) =>
                v !== null && change('direction', Number(v))
              }
            >
              <SelectTrigger aria-labelledby="direction-label">
                <SelectValue>
                  {selected.direction < 0
                    ? 'Left posterolateral'
                    : selected.direction > 0
                      ? 'Right posterolateral'
                      : 'Central / posterior'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-35">Left posterolateral</SelectItem>
                <SelectItem value="0">Central / posterior</SelectItem>
                <SelectItem value="35">Right posterolateral</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Parameter
            label="Angular spread"
            value={selected.spread}
            min={12}
            max={65}
            unit="°"
            onChange={(v) => change('spread', v)}
            low="Focal"
            high="Broad"
          />
          <div className="section-rule" />
          <div className="layer-row">
            <label htmlFor="tissue-section">
              <Layers3 size={16} />
              Disc tissue cutaway
            </label>
            <Switch
              id="tissue-section"
              checked={tissueSection}
              onCheckedChange={(v) => {
                setTissueSection(v);
                if (v) {
                  setFocus(true);
                  setCutaway(true);
                  camera('section');
                }
              }}
            />
          </div>
          {tissueSection && (
            <div className="tissue-key">
              <span>
                <i className="annulus-key" />
                Annulus fibrosus · layered ring
              </span>
              <span>
                <i className="nucleus-key" />
                Nucleus pulposus · gel-like core
              </span>
              <small>Illustrative internal anatomy</small>
            </div>
          )}
          <button
            className="compare-button"
            onClick={() => setMotionTick((t) => t + 1)}
            disabled={selected.bulge === 0 && selected.compression === 0}
          >
            Replay deformation <span>↻</span>
          </button>
          <Parameter
            label="Separate bones"
            value={separation}
            unit="%"
            low="Assembled"
            high="Exploded view"
            onChange={setSeparation}
          />
          <p className="separation-note">
            Moves bones aside to reveal discs and nerves together. Viewing aid
            only.
          </p>
          <div className="layer-row">
            <label htmlFor="cutaway">
              <Scan size={16} />
              Expose disc
            </label>
            <Switch
              id="cutaway"
              checked={cutaway}
              onCheckedChange={(v) => {
                setCutaway(v);
                if (v) {
                  setFocus(true);
                  camera('oblique');
                }
              }}
            />
          </div>
          <button
            className={'compare-button ' + (compare ? 'active' : '')}
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
          >
            <Columns2 size={17} />
            {compare ? 'Exit comparison' : 'Compare with neutral'}
            <span>{compare ? '−' : '+'}</span>
          </button>
          <div className="scenario-reading">
            <div className="eyebrow">WHAT YOU’RE SEEING</div>
            <p>
              {selected.bulge === 0
                ? 'The disc stays within its baseline outline. Nearby neural structures are shown for orientation.'
                : 'A localized part of the disc extends beyond its baseline outline toward nearby neural structures.'}
            </p>
            <span>
              Nerves deflect when the disc surface reaches them. Red marks
              geometric contact, which does not necessarily cause pain. Annulus
              and nucleus move together with damped animation. Bone surfaces
              constrain the disc and redirect tissue along contact surfaces.
              This educational model does not calculate tissue forces, damage,
              or rupture.
            </span>
          </div>
          <button
            className="reset-button"
            onClick={() =>
              setScenarios((p) => ({ ...p, [level]: { ...NEUTRAL_SCENARIO } }))
            }
          >
            <RotateCcw size={14} />
            Reset this disc
          </button>
        </aside>
      </div>
      {about && (
        <section className="about-panel" id="model-notes">
          <div>
            <span className="eyebrow">MODEL NOTES</span>
            <h2>Medical disclaimer</h2>
            <p>
              SpineLab is provided for general education and visualization only.
              It does not provide medical advice, diagnosis, treatment, or a
              professional opinion. Its anatomy, calculations, simulations,
              labels, and outputs may be incomplete, inaccurate, misleading, or
              wrong. They are not clinically validated and do not represent your
              individual anatomy or MRI.
            </p>
            <p>
              Do not rely on this app to assess symptoms, determine the cause or
              severity of pain, choose exercises, decide whether an activity is
              safe, or make healthcare decisions. Consult a qualified healthcare
              professional, and never disregard or delay professional care
              because of this app.
            </p>
            <p>
              SpineLab is provided “as is,” without warranties of accuracy,
              completeness, fitness for a particular purpose, or clinical
              effectiveness. To the extent permitted by applicable law, its
              authors and operators disclaim liability for losses or harm
              arising from use of or reliance on the app. Nothing in this notice
              excludes rights or liabilities that cannot legally be excluded.
            </p>
            <h2>Reference anatomy. Illustrative scenarios.</h2>
            <p>
              Bone and baseline disc surfaces are sourced from BodyParts3D 3.0:
              24 individually shaped vertebrae, the sacrum, and 23 discs from
              C2–C3 through L5–S1. Original mesh surfaces, spacing, and
              curvature are retained at the neutral setting. Neural pathways and
              disc deformations and internal disc layers are illustrative
              reconstructions. The cutaway uses educational colors to
              distinguish annulus and nucleus. This reference body is not your
              MRI.
            </p>
            <p>
              The spinal cord transitions to a bundle of nerve roots in the
              upper lumbar region. Herniation can irritate or compress neural
              structures, but this model does not calculate contact forces,
              inflammation, symptoms, or the effect of an exercise or treatment.
            </p>
            <a
              href="https://www.aans.org/patients/conditions-treatments/herniated-disc/"
              target="_blank"
              rel="noreferrer"
            >
              Herniated discs · AANS <ArrowUpRight size={14} />
            </a>
          </div>
          <button className="quiet-button" onClick={() => setAbout(false)}>
            Close
          </button>
        </section>
      )}
    </main>
  );
}
