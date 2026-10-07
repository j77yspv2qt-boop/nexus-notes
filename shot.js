#!/usr/bin/env node
/* 產生手機版截圖：主頁 / 安全區域 / 編輯頁 / 插入分類 */
const {spawn}=require('child_process');
const fs=require('fs');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9344;
const OUT='/Users/wongty99/notes-app/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-shot','--window-size=390,844','about:blank'],{stdio:'ignore'});
  let targets=null;
  for(let i=0;i<40;i++){
    try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);targets=await r.json();if(targets.length)break;}catch(e){}
    await sleep(250);
  }
  if(!targets){console.error('FAIL: CDP 不可用');chrome.kill();process.exit(1);}
  const resp=await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('file:///Users/wongty99/notes-app/note-app.html')}`,{method:'PUT'});
  const page=await resp.json();
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
  await sleep(2500);
  const measure=async(label)=>{
    const r=await send('Runtime.evaluate',{expression:`JSON.stringify((function(){
      try{
        const R=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {t:Math.round(b.top),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)};};
        return {theme:R('.homeTop .brand'),acts:R('.homeActs'),search:R('.homeSearch'),
          htmlTheme:document.documentElement.getAttribute('data-theme'),
          themeBtnCls:document.getElementById('btnHomeTheme')?document.getElementById('btnHomeTheme').className:'',
          themeBtnBg:document.getElementById('btnHomeTheme')?getComputedStyle(document.getElementById('btnHomeTheme')).background.slice(0,70):'',
          uploadBtnBg:document.getElementById('btnHomeUpload')?getComputedStyle(document.getElementById('btnHomeUpload')).background.slice(0,70):'',
          cats:R('#tbCats'),catsScroll:document.getElementById('tbCats')?document.getElementById('tbCats').scrollWidth:0,
          tbBrand:R('#topbar .brand')};
      }catch(e){return {err:String(e)}}
    })())`,returnByValue:true});
    console.log(label, r.result.result.value);
  };
  const shot=async name=>{
    const r=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(OUT+'shot-'+name+'.png',Buffer.from(r.result.data,'base64'));
    console.log('saved shot-'+name+'.png');
  };
  await measure('HOME@390');
  await shot('1-home');
  await send('Runtime.evaluate',{expression:`document.documentElement.style.setProperty('--safe-top','34px');document.documentElement.style.setProperty('--safe-bottom','24px')`});
  await sleep(400);await shot('2-home-safe');
  await send('Runtime.evaluate',{expression:`openDoc(curDoc().id)`});
  await sleep(700);await measure('EDITOR@390');await shot('3-editor');
  await send('Runtime.evaluate',{expression:`document.querySelector('.tcat[data-cat="insert"]').click()`});
  await sleep(300);await shot('4-editor-insert');
  await send('Runtime.evaluate',{expression:`document.querySelector('.tcat[data-cat="file"]').click()`});
  await sleep(300);await shot('5-editor-file');
  chrome.kill();
  process.exit(0);
}
main();
