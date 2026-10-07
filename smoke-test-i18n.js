#!/usr/bin/env node
/* i18n verification: elbar/colorPop/upload keys in EN + SIM */
const {spawn}=require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9338;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-i18n','about:blank'],{stdio:'ignore'});
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

  // EN: elbar + colorPop labels + upload button tip
  const en=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      setLang('en');
      const d=curDoc();
      const cfg={type:'draw',xmin:0,xmax:100,xstep:20,ymin:0,ymax:100,ystep:20,
        zero:true,grid:true,eqAuto:true,title:'t',xl:'X',yl:'Y',lines:[{id:uid(),kind:'line',color:'#d32f2f',dashed:false,arrowStart:false,arrowEnd:false,name:'',pts:[[0,0],[1,1]]}],ilabels:{}};
      const el={id:uid(),type:'chart',x:50,y:50,w:460,h:330,cfg};
      d.pages[0].els.push(el);
      S.sel={pi:0,id:el.id};S.dselLine=0;commit();renderAll();
      const bar=document.getElementById('elbar');
      const smi=(bar.querySelector('.smi')||{}).textContent;
      const caxis=bar.querySelector('[data-b="caxis"]');
      const dline=bar.querySelector('[data-b="dline"]');
      const uploadBtn=document.querySelector('[data-tip="Upload files into this note"]');
      const colorPop=document.getElementById('colorPop');
      const popAria=colorPop.getAttribute('aria-label');
      // check palette swatch aria
      const swAria=colorPop.querySelector('.cpSw').getAttribute('aria-label');
      const eyeTip=document.getElementById('cpEye').getAttribute('data-tip');
      return {smi,caxisTitle:caxis&&caxis.getAttribute('title'),dlineTitle:dline&&dline.getAttribute('title'),
        uploadTip:!!uploadBtn,popAria,swAria,eyeTip};
    }catch(e){return {err:String(e)}}
  })())`));
  check('EN smi = "1 line"',en.smi==='1 line · selected #1',JSON.stringify(en.smi));
  check('EN caxis title',en.caxisTitle==='Axes settings',JSON.stringify(en.caxisTitle));
  check('EN dline title',en.dlineTitle==='+ Straight line',JSON.stringify(en.dlineTitle));
  check('EN 上載按鈕 tooltip',en.uploadTip===true);
  check('EN 調色盤 aria-label',en.popAria==='Color palette',JSON.stringify(en.popAria));
  check('EN 色票 aria-label',en.swAria==='Red',JSON.stringify(en.swAria));
  check('EN 吸色 tooltip',en.eyeTip==='Eyedropper (click to pick a color)',JSON.stringify(en.eyeTip));

  // SIM
  const sim=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      setLang('zh-Hans');
      const bar=document.getElementById('elbar');
      const smi=(bar.querySelector('.smi')||{}).textContent;
      const caxis=bar.querySelector('[data-b="caxis"]');
      const colorPop=document.getElementById('colorPop');
      return {smi,caxisTitle:caxis&&caxis.getAttribute('title'),
        popAria:colorPop.getAttribute('aria-label'),
        swAria:colorPop.querySelector('.cpSw').getAttribute('aria-label')};
    }catch(e){return {err:String(e)}}
  })())`));
  check('SIM smi = 1 条线',sim.smi==='1 条线 · 选取 #1',JSON.stringify(sim.smi));
  check('SIM caxis title',sim.caxisTitle==='坐标轴设置',JSON.stringify(sim.caxisTitle));
  check('SIM 調色盤 aria-label',sim.popAria==='调色盘',JSON.stringify(sim.popAria));
  check('SIM 色票 aria-label',sim.swAria==='红',JSON.stringify(sim.swAria));

  // back to zh-TW, no errors
  const zh=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      setLang('zh-TW');
      const bar=document.getElementById('elbar');
      return {smi:(bar.querySelector('.smi')||{}).textContent};
    }catch(e){return {err:String(e)}}
  })())`));
  check('zh-TW smi 還原',zh.smi==='1 條線 · 選取 #1',JSON.stringify(zh.smi));
  check('全程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));

  const pass=results.filter(r=>r.ok).length;
  console.log('\\n=== '+pass+'/'+results.length+' 通過 ===');
  chrome.kill();
  process.exit(pass===results.length?0:1);
}
main();