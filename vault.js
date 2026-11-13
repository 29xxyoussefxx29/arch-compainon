/* Local encrypted storage. Passwords and unwrapped keys are never persisted. */
(() => {
  'use strict';
  const encoder=new TextEncoder(),decoder=new TextDecoder(),ITERATIONS=600000;
  const random=length=>crypto.getRandomValues(new Uint8Array(length));
  const bytes=value=>value instanceof Uint8Array?value:new Uint8Array(value);
  function base64(value){const input=bytes(value);let result='';for(let i=0;i<input.length;i+=32768)result+=String.fromCharCode(...input.subarray(i,i+32768));return btoa(result);}
  function unbase64(value){if(typeof value!=='string'||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Invalid encrypted backup.');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
  const importKey=raw=>crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  async function derive(password,salt,iterations=ITERATIONS){
    if(iterations!==ITERATIONS)throw new Error('Unsupported encryption settings.');
    const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encrypt(key,content,context){const iv=random(12);const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context),tagLength:128},key,content);return {iv,cipher};}
  async function decrypt(key,box,context){if(bytes(box.iv).length!==12)throw new Error('Invalid encrypted data.');return crypto.subtle.decrypt({name:'AES-GCM',iv:box.iv,additionalData:encoder.encode(context),tagLength:128},key,box.cipher);}
  function validWorkspace(value){return value&&Array.isArray(value.projects)&&value.projects.every(p=>typeof p.id==='string'&&typeof p.name==='string'&&typeof p.deadline==='string'&&Array.isArray(p.tasks)&&p.tasks.every(t=>typeof t.id==='string'&&typeof t.text==='string'&&typeof t.done==='boolean')&&Array.isArray(p.notes)&&p.notes.every(n=>typeof n.id==='string'&&typeof n.text==='string'&&typeof n.date==='string'));}
  function validatePassword(password){if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('Use a password or passphrase with 12–256 characters.');}
  const portable=box=>({iv:base64(box.iv),cipher:base64(box.cipher)});
  const unpack=box=>({iv:unbase64(box.iv),cipher:unbase64(box.cipher)});

  function createVault({name='studio-companion-vault',legacyName='studio-companion-files',storage=localStorage}={}){
    let database=null,key=null,account=null,closing=false,pending=Promise.resolve(),epoch=0;
    async function db(){
      if(database)return database;
      database=await new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>{const d=request.result;d.createObjectStore('config',{keyPath:'id'});const s=d.createObjectStore('records',{keyPath:'id'});s.createIndex('projectId','projectId');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other Studio Companion windows and try again.'));});
      database.onversionchange=()=>{database.close();database=null;key=null;epoch++;};return database;
    }
    async function tx(stores,mode,work){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(stores,mode);let request;t.oncomplete=()=>resolve(request?.result);t.onabort=()=>reject(t.error||new Error('Could not save the encrypted workspace.'));t.onerror=()=>{};try{request=work(t);}catch(error){t.abort();reject(error);}});}
    function requireKey(){if(!key||closing)throw new Error('Your workspace is locked. Log in to continue.');return key;}
    function queue(work){requireKey();const activeKey=key;const result=pending.then(()=>work(activeKey));pending=result.catch(()=>{});return result;}
    const config=()=>tx(['config'],'readonly',t=>t.objectStore('config').get('account'));
    async function status(){const a=await config();return {configured:!!a,username:a?.username||''};}
    async function readLegacy(){
      const raw=storage.getItem('studio-companion-v1'),workspace=raw?JSON.parse(raw):{projects:[]};
      if(!validWorkspace(workspace))throw new Error('The existing workspace could not be read. Keep your original files and backup before continuing.');
      const legacy=await new Promise((resolve,reject)=>{const r=indexedDB.open(legacyName,1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('files',{keyPath:'id'});s.createIndex('projectId','projectId');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Close older Studio Companion windows first.'));});
      try{const files=await new Promise((resolve,reject)=>{const t=legacy.transaction('files','readonly'),r=t.objectStore('files').getAll();t.oncomplete=()=>resolve(r.result);t.onabort=()=>reject(t.error);});return {workspace,files};}finally{legacy.close();}
    }
    async function cleanupLegacy(){
      const legacy=await new Promise((resolve,reject)=>{const r=indexedDB.open(legacyName,1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('files',{keyPath:'id'});s.createIndex('projectId','projectId');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{await new Promise((resolve,reject)=>{const t=legacy.transaction('files','readwrite');t.objectStore('files').clear();t.oncomplete=resolve;t.onabort=()=>reject(t.error);});storage.removeItem('studio-companion-v1');}finally{legacy.close();}
    }
    async function sealFile(activeKey,file){const {blob,...meta}=file;return {id:file.id,projectId:file.projectId,meta:await encrypt(activeKey,encoder.encode(JSON.stringify(meta)),'file-meta:'+file.id),body:await encrypt(activeKey,await blob.arrayBuffer(),'file-body:'+file.id)};}
    async function create(username,password){
      validatePassword(password);username=username.trim();if(username.length<3||username.length>40)throw new Error('Choose a username with 3–40 characters.');
      if(await config())throw new Error('An account already exists. Log in instead.');
      const legacy=await readLegacy(),rawKey=random(32),salt=random(16),activeKey=await importKey(rawKey);
      const wrapping=await derive(password,salt),wrapped=await encrypt(wrapping,rawKey,'studio-companion-key-v1');rawKey.fill(0);
      const a={id:'account',version:1,username,salt,iterations:ITERATIONS,wrapped,cleanupPending:true};
      const records=[{id:'workspace',box:await encrypt(activeKey,encoder.encode(JSON.stringify(legacy.workspace)),'workspace')}];
      for(const file of legacy.files)records.push(await sealFile(activeKey,file));
      await tx(['config','records'],'readwrite',t=>{const request=t.objectStore('config').get('account');request.onsuccess=()=>{if(request.result){t.abort();return;}t.objectStore('config').put(a);for(const record of records)t.objectStore('records').put(record);};});
      // The new encrypted copy is committed before plaintext migration copies are removed.
      await cleanupLegacy();a.cleanupPending=false;await tx(['config'],'readwrite',t=>t.objectStore('config').put(a));
      account=a;key=activeKey;closing=false;epoch++;return legacy.workspace;
    }
    async function openKey(a,password){const raw=await decrypt(await derive(password,a.salt,a.iterations),a.wrapped,'studio-companion-key-v1');try{return await importKey(raw);}finally{new Uint8Array(raw).fill(0);}}
    async function login(username,password){
      const a=await config();if(!a)throw new Error('Create your local account first.');
      let next;try{next=await openKey(a,password);if(username.trim().toLowerCase()!==a.username.toLowerCase())throw new Error();}catch{throw new Error('Incorrect username or password. Try again.');}
      const record=await tx(['records'],'readonly',t=>t.objectStore('records').get('workspace'));
      const workspace=JSON.parse(decoder.decode(await decrypt(next,record.box,'workspace')));if(!validWorkspace(workspace))throw new Error('The encrypted workspace is damaged. Restore a backup in a separate workspace.');
      if(a.cleanupPending){await cleanupLegacy();a.cleanupPending=false;await tx(['config'],'readwrite',t=>t.objectStore('config').put(a));}
      account=a;key=next;closing=false;epoch++;return workspace;
    }
    async function lock(){closing=true;epoch++;await pending;key=null;account=null;closing=false;}
    function saveWorkspace(workspace){const snapshot=JSON.stringify(workspace);return queue(async k=>{const box=await encrypt(k,encoder.encode(snapshot),'workspace');await tx(['records'],'readwrite',t=>t.objectStore('records').put({id:'workspace',box}));});}
    async function loadWorkspace(){const k=requireKey(),stamp=epoch;const r=await tx(['records'],'readonly',t=>t.objectStore('records').get('workspace'));const value=JSON.parse(decoder.decode(await decrypt(k,r.box,'workspace')));if(stamp!==epoch||!key)throw new Error('Your workspace is locked.');return value;}
    async function decodeFile(k,record,content=true){const meta=JSON.parse(decoder.decode(await decrypt(k,record.meta,'file-meta:'+record.id)));if(content)meta.blob=new Blob([await decrypt(k,record.body,'file-body:'+record.id)],{type:meta.type||'application/octet-stream'});return meta;}
    async function listFiles(projectId,content=true){const k=requireKey(),stamp=epoch;const records=await tx(['records'],'readonly',t=>projectId?t.objectStore('records').index('projectId').getAll(projectId):t.objectStore('records').getAll());const result=[];for(const record of records)if(record.id!=='workspace')result.push(await decodeFile(k,record,content));if(stamp!==epoch||!key)throw new Error('Your workspace is locked.');return result;}
    async function getFile(id){const k=requireKey(),stamp=epoch;const record=await tx(['records'],'readonly',t=>t.objectStore('records').get(id));const result=record?await decodeFile(k,record):null;if(stamp!==epoch||!key)throw new Error('Your workspace is locked.');return result;}
    function writeFiles(files){return queue(async k=>{const records=[];for(const file of files)records.push(await sealFile(k,file));await tx(['records'],'readwrite',t=>{for(const r of records)t.objectStore('records').put(r);});});}
    function importWorkspace(workspace,files){const snapshot=JSON.stringify(workspace);return queue(async k=>{const records=[];for(const file of files)records.push(await sealFile(k,file));records.push({id:'workspace',box:await encrypt(k,encoder.encode(snapshot),'workspace')});await tx(['records'],'readwrite',t=>{for(const record of records)t.objectStore('records').put(record);});});}
    function removeIds(ids){return queue(()=>tx(['records'],'readwrite',t=>{for(const id of ids){if(id==='workspace')throw new Error('Invalid file ID.');t.objectStore('records').delete(id);}}));}
    function removeProject(id){return queue(()=>tx(['records'],'readwrite',t=>{const s=t.objectStore('records'),r=s.index('projectId').openKeyCursor(id);r.onsuccess=()=>{if(r.result){s.delete(r.result.primaryKey);r.result.continue();}};}));}
    async function changePassword(current,next){validatePassword(next);return queue(async()=>{const a=await config();let raw;try{raw=await decrypt(await derive(current,a.salt,a.iterations),a.wrapped,'studio-companion-key-v1');}catch{throw new Error('Your current password is incorrect.');}try{const salt=random(16);const updated={...a,salt,wrapped:await encrypt(await derive(next,salt),raw,'studio-companion-key-v1')};await tx(['config'],'readwrite',t=>t.objectStore('config').put(updated));account=updated;}finally{new Uint8Array(raw).fill(0);}});}
    async function sealBackup(backup){const k=requireKey(),a=account;const box=await encrypt(k,encoder.encode(JSON.stringify(backup)),'backup-v1');return {format:'studio-companion-encrypted',version:1,account:{username:a.username,salt:base64(a.salt),iterations:a.iterations,wrapped:portable(a.wrapped)},payload:portable(box)};}
    async function readBackup(backup,password){if(backup.format!=='studio-companion-encrypted')return backup;if(backup.version!==1)throw new Error('Unsupported backup version.');try{const a={...backup.account,salt:unbase64(backup.account.salt),wrapped:unpack(backup.account.wrapped)};const k=await openKey(a,password);return JSON.parse(decoder.decode(await decrypt(k,unpack(backup.payload),'backup-v1')));}catch{throw new Error('The backup password is incorrect, or the backup is damaged.');}}
    return {status,create,login,lock,saveWorkspace,loadWorkspace,listFiles,getFile,writeFiles,importWorkspace,removeIds,removeProject,changePassword,sealBackup,readBackup,isUnlocked:()=>!!key&&!closing,flush:()=>pending,close:()=>{epoch++;key=null;database?.close();database=null;}};
  }
  globalThis.StudioVaultCore={createVault};
})();
