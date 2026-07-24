import { homedir } from 'node:os';
import { dirname,isAbsolute,join,parse,relative,resolve,sep } from 'node:path';
import { constants } from 'node:fs';
import { lstat,mkdir,open,readFile,realpath,rename,rm } from 'node:fs/promises';
import { filesystem,integrity } from './errors.js';
import { sha256 } from './hashing.js';
export function cacheRoot(env=process.env){return join(env.VGPU_CACHE_DIR||env.XDG_CACHE_HOME||join(homedir(),'.cache'),'vgpu','examples');}
const safe=s=>{if(!/^[a-z0-9.-]+$/.test(s))throw integrity('Invalid cache key');return s;};
const missing=e=>e?.code==='ENOENT';
async function stat(path){try{return await lstat(path)}catch(e){if(missing(e))return;throw e}}
export class ExamplesCache{
 constructor(root=cacheRoot()){this.root=resolve(root);}
 discoveryPath(){return join(this.root,'discovery.json');} metaPath(){return join(this.root,'discovery.meta.json');}
 revisionDir(rev){return join(this.root,'v1',safe(rev));} indexPath(rev){return join(this.revisionDir(rev),'index.json');} revisionMetaPath(rev){return join(this.revisionDir(rev),'verified.json');}
 manifestPath(rev,id){return join(this.revisionDir(rev),'manifests',`${safe(id)}.json`);} filePath(rev,hash){return join(this.revisionDir(rev),'files',safe(hash));}
 inside(path){const full=resolve(path),rel=relative(this.root,full);if(rel===''||(!rel.startsWith(`..${sep}`)&&rel!=='..'&&!isAbsolute(rel)))return full;throw filesystem('Cache path escapes cache root');}
 async secureRoot(create=false){const {root}=parse(this.root);let cursor=root;for(const part of relative(root,this.root).split(sep).filter(Boolean)){cursor=join(cursor,part);let s=await stat(cursor);if(!s&&create){try{await mkdir(cursor,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}s=await lstat(cursor);}if(!s)return false;if(s.isSymbolicLink()||!s.isDirectory())throw filesystem(`Unsafe cache directory: ${cursor}`);}if(resolve(await realpath(this.root))!==this.root)throw filesystem('Cache root contains a symlink');return true;}
 async secureParents(path,create=false){const full=this.inside(path);if(!await this.secureRoot(create))return false;let cursor=this.root;for(const part of relative(this.root,dirname(full)).split(sep).filter(Boolean)){cursor=join(cursor,part);let s=await stat(cursor);if(!s&&create){try{await mkdir(cursor,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}s=await lstat(cursor);}if(!s)return false;if(s.isSymbolicLink()||!s.isDirectory())throw filesystem(`Unsafe cache directory: ${cursor}`);}return true;}
 async read(path){try{const full=this.inside(path);if(!await this.secureParents(full))return;const s=await stat(full);if(!s)return;if(s.isSymbolicLink()||!s.isFile())throw filesystem(`Unsafe cache entry: ${full}`);const canonical=await realpath(full);if(relative(this.root,canonical).startsWith('..'))throw filesystem('Cache entry escapes cache root');const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);try{return await handle.readFile()}finally{await handle.close()}}catch(e){if(missing(e))return;if(e?.code?.startsWith?.('VGPU-'))throw e;throw filesystem(`Cannot read cache: ${e.message}`);}}
 async readJson(path){const b=await this.read(path);if(!b)return;try{return JSON.parse(b.toString('utf8'))}catch{throw integrity(`Corrupt cache entry: ${path}`)}}
 async write(path,bytes){let tmp;try{const full=this.inside(path);await this.secureParents(full,true);const leaf=await stat(full);if(leaf?.isSymbolicLink()||(leaf&&!leaf.isFile()))throw filesystem(`Unsafe cache entry: ${full}`);tmp=`${full}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;const handle=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}await this.secureParents(full);await rename(tmp,full);tmp=undefined;}catch(e){if(tmp)await rm(tmp,{force:true}).catch(()=>{});if(e?.code?.startsWith?.('VGPU-'))throw e;throw filesystem(`Cannot write cache: ${e.message}`);}}
 async writeVerified(path,bytes,expected){if(sha256(bytes)!==expected)throw integrity('Cached object hash mismatch');await this.write(path,bytes);}
 async mark(rev,indexSha256,now=new Date()){await this.write(this.revisionMetaPath(rev),Buffer.from(JSON.stringify({lastVerifiedAt:now.toISOString(),indexSha256})+'\n'));}
 async clear(){try{const s=await stat(this.root);if(!s)return;if(s.isSymbolicLink()||!s.isDirectory())throw filesystem('Unsafe cache root');await this.secureRoot();await rm(this.root,{recursive:true});}catch(e){if(e?.code?.startsWith?.('VGPU-'))throw e;throw filesystem(`Cannot clear cache: ${e.message}`);}}
}
