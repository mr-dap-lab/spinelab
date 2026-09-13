import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createSpineDynamics} from '../lib/spine-dynamics.js';
import {DEFAULT_BODY,movementPose} from '../lib/body-settings.js';
const parts=Array.from({length:23},(_,i)=>({kind:'disc',label:i<5?'L4–L5':i<17?'T5–T6':'C4–C5',center:new T.Vector3(0,i,Math.sin(i*.1)),thickness:.4}));

test('articulated joints preserve neutral rest, rigid transforms and regional rotation limits',()=>{
 const rig=createSpineDynamics(parts);rig.step(movementPose(DEFAULT_BODY),0,1/30,true);
 for(const p of parts)assert.ok(p.center.clone().applyMatrix4(rig.matrixAt(p.center.y,true)).distanceTo(p.center)<1e-10);
 rig.step({...movementPose(DEFAULT_BODY),flexion:400,twist:300,side:300},100,1/30,true);
 for(const j of rig.joints)j.q.forEach((q,i)=>assert.ok(Math.abs(q)<=j.limit[i]+1e-10));
 for(const p of parts){const s=new T.Vector3(),q=new T.Quaternion(),v=new T.Vector3();rig.matrixAt(p.center.y,true).decompose(v,q,s);assert.ok(s.distanceTo(new T.Vector3(1,1,1))<1e-10);}
});
test('spring dynamics converge consistently across frame rates, without unbounded shortening',()=>{
 function run(dt){const rig=createSpineDynamics(parts);for(let t=0;t<3;t+=dt)rig.step({...movementPose(DEFAULT_BODY),hinge:50,flexion:30},40,dt);return rig;}
 const a=run(1/30),b=run(1/60);
 a.joints.forEach((j,i)=>{j.q.forEach((q,k)=>assert.ok(Math.abs(q-b.joints[i].q[k])<.002));assert.ok(j.compression>=0&&j.compression<=j.thickness*.08);});
 const unloaded=createSpineDynamics(parts);unloaded.step(movementPose(DEFAULT_BODY),0,1/30,true);
 const loaded=createSpineDynamics(parts);loaded.step(movementPose(DEFAULT_BODY),60,1/30,true);
 assert.ok(loaded.joints[0].compression>unloaded.joints[0].compression);
});
