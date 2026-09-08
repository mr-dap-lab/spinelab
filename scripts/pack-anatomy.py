"""Package unaltered BodyParts3D surfaces into one indexed GLB (axis/scale only)."""
import json,struct,pathlib,hashlib
src=pathlib.Path('/tmp/spinelab-bodyparts');out=pathlib.Path('public/anatomy');out.mkdir(exist_ok=True)
bones=[12519,12520,12521,12522,12523,12524,12525,9165,9187,9209,9248,9922,9945,9968,9991,10014,10037,10059,10081,13072,13073,13074,13075,13076,16202]
discs=[25058,13896,13897,13898,13899,13900,10458,13495,13500,13501,13502,13503,13504,13505,13506,13507,13508,13509,16033,16034,16035,16036,16037]
labels=[f'C{i}' for i in range(1,8)]+[f'T{i}' for i in range(1,13)]+[f'L{i}' for i in range(1,6)]+['S1']
levels=[f'{labels[i]}–{labels[i+1]}' for i in range(1,24)]
gltf={'asset':{'version':'2.0','generator':'SpineLab BodyParts3D packer; original surfaces, vertex welding and coordinate transform only','copyright':'BodyParts3D, © The Database Center for Life Science; CC BY-SA 2.1 Japan; STL conversion Kevin Mattheus Moerman'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'buffers':[],'bufferViews':[],'accessors':[]};binary=bytearray();metadata=[]
def view(data,target):
 while len(binary)%4:binary.append(0)
 idx=len(gltf['bufferViews']);gltf['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data),'target':target});binary.extend(data);return idx
for k,ident in enumerate(bones+discs):
 b=(src/f'FMA{ident}.stl').read_bytes();verts=[];indices=[];seen={}
 for o in range(84,len(b),50):
  for j in range(3):
   x,y,z=struct.unpack_from('<fff',b,o+12+j*12);p=(-x*.04,(z-1140)*.04,(y+65)*.04);key=tuple(round(a,5) for a in p)
   if key not in seen:seen[key]=len(verts);verts.append(p)
   indices.append(seen[key])
 assert len(verts)<65536
 lo=[min(p[i] for p in verts) for i in range(3)];hi=[max(p[i] for p in verts) for i in range(3)]
 va=len(gltf['accessors']);gltf['accessors'].append({'bufferView':view(struct.pack('<'+'f'*len(verts)*3,*[a for p in verts for a in p]),34962),'componentType':5126,'count':len(verts),'type':'VEC3','min':lo,'max':hi})
 ia=len(gltf['accessors']);gltf['accessors'].append({'bufferView':view(struct.pack('<'+'H'*len(indices),*indices),34963),'componentType':5123,'count':len(indices),'type':'SCALAR'})
 label=labels[k] if k<len(bones) else levels[k-len(bones)];kind='bone' if k<len(bones) else 'disc'
 node={'name':f'FMA{ident}','mesh':len(gltf['meshes']),'extras':{'fma':f'FMA{ident}','kind':kind,'label':label,'index':k if kind=='bone' else k-len(bones)}}
 gltf['scenes'][0]['nodes'].append(len(gltf['nodes']));gltf['nodes'].append(node);gltf['meshes'].append({'primitives':[{'attributes':{'POSITION':va},'indices':ia,'mode':4}]})
 metadata.append({**node['extras'],'min':lo,'max':hi,'vertices':len(verts),'triangles':len(indices)//3})
gltf['buffers']=[{'byteLength':len(binary)}];js=json.dumps(gltf,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binary+=b'\x00'*((-len(binary))%4)
blob=struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
(out/'spine.glb').write_bytes(blob);(out/'manifest.json').write_text(json.dumps(metadata,indent=2));(out/'sources.json').write_text((src/'sources.json').read_text())
print(f'Packed {len(metadata)} original anatomical surfaces, {sum(m["triangles"] for m in metadata):,} triangles, {len(blob)/1e6:.2f} MB GLB; sha256 {hashlib.sha256(blob).hexdigest()}')
