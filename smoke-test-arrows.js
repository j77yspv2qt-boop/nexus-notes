#!/usr/bin/env node
/* Verify: two-line arrow creation/selection/deletion, draggable line names, NEXUS brand */
const {spawn}=require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9340;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-arrows','about:blank'],{stdio:'ignore'});
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

  // setup: doc + draw chart + 2 lines
  const setup=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);
      setTool('select');
      const d=curDoc();d.pages[0].els=[];
      const cfg={type:'draw',xmin:0,xmax:100,xstep:20,ymin:0,ymax:100,ystep:20,
        zero:true,grid:true,eqAuto:true,title:'自繪經濟圖表',xl:'X',yl:'Y',lines:[],ilabels:{},arrows:[]};
      const el={id:uid(),type:'chart',x:40,y:40,w:520,h:380,cfg};
      d.pages[0].els.push(el);
      S.sel={pi:0,id:el.id};commit();renderAll();
      drawAddLine(el,'line');drawAddLine(el,'line');
      el.cfg.lines[0].name='D';el.cfg.lines[1].name='S';
      el.cfg.lines[0].namePos=[20,80];el.cfg.lines[1].namePos=[15,65];
      S.dselLine=1;commit();renderAll();
      const node=document.querySelector('.el[data-id="'+el.id+'"]');
      const labels=[...node.querySelectorAll('.nhandle')].map(x=>x.textContent);
      const svgNames=[...node.querySelectorAll('text[data-nametext]')].map(x=>x.textContent);
      return {lines:el.cfg.lines.length,names:el.cfg.lines.map(l=>l.name),labels,svgNames,
        armsLen:(el.cfg.arrows||[]).length};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('兩條線 + 名稱標籤渲染',setup.lines===2&&setup.labels&&setup.labels.join(',')==='D,S',JSON.stringify(setup));
  check('名稱標籤為 HTML 覆蓋層(.nhandle)',setup.labels&&setup.labels.length===2);
  check('SVG 含線條名稱文字(可匯出)',setup.svgNames&&setup.svgNames.join(',')==='D,S',JSON.stringify(setup.svgNames));

  // simulate drag from line0 to line1 via pointer handlers
  const drag=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const d=curDoc();const f=findEl(S.sel.id);const e=f.el;const G=drawGeom(e);
      const node=document.querySelector('.el[data-id="'+e.id+'"]');
      const rect=node.getBoundingClientRect();
      const z=S.zoom||1;
      /* pick a point on line0 (near its start) and a point on line1 */
      const p0=e.cfg.lines[0].pts[0];
      const p1=e.cfg.lines[1].pts[0];
      const sx=rect.left+G.X(p0[0])*z, sy=rect.top+G.Y(p0[1])*z;
      const ex=rect.left+G.X(p1[0])*z, ey=rect.top+G.Y(p1[1])*z;
      const pd=(t,x,y)=>{const ev=new PointerEvent(t,{bubbles:true,clientX:X,clientY:Y,button:0});};
      function mk(t,X,Y){return new PointerEvent(t,{bubbles:true,cancelable:true,clientX:X,clientY:Y,button:0,pointerId:1});}
      /* pointerdown on the line stroke: use the svg path element */
      const vb=node.querySelector('svg').getBoundingClientRect();
      const path=node.querySelector('path[data-linei="0"]');
      path.dispatchEvent(mk('pointerdown',sx,sy));
      window.dispatchEvent(mk('pointermove',ex,ey));
      const ghost=node.querySelector('.ghostLine');
      const ghostOk=ghost&&ghost.getAttribute('class').indexOf('ok')>=0;
      const hint=document.getElementById('lineDragHint');
      const hintTxt=hint?hint.textContent:'';
      window.dispatchEvent(mk('pointerup',ex,ey));
      const n=(e.cfg.arrows||[]).length;
      const ar=n?e.cfg.arrows[n-1]:null;
      const node2=document.querySelector('.el[data-id="'+e.id+'"]');const svgAfter=node2.querySelector('svg').innerHTML;
      return {dragActive:!!S.sel,ghostOk,hintTxt,n,ar,hasMarker:svgAfter.indexOf('marrow')>=0,
        hasDarrow:svgAfter.indexOf('darrow')>=0};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('拖曳時顯示 ghost 線並高亮目標',drag.ghostOk===true,JSON.stringify({ghostOk:drag.ghostOk,hint:drag.hintTxt}));
  check('放開後建立一條箭頭',drag.n===1,'arrows='+drag.n+(drag.err?' ERR:'+drag.err:''));
  check('箭頭預設黑色',drag.ar&&drag.ar.color==='#111111',JSON.stringify(drag.ar&&drag.ar.color));
  check('箭頭連接兩線端點',drag.ar&&drag.ar.to!=null&&drag.ar.x1!=null&&drag.ar.x2!=null,JSON.stringify(drag.ar));
  check('SVG 含黑色箭頭 marker',drag.hasMarker===true);
  check("SVG 渲染箭頭元素",drag.hasDarrow===true);

  // select the arrow then delete via Delete key
  const del=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const f=findEl(S.sel.id);const e=f.el;const node=document.querySelector('.el[data-id="'+e.id+'"]');
      const hit=node.querySelector('line.darrowHit[data-arrowi="0"]');
      hit.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:1}));
      const selSet=S.dselArrow===0;
      const node2=document.querySelector('.el[data-id="'+e.id+'"]');
      const hasSel=!!node2.querySelector('.darrow.sel');
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete'}));
      const after=(e.cfg.arrows||[]).length;
      const node3=document.querySelector('.el[data-id="'+e.id+'"]');
      const gone=!node3.querySelector('line.darrow[data-arrowi]');
      return {selSet,hasSel,after,gone};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('點擊箭頭可選取',del.selSet===true&&del.hasSel===true,JSON.stringify(del));
  check('Delete 鍵刪除箭頭',del.after===0&&del.gone===true,JSON.stringify(del));

  // line name drag: pointerdown on .nhandle then move
  const nm=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const e=findEl(S.sel.id).el;const node=document.querySelector('.el[data-id="'+e.id+'"]');
      const nh=node.querySelector('.nhandle[data-li="0"]');
      const r=nh.getBoundingClientRect();
      nh.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:2,clientX:r.left+5,clientY:r.top+5}));
      const before=(e.cfg.lines[0].namePos||[]).join(',');
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.left+60,clientY:r.top+40,pointerId:2}));
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2}));
      const after=(e.cfg.lines[0].namePos||[]).join(',');
      return {before,after,changed:before!==after,hasPos:!!e.cfg.lines[0].namePos};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('線條名稱可獨立拖曳',nm.hasPos===true&&nm.changed===true,JSON.stringify(nm));

  // NEXUS brand
  const brand=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const b=document.querySelector('#brandHome');
      const use=b.querySelector('use');
      return {text:b.textContent.trim(),href:use.getAttribute('href'),
        hasNexus:!!document.querySelector('symbol#i-nexus'),
        title:document.title};
    }catch(e){return {err:String(e)}}
  })())`));
  check('品牌名稱改為 NEXUS',brand.text==='NEXUS',brand.text);
  check('使用 NEXUS 圖示 (#i-nexus)',brand.href==='#i-nexus'&&brand.hasNexus===true,JSON.stringify(brand));
  check('頁面標題含 NEXUS',/NEXUS/.test(brand.title||''),brand.title);

  // English mode: arrow keys present
  const en=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      setLang('en');
      const f=findEl(S.sel.id);const e=f.el;
      e.cfg.arrows=[{id:uid(),x1:10,y1:80,x2:20,y2:70,to:1,color:'#111111'}];
      S.dselArrow=null;updateSelUI();
      const bar=document.getElementById('elbar');
      const del=[...bar.querySelectorAll('button')].find(b=>b.dataset.b==='darrowDel');
      const title=del?del.getAttribute('title'):'';
      const smi=(bar.querySelector('.smi')||{}).textContent;
      setLang('zh-TW');
      return {title,smi};
    }catch(e){return {err:String(e)}}
  })())`));
  check('EN 箭頭刪除鈕 tooltip',en.title==='Delete selected arrow',JSON.stringify(en.title));
  check('smi 顯示箭頭數量(單數 1 arrow)',/1 arrow\b/.test(en.smi||''),en.smi);

  check('全程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));
  const pass=results.filter(r=>r.ok).length;
  console.log('\\n=== '+pass+'/'+results.length+' 通過 ===');
  chrome.kill();
  process.exit(pass===results.length?0:1);
}
main();