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
