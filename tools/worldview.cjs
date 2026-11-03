// World-viewing rig: renders each set from map (top-down), aerial and ground cameras.
// Usage: node tools/worldview.cjs <outDir> [tag]   (serves pinned three.js locally; no CDN needed)
const fs=require('fs'),http=require('http'),path=require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'); const out=process.argv[2]||path.join(root,'.validation'); const tag=process.argv[3]||'';
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/three/')){const r=req.url.slice(7);res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'node_modules','three',r)));return;}
 res.setHeader('Content-Type','text/html');
 res.end(fs.readFileSync(path.join(root,'Clockwork_Firefly_fullfilm.html'),'utf8').replace('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js','/three/build/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/','/three/examples/jsm/'));});
// [set, film time, name, camera pos, look target, fov, options{near, ambient, fog}]
const VIEWS=JSON.parse(process.env.VIEWS||'null')||[
 ['atrium',12,'atrium-map',[0,34,0.01],[0,0,0],42],
 ['atrium',12,'atrium-aerial',[11,9,13],[0,2.5,0],55],
 ['atrium',12,'atrium-ground',[6.5,1.1,6.5],[0,1.8,0],60],
 ['roof',60,'roof-map',[0,95,0.01],[5,0,-5],55,{ambient:1.2,fog:0}],
 ['roof',60,'roof-aerial',[30,22,35],[0,2,-8],60],
 ['roof',60,'roof-ground',[8,3,10],[0,3,-4],62],
 ['forest',140,'forest-map',[0,70,0.01],[0,0,0],55,{near:56,ambient:3,fog:0}],
 ['forest',140,'forest-aerial',[18,12,22],[0,3,0],60],
 ['forest',140,'forest-ground',[5,1.2,6],[0,1.5,0],65],
];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const b=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/opt/pw-browsers/chromium',args:['--enable-webgl','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:1280,height:720}});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://127.0.0.1:'+server.address().port);
 await p.waitForFunction(()=>window.__film?.st.ready,null,{timeout:300000});
 await p.evaluate(()=>{for(const id of ['loader','start','chrome','notes'])document.getElementById(id)?.classList.add('hidden');window.__film.st.started=true;window.__film.director.update=()=>{};});
 for(const [set,t,name,pos,tgt,fov,opt] of VIEWS){
  await p.evaluate(({t,pos,tgt,fov,map,opt})=>{
   const f=window.__film; f.director.setMode('orbit'); f.seekTo(t); f.setPlaying(false); f.ember?.update(t,0,f.anim);
   const c=f.camera; c.fov=fov; c.far=2000; c.near=(opt&&opt.near)||0.1; c.updateProjectionMatrix(); c.position.set(...pos); c.lookAt(...tgt); c.updateMatrixWorld(true);
   f.world.sky.follow(c);
   if(map) f.scene.fog.density*=(opt&&opt.fog!==undefined?opt.fog:0.15);
   if(opt&&opt.ambient){ f.scene.environmentIntensity*=opt.ambient*2; f.scene.traverse(o=>{if(o.isLight&&o.visible) o.intensity*=opt.ambient;}); }
   f.post.render(t,t,{letter:0,cinematic:false,threshold:0.8});
  },{t,pos,tgt,fov,opt,map:name.endsWith('map')});
  await p.waitForTimeout(250);
  await p.screenshot({path:path.join(out,name+tag+'.png')});
 }
 console.log('views',VIEWS.length,'errors',errs); await b.close(); server.close();
})();
