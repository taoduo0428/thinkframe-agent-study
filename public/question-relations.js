const relationFamilies=[
 {id:"agent-structure",terms:["普通 llm","核心模块","agent架构","agent 设计","agent设计","agent 的理解","主流的 agent","agent 架构","agent具体怎么实现","agent实现"]},
 {id:"agent-loop",terms:["react","agent loop","loop engineering","plan and execute","规划模块","规划-执行","循环机制","任务拆解","推理模式","autonomous agent","workflow"]},
 {id:"agent-implementation",terms:["agent具体怎么实现","agent实现","agent架构","agent 架构","agent设计","agent 设计","agent实现流程","agent工作流程"]},
 {id:"agent-coordination",terms:["多 agent","多agent","multi-agent","multi agent","多智能体","agent协作","agent 协作","agent team","协作机制"]},
 {id:"agent-context",terms:["agent多轮对话","agent 多轮对话","attention","分模块输入","需求理解","上下文窗口","context window","多轮对话"]},
 {id:"tool-use",terms:["mcp","function calling","tool calling","function call","cli","skill","hook","a2a","工具调用","工具路由","工具描述","插件"]},
 {id:"memory-context",terms:["memory","记忆","context","上下文","记忆压缩","上下文压缩","长期记忆","短期记忆","summary"]},
 {id:"rag-retrieval",terms:["rag","embedding","rerank","chunk","向量","切片","召回","检索","hnsw","faiss","ann","ivf","milvus","pinecone","chroma","余弦","欧氏距离","双塔","单塔"]},
 {id:"framework",terms:["langchain","langgraph","harness","graph engineering","loop engineering","checkpoint","状态快照"]},
 {id:"reliability",terms:["badcase","幻觉","超时","失败","评估","成功率","路径震荡","延迟","冲突","a/b test","llm as judge","高并发"]},
 {id:"backend",terms:["mysql","redis","缓存","索引","布隆过滤器","多进程","多线程","异步","async","sse","websocket"]},
 {id:"coding-agent",terms:["claude code","codex","cursor","openclaw","queryengine","queryloop","microcompact","autocompact","agent.md","memory.md","grep"]},
 {id:"system-design",terms:["系统架构","智能客服","新闻推荐","可中断","弹性伸缩","生产级"]}
];
const stopWords=new Set(["什么","如何","怎么","一个","哪些","介绍","一下","核心","区别","实现","设计","问题","场景","方式","特点","分析","需要","应该","是否","进行","中的","可以","怎样","为什么","时候","以及","这个","那个","自己","一般","通常","具体","简要","说一说","了解","什么是","有何","有什么","哪些是","是什么","怎么做","能否","是否可以","agent","agents","llm","llms","system","systems"]);
function textOf(question){
 return [question.title,question.question,question.category,...(question.tags||[]),...(question.keyPoints||[])].filter(Boolean).join(" ").toLowerCase();
}
function tokenWeights(question){
 const weights=new Map();
 const add=(value,weight)=>{
  const text=String(value||"").toLowerCase().replace(/(?:什么是|有什么区别|的区别|是什么|有什么|如何|怎么|为什么|介绍一下|简要介绍|说一说|了解过)/g," ").replace(/[的和与及或在中对把为等是有了从将能会被并而还可]/g," ");
  const latin=text.match(/[a-z][a-z0-9_+#.-]{1,}/g)||[];
  for(const token of latin)if(!stopWords.has(token))weights.set(token,(weights.get(token)||0)+weight);
  const runs=text.match(/[\u3400-\u9fff]{2,}/g)||[];
  for(const run of runs){
   if(run.length<=6&&!stopWords.has(run))weights.set(run,(weights.get(run)||0)+weight*1.15);
   for(let i=0;i<run.length-1;i++){const token=run.slice(i,i+2);if(!stopWords.has(token))weights.set(token,(weights.get(token)||0)+weight*.55);}
   for(let i=0;i<run.length-2;i++){const token=run.slice(i,i+3);if(!stopWords.has(token))weights.set(token,(weights.get(token)||0)+weight*.35);}
  }
 };
 add(question.title,3.2);add(question.question,1.5);
 for(const tag of question.tags||[])if(String(tag)!==String(question.category))add(tag,2.2);
 for(const point of question.keyPoints||[])add(point,1.8);
 return weights;
}
export function findRelatedQuestions(question,questions,limit=4){
 const all=Array.isArray(questions)?questions:[];
 if(!question||!all.length)return [];
 const profiles=all.map(item=>({item,weights:tokenWeights(item)}));
 const documentFrequency=new Map();
 for(const profile of profiles)for(const token of profile.weights.keys())documentFrequency.set(token,(documentFrequency.get(token)||0)+1);
 const idf=token=>Math.log(1+(all.length+1)/(1+(documentFrequency.get(token)||0)));
 const vectors=profiles.map(profile=>{
  const vector=new Map();let norm=0;
  for(const [token,weight] of profile.weights){const value=weight*idf(token);vector.set(token,value);norm+=value*value;}
  return {...profile,vector,norm:Math.sqrt(norm)};
 });
 const source=vectors.find(x=>x.item.id===question.id)||(()=>{
  const weights=tokenWeights(question),vector=new Map();let norm=0;
  for(const [token,weight] of weights){const value=weight*idf(token);vector.set(token,value);norm+=value*value;}
  return {item:question,vector,norm:Math.sqrt(norm)};
 })();
 const sourceText=textOf(question);
 const sourceFamilies=relationFamilies.filter(f=>f.terms.some(term=>sourceText.includes(term))).map(f=>f.id);
 const explicit=new Set((question.relatedQuestions||[]).map(String));
 const max=Math.max(1,Math.min(12,Number(limit)||4));
 return vectors.filter(x=>x.item.id!==question.id).map(candidate=>{
  let dot=0;for(const [token,value] of source.vector)dot+=value*(candidate.vector.get(token)||0);
  const cosine=source.norm&&candidate.norm?dot/(source.norm*candidate.norm):0;
  const targetText=textOf(candidate.item);
  const sharedFamilies=sourceFamilies.filter(id=>relationFamilies.find(f=>f.id===id)?.terms.some(term=>targetText.includes(term)));
  const reverseExplicit=(candidate.item.relatedQuestions||[]).some(value=>String(value)===String(question.id)||String(value)===String(question.title));
  const linked=explicit.has(String(candidate.item.id))||explicit.has(String(candidate.item.title))||reverseExplicit;
  const implementationToArchitecture = (
    ((sourceText.includes("agent具体怎么实现") || sourceText.includes("agent实现")) && /agent\s*架构/.test(targetText)) ||
    ((targetText.includes("agent具体怎么实现") || targetText.includes("agent实现")) && /agent\s*架构/.test(sourceText))
   );
   const multiAgentPair = /多\s*agent|multi[- ]agent|多智能体/.test(sourceText) && /多\s*agent|multi[- ]agent|多智能体/.test(targetText);
   const relationBoost = Math.min(.36, sharedFamilies.length * .14) +
    (implementationToArchitecture ? .42 : 0) + (multiAgentPair ? .18 : 0);
   const score=cosine+relationBoost+(question.category===candidate.item.category?0.015:0)+(question.questionType===candidate.item.questionType?0.005:0)+(linked?1:0);
  return {question:candidate.item,score,cosine,sharedFamilies};
 }).filter(x=>x.score>=.085).sort((a,b)=>b.score-a.score||String(a.question.title||"").localeCompare(String(b.question.title||""),"zh-CN")).slice(0,max).map(x=>x.question);
}
