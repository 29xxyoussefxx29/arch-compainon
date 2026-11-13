(() => {
  'use strict';
  const $=selector=>document.querySelector(selector);
  window.StudioVault=StudioVaultCore.createVault();
  let setup=false,busy=false,lastActivity=Date.now(),locking=false,failed=0,retryAt=0;
  const accountForm=$('#account-form'),screen=$('#welcome-screen'),drawer=$('#workspace-menu');
  function error(text){$('#account-error').textContent=text;}
  function showLocked(){
    document.body.classList.remove('is-unlocked');screen.hidden=false;$('.shell').inert=true;
    if(drawer.open)drawer.close();$('#menu-toggle').setAttribute('aria-expanded','false');
  }
  function showMode(configured){
    setup=!configured;$('#account-title').textContent=setup?'Make this space yours.':'Welcome back.';
    $('#account-subtitle').textContent=setup?'Create a local account to protect your studio work.':'Log in to pick up where you left off.';
    $('#account-submit').textContent=setup?'Create my secure workspace ↗':'Log in to my studio ↗';
    $('#password-confirm-row').hidden=!setup;$('#account-confirm').required=setup;
    $('#account-password').autocomplete=setup?'new-password':'current-password';
    $('#account-password').minLength=setup?12:1;$('#setup-note').hidden=!setup;$('#login-note').hidden=setup;
  }
  async function lock(reason='Your workspace is locked.'){
    if(locking||!StudioVault.isUnlocked())return;
    locking=true;showLocked();error('Locking and finishing any pending saves…');
    window.dispatchEvent(new Event('studio-locking'));
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    document.querySelectorAll('form').forEach(form=>form.reset());
    for(const selector of ['#note-project','#confirm-description','#import-summary','#import-error'])$(selector).replaceChildren();
    $('#account-password').type='password';$('#account-confirm').type='password';
    try{await StudioVault.lock();showMode(true);error(reason);}
    finally{locking=false;$('#account-submit').disabled=false;$('#account-password').focus();}
  }
  window.StudioSecurity={lock};
  accountForm.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||locking)return;if(Date.now()<retryAt){error('Please wait a few seconds before trying again.');return;}
    const username=$('#account-username').value,password=$('#account-password').value;
    if(setup&&password!==$('#account-confirm').value){error('The passwords don’t match. Please enter them again.');return;}
    busy=true;$('#account-submit').disabled=true;error(setup?'Encrypting your existing projects and files…':'Unlocking your studio…');
    try{
      const workspace=setup?await StudioVault.create(username,password):await StudioVault.login(username,password);
      accountForm.reset();$('#account-password').type='password';$('#account-confirm').type='password';failed=0;retryAt=0;error('');lastActivity=Date.now();
      window.dispatchEvent(new CustomEvent('studio-unlocked',{detail:workspace}));
      screen.hidden=true;document.body.classList.add('is-unlocked');$('.shell').inert=false;
      $('#menu-toggle').focus();
    }catch(err){failed++;if(failed>=5)retryAt=Date.now()+10000;error(err.message);const state=await StudioVault.status().catch(()=>null);if(state)showMode(state.configured);}
    finally{busy=false;$('#account-submit').disabled=false;$('#account-password').value='';$('#account-confirm').value='';}
  });
  $('#show-account-password').addEventListener('change',e=>{for(const input of [$('#account-password'),$('#account-confirm')])input.type=e.target.checked?'text':'password';});
  function closeMenu(){if(drawer.open)drawer.close();}
  $('#menu-toggle').addEventListener('click',()=>{if(!StudioVault.isUnlocked())return;drawer.showModal();$('#menu-toggle').setAttribute('aria-expanded','true');});
  $('#menu-close').addEventListener('click',closeMenu);
  drawer.addEventListener('close',()=>{$('#menu-toggle').setAttribute('aria-expanded','false');if(StudioVault.isUnlocked())$('#menu-toggle').focus();});
  drawer.addEventListener('click',e=>{if(e.target===drawer){const bounds=drawer.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right)closeMenu();}if(e.target.closest('nav a'))closeMenu();});
  $('#lock-workspace').addEventListener('click',()=>lock());
  $('#change-password').addEventListener('click',()=>{closeMenu();$('#password-form').reset();$('#password-error').textContent='';$('#password-dialog').showModal();$('#current-password').focus();});
  $('#password-form').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target;if(form.dataset.busy)return;
    if($('#new-password').value!==$('#confirm-new-password').value){$('#password-error').textContent='The new passwords don’t match.';return;}
    form.dataset.busy='true';$('#password-save').disabled=true;$('#password-error').textContent='Updating your password…';
    try{await StudioVault.changePassword($('#current-password').value,$('#new-password').value);form.reset();$('#password-dialog').close();await lock('Password updated. Log in with your new password.');}
    catch(err){$('#password-error').textContent=err.message;}
    finally{delete form.dataset.busy;$('#password-save').disabled=false;}
  });
  ['pointerdown','keydown','input','scroll'].forEach(name=>window.addEventListener(name,()=>{lastActivity=Date.now();},{passive:true}));
  setInterval(()=>{if(StudioVault.isUnlocked()&&Date.now()-lastActivity>10*60*1000&&!busy)lock('Locked after 10 minutes of inactivity. Log in to continue.');},10000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&StudioVault.isUnlocked()&&Date.now()-lastActivity>10*60*1000)lock('Your session timed out. Log in to continue.');});
  window.addEventListener('pagehide',()=>{StudioVault.lock();});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  async function start(){
    showLocked();$('#account-submit').disabled=true;
    if(!crypto.subtle||!window.indexedDB){error('Secure storage is unavailable here. Open the Windows app, localhost, or an HTTPS website.');return;}
    try{const state=await StudioVault.status();showMode(state.configured);$('#account-submit').disabled=false;$('#account-username').focus();}
    catch(err){error('Could not open local storage: '+err.message);}
  }
  if(navigator.locks){navigator.locks.request('studio-companion-active-session',{ifAvailable:true},async lease=>{
    if(!lease){showLocked();$('#account-submit').disabled=true;error('Studio Companion is already open in another tab. Close that tab, then reload this page.');return;}
    await start();await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));
  }).catch(err=>error('Could not open the secure session: '+err.message));}else{showLocked();$('#account-submit').disabled=true;error('This browser needs an update to open a secure workspace. You can also use the Windows app.');}
})();
