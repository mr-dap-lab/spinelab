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
    if(!geometry.attributes.normal)geometry.computeVertexNormals();geometry.computeBoundingBox();return geometry;
  }).catch(error=>{skinPromise=null;throw error;});
}
function segmentMatrix(a,b,c,d) {
  const q=new T.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(),d.clone().sub(c).normalize());
  return new T.Matrix4().compose(c.clone().sub(a.clone().applyQuaternion(q)),q,new T.Vector3(1,1,1));
}
function ik(a,b,l1,l2,bend) {
  const delta=b.clone().sub(a),distance=clamp(delta.length(),Math.abs(l1-l2)+.001,l1+l2-.001),axis=delta.normalize();
  // Keep the end effector and joint solution on the same reachable chain.
  b.copy(a).addScaledVector(axis,distance);
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance);
  const perpendicular=bend.clone().addScaledVector(axis,-bend.dot(axis)).normalize();
  return a.clone().addScaledVector(axis,along).addScaledVector(perpendicular,Math.sqrt(Math.max(0,l1*l1-along*along)));
}
export function createBodyMotion(model,parts,sourceSkin) {
  if(!sourceSkin)throw new Error('Body surface must be loaded before creating the rig');
  const dynamics=createSpineDynamics(parts),bottom=dynamics.pelvis.y,top=dynamics.top,h=top-bottom;
  const group=new T.Group();group.name='Anatomical body surface';
  const skin=new T.MeshPhysicalMaterial({color:'#c6b3a2',transparent:true,opacity:.28,depthWrite:false,roughness:.65,metalness:0,side:T.DoubleSide});
  const surface=new T.Mesh(sourceSkin.clone(),skin);surface.geometry.userData.shared=false;surface.frustumCulled=false;surface.renderOrder=2;group.add(surface);
  // Render just the nearest skin layer: prevent overlapping scan surfaces from
  // accumulating opacity and obscuring the anatomical structures underneath.
  const depthMaterial=skin.clone();depthMaterial.colorWrite=false;depthMaterial.depthWrite=true;depthMaterial.forceSinglePass=true;
  const skinDepth=new T.Mesh(surface.geometry,depthMaterial);
  skinDepth.renderOrder=1;skinDepth.frustumCulled=false;group.add(skinDepth);
  skin.forceSinglePass=true;skin.depthFunc=T.LessEqualDepth;skin.polygonOffset=false;
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
  const limbs=[-1,1].map(side=>({side,hip:new T.Vector3(side*3.5,-13.6,-1),knee:new T.Vector3(side*3.6,-29,-1.4),ankle:new T.Vector3(side*3.6,-43.7,-.3),shoulder:new T.Vector3(side*7,8,-1.3),elbow:new T.Vector3(side*8.8,-4.2,-.6),wrist:new T.Vector3(side*10.1,-12.2,-1.9)}));
  // Smooth skinning weights preserve one continuous body surface at the joints.
  const bindings=[];
  for(let i=0;i<base.length;i+=3){
    const p=new T.Vector3().fromArray(base,i),side=p.x<0?0:1,l=limbs[side];
    // Hands extend below the pelvis in this scan. Classify the complete arm
    // before the legs; a height-only split incorrectly attached fingers to hips.
    const armEdge=p.y>0?T.MathUtils.lerp(6.4,5,clamp(p.y/8,0,1)):T.MathUtils.lerp(6.4,8,clamp((-p.y-6)/7,0,1));
    if(p.y<10 && Math.abs(p.x)>armEdge){
      const width=T.MathUtils.lerp(.3,2.5,T.MathUtils.smoothstep(p.y,-2,5));
      const mix=T.MathUtils.smoothstep(Math.abs(p.x),armEdge,armEdge+width)*(1-T.MathUtils.smoothstep(p.y,8,10));
      const elbow=T.MathUtils.smoothstep(l.elbow.y-p.y,-2,2);
      bindings.push({side,limb:'arm',mix,joint:elbow,hand:T.MathUtils.smoothstep(l.wrist.y-p.y,-1.2,1.2)});
    }else if(p.y<-11){
      const mix=T.MathUtils.smoothstep(-p.y,11,18),knee=T.MathUtils.smoothstep(l.knee.y-p.y,-2,2);
      bindings.push({side,limb:'leg',mix,joint:knee,foot:T.MathUtils.smoothstep(-p.y,41.5,44)});
    }else bindings.push(null);
  }
  // Elastic surface correction prevents the scan's narrow joint folds from
  // becoming long, thin triangles when the articulated limbs open them.
  const edges=[],edgeSet=new Set(),index=surface.geometry.index?.array;
  if(index)for(let i=0;i<index.length;i+=3)for(let j=0;j<3;j++){
    const a=index[i+j],b=index[i+(j+1)%3],key=Math.min(a,b)*bindings.length+Math.max(a,b);
    if(edgeSet.has(key))continue;edgeSet.add(key);
    const ai=a*3,bi=b*3,rest=Math.hypot(base[ai]-base[bi],base[ai+1]-base[bi+1],base[ai+2]-base[bi+2]);
    edges.push([ai,bi,Math.max(.01,rest)*1.8]);
  }
  function relaxSurface(array){
    for(let pass=0;pass<12;pass++)for(const [a,b,limit] of edges){
      const dx=array[b]-array[a],dy=array[b+1]-array[a+1],dz=array[b+2]-array[a+2],d2=dx*dx+dy*dy+dz*dz;
      if(d2<=limit*limit)continue;
      const correction=.5*(1-limit/Math.sqrt(d2));
      array[a]+=dx*correction;array[a+1]+=dy*correction;array[a+2]+=dz*correction;
      array[b]-=dx*correction;array[b+1]-=dy*correction;array[b+2]-=dz*correction;
    }
  }
  const weights=limbs.map(()=>{const o=new T.Mesh(new T.BoxGeometry(2,2.4,2),new T.MeshStandardMaterial({color:'#ac986c',roughness:.5}));group.add(o);return o;});
  const arrow=new T.ArrowHelper(new T.Vector3(0,-1,0),new T.Vector3(),4,0xd8b775,1,.5);group.add(arrow);
  const floor=new T.GridHelper(120,48,'#63747a','#46575e');floor.position.y=-46.3;floor.material.transparent=true;floor.material.opacity=.18;group.add(floor);
  const geometry=new T.BufferGeometry().setFromPoints(Array.from({length:25},()=>new T.Vector3()));
  const path=new T.Line(geometry,new T.LineBasicMaterial({color:'#e0bb74',transparent:true,opacity:.75,depthTest:false}));path.renderOrder=10;group.add(path);
  let last='',metrics={maxJoint:0,moment:0,shortening:0};
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
    const floorY=-46.1352;
    const floorPose=pose.floor!=='standing';
    const hips=limbs.map(l=>warp(l.hip.clone())),shoulders=limbs.map(l=>warp(l.shoulder.clone()));
    // Place the support joints from their actual segment lengths. The floor is
    // fixed in world space; the whole skeleton shares this translation.
    let elevation=0;
    if(pose.floor==='kneeling')elevation=floorY+1.7+limbs[0].hip.distanceTo(limbs[0].knee)-Math.max(...hips.map(p=>p.y));
    if(pose.floor==='plank')elevation=floorY+16-pose.drop*10-Math.max(...shoulders.map(p=>p.y));
    const limbFrames=limbs.map((l,i)=>{
      const hip=hips[i],shoulder=shoulders[i];
      const footRotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),pose.floor==='kneeling'?Math.PI:0);
      const handRotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),rad(70));
      // Support offsets are measured from the surface, not assumed at ankles
      // or wrists. This accounts for the thickness of toes, soles and palms.
      let footBottom=Infinity,handBottom=Infinity;
      for(let v=0;v<bindings.length;v++){
        const bind=bindings[v];if(!bind||bind.side!==i)continue;
        if(bind.foot===1){p.fromArray(base,v*3).sub(l.ankle).applyQuaternion(footRotation);footBottom=Math.min(footBottom,p.y);}
        if(bind.hand===1){p.fromArray(base,v*3).sub(l.wrist).applyQuaternion(handRotation);handBottom=Math.min(handBottom,p.y);}
      }
      if(!Number.isFinite(footBottom))footBottom=-2.4352;
      if(!Number.isFinite(handBottom))handBottom=-.8;
      let ankle=l.ankle.clone().add(new T.Vector3(0,0,-l.side*pose.stride*26)),knee;
      if(floorPose)ankle.y=floorY-elevation-footBottom;
      if(pose.floor==='kneeling'){
        knee=new T.Vector3(hip.x,hip.y-l.hip.distanceTo(l.knee),hip.z);
        ankle.x=knee.x;
        ankle.z=knee.z+Math.sqrt(Math.max(.01,l.knee.distanceToSquared(l.ankle)-(ankle.y-knee.y)**2));
      }else if(pose.floor==='plank'){
        // A nearly straight plank, with both leg bones retaining their lengths.
        const reach=l.hip.distanceTo(l.knee)+l.knee.distanceTo(l.ankle)-.08;
        ankle.x=hip.x;ankle.z=hip.z+Math.sqrt(Math.max(.01,reach*reach-(ankle.y-hip.y)**2));
        knee=ik(hip,ankle,l.hip.distanceTo(l.knee),l.knee.distanceTo(l.ankle),new T.Vector3(0,-1,0));
      }else if(reset)knee=l.knee.clone();
      else knee=ik(hip,ankle,l.hip.distanceTo(l.knee),l.knee.distanceTo(l.ankle),new T.Vector3(0,0,-1));
      let hand=warp(l.wrist.clone());
      hand.z-=pose.arms*13;hand.y+=pose.arms*12;
      if(floorPose)hand.set(l.side*7,floorY-elevation-handBottom,shoulder.z-2);
      const elbow=reset?l.elbow.clone():ik(shoulder,hand,l.shoulder.distanceTo(l.elbow),l.elbow.distanceTo(l.wrist),new T.Vector3(l.side*.4,0,1));
      weights[i].visible=config.load>0&&!floorPose;weights[i].position.copy(hand).add(new T.Vector3(0,-2.5,0));weights[i].scale.setScalar(.65+Math.cbrt(config.load/100));
      const foot=new T.Matrix4().compose(ankle.clone().sub(l.ankle.clone().applyQuaternion(footRotation)),footRotation,new T.Vector3(1,1,1));
      const palm=new T.Matrix4().compose(hand.clone().sub(l.wrist.clone().applyQuaternion(handRotation)),handRotation,new T.Vector3(1,1,1));
      return {foot,palm,leg:[segmentMatrix(l.hip,l.knee,hip,knee),segmentMatrix(l.knee,l.ankle,knee,ankle)],arm:[segmentMatrix(l.shoulder,l.elbow,shoulder,elbow),segmentMatrix(l.elbow,l.wrist,elbow,hand)]};
    });
    const a=surface.geometry.attributes.position,normal=surface.geometry.attributes.normal;
    for(let i=0;i<a.count;i++){
      p.fromArray(base,i*3);const m=get(p.y),bind=bindings[i];pa.copy(p).applyMatrix4(m);n.fromArray(baseNormals,i*3).transformDirection(m);
      if(bind){const [m1,m2]=limbFrames[bind.side][bind.limb];pb.copy(p).applyMatrix4(m1).lerp(p.clone().applyMatrix4(m2),bind.joint);if(bind.foot)pb.lerp(p.clone().applyMatrix4(limbFrames[bind.side].foot),bind.foot);if(floorPose&&bind.hand)pb.lerp(p.clone().applyMatrix4(limbFrames[bind.side].palm),bind.hand);pa.lerp(pb,bind.mix);
        const nn=new T.Vector3().fromArray(baseNormals,i*3),limbNormal=nn.clone().transformDirection(m1).lerp(nn.clone().transformDirection(m2),bind.joint);
        if(bind.foot)limbNormal.lerp(nn.clone().transformDirection(limbFrames[bind.side].foot),bind.foot);
        if(floorPose&&bind.hand)limbNormal.lerp(nn.clone().transformDirection(limbFrames[bind.side].palm),bind.hand);
        n.lerp(limbNormal.normalize(),bind.mix).normalize();}
      a.setXYZ(i,pa.x,pa.y,pa.z);normal.setXYZ(i,n.x,n.y,n.z);
    }if(!reset)relaxSurface(a.array);a.needsUpdate=true;
    // Preserve scan normals; clustered triangles can have reversed winding.
    normal.needsUpdate=true;surface.geometry.computeBoundingSphere();
    if(floorPose){
      let lowest=Infinity;for(let i=0;i<a.count;i++)lowest=Math.min(lowest,a.getY(i));
      elevation=Math.max(elevation,floorY-lowest);
    }
    group.position.y=elevation;for(const r of records)r.o.position.y+=elevation;
    skin.opacity=clamp(config.opacity,0,100)/100;skin.depthWrite=config.opacity>=98;skin.transparent=config.opacity<98;surface.visible=config.opacity>0;skinDepth.visible=surface.visible&&config.opacity<98;
    arrow.visible=config.load>0;path.visible=config.load>0;
    arrow.position.copy(warp(new T.Vector3(0,top+5,0)));arrow.setLength(2+config.load*.08,1,.5);
    const points=geometry.attributes.position;
    for(let i=0;i<25;i++){p.set(0,bottom+(top-bottom)*i/24,1);warp(p);points.setXYZ(i,p.x,p.y,p.z);}points.needsUpdate=true;
    floor.position.y=floorY-elevation;
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
