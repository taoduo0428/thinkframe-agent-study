#!/usr/bin/env python3
"""Import the interview section from the original AI Agent knowledge-base PDF.

The source PDF is read-only. The script writes normalized records to data/questions.json.
Requires: python -m pip install pymupdf
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT.parent / "AI Agent工程师知识库全文.pdf"
SECTION_NAMES = {"基础篇", "RAG篇", "框架篇", "系统篇", "策略篇", "IDE篇", "场景题", "开放题"}


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def block_text(block: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    spans = [
        span
        for line in block.get("lines", [])
        for span in line.get("spans", [])
        if span.get("text", "").strip()
    ]
    text = "".join(span.get("text", "") for span in spans).strip()
    return text, spans


def classify_category(title: str, section: str) -> str:
    t = title.lower()
    if section == "RAG篇" or any(k in t for k in ("rag", "embedding", "rerank", "向量", "chunk", "hnsw", "ivf", "faiss", "ann", "召回")):
        return "RAG 与向量检索"
    if section == "IDE篇" or any(k in t for k in ("claude code", "claudecode", "codex", "cursor", "openclaw", "queryengine", "queryloop", "microcompact", "grep")):
        return "Coding Agent 与 IDE"
    if any(k in t for k in ("memory", "记忆", "上下文", "context")):
        return "Memory 与 Context Engineering"
    if any(k in t for k in ("mcp", "tool calling", "function calling", "function call", "skill", "cli", "hook", "plugin", "a2a", "工具调用")):
        return "工具调用与能力接入"
    if section == "系统篇" or any(k in t for k in ("mysql", "redis", "多进程", "多线程", "异步", "async", "sse", "websocket", "缓存", "布隆", "数据库", "索引", "高并发", "弹性伸缩")):
        return "系统基础与后端工程"
    if section == "框架篇" or any(k in t for k in ("langchain", "langgraph", "harness", "graph engineering", "loop engineering", "checkpoint", "框架")):
        return "框架与运行时架构"
    if section == "策略篇" or any(k in t for k in ("评估", "judge", "badcase", "幻觉", "路径震荡", "超时", "失败", "冲突", "成功率", "a/b test", "ab test", "优化")):
        return "可靠性、评估与安全"
    if section == "场景题" or any(k in t for k in ("设计一个", "智能客服", "新闻推荐", "可中断", "系统架构")):
        return "综合系统设计与场景题"
    if section == "开放题" or any(k in t for k in ("未来", "使用心得", "瓶颈", "难点", "发展", "谈谈", "怎么看待")):
        return "开放题与个人观点"
    return "Agent 基础与推理机制"


def classify_type(title: str) -> str:
    t = title.lower()
    if any(k in t for k in ("区别", "对比", "选型", "vs", "和什么不同")):
        return "comparison"
    if any(k in t for k in ("设计一个", "如何设计", "搭建", "系统架构")):
        return "system-design"
    if any(k in t for k in ("怎么办", "怎么解决", "如何优化", "优化", "失败", "冲突", "异常", "成功率", "延迟", "如何保证")):
        return "troubleshooting"
    if any(k in t for k in ("流程", "原理", "机制", "怎么实现", "如何实现", "怎么触发", "如何工作", "具体实现")):
        return "mechanism"
    if any(k in t for k in ("未来", "心得", "瓶颈", "难点", "谈谈", "怎么看", "你认为", "你的理解")):
        return "opinion"
    return "concept"


def thinking_path(question_type: str, category: str) -> list[dict[str, str]]:
    domain = {
        "RAG 与向量检索": "沿着文档处理、向量化、召回、精排、生成和评估这条链路分析。",
        "工具调用与能力接入": "区分模型侧的工具决策、Runtime 执行、结果回传和权限控制。",
        "Memory 与 Context Engineering": "先区分上下文、任务状态和长期记忆，再分析写入、召回、更新与压缩。",
        "系统基础与后端工程": "从底层机制出发，结合负载、资源瓶颈、一致性和故障边界说明。",
        "框架与运行时架构": "先定位框架层次，再解释状态、控制流、执行循环和恢复机制。",
        "Coding Agent 与 IDE": "从产品定位、工具链、上下文管理和执行运行时还原实现。",
        "可靠性、评估与安全": "先定位问题发生在哪一层，再用可观测指标验证修复是否有效。",
        "综合系统设计与场景题": "先明确业务目标和约束，再从架构、数据流、可靠性和评估展开。",
        "开放题与个人观点": "观点必须有技术依据和真实使用经验支撑，同时说明边界和不确定性。",
    }.get(category, "先建立概念边界，再解释 Agent 的目标、决策、执行和反馈闭环。")

    templates = {
        "concept": [
            ("先给出定义", "用一两句话说明概念本身，先把它与相近概念区分开。"),
            ("说明解决的问题", "解释为什么需要它，以及它弥补了传统方案的什么不足。"),
            ("拆解核心组成", "按职责说明关键模块，避免只罗列术语。"),
            ("补充运行例子", "用一个具体任务串起各模块如何协作。"),
            ("说明边界与取舍", "指出适用场景、局限和容易混淆的概念。"),
        ],
        "mechanism": [
            ("明确输入与目标", "先说明机制接收什么信息，最终要完成什么。"),
            ("列出参与模块", "说明模型、Runtime、工具、状态或数据存储分别承担什么职责。"),
            ("按时间顺序讲流程", "从请求进入开始，依次说明决策、执行、反馈和下一轮处理。"),
            ("解释关键底层机制", "讲清协议、算法、数据结构或状态转换，而不是只描述表面现象。"),
            ("补充异常分支", "说明超时、无效结果、重试、终止和恢复如何处理。"),
        ],
        "comparison": [
            ("分别定义与定位", "先讲清 A 和 B 各自处于哪一层、解决什么问题。"),
            ("确定比较维度", "从原理、职责、数据流、性能、成本和可控性等维度比较。"),
            ("分析优缺点", "解释优势背后的代价，不把单一指标当成绝对结论。"),
            ("匹配使用场景", "分别说明什么情况下更适合 A、什么情况下更适合 B。"),
            ("给出组合或选型结论", "如果两者可以组合，要说明组合方式；最后给出选择依据。"),
        ],
        "troubleshooting": [
            ("界定现象与影响", "先说明问题表现、发生条件，以及影响的是准确率、延迟、成本还是成功率。"),
            ("沿链路定位", "按模型、Prompt、检索、工具、编排、存储和网络等层次逐步排查。"),
            ("归纳根因", "区分数据问题、决策问题、执行问题和系统资源问题，避免先入为主。"),
            ("分层提出修复", "把模型策略、代码控制、基础设施和人工兜底分开说明。"),
            ("用指标验证", "通过日志、Trace、回归集和线上指标确认问题确实改善。"),
        ],
        "system-design": [
            ("澄清需求与约束", "确认用户、核心任务、规模、延迟、成本、权限和合规要求。"),
            ("画出整体架构", "说明入口、编排器、模型、知识库、工具、状态存储和观测模块。"),
            ("讲清核心数据流", "从请求进入到结果返回，按顺序解释每个组件的输入输出。"),
            ("设计状态与数据", "说明会话、任务状态、业务数据和长期记忆如何分开管理。"),
            ("补充可靠性与安全", "考虑超时、重试、幂等、权限、审计、人工介入和降级。"),
            ("定义评估指标", "同时衡量任务成功率、质量、延迟、成本和稳定性。"),
        ],
        "opinion": [
            ("先给明确观点", "直接表达判断，不用空泛的行业套话开场。"),
            ("给出技术依据", "用架构、模型能力、工具可靠性或工程约束解释观点。"),
            ("结合实际案例", "用真实使用或项目经验支撑，明确哪些是亲自验证的。"),
            ("承认局限与反例", "说明当前方案不适用的情况，以及仍未解决的问题。"),
            ("给出审慎判断", "总结短期趋势和长期方向，区分事实与预测。"),
        ],
    }
    result = [{"heading": h, "detail": d} for h, d in templates.get(question_type, templates["concept"])]
    result.insert(0, {"heading": "先确定这道题的切入点", "detail": domain})
    return result


def prerequisites(category: str) -> list[str]:
    mapping = {
        "Agent 基础与推理机制": ["大语言模型基础", "Prompt Engineering", "Agent Loop"],
        "工具调用与能力接入": ["Agent 架构", "Function Calling", "工具执行与权限"],
        "Memory 与 Context Engineering": ["Transformer 与 Context Window", "RAG 基础", "Agent 状态管理"],
        "RAG 与向量检索": ["Embedding", "向量相似度", "检索与排序"],
        "框架与运行时架构": ["Agent Loop", "状态机", "Checkpoint"],
        "系统基础与后端工程": ["操作系统基础", "网络通信", "数据库与缓存"],
        "可靠性、评估与安全": ["Agent 执行链路", "日志与 Trace", "评估指标"],
        "Coding Agent 与 IDE": ["Tool Calling", "Context Engineering", "代码检索"],
        "综合系统设计与场景题": ["Agent 架构", "RAG", "可靠性与评估"],
        "开放题与个人观点": ["Agent 基础", "实际项目经验"],
    }
    return mapping.get(category, ["Agent 基础"])


def tags_for(title: str, category: str) -> list[str]:
    terms = [
        "Agent", "LLM", "RAG", "MCP", "Function Calling", "Tool Calling",
        "ReAct", "Planning", "Memory", "Context", "Skill", "Harness",
        "LangGraph", "LangChain", "Claude Code", "Codex", "Redis", "MySQL",
        "Embedding", "Rerank", "HNSW", "IVF", "FAISS", "Multi-Agent",
        "Hook", "Async", "A2A", "OpenClaw",
    ]
    lower = title.lower()
    tags = [term for term in terms if term.lower() in lower]
    if category not in tags:
        tags.append(category)
    return tags[:8]


def extract_questions(pdf_path: Path, first_page: int, last_page: int) -> list[dict[str, Any]]:
    document = fitz.open(pdf_path)
    current_section = "基础篇"
    current: dict[str, Any] | None = None
    records: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        title = compact("".join(current["title_parts"]))
        answer = "\n\n".join(part.strip() for part in current["answer_parts"] if part.strip()).strip()
        if title and title not in SECTION_NAMES and "Agent面试八股" not in title:
            question_type = classify_type(title)
            category = classify_category(title, current["section"])
            digest = hashlib.sha1(f"{current['page']}|{title}".encode("utf-8")).hexdigest()[:12]
            records.append({
                "id": f"src-{digest}",
                "title": title,
                "question": title,
                "category": category,
                "sourceSection": current["section"],
                "sourcePage": current["page"],
                "questionType": question_type,
                "difficulty": "进阶" if question_type in ("mechanism", "troubleshooting", "system-design") else "基础",
                "tags": tags_for(title, category),
                "keyPoints": [],
                "thinkingPath": thinking_path(question_type, category),
                "answer": answer or "原始资料中未识别到对应答案。可以使用 AI 整理补全，或手动编辑。",
                "answerOrigin": "source" if answer else "draft",
                "sourceAnswer": answer,
                "followUps": [],
                "prerequisites": prerequisites(category),
                "relatedQuestions": [],
                "status": "new",
                "reviewCount": 0,
                "lastReviewedAt": None,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            })
        current = None

    for page_index in range(first_page - 1, min(last_page, len(document))):
        page = document[page_index]
        for block in page.get_text("dict", sort=True).get("blocks", []):
            if "lines" not in block:
                continue
            text, spans = block_text(block)
            if not text:
                continue
            sizes = [span.get("size", 0) for span in spans]
            all_bold = bool(spans) and all((span.get("flags", 0) & 16) and span.get("size", 0) >= 11.5 for span in spans)

            if all_bold and max(sizes, default=0) >= 15:
                flush()
                section = compact(text)
                if section in SECTION_NAMES:
                    current_section = section
                continue

            if "Agent面试八股" in text:
                continue

            if all_bold and 11.5 <= max(sizes, default=0) < 15:
                if current and current["answer_parts"]:
                    flush()
                if current is None:
                    current = {"title_parts": [text], "answer_parts": [], "page": page_index + 1, "section": current_section}
                else:
                    current["title_parts"].append(text)
                continue

            if current:
                # Drop small page-number spans and keep paragraph text in reading order.
                current["answer_parts"].append(text)

    flush()
    document.close()

    # Remove exact duplicate records while preserving the earliest source occurrence.
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in records:
        key = compact(item["title"]).casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--first-page", type=int, default=445)
    parser.add_argument("--last-page", type=int, default=515)
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "questions.json")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source PDF not found: {args.source}")
    records = extract_questions(args.source, args.first_page, args.last_page)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    with_answers = sum(1 for item in records if item["sourceAnswer"])
    print(json.dumps({
        "source": str(args.source),
        "pages": [args.first_page, args.last_page],
        "imported": len(records),
        "withSourceAnswers": with_answers,
        "draftAnswers": len(records) - with_answers,
        "output": str(args.output),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
