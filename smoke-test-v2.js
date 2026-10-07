#!/usr/bin/env node
/* Verify: line color via shared colorPop palette, fixed topbar layout across i18n,
   frosted sidebar cards, zoomSel dynamic option text */
const {spawn}=require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9342;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-v2','--window-size=1440,900','about:blank'],{stdio:'ignore'});
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

  // setup: draw chart + one line
  const setup=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);
      const d=curDoc();d.pages[0].els=[];
      const cfg={type:'draw',xmin:0,xmax:100,xstep:20,ymin:0,ymax:100,ystep:20,
        zero:true,grid:true,eqAuto:true,title:'T',xl:'X',yl:'Y',lines:[],ilabels:{},arrows:[]};
      const ce={id:uid(),type:'chart',x:60,y:80,w:520,h:360,cfg};
      d.pages[0].els.push(ce);
      S.sel={pi:0,id:ce.id};commit();renderAll();
      drawAddLine(ce,'line');
      ce.cfg.lines[0].name='D';S.dselLine=0;commit();renderAll();
      return {ok:true,chartId:ce.id,color:ce.cfg.lines[0].color};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('測試資料建立(含一條線)',setup.ok===true&&setup.color!=null,JSON.stringify(setup));

  // --- 1. line color uses shared colorPop palette ---
  const lc1=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const bar=document.getElementById('elbar');
      const native=bar.querySelector('input[type="color"][data-b="dcolor"]');
      const sw=bar.querySelector('button.dswatch[data-b="dcolor"]');
      if(!sw)return {err:'dswatch missing',native:!!native};
      sw.click();
      const pop=document.getElementById('colorPop');
      const open=pop.classList.contains('open');
      const cpCur=document.getElementById('cpCur');
      return {native:!!native,open,cpCur:cpCur?getComputedStyle(cpCur).background.slice(0,30):null,
        sv:!!document.getElementById('cpSV'),hue:!!document.getElementById('cpHue')};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('線條改用 colorPop 調色盤(非原生 input)',lc1.native===false&&lc1.open===true,JSON.stringify(lc1));
  check('調色盤含 SV+色相+當前色',lc1.sv===true&&lc1.hue===true&&!!lc1.cpCur,JSON.stringify(lc1));


  const lc2=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      /* 選綠色票 */
      document.querySelector('#colorPop .cpSw[data-c="#43a047"]').click();
      const ce=curDoc().pages[0].els.find(x=>x.type==='chart');
      const svgStroke=document.querySelector('.el[data-id="'+ce.id+'"] path[data-linei="0"]');
      const sw=document.querySelector('.elbar .dswatch');
      const pop=document.getElementById('colorPop');
      const histBefore=S.hi;
      closeColorPop();
      return {color:ce.cfg.lines[0].color,
        svg:svgStroke?svgStroke.getAttribute('stroke'):null,
        swBg:sw?sw.style.background:null,
        closed:!pop.classList.contains('open'),
        committed:S.hi>=histBefore};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('色票寫入線條顏色',lc2.color==='#43a047',JSON.stringify(lc2));
  check('SVG 線條同步變色',lc2.svg==='#43a047',JSON.stringify(lc2));
  check('elbar 色塊同步',/67\s*,\s*160\s*,\s*71/.test(lc2.swBg||''),lc2.swBg);
  check('關閉調色盤後 commit',lc2.closed===true&&lc2.committed===true,JSON.stringify(lc2));

  // --- 2. editor toolbar: category tabs, stable layout across zh/en ---
  const lay1=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      setLang('zh-TW');
      const cats=[...document.querySelectorAll('#tbCats .tcat')];
      const g=cats.map(x=>Math.round(x.getBoundingClientRect().left));
      const lbl=cats.map(x=>Math.round(x.getBoundingClientRect().width));
      const fs=getComputedStyle(cats[0]).fontSize;
      const bfs=getComputedStyle(document.querySelector('#tbPanel .tbPane.on button')).fontSize;
      return {g,lbl,fs,bfs};
    }catch(e){return {err:String(e)}}
  })())`));
  await sleep(300);
  const lay2=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      setLang('en');
      const cats=[...document.querySelectorAll('#tbCats .tcat')];
      const g=cats.map(x=>Math.round(x.getBoundingClientRect().left));
      const lbl=cats.map(x=>Math.round(x.getBoundingClientRect().width));
      return {g,lbl};
    }catch(e){return {err:String(e)}}
  })())`));
  await sleep(300);
  await evalJs(`setLang('zh-TW')`);
  check('分類鈕字級 ≥14px',parseFloat(lay1.fs)>=14,'fs='+lay1.fs);
  check('工具按鈕字級 ≥14px',parseFloat(lay1.bfs)>=14,'fs='+lay1.bfs);
  const samePos=lay1.g.length===lay2.g.length&&lay1.g.every((v,i)=>Math.abs(v-lay2.g[i])<=2);
  const sameW=lay1.lbl.length===lay2.lbl.length&&lay1.lbl.every((v,i)=>Math.abs(v-lay2.lbl[i])<=2);
  check('切換中英文 分類鈕位置不變(±2px)',samePos,JSON.stringify({zh:lay1.g,en:lay2.g}));
  check('切換中英文 分類鈕寬度一致(±2px)',sameW,JSON.stringify({zh:lay1.lbl,en:lay2.lbl}));


  // --- 3. sidebar frosted gradient cards ---
  const sb=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const side=document.getElementById('sidebar');
      const card=document.querySelector('.docItem');
      if(!side||!card)return {err:'missing',side:!!side,card:!!card};
      const cs=getComputedStyle(side);
      const cc=getComputedStyle(card);
      return {sideRadius:cs.borderRadius,sideBg:cs.backgroundImage.slice(0,60),
        sideBlur:cs.backdropFilter||cs.webkitBackdropFilter,
        cardRadius:parseFloat(cc.borderRadius),cardBg:cc.backgroundImage.includes('gradient'),
        cardBlur:(cc.backdropFilter||cc.webkitBackdropFilter||'').includes('blur')};
    }catch(e){return {err:String(e)}}
  })())`));
  check('側欄圓角+漸變背景',sb.sideRadius!=='0px'&&/gradient/.test(sb.sideBg||''),JSON.stringify(sb));
  check('側欄磨砂 backdrop-filter',/blur/.test(sb.sideBlur||''),sb.sideBlur);
  check('筆記卡片圓角 ≥14px+漸變+磨砂',sb.cardRadius>=14&&sb.cardBg===true&&sb.cardBlur===true,JSON.stringify(sb));

  // --- 4. zoomSel dynamic option always has text ---
  const zm=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);setZoom(1);
      const s=document.getElementById('zoomSel');
      const t1=s.options[s.selectedIndex].textContent;
      zoomStep(1);
      const v2=s.value;
      const t2=s.options[s.selectedIndex].textContent;
      zoomStep(1);
      const t3=s.options[s.selectedIndex].textContent;
      const dynCount=[...s.options].filter(o=>o.dataset.dyn).length;
      setZoom(1);
      const t4=s.options[s.selectedIndex].textContent;
      const dynAfter=[...s.options].filter(o=>o.dataset.dyn).length;
      const empty=[...s.options].filter(o=>!o.textContent).length;
      return {t1,v2,t2,t3,dynCount,t4,dynAfter,empty};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('初始顯示 100%',zm.t1==='100%',JSON.stringify(zm));
  check('縮放後選項有文字(非空白)',zm.t2==='120%'&&zm.t3==='144%',JSON.stringify(zm));
  check('動態選項只保留 1 個且無空白項',zm.dynCount===1&&zm.empty===0,JSON.stringify(zm));
  check('回到 100% 後動態項清除',zm.t4==='100%'&&zm.dynAfter===0,JSON.stringify(zm));

  check('全程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));
  const pass=results.filter(r=>r.ok).length;
  console.log('\n=== '+pass+'/'+results.length+' 通過 ===');
  chrome.kill();
  process.exit(pass===results.length?0:1);
}
main();
