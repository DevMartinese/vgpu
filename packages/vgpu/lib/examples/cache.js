import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir,readFile,writeFile,rename,rm } from 'node:fs/promises';
import { filesystem, integrity } from './errors.js';
import { sha256 } from './hashing.js';
export function cacheRoot(env=process.env){return join(env.VGPU_CACHE_DIR||env.XDG_CACHE_HOME||join(homedir(),'.cache'),'vgpu','examples');}
const safe=(s)=>{if(!/^[a-z0-9.-]+$/.test(s))throw integrity('Invalid cache key');return s;};
export class ExamplesCache{
 constructor(root=cacheRoot()){this.root=root;}
 discoveryPath(){return join(this.root,'discovery.json');} metaPath(){return join(this.root,'discovery.meta.json');}
 revisionDir(rev){return join(this.root,'v1',safe(rev));} indexPath(rev){return join(this.revisionDir(rev),'index.json');} revisionMetaPath(rev){return join(this.revisionDir(rev),'verified.json');}
 manifestPath(rev,id){return join(this.revisionDir(rev),'manifests',`${safe(id)}.json`);} filePath(rev,hash){return join(this.revisionDir(rev),'files',safe(hash));}
 async read(path){try{return await readFile(path);}catch(e){if(e.code==='ENOENT')return undefined;throw filesystem(`Cannot read cache: ${e.message}`);}}
 async readJson(path){const b=await this.read(path);if(!b)return undefined;try{return JSON.parse(b.toString('utf8'));}catch{throw integrity(`Corrupt cache entry: ${path}`);}}
 async write(path,bytes){try{await mkdir(join(path,'..'),{recursive:true,mode:0o700});const tmp=`${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;await writeFile(tmp,bytes,{mode:0o600});await rename(tmp,path);}catch(e){throw filesystem(`Cannot write cache: ${e.message}`);}}
 async writeVerified(path,bytes,expected){if(sha256(bytes)!==expected)throw integrity('Cached object hash mismatch');await this.write(path,bytes);}
 async mark(rev,indexSha256,now=new Date()){await this.write(this.revisionMetaPath(rev),Buffer.from(JSON.stringify({lastVerifiedAt:now.toISOString(),indexSha256})+'\n'));}
 async clear(){try{await rm(this.root,{recursive:true,force:true});}catch(e){throw filesystem(`Cannot clear cache: ${e.message}`);}}
}
