/**
 * @layer Domain —— 垂类钓鱼知识库规则表（哪钓专业化 QY-SPOT-003 / 004 / 011）
 * @file api/knowledge/fishingRules.ts
 *
 * 设计原则：专业结论由**规则库**保证正确性，模型只负责「看图提取特征 + 叙述规则库结论」，
 * 这样修错不必重训模型，知识可人工审定、可热更。
 *
 * 检索零 token 成本：Step 2 完全在本地按维度打分（鱼种 > 季节 > 水型 > 流态 > 水色 > 结构 > 水温 > 时段）。
 * 未达最低命中分时返回 matched 空数组，调用方必须降级为通用建议，**不得编造具体线号/钩型**。
 *
 * 热更（QY-SPOT-011）：沿用 contentFilter 的 mtime 模式 —— env FISH_KNOWLEDGE_FILE 指向 JSON 数组，
 * stat 比对 mtime 变化则重读；读取/解析/校验失败保留旧表（可用性优先）。
 */

export type Season = "春" | "夏" | "秋" | "冬";
export type TimeOfDay = "晨" | "午" | "昏" | "夜";
export type Clarity = "清澈" | "中等" | "浑浊" | "肥水";
export type Flow = "静水" | "缓流" | "急流";

/** 规则表涉及的主流水域类型（覆盖率口径以此为准） */
export const MAIN_WATER_TYPES = ["湖泊", "河流", "水库", "野塘"] as const;
/** 规则表覆盖的主流鱼种（覆盖率/命中率口径以此为准） */
export const MAIN_FISH = ["鲫鱼", "鲤鱼", "草鱼", "青鱼", "鳊鱼", "翘嘴", "鲢鱼", "鳙鱼", "鲶鱼", "鳜鱼"] as const;

export interface RigAdvice {
  /** 钓法（含线组形式/钓层） */
  method: string;
  /** 线号：主线/子线 */
  lineSpec: string;
  /** 钩型与号数 */
  hookSpec: string;
  /** 调漂（含钓目/抓口） */
  floatSetup: string;
  /** 铅坠与配重 */
  sinkerSpec: string;
  /** 饵料（钓饵） */
  bait: string;
  /** 打窝/诱饵策略 */
  nest: string;
  /** 选位与作钓策略 */
  strategy: string;
  /** 时段建议（可选，缺省由模型按时段字段叙述） */
  timeNote?: string;
}

export interface FishingRule {
  /** 稳定编号，形如 R-JI-冬-静 */
  id: string;
  /** 目标鱼种；"*" 表示不限鱼种的结构性规则 */
  fish: string;
  seasons: Season[];
  /** 适用水体类型；命中要求规则数组包含查询水型 */
  waterTypes: string[];
  /** 流态偏好（缺省=不限） */
  flows?: Flow[];
  /** 水色/透明度偏好（缺省=不限） */
  clarity?: Clarity[];
  /** 需要观察到的岸边/水底结构（任一命中即加分） */
  structures?: string[];
  /** 水温适用区间 ℃（缺省=不限） */
  tempRange?: [number, number];
  /** 时段偏好（缺省=不限） */
  times?: TimeOfDay[];
  advice: RigAdvice;
  /** 规则来源与审定状态：初稿由公开资料整理，需钓手/产品审定后置 approved */
  reviewStatus: "draft" | "approved";
  source: string;
}

/** 鱼种别名归一：模型/用户写法五花八门，规则表只用标准名 */
const FISH_ALIASES: Record<string, string[]> = {
  鲫鱼: ["鲫", "草鲫", "土鲫", "月鲫", "大鲫"],
  鲤鱼: ["鲤", "黄河鲤", "镜鲤", "三道鳞", "大鲤"],
  草鱼: ["草", "鲩", "草鲩", "厚子"],
  青鱼: ["青", "黑鲩", "螺蛳青"],
  鳊鱼: ["鳊", "武昌鱼", "三角鳊", "鳊花"],
  翘嘴: ["翘", "翘嘴鲌", "白鱼", "大白条", "餐条"],
  鲢鱼: ["鲢", "白鲢", "鲢子"],
  鳙鱼: ["鳙", "花鲢", "胖头鱼", "包头鱼", "大头鱼"],
  鲢鳙: ["鲢鳙"],
  鲈鱼: ["鲈", "加州鲈", "大口黑鲈", "Micropterus"],
  鲶鱼: ["鲶", "塘鲺", "土鲶", "胡子鲶"],
  鳜鱼: ["鳜", "桂鱼", "季花"],
  罗非鱼: ["罗非", "非洲鲫", "福寿鱼", "Tilapia"],
  黄颡鱼: ["黄颡", "黄辣丁", "嘎鱼", "昂刺", "昂公", "黄鸭叫"],
  白条: ["白条", "餐", "小白条"],
  黑鱼: ["黑鱼", "乌鳢", "生鱼", "财鱼", "蛇头鱼", "孝鱼", "火头"],
  麦穗鱼: ["麦穗", "麦穗鱼", "食蚊鱼"],
  鲻鱼: ["鲻", "乌头", "梭鱼"],
};

/** 归一鱼种名；无法识别返回原串（去空格） */
export function normalizeFish(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return raw;
  for (const [std, aliases] of Object.entries(FISH_ALIASES)) {
    if (std === raw || aliases.includes(raw)) return std;
    for (const a of aliases) if (raw.includes(a) && a.length >= 2) return std;
  }
  for (const [std, aliases] of Object.entries(FISH_ALIASES)) {
    for (const a of aliases) if (raw.includes(a) && a.length === 1 && raw.length <= 3) return std;
  }
  return raw;
}

/** 水型归一：模型常输出「天然湖泊」「山塘」之类，规则表只用 湖泊/河流/水库/野塘/沟渠/黑坑 */
export function normalizeWaterType(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return t;
  if (t.includes("湖")) return "湖泊";
  if (t.includes("水库")) return "水库";
  if (t.includes("河") || t.includes("江") || t.includes("渠") && !t.includes("野塘")) return t.includes("沟") ? "沟渠" : "河流";
  if (t.includes("沟") || t.includes("渠")) return "沟渠";
  if (t.includes("塘") || t.includes("堰") || t.includes("泡") || t.includes("淀")) return t.includes("野") || t.includes("山") ? "野塘" : "野塘";
  if (t.includes("坑") || t.includes("养殖")) return "黑坑";
  return t;
}

/** 月份 → 季节（用户不填时自动推断，允许覆盖） */
export function seasonFromMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "春";
  if (month >= 6 && month <= 8) return "夏";
  if (month >= 9 && month <= 11) return "秋";
  return "冬";
}

/** 时刻 → 时段 */
export function timeOfDayFromHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 10) return "晨";
  if (hour >= 10 && hour < 16) return "午";
  if (hour >= 16 && hour < 20) return "昏";
  return "夜";
}

/** 无实测水温时按季节 + 气温粗估（保守区间，仅供规则打分） */
export function estimateWaterTempC(season: Season, airTempC?: number): number | undefined {
  if (typeof airTempC === "number" && Number.isFinite(airTempC)) {
    // 水体滞后于气温：夏季水温略低于气温，冬季略高于气温
    const delta = season === "夏" ? -4 : season === "冬" ? 2 : -1;
    return Math.round(airTempC + delta);
  }
  const base: Record<Season, number> = { 春: 14, 夏: 26, 秋: 18, 冬: 7 };
  return base[season];
}

// ─────────────────────────────────────────────────────────────────────────────
// 内置规则表（初稿：按公开垂钓资料整理，reviewStatus=draft 待钓手/产品审定）
// 维度组合口径：鱼种 × 季节 × 水型 × 流态 × 水色 × 结构 × 水温
// ─────────────────────────────────────────────────────────────────────────────
const STILL: Flow[] = ["静水"];
const FLOW_SLOW: Flow[] = ["缓流", "急流"];

export const BUILTIN_RULES: FishingRule[] = [
  // ===== 鲫鱼：四季主力，细线小钩轻漂，随水温换饵 =====
  {
    id: "R-JI-春-静", fish: "鲫鱼", seasons: ["春"], waterTypes: ["湖泊", "水库", "野塘", "沟渠"], flows: STILL,
    tempRange: [10, 20], structures: ["水草区", "深浅交界", "湾汊"],
    advice: {
      method: "台钓底钓为主，早晚钓浅滩、午间退深水；荤素切换",
      lineSpec: "主线 0.8～1.0 号，子线 0.4～0.6 号",
      hookSpec: "袖钩 3～4 号（钩条细、自重轻）",
      floatSetup: "调 4～5 目钓 2 目，抓顶漂与连续小顿口",
      sinkerSpec: "细身铅 0.8～1.2 克，离底 5～10 cm 找鱼层",
      bait: "红虫/蚯蚓优先，商品饵腥香（拉饵）",
      nest: "酒米 + 少量腥粉小窝，20～30 克起窝，勤补少补",
      strategy: "选背风向阳 浅水湾汊与水草边缘，先浅后深；保持安静少换饵",
      timeNote: "上午 09:00–11:30、下午 15:00–18:00 口最好",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-春-流", fish: "鲫鱼", seasons: ["春"], waterTypes: ["河流", "沟渠"], flows: FLOW_SLOW,
    tempRange: [10, 22],
    advice: {
      method: "跑铅/铅坠到底，缓流边钓边等；急流只找回水湾",
      lineSpec: "主线 1.0～1.2 号，子线 0.6 号（缩短至 10～12 cm）",
      hookSpec: "袖钩 4 号或溪流钩 2～3 号",
      floatSetup: "调平水钓 2～3 目，铅坠滑跑，看漂尾走位与黑漂",
      sinkerSpec: "跑铅 1.5～2.5 克，按流速增减",
      bait: "蚯蚓/麦粒，耐冲刷",
      nest: "少打或不打窝，靠流水自然带饵",
      strategy: "站住回水湾、汊口、桥墩下游缓流区；抛上游让饵漂进钓点",
      timeNote: "晨昏为主，夜间流水区常有大鲫",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-夏-静", fish: "鲫鱼", seasons: ["夏"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [22, 32], clarity: ["清澈", "中等", "肥水"],
    advice: {
      method: "钓阴钓深钓草边，早晚下竿、正午收竿或改夜钓",
      lineSpec: "主线 0.8～1.0 号，子线 0.4～0.6 号",
      hookSpec: "袖钩 3～4 号",
      floatSetup: "调 5 钓 2 或调 3 钓 3，避小鱼则钓顿",
      sinkerSpec: "细身铅 0.8～1.0 克",
      bait: "清香/本味、发酵麦粒、米饭粒，避腥招小鱼",
      nest: "素窝为主（底窝米 + 少量商品饵），忌高腥闹窝",
      strategy: "找水草明暗交界、树荫下、进水口溶氧高处；水深 1.5～2.5 m",
      timeNote: "05:00–09:00、17:30–21:00 或通宵夜钓",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-夏-流", fish: "鲫鱼", seasons: ["夏"], waterTypes: ["河流"], flows: FLOW_SLOW,
    advice: {
      method: "跑铅找缓流边，专攻溶氧高的进水口两侧",
      lineSpec: "主线 1.0～1.5 号，子线 0.6～0.8 号",
      hookSpec: "溪流钩 2～3 号",
      floatSetup: "调平水钓 2 目，重铅触底",
      sinkerSpec: "跑铅 2～3 克",
      bait: "蚯蚓、玉米粒",
      nest: "不打窝或打薄窝，流水不留窝",
      strategy: "进水口、闸口下游、水草滞留带；避主航道急流",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-秋-静", fish: "鲫鱼", seasons: ["秋"], waterTypes: ["湖泊", "水库", "野塘", "沟渠"], flows: STILL,
    tempRange: [12, 25],
    advice: {
      method: "初秋续夏季钓法，深秋转钓深钓阳、荤饵过渡",
      lineSpec: "主线 0.8～1.2 号，子线 0.4～0.8 号",
      hookSpec: "袖钩 3～5 号（深秋可放大一号搏大鲫）",
      floatSetup: "初秋调 4 钓 2，深秋调 3 钓 2 抓稳口",
      sinkerSpec: "常规水滴铅 1.0～1.5 克",
      bait: "初秋清香、深秋腥香/红虫过渡",
      nest: "酒米 + 腥香底窝，早秋少、深秋多（鱼需囤食）",
      strategy: "找深浅交界与铧尖侧湾，秋季鱼沿坎巡游明显；风向转变前后抢钓",
      timeNote: "全天可钓，午间亦开口",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-秋-流", fish: "鲫鱼", seasons: ["秋"], waterTypes: ["河流"], flows: FLOW_SLOW,
    advice: {
      method: "走钓与守钓结合，铅坠到底抓黑漂",
      lineSpec: "主线 1.2 号，子线 0.6～0.8 号",
      hookSpec: "溪流钩/袖钩 4～5 号",
      floatSetup: "调平水钓 2～4 目",
      sinkerSpec: "跑铅 2～3 克",
      bait: "蚯蚓、麦粒、玉米",
      nest: "少量颗粒窝在缓流角",
      strategy: "秋汛后水回落处的深坑与洄湾",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-冬-静", fish: "鲫鱼", seasons: ["冬"], waterTypes: ["湖泊", "水库", "野塘", "沟渠"], flows: STILL,
    tempRange: [1, 12], clarity: ["清澈", "中等"],
    advice: {
      method: "传统钓/台钓细小线组，深水区底钓，主逗钓",
      lineSpec: "主线 0.6～0.8 号，子线 0.3～0.4 号",
      hookSpec: "袖钩 2～3 号（细条轻钩，冬季口轻）",
      floatSetup: "调平水钓 1～2 目，抓漂尾上顶 1 目的轻口",
      sinkerSpec: "细身铅/咬铅 0.5～0.8 克，减少吸饵阻力",
      bait: "红虫、蚯蚓等活饵优先，商品饵浓腥打窝不钓窝",
      nest: "酒米小窝 20～30 克，冬季忌大窝死窝",
      strategy: "背风向阳、水深 2～3.5 m 的草洞/水底坎；多点布窝轮钓，动作轻",
      timeNote: "午间 11:00–15:00 水温最高时段最好",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-冬-浑", fish: "鲫鱼", seasons: ["冬"], waterTypes: ["野塘", "沟渠", "河流"], clarity: ["浑浊", "肥水"],
    advice: {
      method: "底钓为主，饵近水底、动饵诱鱼",
      lineSpec: "主线 0.8 号，子线 0.4 号",
      hookSpec: "袖钩 3 号",
      floatSetup: "调低钓高（调 1 钓 3），钝中抓顶",
      sinkerSpec: "铅 0.8～1.0 克触底",
      bait: "活饵（红虫/蚯蚓）为主，浑水靠味型与动态",
      nest: "少打浓腥小窝",
      strategy: "浑水鱼警惕低，可靠近岸与进水口浅区；找避风向阳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鲤鱼：唇须拱泥，重窝大钩守钓 =====
  {
    id: "R-LI-春-静", fish: "鲤鱼", seasons: ["春"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [12, 22],
    advice: {
      method: "台钓大线组底钓守钓，钓缓坡深浅交界；鲤鱼产卵前靠边",
      lineSpec: "主线 2.0～3.0 号，子线 1.0～1.5 号（可加长至 25～30 cm）",
      hookSpec: "伊势尼 5～7 号或新关东 0.5～0.8",
      floatSetup: "调低钓高（调 2 钓 4～6），抓黑漂与大幅移漂",
      sinkerSpec: "大铅 2～3 克，可跑铅减阻力",
      bait: "薯香/玉米/发酵杂粮，商品饵甜香",
      nest: "重窝：颗粒 + 老坛玉米 + 底窝料 0.5～1 kg，提前 1～2 天养窝",
      strategy: "选水库湾汊缓坡、水底坎、淤泥拱食区；中鱼后用长线慢遛",
      timeNote: "夜钓与晨昏更稳，鲤鱼怕强光",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LI-夏-静", fish: "鲤鱼", seasons: ["夏"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [22, 32],
    advice: {
      method: "夜钓守深水，或雨后涨水钓进水口",
      lineSpec: "主线 2.5～3.5 号，子线 1.2～1.5 号",
      hookSpec: "伊势尼 6～8 号",
      floatSetup: "调 2 钓 4，抓黑漂、移漂",
      sinkerSpec: "铅 2.5～3.5 克",
      bait: "老坛玉米、薯味、发酵饵，避小非",
      nest: "重窝少补，玉米 1～2 kg 打底",
      strategy: "找深浅交界与铧尖深水侧；闷热天靠溶氧（进水口、下风）",
      timeNote: "19:00–02:00 为黄金段",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LI-夏-流", fish: "鲤鱼", seasons: ["夏"], waterTypes: ["河流", "沟渠"], flows: FLOW_SLOW,
    advice: {
      method: "跑铅重坠到底，专攻涨水后的缓流深坑",
      lineSpec: "主线 3.0～4.0 号，子线 1.5 号短子线",
      hookSpec: "伊势尼 7～9 号",
      floatSetup: "调平水钓 3～5 目或直接看竿稍",
      sinkerSpec: "跑铅 4～6 克防冲底",
      bait: "玉米、蚯蚓捆、薯饵",
      nest: "石笼/黏土裹窝投于缓流角",
      strategy: "涨水浑流靠边，退水找深坑；闸口下游两侧",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LI-秋-静", fish: "鲤鱼", seasons: ["秋"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [12, 25],
    advice: {
      method: "全天守钓，仲秋可钓半水截食，深秋回归底钓",
      lineSpec: "主线 2.5～3.5 号，子线 1.2～2.0 号",
      hookSpec: "伊势尼 6～8 号",
      floatSetup: "调 3 钓 3～5，抓沉稳的黑漂",
      sinkerSpec: "铅 2.5～4 克",
      bait: "高糖高淀粉（玉米、红薯块、颗粒）",
      nest: "重窝囤食期可加倍，颗粒为主",
      strategy: "深秋鱼群向深水迁移，找 3～5 m 深的大水面坎位",
      timeNote: "全天，午间亦中大鲤",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LI-秋-流", fish: "鲤鱼", seasons: ["秋"], waterTypes: ["河流"], flows: FLOW_SLOW,
    advice: {
      method: "重铅守深潭，秋汛后靠边",
      lineSpec: "主线 3.5～4.0 号，子线 1.5～2.0 号",
      hookSpec: "伊势尼 8～9 号",
      floatSetup: "调平水钓 4 目或无漂看竿稍",
      sinkerSpec: "重铅 5～8 克",
      bait: "玉米捆、大蚯蚓、发酵粮",
      nest: "黏土包窝投定点",
      strategy: "深潭、桥墩下游、老河道弯",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LI-冬-静", fish: "鲤鱼", seasons: ["冬"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [2, 12],
    advice: {
      method: "深水底钓守钓为主，冬季鲤鱼群聚深水区少动",
      lineSpec: "主线 1.5～2.5 号，子线 1.0～1.2 号",
      hookSpec: "伊势尼 4～6 号（口轻可减号）",
      floatSetup: "调 2 钓 3 抓小顿口，或调平水钓 2 目",
      sinkerSpec: "铅 1.5～2.5 克",
      bait: "浓腥小饵或红虫捆，玉米改用细颗粒",
      nest: "小窝勤补（冬季不宜重窝），100～200 克起",
      strategy: "找深水最稳的坑底与向阳深坎，耐心久守，一个钓位一整天",
      timeNote: "午间 11:00–15:00",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LI-冬-流", fish: "鲤鱼", seasons: ["冬"], waterTypes: ["河流"], flows: FLOW_SLOW,
    advice: {
      method: "深潭守钓，重铅到底看竿稍",
      lineSpec: "主线 2.5～3.0 号，子线 1.2 号",
      hookSpec: "伊势尼 5～7 号",
      floatSetup: "调平水钓 3～5 目",
      sinkerSpec: "跑铅 4～5 克",
      bait: "红虫捆、蚯蚓、少量玉米",
      nest: "定点小窝",
      strategy: "电站/工厂排水暖水区、深潭回湾",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 草鱼：高温素食、中上层与草边 =====
  {
    id: "R-CAO-春-静", fish: "草鱼", seasons: ["春"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [15, 24],
    advice: {
      method: "底钓与浮钓结合，水温回升后逐层上找",
      lineSpec: "主线 2.0～3.0 号，子线 1.2～1.5 号",
      hookSpec: "伊势尼 6～7 号或草鱼钩 4～5 号",
      floatSetup: "调 5 钓 3，抓大弯弯与连续上顶",
      sinkerSpec: "铅 2～3 克",
      bait: "嫩苇芯、商品饵草香、桑葚",
      nest: "青草/芦苇捆 + 颗粒养窝",
      strategy: "浅滩升温处长草区、芦苇边",
      timeNote: "午间水温高时最好",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-CAO-夏-静", fish: "草鱼", seasons: ["夏"], waterTypes: ["湖泊", "水库", "野塘", "沟渠"], flows: STILL,
    tempRange: [24, 34], clarity: ["清澈", "中等", "肥水"],
    advice: {
      method: "半水浮钓/钓草洞，草边下竿；可挂草捆做窝",
      lineSpec: "主线 2.5～3.5 号，子线 1.5～2.0 号",
      hookSpec: "伊势尼 7～8 号（钩条粗抗拉）",
      floatSetup: "调满铅钓浮或大漂钓半水 0.5～1.5 m，抓黑漂大弯",
      sinkerSpec: "通心铅/太空豆定位，配重按钓层",
      bait: "嫩芦苇芯、玉米粒、青草捆、草香商品饵",
      nest: "打草窝：成捆青草/芦苇坠入钓点，诱食兼遮蔽",
      strategy: "找水草带边缘、下风口漂来的草屑聚集处；高温天早晚与夜钓",
      timeNote: "05:00–09:00、17:00–22:00",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-CAO-夏-流", fish: "草鱼", seasons: ["夏"], waterTypes: ["河流"], flows: FLOW_SLOW,
    advice: {
      method: "钓缓流草边或钓浮随流",
      lineSpec: "主线 3.0～3.5 号，子线 1.5～2.0 号",
      hookSpec: "伊势尼 7～9 号",
      floatSetup: "大漂钓浮 0.5～1 m，看漂走与黑漂",
      sinkerSpec: "配重随流速，必要时无铅随流",
      bait: "嫩苇芯、玉米",
      nest: "草捆绑沉在缓流角",
      strategy: "进水口两侧、回湾漂草聚集带",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-CAO-秋-静", fish: "草鱼", seasons: ["秋"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [12, 26],
    advice: {
      method: "初秋续钓浮，仲秋后转底钓、逐层下移",
      lineSpec: "主线 2.5～3.0 号，子线 1.2～1.8 号",
      hookSpec: "伊势尼 6～8 号",
      floatSetup: "钓浮改钓底过渡，调 4 钓 2",
      sinkerSpec: "铅 2～3 克",
      bait: "玉米、颗粒、商品饵谷物香",
      nest: "颗粒 + 玉米重窝囤食",
      strategy: "找深水与草边交界，秋凉后鱼离浅滩",
      timeNote: "全天，午间佳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-CAO-秋-流", fish: "草鱼", seasons: ["秋"], waterTypes: ["河流", "沟渠"], flows: FLOW_SLOW,
    advice: {
      method: "缓流草边底钓或轻浮",
      lineSpec: "主线 3.0 号，子线 1.5 号",
      hookSpec: "伊势尼 7～8 号",
      floatSetup: "调平水钓 2～3 目",
      sinkerSpec: "铅 3～4 克",
      bait: "玉米、苇芯",
      nest: "草捆定点",
      strategy: "退水期找残留深草区",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-CAO-冬-静", fish: "草鱼", seasons: ["冬"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [2, 14],
    advice: {
      method: "深水底钓为主，草鱼冬季摄食极少，需耐心久守",
      lineSpec: "主线 2.0～2.5 号，子线 1.0～1.2 号",
      hookSpec: "伊势尼 5～6 号（饵小减号）",
      floatSetup: "调 2 钓 3，抓小幅上顶与横移",
      sinkerSpec: "铅 1.5～2 克",
      bait: "浓腥小饵、发酵玉米少量",
      nest: "轻窝勤补，忌重窝死窝",
      strategy: "向阳深水坎与背风水下凹槽",
      timeNote: "午间 11:00–15:00",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-CAO-冬-流", fish: "草鱼", seasons: ["冬"], waterTypes: ["河流"], flows: FLOW_SLOW,
    advice: {
      method: "深潭底钓久守",
      lineSpec: "主线 2.5～3.0 号，子线 1.2～1.5 号",
      hookSpec: "伊势尼 6～7 号",
      floatSetup: "调平水钓 3 目",
      sinkerSpec: "跑铅 3～5 克",
      bait: "玉米、腥饵",
      nest: "定点小窝",
      strategy: "暖排水区与深潭",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 其他常见鱼种（补充覆盖，非覆盖率口径必需） =====
  {
    id: "R-QING-夏-静", fish: "青鱼", seasons: ["夏", "秋"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [20, 30],
    advice: {
      method: "深水底钓重守，螺蛳为饵找螺蛳滩",
      lineSpec: "主线 3.5～5.0 号，子线 2.0～2.5 号",
      hookSpec: "伊势尼 9～11 号（钩条粗硬）",
      floatSetup: "调 2 钓 4～6，抓黑漂大弯",
      sinkerSpec: "重铅 3～5 克到底",
      bait: "螺蛳（带壳敲裂）、玉米",
      nest: "螺蛳 2～5 kg 重窝",
      strategy: "水底有硬物/螺群的大水面深区，久守不频换",
      timeNote: "夜钓佳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-BIAN-秋-静", fish: "鳊鱼", seasons: ["春", "夏", "秋"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [15, 28],
    advice: {
      method: "钓离底/飞铅追中层，主抓行程接口",
      lineSpec: "主线 1.0～1.5 号，子线 0.6～0.8 号（加长 25～35 cm）",
      hookSpec: "袖钩 5～6 号或新关东 0.3",
      floatSetup: "调 7～8 钓 2～3，翻身缓降的停与斜漂是口",
      sinkerSpec: "飞铅上推铅坠 20～40 cm 延长的摆动",
      bait: "细雾化腥香/藻味拉饵，嫩玉米粒",
      nest: "少量高频雾化养层",
      strategy: "找中上层鱼群，深水陡岸与溶氧高处",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-QIAO-夏-流", fish: "翘嘴", seasons: ["春", "夏", "秋"], waterTypes: ["湖泊", "水库", "河流"], flows: ["缓流", "急流"],
    tempRange: [18, 30],
    advice: {
      method: "路亚为主（米诺/VIB/亮片），台钓可用抽浮钓白条层",
      lineSpec: "路亚 PE 0.8～1.2 号 + 前导碳线 2.0 号",
      hookSpec: "三本钩 8～12 号（按饵型）",
      floatSetup: "台钓则大漂钓浮 0.3～1 m，抓急速下顿",
      sinkerSpec: "路亚靠饵重，铅头钩 3～7 克",
      bait: "活小白条/虾，路亚拟饵",
      nest: "不打窝，靠抛投搜索",
      strategy: "晨昏追小鱼群炸水处：湾汊口、明暗草边、闸口",
      timeNote: "日出前后与日落后 1 小时最凶",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LIAN-夏-静", fish: "鲢鱼", seasons: ["夏", "秋"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [22, 32], clarity: ["中等", "肥水"],
    advice: {
      method: "钓浮追温、水层由浅至深找鲢层，雾化滤食",
      lineSpec: "主线 2.0～3.0 号，子线 1.2～1.5 号（钩距 8～12 cm）",
      hookSpec: "伊势尼 7～9 号或新关东 1.0～1.5 大钩",
      floatSetup: "大漂调满钓 2～3 目，钓深 0.6～1.5 m 逐层找",
      sinkerSpec: "配重需拉得起大饵团",
      bait: "酸臭/草莓香雾化饵（鲢鱼饵），高频抛",
      nest: "大量雾化造悬浮带，不打沉底窝",
      strategy: "上风口/开阔水域表层升温处，肥水塘优先",
      timeNote: "午后至傍晚高温时段",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-NIAN-夏-浑", fish: "鲶鱼", seasons: ["春", "夏", "秋"], waterTypes: ["野塘", "河流", "沟渠", "湖泊"],
    clarity: ["浑浊", "肥水"],
    advice: {
      method: "夜钓底钓为主，重铅无漂或大跑铅看竿稍",
      lineSpec: "主线 3.0～5.0 号，子线 2.0 号或防咬线",
      hookSpec: "伊势尼 10～13 号/宽钩门",
      floatSetup: "调平水钓 5 目以上或直接看竿稍连续点动后大弯",
      sinkerSpec: "重铅 5～10 克到底",
      bait: "大黑蚯蚓、鸡肝、小鱼段，味腥重",
      nest: "动物内脏/骨粉笼沉底做气味窝",
      strategy: "乱石堆、桥墩、水草腐叶底、闸下深水；雨夜浑水最爆",
      timeNote: "20:00 后至凌晨",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-GUI-夏-流", fish: "鳜鱼", seasons: ["春", "夏", "秋"], waterTypes: ["河流", "水库", "湖泊"], flows: ["缓流", "急流"],
    clarity: ["清澈", "中等"],
    advice: {
      method: "路亚为主，贴底跳搜结构区；活饵钓底亦可",
      lineSpec: "PE 1.0～1.5 号 + 碳前导 3.0 号",
      hookSpec: "曲柄钩 2～4 号 + 防挂软饵，或三本钩亮片",
      floatSetup: "活饵钓底时调平水钓 3～5 目",
      sinkerSpec: "铅头钩 7～14 克，乱石区偏轻防挂",
      bait: "小活鱼/泥鳅（注意当地外来种法规），软虫/米诺",
      nest: "不打窝",
      strategy: "清晨与黄昏钓乱石、倒树、桥墩、陡坎等结构，光线暗时靠边",
      timeNote: "低光时段（晨昏/夜）",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-HUANG-夏-浑", fish: "黄颡鱼", seasons: ["春", "夏", "秋"], waterTypes: ["河流", "野塘", "沟渠", "湖泊"],
    clarity: ["浑浊", "中等"],
    advice: {
      method: "底钓/抛竿串钩，重铅短子线躺底",
      lineSpec: "主线 1.5～2.5 号，子线 0.8～1.0 号（短 8～12 cm）",
      hookSpec: "丸世 6～8 号（长柄易摘钩）",
      floatSetup: "调平水钓 2～4 目，抓连续抖动上顶",
      sinkerSpec: "铅 3～6 克到底",
      bait: "大蚯蚓、鸡肝、虾肉",
      nest: "碎肝/骨粉少量气味窝",
      strategy: "夜钓乱石与泥底交界、桥墩阴影",
      timeNote: "夜间与阴雨天",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LUOFEI-夏-静", fish: "罗非鱼", seasons: ["夏", "秋"], waterTypes: ["野塘", "水库", "湖泊", "沟渠"],
    tempRange: [22, 34],
    advice: {
      method: "底钓为主，罗非贪食群来后连竿，可钓钝",
      lineSpec: "主线 1.2～2.0 号，子线 0.8～1.0 号",
      hookSpec: "袖钩 6～8 号或罗非钩（钩门宽）",
      floatSetup: "调 5 钓 3 或调平水钓 2 目，抓上顶与黑漂",
      sinkerSpec: "铅 1.5～2.5 克",
      bait: "浓腥肝味饵、南极虾粉饵、蚯蚓",
      nest: "腥窝量大，鱼群入窝后续撒颗粒",
      strategy: "找向阳浅水升温区与塘中低洼，注意小非闹窝则换大饵钓钝",
      timeNote: "全天（水温越高越活跃）",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 不限鱼种的结构性规则（兜底加分为「钓位/水情」类建议） =====
  {
    id: "R-ANY-进出水口", fish: "*", seasons: ["春", "夏", "秋", "冬"],
    waterTypes: ["湖泊", "水库", "河流", "野塘", "沟渠"], structures: ["进出水口", "闸口"],
    advice: {
      method: "侧边缓流区底钓，避主流直射",
      lineSpec: "主线 1.5～2.5 号，子线 0.8～1.2 号",
      hookSpec: "袖钩 5～6 号或伊势尼 5 号",
      floatSetup: "调平水钓 2～3 目，重铅防冲走",
      sinkerSpec: "跑铅 2～4 克",
      bait: "随主攻鱼种，流水优先耐冲刷饵（玉米/蚯蚓）",
      nest: "流水少打或不打窝",
      strategy: "进出水口溶氧与食物集中，是四季首选钓位；夏季高温尤其明显",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-水草区", fish: "*", seasons: ["春", "夏", "秋", "冬"],
    waterTypes: ["湖泊", "水库", "野塘", "沟渠"], structures: ["水草区", "障碍物", "芦苇边"],
    advice: {
      method: "草洞/草边精准下竿，钓线短、起鱼快",
      lineSpec: "主线 1.0～2.0 号（偏粗防挂缠），子线 0.6～1.0 号",
      hookSpec: "袖钩 4～6 号，可用单钩防挂",
      floatSetup: "调高钓低抓顶，中鱼即挑出草区",
      sinkerSpec: "铅 0.8～1.5 克集中坠防缠草",
      bait: "活饵或黏性好的拉饵",
      nest: "草洞点小窝",
      strategy: "草区是鱼道与食物库，明暗交界最稳；注意挂钩改用单钩",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-深浅交界", fish: "*", seasons: ["春", "夏", "秋", "冬"],
    waterTypes: ["湖泊", "水库", "河流", "野塘"], structures: ["深浅交界", "水底坎", "坡位"],
    advice: {
      method: "打在同深槽边缘，鱼沿坎巡游",
      lineSpec: "主线 1.2～2.0 号，子线 0.6～1.0 号",
      hookSpec: "袖钩 4～6 号",
      floatSetup: "调 4 钓 2，按鱼层微调",
      sinkerSpec: "铅 1.5～2.5 克",
      bait: "随主攻鱼种",
      nest: "窝量投在坎下深水侧，鱼上坎吃散食",
      strategy: "深浅交界是四季通用鱼道，风向变化时优先",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-刮风天", fish: "*", seasons: ["春", "夏", "秋"],
    waterTypes: ["湖泊", "水库", "河流", "野塘"],
    advice: {
      method: "顶风水浅区作钓，溶氧升高鱼开口",
      lineSpec: "主线 1.2～2.0 号，子线 0.6～1.0 号",
      hookSpec: "袖钩 4～6 号",
      floatSetup: "风浪大改调平水钓 2～3 目或直接重铅",
      sinkerSpec: "重铅 2～4 克稳定钓组",
      bait: "随主攻鱼种，风大用黏饵",
      nest: "减少窝量，风散味快",
      strategy: "下风口/迎风岸溶氧与漂浮食物聚集，3～4 级风最佳；6 级以上换背风湾",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鲢鱼（补充季节） =====
  {
    id: "R-LIAN-春-静", fish: "鲢鱼", seasons: ["春"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [15, 22], clarity: ["清澈", "中等"],
    advice: {
      method: "水温回升后钓浮，由浅层逐渐下探找鲢层",
      lineSpec: "主线 1.5～2.5 号，子线 1.0～1.2 号",
      hookSpec: "伊势尼 6～8 号或新关东 0.8～1.0",
      floatSetup: "大漂调满钓 2 目，钓深 0.4～1.0 m",
      sinkerSpec: "配重按饵团大小调，确保翻身快",
      bait: "酸香雾化饵，春季偏腥香",
      nest: "高频雾化造层，少量勤抛",
      strategy: "向阳浅水升温区，避风岸",
      timeNote: "午后水温高时最佳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鳙鱼（从鲢鳙拆分独立） =====
  {
    id: "R-YONG-夏-静", fish: "鳙鱼", seasons: ["夏", "秋"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [22, 32], clarity: ["中等", "肥水"],
    advice: {
      method: "钓浮找鳙层，鳙鱼比鲢鱼偏深，雾化滤食",
      lineSpec: "主线 2.5～3.5 号，子线 1.5～2.0 号（钩距 10～15 cm）",
      hookSpec: "伊势尼 8～10 号或新关东 1.5～2.0",
      floatSetup: "大漂调满钓 2～3 目，钓深 1.0～2.0 m",
      sinkerSpec: "配重需拉得起大饵团",
      bait: "酸臭雾化饵（鳙鱼饵），鳙鱼偏臭味",
      nest: "大量雾化造悬浮带",
      strategy: "开阔水域深水区，大水面优于小塘",
      timeNote: "午后至傍晚",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-YONG-秋-静", fish: "鳙鱼", seasons: ["秋"], waterTypes: ["湖泊", "水库"], flows: STILL,
    tempRange: [15, 25],
    advice: {
      method: "秋凉后鳙鱼下沉，钓深增加",
      lineSpec: "主线 2.5～3.0 号，子线 1.5 号",
      hookSpec: "伊势尼 8～9 号",
      floatSetup: "大漂调满钓 2 目，钓深 1.5～2.5 m",
      sinkerSpec: "配重按饵团",
      bait: "酸臭雾化饵",
      nest: "持续雾化",
      strategy: "深水区大水面，秋凉后鱼下沉",
      timeNote: "午间至傍晚",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 青鱼（补充季节） =====
  {
    id: "R-QING-春-静", fish: "青鱼", seasons: ["春"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [15, 24],
    advice: {
      method: "底钓守钓，螺蛳为饵找螺蛳滩",
      lineSpec: "主线 3.0～4.0 号，子线 2.0～2.5 号",
      hookSpec: "伊势尼 8～10 号（钩条粗硬）",
      floatSetup: "调 2 钓 4～6，抓黑漂大弯",
      sinkerSpec: "重铅 3～4 克到底",
      bait: "螺蛳（带壳敲裂）、玉米",
      nest: "螺蛳 1～3 kg 重窝",
      strategy: "水底有硬物/螺群的大水面深区",
      timeNote: "夜钓佳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-QING-冬-静", fish: "青鱼", seasons: ["冬"], waterTypes: ["湖泊", "水库"], flows: STILL,
    tempRange: [4, 12],
    advice: {
      method: "深水底钓久守，冬季青鱼少食",
      lineSpec: "主线 2.5～3.5 号，子线 1.5～2.0 号",
      hookSpec: "伊势尼 7～9 号",
      floatSetup: "调 2 钓 3～4，抓小幅下顿",
      sinkerSpec: "铅 2～3 克",
      bait: "螺蛳、玉米，少量",
      nest: "轻窝，冬季不重窝",
      strategy: "深水最稳的坑底，久守",
      timeNote: "午间 11:00–15:00",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鳊鱼（补充季节） =====
  {
    id: "R-BIAN-夏-静", fish: "鳊鱼", seasons: ["夏"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [22, 30],
    advice: {
      method: "飞铅钓中层，追行程接口",
      lineSpec: "主线 1.0～1.5 号，子线 0.6～0.8 号（加长 30 cm）",
      hookSpec: "袖钩 5～7 号",
      floatSetup: "调 7～8 钓 2～3，翻身缓降抓停与斜漂",
      sinkerSpec: "飞铅上推 20～40 cm",
      bait: "腥香拉饵、嫩玉米",
      nest: "高频雾化养层",
      strategy: "深水陡岸、溶氧高处",
      timeNote: "晨昏为主",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-BIAN-冬-静", fish: "鳊鱼", seasons: ["冬"], waterTypes: ["湖泊", "水库"], flows: STILL,
    tempRange: [4, 12],
    advice: {
      method: "底钓深水，冬季鳊鱼聚深水少动",
      lineSpec: "主线 0.8～1.2 号，子线 0.4～0.6 号",
      hookSpec: "袖钩 3～5 号",
      floatSetup: "调 3 钓 2，抓轻口",
      sinkerSpec: "铅 0.8～1.2 克",
      bait: "腥香小饵、红虫",
      nest: "酒米小窝",
      strategy: "深水坎与背风区",
      timeNote: "午间",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 翘嘴（补充季节） =====
  {
    id: "R-QIAO-春-流", fish: "翘嘴", seasons: ["春"], waterTypes: ["湖泊", "水库", "河流"], flows: ["缓流", "急流"],
    tempRange: [15, 24],
    advice: {
      method: "路亚搜中层，台钓抽浮钓白条层",
      lineSpec: "路亚 PE 0.6～1.0 号 + 碳前导 1.5 号",
      hookSpec: "三本钩 6～10 号",
      floatSetup: "台钓大漂钓浮 0.3～0.8 m",
      sinkerSpec: "铅头钩 3～5 克",
      bait: "活小白条、拟饵米诺/VIB",
      nest: "不打窝，靠抛投搜索",
      strategy: "湾汊口、草边、闸口晨昏追炸水",
      timeNote: "日出前后与日落后 1 小时",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-QIAO-冬-静", fish: "翘嘴", seasons: ["冬"], waterTypes: ["湖泊", "水库"], flows: STILL,
    tempRange: [4, 12],
    advice: {
      method: "深水路亚慢搜，冬季翘嘴下沉",
      lineSpec: "PE 0.8～1.2 号 + 碳前导 2.0 号",
      hookSpec: "三本钩 8～12 号",
      floatSetup: "台钓可钓底或离底",
      sinkerSpec: "铅头钩 5～10 克深水用",
      bait: "VIB/铁板慢摇，活小鱼",
      nest: "不打窝",
      strategy: "深水陡坎、水下结构区",
      timeNote: "午间水温高时",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鲶鱼（补充季节） =====
  {
    id: "R-NIAN-春-浑", fish: "鲶鱼", seasons: ["春"], waterTypes: ["野塘", "河流", "湖泊"], clarity: ["浑浊", "肥水"],
    advice: {
      method: "夜钓底钓，重铅无漂或大跑铅看竿稍",
      lineSpec: "主线 2.5～4.0 号，子线 1.5～2.0 号或防咬线",
      hookSpec: "伊势尼 8～12 号",
      floatSetup: "调平水钓 5 目以上或看竿稍",
      sinkerSpec: "重铅 4～8 克到底",
      bait: "大黑蚯蚓、鸡肝、小鱼段",
      nest: "动物内脏/骨粉笼沉底",
      strategy: "乱石堆、桥墩、水草腐叶底",
      timeNote: "入夜后至凌晨",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-NIAN-冬-浑", fish: "鲶鱼", seasons: ["冬"], waterTypes: ["河流", "野塘"], clarity: ["浑浊"],
    advice: {
      method: "深水底钓久守，冬季鲶鱼少动",
      lineSpec: "主线 2.0～3.0 号，子线 1.2 号",
      hookSpec: "伊势尼 7～9 号",
      floatSetup: "调平水钓 3～5 目或看竿稍",
      sinkerSpec: "铅 3～5 克",
      bait: "大蚯蚓、鸡肝",
      nest: "少量气味窝",
      strategy: "深潭、桥墩下游",
      timeNote: "夜间偶有口",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鳜鱼（补充季节） =====
  {
    id: "R-GUI-春-流", fish: "鳜鱼", seasons: ["春"], waterTypes: ["河流", "水库", "湖泊"], flows: ["缓流", "急流"],
    tempRange: [15, 24], clarity: ["清澈", "中等"],
    advice: {
      method: "路亚贴底跳搜结构区，活饵钓底",
      lineSpec: "PE 1.0～1.5 号 + 碳前导 3.0 号",
      hookSpec: "曲柄钩 2～4 号 + 软饵",
      floatSetup: "活饵底钓调平水钓 3～5 目",
      sinkerSpec: "铅头钩 5～10 克",
      bait: "小活鱼/泥鳅、软虫/米诺",
      nest: "不打窝",
      strategy: "乱石、倒树、桥墩、陡坎",
      timeNote: "低光时段晨昏",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-GUI-冬-静", fish: "鳜鱼", seasons: ["冬"], waterTypes: ["河流", "水库"], flows: STILL,
    tempRange: [4, 12], clarity: ["清澈", "中等"],
    advice: {
      method: "深水路亚慢搜，冬季鳜鱼伏底少动",
      lineSpec: "PE 1.0～1.5 号 + 碳前导 3.0 号",
      hookSpec: "曲柄钩 3～5 号 + 铅头钩软饵",
      floatSetup: "底钓可调平水钓 3 目",
      sinkerSpec: "铅头钩 7～14 克",
      bait: "软虫/铁板慢摇，活小鱼",
      nest: "不打窝",
      strategy: "深水乱石、陡坎结构",
      timeNote: "午间水温高时",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 黄颡鱼（补充季节） =====
  {
    id: "R-HUANG-冬-浑", fish: "黄颡鱼", seasons: ["冬"], waterTypes: ["河流", "野塘"], clarity: ["浑浊", "中等"],
    advice: {
      method: "底钓/抛竿串钩，冬季口轻需小饵",
      lineSpec: "主线 1.2～2.0 号，子线 0.6～1.0 号",
      hookSpec: "丸世 5～7 号",
      floatSetup: "调平水钓 2～3 目，抓连续抖动",
      sinkerSpec: "铅 2～4 克到底",
      bait: "红虫、小蚯蚓段",
      nest: "碎肝/骨粉少量气味窝",
      strategy: "泥底交界、桥墩阴影",
      timeNote: "夜间与阴雨天",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 罗非鱼（补充季节） =====
  {
    id: "R-LUOFEI-春-静", fish: "罗非鱼", seasons: ["春"], waterTypes: ["野塘", "沟渠"], flows: STILL,
    tempRange: [18, 25],
    advice: {
      method: "底钓为主，春季罗非恢复摄食",
      lineSpec: "主线 1.0～1.5 号，子线 0.6～0.8 号",
      hookSpec: "袖钩 5～7 号",
      floatSetup: "调 4 钓 2，抓黑漂与上顶",
      sinkerSpec: "铅 1.0～1.5 克",
      bait: "腥香饵、蚯蚓",
      nest: "腥窝少量",
      strategy: "向阳浅水升温区",
      timeNote: "午间水温高时",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 黑鱼（新增，四季主力掠食鱼） =====
  {
    id: "R-HEI-春-静", fish: "黑鱼", seasons: ["春"], waterTypes: ["湖泊", "野塘", "沟渠"], flows: STILL,
    tempRange: [15, 24], clarity: ["清澈", "中等"],
    advice: {
      method: "路亚搜草边/障碍区，青蛙/雷蛙水面系",
      lineSpec: "PE 1.5～3.0 号 + 钢前导 4～6 号",
      hookSpec: "单钩/双钩雷蛙钩 3/0～5/0",
      floatSetup: "水面系无漂",
      sinkerSpec: "饵重 10～20 克",
      bait: "雷蛙/软蛙/小活鱼",
      nest: "不打窝",
      strategy: "水草区、芦苇边、浅水草洞",
      timeNote: "午间水温高时活跃",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-HEI-夏-静", fish: "黑鱼", seasons: ["夏"], waterTypes: ["湖泊", "野塘", "沟渠"], flows: STILL,
    tempRange: [24, 34],
    advice: {
      method: "路亚水面系打草洞，黑鱼护仔期攻击欲强",
      lineSpec: "PE 2.0～4.0 号 + 钢前导 5～8 号",
      hookSpec: "雷蛙钩 4/0～6/0",
      floatSetup: "水面系无漂",
      sinkerSpec: "饵重 15～25 克",
      bait: "雷蛙/软蛙/小活鱼",
      nest: "不打窝",
      strategy: "密集水草区、浮萍覆盖下、荷花塘",
      timeNote: "全天可钓，午间烈日下最活跃",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-HEI-秋-静", fish: "黑鱼", seasons: ["秋"], waterTypes: ["湖泊", "野塘", "沟渠"], flows: STILL,
    tempRange: [12, 25],
    advice: {
      method: "路亚水面+中层搜草边，秋后黑鱼猛食囤膘",
      lineSpec: "PE 1.5～3.0 号 + 钢前导 4～6 号",
      hookSpec: "雷蛙钩 3/0～5/0",
      floatSetup: "水面系或中层 swimbait",
      sinkerSpec: "饵重 10～20 克",
      bait: "雷蛙/软鱼/小活鱼",
      nest: "不打窝",
      strategy: "草边、倒树、浅滩残草区",
      timeNote: "午间至傍晚",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鲈鱼（大口黑鲈，新增） =====
  {
    id: "R-LU-春-静", fish: "鲈鱼", seasons: ["春"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [15, 24], clarity: ["清澈", "中等"],
    advice: {
      method: "路亚搜结构区，小泳姿软饵/Jig 贴底",
      lineSpec: "PE 0.8～1.5 号 + 碳前导 2.0～3.0 号",
      hookSpec: "曲柄钩 1/0～3/0 + 软饵，或铅头钩 3/0",
      floatSetup: "德州/卡罗莱纳钓组贴底",
      sinkerSpec: "铅头钩 3～7 克、子弹铅 5～10 克",
      bait: "软虫/Ned Rig/小活鱼",
      nest: "不打窝",
      strategy: "浅湾草边、倒树、水下坎",
      timeNote: "全天，午间佳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LU-夏-静", fish: "鲈鱼", seasons: ["夏"], waterTypes: ["湖泊", "水库", "野塘"], flows: STILL,
    tempRange: [24, 32],
    advice: {
      method: "路亚早晚搜浅水结构，正午退深水/草荫",
      lineSpec: "PE 1.0～1.5 号 + 碳前导 2.5～3.5 号",
      hookSpec: "曲柄钩 2/0～4/0 + 软饵",
      floatSetup: "水面系 frog 或 swimbait 中层",
      sinkerSpec: "铅头钩 5～10 克",
      bait: "雷蛙/软鱼/Ned Rig/小活鱼",
      nest: "不打窝",
      strategy: "草边、倒树、桥墩阴影、深浅交界",
      timeNote: "日出前与日落后最佳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-LU-秋-流", fish: "鲈鱼", seasons: ["秋"], waterTypes: ["湖泊", "水库", "河流"], flows: ["缓流", "急流"],
    tempRange: [12, 25],
    advice: {
      method: "路亚搜深水结构，秋季鲈鱼追饵鱼群",
      lineSpec: "PE 1.0～1.5 号 + 碳前导 3.0 号",
      hookSpec: "曲柄钩 2/0～4/0 + 软饵",
      floatSetup: "深水用 Jig/Crankbait 贴底搜",
      sinkerSpec: "铅头钩 7～14 克",
      bait: "软鱼/Crank/铁板",
      nest: "不打窝",
      strategy: "深水坎、水下结构、急流边回流",
      timeNote: "全天，午间亦佳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鲫鱼（补充：夏浑、冬流） =====
  {
    id: "R-JI-夏-浑", fish: "鲫鱼", seasons: ["夏"], waterTypes: ["野塘", "沟渠"], clarity: ["浑浊", "肥水"],
    advice: {
      method: "浑水钓边钓浅，动饵诱鱼",
      lineSpec: "主线 0.8～1.0 号，子线 0.4～0.6 号",
      hookSpec: "袖钩 3～4 号",
      floatSetup: "调 3 钓 2，钝中抓顶",
      sinkerSpec: "铅 0.8～1.0 克",
      bait: "蚯蚓、腥香拉饵",
      nest: "少量浓腥窝",
      strategy: "近岸浅水、进水口两侧",
      timeNote: "晨昏",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-JI-冬-流", fish: "鲫鱼", seasons: ["冬"], waterTypes: ["河流", "沟渠"], flows: FLOW_SLOW,
    advice: {
      method: "跑铅底钓，冬季流水区鲫鱼聚深坑",
      lineSpec: "主线 0.8～1.0 号，子线 0.3～0.4 号",
      hookSpec: "袖钩 2～3 号",
      floatSetup: "调平水钓 2 目，铅坠到底",
      sinkerSpec: "跑铅 1.5～2.5 克",
      bait: "红虫、蚯蚓",
      nest: "酒米小窝定点",
      strategy: "回水湾、桥墩下游缓流深坑",
      timeNote: "午间 11:00–15:00",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 鲤鱼（补充：夏浑、冬流） =====
  {
    id: "R-LI-夏-浑", fish: "鲤鱼", seasons: ["夏"], waterTypes: ["野塘", "沟渠"], clarity: ["浑浊", "肥水"],
    advice: {
      method: "浑水钓边，雨后涨水钓进水口",
      lineSpec: "主线 2.5～3.5 号，子线 1.2～1.5 号",
      hookSpec: "伊势尼 6～8 号",
      floatSetup: "调 2 钓 4，抓黑漂",
      sinkerSpec: "铅 2～3 克",
      bait: "玉米、薯味饵",
      nest: "颗粒 + 玉米打底",
      strategy: "进水口两侧、浑水近岸",
      timeNote: "傍晚至夜间",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 草鱼（补充：春流、夏浑） =====
  {
    id: "R-CAO-春-流", fish: "草鱼", seasons: ["春"], waterTypes: ["河流"], flows: FLOW_SLOW,
    advice: {
      method: "缓流草边底钓或轻浮",
      lineSpec: "主线 2.5～3.0 号，子线 1.2～1.5 号",
      hookSpec: "伊势尼 6～8 号",
      floatSetup: "调平水钓 2～3 目",
      sinkerSpec: "铅 2～3 克",
      bait: "嫩苇芯、玉米",
      nest: "草捆绑定点",
      strategy: "缓流草边、回湾漂草聚集",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-CAO-夏-浑", fish: "草鱼", seasons: ["夏"], waterTypes: ["野塘", "沟渠"], clarity: ["浑浊", "肥水"],
    advice: {
      method: "浑水草边钓浮，草鱼浑水靠边觅食",
      lineSpec: "主线 2.5～3.5 号，子线 1.5～2.0 号",
      hookSpec: "伊势尼 7～8 号",
      floatSetup: "钓浮 0.5～1 m",
      sinkerSpec: "通心铅定位",
      bait: "嫩芦苇芯、玉米、草香饵",
      nest: "草捆沉底做窝",
      strategy: "草边浑水区、下风口",
      timeNote: "早晚与夜钓",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },

  // ===== 通用补充规则（高温/闷热/雨后/冬季深水） =====
  {
    id: "R-ANY-闷热天", fish: "*", seasons: ["夏"],
    waterTypes: ["湖泊", "水库", "野塘"],
    advice: {
      method: "闷热低压鱼浮头，改钓浮或钓流水口",
      lineSpec: "主线 1.0～2.0 号，子线 0.6～1.0 号",
      hookSpec: "袖钩 4～6 号",
      floatSetup: "改钓浮 0.3～1 m，或跑铅钓流水口",
      sinkerSpec: "铅 1～2 克",
      bait: "轻饵雾化，偏清淡",
      nest: "减量或不打窝",
      strategy: "进水口/出水口溶氧高处；闷热无风天不咬钩则收竿",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-雨后涨水", fish: "*", seasons: ["春", "夏", "秋"],
    waterTypes: ["河流", "湖泊", "野塘", "沟渠"],
    advice: {
      method: "雨后涨水钓边钓进水口，鱼随浑水靠边觅食",
      lineSpec: "主线 1.5～2.5 号，子线 0.8～1.2 号",
      hookSpec: "袖钩 5～6 号或伊势尼 5 号",
      floatSetup: "调平水钓 2～3 目，重铅防冲走",
      sinkerSpec: "跑铅 2～4 克",
      bait: "蚯蚓、玉米（耐冲刷）",
      nest: "流水少打或不打",
      strategy: "进水口两侧、浑水回湾、涨水淹没的草地边",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-冬季深水", fish: "*", seasons: ["冬"],
    waterTypes: ["湖泊", "水库", "河流"],
    advice: {
      method: "冬季找最深的坑/坎底钓，鱼聚深水少动",
      lineSpec: "主线 0.8～1.5 号，子线 0.3～0.8 号",
      hookSpec: "袖钩 2～4 号（冬口轻）",
      floatSetup: "调低钓高，抓漂尾微顶 1 目",
      sinkerSpec: "细身铅 0.5～1.5 克",
      bait: "红虫/蚯蚓活饵优先，浓腥商品饵",
      nest: "酒米小窝 20～30 克，多点轮钓",
      strategy: "背风向阳深水 2.5～4 m，找水底坎/坑底",
      timeNote: "午间 11:00–15:00 水温最高",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-障碍物", fish: "*", seasons: ["春", "夏", "秋", "冬"],
    waterTypes: ["湖泊", "水库", "河流", "野塘", "沟渠"], structures: ["障碍物", "倒树", "桥墩"],
    advice: {
      method: "贴障碍物边下竿，单钩防挂",
      lineSpec: "主线 1.2～2.0 号，子线 0.6～1.0 号",
      hookSpec: "单钩 4～6 号（防挂）",
      floatSetup: "调高钓低，中鱼即挑出障碍区",
      sinkerSpec: "铅 1～2 克集中坠",
      bait: "活饵或黏饵",
      nest: "障碍边少量打窝",
      strategy: "倒树、桥墩、乱石堆旁是鱼藏匿点；注意防挂",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-芦苇边", fish: "*", seasons: ["春", "夏", "秋"],
    waterTypes: ["湖泊", "水库", "野塘"], structures: ["芦苇边", "水草区"],
    advice: {
      method: "贴芦苇根下竿，钓草洞草缝",
      lineSpec: "主线 1.0～2.0 号，子线 0.6～1.0 号",
      hookSpec: "袖钩 4～6 号，可用单钩",
      floatSetup: "调 4 钓 2，快速起鱼防缠",
      sinkerSpec: "铅 0.8～1.5 克",
      bait: "活饵/拉饵",
      nest: "草洞点小窝",
      strategy: "芦苇根/草洞是鱼道与庇护所，明暗交界最稳",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-湾汊", fish: "*", seasons: ["春", "夏", "秋", "冬"],
    waterTypes: ["湖泊", "水库", "河流"], structures: ["湾汊", "洄湾"],
    advice: {
      method: "湾汊内缓流区底钓，鱼在此休憩觅食",
      lineSpec: "主线 1.0～2.0 号，子线 0.6～1.0 号",
      hookSpec: "袖钩 4～6 号",
      floatSetup: "调 4 钓 2",
      sinkerSpec: "铅 1～2 克",
      bait: "随主攻鱼种",
      nest: "湾汊中心打窝诱集",
      strategy: "湾汊是鱼道必经之地，缓流回水区食物聚集",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
  {
    id: "R-ANY-明暗交界", fish: "*", seasons: ["春", "夏", "秋", "冬"],
    waterTypes: ["湖泊", "水库", "野塘"], structures: ["深浅交界"],
    advice: {
      method: "沿明暗交界线（树荫边/光照分界）下竿",
      lineSpec: "主线 1.0～2.0 号，子线 0.6～1.0 号",
      hookSpec: "袖钩 4～6 号",
      floatSetup: "调 4 钓 2",
      sinkerSpec: "铅 1～1.5 克",
      bait: "随主攻鱼种",
      nest: "交界线上定点",
      strategy: "光线交界处是鱼安全感与觅食的过渡带，全天可钓",
    },
    reviewStatus: "draft", source: "公开垂钓资料整理（待审定）",
  },
];
