"""
简历自动生成引擎 - 配置模块

说明：
- LLM 配置不再写死在代码里，改为从环境变量（由 Spring Boot 注入）或命令行参数读取：
    RESUME_LLM_API_KEY / RESUME_LLM_BASE_URL / RESUME_LLM_MODEL / RESUME_LLM_TEMPERATURE
- 参考素材目录从环境变量 REFERENCES_DIR 读取（由前端上传管理，默认 D:/qiuzhaohub/uploads/references）。
  若未配置或目录不存在，回退到本引擎内置的「参考素材」目录。
- PDF 中文渲染字体：优先使用系统中文字体（C:/Windows/Fonts），找不到再回退到内置字体。
"""

import os

# ============ 路径配置 ============
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 引擎内置的兜底参考素材目录（与代码同级）
DEFAULT_REF_DIR = os.path.join(BASE_DIR, "参考素材")
# 由前端/Spring Boot 管理的参考素材目录（最高优先级）
REFERENCES_DIR = os.environ.get("REFERENCES_DIR", r"D:\qiuzhaohub\uploads\references")
# 若环境变量目录不存在，回退到内置目录，保证可独立运行
if not os.path.isdir(REFERENCES_DIR):
    REFERENCES_DIR = DEFAULT_REF_DIR

# ============ LLM 配置（从环境变量 / 命令行读取，不写死） ============
def load_llm_config(override=None):
    """读取 LLM 配置。

    override: dict，可选，命令行/调用方传入的覆盖值（优先级最高）。
    环境变量：RESUME_LLM_API_KEY / RESUME_LLM_BASE_URL / RESUME_LLM_MODEL / RESUME_LLM_TEMPERATURE
    返回 dict，缺项以 None 表示（调用方据此判断是否需要走规则兜底）。
    """
    cfg = {
        "api_key": os.environ.get("RESUME_LLM_API_KEY"),
        "base_url": os.environ.get("RESUME_LLM_BASE_URL"),
        "model": os.environ.get("RESUME_LLM_MODEL"),
        "temperature": os.environ.get("RESUME_LLM_TEMPERATURE"),
        "max_tokens": int(os.environ.get("RESUME_LLM_MAX_TOKENS", "4000")),
    }
    # 类型转换
    if cfg["temperature"] is not None:
        try:
            cfg["temperature"] = float(cfg["temperature"])
        except ValueError:
            cfg["temperature"] = 0.3
    if override:
        for k, v in override.items():
            if v is not None:
                cfg[k] = v
    # override 可能传入字符串 temperature，需再次确保为 float
    if cfg["temperature"] is not None:
        try:
            cfg["temperature"] = float(cfg["temperature"])
        except (ValueError, TypeError):
            cfg["temperature"] = 0.3
    return cfg


# 兼容旧代码的 LLM_CONFIG 单例（默认从环境变量构造，可能为 None 项）
LLM_CONFIG = load_llm_config()

# ============ 中文字体 ============
# 优先系统中文字体；reportlab 需要 ttf/ttc 路径
def _find_font(candidates):
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

# 黑体（SimHei，无衬线，最稳）+ 微软雅黑（备选）
FONT_SIMHEI = _find_font([
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    os.path.join(BASE_DIR, "fonts", "simhei.ttf"),
])
# 若雅黑存在，可用于更细的正文渲染
FONT_MSYH = _find_font([
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simsun.ttc",
])

# ============ JD 关键词库（扩展版，保留原逻辑） ============
# 说明：同一技术词可能出现在多个分类中（如 视觉 在 cv 与 multimodal），
# 匹配阶段会对跨分类的重复词去重取最高权重，不会重复计分。
JD_TECH_KEYWORDS = {
    # Agent / 智能体相关
    "agent": [
        "agent", "agentscope", "langchain", "langgraph", "llamaindex", "llama-index",
        "autogen", "dify", "metagpt", "crewai", "multi-agent", "多智能体",
        "tool-calling", "tool calling", "function calling", "mcp", "agentic",
        "remanus", "manus", "autonomous", "ai agent", "智能体", "agent编排",
        "多agent", "工具调用", "记忆", "记忆系统", "上下文管理", "任务规划",
        "规划", "调度", "自主任务", "反思", "reflection", "react", "工作流编排",
    ],
    # RAG / 检索增强相关
    "rag": [
        "rag", "retrieval", "知识库", "knowledge base", "向量", "vector",
        "embedding", "召回", "rerank", "检索", "qdrant", "milvus",
        "elasticsearch", "向量化", "语义搜索", "语义检索", "重排", "语义切分",
        "rag系统", "rag链路",
    ],
    # 大模型 / LLM 相关
    "llm": [
        "llm", "gpt", "claude", "大模型", "大语言模型", "语言模型", "openai", "api",
        "fine-tun", "prompt", "token", "推理", "inference", "transformer",
        "预训练", "后训练", "rlhf", "sft", "对齐", "dpo", "post-training",
        "预训练语言模型", "流式", "sse", "长文本", "long context",
    ],
    # NLP 自然语言处理
    "nlp": [
        "nlp", "自然语言处理", "自然语言", "文本生成", "文本理解", "命名实体",
        "词向量", "序列标注", "bert", "语言模型", "tokenizer",
    ],
    # CV 计算机视觉
    "cv": [
        "cv", "计算机视觉", "视觉", "vision", "图像", "image", "图像识别",
        "目标检测", "视频", "video", "clip", "opencv",
    ],
    # 训练与推理系统（含后训练 / 对齐）
    "train_infer": [
        "训推", "训练", "推理引擎", "训练系统", "推理系统", "训推框架",
        "训推系统", "预训练", "后训练", "rl后训练", "强化学习",
        "训练加速", "推理加速", "模型训练", "模型推理",
        "训练框架", "推理框架", "分布式训练", "分布式推理", "后训练(post-training)",
        "对齐技术", "sft", "rlhf", "dpo",
    ],
    # 分布式与并行 / 高并发系统
    "distributed": [
        "分布式", "并行", "parallel", "distributed", "集群", "cluster",
        "多机", "多卡", "gpu", "cuda", "计算集群", "分布式计算",
        "分布式存储", "并行计算", "并行开发", "数据并行", "模型并行",
        "高并发", "高可用", "微服务", "消息队列", "异步调度", "缓存",
        "异步", "调度",
    ],
    # 编译与系统优化
    "compile_opt": [
        "编译", "compile", "优化", "optimization", "加速", "accelerat",
        "clang", "llvm", "ast", "编译器", "性能优化", "系统优化",
        "内存优化", "通信优化", "io优化", "软硬协同", "算子优化",
        "kernel", "cuda kernel", "图优化", "计算图", "缓存机制",
    ],
    # 多模态
    "multimodal": [
        "多模态", "multimodal", "视觉", "vision", "图像", "image",
        "语音", "audio", "视频", "video", "clip", "生成式",
        "diffusion", "stable diffusion", "文生图", "图生图",
    ],
    # 空间智能
    "spatial": [
        "空间智能", "3d", "三维", "cesium", "gis", "地理", "空间",
        "无人机", "uav", "遥感", "测绘", "slam", "点云",
    ],
    # 后端开发
    "backend": [
        "python", "fastapi", "flask", "django", "spring boot", "java",
        "go", "gin", "c++", "cpp", "c#", "后端", "backend", "api", "rest",
        "微服务", "服务化", "服务部署", "高并发", "高可用", "工程实践",
    ],
    # 前端开发
    "frontend": [
        "react", "vue", "typescript", "javascript", "前端", "frontend",
        "next.js", "tailwind", "html", "css",
    ],
    # 数据与存储
    "data": [
        "mysql", "postgresql", "redis", "mongodb", "数据库", "database",
        "sql", "消息队列", "kafka", "rabbitmq", "minio", "存储", "缓存",
        "elasticsearch",
    ],
    # DevOps / 可观测
    "devops": [
        "docker", "kubernetes", "k8s", "ci/cd", "deploy", "部署",
        "prometheus", "grafana", "监控", "linux", "可观测", "可观测性",
    ],
    # 推荐系统
    "recommendation": [
        "推荐", "recommendation", "推荐系统", "生成式推荐", "排序",
        "召回", "精排", "粗排", "特征工程",
    ],
    # 编程与算法 / 竞赛
    "coding": [
        "算法", "algorithm", "数据结构", "leetcode", "编程", "coding",
        "代码", "软件开发", "系统架构", "设计模式", "acm", "icpc",
        "kaggle", "天池", "算法竞赛", "竞赛", "acm/icpc",
    ],
    # AI 编程工具
    "ai_tools": [
        "cursor", "claude code", "copilot", "ai原生", "ai 原生", "ai编程",
        "ai-native", "代码大模型", "ai 编程工具",
    ],
    # 安全与防护（Agent 安全体系）
    "safety": [
        "沙箱", "意图识别", "输出过滤", "权限控制", "安全防护", "安全机制",
        "沙箱执行", "权限", "安全", "可控性",
    ],
    # 可观测与评估体系
    "observability": [
        "可观测", "可观测性", "评估体系", "成功率", "延迟", "token消耗",
        "监控", "评估", "评测", "业务转化率", "全链路", "评估可观测",
    ],
    # 产品 / 知识管理方向（产品知识智能化、知识运营类岗位）
    "product": [
        "axure", "mindmanager", "xmind", "figma", "sketch", "原型", "原型设计",
        "思维导图", "脑图", "产品设计", "产品方案", "产品规划", "产品运营",
        "需求拆解", "需求分析", "产品需求", "prd", "产品设计工具", "知识库",
        "知识图谱", "知识工程", "知识管理", "知识运营", "知识资产", "知识沉淀",
        "智能客服", "知识问答", "知识平台", "知识治理", "数据治理", "知识校验",
        "知识质检", "智能纠错", "问答推理", "语义理解", "检索增强", "知识检索",
        "知识结构化", "自动化知识", "知识采集", "知识加工", "知识分发",
        "知识平台", "大模型应用", "ai agent", "智能体", "产品设计",
        "用户研究", "交互设计", "信息架构", "业务拆解", "方案设计",
    ],
    # 嵌入式 / 工业软件 / Windows 客户端 / 产测（2026-08-24 增补，弥补"智能硬件产测"类 JD 漏抽）
    "embedded": [
        # 语言与库
        "c", "c++", "cpp", "stl", "mfc", "qt", "vc", "mfc/windows",
        # Windows 客户端与系统编程
        "windows", "windows客户端", "windows编程", "windows开发", "windows调试",
        "内存管理", "文件系统", "通信协议", "进程线程", "进程", "线程",
        "进程线程调度", "内存管理", "界面实现", "windows界面",
        # 运动控制 / 自动化
        "固高", "雷赛", "正运动", "运动控制卡", "运动控制", "二次开发",
        "伺服", "步进", "plc", "工控", "工业控制",
        # 产测 / 智能硬件
        "产测", "产测系统", "产测模块", "生产测试", "测试工位",
        "自动化测试", "自动化测试软件", "测试软件开发", "智能硬件", "硬件测试",
        "瓶颈工位", "效率提升", "工位设计",
        # 架构与方法论
        "模块化设计", "架构优化", "模块化", "架构设计",
    ],
}
