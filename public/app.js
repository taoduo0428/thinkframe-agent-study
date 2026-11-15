import { findRelatedQuestions } from "./question-relations.js";
import { splitAnswerIntoPoints } from "./answer-format.js";
const categories=["Agent 基础与推理机制","工具调用与能力接入","Memory 与 Context Engineering","RAG 与向量检索","框架与运行时架构","系统基础与后端工程","可靠性、评估与安全","Coding Agent 与 IDE","综合系统设计与场景题","开放题与个人观点"];
const defaultAppearance={version:2,oceanMode:"light",topbar:{tone:"light",transparency:4},content:{tone:"light",transparency:0},agent:{tone:"light",transparency:0}};
function loadAppearance(){try{const saved=JSON.parse(localStorage.getItem("thinkframe.appearance")||"{}");const merged={...defaultAppearance,...saved,topbar:{...defaultAppearance.topbar,...saved.topbar},content:{...defaultAppearance.content,...saved.content},agent:{...defaultAppearance.agent,...saved.agent}};if(saved.version!==2){merged.agent={...merged.agent,tone:"light",transparency:0};}merged.version=2;return merged;}catch{return structuredClone(defaultAppearance);}}
const state={view:"overview",questions:[],stats:{categories:{}},settings:{providers:[],activeProviderId:null,activeProvider:null,baseUrl:"https://api.openai.com/v1",model:"",hasApiKey:false,temperature:.3},modelsByProvider:{},editingProviderId:null,providerFeedback:"",health:{},category:"全部",search:"",status:"all",question:null,study:0,reveal:false,preview:[],warnings:[],messages:[],history:[],contextId:null,conversationId:null,conversations:[],conversationHistoryOpen:false,conversationRestored:false,busy:false,error:"",quickAgentOpen:false,appearance:loadAppearance()};
const root=document.getElementById("app-view");
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,opt={}){const r=await fetch(path,{headers:{"Content-Type":"application/json"},...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"请求失败");return d;}
function localDateKey(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
function toast(s,bad=false){const e=document.createElement("div");e.className="toast"+(bad?" error":"");e.textContent=s;$("#toast-root").append(e);setTimeout(()=>e.remove(),3000);}
function label(v){return ({overview:"学习总览",bank:"全部题目",favorites:"星标题目",detail:"题目详情",study:"专注练习",agent:"Agent 解答",add:"整理新题",settings:"设置与连接"})[v]||"学习总览";}
function statusText(s){return ({new:"未学习",learning:"学习中",mastered:"已掌握"})[s]||"未标记";}
function pill(s){return '<span class="pill '+(s==="mastered"?"green":s==="learning"?"blue":"amber")+'">'+statusText(s)+"</span>";}
function typeText(t){return ({concept:"概念理解",mechanism:"原理机制",comparison:"对比选型",troubleshooting:"问题排查","system-design":"系统设计",opinion:"观点表达"})[t]||"技术问题";}
function saveAppearance(){try{state.appearance.version=2;localStorage.setItem("thinkframe.appearance",JSON.stringify(state.appearance));}catch{toast("外观设置无法保存到本机。",true);}}
function applyAppearance(){
 const a=state.appearance,rootStyle=document.documentElement.style;
 document.body.dataset.oceanMode=a.oceanMode==="dark"?"dark":"light";document.documentElement.dataset.oceanMode=a.oceanMode==="dark"?"dark":"light";
 for(const zone of ["topbar","content","agent"]){
  const tone=a[zone].tone==="dark"?"dark":"light";
  const transparency=Math.max(0,Math.min(100,Number(a[zone].transparency)||0));
  rootStyle.setProperty("--glass-"+zone+"-alpha",((100-transparency)/100).toFixed(2));
  rootStyle.setProperty("--glass-"+zone+"-rgb",tone==="dark"?"28,43,62":"255,253,249");
  document.documentElement.dataset["glass"+zone[0].toUpperCase()+zone.slice(1)+"Tone"]=tone;
 }
}
function setAgentContext(id){
 const next=id||null;
 if(state.contextId!==next){state.contextId=next;state.conversationId=null;state.messages=[];state.history=[];state.error="";state.conversationHistoryOpen=false;try{localStorage.removeItem("thinkframe.conversationId");}catch{}}
}
function persistConversationId(id){state.conversationId=id||null;try{if(id)localStorage.setItem("thinkframe.conversationId",id);else localStorage.removeItem("thinkframe.conversationId");}catch{}}
function mapConversationMessages(items=[]){
 return items.filter(item=>item&&["user","assistant"].includes(item.role)).map(item=>item.role==="user"
  ? {role:"user",content:String(item.content||"")}
  : (item.result?{role:"assistant",result:item.result}:{role:"assistant",content:String(item.content||item.error||"")}));
}
async function restoreConversation(){
 const id=state.conversationId||(()=>{try{return localStorage.getItem("thinkframe.conversationId");}catch{return null;}})();
 if(!id)return null;
 try{
  const conversation=await api("/api/agent/conversations/"+encodeURIComponent(id));
  if(state.contextId && (conversation.contextId||null)!==(state.contextId||null)){persistConversationId(null);return null;}
  if(!state.contextId)state.contextId=conversation.contextId||null;
  persistConversationId(conversation.id);
  state.messages=mapConversationMessages(conversation.messages||[]);
  state.history=(conversation.messages||[]).filter(item=>["user","assistant"].includes(item.role)&&item.status!=="error").map(item=>({role:item.role,content:item.content||item.result?.answer||""})).filter(item=>item.content);
  return conversation;
 }catch{persistConversationId(null);return null;}
}
async function ensureConversation(){
 if(state.conversationId)return state.conversationId;
 const restored=await restoreConversation();
 if(restored)return restored.id;
 const conversation=await api("/api/agent/conversations",{method:"POST",body:JSON.stringify({contextId:state.contextId})});
 persistConversationId(conversation.id);
 state.messages=[];
 state.history=[];
 return conversation.id;
}
async function loadConversationList(){
 const result=await api("/api/agent/conversations?limit=30");
 state.conversations=result.conversations||[];
 return state.conversations;
}
async function startNewConversation(){
 const conversation=await api("/api/agent/conversations",{method:"POST",body:JSON.stringify({contextId:state.contextId})});
 persistConversationId(conversation.id);
 state.messages=[];state.history=[];state.error="";state.conversationHistoryOpen=false;
 renderQuickAgent();
}
function appearanceZone(title,key,description){
 const item=state.appearance[key];
 return '<article class="appearance-zone"><div class="appearance-zone-head"><div><strong>'+title+'</strong><p>'+description+'</p></div><span class="appearance-preview" data-appearance-preview="'+key+'">GLASS</span></div><div class="appearance-zone-controls"><label>玻璃明暗<select class="field appearance-select" data-appearance-tone="'+key+'"><option value="light"'+(item.tone==="light"?" selected":"")+'>浅色玻璃</option><option value="dark"'+(item.tone==="dark"?" selected":"")+'>深色玻璃</option></select></label><label class="transparency-control"><span>透明度 <strong data-opacity-value="'+key+'">'+item.transparency+'%</strong></span><input type="range" min="0" max="100" step="1" value="'+item.transparency+'" data-appearance-transparency="'+key+'"><small>0% 不透明 · 100% 完全透明</small></label></div></article>';
}
function appearancePanelHtml(){
 return '<section class="appearance-panel"><div class="appearance-panel-head"><div><span class="eyebrow">APPEARANCE</span><h2>晴空蓝与暖纸白</h2><p>以清澈浅蓝、柔和暖白和杏桃色点缀建立统一层次。顶部、学习内容和 Agent 面板可分别调整明暗与透明度。</p></div><label class="ocean-mode-select">页面基调<select id="ocean-mode" class="field"><option value="light"'+(state.appearance.oceanMode==="light"?" selected":"")+'>海岸日光</option><option value="dark"'+(state.appearance.oceanMode==="dark"?" selected":"")+'>深海夜色</option></select></label></div><div class="appearance-zone-grid">'+appearanceZone("顶部导航","topbar","品牌、主导航与快捷操作") + appearanceZone("学习内容","content","题目、思路、答案和个人笔记") + appearanceZone("Agent 面板","agent","随时呼出的浅色对话窗口")+'</div><div class="appearance-footnote">透明度 0% 为不透明，100% 为完全透明；设置保存在当前浏览器。</div></section>';
}
function highlightAnswerLine(line){
 const match=line.match(/^(\s*(?:(?:\d+)[.、)）]\s*|[-*•]\s*)?)([^：:<]{1,32})([：:])(\s*.*)$/);
 if(match&&(match[1]||/(要点|核心|关键|首先|其次|最后|结论|原理|机制|流程|区别|优点|缺点|原因|方案|步骤|作用)/.test(match[2])))return match[1]+'<strong class="answer-key">'+match[2]+match[3]+'</strong>'+match[4];
 return line;
}
function escapeRegex(value){
 const meta=new Set([".","*","+","?","^","$","{","}","(",")","|","[","]","\\"]);
 return [...String(value)].map(char=>meta.has(char)?"\\"+char:char).join("");
}
function highlightKeyPoints(html,terms=[]){
 const keys=[...new Set(terms.map(x=>String(x||"").trim()).filter(x=>x.length>1))].sort((a,b)=>b.length-a.length);
 if(!keys.length)return html;
 const stack=[];
 return html.split(/(<\/?[a-z][^>]*>)/gi).map(part=>{
  if(part.startsWith("<")){
   const match=part.match(/^<\/?([a-z]+)/i);
   if(match){const tag=match[1].toLowerCase();if(part.startsWith("</")){const index=stack.lastIndexOf(tag);if(index>=0)stack.splice(index,1);}else if(!part.endsWith("/>"))stack.push(tag);}
   return part;
  }
  if(stack.some(tag=>["strong","code","pre"].includes(tag)))return part;
  let out=part;
  for(const key of keys){const pattern=new RegExp(escapeRegex(esc(key)),"gi");out=out.replace(pattern,match=>'<strong class="answer-key">'+match+'</strong>');}
  return out;
 }).join("");
}
function rich(s,keyPoints=[]){
 const fence=String.fromCharCode(96).repeat(3);
 const codePattern=new RegExp(fence+"[a-zA-Z0-9_-]*\\s*\\n([\\s\\S]*?)"+fence,"g");
 const blocks=[];
 let raw=String(s||"").replace(codePattern,(_,code)=>{const marker="@@CODEBLOCK"+blocks.length+"@@";blocks.push("<pre><code>"+esc(code.trim())+"</code></pre>");return marker;});
 let html=esc(raw).replace(/\*\*(.*?)\*\*/g,'<strong class="answer-key">$1</strong>');
 const inlinePattern=new RegExp(String.fromCharCode(96)+"([^"+String.fromCharCode(96)+"]+)"+String.fromCharCode(96),"g");
 html=html.replace(inlinePattern,"<code>$1</code>");
 html=html.split(/\n{2,}/).map(part=>{
  const trimmed=part.trim();
  if(/^@@CODEBLOCK\d+@@$/.test(trimmed))return trimmed;
  const lines=part.split("\n");
  if(lines.every(line=>/^\s*[-*•]\s+/.test(line)))return "<ul>"+lines.map(line=>"<li>"+highlightAnswerLine(line.replace(/^\s*[-*•]\s+/,""))+"</li>").join("")+"</ul>";
  if(lines.every(line=>/^\s*\d+[.、)）]\s+/.test(line)))return "<ol>"+lines.map(line=>"<li>"+highlightAnswerLine(line.replace(/^\s*\d+[.、)）]\s+/,""))+"</li>").join("")+"</ol>";
  return "<p>"+lines.map(highlightAnswerLine).join("<br>")+"</p>";
 }).join("");
 html=highlightKeyPoints(html,keyPoints);
 blocks.forEach((block,index)=>{html=html.replace("@@CODEBLOCK"+index+"@@",block);});
 return '<div class="answer-body">'+html+"</div>";
}
function answerPoints(source,keyPoints=[]){
 const points=splitAnswerIntoPoints(source);
 if(!points.length)return '<div class="answer-body"></div>';
 return '<div class="answer-point-list">'+points.map((point,index)=>{
  const title=String(point.heading||"").replace(/^[0-9]+[.、)] */,"");
  return '<article class="answer-point"><span class="answer-point-index">'+String(index+1).padStart(2,"0")+'</span><div class="answer-point-main">'+(title?'<h3 class="answer-point-title">'+esc(title)+'</h3>':"")+(point.content?rich(point.content,keyPoints):"")+'</div></article>';
 }).join("")+'</div>';
}
function heading(k,t,d,action=""){return '<div class="page-heading"><div><h1>'+t+'</h1><p>'+d+'</p></div>'+(action?'<div class="heading-actions">'+action+"</div>":"")+"</div>";}
function nav(){ document.querySelectorAll(".top-nav-link[data-view],.mobile-nav-link[data-view]").forEach(b=>{const active=b.dataset.view===state.view;b.classList.toggle("active",active);if(b.classList.contains("mobile-nav-link")){if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");}});const active=state.settings.activeProvider;$("#agent-status").textContent=active?.model?(active.name+" · "+active.model):(state.settings.hasApiKey?"API 已连接":"本地模式");}
function starButton(q){return '<button class="star-toggle '+(q.starred?"is-starred":"")+'" data-action="toggle-star" data-id="'+esc(q.id)+'" aria-pressed="'+(q.starred?"true":"false")+'" aria-label="'+(q.starred?"取消星标":"加入星标")+'" title="'+(q.starred?"取消星标":"加入星标")+'">'+(q.starred?"★":"☆")+'</button>';}
function row(q,i){return '<div class="question-row" data-q="'+esc(q.id)+'" role="button" tabindex="0"><div class="question-row-main"><strong>'+esc(q.title)+'</strong><small>'+esc(q.category)+" · "+typeText(q.questionType)+'</small></div><div class="question-row-end">'+pill(q.status)+starButton(q)+'</div></div>';}
function activityPlot(){return (state.stats.dailyActivity||[]).slice(-7).map(d=>{const height=d.count?Math.min(38,8+d.count*5):3;return '<div class="activity-day" title="'+d.date+' · '+d.count+' 次复习"><span class="activity-count">'+(d.count||"")+'</span><span class="activity-bar" style="height:'+height+'px"></span><small>'+d.date.slice(5)+'</small></div>';}).join("");}
function renderHome(){
 const recent=state.questions.slice().sort((a,b)=>new Date(b.lastReviewedAt||b.updatedAt||0)-new Date(a.lastReviewedAt||a.updatedAt||0)).slice(0,6);
 const s=state.stats;
 root.innerHTML='<section class="home-masthead"><div class="home-copy"><h1>把技术问题看清楚，<br><em>再把答案讲明白。</em></h1><p>围绕 AI Agent 工程建立自己的知识脉络。每道题都有独立的思考路径，也能和相近问题互相参照。</p><div class="home-actions"><button class="button-primary" data-view="bank">进入题库</button><button class="button-secondary" data-view="study">开始复习</button></div></div><aside class="home-daily"><div class="daily-kicker">今日学习记录 <span>'+new Date().toLocaleDateString("zh-CN",{month:"long",day:"numeric"})+'</span></div><div class="daily-count"><strong>'+(s.todayReviewed||0)+'</strong><span>次复习</span></div><div class="activity-plot">'+activityPlot()+'</div><div class="daily-foot"><span>连续学习 '+(s.streakDays||0)+' 天</span><span>累计 '+(s.totalReviews||0)+' 次</span></div><button class="daily-link" data-view="study">继续今天的学习</button></aside></section>'+
 '<section class="learning-ledger"><div><small>题库题目</small><strong>'+(s.total||0)+'</strong></div><div><small>已掌握</small><strong>'+(s.mastered||0)+'</strong></div><div><small>学习中</small><strong>'+(s.learning||0)+'</strong></div><div><small>掌握进度</small><strong>'+(s.completion||0)+'<i>%</i></strong></div></section>'+
 '<section class="home-section"><div class="section-head"><div><h2>知识目录</h2><p>从主题进入，再沿着相关问题逐步深入。</p></div><button class="text-link" data-view="bank">全部题目</button></div><div class="category-index">'+categories.map(c=>'<button class="category-index-row" data-category="'+esc(c)+'"><strong>'+esc(c)+'</strong><span class="category-index-count">'+(s.categories?.[c]||0)+' 道题</span></button>').join("")+'</div></section>'+
 '<section class="home-section recent-section"><div class="section-head"><div><h2>最近学习</h2><p>从最近记录过的题目继续。</p></div><button class="text-link" data-view="favorites">查看星标</button></div><div class="question-list">'+(recent.length?recent.map(row).join(""):'<div class="empty-state">题库还没有内容。</div>')+'</div></section>';
}
function relatedQuestionsFor(q){return findRelatedQuestions(q,state.questions,4);}
function relatedMarkup(q){
 const list=relatedQuestionsFor(q);
 return '<section class="related-section"><div class="section-head"><div><h2>相近问题</h2><p>沿着同一概念链，把相关问题放在一起理解。</p></div></div>'+(list.length?'<div class="related-list">'+list.map(x=>'<button class="related-row" data-q="'+esc(x.id)+'"><strong>'+esc(x.title)+'</strong><small>'+esc(x.category)+'</small></button>').join("")+'</div>':'<p class="related-empty">暂未找到足够相近的题目。</p>')+'</section>';
}
function filtered(){return state.questions.filter(q=>(state.category==="全部"||q.category===state.category)&&(state.status==="all"||q.status===state.status)&&(!state.search||[q.title,q.question,q.category,...(q.tags||[])].join(" ").toLowerCase().includes(state.search.toLowerCase())));}
function card(q,i){return row(q,i);}
function bankResults(){const list=filtered();const pending=list.filter(q=>q.reviewStatus!=="pass").length;$("#bank-summary").innerHTML="找到 <strong>"+list.length+"</strong> 道题目 · <strong>"+pending+"</strong> 道待校准思路";$("#bank-results").innerHTML=list.length?list.map(card).join(""):'<div class="empty-state">没有找到匹配题目。</div>';}
function renderBank(){
 const categoryOptions=categories.map(c=>'<option value="'+esc(c)+'"'+(state.category===c?" selected":"")+'>'+esc(c)+"</option>").join("");
 const statusOptions=[["all","全部"],["new","未学习"],["learning","学习中"],["mastered","已掌握"]].map(([v,t])=>'<button class="filter-tab '+(state.status===v?"active":"")+'" data-status="'+v+'">'+t+"</button>").join("");
 root.innerHTML=heading("QUESTION LIBRARY","全部题目","搜索、筛选题目，或进入单题深入学习。",'<button class="button-primary" data-view="add">整理新题</button>')+
 '<div class="bank-toolbar"><label class="search-box"><span>⌕</span><input id="search" placeholder="搜索题目、关键词或技术名词…" value="'+esc(state.search)+'"></label><select id="category" class="filter-select"><option value="全部">全部分类</option>'+categoryOptions+'</select><div class="filter-tabs">'+statusOptions+'</div></div><div class="bank-summary" id="bank-summary"></div><div id="bank-results" class="question-list"></div>';
 bankResults();
}
function renderFavorites(){
 const favorites=state.questions.filter(q=>q.starred);
 root.innerHTML=heading("STARRED","星标题目","把重要问题收进自己的复习清单。")+'<div class="bank-summary">'+favorites.length+' 道已收藏题目</div><div class="question-list">'+(favorites.length?favorites.map(row).join(""):'<div class="empty-state">还没有星标题目。可以在题目列表或详情页点击星标。</div>')+'</div>';
}
function pathHtml(items){return '<div class="thinking-list">'+(items||[]).map((s,i)=>'<div class="thinking-step"><span class="thinking-number">'+String(i+1).padStart(2,"0")+'</span><div><strong class="thinking-key">'+esc(s.heading)+'</strong><p>'+esc(s.detail)+'</p></div></div>').join("")+"</div>";}
function renderDetail(){
 const q=state.question;if(!q)return renderBank();
 const sourceLabel=q.answerOrigin==="source"?"原始资料":q.answerOrigin==="curated"?"基于原文整理":q.answerOrigin==="ai"?"AI 整理":"待补充";
 const alignmentLabel=q.reviewStatus==="pass"?"思路已校准":q.reviewStatus==="source-check-required"?"需要核对来源":q.reviewStatus==="needs-revision"?"需要复核":"待逐题校准";
 const hasCuratedKeyPoints=Array.isArray(q.keyPoints)&&q.keyPoints.length>0;
 const visibleKeyPoints=hasCuratedKeyPoints?q.keyPoints:(q.tags||[]).slice(0,6);
 const alignmentNote=q.reviewStatus==="pass"?"本题思路已完成逐题校准。":q.reviewStatus==="source-check-required"?"本题有内容需要回到原始资料核对。":q.reviewStatus==="needs-revision"?"本题思路或答案仍有需要修订的地方。":"本题尚未完成逐题校准，当前内容以原始资料为依据，仅供复习参考。";
 const sourcePanel=q.sourceAnswer&&q.sourceAnswer!==q.answer
  ? '<section class="content-panel"><h2 class="panel-title">原始资料</h2>'+rich(q.sourceAnswer)+'</section>'
  : "";
 const reviewPanel=(q.reviewIssues||[]).length?'<section class="content-panel review-issues"><h2 class="panel-title">核对说明</h2><ul>'+(q.reviewIssues||[]).map(issue=>'<li>'+esc(issue)+'</li>').join("")+'</ul></section>':"";
 const header=[
  '<button class="detail-back" data-view="bank">← 返回题库</button>',
  '<header class="detail-header"><div class="detail-head-copy">',
  '<div class="eyebrow">'+esc(q.category)+' / '+typeText(q.questionType)+'</div>',
  '<div class="detail-title-line"><h1>'+esc(q.title)+'</h1>'+starButton(q)+'</div>',
  '<div class="detail-meta">'+pill(q.status)+'<span class="alignment-status '+(q.reviewStatus==="pass"?"is-pass":"")+'">'+alignmentLabel+'</span>',
  '<span class="pill">'+esc(q.sourceSection||"自定义")+'</span>',
  '<span class="pill">'+(q.sourcePage?"资料第 "+q.sourcePage+" 页":"自定义题目")+'</span></div></div>',
  state.settings.hasApiKey&&state.settings.model?'<div class="detail-actions"><button class="button-secondary" data-action="rewrite">按本题校准思路与答案</button>':'<div class="detail-actions"><button class="button-secondary" data-view="settings">配置模型 API 后校准</button>',
  '<button class="button-secondary" data-action="review-question" data-id="'+esc(q.id)+'">记录本次学习</button>',
  '<button class="button-primary" data-action="ask">问 Agent</button></div></header>'
 ].join("");
 const main=[
  '<div class="detail-layout"><div class="detail-main">',
  '<section class="content-panel question-panel"><h2 class="panel-title">题目</h2><div class="question-prompt">'+esc(q.question||q.title)+'</div></section>',
  '<section class="content-panel thinking-panel"><h2 class="panel-title">答题思路</h2><p class="panel-intro">'+alignmentNote+'</p>'+pathHtml(q.thinkingPath)+'</section>',
  reviewPanel,
  '<section class="content-panel answer-panel"><div class="answer-panel-head"><span class="answer-source">'+sourceLabel+'</span></div>'+answerPoints(q.answer||q.sourceAnswer,[...visibleKeyPoints,...(q.thinkingPath||[]).map(step=>step.heading)])+'</section>',
  sourcePanel,
  '<section class="content-panel notes-panel"><h2 class="panel-title">我的笔记</h2>',
  '<textarea id="question-notes" class="textarea-field" rows="5" maxlength="5000" placeholder="记录自己的理解、容易混淆的点，或下次复习要补充的内容…">'+esc(q.notes||"")+'</textarea>',
  '<div class="notes-footer"><span>保存在本地题库</span><button class="button-secondary" data-action="save-notes" data-id="'+esc(q.id)+'">保存笔记</button></div></section>',
  relatedMarkup(q),
  '</div>'
 ].join("");
 const lastReviewedLabel=q.lastReviewedAt?new Date(q.lastReviewedAt).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"尚未复习";
 const aside=[
  '<aside class="detail-aside"><div class="aside-card study-aside"><h3>本题进度</h3>',
  '<div class="detail-status"><span>',statusText(q.status),'</span><strong>',String(q.reviewCount||0),' 次复习</strong></div>',
  '<div class="detail-status last-review"><span>上次复习</span><strong>',esc(lastReviewedLabel),'</strong></div>',

  '<button class="button-secondary" data-action="review-question" data-id="',esc(q.id),'" style="width:100%;margin-top:14px">记录本次学习</button>',
  '<button class="button-quiet" data-action="toggle-status" style="width:100%;margin-top:7px">',
  q.status==="mastered"?"重新加入待复习":"标记为已掌握",
  '</button></div><div class="aside-card"><h3>'+(hasCuratedKeyPoints?"本题要点":"本题关键词")+'</h3><div class="keypoint-list">',
  visibleKeyPoints.map(t=>'<div class="keypoint-item">'+esc(t)+'</div>').join("") || '<p class="keypoint-empty">本题尚未整理关键词。</p>',
  '</div></div><div class="aside-card"><h3>资料来源</h3><p class="source-meta">',
  esc(q.sourceSection||"自定义题目"),q.sourcePage?" · 第 "+q.sourcePage+" 页":"",
  '</p></div></aside></div>'
 ].join("");
 root.innerHTML=header+main+aside;
}
function renderStudy(){
 const list=state.questions.filter(q=>q.status!=="mastered");
 if(!list.length){root.innerHTML=heading("FOCUS MODE","专注练习","通过主动回忆，把理解转化为自己的表达。")+'<div class="empty-state">目前没有待复习题目。</div>';return;}
 state.study=Math.max(0,Math.min(state.study,list.length-1));const q=list[state.study];const visibleKeyPoints=Array.isArray(q.keyPoints)&&q.keyPoints.length?q.keyPoints:(q.tags||[]).slice(0,6);
 root.innerHTML=heading("FOCUS MODE","专注练习","先自己组织答案，再对照这道题的思路与资料。")+'<div class="study-wrap"><div class="study-topline"><span>待复习 '+list.length+' 道</span><span>'+(state.study+1)+' / '+list.length+'</span></div><section class="study-card"><div class="study-card-top"><div class="eyebrow">'+esc(q.category)+' · '+typeText(q.questionType)+'</div>'+starButton(q)+'</div><h2 class="study-question">'+esc(q.title)+'</h2><p class="study-hint">试着先用自己的话回答。完成后再展开思路和答案。</p>'+pathHtml(q.thinkingPath)+(state.reveal?'<div class="study-answer"><div class="panel-kicker">原文整理</div>'+answerPoints(q.answer||q.sourceAnswer,[...visibleKeyPoints,...(q.thinkingPath||[]).map(step=>step.heading)])+'</div>':'<button class="button-secondary" data-action="reveal">展开答案</button>')+'<div class="study-controls"><button class="button-quiet" data-action="prev">← 上一道</button><div class="study-controls-right"><button class="button-secondary" data-action="open-study">查看详情</button><button class="button-secondary" data-action="review-study" data-id="'+esc(q.id)+'">记录今日复习</button><button class="button-primary" data-action="master-study">我已掌握</button><button class="button-secondary" data-action="next">下一道 →</button></div></div></section></div>';
}
function welcome(){return '<div class="chat-welcome"><div class="welcome-orb">AI</div><h2>你好，我是 ThinkFrame Agent。</h2><p>可以直接提问，也可以围绕题库题目继续追问。我会优先检索本地知识库，并标出资料出处。</p><div class="suggestion-grid">'+["MCP 和 Function Calling 有什么区别？","Agent 的 ReAct 执行循环是怎样的？","RAG 检索效果不好，应该怎么排查？","如何设计一个可靠的 Coding Agent？"].map(s=>'<button class="suggestion-chip" data-suggestion="'+esc(s)+'">'+esc(s)+" ↗</button>").join("")+"</div></div>";}
function answerCard(r){
 const citations=r.citations||[];const thinking=(r.thinkingPath||[]).map((s,i)=>'<div class="thinking-step"><span class="thinking-number">'+(i+1)+'</span><div><strong>'+esc(s.heading)+'</strong><p>'+esc(s.detail)+'</p></div></div>').join("");
 const sources=citations.map(s=>'<div class="chat-source"><strong>'+esc(s.title)+'</strong><small>'+esc(s.section)+" · "+esc(s.location)+"</small><p>"+esc((s.excerpt||"").slice(0,250))+"</p></div>").join("");
 const follow=(r.followUps||[]).map(s=>'<button class="followup-chip" data-follow="'+esc(s)+'">'+esc(s)+" ↗</button>").join("");
 return '<div class="chat-answer">'+(r.understanding?'<div class="answer-understanding">'+esc(r.understanding)+"</div>":"")+(thinking?'<div class="answer-section"><h4>答题思路</h4><div class="chat-thinking">'+thinking+"</div></div>":"")+
 '<div class="answer-point-meta"><span class="pill '+(r.mode==="agent"?"blue":"amber")+'">'+(r.mode==="agent"?"AI 解答":"本地资料")+"</span></div>"+answerPoints(r.answer,(r.thinkingPath||[]).map(step=>step.heading)) +
 (r.implementation?'<div class="answer-section"><h4>实现细节 / 示例</h4>'+rich(r.implementation)+"</div>":"")+(r.tradeoffs?'<div class="answer-section"><h4>工程边界与取舍</h4>'+rich(r.tradeoffs)+"</div>":"")+
 (r.supplementalNotes?'<div class="answer-section"><h4>'+(r.mode==="local"?"本地资料摘录":"模型补充（非原文）")+"</h4>"+rich(r.supplementalNotes)+"</div>":"")+
 (sources?'<div class="answer-section"><h4>参考资料</h4><div class="answer-citations">'+citations.map(s=>'<span class="citation-chip">'+esc(s.sourceId)+" · "+esc(s.location)+"</span>").join("")+'</div><div class="chat-source-list">'+sources+"</div></div>":"")+
 (follow?'<div class="chat-followups">'+follow+"</div>":"")+"</div>";
}
function renderAgent(){
 const q=state.contextId?state.questions.find(x=>x.id===state.contextId):null;
 const messages=state.messages.map(m=>m.role==="user"?'<div class="chat-message user"><span class="chat-avatar">YOU</span><div class="chat-bubble"><p>'+esc(m.content)+"</p></div></div>":'<div class="chat-message assistant"><span class="chat-avatar">TF</span><div class="chat-bubble">'+(m.result?answerCard(m.result):rich(m.content||""))+"</div></div>").join("");
 const typing=state.busy?'<div class="chat-message assistant"><span class="chat-avatar">TF</span><div class="chat-bubble">正在检索资料并组织答案…</div></div>':"";
 root.innerHTML=heading("THINKFRAME AGENT","让问题得到真正的解释。","说明思路、原理、实现方式与资料依据。")+
 '<div class="agent-layout"><section class="chat-panel"><div class="chat-header"><div class="chat-brand"><span class="chat-orb">AI</span><div><strong>ThinkFrame · Interview Coach</strong><small>'+(state.settings.hasApiKey&&state.settings.model?"模型已连接 · RAG 知识库检索":"本地资料检索 · 配置模型后开启 AI 生成")+"</small></div></div><div class=\"chat-header-right\"><span class=\"pill "+(state.health.knowledgeIndexReady?"green":"amber")+'">'+(state.health.knowledgeIndexReady?"知识库已索引":"索引未建立")+'</span><button class="button-quiet" data-action="clear">清空对话</button></div></div>'+
 '<div id="chat-feed" class="chat-feed">'+(messages||welcome())+typing+(state.error?'<div class="notice warning">'+esc(state.error)+"</div>":"")+"</div>"+
 '<div class="chat-input-area">'+(q?'<div class="chat-context">围绕题目：'+esc(q.title)+'<button data-action="clear-context">解除关联 ×</button></div>':"")+'<form id="agent-form"><div class="chat-composer"><textarea id="agent-input" rows="2" placeholder="输入问题，或继续追问…" '+(state.busy?"disabled":"")+'></textarea><button class="chat-send" type="submit" '+(state.busy?"disabled":"")+'">↑</button></div></form><div class=\"chat-disclaimer\">本地资料优先；模型补充会单独标注。重要技术结论请进一步核验。</div></div></section>'+
 '<aside class="agent-aside"><div class="agent-side-card"><h3>Agent 能力</h3><ul><li>答题思路与完整解答</li><li>代码 / 实现流程与工程取舍</li><li>多轮追问与上下文延续</li><li>资料引用及 PDF 页码</li></ul></div>' +
 '<div class="agent-side-card"><h3>知识库状态</h3>' +
 '<div class="agent-stat"><span>题库题目</span><strong>'+state.stats.total+'</strong></div>' +
 '<div class="agent-stat"><span>全文索引片段</span><strong>'+(state.health.knowledgeChunks||0)+'</strong></div>' +
 '<div class="agent-stat"><span>模型状态</span><strong>'+(state.settings.hasApiKey&&state.settings.model?"已配置":"未配置")+'</strong></div></div>' +
 '<div class="agent-side-card"><h3>继续深入</h3><p>可以追问底层机制、实现方式、失败处理、性能优化与系统设计。</p><button class="button-secondary" style="width:100%;margin-top:12px" data-view="settings">配置模型 API</button></div></aside></div>';
 const feed=$("#chat-feed");if(feed)feed.scrollTop=feed.scrollHeight;
}
function renderQuickAgent(){
 const host=$("#quick-agent-root");if(!host)return;
 const q=state.contextId?(state.questions.find(x=>x.id===state.contextId)||state.question):null;
 const trigger=state.quickAgentOpen?"":'<button class="quick-agent-trigger" data-action="quick-agent-open" aria-label="打开 ThinkFrame Agent" aria-haspopup="dialog" aria-controls="quick-agent-drawer" aria-expanded="false"><span class="quick-agent-trigger-orb">AI</span><span><strong>问问 Agent</strong><small>随时解释 · 追问 · 举例</small></span><kbd>AI</kbd></button>';
 if(!state.quickAgentOpen){host.innerHTML=trigger;return;}
 const messages=state.messages.map(m=>m.role==="user"?'<div class="chat-message user"><span class="chat-avatar">YOU</span><div class="chat-bubble"><p>'+esc(m.content)+"</p></div></div>":'<div class="chat-message assistant"><span class="chat-avatar">TF</span><div class="chat-bubble">'+(m.result?answerCard(m.result):rich(m.content||""))+"</div></div>").join("");
 const typing=state.busy?'<div class="chat-message assistant"><span class="chat-avatar">TF</span><div class="chat-bubble"><span class="typing-dots"><i></i><i></i><i></i></span>正在检索资料并组织答案…</div></div>':"";
 const historyPanel=state.conversationHistoryOpen?'<section class="conversation-history"><div class="conversation-history-head"><strong>最近对话</strong><button data-action="quick-agent-history" aria-label="收起历史对话">收起</button></div>'+(state.conversations.length?state.conversations.map(item=>'<div class="conversation-history-row"><button data-action="load-conversation" data-id="'+esc(item.id)+'" class="'+(item.id===state.conversationId?"active":"")+'"><strong>'+esc(item.title||"新对话")+'</strong><small>'+esc(item.preview||"暂无消息")+'</small></button><button class="conversation-delete" data-action="delete-conversation" data-id="'+esc(item.id)+'" aria-label="删除对话">×</button></div>').join(""):'<p class="conversation-history-empty">还没有历史对话。</p>')+'</section>':"";
 host.innerHTML=trigger+'<div class="quick-agent-scrim" data-action="quick-agent-close"></div><section id="quick-agent-drawer" class="quick-agent-drawer" role="dialog" aria-modal="false" aria-label="ThinkFrame Agent" aria-describedby="quick-agent-context"><header class="quick-agent-head"><div class="chat-brand"><span class="chat-orb">AI</span><div><strong>ThinkFrame Agent</strong><small>'+(state.settings.activeProvider?.model?esc(state.settings.activeProvider.name+" · "+state.settings.activeProvider.model):"本地知识库 · "+(state.health.knowledgeIndexReady?"已建立索引":"索引未建立"))+'</small></div></div><div class="quick-agent-actions"><button data-action="quick-agent-history" title="历史对话" aria-label="历史对话" aria-expanded="'+(state.conversationHistoryOpen?"true":"false")+'">历史</button><button data-action="quick-agent-new" title="新对话" aria-label="新建对话">＋</button><button data-action="quick-agent-close" title="收起" aria-label="收起 ThinkFrame Agent">×</button></div></header>' +(q?'<div id="quick-agent-context" class="quick-agent-context"><span>当前题目</span><strong>'+esc(q.title)+'</strong></div>':'<div id="quick-agent-context" class="quick-agent-context"><span>通用问答</span><strong>可以直接问技术问题，也可以继续追问</strong></div>')+historyPanel+'<div id="quick-agent-feed" class="quick-agent-feed" role="log" aria-live="polite" aria-relevant="additions text" aria-busy="'+(state.busy?"true":"false")+'">'+(messages||welcome())+typing+(state.error?'<div class="notice warning">'+esc(state.error)+"</div>":"")+'</div><div class="quick-agent-compose"><form id="quick-agent-form"><div class="chat-composer"><textarea id="quick-agent-input" aria-label="输入技术问题" aria-describedby="quick-agent-disclaimer" rows="2" placeholder="'+(q?"围绕当前题目继续追问…":"输入技术问题，Agent 随时为你解释…")+'" '+(state.busy?"disabled":"")+'></textarea><button class="chat-send" type="submit" '+(state.busy?"disabled":"")+' aria-label="发送">↑</button></div></form><div id="quick-agent-disclaimer" class="chat-disclaimer">优先检索本地资料 · AI 补充与原文依据分开标注</div></div></section>';
 const feed=$("#quick-agent-feed");if(feed)feed.scrollTop=feed.scrollHeight;
}
function renderAdd(){
 const previewCards=state.preview.map((q,i)=>{
  const options=categories.map(c=>'<option value="'+esc(c)+'"'+(q.category===c?" selected":"")+'>'+esc(c)+'</option>').join("");
  const path=(q.thinkingPath||[]).map((s,j)=>(j+1)+". "+esc(s.heading)).join("<br>");
  return '<div class="preview-card" data-i="'+i+'"><div class="preview-card-head"><strong>'+String(i+1).padStart(2,"0")+' · 题目预览</strong></div><label class="form-label">题目</label><input class="field p-title" value="'+esc(q.title)+'"><label class="form-label">分类</label><select class="field p-category">'+options+'</select><div class="preview-thinking"><strong>答题思路</strong><br>'+path+'</div><label class="form-label">答案</label><textarea class="textarea-field p-answer" rows="5">'+esc(q.answer||"")+'</textarea></div>';
 }).join("");
 const preview=state.preview.length
  ? '<div class="preview-stack">'+previewCards+'<div class="preview-footer"><span class="small muted">'+state.preview.length+' 道题目待保存</span><button class="button-primary" data-action="save-preview">保存到题库 →</button></div></div>'
  : '<div class="preview-empty"><div><div class="preview-empty-mark">AI</div><strong>等待生成学习卡片</strong><br>在左侧粘贴题目，Agent 会整理题型、分类和答题路径。</div></div>';
 const mode=state.settings.hasApiKey?"AI Agent 模式":"本地规则模式";
 const warnings=state.warnings.length?'<div class="notice warning">'+state.warnings.map(esc).join("<br>")+'</div>':"";
 root.innerHTML=heading("QUESTION CURATOR","把零散题目，整理成学习卡片。","支持一次输入多道题目。生成后先预览，确认无误再保存。")+
 '<div class="add-layout"><section class="add-panel"><h2>导入原始题目</h2><p>可以粘贴面试记录或题目清单，建议一行一道题。</p><form id="add-form"><label class="form-label">题目内容</label><textarea class="textarea-field" id="raw-questions" placeholder="例如：\n1. Agent 和普通 LLM 有什么区别？\n2. MCP 与 Function Calling 有什么区别？\n3. RAG 检索效果不好，应该怎么排查？"></textarea><div class="form-help">保留原始题意，不会覆盖已保存的原始答案。</div><div class="form-actions"><span class="agent-mode"><span class="online-dot"></span><strong>'+mode+'</strong></span><button class="button-primary" type="submit">AI 生成学习卡片</button></div></form>'+warnings+'</section><section class="add-panel"><h2>结构化预览</h2><p>检查题目、分类、思路与答案。</p>'+preview+'</section></div>';
}
function renderSettings(){
 const providers=state.settings.providers||[];
 if(state.editingProviderId===null)state.editingProviderId=state.settings.activeProviderId||"new";
 const isNew=state.editingProviderId==="new";
 const editing=isNew?null:providers.find(p=>p.id===state.editingProviderId)||null;
 const models=editing?(state.modelsByProvider[editing.id]||[]):[];
 const model=editing?.model||"";
 const modelOptions=(models.some(m=>m.id===model)?"":(model?'<option value="'+esc(model)+'" selected>当前模型 · '+esc(model)+'</option>':""))+
 models.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===model?" selected":"")+'>'+esc(m.id)+(m.ownedBy?" · "+esc(m.ownedBy):"")+"</option>").join("");
 const cards=providers.length?providers.map(p=>{
  const status=p.active?'<i class="status-dot"></i>当前使用':(p.enabled===false?"已停用":(p.hasApiKey?"已配置":"待配置"));
  const activation=p.active||p.enabled===false?"":'<button data-action="activate-provider" data-id="'+esc(p.id)+'">设为当前</button>';
  const toggle='<button data-action="toggle-provider-enabled" data-id="'+esc(p.id)+'">'+(p.enabled===false?"启用":"停用")+"</button>";
  return '<article class="provider-card '+(p.id===state.editingProviderId?"selected ":"")+(p.active?"active ":"")+(p.enabled===false?"disabled":"")+'"><button class="provider-card-open" data-action="edit-provider" data-id="'+esc(p.id)+'"><span class="provider-mark">'+esc((p.name||"A").slice(0,1).toUpperCase())+'</span><span class="provider-card-copy"><strong>'+esc(p.name)+'</strong><small>'+esc(p.baseUrl)+'</small><em>'+esc(p.model||"尚未选择模型")+'</em></span><span class="provider-card-state">'+status+'</span></button><div class="provider-card-actions"><button data-action="edit-provider" data-id="'+esc(p.id)+'">编辑</button>'+activation+toggle+'<button class="danger-link" data-action="delete-provider" data-id="'+esc(p.id)+'">删除</button></div></article>';
 }).join(""):'<div class="provider-empty"><span class="provider-empty-icon">⌘</span><strong>还没有 API 连接</strong><p>添加一个兼容接口，即可启用 Agent 的生成式回答。</p></div>';
 const active=state.settings.activeProvider;
 const activeName=active?.name||"尚未启用模型 API";
 const activeModel=active?.model||"添加连接并选择模型后，Agent 将自动使用它";
 const editorName=editing?.name||"新的 API 连接";
 const editorStatus=editing?(editing.active?"当前使用":"已保存连接"):"尚未保存";
 const feedback=state.providerFeedback?'<div class="provider-feedback">'+esc(state.providerFeedback)+'</div>':"";
 const keyPlaceholder=editing?.hasApiKey?"密钥已保存在本机 · 留空则保持不变":"粘贴 API Key";
 const modelSelect='<select class="field premium-select" id="provider-model-select"><option value="">从模型列表选择…</option>'+modelOptions+'</select>';
 root.innerHTML=heading("CONNECTIONS","模型连接中心","添加多个 API 服务，获取可用模型，并指定 ThinkFrame Agent 当前使用的模型。")+appearancePanelHtml()+
 '<section class="connection-hero"><div class="connection-hero-copy"><span class="connection-kicker"><i></i> ACTIVE WORKSPACE</span><h2>'+esc(activeName)+'</h2><p>'+esc(activeModel)+'</p><div class="connection-hero-meta"><span><i class="status-dot"></i>'+(active?.hasApiKey&&active?.model?"连接已就绪":"等待配置")+'</span><span>'+providers.length+' 个 API 连接</span><span>仅本机保存</span></div></div><div class="connection-hero-orb"><span></span><i></i><b></b></div></section>'+
 '<div class="provider-workspace"><section class="provider-library"><div class="provider-section-head"><div><span class="eyebrow">YOUR CONNECTIONS</span><h2>API 服务</h2><p>管理不同服务商、网关或自建接口。</p></div><button class="button-primary" data-action="new-provider">＋ 添加连接</button></div><div class="provider-list">'+cards+'</div><div class="provider-library-foot"><span class="privacy-lock">◈</span> API Key 仅保存在本机 <code>.data/settings.json</code></div></section>'+
 '<section class="provider-editor"><div class="provider-editor-head"><div><span class="eyebrow">CONNECTION DETAILS</span><h2>'+esc(editorName)+'</h2><p>配置地址、认证方式和模型协议。</p></div><span class="provider-editor-state">'+esc(editorStatus)+'</span></div>'+
 '<form id="provider-form" autocomplete="off"><div class="provider-form-grid"><div class="provider-field full"><label class="form-label" for="provider-name">连接名称</label><input class="field" id="provider-name" required maxlength="80" value="'+esc(editing?.name||"")+'" placeholder="例如：OpenAI / Sub2API / DeepSeek"></div><div class="provider-field full"><label class="form-label" for="provider-base-url">API Base URL</label><input class="field" id="provider-base-url" required value="'+esc(editing?.baseUrl||"")+'" placeholder="https://api.openai.com/v1"><small>填写 API 根地址，不需要附加 /chat/completions 或 /models。</small></div><div class="provider-field full"><label class="form-label" for="provider-api-key">API Key</label><input class="field" id="provider-api-key" type="password" autocomplete="new-password" placeholder="'+keyPlaceholder+'"><small>保存后不会回显；编辑时留空不会覆盖已有密钥。</small></div><div class="provider-field"><label class="form-label" for="provider-auth-mode">认证方式</label><select class="field" id="provider-auth-mode"><option value="bearer"'+((editing?.authMode||"bearer")==="bearer"?" selected":"")+'>Bearer Token</option><option value="x-api-key"'+(editing?.authMode==="x-api-key"?" selected":"")+'>x-api-key</option><option value="api-key"'+(editing?.authMode==="api-key"?" selected":"")+'>api-key</option></select></div><div class="provider-field"><label class="form-label" for="provider-protocol">调用协议</label><select class="field" id="provider-protocol"><option value="chat-completions"'+((editing?.protocol||"chat-completions")==="chat-completions"?" selected":"")+'>Chat Completions</option><option value="responses"'+(editing?.protocol==="responses"?" selected":"")+'>Responses API</option></select></div><div class="provider-field full"><div class="model-field-head"><label class="form-label" for="provider-model-select">模型选择</label><span class="model-count">'+(models.length?models.length+" 个模型可选":"支持自动获取")+'</span></div><div class="model-picker-row">'+modelSelect+'<button class="button-secondary" type="button" data-action="fetch-models">↻ 获取模型</button></div><input class="field model-manual" id="provider-model-manual" value="'+esc(model)+'" placeholder="也可以手动输入模型 ID，例如 gpt-4.1 / deepseek-chat"><small>点击「获取模型」会从服务端请求 GET /models，再从下拉列表选择。模型列表不支持时可手动填写。</small></div><div class="provider-field"><label class="form-label" for="provider-temperature">Temperature</label><input class="field" id="provider-temperature" type="number" min="0" max="1.5" step=".1" value="'+Number(editing?.temperature??.3)+'"></div></div><div class="provider-editor-actions"><div class="provider-editor-actions-left"><button class="button-secondary" type="button" data-action="test-provider" '+(!editing?.id?"disabled":"")+'>测试模型调用</button></div><div class="provider-editor-actions-right"><button class="button-quiet" type="button" data-action="cancel-provider">取消</button><button class="button-primary" type="submit">保存连接</button></div></div>'+feedback+'</form></section></div>'+
 '<section class="connection-note"><div class="connection-note-icon">TF</div><div><strong>一处配置，所有 Agent 工作流共用</strong><p>切换当前连接后，Agent 解答、批量整理题目和答案优化都会自动使用所选 API 与模型。原始题库与本地 RAG 索引不会受到影响。</p></div></section>';
}
function render(){nav();if(state.view==="overview")renderHome();else if(state.view==="bank")renderBank();else if(state.view==="favorites")renderFavorites();else if(state.view==="detail")renderDetail();else if(state.view==="study")renderStudy();else if(state.view==="agent")renderAgent();else if(state.view==="add")renderAdd();else if(state.view==="settings")renderSettings();root.classList.remove("page-enter");requestAnimationFrame(()=>root.classList.add("page-enter"));renderQuickAgent();}
async function refresh(){const snapshot=await api("/api/bootstrap");state.health=snapshot.health||{};state.stats=snapshot.stats||{};state.questions=snapshot.questions||[];state.settings=snapshot.settings||{};if(!state.conversationRestored){await restoreConversation();state.conversationRestored=true;}render();}
async function openQ(id){state.question=await api("/api/questions/"+encodeURIComponent(id));state.view="detail";if(state.quickAgentOpen)setAgentContext(id);render();}
async function askAgent(text,surface="page"){
 if(state.busy)return;
 const selector=surface==="quick"?"#quick-agent-input":"#agent-input";
 const message=String(text||$(selector)?.value||"").trim();if(!message)return;
 state.error="";state.messages.push({role:"user",content:message});state.busy=true;
 if(surface==="quick")renderQuickAgent();else renderAgent();
 try{
  const conversationId=await ensureConversation();
  const payload=await api("/api/agent/chat",{method:"POST",body:JSON.stringify({message,questionId:state.contextId,conversationId})});
  persistConversationId(payload.conversation.id);
  state.messages=mapConversationMessages(payload.conversation.messages||[]);
  state.history=(payload.conversation.messages||[]).filter(item=>["user","assistant"].includes(item.role)&&item.status!=="error").slice(-8).map(item=>({role:item.role,content:item.content||item.result?.answer||""})).filter(item=>item.content);
  if(state.conversationHistoryOpen)await loadConversationList();
 }catch(error){
  state.error=error.message;
  try{
   if(state.conversationId){const conversation=await api("/api/agent/conversations/"+encodeURIComponent(state.conversationId));state.messages=mapConversationMessages(conversation.messages||[]);}
   else state.messages.pop();
  }catch{state.messages.pop();}
 }finally{state.busy=false;if(surface==="quick")renderQuickAgent();else renderAgent();}
}
async function savePreview(){
 const qs=Array.from(document.querySelectorAll(".preview-card")).map((el,i)=>({...state.preview[i],title: $(".p-title",el).value,question:$(".p-title",el).value,category:$(".p-category",el).value,answer:$(".p-answer",el).value}));
 if(!qs.length)return;try{const r=await api("/api/questions",{method:"POST",body:JSON.stringify({questions:qs})});state.preview=[];state.warnings=[];await refresh();toast("保存 "+r.added.length+" 道，重复跳过 "+r.skipped+" 道。");state.view="bank";render();}catch(e){toast(e.message,true);}
}
function providerFormPayload(){
 const existing=(state.settings.providers||[]).find(p=>p.id===state.editingProviderId);
 return {
  name:$("#provider-name").value.trim(),
  baseUrl:$("#provider-base-url").value.trim(),
  apiKey:$("#provider-api-key").value.trim(),
  authMode:$("#provider-auth-mode").value,
  protocol:$("#provider-protocol").value,
  model:$("#provider-model-manual").value.trim()||$("#provider-model-select").value,
  temperature:Number($("#provider-temperature").value||.3),
  activate:existing?.active===true,
  enabled:existing?.enabled!==false
 };
}
async function saveProviderForm(){
 const payload=providerFormPayload();
 if(!payload.name||!payload.baseUrl)throw Error("请先填写连接名称和 API Base URL。");
 const existing=(state.settings.providers||[]).find(p=>p.id===state.editingProviderId);
 const result=await api(existing?"/api/providers/"+encodeURIComponent(existing.id):"/api/providers",{
  method:existing?"PUT":"POST",
  body:JSON.stringify(payload)
 });
 const id=result.savedProviderId||existing?.id;
 if(!id)throw Error("连接已保存，但未能确认连接 ID。");
 state.settings=result;
 state.editingProviderId=id;
 return id;
}
async function fetchProviderModels(){
 try{
  const id=await saveProviderForm();
  state.providerFeedback="正在从 API 获取模型列表…";
  renderSettings();
  const result=await api("/api/providers/"+encodeURIComponent(id)+"/models",{method:"POST",body:"{}"});
  state.modelsByProvider[id]=result.models||[];
  state.providerFeedback="已获取 "+(result.count||0)+" 个模型。请选择模型并保存连接。";
  renderSettings();
  toast("模型列表已更新。");
 }catch(error){
  state.providerFeedback=error.message;
  renderSettings();
  toast(error.message,true);
 }
}
async function testProvider(){
 try{
  const id=await saveProviderForm();
  state.providerFeedback="正在调用所选模型进行连接测试…";
  renderSettings();
  const result=await api("/api/providers/"+encodeURIComponent(id)+"/test",{method:"POST",body:"{}"});
  state.providerFeedback=result.message||"模型调用成功。";
  renderSettings();
  toast("模型调用测试成功。");
 }catch(error){
  state.providerFeedback=error.message;
  renderSettings();
  toast(error.message,true);
 }
}
document.addEventListener("click",async e=>{
 const v=e.target.closest("[data-view]");if(v){e.preventDefault();state.view=v.dataset.view;if(state.quickAgentOpen&&state.view!=="detail")setAgentContext(null);render();return;}
 const c=e.target.closest("[data-category]");if(c){state.category=c.dataset.category;state.search="";state.status="all";state.view="bank";if(state.quickAgentOpen)setAgentContext(null);render();return;}
 const star=e.target.closest('[data-action="toggle-star"]');
 if(star){e.preventDefault();e.stopPropagation();try{const id=star.dataset.id||state.question?.id;const current=state.questions.find(x=>x.id===id)||state.question;if(!current)return;const updated=await api("/api/questions/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({starred:!current.starred})});await refresh();if(state.question?.id===id)state.question=updated;render();toast(updated.starred?"已加入星标":"已取消星标");}catch(err){toast(err.message,true);}return;}
 const q=e.target.closest("[data-q]");if(q){await openQ(q.dataset.q);return;}
 const st=e.target.closest("[data-status]");if(st){state.status=st.dataset.status;renderBank();return;}
 const quickSurface=!!e.target.closest("#quick-agent-root");
 const sug=e.target.closest("[data-suggestion]");if(sug){askAgent(sug.dataset.suggestion,quickSurface?"quick":"page");return;}
 const fu=e.target.closest("[data-follow]");if(fu){askAgent(fu.dataset.follow,quickSurface?"quick":"page");return;}
 const a=e.target.closest("[data-action]");if(!a)return;
 try{
  switch(a.dataset.action){
   case "quick-agent-open":state.quickAgentOpen=true;if(state.view==="detail")setAgentContext(state.question?.id);nav();renderQuickAgent();$("#quick-agent-input")?.focus();break;
   case "quick-agent-close":state.quickAgentOpen=false;nav();renderQuickAgent();break;
   case "quick-agent-clear":await startNewConversation();break;
   case "quick-agent-new":await startNewConversation();break;
   case "quick-agent-history":state.conversationHistoryOpen=!state.conversationHistoryOpen;if(state.conversationHistoryOpen)await loadConversationList();renderQuickAgent();break;
   case "load-conversation":{const conversation=await api("/api/agent/conversations/"+encodeURIComponent(a.dataset.id));setAgentContext(conversation.contextId);persistConversationId(conversation.id);state.messages=mapConversationMessages(conversation.messages||[]);state.history=(conversation.messages||[]).filter(item=>["user","assistant"].includes(item.role)&&item.status!=="error").slice(-12).map(item=>({role:item.role,content:item.content||item.result?.answer||""})).filter(item=>item.content);state.conversationHistoryOpen=false;state.error="";renderQuickAgent();break;}
   case "delete-conversation":{if(!window.confirm("确定删除这条历史对话？删除后无法恢复。"))break;await api("/api/agent/conversations/"+encodeURIComponent(a.dataset.id),{method:"DELETE"});if(state.conversationId===a.dataset.id){persistConversationId(null);state.messages=[];state.history=[];state.error="";}await loadConversationList();renderQuickAgent();toast("历史对话已删除。");break;}
   case "ask":state.quickAgentOpen=true;setAgentContext(state.question?.id);nav();renderQuickAgent();$("#quick-agent-input")?.focus();break;
   case "clear":setAgentContext(null);await startNewConversation();renderAgent();renderQuickAgent();break;
   case "clear-context":state.contextId=null;renderAgent();renderQuickAgent();break;
   case "reveal":state.reveal=true;renderStudy();break;
   case "next":state.study++;state.reveal=false;renderStudy();break;
   case "prev":state.study--;state.reveal=false;renderStudy();break;
   case "open-study":{const list=state.questions.filter(x=>x.status!=="mastered");if(list[state.study])await openQ(list[state.study].id);break;}
   case "review-question":{const id=a.dataset.id||state.question?.id;if(!id)break;const updated=await api("/api/questions/"+encodeURIComponent(id)+"/review",{method:"POST",body:JSON.stringify({date:localDateKey()})});await refresh();state.question=updated;state.view="detail";render();toast("已记录本次学习");break;}
   case "review-study":{const list=state.questions.filter(x=>x.status!=="mastered");const item=list[state.study];if(item){await api("/api/questions/"+encodeURIComponent(item.id)+"/review",{method:"POST",body:JSON.stringify({date:localDateKey()})});await refresh();state.view="study";render();toast("已记录今日复习");}break;}
   case "master-study":{const list=state.questions.filter(x=>x.status!=="mastered");const item=list[state.study];if(item){await api("/api/questions/"+encodeURIComponent(item.id)+"/review",{method:"POST",body:JSON.stringify({date:localDateKey(),mastered:true})});await refresh();state.study=0;state.view="study";render();toast("已标记掌握并记录本次学习");}break;}
   case "toggle-status":{const status=state.question.status==="mastered"?"learning":"mastered";state.question=await api("/api/questions/"+encodeURIComponent(state.question.id),{method:"PUT",body:JSON.stringify({status})});await refresh();state.question=state.questions.find(x=>x.id===state.question.id)||state.question;state.view="detail";render();break;}
   case "save-notes":{const id=a.dataset.id||state.question?.id;if(!id)break;const updated=await api("/api/questions/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({notes:$("#question-notes")?.value||""})});await refresh();state.question=state.questions.find(x=>x.id===id)||updated;state.view="detail";render();toast("笔记已保存");break;}
   case "save-preview":await savePreview();break;
   case "rewrite":{const related=relatedQuestionsFor(state.question).map(x=>({id:x.id,title:x.title,category:x.category,questionType:x.questionType,question:x.question}));state.question=await api("/api/agent/rewrite/"+encodeURIComponent(state.question.id),{method:"POST",body:JSON.stringify({relatedQuestions:related})});await refresh();state.view="detail";render();break;}
   case "new-provider":state.editingProviderId="new";state.providerFeedback="";renderSettings();break;
   case "cancel-provider":state.editingProviderId=state.settings.activeProviderId||"new";state.providerFeedback="";renderSettings();break;
   case "edit-provider":state.editingProviderId=a.dataset.id;state.providerFeedback="";renderSettings();break;
   case "fetch-models":await fetchProviderModels();break;
   case "test-provider":await testProvider();break;
   case "activate-provider":state.settings=await api("/api/providers/"+encodeURIComponent(a.dataset.id)+"/activate",{method:"POST",body:"{}"});state.editingProviderId=a.dataset.id;state.providerFeedback="已切换当前 API 连接。";renderSettings();toast("当前连接已切换。");break;
   case "toggle-provider-enabled":{const profile=state.settings.providers.find(p=>p.id===a.dataset.id);const action=profile?.enabled===false?"enable":"disable";state.settings=await api("/api/providers/"+encodeURIComponent(a.dataset.id)+"/"+action,{method:"POST",body:"{}"});state.providerFeedback=action==="enable"?"连接已启用。":"连接已停用。";renderSettings();toast(state.providerFeedback);break;}
   case "delete-provider":if(!window.confirm("确定删除这个 API 连接？此操作不会影响题库。"))break;state.settings=await api("/api/providers/"+encodeURIComponent(a.dataset.id),{method:"DELETE"});delete state.modelsByProvider[a.dataset.id];state.editingProviderId=state.settings.activeProviderId||"new";state.providerFeedback="API 连接已删除。";renderSettings();toast("连接已删除。");break;
  }
 }catch(err){toast(err.message,true);}
});
document.addEventListener("input",e=>{
 if(e.target.id==="search"){state.search=e.target.value;bankResults();}
 if(e.target.matches("[data-appearance-transparency]")){const zone=e.target.dataset.appearanceTransparency;state.appearance[zone].transparency=Number(e.target.value);const output=$("[data-opacity-value="+zone+"]");if(output)output.textContent=e.target.value+"%";saveAppearance();applyAppearance();}
});
document.addEventListener("change",e=>{
 if(e.target.id==="category"){state.category=e.target.value;bankResults();}
 if(e.target.id==="provider-model-select"&&$("#provider-model-manual"))$("#provider-model-manual").value=e.target.value;
 if(e.target.id==="ocean-mode"){state.appearance.oceanMode=e.target.value;saveAppearance();applyAppearance();}
 if(e.target.matches("[data-appearance-tone]")){const zone=e.target.dataset.appearanceTone;state.appearance[zone].tone=e.target.value;saveAppearance();applyAppearance();}
});
document.addEventListener("submit",async e=>{
 if(e.target.id==="agent-form"){e.preventDefault();await askAgent();}
 if(e.target.id==="quick-agent-form"){e.preventDefault();await askAgent("","quick");}
 if(e.target.id==="add-form"){e.preventDefault();const text=$("#raw-questions").value;if(!text.trim())return toast("请先输入题目。",true);try{const r=await api("/api/agent/organize",{method:"POST",body:JSON.stringify({text})});state.preview=r.questions||[];state.warnings=r.warnings||[];renderAdd();}catch(err){toast(err.message,true);}}
 if(e.target.id==="provider-form"){e.preventDefault();try{await saveProviderForm();state.providerFeedback="连接配置已保存。";renderSettings();toast("API 连接已保存。");}catch(err){state.providerFeedback=err.message;renderSettings();toast(err.message,true);}}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&state.quickAgentOpen){state.quickAgentOpen=false;nav();renderQuickAgent();return;}if((e.key==="Enter"||e.key===" ")&&e.target.matches(".question-row[data-q]")){e.preventDefault();openQ(e.target.dataset.q);}});
applyAppearance();
renderQuickAgent();
refresh().catch(e=>{root.innerHTML='<div class="empty-state">ThinkFrame 启动失败：'+esc(e.message)+"<br>请确认本地服务已启动，然后刷新页面。</div>";});
