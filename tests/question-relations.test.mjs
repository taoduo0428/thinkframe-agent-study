import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findRelatedQuestions } from "../public/question-relations.js";

const questions=JSON.parse(readFileSync(new URL("../data/questions.json",import.meta.url),"utf8"));

test("links an MCP concept question to its Function Calling comparison",()=>{
 const source=questions.find(q=>q.title==="MCP是什么");
 assert.ok(source,"MCP source question exists");
 const related=findRelatedQuestions(source,questions,4);
 assert.ok(related.some(q=>/Function Calling/i.test(q.title)),related.map(q=>q.title).join(" | "));
});

test("links RAG questions through their shared retrieval concepts",()=>{
 const source=questions.find(q=>/RAG 的整体流程/i.test(q.title));
 assert.ok(source,"RAG source question exists");
 const related=findRelatedQuestions(source,questions,4);
 assert.ok(related.length>0,"related RAG questions should be found");
 assert.ok(related.some(q=>/RAG|向量|检索|Embedding/i.test(q.title)),related.map(q=>q.title).join(" | "));
});

test("connects Agent implementation, collaboration, and context questions without relying on category alone",()=>{
 const implementation=questions.find(q=>q.title==="Agent具体怎么实现呢");
 assert.ok(findRelatedQuestions(implementation,questions,4).some(q=>q.title==="Agent 架构有什么特点"));
 const collaboration=questions.find(q=>q.title==="多 Agent 怎么协作");
 assert.ok(findRelatedQuestions(collaboration,questions,4).some(q=>/multi-agent/.test(q.title)));
 const context=questions.find(q=>q.title==="如果分模块输入，agent是否会对整个需求没有认知,导致做出来的成果不符合预期?");
 assert.ok(findRelatedQuestions(context,questions,4).some(q=>q.title.includes("Agent多轮对话")));
});

test("honors explicit related-question references even when wording differs",()=>{
 const a={id:"a",title:"MCP",question:"Model Context Protocol",category:"工具",questionType:"concept",relatedQuestions:["b"]};
 const b={id:"b",title:"Redis 缓存",question:"Redis cache",category:"后端",questionType:"concept"};
 const c={id:"c",title:"图像压缩",question:"image compression",category:"图像",questionType:"mechanism"};
 assert.deepEqual(findRelatedQuestions(a,[a,b,c],4).map(q=>q.id),["b"]);
});

test("supports reverse references, excludes the current question, and respects the limit",()=>{
 const a={id:"a",title:"RAG 检索",question:"向量检索",category:"RAG",questionType:"concept"};
 const b={id:"b",title:"向量数据库",question:"向量检索数据库",category:"RAG",questionType:"concept",relatedQuestions:["a"]};
 const c={id:"c",title:"Embedding 模型",question:"向量 embedding",category:"RAG",questionType:"concept"};
 const d={id:"d",title:"Reranker",question:"向量检索精排",category:"RAG",questionType:"concept"};
 const result=findRelatedQuestions(a,[a,b,c,d],2);
 assert.ok(result.length<=2);
 assert.ok(result.every(q=>q.id!=="a"));
 assert.ok(result.some(q=>q.id==="b"));
});
