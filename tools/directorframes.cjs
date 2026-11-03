// Renders the director's-cut frame at each requested film time.
// Usage: TIMES=229,231 node tools/directorframes.cjs <outDir> [tag]
const fs=require('fs'),http=require('http'),path=require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'); const out=process.argv[2]; const tag=process.argv[3]||'';
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/three/')){const r=req.url.slice(7);res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'node_modules','three',r)));return;}
 res.setHeader('Content-Type','text/html');
 res.end(fs.readFileSync(path.join(root,'Clockwork_Firefly_fullfilm.html'),'utf8').replace('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js','/three/build/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/','/three/examples/jsm/'));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const b=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/opt/pw-browsers/chromium',args:['--enable-webgl','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:1280,height:720}});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://127.0.0.1:'+server.address().port);
 await p.waitForFunction(()=>window.__film?.st.ready,null,{timeout:300000});
 await p.evaluate(()=>{for(const id of ['loader','start','chrome','notes'])document.getElementById(id)?.classList.add('hidden');window.__film.st.started=true;});
 for(const t of (process.env.TIMES||'').split(',').map(Number)){
  await p.evaluate((t)=>{const f=window.__film;f.director.setMode('director');f.seekTo(t);f.setPlaying(false);f.ember?.update(t,0,f.anim);f.world.sky.follow(f.camera);f.post.render(t,t,{letter:0,cinematic:true,threshold:0.8});},t);
  await p.waitForTimeout(200);
  await p.screenshot({path:path.join(out,'d'+t+tag+'.png')});
 }
 console.log('errors',errs); await b.close(); server.close();
})();
