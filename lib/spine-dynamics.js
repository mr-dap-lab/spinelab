import * as T from 'three';
const rad=T.MathUtils.degToRad, clamp=T.MathUtils.clamp;
// Reduced-order mechanics, not patient-calibrated constants. Units: radians,
// seconds, N·m, kg·m². The source geometry uses 40 scene units per metre.
export function createSpineDynamics(parts) {
  const joints=parts.filter(p=>p.kind==='disc').sort((a,b)=>a.center.y-b.center.y).map(p=>{
    const region=(p.label||'L4–L5')[0];
    return {pivot:p.center.clone(),label:p.label,thickness:p.thickness||.3,
      stiffness:region==='L'?[32,75,40]:region==='T'?[65,42,60]:[24,22,24],
      limit:(region==='L'?[8,2,6]:region==='T'?[4,4,4]:[7,7,6]).map(rad),
      q:[0,0,0],v:[0,0,0],compression:0,moment:0};
  });
  const sacrum=parts.find(p=>p.kind==='bone'&&p.label==='S1');
  const pelvis=new T.Vector3(0,sacrum?sacrum.center.y-2.5:Math.min(...joints.map(j=>j.pivot.y))-2.7,-1);
  const top=Math.max(...joints.map(j=>j.pivot.y))+1;
  let frames=[],settled=false;
  function step(pose,load,dt=1/30,instant=false) {
    const desired=[-pose.flexion,pose.twist,-pose.side].map(rad);
    // Minimum elastic-energy allocation: compliant segments contribute more,
    // with excess redistributed only to joints below their motion limits.
    const targets=joints.map(()=>[0,0,0]);
    for(let axis=0;axis<3;axis++) {
      let remaining=desired[axis], active=joints.map((_,i)=>i);
      for(let pass=0;pass<joints.length && active.length;pass++) {
        const inv=active.reduce((n,i)=>n+1/joints[i].stiffness[axis],0), next=[];
        let allocated=0;
        for(const i of active) {
          const value=remaining/(joints[i].stiffness[axis]*inv);
          if(Math.abs(value)>joints[i].limit[axis]) {targets[i][axis]=Math.sign(value)*joints[i].limit[axis];allocated+=targets[i][axis];}
          else next.push(i);
        }
        if(next.length===active.length){for(const i of active)targets[i][axis]=remaining/(joints[i].stiffness[axis]*inv);break;}
        remaining-=allocated;active=next;
      }
    }
    const root=new T.Matrix4().makeTranslation(-pelvis.x,-pelvis.y,-pelvis.z);
    root.premultiply(new T.Matrix4().makeRotationX(rad(-pose.hinge)));
    root.premultiply(new T.Matrix4().makeTranslation(pelvis.x,pelvis.y-pose.drop*26,pelvis.z+pose.retreat*26));
    const substeps=Math.max(1,Math.ceil(Math.min(dt,.1)*120)),h=Math.min(dt,.1)/substeps;
    let activity=0;
    for(let k=0;k<substeps;k++)for(let i=0;i<joints.length;i++) {
      const j=joints[i],above=Math.max(0,(top-j.pivot.y)/40);
      // External load only: posture controller supplies the opposing torque.
      // Residual compliance grows with the gravity moment of the held load.
      j.moment=load*9.81*above*Math.sin(rad(pose.hinge+pose.flexion*.5));
      for(let a=0;a<3;a++) {
        const stiffness=j.stiffness[a],drive=stiffness*12,inertia=.035+.08*above;
        const gravity=a===0?-j.moment/joints.length:0;
        const target=clamp(targets[i][a]+gravity/(drive+stiffness),-j.limit[a],j.limit[a]);
        if(instant){j.q[a]=target;j.v[a]=0;continue;}
        const damping=2*Math.sqrt(inertia*(drive+stiffness));
        // Implicit velocity integration is stable at a fixed bounded substep.
        j.v[a]=(j.v[a]+h*(drive+stiffness)*(target-j.q[a])/inertia)/(1+h*damping/inertia+h*h*(drive+stiffness)/inertia);
        j.q[a]=clamp(j.q[a]+h*j.v[a],-j.limit[a],j.limit[a]);
        if(Math.abs(j.q[a])>=j.limit[a])j.v[a]=0;
        activity+=Math.abs(j.v[a])+Math.abs(target-j.q[a]);
      }
      const shortening=Math.min(j.thickness*.08,load*9.81*Math.abs(Math.cos(rad(pose.hinge)))/1.2e6*40);
      j.compression=instant?shortening:T.MathUtils.lerp(j.compression,shortening,1-Math.exp(-h*12));
      activity+=Math.abs(shortening-j.compression);
    }
    settled=activity<1e-5;
    let m=root.clone();frames=[{y:pelvis.y,m:m.clone()}];
    for(const j of joints) {
      frames.push({y:j.pivot.y-j.thickness*.5,m:m.clone()});
      const rotation=new T.Matrix4().makeRotationFromEuler(new T.Euler(...j.q,'YXZ'));
      const local=new T.Matrix4().makeTranslation(j.pivot.x,j.pivot.y,j.pivot.z).multiply(rotation).multiply(new T.Matrix4().makeTranslation(-j.pivot.x,-j.pivot.y-j.compression,-j.pivot.z));
      m.multiply(local);frames.push({y:j.pivot.y+j.thickness*.5,m:m.clone()});
    }
    frames.push({y:top+10,m:m.clone()});
    return !settled;
  }
  function matrixAt(y,rigid=false) {
    let upper=frames.findIndex(f=>f.y>=y);if(upper<=0)return frames[upper<0?frames.length-1:0].m.clone();
    const a=frames[upper-1],b=frames[upper],t=clamp((y-a.y)/(b.y-a.y),0,1);
    if(rigid)return (t<.5?a:b).m.clone();
    const pa=new T.Vector3(),pb=new T.Vector3(),qa=new T.Quaternion(),qb=new T.Quaternion(),scale=new T.Vector3();
    a.m.decompose(pa,qa,scale);b.m.decompose(pb,qb,scale);
    return new T.Matrix4().compose(pa.lerp(pb,t),qa.slerp(qb,t),new T.Vector3(1,1,1));
  }
  return {joints,pelvis,top,step,matrixAt,get settled(){return settled;}};
}
