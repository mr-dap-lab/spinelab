export const MOVEMENTS = {
  manual: 'Manual pose', hinge: 'Hip hinge', squat: 'Squat', catcow: 'Cat–cow',
  lunge: 'Lunge', push: 'Push-up', carry: 'Carry', pull: 'Standing pull',
  extend: 'Extension', sidebend: 'Side bend', rotate: 'Trunk rotation',
};
export const DEFAULT_BODY = {
  enabled: false, cycleTick: 0, opacity: 32, movement: 'manual', phase: 0, playing: false,
  speed: 1, hinge: 0, flexion: 0, side: 0, twist: 0, load: 0, drag: 'camera', follow: true,
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function movementPose(config, phase = config.phase) {
  const u = (1 - Math.cos(clamp(phase, 0, 100) / 100 * Math.PI * 2)) / 2;
  const wave = Math.sin(clamp(phase, 0, 100) / 100 * Math.PI * 2);
  const p = { hinge: 0, flexion: 0, side: 0, twist: 0, drop: 0, retreat: 0, stride: 0, arms: 0, floor: 'standing' };
  switch (config.movement) {
    case 'hinge': p.hinge = 65 * u; p.retreat = 0.07 * u; break;
    case 'squat': p.hinge = 28 * u; p.flexion = 6 * u; p.drop = 0.34 * u; p.retreat = 0.12 * u; p.arms = 0.65 * u; break;
    case 'catcow': p.hinge = 75 - 25 * wave; p.flexion = (wave>0?70:35) * wave; p.floor = 'kneeling'; break;
    case 'lunge': p.drop = 0.23 * u; p.stride = 0.38 * u; p.hinge = 8 * u; break;
    case 'push': p.hinge = 70 + 12 * u; p.pushDepth = u; p.floor = 'plank'; break;
    case 'carry': p.side = 3 * wave; p.twist = 4 * wave; p.stride = 0.12 * wave; break;
    case 'pull': p.arms = 0.85 - 0.6 * u; p.hinge = -8 * u; break;
    case 'extend': p.flexion = -20 * u; break;
    case 'sidebend': p.side = 25 * wave; break;
    case 'rotate': p.twist = 40 * wave; break;
    default: p.hinge = clamp(config.hinge, -20, 85); p.flexion = clamp(config.flexion, -25, 45); p.side = clamp(config.side, -30, 30); p.twist = clamp(config.twist, -45, 45);
  }
  return p;
}

