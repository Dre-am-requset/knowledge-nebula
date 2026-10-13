import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';

// World coordinates and perspective are shared by geometry, picking and labels.
export class KnowledgeGalaxy {
 constructor(host, callbacks){
  this.host=host;this.callbacks=callbacks;this.labels=[];this.pickables=[];this.selected=null;this.frame=0;this.enabled=true;this.auto=false;this.lastFrameAt=null;
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#080f22');
  this.camera=new THREE.PerspectiveCamera(48,1,.1,1600);
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));this.renderer.setClearColor('#080f22');
  this.canvas=this.renderer.domElement;this.canvas.id='galaxy';this.canvas.tabIndex=0;
  this.canvas.setAttribute('role','group');this.canvas.setAttribute('aria-label','三维知识星系。拖动旋转，Shift 或右键拖动平移，滚轮缩放。方向键旋转，加减键缩放。主题也可在列表中选择。');
  host.prepend(this.canvas);this.overlay=document.createElement('div');this.overlay.className='galaxy-labels';host.append(this.overlay);
  this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=false;this.controls.minDistance=5;this.controls.maxDistance=440;
  this.controls.enablePan=true;this.controls.zoomToCursor=true;this.controls.rotateSpeed=.65;this.controls.zoomSpeed=.8;this.controls.autoRotateSpeed=.32;
  this.controls.addEventListener('change',()=>{if(this.tip)this.tip.hidden=true;this.request();});
  this.scene.add(new THREE.AmbientLight('#aebfe8',2));const sun=new THREE.DirectionalLight('#fff2d8',3.5);sun.position.set(60,90,100);this.scene.add(sun);
  const fill=new THREE.DirectionalLight('#799eea',1.7);fill.position.set(-100,0,-80);this.scene.add(fill);
  const sprite=document.createElement('canvas');sprite.width=sprite.height=128;const ctx=sprite.getContext('2d');const glow=ctx.createRadialGradient(64,64,0,64,64,64);
  glow.addColorStop(0,'rgba(255,255,255,1)');glow.addColorStop(.1,'rgba(255,255,255,.8)');glow.addColorStop(.33,'rgba(255,255,255,.17)');glow.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,128,128);this.texture=new THREE.CanvasTexture(sprite);
  this.spheres=new THREE.SphereGeometry(1,24,16);this.reset();
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);
  document.addEventListener('visibilitychange',()=>{this.lastFrameAt=null;if(!document.hidden)this.request();});
  let down=null;
  this.canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,button:e.button};});
  this.canvas.addEventListener('pointerup',e=>{if(down&&down.button===0&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5){const r=this.canvas.getBoundingClientRect();this.pick((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);}down=null;});
  this.canvas.addEventListener('pointercancel',()=>{down=null;});
  this.tip=document.createElement('div');this.tip.className='star-preview';this.tip.hidden=true;host.append(this.tip);
  this.canvas.addEventListener('pointermove',e=>{if(down)return;const r=this.canvas.getBoundingClientRect(),a=this.nearestAtom(e.clientX-r.left,e.clientY-r.top);this.canvas.style.cursor=a?'pointer':'grab';this.tip.hidden=!a;if(a){this.tip.replaceChildren();const title=document.createElement('strong'),summary=document.createElement('p');title.textContent=a.title;summary.textContent=a.summary.slice(0,110);this.tip.append(title,summary);this.tip.style.left=Math.min(r.width-245,Math.max(5,e.clientX-r.left+14))+'px';this.tip.style.top=Math.max(8,Math.min(r.height-150,e.clientY-r.top+14))+'px';}});
  this.canvas.addEventListener('pointerleave',()=>{this.tip.hidden=true;});
  this.canvas.addEventListener('dblclick',e=>{const r=this.canvas.getBoundingClientRect(),a=this.nearestAtom(e.clientX-r.left,e.clientY-r.top);if(a)this.focusAtom(a.id);else{const ray=new THREE.Raycaster();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1},this.camera);const hit=ray.intersectObjects(this.pickables,false)[0];if(hit)this.focusPoint(hit.object.position,35);}});
  this.canvas.addEventListener('keydown',e=>{const d=this.camera.position.clone().sub(this.controls.target),s=new THREE.Spherical().setFromVector3(d);let handled=true;
   if(e.key==='ArrowLeft')s.theta-=.12;else if(e.key==='ArrowRight')s.theta+=.12;else if(e.key==='ArrowUp')s.phi=Math.max(.04,s.phi-.12);else if(e.key==='ArrowDown')s.phi=Math.min(Math.PI-.04,s.phi+.12);else if(e.key==='+'||e.key==='=')s.radius=Math.max(5,s.radius*.85);else if(e.key==='-')s.radius=Math.min(440,s.radius/ .85);else if(e.key==='Home'){this.reset();}else handled=false;
   if(handled){e.preventDefault();if(e.key!=='Home'){this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));this.controls.update(0);this.request();}}});
  this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;callbacks.error('三维画面暂时中断，可以切换列表继续阅读。');});
  this.canvas.addEventListener('webglcontextrestored',()=>{this.lost=false;callbacks.error('');this.request();});
  this.request();
 }
 reset(){const fit=Math.max(1,Math.min(2,1/Math.max(.5,this.camera.aspect)));this.controls?.target.set(0,0,0);this.camera.position.set(0,115*fit,185*fit);this.controls?.update(0);this.request();}
 zoom(factor){const d=this.camera.position.clone().sub(this.controls.target);d.setLength(THREE.MathUtils.clamp(d.length()*factor,5,440));this.camera.position.copy(this.controls.target).add(d);this.controls.update(0);this.request();}
 setVisible(value){this.enabled=value;this.lastFrameAt=null;if(value){this.resize();this.request();}}
 // Motion starts only through this explicit user action, including when the
 // system requests reduced motion. Never change the system/browser preference.
 setAuto(value){this.auto=Boolean(value);this.controls.autoRotate=this.auto;this.lastFrameAt=null;this.request();return this.auto;}
 resize(){const r=this.host.getBoundingClientRect();if(!r.width||!r.height)return;const first=!this.width;this.width=r.width;this.height=r.height;this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();this.renderer.setSize(r.width,r.height,false);if(this.nebula)this.nebula.material.uniforms.viewportHeight.value=r.height*this.renderer.getPixelRatio();if(first)this.reset();this.request();}
 request(){if(!this.frame)this.frame=requestAnimationFrame(timestamp=>{this.frame=0;if(!this.enabled||document.hidden||this.lost){this.lastFrameAt=null;return;}this.render(timestamp);if(this.auto)this.request();});}
 render(timestamp=performance.now()){if(!this.width)this.resize();const elapsed=this.lastFrameAt===null?0:THREE.MathUtils.clamp((timestamp-this.lastFrameAt)/1000,0,.1);this.lastFrameAt=timestamp;this.controls.update(this.auto?elapsed:0);this.scene.updateMatrixWorld();this.camera.updateMatrixWorld();this.renderer.render(this.scene,this.camera);this.placeLabels();}
 addPoint(position,radius,color,identity,label,meta,category=false){
  const material=new THREE.MeshStandardMaterial({color,roughness:.7,metalness:.12,emissive:color,emissiveIntensity:.25});const sphere=new THREE.Mesh(this.spheres,material);sphere.position.copy(position);sphere.scale.setScalar(radius);sphere.userData={identity,label,radius};this.content.add(sphere);this.pickables.push(sphere);
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture,color,transparent:true,opacity:category?.58:.34,depthWrite:false,blending:THREE.AdditiveBlending}));halo.scale.setScalar(radius*(category?10:8));sphere.add(halo);halo.scale.divideScalar(radius);
  const b=document.createElement('button');b.type='button';b.className='galaxy-label'+(category?' galaxy-category':'');b.style.setProperty('--star-color',color);b.dataset.node=identity;b.setAttribute('aria-label',label+'，'+meta);const name=document.createElement('strong'),small=document.createElement('span');name.textContent=label;small.textContent=meta;b.append(name,small);b.onclick=()=>this.activate(identity);b.ondblclick=()=>this.focusPoint(position,35);this.overlay.append(b);this.labels.push({button:b,object:sphere,category});return sphere;
 }
 activate(id){if(id.startsWith('category:'))this.callbacks.category(id.slice(9));else if(id.startsWith('card:'))this.callbacks.card(id.slice(5));else this.callbacks.topic(id);}
 setSelected(id){this.selected=id;for(const o of this.pickables)o.material.emissiveIntensity=o.userData.identity===id?1.5:.25;for(const x of this.labels)x.button.classList.toggle('active',x.object.userData.identity===id);this.request();}
 pick(x,y){const atom=this.nearestAtom((x+1)/2*this.width,(1-y)/2*this.height);if(atom){this.tip.hidden=true;this.selectAtom(atom.id);this.callbacks.atom?.(atom.id);return;}this.scene.updateMatrixWorld();const ray=new THREE.Raycaster();ray.setFromCamera({x,y},this.camera);const hit=ray.intersectObjects(this.pickables,false)[0];if(hit)this.activate(hit.object.userData.identity);}
 setData(data,chat=''){
  if(this.content){const disposed=new Set();this.scene.remove(this.content);this.content.traverse(o=>{for(const resource of [o.geometry===this.spheres?null:o.geometry,o.material])if(resource&&!disposed.has(resource)){resource.dispose();disposed.add(resource);}});this.stars=null;this.nebula=null;this.selection=null;}
  this.content=new THREE.Group();this.scene.add(this.content);this.overlay.replaceChildren();this.labels=[];this.pickables=[];
  // Nebula light is derived from the knowledge points below; no unrelated star field.
  const centers={prompt:[-30,11,24],agent:[18,22,-49],engineering:[63,-7,-3],annotation:[28,2,54],quant:[-51,-13,-42],career:[-70,1,17],unclassified:[0,-24,83]};
  const topicPoints={};this.topicPoints=topicPoints;this.categoryColors=Object.fromEntries(data.categories.map(c=>[c.id,c.color]));this.topicColors={};
  for(const category of data.categories){
   // Custom categories also have stable centres; adding another category does
   // not move existing ones. Import data may provide an explicit XYZ position.
   let seed=2166136261;for(const char of category.id)seed=Math.imul(seed^char.charCodeAt(0),16777619);
   const angle=(seed>>>0)/4294967296*Math.PI*2;
   const centre=category.position||centers[category.id]||[Math.cos(angle)*75,((seed>>>8)%35)-17,Math.sin(angle)*65];
   const p=new THREE.Vector3(...centre),isUnknown=category.id==='unclassified';
   this.addPoint(p,isUnknown?1.2:1.5+Math.log10(category.messages+1)*.22,category.color,'category:'+category.id,category.name,Number(category.messages).toLocaleString('zh-CN')+' 条主分类消息',true);
   const members=data.topics.filter(t=>t.category===category.id);
   members.forEach((topic,i)=>{
    const a=i/members.length*Math.PI*2+(category.id==='prompt'?.3:.8),rad=17+(i%2)*6;
    const pos=p.clone().add(new THREE.Vector3(Math.cos(a)*rad,Math.sin(i*2+1)*9,Math.sin(a)*rad));topicPoints[topic.id]=pos;this.topicColors[topic.id]=category.color;
    const relevantCards=data.cards.filter(k=>k.topic===topic.id&&k.review_status==='ready'&&(!chat||k.chats.includes(chat)));
    this.addPoint(pos,.65+Math.log10(topic.documents+1)*.24,category.color,topic.id,topic.name,topic.documents+' 份资料 · '+relevantCards.length+' 篇总结');

   });
  }
  this.topicPoints.unclassified=new THREE.Vector3(...centers.unclassified);
  this.setAtoms(this.atoms||[]);
  this.setSelected(this.selected);this.resize();
 }
 line(a,b,color,opacity){const midpoint=a.clone().lerp(b,.5);midpoint.y+=Math.min(17,a.distanceTo(b)*.15);const curve=new THREE.QuadraticBezierCurve3(a,midpoint,b);const g=new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));this.content.add(new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false})));}
 placeLabels(){
  if(!this.width)return;const placed=[];const projected=this.labels.map(item=>{const p=item.object.position.clone().project(this.camera);return {...item,p,d:this.camera.position.distanceTo(item.object.position)};});
  projected.sort((a,b)=>(b.object.userData.identity===this.selected)-(a.object.userData.identity===this.selected)||Number(b.category)-Number(a.category)||a.d-b.d);
  for(const item of projected){const {button,p}=item,x=(p.x*.5+.5)*this.width,y=(-p.y*.5+.5)*this.height;const width=item.category?160:135,height=item.category?43:34;
   let chosen=null;
   if(p.z>-1&&p.z<1&&!(this.camera.position.distanceTo(this.controls.target)<55&&item.d>95)){for(const [dx,dy] of [[0,17],[0,-height-17],[-55,22],[55,22],[-60,-height-22],[60,-height-22],[0,58],[0,-height-58]]){
    const rect={x:x+dx-width/2,y:y+dy,w:width,h:height};
    if(rect.x<6||rect.x+width>this.width-6||rect.y<12||rect.y+height>this.height-120)continue;
    if(placed.some(r=>rect.x<r.x+r.w+4&&rect.x+width+4>r.x&&rect.y<r.y+r.h+3&&rect.y+height+3>r.y))continue;
    chosen={rect,dx,dy};break;
   }}
   button.hidden=!chosen;if(chosen){placed.push(chosen.rect);button.style.width=width+'px';button.style.transform=`translate(${x+chosen.dx}px,${y+chosen.dy}px) translateX(-50%)`;button.style.opacity=String(THREE.MathUtils.clamp(1-(item.d-180)/450,.5,1));}
  }
 }
 focusPoint(point,distance=24){const direction=this.camera.position.clone().sub(this.controls.target).normalize();this.controls.target.copy(point);this.camera.position.copy(point).addScaledVector(direction,distance);this.controls.update(0);this.request();}
 atomPosition(a){
  // Stable, winding filaments with depth. Every bright centre remains one real ID.
  let h=2166136261;for(const char of a.id)h=Math.imul(h^char.charCodeAt(0),16777619);
  const random=()=>{h^=h<<13;h^=h>>>17;h^=h<<5;return (h>>>0)/4294967296;};
  let topicSeed=0;for(const char of a.topic)topicSeed=(Math.imul(topicSeed,31)+char.charCodeAt(0))>>>0;
  const u=random(),arm=Math.floor(random()*3),radius=1+Math.pow(u,.72)*25;
  const angle=arm*Math.PI*2/3+u*3.7+(random()-.5)*(.3+u*.9);
  const offset=new THREE.Vector3(Math.cos(angle)*radius*1.18,Math.sin(angle*1.8+u*3)*3+(random()-.5)*(3+u*6),Math.sin(angle)*radius*.65);
  offset.applyAxisAngle(new THREE.Vector3(1,0,0),((topicSeed%100)/100-.5)*.8);
  offset.applyAxisAngle(new THREE.Vector3(0,1,0),(topicSeed%628)/100);
  return (this.topicPoints[a.topic]||this.topicPoints.unclassified||new THREE.Vector3()).clone().add(offset);
 }
 setAtoms(atoms){
  this.atoms=atoms;if(!this.content)return;
  if(this.nebula){this.nebula.parent?.remove(this.nebula);this.nebula.material.dispose();}
  if(this.stars){this.stars.parent?.remove(this.stars);this.stars.geometry.dispose();this.stars.material.dispose();}
  const topicCounts={};for(const a of atoms)topicCounts[a.topic]=(topicCounts[a.topic]||0)+1;
  const positions=[],colors=[],scores=[],grain=[],densities=[];this.atomPositions=new Map();
  for(const a of atoms){const p=this.atomPosition(a);this.atomPositions.set(a.id,p);positions.push(...p.toArray());const c=new THREE.Color(this.topicColors[a.topic]||'#a8b8d0');colors.push(c.r,c.g,c.b);scores.push(a.importance/100);grain.push(parseInt(a.id.slice(-5),16)/1048575);densities.push(Math.min(1,Math.sqrt(80/topicCounts[a.topic])));}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('importance',new THREE.Float32BufferAttribute(scores,1));geometry.setAttribute('grain',new THREE.Float32BufferAttribute(grain,1));geometry.setAttribute('density',new THREE.Float32BufferAttribute(densities,1));
  const common={transparent:true,depthWrite:false,blending:THREE.AdditiveBlending};
  // Overlapping, soft light at the SAME XYZ positions forms the nebula body.
  // No extra point is presented as a knowledge item; the geometry is shared.
  const haze=new THREE.ShaderMaterial({...common,uniforms:{viewportHeight:{value:(this.height||740)*this.renderer.getPixelRatio()}},vertexShader:`
   attribute vec3 color;attribute float importance;attribute float grain;attribute float density;
   uniform float viewportHeight;varying vec3 vColor;varying float vAlpha;varying float vGrain;
   void main(){vec4 p=modelViewMatrix*vec4(position,1.);float distance=length(p.xyz);
    vColor=color;vGrain=grain;vAlpha=(.024+importance*.02)*density*smoothstep(16.,90.,distance);
    gl_PointSize=clamp((18.+grain*18.)*viewportHeight/max(distance,1.),8.,190.);
    gl_Position=projectionMatrix*p;}`,fragmentShader:`
   varying vec3 vColor;varying float vAlpha;varying float vGrain;
   void main(){vec2 uv=gl_PointCoord-.5;float a=vGrain*6.283;
    uv=mat2(cos(a),-sin(a),sin(a),cos(a))*uv;uv.y*=1.25;
    float radius=length(uv);float fog=exp(-radius*radius*16.)*(1.-smoothstep(.35,.5,radius));
    float wisp=.78+.22*sin(uv.x*13.+vGrain*8.)*cos(uv.y*9.);
    gl_FragColor=vec4(vColor,fog*wisp*vAlpha);}`});
  this.nebula=new THREE.Points(geometry,haze);this.nebula.renderOrder=1;this.content.add(this.nebula);
  const material=new THREE.ShaderMaterial({...common,uniforms:{pixelRatio:{value:this.renderer.getPixelRatio()}},vertexShader:`
   attribute vec3 color;attribute float importance;attribute float grain;uniform float pixelRatio;
   varying vec3 vColor;varying float vAlpha;
   void main(){vec4 p=modelViewMatrix*vec4(position,1.);float distance=length(p.xyz);
    vColor=color*(.62+importance*.7);vAlpha=.4+importance*.6;
    float perspective=clamp(pow(210./max(distance,1.),.55),.7,2.4);
    gl_PointSize=(7.+grain*3.5)*perspective*pixelRatio;gl_Position=projectionMatrix*p;}`,fragmentShader:`
   varying vec3 vColor;varying float vAlpha;
   void main(){vec2 uv=gl_PointCoord-.5;float r=length(uv);if(r>.5)discard;
    float core=exp(-r*r*85.);float glow=exp(-r*r*14.)*(1.-smoothstep(.36,.5,r));
    vec3 color=mix(vColor,vec3(1.,.98,.94),core*.72);
    gl_FragColor=vec4(color,(core*.65+glow*.6)*vAlpha);}`});
  this.stars=new THREE.Points(geometry,material);this.stars.renderOrder=2;this.content.add(this.stars);this.selectAtom(this.selectedAtom);this.request();
 }
 nearestAtom(x,y){if(!this.atomPositions)return null;this.camera.updateMatrixWorld();let chosen=null,best=11;
  for(const a of this.atoms){const point=this.atomPositions.get(a.id);const p=point.clone().project(this.camera);if(p.z<-1||p.z>1)continue;const d=Math.hypot((p.x*.5+.5)*this.width-x,(-p.y*.5+.5)*this.height-y);if(d<best){best=d;chosen=a;}}return chosen;
 }
 focusAtom(id){const p=this.atomPositions?.get(id);if(p){this.focusPoint(p,17);this.selectAtom(id);}}
 selectAtom(id,related=[]){this.selectedAtom=id;if(this.selection){this.selection.parent?.remove(this.selection);this.selection.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}this.selection=new THREE.Group();this.content?.add(this.selection);const p=this.atomPositions?.get(id);if(p){const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture,color:'#fff3c5',transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending}));halo.position.copy(p);halo.scale.setScalar(2.3);this.selection.add(halo);for(const id of related){const target=this.atomPositions.get(id);if(target){const geometry=new THREE.BufferGeometry().setFromPoints([p,target]);this.selection.add(new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#b9d8ec',transparent:true,opacity:.4})));}}}this.request();}
 inspect(){return {renderer:'WebGL / Three.js '+THREE.REVISION,camera:this.camera.position.toArray(),target:this.controls.target.toArray(),nodes:this.pickables.length,atoms:this.atoms?.length||0,nebulaPoints:this.nebula?.geometry.attributes.position.count||0,selectedAtom:this.selectedAtom,topics:this.pickables.filter(o=>!o.userData.identity.includes(':')).length,depthRange:Math.max(...this.pickables.map(o=>o.position.y))-Math.min(...this.pickables.map(o=>o.position.y)),size:[this.width,this.height],visible:!document.hidden,auto:this.auto,labelsVisible:this.labels.filter(x=>!x.button.hidden).length};}
}
