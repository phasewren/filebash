const state = { files: [], folders: {}, rootHandle: null, rootName: '', mode: 'folder', scanPhase: 'idle', scanCount: 0, addingToFolder: false, browserError: false };
const rules = [
  { name: 'Work & Projects', exts: ['doc','docx','ppt','pptx','key','pages'], words: ['project','proposal','brief','meeting','notes','report','client','work'] },
  { name: 'Finance', exts: ['xls','xlsx','csv','numbers','ofx','qfx'], words: ['invoice','receipt','budget','tax','expense','payment','statement'] },
  { name: 'Photos & Images', exts: ['jpg','jpeg','png','gif','webp','heic','svg','tiff'], words: ['photo','image','screenshot','img'] },
  { name: 'Design Assets', exts: ['psd','ai','fig','sketch','indd'], words: ['design','logo','brand','mockup','asset'] },
  { name: 'Audio & Video', exts: ['mp3','wav','m4a','mp4','mov','avi','mkv','webm'], words: ['recording','video','audio','clip'] },
  { name: 'Books & PDFs', exts: ['pdf','epub','mobi'], words: ['book','paper','guide','manual'] },
  { name: 'Archives', exts: ['zip','rar','7z','tar','gz'], words: ['archive','backup'] },
  { name: 'Code & Data', exts: ['js','ts','jsx','tsx','html','css','json','xml','py','sql','md'], words: ['code','data','export','dataset'] }
];
const ids = ['installBtn','dropzone','dropTitle','dropHelp','connectionState','folderLinks','fileInput','connectFolderBtn','browseBtn','addFilesBtn','rescanBtn','changeFolderBtn','clearBtn','emptyState','planContent','planTitle','fileCount','folderCount','folderList','searchInput','downloadBtn','downloadDialog','downloadMessage','downloadLinks','applyDialog','applyMessage','deleteDuplicates','removeEmpty','cancelApplyBtn','applyNowBtn','toast'];
const els = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

function category(file) {
  const name = file.name.toLowerCase(), ext = name.includes('.') ? name.split('.').pop() : '';
  let best = { name: 'Other', score: 0 };
  rules.forEach(rule => { let score = rule.exts.includes(ext) ? 3 : 0; rule.words.forEach(word => { if (name.includes(word)) score += 2; }); if (score > best.score) best = { name: rule.name, score }; });
  return best.name;
}
function prettySize(bytes){if(bytes<1024)return `${bytes} B`;if(bytes<1048576)return `${(bytes/1024).toFixed(1)} KB`;if(bytes<1073741824)return `${(bytes/1048576).toFixed(1)} MB`;return `${(bytes/1073741824).toFixed(1)} GB`}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(message){els.toast.textContent=message;els.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>els.toast.classList.remove('show'),2600)}
function safeName(name){return name.replace(/[\\/:*?"<>|]/g,'-').trim() || 'Other'}
function rebuildFolders(){const next={};state.files.forEach(item=>(next[item.folder]||=[]).push(item));state.folders=next}

async function walkDirectory(dirHandle, parts=[], results=[], onProgress=()=>{}){
  for await (const [name, handle] of dirHandle.entries()) {
    if(handle.kind==='file'){
      const file=await handle.getFile();
      results.push({file,handle,parentHandle:dirHandle,key:`${parts.join('/')}/${name}-${file.size}-${file.lastModified}`,path:[...parts,name].join('/'),folder:category(file),duplicate:false,duplicateOf:''});
      onProgress(results.length);
    } else if(handle.kind==='directory') await walkDirectory(handle,[...parts,name],results,onProgress);
  }
  return results;
}
async function sha(file){const bytes=await file.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function markDuplicates(items){
  const bySize={};items.forEach(item=>(bySize[item.file.size]||=[]).push(item));
  for(const group of Object.values(bySize)){
    if(group.length<2)continue;
    const byHash=new Map();
    for(const item of group){const digest=await sha(item.file);if(!byHash.has(digest))byHash.set(digest,[]);byHash.get(digest).push(item)}
    for(const matches of byHash.values()){
      if(matches.length<2)continue;
      const keeper=matches.find(item=>item.path.split('/').slice(0,-1).join('/')===safeName(item.folder))||matches[0];
      matches.forEach(item=>{if(item!==keeper){item.duplicate=true;item.duplicateOf=keeper.path}});
    }
  }
}
async function ensurePermission(){
  if(!state.rootHandle)return false;
  if(typeof state.rootHandle.queryPermission==='function'&&await state.rootHandle.queryPermission({mode:'readwrite'})==='granted')return true;
  if(typeof state.rootHandle.requestPermission==='function')return await state.rootHandle.requestPermission({mode:'readwrite'})==='granted';
  return true;
}
async function scanConnectedFolder(skipPermission=false){
  if(!state.rootHandle)return;
  state.scanPhase='scanning';state.scanCount=0;state.browserError=false;render();setBusy(true,'Scanning folder…');
  try{
    if(!skipPermission&&!await ensurePermission())throw new Error('Folder access was not granted.');
    const files=await walkDirectory(state.rootHandle,[],[],count=>{state.scanCount=count;els.dropHelp.textContent=`Scanning… ${count} ${count===1?'file':'files'} found`});
    els.dropHelp.textContent=`Checking ${files.length} ${files.length===1?'file':'files'} for exact duplicates…`;
    await markDuplicates(files);state.files=files;state.mode='folder';state.scanPhase='ready';rebuildFolders();render();toast(`${files.length} ${files.length===1?'file':'files'} checked`)
  }
  catch(error){state.scanPhase='error';render();toast(error.message||'Could not read that folder')}
  finally{setBusy(false)}
}
async function connectFolder(){
  if(!window.showDirectoryPicker){state.browserError=true;render();toast('Folder access needs Chrome or Edge. You can still organize loose files.');return}
  try{state.rootHandle=await window.showDirectoryPicker({mode:'readwrite'});state.rootName=state.rootHandle.name;state.scanPhase='connected';render();await new Promise(requestAnimationFrame);await scanConnectedFolder(true)}catch(error){if(error.name!=='AbortError'){state.scanPhase='error';render();toast(error.message||'Could not connect that folder')}}
}
function addLooseFiles(fileList){
  state.files=[];state.folders={};state.rootHandle=null;state.rootName='';state.mode='loose';let added=0;
  for(const file of fileList){const key=`${file.name}-${file.size}-${file.lastModified}`;if(state.files.some(item=>item.key===key))continue;state.files.push({file,key,path:file.name,folder:category(file),duplicate:false});added++}
  rebuildFolders();render();toast(added?`${added} ${added===1?'file':'files'} sorted`:'Those files are already here');
}
function setBusy(busy){els.connectFolderBtn.disabled=busy;els.rescanBtn.disabled=busy;els.addFilesBtn.disabled=busy;els.changeFolderBtn.disabled=busy;els.downloadBtn.disabled=busy}
function render(){
  const hasFiles=state.files.length>0, connected=!!state.rootHandle;
  els.emptyState.hidden=hasFiles;els.planContent.hidden=!hasFiles;els.clearBtn.hidden=!hasFiles&&!connected;els.folderLinks.hidden=!connected;els.browseBtn.hidden=connected;els.connectionState.hidden=!connected;
  els.dropzone.classList.toggle('connected',connected);els.connectionState.classList.toggle('scanning',state.scanPhase==='scanning');
  if(connected)els.connectionState.querySelector('b').textContent=state.scanPhase==='scanning'?'SCANNING':'CONNECTED';
  els.dropTitle.textContent=connected?state.rootName:'Connect your messy folder';
  els.dropHelp.textContent=connected?(state.scanPhase==='scanning'?`Scanning… ${state.scanCount} files found`:state.scanPhase==='error'?'Connected, but the scan stopped. Try again or choose another folder.':hasFiles?`${state.files.length} files checked. Review the plan, then organize in place.`:'Connected. This folder is empty or already clear.'):(state.browserError?'Direct folder access needs Chrome or Edge.':'You’ll approve the plan before anything moves');
  els.connectFolderBtn.textContent=connected?(state.scanPhase==='error'?'Try scanning again':'Organize files in this folder'):'Connect a folder';
  els.planTitle.textContent=state.scanPhase==='scanning'?'Scanning folder…':hasFiles?(connected?'Review the changes':'Here’s the clean-up'):'Ready when you are';
  els.downloadBtn.textContent=connected?'Apply this plan':'Download organized ZIP';
  els.fileCount.textContent=`${state.files.length} ${state.files.length===1?'file':'files'}`;
  const query=els.searchInput.value.trim().toLowerCase();
  els.folderList.innerHTML=Object.entries(state.folders).map(([folder,items])=>{
    const filtered=items.filter(x=>!query||x.file.name.toLowerCase().includes(query)||folder.toLowerCase().includes(query)||x.path.toLowerCase().includes(query));if(!filtered.length)return'';
    return `<details class="folder" open><summary><span class="folder-icon"></span><span class="folder-name" data-folder="${escapeHtml(folder)}">${escapeHtml(folder)}</span><span class="file-total">${filtered.length} ${filtered.length===1?'file':'files'}</span><span class="chev">⌄</span></summary><div class="files">${filtered.map(x=>`<div class="file-row ${x.duplicate?'is-duplicate':''}"><span><b>${escapeHtml(x.file.name)}</b><small>${connected?`${escapeHtml(x.path)} → ${escapeHtml(folder)}`:''}</small></span><span>${x.duplicate?'<mark>exact duplicate</mark>':prettySize(x.file.size)}</span></div>`).join('')}</div></details>`}).join('')||'<div class="empty-state"><p>No matches. Try another search.</p></div>';
  const count=Object.keys(state.folders).length,duplicates=state.files.filter(x=>x.duplicate).length;
  els.folderCount.textContent=`${count} ${count===1?'folder':'folders'}${duplicates?` · ${duplicates} duplicate${duplicates===1?'':'s'}`:''}`;
  document.querySelectorAll('.folder-name').forEach(name=>name.addEventListener('dblclick',()=>renameFolder(name)));
}
function renameFolder(el){
  const original=el.dataset.folder;el.innerHTML=`<input value="${escapeHtml(original)}" aria-label="Rename folder" />`;const input=el.querySelector('input');input.focus();input.select();
  const save=()=>{const next=safeName(input.value);if(next&&next!==original)state.files.forEach(x=>{if(x.folder===original)x.folder=next});rebuildFolders();render()};input.addEventListener('blur',save,{once:true});input.addEventListener('keydown',e=>{if(e.key==='Enter')input.blur();if(e.key==='Escape'){input.value=original;input.blur()}});
}
async function filesMatch(a,b){if(a.size!==b.size)return false;return await sha(a)===await sha(b)}
async function uniqueTargetName(dir,name){
  const dot=name.lastIndexOf('.'),base=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';let candidate=name,n=2;
  while(true){try{await dir.getFileHandle(candidate);candidate=`${base} (${n++})${ext}`}catch(error){if(error.name==='NotFoundError')return candidate;throw error}}
}
async function addFilesToConnected(fileList){
  if(!fileList.length)return;
  setBusy(true);
  try{
    if(!await ensurePermission())throw new Error('Folder access was not granted.');
    let added=0;
    for(const file of fileList){const name=await uniqueTargetName(state.rootHandle,file.name),target=await state.rootHandle.getFileHandle(name,{create:true}),writable=await target.createWritable();await writable.write(file);await writable.close();added++}
    state.addingToFolder=false;await scanConnectedFolder();toast(`${added} ${added===1?'file':'files'} added and sorted into the plan`);
  }catch(error){state.addingToFolder=false;toast(error.message||'Could not add those files')}finally{setBusy(false);els.fileInput.value=''}
}
async function applyPlan(){
  els.applyNowBtn.disabled=true;els.applyNowBtn.textContent='Moving files…';let moved=0,deleted=0,skipped=0;
  try{
    const permission=await state.rootHandle.requestPermission({mode:'readwrite'});if(permission!=='granted')throw new Error('Folder access was not granted.');
    for(const item of state.files){
      if(item.duplicate&&els.deleteDuplicates.checked){await item.parentHandle.removeEntry(item.file.name);deleted++;continue}
      if(item.duplicate){skipped++;continue}
      const folderName=safeName(item.folder),alreadyThere=item.path.split('/').slice(0,-1).join('/')===folderName;if(alreadyThere){skipped++;continue}
      const targetDir=await state.rootHandle.getDirectoryHandle(folderName,{create:true});let targetName=item.file.name;
      try{const existingHandle=await targetDir.getFileHandle(targetName);const existing=await existingHandle.getFile();if(await filesMatch(existing,item.file)){if(els.deleteDuplicates.checked){await item.parentHandle.removeEntry(item.file.name);deleted++}else skipped++;continue}targetName=await uniqueTargetName(targetDir,targetName)}catch(error){if(error.name!=='NotFoundError')throw error}
      const target=await targetDir.getFileHandle(targetName,{create:true}),writable=await target.createWritable();await writable.write(item.file);await writable.close();await item.parentHandle.removeEntry(item.file.name);moved++;
    }
    if(els.removeEmpty.checked)await removeEmptyFolders(state.rootHandle);
    els.applyDialog.close();await scanConnectedFolder();toast(`Done — ${moved} moved${deleted?`, ${deleted} duplicates removed`:''}${skipped?`, ${skipped} already tidy`:''}`);
  }catch(error){toast(`Stopped safely: ${error.message||'a file could not be changed'}`)}finally{els.applyNowBtn.disabled=false;els.applyNowBtn.textContent='Move files now'}
}
async function removeEmptyFolders(dir){
  const children=[];for await(const [name,handle] of dir.entries())if(handle.kind==='directory')children.push([name,handle]);
  for(const [name,child] of children){await removeEmptyFolders(child);let empty=true;for await(const _ of child.entries()){empty=false;break}if(empty)await dir.removeEntry(name)}
}
function reviewApply(){const duplicates=state.files.filter(x=>x.duplicate).length,moves=state.files.filter(x=>!x.duplicate&&x.path.split('/').slice(0,-1).join('/')!==safeName(x.folder)).length;els.applyMessage.textContent=`File Bash will move ${moves} ${moves===1?'file':'files'} into ${Object.keys(state.folders).length} folders${duplicates?` and found ${duplicates} exact duplicate${duplicates===1?'':'s'}`:''}.`;els.applyDialog.showModal()}
function crc32(bytes){let c=-1;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^-1)>>>0}
function u16(n){return[n&255,(n>>>8)&255]}function u32(n){return[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]}
async function createZip(){const enc=new TextEncoder(),local=[],central=[];let offset=0;for(const[folder,items]of Object.entries(state.folders))for(const item of items){const name=enc.encode(`${safeName(folder)}/${item.file.name}`),data=new Uint8Array(await item.file.arrayBuffer()),crc=crc32(data),header=new Uint8Array([80,75,3,4,20,0,0,8,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,...name]);local.push(header,data);central.push(new Uint8Array([80,75,1,2,20,0,20,0,0,8,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset),...name]));offset+=header.length+data.length}const centralSize=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array([80,75,5,6,0,0,0,0,...u16(central.length),...u16(central.length),...u32(centralSize),...u32(offset),0,0]);return new Blob([...local,...central,end],{type:'application/zip'})}
async function downloadLoose(){els.downloadBtn.disabled=true;els.downloadBtn.textContent='Building your folders…';try{const blob=await createZip(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='File-Bash-Organized.zip';a.textContent='Download File-Bash-Organized.zip';els.downloadLinks.innerHTML='';els.downloadLinks.appendChild(a);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);els.downloadMessage.textContent=`File Bash arranged ${state.files.length} files across ${Object.keys(state.folders).length} folders in one ZIP.`;els.downloadDialog.showModal()}finally{els.downloadBtn.disabled=false;els.downloadBtn.textContent='Download organized ZIP'}}
function clearAll(){state.files=[];state.folders={};state.rootHandle=null;state.rootName='';state.mode='folder';state.scanPhase='idle';state.scanCount=0;state.addingToFolder=false;state.browserError=false;els.searchInput.value='';render();toast('Folder disconnected')}

els.connectFolderBtn.addEventListener('click',()=>{if(!state.rootHandle)return connectFolder();if(state.scanPhase==='ready'&&state.files.length)return reviewApply();return scanConnectedFolder()});els.rescanBtn.addEventListener('click',()=>scanConnectedFolder());els.changeFolderBtn.addEventListener('click',connectFolder);els.addFilesBtn.addEventListener('click',()=>{state.addingToFolder=true;els.fileInput.click()});els.browseBtn.addEventListener('click',()=>{state.addingToFolder=false;els.fileInput.click()});els.fileInput.addEventListener('change',e=>state.addingToFolder&&state.rootHandle?addFilesToConnected(e.target.files):addLooseFiles(e.target.files));
['dragenter','dragover'].forEach(type=>els.dropzone.addEventListener(type,e=>{e.preventDefault();els.dropzone.classList.add('dragging')}));['dragleave','drop'].forEach(type=>els.dropzone.addEventListener(type,e=>{e.preventDefault();els.dropzone.classList.remove('dragging')}));els.dropzone.addEventListener('drop',e=>addLooseFiles(e.dataTransfer.files));
els.searchInput.addEventListener('input',render);els.clearBtn.addEventListener('click',clearAll);els.downloadBtn.addEventListener('click',()=>state.rootHandle?reviewApply():downloadLoose());els.cancelApplyBtn.addEventListener('click',()=>els.applyDialog.close());els.applyNowBtn.addEventListener('click',applyPlan);
document.querySelectorAll('dialog .dialog-close').forEach(btn=>btn.addEventListener('click',()=>btn.closest('dialog').close()));document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()}));render();

let installPrompt=null;
const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true||navigator.userAgent.includes('Electron');
if(standalone)els.installBtn.hidden=true;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;els.installBtn.classList.add('ready')});
window.addEventListener('appinstalled',()=>{installPrompt=null;els.installBtn.hidden=true;toast('File Bash is installed')});
els.installBtn.addEventListener('click',async()=>{
  if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return}
  toast('In Chrome or Edge, open the browser menu and choose “Install File Bash”');
});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();document.modelContext.registerTool({name:'read_organization_plan',title:'Read organization plan',description:'Read the visible File Bash folder plan. Applying real file changes still requires the person to confirm in the page.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return{connectedFolder:state.rootName||null,fileCount:state.files.length,duplicateCount:state.files.filter(x=>x.duplicate).length,folders:Object.fromEntries(Object.entries(state.folders).map(([name,items])=>[name,items.map(x=>x.file.name)]))}}},{signal:lifecycle.signal});
}
