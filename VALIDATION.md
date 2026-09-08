# Validation

- Both production targets compile: Sites/Cloudflare and portable static hosting.
- TypeScript type checking passes.
- Eight geometry tests pass, covering all source parts, every disc at extreme parameter settings, directional deformation, compression displacement, source immutability, input rejection, and expose-disc visibility.
- Original anatomy GLB: 48 surfaces; 443,984 triangles. Source checksums and IDs are distributed with the model.
- Local HTTP preview responds successfully.
- Docker container launch was not verified: the Docker daemon is not running on this machine.
- Browser QA after the rendering fix: visually confirmed sourced anatomy in disc-detail, whole-spine and exposed-disc views; checked runtime logs (no rendering errors).
- WebMCP read/configure tools were executed in the browser: valid deformation values were applied and read back; an out-of-range value was rejected.
- No medical or biomechanical validation is claimed.

Rendering fix: added the missing base RenderPass before SSAO and OutputPass. SSAO blends shadows onto the previously rendered scene; without that base pass, the final canvas was blank even after geometry loaded.
