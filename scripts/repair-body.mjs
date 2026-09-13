// Reconstruct a closed outer skin from the scan's anterior/posterior envelopes.
// The original dataset registration and scale are retained (6 mm sampling).
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const file=fs.readFileSync('public/anatomy/body.glb');
const asset=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
let geo;asset.scene.traverse(o=>{if(o.isMesh)geo=o.geometry;});geo.computeBoundingBox();
const step=.24,min=geo.boundingBox.min.clone().addScalar(-step*2),max=geo.boundingBox.max.clone().addScalar(step*2);
const nx=Math.ceil((max.x-min.x)/step)+1,ny=Math.ceil((max.y-min.y)/step)+1,nz=Math.ceil((max.z-min.z)/step)+1;
const front=new Float32Array(nx*ny).fill(Infinity),back=new Float32Array(nx*ny).fill(-Infinity),p=geo.attributes.position,ix=geo.index.array;
for(let i=0;i<ix.length;i+=3){
 const a=new T.Vector3().fromBufferAttribute(p,ix[i]),b=new T.Vector3().fromBufferAttribute(p,ix[i+1]),c=new T.Vector3().fromBufferAttribute(p,ix[i+2]);
 const d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(d)<1e-10)continue;
 for(let y=Math.max(0,Math.ceil((Math.min(a.y,b.y,c.y)-min.y)/step));y<=Math.min(ny-1,Math.floor((Math.max(a.y,b.y,c.y)-min.y)/step));y++)
 for(let x=Math.max(0,Math.ceil((Math.min(a.x,b.x,c.x)-min.x)/step));x<=Math.min(nx-1,Math.floor((Math.max(a.x,b.x,c.x)-min.x)/step));x++){
  const xx=min.x+x*step,yy=min.y+y*step,u=((b.y-c.y)*(xx-c.x)+(c.x-b.x)*(yy-c.y))/d,v=((c.y-a.y)*(xx-c.x)+(a.x-c.x)*(yy-c.y))/d;
  if(u<-.00001||v<-.00001||u+v>1.00001)continue;const z=u*a.z+v*b.z+(1-u-v)*c.z,k=y*nx+x;front[k]=Math.min(front[k],z);back[k]=Math.max(back[k],z);
 }
}
for(let pass=0;pass<2;pass++){const f=front.slice(),b=back.slice();for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){const k=y*nx+x;if(Number.isFinite(f[k]))continue;const neighbors=[k-1,k+1,k-nx,k+nx].filter(j=>Number.isFinite(f[j]));if(neighbors.length>=3){front[k]=neighbors.reduce((s,j)=>s+f[j],0)/neighbors.length;back[k]=neighbors.reduce((s,j)=>s+b[j],0)/neighbors.length;}}}
const field=new Float32Array(nx*ny*nz);for(let z=0;z<nz;z++)for(let k=0;k<nx*ny;k++)field[z*nx*ny+k]=Number.isFinite(front[k])?Math.min(min.z+z*step-front[k],back[k]-min.z-z*step):-step;
const positions=[],indices=[],cache=new Map(),tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],offset=[0,1,1+nx,nx,nx*ny,nx*ny+1,nx*ny+nx+1,nx*ny+nx];
function point(k){const z=Math.floor(k/(nx*ny)),y=Math.floor((k-z*nx*ny)/nx),x=k%nx;return new T.Vector3(min.x+x*step,min.y+y*step,min.z+z*step);}
function vertex(a,b){const key=Math.min(a,b)*field.length+Math.max(a,b);if(cache.has(key))return cache.get(key);const v=point(a).lerp(point(b),field[a]/(field[a]-field[b])),id=positions.length/3;positions.push(...v);cache.set(key,id);return id;}
function face(ids,outward){const a=new T.Vector3().fromArray(positions,ids[0]*3),b=new T.Vector3().fromArray(positions,ids[1]*3),c=new T.Vector3().fromArray(positions,ids[2]*3);if(b.sub(a).cross(c.sub(a)).dot(outward)<0)ids.reverse();indices.push(...ids);}
for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
 const root=(z*ny+y)*nx+x,corners=offset.map(o=>root+o),count=corners.reduce((s,k)=>s+(field[k]>0?1:0),0);if(!count||count===8)continue;
 for(const t of tetra){const inside=t.map(j=>corners[j]).filter(k=>field[k]>0),outside=t.map(j=>corners[j]).filter(k=>field[k]<=0);if(!inside.length||!outside.length)continue;
 const direction=point(outside[0]).sub(point(inside[0]));
 if(inside.length===1||outside.length===1){const single=inside.length===1?inside[0]:outside[0],others=inside.length===1?outside:inside;face(others.map(k=>vertex(single,k)),direction);}
 else {const [a,b]=inside,[c,d]=outside,A=vertex(a,c),B=vertex(a,d),C=vertex(b,c),D=vertex(b,d);face([A,B,C],direction);face([B,D,C],direction);}
 }
}
const neighbors=Array.from({length:positions.length/3},()=>new Set());for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3];neighbors[a].add(b);neighbors[b].add(a);}
// Taubin smoothing removes voxel stair steps with little overall shrinkage.
for(let pass=0;pass<32;pass++){const old=positions.slice(),lambda=pass%2?-.53:.5;for(let i=0;i<neighbors.length;i++){const ns=neighbors[i];if(!ns.size)continue;for(let a=0;a<3;a++){let sum=0;for(const j of ns)sum+=old[j*3+a];positions[i*3+a]+=lambda*(sum/ns.size-old[i*3+a]);}}}
const clean=new T.BufferGeometry();clean.setAttribute('position',new T.Float32BufferAttribute(positions,3));clean.setIndex(indices);clean.computeVertexNormals();clean.computeBoundingBox();
const buffers=[Buffer.from(clean.attributes.position.array.buffer),Buffer.from(new Uint32Array(indices).buffer),Buffer.from(clean.attributes.normal.array.buffer)];let offsetBytes=0;const views=buffers.map((b,i)=>{const v={buffer:0,byteOffset:offsetBytes,byteLength:b.length,target:i===1?34963:34962};offsetBytes+=b.length;return v;});
const count=positions.length/3,json={asset:{version:'2.0',copyright:'BodyParts3D / DBCLS, CC BY-SA 2.1 Japan; modified outer skin'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:2},indices:1}]}],buffers:[{byteLength:offsetBytes}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min:clean.boundingBox.min.toArray(),max:clean.boundingBox.max.toArray()},{bufferView:1,componentType:5125,count:indices.length,type:'SCALAR'},{bufferView:2,componentType:5126,count,type:'VEC3'}]};
let js=Buffer.from(JSON.stringify(json));js=Buffer.concat([js,Buffer.alloc((4-js.length%4)%4,32)]);const bin=Buffer.concat(buffers),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+js.length+bin.length,8);jh.writeUInt32LE(js.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);fs.writeFileSync('public/anatomy/body.glb',Buffer.concat([header,jh,js,bh,bin]));const meta=JSON.parse(fs.readFileSync('public/anatomy/body-source.json'));meta.processing+=' Closed outer skin reconstruction at 6 mm with Taubin smoothing; scan normals regenerated.';meta.vertices=count;meta.triangles=indices.length/3;fs.writeFileSync('public/anatomy/body-source.json',JSON.stringify(meta,null,2));console.log({vertices:count,triangles:indices.length/3});
