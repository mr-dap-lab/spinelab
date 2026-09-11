import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  rigidBone,
  constrainDiscColumn,
  discBoneClearance,
} from './bone-contact.js';
import { buildDiscTissues, deformPoint } from './disc-tissue.js';
import { displaceNerve } from './nerve-contact.js';
import { LEVELS, NEUTRAL_SCENARIO } from './scenarios.js';
export {
  LEVELS,
  DEFAULT_SCENARIO,
  NEUTRAL_SCENARIO,
  validateScenario,
} from './scenarios.js';
let assetPromise;
export function loadAnatomy() {
  if (!assetPromise)
    assetPromise = new GLTFLoader()
      .loadAsync('/anatomy/spine.glb')
      .then((gltf) => {
        return prepareAnatomy(gltf);
      })
      .catch((error) => {
        assetPromise = null;
        throw error;
      });
  return assetPromise;
}
export function prepareAnatomy(gltf) {
  const parts = [];
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const geometry = node.geometry;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.userData.shared = true;
    const box = geometry.boundingBox,
      center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    let slope = 0,
      thickness = size.y;
    if (node.userData.kind === 'disc') {
      const a = geometry.attributes.position;
      let zz = 0,
        zy = 0;
      for (let i = 0; i < a.count; i++) {
        const z = a.getZ(i) - center.z;
        zz += z * z;
        zy += z * (a.getY(i) - center.y);
      }
      slope = zy / zz;
      let low = Infinity,
        high = -Infinity;
      for (let i = 0; i < a.count; i++) {
        const y = a.getY(i) - center.y - slope * (a.getZ(i) - center.z);
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
      thickness = high - low;
    }
    parts.push({ geometry, center, size, slope, thickness, ...node.userData });
  });
  return parts;
}

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.67,
    metalness: 0,
    ...options,
  });
}
function addMesh(group, geometry, mat, shift = 0) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.y = shift;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function deformDisc(part, scenario) {
  const geometry = part.geometry.clone();
  geometry.userData.shared = false;
  const p = geometry.attributes.position,
    colors = [];
  const { center: c, size, slope } = part;
  const dir = (scenario.direction * Math.PI) / 180,
    spread = (scenario.spread * Math.PI) / 180;
  const base = new THREE.Color('#c7a9a1'),
    herniated = new THREE.Color('#c26b60');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - c.x,
      z = p.getZ(i) - c.z,
      y = p.getY(i) - c.y;
    const theta = Math.atan2(x / (size.x / 2), z / (size.z / 2));
    const delta = Math.atan2(Math.sin(theta - dir), Math.cos(theta - dir));
    const radial = Math.min(1, Math.hypot(x / (size.x / 2), z / (size.z / 2)));
    const focal = Math.exp(-0.5 * (delta / spread) ** 2) * radial ** 3;
    const point = deformPoint(
      part,
      scenario,
      new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)),
    );
    p.setXYZ(i, point.x, point.y, point.z);
    const color = base.clone().lerp(herniated, (focal * scenario.bulge) / 100);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
export function buildSpine(
  {
    level,
    scenarios,
    layers,
    focus,
    cutaway,
    separation = 0,
    tissueSection = false,
  },
  parts,
) {
  const group = new THREE.Group(),
    pickables = [],
    discParts = parts
      .filter((p) => p.kind === 'disc')
      .sort((a, b) => a.index - b.index),
    selected = discParts.find((p) => p.label === level),
    selectedIndex = LEVELS.indexOf(level);
  const shrink = discParts.map(
    (p) => (p.thickness * (scenarios[p.label]?.compression || 0)) / 100,
  );
  // Endplates may meet before the requested height reduction is reached.
  // Stop rigid vertebral approach at the available source-anatomy clearance.
  discParts.forEach((part) => {
    if (!shrink[part.index]) return;
    const adjacent = parts
      .filter(
        (p) =>
          p.kind === 'bone' &&
          (p.index === part.index + 1 || p.index === part.index + 2),
      )
      .map((p) => rigidBone(p.geometry));
    const gap = discBoneClearance(part, adjacent);
    shrink[part.index] = Math.min(shrink[part.index], gap * 0.8);
  });
  const shiftAbove = (index) =>
    -shrink.reduce((sum, value, i) => sum + (i >= index ? value : 0), 0);
  const selectedShift =
    shiftAbove(selectedIndex + 1) - shrink[selectedIndex] / 2;
  let boneContactCount = 0;
  const constrainedParts = new Map();
  for (const part of discParts) {
    const scenario = scenarios[part.label] || NEUTRAL_SCENARIO;
    if (
      (focus && part.label !== level) ||
      (!scenario.bulge && !scenario.compression)
    )
      continue;
    const discShift = shiftAbove(part.index + 1) - shrink[part.index] / 2;
    const adjacent = parts
      .filter(
        (p) =>
          p.kind === 'bone' &&
          (p.index === part.index + 1 || p.index === part.index + 2),
      )
      .map((p) => rigidBone(p.geometry, shiftAbove(p.index - 1)));
    const memo = new Map(),
      columns = new Map();
    constrainedParts.set(part.label, {
      ...part,
      constrain: (rest, target) => {
        const key = rest.x + ',' + rest.y + ',' + rest.z;
        if (memo.has(key)) return memo.get(key).clone();
        const a = rest.clone(),
          b = target.clone();
        a.y += discShift;
        b.y += discShift;
        const result = constrainDiscColumn(a, b, adjacent, columns);
        if (result.touched) boneContactCount++;
        result.point.y -= discShift;
        memo.set(key, result.point);
        return result.point.clone();
      },
    });
  }
  const bone = material('#d9cdb6', {
    transparent: layers.boneOpacity < 100,
    opacity: layers.boneOpacity / 100,
    depthWrite: layers.boneOpacity > 95,
  });
  // Subtle material variation; the actual bone contours come from BodyParts3D.
  bone.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 atlasPosition;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\natlasPosition = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 atlasPosition;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat grain=sin(atlasPosition.x*103.0)*sin(atlasPosition.y*117.0)*sin(atlasPosition.z*97.0);\ndiffuseColor.rgb *= 0.97 + grain*0.025;',
      );
  };
  const discMat = material('#ffffff', { vertexColors: true, roughness: 0.55 }),
    neutralDiscMat = material('#c7a9a1', { roughness: 0.55 });
  const collisionMaterial = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
  });
  const neutralColliders = [],
    colliders = [];
  for (const part of discParts) {
    if (focus && part.label !== level) continue;
    const scenario = scenarios[part.label] || NEUTRAL_SCENARIO;
    for (const [list, geometry] of [
      [neutralColliders, part.geometry],
      [
        colliders,
        deformDisc(constrainedParts.get(part.label) || part, scenario),
      ],
    ]) {
      const mesh = new THREE.Mesh(geometry, collisionMaterial);
      mesh.position.y = shiftAbove(part.index + 1) - shrink[part.index] / 2;
      mesh.updateMatrixWorld();
      list.push(mesh);
    }
  }
  const nerveResponses = [];
  function responsiveTube(group, points, radius, kind = 'strand') {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
    );
    const samples = curve.getSpacedPoints(Math.max(64, points.length * 12));
    const response = displaceNerve(
      samples,
      kind === 'root'
        ? (t) => radius * (0.8 + 0.75 * Math.exp(-(((t - 0.56) / 0.15) ** 2)))
        : radius,
      neutralColliders,
      colliders,
    );
    nerveResponses.push(response);
    // Linear segments preserve the sampled collision constraints without spline overshoot.
    const path = new THREE.CurvePath();
    for (let i = 1; i < response.points.length; i++)
      path.add(
        new THREE.LineCurve3(response.points[i - 1], response.points[i]),
      );
    const geometry = new THREE.TubeGeometry(
      path,
      samples.length - 1,
      radius,
      10,
      false,
    );
    const colors = [];
    const gold = new THREE.Color('#e4c386'),
      red = new THREE.Color('#ff3038');
    // TubeGeometry samples by arc length; locate contact on that same path.
    for (let i = 0; i < samples.length; i++) {
      const p = path.getPointAt(i / (samples.length - 1));
      let contact = false;
      for (let j = 0; j < response.points.length; j++)
        if (
          response.contact[j] &&
          p.distanceTo(response.points[j]) < radius * 2 + 0.035
        ) {
          contact = true;
          break;
        }
      const c = contact ? red : gold;
      for (let j = 0; j <= 10; j++) colors.push(c.r, c.g, c.b);
    }
    // A spindle-shaped root ganglion and taper avoid uniform cable silhouettes.
    if (kind === 'root') {
      const a = geometry.attributes.position;
      for (let i = 0; i < samples.length; i++) {
        const t = i / (samples.length - 1),
          center = path.getPointAt(t);
        const scale = 0.8 + 0.75 * Math.exp(-(((t - 0.56) / 0.15) ** 2));
        for (let j = 0; j <= 10; j++) {
          const index = i * 11 + j;
          const v = new THREE.Vector3()
            .fromBufferAttribute(a, index)
            .sub(center)
            .multiplyScalar(scale)
            .add(center);
          a.setXYZ(index, v.x, v.y, v.z);
        }
      }
      geometry.computeVertexNormals();
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // Longitudinal surface fibers follow the already-displaced nerve centerline.
    if (focus && radius >= 0.035) {
      const frames = path.computeFrenetFrames(samples.length - 1, false);
      for (let fiber = 0; fiber < 7; fiber++) {
        const angle = (fiber / 7) * Math.PI * 2;
        const fiberPoints = samples.map((_, i) => {
          const t = i / (samples.length - 1),
            scale =
              kind === 'root'
                ? 0.8 + 0.75 * Math.exp(-(((t - 0.56) / 0.15) ** 2))
                : 1;
          return path
            .getPointAt(t)
            .addScaledVector(
              frames.normals[i],
              Math.cos(angle) * radius * scale * 0.98,
            )
            .addScaledVector(
              frames.binormals[i],
              Math.sin(angle) * radius * scale * 0.98,
            );
        });
        const fiberGeo = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(fiberPoints),
          samples.length - 1,
          0.0025,
          4,
          false,
        );
        addMesh(group, fiberGeo, material('#bb995d', { roughness: 0.62 }));
      }
    }
    addMesh(
      group,
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        vertexColors: true,
        roughness: 0.42,
        clearcoat: 0.18,
      }),
    );
  }
  for (const part of parts) {
    if (part.kind === 'bone') {
      if (!layers.bones) continue;
      if (
        focus &&
        (part.index < selectedIndex + 1 || part.index > selectedIndex + 2)
      )
        continue;
      if (cutaway && part.index === selectedIndex + 1) continue;
      const mesh = addMesh(
        group,
        part.geometry,
        bone,
        shiftAbove(part.index - 1),
      );
      mesh.userData.kind = 'bone';
      // Move bone away from the disc/neural assembly. This is a viewing aid only.
      mesh.position.x += (separation / 100) * 3.5;
      if (focus)
        mesh.position.y +=
          (((part.index === selectedIndex + 1 ? 1 : -1) * separation) / 100) *
          1.3;
    } else if (layers.discs) {
      if (focus && part.label !== level) continue;
      const scenario = scenarios[part.label] || NEUTRAL_SCENARIO,
        geometry =
          scenario.bulge === 0 && scenario.compression === 0
            ? part.geometry
            : deformDisc(constrainedParts.get(part.label) || part, scenario);
      const mesh = addMesh(
        group,
        geometry,
        geometry === part.geometry ? neutralDiscMat : discMat,
        shiftAbove(part.index + 1) - shrink[part.index] / 2,
      );
      mesh.userData.level = part.label;
      pickables.push(mesh);
      if (tissueSection && part.label === level) {
        mesh.material = mesh.material.clone();
        const original = part.geometry.attributes.position;
        const sectionHeights = new Float32Array(original.count);
        for (let i = 0; i < original.count; i++)
          sectionHeights[i] =
            original.getY(i) -
            part.center.y -
            part.slope * (original.getZ(i) - part.center.z);
        if (mesh.geometry.userData.shared) {
          mesh.geometry = mesh.geometry.clone();
          mesh.geometry.userData.shared = false;
        }
        mesh.geometry.setAttribute(
          'sectionHeight',
          new THREE.BufferAttribute(sectionHeights, 1),
        );
        mesh.material.side = THREE.DoubleSide;
        mesh.material.polygonOffset = true;
        mesh.material.polygonOffsetFactor = 2;
        mesh.material.polygonOffsetUnits = 4;
        mesh.material.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              '#include <common>\nattribute float sectionHeight; varying float cutHeight;',
            )
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\ncutHeight=sectionHeight;',
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              '#include <common>\nvarying float cutHeight;',
            )
            .replace(
              '#include <clipping_planes_fragment>',
              '#include <clipping_planes_fragment>\nif(cutHeight>0.0) discard;',
            );
        };
        const tissues = buildDiscTissues(
          constrainedParts.get(part.label) || part,
          scenario,
          mesh.position.y,
        );
        group.add(tissues);
        tissues.traverse((o) => {
          if (o.isMesh) pickables.push(o);
        });
      }
    }
  }
  if (layers.nerves) {
    // These pathways are schematic overlays, not sourced nerve meshes.
    const anchors = discParts.map((p) => [
      p.center.x,
      p.center.y + shiftAbove(p.index + 1) - shrink[p.index] / 2,
      p.center.z + p.size.z * 0.64,
    ]);
    if (!focus) {
      responsiveTube(group, anchors.slice(0, 19), 0.1);
      for (let n = 0; n < 9; n++) {
        const tail = anchors
          .slice(17)
          .map((p, i) => [
            p[0] + (n - 4) * 0.032 * (1 + i * 0.15),
            p[1],
            p[2] + Math.sin(n + i) * 0.015,
          ]);
        responsiveTube(group, tail, 0.017);
      }
    } else {
      const p = anchors[selectedIndex],
        lumbar = level.startsWith('L');
      for (let n = 0; n < (lumbar ? 13 : 1); n++) {
        const x =
          p[0] + (lumbar ? Math.cos(n * 2.399) * Math.sqrt(n / 12) * 0.13 : 0);
        responsiveTube(
          group,
          [
            [
              x,
              p[1] + 1.45,
              p[2] +
                (lumbar ? Math.sin(n * 2.399) * Math.sqrt(n / 12) * 0.09 : 0),
            ],
            [
              x,
              p[1],
              p[2] +
                (lumbar ? Math.sin(n * 2.399) * Math.sqrt(n / 12) * 0.09 : 0),
            ],
            [
              x,
              p[1] - 1.4,
              p[2] +
                (lumbar ? Math.sin(n * 2.399) * Math.sqrt(n / 12) * 0.09 : 0),
            ],
          ],
          lumbar ? 0.021 : 0.105,
        );
      }
    }
    for (let i = 0; i < anchors.length; i++) {
      if (focus && i !== selectedIndex) continue;
      const p = anchors[i],
        w = discParts[i].size.x;
      for (const side of [-1, 1]) {
        responsiveTube(
          group,
          [
            [p[0] + side * 0.055, p[1] + 0.23, p[2]],
            [p[0] + side * w * 0.25, p[1] - 0.02, p[2] + 0.03],
            [p[0] + side * w * 0.48, p[1] - 0.22, p[2] - 0.12],
            [p[0] + side * w * 0.64, p[1] - 0.37, p[2] - 0.3],
          ],
          0.042,
          'root',
        );
        if (focus) {
          // Paired converging roots and a smaller distal branch are schematic.
          responsiveTube(
            group,
            [
              [p[0] + side * 0.055, p[1] - 0.1, p[2]],
              [p[0] + side * w * 0.25, p[1] - 0.19, p[2] + 0.05],
              [p[0] + side * w * 0.46, p[1] - 0.2, p[2] - 0.1],
            ],
            0.022,
          );
          responsiveTube(
            group,
            [
              [p[0] + side * w * 0.48, p[1] - 0.22, p[2] - 0.12],
              [p[0] + side * w * 0.66, p[1] - 0.28, p[2] + 0.12],
              [p[0] + side * w * 0.82, p[1] - 0.38, p[2] + 0.18],
            ],
            0.015,
          );
        }
      }
    }
  }
  colliders.forEach((mesh) => mesh.geometry.dispose());
  collisionMaterial.dispose();
  const contactCount = nerveResponses.reduce(
    (sum, r) => sum + r.contact.filter(Boolean).length,
    0,
  );
  const bounds = new THREE.Box3().setFromObject(group);
  if (bounds.isEmpty())
    bounds.copy(
      new THREE.Box3(
        new THREE.Vector3(-3, -14, -3),
        new THREE.Vector3(3, 14, 3),
      ),
    );
  const target = focus
    ? selected.center.clone().add(new THREE.Vector3(0, selectedShift, 0.25))
    : bounds.getCenter(new THREE.Vector3());
  return {
    group,
    pickables,
    target,
    bounds,
    selected,
    parts,
    contactCount,
    boneContactCount,
    nerveResponses,
  };
}
export function disposeModel(group) {
  const mats = new Set();
  group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material)
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        mats.add(m),
      );
  });
  mats.forEach((m) => m.dispose());
}
