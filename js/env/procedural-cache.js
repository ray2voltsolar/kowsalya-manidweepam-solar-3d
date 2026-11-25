// Precomputed outputs of the deterministic builders. Each record is [name,width,height,byte lengths]
// followed by its buffer(s). Inflate natively, then give WebGL views into the same allocation.
export async function readPack(name) {
  const url = new URL('../../assets/' + name + '.bin.gz', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(name + ' ' + response.status);
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const headerSize = new DataView(bytes.buffer).getUint32(0, true);
  let pos = 4 + headerSize;
  const records = JSON.parse(new TextDecoder().decode(bytes.subarray(4, pos)));
  const pack = {};
  for (const [key, width, height, lengths] of records) {
    const levels = lengths.map(length => {
      const start = pos; pos += length;
      return bytes.subarray(start, pos);
    });
    pack[key] = {width, height, levels};
  }
  if (pos !== bytes.length) throw new Error('Incomplete ' + name);
  return pack;
}

export function packedTexture(THREE, record, flipY) {
  let {width, height} = record;
  const texture = new THREE.DataTexture(record.levels[0], width, height);
  texture.mipmaps = record.levels.map(data => {
    const image = {data, width, height};
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
    return image;
  });
  texture.flipY = flipY;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Prototypes use the original attribute types and vertex order.
export function cachedGeometry(THREE,pack,name) {
  const geo=new THREE.BufferGeometry();
  for(const key of ['position','normal','uv','color','finish','index']){
    const record=pack[name+'|'+key];
    if(!record)continue;
    const Type=key==='index'?(record.height===2?Uint16Array:Uint32Array):Float32Array;
    const src=record.levels[0];
    const values=src.byteOffset%Type.BYTES_PER_ELEMENT===0 ?
      new Type(src.buffer,src.byteOffset,src.byteLength/Type.BYTES_PER_ELEMENT) : new Type(src.slice().buffer);
    const attr=new THREE.BufferAttribute(values,record.width);
    if(key==='index')geo.setIndex(attr);else geo.setAttribute(key,attr);
  }
  return geo;
}

