#!/usr/bin/env node
/* CDP smoke test for note-app.html */
const {spawn} = require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const chrome=spawn(CHROME,[
    '--headless=new','--disable-gpu','--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/chrome-cdp-test',
    'about:blank'
  ],{stdio:'ignore'});
  let targets=null;
  for(let i=0;i<40;i++){
    try{
      const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets=await r.json();
      if(targets.length)break;
    }catch(e){}
    await sleep(250);
  }
  if(!targets){console.error('FAIL: CDP 不可用');chrome.kill();process.exit(1);}

  const resp=await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('file:///Users/wongty99/notes-app/note-app.html')}`,{method:'PUT'});
  const page=await resp.json();
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();const errors=[];
  ws.onmessage=ev=>{
    const m=JSON.parse(ev.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
    if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails.exception||m.params.exceptionDetails.text));
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error: '+m.params.args.map(a=>a.value||a.description).join(' '));
  };
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);

  const results=[];
  const check=(name,ok,extra='')=>{results.push({name,ok});console.log((ok?'PASS':'FAIL')+' '+name+(extra?' — '+extra:''));};

  async function evalJs(expr){
    const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails)return JSON.stringify({err:JSON.stringify(r.result.exceptionDetails.exception||r.result.exceptionDetails.text)});
    const v=r.result&&r.result.result?r.result.result.value:'null';
    return typeof v==='string'?v:JSON.stringify(v);
  }

  // --- 0. 啟動無錯誤
  check('啟動無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,300));

  // --- 1. UI 分類
  const u=JSON.parse(await evalJs(`JSON.stringify({
    groups:document.querySelectorAll('#topbar .tgroup').length,
    labels:[...document.querySelectorAll('#topbar .tlabel')].map(x=>x.textContent),
    hasSideList:!!document.querySelector('#fileList'),
    hasCollapse:!!document.querySelector('#btnSideCollapse'),
    hasZoom:!!document.querySelector('#zoomSel'),
    hasMargin:!!document.querySelector('#pageMargin')
  })`));
  check('UI 功能分類（tgroup ≥6 且有分類標籤）',u.groups>=6&&u.labels.length>=6,(u.labels||[]).join('/'));
  check('UI 側欄+檔案清單+縮放+邊距控件存在',u.hasSideList&&u.hasCollapse&&u.hasZoom&&u.hasMargin);

  // --- 2. 自繪經濟圖表
  const dw=JSON.parse(await evalJs(`(function(){
    try{
      $('#cType').value='draw';
      const d=curDoc();
      const cfg={type:'draw',xmin:0,xmax:100,xstep:20,ymin:0,ymax:100,ystep:20,
        zero:true,grid:false,eqAuto:true,title:'測試',xl:'Q',yl:'P',lines:[],ilabels:{}};
      const el={id:uid(),type:'chart',x:50,y:50,w:460,h:330,cfg};
      d.pages[0].els.push(el);
      S.sel={pi:0,id:el.id};
      commit();renderAll();
      drawAddLine(el,'line');
      drawAddLine(el,'line');
      const n1=el.cfg.lines.length;
      drawAddLine(el,'curve');
      const n2=el.cfg.lines.length;
      const its=drawIntersections(el.cfg);
      S.dselLine=0;drawToggle(el,'end');drawToggle(el,'dash');
      const arrow=el.cfg.lines[0].arrowEnd,dash=el.cfg.lines[0].dashed;
      const before=el.cfg.lines[0].pts.length;
      S.dselLine=0;drawWarp(el);
      const after=el.cfg.lines[0].pts.length;
      const key=its[0]&&its[0].key;
      if(key){el.cfg.ilabels[key]='E測試';}
      const svg=chartSVG(el);
      return JSON.stringify({n1,n2,inters:its.length,arrow,dash,warp:after>before,
        hasDashToAxes:/stroke-dasharray="4 3"/.test(svg),
        hasLabel:svg.includes('E測試'),hasZero:svg.includes('>0<'),
        hasXYLabels:svg.includes('Q')&&svg.includes('P'),
        hasHandles:drawHandles(el).includes('chandle')});
    }catch(e){return JSON.stringify({err:String(e)})}
  })()`));
  check('自繪圖表：加直線/曲線',dw.n1===2&&dw.n2===3,`lines=${dw.n2}`);
  check('自繪圖表：交點計算',dw.inters>=1,`intersections=${dw.inters}`);
  check('自繪圖表：箭頭+虛線切換',dw.arrow===true&&dw.dash===true);
  check('自繪圖表：扭曲點加入',dw.warp===true);
  check('自繪圖表：交點虛線連 XY 軸',dw.hasDashToAxes===true);
  check('自繪圖表：交點自訂標籤',dw.hasLabel===true);
  check('自繪圖表：0 標記+XY 標籤',dw.hasZero&&dw.hasXYLabels);
  check('自繪圖表：節點 handle 渲染',dw.hasHandles===true);

  // --- 3. 上載檔案位置顯示
  const fl=JSON.parse(await evalJs(`(function(){
    try{
      const d=curDoc();d.files=[];
      const t=trackFile('demo.pdf',{size:12345});
      const fromExp=d.pages.length; // 上載起點頁（0-based）
      for(let i=0;i<3;i++)d.pages.push({id:uid(),bg:{src:'data:image/png;base64,x',name:'demo.pdf',page:i+1},strokes:[],els:[],flow:''});
      finishTrack(t,3,fromExp,'pdf');
      renderFileList();
      const item=document.querySelector('#fileList .fileItem');
      const meta=item?item.textContent:'';
      item&&item.click();
      return JSON.stringify({hasItem:!!item,meta:meta.trim().slice(0,80),
        exp:'第 '+(fromExp+1)+'–'+(fromExp+3)+' 頁',
        expGo:'位於第 '+(fromExp+1)+' 頁',
        toast:document.querySelector('#toast').textContent});
    }catch(e){return JSON.stringify({err:String(e)})}
  })()`));
  check('上載檔案清單顯示（檔名+頁碼）',fl.hasItem&&/demo\.pdf/.test(fl.meta)&&fl.meta.includes(fl.exp),fl.meta+' | 期望含:'+fl.exp);
  check('點擊檔案跳轉提示頁面位置',(fl.toast||'').includes(fl.expGo),fl.toast);

  // --- 4. 表格非統一長寬+格線拖曳
  const tb=JSON.parse(await evalJs(`(function(){
    try{
      const d=curDoc();
      const el={id:uid(),type:'table',x:60,y:60,cols:4,rows:3,cw:90,ch:34,
        cells:Array.from({length:3},()=>Array(4).fill('')),header:true,border:'#333'};
      ensureTableDims(el);
      d.pages[0].els.push(el);
      S.sel={pi:0,id:el.id};
      commit();renderAll();
      const handles=tableHandles(el);
      const colH=(handles.match(/tcolh/g)||[]).length;
      const rowH=(handles.match(/trowh/g)||[]).length;
      el.colW[0]+=50;el.rowH[1]+=20;
      ensureTableDims(el);
      const nonUniform=el.colW[0]!==el.colW[1];
      const wChanged=el.w===el.colW.reduce((a,b)=>a+b,0);
      const node=document.querySelector('.el[data-id="'+el.id+'"]');
      const hasTh=!!(node&&node.querySelector('.tcolh,.trowh'));
      return JSON.stringify({colH,rowH,nonUniform,wChanged,hasTh,colW:el.colW});
    }catch(e){return JSON.stringify({err:String(e)})}
  })()`));
  check('表格：欄/列拖曳格線 handle（3欄2列）',tb.colH===3&&tb.rowH===2,`cols=${tb.colH} rows=${tb.rowH}`);
  check('表格：每格長寬可不統一',tb.nonUniform===true,`colW=[${tb.colW}]`);
  check('表格：尺寸同步',tb.wChanged===true);
  check('表格：DOM 有拖曳格線',tb.hasTh===true);

  // --- 整體無新錯誤
  check('互動過程無 JS 錯誤',errors.length===0,errors.join('; ').slice(0,400));

  const fail=results.filter(r=>!r.ok).length;
  console.log('\\n=== '+(results.length-fail)+'/'+results.length+' 通過 ===');
  ws.close();chrome.kill();
  process.exit(fail?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
