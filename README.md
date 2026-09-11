# SpineLab

A browser-based 3D medical-atlas explorer using actual BodyParts3D bone and baseline disc surfaces. Inspect the entire spinal column or a disc segment, adjust illustrative herniation shape and disc height, expose the disc, and compare against a neutral reference.

## View locally

Requires Node.js 24 (Node 22.13+ also satisfies the starter's requirements).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Use **Disc detail** to inspect the selected level. Drag directly on anatomy to rotate. Drag empty canvas to pan vertically or horizontally; scroll/pinch to zoom. Enable **Disc tissue cutaway** to reveal the annulus lamellae and nucleus, and use **Replay deformation** to watch their motion. The camera buttons and level controls are keyboard accessible. WebGL 2 and hardware acceleration are required.

## Deploy on your own server

The self-hosted application is static: no database, account, API key, or Cloudflare runtime is required. Models are served from your own server. No external model CDN is used.

### Docker

```sh
docker compose up --build -d
```

Open http://YOUR-SERVER:8080. Put your existing HTTPS reverse proxy in front of this port for internet deployment. The included Nginx container runs unprivileged. The image build requires network access to npm and container registries.

### Any static web server

```sh
npm ci
npm run build:standalone
```

Serve the contents of `dist-selfhost/` at the website root using Nginx, Caddy, Apache, or another static host. Do not open `index.html` directly with `file://`: the GLB loader requires HTTP. Keep the `anatomy/` directory and attribution files with the build. The complete GLB is approximately 5.4 MB; enable gzip or Brotli for it.

To preview the standalone build locally:

```sh
npm run preview:standalone -- --host 0.0.0.0
```

The normal `npm run build` builds the separate Sites/Cloudflare target. `npm run build:standalone` builds the portable server target from the same application components.

## Anatomy and limitations

- 24 individually modeled vertebrae (C1–L5), sacrum, and 23 discs (C2–C3 through L5–S1).
- Actual neutral bone and disc surfaces from BodyParts3D 3.0. Original relative positioning and curvature are retained at neutral settings; source meshes are polygon-reduced.
- Adjustable herniation uses a geometric deformation of the original disc mesh. It is **not** a validated finite-element or biomechanical model. The size slider is an illustrative 0–100 parameter, not millimeters or pressure.
- Bone contact uses a cached triangle hierarchy, adjacent-endplate envelopes, and sweep-and-slide constraints for blocked columns. Compression spreads tissue outward; superior bone translation is capped by sampled neutral endplate clearance. Bones remain rigid. This is an approximate geometric response, not a finite-element or validated continuum model. Source surface errors, unsampled collisions, and extreme configurations can still produce artifacts.
- Height reduction changes the disc's local thickness and shifts superior bones vertically. It does not simulate posture, loading forces, joint mechanics, exercise, or treatment.
- Neural pathways are explicitly schematic, and not patient-specific. The spinal cord transitions to nerve roots in the upper lumbar region.
- “Separate bones” shifts bones away from the disc/neural assembly without changing collision calculations.
- The selected disc can show 16 reconstructed annulus lamellae and a gel-like nucleus. Their shared deformation field illustrates nucleus migration and annulus thinning, with a critically damped animation. It does not simulate material rupture, extrusion, or calibrated fluid/solid mechanics.
- Neural overlays include packed lumbar root bundles, paired converging roots, distal branches, and spindle-shaped ganglia. These remain schematic, not patient-derived nerve anatomy.
- Nerves respond to posterior disc-surface contact using sampled geometric constraints and a spring-like smoothing solver. Red denotes contact, not pain. Displacement is constrained posteriorly; this is not a 3D tissue-mechanics or force simulation.
- Camera controls include orbit, pan, zoom, anatomical presets, and reframing. Phone layouts keep the viewer visible above scrolling controls.
- “Expose disc” removes the upper vertebra from the close-up; this is a visibility control, not a surgical simulation.
- The viewer does not estimate pain, neurologic impairment, or safe movement. Source anatomy itself can contain modeling errors. It is not your MRI.
- Parameters are temporary browser memory; refresh resets them. No patient data is stored or transmitted by the application.

BodyParts3D: © The Database Center for Life Science. The redistributed meshes and their derivatives retain the source distribution's **CC BY-SA 2.1 Japan** license. See `public/anatomy/ATTRIBUTION.txt`, `sources.json` (original URLs and SHA-256 checksums), and `manifest.json` (mesh IDs). The source meshes were converted to STL by Kevin Mattheus Moerman. SpineLab welds duplicate vertices, changes coordinates uniformly, and packages the surfaces into GLB; it does not invent the neutral vertebral geometry.

The anatomical source files can be rebuilt with `python3 scripts/download-anatomy.py` then `python3 scripts/pack-anatomy.py` (network required only for the download).

## Validation

```sh
npm test
npm run build
npm run build:standalone
```

Geometry tests validate mesh coverage, finite coordinates and triangle indices, source-preserving neutral anatomy, and extreme deformation inputs. They do not establish medical accuracy. Docker runtime testing additionally requires Docker to be installed.

## References

- [BodyParts3D research paper](https://doi.org/10.1093/nar/gkn613)
- [Converted source mesh distribution](https://github.com/Kevin-Mattheus-Moerman/BodyParts3D)
- [BodyParts3D archive and license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)
- [AANS: Herniated Disc](https://www.aans.org/patients/conditions-treatments/herniated-disc/)

- [Intervertebral disc anatomy — NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK470583/)

## Medical disclaimer

SpineLab is educational only and does not provide medical advice, diagnosis, or treatment. Its anatomy and simulations may be incomplete, inaccurate, or wrong. Do not use it for healthcare or exercise-safety decisions. Consult a qualified clinician. The app includes a prominent notice and a fuller disclaimer with an as-is statement and a limitation of liability subject to applicable law. These notices are not a guarantee of legal protection.

### Annulus rupture and nucleus extrusion
The **Annulus rupture / nucleus extrusion** slider drives a prescribed educational sequence: a radial tear progresses through reconstructed lamellae, the edges splay, and an attached blue nucleus lobe advances through the opening. The remaining core contracts slightly to suggest material redistribution. Replay uses the existing damped animation; the extruded mesh participates in nerve contact and rigid-bone constraints. Moving the slider backward resets a scenario and does not depict healing.

The timeline is not a measured damage percentage or a clinically calibrated fracture, fluid, or volume-conserving biomechanical solver. It does not simulate detached fragments, biological resorption, or predict pain. Anatomical background: [AAOS, Herniated Disk](https://orthoinfo.aaos.org/globalassets/pdfs/herniated-disk.pdf).

### Human body and movement layer
Enable **Human body & movement** to see a procedural body silhouette aligned to the entire spine. Opacity ranges from 0–100%. Drag the body in the selected pose mode, use keyboard/touch sliders, or choose hip hinge, squat, cat–cow, lunge, push-up, carry, standing pull, extension, side bend, or trunk rotation. Presets support pause, speed, cycle scrubbing, and reset. Playback starts only when requested. Hiding the layer restores the disc view.

The overlay uses a shared centerline rig with rigid vertebra transforms and interpolated disc/nerve deformation. Standing squat/lunge use two-link leg positioning; the proportions and movement trajectories are illustrative, not motion-capture data. Body motion preserves the disc scenario and carries its contact visualization with the pose. It does not recalculate joint collisions, nerve contact, muscle forces, fracture, balance, or exercise-induced disc pressure. Extreme poses may show intersections.

Total external load is in kilograms. The displayed weight force is mass × 9.81 N/kg; paired standing weights each represent half the total. Amber arrows and a spinal line show a schematic load path. They do not measure internal spinal force, predict injury, or define a safe load. In floor presets the external load is schematic. Internal spinal loading depends on posture, muscle action, and other factors beyond external mass: [Dreischarf et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26873281/).
