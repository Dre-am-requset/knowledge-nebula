import {KnowledgeGalaxy} from './galaxy3d.js';
import {FragmentExplorer} from './fragments.js';
'use strict';
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const state={data:null,mode:'map',chat:'',topic:null,category:null,request:0,box:[0,0,1400,1000],sourcePage:1,sourceMode:'documents',lesson:null};
const progressKey='knowledge-nebula-learning.v1';
let progress={done:[],notes:{}};
try{const saved=JSON.parse(localStorage.getItem(progressKey)||'null');if(saved&&Array.isArray(saved.done)&&saved.notes)progress=saved;}catch{}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function svg(tag,attrs,text){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs||{}))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
function button(text,callback,cls){const n=node('button',cls,text);n.type='button';n.onclick=callback;return n;}
function anchor(url,text){const n=node('a',null,text);try{const u=new URL(url,location.origin);if(['http:','https:'].includes(u.protocol)){n.href=u.href;if(u.origin!==location.origin){n.target='_blank';n.rel='noopener noreferrer';}}}catch{}return n;}
async function api(path,params={}){const query=new URLSearchParams(params);const r=await fetch(path+(query.size?'?'+query:''));const data=await r.json();if(!r.ok||data.error)throw Error(data.error||'读取失败');return data;}
function number(n){return Number(n||0).toLocaleString('zh-CN');}
function color(category){return state.data.categories.find(c=>c.id===category)?.color||'#8fa3c3';}
function topicInfo(id){return state.data.topics.find(t=>t.id===id);}
function renderGroups(){const select=$('group'),groups=state.data.groups;if(state.chat&&!groups[state.chat])state.chat='';select.replaceChildren();const all=node('option',null,'全部来源');all.value='';select.append(all);for(const [id,group]of Object.entries(groups)){const option=node('option',null,group.name);option.value=id;select.append(option);}select.value=state.chat;}
function updateLearningButtons(){for(const id of ['learnNav','startLearning','readerStart']){const button=$(id);if(button)button.disabled=!state.data.paths[0]?.steps.length;}}
let learningRevision=0,learningTimer=null,learningQueue=Promise.resolve();
async function learningPost(data){const r=await fetch('/api/atoms/learning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,revision:learningRevision})});const result=await r.json();if(!r.ok)throw Error(result.error);learningRevision=result.revision;}
async function loadLearning(){const remote=await api('/api/learning');learningRevision=remote.revision;if(remote.revision)progress=remote.value;else if(progress.done.length||Object.keys(progress.notes).length)await learningPost(progress);}
function saveProgress(){try{localStorage.setItem(progressKey,JSON.stringify(progress));}catch{}clearTimeout(learningTimer);learningTimer=setTimeout(()=>{const snapshot=structuredClone(progress);learningQueue=learningQueue.catch(()=>{}).then(()=>learningPost(snapshot)).then(()=>{const p=document.querySelector('.learning-note');if(p)p.textContent='学习记录已保存到本地知识库';}).catch(e=>{const p=document.querySelector('.learning-note');if(p)p.textContent=e.message+'；本页输入仍保留。';});},450);return true;}
function showError(error){$('reader').replaceChildren(node('p','error',error.message||String(error)));}
function heading(title,description){$('viewTitle').textContent=title;$('viewDescription').textContent=description;}
function hashCard(id){history.replaceState(null,'','#card='+encodeURIComponent(id));}
function setMode(mode){if(fragments)fragments.toolbar.hidden=mode!=='map';state.mode=mode;state.lesson=null;$('mapNav').classList.toggle('active',mode==='map');$('learnNav').classList.toggle('active',mode==='learn');$('overviewNav').classList.toggle('active',mode==='overview');$('mapView').hidden=mode!=='map'||$('listToggle').dataset.list==='true';$('listView').hidden=mode!=='map'||$('listToggle').dataset.list!=='true';$('learningView').hidden=mode!=='learn';$('overviewView').hidden=mode!=='overview';$('viewActions').hidden=mode!=='map';galaxy?.setVisible(mode==='map'&&$('listToggle').dataset.list!=='true');}
function renderDistribution(){
 const data=state.data,filtered=data.filtered_group&&data.groups[state.chat];
 const active=filtered?filtered.active_messages:data.totals.active_messages;
 const unknown=data.categories.find(c=>c.id==='unclassified').messages;
 $('recognizedCount').textContent=number(active-unknown)+' 条已归类消息';
 $('distribution').replaceChildren();const max=Math.max(1,...data.categories.filter(c=>c.id!=='unclassified').map(c=>c.messages));
 for(const category of data.categories.filter(c=>c.id!=='unclassified')){
  const b=button('',()=>chooseCategory(category.id),'distribution-row');const label=node('span','row-label');label.append(node('span',null,category.name),node('span',null,number(category.messages)));
  const bar=node('div','bar'),fill=node('i');fill.style.width=(category.messages/max*100)+'%';fill.style.background=category.color;bar.append(fill);b.append(label,bar);$('distribution').append(b);
 }
 $('uncertain').textContent=number(unknown)+' 条日常与待归类内容，包含短消息、图片及不足以判定主题的内容。';
 $('updated').textContent='整理于 '+data.checked_at.replace('T',' ');
 $('coverage').textContent=number(data.totals.stored_messages)+' 条原消息 · '+data.topics.length+' 个主题 · '+(data.totals.curated_cards||0)+' 篇精编 · '+(data.totals.automatic_cards||0)+' 篇自动综述';
}
let galaxy=null,fragments=null;
window.fragmentExplorerReady=()=>fragments;
function drawGalaxy(){
 try{
  if(!galaxy){galaxy=new KnowledgeGalaxy($('galaxyHost'),{topic:chooseTopic,category:chooseCategory,card:readCard,atom:id=>fragments?.read(id),error:text=>{$('galaxyError').textContent=text;}});window.knowledgeGalaxy=galaxy;}
  galaxy.setData(state.data,state.chat);if(fragments)galaxy.setAtoms(fragments.items.filter(a=>!a.hidden));galaxy.setVisible(state.mode==='map'&&$('listToggle').dataset.list!=='true');
 }catch(error){$('galaxyError').textContent='三维渲染不可用，请使用列表视图。';console.error('3D initialization failed',error);}
}
function updateSelection(){galaxy?.setSelected(state.topic);}
function zoom(factor){galaxy?.zoom(factor);}
function topicRows(container,category=null){
 container.replaceChildren();for(const cat of state.data.categories.filter(c=>c.id!=='unclassified'&&(!category||c.id===category))){
  const section=node('section','topic-section');const h=node('h2',null,cat.name);h.style.color=cat.color;section.append(h);
  for(const topic of state.data.topics.filter(t=>t.category===cat.id)){
   const b=button('',()=>chooseTopic(topic.id),'topic-row');b.append(node('span','topic-name',topic.name),node('span','topic-count',number(topic.documents)+' 份资料 · '+topic.cards.length+' 篇总结'));section.append(b);
  }container.append(section);
 }
}
function cardList(cards,container){
 for(const card of cards){const b=button('',()=>readCard(card.card_id||card.id.replace('knowledge:','')),'article-link');b.append(node('span','eyebrow',(card.origin==='automatic_extract'?'自动摘编 · ':'精编 · ')+(topicInfo(card.topic)?.name||'经验整理')),node('strong',null,card.title),node('p',null,card.excerpt||card.summary));container.append(b);}
 if(!cards.length)container.append(node('p','empty-note','这个范围还没有整理好的经验总结，可以先阅读主题资料。'));
}
async function chooseCategory(id){
 fragments?.clearSelection();
 history.replaceState(null,'','/');
 state.category=id;state.topic=null;state.lesson=null;state.request++;updateSelection();
 const category=state.data.categories.find(c=>c.id===id),r=$('reader');r.replaceChildren(node('span','eyebrow','知识分布'),node('h2',null,category.name),node('p','summary',category.description));
 r.append(node('p','meta',number(category.messages)+' 条消息以此为主分类。每条消息只计入一个主分类，仍可带多个主题标签。'));
 if(id==='unclassified'){r.append(node('p','empty-note','这里的资料没有足够线索归入专业主题。保留闲聊、通知、图片与待确认内容，避免把每条聊天都当作知识。'));const b=button('查看待归类资料',()=>chooseTopic('unclassified'));r.append(b);return;}
 const list=node('div');cardList(state.data.cards.filter(c=>c.review_status==='ready'&&topicInfo(c.topic)?.category===id&&(!state.chat||c.chats.includes(state.chat))),list);r.append(list);
}
async function chooseTopic(id){
 fragments?.clearSelection();
 history.replaceState(null,'','/');
 state.topic=id;state.lesson=null;state.sourcePage=1;state.sourceMode='documents';const turn=++state.request;updateSelection();
 const info=topicInfo(id)||{name:'日常与待归类',category:'unclassified',messages:state.data.totals.unclassified_messages,documents:0};
 const r=$('reader');r.replaceChildren(node('span','eyebrow','主题导航'),node('h2',null,info.name));
 const meta=node('div','topic-meta');meta.append(node('span','pill',number(info.messages)+' 条关联消息'),node('span','pill',number(info.documents)+' 份关联资料'));r.append(meta);if(fragments)r.append(button('探索这个主题的小知识',async()=>{fragments.filters.topic=id;fragments.topic.value=id;await fragments.reload();fragments.list();galaxy?.focusPoint(galaxy.topicPoints[id],35);},'source-link'));
 r.append(node('h3',null,'先读经验总结'));const cards=node('div','article-list');cardList(state.data.cards.filter(c=>c.topic===id&&c.review_status==='ready'&&(!state.chat||c.chats.includes(state.chat))),cards);r.append(cards);
 const tabs=node('div','tabs'),docs=button('主题资料',()=>switchSources(false),'active'),msgs=button('归类消息',()=>switchSources(true));tabs.append(docs,msgs);r.append(tabs);
 const sources=node('div');sources.id='topicSources';r.append(sources);
 async function switchSources(messages){state.sourceMode=messages?'messages':'documents';state.sourcePage=1;docs.classList.toggle('active',!messages);msgs.classList.toggle('active',messages);await loadTopicSources(turn);}
 await loadTopicSources(turn);
}
async function loadTopicSources(turn=state.request){
 const target=$('topicSources');if(!target)return;target.replaceChildren(node('p','loading','正在读取关联资料…'));
 try{const data=await api(state.sourceMode==='messages'?'/api/topic-messages':'/api/topic-sources',{topic:state.topic,chat:state.chat,page:state.sourcePage});if(turn!==state.request)return;target.replaceChildren();
  for(const item of data.results){
   if(state.sourceMode==='messages'){
    const box=node('div','source-message');box.append(node('div','meta',item.name+'　'+item.time));box.append(node('p',null,item.content));const label=item.labels.find(l=>l.topic===state.topic);box.append(node('div','meta',label?.basis==='thread_context'?'归类依据：同话题上下文，待进一步确认':'命中线索：'+(label?.clues?.join('、')||'资料上下文')));if(item.url)box.append(anchor(item.url,'打开原始出处'));target.append(box);
   }else{const b=button('',()=>readSource(item.id),'article-link');b.append(node('span','meta',item.name+'　'+item.last),node('strong',null,item.title),node('p',null,item.excerpt));target.append(b);}
  }
  if(!data.results.length)target.append(node('p','empty-note','这个来源的该主题暂无关联资料，可切换全部来源。'));
  const pager=node('div','pager'),prev=button('上一页',()=>{state.sourcePage--;loadTopicSources();}),next=button('下一页',()=>{state.sourcePage++;loadTopicSources();});prev.disabled=state.sourcePage===1;next.disabled=state.sourcePage*20>=data.total;pager.append(prev,node('span',null,number(data.total)+' 条 · 第 '+state.sourcePage+' 页'),next);target.append(pager);
 }catch(e){if(turn===state.request)target.replaceChildren(node('p','error',e.message));}
}
async function readCard(id,lesson=null,scroll=true){
 fragments?.clearSelection();
 const turn=++state.request;state.lesson=lesson;$('reader').replaceChildren(node('p','loading','正在打开经验总结…'));hashCard(id);
 try{const card=await api('/api/doc/'+encodeURIComponent('knowledge:'+id));if(turn!==state.request)return;
  state.topic=card.topic;updateSelection();const r=$('reader');r.replaceChildren(button('返回主题资料',()=>chooseTopic(card.topic),'back'),node('span','eyebrow',lesson?'Prompt 学习 · 第 '+(lesson.index+1)+' 步':card.origin==='automatic_extract'?'自动主题综述 · 原文摘编':'精编经验'),node('h2',null,card.title),node('p','summary',card.summary));
  r.append(node('div','meta','来源跨度：'+card.first.slice(0,10)+' 至 '+card.last.slice(0,10)+'　'+card.source_documents.length+' 份关联资料'));
  if(card.review_status!=='ready'){r.append(node('p','error','来源已经变化，总结待复核，请先阅读原资料。'));}
  else{
   for(const section of card.sections){const box=node('section',section.heading.includes('边界')?'boundary':null);box.append(node('h3',null,section.heading));if(section.items){const ul=node('ul');for(const item of section.items)ul.append(node('li',null,item));box.append(ul);}if(section.text)box.append(node('p',null,section.text));r.append(box);}
   if(card.template){r.append(node('h3',null,'可修改的练习模板'),node('p','meta','原创学习练习，不是项目提交答案。'));const pre=node('pre',null,card.template);r.append(pre);const copy=button('复制练习模板',async()=>{try{await navigator.clipboard.writeText(card.template);copy.textContent='已复制';}catch{copy.textContent='请选中模板手动复制';}},'copy');r.append(copy);}
  }
  if(lesson&&card.review_status==='ready')appendExercise(r,id,lesson);
  r.append(node('h3',null,'原讨论与支持资料'),node('p','meta','关联消息提供讨论上下文，条目数量不代表独立证实次数。'));
  for(const source of card.source_documents){const b=button(source.title+'　'+source.first.slice(0,10),()=>readSource(source.id),'source-link');r.append(b);}
  if(card.references.length){r.append(node('h3',null,'补充阅读'));for(const ref of card.references){const p=node('p');p.append(anchor(ref.url,ref.title));r.append(p);}r.append(node('p','meta','官方资料用于补充基础方法；来源记录与历史项目规则保留各自边界。'));}
  const reveal=button('核对关联原消息（'+number(card.source_total)+' 条）',()=>{sourceBox.hidden=!sourceBox.hidden;},'source-link'),sourceBox=node('div');sourceBox.hidden=true;r.append(reveal,sourceBox);
  const appendOriginal=data=>{for(const m of data.sources){const box=node('div','source-message');box.append(node('div','meta',m.name+'　'+m.time),node('p',null,m.content));sourceBox.append(box);}};appendOriginal(card);
  if(card.has_more){let offset=0;const more=button('加载更多原消息',async()=>{more.disabled=true;try{offset+=30;const data=await api('/api/doc/'+encodeURIComponent('knowledge:'+id),{offset});appendOriginal(data);more.hidden=!data.has_more;}catch(e){more.textContent=e.message;}finally{more.disabled=false;}});sourceBox.append(more);}
  if(scroll&&innerWidth<721)r.scrollIntoView({block:'start'});
 }catch(e){if(turn===state.request)showError(e);}
}
function appendExercise(container,id,lesson){
 const step=lesson.step,section=node('section','exercise');section.append(node('h3',null,'动手练习'),node('p',null,step.exercise));
 const label=node('label','notes-label','写下你的 Prompt 或复盘笔记'),notes=node('textarea');notes.rows=5;notes.maxLength=10000;notes.value=progress.notes[id]||'';notes.id='lessonNotes';label.htmlFor=notes.id;const saved=node('p','learning-note','学习记录保存在本地知识库，不会自动调用模型。');notes.oninput=()=>{progress.notes[id]=notes.value;saved.textContent=saveProgress()?'正在保存到本地知识库…':'本机存储不可用，可手动复制笔记。';};section.append(label,notes,saved);
 section.append(node('p','question',step.question));const feedback=node('p','feedback');feedback.id='quizFeedback';
 step.options.forEach((option,index)=>section.append(button(option,()=>{feedback.textContent=(index===step.answer?'答对了。':'再想一想。')+step.explanation;},'option')));section.append(feedback);
 const complete=button(progress.done.includes(id)?'已完成此步':'标记此步已完成',()=>{if(!progress.done.includes(id))progress.done.push(id);const ok=saveProgress();complete.textContent=ok?'已完成此步':'存储不可用，本次进度暂存';renderLearning();},'complete');section.append(complete);
 if(lesson.index+1<state.data.paths[0].steps.length)section.append(button('进入下一步',()=>openLesson(lesson.index+1),'source-link'));
 container.append(section);
}
async function readSource(id){
 history.replaceState(null,'','/');
 const turn=++state.request;const priorTopic=state.topic;$('reader').replaceChildren(node('p','loading','正在打开来源资料…'));
 try{const doc=await api('/api/doc/'+encodeURIComponent(id));if(turn!==state.request)return;const r=$('reader');r.replaceChildren(button('返回主题',()=>chooseTopic(priorTopic||'prompt-structure'),'back'),node('span','eyebrow','来源资料'),node('h2',null,doc.title),node('div','meta',doc.name+'　'+doc.first+' ～ '+doc.last),node('pre',null,doc.body));
  if(doc.url)r.append(anchor(doc.url,'打开原始出处'));const original=node('details'),summary=node('summary',null,'核对原消息（'+number(doc.source_total)+' 条）');original.append(summary);let offset=0;
  const append=data=>{for(const m of data.sources){const box=node('div','source-message');box.append(node('div','meta',m.time+'　'+m.sender),node('p',null,m.content));original.append(box);}};append(doc);
  if(doc.has_more){const more=button('加载更多原消息',async()=>{more.disabled=true;try{offset+=30;const next=await api('/api/doc/'+encodeURIComponent(id),{offset});append(next);more.hidden=!next.has_more;}finally{more.disabled=false;}});original.append(more);}r.append(original);
 }catch(e){if(turn===state.request)showError(e);}
}
function renderLearning(){
 const path=state.data.paths[0],container=$('learningView');container.replaceChildren();if(!path){container.append(node('p','empty-note','这份资料没有学习路线。可以从知识清单阅读，或在导入文件中添加 paths。'));return;}const intro=node('div','path-intro');intro.append(node('h2',null,path.title),node('p',null,path.description));const completed=path.steps.filter(s=>progress.done.includes(s.card)).length;const bar=node('div','path-progress'),fill=node('i');fill.style.width=(path.steps.length?completed/path.steps.length*100:0)+'%';bar.append(fill);intro.append(bar,node('p','meta','已完成 '+completed+' / '+path.steps.length+' 步　约 '+path.steps.reduce((s,x)=>s+x.minutes,0)+' 分钟练习 · 综合全部来源的资料'));container.append(intro);
 path.steps.forEach((step,index)=>{const b=button('',()=>openLesson(index),'step'+(progress.done.includes(step.card)?' done':'')+(state.lesson?.index===index?' active':''));b.dataset.lesson=index;b.append(node('span','step-number',progress.done.includes(step.card)?'✓':String(index+1)));const text=node('span');text.append(node('strong',null,step.title),node('small',null,step.minutes+' 分钟 · '+(state.data.cards.find(c=>c.id===step.card)?.title||'来源变化，待补充')));b.append(text);container.append(b);});
}
function openLesson(index){setMode('learn');if(!state.data.paths[0]?.steps[index]){renderLearning();return;}state.lesson={index,step:state.data.paths[0].steps[index]};heading('写好提示词，也学会检查回答','每一步都有方法、示例、练习和原讨论出处。');renderLearning();readCard(state.lesson.step.card,state.lesson);}
function renderOverview(){
 const container=$('overviewView');container.replaceChildren(node('h2','overview-title','从多个讨论中提炼的方法'),node('p','meta','总结保留项目差异、尚未验证的判断和历史时间，不将聊天意见变成通用规则。'));
 for(const category of state.data.categories.filter(c=>c.id!=='unclassified')){const section=node('section','overview-category');const title=node('h2',null,category.name);title.style.color=category.color;section.append(title,node('p',null,category.description));cardList(state.data.cards.filter(c=>topicInfo(c.topic)?.category===category.id&&c.review_status==='ready'&&(!state.chat||c.chats.includes(state.chat))),section);container.append(section);}
}
async function searchKnowledge(){
 const q=$('query').value.trim();if(!q){setMode('map');heading('走进知识的星系','拖动旋转 · 滚轮缩放 · 点击主题，沿出处阅读。');return;}
 const turn=++state.request;setMode('overview');heading('搜索：'+q,'先看总结，再沿关联资料核对。');const container=$('overviewView');container.replaceChildren(node('p','loading','正在搜索…'));
 try{const data=await api('/api/knowledge/search',{q,chat:state.chat});if(turn!==state.request)return;container.replaceChildren(node('p','meta',number(data.total)+' 个匹配结果；其中 '+number(data.knowledge_matches)+' 篇经验总结。'));
  for(const item of data.results){const b=button('',()=>item.kind==='knowledge'?readCard(item.card_id):readSource(item.id),'article-link');b.append(node('span','eyebrow',item.kind==='knowledge'?'经验总结':'来源资料'),node('strong',null,item.title),node('p',null,item.excerpt));container.append(b);}if(!data.results.length)container.append(node('p','empty-note','试试“提示词”“错误”“上下文”，或切换全部来源。'));
  if(data.total>20){let page=1;const more=button('加载更多结果',async()=>{more.disabled=true;try{const next=await api('/api/knowledge/search',{q,chat:state.chat,page:++page});for(const item of next.results){const b=button('',()=>item.kind==='knowledge'?readCard(item.card_id):readSource(item.id),'article-link');b.append(node('strong',null,item.title),node('p',null,item.excerpt));container.insertBefore(b,more);}more.hidden=page*20>=next.total;}finally{more.disabled=false;}});container.append(more);}
 }catch(e){container.replaceChildren(node('p','error',e.message));}
}
async function loadAtlas(){
 const turn=++state.request;const data=await api('/api/atlas',{chat:state.chat});if(turn!==state.request)return;state.data=data;
 renderGroups();
 renderDistribution();drawGalaxy();topicRows($('listView'));renderLearning();renderOverview();updateLearningButtons();
 $('methodBody').replaceChildren(node('p',null,data.method),node('p',null,'主分类分布按消息去重，每条消息只计一次。一个主题的关联数量包含多标签消息或资料，主题数量不能相加当成消息总量。'),node('p',null,'当前处理 '+number(data.totals.active_messages)+' 条可用消息，其中 '+number(data.totals.classified_messages)+' 条识别出主题，'+number(data.totals.unclassified_messages)+' 条保留为日常与待归类。'+number(data.totals.thread_context_assignments)+' 条使用同话题上下文归类。'),node('p',null,'精编经验来自已阅读的讨论样本，来源变化时标记待复核；自动主题综述每次构建重新统计并摘取原文，不冒充已验证结论。学习模板为教学练习，不能代替特定项目的人工提交要求。'),node('p',null,'每颗小星对应一条有来源的知识，亮度代表阅读重要度。收藏、笔记、学习进度和人工整理保存在本机 SQLite。导入更新会保留人工整理；来源变化时需要重新核对。演示数据均为项目自编示例。'));
 if(!fragments){fragments=new FragmentExplorer({reader:$('reader'),host:$('stage'),galaxy:()=>galaxy,data:()=>state.data,chat:()=>state.chat,onSelect:()=>{state.request++;state.lesson=null;},openSource:readSource,onMap:()=>setMode('map')});}await fragments.reload();
 window.__knowledgeDataReady=true;
}
$('mapNav').onclick=()=>{setMode('map');history.replaceState(null,'','/');heading('走进知识的星系','拖动旋转 · 滚轮缩放 · 点击主题，沿出处阅读。');};
$('learnNav').onclick=$('startLearning').onclick=$('readerStart').onclick=()=>openLesson(0);
$('overviewNav').onclick=()=>{setMode('overview');heading('经验综述','先看方法和适用边界，再查看支持资料。');renderOverview();};
$('searchForm').onsubmit=e=>{e.preventDefault();searchKnowledge();};
$('group').onchange=async()=>{state.chat=$('group').value;state.topic=null;try{await loadAtlas();if(state.mode==='learn')openLesson(0);else $('reader').replaceChildren(node('p','empty-note','已切换资料来源，选择主题继续探索。'));}catch(e){showError(e);}};
$('listToggle').onclick=()=>{const list=$('listToggle').dataset.list!=='true';$('listToggle').dataset.list=String(list);$('listToggle').textContent=list?'星图视图':'列表视图';$('mapView').hidden=list;$('listView').hidden=!list;galaxy?.setVisible(!list);};
$('resetMap').onclick=()=>galaxy?.reset();$('orbitToggle').onclick=()=>{const enabled=galaxy?.setAuto(!galaxy.auto);$('orbitToggle').textContent=enabled?'暂停巡航':'缓慢巡航';$('orbitToggle').setAttribute('aria-pressed',String(!!enabled));};$('zoomIn').onclick=()=>zoom(.8);$('zoomOut').onclick=()=>zoom(1.25);
$('methodToggle').onclick=()=>$('methodDialog').showModal();$('methodClose').onclick=()=>$('methodDialog').close();
let polling=false,lastUpdateStatus=null;
async function pollUpdates(){
 if(polling||!state.data)return;polling=true;
 try{
  const status=await api('/api/update-status');lastUpdateStatus=status;
  const label=$('syncState'),last=status.last_published_at?.replace('T',' ').slice(0,19);
  const phaseNames={atoms:'更新知识星',ocr:'识别截图',sync:'同步群消息',index:'重建检索',documents:'读取文档',attachments:'整理附件',knowledge:'更新知识综述'};
  label.textContent=status.running?'正在'+(phaseNames[status.phase]||'更新知识库')+'…':status.loop_active?'导入器正在运行':'本地资料已就绪';
  $('syncDetail').textContent=(last?'最近发布：'+last:'通过命令行导入资料后自动更新页面。')+(status.next_run_at?'；下次：'+status.next_run_at.replace('T',' ').slice(0,19):'');
  if(status.last_error)$('syncDetail').textContent+='；'+status.last_error;
  if(status.current_group&&status.running)$('syncDetail').textContent+='；当前：'+status.current_group;
  const scans=(status.groups||[]).filter(g=>g.older_topics).map(g=>g.name+' '+g.older_topics.refreshed+'/'+g.older_topics.known);
  if(scans.length)$('syncDetail').textContent+='；本轮旧话题回查：'+scans.join('，')+'（按导入任务更新）';
  const version=await api('/api/version');
  if(version.generation&&version.generation!==state.data.generation||version.atoms_generation&&version.atoms_generation!==fragments?.generation){
   const selected=state.topic,mode=state.mode,lesson=state.lesson,hash=new URLSearchParams(location.hash.slice(1)).get('card');
   // Preserve camera, notes, progress, input and the current reader during live refresh.
   const data=await api('/api/atlas',{chat:state.chat});state.data=data;renderGroups();renderDistribution();drawGalaxy();topicRows($('listView'));renderLearning();updateLearningButtons();
   await fragments?.reload();await fragments?.refreshSelected();
   if(mode==='overview'&&!$('query').value.trim())renderOverview();
   if(!fragments?.selected&&!document.activeElement?.matches('textarea,input')){
    if(lesson)await readCard(lesson.step.card,lesson,false);else if(hash)await readCard(hash,null,false);else if(selected)await chooseTopic(selected);
   }
   $('syncNotice').textContent='知识库已自动更新，当前视角和学习笔记已保留。';
  }
 }catch(error){console.error('Knowledge refresh failed',error);$('syncState').textContent='暂时无法更新本地资料';}finally{polling=false;}
}
window.pollKnowledgeUpdates=pollUpdates;
setInterval(pollUpdates,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollUpdates();});
(async()=>{try{await loadLearning();await loadAtlas();const hash=new URLSearchParams(location.hash.slice(1));if(hash.get('atom'))await fragments.read(hash.get('atom'));else if(hash.get('card')||state.data.cards[0])await readCard(hash.get('card')||state.data.cards[0].id,null,false);else fragments.list();window.__knowledgeReady=true;pollUpdates();}catch(e){showError(e);$('coverage').textContent='知识整理结果暂不可用，请检查本地资料。';}})();
