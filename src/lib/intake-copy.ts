/**
 * Client onboarding form (/start/[token]) — every word a client sees, in English, 简体中文 and 繁體中文.
 *
 * Shared by the server (validation messages, the page, the team view's English labels) and the browser form,
 * so it has no server imports. `IntakeCopy` is the English shape; the two Chinese dictionaries are typed
 * against it, so a missing key in any language is a type error. Option labels are Record<value, string>, so a
 * new option must be translated everywhere too.
 *
 * Chinese is written for restaurant owners, not translated word for word. Platform names stay in English
 * (Instagram, Facebook, TikTok, Google, Yelp, WeChat), and app menu names are given in Chinese with the
 * English menu name alongside, because many owners run their phones in English.
 */

export const INTAKE_LANG_CODES = ["en", "zh-Hans", "zh-Hant"] as const;
export type IntakeLangCode = (typeof INTAKE_LANG_CODES)[number];
export const INTAKE_LANG_COOKIE = "nhq_intake_lang";

export function isIntakeLang(v: unknown): v is IntakeLangCode {
  return typeof v === "string" && (INTAKE_LANG_CODES as readonly string[]).includes(v);
}

/** ?lang= values we accept (case-insensitive), mapped to a language. */
export function parseIntakeLang(v: unknown): IntakeLangCode | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "en" || s === "english") return "en";
  if (["zh-hans", "hans", "zh-cn", "zh-sg", "cn", "sc", "简体", "简"].includes(s)) return "zh-Hans";
  if (["zh-hant", "hant", "zh-tw", "zh-hk", "zh-mo", "tw", "hk", "tc", "繁體", "繁"].includes(s)) return "zh-Hant";
  return null;
}

/** Accept-Language → language: zh-TW / zh-HK / zh-MO / zh-Hant → 繁體, any other zh → 简体, else English. First zh/en match wins by q-order. */
export function langFromAcceptLanguage(header: string | null | undefined): IntakeLangCode {
  if (!header) return "en";
  const items = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((i) => i.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of items) {
    if (tag.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(tag) ? "zh-Hant" : "zh-Hans";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

/* ───────────────────────── Fields (language-neutral) ───────────────────────── */

export const INTAKE_STEP_COUNT = 7;

type TextKind = "line" | "block";
const t = (kind: TextKind, max: number, step: number) => ({ kind, max, step }) as const;

/** Every free-text answer: kind, length cap, and the step (0-based) it's on. */
export const TEXT_FIELDS = {
  businessName: t("line", 160, 1),
  businessNameZh: t("line", 160, 1),
  address: t("line", 300, 1),
  phone: t("line", 40, 1),
  website: t("line", 300, 1),
  hours: t("block", 800, 1),
  cuisine: t("line", 200, 1),
  signatureDishes: t("block", 1000, 1),
  story: t("block", 2000, 1),
  different: t("block", 1500, 1),

  busyDays: t("line", 300, 2),
  slowDays: t("line", 300, 2),
  upcoming: t("block", 1500, 2),

  avoid: t("block", 1000, 3),
  likedAccounts: t("block", 1000, 3),
  mediaLink: t("line", 500, 3),

  instagram: t("line", 200, 4),
  facebook: t("line", 300, 4),
  tiktok: t("line", 200, 4),
  google: t("line", 300, 4),
  yelp: t("line", 300, 4),

  signoff: t("line", 120, 5),
  managerContact: t("line", 200, 5),
  neverMention: t("block", 1000, 5),
  offerNote: t("line", 300, 5),
  visitTimes: t("line", 300, 5),
  noFilm: t("block", 1000, 5),

  contactName: t("line", 120, 6),
  contactRole: t("line", 120, 6),
  contactPhone: t("line", 40, 6),
  contactEmail: t("line", 200, 6),
  talkLangOther: t("line", 80, 6),
  wechatId: t("line", 80, 6),
  approver: t("line", 200, 6),
  anythingElse: t("block", 3000, 6),
} as const;
export type TextField = keyof typeof TEXT_FIELDS;

const o = <const M extends boolean, const T extends readonly string[]>(multi: M, step: number, values: T) => ({ multi, step, values });

/** Every choice answer: single (radio) or multi (chips), its step, and its option values. */
export const CHOICE_FIELDS = {
  priceRange: o(false, 1, ["1", "2", "3", "4"]),
  dietary: o(true, 1, ["vegetarian", "vegan", "glutenFree", "halal"]),
  customers: o(true, 2, ["families", "students", "office", "dateNight", "tourists", "chinese", "seniors", "groups", "takeout"]),
  goals: o(true, 2, ["walkIns", "onlineOrders", "catering", "events", "newMenu", "reviews", "followers", "hiring"]),
  tone: o(true, 3, ["friendly", "fun", "elegant", "family", "bold"]),
  emojis: o(false, 3, ["yes", "some", "no"]),
  postLangs: o(false, 3, ["en", "zh", "both"]),
  accessMeta: o(false, 4, ["done", "help"]),
  accessGoogle: o(false, 4, ["done", "help"]),
  accessTiktok: o(false, 4, ["call", "none"]),
  complaints: o(false, 5, ["contact", "manager", "askFirst"]),
  creatorsOk: o(false, 5, ["yes", "maybe", "no"]),
  creatorOffer: o(true, 5, ["meal1", "meal2", "drinks", "setMenu", "dessert"]),
  talkLang: o(false, 6, ["en", "mandarin", "cantonese", "other"]),
  reachBy: o(true, 6, ["text", "call", "wechat", "whatsapp", "email"]),
  approvalSpeed: o(false, 6, ["sameDay", "fewDays", "weekly"]),
} as const;
export type ChoiceField = keyof typeof CHOICE_FIELDS;
export type ChoiceValue<F extends ChoiceField> = (typeof CHOICE_FIELDS)[F]["values"][number];
export type IntakeField = TextField | ChoiceField | "uploads";

/** Which answers live on which step (0 = welcome). Drives the form, the team view and "Copy all". */
export const INTAKE_STEP_FIELDS: IntakeField[][] = [
  [],
  ["businessName", "businessNameZh", "address", "phone", "website", "hours", "cuisine", "priceRange", "signatureDishes", "dietary", "story", "different"],
  ["customers", "goals", "busyDays", "slowDays", "upcoming"],
  ["tone", "emojis", "postLangs", "avoid", "likedAccounts", "mediaLink", "uploads"],
  ["instagram", "facebook", "tiktok", "google", "yelp", "accessMeta", "accessGoogle", "accessTiktok"],
  ["signoff", "complaints", "managerContact", "neverMention", "creatorsOk", "creatorOffer", "offerNote", "visitTimes", "noFilm"],
  ["contactName", "contactRole", "contactPhone", "contactEmail", "talkLang", "talkLangOther", "reachBy", "wechatId", "approver", "approvalSpeed", "anythingElse"],
];

type OptionLabels = { [F in ChoiceField]: Record<ChoiceValue<F>, string> };
type FieldCopy = { label: string; hint?: string; placeholder?: string };

/** Error keys the server returns; each language words them. */
export type IntakeErrorKey = "businessName" | "contactName" | "contactMethod" | "tooLong" | "email" | "website" | "pick";

/* ───────────────────────── English ───────────────────────── */

const en = {
  langName: "English",
  htmlLang: "en",
  meta: {
    title: "Welcome — let's get to know your restaurant",
    description: "A short, private onboarding form from Nora & Cameron.",
  },
  brand: "Nora & Cameron",
  common: {
    optional: "optional",
    required: "needed",
    skip: "Not sure? Skip it — we'll ask on our call.",
    back: "Back",
    next: "Next",
    start: "Let's start",
    submit: "Send my answers",
    sending: "Sending…",
    stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
    choose: "Choose one…",
    example: "Example:",
    restored: "Welcome back! We kept your answers on this phone, so you can pick up where you left off.",
    startOver: "Start over",
    autosave: "Your answers save on this device as you go.",
    neverPasswords: "Never send passwords in this form. We'll never ask for one.",
    language: "Language",
    privacy: "This link is just for you. Please don't share it.",
    copy: "Copy",
    copied: "Copied ✓",
  },
  welcome: {
    hi: (business: string) => `Hi ${business}!`,
    intro:
      "We're Nora & Cameron. We'll take care of your Instagram, Facebook, TikTok and Google reviews. We'll also invite local food creators from Richmond and the 757 to visit.",
    purpose: "These questions help us learn your restaurant, so your posts sound like you from day one.",
    points: [
      "Takes about 10 minutes. Short answers are perfect.",
      "Skip anything you're not sure about — we'll go over it together on our call.",
      "Nothing is ever posted without your OK.",
      "Your answers save on this phone as you go, so you can stop and come back.",
    ],
  },
  steps: [
    { title: "Welcome", blurb: "A quick hello before we start." },
    { title: "Your business", blurb: "The basics, like you'd tell a new customer." },
    { title: "Your customers & goals", blurb: "Who you love serving, and what you'd like more of." },
    { title: "Your look & voice", blurb: "How your posts should feel." },
    { title: "Your accounts", blurb: "Where to find you online, and how to let us help." },
    { title: "Reviews & creators", blurb: "How we reply to reviews and work with local food creators." },
    { title: "Contact & approvals", blurb: "Who we talk to, and how you'd like to approve posts." },
  ],
  fields: {
    businessName: { label: "Business name", placeholder: "Lucky Noodle House" },
    businessNameZh: { label: "Chinese name", hint: "If your business has a Chinese name.", placeholder: "自由市场" },
    address: { label: "Address", placeholder: "123 Main St, Richmond, VA 23220" },
    phone: { label: "Business phone", placeholder: "(804) 555-0123" },
    website: { label: "Website or online ordering link", placeholder: "luckynoodlehouse.com" },
    hours: { label: "Opening hours", hint: "Write it however is easiest.", placeholder: "Mon–Thu 11am–9pm, Fri–Sat 11am–10pm, closed Sunday" },
    cuisine: { label: "What kind of food or business?", placeholder: "Chinese market & hot food, Sichuan, bubble tea…" },
    priceRange: { label: "Price range", hint: "About how much one person spends." },
    signatureDishes: { label: "Your best dishes (top 3–5)", hint: "The ones people come back for.", placeholder: "Spicy beef noodle soup, soup dumplings, scallion pancakes" },
    dietary: { label: "Do you have options for…", hint: "Tap any that apply." },
    story: { label: "Your story, in a few sentences", hint: "How you started, who's in the kitchen, what you're proud of.", placeholder: "My parents opened the shop in 2009. Everything is still made by hand every morning…" },
    different: { label: "What makes you different?", placeholder: "Only place in town with hand-pulled noodles; family recipes; huge portions" },

    customers: { label: "Who are your best customers?", hint: "Tap all that fit." },
    goals: { label: "What would you like more of?", hint: "Tap your top goals." },
    busyDays: { label: "Busy days and times", placeholder: "Friday & Saturday dinner, Sunday lunch" },
    slowDays: { label: "Slow days and times", hint: "We can help fill these.", placeholder: "Monday–Wednesday afternoons" },
    upcoming: { label: "Coming up soon", hint: "Promotions, holidays, events, new dishes.", placeholder: "Lunar New Year menu in February; anniversary sale in May" },

    tone: { label: "How should your posts feel?", hint: "Pick one or two." },
    emojis: { label: "Emojis in posts?" },
    postLangs: { label: "Which language should we post in?" },
    avoid: { label: "Words or topics to avoid", placeholder: "Don't say \"cheap\"; no politics; don't compare us to other restaurants" },
    likedAccounts: { label: "Accounts you like the style of", hint: "Any business or creator — paste a link or @name.", placeholder: "@someplace, @anotherplace" },
    mediaLink: {
      label: "Logo, photos and videos — share a link",
      hint: "Put them in a Google Drive, Dropbox or iCloud folder, tap Share → \"Anyone with the link\", and paste the link here.",
      placeholder: "https://drive.google.com/…",
    },

    instagram: { label: "Instagram", placeholder: "@yourplace" },
    facebook: { label: "Facebook page", hint: "Paste the link, or type the page name.", placeholder: "facebook.com/yourplace" },
    tiktok: { label: "TikTok", placeholder: "@yourplace" },
    google: { label: "Google Business listing", hint: "Paste the Google Maps link, or just write \"search Lucky Noodle House Richmond\".", placeholder: "maps.app.goo.gl/… or the name we should search" },
    yelp: { label: "Yelp", placeholder: "yelp.com/biz/…" },
    accessMeta: { label: "Instagram + Facebook access" },
    accessGoogle: { label: "Google Business access" },
    accessTiktok: { label: "TikTok access" },

    signoff: { label: "How should we sign review replies?", placeholder: "— The Lucky Noodle House team" },
    complaints: { label: "When someone leaves an unhappy review, we should…" },
    managerContact: { label: "Phone or email we can share for complaints", hint: "Only if you picked that above.", placeholder: "Manager Lily, (804) 555-0199" },
    neverMention: { label: "Anything we should never mention in replies?", placeholder: "Don't mention refunds; don't name staff" },
    creatorsOk: { label: "Is it OK to invite local food creators to visit and post about you?" },
    creatorOffer: { label: "What could you offer a creator for a visit?", hint: "Tap any — nothing is promised until you agree." },
    offerNote: { label: "Anything else about the offer?", placeholder: "Up to $60 of food; weekdays only" },
    visitTimes: { label: "Best days and times for visits", placeholder: "Tue–Thu, 2–5pm (between lunch and dinner)" },
    noFilm: { label: "Anything creators shouldn't film?", placeholder: "The kitchen; customers' faces; the back office" },

    contactName: { label: "Your name", placeholder: "Lily Chen" },
    contactRole: { label: "Your role", placeholder: "Owner, manager…" },
    contactPhone: { label: "Mobile phone", placeholder: "(804) 555-0123" },
    contactEmail: { label: "Email", hint: "We'll send your monthly report here.", placeholder: "you@example.com" },
    talkLang: { label: "What language do you prefer to talk in?" },
    talkLangOther: { label: "Other language", placeholder: "Fujianese, Vietnamese…" },
    reachBy: { label: "Best way to reach you", hint: "Tap all that work." },
    wechatId: { label: "WeChat or WhatsApp ID", hint: "If you picked WeChat or WhatsApp." },
    approver: { label: "Who approves posts?", placeholder: "Me / my daughter Amy / the manager" },
    approvalSpeed: { label: "How quickly can you usually review a post?" },
    anythingElse: { label: "Anything else we should know?", placeholder: "Questions, worries, ideas — anything at all." },
    uploads: { label: "Or upload files from this phone", hint: "Photos, videos or your logo. Up to 25 MB each." },
  } satisfies Record<IntakeField, FieldCopy>,
  needContact: "Please give us at least a phone number or an email so we can reach you.",
  options: {
    priceRange: { "1": "$ · under $15", "2": "$$ · $15–30", "3": "$$$ · $30–60", "4": "$$$$ · over $60" },
    dietary: { vegetarian: "Vegetarian", vegan: "Vegan", glutenFree: "Gluten-free", halal: "Halal" },
    customers: {
      families: "Families", students: "Students", office: "Office workers", dateNight: "Date night", tourists: "Tourists & visitors",
      chinese: "Chinese-speaking community", seniors: "Seniors", groups: "Big groups & parties", takeout: "Takeout & delivery regulars",
    },
    goals: {
      walkIns: "More walk-ins", onlineOrders: "More online orders", catering: "Catering", events: "Events & parties",
      newMenu: "Launch a new menu", reviews: "More reviews", followers: "More followers", hiring: "Hiring staff",
    },
    tone: { friendly: "Friendly", fun: "Fun", elegant: "Elegant", family: "Family-style", bold: "Bold" },
    emojis: { yes: "Yes, love them 😋", some: "A few is fine", no: "No emojis" },
    postLangs: { en: "English", zh: "Chinese", both: "Both English & Chinese" },
    accessMeta: { done: "Done ✓", help: "I'll need help" },
    accessGoogle: { done: "Done ✓", help: "I'll need help" },
    accessTiktok: { call: "OK — let's do it on the call", none: "We don't have TikTok yet" },
    complaints: {
      contact: "Ask them to contact us directly",
      manager: "Share our manager's phone or email",
      askFirst: "Check with me first",
    },
    creatorsOk: { yes: "Yes!", maybe: "Maybe — tell me more", no: "Not right now" },
    creatorOffer: { meal1: "Free meal for 1", meal2: "Free meal for 2", drinks: "Drinks", setMenu: "A set menu / tasting", dessert: "Dessert" },
    talkLang: { en: "English", mandarin: "Mandarin (普通话)", cantonese: "Cantonese (粤语)", other: "Other" },
    reachBy: { text: "Text", call: "Phone call", wechat: "WeChat", whatsapp: "WhatsApp", email: "Email" },
    approvalSpeed: { sameDay: "Same day", fewDays: "Within 1–2 days", weekly: "Once a week, in a batch" },
  } satisfies OptionLabels,
  access: {
    title: "How to give us access",
    intro: "Add Nora as a helper on your accounts. You stay the owner, and you can remove her any time. No passwords needed.",
    emailLabel: "Nora's email to add:",
    emailFallback: "Nora's email — we'll text it to you",
    meta: {
      title: "Instagram + Facebook (one place for both)",
      steps: [
        "Open Meta Business Suite (the app, or business.facebook.com on a computer) and log in like usual.",
        "Tap Settings (the gear ⚙️).",
        "Tap People. (It may say \"Users\" or \"Business users\" instead.)",
        "Tap Invite people (or Add people), type {email}, and tap Next.",
        "Turn on your Facebook Page and Instagram account for her, then tap Invite.",
      ],
    },
    google: {
      title: "Google Business Profile (Google reviews)",
      steps: [
        "On your phone or computer, sign in to the Google account that owns your listing.",
        "Search your business name on Google. You'll see your listing with edit buttons.",
        "Tap the three dots ⋮, then Business Profile settings.",
        "Tap People and access, then tap Add.",
        "Type {email}, choose Manager, and tap Invite.",
      ],
    },
    tiktok: {
      title: "TikTok",
      body: "We'll set this up together on our call — please don't type passwords here.",
    },
    tip: "Stuck on a step? That's totally normal. Pick \"I'll need help\" and we'll do it together.",
  },
  upload: {
    pick: "Choose photos or videos",
    uploading: (done: number, total: number) => `Uploading ${done} of ${total}…`,
    done: (n: number) => (n === 1 ? "1 file added ✓" : `${n} files added ✓`),
    remove: "Remove",
    failed: "That file didn't upload. Try again, or share a link instead.",
    tooBig: (name: string) => `${name} is over 25 MB — please share it with a link instead.`,
    badType: (name: string) => `${name} isn't a photo, video or PDF.`,
  },
  errors: {
    businessName: "Please add your business name.",
    contactName: "Please add your name.",
    contactMethod: "Please add a phone number or an email so we can reach you.",
    tooLong: "That's a bit long — please shorten it.",
    email: "That email doesn't look quite right.",
    website: "That link doesn't look quite right — something like yourplace.com works.",
    pick: "Please pick one of the options.",
    fix: "Almost there — please check the highlighted answers.",
    generic: "Sorry, something went wrong on our side. Please try again in a minute — your answers are still here.",
    rateLimited: "We got a lot of tries from this connection. Please wait a little and try again.",
  } satisfies Record<IntakeErrorKey | "fix" | "generic" | "rateLimited", string>,
  thanks: {
    title: (name: string) => (name ? `Thank you, ${name}!` : "Thank you!"),
    body: "We got your answers. We're excited to work with you.",
    nextTitle: "What happens next",
    next: [
      "We'll read everything and start planning your first month.",
      "Nora will reach out to set up a short call — we'll fill in anything you skipped.",
      "You'll see every post before it goes live. Nothing is posted without your OK.",
    ],
    foot: "Questions anytime? Just text Nora.",
  },
  already: {
    title: "Thanks — we got your answers",
    body: "Your onboarding form is already in. We're on it!",
    change: "Need to change something? Just text Nora and she'll update it for you.",
  },
  expired: {
    title: "This link has expired",
    body: "No problem — just ask Nora for a new one.",
  },
  share: {
    label: "English",
    message: (business: string, url: string) =>
      `Hi! It's Nora 😊 So excited to start working with ${business}. Here's a short welcome form so we can get to know your restaurant — it takes about 10 minutes, and you can skip anything you're not sure about. It works in English and Chinese.\n\n${url}\n\nPlease don't share this link — it's just for you. Text me anytime with questions!`,
  },
};

export type IntakeCopy = typeof en;

/* ───────────────────────── 简体中文 ───────────────────────── */

const zhHans: IntakeCopy = {
  langName: "简体",
  htmlLang: "zh-Hans",
  meta: {
    title: "欢迎！让我们更了解您的餐厅",
    description: "Nora 和 Cameron 的新客户资料表（私人链接）。",
  },
  brand: "Nora & Cameron",
  common: {
    optional: "选填",
    required: "必填",
    skip: "不确定？可以先跳过，我们通电话时再聊。",
    back: "上一步",
    next: "下一步",
    start: "开始填写",
    submit: "提交",
    sending: "正在提交…",
    stepOf: (n, total) => `第 ${n} 步，共 ${total} 步`,
    choose: "请选择…",
    example: "例如：",
    restored: "欢迎回来！您之前填的内容已保存在这部手机上，可以接着填。",
    startOver: "重新填写",
    autosave: "您填写的内容会自动保存在这部设备上。",
    neverPasswords: "请不要在表格里填写任何密码，我们也绝不会向您要密码。",
    language: "语言",
    privacy: "这个链接是专门发给您的，请不要转发给别人。",
    copy: "复制",
    copied: "已复制 ✓",
  },
  welcome: {
    hi: (business) => `${business}，您好！`,
    intro:
      "我们是 Nora 和 Cameron。接下来由我们帮您打理 Instagram、Facebook、TikTok，回复 Google 评论，还会邀请 Richmond 和 757 地区的本地美食博主来探店。",
    purpose: "填写这份资料，可以让我们更快了解您的餐厅，从第一篇帖子开始就有您店里的味道。",
    points: [
      "大约 10 分钟就能填完，简单写几句就好。",
      "不确定的问题可以跳过，通电话时我们一起补上。",
      "所有内容都要经过您同意才会发布。",
      "填写内容会自动保存在手机上，中途离开也没关系，回来可以接着填。",
    ],
  },
  steps: [
    { title: "欢迎", blurb: "开始之前，先打个招呼。" },
    { title: "店铺基本信息", blurb: "就像跟新客人介绍自己的店一样。" },
    { title: "顾客和目标", blurb: "您最喜欢服务哪些客人，希望生意在哪方面更好。" },
    { title: "风格和语气", blurb: "您希望帖子给人什么样的感觉。" },
    { title: "您的账号", blurb: "在网上哪里可以找到您，以及怎样让我们帮忙管理。" },
    { title: "评论和美食博主", blurb: "怎么回复顾客评论，怎么跟本地美食博主合作。" },
    { title: "联系方式和审核", blurb: "我们该找谁沟通，以及帖子怎么给您过目。" },
  ],
  fields: {
    businessName: { label: "店名", placeholder: "Lucky Noodle House" },
    businessNameZh: { label: "中文店名", hint: "如果有中文名的话。", placeholder: "自由市场" },
    address: { label: "地址", placeholder: "123 Main St, Richmond, VA 23220" },
    phone: { label: "店里电话", placeholder: "(804) 555-0123" },
    website: { label: "网站或网上点餐链接", placeholder: "luckynoodlehouse.com" },
    hours: { label: "营业时间", hint: "怎么方便就怎么写。", placeholder: "周一至周四 11am–9pm，周五周六 11am–10pm，周日休息" },
    cuisine: { label: "主要做什么菜？店是什么类型？", placeholder: "中国超市兼卖熟食、川菜、奶茶…" },
    priceRange: { label: "价位", hint: "大概每位客人花多少钱。" },
    signatureDishes: { label: "招牌菜（3–5 道）", hint: "客人最常回头点的菜。", placeholder: "红烧牛肉面、小笼包、葱油饼" },
    dietary: { label: "店里有没有以下选择？", hint: "有的就点一下。" },
    story: { label: "用几句话说说您店里的故事", hint: "怎么开起来的、谁在掌勺、最自豪的是什么。", placeholder: "我父母 2009 年开了这家店，到现在每天早上还是手工现做…" },
    different: { label: "您的店跟别家有什么不一样？", placeholder: "城里唯一现场手工拉面；家传配方；分量特别足" },

    customers: { label: "您的主要客人是哪些人？", hint: "符合的都可以点。" },
    goals: { label: "您最希望在哪些方面有提升？", hint: "选几个最重要的。" },
    busyDays: { label: "哪几天、什么时段最忙？", placeholder: "周五周六晚上，周日中午" },
    slowDays: { label: "哪几天、什么时段比较淡？", hint: "这些时段我们可以想办法帮您带人气。", placeholder: "周一到周三下午" },
    upcoming: { label: "近期有什么活动？", hint: "促销、节日、活动、新菜都可以写。", placeholder: "二月有春节套餐；五月店庆打折" },

    tone: { label: "您希望帖子是什么感觉？", hint: "选一两个就好。" },
    emojis: { label: "帖子里可以用表情符号吗？" },
    postLangs: { label: "帖子用什么语言发？" },
    avoid: { label: "有没有不想用的字眼或不想提的话题？", placeholder: "不要说“便宜”；不谈政治；不要跟别的餐厅比较" },
    likedAccounts: { label: "有哪些账号的风格是您喜欢的？", hint: "任何商家或博主都可以，贴链接或 @名字。", placeholder: "@someplace, @anotherplace" },
    mediaLink: {
      label: "Logo、照片和视频：分享一个链接",
      hint: "把文件放进 Google Drive、Dropbox 或 iCloud 的文件夹，点“共享”，设成“任何知道链接的人都能查看”，再把链接贴在这里。",
      placeholder: "https://drive.google.com/…",
    },

    instagram: { label: "Instagram", placeholder: "@yourplace" },
    facebook: { label: "Facebook 专页", hint: "贴链接，或写专页名称都可以。", placeholder: "facebook.com/yourplace" },
    tiktok: { label: "TikTok", placeholder: "@yourplace" },
    google: { label: "Google 商家资料", hint: "贴 Google 地图链接，或直接写“搜索 Lucky Noodle House Richmond”。", placeholder: "maps.app.goo.gl/… 或我们该搜的店名" },
    yelp: { label: "Yelp", placeholder: "yelp.com/biz/…" },
    accessMeta: { label: "Instagram + Facebook 权限" },
    accessGoogle: { label: "Google 商家资料权限" },
    accessTiktok: { label: "TikTok 权限" },

    signoff: { label: "回复评论时用什么落款？", placeholder: "— Lucky Noodle House 全体员工" },
    complaints: { label: "遇到差评时，我们应该…" },
    managerContact: { label: "处理投诉可以公开的电话或邮箱", hint: "上面选了这一项才需要填。", placeholder: "经理 Lily，(804) 555-0199" },
    neverMention: { label: "回复评论时有没有绝对不能提的事？", placeholder: "不要提退款；不要说员工名字" },
    creatorsOk: { label: "可以邀请本地美食博主来店里探店、发帖吗？" },
    creatorOffer: { label: "博主来探店，您可以提供什么？", hint: "可以多选。您同意之前，我们不会答应博主任何事。" },
    offerNote: { label: "关于招待还有什么要说明的？", placeholder: "餐费 $60 以内；只限平日" },
    visitTimes: { label: "哪几天、什么时段方便博主来？", placeholder: "周二到周四，下午 2–5 点（午餐和晚餐之间）" },
    noFilm: { label: "有没有不希望博主拍的地方？", placeholder: "厨房；客人的脸；后面办公室" },

    contactName: { label: "您的姓名", placeholder: "Lily Chen / 陈丽" },
    contactRole: { label: "您的职位", placeholder: "老板、经理…" },
    contactPhone: { label: "手机号码", placeholder: "(804) 555-0123" },
    contactEmail: { label: "电子邮箱", hint: "每月的成果报告会发到这个邮箱。", placeholder: "you@example.com" },
    talkLang: { label: "您习惯用什么语言沟通？" },
    talkLangOther: { label: "其他语言", placeholder: "福州话、越南语…" },
    reachBy: { label: "怎么联系您最方便？", hint: "方便的都可以点。" },
    wechatId: { label: "微信号或 WhatsApp 号码", hint: "如果上面选了微信或 WhatsApp。" },
    approver: { label: "谁来审核帖子？", placeholder: "我本人 / 我女儿 Amy / 店经理" },
    approvalSpeed: { label: "帖子发给您看，一般多快能回复？" },
    anythingElse: { label: "还有什么想告诉我们的吗？", placeholder: "问题、顾虑、想法，什么都可以。" },
    uploads: { label: "或者直接从手机上传", hint: "照片、视频或 Logo，每个文件 25 MB 以内。" },
  },
  needContact: "请至少留一个电话或邮箱，方便我们联系您。",
  options: {
    priceRange: { "1": "$ · 每人 $15 以下", "2": "$$ · $15–30", "3": "$$$ · $30–60", "4": "$$$$ · $60 以上" },
    dietary: { vegetarian: "素食", vegan: "纯素（不含蛋奶）", glutenFree: "无麸质", halal: "清真" },
    customers: {
      families: "家庭客", students: "学生", office: "上班族", dateNight: "情侣约会", tourists: "游客和外地客",
      chinese: "华人顾客", seniors: "长者", groups: "聚餐和派对", takeout: "常点外卖的客人",
    },
    goals: {
      walkIns: "更多堂食客人", onlineOrders: "更多网上订单", catering: "接更多 Catering（团体订餐）", events: "活动和包场",
      newMenu: "推出新菜单", reviews: "更多好评", followers: "更多粉丝", hiring: "招聘员工",
    },
    tone: { friendly: "亲切", fun: "有趣", elegant: "高雅", family: "家常温馨", bold: "大胆吸睛" },
    emojis: { yes: "可以，很喜欢 😋", some: "少量就好", no: "不要用" },
    postLangs: { en: "英文", zh: "中文", both: "中英文都要" },
    accessMeta: { done: "已完成 ✓", help: "需要你们帮忙" },
    accessGoogle: { done: "已完成 ✓", help: "需要你们帮忙" },
    accessTiktok: { call: "好的，通电话时一起设置", none: "我们还没有 TikTok" },
    complaints: {
      contact: "请客人直接联系我们店",
      manager: "留经理的电话或邮箱给客人",
      askFirst: "每次先问过我再回复",
    },
    creatorsOk: { yes: "可以！", maybe: "也许，想先多了解一下", no: "暂时不用" },
    creatorOffer: { meal1: "招待 1 人用餐", meal2: "招待 2 人用餐", drinks: "饮料", setMenu: "套餐或试吃", dessert: "甜品" },
    talkLang: { en: "英语", mandarin: "普通话", cantonese: "粤语（广东话）", other: "其他" },
    reachBy: { text: "短信", call: "打电话", wechat: "微信", whatsapp: "WhatsApp", email: "邮件" },
    approvalSpeed: { sameDay: "当天", fewDays: "一两天内", weekly: "每周集中看一次" },
  },
  access: {
    title: "怎样给我们管理权限",
    intro: "把 Nora 加为账号的协助管理员就可以。账号还是您的，随时可以把她移除。不需要给我们密码。",
    emailLabel: "请添加 Nora 的邮箱：",
    emailFallback: "Nora 的邮箱（我们会发短信告诉您）",
    meta: {
      title: "Instagram + Facebook（在同一个地方设置）",
      steps: [
        "打开 Meta Business Suite（Meta 官方的商家管理工具）App，或在电脑浏览器打开 business.facebook.com，照常登录。",
        "点“设置”（齿轮图标 ⚙️，英文叫 Settings）。",
        "点“人员”（英文 People，有时显示为“用户”或“企业用户”）。",
        "点“邀请人员”或“添加人员”（Invite people / Add people），输入 {email}，再点“下一步”（Next）。",
        "勾选您的 Facebook 专页和 Instagram 账号，然后点“邀请”（Invite）。",
      ],
    },
    google: {
      title: "Google 商家资料（Google 评论）",
      steps: [
        "在手机或电脑上，登录管理您店铺资料的那个 Google 账号。",
        "在 Google 搜索您的店名，会看到带编辑按钮的商家资料。",
        "点三个点 ⋮，再点“商家资料设置”（Business Profile settings）。",
        "点“用户和访问权限”（People and access），再点“添加”（Add）。",
        "输入 {email}，角色选“管理员”（Manager），再点“邀请”（Invite）。",
      ],
    },
    tiktok: {
      title: "TikTok",
      body: "TikTok 我们通电话时一起设置。请不要在这里填写密码。",
    },
    tip: "哪一步卡住了很正常，选“需要你们帮忙”，我们一起设置。",
  },
  upload: {
    pick: "选择照片或视频",
    uploading: (done, total) => `正在上传 ${done}/${total}…`,
    done: (n) => `已添加 ${n} 个文件 ✓`,
    remove: "移除",
    failed: "文件没有传上去。请再试一次，或改用分享链接。",
    tooBig: (name) => `${name} 超过 25 MB，请改用分享链接。`,
    badType: (name) => `${name} 不是照片、视频或 PDF。`,
  },
  errors: {
    businessName: "请填写店名。",
    contactName: "请填写您的姓名。",
    contactMethod: "请至少留一个电话或邮箱，方便我们联系您。",
    tooLong: "内容有点长，请精简一下。",
    email: "邮箱格式好像不太对。",
    website: "链接好像不太对，像 yourplace.com 这样就可以。",
    pick: "请从选项中选一个。",
    fix: "快好了！请看一下标出来的地方。",
    generic: "抱歉，我们这边出了点问题。请过一分钟再试，您填的内容都还在。",
    rateLimited: "提交次数有点多，请稍等一会儿再试。",
  },
  thanks: {
    title: (name) => (name ? `谢谢您，${name}！` : "谢谢您！"),
    body: "我们已经收到您的资料，非常期待跟您合作！",
    nextTitle: "接下来",
    next: [
      "我们会仔细看完您的资料，开始规划第一个月的内容。",
      "Nora 会联系您约一个简短的电话，把您跳过的问题一起补上。",
      "每篇帖子发布前都会先给您过目，没有您同意不会发布。",
    ],
    foot: "有任何问题，随时发短信给 Nora。",
  },
  already: {
    title: "谢谢，我们已经收到您的资料",
    body: "您的资料表已经提交，我们正在准备中！",
    change: "需要修改什么吗？直接发短信给 Nora，她会帮您更新。",
  },
  expired: {
    title: "这个链接已经失效",
    body: "没关系，请找 Nora 要一个新的链接。",
  },
  share: {
    label: "简体中文",
    message: (business, url) =>
      `您好！我是 Nora 😊 很高兴开始跟 ${business} 合作。这是一份简单的新客户资料表，帮我们更了解您的餐厅，大约 10 分钟就能填完，不确定的问题可以跳过。表格有中英文版本。\n\n${url}\n\n这个链接是专门给您的，请不要转发。有任何问题随时联系我！`,
  },
};

/* ───────────────────────── 繁體中文 ───────────────────────── */

const zhHant: IntakeCopy = {
  langName: "繁體",
  htmlLang: "zh-Hant",
  meta: {
    title: "歡迎！讓我們更認識您的餐廳",
    description: "Nora 和 Cameron 的新客戶資料表（私人連結）。",
  },
  brand: "Nora & Cameron",
  common: {
    optional: "選填",
    required: "必填",
    skip: "不確定？可以先跳過，我們通電話時再聊。",
    back: "上一步",
    next: "下一步",
    start: "開始填寫",
    submit: "送出",
    sending: "正在送出…",
    stepOf: (n, total) => `第 ${n} 步，共 ${total} 步`,
    choose: "請選擇…",
    example: "例如：",
    restored: "歡迎回來！您之前填的內容已存在這支手機上，可以接著填。",
    startOver: "重新填寫",
    autosave: "您填寫的內容會自動儲存在這個裝置上。",
    neverPasswords: "請不要在表格裡填寫任何密碼，我們也絕對不會跟您要密碼。",
    language: "語言",
    privacy: "這個連結是專門給您的，請不要轉傳給別人。",
    copy: "複製",
    copied: "已複製 ✓",
  },
  welcome: {
    hi: (business) => `${business}，您好！`,
    intro:
      "我們是 Nora 和 Cameron。接下來由我們幫您經營 Instagram、Facebook、TikTok，回覆 Google 評論，也會邀請 Richmond 和 757 地區的在地美食網紅來店裡試吃分享。",
    purpose: "填好這份資料，我們就能更快認識您的餐廳，從第一篇貼文開始就有您店裡的味道。",
    points: [
      "大約 10 分鐘就能填完，簡單寫幾句就好。",
      "不確定的問題可以跳過，通電話時我們一起補上。",
      "所有內容都要經過您同意才會發布。",
      "填寫內容會自動存在手機上，中途離開也沒關係，回來可以接著填。",
    ],
  },
  steps: [
    { title: "歡迎", blurb: "開始之前，先打聲招呼。" },
    { title: "店家基本資料", blurb: "就像跟新客人介紹自己的店一樣。" },
    { title: "客人和目標", blurb: "您最喜歡招待哪些客人，希望生意在哪方面更好。" },
    { title: "風格和語氣", blurb: "您希望貼文給人什麼樣的感覺。" },
    { title: "您的帳號", blurb: "在網路上哪裡找得到您，以及怎麼讓我們幫忙管理。" },
    { title: "評論和美食網紅", blurb: "怎麼回覆客人評論，怎麼跟在地美食網紅合作。" },
    { title: "聯絡方式和審核", blurb: "我們該找誰溝通，以及貼文怎麼給您過目。" },
  ],
  fields: {
    businessName: { label: "店名", placeholder: "Lucky Noodle House" },
    businessNameZh: { label: "中文店名", hint: "如果有中文名的話。", placeholder: "自由市場" },
    address: { label: "地址", placeholder: "123 Main St, Richmond, VA 23220" },
    phone: { label: "店裡電話", placeholder: "(804) 555-0123" },
    website: { label: "網站或線上點餐連結", placeholder: "luckynoodlehouse.com" },
    hours: { label: "營業時間", hint: "怎麼方便就怎麼寫。", placeholder: "週一至週四 11am–9pm，週五週六 11am–10pm，週日公休" },
    cuisine: { label: "主要賣什麼？店是什麼類型？", placeholder: "亞洲超市加熟食、川菜、手搖飲…" },
    priceRange: { label: "價位", hint: "大概每位客人花多少錢。" },
    signatureDishes: { label: "招牌菜（3–5 道）", hint: "客人最常回頭點的菜。", placeholder: "紅燒牛肉麵、小籠包、蔥油餅" },
    dietary: { label: "店裡有沒有以下選擇？", hint: "有的就點一下。" },
    story: { label: "用幾句話說說您店裡的故事", hint: "怎麼開始的、誰在掌廚、最自豪的是什麼。", placeholder: "我爸媽 2009 年開了這家店，到現在每天早上還是手工現做…" },
    different: { label: "您的店跟別家有什麼不一樣？", placeholder: "城裡唯一現場手工拉麵；家傳配方；份量特別大" },

    customers: { label: "您的主要客人是哪些人？", hint: "符合的都可以點。" },
    goals: { label: "您最希望在哪些方面有進步？", hint: "選幾個最重要的。" },
    busyDays: { label: "哪幾天、什麼時段最忙？", placeholder: "週五週六晚上，週日中午" },
    slowDays: { label: "哪幾天、什麼時段比較冷清？", hint: "這些時段我們可以想辦法幫您帶人潮。", placeholder: "週一到週三下午" },
    upcoming: { label: "近期有什麼活動？", hint: "促銷、節日、活動、新菜都可以寫。", placeholder: "二月有農曆新年套餐；五月週年慶打折" },

    tone: { label: "您希望貼文是什麼感覺？", hint: "選一兩個就好。" },
    emojis: { label: "貼文裡可以用表情符號嗎？" },
    postLangs: { label: "貼文用什麼語言發？" },
    avoid: { label: "有沒有不想用的字眼或不想提的話題？", placeholder: "不要說「便宜」；不談政治；不要跟別家餐廳比較" },
    likedAccounts: { label: "有哪些帳號的風格是您喜歡的？", hint: "任何店家或網紅都可以，貼連結或 @名稱。", placeholder: "@someplace, @anotherplace" },
    mediaLink: {
      label: "Logo、照片和影片：分享一個連結",
      hint: "把檔案放進 Google Drive、Dropbox 或 iCloud 的資料夾，點「共用」，設定成「知道連結的任何人都能檢視」，再把連結貼在這裡。",
      placeholder: "https://drive.google.com/…",
    },

    instagram: { label: "Instagram", placeholder: "@yourplace" },
    facebook: { label: "Facebook 粉絲專頁", hint: "貼連結，或寫粉專名稱都可以。", placeholder: "facebook.com/yourplace" },
    tiktok: { label: "TikTok", placeholder: "@yourplace" },
    google: { label: "Google 商家檔案", hint: "貼 Google 地圖連結，或直接寫「搜尋 Lucky Noodle House Richmond」。", placeholder: "maps.app.goo.gl/… 或我們該搜尋的店名" },
    yelp: { label: "Yelp", placeholder: "yelp.com/biz/…" },
    accessMeta: { label: "Instagram + Facebook 權限" },
    accessGoogle: { label: "Google 商家檔案權限" },
    accessTiktok: { label: "TikTok 權限" },

    signoff: { label: "回覆評論時用什麼署名？", placeholder: "— Lucky Noodle House 全體同仁" },
    complaints: { label: "遇到負評時，我們應該…" },
    managerContact: { label: "處理客訴可以公開的電話或 Email", hint: "上面選了這一項才需要填。", placeholder: "經理 Lily，(804) 555-0199" },
    neverMention: { label: "回覆評論時有沒有絕對不能提的事？", placeholder: "不要提退款；不要說員工名字" },
    creatorsOk: { label: "可以邀請在地美食網紅來店裡試吃、發文分享嗎？" },
    creatorOffer: { label: "網紅來店裡，您可以提供什麼？", hint: "可以複選。您同意之前，我們不會答應網紅任何事。" },
    offerNote: { label: "關於招待還有什麼要說明的？", placeholder: "餐費 $60 以內；只限平日" },
    visitTimes: { label: "哪幾天、什麼時段方便網紅來？", placeholder: "週二到週四，下午 2–5 點（午餐和晚餐之間）" },
    noFilm: { label: "有沒有不希望網紅拍的地方？", placeholder: "廚房；客人的臉；後面辦公室" },

    contactName: { label: "您的姓名", placeholder: "Lily Chen / 陳麗" },
    contactRole: { label: "您的職稱", placeholder: "老闆、經理…" },
    contactPhone: { label: "手機號碼", placeholder: "(804) 555-0123" },
    contactEmail: { label: "Email", hint: "每月的成果報告會寄到這個信箱。", placeholder: "you@example.com" },
    talkLang: { label: "您習慣用什麼語言溝通？" },
    talkLangOther: { label: "其他語言", placeholder: "台語、福州話、越南語…" },
    reachBy: { label: "怎麼聯絡您最方便？", hint: "方便的都可以點。" },
    wechatId: { label: "微信 ID 或 WhatsApp 號碼", hint: "如果上面選了微信或 WhatsApp。" },
    approver: { label: "誰來審核貼文？", placeholder: "我本人 / 我女兒 Amy / 店經理" },
    approvalSpeed: { label: "貼文傳給您看，通常多快能回覆？" },
    anythingElse: { label: "還有什麼想告訴我們的嗎？", placeholder: "問題、顧慮、想法，什麼都可以。" },
    uploads: { label: "或是直接從手機上傳", hint: "照片、影片或 Logo，每個檔案 25 MB 以內。" },
  },
  needContact: "請至少留一個電話或 Email，方便我們聯絡您。",
  options: {
    priceRange: { "1": "$ · 每人 $15 以下", "2": "$$ · $15–30", "3": "$$$ · $30–60", "4": "$$$$ · $60 以上" },
    dietary: { vegetarian: "素食", vegan: "全素（不含蛋奶）", glutenFree: "無麩質", halal: "清真" },
    customers: {
      families: "家庭客", students: "學生", office: "上班族", dateNight: "情侶約會", tourists: "觀光客和外地客",
      chinese: "華人客群", seniors: "長輩", groups: "聚餐和派對", takeout: "外帶和外送常客",
    },
    goals: {
      walkIns: "更多內用客人", onlineOrders: "更多線上訂單", catering: "接更多外燴（Catering）", events: "活動和包場",
      newMenu: "推出新菜單", reviews: "更多好評", followers: "更多粉絲", hiring: "招募員工",
    },
    tone: { friendly: "親切", fun: "有趣", elegant: "高雅", family: "家常溫馨", bold: "大膽吸睛" },
    emojis: { yes: "可以，很喜歡 😋", some: "少量就好", no: "不要用" },
    postLangs: { en: "英文", zh: "中文", both: "中英文都要" },
    accessMeta: { done: "已完成 ✓", help: "需要你們幫忙" },
    accessGoogle: { done: "已完成 ✓", help: "需要你們幫忙" },
    accessTiktok: { call: "好的，通電話時一起設定", none: "我們還沒有 TikTok" },
    complaints: {
      contact: "請客人直接聯絡我們店",
      manager: "留經理的電話或 Email 給客人",
      askFirst: "每次先問過我再回覆",
    },
    creatorsOk: { yes: "可以！", maybe: "也許，想先多了解一下", no: "暫時不用" },
    creatorOffer: { meal1: "招待 1 人用餐", meal2: "招待 2 人用餐", drinks: "飲料", setMenu: "套餐或試吃", dessert: "甜點" },
    talkLang: { en: "英文", mandarin: "國語（普通話）", cantonese: "粵語（廣東話）", other: "其他" },
    reachBy: { text: "簡訊", call: "打電話", wechat: "微信", whatsapp: "WhatsApp", email: "Email" },
    approvalSpeed: { sameDay: "當天", fewDays: "一兩天內", weekly: "每週集中看一次" },
  },
  access: {
    title: "怎麼給我們管理權限",
    intro: "把 Nora 加為帳號的協助管理員就可以。帳號還是您的，隨時可以把她移除。不需要給我們密碼。",
    emailLabel: "請新增 Nora 的 Email：",
    emailFallback: "Nora 的 Email（我們會傳簡訊告訴您）",
    meta: {
      title: "Instagram + Facebook（在同一個地方設定）",
      steps: [
        "打開 Meta Business Suite（Meta 官方的商家管理工具）App，或在電腦瀏覽器打開 business.facebook.com，照常登入。",
        "點「設定」（齒輪圖示 ⚙️，英文是 Settings）。",
        "點「人員」（英文 People，有時會顯示「使用者」或「企業用戶」）。",
        "點「邀請人員」或「新增人員」（Invite people / Add people），輸入 {email}，再點「下一步」（Next）。",
        "勾選您的 Facebook 粉絲專頁和 Instagram 帳號，然後點「邀請」（Invite）。",
      ],
    },
    google: {
      title: "Google 商家檔案（Google 評論）",
      steps: [
        "在手機或電腦上，登入管理您店家檔案的那個 Google 帳號。",
        "在 Google 搜尋您的店名，會看到有編輯按鈕的商家檔案。",
        "點三個點 ⋮，再點「商家檔案設定」（Business Profile settings）。",
        "點「使用者和存取權」（People and access），再點「新增」（Add）。",
        "輸入 {email}，角色選「管理員」（Manager），再點「邀請」（Invite）。",
      ],
    },
    tiktok: {
      title: "TikTok",
      body: "TikTok 我們通電話時一起設定。請不要在這裡填寫密碼。",
    },
    tip: "哪一步卡住了很正常，選「需要你們幫忙」，我們一起設定。",
  },
  upload: {
    pick: "選擇照片或影片",
    uploading: (done, total) => `正在上傳 ${done}/${total}…`,
    done: (n) => `已新增 ${n} 個檔案 ✓`,
    remove: "移除",
    failed: "檔案沒有傳上去。請再試一次，或改用分享連結。",
    tooBig: (name) => `${name} 超過 25 MB，請改用分享連結。`,
    badType: (name) => `${name} 不是照片、影片或 PDF。`,
  },
  errors: {
    businessName: "請填寫店名。",
    contactName: "請填寫您的姓名。",
    contactMethod: "請至少留一個電話或 Email，方便我們聯絡您。",
    tooLong: "內容有點長，請精簡一下。",
    email: "Email 格式好像不太對。",
    website: "連結好像不太對，像 yourplace.com 這樣就可以。",
    pick: "請從選項中選一個。",
    fix: "快好了！請看一下標示出來的地方。",
    generic: "抱歉，我們這邊出了點問題。請過一分鐘再試，您填的內容都還在。",
    rateLimited: "送出次數有點多，請稍等一下再試。",
  },
  thanks: {
    title: (name) => (name ? `謝謝您，${name}！` : "謝謝您！"),
    body: "我們已經收到您的資料，非常期待跟您合作！",
    nextTitle: "接下來",
    next: [
      "我們會仔細看完您的資料，開始規劃第一個月的內容。",
      "Nora 會聯絡您約一個簡短的電話，把您跳過的問題一起補上。",
      "每篇貼文發布前都會先給您過目，沒有您同意不會發布。",
    ],
    foot: "有任何問題，隨時傳簡訊給 Nora。",
  },
  already: {
    title: "謝謝，我們已經收到您的資料",
    body: "您的資料表已經送出，我們正在準備中！",
    change: "需要修改什麼嗎？直接傳簡訊給 Nora，她會幫您更新。",
  },
  expired: {
    title: "這個連結已經失效",
    body: "沒關係，請跟 Nora 要一個新的連結。",
  },
  share: {
    label: "繁體中文",
    message: (business, url) =>
      `您好！我是 Nora 😊 很開心開始跟 ${business} 合作。這是一份簡單的新客戶資料表，幫我們更認識您的餐廳，大約 10 分鐘就能填完，不確定的問題可以跳過。表格有中英文版本。\n\n${url}\n\n這個連結是專門給您的，請不要轉傳。有任何問題隨時聯絡我！`,
  },
};

export const INTAKE_COPY: Record<IntakeLangCode, IntakeCopy> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant };

export function intakeCopy(lang: IntakeLangCode): IntakeCopy {
  return INTAKE_COPY[lang] ?? en;
}

/** Short tag for the team view ("Answered in 简体"). */
export const INTAKE_LANG_TAG: Record<IntakeLangCode, string> = { en: "English", "zh-Hans": "简体", "zh-Hant": "繁體" };

/** English label for an option value (team view, notes, Claude). */
export function intakeOptionLabel<F extends ChoiceField>(field: F, value: string): string {
  const labels = en.options[field] as Record<string, string>;
  return labels[value] ?? value;
}

/* ───────────────────────── Welcome sentence, tailored ───────────────────────── */

/** What we do for this business, as the welcome step words it. Mirrors onboard-services' service names. */
export type WelcomeService = "instagram" | "facebook" | "tiktok" | "google" | "creators" | "collab";

/**
 * The client's active monthly plan → which services to mention. Platform items name themselves; creator outreach
 * and collabs are recognised by title (the plan has no service column).
 */
export function welcomeServicesFromPlan(items: ReadonlyArray<{ title: string; platform: string; active: boolean }>): WelcomeService[] {
  const out = new Set<WelcomeService>();
  for (const d of items) {
    if (!d.active) continue;
    const t = d.title.toLowerCase();
    if (/collab/.test(t)) out.add("collab");
    else if (/creator|influencer|outreach/.test(t)) out.add("creators");
    else if (d.platform === "instagram" || d.platform === "facebook" || d.platform === "tiktok" || d.platform === "google") out.add(d.platform);
  }
  return (["instagram", "facebook", "tiktok", "google", "creators", "collab"] as const).filter((s) => out.has(s));
}

const SOCIAL = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" } as const;

/** "a", "a and b", "a, b and c" — or the Chinese "a、b和c". */
function listJoin(items: string[], lang: IntakeLangCode): string {
  if (items.length <= 1) return items[0] ?? "";
  const last = items[items.length - 1];
  const head = items.slice(0, -1);
  if (lang === "en") return `${head.join(", ")} and ${last}`;
  return `${head.join("、")} 和 ${last}`;
}

/**
 * The welcome step's "what we'll do" sentence, built from the client's plan and creator search areas
 * (clients.outreachAreas), in natural English / 简体 / 繁體. With no plan, falls back to a general sentence.
 */
export function welcomeIntro(lang: IntakeLangCode, opts: { services: readonly WelcomeService[]; areas?: string | null }): string {
  const has = (s: WelcomeService) => opts.services.includes(s);
  const social = (["instagram", "facebook", "tiktok"] as const).filter(has).map((s) => SOCIAL[s]);
  const areas = (opts.areas ?? "").split(/[,;\n]+/).map((a) => a.trim()).filter(Boolean).slice(0, 4);
  const google = has("google");
  const creators = has("creators");
  const collab = has("collab");

  if (!social.length && !google && !creators && !collab) {
    return {
      en: "We're Nora & Cameron. We'll help with your social media and online reviews, so more people find your restaurant.",
      "zh-Hans": "我们是 Nora 和 Cameron，会帮您打理社交媒体和网上评论，让更多人认识您的餐厅。",
      "zh-Hant": "我們是 Nora 和 Cameron，會幫您經營社群媒體和網路評論，讓更多人認識您的餐廳。",
    }[lang];
  }

  if (lang === "en") {
    const jobs = [
      social.length ? `take care of your ${listJoin(social, "en")}` : null,
      google ? "reply to your Google reviews" : null,
    ].filter((x): x is string => !!x);
    const parts = ["We're Nora & Cameron."];
    if (jobs.length) parts.push(`We'll ${jobs.join(social.length > 1 ? ", and " : " and ")}.`);
    if (creators) {
      const where = areas.length ? ` from ${listJoin(areas, "en")}` : "";
      parts.push(`We'll ${jobs.length ? "also " : ""}invite local food creators${where} to visit.`);
    }
    if (collab) parts.push(`Nora will ${jobs.length || creators ? "also " : ""}come by to film and post about your food herself.`);
    return parts.join(" ");
  }

  const hans = lang === "zh-Hans";
  const jobs = [
    social.length ? `${hans ? "帮您打理" : "幫您經營"} ${social.join("、")}` : null,
    google ? (social.length ? (hans ? "回复 Google 评论" : "回覆 Google 評論") : hans ? "帮您回复 Google 评论" : "幫您回覆 Google 評論") : null,
  ].filter((x): x is string => !!x);
  const where = areas.length ? ` ${listJoin(areas, lang)} ${hans ? "地区的" : "地區的"}` : "";
  const creatorClause = hans ? `邀请${where || ""}本地美食博主来探店` : `邀請${where || ""}在地美食網紅來店裡試吃分享`;
  let text = hans ? "我们是 Nora 和 Cameron。" : "我們是 Nora 和 Cameron。";
  if (jobs.length) {
    text += `${hans ? "接下来由我们" : "接下來由我們"}${jobs.join("，")}`;
    text += creators ? `，${hans ? "还会" : "也會"}${creatorClause}。` : "。";
  } else if (creators) {
    text += `${hans ? "接下来我们会" : "接下來我們會"}${creatorClause}。`;
  }
  if (collab) {
    const also = jobs.length || creators;
    text += hans ? `Nora ${also ? "也会" : "会"}亲自到店拍摄，分享您的美食。` : `Nora ${also ? "也會" : "會"}親自到店拍攝，分享您的美食。`;
  }
  return text.replace(/\s+([，。])/g, "$1").replace(/邀请\s+/g, "邀请 ").replace(/邀請\s+/g, "邀請 ");
}
