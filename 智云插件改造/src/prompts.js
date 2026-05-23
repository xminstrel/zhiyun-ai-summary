export const SUMMARY_MODES = {
  comprehensive: {
    label: "完整课堂总结",
    focus: "归纳课堂主线、知识点、重点难点、学习大纲、复习建议和待澄清问题。"
  },
  outline: {
    label: "学习大纲",
    focus: "整理成层级化学习大纲，突出章节关系、概念层次和先后顺序。"
  },
  keypoints: {
    label: "重点速记",
    focus: "提炼最重要的定义、结论、公式、例题思路、老师强调点和易错点。"
  },
  exam: {
    label: "考试复习",
    focus: "从考试复习角度整理高频考点、可能题型、答题框架和背诵清单。"
  }
}

export function buildSystemPrompt() {
  return [
    "你是一名严谨的大学课程学习助手。",
    "你的任务是把课堂语音识别文本整理成可复习、可执行、结构清晰的中文学习资料。",
    "语音识别文本可能包含口头语、错别字、重复句和断句错误。请在不编造事实的前提下做合理清洗。",
    "如果原文信息不足，请明确写出“需要回看确认”，不要伪造老师没有讲过的内容。",
    "输出使用 Markdown，标题层级清楚，尽量使用短句。"
  ].join("\n")
}

export function buildChunkPrompt({ title, sourceUrl, chunkIndex, chunkCount, transcript }) {
  return [
    `课程标题：${title || "未命名课程"}`,
    sourceUrl ? `来源页面：${sourceUrl}` : "",
    `当前文本分段：${chunkIndex + 1} / ${chunkCount}`,
    "",
    "请先对这一段课堂语音识别文本做局部整理，输出以下部分：",
    "",
    "## 本段主题",
    "## 本段知识点",
    "## 老师强调的重点",
    "## 例子、公式或操作步骤",
    "## 仍需回看确认的地方",
    "",
    "课堂语音识别文本如下：",
    "",
    transcript
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildFinalPrompt({ title, sourceUrl, mode, transcript, partialSummaries }) {
  const selected = SUMMARY_MODES[mode] || SUMMARY_MODES.comprehensive
  const content = partialSummaries?.length ? partialSummaries.join("\n\n---\n\n") : transcript

  return [
    `课程标题：${title || "未命名课程"}`,
    sourceUrl ? `来源页面：${sourceUrl}` : "",
    `整理模式：${selected.label}`,
    `整理重点：${selected.focus}`,
    "",
    "请把材料整理成一份完整学习资料，必须包含以下栏目：",
    "",
    `# ${title || "课堂学习总结"}`,
    "",
    "## 1. 课堂一句话概览",
    "用 1-3 句话说明这节课主要讲什么。",
    "",
    "## 2. 课程主线",
    "按老师讲解顺序整理课堂推进逻辑。",
    "",
    "## 3. 核心知识点",
    "用项目符号列出概念、定义、结论、公式、方法或操作流程。",
    "",
    "## 4. 重点与难点",
    "分别列出老师强调的重点、学生容易卡住的难点、易错点。",
    "",
    "## 5. 学习大纲",
    "整理成可复习的层级大纲。",
    "",
    "## 6. 复习与作业建议",
    "给出具体复习动作、练习方向和回看建议。",
    "",
    "## 7. 待确认问题",
    "只列出文本中不清楚、可能识别错误或需要回看视频确认的内容。",
    "",
    "材料如下：",
    "",
    content
  ]
    .filter(Boolean)
    .join("\n")
}
