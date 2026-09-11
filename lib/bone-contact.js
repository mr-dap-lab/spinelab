import * as THREE from 'three';

// Cached triangle BVH for rigid source bone surfaces. No bone vertices are moved.
const cache = new WeakMap();
function treeFor(geometry) {
  if (cache.has(geometry)) return cache.get(geometry);
  const p = geometry.attributes.position,
    index = geometry.index,
    triangles = [];
  for (let i = 0; i < (index ? index.count : p.count); i += 3) {
    const v = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(
        p,
        index ? index.getX(i + j) : i + j,
      ),
    );
    const triangle = new THREE.Triangle(...v),
      box = new THREE.Box3().setFromPoints(v);
    triangles.push({
      triangle,
      box,
      center: box.getCenter(new THREE.Vector3()),
    });
  }
  function build(items) {
    const box = new THREE.Box3();
    items.forEach((t) => box.union(t.box));
    if (items.length <= 12) return { box, items };
    const size = box.getSize(new THREE.Vector3()),
      axis =
        size.x > size.y
          ? size.x > size.z
            ? 'x'
            : 'z'
          : size.y > size.z
            ? 'y'
            : 'z';
    items.sort((a, b) => a.center[axis] - b.center[axis]);
    const mid = items.length >> 1;
    return {
      box,
      left: build(items.slice(0, mid)),
      right: build(items.slice(mid)),
    };
  }
  const tree = build(triangles);
  cache.set(geometry, tree);
  return tree;
}
function firstHit(tree, ray, maxDistance = Infinity) {
  let best = null,
    limit = maxDistance;
  const scratch = new THREE.Vector3();
  function visit(node) {
    if (!ray.intersectBox(node.box, scratch)) return;
    if (
      !node.box.containsPoint(ray.origin) &&
      scratch.distanceTo(ray.origin) > limit
    )
      return;
    if (node.items)
      for (const item of node.items) {
        const t = item.triangle;
        if (ray.intersectTriangle(t.a, t.b, t.c, false, scratch)) {
          const distance = scratch.distanceTo(ray.origin);
          if (distance <= limit) {
            limit = distance;
            best = {
              distance,
              point: scratch.clone(),
              normal: t.getNormal(new THREE.Vector3()),
            };
          }
        }
      }
    else {
      const near =
        node.left.box.distanceToPoint(ray.origin) <
        node.right.box.distanceToPoint(ray.origin);
      visit(near ? node.left : node.right);
      visit(near ? node.right : node.left);
    }
  }
  visit(tree);
  return best;
}
function isInside(tree, point) {
  if (!tree.box.containsPoint(point)) return false;
  // For consistently oriented closed source surfaces the first exit faces outward.
  const direction = new THREE.Vector3(1, 0.137, 0.071).normalize();
  const hit = firstHit(tree, new THREE.Ray(point, direction));
  return !!hit && hit.normal.dot(direction) > 0;
}
function closest(tree, point) {
  let distance = Infinity,
    result = null;
  const p = new THREE.Vector3();
  function visit(node) {
    if (node.box.distanceToPoint(point) > distance) return;
    if (node.items)
      for (const item of node.items) {
        item.triangle.closestPointToPoint(point, p);
        const d = p.distanceTo(point);
        if (d < distance) {
          distance = d;
          result = {
            point: p.clone(),
            normal: item.triangle.getNormal(new THREE.Vector3()),
            distance: d,
          };
        }
      }
    else {
      const near =
        node.left.box.distanceToPoint(point) <
        node.right.box.distanceToPoint(point);
      visit(near ? node.left : node.right);
      visit(near ? node.right : node.left);
    }
  }
  visit(tree);
  return result;
}
export function rigidBone(geometry, shift = 0) {
  return { tree: treeFor(geometry), shift };
}
export function insideBone(bone, point) {
  return isInside(
    bone.tree,
    point.clone().add(new THREE.Vector3(0, -bone.shift, 0)),
  );
}
export function constrainToBones(rest, target, bones, clearance = 0.003) {
  let position = rest.clone(),
    destination = target.clone(),
    touched = false;
  // Resolve a moving endplate overtaking the starting point before sweeping.
  for (const bone of bones) {
    const local = position.clone();
    local.y -= bone.shift;
    if (isInside(bone.tree, local)) {
      const near = closest(bone.tree, local);
      if (near) {
        const outward = near.point.clone().sub(local).normalize();
        position.copy(near.point).addScaledVector(outward, clearance);
        position.y += bone.shift;
        touched = true;
      }
    }
  }
  for (let iteration = 0; iteration < 5; iteration++) {
    const delta = destination.clone().sub(position),
      length = delta.length();
    if (length < 1e-6) break;
    const direction = delta.clone().divideScalar(length);
    let first = null;
    for (const bone of bones) {
      const local = position.clone();
      local.y -= bone.shift;
      const hit = firstHit(bone.tree, new THREE.Ray(local, direction), length);
      if (hit && (!first || hit.distance < first.distance))
        first = { ...hit, shift: bone.shift };
    }
    if (!first) {
      position.copy(destination);
      break;
    }
    touched = true;
    const normal = first.normal;
    if (normal.dot(direction) > 0) normal.negate();
    const surface = first.point.clone();
    surface.y += first.shift;
    const remaining = destination.clone().sub(surface);
    // Remove the blocked normal motion, retain tangential motion along the bone.
    remaining.addScaledVector(normal, -Math.min(0, remaining.dot(normal)));
    position.copy(surface).addScaledVector(normal, clearance);
    destination.copy(position).add(remaining);
  }
  // Numerical safeguard for concave corners and intersecting source surfaces.
  for (const bone of bones) {
    const local = position.clone();
    local.y -= bone.shift;
    if (isInside(bone.tree, local)) {
      const near = closest(bone.tree, local);
      if (near) {
        position
          .copy(near.point)
          .addScaledVector(
            near.point.clone().sub(local).normalize(),
            clearance,
          );
        position.y += bone.shift;
        touched = true;
      }
    }
  }
  return { point: position, touched };
}

// A tiny off-axis probe avoids degenerate pole/seam triangles and parallel
// ray/box boundary ambiguity. The offset is far below the surface clearance.
function endplateHit(bone, x, z, upward) {
  const tree = bone.tree;
  const epsilon = Math.max(tree.box.max.x - tree.box.min.x, 1) * 1e-7;
  return firstHit(tree, new THREE.Ray(
    new THREE.Vector3(x + epsilon, upward ? tree.box.min.y - 1 : tree.box.max.y + 1, z + epsilon * 0.731),
    new THREE.Vector3(0, upward ? 1 : -1, 0),
  ));
}

// Adjacent endplates bound a continuous disc column. This avoids sending nearby
// tissue vertices to opposite sides of a bone, as nearest-surface projection can.
export function constrainDiscColumn(
  rest,
  target,
  bones,
  columns = new Map(),
  clearance = 0.006,
) {
  const key = target.x + ',' + target.z;
  let bounds = columns.get(key);
  if (!bounds) {
    const upper = bones[0],
      lower = bones[1];
    const bottom = upper && endplateHit(upper, target.x, target.z, true);
    const top = lower && endplateHit(lower, target.x, target.z, false);
    bounds = {
      low: top ? top.point.y + lower.shift + clearance : -Infinity,
      high: bottom ? bottom.point.y + upper.shift - clearance : Infinity,
    };
    columns.set(key, bounds);
  }
  if (bounds.low <= bounds.high) {
    const point = target.clone();
    point.y = Math.max(bounds.low, Math.min(bounds.high, point.y));
    return { point, touched: Math.abs(point.y - target.y) > 1e-6 };
  }
  // No gap through this column (e.g. a posterior process): sweep and slide
  // around its exposed surface rather than pushing through the obstruction.
  return constrainToBones(rest, target, bones, clearance);
}

export function discBoneClearance(part, bones) {
  let clearance = Infinity;
  for (let i = -3; i <= 3; i++)
    for (let j = -3; j <= 3; j++) {
      if (i * i + j * j > 9) continue;
      const x = part.center.x + i * part.size.x * 0.11,
        z = part.center.z + j * part.size.z * 0.11;
      const upper = bones[0],
        lower = bones[1];
      const bottom = endplateHit(upper, x, z, true);
      const top = endplateHit(lower, x, z, false);
      if (bottom && top)
        clearance = Math.min(
          clearance,
          bottom.point.y + upper.shift - top.point.y - lower.shift,
        );
    }
  return Math.max(0, clearance);
}
