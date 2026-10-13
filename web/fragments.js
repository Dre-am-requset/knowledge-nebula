const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const btn=(text,fn)=>{const b=el('button',null,text);b.type='button';b.onclick=fn;return b;};
const kinds={method:'方法步骤',experience:'经验',prompt:'提示词',code:'代码',resource:'参考资源',question:'待解问题'};
const states={unread:'未读',read:'已读',to_learn:'待学',mastered:'已掌握'};
const statuses={rule_extract:'规则摘编',unresolved:'待解问题',needs_review:'待复核',curated:'已精编'};
async function request(url,data){const response=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const body=await response.json();if(!response.ok)throw Error(body.error||'操作未完成');return body;}
function link(url,text){const a=el('a',null,text);try{const u=new URL(url);if(['https:','http:','lark:','feishu:'].includes(u.protocol)){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}}catch{}return a;}
export class FragmentExplorer{
 constructor({reader,host,galaxy,data,chat,onSelect,openSource,onMap}){
  Object.assign(this,{reader,host,galaxy,data,chat,onSelect,openSource,onMap});this.filters={};this.items=[];this.stack=[];this.drafts=new Map();this.selected=null;this.sequence=0;
  this.toolbar=el('section','fragment-toolbar');this.toolbar.setAttribute('aria-label','小知识筛选');host.prepend(this.toolbar);
  this.search=el('input');this.search.type='search';this.search.placeholder='找一颗知识星…';this.search.setAttribute('aria-label','搜索小知识');
  const searchForm=el('form','fragment-search');searchForm.append(this.search,btn('定位',()=>this.searchNow()));searchForm.onsubmit=e=>{e.preventDefault();this.searchNow();};this.toolbar.append(searchForm);
  this.topic=this.select('主题',[['','全部主题'],...data().topics.map(t=>[t.id,t.name]),['unclassified','待归类']],'topic');
  this.kind=this.select('知识类型',[['','全部类型'],...Object.entries(kinds)],'kind');
  this.state=this.select('学习状态',[['','全部知识'],['new','最近新增'],['favorite','我的收藏'],...Object.entries(states),['pending','待解 / 待复核'],['hidden','已隐藏']],'state');
  for(const key of ['start','end']){const label=el('label','fragment-date',key==='start'?'从':'至');const input=el('input');input.type='date';input.setAttribute('aria-label',key==='start'?'来源起始日期':'来源结束日期');input.onchange=()=>{this.filters[key]=input.value;this.reload().then(()=>this.list()).catch(e=>this.notice(e.message));};label.append(input);this.toolbar.append(label);}
  this.toolbar.append(btn('知识清单',()=>this.list()),btn('随机学 3 条',()=>this.random()),btn('整理设置',()=>this.settings()));
  this.count=el('span','fragment-count');this.toolbar.append(this.count);
 }
 notice(text){this.count.textContent=text;}
 select(label,options,key){const select=el('select');select.setAttribute('aria-label',label);for(const [value,name]of options){const option=el('option',null,name);option.value=value;select.append(option);}select.onchange=()=>{this.filters[key]=select.value;this.reload().then(()=>this.list()).catch(e=>this.notice(e.message));};this.toolbar.append(select);return select;}
 async searchNow(){this.filters.q=this.search.value.trim();await this.reload().catch(e=>this.notice(e.message));this.list();if(this.items[0]){this.onMap();this.galaxy()?.focusAtom(this.items[0].id);}}
 syncTopics(){const options=[['','全部主题'],...this.data().topics.map(t=>[t.id,t.name]),['unclassified','待归类']];if(this.filters.topic&&!options.some(x=>x[0]===this.filters.topic))delete this.filters.topic;this.topic.replaceChildren();for(const [value,name]of options){const option=el('option',null,name);option.value=value;this.topic.append(option);}this.topic.value=this.filters.topic||'';}
 async reload(){this.syncTopics();const turn=++this.sequence;const data=await request('/api/atoms?'+new URLSearchParams({...this.filters,chat:this.chat()}));if(turn!==this.sequence)return;this.items=data.results;this.build=data.build;this.config=data.settings;this.generation=data.build.generation;this.galaxy()?.setAtoms(this.items.filter(x=>!x.hidden));this.notice(data.total.toLocaleString('zh-CN')+' 颗知识星');return data;}
 async refreshSelected(){
  const id=this.selected;if(!id)return;const snapshot=await request('/api/atom/'+id).catch(()=>null);if(this.selected!==id)return;
  if(!snapshot){const warning=el('p','boundary','这条知识的来源已发生变化，请重新打开查看。个人笔记仍保留。');this.reader.prepend(warning);return;}
  if(this.drafts.has(id)||document.activeElement?.matches('textarea,input')){
   const body=this.reader.querySelector('.atom-body');if(body){if(snapshot.body)body.textContent=snapshot.body;else body.remove();}
   const summary=this.reader.querySelector('.summary');if(summary)summary.textContent=snapshot.summary;
   const badge=this.reader.querySelector('.eyebrow');if(badge)badge.textContent=statuses[snapshot.status]||snapshot.status;
   if(snapshot.status==='needs_review')this.reader.querySelector('.atom-sources')?.remove();
  }else{const scroll=this.reader.scrollTop;await this.read(id,true);this.reader.scrollTop=scroll;}
 }
 clearSelection(){this.selected=null;this.sequence++;this.galaxy()?.selectAtom(null);}
 list(items=this.items,title='小知识清单'){
  this.onSelect();this.selected=null;this.reader.replaceChildren(el('span','eyebrow','每颗小星都有原文出处'),el('h2',null,title),el('p','meta',items.length+' 条 · 亮度按重要度；缩放到星团后可点击小星。'));
  let shown=0;const more=btn('加载更多',()=>append());const append=()=>{for(const a of items.slice(shown,shown+25)){const b=btn('',()=>{this.onMap();this.galaxy()?.focusAtom(a.id);this.read(a.id);});b.className='article-link';b.append(el('span','meta',(statuses[a.status]||a.status)+' · '+(kinds[a.kind]||a.kind)+' · '+a.importance+' 分'+(a.priority_author?' · 优先作者':'')),el('strong',null,a.title),el('p',null,a.summary));this.reader.insertBefore(b,more);}shown+=25;more.hidden=shown>=items.length;};this.reader.append(more);append();
 }
 random(){const pool=this.items.filter(a=>a.user.state!=='mastered'&&!a.hidden),sample=[];while(pool.length&&sample.length<3)sample.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);this.list(sample,'这次学三条');}
 async read(id,back=false){
  const turn=++this.sequence;this.onSelect();if(this.selected&&this.selected!==id&&!back)this.stack.push(this.selected);this.selected=id;
  this.reader.replaceChildren(el('p','loading','正在打开知识星…'));history.replaceState(null,'','#atom='+id);
  try{const a=await request('/api/atom/'+id);if(turn!==this.sequence)return;this.current=a;const r=this.reader;r.replaceChildren();
   const nav=el('div','fragment-actions');nav.append(btn('返回上条',()=>{const prev=this.stack.pop();if(prev)this.read(prev,true);else this.list();}),btn('靠近这颗星',()=>{this.onMap();this.galaxy()?.focusAtom(id);}));r.append(nav,el('span','eyebrow',statuses[a.status]||a.status),el('h2',null,a.title),el('p','meta',(kinds[a.kind]||a.kind)+' · '+a.first.slice(0,10)+' ～ '+a.last.slice(0,10)));
   r.append(el('p','summary',a.summary));if(a.body)r.append(el('pre','atom-body',a.body));
   const score=el('details');score.append(el('summary',null,'重要度 '+a.importance+' / 100 · 查看亮度依据'),el('p',null,(a.importance_reasons||[]).join('；')+'。重要度表示阅读优先级，不代表事实已验证。'));r.append(score,el('p','boundary',a.boundary||'请结合来源时间和项目条件阅读。'));
   if(a.annotation)r.append(el('p','boundary',a.annotation));
   const actions=el('div','fragment-actions');const favorite=btn(a.user.favorite?'已收藏':'收藏',()=>save({favorite:!a.user.favorite}));actions.append(favorite);
   const state=el('select');state.setAttribute('aria-label','这条知识的学习状态');for(const [value,name]of Object.entries(states)){const o=el('option',null,name);o.value=value;state.append(o);}state.value=a.user.state||'unread';state.onchange=()=>save({state:state.value});actions.append(state,btn('编辑 / 合并 / 拆分',()=>this.editor(a)),btn('修改历史',()=>this.versions(id)));r.append(actions);
   const label=el('label',null,'我的学习笔记'),notes=el('textarea');notes.id='atomNotes';notes.rows=5;notes.maxLength=10000;notes.value=this.drafts.get(id)??a.user.note??'';label.htmlFor=notes.id;const feedback=el('p','meta','保存在本地知识库，同步保留。');notes.oninput=()=>{this.drafts.set(id,notes.value);feedback.textContent='有未保存的笔记';};const saveNote=btn('保存笔记',()=>save({note:notes.value}));r.append(label,notes,saveNote,feedback);
   const save=async patch=>{saveNote.disabled=true;try{const result=await request('/api/atoms/state',{id,revision:a.user_revision,...patch});a.user_revision=result.revision;a.user=result.value;favorite.textContent=a.user.favorite?'已收藏':'收藏';if('note'in patch){this.drafts.delete(id);feedback.textContent='笔记已保存到本地知识库';}else feedback.textContent='学习状态已保存';const item=this.items.find(x=>x.id===id);if(item)item.user=a.user;}catch(e){feedback.textContent=e.message;feedback.className='error';}finally{saveNote.disabled=false;}};
   r.append(el('h3',null,'原文与上下文'));
   const sourceBox=el('details','atom-sources');sourceBox.append(el('summary',null,'查看 '+a.sources.length+' 条关联原消息'));let shown=0;const more=btn('加载更多原文',()=>append());const append=()=>{for(const m of a.sources.slice(shown,shown+20)){const box=el('div','source-message');box.append(el('p','meta',m.name+' · '+m.sender+' · '+m.time),el('pre',null,m.body));if(m.url)box.append(link(m.url,'打开原始出处'));sourceBox.insertBefore(box,more);}shown+=20;more.hidden=shown>=a.sources.length;};sourceBox.append(more);append();r.append(sourceBox);
   for(const d of a.documents){r.append(btn('完整讨论：'+d.title,async()=>{await this.openSource(d.id);const back=btn('返回刚才的知识星',()=>this.read(id,true));this.reader.prepend(back);}));}
   if(a.related.length){r.append(el('h3',null,'继续阅读'));for(const related of a.related)r.append(btn(related.relation+'：'+related.title,()=>this.read(related.id)));}
   if(a.parents?.length)r.append(el('p','meta','合并 / 拆分前的个人笔记仍在原条目，可在“已隐藏”清单查看。'));
   this.galaxy()?.selectAtom(id,a.related.map(x=>x.id));
  }catch(e){if(turn===this.sequence)this.reader.replaceChildren(el('p','error',e.message));}
 }
 modal(title){const dialog=el('dialog','fragment-dialog');dialog.append(btn('关闭',()=>dialog.close()),el('h2',null,title));document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;}
 field(dialog,label,value,multi=false){const wrap=el('label',null,label),input=el(multi?'textarea':'input');input.value=value||'';if(multi)input.rows=7;wrap.append(input);dialog.append(wrap);return input;}
 editor(a){const dialog=this.modal('整理这条知识'),title=this.field(dialog,'标题',a.title),summary=this.field(dialog,'摘要',a.summary,true),body=this.field(dialog,'正文（保留适用条件和不同意见）',a.body,true),annotation=this.field(dialog,'适用边界 / 编辑备注',a.annotation,true);
  const topic=el('select');topic.setAttribute('aria-label','修改主题');for(const t of [...this.data().topics,{id:'unclassified',name:'待归类'}]){const o=el('option',null,t.name);o.value=t.id;topic.append(o);}topic.value=a.topic;dialog.append(topic);
  const reviewed=el('input');reviewed.type='checkbox';if(a.status==='needs_review'){const label=el('label');label.append(reviewed,document.createTextNode('已核对更新后的来源，下面的正文是重新整理的结果'));dialog.append(label);}
  const status=el('p','meta','人工编辑保留版本；同步不会覆盖人工正文。'),run=async(route,data)=>{try{const result=await request('/api/atoms/'+route,data);dialog.close();await this.reload();await this.read(result.ids?.[0]||a.id,true);}catch(e){status.textContent=e.message;status.className='error';}};
  dialog.append(btn('保存整理',()=>run('edit',{id:a.id,revision:a.edit_revision,title:title.value,summary:summary.value,body:body.value,annotation:annotation.value,topic:topic.value,acknowledge_sources:reviewed.checked})),btn(a.hidden?'恢复显示':'隐藏这条',()=>run('edit',{id:a.id,revision:a.edit_revision,hidden:!a.hidden})),status);
  const advanced=el('details');advanced.append(el('summary',null,'合并与拆分（保留原条目和笔记）'));dialog.append(advanced);
  const other=this.field(advanced,'待合并知识的 ID（可从另一张知识卡地址 #atom= 后复制）','');
  advanced.append(btn('与指定条目合并',async()=>{try{const b=await request('/api/atom/'+other.value.trim());const review=this.modal('核对合并结果');review.append(el('p','boundary','仅合并同一知识；相反观点请分别保留。'));const merged=this.field(review,'合并正文',body.value+'\n\n'+b.body,true);review.append(btn('保存合并',async()=>{review.close();await run('merge',{id:a.id,other:b.id,title:title.value,body:merged.value,revisions:{[a.id]:a.edit_revision,[b.id]:b.edit_revision}});}));}catch(e){status.textContent=e.message;}}));
  const pieces=this.field(advanced,'拆分正文：用独立一行的 === 分隔，每份保持意思完整',a.body,true);advanced.append(btn('保存拆分',()=>run('split',{id:a.id,title:title.value,parts:pieces.value.split(/^\s*===\s*$/m).map(x=>x.trim()).filter(Boolean),revisions:{[a.id]:a.edit_revision}})));
 }
 async versions(id){const d=this.modal('修改历史');try{const rows=await request('/api/atom-history/'+id);if(!rows.length)d.append(el('p',null,'暂无人工修改或来源变更。'));for(const row of rows){const detail=el('details');detail.append(el('summary',null,row.at+' · '+({edit:'人工整理',state:'学习记录',merge:'合并',split:'拆分',source_changed:'来源更新'}[row.action]||row.action)),el('pre',null,JSON.stringify(row.value,null,2)));d.append(detail);}}catch(e){d.append(el('p','error',e.message));}}
 settings(){const d=this.modal('知识来源与整理规则');d.append(el('p',null,'每颗星是一条知识；空间位置由稳定 ID 决定，星之间的距离不表示语义相似度。'),el('p',null,'亮度表示阅读重要度，不表示事实可信度。来自同一资料的知识可显示关系线。'),el('p',null,'资料导入保留收藏、笔记与人工修订；来源编辑或撤回后，人工正文会提示待复核。'),el('p',null,'当前数据标记：'+(this.build.dataset_label||'本地导入资料')+'。通过 python -m nebula import 导入自己的资料。'));}
}
