/* Project attachments live in IndexedDB, never in localStorage or on a server. */
(() => {
  'use strict';
  const LIMIT = 50 * 1024 * 1024;
  const BACKUP_LIMIT = 250 * 1024 * 1024;
  let database, mountVersion = 0, previewVersion = 0, previewUrl = null, previewCleanup = null;
  let currentProject = null, busy = false, previewLoading = false;
  const downloadUrls=new Set();
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => crypto.randomUUID();
  const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`;
  const extension = name => name.split('.').pop().toLowerCase();
  const formats = {
    png:['image','image/png'],jpg:['image','image/jpeg'],jpeg:['image','image/jpeg'],gif:['image','image/gif'],webp:['image','image/webp'],bmp:['image','image/bmp'],avif:['image','image/avif'],
    pdf:['pdf','application/pdf'],txt:['text','text/plain'],md:['text','text/plain'],csv:['text','text/plain'],json:['text','text/plain'],log:['text','text/plain'],svg:['text','text/plain'],html:['text','text/plain'],css:['text','text/plain'],js:['text','text/plain'],xml:['text','text/plain'],
    mp4:['video','video/mp4'],webm:['video','video/webm'],ogv:['video','video/ogg'],mp3:['audio','audio/mpeg'],wav:['audio','audio/wav'],ogg:['audio','audio/ogg'],m4a:['audio','audio/mp4']
  };
  const list=(projectId,content=true)=>StudioVault.listFiles(projectId,content);
  const get=fileId=>StudioVault.getFile(fileId);
  const write=records=>StudioVault.writeFiles(records);
  const removeIds=ids=>StudioVault.removeIds(ids);
  const removeProject=projectId=>StudioVault.removeProject(projectId);
  function failure(error) {return error?.name==='QuotaExceededError'?'There isn’t enough browser storage. Download and remove older attachments, then try again.':error?.message||'Could not access your files. Please try again.';}
  function message(text, bad=false) {const status=document.querySelector('#file-status');if(status){status.textContent=text;status.classList.toggle('file-error',bad);}}
  const preview = document.createElement('dialog');
  preview.id='file-preview-dialog';preview.setAttribute('aria-labelledby','file-preview-title');
  preview.innerHTML='<div class="preview-heading"><div><span class="eyebrow">PROJECT FILE</span><h2 id="file-preview-title"></h2><p id="file-preview-meta" class="muted"></p></div><button class="icon-button" data-close aria-label="Close file preview">×</button></div><div id="file-preview-content"></div><div class="preview-footer"><span id="file-preview-help" class="muted"></span><button class="button primary" id="preview-download">↓ Download file</button></div>';
  document.body.append(preview);
  function clearPreview() {previewVersion++;previewCleanup?.();previewCleanup=null;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;selectedFile=null;preview.querySelector('#file-preview-content').replaceChildren();}
  preview.addEventListener('close',()=>{if(!preview.open&&!previewLoading)clearPreview();});
  let selectedFile;
  function download(file) {
    if(!StudioVault.isUnlocked())return;const url=URL.createObjectURL(new Blob([file.blob],{type:'application/octet-stream'}));
    downloadUrls.add(url);const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);downloadUrls.delete(url);},60000);
  }
  preview.querySelector('#preview-download').addEventListener('click',()=>{if(selectedFile)download(selectedFile);});
  async function showPreview(fileId) {
    clearPreview();const version=previewVersion;previewLoading=true;
    try {
      const file=await get(fileId);if(version!==previewVersion)return;if(!file)throw new Error('This file was removed in another window.');
      selectedFile=file;
      preview.querySelector('h2').textContent=file.name;
      preview.querySelector('#file-preview-meta').textContent=`${size(file.size)} · Added ${new Date(file.created).toLocaleDateString()}`;
      preview.querySelector('#file-preview-help').textContent='Your original file is always available to download.';
      const content=preview.querySelector('#file-preview-content');const [kind,type]=formats[extension(file.name)]||['unsupported','application/octet-stream'];
      if(kind==='text') {
        const text=await file.blob.slice(0,1024*1024).text();if(version!==previewVersion)return;
        const pre=document.createElement('pre');pre.textContent=text;content.append(pre);
        if(file.size>1024*1024)preview.querySelector('#file-preview-help').textContent='Showing the first 1 MB. Download to read the full file.';
      } else if(kind==='pdf'&&window.StudioPdf) {
        if(!preview.open)preview.showModal();
        previewCleanup=window.StudioPdf.mount(file.blob,content);
      } else if(kind==='unsupported') {
        const empty=document.createElement('div');empty.className='unsupported-file';
        empty.innerHTML='<span aria-hidden="true">▱</span><h3>This file is safely attached.</h3><p>A preview isn’t available for this format. Download it and open it in the application you use for this file.</p>';
        content.append(empty);
      } else {
        previewUrl=URL.createObjectURL(new Blob([file.blob],{type}));
        const element=document.createElement(kind==='image'?'img':kind==='pdf'?'iframe':kind);
        if(kind==='image')element.alt=file.name;
        if(kind==='pdf') {element.title=`PDF preview: ${file.name}`;preview.querySelector('#file-preview-help').textContent='If your browser can’t display this PDF, download it to view it.';}
        if(kind==='video'||kind==='audio'){element.controls=true;element.preload='metadata';}
        element.src=previewUrl;element.onerror=()=>{preview.querySelector('#file-preview-help').textContent='This browser couldn’t display the file. Download it to open it in another app.';};content.append(element);
      }
      if(!preview.open)preview.showModal();preview.querySelector('[data-close]').focus();
    } catch(error){message(failure(error),true);}
    finally{previewLoading=false;}
  }
  async function upload(files, projectId) {
    if(busy)return;
    const candidates=Array.from(files);if(!candidates.length)return;
    const invalid=candidates.find(file=>file.size>LIMIT);
    if(invalid){message(`“${invalid.name}” is over the 50 MB per-file limit. No files were added.`,true);return;}
    busy=true;message(`Saving ${candidates.length} ${candidates.length===1?'file':'files'}…`);
    document.querySelector('#upload-files-button')?.setAttribute('disabled','');
    try {
      const records=candidates.map(file=>({id:uid(),projectId,name:file.name,size:file.size,type:file.type,created:Date.now(),blob:file}));
      await write(records);
      if(currentProject===projectId){await refresh(projectId);message(`${records.length} ${records.length===1?'file saved':'files saved'} on this device.`);}
    } catch(error){message(failure(error),true);}
    finally{busy=false;document.querySelector('#upload-files-button')?.removeAttribute('disabled');}
  }
  async function refresh(projectId) {
    const version=++mountVersion;
    try {
      const files=await list(projectId,false);if(version!==mountVersion||currentProject!==projectId)return;
      const grid=document.querySelector('#project-files-list');if(!grid)return;
      document.querySelector('#files-count').textContent=files.length;
      grid.innerHTML=files.length?files.sort((a,b)=>b.created-a.created).map(file=>{
        const kind=formats[extension(file.name)]?.[0]||'file';
        return `<article class="file-card"><button class="file-open" data-preview-file="${escape(file.id)}"><span class="file-symbol">${kind==='image'?'▧':kind==='pdf'?'PDF':kind==='audio'?'♫':kind==='video'?'▷':'▤'}</span><span class="file-description"><strong>${escape(file.name)}</strong><small>${size(file.size)} · ${new Date(file.created).toLocaleDateString()}</small></span></button><div class="file-card-actions"><button class="text-button" data-preview-file="${escape(file.id)}">Preview</button><button class="text-button" data-download-file="${escape(file.id)}">Download</button><button class="text-button file-remove" data-remove-file="${escape(file.id)}" aria-label="Remove ${escape(file.name)}">Remove</button></div></article>`;
      }).join(''):'<p class="files-empty">A home for your drawings, references, and submissions.<br>Add your first file above.</p>';
    } catch(error){message(failure(error),true);}
  }
  function mount(projectId) {
    currentProject=projectId;mountVersion++;
    if(!projectId)return;
    const section=document.createElement('section');section.className='files-panel';section.id='project-files';
    section.innerHTML=`<div class="section-heading"><div><h2>Project files <small id="files-count">…</small></h2><p class="muted">Drawings, references, and everything in between.</p></div><button class="button primary" id="upload-files-button" ${busy?'disabled':''}>↑ Add files</button></div><input type="file" id="file-input" multiple hidden aria-label="Choose project files"><div class="file-dropzone" id="file-dropzone"><span aria-hidden="true">↑</span><div><strong>Drop files here, or choose “Add files”</strong><p>Any file type · Up to 50 MB each · Stored on this device</p></div></div><p id="file-status" role="status" aria-live="polite">Preview images, PDFs, text, audio, and video. Other formats can be downloaded.</p><div class="project-files-list" id="project-files-list"></div>`;
    document.querySelector('#main .delete-project')?.before(section);
    const input=section.querySelector('#file-input');
    section.querySelector('#upload-files-button').addEventListener('click',()=>input.click());
    input.addEventListener('change',()=>{upload(input.files,projectId);input.value='';});
    const zone=section.querySelector('#file-dropzone');
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragging');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));
    zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragging');upload(e.dataTransfer.files,projectId);});
    section.addEventListener('click',async e=>{
      const button=e.target.closest('button');if(!button)return;
      if(button.dataset.previewFile)showPreview(button.dataset.previewFile);
      if(button.dataset.downloadFile){try{const file=await get(button.dataset.downloadFile);if(file)download(file);else message('This file is no longer available.',true);}catch(error){message(failure(error),true);}}
      if(button.dataset.removeFile){
        button.disabled=true;
        try{const file=await get(button.dataset.removeFile);if(!file)return;
          const dialog=document.querySelector('#remove-file-dialog');dialog.querySelector('p').textContent=`Remove “${file.name}” from this project? Your original file on disk will not be changed.`;
          dialog.returnValue='cancel';dialog.showModal();dialog.querySelector('[value="cancel"]').focus();
          dialog.addEventListener('close',async()=>{if(dialog.returnValue!=='remove')return;try{await removeIds([file.id]);await refresh(projectId);message('Attachment removed.');}catch(error){message(failure(error),true);}},{once:true});
        }catch(error){message(failure(error),true);}finally{button.disabled=false;}
      }
    });
    refresh(projectId);
  }
  const removeDialog=document.createElement('dialog');removeDialog.id='remove-file-dialog';removeDialog.setAttribute('aria-labelledby','remove-file-title');
  removeDialog.innerHTML='<form method="dialog"><h2 id="remove-file-title">Remove attachment?</h2><p class="muted"></p><div class="dialog-actions"><button class="button secondary" value="cancel">Keep file</button><button class="button danger" value="remove">Remove file</button></div></form>';
  document.body.append(removeDialog);
  const toBase64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  async function exportFiles(projectIds) {
    const all=(await list()).filter(file=>projectIds.includes(file.projectId));
    if(all.reduce((n,f)=>n+f.size,0)>BACKUP_LIMIT)throw new Error('Your attachments exceed the 250 MB backup limit. Download large files separately before exporting.');
    const result=[];
    for(const {blob,...metadata} of all)result.push({...metadata,base64:await toBase64(blob)});
    return result;
  }
  function prepareImport(files, projectMap) {
    if(!Array.isArray(files)||files.length>10000)throw new Error('This backup has an invalid attachment list.');
    let total=0;
    return files.map(file=>{
      if(!file||!projectMap.has(file.projectId)||typeof file.name!=='string'||!file.name||file.name.length>1024||typeof file.base64!=='string'||file.base64.length>Math.ceil(LIMIT/3)*4||(file.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)))throw new Error('This backup contains an invalid attachment.');
      const raw=atob(file.base64);total+=raw.length;if(raw.length>LIMIT||total>BACKUP_LIMIT)throw new Error('This backup exceeds the supported file size limit.');
      if(file.size!==raw.length)throw new Error('An attachment is incomplete. Import was cancelled.');
      const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
      return {id:uid(),projectId:projectMap.get(file.projectId),name:file.name,size:bytes.length,type:typeof file.type==='string'?file.type:'',created:Number.isFinite(file.created)?file.created:Date.now(),blob:new Blob([bytes],{type:'application/octet-stream'})};
    });
  }
  window.StudioFiles={lock(){currentProject=null;mountVersion++;clearPreview();for(const url of downloadUrls)URL.revokeObjectURL(url);downloadUrls.clear();if(preview.open)preview.close();preview.querySelector('h2').textContent='';preview.querySelector('#file-preview-meta').textContent='';removeDialog.querySelector('p').textContent='';},mount,removeProject,exportFiles,prepareImport,write,removeIds,isBusy:()=>busy};
})();
