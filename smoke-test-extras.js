#!/usr/bin/env node
/* Verify: colorPop interaction, home upload creates docs, editor upload imports */
const {spawn}=require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9337;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-extras','about:blank'],{stdio:'ignore'});
  let targets=null;
  for(let i=0;i<40;i++){
    try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);targets=await r.json();if(targets.length)break;}catch(e){}
    await sleep(250);
  }
  if(!targets){console.error('FAIL: CDP 不可用');chrome.kill();process.exit(1);}
  const resp=await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('file:///Users/wongty99/notes-app/note-app.html')}`,{method:'PUT'});
  const page=await resp.json();
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();const errors=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails.exception||m.params.exceptionDetails.text));
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error: '+m.params.args.map(a=>a.value||a.description).join(' '));};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  await send('Runtime.enable');await sleep(2200);
  const results=[];
  const check=(name,ok,extra='')=>{results.push({name,ok});console.log((ok?'PASS':'FAIL')+' '+name+(extra?' — '+extra:''));};
  async function evalJs(expr){
    const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails)return 'ERR: '+JSON.stringify(r.result.exceptionDetails.exception||r.result.exceptionDetails.text);
    const v=r.result&&r.result.result?r.result.result.value:'null';
    return typeof v==='string'?v:JSON.stringify(v);
  }

  check('啟動無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,300));

  // --- colorPop
  const cp1=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const before=S.pen.c;
      const sw=document.getElementById('penSwatch');
      sw.click();
      const pop=document.getElementById('colorPop');
      const opened=pop.classList.contains('open');
      const blue=[...pop.querySelectorAll('.cpSw')].find(b=>b.dataset.c==='#1e88e5');
      blue.click();
      const afterS=S.pen.c;
      const hue=document.getElementById('cpHue');
      hue.value=120;hue.dispatchEvent(new Event('input'));
      const afterH=S.pen.c;
      document.body.click();
      const closed=!pop.classList.contains('open');
      sw.click();
      const reopened=pop.classList.contains('open');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      const escClosed=!pop.classList.contains('open');
      return {opened,afterS,afterH,closed,reopened,escClosed,before,
        swatchBg:sw.style.background};
    }catch(e){return {err:String(e)}}
  })())`));
  check('調色盤點擊展開',cp1.opened===true,cp1.err||'');
  check('色票套用（藍 #1e88e5）',String(cp1.afterS).toLowerCase()==='#1e88e5',cp1.afterS);
  {const hh=String(cp1.afterH).toLowerCase();const g=parseInt(hh.slice(3,5),16),r2=parseInt(hh.slice(1,3),16),b2=parseInt(hh.slice(5,7),16);check('色相滑桿套用（h=120 綠為主，保留 S/V）',g>r2+40&&g>b2+40,hh+` r=${r2} g=${g} b=${b2}`);}
  check('點外部關閉',cp1.closed===true);
  check('Esc 關閉',cp1.escClosed===true);

  // --- elbar interaction
  const eb=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const d=curDoc();
      const cfg={type:'draw',xmin:0,xmax:100,xstep:20,ymin:0,ymax:100,ystep:20,
        zero:true,grid:true,eqAuto:true,title:'t',xl:'X',yl:'Y',lines:[],ilabels:{}};
      const el={id:uid(),type:'chart',x:50,y:50,w:460,h:330,cfg};
      d.pages[0].els.push(el);
      S.sel={pi:0,id:el.id};commit();renderAll();
      const bar=document.getElementById('elbar');
      const btns=[...bar.querySelectorAll('button')].map(b=>b.dataset.b);
      bar.querySelector('[data-b="dline"]').click();
      const n1=el.cfg.lines.length;
      const bar2=document.getElementById('elbar');
      const hasColorInput=!!bar2.querySelector('[data-b="dcolor"]');
      const smi=(bar2.querySelector('.smi')||{}).textContent;
      const dstart=bar2.querySelector('[data-b="dstart"]');
      if(dstart)dstart.click();
      const arrowOn=el.cfg.lines[0].arrowStart===true;
      return {btns,n1,hasColorInput,smi,arrowOn};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('elbar 9+ 按鈕渲染',!eb.err&&eb.btns&&eb.btns.length>=9,JSON.stringify(eb.btns||eb.err));
  check('＋直線按鈕可點擊加線',eb.n1===1,'lines='+eb.n1);
  check('加線後顯示顏色/名稱輸入',eb.hasColorInput===true);
  check('smi 顯示「1 條線」',/1 條線/.test(eb.smi||''),eb.smi);
  check('起點箭頭切換',eb.arrowOn===true);


  // --- home upload: each file → new note
  const up1=JSON.parse(await evalJs(`(async function(){
    try{
      const before=S.docs.length;
      uploadMode='home';
      const f1=new File(['hello world\\nsecond line'],'我的筆記 alpha.txt',{type:'text/plain'});
      const f2=new File(['another doc'],'報告 beta.txt',{type:'text/plain'});
      await handleFiles([f1,f2]);
      const after=S.docs.length;
      const newest=S.docs.slice(0,2).map(d=>({name:d.name,pages:d.pages.length}));
      const home=document.body.classList.contains('view-home');
      uploadMode='doc';
      return {before,after,newest,home};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })()`));
  check('主頁上載：每檔建立新筆記',!up1.err&&(up1.after-up1.before)===2,'before='+up1.before+' after='+up1.after+(up1.err?' ERR:'+up1.err:''));
  const names=(up1.newest||[]).map(d=>d.name);check('新筆記以檔名命名',names.length===2&&names.some(n=>/alpha/.test(n))&&names.some(n=>/beta/.test(n)),JSON.stringify(names));
  check('上載後回到主頁',up1.home===true);

  // --- editor upload: imports into current note
  const up2=JSON.parse(await evalJs(`(async function(){
    try{
      const d=S.docs[0];openDoc(d.id);
      const pagesBefore=d.pages.length;
      const filesBefore=(d.files||[]).length;
      uploadMode='doc';
      const f=new File(['line1\\nline2\\nline3'],'內容.txt',{type:'text/plain'});
      await handleFiles([f]);
      return {pagesBefore,pagesAfter:d.pages.length,filesBefore,filesAfter:(d.files||[]).length,name:d.name};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })()`));
  check('編輯頁上載：匯入目前筆記',!up2.err&&up2.pagesAfter>=up2.pagesBefore&&up2.filesAfter===up2.filesBefore+1,JSON.stringify(up2));
  check('編輯頁上載不建新筆記',up2.filesAfter===up2.filesBefore+1,'files='+up2.filesAfter);

  const btn=JSON.parse(await evalJs(`JSON.stringify({exists:!!document.getElementById('btnUploadDoc')})`));
  check('編輯頁有上載按鈕',btn.exists===true);

  check('互動過程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));

  const pass=results.filter(r=>r.ok).length;
  console.log('\\n=== '+pass+'/'+results.length+' 通過 ===');
  chrome.kill();
  process.exit(pass===results.length?0:1);
}
main();