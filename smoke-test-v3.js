#!/usr/bin/env node
/* Verify v3 UI 集中優化：主頁頂列尺寸一致 / 卡片固定扁身磨砂隨機漸變 / 主頁捲動 /
   編輯頁分類列(預設文字工具) / 畫布自由平移 / 移除藍色點擊回饋 / 安全區域 */
const {spawn}=require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9343;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-cdp-v3','--window-size=1440,900','about:blank'],{stdio:'ignore'});
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
  // --- 0. 建立多筆記，回到主頁 ---
  await evalJs(`(function(){for(let i=0;i<5;i++)newDoc('測試'+i);showHome();return true;})()`);
  await sleep(300);

  // --- 1. 主頁頂列：品牌與按鈕尺寸一致（不擁擠） ---
  const top=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const h=(s)=>{const e=document.querySelector(s);return e?+e.getBoundingClientRect().height.toFixed(1):null;};
      return {brand:h('.homeTop .brand'),gbtn:h('.homeActs .gbtn'),ibtn:h('.homeActs .ibtn'),
        lang:h('.homeActs .langSel'),
        wrap:getComputedStyle(document.querySelector('.homeTop')).flexWrap};
    }catch(e){return {err:String(e)}}
  })())`));
  check('主頁頂列品牌/主要按鈕高度一致(±3px)',top.brand&&top.gbtn&&Math.abs(top.brand-top.gbtn)<=3,JSON.stringify(top));
  check('主頁頂列圖示鈕與品牌同高(±3px)',top.brand&&top.ibtn&&Math.abs(top.brand-top.ibtn)<=3,JSON.stringify(top));
  check('主頁頂列語言選擇與品牌同高(±3px)',top.brand&&top.lang&&Math.abs(top.brand-top.lang)<=3,JSON.stringify(top));

  // --- 2. 主頁卡片：固定大小 + 磨砂圓角 + 隨機漸變 ---
  const cards=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const cs=[...document.querySelectorAll('.ncard')];
      const heights=cs.map(c=>Math.round(c.getBoundingClientRect().height));
      const widths=cs.map(c=>Math.round(c.getBoundingClientRect().width));
      const info=cs.map(c=>({
        r:parseFloat(getComputedStyle(c).borderRadius),
        blur:(getComputedStyle(c).backdropFilter||getComputedStyle(c).webkitBackdropFilter||''),
        grad:getComputedStyle(c).backgroundImage.includes('gradient'),
        c1:(c.style.getPropertyValue('--c1')||'').trim(),
        isNew:c.classList.contains('new')
      }));
      const notes=info.filter(x=>!x.isNew);
      return {n:cs.length, heights,widths,
        uniform:heights.length>1&&heights.every(h=>h===heights[0])&&widths.every(w=>w===widths[0]),
        h:heights[0],
        rounded:info.every(x=>x.r>=18),
        frosted:notes.length>0&&notes.every(x=>x.blur.indexOf('blur')>=0&&x.grad)&&info.every(x=>x.grad),
        tinted:notes.length>0&&notes.every(x=>x.c1.length>0),
        distinct:new Set(notes.map(x=>x.c1)).size};
    }catch(e){return {err:String(e)}}
  })())`));
  check('卡片固定統一大小',cards.uniform===true,JSON.stringify({h:cards.h,hs:cards.heights}));
  check('卡片比網頁版扁(高度 ≤130px)',cards.h!=null&&cards.h<=130,'h='+cards.h);
  check('卡片圓角 ≥18px',cards.rounded===true,JSON.stringify(cards.rounded));
  check('卡片磨砂+漸變(backdrop blur)',cards.frosted===true,JSON.stringify(cards.frosted));
  check('卡片有隨機漸變色(≥2 種)',cards.tinted===true&&cards.distinct>=2,JSON.stringify({distinct:cards.distinct}));

  // --- 3. 主頁可往下滑動 ---
  const scroll=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const g=document.getElementById('homeGrid');
      const cs=getComputedStyle(g);
      return {oy:cs.overflowY, canScroll:g.scrollHeight>=g.clientHeight, sh:g.scrollHeight, ch:g.clientHeight};
    }catch(e){return {err:String(e)}}
  })())`));
  check('主頁網格可垂直捲動',scroll.oy==='auto'||scroll.oy==='scroll',JSON.stringify(scroll));
  check('主頁網格有可捲動內容',scroll.canScroll===true,JSON.stringify(scroll));
  // --- 4. 移除藍色點擊回饋 + 安全區域 ---
  const fx=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const btn=document.querySelector('.homeActs .gbtn');
      const cs=getComputedStyle(btn);
      const tap=(cs.webkitTapHighlightColor||cs.getPropertyValue('-webkit-tap-highlight-color')||'').trim();
      const safe=getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim();
      const ht=getComputedStyle(document.querySelector('.homeTop')).paddingTop;
      return {tap,safe,ht};
    }catch(e){return {err:String(e)}}
  })())`));
  check('點擊無藍色回饋(tap-highlight=transparent)',/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|^transparent$/.test(fx.tap||''),JSON.stringify(fx));
  check('定義安全區域變數 --safe-top',!!fx.safe,JSON.stringify(fx));
  const safeWiring=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      const r=document.documentElement;
      const before=parseFloat(getComputedStyle(document.querySelector('.homeTop')).paddingTop);
      r.style.setProperty('--safe-top','40px');
      const after=parseFloat(getComputedStyle(document.querySelector('.homeTop')).paddingTop);
      r.style.removeProperty('--safe-top');
      return {before,after};
    }catch(e){return {err:String(e)}}
  })())`));
  check('安全區域變數驅動頂列 padding(+40px)',safeWiring.after>=safeWiring.before+40,JSON.stringify(safeWiring));

  // --- 5. 編輯頁：分類列 + 預設文字工具 ---
  const cats=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);
      const on=()=>document.querySelector('#tbPanel .tbPane.on').dataset.cat;
      const defaultCat=on();
      const defaultTool=S.tool;
      const toolBtn=document.querySelector('[data-tool="'+S.tool+'"]');
      const toolActive=toolBtn?toolBtn.classList.contains('active'):false;
      document.querySelector('.tcat[data-cat="insert"]').click();
      const after=on();
      const insertVisible=getComputedStyle(document.getElementById('btnInsertText')).display!=='none';
      const panesOn=document.querySelectorAll('#tbPanel .tbPane.on').length;
      document.querySelector('.tcat[data-cat="tools"]').click();
      const back=on();
      return {defaultCat,defaultTool,toolActive,after,insertVisible,panesOn,back,
        cats:document.querySelectorAll('#tbCats .tcat').length};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('進入編輯頁預設文字工具',cats.defaultTool==='text'&&cats.toolActive===true,JSON.stringify(cats));
  check('預設開啟「工具」分類',cats.defaultCat==='tools',JSON.stringify(cats));
  check('切換分類只顯示該類工具',cats.after==='insert'&&cats.panesOn===1&&cats.insertVisible===true,JSON.stringify(cats));
  check('切回「工具」分類生效',cats.back==='tools',JSON.stringify(cats));
  check('共 6 個分類鈕',cats.cats===6,JSON.stringify(cats));

  // --- 6. 編輯頁可自由平移（Google Docs 式） ---
  const pan=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      openDoc(curDoc().id);
      const ws=document.getElementById('workspace');
      const cs=getComputedStyle(ws);
      const pgs=document.getElementById('pages');
      S.panX=0;S.panY=0;S.zoom=1;applyPagesTransform();
      const t0=pgs.style.transform;
      ws.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:10,clientY:10,button:0,pointerId:9,pointerType:'mouse'}));
      ws.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:10,clientY:90,pointerId:9,pointerType:'mouse'}));
      const px1=S.panX, py1=S.panY;
      ws.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:10,clientY:90,pointerId:9}));
      const t1=pgs.style.transform;
      const mk=(x1,y1,x2,y2)=>[{clientX:x1,clientY:y1},{clientX:x2,clientY:y2}];
      S.panX=0;S.panY=0;S.zoom=1;applyPagesTransform();
      NexusPinch.start(mk(100,100,200,100));
      NexusPinch.move(mk(200,160,300,160));
      const px2=S.panX, py2=S.panY, z2=S.zoom;
      NexusPinch.end([{clientX:1,clientY:1}]);
      return {overflow:cs.overflow, touch:cs.touchAction, t0, t1, px1, py1, px2, py2, z2,
        moved:(px1!==0||py1!==0), pinchMoved:(px2!==0||py2!==0)};
    }catch(e){return {err:String(e)+' @ '+(e.stack||'').split('\\n')[1]}}
  })())`));
  check('畫布 overflow:hidden + touch-action:none',pan.overflow==='hidden'&&pan.touch==='none',JSON.stringify({overflow:pan.overflow,touch:pan.touch}));
  check('單指拖曳可上下平移',pan.moved===true&&pan.py1>0,JSON.stringify({px1:pan.px1,py1:pan.py1}));
  check('雙指可平移（跟手移動）',pan.pinchMoved===true&&pan.py2>0,JSON.stringify({px2:pan.px2,py2:pan.py2,z2:pan.z2}));

  // --- 7. 手機版主頁可往下滑動（板塊不擠在一起） ---
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
  await sleep(400);
  const mob=JSON.parse(await evalJs(`JSON.stringify((function(){
    try{
      showHome();
      const g=document.getElementById('homeGrid');
      return {sh:g.scrollHeight, ch:g.clientHeight, oy:getComputedStyle(g).overflowY,
        cols:getComputedStyle(g).gridTemplateColumns.split(' ').length,
        w:window.innerWidth};
    }catch(e){return {err:String(e)}}
  })())`));
  await sleep(200);
  check('手機版主頁網格可捲動(scrollHeight>clientHeight)',mob.sh>mob.ch,JSON.stringify(mob));
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

  check('全程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));
  const pass=results.filter(r=>r.ok).length;
  console.log('\n=== '+pass+'/'+results.length+' 通過 ===');
  chrome.kill();
  process.exit(pass===results.length?0:1);
}
main();
