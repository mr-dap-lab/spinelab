// Analytic critically damped spring: stable across frame rates, no overshoot.
export function springStep(value, velocity, target, dt, frequency = 12) {
  const displacement = value - target,
    c = velocity + frequency * displacement,
    decay = Math.exp(-frequency * dt);
  return [
    target + (displacement + c * dt) * decay,
    (velocity - frequency * c * dt) * decay,
  ];
}
