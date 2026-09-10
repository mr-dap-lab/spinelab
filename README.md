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
