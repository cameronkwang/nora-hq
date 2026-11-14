/**
 * Client onboarding form (/start/[token]) — every word a client sees (3 short pages; page 1 alone is enough to
 * send), in English, 简体中文 and 繁體中文.
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

import type { OwnerCardFact } from "./business-facts";

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

/**
 * Three short pages; a busy owner can finish page 1 in under a minute and send.
 *   1 · "Is this right?": the public facts we looked up BEFORE sending (name, address, hours, phone, website,
 *       Instagram, TikTok, Facebook) on one card, confirmed with one tap or corrected in one text box; then how to
 *       reach them. The only page with required answers (their name + a phone or email).
 *   2 · Accounts & photos (optional): access to Instagram + Facebook and Google, the accounts we couldn't find, photos.
 *   3 · How we'll work together (optional): what to show off and a few closed choices.
 * Public facts are never asked: Claude looks them up before the form goes out (lib/business-facts).
 */
export const INTAKE_STEP_COUNT = 3;

type TextKind = "line" | "block";
const t = (kind: TextKind, max: number, step: number) => ({ kind, max, step }) as const;

/** Every free-text answer on the current form: kind, length cap, and the step (0-based) it's on. */
export const TEXT_FIELDS = {
  /** "Something's off": the ONE box where the owner says what to fix in the facts we showed them. */
  factsFix: t("block", 1000, 0),
  contactName: t("line", 120, 0),
  contactPhone: t("line", 40, 0),
  contactEmail: t("line", 200, 0),
  talkLangOther: t("line", 80, 0),

  /** Only asked when we couldn't find the account ourselves. */
  instagram: t("line", 200, 1),
  tiktok: t("line", 200, 1),
  facebook: t("line", 300, 1),
  mediaLink: t("line", 500, 1),

  promote: t("block", 2000, 2),
  anythingElse: t("block", 3000, 2),
} as const;
export type TextField = keyof typeof TEXT_FIELDS;

const o = <const M extends boolean, const T extends readonly string[]>(multi: M, step: number, values: T) => ({ multi, step, values });

/** Every choice answer on the current form: single (radio) or multi (chips), its step, and its option values. */
export const CHOICE_FIELDS = {
  /** One tap under the "Is this right?" card. */
  factsOk: o(false, 0, ["yes", "no"]),
  reachBy: o(true, 0, ["text", "call", "wechat", "whatsapp", "email"]),
  talkLang: o(false, 0, ["en", "mandarin", "cantonese", "other"]),
  accessMeta: o(false, 1, ["done", "help"]),
  accessGoogle: o(false, 1, ["done", "help"]),
  postLangs: o(false, 2, ["en", "zh", "both"]),
  creatorsOk: o(false, 2, ["yes", "maybe", "no"]),
  creatorOffer: o(true, 2, ["meal1", "meal2", "drinks", "setMenu", "dessert"]),
  complaints: o(false, 2, ["contact", "manager", "askFirst"]),
} as const;
export type ChoiceField = keyof typeof CHOICE_FIELDS;
export type ChoiceValue<F extends ChoiceField> = (typeof CHOICE_FIELDS)[F]["values"][number];
export type IntakeField = TextField | ChoiceField | "uploads";

/** Which answers live on which step. Drives the form, the team view and "Copy all". */
export const INTAKE_STEP_FIELDS: IntakeField[][] = [
  ["factsOk", "factsFix", "contactName", "contactPhone", "contactEmail", "reachBy", "talkLang", "talkLangOther"],
  ["instagram", "tiktok", "facebook", "accessMeta", "accessGoogle", "mediaLink", "uploads"],
  ["promote", "postLangs", "creatorsOk", "creatorOffer", "complaints", "anythingElse"],
];

type OptionLabels = { [F in ChoiceField]: Record<ChoiceValue<F>, string> };
type FieldCopy = { label: string; hint?: string; placeholder?: string };

/** The language the owner most likely wants to talk in, from the language they read the form in. They can change it. */
export const TALK_LANG_DEFAULT: Record<IntakeLangCode, ChoiceValue<"talkLang">> = { en: "en", "zh-Hans": "mandarin", "zh-Hant": "mandarin" };

/** The facts on the "Is this right?" card (after the business name): each needs a label in every language. */
export type IntakeFactKey = OwnerCardFact;

/** Error keys the server returns; each language words them. */
export type IntakeErrorKey = "contactName" | "contactMethod" | "tooLong" | "email" | "pick" | "secret";

/* ───────────────────────── English ───────────────────────── */

const en = {
  langName: "English",
  htmlLang: "en",
  meta: {
    title: "Welcome — let's get you set up",
    description: "A short, private onboarding form from Nora & Cameron.",
  },
  brand: "Nora & Cameron",
  common: {
    optional: "optional",
    required: "needed",
    skip: "Everything on this page is optional. Skip anything you're not sure about — we'll ask on our call.",
    back: "Back",
    next: "Next",
    submit: "Send my answers",
    sendNow: "Send now",
    sending: "Sending…",
    oneMoreMinute: "Got one more minute?",
    thatsAll: "That's all we need! Tap “Send now” — or tap Next if you've got one more minute for a few optional questions.",
    stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
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
    hi: (business: string) => `Hi ${business}! 👋`,
    line: "This takes about a minute. Nothing is posted without your OK — and please never send passwords here.",
  },
  /** The "Is this right?" card on page 1: what we found, shown back to the owner. */
  facts: {
    title: "Is this right?",
    intro: "Here's what we found about your business, so you don't have to type it.",
    labels: { name: "Name", address: "Address", hours: "Hours", phone: "Phone", website: "Website", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" } satisfies Record<IntakeFactKey | "name", string>,
  },
  /** Page 1 when we have nothing to show back (no card). */
  aboutYou: { title: "About you", blurb: "How we can reach you." },
  contactTitle: "How do we reach you?",
  /** Page 2: accounts we couldn't find ourselves. */
  handles: { title: "Your accounts", intro: "We couldn't find these. Add them if you have them — or skip." },
  steps: [
    { title: "Is this right?", blurb: "Check what we found, then tell us how to reach you." },
    { title: "Accounts & photos", blurb: "Let us into your accounts (no passwords), and share a few photos." },
    { title: "How we'll work together", blurb: "What to show off, plus a few quick choices." },
  ],
  fields: {
    factsOk: { label: "Is this right?" },
    factsFix: { label: "What should we fix?", hint: "Tell us in your own words — we'll update it.", placeholder: "We close at 10pm on Fridays; the phone number is old." },
    contactName: { label: "Your name", placeholder: "Lily Chen" },
    contactPhone: { label: "Mobile phone", placeholder: "(804) 555-0123" },
    contactEmail: { label: "Email", hint: "We'll send your monthly report here.", placeholder: "you@example.com" },
    reachBy: { label: "Best way to reach you", hint: "Tap all that work." },
    talkLang: { label: "Language you'd like us to talk in" },
    talkLangOther: { label: "Which language?", placeholder: "Fujianese, Vietnamese…" },

    instagram: { label: "Instagram", placeholder: "@yourplace" },
    tiktok: { label: "TikTok", placeholder: "@yourplace" },
    facebook: { label: "Facebook page", hint: "Paste the link, or type the page name.", placeholder: "facebook.com/yourplace" },
    accessMeta: { label: "Instagram + Facebook access" },
    accessGoogle: { label: "Google Business access" },
    mediaLink: {
      label: "Logo, photos and videos — share a link",
      hint: "A Google Drive, Dropbox or iCloud folder works. Set sharing to \"Anyone with the link\" and paste it here.",
      placeholder: "https://drive.google.com/…",
    },
    uploads: { label: "Or upload from this phone", hint: "Photos, videos or your logo. Up to 25 MB each." },

    promote: {
      label: "What should we show off?",
      hint: "Your best dishes or products, deals, events coming up — anything you're proud of.",
      placeholder: "Spicy beef noodle soup and soup dumplings; lunch special Mon–Fri; Lunar New Year menu in February",
    },
    postLangs: { label: "Which language should we post in?" },
    creatorsOk: { label: "Is it OK to invite local food creators to visit and post about you?" },
    creatorOffer: { label: "What could you offer a creator for a visit?", hint: "Tap any — nothing is promised until you agree." },
    complaints: { label: "When someone leaves an unhappy review, we should…" },
    anythingElse: { label: "Anything else we should know?", placeholder: "Questions, worries, ideas — anything at all." },
  } satisfies Record<IntakeField, FieldCopy>,
  needContact: "Please give us at least a phone number or an email so we can reach you.",
  options: {
    factsOk: { yes: "Yes, that's right", no: "Something's off" },
    reachBy: { text: "Text", call: "Phone call", wechat: "WeChat", whatsapp: "WhatsApp", email: "Email" },
    talkLang: { en: "English", mandarin: "Mandarin (普通话)", cantonese: "Cantonese (粤语)", other: "Other" },
    accessMeta: { done: "Done ✓", help: "I'll need help" },
    accessGoogle: { done: "Done ✓", help: "I'll need help" },
    postLangs: { en: "English", zh: "Chinese", both: "Both English & Chinese" },
    creatorsOk: { yes: "Yes!", maybe: "Maybe — tell me more", no: "Not right now" },
    creatorOffer: { meal1: "Free meal for 1", meal2: "Free meal for 2", drinks: "Drinks", setMenu: "A set menu / tasting", dessert: "Dessert" },
    complaints: {
      contact: "Ask them to contact us directly",
      manager: "Share our manager's phone or email",
      askFirst: "Check with me first",
    },
  } satisfies OptionLabels,
  access: {
    title: "How to give us access",
    intro: "Add Nora as a helper on your accounts. You stay the owner, and you can remove her any time. No passwords needed.",
    emailLabel: "Nora's email to add:",
    emailFallback: "Nora's email — we'll text it to you",
    showHow: "Show me how",
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
    contactName: "Please add your name.",
    contactMethod: "Please add a phone number or an email so we can reach you.",
    tooLong: "That's a bit long — please shorten it.",
    email: "That email doesn't look quite right.",
    pick: "Please pick one of the options.",
    secret: "That looks like a password. Please take it out — we never need one.",
    fix: "Almost there — please check the highlighted answers.",
    generic: "Sorry, something went wrong on our side. Please try again in a minute — your answers are still here.",
    rateLimited: "We got a lot of tries from this connection. Please wait a little and try again.",
  } satisfies Record<IntakeErrorKey | "fix" | "generic" | "rateLimited", string>,
  thanks: {
    title: (name: string) => (name ? `Thank you, ${name}!` : "Thank you!"),
    body: "We got your answers. We're excited to work with you.",
    nextTitle: "What happens next",
    next: [
      "We'll start planning your first month with what you told us.",
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
      `Hi! It's Nora 😊 So excited to start working with ${business}. Here's a short welcome form — it takes about a minute. We've already filled in what we could find, so you mostly just check it. It works in English and Chinese.\n\n${url}\n\nPlease don't share this link — it's just for you. Text me anytime with questions!`,
  },
};

export type IntakeCopy = typeof en;

/* ───────────────────────── 简体中文 ───────────────────────── */

const zhHans: IntakeCopy = {
  langName: "简体",
  htmlLang: "zh-Hans",
  meta: {
    title: "欢迎！我们来做个简单设置",
    description: "Nora 和 Cameron 的新客户资料表（私人链接）。",
  },
  brand: "Nora & Cameron",
  common: {
    optional: "选填",
    required: "必填",
    skip: "这一页都是选填。不确定的可以先跳过，我们通电话时再聊。",
    back: "上一步",
    next: "下一步",
    submit: "提交",
    sendNow: "现在提交",
    sending: "正在提交…",
    oneMoreMinute: "还有一分钟吗？",
    thatsAll: "这样就可以了！点“现在提交”即可；如果还有一分钟，可以点“下一步”，再回答几个选填的小问题。",
    stepOf: (n, total) => `第 ${n} 步，共 ${total} 步`,
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
    hi: (business) => `${business}，您好！👋`,
    line: "大约一分钟就能填完。没有您同意，什么都不会发布；也请不要在这里填写任何密码。",
  },
  facts: {
    title: "这些信息对吗？",
    intro: "这是我们查到的贵店信息，您不用再填一遍。",
    labels: { name: "店名", address: "地址", hours: "营业时间", phone: "电话", website: "网站", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" },
  },
  aboutYou: { title: "关于您", blurb: "怎么联系您最方便。" },
  contactTitle: "怎么联系您？",
  handles: { title: "您的账号", intro: "这几个我们没找到。有的话请填一下，没有可以跳过。" },
  steps: [
    { title: "这些信息对吗？", blurb: "看一下我们查到的信息，再告诉我们怎么联系您。" },
    { title: "账号和照片", blurb: "让我们协助管理账号（不需要密码），再分享几张照片。" },
    { title: "我们怎么合作", blurb: "想重点推什么，再做几个简单选择。" },
  ],
  fields: {
    factsOk: { label: "这些信息对吗？" },
    factsFix: { label: "哪里需要改？", hint: "用您自己的话告诉我们就行，我们来更新。", placeholder: "周五营业到晚上 10 点；电话号码是旧的。" },
    contactName: { label: "您的姓名", placeholder: "Lily Chen / 陈丽" },
    contactPhone: { label: "手机号码", placeholder: "(804) 555-0123" },
    contactEmail: { label: "电子邮箱", hint: "每月的成果报告会发到这个邮箱。", placeholder: "you@example.com" },
    reachBy: { label: "怎么联系您最方便？", hint: "方便的都可以点。" },
    talkLang: { label: "您希望我们用什么语言跟您沟通？" },
    talkLangOther: { label: "哪种语言？", placeholder: "福州话、越南语…" },

    instagram: { label: "Instagram", placeholder: "@yourplace" },
    tiktok: { label: "TikTok", placeholder: "@yourplace" },
    facebook: { label: "Facebook 专页", hint: "贴链接，或写专页名称都可以。", placeholder: "facebook.com/yourplace" },
    accessMeta: { label: "Instagram + Facebook 权限" },
    accessGoogle: { label: "Google 商家资料权限" },
    mediaLink: {
      label: "Logo、照片和视频：分享一个链接",
      hint: "放在 Google Drive、Dropbox 或 iCloud 的文件夹里，共享设成“任何知道链接的人都能查看”，再把链接贴过来。",
      placeholder: "https://drive.google.com/…",
    },
    uploads: { label: "或者直接从手机上传", hint: "照片、视频或 Logo，每个文件 25 MB 以内。" },

    promote: {
      label: "想重点推什么？",
      hint: "招牌菜或拿手产品、优惠、近期活动，您觉得自豪的都可以写。",
      placeholder: "红烧牛肉面、小笼包；周一到周五午餐特价；二月有春节套餐",
    },
    postLangs: { label: "帖子用什么语言发？" },
    creatorsOk: { label: "可以邀请本地美食博主来店里探店、发帖吗？" },
    creatorOffer: { label: "博主来探店，您可以提供什么？", hint: "可以多选。您同意之前，我们不会答应博主任何事。" },
    complaints: { label: "遇到差评时，我们应该…" },
    anythingElse: { label: "还有什么想告诉我们的吗？", placeholder: "问题、顾虑、想法，什么都可以。" },
  },
  needContact: "请至少留一个电话或邮箱，方便我们联系您。",
  options: {
    factsOk: { yes: "对，没问题", no: "有地方不对" },
    reachBy: { text: "短信", call: "打电话", wechat: "微信", whatsapp: "WhatsApp", email: "邮件" },
    talkLang: { en: "英语", mandarin: "普通话", cantonese: "粤语（广东话）", other: "其他" },
    accessMeta: { done: "已完成 ✓", help: "需要你们帮忙" },
    accessGoogle: { done: "已完成 ✓", help: "需要你们帮忙" },
    postLangs: { en: "英文", zh: "中文", both: "中英文都要" },
    creatorsOk: { yes: "可以！", maybe: "也许，想先多了解一下", no: "暂时不用" },
    creatorOffer: { meal1: "招待 1 人用餐", meal2: "招待 2 人用餐", drinks: "饮料", setMenu: "套餐或试吃", dessert: "甜品" },
    complaints: {
      contact: "请客人直接联系我们店",
      manager: "留经理的电话或邮箱给客人",
      askFirst: "每次先问过我再回复",
    },
  },
  access: {
    title: "怎样给我们管理权限",
    intro: "把 Nora 加为账号的协助管理员就可以。账号还是您的，随时可以把她移除。不需要给我们密码。",
    emailLabel: "请添加 Nora 的邮箱：",
    emailFallback: "Nora 的邮箱（我们会发短信告诉您）",
    showHow: "查看步骤",
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
    contactName: "请填写您的姓名。",
    contactMethod: "请至少留一个电话或邮箱，方便我们联系您。",
    tooLong: "内容有点长，请精简一下。",
    email: "邮箱格式好像不太对。",
    pick: "请从选项中选一个。",
    secret: "这里好像有密码，请删掉。我们不需要您的密码。",
    fix: "快好了！请看一下标出来的地方。",
    generic: "抱歉，我们这边出了点问题。请过一分钟再试，您填的内容都还在。",
    rateLimited: "提交次数有点多，请稍等一会儿再试。",
  },
  thanks: {
    title: (name) => (name ? `谢谢您，${name}！` : "谢谢您！"),
    body: "我们已经收到您的资料，非常期待跟您合作！",
    nextTitle: "接下来",
    next: [
      "我们会根据您提供的信息，开始规划第一个月的内容。",
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
      `您好！我是 Nora 😊 很高兴开始跟 ${business} 合作。这是一份简短的新客户资料表，大约一分钟就能填完：我们已经先把查到的信息填好了，您看一下对不对就行。表格有中英文版本。\n\n${url}\n\n这个链接是专门给您的，请不要转发。有任何问题随时联系我！`,
  },
};

/* ───────────────────────── 繁體中文 ───────────────────────── */

const zhHant: IntakeCopy = {
  langName: "繁體",
  htmlLang: "zh-Hant",
  meta: {
    title: "歡迎！我們來做個簡單設定",
    description: "Nora 和 Cameron 的新客戶資料表（私人連結）。",
  },
  brand: "Nora & Cameron",
  common: {
    optional: "選填",
    required: "必填",
    skip: "這一頁都是選填。不確定的可以先跳過，我們通電話時再聊。",
    back: "上一步",
    next: "下一步",
    submit: "送出",
    sendNow: "現在送出",
    sending: "正在送出…",
    oneMoreMinute: "還有一分鐘嗎？",
    thatsAll: "這樣就可以了！點「現在送出」即可；如果還有一分鐘，可以點「下一步」，再回答幾個選填的小問題。",
    stepOf: (n, total) => `第 ${n} 步，共 ${total} 步`,
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
    hi: (business) => `${business}，您好！👋`,
    line: "大約一分鐘就能填完。沒有您同意，什麼都不會發布；也請不要在這裡填寫任何密碼。",
  },
  facts: {
    title: "這些資訊對嗎？",
    intro: "這是我們查到的貴店資訊，您不用再填一次。",
    labels: { name: "店名", address: "地址", hours: "營業時間", phone: "電話", website: "網站", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" },
  },
  aboutYou: { title: "關於您", blurb: "怎麼聯絡您最方便。" },
  contactTitle: "怎麼聯絡您？",
  handles: { title: "您的帳號", intro: "這幾個我們沒找到。有的話請填一下，沒有可以跳過。" },
  steps: [
    { title: "這些資訊對嗎？", blurb: "看一下我們查到的資訊，再告訴我們怎麼聯絡您。" },
    { title: "帳號和照片", blurb: "讓我們協助管理帳號（不需要密碼），再分享幾張照片。" },
    { title: "我們怎麼合作", blurb: "想主打什麼，再做幾個簡單選擇。" },
  ],
  fields: {
    factsOk: { label: "這些資訊對嗎？" },
    factsFix: { label: "哪裡需要改？", hint: "用您自己的話告訴我們就好，我們來更新。", placeholder: "週五營業到晚上 10 點；電話號碼是舊的。" },
    contactName: { label: "您的姓名", placeholder: "Lily Chen / 陳麗" },
    contactPhone: { label: "手機號碼", placeholder: "(804) 555-0123" },
    contactEmail: { label: "Email", hint: "每月的成果報告會寄到這個信箱。", placeholder: "you@example.com" },
    reachBy: { label: "怎麼聯絡您最方便？", hint: "方便的都可以點。" },
    talkLang: { label: "您希望我們用什麼語言跟您溝通？" },
    talkLangOther: { label: "哪種語言？", placeholder: "台語、福州話、越南語…" },

    instagram: { label: "Instagram", placeholder: "@yourplace" },
    tiktok: { label: "TikTok", placeholder: "@yourplace" },
    facebook: { label: "Facebook 粉絲專頁", hint: "貼連結，或寫粉專名稱都可以。", placeholder: "facebook.com/yourplace" },
    accessMeta: { label: "Instagram + Facebook 權限" },
    accessGoogle: { label: "Google 商家檔案權限" },
    mediaLink: {
      label: "Logo、照片和影片：分享一個連結",
      hint: "放在 Google Drive、Dropbox 或 iCloud 的資料夾裡，共用設定成「知道連結的任何人都能檢視」，再把連結貼過來。",
      placeholder: "https://drive.google.com/…",
    },
    uploads: { label: "或是直接從手機上傳", hint: "照片、影片或 Logo，每個檔案 25 MB 以內。" },

    promote: {
      label: "想主打什麼？",
      hint: "招牌菜或拿手商品、優惠、近期活動，您覺得自豪的都可以寫。",
      placeholder: "紅燒牛肉麵、小籠包；週一到週五午餐特價；二月有農曆新年套餐",
    },
    postLangs: { label: "貼文用什麼語言發？" },
    creatorsOk: { label: "可以邀請在地美食網紅來店裡試吃、發文分享嗎？" },
    creatorOffer: { label: "網紅來店裡，您可以提供什麼？", hint: "可以複選。您同意之前，我們不會答應網紅任何事。" },
    complaints: { label: "遇到負評時，我們應該…" },
    anythingElse: { label: "還有什麼想告訴我們的嗎？", placeholder: "問題、顧慮、想法，什麼都可以。" },
  },
  needContact: "請至少留一個電話或 Email，方便我們聯絡您。",
  options: {
    factsOk: { yes: "對，沒問題", no: "有地方不對" },
    reachBy: { text: "簡訊", call: "打電話", wechat: "微信", whatsapp: "WhatsApp", email: "Email" },
    talkLang: { en: "英文", mandarin: "國語（普通話）", cantonese: "粵語（廣東話）", other: "其他" },
    accessMeta: { done: "已完成 ✓", help: "需要你們幫忙" },
    accessGoogle: { done: "已完成 ✓", help: "需要你們幫忙" },
    postLangs: { en: "英文", zh: "中文", both: "中英文都要" },
    creatorsOk: { yes: "可以！", maybe: "也許，想先多了解一下", no: "暫時不用" },
    creatorOffer: { meal1: "招待 1 人用餐", meal2: "招待 2 人用餐", drinks: "飲料", setMenu: "套餐或試吃", dessert: "甜點" },
    complaints: {
      contact: "請客人直接聯絡我們店",
      manager: "留經理的電話或 Email 給客人",
      askFirst: "每次先問過我再回覆",
    },
  },
  access: {
    title: "怎麼給我們管理權限",
    intro: "把 Nora 加為帳號的協助管理員就可以。帳號還是您的，隨時可以把她移除。不需要給我們密碼。",
    emailLabel: "請新增 Nora 的 Email：",
    emailFallback: "Nora 的 Email（我們會傳簡訊告訴您）",
    showHow: "查看步驟",
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
    contactName: "請填寫您的姓名。",
    contactMethod: "請至少留一個電話或 Email，方便我們聯絡您。",
    tooLong: "內容有點長，請精簡一下。",
    email: "Email 格式好像不太對。",
    pick: "請從選項中選一個。",
    secret: "這裡好像有密碼，請刪掉。我們不需要您的密碼。",
    fix: "快好了！請看一下標示出來的地方。",
    generic: "抱歉，我們這邊出了點問題。請過一分鐘再試，您填的內容都還在。",
    rateLimited: "送出次數有點多，請稍等一下再試。",
  },
  thanks: {
    title: (name) => (name ? `謝謝您，${name}！` : "謝謝您！"),
    body: "我們已經收到您的資料，非常期待跟您合作！",
    nextTitle: "接下來",
    next: [
      "我們會根據您提供的資訊，開始規劃第一個月的內容。",
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
      `您好！我是 Nora 😊 很開心開始跟 ${business} 合作。這是一份簡短的新客戶資料表，大約一分鐘就能填完：我們已經先把查到的資訊填好了，您看一下對不對就好。表格有中英文版本。\n\n${url}\n\n這個連結是專門給您的，請不要轉傳。有任何問題隨時聯絡我！`,
  },
};

export const INTAKE_COPY: Record<IntakeLangCode, IntakeCopy> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant };

export function intakeCopy(lang: IntakeLangCode): IntakeCopy {
  return INTAKE_COPY[lang] ?? en;
}

/** Short tag for the team view ("Answered in 简体"). */
export const INTAKE_LANG_TAG: Record<IntakeLangCode, string> = { en: "English", "zh-Hans": "简体", "zh-Hant": "繁體" };

/** Team-side (English) label where the form's own wording reads oddly out of context. */
const TEAM_LABEL: Partial<Record<IntakeField, string>> = {
  factsOk: "The details we showed them",
  factsFix: "What they say is off (their words)",
  talkLang: "Language to talk in (starts from the form's language)",
  talkLangOther: "Other language",
  uploads: "Uploaded files",
};

/** Section titles on the team view, "Copy all" and get_client_intake (one per page of the form). */
export const INTAKE_TEAM_SECTIONS = ["Is this right? · About you", "Accounts & photos", "How we'll work together"] as const;

/** English label for a current question, as the team view, "Copy all" and Claude see it. */
export function intakeTeamLabel(f: IntakeField): string {
  return TEAM_LABEL[f] ?? en.fields[f].label;
}

/* ───────────────────────── Earlier form (read-only) ───────────────────────── */

/**
 * Questions the earlier 7-step form asked and the current one doesn't. Forms already sent keep these keys in
 * their answers (jsonb), so the team view, "Copy all" and get_client_intake still show them, under
 * "Earlier answers". English only: nobody fills these in any more.
 */
type LegacyField = { label: string; kind: "line" | "block" | "choice"; link?: boolean; options?: Record<string, string> };

export const LEGACY_FIELDS = {
  businessName: { label: "Business name (as the owner wrote it)", kind: "line" },
  businessNameZh: { label: "Chinese name", kind: "line" },
  address: { label: "Address", kind: "line" },
  phone: { label: "Business phone", kind: "line" },
  website: { label: "Website or online ordering link", kind: "line", link: true },
  hours: { label: "Opening hours", kind: "block" },
  cuisine: { label: "What kind of food or business?", kind: "line" },
  priceRange: { label: "Price range", kind: "choice", options: { "1": "$ · under $15", "2": "$$ · $15–30", "3": "$$$ · $30–60", "4": "$$$$ · over $60" } },
  signatureDishes: { label: "Your best dishes (top 3–5)", kind: "block" },
  dietary: { label: "Do you have options for…", kind: "choice", options: { vegetarian: "Vegetarian", vegan: "Vegan", glutenFree: "Gluten-free", halal: "Halal" } },
  story: { label: "Your story, in a few sentences", kind: "block" },
  different: { label: "What makes you different?", kind: "block" },
  customers: {
    label: "Who are your best customers?", kind: "choice",
    options: {
      families: "Families", students: "Students", office: "Office workers", dateNight: "Date night", tourists: "Tourists & visitors",
      chinese: "Chinese-speaking community", seniors: "Seniors", groups: "Big groups & parties", takeout: "Takeout & delivery regulars",
    },
  },
  goals: {
    label: "What would you like more of?", kind: "choice",
    options: {
      walkIns: "More walk-ins", onlineOrders: "More online orders", catering: "Catering", events: "Events & parties",
      newMenu: "Launch a new menu", reviews: "More reviews", followers: "More followers", hiring: "Hiring staff",
    },
  },
  busyDays: { label: "Busy days and times", kind: "line" },
  slowDays: { label: "Slow days and times", kind: "line" },
  upcoming: { label: "Coming up soon", kind: "block" },
  tone: { label: "How should your posts feel?", kind: "choice", options: { friendly: "Friendly", fun: "Fun", elegant: "Elegant", family: "Family-style", bold: "Bold" } },
  emojis: { label: "Emojis in posts?", kind: "choice", options: { yes: "Yes, love them 😋", some: "A few is fine", no: "No emojis" } },
  avoid: { label: "Words or topics to avoid", kind: "block" },
  likedAccounts: { label: "Accounts you like the style of", kind: "block" },
  google: { label: "Google Business listing", kind: "line", link: true },
  yelp: { label: "Yelp", kind: "line", link: true },
  accessTiktok: { label: "TikTok access", kind: "choice", options: { call: "OK — let's do it on the call", none: "We don't have TikTok yet" } },
  signoff: { label: "How should we sign review replies?", kind: "line" },
  managerContact: { label: "Phone or email we can share for complaints", kind: "line" },
  neverMention: { label: "Anything we should never mention in replies?", kind: "block" },
  offerNote: { label: "Anything else about the offer?", kind: "line" },
  visitTimes: { label: "Best days and times for visits", kind: "line" },
  noFilm: { label: "Anything creators shouldn't film?", kind: "block" },
  contactRole: { label: "Your role", kind: "line" },
  wechatId: { label: "WeChat or WhatsApp ID", kind: "line" },
  approver: { label: "Who approves posts?", kind: "line" },
  approvalSpeed: { label: "How quickly can you usually review a post?", kind: "choice", options: { sameDay: "Same day", fewDays: "Within 1–2 days", weekly: "Once a week, in a batch" } },
} as const satisfies Record<string, LegacyField>;
export type LegacyIntakeField = keyof typeof LEGACY_FIELDS;

/** How the earlier form grouped those questions (titles shown under "Earlier answers · …"). */
export const LEGACY_GROUPS: { title: string; fields: LegacyIntakeField[] }[] = [
  { title: "Your business", fields: ["businessName", "businessNameZh", "address", "phone", "website", "hours", "cuisine", "priceRange", "signatureDishes", "dietary", "story", "different"] },
  { title: "Customers & goals", fields: ["customers", "goals", "busyDays", "slowDays", "upcoming"] },
  { title: "Look & voice", fields: ["tone", "emojis", "avoid", "likedAccounts"] },
  { title: "Accounts", fields: ["google", "yelp", "accessTiktok"] },
  { title: "Reviews & creators", fields: ["signoff", "managerContact", "neverMention", "offerNote", "visitTimes", "noFilm"] },
  { title: "Contact & approvals", fields: ["contactRole", "wechatId", "approver", "approvalSpeed"] },
];

/** English label for an option value (team view, notes, Claude) — current or earlier form. Unknown values pass through. */
export function intakeOptionLabel(field: string, value: string): string {
  const cur = (en.options as Record<string, Record<string, string> | undefined>)[field];
  if (cur?.[value]) return cur[value];
  const old = (LEGACY_FIELDS as Record<string, LegacyField | undefined>)[field]?.options;
  return old?.[value] ?? value;
}
