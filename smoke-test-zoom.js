#!/usr/bin/env node
/* Verify zoomBar wiring (zbIn/zbOut/zbRange/zbVal) */
const {spawn}=require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9339;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-zoom','about:blank'],{stdio:'ignore'});
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
    if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails.exception||m.params.exceptionDetails.text));};
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

  const zb=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);
      const d=curDoc();if(!d.pages.length)d.pages.push(blankPage());renderAll();
      setZoom(1);
      const v1=document.getElementById('zbVal').textContent;
      const r1=+document.getElementById('zbRange').value;
      document.getElementById('zbIn').click();
      const v2=document.getElementById('zbVal').textContent;
      document.getElementById('zbOut').click();
      document.getElementById('zbOut').click();
      const v3=document.getElementById('zbVal').textContent;
      const rng=document.getElementById('zbRange');
      rng.value=200;rng.dispatchEvent(new Event('input'));
      const v4=document.getElementById('zbVal').textContent;
      const z4=+S.zoom.toFixed(2);
      return {v1,r1,v2,v3,v4,z4};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('zbVal 初始 100%',zb.v1==='100%',zb.v1+(zb.err?' ERR:'+zb.err:''));
  check('zbRange 初始 100',zb.r1===100,'r='+zb.r1);
  check('zbIn 點擊放大',zb.v2&&zb.v2!=='100%','v2='+zb.v2);
  check('zbOut 點擊縮小',zb.v3&&zb.v3!=='100%','v3='+zb.v3);
  check('zbRange 拖動縮放',zb.v4==='200%'&&zb.z4===2,'v4='+zb.v4+' zoom='+zb.z4);

  check('全程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));
  const pass=results.filter(r=>r.ok).length;
  console.log('\\n=== '+pass+'/'+results.length+' 通過 ===');
  chrome.kill();
  process.exit(pass===results.length?0:1);
}
main();