import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const session = page => page.evaluate(()=>JSON.parse(localStorage.getItem('markdown.localSession.v1')));
async function edit(page,value){await page.locator('.cm-content').fill(value);await expect(page.locator('.cm-content')).toHaveText(value);}
async function folder(page,name){await page.getByRole('button',{name:'New folder',exact:true}).click();await page.getByRole('textbox',{name:'Folder name'}).fill(name);await page.getByRole('textbox',{name:'Folder name'}).press('Enter');await expect(page.getByRole('region',{name:name+' folder',exact:true})).toBeVisible();}

test.beforeEach(async({page})=>{
 if(process.env.MARKDOWN_TEST_ORIGIN)await page.route('http://127.0.0.1:5173/**',async route=>{const response=await route.fetch({url:route.request().url().replace('http://127.0.0.1:5173',process.env.MARKDOWN_TEST_ORIGIN)});await route.fulfill({response});});
});

test('folder dialogs work without native prompts and restore keyboard focus',async({page})=>{
 await page.addInitScript(()=>{window.prompt=()=>null;});await page.goto('/');await folder(page,'Tech');
 await expect(page.getByRole('button',{name:'New folder',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Rename Tech',exact:true}).click();await page.getByRole('textbox',{name:'Folder name'}).fill('');await page.getByRole('textbox',{name:'Folder name'}).press('Enter');await expect(page.getByRole('alert')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Rename Tech',exact:true})).toBeFocused();
 await folder(page,'Archive');await page.getByRole('button',{name:'Rename Tech',exact:true}).click();await page.getByRole('textbox',{name:'Folder name'}).fill('Archive');await page.getByRole('textbox',{name:'Folder name'}).press('Enter');await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('textbox',{name:'Folder name'}).fill('Engineering');await page.getByRole('textbox',{name:'Folder name'}).press('Enter');await expect(page.getByRole('button',{name:'Rename Engineering',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Remove Engineering',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('region',{name:'Engineering folder'})).toBeVisible();
});

test('integrated folders reconnect a moved real file and save only to its chosen destination',async({page,isMobile})=>{
 test.skip(isMobile, 'Native desktop adapter scenario; narrow folder controls are covered separately.');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'markdown-folders-'));
 const first=path.join(root,'alpha','notes.md'),second=path.join(root,'beta','notes.md'),moved=path.join(root,'moved','notes.md'),draftPath=path.join(root,'draft.md');
 const selected=[];let savePath=null;
 for(const dir of ['alpha','beta','moved'])await fs.mkdir(path.join(root,dir));
 await fs.writeFile(first,'ALPHA ORIGINAL');await fs.writeFile(second,'BETA ORIGINAL');
 // The native IPC transport/pickers are supplied by the harness. The real
 // Tauri adapter, sidebar, session logic and disposable disk I/O are exercised.
 await page.exposeBinding('__diskCommand',async(_,cmd,args,options)=>{
  if(cmd==='plugin:dialog|open')return selected.shift()??null;
  if(cmd==='plugin:dialog|save')return savePath;
  if(cmd==='plugin:fs|read_text_file'){if(!args.path.startsWith(root+path.sep))throw Error('outside disposable root');return Array.from(await fs.readFile(args.path));}
  if(cmd==='plugin:fs|write_text_file'){const dest=decodeURIComponent(options.headers.path);if(!dest.startsWith(root+path.sep))throw Error('outside disposable root');await fs.writeFile(dest,Buffer.from(Object.values(args)));return null;}
  if(cmd==='drain_pending_open_paths')return [];
  return null;
 });
 await page.addInitScript(()=>{
  let id=0;window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>++id,unregisterCallback(){},convertFileSrc:p=>p,invoke:(...args)=>window.__diskCommand(...args)};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};window.prompt=()=>null;
 });
 try{
  await page.goto('/');await folder(page,'Tech');selected.push(first);await page.getByRole('button',{name:'Add existing files to Tech',exact:true}).click();await expect(page.locator('.cm-content')).toHaveText('ALPHA ORIGINAL');await edit(page,'ALPHA DRAFT');
  selected.push(second);await page.getByRole('button',{name:'Add existing files to Tech',exact:true}).click();await expect(page.locator('.cm-content')).toHaveText('BETA ORIGINAL');
  let state=await session(page);const alpha=state.files.find(f=>f.reopen.path===first),beta=state.files.find(f=>f.reopen.path===second);
  await folder(page,'Archive');await page.getByRole('region',{name:'Tech folder'}).getByRole('combobox',{name:'Move notes.md',exact:true}).last().selectOption({label:'Archive'});
  await page.getByRole('button',{name:'New file in Tech',exact:true}).click();await edit(page,'NEW DRAFT');
  await page.getByRole('region',{name:'Tech folder'}).getByRole('button',{name:'Close untitled.md',exact:true}).click();await page.getByRole('button',{name:'Reopen untitled.md, unsaved changes',exact:true}).click();await expect(page.locator('.cm-content')).toHaveText('NEW DRAFT');
  await page.getByRole('button',{name:'Collapse Tech',exact:true}).click();await expect.poll(async()=>(await session(page)).virtualFolders.folders.find(f=>f.name==='Tech').collapsed).toBe(true);
  await page.reload();await expect(page.getByRole('button',{name:'Expand Tech',exact:true})).toBeVisible();await page.getByRole('button',{name:'Expand Tech',exact:true}).click();await expect(page.locator('.cm-content')).toHaveText('NEW DRAFT');
  expect(await fs.readFile(first,'utf8')).toBe('ALPHA ORIGINAL');expect(await fs.readFile(second,'utf8')).toBe('BETA ORIGINAL');await expect(fs.stat(draftPath)).rejects.toThrow();
  savePath=draftPath;await page.getByRole('button',{name:'Save file',exact:true}).click();await expect.poll(()=>fs.readFile(draftPath,'utf8').catch(()=>null)).toBe('NEW DRAFT');
  await fs.rename(first,moved);await page.reload();await expect(page.getByRole('region',{name:'Tech folder'}).getByText('Reconnect needed')).toBeVisible();
  selected.push(moved);await page.getByRole('region',{name:'Tech folder'}).getByRole('button',{name:'Reconnect notes.md',exact:true}).click();
  await expect.poll(async()=>(await session(page)).files.find(f=>f.id===alpha.id)?.reopen.path).toBe(moved);
  await page.getByRole('region',{name:'Tech folder'}).getByRole('button',{name:'Select notes.md, unsaved changes',exact:true}).click();await expect(page.locator('.cm-content')).toHaveText('ALPHA DRAFT');await page.getByRole('button',{name:'Save file',exact:true}).click();await expect.poll(()=>fs.readFile(moved,'utf8')).toBe('ALPHA DRAFT');
  expect(await fs.readFile(second,'utf8')).toBe('BETA ORIGINAL');await expect(fs.stat(first)).rejects.toThrow();
  await page.getByRole('button',{name:'Rename Tech',exact:true}).click();await page.getByRole('textbox',{name:'Folder name'}).fill('Engineering');await page.getByRole('textbox',{name:'Folder name'}).press('Enter');
  await page.getByRole('button',{name:'Remove Engineering',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Remove',exact:true}).click();await expect(page.getByRole('region',{name:'Engineering folder'})).toHaveCount(0);
  state=await session(page);expect(state.files.find(f=>f.id===alpha.id)?.draft).toBe('ALPHA DRAFT');expect(state.files.find(f=>f.id===beta.id)?.draft).toBe('BETA ORIGINAL');
  expect(await fs.readFile(moved,'utf8')).toBe('ALPHA DRAFT');expect(await fs.readFile(draftPath,'utf8')).toBe('NEW DRAFT');
 }finally{await page.close();await fs.rm(root,{recursive:true,force:true});}
});
