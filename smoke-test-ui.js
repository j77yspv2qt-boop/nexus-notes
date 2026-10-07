#!/usr/bin/env node
/* Verify: red ✕ delete, line-name font size, draggable elbar grip,
   zoom bar embedded in properties panel, Nexus icon, mobile layout, pinch zoom */
const {spawn}=require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9341;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-ui','about:blank'],{stdio:'ignore'});
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

  // setup: doc + text element + draw chart with one named line
  const setup=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);
      const d=curDoc();d.pages[0].els=[];
      const te=makeText(120,60,'hello',280,34);
      d.pages[0].els.push(te);
      const cfg={type:'draw',xmin:0,xmax:100,xstep:20,ymin:0,ymax:100,ystep:20,
        zero:true,grid:true,eqAuto:true,title:'T',xl:'X',yl:'Y',lines:[],ilabels:{},arrows:[]};
      const ce={id:uid(),type:'chart',x:60,y:520,w:520,h:360,cfg};
      d.pages[0].els.push(ce);
      S.sel={pi:0,id:te.id};commit();renderAll();
      return {ok:true,textId:te.id,chartId:ce.id};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('測試資料建立',setup.ok===true,JSON.stringify(setup));

  // --- elbar: red ✕ delete button (no trash emoji) ---
  const del=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const bar=document.getElementById('elbar');
      const b=bar.querySelector('[data-b="del"]');
      const grip=bar.querySelector('.elgrip');
      return {txt:b.textContent,cls:b.className,
        red:getComputedStyle(b).color, hasTrash:/🗑/.test(bar.innerHTML),
        hasGrip:!!grip, gripTitle:grip?grip.title:'', gripW:grip?grip.offsetWidth:0};
    }catch(e){return {err:String(e)}}
  })())`));
  check('刪除鍵為 ✕（非垃圾桶 emoji）',del.txt==='✕'&&del.hasTrash===false,JSON.stringify(del));
  check('刪除鍵為紅色',del.red==='rgb(217, 45, 32)',del.red);
  check('左側握把存在且有寬度',del.hasGrip===true&&del.gripW>=14,'w='+del.gripW+' title='+del.gripTitle);

  // --- default placement: bar does NOT cover the text box ---
  const place=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const f=findEl(S.sel.id);const e=f.el;
      const bar=document.getElementById('elbar');
      const bl=parseFloat(bar.style.left),bt=parseFloat(bar.style.top);
      const bw=bar.offsetWidth,bh=bar.offsetHeight;
      const overlap=!(bl+bw<=e.x || bl>=e.x+e.w || bt+bh<=e.y || bt>=e.y+e.h);
      return {bl,bt,bw,bh,ex:e.x,ey:e.y,ew:e.w,eh:e.h,overlap};
    }catch(e){return {err:String(e)}}
  })())`));
  check('預設位置不遮擋輸入框',place.overlap===false,JSON.stringify(place));

  // --- grip drag moves the bar + persists across re-render (relative offset) ---
  const gripDrag=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const f=findEl(S.sel.id);const e=f.el;
      const bar=document.getElementById('elbar');
      const grip=bar.querySelector('.elgrip');
      const z=S.zoom||1;
      const before={x:parseFloat(bar.style.left),y:parseFloat(bar.style.top)};
      function mk(t,dx,dy){return new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:9,
        clientX:(bar.getBoundingClientRect().left+8)+dx*z,clientY:(bar.getBoundingClientRect().top+8)+dy*z,button:0});}
      grip.dispatchEvent(mk('pointerdown',0,0));
      grip.dispatchEvent(mk('pointermove',90,70));
      grip.dispatchEvent(mk('pointerup',90,70));
      const after={x:parseFloat(bar.style.left),y:parseFloat(bar.style.top)};
      const off=S.elbarOff&&S.elbarOff[e.id];
      commit();renderAll();
      const bar2=document.getElementById('elbar');
      const after2={x:parseFloat(bar2.style.left),y:parseFloat(bar2.style.top)};
      const moved=(after.x!==before.x||after.y!==before.y);
      return {before,after,after2,off,moved,persist:Math.abs(after2.x-after.x)<1.5&&Math.abs(after2.y-after.y)<1.5};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('握把拖曳移動編輯列',gripDrag.moved===true,JSON.stringify(gripDrag));
  check('移動位置跨重繪保留(相對元素)',gripDrag.persist===true&&!!gripDrag.off,JSON.stringify(gripDrag));

  // --- line name font size ---
  const nameFS=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const d=curDoc();
      const ce=d.pages[0].els.find(x=>x.type==='chart');
      S.sel={pi:0,id:ce.id};commit();renderAll();
      drawAddLine(ce,'line');
      ce.cfg.lines[0].name='D';
      S.dselLine=0;commit();renderAll();
      const bar=document.getElementById('elbar');
      const inp=bar.querySelector('[data-b="dnfs"]');
      if(!inp)return {err:'dnfs input missing'};
      const v0=inp.value;
      inp.value='24';
      inp.dispatchEvent(new Event('change',{bubbles:true}));
      const node=document.querySelector('.el[data-id="'+ce.id+'"]');
      const svgT=node.querySelector('text[data-nametext]');
      const nh=node.querySelector('.nhandle');
      return {v0, stored:curDoc().pages[0].els.find(x=>x.type==='chart').cfg.lines[0].nameFS,
        svgFS:svgT?svgT.getAttribute('font-size'):null,
        nhFS:nh?nh.style.fontSize:null};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('線名稱字級輸入框存在',nameFS.v0==='10.5',JSON.stringify(nameFS));
  check('字級寫入 ln.nameFS',nameFS.stored===24,'stored='+nameFS.stored);
  check('SVG 文字套用字級(可匯出)',nameFS.svgFS==='24','svgFS='+nameFS.svgFS);
  check('拖曳把手同步字級',nameFS.nhFS==='24px','nhFS='+nameFS.nhFS);

  // --- zoom bar embedded in properties panel ---
  const zb=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const z=document.getElementById('zoomBar');
      const panel=document.getElementById('panel');
      const inPanel=!!(z&&panel&&panel.contains(z));
      const prev=z?getComputedStyle(z).position:null;
      return {inPanel,position:prev};
    }catch(e){return {err:String(e)}}
  })())`));
  check('縮放列嵌入 Properties 欄',zb.inPanel===true,JSON.stringify(zb));
  check('縮放列非浮動(fixed→面板內)',zb.inPanel===true&&zb.position!=='fixed',JSON.stringify(zb));

  // --- Nexus icon replaces hand-drawn one ---
  const icon=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const fav=document.querySelector('link[rel="icon"]');
      const sym=document.querySelector('symbol#i-nexus');
      const img=sym?sym.querySelector('image'):null;
      return {fav:(fav&&fav.href||'').slice(0,30),
        symImg:!!img, symHref:img?(img.getAttribute('href')||'').slice(0,30):null};
    }catch(e){return {err:String(e)}}
  })())`));
  check('favicon 換成 Nexus icon (JPEG data-URI)',/^data:image\/jpeg/.test(icon.fav||''),icon.fav);
  check('品牌圖示 #i-nexus 使用實體 icon',icon.symImg===true&&/^data:image\/jpeg/.test(icon.symHref||''),JSON.stringify(icon));

  // --- pinch zoom API ---
  const pinch=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);
      setZoom(1);
      const mkT=(x1,y1,x2,y2)=>[{clientX:x1,clientY:y1},{clientX:x2,clientY:y2}];
      NexusPinch.start(mkT(100,100,200,100));
      const active=NexusPinch.active;
      NexusPinch.move(mkT(100,100,250,100));
      const z1=S.zoom;
      const p=NexusPinch.move(mkT(100,100,300,100));
      const z2=S.zoom;
      NexusPinch.end([{clientX:1,clientY:1}]);
      return {active,z1:+z1.toFixed(2),z2:+z2.toFixed(2),handled:p,afterEnd:!NexusPinch.active};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('NexusPinch 捏合啟動',pinch.active===true,JSON.stringify(pinch));
  check('雙指放大 → 文件 1.5x',pinch.z1===1.5,'z1='+pinch.z1);
  check('持續放大 → 2x / 結束復原',pinch.z2===2&&pinch.afterEnd===true,JSON.stringify(pinch));

  // --- mobile layout (≤768px): sidebar/panel/zoomgrp/tlabel hidden, topbar single-line scroll ---
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
  await sleep(500);
  const mob=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const disp=id=>{const el=document.getElementById(id);return el?getComputedStyle(el).display:'missing';};
      const zg=document.querySelector('.zoomgrp');
      const tl=document.querySelector('.tlabel');
      const tb=document.getElementById('topbar');
      const tcs=getComputedStyle(document.getElementById('tbCats'));
      const tbs=getComputedStyle(tb);
      return {sidebar:disp('sidebar'),panel:disp('panel'),sideToggle:disp('sideToggle'),
        zoomgrp:zg?getComputedStyle(zg).display:'none',
        tlabel:tl?getComputedStyle(tl).display:'none',
        topbarWrap:tbs.flexWrap,topbarOx:tcs.overflowX,
        catsCount:document.querySelectorAll('#tbCats .tcat').length,
        paneOn:document.querySelectorAll('#tbPanel .tbPane.on').length,
        innerW:window.innerWidth};
    }catch(e){return {err:String(e)}}
  })())`));
  check('手機寬度模擬生效(≤768)',mob.innerW<=768,'w='+mob.innerW);
  check('手機版隱藏側欄 #sidebar',mob.sidebar==='none',JSON.stringify(mob));
  check('手機版隱藏屬性欄 #panel',mob.panel==='none',JSON.stringify(mob));
  check('手機版隱藏縮放鈕組 .zoomgrp',mob.zoomgrp==='none',JSON.stringify(mob));
  check('頂列單行不換行+分類列橫向捲動',mob.topbarWrap==='nowrap'&&mob.topbarOx==='auto',JSON.stringify({wrap:mob.topbarWrap,ox:mob.topbarOx}));
  check('分類鈕 6 個且只顯示 1 個工具面板',mob.catsCount===6&&mob.paneOn===1,JSON.stringify({cats:mob.catsCount,pane:mob.paneOn}));
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await sleep(400);
  const desk=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const sb=document.getElementById('sidebar');
      return {sidebar:sb?getComputedStyle(sb).display:'missing',w:window.innerWidth};
    }catch(e){return {err:String(e)}}
  })())`));
  check('回桌面版側欄恢復顯示',desk.sidebar!=='none',JSON.stringify(desk));

  check('全程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));
  const pass=results.filter(r=>r.ok).length;
  console.log('\\n=== '+pass+'/'+results.length+' 通過 ===');
  chrome.kill();
  process.exit(pass===results.length?0:1);
}
main();
