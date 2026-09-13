"""Cluster the matching FMA7163 skin mesh and retain SpineLab's exact axis transform."""
import struct,json,pathlib,hashlib
source=pathlib.Path('/tmp/spinelab-skin.stl'); data=source.read_bytes()
cells={}; sums=[]; indices=[]; faces=set()
for face in struct.iter_unpack('<12fH',data[84:]):
 tri=[]
 for j in range(3):
  x,y,z=face[3+j*3:6+j*3]
  step=4.0 if z>1450 else 8.0
  key=(step,round(x/step),round(y/step),round(z/step))
  if key not in cells: cells[key]=len(sums);sums.append([0.,0.,0.,0])
  n=cells[key];a=sums[n];a[0]+=x;a[1]+=y;a[2]+=z;a[3]+=1;tri.append(n)
 if len(set(tri))==3 and tuple(sorted(tri)) not in faces:
  faces.add(tuple(sorted(tri)));indices.extend(tri)
verts=[(-a[0]/a[3]*.04,(a[2]/a[3]-1140)*.04,(a[1]/a[3]+65)*.04) for a in sums]
positions=struct.pack('<'+'f'*len(verts)*3,*[v for p in verts for v in p]);ib=struct.pack('<'+'I'*len(indices),*indices)
meta={'source':'https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/stl/FMA7163.stl','sha256':hashlib.sha256(data).hexdigest(),'license':'CC BY-SA 2.1 Japan','vertices':len(verts),'triangles':len(indices)//3,'processing':'Vertex clustering 8 mm, 4 mm head; same uniform coordinate transform as spine.glb. No independent body scaling.'}
g={'asset':{'version':'2.0','copyright':'BodyParts3D © The Database Center for Life Science; CC BY-SA 2.1 Japan; STL conversion Kevin Mattheus Moerman'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':'FMA7163 skin'}],'meshes':[{'primitives':[{'attributes':{'POSITION':0},'indices':1}]}],'buffers':[{'byteLength':len(positions)+len(ib)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(positions),'target':34962},{'buffer':0,'byteOffset':len(positions),'byteLength':len(ib),'target':34963}],'accessors':[{'bufferView':0,'componentType':5126,'count':len(verts),'type':'VEC3','min':[min(v[i] for v in verts) for i in range(3)],'max':[max(v[i] for v in verts) for i in range(3)]},{'bufferView':1,'componentType':5125,'count':len(indices),'type':'SCALAR'}]}
js=json.dumps(g,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binary=positions+ib
blob=struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
pathlib.Path('public/anatomy/body.glb').write_bytes(blob);pathlib.Path('public/anatomy/body-source.json').write_text(json.dumps(meta,indent=2))
print(meta);print('Bounds',g['accessors'][0]['min'],g['accessors'][0]['max'])
