import * as THREE from 'three';

// Shared deformation field keeps the outer surface and reconstructed internal
// tissues registered. Parameters are illustrative, not measured material laws.
export function deformPoint(part, scenario, point) {
  const c = part.center,
    size = part.size;
  const x = point.x - c.x,
    y = point.y - c.y,
    z = point.z - c.z;
  const angle = Math.atan2(x / (size.x / 2), z / (size.z / 2));
  const direction = (scenario.direction * Math.PI) / 180;
  const delta = Math.atan2(
    Math.sin(angle - direction),
    Math.cos(angle - direction),
  );
  const radial = Math.min(1, Math.hypot(x / (size.x / 2), z / (size.z / 2)));
  const focal = Math.exp(
    -0.5 * (delta / ((scenario.spread * Math.PI) / 180)) ** 2,
  );
  const displacement =
    (scenario.bulge / 100) *
    size.z *
    (0.35 * focal * (radial + 0.72 * Math.sin(Math.PI * radial)) +
      0.045 * (1 - radial));
  const expansion = 1 / Math.sqrt(1 - (scenario.compression / 100) * 0.65);
  const result = new THREE.Vector3(
    c.x + x * expansion + Math.sin(direction) * displacement,
    point.y -
      ((y - part.slope * z) * scenario.compression) / 100 +
      part.slope * Math.cos(direction) * displacement,
    c.z + z * expansion + Math.cos(direction) * displacement,
  );
  return part.constrain ? part.constrain(point, result) : result;
}
const profiles = new WeakMap();
function outline(part) {
  if (profiles.has(part.geometry)) return profiles.get(part.geometry);
  const count = 128,
    radii = new Array(count).fill(0),
    p = part.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = (p.getX(i) - part.center.x) / (part.size.x / 2),
      z = (p.getZ(i) - part.center.z) / (part.size.z / 2);
    const a = (Math.atan2(x, z) + Math.PI * 2) % (Math.PI * 2);
    const bin = Math.round((a / (Math.PI * 2)) * count) % count;
    radii[bin] = Math.max(radii[bin], Math.hypot(x, z));
  }
  for (let i = 0; i < count; i++)
    if (!radii[i]) {
      for (let d = 1; d < count; d++)
        if (radii[(i + d) % count]) {
          radii[i] = radii[(i + d) % count];
          break;
        }
    }
  const smoothed = radii.map(
    (r, i) =>
      (r * 2 + radii[(i + 1) % count] + radii[(i + count - 1) % count]) / 4,
  );
  profiles.set(part.geometry, smoothed);
  return smoothed;
}
export function buildDiscTissues(part, scenario, shift) {
  const group = new THREE.Group(),
    profile = outline(part),
    segments = 128;
  function at(radial, i, height = 0.016) {
    const theta = (i / segments) * Math.PI * 2;
    const r = profile[i % segments] * radial;
    const x = ((Math.sin(theta) * part.size.x) / 2) * r,
      z = ((Math.cos(theta) * part.size.z) / 2) * r;
    const p = deformPoint(
      part,
      scenario,
      new THREE.Vector3(
        part.center.x + x,
        part.center.y + part.slope * z + height,
        part.center.z + z,
      ),
    );
    p.y += shift + (part.constrain ? 0.018 : 0);
    return p;
  }
  // Sixteen visible lamellae are an educational reconstruction, not segmentation.
  for (let layer = 0; layer < 16; layer++) {
    const inner = 0.58 + (layer * 0.42) / 16,
      outer = inner + 0.42 / 16 - 0.003;
    const positions = [],
      indices = [];
    for (let i = 0; i <= segments; i++)
      for (const r of [inner, outer]) positions.push(...at(r, i).toArray());
    for (let i = 0; i < segments; i++) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: layer % 2 ? '#9ebfc4' : '#c4dcdb',
        roughness: 0.5,
        side: THREE.DoubleSide,
        clearcoat: 0.15,
      }),
    );
    mesh.userData.tissue = 'annulus';
    group.add(mesh);
    // Fine dark lamellar boundaries follow the same deformation field.
    const curve = new THREE.CatmullRomCurve3(
      Array.from({ length: segments }, (_, i) => at(inner, i, 0.02)),
      true,
    );
    const boundary = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, 0.0035, 4, true),
      new THREE.MeshStandardMaterial({ color: '#587e87', roughness: 0.6 }),
    );
    boundary.userData.tissue = 'annulus';
    group.add(boundary);
  }
  // Gel-like domed nucleus, trimmed to an exposed face at the section plane.
  const positions = [],
    indices = [],
    rings = 20;
  for (let row = 0; row <= rings; row++)
    for (let i = 0; i <= segments; i++) {
      const r = (0.575 * row) / rings;
      const height =
        0.018 +
        Math.sqrt(Math.max(0, 1 - (row / rings) ** 2)) * part.thickness * 0.11;
      positions.push(...at(r, i, height).toArray());
    }
  for (let row = 0; row < rings; row++)
    for (let i = 0; i < segments; i++) {
      const j = row * (segments + 1) + i;
      indices.push(
        j,
        j + 1,
        j + segments + 1,
        j + 1,
        j + segments + 2,
        j + segments + 1,
      );
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const nucleus = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: '#657fac',
      roughness: 0.28,
      clearcoat: 0.65,
      clearcoatRoughness: 0.3,
      side: THREE.DoubleSide,
    }),
  );
  nucleus.material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 tissuePosition;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntissuePosition=position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 tissuePosition;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat tissueVariation=sin(tissuePosition.x*18.0+sin(tissuePosition.z*15.0))*sin(tissuePosition.z*21.0);\ndiffuseColor.rgb*=0.97+0.035*tissueVariation;',
      );
  };
  nucleus.userData.tissue = 'nucleus';
  group.add(nucleus);
  group.userData.level = part.label;
  group.traverse((o) => {
    if (o.isMesh) o.userData.level = part.label;
  });
  return group;
}
