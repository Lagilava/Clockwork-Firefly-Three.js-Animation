const fs=require('fs'),http=require('http'),path=require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'); const out=process.argv[2]; fs.mkdirSync(out,{recursive:true});
const file=process.env.GV_FILE||'Clockwork_Firefly_godview.html';
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/three/')){const r=req.url.slice(7);res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'node_modules','three',r)));return;}
 res.setHeader('Content-Type','text/html');
 res.end(fs.readFileSync(path.join(root,file),'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\//g,'/three/build/').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\//g,'/three/examples/jsm/'));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium',args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=swiftshader']});
 const p=await b.newPage({viewport:{width:1500,height:860}});
 const errs=[];p.on('pageerror',e=>errs.push('PAGEERR '+e.message));p.on('console',m=>{if(['error','warning'].includes(m.type()))errs.push(m.type()+' '+m.text())});
 await p.goto('http://127.0.0.1:'+server.address().port);
 await p.waitForFunction(()=>window.__godview,null,{timeout:300000});
 await p.waitForTimeout(1500);
 const shot=async(n)=>{await p.waitForTimeout(700);await p.screenshot({path:path.join(out,n+'.png')});};
 const film=()=>p.evaluate(()=>window.__film);
 // roof at 60s, top
 await p.evaluate(()=>{window.__film.seekTo(60);});
 await shot('gv-roof-aerial');
 await p.click('[data-view=top]'); await shot('gv-roof-top');
 await p.evaluate(()=>{window.__film.seekTo(150)}); await shot('gv-glade-top');
 await p.click('[data-view=aerial]'); await shot('gv-glade-aerial');
 await p.click('[data-view=side]'); await shot('gv-glade-side');
 await p.keyboard.press('m'); await shot('gv-map');
 await p.keyboard.press('Escape');
 await p.click('[data-tab=shots]'); await p.evaluate(()=>document.getElementById('gvClipOn').click()); await shot('gv-shots-clip');
 console.log('keys',await p.evaluate(()=>Object.keys(window.__godview||{})));
 console.log('errors',errs.slice(0,15));
 await b.close(); server.close();
})();
