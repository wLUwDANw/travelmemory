"""六类语义标签的**唯一真相源**（阶段 7 W7-1 / W7-2 共用）。

## 为什么放在 `app/utils/` 而不是某个 service 里

依赖红线（PROJECT.md §二、[4]）：`agent → nodes → tools → services → models`。
语义词汇会被 `app/services/semantic_service.py`（抽取）与
`app/services/semantic_trajectory.py`（模式挖掘）**同时**用到，还可能被将来的
agent 工具引用。放在任一个 service 里都会让另一个反向依赖它 —— 那是红线禁止的方向。
`app/utils/` 是最底层的纯函数层，谁都可以向下依赖。

## 为什么是确定性规则而不是让 LLM 分类

1. **可复现**：同一条 POI 在 A 机器和 B 机器上必须得到同一个标签，否则两地的
   语义序列对不上，群体模式库就是噪声。LLM 做不到逐位一致。
2. **可审计**：规则表能直接读、能单测、能手工改一个词；LLM 的分类边界不可见。
3. **零成本**：语义抽取发生在导入链路里，每条照片/地点都调一次 LLM 是不可接受的。

## 平票时按 `SEMANTIC_TAGS` 顺序取

`SEMANTIC_TAGS` 的**顺序本身就是契约**：它与前端 `src/types/share.ts` 的 `ALL_TAGS`
逐项一致，而 `ALL_TAGS` 是 TrailShare 规范里"评分打平时谁在前面"的依据。
改顺序会让两端的推荐结果分叉，**只能追加，不能重排**。
"""

from __future__ import annotations

from collections.abc import Sequence

#: 六类语义标签。**顺序即平票排序依据**，与前端 `ALL_TAGS` 一致，禁止重排。
SEMANTIC_TAGS: tuple[str, ...] = (
    "heritage",
    "nature",
    "watertown",
    "metropolis",
    "food",
    "leisure",
)

SEMANTIC_TAG_LABELS: dict[str, str] = {
    "heritage": "人文历史",
    "nature": "自然风光",
    "watertown": "水乡古镇",
    "metropolis": "都市风光",
    "food": "美食探索",
    "leisure": "休闲度假",
}

#: 语义标签版本号。变更关键词表**必须**同步升它 —— 已落库的语义序列是按旧版抽的，
#: 拿新版规则去解释旧序列会得到错误的模式（设计文档 §12.2 `make resemantic` 的由来）。
SEMANTIC_TAG_VERSION = "sem-2026.1"

#: 关键词 → 语义标签。命中即计 1 票，多命中累加，平票按 `SEMANTIC_TAGS` 顺序取。
#:
#: 词表来源：设计文档 §9.1 的示例行程（龙门石窟→heritage、老君山→nature、
#: 拙政园/平江路→watertown、外滩/陆家嘴→metropolis），其余按同类常见 POI 补齐。
TAG_KEYWORDS: dict[str, tuple[str, ...]] = {
    "heritage": (
        "石窟", "寺庙", "寺院", "寺", "庙", "观", "庵", "遗址", "古迹", "文物",
        "博物馆", "博物院", "纪念馆", "故居", "陵园", "陵", "墓", "碑", "塔",
        "古城", "城楼", "城墙", "关隘", "宫殿", "王府", "书院", "教堂", "清真寺",
        "历史", "人文", "文化", "非遗", "民俗", "考古", "石窟寺", "造像",
        "科教文化服务", "文化场馆",
    ),
    "nature": (
        "山", "山峰", "峰", "岭", "谷", "峡谷", "湖", "海", "江", "河", "溪",
        "瀑", "瀑布", "森林", "林场", "草原", "草甸", "沙漠", "戈壁", "岛",
        "湿地", "公园", "地质公园", "国家公园", "自然", "风景", "名胜",
        "云海", "日出", "日落", "星空", "梯田", "花海", "竹海", "溶洞", "天池",
        "风景区", "风景名胜",
    ),
    "watertown": (
        "古镇", "古村", "水乡", "水镇", "乌镇", "西塘", "周庄", "同里", "南浔",
        "平江路", "山塘街", "拙政园", "留园", "网师园", "园林", "水巷", "弄堂",
        "巷", "运河", "码头", "拱桥", "石桥", "摇橹", "乌篷",
    ),
    "metropolis": (
        "外滩", "陆家嘴", "cbd", "商圈", "金融", "写字楼", "摩天", "天际线",
        "都市", "夜景", "广场", "步行街", "购物中心", "商场", "百货",
        "观景台", "电视塔", "观光塔", "地铁", "机场", "车站", "港区",
        "购物服务", "商务",
    ),
    "food": (
        "美食", "小吃", "餐厅", "饭店", "饭馆", "食街", "夜市", "菜市场",
        "茶楼", "茶馆", "咖啡", "烘焙", "甜品", "火锅", "烧烤", "海鲜",
        "米其林", "老字号", "特产", "农家菜", "大排档", "食堂",
        "餐饮服务", "饮食",
    ),
    "leisure": (
        "度假", "温泉", "spa", "汤泉", "高尔夫", "游乐场", "游乐园", "主题公园",
        "动物园", "海洋馆", "水族馆", "露营", "民宿", "农家乐", "休闲", "康养",
        "酒吧", "club", "ktv", "影院", "剧院", "演出", "滑雪", "潜水", "冲浪",
        "骑行", "徒步", "营地", "度假村", "体育休闲服务", "住宿服务",
    ),
}


def is_semantic_tag(value: str | None) -> bool:
    """是否是六类语义标签之一。"""
    return isinstance(value, str) and value in SEMANTIC_TAGS


def score_semantic_tags(*texts: str | None) -> dict[str, int]:
    """对若干段文本投票，返回每类的命中数（未命中的类不出现在字典里）。

    大小写不敏感（中英混排的 POI 名里英文很常见），同一个词在同一段文本里
    重复出现只算一次 —— 否则"山山山"这种噪声文本会把它自己刷成 nature。
    """
    scores: dict[str, int] = {}
    for raw in texts:
        if not raw:
            continue
        haystack = raw.lower()
        for tag, keywords in TAG_KEYWORDS.items():
            if any(keyword in haystack for keyword in keywords):
                scores[tag] = scores.get(tag, 0) + 1
    return scores


def pick_semantic_tag(scores: dict[str, int]) -> str | None:
    """按票数取标签；**平票按 `SEMANTIC_TAGS` 顺序**，保证跨设备一致。"""
    if not scores:
        return None
    best_tag = None
    best_score = -1
    for tag in SEMANTIC_TAGS:  # 顺序遍历 → 平票时靠前的赢
        score = scores.get(tag, 0)
        if score > best_score:
            best_score = score
            best_tag = tag
    return best_tag if best_score > 0 else None


def classify_semantic_tag(
    poi_type: str | None = None,
    ai_tags: Sequence[str] | None = None,
    name: str | None = None,
) -> str | None:
    """把具体的 `poi_type` / `ai_tags` / 地点名映射到六类语义标签。

    三类输入**等权**各计一票（不加权的原因：权重从哪来没有依据，拍脑袋的权重
    只会让"为什么这个石窟被分到 nature"变得更难解释）。全部无命中返回 `None` ——
    调用方决定是隐藏语义条还是退回默认，**本函数不做兜底猜测**：猜错的语义序列
    会污染整个群体模式库，而"没有语义"只是少一条数据。
    """
    scores = score_semantic_tags(poi_type, name)
    for tag_value in ai_tags or ():
        if not tag_value:
            continue
        # ai_tags 是列表：逐项各投一票，比拼成一个大字符串更能体现"命中了几类"
        for tag, keywords in TAG_KEYWORDS.items():
            haystack = tag_value.lower()
            if any(keyword in haystack for keyword in keywords):
                scores[tag] = scores.get(tag, 0) + 1
    return pick_semantic_tag(scores)
