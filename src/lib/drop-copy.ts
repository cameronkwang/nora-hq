/**
 * Owner drop link (/drop/[token]) — every word a business owner sees on their private "send us a flyer" page, in
 * English, 简体中文 and 繁體中文, plus the ready-to-text message the team sends with the link.
 *
 * No server imports: shared by the page, its server action and the browser form. The Chinese dictionaries are typed
 * against the English shape, so a missing key is a type error. Upload messages, the "link is off" screen and the
 * shared error lines (too long, password, rate limit) come from the onboarding form's copy (lib/intake-copy), so the
 * two owner-facing pages read the same.
 */

import type { IntakeLangCode } from "./intake-copy";

/** Longest note an owner can send with a drop. */
export const DROP_NOTE_MAX = 1000;
/** Most files in one drop (a flyer, maybe a second side or a product photo). */
export const DROP_MAX_FILES = 4;

const en = {
  meta: { title: "Send us a flyer or deal", description: "A private page for sending Nora & Cameron a flyer or photo." },
  hi: (business: string) => `Hi ${business}! 👋`,
  title: "Got a new deal or flyer?",
  intro: "Send it here and we'll turn it into a post and a Story.",
  photo: {
    label: "Photo of the flyer or deal",
    hint: "Take a photo or pick one from your phone. A PDF works too.",
  },
  note: {
    label: "What's the deal? When does it end?",
    placeholder: "Buy 1 get 1 free crab legs, Mon–Thu, ends Dec 31",
  },
  send: "Send to Nora",
  sending: "Sending…",
  needOne: "Add a photo, or tell us about the deal.",
  uploadsOff: "Photos can't be added here right now. Tell us about the deal below and text the photo to Nora.",
  thanks: {
    title: "Got it, thank you!",
    body: "We'll turn it into a post and a Story.",
    again: "Send another",
  },
  share: {
    label: "English",
    message: (business: string, url: string) =>
      `Hi! It's Nora 😊 Whenever ${business} has a new deal, flyer or special, send it to us here: snap a photo and tell us when it ends. We'll turn it into a post and a Story.\n\n${url}\n\nThis link is just for you, so please don't share it. It works anytime.`,
  },
};

export type DropCopy = typeof en;

const zhHans: DropCopy = {
  meta: { title: "发送优惠或传单", description: "把传单或照片发给 Nora 和 Cameron 的专属页面。" },
  hi: (business) => `${business}，您好！👋`,
  title: "有新的优惠或传单吗？",
  intro: "在这里发给我们，我们会帮您做成帖子和限时动态（Story）。",
  photo: {
    label: "传单或优惠的照片",
    hint: "可以现拍，也可以从手机相册里选。PDF 也可以。",
  },
  note: {
    label: "是什么优惠？到哪天结束？",
    placeholder: "蟹腿买一送一，周一到周四，12 月 31 日截止",
  },
  send: "发送给 Nora",
  sending: "正在发送…",
  needOne: "请添加一张照片，或写一下优惠内容。",
  uploadsOff: "这里暂时不能添加照片。请在下面写一下优惠内容，照片直接发短信给 Nora。",
  thanks: {
    title: "收到了，谢谢！",
    body: "我们会把它做成帖子和限时动态（Story）。",
    again: "再发一个",
  },
  share: {
    label: "简体中文",
    message: (business, url) =>
      `您好！我是 Nora 😊 以后 ${business} 有新的优惠、传单或活动，直接在这里发给我们就行：拍张照，告诉我们哪天结束，我们会做成帖子和限时动态（Story）。\n\n${url}\n\n这个链接是专门给您的，请不要转发。随时都可以用。`,
  },
};

const zhHant: DropCopy = {
  meta: { title: "傳送優惠或傳單", description: "把傳單或照片傳給 Nora 和 Cameron 的專屬頁面。" },
  hi: (business) => `${business}，您好！👋`,
  title: "有新的優惠或傳單嗎？",
  intro: "在這裡傳給我們，我們會幫您做成貼文和限時動態（Story）。",
  photo: {
    label: "傳單或優惠的照片",
    hint: "可以現拍，也可以從手機相簿裡選。PDF 也可以。",
  },
  note: {
    label: "是什麼優惠？到哪天結束？",
    placeholder: "蟹腳買一送一，週一到週四，12 月 31 日截止",
  },
  send: "傳送給 Nora",
  sending: "正在傳送…",
  needOne: "請新增一張照片，或寫一下優惠內容。",
  uploadsOff: "這裡暫時不能新增照片。請在下面寫一下優惠內容，照片直接傳簡訊給 Nora。",
  thanks: {
    title: "收到了，謝謝！",
    body: "我們會把它做成貼文和限時動態（Story）。",
    again: "再傳一個",
  },
  share: {
    label: "繁體中文",
    message: (business, url) =>
      `您好！我是 Nora 😊 以後 ${business} 有新的優惠、傳單或活動，直接在這裡傳給我們就可以：拍張照，告訴我們哪天結束，我們會做成貼文和限時動態（Story）。\n\n${url}\n\n這個連結是專門給您的，請不要轉傳。隨時都可以用。`,
  },
};

export const DROP_COPY: Record<IntakeLangCode, DropCopy> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant };

export function dropCopy(lang: IntakeLangCode): DropCopy {
  return DROP_COPY[lang] ?? en;
}
