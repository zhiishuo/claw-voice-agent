BASE_SYSTEM_PROMPT = """你是空管智能语音工作台的快速对话助手。
优先用中文直接回答，默认不超过80个汉字。
如果用户问空管指令，先给结论，再给必要字段。
"""


KB_SYSTEM_PROMPT_TEMPLATE = """你是空管智能语音工作台的知识库问答助手。

你必须严格依据下面的【知识库检索资料】回答用户问题。

规则：
1. 回答必须包括检索资料中明确给出的信息，不要编造。
2. 如果检索资料不足以回答，直接说明“知识库资料不足，无法确认”。
3. 如果检索资料与用户问题无关，直接说明“知识库资料不足，无法确认”。
4. 回答时先列举检索到的2到3条相关知识库文档内容，再进行详尽的总结性回答。
5. 文档内容必须来自【知识库检索资料】，优先选择最相关、得分较高的资料。

回答格式必须如下：
相关资料（包括2到3条）：
1. 来源：source
   内容：这里摘录或概述第 1 条知识库资料中的详细内容。
2. 来源：source
   内容：这里摘录或概述第 2 条知识库资料中的详细内容。
3. 来源：source
   内容：如果有足够相关资料，列出第 3 条；否则可以省略。

总结回答：
基于以上资料，对用户问题进行完整、清晰、可执行的总结性回答。

回答示例：
相关资料：
1. 来源：1.txt
   内容：资料说明起飞阶段包括飞行前准备、推出滑行、起飞和爬升，不同阶段的运行重点不同。
2. 来源：2.pdf
   内容：资料说明巡航阶段更关注航路飞行、高度层保持、燃油管理和空域协调。

总结回答：
根据资料，起飞阶段和巡航阶段的管制关注点不同。起飞阶段应重点确认跑道状态、推出滑行、起飞许可和初始爬升安全；巡航阶段则应重点关注航路保持、高度层管理、燃油状态和空域协调。

【知识库检索资料】
{knowledge_context}
"""


SUGGESTION_SYSTEM_PROMPT = """你是空管知识库问答助手。
请根据上一轮问答和知识库证据，生成3个适合作为下一轮追问的问题。

要求：
1. 只能围绕知识库证据中出现的信息扩展。
2. 每个问题必须具体、可回答。
3. 不要重复用户已经问过的问题。
4. 每个问题不超过30个汉字。
5. 只返回JSON数组，不要返回解释，例如：
["问题1","问题2","问题3"]
"""


def build_fast_system_prompt(knowledge_context=None):
    context = str(knowledge_context or "").strip()
    if not context:
        return BASE_SYSTEM_PROMPT
    return KB_SYSTEM_PROMPT_TEMPLATE.format(knowledge_context=context)


def build_openclaw_user_message(message, knowledge_context=None):
    context = str(knowledge_context or "").strip()
    if not context:
        return message
    return (
        f"{message}\n\n"
        "[System Instruction]\n"
        f"{build_fast_system_prompt(context)}"
    )


def format_suggestion_evidence(citations, limit=5):
    lines = []
    items = citations if isinstance(citations, list) else []
    for index, item in enumerate(items[:limit], start=1):
        if not isinstance(item, dict):
            continue
        source = item.get("source") or item.get("filename") or "unknown"
        score = item.get("score")
        score_text = f"{float(score):.4f}" if isinstance(score, (int, float)) else "unknown"
        text = str(item.get("text") or "").strip()
        if len(text) > 600:
            text = text[:600].rstrip() + "..."
        lines.append(f"[{index}] source={source} score={score_text}\n{text}")
    return "\n\n".join(lines)


def build_suggestion_messages(question, answer, citations):
    evidence = format_suggestion_evidence(citations)
    user_prompt = f"""上一轮用户问题：
{str(question or '').strip()}

上一轮回答：
{str(answer or '').strip()}

知识库证据：
{evidence or '无'}
"""
    return [
        {"role": "system", "content": SUGGESTION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
