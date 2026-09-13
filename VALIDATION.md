# Validation

- Both production targets compile: Sites/Cloudflare and portable static hosting.
- TypeScript type checking passes.
- Contact and geometry tests pass, covering all source parts, every disc at extreme parameter settings, directional deformation, compression displacement, source immutability, input rejection, and expose-disc visibility.
- Original anatomy GLB: 48 surfaces; 443,984 triangles. Source checksums and IDs are distributed with the model.
- Local HTTP preview responds successfully.
- Docker container launch was not verified: the Docker daemon is not running on this machine.
- Browser QA after the rendering fix: visually confirmed sourced anatomy in disc-detail, whole-spine and exposed-disc views; checked runtime logs (no rendering errors).
- WebMCP read/configure tools were executed in the browser: valid deformation values were applied and read back; an out-of-range value was rejected.
- No medical or biomechanical validation is claimed.

Rendering fix: added the missing base RenderPass before SSAO and OutputPass. SSAO blends shadows onto the previously rendered scene; without that base pass, the final canvas was blank even after geometry loaded.

September 10 update: tested contact onset, displacement constraints, neutral release, and invariance under bone separation. The spatial index accelerates exact triangle intersections; it does not approximate disc contours with a bounding box. Browser QA confirmed localized red neural contact and separated bones in a phone viewport. All anatomy-layer controls remain available on mobile.

Tissue update: verified background-drag panning and anatomy-drag rotation in the browser. Added all-level cutaway topology/finite-coordinate tests, frame-rate-independent spring convergence, and nucleus migration with annulus thinning. Internal layers are reconstructed and not medically validated.

Rigid-contact update: restored a prominent disc tightness/compression control and panel navigation; added medical-use and accuracy notices. Tests cover rigid-surface sliding, no tunneling in the box fixture, free motion, unchanged bone vertices, curved endplate contact, neutral release, and finite all-level geometry. Source meshes and the simplified contact approximation are not clinically validated.

Rupture update: regression coverage includes progressive layer opening, extrusion only after the full-depth tear stage, legacy parameter compatibility and invalid input rejection, finite extruded geometry across all 23 disc levels under compression, and neutral reset. The visible extrusion and neural collision mesh use the same generator and rigid-bone constraint. No clinical validation or calibrated fracture/fluid solver is claimed.

Body-motion update: tests cover finite closed preset cycles, separate hip and spinal motion, rigid vertebra size, immutable source geometry, neutral reset, absence of invented mass-driven compression, and a complete sourced spine through squat, cat–cow, lunge, push-up, and rotation. Browser interaction and anatomical realism have not been visually validated for this update. The rig is a kinematic educational overlay, not a validated exercise or internal-load model.

Anatomical-body refinement: replaced the dummy with co-registered FMA7163 skin, checked all neutral skin coordinates against the derived source, and tested articulated regional joint limits, rigid-bone transforms, bounded compression, frame-rate consistency, and reset. Browser checks verified the body surface, transparent spine visibility, inspector tabs, side camera and a cat–cow pose. Corrected multi-layer transparency after visual inspection. The reduced-order joint mechanics and skinning remain unvalidated and may show artifacts at extreme poses.
