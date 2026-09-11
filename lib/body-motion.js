import * as T from 'three';

import { movementPose } from './body-settings.js';
export { DEFAULT_BODY, MOVEMENTS, movementPose } from './body-settings.js';
const rad = T.MathUtils.degToRad;
const clamp = T.MathUtils.clamp;

// A shared centerline deformation registers the body and spine. Vertebrae are
// rigid; discs and neural overlays interpolate the centerline transforms.
export function spineFrames(bottom, top, pose) {
  const height = top - bottom, frames = [];
  let center = new T.Vector3(0, bottom - pose.drop * height, pose.retreat * height);
  for (let i = 0; i <= 128; i++) {
    const t = i / 128;
    const q = new T.Quaternion().setFromEuler(new T.Euler(
      rad(-pose.hinge - pose.flexion * t), rad(pose.twist * t), rad(-pose.side * t), 'YXZ',
    ));
    if (i) center.add(new T.Vector3(0, height / 128, 0).applyQuaternion(q));
    const origin = new T.Vector3(0, bottom + t * height, 0);
    const translation = center.clone().sub(origin.clone().applyQuaternion(q));
    frames.push(new T.Matrix4().compose(translation, q, new T.Vector3(1, 1, 1)));
  }
  return frames;
}
function frameIndex(y, bottom, height) { return Math.round(clamp((y - bottom) / height, 0, 1) * 128); }

export function createBodyMotion(model, parts) {
  const discs = parts.filter(p => p.kind === 'disc');
  const bottom = Math.min(...discs.map(p => p.center.y)) - 0.55;
  const top = Math.max(...discs.map(p => p.center.y)) + 0.9;
  const h = top - bottom;
  const group = new T.Group(); group.name = 'Human body overlay';
  const skin = new T.MeshPhysicalMaterial({ color: '#c4a99b', transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.57, side: T.FrontSide });
  const solid = new T.MeshStandardMaterial({ color: '#cfab6e', roughness: 0.4 });
  const bodyPickables = [], records = [];
  // Preserve source buffers and base transforms; animation never accumulates drift.
  model.group.updateMatrixWorld(true);
  model.group.traverse(o => {
    if (!o.isMesh) return;
    if (o.userData.kind === 'bone') {
      o.geometry.computeBoundingBox();
      const center = o.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(o.matrixWorld);
      records.push({ o, rigid: true, matrix: o.matrix.clone(), index: frameIndex(center.y, bottom, h) });
    } else {
      const original = o.geometry, geometry = original.clone();
      geometry.userData.shared = false; o.geometry = geometry;
      if (!original.userData.shared) original.dispose();
      const p = geometry.attributes.position, n = geometry.attributes.normal;
      const base = new Float32Array(p.array), normals = n ? new Float32Array(n.array) : null;
      const indices = new Uint8Array(p.count);
      for (let i = 0; i < p.count; i++) indices[i] = frameIndex(p.getY(i) + o.position.y, bottom, h);
      records.push({ o, base, normals, indices, offset: o.position.clone() });
      o.frustumCulled = false;
    }
  });
  function ellipsoid(scale) {
    const mesh = new T.Mesh(new T.SphereGeometry(1, 28, 20), skin);
    mesh.scale.set(...scale); group.add(mesh); bodyPickables.push(mesh); return mesh;
  }
  // Continuous torso silhouette: pelvis, waist, ribcage and shoulder contours.
  const rows = [[0,.18,.13],[.10,.21,.14],[.25,.16,.12],[.42,.17,.14],[.62,.23,.16],[.77,.25,.14],[.86,.17,.11],[.91,.075,.075]];
  const pos = [], idx = [];
  for (const [y,w,d] of rows) for (let j=0;j<=48;j++) {
    const a=j/48*Math.PI*2;
    pos.push(Math.sin(a)*h*w, bottom+y*h, -h*.055+Math.cos(a)*h*d);
  }
  for(let i=0;i<rows.length-1;i++) for(let j=0;j<48;j++) {
    const a=i*49+j,b=a+49; idx.push(a,a+1,b,a+1,b+1,b);
  }
  const torsoG=new T.BufferGeometry(); torsoG.setAttribute('position',new T.Float32BufferAttribute(pos,3));torsoG.setIndex(idx);torsoG.computeVertexNormals();
  const torso=new T.Mesh(torsoG,skin);torso.frustumCulled=false;group.add(torso);bodyPickables.push(torso);
  const torsoBase=new Float32Array(pos);
  const head=ellipsoid([h*.105,h*.14,h*.115]);
  const neck=ellipsoid([h*.065,h*.09,h*.065]);
  const pelvis=ellipsoid([h*.20,h*.115,h*.14]);
  const limbs=[];
  function limb(radius) {
    const mesh=new T.Mesh(new T.CapsuleGeometry(radius,1,6,14),skin);
    group.add(mesh);bodyPickables.push(mesh);return {mesh,radius};
  }
  for(const side of [-1,1]) limbs.push({side, thigh:limb(h*.075),calf:limb(h*.05),upper:limb(h*.047),fore:limb(h*.034),hand:ellipsoid([h*.04,h*.065,h*.027]),foot:ellipsoid([h*.055,h*.035,h*.10]),weight:new T.Mesh(new T.BoxGeometry(h*.09,h*.12,h*.09),solid)});
  limbs.forEach(l=>group.add(l.weight));
  function segment(l,a,b) {
    l.mesh.position.copy(a).add(b).multiplyScalar(.5);
    l.mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());
    l.mesh.scale.y=Math.max(.01,a.distanceTo(b))/(1+2*l.radius);
  }
  // Two-link IK keeps feet planted while the pelvis lowers in squat/lunge.
  function joint(a,b,length,forward) {
    const d=b.clone().sub(a), distance=Math.min(d.length(),length*1.999);
    const along=d.clone().normalize();
    let normal=new T.Vector3(0,0,forward).addScaledVector(along,-along.z*forward).normalize();
    if(normal.lengthSq()<.01) normal.set(0,1,0);
    return a.clone().addScaledVector(along,distance*.5).addScaledVector(normal,Math.sqrt(Math.max(0,length*length-distance*distance*.25)));
  }
  const arrow=new T.ArrowHelper(new T.Vector3(0,-1,0),new T.Vector3(),h*.18,0xefbf69,h*.045,h*.022); group.add(arrow);
  const loadPath=new T.Line(new T.BufferGeometry().setFromPoints(Array.from({length:25},()=>new T.Vector3())),new T.LineBasicMaterial({color:'#f0bc63',transparent:true,opacity:.8,depthTest:false}));
  loadPath.renderOrder=10; group.add(loadPath);
  const floor=new T.Mesh(new T.CircleGeometry(h*1.25,64),new T.MeshBasicMaterial({color:'#9faeb3',transparent:true,opacity:.08,depthWrite:false,side:T.DoubleSide}));
  floor.rotation.x=-Math.PI/2;group.add(floor);
  let last='';
  function update(config,phase) {
    const key=JSON.stringify({...config,phase});if(key===last)return false;last=key;
    const pose=movementPose(config,phase), frames=spineFrames(bottom,top,pose);
    const p=new T.Vector3(), n=new T.Vector3();
    const warp=(point)=>point.applyMatrix4(frames[frameIndex(point.y,bottom,h)]);
    for(const r of records) {
      if(r.rigid) {r.o.matrix.multiplyMatrices(frames[r.index],r.matrix);r.o.matrix.decompose(r.o.position,r.o.quaternion,r.o.scale);continue;}
      const a=r.o.geometry.attributes.position,normal=r.o.geometry.attributes.normal;
      for(let i=0;i<a.count;i++) {
        p.fromArray(r.base,i*3).add(r.offset).applyMatrix4(frames[r.indices[i]]).sub(r.offset);a.setXYZ(i,p.x,p.y,p.z);
        if(normal&&r.normals){n.fromArray(r.normals,i*3).transformDirection(frames[r.indices[i]]);normal.setXYZ(i,n.x,n.y,n.z);}
      }
      a.needsUpdate=true;if(normal)normal.needsUpdate=true;
      r.o.geometry.computeBoundingSphere();
    }
    const a=torsoG.attributes.position;
    for(let i=0;i<a.count;i++){p.fromArray(torsoBase,i*3);warp(p);a.setXYZ(i,p.x,p.y,p.z);}a.needsUpdate=true;torsoG.computeVertexNormals();
    const place=(mesh,y,z=0)=>{mesh.position.copy(warp(new T.Vector3(0,y,z)));mesh.quaternion.setFromRotationMatrix(frames[frameIndex(y,bottom,h)]);};
    place(head,top+h*.1,-h*.055);place(neck,top-h*.04,-h*.05);place(pelvis,bottom+h*.025,-h*.045);
    let floorY=bottom-h*.95;
    if(pose.floor==='kneeling')floorY=bottom-h*.49;
    if(pose.floor==='plank')floorY=bottom-h*.50;
    floor.position.set(0,floorY-h*.04,-h*.25);
    for(const l of limbs) {
      const s=l.side;
      const hip=warp(new T.Vector3(s*h*.12,bottom,-h*.04));
      let ankle=new T.Vector3(s*h*.14,floorY,-s*pose.stride*h);
      let knee;
      if(pose.floor==='kneeling'){knee=new T.Vector3(s*h*.13,floorY,hip.z);ankle=new T.Vector3(s*h*.13,floorY,hip.z+h*.4);}
      else if(pose.floor==='plank'){ankle.set(s*h*.11,floorY,h*.85);knee=hip.clone().lerp(ankle,.5);}
      else knee=joint(hip,ankle,h*.49,-1);
      segment(l.thigh,hip,knee);segment(l.calf,knee,ankle);l.foot.position.copy(ankle).add(new T.Vector3(0,0,-h*.055));
      const shoulder=warp(new T.Vector3(s*h*.235,bottom+h*.77,-h*.045));
      let hand=warp(new T.Vector3(s*h*.255,bottom+h*(.16+pose.arms*.43),-h*(.07+pose.arms*.45)));
      if(pose.floor!=='standing')hand=new T.Vector3(s*h*.25,floorY,shoulder.z-h*.06);
      const elbow=joint(shoulder,hand,h*.32,1);
      segment(l.upper,shoulder,elbow);segment(l.fore,elbow,hand);l.hand.position.copy(hand);
      l.weight.visible=config.load>0 && pose.floor==='standing';l.weight.position.copy(hand).add(new T.Vector3(0,-h*.10,0));
      l.weight.scale.setScalar(.6+Math.cbrt(config.load/100)*.8);
    }
    skin.opacity=clamp(config.opacity,0,100)/100;
    for(const m of bodyPickables)m.visible=config.opacity>0;
    arrow.visible=config.load>0;loadPath.visible=config.load>0;
    arrow.position.copy(warp(new T.Vector3(0,top+h*.32,0)));
    arrow.setLength(h*(.10+.25*config.load/100),h*.045,h*.022);
    const path=loadPath.geometry.attributes.position;
    for(let i=0;i<25;i++){p.set(0,bottom+h*i/24,h*.05);warp(p);path.setXYZ(i,p.x,p.y,p.z);}path.needsUpdate=true;
    loadPath.material.opacity=.25+.7*config.load/100;
    return true;
  }
  // Envelope accommodates full-body poses without refitting during playback.
  const bounds=new T.Box3(new T.Vector3(-h*.65,bottom-h*1.03,-h*1.3),new T.Vector3(h*.65,top+h*.28,h*.9));
  return {group,bodyPickables,bounds,update,bottom,top};
}
