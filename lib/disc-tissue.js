import * as THREE from 'three';

// One user-controlled timeline: inner-to-outer tear, then attached extrusion.
// This is a prescribed deformation, not a fracture or fluid-dynamics solver.
export function ruptureState(scenario) {
  const progress = Math.max(0, Math.min(1, (scenario.rupture || 0) / 100));
  return { depth: Math.min(1, progress / 0.35),
    extrusion: Math.max(0, (progress - 0.35) / 0.65),
    halfWidth: progress * 0.24 };
}
export function tearAt(scenario, angle, radial = 1) {
  const state = ruptureState(scenario), direction = scenario.direction * Math.PI / 180;
  const delta = Math.atan2(Math.sin(angle - direction), Math.cos(angle - direction));
  return state.depth > 0 && radial <= 0.58 + state.depth * 0.42 && Math.abs(delta) < state.halfWidth;
}

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
    let theta = (i / segments) * Math.PI * 2;
    if (radial >= 0.58) {
      const direction = scenario.direction * Math.PI / 180;
      const delta = Math.atan2(Math.sin(theta - direction), Math.cos(theta - direction));
      const state = ruptureState(scenario);
      theta += Math.sign(delta) * state.halfWidth * 0.35 * Math.exp(-Math.abs(delta) * 6) * state.depth;
    }
    const index = ((i % segments) + segments) % segments;
    const fraction = index - Math.floor(index);
    const r = (profile[Math.floor(index)] * (1 - fraction) + profile[(Math.floor(index) + 1) % segments] * fraction) * radial;
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
      if (tearAt(scenario, (i + 0.5) / segments * Math.PI * 2, inner)) continue;
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
    const torn = ruptureState(scenario).depth > 0 && inner <= 0.58 + ruptureState(scenario).depth * 0.42;
    const direction = scenario.direction * Math.PI / 180;
    const gap = torn ? ruptureState(scenario).halfWidth : 0;
    const curve = new THREE.CatmullRomCurve3(
      Array.from({ length: segments + (torn ? 1 : 0) }, (_, i) => {
        const angle = torn ? direction + gap + i / segments * (Math.PI * 2 - 2 * gap) : i / segments * Math.PI * 2;
        return at(inner, ((angle / (Math.PI * 2) * segments) % segments + segments) % segments, 0.02);
      }), !torn,
    );
    const boundary = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, 0.0035, 4, !torn),
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
      const r = (0.575 * row) / rings * (1 - ruptureState(scenario).extrusion * 0.10);
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

// Closed, attached gel tongue with a narrow neck and rounded external lobe.
// Every vertex shares the existing rigid-bone constraint; the resulting mesh is
// also used by neural contact so visible material and nerve displacement agree.
export function buildNucleusExtrusion(part, scenario) {
  const { extrusion } = ruptureState(scenario);
  if (extrusion <= 0) return null;
  const direction = scenario.direction * Math.PI / 180;
  const profile = outline(part);
  const index = ((direction / (Math.PI * 2) * profile.length) % profile.length + profile.length) % profile.length;
  const radius = profile[Math.floor(index)];
  const axis = new THREE.Vector3(Math.sin(direction) * part.size.x / 2 * radius, 0, Math.cos(direction) * part.size.z / 2 * radius);
  const tangent = new THREE.Vector3(Math.cos(direction), 0, -Math.sin(direction));
  const positions = [], indices = [], rows = 48, sides = 24;
  const end = 0.58 + extrusion * 0.95;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, radial = 0.43 + t * (end - 0.43);
    const envelope = Math.sin(Math.PI * t) ** 0.65;
    const lobe = 0.55 + 0.85 * Math.exp(-(((t - 0.80) / 0.18) ** 2));
    const width = Math.min(part.size.x, part.size.z) * 0.075 * Math.sqrt(extrusion) * envelope * lobe;
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const rest = new THREE.Vector3(part.center.x + axis.x * radial, part.center.y + part.slope * axis.z * radial, part.center.z + axis.z * radial);
      rest.addScaledVector(tangent, Math.cos(angle) * width);
      rest.y += Math.sin(angle) * Math.min(width, part.thickness * 0.22);
      const point = deformPoint(part, scenario, rest);
      positions.push(...point.toArray());
    }
  }
  for (let row = 0; row < rows; row++) for (let j = 0; j < sides; j++) {
    const a = row * (sides + 1) + j, b = a + sides + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}
