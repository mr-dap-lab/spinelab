import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSpineDynamics } from './spine-dynamics.js';

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

let skinPromise;
export function loadBodySurface() {
  return skinPromise ||= new GLTFLoader().loadAsync('/anatomy/body.glb').then(g=>{
    let geometry;g.scene.traverse(o=>{if(o.isMesh)geometry=o.geometry;});
    if(!geometry)throw new Error('Anatomical body surface missing');
    geometry.computeVertexNormals();geometry.computeBoundingBox();return geometry;
  }).catch(error=>{skinPromise=null;throw error;});
}
function segmentMatrix(a,b,c,d) {
  const q=new T.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(),d.clone().sub(c).normalize());
  return new T.Matrix4().compose(c.clone().sub(a.clone().applyQuaternion(q)),q,new T.Vector3(1,1,1));
}
function ik(a,b,l1,l2,bend) {
  const delta=b.clone().sub(a),distance=clamp(delta.length(),.001,l1+l2-.001),axis=delta.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance);
  const perpendicular=bend.clone().addScaledVector(axis,-bend.dot(axis)).normalize();
  return a.clone().addScaledVector(axis,along).addScaledVector(perpendicular,Math.sqrt(Math.max(0,l1*l1-along*along)));
}
export function createBodyMotion(model,parts,sourceSkin) {
  if(!sourceSkin)throw new Error('Body surface must be loaded before creating the rig');
  const dynamics=createSpineDynamics(parts),bottom=dynamics.pelvis.y,top=dynamics.top,h=top-bottom;
  const group=new T.Group();group.name='Anatomical body surface';
  const skin=new T.MeshPhysicalMaterial({color:'#c6b3a2',transparent:true,opacity:.28,depthWrite:false,roughness:.52,metalness:0,side:T.FrontSide});
  const surface=new T.Mesh(sourceSkin.clone(),skin);surface.geometry.userData.shared=false;surface.frustumCulled=false;surface.renderOrder=2;group.add(surface);
  // Render just the nearest skin layer: prevent overlapping scan surfaces from
  // accumulating opacity and obscuring the anatomical structures underneath.
  const skinDepth=new T.Mesh(surface.geometry,new T.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:T.FrontSide}));
  skinDepth.renderOrder=1;skinDepth.frustumCulled=false;group.add(skinDepth);
  skin.depthFunc=T.LessEqualDepth;skin.polygonOffset=true;skin.polygonOffsetFactor=-1;skin.polygonOffsetUnits=-1;
  const bodyPickables=[surface],records=[];
  model.group.updateMatrixWorld(true);
  model.group.traverse(o=>{
    if(!o.isMesh)return;
    if(o.userData.kind==='bone'){
      o.geometry.computeBoundingBox();const center=o.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(o.matrixWorld);
      records.push({o,rigid:true,matrix:o.matrix.clone(),y:center.y});
    }else{
      const old=o.geometry,g=old.clone();g.userData.shared=false;o.geometry=g;if(!old.userData.shared)old.dispose();
      records.push({o,base:new Float32Array(g.attributes.position.array),normals:g.attributes.normal?new Float32Array(g.attributes.normal.array):null,offset:o.position.clone()});o.frustumCulled=false;
    }
  });
  const base=new Float32Array(surface.geometry.attributes.position.array),baseNormals=new Float32Array(surface.geometry.attributes.normal.array);
  // Landmarks in the same original dataset coordinate system (no body scaling).
  const limbs=[-1,1].map(side=>({side,hip:new T.Vector3(side*3.5,-13.6,-1),knee:new T.Vector3(side*3.6,-29,-1.4),ankle:new T.Vector3(side*3.6,-43.7,-.3),shoulder:new T.Vector3(side*7,8,-1.3),elbow:new T.Vector3(side*10.3,-.7,-1.1),wrist:new T.Vector3(side*11.8,-9,-.9)}));
  // Smooth skinning weights preserve one continuous body surface at the joints.
  const bindings=[];
  for(let i=0;i<base.length;i+=3){
    const p=new T.Vector3().fromArray(base,i),side=p.x<0?0:1,l=limbs[side];
    if(p.y<-13){
      const mix=clamp((-p.y-13)/2.5,0,1),knee=clamp((l.knee.y+2-p.y)/4,0,1);
      bindings.push({side,limb:'leg',mix,joint:knee,foot:clamp((-p.y-42)/1.5,0,1)});
    }else if(p.y<9 && Math.abs(p.x)>5){
      const mix=clamp((Math.abs(p.x)-5)/2.1,0,1),elbow=clamp((l.elbow.y+2-p.y)/4,0,1);
      bindings.push({side,limb:'arm',mix,joint:elbow});
    }else bindings.push(null);
  }
  const weights=limbs.map(()=>{const o=new T.Mesh(new T.BoxGeometry(2,2.4,2),new T.MeshStandardMaterial({color:'#ac986c',roughness:.5}));group.add(o);return o;});
  const arrow=new T.ArrowHelper(new T.Vector3(0,-1,0),new T.Vector3(),4,0xd8b775,1,.5);group.add(arrow);
  const floor=new T.GridHelper(65,26,'#63747a','#46575e');floor.position.y=-46.3;floor.material.transparent=true;floor.material.opacity=.18;group.add(floor);
  const geometry=new T.BufferGeometry().setFromPoints(Array.from({length:25},()=>new T.Vector3()));
  const path=new T.Line(geometry,new T.LineBasicMaterial({color:'#e0bb74',transparent:true,opacity:.75,depthTest:false}));path.renderOrder=10;group.add(path);
  let last='',lastConfig='',metrics={maxJoint:0,moment:0,shortening:0};
  function update(config,phase,dt=1/30,instant=false){
    const key=JSON.stringify({...config,phase});if(last===key&&dynamics.settled)return false;last=key;
    const pose=movementPose(config,phase);
    const reset=config.movement==='manual'&&!config.hinge&&!config.flexion&&!config.side&&!config.twist&&!config.load;
    dynamics.step(pose,config.load,dt,instant||reset);
    // Cache interpolated transforms in 0.05-unit slices for soft tissue/skin.
    const frameCache=new Map(),get=(y)=>{const key=Math.round(y*20);if(!frameCache.has(key))frameCache.set(key,dynamics.matrixAt(key/20));return frameCache.get(key);};
    const warp=(p)=>p.applyMatrix4(get(p.y));
    const p=new T.Vector3(),n=new T.Vector3(),pa=new T.Vector3(),pb=new T.Vector3();
    for(const r of records){
      if(r.rigid){r.o.matrix.multiplyMatrices(dynamics.matrixAt(r.y,true),r.matrix);r.o.matrix.decompose(r.o.position,r.o.quaternion,r.o.scale);continue;}
      r.o.position.copy(r.offset);
      const a=r.o.geometry.attributes.position,normal=r.o.geometry.attributes.normal;
      for(let i=0;i<a.count;i++){
        p.fromArray(r.base,i*3).add(r.offset);const m=get(p.y);p.applyMatrix4(m).sub(r.offset);a.setXYZ(i,p.x,p.y,p.z);
        if(normal&&r.normals){n.fromArray(r.normals,i*3).transformDirection(m);normal.setXYZ(i,n.x,n.y,n.z);}
      }a.needsUpdate=true;if(normal)normal.needsUpdate=true;r.o.geometry.computeBoundingSphere();
    }
    let floorY=-46.1;
    // Floor poses translate the entire assembly after joint articulation.
    const floorPose=pose.floor!=='standing';
    let elevation=pose.floor==='kneeling'?-16:floorPose?-17:0;
    group.position.y=elevation;
    for(const r of records)r.o.position.y+=elevation;
    const limbFrames=limbs.map((l,i)=>{
      const hip=warp(l.hip.clone()),shoulder=warp(l.shoulder.clone());
      let ankle=l.ankle.clone().add(new T.Vector3(0,0,-l.side*pose.stride*26)),knee;
      if(pose.floor==='kneeling'){knee=new T.Vector3(hip.x,floorY-elevation,hip.z);ankle=new T.Vector3(hip.x,floorY-elevation,hip.z+13);}
      else if(pose.floor==='plank'){ankle.set(l.side*3.5,floorY-elevation,25);knee=hip.clone().lerp(ankle,.5);}
      else if(reset)knee=l.knee.clone();
      else knee=ik(hip,ankle,l.hip.distanceTo(l.knee),l.knee.distanceTo(l.ankle),new T.Vector3(0,0,-1));
      let hand=warp(l.wrist.clone());
      hand.z-=pose.arms*13;hand.y+=pose.arms*12;
      if(floorPose)hand.set(l.side*7,floorY-elevation,shoulder.z-2);
      const elbow=reset?l.elbow.clone():ik(shoulder,hand,l.shoulder.distanceTo(l.elbow),l.elbow.distanceTo(l.wrist),new T.Vector3(l.side*.4,0,1));
      weights[i].visible=config.load>0&&!floorPose;weights[i].position.copy(hand).add(new T.Vector3(0,-2.5,0));weights[i].scale.setScalar(.65+Math.cbrt(config.load/100));
      const footRotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),pose.floor==='kneeling'?Math.PI:0);
      const foot=new T.Matrix4().compose(ankle.clone().sub(l.ankle.clone().applyQuaternion(footRotation)),footRotation,new T.Vector3(1,1,1));
      return {foot,leg:[segmentMatrix(l.hip,l.knee,hip,knee),segmentMatrix(l.knee,l.ankle,knee,ankle)],arm:[segmentMatrix(l.shoulder,l.elbow,shoulder,elbow),segmentMatrix(l.elbow,l.wrist,elbow,hand)]};
    });
    const a=surface.geometry.attributes.position,normal=surface.geometry.attributes.normal;
    for(let i=0;i<a.count;i++){
      p.fromArray(base,i*3);const m=get(p.y),bind=bindings[i];pa.copy(p).applyMatrix4(m);n.fromArray(baseNormals,i*3).transformDirection(m);
      if(bind){const [m1,m2]=limbFrames[bind.side][bind.limb];pb.copy(p).applyMatrix4(m1).lerp(p.clone().applyMatrix4(m2),bind.joint);if(bind.foot)pb.lerp(p.clone().applyMatrix4(limbFrames[bind.side].foot),bind.foot);pa.lerp(pb,bind.mix);
        const nn=new T.Vector3().fromArray(baseNormals,i*3);n.lerp(nn.clone().transformDirection(m1).lerp(nn.transformDirection(m2),bind.joint).normalize(),bind.mix).normalize();}
      a.setXYZ(i,pa.x,pa.y,pa.z);normal.setXYZ(i,n.x,n.y,n.z);
    }a.needsUpdate=true;normal.needsUpdate=true;surface.geometry.computeBoundingSphere();
    skin.opacity=clamp(config.opacity,0,100)/100;skin.depthWrite=config.opacity>=98;skin.transparent=config.opacity<98;surface.visible=config.opacity>0;skinDepth.visible=surface.visible;
    arrow.visible=config.load>0;path.visible=config.load>0;
    arrow.position.copy(warp(new T.Vector3(0,top+5,0)));arrow.setLength(2+config.load*.08,1,.5);
    const points=geometry.attributes.position;
    for(let i=0;i<25;i++){p.set(0,bottom+(top-bottom)*i/24,1);warp(p);points.setXYZ(i,p.x,p.y,p.z);}points.needsUpdate=true;
    floor.position.y=floorY-elevation-.2;
    metrics={maxJoint:Math.max(...dynamics.joints.flatMap(j=>j.q.map(v=>Math.abs(v)*180/Math.PI))),moment:Math.max(...dynamics.joints.map(j=>Math.abs(j.moment))),shortening:dynamics.joints.reduce((n,j)=>n+j.compression,0)/.04};
    return true;
  }
  function currentBounds(spineOnly=false){
    model.group.updateMatrixWorld(true);
    const box=new T.Box3();
    if(spineOnly){for(const r of records)if(r.rigid)box.union(new T.Box3().setFromObject(r.o));}
    else {surface.geometry.computeBoundingBox();box.copy(surface.geometry.boundingBox).applyMatrix4(surface.matrixWorld);}
    return box;
  }
  const bounds=sourceSkin.boundingBox?.clone()||new T.Box3(new T.Vector3(-14,-47,-8),new T.Vector3(14,21,6));
  return {group,bodyPickables,bounds,currentBounds,update,bottom,top,dynamics,get metrics(){return metrics;}};
}
