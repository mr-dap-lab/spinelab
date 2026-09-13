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
