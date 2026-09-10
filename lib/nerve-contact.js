import * as THREE from 'three';

// Quasistatic geometric constraint, not a calibrated tissue-mechanics model.
export function relaxDisplacement(required) {
  const d = required.slice();
  for (let iteration = 0; iteration < 80; iteration++) {
    for (let i = 0; i < d.length; i++) {
      const neighbors = (d[i - 1] || 0) + (d[i + 1] || 0);
      d[i] = Math.max(required[i], neighbors / 2.12);
    }
  }
  return d;
}

const surfaceCache = new WeakMap();
function surfaceIndex(geometry) {
  if (surfaceCache.has(geometry)) return surfaceCache.get(geometry);
  const box = geometry.boundingBox,
    n = 48,
    bins = Array.from({ length: n * n }, () => []);
  const positions = geometry.attributes.position,
    indices = geometry.index;
  const cellX = (x) =>
    Math.max(
      0,
      Math.min(
        n - 1,
        Math.floor(((x - box.min.x) / (box.max.x - box.min.x)) * n),
      ),
    );
  const cellY = (y) =>
    Math.max(
      0,
      Math.min(
        n - 1,
        Math.floor(((y - box.min.y) / (box.max.y - box.min.y)) * n),
      ),
    );
  for (let i = 0; i < (indices ? indices.count : positions.count); i += 3) {
    const v = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(
        positions,
        indices ? indices.getX(i + j) : i + j,
      ),
    );
    const denominator =
      (v[1].y - v[2].y) * (v[0].x - v[2].x) +
      (v[2].x - v[1].x) * (v[0].y - v[2].y);
    if (Math.abs(denominator) < 1e-12) continue;
    const triangle = { v, denominator };
    for (
      let y = cellY(Math.min(...v.map((p) => p.y)));
      y <= cellY(Math.max(...v.map((p) => p.y)));
      y++
    )
      for (
        let x = cellX(Math.min(...v.map((p) => p.x)));
        x <= cellX(Math.max(...v.map((p) => p.x)));
        x++
      )
        bins[y * n + x].push(triangle);
  }
  const index = { box, n, bins, cellX, cellY };
  surfaceCache.set(geometry, index);
  return index;
}
export function posteriorSurface(meshes, point, radius) {
  let surface = -Infinity;
  // Exact vertical triangle intersections, accelerated by an XY spatial index.
  for (const mesh of meshes) {
    const { box, n, bins, cellX, cellY } = surfaceIndex(mesh.geometry);
    for (const [dx, dy] of [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ]) {
      const x = point.x + dx,
        y = point.y + dy - mesh.position.y;
      if (x < box.min.x || x > box.max.x || y < box.min.y || y > box.max.y)
        continue;
      for (const { v, denominator } of bins[cellY(y) * n + cellX(x)]) {
        const a =
          ((v[1].y - v[2].y) * (x - v[2].x) +
            (v[2].x - v[1].x) * (y - v[2].y)) /
          denominator;
        const b =
          ((v[2].y - v[0].y) * (x - v[2].x) +
            (v[0].x - v[2].x) * (y - v[2].y)) /
          denominator;
        const c = 1 - a - b;
        if (a >= -1e-7 && b >= -1e-7 && c >= -1e-7)
          surface = Math.max(surface, a * v[0].z + b * v[1].z + c * v[2].z);
      }
    }
  }
  return surface;
}

export function displaceNerve(points, radius, neutral, deformed) {
  const rest = points.map((p) => p.clone());
  const radii = points.map((_, i) =>
    typeof radius === 'function' ? radius(i / (points.length - 1)) : radius,
  );
  rest.forEach((p, i) => {
    p.z = Math.max(
      p.z,
      posteriorSurface(neutral, p, radii[i]) + radii[i] + 0.025,
    );
  });
  const required = rest.map((p, i) =>
    Math.max(0, posteriorSurface(deformed, p, radii[i]) + radii[i] - p.z),
  );
  const displacement = relaxDisplacement(required);
  const contact = required.map(
    (r, i) => r > 0.002 && displacement[i] - r < 0.008,
  );
  return {
    rest,
    required,
    displacement,
    contact,
    points: rest.map((p, i) =>
      p.clone().add(new THREE.Vector3(0, 0, displacement[i])),
    ),
  };
}
