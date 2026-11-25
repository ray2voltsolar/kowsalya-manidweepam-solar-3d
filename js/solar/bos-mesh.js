// Shared indexed batches. Authoring in plan space keeps the routing coordinates
// identical to the installed geometry, including the vertical duct hardware.
import * as THREE from 'three';

const colours=new Map();
const minus=(a,b)=>a.map((n,i)=>n-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n);};
export class Batch {
  constructor(){this.positions=[];this.normals=[];this.colours=[];this.uv=[];this.indices=[];this.setFrame();}
  setFrame(x=0,y=0,z=0,normal=[0,1]){
    this.origin=[x,y,z];this.outward=normal;
  }
  vertex(p,n,c,uv){
    const [x,y,z]=this.origin;
    const [nx,ny]=this.outward;
    this.positions.push(x+ny*p[0]+nx*p[1],z+p[2],-y+nx*p[0]-ny*p[1]);
    this.normals.push(ny*n[0]+nx*n[1],n[2],nx*n[0]-ny*n[1]);
    if(!colours.has(c)) colours.set(c,new THREE.Color(c));
    const k=colours.get(c);this.colours.push(k.r,k.g,k.b);this.uv.push(...uv);
  }
  face(pts,c,uv,normals){
    const k=this.positions.length/3,n=unit(cross(minus(pts[1],pts[0]),minus(pts[2],pts[0])));
    const axis=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
    pts.forEach((p,i)=>this.vertex(p,normals?.[i]||n,c,uv?.[i]||[p[axis===0?1:0]*5,p[axis===2?1:2]*5]));
    for(let i=1;i<pts.length-1;i++)this.indices.push(k,k+i,k+i+1);
  }
  box(x,y,z,w,d,h,c,open=false){
    const a=x-w/2,b=x+w/2,l=y-d/2,r=y+d/2,f=z-h/2,t=z+h/2;
    const p=[[a,l,f],[b,l,f],[b,r,f],[a,r,f],[a,l,t],[b,l,t],[b,r,t],[a,r,t]];
    for(const face of [[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])this.face(face.map(i=>p[i]),c);
    if(!open)this.face([p[3],p[2],p[1],p[0]],c);
  }
  rod(a,b,r,c,sides=8,r2=r,cap=false,smooth=true){
    const axis=unit(minus(b,a)),u=unit(cross(axis,Math.abs(axis[2])>.9?[0,1,0]:[0,0,1])),v=cross(axis,u);
    const lower=[],upper=[],norm=[];
    for(let i=0;i<sides;i++){
      const angle=2*Math.PI*i/sides,n=u.map((e,j)=>e*Math.cos(angle)+v[j]*Math.sin(angle));
      norm.push(n);lower.push(a.map((e,j)=>e+r*n[j]));upper.push(b.map((e,j)=>e+r2*n[j]));
    }
    for(let i=0;i<sides;i++){const j=(i+1)%sides;this.face([lower[i],lower[j],upper[j],upper[i]],c,null,smooth?[norm[i],norm[j],norm[j],norm[i]]:null);}
    if(cap){this.face(lower.reverse(),c);this.face(upper,c);}
  }
  path(points,r,c,sides=6){
    // A continuous swept jacket avoids gaps at the elbows on exposed leads.
    let u,previousRing,previousNormal;
    points.forEach((p,i)=>{
      const before=unit(minus(p,points[Math.max(0,i-1)]));
      const after=unit(minus(points[Math.min(i+1,points.length-1)],p));
      const tangent=unit(before.map((v,j)=>v+after[j]));
      if(!u)u=unit(cross(tangent,Math.abs(tangent[2])>.9?[0,1,0]:[0,0,1]));
      const v=unit(cross(tangent,u));u=cross(v,tangent);
      const ring=[],normal=[];
      for(let j=0;j<sides;j++){
        const a=j*2*Math.PI/sides,n=u.map((k,m)=>k*Math.cos(a)+v[m]*Math.sin(a));
        normal.push(n);ring.push(p.map((k,m)=>k+n[m]*r));
      }
      if(previousRing)for(let j=0;j<sides;j++){
        const k=(j+1)%sides;
        this.face([previousRing[j],previousRing[k],ring[k],ring[j]],c,null,[previousNormal[j],previousNormal[k],normal[k],normal[j]]);
      }
      previousRing=ring;previousNormal=normal;
    });
  }
  // Die casting with a radiused silhouette and a second radius on the lid return.
  housing(x,y,z,w,d,h,r,c,steps=4){
    if(steps===1){this.box(x,y,z,w,d,h,c);return;}
    const rings=[];
    for(const [offset,inset] of [[-d/2,.012],[-d/2+.014,0],[d/2-.025,0],[d/2-.008,.007],[d/2,.023]]){
      const ring=[];
      for(let k=0;k<4;k++)for(let j=0;j<=steps;j++){
        const angle=(k+j/steps)*Math.PI/2;
        ring.push([x+(k===0||k===3?1:-1)*(w/2-r)+(r-inset)*Math.cos(angle),y+offset,
          z+(k<2?1:-1)*(h/2-r)+(r-inset)*Math.sin(angle)]);
      }
      rings.push(ring);
    }
    for(let k=1;k<rings.length;k++)for(let i=0;i<rings[k].length;i++){
      const j=(i+1)%rings[k].length;
      this.face([rings[k-1][i],rings[k][i],rings[k][j],rings[k-1][j]],c);
    }
    this.face(rings[0],c);this.face(rings.at(-1).reverse(),c);
  }
  mesh(group,name,material,shadow=false,ctx=null){
    if(!this.indices.length)return;
    const geometry=new THREE.BufferGeometry();
    for(const [key,values,size] of [['position',this.positions,3],['normal',this.normals,3],['color',this.colours,3],['uv',this.uv,2]])
      geometry.setAttribute(key,new THREE.Float32BufferAttribute(values,size));
    geometry.setIndex(this.indices);geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.userData.kind=name;
    mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);
    if(ctx){mesh.userData.occluderCategory='solar';ctx.registerOccluder?.(mesh);}
    return mesh;
  }
}
export const material=(name,roughness,metalness,props={})=>new THREE.MeshStandardMaterial({name,vertexColors:true,roughness,metalness,...props});

// Subtle grain breaks the perfectly even specular highlight on cast aluminium.
export function powderFinish(ctx){
  if(ctx.quality==='low')return material('Powder coated enclosures',.48,.15);
  const n=128,cv=document.createElement('canvas');cv.width=cv.height=n;
  const c=cv.getContext('2d'),im=c.createImageData(n,n),data=im.data;
  let seed=815;
  for(let i=0;i<data.length;i+=4){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const v=239+(seed>>>28);
    data.set([v,v,v,255],i);
  }
  c.putImageData(im,0,0);
  const map=new THREE.CanvasTexture(cv);map.colorSpace=THREE.SRGBColorSpace;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;map.magFilter=THREE.LinearFilter;
  map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  return material('Fine texture powder coat',.48,.16,{map});
}
const labels=[
  ['DANGER','PV ARRAY  /  LIVE DC','ISOLATE BEFORE SERVICE'],
  ['STRING INVERTER','UTILITY   /   3 PHASE','GRID CONNECTED    •    IP66'],
  ['AC DISTRIBUTION','SOLAR GENERATION','MAIN AC ISOLATOR'],
  ['GENERATION','RUN    GRID    ALARM','LOCAL CONTROL'],
  ['DRY POWDER','ABC   •   4 kg','PULL PIN    AIM LOW'],
  ['LT PANEL','SOLAR INCOMER','415 V    •    3 PHASE'],
  ['PV MONITOR','DATA LOGGER','LINK    /    COM'],
  ['ELECTRICAL DATA','DC INPUT   |   AC OUTPUT','S/N   PV–125–03'],
  ['INV–01','STRING INVERTER',''],
  ['INV–02','STRING INVERTER',''],
  ['INV–03','STRING INVERTER',''],
  ['INV–04','STRING INVERTER',''],
  ['AC OUTPUT','POWER    /    GRID','ONLINE'],
];
export function labelSheet(quality,aniso,inverters=[]){
  const cellW=quality==='high'?512:256,cellH=cellW/3.2;
  const cv=document.createElement('canvas');cv.width=cellW;cv.height=Math.ceil(cellH*labels.length);
  const c=cv.getContext('2d');
  labels.forEach(([a,b,d],i)=>{
    if(i>=8 && i<12){const inv=inverters[i-8];if(inv){a=inv.id;b=inv.kw+' kW   /   3 PHASE';d='GRID CONNECTED';}}
    const yy=i*cellH;c.save();c.translate(0,yy);c.scale(cellW/512,cellH/160);
    const hazard=i===0, id=i>=8;
    c.fillStyle=hazard?'#f6bd28':i===12?'#577c76':(i===3||id)?'#28363c':'#d7dcda';c.fillRect(0,0,512,160);
    c.fillStyle=hazard?'#231e15':i===12?'#1c302f':(i===3||id)?'#c9dad8':'#344249';
    if(hazard){
      c.beginPath();c.moveTo(48,28);c.lineTo(86,103);c.lineTo(9,103);c.closePath();c.lineWidth=5;c.strokeStyle=c.fillStyle;c.stroke();
      c.beginPath();c.moveTo(53,45);c.lineTo(34,76);c.lineTo(47,74);c.lineTo(43,92);c.lineTo(63,62);c.lineTo(49,65);c.fill();
    }
    const x=hazard?100:20;
    c.font='bold 41px Arial';c.fillText(a,x,52);c.fillRect(x,65,385,2);
    c.font='bold 24px Arial';c.fillText(b,x,100);c.font='19px monospace';c.fillText(d,x,133);
    c.restore();
  });
  const map=new THREE.CanvasTexture(cv);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=Math.min(8,aniso||1);
  return material('Screen printed equipment plates',.62,.07,{map});
}
export function plate(batch,id,x,y,z,w,h,south=false){
  const normal=Array.isArray(south)?south:[0,south?-1:1],v1=1-(id+.012)/labels.length,v0=1-(id+.988)/labels.length;
  const at=(u,v)=>[x-normal[1]*u,y+normal[0]*u,z+v];
  batch.face([at(-w/2,-h/2),at(w/2,-h/2),at(w/2,h/2),at(-w/2,h/2)],
    0xffffff,[[.005,v0],[.995,v0],[.995,v1],[.005,v1]]);
}

