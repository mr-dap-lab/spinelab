'use client';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';

export type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
};
export type CameraLink = { listeners: Set<(pose: CameraPose) => void> };
export type SceneProps = {
  cameraLink?: CameraLink;
  level: string;
  scenarios: Record<
    string,
    { bulge: number; compression: number; direction: number; spread: number }
  >;
  layers: {
    bones: boolean;
    discs: boolean;
    nerves: boolean;
    boneOpacity: number;
  };
  separation?: number;
  panMode?: boolean;
  focus: boolean;
  cutaway: boolean;
  view: string;
  viewTick: number;
  cameraCommand?: string;
  onSelect: (level: string) => void;
};
export default function SpineView(props: SceneProps) {
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<any>(null),
    latest = useRef(props);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [contactCount, setContactCount] = useState(0);
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
          controls.enableDamping = true;
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
          function update(next: SceneProps) {
            needsRender = true;
            if (model) {
              scene.remove(model.group);
              anatomy.disposeModel(model.group);
            }
            controls.mouseButtons.LEFT = next.panMode
              ? T.MOUSE.PAN
              : T.MOUSE.ROTATE;
            controls.touches.ONE = next.panMode ? T.TOUCH.PAN : T.TOUCH.ROTATE;
            model = anatomy.buildSpine(next, parts);
            setContactCount(model.contactCount);
            scene.add(model.group);
            if (lastFocus !== next.focus || lastLevel !== next.level) {
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
          const onDown = (e: PointerEvent) => {
            down = [e.clientX, e.clientY];
            tween = null;
          };
          const onUp = (e: PointerEvent) => {
            if (
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
          renderer.domElement.addEventListener('pointerdown', onDown);
          renderer.domElement.addEventListener('pointerup', onUp);
          function frame() {
            raf = requestAnimationFrame(frame);
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
          engine.current = { update, moveCamera };
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
            renderer.domElement.removeEventListener('pointerdown', onDown);
            renderer.domElement.removeEventListener('pointerup', onUp);
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
  useEffect(() => {
    engine.current?.update(props);
  }, [
    props.level,
    props.scenarios,
    props.layers,
    props.focus,
    props.cutaway,
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
          <small>Illustrative contact · not a pain prediction</small>
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
