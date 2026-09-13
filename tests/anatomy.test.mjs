import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  prepareAnatomy,
  buildSpine,
  disposeModel,
} from '../lib/spine-model.js';
import {
  LEVELS,
  NEUTRAL_SCENARIO,
  validateScenario,
} from '../lib/scenarios.js';
const file = await readFile(
  new URL('../public/anatomy/spine.glb', import.meta.url),
);
const gltf = await new GLTFLoader().parseAsync(
  file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  '',
);
const parts = prepareAnatomy(gltf);
const layers = { bones: true, discs: true, nerves: true, boneOpacity: 100 };
function scene(level, scenarios = {}, extra = {}) {
  return buildSpine(
    { level, scenarios, layers, focus: true, cutaway: false, ...extra },
    parts,
  );
}
function finiteModel(model) {
  model.group.traverse((o) => {
    if (!o.geometry) return;
    const g = o.geometry,
      p = g.attributes.position;
    for (const value of p.array) assert.ok(Number.isFinite(value));
    if (g.index)
      for (const i of g.index.array) assert.ok(i >= 0 && i < p.count);
  });
  assert.ok(Number.isFinite(model.target.y));
}
test('all 24 distinct vertebrae, sacrum and all 23 discs exist with valid topology', () => {
  assert.equal(parts.filter((p) => p.kind === 'bone').length, 25);
  assert.deepEqual(
    parts.filter((p) => p.kind === 'disc').map((p) => p.label),
    LEVELS,
  );
  assert.equal(new Set(parts.map((p) => p.fma)).size, 48);
  const m = scene('L4–L5', {}, { focus: false });
  assert.equal(m.pickables.length, 23);
  finiteModel(m);
  disposeModel(m.group);
});
test('neutral bones and discs preserve the source positions exactly', () => {
  const m = scene('C5–C6');
  for (const mesh of m.group.children.filter(
    (c) => c.isMesh && c.geometry.userData.shared,
  )) {
    assert.ok(mesh.position.y === 0);
    assert.ok(parts.some((p) => p.geometry === mesh.geometry));
  }
  const neutralDisc = m.pickables[0];
  assert.equal(
    neutralDisc.geometry,
    parts.find((p) => p.label === 'C5–C6').geometry,
  );
  disposeModel(m.group);
});
test('extreme deformations remain finite for every disc, with camera targets inside the anatomy', () => {
  for (const level of LEVELS) {
    const m = scene(level, {
      [level]: { bulge: 100, compression: 60, direction: -60, spread: 12 },
    });
    finiteModel(m);
    assert.equal(m.pickables.length, 1);
    assert.ok(m.bounds.containsPoint(m.target));
    disposeModel(m.group);
  }
});
test('herniation direction moves the posterior surface toward the selected side', () => {
  for (const direction of [-35, 35]) {
    const m = scene('L4–L5', {
      'L4–L5': { ...NEUTRAL_SCENARIO, bulge: 100, direction },
    });
    const orig = parts.find((p) => p.label === 'L4–L5').geometry.attributes
        .position,
      mod = m.pickables[0].geometry.attributes.position;
    let dx = 0,
      dz = 0;
    for (let i = 0; i < orig.count; i++) {
      dx += mod.getX(i) - orig.getX(i);
      dz += mod.getZ(i) - orig.getZ(i);
    }
    assert.ok(dz > 0);
    assert.equal(Math.sign(dx), Math.sign(direction));
    disposeModel(m.group);
  }
});
test('compression moves superior bones while preserving the inferior vertebra', () => {
  const m = scene('L4–L5', {
    'L4–L5': { ...NEUTRAL_SCENARIO, compression: 50 },
  });
  const bones = m.group.children.filter((c) => c.geometry?.userData.shared);
  assert.ok(bones.some((b) => b.position.y < 0));
  assert.ok(bones.some((b) => b.position.y === 0));
  disposeModel(m.group);
});
test('source meshes are not mutated by deforming or disposing a scenario', () => {
  const p = parts.find((p) => p.label === 'L4–L5'),
    before = Array.from(p.geometry.attributes.position.array);
  const m = scene('L4–L5', {
    'L4–L5': { bulge: 100, compression: 60, direction: 35, spread: 65 },
  });
  disposeModel(m.group);
  assert.deepEqual(Array.from(p.geometry.attributes.position.array), before);
});
test('input validation rejects missing, infinite and out-of-range values', () => {
  assert.equal(validateScenario(null), null);
  assert.equal(validateScenario({}), null);
  for (const value of [NaN, Infinity, -1, 101])
    assert.equal(validateScenario({ ...NEUTRAL_SCENARIO, bulge: value }), null);
  assert.equal(
    validateScenario({ ...NEUTRAL_SCENARIO, compression: 61 }),
    null,
  );
  assert.deepEqual(validateScenario(NEUTRAL_SCENARIO), NEUTRAL_SCENARIO);
});
test('expose-disc removes the upper bone without changing the source disc', () => {
  const normal = scene('L4–L5'),
    exposed = scene('L4–L5', {}, { cutaway: true });
  assert.equal(normal.group.children.length - exposed.group.children.length, 1);
  assert.equal(normal.pickables[0].geometry, exposed.pickables[0].geometry);
  disposeModel(normal.group);
  disposeModel(exposed.group);
});

test('neutral nerves have no contact; a broad posterior herniation pushes and highlights them', () => {
  const neutral = scene('L4–L5');
  assert.equal(neutral.contactCount, 0);
  const scenario = {
    'L4–L5': { ...NEUTRAL_SCENARIO, bulge: 100, spread: 65, direction: 0 },
  };
  const pushed = scene('L4–L5', scenario);
  assert.ok(pushed.contactCount > 0);
  assert.ok(
    pushed.nerveResponses.some((r) => Math.max(...r.displacement) > 0.03),
  );
  for (const r of pushed.nerveResponses)
    for (let i = 0; i < r.required.length; i++)
      assert.ok(r.displacement[i] >= r.required[i]);
  const separated = scene('L4–L5', scenario, { separation: 100 });
  assert.equal(separated.contactCount, pushed.contactCount);
  assert.deepEqual(separated.nerveResponses, pushed.nerveResponses);
  assert.ok(
    separated.group.children.some(
      (m) => m.userData.kind === 'bone' && m.position.x === 3.5,
    ),
  );
  const restored = scene('L4–L5');
  assert.equal(restored.contactCount, 0);
  assert.ok(
    restored.nerveResponses.every((r) => r.displacement.every((d) => d === 0)),
  );
  for (const m of [neutral, pushed, separated, restored]) disposeModel(m.group);
});

test('disc cutaway has nested lamellae and a distinct nucleus at all levels', () => {
  for (const level of LEVELS) {
    const m = scene(
      level,
      {
        [level]: {
          ...NEUTRAL_SCENARIO,
          bulge: 100,
          compression: 60,
          direction: 35,
          spread: 65,
        },
      },
      { tissueSection: true, cutaway: true },
    );
    const tissues = [];
    m.group.traverse((o) => {
      if (o.userData.tissue) tissues.push(o);
    });
    assert.equal(
      tissues.filter((o) => o.userData.tissue === 'nucleus').length,
      1,
    );
    assert.equal(
      tissues.filter((o) => o.userData.tissue === 'annulus').length,
      32,
    );
    finiteModel(m);
    disposeModel(m.group);
  }
});

test('damped tissue motion converges consistently across frame rates', async () => {
  const { springStep } = await import('../lib/animation.js');
  const simulate = (dt) => {
    let x = 0,
      v = 0;
    for (let t = 0; t < 2 - dt / 2; t += dt) {
      [x, v] = springStep(x, v, 100, dt);
      assert.ok(x >= 0 && x <= 100);
    }
    return x;
  };
  assert.ok(Math.abs(simulate(1 / 60) - simulate(1 / 20)) < 0.001);
  assert.ok(Math.abs(simulate(1 / 20) - 100) < 0.001);
});

test('posterior nucleus migration stretches and thins the annulus without crossing its exterior', async () => {
  const { deformPoint } = await import('../lib/disc-tissue.js');
  const { Vector3 } = await import('three');
  const p = parts.find((p) => p.label === 'L4–L5');
  const inner = p.center
    .clone()
    .add(new Vector3(0, p.slope * p.size.z * 0.29, p.size.z * 0.29));
  const outer = p.center
    .clone()
    .add(new Vector3(0, p.slope * p.size.z * 0.5, p.size.z * 0.5));
  const scenario = {
    ...NEUTRAL_SCENARIO,
    bulge: 100,
    direction: 0,
    spread: 65,
  };
  const core = deformPoint(p, scenario, inner),
    shell = deformPoint(p, scenario, outer);
  assert.ok(core.z > inner.z);
  assert.ok(shell.z - core.z > 0);
  assert.ok(shell.z - core.z < outer.z - inner.z);
});

test('rigid bone contact blocks penetration and retains sliding along the surface', async () => {
  const { BoxGeometry, Vector3 } = await import('three');
  const { rigidBone, constrainToBones, insideBone } =
    await import('../lib/bone-contact.js');
  const geometry = new BoxGeometry(2, 2, 2),
    before = Array.from(geometry.attributes.position.array),
    bone = rigidBone(geometry);
  assert.equal(insideBone(bone, new Vector3()), true);
  assert.equal(insideBone(bone, new Vector3(0, 2, 0)), false);
  const contact = constrainToBones(
    new Vector3(0, 2, 0),
    new Vector3(0.7, 0, 0),
    [bone],
  );
  assert.equal(contact.touched, true);
  assert.ok(contact.point.y >= 1);
  assert.ok(contact.point.x > 0.65);
  assert.equal(insideBone(bone, contact.point), false);
  const free = constrainToBones(
    new Vector3(0, 2, 0),
    new Vector3(0.7, 1.5, 0),
    [bone],
  );
  assert.equal(free.touched, false);
  assert.deepEqual(free.point.toArray(), [0.7, 1.5, 0]);
  const crossing = constrainToBones(
    new Vector3(0, 2, 0),
    new Vector3(0, -2, 0),
    [bone],
  );
  assert.ok(
    crossing.point.y >= 1,
    'A large step must not tunnel through the bone',
  );
  assert.deepEqual(Array.from(geometry.attributes.position.array), before);
  geometry.dispose();
});

test('disc columns follow curved rigid endplates while preserving an open gap', async () => {
  const { SphereGeometry, Vector3 } = await import('three');
  const { rigidBone, constrainDiscColumn, insideBone } =
    await import('../lib/bone-contact.js');
  const geometry = new SphereGeometry(1, 32, 24),
    upper = rigidBone(geometry, 2),
    lower = rigidBone(geometry, -2);
  const a = constrainDiscColumn(new Vector3(), new Vector3(0, 1.8, 0), [
    upper,
    lower,
  ]);
  const b = constrainDiscColumn(
    new Vector3(0.5, 0, 0),
    new Vector3(0.5, 1.8, 0),
    [upper, lower],
  );
  assert.ok(a.touched && b.touched);
  assert.ok(
    b.point.y > a.point.y + 0.08,
    'Contact follows the curved bone surface',
  );
  for (const point of [a.point, b.point])
    assert.ok(!insideBone(upper, point) && !insideBone(lower, point));
  geometry.dispose();
});

test('rupture progression opens layers before extrusion and validates legacy scenarios', async () => {
  const { ruptureState, tearAt, buildNucleusExtrusion } = await import('../lib/disc-tissue.js');
  assert.equal(validateScenario({ ...NEUTRAL_SCENARIO, rupture: NaN }), null);
  assert.equal(validateScenario({ ...NEUTRAL_SCENARIO, rupture: 101 }), null);
  const { rupture, ...legacy } = NEUTRAL_SCENARIO;
  assert.equal(validateScenario(legacy).rupture, 0);
  const early = { ...NEUTRAL_SCENARIO, direction: 0, rupture: 15 };
  assert.ok(tearAt(early, 0, 0.6));
  assert.equal(tearAt(early, 0, 0.98), false);
  assert.equal(ruptureState(early).extrusion, 0);
  for (const part of parts.filter(p => p.kind === 'disc')) {
    assert.equal(buildNucleusExtrusion(part, early), null);
  }
  const part = parts.find(p => p.kind === 'disc');
  const small = buildNucleusExtrusion(part, { ...early, rupture: 60 });
  const large = buildNucleusExtrusion(part, { ...early, rupture: 100 });
  small.computeBoundingBox(); large.computeBoundingBox();
  assert.ok(large.boundingBox.max.z > small.boundingBox.max.z, 'Extruded material advances outward');
  small.dispose(); large.dispose();
  assert.ok(tearAt({ ...early, rupture: 100 }, 0, 1));
  assert.equal(tearAt({ ...early, rupture: 100 }, Math.PI, 1), false);
});

test('extruded nucleus appears at all levels, grows outward and resets cleanly', () => {
  for (const level of LEVELS) {
    const model = scene(level, { [level]: { ...NEUTRAL_SCENARIO, rupture: 100, compression: 60, bulge: 70 } }, { tissueSection: true });
    finiteModel(model);
    const meshes = [];
    model.group.traverse(o => { if (o.userData.tissue === 'extruded-nucleus') meshes.push(o); });
    assert.equal(meshes.length, 1, level);
    assert.ok(meshes[0].geometry.index.count > 0);
    disposeModel(model.group);
  }
  const neutral = scene('L4–L5');
  neutral.group.traverse(o => assert.notEqual(o.userData.tissue, 'extruded-nucleus'));
  disposeModel(neutral.group);
});

test('extrusion alone displaces nerves without a bulge parameter', () => {
  const model = scene('L4–L5', { 'L4–L5': { ...NEUTRAL_SCENARIO, rupture: 100, direction: 0 } });
  assert.ok(model.contactCount > 0);
  assert.ok(model.nerveResponses.some(r => Math.max(...r.displacement) > 0.01));
  disposeModel(model.group);
});

test('full sourced spine remains finite during body motion and returns to its neutral pose', async () => {
  const { createBodyMotion, DEFAULT_BODY } = await import('../lib/body-motion.js');
  const model = scene('L4–L5', {}, { focus: false });
  const bytes = await readFile(new URL('../public/anatomy/body.glb', import.meta.url));
  const skinAsset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  let skin; skinAsset.scene.traverse(o=>{if(o.isMesh)skin=o.geometry;});
  skin.computeVertexNormals();skin.computeBoundingBox();
  const rig = createBodyMotion(model, parts, skin);
  model.group.add(rig.group);
  for (const movement of ['squat', 'catcow', 'lunge', 'push', 'rotate']) {
    rig.update({ ...DEFAULT_BODY, enabled: true, movement }, 40);
    finiteModel(model);
  }
  rig.update({ ...DEFAULT_BODY, enabled: true }, 0);
  const surface=rig.bodyPickables[0].geometry.attributes.position;
  const original=skin.attributes.position;
  for(let i=0;i<surface.array.length;i++)assert.ok(Math.abs(surface.array[i]-original.array[i])<1e-4,'Neutral skin retains source registration and proportions');
  const bone = model.group.children.find(o => o.userData.kind === 'bone');
  assert.ok(bone.quaternion.angleTo(new (await import('three')).Quaternion()) < 1e-7);
  disposeModel(model.group);
});
