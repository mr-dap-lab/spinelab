"""Download the selected BodyParts3D 3.0 source meshes, keeping provenance."""
import json, pathlib, urllib.request, concurrent.futures, hashlib
root=pathlib.Path('/tmp/spinelab-bodyparts');root.mkdir(exist_ok=True)
base='https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/stl/'
bones=[12519,12520,12521,12522,12523,12524,12525,9165,9187,9209,9248,9922,9945,9968,9991,10014,10037,10059,10081,13072,13073,13074,13075,13076,16202]
discs=[25058,13896,13897,13898,13899,13900,10458,13495,13500,13501,13502,13503,13504,13505,13506,13507,13508,13509,16033,16034,16035,16036,16037]
def get(ident):
 name=f'FMA{ident}.stl';path=root/name
 if not path.exists():
  with urllib.request.urlopen(base+name,timeout=45) as response: data=response.read()
  count=int.from_bytes(data[80:84],'little');assert len(data)==84+count*50, name
  path.write_bytes(data)
 return {'id':f'FMA{ident}','source':base+name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: entries=list(pool.map(get,bones+discs))
(root/'sources.json').write_text(json.dumps(entries,indent=2))
print(f'Downloaded and verified {len(entries)} meshes ({sum(p.stat().st_size for p in root.glob("*.stl"))/1e6:.1f} MB).')
