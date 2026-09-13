import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {DEFAULT_BODY,MOVEMENTS,movementPose,spineFrames,createBodyMotion} from '../lib/body-motion.js';

test('presets produce finite repeatable closed cycles and separate hinge from spinal motion',()=>{
  for(const movement of Object.keys(MOVEMENTS)) {
    const c={...DEFAULT_BODY,movement};
    const start=movementPose(c,0),end=movementPose(c,100);
    for(const key of ['hinge','flexion','side','twist','drop','stride'])assert.ok(Math.abs(start[key]-end[key])<1e-10);
    for(const phase of [0,25,50,75,100])for(const m of spineFrames(-10,10,movementPose(c,phase)))for(const v of m.elements)assert.ok(Number.isFinite(v));
  }
  assert.equal(movementPose({...DEFAULT_BODY,movement:'hinge'},50).flexion,0);
  assert.equal(movementPose({...DEFAULT_BODY,movement:'extend'},50).hinge,0);
});

test('hinging rotates the spine rigidly; flexion distributes orientation; mass does not invent compression',()=>{
  const neutral=spineFrames(-10,10,movementPose(DEFAULT_BODY));
  for(const frame of neutral)assert.ok(new T.Vector3(1,3,2).applyMatrix4(frame).distanceTo(new T.Vector3(1,3,2))<1e-10);
  const hinge=spineFrames(-10,10,movementPose({...DEFAULT_BODY,hinge:60}));
  const a=new T.Vector3(0,0,0).applyMatrix4(hinge[64]),b=new T.Vector3(0,10,0).applyMatrix4(hinge[128]);
  assert.ok(Math.abs(a.distanceTo(b)-10)<1e-10);
  const flex=spineFrames(-10,10,movementPose({...DEFAULT_BODY,flexion:30}));
  assert.notDeepEqual(flex[0].elements,flex[128].elements);
  assert.deepEqual(movementPose({...DEFAULT_BODY,load:100}),movementPose(DEFAULT_BODY));
});

test('body deformation preserves source buffers, rigid bone size and neutral reset',()=>{
  const source=new T.BoxGeometry(1,1,1);source.userData.shared=true;const before=Array.from(source.attributes.position.array);
  const group=new T.Group(),bone=new T.Mesh(source,new T.MeshBasicMaterial());bone.userData.kind='bone';group.add(bone);
  const soft=new T.Mesh(source,new T.MeshBasicMaterial());soft.position.y=1;group.add(soft);
  const parts=[{kind:'disc',center:new T.Vector3(0,-2,0)},{kind:'disc',center:new T.Vector3(0,2,0)}];
  const rig=createBodyMotion({group},parts,source);
  rig.update({...DEFAULT_BODY,enabled:true,flexion:35,hinge:40,load:100},50);
  assert.ok(Math.abs(bone.scale.x-1)<1e-10 && Math.abs(bone.scale.y-1)<1e-10);
  assert.deepEqual(Array.from(source.attributes.position.array),before);
  rig.update({...DEFAULT_BODY,enabled:true},0);
  assert.deepEqual(Array.from(soft.geometry.attributes.position.array),before);
  assert.ok(bone.position.length()<1e-10);
  for(const movement of Object.keys(MOVEMENTS))for(const phase of [0,25,50,75]) {
    rig.update({...DEFAULT_BODY,enabled:true,movement,load:100},phase);
    rig.group.traverse(o=>{if(o.isMesh){for(const v of o.matrix.elements)assert.ok(Number.isFinite(v));if(o.geometry.attributes.position)for(const v of o.geometry.attributes.position.array)assert.ok(Number.isFinite(v));}});
  }
});

test('anatomical skin does not bridge hands to hips and floor poses stay grounded',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const {prepareAnatomy}=await import('../lib/spine-model.js');
  async function load(name){const bytes=await readFile(new URL(`../public/anatomy/${name}.glb`,import.meta.url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
  const asset=await load('body');let source;asset.scene.traverse(o=>{if(o.isMesh)source=o.geometry;});
  const group=new T.Group(),rig=createBodyMotion({group},prepareAnatomy(await load('spine')),source);group.add(rig.group);
  const base=source.attributes.position,indices=source.index.array;
  const edges=new Map(),a=new T.Vector3(),b=new T.Vector3();
  for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){
    const x=indices[i+j],y=indices[i+(j+1)%3],key=Math.min(x,y)*base.count+Math.max(x,y);
    if(!edges.has(key))edges.set(key,[x,y,a.fromBufferAttribute(base,x).distanceTo(b.fromBufferAttribute(base,y))]);
  }
  for(const movement of ['squat','pull','catcow','push'])for(const phase of [0,25,50,75,100]){
    rig.update({...DEFAULT_BODY,movement},phase,1/30,true);
    const posed=rig.bodyPickables[0].geometry.attributes.position;
    for(const [x,y,rest] of edges.values()){
      const length=a.fromBufferAttribute(posed,x).distanceTo(b.fromBufferAttribute(posed,y));
      assert.ok(length-rest<3,`${movement} ${phase}: stretched skin bridge (${length-rest})`);
      if(Math.abs(base.getX(x))>8.5 && Math.abs(base.getX(y))>8.5 && base.getY(x)<-14 && base.getY(y)<-14)
        {
          const expected=(movement==='catcow'||movement==='push')?a.fromBufferAttribute(base,x).applyMatrix4(new T.Matrix4().set(1,0,0,0,0,1,0,0,0,-.3,1,0,0,0,0,1)).distanceTo(b.fromBufferAttribute(base,y).applyMatrix4(new T.Matrix4().set(1,0,0,0,0,1,0,0,0,-.3,1,0,0,0,0,1))):rest;
          assert.ok(Math.abs(length-expected)<.025,`${movement}: finger geometry must move with the planted hand`);
        }
    }
    if(movement==='push'&&(phase===0||phase===100))assert.ok(rig.metrics.elbowFlexion<5,`Push-up top must extend arms: ${rig.metrics.elbowFlexion}`);
    if(movement==='push'&&phase===50)assert.ok(rig.metrics.elbowFlexion>75,`Push-up bottom must bend arms: ${rig.metrics.elbowFlexion}`);
    if(movement==='catcow'){
      let heel=0,toe=0,heels=0,toes=0,lowestFoot=Infinity;
      for(let i=0;i<posed.count;i++)if(base.getY(i)<-44){
        const y=posed.getY(i)+rig.group.position.y;
        lowestFoot=Math.min(lowestFoot,y);
        if(base.getZ(i)>.5){heel+=y;heels++;}
        if(base.getZ(i)<-3){toe+=y;toes++;}
      }
      assert.ok(heels&&toes,'Actual heel and toe surface samples exist');
      assert.ok(heel/heels-toe/toes>1.5,'Tucked toes must sit below raised heels');
      assert.ok(lowestFoot< -45.9,'Toes must remain in contact with the floor');
    }
    if(movement==='catcow'||movement==='push'){
      assert.ok(Math.abs(rig.currentBounds().min.y+46.1352)<.002,`${movement}: surface must meet the fixed floor`);
      for(let i=0;i<posed.count;i++)assert.ok(posed.getY(i)+rig.group.position.y>=-46.137,`${movement}: floor penetration`);
    }
  }
  // The central anterior genital surface is omitted in the distributed asset.
  for(let i=0;i<base.count;i++)if(Math.abs(base.getX(i))<1.8&&base.getY(i)>-18.5&&base.getY(i)<-13)
    assert.ok(base.getZ(i)>=-3.2-.18*(base.getY(i)+14)+.06*base.getX(i)**2-.3);
});
