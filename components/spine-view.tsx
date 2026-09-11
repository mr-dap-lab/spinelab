'use client';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_BODY } from '@/lib/body-settings.js';
import { springStep } from '@/lib/animation.js';
import { NEUTRAL_SCENARIO } from '@/lib/scenarios.js';
import { LoaderCircle, TriangleAlert } from 'lucide-react';

export type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
};
export type CameraLink = { listeners: Set<(pose: CameraPose) => void> };
export type SceneProps = {
  body?: typeof DEFAULT_BODY;
  onBodyPose?: (patch: Partial<typeof DEFAULT_BODY>) => void;
  cameraLink?: CameraLink;
  level: string;
  scenarios: Record<
    string,
    { rupture: number; bulge: number; compression: number; direction: number; spread: number }
  >;
  layers: {
    bones: boolean;
    discs: boolean;
    nerves: boolean;
    boneOpacity: number;
  };
  separation?: number;
  panMode?: boolean;
  tissueSection?: boolean;
  motionTick?: number;
  focus: boolean;
  cutaway: boolean;
  view: string;
  viewTick: number;
  cameraCommand?: string;
  onSelect: (level: string) => void;
};
export default function SpineView(props: SceneProps) {
  const phaseReadout = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<any>(null),
    latest = useRef(props);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [contactCount, setContactCount] = useState(0);
  const [boneContact, setBoneContact] = useState(false);
  latest.current = props;
  useEffect(() => {
    let disposed = false,
      cleanup = () => {};
    Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
      import('@/lib/spine-model.js'),
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/SSAOPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('@/lib/body-motion.js'),
    ])
      .then(
        async ([
          T,
          { OrbitControls },
          anatomy,
          { EffectComposer },
          { SSAOPass },
          { OutputPass },
          { RenderPass },
          { createBodyMotion, movementPose },
        ]) => {
          const parts = await anatomy.loadAnatomy();
          if (disposed || !host.current) return;
          const container = host.current,
            scene = new T.Scene();
          scene.background = new T.Color(0x343b43);
          const renderer = new T.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          });
          renderer.localClippingEnabled = true;
          renderer.setPixelRatio(
            Math.min(
              devicePixelRatio,
              matchMedia('(max-width: 700px)').matches ? 1.25 : 1.75,
            ),
          );
          renderer.setClearColor(0x000000, 0);
          renderer.outputColorSpace = T.SRGBColorSpace;
          renderer.toneMapping = T.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.05;
          container.appendChild(renderer.domElement);
          renderer.domElement.setAttribute(
            'aria-label',
            'Interactive 3D spine. Use the disc list and camera buttons for keyboard navigation.',
          );
          renderer.domElement.setAttribute('role', 'img');
          const camera = new T.PerspectiveCamera(34, 1, 0.05, 200);
          camera.position.set(21, 7, 39);
          const controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = false;
          controls.screenSpacePanning = true;
          controls.dampingFactor = 0.09;
          controls.minDistance = 0.4;
          controls.maxDistance = 180;
          controls.enablePan = true;
          scene.add(new T.HemisphereLight(0xf4f2ee, 0x555666, 1.65));
          const key = new T.DirectionalLight(0xfff7eb, 2.7);
          key.position.set(-8, 12, 16);
          scene.add(key);
          const rim = new T.DirectionalLight(0xe1e9f5, 1.9);
          rim.position.set(7, 5, -12);
          scene.add(rim);
          const fill = new T.DirectionalLight(0xf0e8dc, 0.65);
          fill.position.set(6, -4, 12);
          scene.add(fill);
          const composer = new EffectComposer(renderer),
            ao = new SSAOPass(scene, camera, 1, 1);
          ao.enabled = !matchMedia('(max-width: 700px)').matches;
          ao.kernelRadius = 0.32;
          ao.minDistance = 0.0002;
          ao.maxDistance = 0.03;
          composer.addPass(new RenderPass(scene, camera));
          composer.addPass(ao);
          composer.addPass(new OutputPass());
          const compass = document.createElement('canvas');
          compass.className = 'atlas-compass';
          compass.width = 180;
          compass.height = 180;
          compass.setAttribute('aria-hidden', 'true');
          container.appendChild(compass);
          const compassContext = compass.getContext('2d');
          function drawCompass() {
            if (!compassContext) return;
            const c = compassContext;
            c.clearRect(0, 0, 180, 180);
            c.font = '22px Arial';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            const inv = camera.quaternion.clone().invert();
            const axes = [
              ['R', 1, 0, 0],
              ['L', -1, 0, 0],
              ['S', 0, 1, 0],
              ['I', 0, -1, 0],
              ['P', 0, 0, 1],
              ['A', 0, 0, -1],
            ];
            const projected = axes
              .map(([label, x, y, z]) => ({
                label,
                vector: new T.Vector3(
                  Number(x),
                  Number(y),
                  Number(z),
                ).applyQuaternion(inv),
              }))
              .sort((a, b) => a.vector.z - b.vector.z);
            for (const a of projected) {
              c.globalAlpha = a.vector.z < 0 ? 0.35 : 1;
              c.strokeStyle = '#b9c5ca';
              c.fillStyle = '#e1e8ec';
              c.beginPath();
              c.moveTo(90, 90);
              c.lineTo(90 + a.vector.x * 46, 90 - a.vector.y * 46);
              c.stroke();
              c.fillText(
                String(a.label),
                90 + a.vector.x * 66,
                90 - a.vector.y * 66,
              );
            }
            c.globalAlpha = 1;
          }
          let bodyRig: any = null, bodyPhase = 0, bodyTime = 0, bodyConfig = latest.current.body || DEFAULT_BODY;
          let lastBodyEnabled = false;
          let model: any = null,
            raf = 0,
            needsRender = true,
            tween: any = null,
            lastFocus: boolean | undefined,
            lastLevel: string | undefined;
          function moveCamera(view: string, instant = false) {
            if (view === 'zoom-in' || view === 'zoom-out') {
              tween = null;
              const offset = camera.position.clone().sub(controls.target);
              offset.setLength(
                T.MathUtils.clamp(
                  offset.length() * (view === 'zoom-in' ? 0.78 : 1.28),
                  controls.minDistance,
                  controls.maxDistance,
                ),
              );
              camera.position.copy(controls.target).add(offset);
              controls.update();
              return;
            }
            const target = model.bounds.getCenter(new T.Vector3()),
              size = model.bounds.getSize(new T.Vector3()),
              distance =
                (Math.max(
                  size.length(),
                  size.length() / Math.max(camera.aspect, 0.25),
                ) /
                  (2 * Math.tan((camera.fov * Math.PI) / 360))) *
                1.25;
            const vectors: Record<string, number[]> = {
              oblique: [1, 0.35, 1.25],
              posterior: [0, 0.02, 1],
              anterior: [0, 0.02, -1],
              side: [1, 0.03, 0],
              axial: [0, 1, 0.0001],
              section: [0, 1.7, -1.2],
            };
            const v = vectors[view] || vectors.oblique;
            const end = new T.Vector3(...(v as [number, number, number]))
              .normalize()
              .multiplyScalar(distance)
              .add(target);
            if (
              instant ||
              matchMedia('(prefers-reduced-motion: reduce)').matches
            ) {
              camera.position.copy(end);
              controls.target.copy(target);
              controls.update();
            } else
              tween = {
                from: camera.position.clone(),
                to: end,
                fromTarget: controls.target.clone(),
                toTarget: target,
                start: performance.now(),
              };
          }
          let desired = latest.current;
          let displayed = structuredClone(desired.scenarios);
          let velocities: Record<string, Record<string, number>> = {};
          let lastMotion = desired.motionTick,
            lastStep = 0;
          function update(next: SceneProps) {
            if (
              !model ||
              next.level !== desired.level ||
              matchMedia('(prefers-reduced-motion: reduce)').matches
            )
              displayed = structuredClone(next.scenarios);
            if (
              next.motionTick !== lastMotion &&
              !matchMedia('(prefers-reduced-motion: reduce)').matches
            ) {
              velocities = {};
              displayed = {
                ...next.scenarios,
                [next.level]: {
                  ...(next.scenarios[next.level] || NEUTRAL_SCENARIO),
                  rupture: 0,
                  bulge: 0,
                  compression: 0,
                },
              };
              lastMotion = next.motionTick;
            }
            desired = next;
            rebuild({ ...next, scenarios: displayed });
          }
          function rebuild(next: SceneProps) {
            needsRender = true;
            if (model) {
              scene.remove(model.group);
              anatomy.disposeModel(model.group);
            }

            bodyRig = null;
            const enabled = latest.current.body?.enabled;
            model = anatomy.buildSpine(enabled ? {...next, focus:false, cutaway:false, tissueSection:false, separation:0} : next, parts);
            if(enabled) {
              bodyRig = createBodyMotion(model, parts);
              model.group.add(bodyRig.group);
              model.bounds.copy(bodyRig.bounds);
              bodyRig.update(latest.current.body, bodyPhase);
            }
            setContactCount(model.contactCount);
            setBoneContact(model.boneContactCount > 0);
            scene.add(model.group);
            if (lastFocus !== next.focus || lastLevel !== next.level || lastBodyEnabled !== !!enabled) {
              lastBodyEnabled = !!enabled;
              moveCamera(next.view, lastFocus === undefined);
              lastFocus = next.focus;
              lastLevel = next.level;
            }
          }
          function resize() {
            needsRender = true;
            const w = container.clientWidth,
              h = container.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h);
            composer.setSize(w, h);
            const previousAspect = camera.aspect;
            camera.aspect = w / h;
            if (model && camera.aspect < previousAspect) {
              camera.position
                .sub(controls.target)
                .multiplyScalar(previousAspect / camera.aspect)
                .add(controls.target);
              controls.update();
            }
            camera.updateProjectionMatrix();
          }
          const observer = new ResizeObserver(resize);
          observer.observe(container);
          resize();
          update(latest.current);
          const ray = new T.Raycaster(),
            pointer = new T.Vector2();
          let down = [0, 0];
          const activePointers = new Set<number>();
          let multiTouch = false;
          let bodyDrag: {id:number;x:number;y:number;config:typeof DEFAULT_BODY} | null = null;
          const onBodyMove = (e: PointerEvent) => {
            if(!bodyDrag || e.pointerId!==bodyDrag.id) return;
            e.stopImmediatePropagation();
            const config=bodyDrag.config, axis=config.drag;
            const value= axis==='hinge' || axis==='flexion' ? (bodyDrag.y-e.clientY)*.25 : (e.clientX-bodyDrag.x)*.25;
            const limits: Record<string,number[]>={hinge:[-20,85],flexion:[-25,45],side:[-30,30],twist:[-45,45]};
            const base=Number(config[axis as keyof typeof config]);
            latest.current.onBodyPose?.({movement:'manual',playing:false,[axis]:T.MathUtils.clamp(base+value,...limits[axis] as [number,number])});
          };
          const onDown = (e: PointerEvent) => {
            activePointers.add(e.pointerId);
            if (activePointers.size === 1) multiTouch = false;
            else multiTouch = true;
            down = [e.clientX, e.clientY];
            tween = null;
            const rect = renderer.domElement.getBoundingClientRect();
            pointer.set(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              (-(e.clientY - rect.top) / rect.height) * 2 + 1,
            );
            scene.updateMatrixWorld(true);
            ray.setFromCamera(pointer, camera);
            if(bodyRig && bodyConfig.drag!=='camera' && ray.intersectObjects(bodyRig.bodyPickables.filter((m:any)=>m.visible),false).length && e.button===0) {
              bodyDrag={id:e.pointerId,x:e.clientX,y:e.clientY,config:{...bodyConfig,...movementPose(bodyConfig,bodyPhase)}};
              controls.enabled=false; renderer.domElement.setPointerCapture(e.pointerId);
              e.stopImmediatePropagation(); renderer.domElement.dataset.dragMode='pose'; return;
            }
            const overAnatomy = ray
              .intersectObject(model.group, true)
              .some((hit) => {
                const mat = (hit.object as any).material;
                return !mat?.clippingPlanes?.some(
                  (plane: any) => plane.distanceToPoint(hit.point) < 0,
                );
              });
            const pan = latest.current.panMode || !overAnatomy;
            controls.mouseButtons.LEFT = pan ? T.MOUSE.PAN : T.MOUSE.ROTATE;
            controls.touches.ONE = pan ? T.TOUCH.PAN : T.TOUCH.ROTATE;
            renderer.domElement.dataset.dragMode = pan ? 'pan' : 'rotate';
          };
          const onUp = (e: PointerEvent) => {
            if(bodyDrag?.id===e.pointerId) {
              bodyDrag=null;controls.enabled=true;activePointers.delete(e.pointerId);
              if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);
              e.stopImmediatePropagation();return;
            }
            activePointers.delete(e.pointerId);
            if (
              multiTouch ||
              latest.current.panMode ||
              e.button !== 0 ||
              Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
            )
              return;
            const rect = renderer.domElement.getBoundingClientRect();
            pointer.set(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              (-(e.clientY - rect.top) / rect.height) * 2 + 1,
            );
            ray.setFromCamera(pointer, camera);
            const hit = ray.intersectObjects(model.pickables)[0];
            if (hit) latest.current.onSelect(hit.object.userData.level);
          };
          let receiving = false;
          const link = latest.current.cameraLink;
          const receive = (pose: CameraPose) => {
            receiving = true;
            tween = null;
            camera.position.fromArray(pose.position);
            controls.target.fromArray(pose.target);
            controls.update();
            receiving = false;
          };
          const publish = () => {
            needsRender = true;
            if (receiving || !link) return;
            const pose: CameraPose = {
              position: camera.position.toArray() as [number, number, number],
              target: controls.target.toArray() as [number, number, number],
            };
            link.listeners.forEach((listener) => {
              if (listener !== receive) listener(pose);
            });
          };
          link?.listeners.add(receive);
          controls.addEventListener('change', publish);
          renderer.domElement.addEventListener('pointerdown', onDown, true);
          const onCancel = (e: PointerEvent) => { activePointers.delete(e.pointerId); bodyDrag=null; controls.enabled=true; };
          renderer.domElement.addEventListener('pointercancel', onCancel);
          renderer.domElement.addEventListener('pointerup', onUp, true);
          renderer.domElement.addEventListener('pointermove', onBodyMove, true);
          function frame() {
            raf = requestAnimationFrame(frame);
            const now = performance.now();
            if(bodyRig && now - bodyTime >= 33) {
              const delta = Math.min(.1,(now-bodyTime)/1000); bodyTime=now;
              if(bodyConfig.playing) bodyPhase=(bodyPhase+delta*bodyConfig.speed*100/6)%100;
              if(bodyRig.update(bodyConfig,bodyPhase)) needsRender=true;
              if(phaseReadout.current)phaseReadout.current.textContent=`Cycle ${Math.round(bodyPhase)}%`;
            }
            if (now - lastStep >= 45) {
              const dt = Math.min(0.1, (now - lastStep) / 1000);
              lastStep = now;
              let changed = false;
              const nextDisplay = { ...displayed };
              for (const level of new Set([
                ...Object.keys(desired.scenarios),
                ...Object.keys(displayed),
              ])) {
                const target = desired.scenarios[level] || NEUTRAL_SCENARIO;
                const current = displayed[level] || NEUTRAL_SCENARIO;
                const next = { ...current };
                const speed = (velocities[level] ||= {});
                for (const key of [
                  'rupture',
                  'bulge',
                  'compression',
                  'direction',
                  'spread',
                ] as const) {
                  if (
                    Math.abs(current[key] - target[key]) > 0.015 ||
                    Math.abs(speed[key] || 0) > 0.05
                  ) {
                    const [value, velocity] = springStep(
                      current[key],
                      speed[key] || 0,
                      target[key],
                      dt,
                    );
                    const bounds =
                      key === 'direction'
                        ? [-60, 60]
                        : key === 'spread'
                          ? [12, 65]
                          : [0, key === 'compression' ? 60 : 100];
                    next[key] = Math.max(bounds[0], Math.min(bounds[1], value));
                    speed[key] = velocity;
                    changed = true;
                  } else {
                    next[key] = target[key];
                    speed[key] = 0;
                    if (next[key] !== current[key]) changed = true;
                  }
                }
                nextDisplay[level] = next;
              }
              if (changed) {
                displayed = nextDisplay;
                rebuild({ ...desired, scenarios: displayed });
              }
            }
            if (tween) {
              const t = Math.min(1, (performance.now() - tween.start) / 650),
                ease = 1 - (1 - t) ** 3;
              camera.position.lerpVectors(tween.from, tween.to, ease);
              controls.target.lerpVectors(
                tween.fromTarget,
                tween.toTarget,
                ease,
              );
              if (t === 1) tween = null;
            }
            const moved = controls.update();
            if (needsRender || moved || tween) {
              composer.render();
              drawCompass();
              needsRender = false;
            }
          }
          frame();
          engine.current = { update, moveCamera, updateBody: () => {
            const next = latest.current.body || DEFAULT_BODY;
            if(next.cycleTick !== bodyConfig.cycleTick || next.phase !== bodyConfig.phase || next.movement !== bodyConfig.movement) bodyPhase = next.phase;
            const toggle = next.enabled !== bodyConfig.enabled;
            bodyConfig = next; bodyTime = performance.now();
            if(toggle) rebuild({...latest.current, scenarios:displayed});
            needsRender = true;
          }};
          setStatus('ready');
          const onLost = (event: Event) => {
            event.preventDefault();
            setStatus('error');
          };
          renderer.domElement.addEventListener('webglcontextlost', onLost);
          cleanup = () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            link?.listeners.delete(receive);
            controls.removeEventListener('change', publish);
            controls.dispose();
            anatomy.disposeModel(model.group);
            ao.dispose();
            composer.dispose();
            renderer.dispose();
            compass.remove();
            renderer.domElement.removeEventListener(
              'pointerdown',
              onDown,
              true,
            );
            renderer.domElement.removeEventListener('pointercancel', onCancel);
            renderer.domElement.removeEventListener('pointerup', onUp, true);
            renderer.domElement.removeEventListener('pointermove', onBodyMove, true);
            renderer.domElement.removeEventListener('webglcontextlost', onLost);
            renderer.domElement.remove();
            engine.current = null;
          };
        },
      )
      .catch((error) => {
        console.error('3D viewer initialization failed', error);
        if (!disposed) setStatus('error');
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  useEffect(() => { engine.current?.updateBody(); }, [props.body]);
  useEffect(() => {
    engine.current?.update(props);
  }, [
    props.level,
    props.scenarios,
    props.layers,
    props.focus,
    props.cutaway,
    props.tissueSection,
    props.motionTick,
    props.separation,
    props.panMode,
  ]);
  useEffect(() => {
    engine.current?.moveCamera(props.cameraCommand || props.view);
  }, [props.view, props.viewTick]);
  return (
    <div className="scene-host" ref={host}>
      {status === 'ready' && (
        <div
          className={'contact-indicator ' + (contactCount ? 'is-contact' : '')}
          role="status"
        >
          <i />
          {!props.layers.nerves
            ? 'Neural structures hidden'
            : contactCount
              ? 'Disc–nerve contact'
              : 'No disc–nerve contact detected'}
          <small>{props.body?.enabled ? 'Contact from the disc scenario · not recalculated by pose' : 'Illustrative contact · not a pain prediction'}</small>
          {props.body?.enabled && <small>Body motion · <span ref={phaseReadout}>Cycle 0%</span></small>}
          {boneContact && (
            <small>Disc constrained by rigid bone surfaces</small>
          )}
        </div>
      )}
      {status !== 'ready' && (
        <div className="scene-status">
          {status === 'loading' ? (
            <>
              <LoaderCircle className="spin" />
              <span>Loading anatomical surfaces</span>
            </>
          ) : (
            <>
              <TriangleAlert />
              <strong>3D rendering is unavailable</strong>
              <span>
                Enable hardware acceleration or try a browser with WebGL 2
                support.
              </span>
              <button onClick={() => location.reload()}>Reload viewer</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
