/**
 * RoleCard Studio v1.9.0 Landing Page Controller
 * Zero-dependency vanilla JS: 4 Themes, ZH/EN i18n, Video Slot, 4 Interactive Sandboxes, Matrix.
 */

/* ============================================================================
 * 宣传片视频替换配置入口 (Upload video to Bilibili/YouTube & paste URL here)
 * ========================================================================== */
const PROMO_VIDEO_CONFIG = {
  // 官方 B 站宣传片 (BV18HsU6SEDE) 已启用；支持随时替换为其他嵌入地址或直链 MP4
  embedUrl: 'https://player.bilibili.com/player.html?bvid=BV18HsU6SEDE&page=1&high_quality=1&danmaku=0&autoplay=0',
  watchUrl: 'https://www.bilibili.com/video/BV18HsU6SEDE/',
  mp4Url: 'assets/promo-placeholder.mp4',
};

const I18N = {
  zh: {
    'nav.pain': '痛点破题',
    'nav.sandbox': '交互沙盒',
    'nav.matrix': '差异对比',
    'nav.deploy': '下载部署',
    'hero.kicker': 'LOCAL-FIRST CHARACTER & LOREBOOK HUB · v1.9.0',
    'hero.title': '让每一份灵感都有据可查，让每一位角色真正活起来',
    'hero.subtitle':
      '专为 AI 角色扮演与桌面跑团创作者打造的本地优先工作台。集成 Mode A/B/C 免 Key 考据防幻觉、CoC 7e × D&D 5e 双规则共存、2:3→1:1 VTT Token 裁切，以及 v1.9.0 蓝绿灯世界书全生命周期与试聊断点续聊。',
    'hero.ctaPrimary': '下载 v1.9.0 / Docker 部署',
    'hero.ctaSandbox': '在线体验交互沙盒',
    'hero.ctaReleases': 'GitHub Releases ↗',
    'hero.m1': '三模式百科考据硬拦截',
    'hero.m2': '双跑团规则同卡共存',
    'hero.m3': '酒馆 / VTT / Obsidian 导出',
    'hero.m4': 'Node 22 原生 SQLite 私有库',
    'video.title': 'v1.9.0 官方演示宣传片 · Bilibili 1080p',
    'video.watchBtn': 'B 站观看 ↗',
    'video.configBtn': '切换视频源',
    'video.posterHead': 'RoleCard Studio v1.9.0 全特性演示',
    'video.posterSub':
      '已接入 B 站官方宣传片（BV18HsU6SEDE）。点击播放按钮或右上角「B 站观看」即可观看 1080p 演示。',
    'pain.kicker': 'WHY ROLECARD STUDIO',
    'pain.title': '终结角色卡创作的四大顽疾',
    'pain.sub': '从设定考据到桌面跑团、从世界书调试到跨平台同步，一套本地工作台一次解决。',
    'pain.c1Tag': '01 · 资料散落',
    'pain.c1Title': '设定四处零散，版本失控',
    'pain.c1Desc': '设定拆在 TXT、聊天记录与多个 Wiki 页，改到一半找不到历史基准。',
    'pain.c1Fix': '✓ 本地 SQLite 中枢 + 20 版快照回溯',
    'pain.c2Tag': '02 · 模型幻觉',
    'pain.c2Title': '大模型凭空胡编履历',
    'pain.c2Desc': '面对冷门角色或二创设定，模型常脱离原作事实自由发挥。',
    'pain.c2Fix': '✓ Mode B 免 Key 百科直连 + 查无实据硬拦截',
    'pain.c3Tag': '03 · 生态割裂',
    'pain.c3Title': '酒馆与跑团数值两张皮',
    'pain.c3Desc': 'SillyTavern CCV3、CoC 7e、D&D 5e 与 VTT Token 反复手工搬运。',
    'pain.c3Fix': '✓ 双规则共存 + 512px Token 裁切 + 8 格式导出',
    'pain.c4Tag': '04 · 世界书黑盒',
    'pain.c4Title': '词条难编辑，试聊断上下文',
    'pain.c4Desc': '蓝绿灯词条切换繁琐，刷新页面或切角色后试聊上下文立刻清空。',
    'pain.c4Fix': '✓ v1.9.0 行内编辑/安全解绑 + 试聊断点续聊',
    'sb.kicker': 'INTERACTIVE PLAYGROUND · LIVE DEMO',
    'sb.title': '四大核心引擎 · 可点击交互体验沙盒',
    'sb.sub': '无需安装即可在浏览器中直接试玩 RoleCard Studio v1.9.0 的核心工作流与实时状态变化。',
    'sb.tab1': 'Mode A/B/C 考据防幻觉',
    'sb.tab2': '双规则数值 & 2:3→1:1 Token',
    'sb.tab3': '世界书全生命周期 × 断点续聊',
    'sb.tab4': '1-Hop 涟漪 × 4 槽位 × 7 代理',
    'mat.kicker': 'DIFFERENTIATION MATRIX',
    'mat.title': '为什么创作者选择 RoleCard Studio？',
    'mat.sub': '横向对比传统酒馆编辑器与通用 AI 生成站，“人无我有”的工程化护城河一目了然。',
    'mat.colDim': '核心能力维度',
    'mat.colRc': 'RoleCard Studio v1.9.0',
    'mat.colTrad': '传统酒馆卡编辑器',
    'mat.colGen': '通用 AI 角色生成站',
    'dep.kicker': 'OPEN SOURCE · LOCAL-FIRST DISTRIBUTION',
    'dep.title': '全平台交付，数据 100% 留在你自己的设备里',
    'dep.sub': '内嵌便携 Node.js 22 原生 SQLite 运行时或 Docker 多架构镜像，开箱即用、零云端锁定。',
    'dep.d1Title': '桌面安装版（Win / Linux）',
    'dep.d1Desc': 'Windows NSIS 图形化向导安装版与 Debian/Ubuntu `.deb` 系统包，自动注册命令与 systemd 服务模板。',
    'dep.d1Btn': '前往 Releases 下载安装包 ↗',
    'dep.d2Title': '绿色便携版（免安装即走）',
    'dep.d2Desc': '已内置 Node.js 22 运行时，不写入系统注册表。解压后双击 `start-rolecard.bat` 或运行 `./start-rolecard.sh` 即刻启动。',
    'dep.d2Btn': '获取便携版压缩包 ↗',
    'dep.d3Title': '多架构 Docker 一键部署',
    'dep.d3Desc': '适配 NAS（威联通 / 群晖 / 极空间）与自建服务器，持久化挂载数据库、`.master.key` 密钥与立绘资产。',
    'dep.d3Btn': '复制 Docker 部署命令',
    'dep.copied': '已复制 Docker 命令 ✓',
    'dep.ecoTitle': '开放生态原生打通：',
    'footer.tag': '让每一份灵感都有据可查，让每一位角色真正活起来。',
    'modal.title': '配置 / 预览宣传片视频源',
    'modal.desc':
      '当前默认嵌入 B 站官方宣传片（BV18HsU6SEDE）。你可粘贴其他 B 站 / YouTube 链接或直链 MP4 URL 立即切换预览。',
    'modal.poster': '查看封面海报',
    'modal.reset': '恢复官方默认视频',
    'modal.apply': '立即预览嵌入效果',
  },
  en: {
    'nav.pain': 'Pain Points',
    'nav.sandbox': 'Live Sandbox',
    'nav.matrix': 'Comparison',
    'nav.deploy': 'Download',
    'hero.kicker': 'LOCAL-FIRST CHARACTER & LOREBOOK HUB · v1.9.0',
    'hero.title': 'Ground Every Inspiration in Fact. Bring Every Character to Life.',
    'hero.subtitle':
      'A local-first studio built for AI roleplay & tabletop RPG creators. Featuring zero-key Mode A/B/C anti-hallucination research, CoC 7e × D&D 5e dual-system sheets, 2:3→1:1 VTT Token cropping, and v1.9.0 Lorebook lifecycle + resumable playtest chat.',
    'hero.ctaPrimary': 'Download v1.9.0 / Docker',
    'hero.ctaSandbox': 'Try Live Sandbox',
    'hero.ctaReleases': 'GitHub Releases ↗',
    'hero.m1': '3-Mode Wiki Guardrail',
    'hero.m2': 'Dual TRPG Coexistence',
    'hero.m3': 'CCV3 / VTT / Obsidian',
    'hero.m4': 'Local SQLite Sovereignty',
    'video.title': 'v1.9.0 Official Promo · Bilibili 1080p',
    'video.watchBtn': 'Watch on Bilibili ↗',
    'video.configBtn': 'Switch Source',
    'video.posterHead': 'RoleCard Studio v1.9.0 Feature Showcase',
    'video.posterSub':
      'Official Bilibili promo video (BV18HsU6SEDE) is live. Click Play or open directly on Bilibili for 1080p fullscreen.',
    'pain.kicker': 'WHY ROLECARD STUDIO',
    'pain.title': 'Eliminate the 4 Bottlenecks of Character Creation',
    'pain.sub': 'From verifiable lore research to tabletop stat blocks, lorebook debugging, and multi-client sync.',
    'pain.c1Tag': '01 · FRAGMENTED LORE',
    'pain.c1Title': 'Scattered Notes & Lost Versions',
    'pain.c1Desc': 'Lore scattered across TXT files, chat logs, and wikis with zero rollback safety.',
    'pain.c1Fix': '✓ Local SQLite Hub + 20 Version Snapshots',
    'pain.c2Tag': '02 · HALLUCINATION',
    'pain.c2Title': 'LLMs Fabricating Canon Facts',
    'pain.c2Desc': 'Models invent traits, timelines, and lore when left unchecked.',
    'pain.c2Fix': '✓ Zero-Key Mode B Wiki Lookup + Hard Block',
    'pain.c3Tag': '03 · SPLIT ECOSYSTEMS',
    'pain.c3Title': 'AI RP vs. TRPG Format Silos',
    'pain.c3Desc': 'Manually copying data between SillyTavern CCV3, CoC 7e, D&D 5e, and VTT tokens.',
    'pain.c3Fix': '✓ Dual-Rule Sheets + 512px Token + 8 Exports',
    'pain.c4Tag': '04 · LOREBOOK CHAOS',
    'pain.c4Title': 'Rigid Entries & Ephemeral Chat',
    'pain.c4Desc': 'Clumsy blue/green entry editing and playtest chats wiped on refresh.',
    'pain.c4Fix': '✓ v1.9.0 Inline Edit/Unlink + Session Resume',
    'sb.kicker': 'INTERACTIVE PLAYGROUND · LIVE DEMO',
    'sb.title': 'Explore All 4 Core Engines Right in Your Browser',
    'sb.sub': 'Click through Mode A/B/C guardrails, dual TRPG token forging, v1.9.0 lorebooks, and 1-Hop ripple sync.',
    'sb.tab1': 'Mode A/B/C Anti-Hallucination',
    'sb.tab2': 'Dual TRPG & 2:3→1:1 Token',
    'sb.tab3': 'v1.9.0 Lorebook × Resume Chat',
    'sb.tab4': '1-Hop Ripple × 4 Slots × 7 Proxies',
    'mat.kicker': 'DIFFERENTIATION MATRIX',
    'mat.title': 'How RoleCard Studio Stands Apart',
    'mat.sub': 'Side-by-side comparison against traditional Tavern editors and cloud AI character generators.',
    'mat.colDim': 'Capability Dimension',
    'mat.colRc': 'RoleCard Studio v1.9.0',
    'mat.colTrad': 'Traditional Card Editors',
    'mat.colGen': 'Cloud AI Card Generators',
    'dep.kicker': 'OPEN SOURCE · LOCAL-FIRST DISTRIBUTION',
    'dep.title': 'Cross-Platform Delivery. 100% Local Data Ownership.',
    'dep.sub': 'Bundled with portable Node.js 22 native SQLite or multi-arch Docker images — zero cloud lock-in.',
    'dep.d1Title': 'Desktop Installers (Win / Linux)',
    'dep.d1Desc': 'Windows NSIS setup wizard and Debian/Ubuntu .deb package with CLI & systemd template.',
    'dep.d1Btn': 'Download Installer on Releases ↗',
    'dep.d2Title': 'Portable Edition (Zero Install)',
    'dep.d2Desc': 'Built-in Node.js 22 runtime with zero registry writes. Extract and run start-rolecard.bat / .sh.',
    'dep.d2Btn': 'Get Portable Archive ↗',
    'dep.d3Title': 'Multi-Arch Docker Image',
    'dep.d3Desc': 'Built for NAS & home servers (amd64 / arm64), persisting SQLite DB, .master.key, and portraits.',
    'dep.d3Btn': 'Copy Docker Command',
    'dep.copied': 'Docker Command Copied ✓',
    'dep.ecoTitle': 'Open Ecosystem Integrations:',
    'footer.tag': 'Ground every inspiration in fact. Bring every character to life.',
    'modal.title': 'Configure / Preview Promo Video Source',
    'modal.desc':
      'Defaulting to the official Bilibili video (BV18HsU6SEDE). Paste any Bilibili/YouTube URL or direct MP4 link below to preview.',
    'modal.poster': 'Show Cover Poster',
    'modal.reset': 'Restore Official Video',
    'modal.apply': 'Preview Video Embed',
  },
};

const MATRIX_ROWS = {
  zh: [
    ['事实依据与防幻觉', 'Mode A/B/C 三模式 + 免 Key 公开百科直连（萌娘/PRTS/Wiki）+ 查无实据硬拦截 + 双源引用勾选', '无（全靠人工手填或外部搜索粘贴）', '无事实拦截（模型常凭空编造）'],
    ['思考过程与版本回溯', '实时 SSE 思考流（支持 <think>/reasoning）+ 截断 JSON 抢救 + 20 版历史快照一键回溯', '无历史快照或仅本地撤销', '黑盒等待，生成结果覆盖原稿'],
    ['AI RP × TRPG 双生态', '同一角色卡下 CoC 7e 与 D&D 5e 双规则隔离共存、AI 数值推演 + 2:3→1:1 512px VTT Token 裁切', '仅支持酒馆 JSON / PNG', '仅支持对话设定文本，无跑团面板'],
    ['独立世界书 & 试聊体验', 'v1.9.0 蓝绿灯行内编辑/启用停用/瞬时切换/关联解绑删除 + 试聊会话持久化与断点续聊', '词条弹窗嵌套，无内置持久化试聊', '无标准 CCV3 蓝绿灯世界书'],
    ['世界演化与防雪崩', '定时演化引擎 + 1-Hop 单跳邻居涟漪 + 人工审核门禁 + SSE 同步至 SillyTavern/Obsidian/MCP', '纯静态文件，无定时演化', '无跨角色关系涟漪机制'],
    ['数据主权与网络可控', '100% 本地 SQLite + AES-256-GCM 加密 + 4 异构模型槽位 + 7 作用域代理 + 桌面/Docker 全发行', '本地单文件或纯静态网页', '云端闭源托管，无法自控网络路由'],
  ],
  en: [
    ['Fact Grounding & Guardrail', 'Mode A/B/C + Zero-Key Wikis (Moegirl/PRTS/Wikipedia) + Hard Block on missing sources + Dual-source citations', 'None (manual copy-paste only)', 'Unchecked LLM hallucination'],
    ['Reasoning Stream & Rollback', 'Live SSE thinking stream + truncated JSON rescue + 20 version snapshots with 1-click rollback', 'No built-in snapshot history', 'Opaque generation overwriting drafts'],
    ['AI RP × TRPG Dual Ecology', 'CoC 7e & D&D 5e coexist on one card + AI stat inference + 2:3→1:1 512px VTT Token cropper', 'Tavern PNG/JSON only', 'Text-only, no tabletop stat blocks'],
    ['Lorebook & Resumable Chat', 'v1.9.0 inline edit, toggle, blue/green switch, unlink-safe delete + persistent resumable playtest', 'Modal-heavy, no persistent playtest', 'No CCV3 selective/constant lorebook'],
    ['World Evolution & Safety', 'Scheduled evolution + 1-Hop ripple + human review gate + SSE sync to SillyTavern/Obsidian/MCP', 'Static files, no live evolution', 'No relationship ripple guardrails'],
    ['Data Sovereignty & Proxy', '100% local SQLite + AES-256-GCM + 4 heterogeneous slots + 7-scope proxy + Desktop/Docker', 'Single local file', 'Cloud-hosted vendor lock-in'],
  ],
};

/* ============================================================================
 * App State
 * ========================================================================== */
const state = {
  lang: 'zh',
  theme: 'dark',
  sbTab: 'mode',
  // Sandbox 1: Mode A/B/C
  sbMode: 'B',
  sbQueryType: 'real', // 'real' | 'fake'
  sbSrcMoegirl: true,
  sbSrcPrts: true,
  sbSnap: 20,
  // Sandbox 2: Dual TRPG & Token Crop
  sbRule: 'coc', // 'coc' | 'dnd'
  cocStr: 65,
  cocDex: 80,
  cocSan: 62,
  dndStr: 18,
  dndAc: 18,
  dndHp: 68,
  cropX: 50,
  cropY: 26,
  cropSize: 64,
  // Sandbox 3: v1.9.0 Worldbook + Playtest Resume
  wbEntries: [
    { id: 1, titleZh: '世界观基石 · 蒸汽与奥术历 1894', titleEn: 'World Canon · Steam & Arcana 1894', mode: 'blue', keys: '', enabled: true, textZh: '蒸汽驱动与黑曜石奥术共鸣网络并存的时代基调。', textEn: 'An era balancing steam engines with obsidian arcane networks.' },
    { id: 2, titleZh: '黑曜石图书馆 · 禁书区守则', titleEn: 'Obsidian Library · Restricted Wing', mode: 'green', keys: '黑曜石图书馆, Obsidian', enabled: true, textZh: '进入地下第三阅览室必须出示银色徽记并登记档案编号。', textEn: 'Entering Sub-Vault 3 requires presenting a silver crest.' },
    { id: 3, titleZh: '角色口癖与行为准则', titleEn: 'Speech Pattern & Conduct', mode: 'green', keys: '准则, 档案', enabled: true, textZh: '说话克制精准，引用档案编号时不带主观情绪。', textEn: 'Speaks with measured precision when citing archive IDs.' },
  ],
  wbEditingId: null,
  wbDeleteConfirmId: null,
  chatSessionId: 104,
  chatResuming: false,
  chatMessages: [
    { role: 'ai', textZh: '[历史存档 #104] 我合上银边档案，向你致意。', textEn: '[Archive #104] I close the silver-edged dossier and nod.', hits: [] },
    { role: 'user', textZh: '带我去黑曜石图书馆的地下第三阅览室。', textEn: 'Take me to Sub-Vault 3 of the Obsidian Library.', hits: [] },
    { role: 'ai', textZh: '她取出银色徽记贴在石门纹章上：“依据 1894 年公约，已为你登记进入权限。”', textEn: 'She presses her silver crest to the seal: "Under the 1894 Accord, access granted."', hits: ['🔵 蓝灯常驻 ×1', '🟢 关键词: 黑曜石图书馆'] },
  ],
  // Sandbox 4: 1-Hop Ripple & 7 Proxy Scopes
  rippleTriggered: false,
  rippleApproved: false,
  proxies: [
    { id: 'llm', zh: '对话推理', en: 'LLM Chat', mode: 'PROXY' },
    { id: 'wiki', zh: '百科考据', en: 'Wiki Search', mode: 'PROXY' },
    { id: 'img', zh: 'AI 生图', en: 'Image Gen', mode: 'PROXY' },
    { id: 'vtt', zh: 'VTT 导出', en: 'VTT Export', mode: 'DIRECT' },
    { id: 'sse', zh: 'SSE 推送', en: 'SSE Sync', mode: 'DIRECT' },
    { id: 'mcp', zh: 'MCP 工具', en: 'MCP Bridge', mode: 'PROXY' },
    { id: 'upd', zh: '版本检查', en: 'Update Check', mode: 'PROXY' },
  ],
};

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('[data-set-theme]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.setTheme === theme);
  });
  try {
    localStorage.setItem('rc_landing_theme', theme);
  } catch {}
}

function applyLang(lang) {
  state.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  const dict = I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (dict[key]) el.textContent = dict[key];
  });
  document.getElementById('langToggle').textContent = lang === 'zh' ? '简中 / EN' : 'EN / 简中';
  renderMatrix();
  renderSandbox();
}

function renderMatrix() {
  const tbody = document.getElementById('matrixBody');
  const rows = MATRIX_ROWS[state.lang];
  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td style="font-weight:800;">${esc(r[0])}</td>
        <td class="is-highlight" style="font-weight:700;color:var(--text-primary);">${esc(r[1])}</td>
        <td style="color:var(--text-secondary);">${esc(r[2])}</td>
        <td style="color:var(--text-secondary);">${esc(r[3])}</td>
      </tr>`
    )
    .join('');
}

/* ============================================================================
 * Interactive Sandbox Renderers
 * ========================================================================== */
function renderSandbox() {
  const mount = document.getElementById('sandboxMount');
  document.querySelectorAll('[data-sb-tab]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.sbTab === state.sbTab);
  });

  if (state.sbTab === 'mode') mount.innerHTML = renderModeSandbox();
  else if (state.sbTab === 'dual') mount.innerHTML = renderDualSandbox();
  else if (state.sbTab === 'v19') mount.innerHTML = renderV19Sandbox();
  else mount.innerHTML = renderRippleSandbox();
}

function renderModeSandbox() {
  const zh = state.lang === 'zh';
  const isBlocked = state.sbMode === 'B' && state.sbQueryType === 'fake';
  const thinkText =
    state.sbMode === 'A'
      ? zh
        ? '<think>\n[Mode A · 纯本地材料] 已跳过外部联网检索。\n正在严格提取用户上传设定集中的性格、语言风格与背景段落…\n✓ 未发现外部补充污染，生成 100% 忠实于本地原稿。\n</think>'
        : '<think>\n[Mode A · Local Material Only] External web search skipped.\nExtracting personality, voice, and canon timeline strictly from uploaded notes…\n✓ Zero external drift detected.\n</think>'
      : isBlocked
        ? zh
          ? '<think>\n[Mode B · 纯联网考据] 正在检索萌娘百科、PRTS Wiki、Wikipedia…\n结果：未命中任何可信公开百科条目。\n⛔ 触发硬拦截（FACT_BOUNDARY_GUARD）：禁止模型脱离依据凭空编造！请补充关键词或切换 Mode C。\n</think>'
          : '<think>\n[Mode B · Web Research] Querying Moegirl, PRTS Wiki, Wikipedia…\nResult: 0 verified public wiki entries matched.\n⛔ HARD BLOCK TRIGGERED: Refusing to hallucinate unverified canon facts.\n</think>'
        : zh
          ? `<think>\n[Mode ${state.sbMode} · 百科考据] 已直连免 Key 公开百科：\n${state.sbSrcMoegirl ? '  ☑ 萌娘百科：命中人物履历与阵营关系\n' : ''}${state.sbSrcPrts ? '  ☑ PRTS Wiki：命中干员档案与语音文本\n' : ''}正在基于已勾选信源构建 CCV3 角色卡（当前预览快照 v${state.sbSnap}）…\n</think>`
          : `<think>\n[Mode ${state.sbMode} · Verified Research] Connected zero-key public wikis:\n${state.sbSrcMoegirl ? '  ☑ Moegirlpedia: Matched character biography & faction\n' : ''}${state.sbSrcPrts ? '  ☑ PRTS Wiki: Matched operator dossier & voice lines\n' : ''}Synthesizing CCV3 card from checked citations (Snapshot v${state.sbSnap})…\n</think>`;

  return `
    <div class="rc-sb-grid">
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <div style="font-size:13px;font-weight:800;margin-bottom:8px;color:var(--text-secondary);">
            ${zh ? '1. 切换生成模式（Mode A / B / C）' : '1. Switch Generation Mode (Mode A / B / C)'}
          </div>
          <div class="rc-seg-row">
            <button class="rc-seg-pill ${state.sbMode === 'A' ? 'is-on' : ''}" data-action="setMode" data-val="A" type="button">
              ${zh ? 'Mode A · 纯本地材料' : 'Mode A · Local Only'}
            </button>
            <button class="rc-seg-pill ${state.sbMode === 'B' ? 'is-on' : ''}" data-action="setMode" data-val="B" type="button">
              ${zh ? 'Mode B · 纯联网考据' : 'Mode B · Web Guardrail'}
            </button>
            <button class="rc-seg-pill ${state.sbMode === 'C' ? 'is-on' : ''}" data-action="setMode" data-val="C" type="button">
              ${zh ? 'Mode C · 混合双源' : 'Mode C · Hybrid Dual'}
            </button>
          </div>
        </div>

        <div>
          <div style="font-size:13px;font-weight:800;margin-bottom:8px;color:var(--text-secondary);">
            ${zh ? '2. 选择测试输入（验证 Mode B 硬拦截）' : '2. Choose Test Input (Test Mode B Hard Block)'}
          </div>
          <div class="rc-seg-row">
            <button class="rc-seg-pill ${state.sbQueryType === 'real' ? 'is-on' : ''}" data-action="setQuery" data-val="real" type="button">
              ${zh ? '真实角色：银灰（有公开百科）' : 'Real Canon: SilverAsh (Verified)'}
            </button>
            <button class="rc-seg-pill ${state.sbQueryType === 'fake' ? 'is-on' : ''}" data-action="setQuery" data-val="fake" type="button">
              ${zh ? '捏造词：虚空星穹幻境使（无实据）' : 'Fabricated Query (No Sources)'}
            </button>
          </div>
        </div>

        <div class="rc-card-soft" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:13px;font-weight:800;">
            ${zh ? '3. 双源引用勾选再生成（Zero-Key Public Wikis）' : '3. Toggle Cited Wiki Sources for Regeneration'}
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">
            <input type="checkbox" data-action="toggleMoegirl" ${state.sbSrcMoegirl ? 'checked' : ''} ${state.sbMode === 'A' ? 'disabled' : ''} />
            <span>${zh ? '萌娘百科（免 Key 直连）' : 'Moegirlpedia (Zero-Key Direct)'}</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">
            <input type="checkbox" data-action="togglePrts" ${state.sbSrcPrts ? 'checked' : ''} ${state.sbMode === 'A' ? 'disabled' : ''} />
            <span>${zh ? 'PRTS Wiki（免 Key 直连）' : 'PRTS Wiki (Zero-Key Direct)'}</span>
          </label>
        </div>

        <div class="rc-card-soft" style="padding:14px 16px;">
          <div style="font-size:13px;font-weight:800;margin-bottom:8px;">
            ${zh ? '4. 20 版历史快照一键回溯' : '4. 20-Version Snapshot Rollback'}
          </div>
          <div class="rc-snap-strip">
            ${[15, 16, 17, 18, 19, 20]
              .map(
                (v) =>
                  `<button class="rc-snap-btn mono ${state.sbSnap === v ? 'is-on' : ''}" data-action="setSnap" data-val="${v}" type="button">v${v}</button>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="rc-card-soft" style="padding:14px 16px;border-color:${isBlocked ? 'var(--err)' : 'var(--ok)'};background:${isBlocked ? 'var(--err-soft)' : 'var(--ok-soft)'};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="color:${isBlocked ? 'var(--err)' : 'var(--ok)'};">
              ${
                isBlocked
                  ? zh
                    ? '⛔ Mode B 硬拦截已触发：拒绝凭空捏造'
                    : '⛔ Mode B Hard Block Triggered'
                  : zh
                    ? '✔ 事实边界校验通过 · 准备生成'
                    : '✔ Fact Boundary Verified · Ready'
              }
            </strong>
            <span class="rc-badge mono ${isBlocked ? 'rc-badge-err' : 'rc-badge-ok'}">${isBlocked ? 'BLOCKED' : 'VERIFIED'}</span>
          </div>
        </div>

        <div style="font-size:13px;font-weight:800;color:var(--accent);">
          ${zh ? '✦ 实时 SSE 思考推理流（Thinking Stream）' : '✦ Live SSE Thinking Stream'}
        </div>
        <pre class="rc-think-box mono">${esc(thinkText)}</pre>

        <div class="rc-card-soft" style="padding:14px 16px;margin-top:auto;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:13px;color:var(--text-secondary);">
            ${zh ? `当前版本：v${state.sbSnap} · 超时保护：300s 流式空闲重置` : `Active Snapshot: v${state.sbSnap} · 300s Idle-Reset Stream`}
          </span>
          <span class="rc-badge rc-badge-accent mono">JSON Rescue ON</span>
        </div>
      </div>
    </div>
  `;
}

function renderDualSandbox() {
  const zh = state.lang === 'zh';
  const isCoc = state.sbRule === 'coc';
  const stats = isCoc
    ? [
        { key: 'cocStr', label: zh ? 'STR 力量' : 'STR', val: state.cocStr, min: 15, max: 95 },
        { key: 'cocDex', label: zh ? 'DEX 敏捷' : 'DEX', val: state.cocDex, min: 15, max: 95 },
        { key: 'cocSan', label: zh ? 'SAN 理智' : 'SAN', val: state.cocSan, min: 10, max: 99 },
      ]
    : [
        { key: 'dndStr', label: zh ? 'STR 力量' : 'STR', val: state.dndStr, min: 6, max: 20 },
        { key: 'dndAc', label: zh ? 'AC 护甲' : 'AC', val: state.dndAc, min: 10, max: 22 },
        { key: 'dndHp', label: zh ? 'HP 生命' : 'HP', val: state.dndHp, min: 12, max: 120 },
      ];

  const ringPx = Math.round((state.cropSize / 100) * 140);
  const ringLeft = Math.round(((196 - ringPx) * state.cropX) / 100);
  const ringTop = Math.round(((294 - ringPx) * state.cropY) / 100);

  return `
    <div class="rc-sb-grid">
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div class="rc-seg-row">
            <button class="rc-seg-pill ${isCoc ? 'is-on' : ''}" data-action="setRule" data-val="coc" type="button">CoC 7e 调查员</button>
            <button class="rc-seg-pill ${!isCoc ? 'is-on' : ''}" data-action="setRule" data-val="dnd" type="button">D&amp;D 5e 冒险者</button>
          </div>
          <button class="rc-btn rc-btn-sm" data-action="aiInferStats" type="button">
            ${zh ? '✦ AI 推演数值' : '✦ AI Infer Stats'}
          </button>
        </div>

        <div class="rc-card-soft" style="padding:18px;display:flex;flex-direction:column;gap:14px;">
          <div style="font-size:13px;font-weight:800;color:var(--text-secondary);">
            ${zh ? '拖动滑块精修属性（双规则桶数据独立共存，互不覆盖）' : 'Drag sliders to refine stats (CoC 7e & D&D 5e stored independently)'}
          </div>
          ${stats
            .map(
              (s) => `
            <div class="rc-stat-row">
              <strong class="mono">${s.label}</strong>
              <input class="rc-range" type="range" min="${s.min}" max="${s.max}" value="${s.val}" data-action="statSlide" data-key="${s.key}" />
              <span class="mono" style="text-align:right;font-weight:800;color:var(--accent);">${s.val}</span>
            </div>`
            )
            .join('')}
        </div>

        <div class="rc-card-soft" style="padding:16px;margin-top:auto;">
          <div style="font-size:13px;font-weight:800;margin-bottom:10px;">
            ${zh ? '8 种标准格式一键导出' : '8 Export Formats Ready'}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:7px;">
            ${['CharaV2 PNG', 'CharaV2 JSON', 'Foundry VTT', 'CoC 7e HTML/MD', 'D&D 5e JSON', 'Worldbook', 'Full ZIP']
              .map((f) => `<span class="rc-badge rc-badge-accent mono">${f}</span>`)
              .join('')}
          </div>
        </div>
      </div>

      <div class="rc-card-soft" style="padding:18px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:14.5px;">${zh ? '2:3 竖版画廊 → 1:1 (512px) VTT Token 交互裁切' : '2:3 Portrait → 1:1 (512px) VTT Token Cropper'}</strong>
          <span class="rc-badge rc-badge-info mono">512×512 PNG</span>
        </div>

        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">
          <div class="rc-portrait-stage">
            <svg viewBox="0 0 120 180" style="width:100%;height:100%;">
              <circle cx="60" cy="54" r="24" fill="#FDE68A" opacity="0.92"/>
              <path d="M22 170 C22 112, 98 112, 98 170 Z" fill="#F59E0B" opacity="0.78"/>
              <path d="M35 50 Q60 20 85 50" fill="none" stroke="#FEF3C7" stroke-width="4"/>
            </svg>
            <div class="rc-crop-ring" style="left:${ringLeft}px;top:${ringTop}px;width:${ringPx}px;height:${ringPx}px;"></div>
          </div>

          <div style="flex:1;min-width:190px;display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;align-items:center;gap:14px;">
              <div class="rc-token-preview">
                <svg viewBox="0 0 120 180" style="width:180%;height:180%;transform:translate(${-(state.cropX - 50) * 0.6}px, ${-(state.cropY - 30) * 0.7}px) scale(${(110 / state.cropSize).toFixed(2)});">
                  <circle cx="60" cy="54" r="24" fill="#FDE68A" opacity="0.92"/>
                  <path d="M22 170 C22 112, 98 112, 98 170 Z" fill="#F59E0B" opacity="0.78"/>
                </svg>
              </div>
              <div style="font-size:12.5px;color:var(--text-secondary);">
                <div style="font-weight:800;color:var(--text-primary);">${zh ? '实时 Token 预览' : 'Live Token Output'}</div>
                <div class="mono">512×512px · Foundry Ready</div>
              </div>
            </div>

            <label style="font-size:12px;color:var(--text-secondary);">
              X ${zh ? '偏移' : 'Offset'}
              <input class="rc-range" type="range" min="0" max="100" value="${state.cropX}" data-action="cropSlide" data-key="cropX" />
            </label>
            <label style="font-size:12px;color:var(--text-secondary);">
              Y ${zh ? '偏移' : 'Offset'}
              <input class="rc-range" type="range" min="0" max="100" value="${state.cropY}" data-action="cropSlide" data-key="cropY" />
            </label>
            <label style="font-size:12px;color:var(--text-secondary);">
              ${zh ? '裁切框尺寸' : 'Crop Radius'}
              <input class="rc-range" type="range" min="45" max="90" value="${state.cropSize}" data-action="cropSlide" data-key="cropSize" />
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderV19Sandbox() {
  const zh = state.lang === 'zh';
  return `
    <div class="rc-sb-grid">
      <!-- Left: Worldbook Lifecycle -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:15px;">${zh ? '独立世界书 · 蓝绿灯全生命周期' : 'Worldbook · Full Entry Lifecycle'}</strong>
          <button class="rc-btn rc-btn-sm" data-action="resetWb" type="button">${zh ? '重置词条' : 'Reset'}</button>
        </div>

        ${state.wbEntries
          .map((e) => {
            const isEdit = state.wbEditingId === e.id;
            const isDel = state.wbDeleteConfirmId === e.id;
            const lastMsg = state.chatMessages[state.chatMessages.length - 1];
            const isHit = e.enabled && lastMsg && lastMsg.hits.length > 0 && (e.mode === 'blue' || lastMsg.hits.some((h) => h.includes('黑曜石') || h.includes('Obsidian')));
            return `
            <div class="rc-wb-item ${e.enabled ? '' : 'is-disabled'} ${isHit ? 'is-hit' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <button class="rc-badge ${e.mode === 'blue' ? 'rc-badge-info' : 'rc-badge-ok'}" style="cursor:pointer;" data-action="wbToggleMode" data-id="${e.id}" type="button">
                    ${e.mode === 'blue' ? (zh ? '🔵 蓝灯常驻' : '🔵 Constant') : (zh ? '🟢 绿灯关键词' : '🟢 Selective')}
                  </button>
                  <strong style="font-size:13.5px;">${esc(zh ? e.titleZh : e.titleEn)}</strong>
                </div>
                <div style="display:flex;gap:5px;">
                  <button class="rc-btn rc-btn-sm" data-action="wbToggleEnable" data-id="${e.id}" type="button">
                    ${e.enabled ? (zh ? '停用' : 'Disable') : (zh ? '启用' : 'Enable')}
                  </button>
                  <button class="rc-btn rc-btn-sm" data-action="wbEdit" data-id="${e.id}" type="button">
                    ${isEdit ? (zh ? '保存' : 'Save') : (zh ? '编辑' : 'Edit')}
                  </button>
                  <button class="rc-btn rc-btn-sm" style="color:var(--err);" data-action="wbDelete" data-id="${e.id}" type="button">
                    ${zh ? '删除' : 'Del'}
                  </button>
                </div>
              </div>

              ${
                isEdit
                  ? `<input class="rc-input" data-wb-input="${e.id}" value="${esc(zh ? e.textZh : e.textEn)}" />`
                  : `<div style="font-size:13px;color:var(--text-secondary);">${esc(zh ? e.textZh : e.textEn)}</div>`
              }

              ${
                isDel
                  ? `<div style="padding:8px 10px;border-radius:8px;background:var(--err-soft);font-size:12px;color:var(--err);display:flex;justify-content:space-between;align-items:center;gap:8px;">
                      <span>${zh ? '⚠ 已关联 2 张角色卡：确认删除并自动安全解绑？' : '⚠ Linked to 2 cards: confirm unlink & delete?'}</span>
                      <button class="rc-btn rc-btn-sm" style="border-color:var(--err);color:var(--err);" data-action="wbConfirmDel" data-id="${e.id}" type="button">${zh ? '确认删除' : 'Confirm'}</button>
                    </div>`
                  : ''
              }
            </div>`;
          })
          .join('')}
      </div>

      <!-- Right: Playtest Persistence & Resume -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <strong style="font-size:15px;">${zh ? '快速试聊沙盒 · 历史持久化与断点续聊' : 'Quick Playtest · Session Persistence & Resume'}</strong>
          <button class="rc-btn rc-btn-sm" data-action="simReload" type="button">
            ${zh ? '↻ 模拟刷新 / 切卡恢复' : '↻ Simulate Reload Resume'}
          </button>
        </div>

        <div class="rc-seg-row">
          ${[
            { id: 104, zh: '#104 酒馆初遇', en: '#104 Tavern' },
            { id: 103, zh: '#103 遗迹审讯', en: '#103 Ruins' },
            { id: 102, zh: '#102 性格压测', en: '#102 Stress' },
          ]
            .map(
              (s) =>
                `<button class="rc-seg-pill ${state.chatSessionId === s.id ? 'is-on' : ''}" data-action="setChatSession" data-val="${s.id}" type="button">${esc(zh ? s.zh : s.en)}</button>`
            )
            .join('')}
        </div>

        <div class="rc-chat-log">
          ${
            state.chatResuming
              ? `<div class="rc-badge rc-badge-warn mono" style="align-self:center;">↻ ${zh ? '正在从本地 SQLite 恢复最近会话快照…' : 'Restoring session from local SQLite…'}</div>`
              : ''
          }
          ${state.chatMessages
            .map(
              (m) => `
            <div class="rc-msg ${m.role === 'user' ? 'is-user' : 'is-ai'}">
              ${
                m.hits && m.hits.length
                  ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:5px;">${m.hits.map((h) => `<span class="rc-badge rc-badge-ok" style="font-size:11px;">${esc(h)}</span>`).join('')}</div>`
                  : ''
              }
              <div>${esc(zh ? m.textZh : m.textEn)}</div>
            </div>`
            )
            .join('')}
        </div>

        <div style="display:flex;gap:8px;">
          <input id="chatQuickInput" class="rc-input" type="text" placeholder="${zh ? '输入含关键词“黑曜石图书馆”试聊…' : 'Type message with Obsidian Library…'}" />
          <button class="rc-btn rc-btn-sm rc-btn-primary" data-action="sendChat" type="button">${zh ? '发送试聊' : 'Send'}</button>
        </div>
      </div>
    </div>
  `;
}

function renderRippleSandbox() {
  const zh = state.lang === 'zh';
  const rippleStroke = state.rippleApproved ? 'var(--ok)' : state.rippleTriggered ? 'var(--accent)' : 'var(--border-default)';
  return `
    <div class="rc-sb-grid">
      <div class="rc-card-soft" style="padding:18px;display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <strong style="font-size:15px;">${zh ? '1-Hop 单跳关系涟漪 & 防雪崩门禁' : '1-Hop Ripple & Avalanche Firewall'}</strong>
          <div style="display:flex;gap:8px;">
            <button class="rc-btn rc-btn-sm" data-action="triggerRipple" type="button">${zh ? '触发定时演化' : 'Run Evolution'}</button>
            <button class="rc-btn rc-btn-sm rc-btn-primary" data-action="approveRipple" type="button" ${!state.rippleTriggered ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
              ${state.rippleApproved ? (zh ? '✔ 已人工放行' : '✔ Approved') : (zh ? '人工审核批准' : 'Approve Gate')}
            </button>
          </div>
        </div>

        <svg viewBox="0 0 460 250" style="width:100%;height:auto;max-height:250px;">
          <!-- 2-Hop Firewall Ring -->
          <circle cx="230" cy="125" r="108" fill="none" stroke="var(--err)" stroke-width="1.5" stroke-dasharray="5 5" opacity="0.65"/>
          <text x="230" y="15" text-anchor="middle" fill="var(--err)" font-size="11" font-weight="700">${zh ? '2-Hop 雪崩隔离防火墙' : '2-Hop Avalanche Firewall'}</text>

          <!-- 1-Hop Ripple Ring -->
          <circle cx="230" cy="125" r="68" fill="none" stroke="${rippleStroke}" stroke-width="${state.rippleTriggered ? '2.5' : '1.2'}" opacity="${state.rippleTriggered ? '0.95' : '0.45'}"/>

          <!-- Edges to 1-Hop neighbors -->
          <line x1="230" y1="125" x2="170" y2="90" stroke="${rippleStroke}" stroke-width="2"/>
          <line x1="230" y1="125" x2="290" y2="90" stroke="${rippleStroke}" stroke-width="2"/>
          <line x1="230" y1="125" x2="230" y2="188" stroke="${rippleStroke}" stroke-width="2"/>

          <!-- 2-Hop Frozen Outer Nodes -->
          <circle cx="70" cy="60" r="16" fill="var(--bg-elevated)" stroke="var(--text-muted)" stroke-width="1.5"/>
          <text x="70" y="64" text-anchor="middle" fill="var(--text-muted)" font-size="10">2-Hop</text>
          <circle cx="390" cy="60" r="16" fill="var(--bg-elevated)" stroke="var(--text-muted)" stroke-width="1.5"/>
          <text x="390" y="64" text-anchor="middle" fill="var(--text-muted)" font-size="10">2-Hop</text>

          <!-- 1-Hop Neighbor Nodes -->
          <circle cx="170" cy="90" r="21" fill="var(--bg-elevated)" stroke="${rippleStroke}" stroke-width="2"/>
          <text x="170" y="94" text-anchor="middle" fill="var(--text-primary)" font-size="11" font-weight="700">${zh ? '盟友' : 'Ally'}</text>

          <circle cx="290" cy="90" r="21" fill="var(--bg-elevated)" stroke="${rippleStroke}" stroke-width="2"/>
          <text x="290" y="94" text-anchor="middle" fill="var(--text-primary)" font-size="11" font-weight="700">${zh ? '对手' : 'Rival'}</text>

          <circle cx="230" cy="188" r="21" fill="var(--bg-elevated)" stroke="${rippleStroke}" stroke-width="2"/>
          <text x="230" y="192" text-anchor="middle" fill="var(--text-primary)" font-size="11" font-weight="700">${zh ? '导师' : 'Mentor'}</text>

          <!-- Center Core -->
          <circle cx="230" cy="125" r="26" fill="var(--accent)" stroke="#fff" stroke-width="2"/>
          <text x="230" y="129" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">CORE</text>
        </svg>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          ${['SillyTavern SSE', 'Obsidian Vault', 'MCP Server']
            .map(
              (dst) => `
            <div class="rc-card-soft" style="padding:9px;text-align:center;font-size:12.5px;font-weight:700;border-color:${state.rippleApproved ? 'var(--ok)' : 'var(--border-default)'};color:${state.rippleApproved ? 'var(--ok)' : 'var(--text-secondary)'};">
              ${state.rippleApproved ? '● ' : '○ '}${dst}
            </div>`
            )
            .join('')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="rc-card-soft" style="padding:16px;">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:10px;">
            ${zh ? '4 路异构模型槽位（15 家服务商 + 4 套新手免费向导）' : '4 Heterogeneous Model Slots (15 Providers + Free Wizard)'}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${[
              [zh ? '槽位 1 · 主创作推理' : 'Slot 1 · Main Reasoning', 'DeepSeek-R1 / Claude'],
              [zh ? '槽位 2 · 考据核验' : 'Slot 2 · Fact Audit', 'Qwen-Max / Gemini'],
              [zh ? '槽位 3 · 视觉识图' : 'Slot 3 · Vision', 'GPT-4o / Gemini Vision'],
              [zh ? '槽位 4 · 2:3 绘图' : 'Slot 4 · 2:3 Image', 'Kolors / CogView / Comfy'],
            ]
              .map(
                ([k, v]) => `
              <div style="padding:10px;border-radius:10px;border:1px solid var(--border-default);background:var(--bg-surface);">
                <div style="font-size:11.5px;font-weight:800;color:var(--accent);">${esc(k)}</div>
                <div class="mono" style="font-size:12.5px;margin-top:3px;">${esc(v)}</div>
              </div>`
              )
              .join('')}
          </div>
        </div>

        <div class="rc-card-soft" style="padding:16px;flex:1;">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:8px;">
            ${zh ? '7 作用域细粒度网络代理（点击切换 PROXY / DIRECT）' : '7-Scope Fine-Grained Proxy Routing (Click to Toggle)'}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${state.proxies
              .map(
                (p) => `
              <button class="rc-seg-pill mono ${p.mode === 'PROXY' ? 'is-on' : ''}" data-action="toggleProxy" data-id="${p.id}" type="button">
                ${p.mode} · ${esc(zh ? p.zh : p.en)}
              </button>`
              )
              .join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================================
 * Video Slot & Embed Handler
 * ========================================================================== */
function normalizeVideoUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  const bvMatch = url.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/i);
  if (bvMatch) {
    return `https://player.bilibili.com/player.html?bvid=${bvMatch[1]}&page=1&high_quality=1&danmaku=0&autoplay=1`;
  }
  const ytShort = url.match(/youtu\.be\/([0-9A-Za-z_-]{6,})/i);
  if (ytShort) {
    return `https://www.youtube.com/embed/${ytShort[1]}?autoplay=1`;
  }
  const ytWatch = url.match(/[?&]v=([0-9A-Za-z_-]{6,})/i);
  if (/youtube\.com/i.test(url) && ytWatch) {
    return `https://www.youtube.com/embed/${ytWatch[1]}?autoplay=1`;
  }
  return url;
}

function applyVideoSource(rawUrl) {
  const url = normalizeVideoUrl(rawUrl);
  const stage = document.getElementById('videoStage');
  const poster = document.getElementById('videoPoster');
  const video = document.getElementById('promoVideoEl');
  const oldIframe = stage.querySelector('iframe');
  if (oldIframe) oldIframe.remove();

  if (!url) {
    video.style.display = 'none';
    video.pause();
    poster.style.display = 'flex';
    return;
  }

  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) {
    video.src = url;
    video.style.display = 'block';
    poster.style.display = 'none';
    video.play().catch(() => {});
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.title = 'RoleCard Studio v1.9.0 Official Promo Video';
  iframe.allow = 'autoplay; fullscreen; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'no-referrer-when-downgrade';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('frameborder', '0');
  stage.appendChild(iframe);
  poster.style.display = 'none';
}

function initPromoVideoSlot() {
  if (PROMO_VIDEO_CONFIG.embedUrl) {
    applyVideoSource(PROMO_VIDEO_CONFIG.embedUrl);
    return;
  }
  const video = document.getElementById('promoVideoEl');
  video.addEventListener('loadedmetadata', () => {
    if (video.duration && video.duration > 0.5) {
      video.style.display = 'block';
      document.getElementById('videoPoster').style.display = 'none';
    }
  });
}

/* ============================================================================
 * Event Wiring
 * ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  try {
    const savedTheme = localStorage.getItem('rc_landing_theme');
    if (savedTheme && ['dark', 'ocean', 'parchment', 'light'].includes(savedTheme)) {
      state.theme = savedTheme;
    }
  } catch {}
  applyTheme(state.theme);
  applyLang(state.lang);
  initPromoVideoSlot();

  // Theme buttons
  document.querySelectorAll('[data-set-theme]').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.setTheme));
  });

  // Language toggle
  document.getElementById('langToggle').addEventListener('click', () => {
    applyLang(state.lang === 'zh' ? 'en' : 'zh');
  });

  // Sandbox tabs
  document.querySelectorAll('[data-sb-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sbTab = btn.dataset.sbTab;
      renderSandbox();
    });
  });

  // Delegated sandbox clicks & inputs
  const mount = document.getElementById('sandboxMount');
  mount.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const { action, val, id } = btn.dataset;
    const numId = Number(id);

    if (action === 'setMode') state.sbMode = val;
    else if (action === 'setQuery') state.sbQueryType = val;
    else if (action === 'toggleMoegirl') state.sbSrcMoegirl = btn.checked;
    else if (action === 'togglePrts') state.sbSrcPrts = btn.checked;
    else if (action === 'setSnap') state.sbSnap = Number(val);
    else if (action === 'setRule') state.sbRule = val;
    else if (action === 'aiInferStats') {
      state.cocStr = 65;
      state.cocDex = 82;
      state.cocSan = 64;
      state.dndStr = 18;
      state.dndAc = 19;
      state.dndHp = 74;
    } else if (action === 'wbToggleMode') {
      const entry = state.wbEntries.find((x) => x.id === numId);
      if (entry) entry.mode = entry.mode === 'blue' ? 'green' : 'blue';
    } else if (action === 'wbToggleEnable') {
      const entry = state.wbEntries.find((x) => x.id === numId);
      if (entry) entry.enabled = !entry.enabled;
    } else if (action === 'wbEdit') {
      if (state.wbEditingId === numId) {
        const inp = mount.querySelector(`[data-wb-input="${numId}"]`);
        const entry = state.wbEntries.find((x) => x.id === numId);
        if (inp && entry) {
          if (state.lang === 'zh') entry.textZh = inp.value;
          else entry.textEn = inp.value;
        }
        state.wbEditingId = null;
      } else {
        state.wbEditingId = numId;
      }
    } else if (action === 'wbDelete') {
      state.wbDeleteConfirmId = state.wbDeleteConfirmId === numId ? null : numId;
    } else if (action === 'wbConfirmDel') {
      state.wbEntries = state.wbEntries.filter((x) => x.id !== numId);
      state.wbDeleteConfirmId = null;
    } else if (action === 'resetWb') {
      state.wbEntries = [
        { id: 1, titleZh: '世界观基石 · 蒸汽与奥术历 1894', titleEn: 'World Canon · Steam & Arcana 1894', mode: 'blue', keys: '', enabled: true, textZh: '蒸汽驱动与黑曜石奥术共鸣网络并存的时代基调。', textEn: 'An era balancing steam engines with obsidian arcane networks.' },
        { id: 2, titleZh: '黑曜石图书馆 · 禁书区守则', titleEn: 'Obsidian Library · Restricted Wing', mode: 'green', keys: '黑曜石图书馆, Obsidian', enabled: true, textZh: '进入地下第三阅览室必须出示银色徽记并登记档案编号。', textEn: 'Entering Sub-Vault 3 requires presenting a silver crest.' },
        { id: 3, titleZh: '角色口癖与行为准则', titleEn: 'Speech Pattern & Conduct', mode: 'green', keys: '准则, 档案', enabled: true, textZh: '说话克制精准，引用档案编号时不带主观情绪。', textEn: 'Speaks with measured precision when citing archive IDs.' },
      ];
      state.wbEditingId = null;
      state.wbDeleteConfirmId = null;
    } else if (action === 'setChatSession') {
      state.chatSessionId = Number(val);
      state.chatResuming = true;
      renderSandbox();
      setTimeout(() => {
        state.chatResuming = false;
        renderSandbox();
      }, 450);
      return;
    } else if (action === 'simReload') {
      state.chatResuming = true;
      renderSandbox();
      setTimeout(() => {
        state.chatResuming = false;
        renderSandbox();
      }, 650);
      return;
    } else if (action === 'sendChat') {
      const inp = document.getElementById('chatQuickInput');
      const raw = (inp && inp.value.trim()) || (state.lang === 'zh' ? '我想查阅黑曜石图书馆的档案准则' : 'Check the Obsidian Library archive rules');
      const blueCount = state.wbEntries.filter((e) => e.enabled && e.mode === 'blue').length;
      const greenHit = state.wbEntries.some((e) => e.enabled && e.mode === 'green' && (raw.includes('黑曜石') || raw.toLowerCase().includes('obsidian')));
      const hits = [];
      if (blueCount > 0) hits.push(state.lang === 'zh' ? `🔵 蓝灯常驻 ×${blueCount}` : `🔵 Constant ×${blueCount}`);
      if (greenHit) hits.push(state.lang === 'zh' ? '🟢 关键词: 黑曜石图书馆' : '🟢 Keyword: Obsidian');
      state.chatMessages.push({ role: 'user', textZh: raw, textEn: raw, hits: [] });
      state.chatMessages.push({
        role: 'ai',
        textZh: greenHit ? '已触发禁书区词条：请出示银色徽记后随我进入第三阅览室。' : '已基于蓝灯常驻世界观响应您的提问。',
        textEn: greenHit ? 'Restricted Wing rule triggered: please present your silver crest.' : 'Responded using active constant worldbook entries.',
        hits,
      });
    } else if (action === 'triggerRipple') {
      state.rippleTriggered = true;
      state.rippleApproved = false;
    } else if (action === 'approveRipple') {
      if (state.rippleTriggered) state.rippleApproved = true;
    } else if (action === 'toggleProxy') {
      const p = state.proxies.find((x) => x.id === id);
      if (p) p.mode = p.mode === 'PROXY' ? 'DIRECT' : 'PROXY';
    }

    renderSandbox();
  });

  mount.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.action === 'statSlide') {
      state[el.dataset.key] = Number(el.value);
      renderSandbox();
    } else if (el.dataset.action === 'cropSlide') {
      state[el.dataset.key] = Number(el.value);
      renderSandbox();
    }
  });

  // Copy Docker command
  document.getElementById('copyDockerBtn').addEventListener('click', async () => {
    const cmd = document.getElementById('dockerCmd').textContent;
    const btn = document.getElementById('copyDockerBtn');
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {}
    btn.textContent = I18N[state.lang]['dep.copied'];
    setTimeout(() => {
      btn.textContent = I18N[state.lang]['dep.d3Btn'];
    }, 1800);
  });

  // Video embed modal
  const modal = document.getElementById('embedModal');
  const openModal = () => modal.classList.add('is-open');
  const closeModal = () => modal.classList.remove('is-open');
  document.getElementById('openEmbedModal').addEventListener('click', openModal);
  document.getElementById('posterPlayBtn').addEventListener('click', () => {
    if (PROMO_VIDEO_CONFIG.embedUrl) {
      applyVideoSource(PROMO_VIDEO_CONFIG.embedUrl.replace('autoplay=0', 'autoplay=1'));
    } else {
      openModal();
    }
  });
  document.getElementById('closeEmbedModal').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.getElementById('applyEmbedBtn').addEventListener('click', () => {
    const url = document.getElementById('embedUrlInput').value.trim();
    if (url) applyVideoSource(url);
    closeModal();
  });
  document.getElementById('showPosterBtn').addEventListener('click', () => {
    applyVideoSource('');
    closeModal();
  });
  document.getElementById('resetEmbedBtn').addEventListener('click', () => {
    document.getElementById('embedUrlInput').value = PROMO_VIDEO_CONFIG.watchUrl || '';
    applyVideoSource(PROMO_VIDEO_CONFIG.embedUrl || '');
    closeModal();
  });
});
