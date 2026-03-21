/*
================= IMPORTANT SYSTEM NOTICE ==================
⚠️ لا تحذف البيانات (users / admins / settings / data.json)
✔️ فقط قم بتحديث الكود
===========================================================
*/

'use strict';

// ================== Dependencies ==================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ================== App / Bot ==================
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.get('/', (_req, res) => res.send('Bot alive'));
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// ================== Constants ==================
const DB_FILE = path.join(__dirname, 'data.json');
const MAIN_ADMIN = 643309456;
const MAIL_TM_BASE = 'https://api.mail.tm';
const POLL_INTERVAL_MS = 4000;
const TELEGRAM_LIMIT = 4096;
const MAX_LAST_MESSAGES = 100;

// ================== Database ==================
function defaultDB() {
  return {
    users: {},
    admins: [],
    settings: {}
  };
}

function normalizeDB(raw) {
  const db = raw && typeof raw === 'object' ? raw : defaultDB();

  if (!db.users || typeof db.users !== 'object' || Array.isArray(db.users)) db.users = {};
  if (!Array.isArray(db.admins)) db.admins = [];
  if (!db.settings || typeof db.settings !== 'object' || Array.isArray(db.settings)) db.settings = {};

  if (!db.admins.includes(MAIN_ADMIN)) db.admins.push(MAIN_ADMIN);

  if (typeof db.settings.forceSub !== 'boolean') db.settings.forceSub = false;
  if (typeof db.settings.botEnabled !== 'boolean') db.settings.botEnabled = true;
  if (typeof db.settings.channel !== 'string') db.settings.channel = '';
  if (typeof db.settings.channelLink !== 'string') db.settings.channelLink = '';
  if (typeof db.settings.joinText !== 'string') db.settings.joinText = '';
  if (typeof db.settings.supportText !== 'string') db.settings.supportText = '';

  for (const uid of Object.keys(db.users)) {
    const user = db.users[uid];

    if (!user || typeof user !== 'object') {
      db.users[uid] = { emails: [], lang: 'ar', notifiedJoin: false };
      continue;
    }

    if (!Array.isArray(user.emails)) user.emails = [];
    if (typeof user.lang !== 'string' || !['ar', 'en'].includes(user.lang)) user.lang = 'ar';
    if (typeof user.notifiedJoin !== 'boolean') user.notifiedJoin = false;

    user.emails = user.emails
      .filter(e => e && typeof e === 'object')
      .map(e => ({
        email: String(e.email || ''),
        password: String(e.password || ''),
        apiToken: String(e.apiToken || ''),
        last: Array.isArray(e.last) ? e.last.map(String) : [],
        mute: Boolean(e.mute)
      }))
      .filter(e => e.email && e.password && e.apiToken);
  }

  return db;
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return normalizeDB(defaultDB());
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw.trim()) return normalizeDB(defaultDB());
    return normalizeDB(JSON.parse(raw));
  } catch (error) {
    console.error('❌ خطأ في تحميل قاعدة البيانات:', error.message);
    return normalizeDB(defaultDB());
  }
}

let db = loadDB();

function saveDB() {
  try {
    const temp = `${DB_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(temp, DB_FILE);
  } catch (error) {
    console.error('❌ خطأ في حفظ قاعدة البيانات:', error.message);
  }
}

function getUsers() {
  return db.users;
}

function getAdmins() {
  return db.admins;
}

function getSettings() {
  return db.settings;
}

function ensureUser(userId) {
  const id = String(userId);
  if (!getUsers()[id]) getUsers()[id] = { emails: [], lang: 'ar', notifiedJoin: false };
  if (!Array.isArray(getUsers()[id].emails)) getUsers()[id].emails = [];
  if (typeof getUsers()[id].lang !== 'string' || !['ar', 'en'].includes(getUsers()[id].lang)) {
    getUsers()[id].lang = 'ar';
  }
  if (typeof getUsers()[id].notifiedJoin !== 'boolean') {
    getUsers()[id].notifiedJoin = false;
  }
  return getUsers()[id];
}

// ================== Runtime State ==================
const states = Object.create(null);

function setState(userId, state) {
  states[String(userId)] = state;
}

function getState(userId) {
  return states[String(userId)] || null;
}

function clearState(userId) {
  delete states[String(userId)];
}

// ================== Helpers ==================
function logError(where, error) {
  console.error(`[${where}]`, error?.response?.data || error?.message || error);
}

function isPrivateChat(msg) {
  return msg?.chat?.type === 'private';
}

function isAdmin(userId) {
  return getAdmins().includes(Number(userId));
}

function truncate(text, limit = TELEGRAM_LIMIT) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}

function onlyEnglishLettersOrNumbers(text) {
  return /^[a-z0-9]+$/i.test(String(text || '').trim());
}

function validEmailName(text) {
  const value = String(text || '').trim().toLowerCase();
  return /^[a-z0-9]+$/.test(value) && value.length >= 3 && value.length <= 30;
}

function randomName(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function easyPassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const nums = '0123456789';

  const a = upper[Math.floor(Math.random() * upper.length)];
  const b = upper[Math.floor(Math.random() * upper.length)];
  const c = lower[Math.floor(Math.random() * lower.length)];
  const d = lower[Math.floor(Math.random() * lower.length)];
  const e = nums[Math.floor(Math.random() * nums.length)];
  const f = nums[Math.floor(Math.random() * nums.length)];
  const g = lower[Math.floor(Math.random() * lower.length)];
  const h = lower[Math.floor(Math.random() * lower.length)];
  const i = upper[Math.floor(Math.random() * upper.length)];
  const j = upper[Math.floor(Math.random() * upper.length)];

  return `${a}${b}${c}${d}${e}${f}${g}${h}${i}${j}`;
}

function normalizeChannel(input) {
  const value = String(input || '').trim();

  if (!value) return '';
  if (/^-100\d+$/.test(value)) return value;
  if (value.startsWith('@')) return value;
  if (/^[a-zA-Z0-9_]{4,}$/.test(value)) return `@${value}`;

  const publicMatch = value.match(/^https?:\/\/t\.me\/([a-zA-Z0-9_]{4,})\/?$/i);
  if (publicMatch) return `@${publicMatch[1]}`;

  return value;
}

function buildChannelLink(channel) {
  const value = String(channel || '').trim();

  if (!value) return '';
  if (value.startsWith('https://t.me/')) return value;
  if (value.startsWith('@')) return `https://t.me/${value.slice(1)}`;
  if (/^[a-zA-Z0-9_]{4,}$/.test(value)) return `https://t.me/${value}`;

  return '';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, truncate(text), options);
  } catch (error) {
    logError(`sendMessage:${chatId}`, error);
    return null;
  }
}

async function safeAnswerCallback(queryId, text = '') {
  try {
    await bot.answerCallbackQuery(queryId, text ? { text } : {});
  } catch (error) {
    logError('answerCallbackQuery', error);
  }
}

async function requirePrivate(msg) {
  if (isPrivateChat(msg)) return true;
  await safeSendMessage(msg.chat.id, '⚠️ البوت يعمل فقط في الخاص حفاظًا على الخصوصية.');
  return false;
}

function botIsEnabledForUser(userId) {
  if (isAdmin(userId)) return true;
  return getSettings().botEnabled !== false;
}

// ================== Language ==================
function getUserLang(userId) {
  return ensureUser(userId).lang || 'ar';
}

function setUserLang(userId, lang) {
  const user = ensureUser(userId);
  user.lang = lang === 'en' ? 'en' : 'ar';
  saveDB();
}

function t(userId, key) {
  const lang = getUserLang(userId);

  const texts = {
    ar: {
      main_menu: '📋 القائمة الرئيسية',
      admin_menu: '👑 لوحة الإدارة',
      create_email: '📧 إنشاء بريد',
      my_emails: '📂 إيميلاتي',
      support: '📩 مراسلة الدعم',
      language: '🌐 تغيير اللغة',
      choose_language: '🌐 اختر اللغة',
      language_updated_ar: '✅ تم تغيير اللغة إلى العربية.',
      language_updated_en: '✅ Language changed to English.',
      no_emails: '📭 لا يوجد لديك إيميلات',
      email_label: '📧 البريد',
      password_label: '🔐 كلمة المرور',
      status_label: '🔕 الحالة',
      muted: 'مكتوم',
      active: 'نشط',
      delete: '🗑️ حذف',
      transfer: '📤 نقل',
      unmute: '🔔 إلغاء الكتم',
      mute: '🔇 كتم',
      private_only: '⚠️ البوت يعمل فقط في الخاص حفاظًا على الخصوصية.',
      bot_off: '⛔ البوت متوقف حاليًا من قبل الإدارة.',
      help:
        '📘 الاستخدام:\n\n' +
        '1- اضغط "إنشاء بريد" لإنشاء بريد عشوائي\n' +
        '2- أو أرسل أحرف/أرقام إنجليزية ليتم إنشاء بريد بنفس الاسم\n' +
        '3- من "إيميلاتي" يمكنك الحذف أو النقل أو الكتم\n' +
        '4- من "مراسلة الدعم" يمكنك التواصل مع الإدارة\n' +
        '5- من "تغيير اللغة" يمكنك اختيار العربية أو الإنجليزية\n\n' +
        '/admin للإدارة',
      cancelled: '✅ تم إلغاء العملية الحالية.',
      join_success: '✅ تم التحقق من الاشتراك بنجاح.',
      join_fail: '❌ لم يتم التحقق بعد. اشترك أولًا ثم اضغط تحقق.',
      force_join_missing: '⚠️ تم تفعيل الاشتراك الإجباري لكن رابط القناة غير مضبوط من الإدارة.',
      force_join_text:
        '⚠️ يجب الاشتراك في القناة أولاً\n\n1- اضغط على زر الاشتراك\n2- اشترك في القناة\n3- ارجع للبوت واضغط تحقق',
      join_button: '📢 الاشتراك في القناة',
      check_button: '✅ تحقق',
      support_ask: '📩 أرسل الآن رسالتك ليتم إرسالها إلى جميع الأدمنية.',
      support_sent: '✅ تم إرسال رسالتك إلى جميع الأدمنية.',
      support_failed: '❌ تعذر إرسال الرسالة إلى الأدمنية.',
      email_created: '✅ تم إنشاء البريد بنجاح',
      random_email_created: '✅ تم إنشاء بريد عشوائي',
      invalid_email_name:
        '⚠️ الاسم غير صالح.\nاستخدم فقط أحرف وأرقام إنجليزية بدون مسافات، من 3 إلى 30 حرفًا.',
      email_name_used: '⚠️ هذا الاسم مستخدم، جرّب اسمًا آخر.',
      email_create_error: '❌ حدث خطأ أثناء إنشاء البريد.',
      email_random_error: '❌ تعذر إنشاء بريد عشوائي الآن، حاول مجددًا.',
      transfer_ask: '📤 أرسل ID المستخدم الذي تريد نقل الإيميل إليه.',
      invalid_user_id: '⚠️ أرسل ID مستخدم صحيحًا.',
      email_not_found: '❌ هذا البريد غير موجود.',
      email_transferred_to_you: '📥 تم نقل إيميل لك',
      transfer_failed: '❌ فشل النقل، غالبًا المستخدم لم يبدأ البوت.',
      transfer_success: '✅ تم نقل الإيميل بنجاح.',
      deleted: '🗑️ تم حذف البريد.',
      muted_done: '🔇 تم كتم الإشعارات.',
      unmuted_done: '🔔 تم إلغاء كتم الإشعارات.',
      only_english_or_button:
        '⚠️ أرسل فقط أحرف أو أرقام إنجليزية لإنشاء بريد مخصص، أو استخدم زر "إنشاء بريد" للحصول على بريد عشوائي.',
      admin_only: '⛔ هذا الخيار للأدمن فقط.',
      new_user_alert_title: '🚀 مستخدم جديد دخل البوت',
      name: '👤 الاسم',
      id: '🆔 ID',
      username: '🔗 المعرف',
      no_username: 'بدون معرف',
      started_bot: '✅ قام ببدء البوت'
    },
    en: {
      main_menu: '📋 Main Menu',
      admin_menu: '👑 Admin Panel',
      create_email: '📧 Create Email',
      my_emails: '📂 My Emails',
      support: '📩 Contact Support',
      language: '🌐 Change Language',
      choose_language: '🌐 Choose your language',
      language_updated_ar: '✅ تم تغيير اللغة إلى العربية.',
      language_updated_en: '✅ Language changed to English.',
      no_emails: '📭 You do not have any emails',
      email_label: '📧 Email',
      password_label: '🔐 Password',
      status_label: '🔕 Status',
      muted: 'Muted',
      active: 'Active',
      delete: '🗑️ Delete',
      transfer: '📤 Transfer',
      unmute: '🔔 Unmute',
      mute: '🔇 Mute',
      private_only: '⚠️ This bot works only in private chat for privacy.',
      bot_off: '⛔ The bot is currently disabled by the admin.',
      help:
        '📘 Usage:\n\n' +
        '1- Press "Create Email" to create a random email\n' +
        '2- Or send English letters/numbers to create an email with that name\n' +
        '3- In "My Emails" you can delete, transfer, or mute\n' +
        '4- In "Contact Support" you can message the admins\n' +
        '5- In "Change Language" you can choose Arabic or English\n\n' +
        '/admin for admins',
      cancelled: '✅ Current operation has been cancelled.',
      join_success: '✅ Subscription verified successfully.',
      join_fail: '❌ Verification failed. Join first, then press verify.',
      force_join_missing: '⚠️ Forced subscription is enabled but the channel link is not configured by admin.',
      force_join_text:
        '⚠️ You must join the channel first\n\n1- Press the join button\n2- Join the channel\n3- Return to the bot and press verify',
      join_button: '📢 Join Channel',
      check_button: '✅ Verify',
      support_ask: '📩 Send your message now and it will be delivered to all admins.',
      support_sent: '✅ Your message has been sent to all admins.',
      support_failed: '❌ Failed to send the message to admins.',
      email_created: '✅ Email created successfully',
      random_email_created: '✅ Random email created successfully',
      invalid_email_name:
        '⚠️ Invalid name.\nUse only English letters and numbers without spaces, 3 to 30 characters.',
      email_name_used: '⚠️ This name is already used, try another one.',
      email_create_error: '❌ An error occurred while creating the email.',
      email_random_error: '❌ Unable to create a random email now, please try again.',
      transfer_ask: '📤 Send the user ID you want to transfer the email to.',
      invalid_user_id: '⚠️ Send a valid user ID.',
      email_not_found: '❌ This email does not exist.',
      email_transferred_to_you: '📥 An email has been transferred to you',
      transfer_failed: '❌ Transfer failed, probably the user has not started the bot.',
      transfer_success: '✅ Email transferred successfully.',
      deleted: '🗑️ Email deleted.',
      muted_done: '🔇 Notifications muted.',
      unmuted_done: '🔔 Notifications unmuted.',
      only_english_or_button:
        '⚠️ Send only English letters or numbers to create a custom email, or use the "Create Email" button for a random email.',
      admin_only: '⛔ This option is for admins only.',
      new_user_alert_title: '🚀 A new user joined the bot',
      name: '👤 Name',
      id: '🆔 ID',
      username: '🔗 Username',
      no_username: 'No username',
      started_bot: '✅ Started the bot'
    }
  };

  return texts[lang][key] || texts.ar[key] || key;
}

// ================== Keyboards ==================
function mainMenuKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: t(userId, 'create_email'), callback_data: 'create' }],
      [{ text: t(userId, 'my_emails'), callback_data: 'my' }],
      [{ text: t(userId, 'support'), callback_data: 'support' }],
      [{ text: t(userId, 'language'), callback_data: 'lang_menu' }]
    ]
  };
}

function languageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🇮🇶 العربية', callback_data: 'set_lang_ar' },
        { text: '🇺🇸 English', callback_data: 'set_lang_en' }
      ]
    ]
  };
}

function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📌 تعيين قناة الاشتراك', callback_data: 'set_channel' }],
      [
        { text: '✅ تفعيل الاشتراك', callback_data: 'enable_sub' },
        { text: '❌ تعطيل الاشتراك', callback_data: 'disable_sub' }
      ],
      [{ text: '✏️ تعديل رسالة الاشتراك', callback_data: 'set_join_text' }],
      [
        { text: '🟢 تشغيل البوت', callback_data: 'bot_on' },
        { text: '🔴 إيقاف البوت', callback_data: 'bot_off' }
      ],
      [
        { text: '➕ إضافة أدمن', callback_data: 'add_admin' },
        { text: '➖ إزالة أدمن', callback_data: 'remove_admin' }
      ],
      [{ text: '📨 مراسلة مستخدم', callback_data: 'message_user' }],
      [{ text: '📢 إذاعة', callback_data: 'broadcast_menu' }],
      [{ text: '👥 عرض الأدمنية', callback_data: 'list_admins' }]
    ]
  };
}

function broadcastMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📢 إذاعة مع كلمة إعلان', callback_data: 'broadcast_with_label' }],
      [{ text: '✉️ إذاعة بدون كلمة إعلان', callback_data: 'broadcast_plain' }]
    ]
  };
}

function emailActionsKeyboard(userId, index, isMuted) {
  return {
    inline_keyboard: [
      [
        { text: t(userId, 'delete'), callback_data: `del_${index}` },
        { text: t(userId, 'transfer'), callback_data: `tran_${index}` },
        { text: isMuted ? t(userId, 'unmute') : t(userId, 'mute'), callback_data: `mute_${index}` }
      ]
    ]
  };
}

function supportAdminKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: '↩️ رد على المستخدم', callback_data: `reply_user_${userId}` }],
      [{ text: '📨 مراسلة المستخدم', callback_data: `msg_user_${userId}` }]
    ]
  };
}

// ================== UI ==================
async function showLanguageMenu(chatId) {
  await safeSendMessage(chatId, t(chatId, 'choose_language'), {
    reply_markup: languageKeyboard()
  });
}

async function showMainMenu(chatId) {
  await safeSendMessage(chatId, t(chatId, 'main_menu'), {
    reply_markup: mainMenuKeyboard(chatId)
  });
}

async function showAdminMenu(chatId) {
  await safeSendMessage(chatId, t(chatId, 'admin_menu'), {
    reply_markup: adminMenuKeyboard()
  });
}

async function showMyEmails(chatId) {
  const user = ensureUser(chatId);

  if (!user.emails.length) {
    await safeSendMessage(chatId, t(chatId, 'no_emails'));
    return;
  }

  for (let i = 0; i < user.emails.length; i += 1) {
    const e = user.emails[i];
    await safeSendMessage(
      chatId,
      `${t(chatId, 'email_label')}:\n${e.email}\n\n${t(chatId, 'password_label')}:\n${e.password}\n\n${t(chatId, 'status_label')}: ${e.mute ? t(chatId, 'muted') : t(chatId, 'active')}`,
      {
        reply_markup: emailActionsKeyboard(chatId, i, e.mute)
      }
    );
  }
}

// ================== New User Notification ==================
async function notifyNewUserJoin(msg) {
  try {
    const userId = msg.from.id;
    const user = ensureUser(userId);

    if (user.notifiedJoin) return;

    const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'غير معروف';
    const username = msg.from.username ? `@${msg.from.username}` : t(userId, 'no_username');

    const content =
      `${t(userId, 'new_user_alert_title')}\n\n` +
      `${t(userId, 'name')}: ${fullName}\n` +
      `${t(userId, 'id')}: ${userId}\n` +
      `${t(userId, 'username')}: ${username}\n\n` +
      `${t(userId, 'started_bot')}`;

    const uniqueAdmins = [...new Set([MAIN_ADMIN, ...getAdmins()])];

    await Promise.all(uniqueAdmins.map(adminId => safeSendMessage(adminId, content)));

    user.notifiedJoin = true;
    saveDB();
  } catch (error) {
    logError('notifyNewUserJoin', error);
  }
}

// ================== Broadcast ==================
async function sendBroadcastToAllUsers(adminId, text, withLabel) {
  const users = getUsers();
  const ids = Object.keys(users);

  if (!ids.length) {
    await safeSendMessage(adminId, '⚠️ لا يوجد مستخدمون للإذاعة.');
    return;
  }

  let sent = 0;
  let failed = 0;
  const finalText = withLabel ? `📢 إعلان:\n\n${text}` : text;

  for (const uid of ids) {
    const ok = await safeSendMessage(uid, finalText);
    if (ok) sent += 1;
    else failed += 1;
  }

  await safeSendMessage(
    adminId,
    `✅ انتهت الإذاعة.\n\n📬 تم الإرسال: ${sent}\n❌ فشل: ${failed}`
  );
}

// ================== Subscription ==================
async function checkJoin(userId) {
  const settings = getSettings();

  try {
    if (!settings.forceSub) return true;
    if (!settings.channel) return true;

    const member = await bot.getChatMember(settings.channel, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (error) {
    logError('checkJoin', error);
    return false;
  }
}

async function sendForceJoinMessage(chatId) {
  const settings = getSettings();
  const link = settings.channelLink || buildChannelLink(settings.channel);

  if (!link) {
    await safeSendMessage(chatId, t(chatId, 'force_join_missing'));
    return;
  }

  await safeSendMessage(
    chatId,
    settings.joinText || t(chatId, 'force_join_text'),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: t(chatId, 'join_button'), url: link }],
          [{ text: t(chatId, 'check_button'), callback_data: 'check' }]
        ]
      }
    }
  );
}

async function enforceSubscription(msg) {
  const userId = msg.from?.id || msg.chat.id;
  const settings = getSettings();

  if (!settings.forceSub) return true;
  if (!settings.channel) return true;
  if (isAdmin(userId)) return true;

  const joined = await checkJoin(userId);

  if (joined) return true;

  await sendForceJoinMessage(userId);
  return false;
}

// ================== Mail.tm API ==================
const mailApi = axios.create({
  baseURL: MAIL_TM_BASE,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json'
  }
});

let domainCache = {
  value: null,
  expiresAt: 0
};

async function getAvailableDomain() {
  const now = Date.now();

  if (domainCache.value && domainCache.expiresAt > now) {
    return domainCache.value;
  }

  const res = await mailApi.get('/domains?page=1');
  const list = res?.data?.['hydra:member'];

  if (!Array.isArray(list) || !list.length || !list[0].domain) {
    throw new Error('No available domains');
  }

  domainCache = {
    value: list[0].domain,
    expiresAt: now + 10 * 60 * 1000
  };

  return domainCache.value;
}

async function createMailAccount(address, password) {
  await mailApi.post('/accounts', { address, password });

  const tokenRes = await mailApi.post('/token', { address, password });
  return tokenRes?.data?.token;
}

async function fetchMessagesPage(apiToken, page = 1) {
  const res = await mailApi.get(`/messages?page=${page}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  });
  return res.data;
}

async function fetchMessageDetails(apiToken, msgId) {
  const res = await mailApi.get(`/messages/${msgId}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  });
  return res.data;
}

// ================== Email Functions ==================
async function createEmail(userId, customName = null) {
  try {
    const domain = await getAvailableDomain();

    if (customName) {
      const name = String(customName).trim().toLowerCase();

      if (!validEmailName(name)) {
        await safeSendMessage(userId, t(userId, 'invalid_email_name'));
        return;
      }

      const email = `${name}@${domain}`;
      const password = easyPassword();
      const apiToken = await createMailAccount(email, password);

      const user = ensureUser(userId);
      user.emails.push({
        email,
        password,
        apiToken,
        last: [],
        mute: false
      });

      saveDB();

      await safeSendMessage(
        userId,
        `${t(userId, 'email_created')}\n\n${t(userId, 'email_label')}:\n${email}\n\n${t(userId, 'password_label')}:\n${password}`
      );
      return;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const name = randomName(10);
      const email = `${name}@${domain}`;
      const password = easyPassword();

      try {
        const apiToken = await createMailAccount(email, password);

        const user = ensureUser(userId);
        user.emails.push({
          email,
          password,
          apiToken,
          last: [],
          mute: false
        });

        saveDB();

        await safeSendMessage(
          userId,
          `${t(userId, 'random_email_created')}\n\n${t(userId, 'email_label')}:\n${email}\n\n${t(userId, 'password_label')}:\n${password}`
        );
        return;
      } catch (error) {
        if (error?.response?.status !== 422) throw error;
      }
    }

    await safeSendMessage(userId, t(userId, 'email_random_error'));
  } catch (error) {
    if (error?.response?.status === 422) {
      await safeSendMessage(userId, t(userId, 'email_name_used'));
      return;
    }

    logError('createEmail', error);
    await safeSendMessage(userId, t(userId, 'email_create_error'));
  }
}

async function transferEmail(fromUserId, toUserIdRaw, index) {
  const fromId = String(fromUserId);
  const toId = String(toUserIdRaw).trim();

  if (!/^\d+$/.test(toId)) {
    await safeSendMessage(fromId, t(fromId, 'invalid_user_id'));
    return;
  }

  const sender = ensureUser(fromId);
  const emailObj = sender.emails[index];

  if (!emailObj) {
    await safeSendMessage(fromId, t(fromId, 'email_not_found'));
    return;
  }

  const receiver = ensureUser(toId);

  receiver.emails.push(emailObj);
  sender.emails.splice(index, 1);
  saveDB();

  const delivered = await safeSendMessage(
    toId,
    `${t(toId, 'email_transferred_to_you')}\n\n${t(toId, 'email_label')}: ${emailObj.email}\n${t(toId, 'password_label')}: ${emailObj.password}`
  );

  if (!delivered) {
    sender.emails.splice(index, 0, emailObj);
    receiver.emails.pop();
    saveDB();

    await safeSendMessage(fromId, t(fromId, 'transfer_failed'));
    return;
  }

  await safeSendMessage(fromId, t(fromId, 'transfer_success'));
}

// ================== Support / Admin Messaging ==================
async function sendUserSupportToAdmins(fromMsg, text) {
  const senderId = fromMsg.from.id;
  const fullName = [fromMsg.from.first_name, fromMsg.from.last_name].filter(Boolean).join(' ') || 'غير معروف';
  const username = fromMsg.from.username ? `@${fromMsg.from.username}` : 'بدون معرف';

  const content =
    `📩 رسالة دعم جديدة\n\n` +
    `👤 الاسم: ${fullName}\n` +
    `🆔 ID: ${senderId}\n` +
    `🔗 المعرف: ${username}\n\n` +
    `💬 الرسالة:\n${text}`;

  let sent = 0;

  for (const adminId of getAdmins()) {
    const ok = await safeSendMessage(adminId, content, {
      reply_markup: supportAdminKeyboard(senderId)
    });
    if (ok) sent += 1;
  }

  if (sent > 0) {
    await safeSendMessage(senderId, t(senderId, 'support_sent'));
  } else {
    await safeSendMessage(senderId, t(senderId, 'support_failed'));
  }
}

async function sendAdminReplyToUser(adminId, userId, text) {
  const sent = await safeSendMessage(
    userId,
    `📩 رد من الإدارة\n\n${text}`
  );

  if (!sent) {
    await safeSendMessage(adminId, '❌ تعذر إرسال الرد للمستخدم.');
    return;
  }

  await safeSendMessage(adminId, '✅ تم إرسال الرد للمستخدم.');
}

async function sendAdminMessageToUser(adminId, userId, text) {
  const sent = await safeSendMessage(
    userId,
    `📨 رسالة من الإدارة\n\n${text}`
  );

  if (!sent) {
    await safeSendMessage(adminId, '❌ تعذر إرسال الرسالة للمستخدم.');
    return;
  }

  await safeSendMessage(adminId, '✅ تم إرسال الرسالة للمستخدم.');
}

// ================== Commands ==================
bot.onText(/\/start/, async (msg) => {
  if (!(await requirePrivate(msg))) return;

  const userId = msg.from.id;
  const isNewUser = !getUsers()[String(userId)];

  ensureUser(userId);

  if (!botIsEnabledForUser(userId)) {
    await safeSendMessage(userId, t(userId, 'bot_off'));
    return;
  }

  if (!(await enforceSubscription(msg))) return;

  clearState(userId);

  if (isNewUser) {
    await notifyNewUserJoin(msg);
  }

  await showMainMenu(userId);
});

bot.onText(/\/menu/, async (msg) => {
  if (!(await requirePrivate(msg))) return;

  const userId = msg.from.id;

  ensureUser(userId);

  if (!botIsEnabledForUser(userId)) {
    await safeSendMessage(userId, t(userId, 'bot_off'));
    return;
  }

  if (!(await enforceSubscription(msg))) return;

  await showMainMenu(userId);
});

bot.onText(/\/help/, async (msg) => {
  if (!(await requirePrivate(msg))) return;

  const userId = msg.from.id;

  ensureUser(userId);

  await safeSendMessage(userId, t(userId, 'help'));
});

bot.onText(/\/cancel/, async (msg) => {
  if (!(await requirePrivate(msg))) return;
  const userId = msg.from.id;
  ensureUser(userId);
  clearState(userId);
  await safeSendMessage(userId, t(userId, 'cancelled'));
});

bot.onText(/\/admin/, async (msg) => {
  if (!(await requirePrivate(msg))) return;

  const userId = msg.from.id;
  ensureUser(userId);

  if (!isAdmin(userId)) return;

  await showAdminMenu(userId);
});

// ================== Callback Queries ==================
bot.on('callback_query', async (q) => {
  const userId = q.from?.id;
  const data = q.data || '';

  await safeAnswerCallback(q.id);

  if (!userId) return;

  ensureUser(userId);

  if (
    !botIsEnabledForUser(userId) &&
    !isAdmin(userId) &&
    data !== 'check' &&
    !data.startsWith('set_lang_') &&
    data !== 'lang_menu'
  ) {
    await safeSendMessage(userId, t(userId, 'bot_off'));
    return;
  }

  if (data === 'lang_menu') {
    await showLanguageMenu(userId);
    return;
  }

  if (data === 'set_lang_ar') {
    setUserLang(userId, 'ar');
    await safeSendMessage(userId, t(userId, 'language_updated_ar'));
    return;
  }

  if (data === 'set_lang_en') {
    setUserLang(userId, 'en');
    await safeSendMessage(userId, t(userId, 'language_updated_en'));
    return;
  }

  if (data === 'check') {
    const joined = await checkJoin(userId);

    if (joined) {
      await safeSendMessage(userId, t(userId, 'join_success'));
      await showMainMenu(userId);
    } else {
      await safeSendMessage(userId, t(userId, 'join_fail'));
      await sendForceJoinMessage(userId);
    }
    return;
  }

  if (!isAdmin(userId)) {
    const fakeMsg = {
      chat: { id: userId, type: 'private' },
      from: { id: userId }
    };

    if (!(await enforceSubscription(fakeMsg))) return;
  }

  if (data === 'create') {
    await createEmail(userId);
    return;
  }

  if (data === 'my') {
    await showMyEmails(userId);
    return;
  }

  if (data === 'support') {
    setState(userId, { type: 'support_message' });
    await safeSendMessage(userId, t(userId, 'support_ask'));
    return;
  }

  if (data.startsWith('del_')) {
    const index = Number(data.split('_')[1]);
    const user = ensureUser(userId);

    if (!Number.isInteger(index) || !user.emails[index]) {
      await safeSendMessage(userId, t(userId, 'email_not_found'));
      return;
    }

    user.emails.splice(index, 1);
    saveDB();
    await safeSendMessage(userId, t(userId, 'deleted'));
    return;
  }

  if (data.startsWith('tran_')) {
    const index = Number(data.split('_')[1]);
    const user = ensureUser(userId);

    if (!Number.isInteger(index) || !user.emails[index]) {
      await safeSendMessage(userId, t(userId, 'email_not_found'));
      return;
    }

    setState(userId, { type: 'transfer_email', index });
    await safeSendMessage(userId, t(userId, 'transfer_ask'));
    return;
  }

  if (data.startsWith('mute_')) {
    const index = Number(data.split('_')[1]);
    const user = ensureUser(userId);

    if (!Number.isInteger(index) || !user.emails[index]) {
      await safeSendMessage(userId, t(userId, 'email_not_found'));
      return;
    }

    user.emails[index].mute = !user.emails[index].mute;
    saveDB();

    await safeSendMessage(
      userId,
      user.emails[index].mute ? t(userId, 'muted_done') : t(userId, 'unmuted_done')
    );
    return;
  }

  // ========= Admin-only callbacks =========
  if (
    [
      'set_channel',
      'enable_sub',
      'disable_sub',
      'set_join_text',
      'bot_on',
      'bot_off',
      'add_admin',
      'remove_admin',
      'message_user',
      'list_admins',
      'broadcast_menu',
      'broadcast_with_label',
      'broadcast_plain'
    ].includes(data) ||
    data.startsWith('reply_user_') ||
    data.startsWith('msg_user_')
  ) {
    if (!isAdmin(userId)) {
      await safeSendMessage(userId, t(userId, 'admin_only'));
      return;
    }
  }

  if (data === 'broadcast_menu') {
    await safeSendMessage(userId, '📢 اختر نوع الإذاعة:', {
      reply_markup: broadcastMenuKeyboard()
    });
    return;
  }

  if (data === 'broadcast_with_label') {
    setState(userId, { type: 'broadcast_with_label' });
    await safeSendMessage(userId, '📢 أرسل الآن نص الإعلان، وسيصل للمستخدمين بهذه الصيغة:\n\nإعلان:\nنصك');
    return;
  }

  if (data === 'broadcast_plain') {
    setState(userId, { type: 'broadcast_plain' });
    await safeSendMessage(userId, '✉️ أرسل الآن نص الرسالة، وسيصل للمستخدمين كما كتبته بدون كلمة إعلان.');
    return;
  }

  if (data === 'set_channel') {
    setState(userId, { type: 'set_channel' });
    await safeSendMessage(
      userId,
      '📌 أرسل معرف القناة مثل:\n@channel\n\nأو رابط القناة العامة:\nhttps://t.me/channel\n\nمهم: يجب أن يكون البوت مضافًا في القناة كأدمن أو عضو يقدر يقرأ الأعضاء.'
    );
    return;
  }

  if (data === 'enable_sub') {
    getSettings().forceSub = true;
    saveDB();
    await safeSendMessage(userId, '✅ تم تفعيل الاشتراك الإجباري.');
    return;
  }

  if (data === 'disable_sub') {
    getSettings().forceSub = false;
    saveDB();
    await safeSendMessage(userId, '❌ تم تعطيل الاشتراك الإجباري.');
    return;
  }

  if (data === 'set_join_text') {
    setState(userId, { type: 'set_join_text' });
    await safeSendMessage(userId, '✏️ أرسل رسالة الاشتراك الجديدة.');
    return;
  }

  if (data === 'bot_on') {
    getSettings().botEnabled = true;
    saveDB();
    await safeSendMessage(userId, '🟢 تم تشغيل البوت.');
    return;
  }

  if (data === 'bot_off') {
    getSettings().botEnabled = false;
    saveDB();
    await safeSendMessage(userId, '🔴 تم إيقاف البوت للمستخدمين. الأدمن فقط يبقى قادرًا على الدخول.');
    return;
  }

  if (data === 'add_admin') {
    setState(userId, { type: 'add_admin' });
    await safeSendMessage(userId, '➕ أرسل ID الأدمن الجديد.');
    return;
  }

  if (data === 'remove_admin') {
    setState(userId, { type: 'remove_admin' });
    await safeSendMessage(userId, '➖ أرسل ID الأدمن الذي تريد حذفه.');
    return;
  }

  if (data === 'message_user') {
    setState(userId, { type: 'ask_user_message_target' });
    await safeSendMessage(userId, '📨 أرسل ID المستخدم الذي تريد مراسلته.');
    return;
  }

  if (data === 'list_admins') {
    const list = getAdmins();
    await safeSendMessage(
      userId,
      `👥 قائمة الأدمنية:\n\n${list.map((id, i) => `${i + 1}- ${id}`).join('\n')}`
    );
    return;
  }

  if (data.startsWith('reply_user_')) {
    const targetUserId = data.replace('reply_user_', '').trim();
    setState(userId, { type: 'reply_to_user', userId: targetUserId });
    await safeSendMessage(userId, `↩️ أرسل الآن الرد الذي تريد إرساله إلى المستخدم ${targetUserId}`);
    return;
  }

  if (data.startsWith('msg_user_')) {
    const targetUserId = data.replace('msg_user_', '').trim();
    setState(userId, { type: 'message_user_direct', userId: targetUserId });
    await safeSendMessage(userId, `📨 أرسل الآن الرسالة التي تريد إرسالها إلى المستخدم ${targetUserId}`);
  }
});

// ================== Messages ==================
bot.on('message', async (msg) => {
  try {
    if (!(await requirePrivate(msg))) return;

    const userId = msg.from.id;
    ensureUser(userId);

    const text = typeof msg.text === 'string' ? msg.text.trim() : '';

    if (!text) return;
    if (text.startsWith('/')) return;

    const state = getState(userId);

    if (!botIsEnabledForUser(userId)) {
      await safeSendMessage(userId, t(userId, 'bot_off'));
      return;
    }

    if (!isAdmin(userId)) {
      if (!(await enforceSubscription(msg))) return;
    }

    // ===== Admin states =====
    if (state?.type === 'set_channel') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      const normalized = normalizeChannel(text);
      const link = buildChannelLink(normalized);

      if (!normalized) {
        await safeSendMessage(userId, '⚠️ قيمة القناة غير صحيحة.');
        return;
      }

      getSettings().channel = normalized;
      getSettings().channelLink = link;
      saveDB();
      clearState(userId);

      await safeSendMessage(
        userId,
        `✅ تم حفظ القناة بنجاح\n\nالقناة: ${normalized}\nالرابط: ${link || 'غير متوفر'}`
      );
      return;
    }

    if (state?.type === 'set_join_text') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      getSettings().joinText = text;
      saveDB();
      clearState(userId);
      await safeSendMessage(userId, '✅ تم تحديث رسالة الاشتراك.');
      return;
    }

    if (state?.type === 'add_admin') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      const newAdminId = Number(text);
      if (!Number.isInteger(newAdminId) || newAdminId <= 0) {
        await safeSendMessage(userId, '⚠️ أرسل ID صحيح.');
        return;
      }

      if (!getAdmins().includes(newAdminId)) {
        getAdmins().push(newAdminId);
        saveDB();
      }

      clearState(userId);
      await safeSendMessage(userId, `✅ تم إضافة الأدمن: ${newAdminId}`);
      await safeSendMessage(newAdminId, '👑 تم منحك صلاحية أدمن في البوت.');
      return;
    }

    if (state?.type === 'remove_admin') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      const adminId = Number(text);

      if (!Number.isInteger(adminId) || adminId <= 0) {
        await safeSendMessage(userId, '⚠️ أرسل ID صحيح.');
        return;
      }

      if (adminId === MAIN_ADMIN) {
        await safeSendMessage(userId, '⛔ لا يمكن إزالة الأدمن الرئيسي.');
        return;
      }

      db.admins = getAdmins().filter(id => id !== adminId);
      saveDB();
      clearState(userId);

      await safeSendMessage(userId, `✅ تم إزالة الأدمن: ${adminId}`);
      return;
    }

    if (state?.type === 'ask_user_message_target') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      if (!/^\d+$/.test(text)) {
        await safeSendMessage(userId, '⚠️ أرسل ID مستخدم صحيح.');
        return;
      }

      setState(userId, { type: 'message_user_direct', userId: text });
      await safeSendMessage(userId, '✍️ أرسل الآن الرسالة التي تريد إرسالها للمستخدم.');
      return;
    }

    if (state?.type === 'message_user_direct') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      await sendAdminMessageToUser(userId, state.userId, text);
      clearState(userId);
      return;
    }

    if (state?.type === 'reply_to_user') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      await sendAdminReplyToUser(userId, state.userId, text);
      clearState(userId);
      return;
    }

    if (state?.type === 'broadcast_with_label') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      await sendBroadcastToAllUsers(userId, text, true);
      clearState(userId);
      return;
    }

    if (state?.type === 'broadcast_plain') {
      if (!isAdmin(userId)) {
        clearState(userId);
        return;
      }

      await sendBroadcastToAllUsers(userId, text, false);
      clearState(userId);
      return;
    }

    // ===== User states =====
    if (state?.type === 'support_message') {
      await sendUserSupportToAdmins(msg, text);
      clearState(userId);
      return;
    }

    if (state?.type === 'transfer_email') {
      await transferEmail(userId, text, state.index);
      clearState(userId);
      return;
    }

    // ===== Default behavior =====
    if (onlyEnglishLettersOrNumbers(text)) {
      await createEmail(userId, text.toLowerCase());
      return;
    }

    await safeSendMessage(userId, t(userId, 'only_english_or_button'));
  } catch (error) {
    logError('messageHandler', error);
  }
});

// ================== Mail Polling ==================
let pollingNow = false;

async function pollOneUserEmails(userId, user) {
  if (!user || !Array.isArray(user.emails) || !user.emails.length) return;

  for (const e of user.emails) {
    if (!e || e.mute || !e.apiToken) continue;

    try {
      const known = new Set(Array.isArray(e.last) ? e.last.map(String) : []);
      const freshIds = [];
      let page = 1;

      while (page <= 2) {
        const data = await fetchMessagesPage(e.apiToken, page);
        const messages = data?.['hydra:member'];

        if (!Array.isArray(messages) || !messages.length) break;

        for (const msg of messages) {
          const msgId = String(msg.id);
          if (!known.has(msgId)) freshIds.push(msgId);
        }

        const hasNext = Boolean(data?.['hydra:view']?.['hydra:next']);
        if (!hasNext) break;
        page += 1;
      }

      freshIds.reverse();

      for (const msgId of freshIds) {
        const full = await fetchMessageDetails(e.apiToken, msgId);
        const sender = full?.from?.address || (getUserLang(userId) === 'en' ? 'Unknown' : 'غير معروف');
        const subject = full?.subject || (getUserLang(userId) === 'en' ? 'No subject' : 'بدون عنوان');
        const bodyRaw =
          full?.text ||
          stripHtml(full?.html || '') ||
          (getUserLang(userId) === 'en' ? 'No content' : 'لا يوجد محتوى');
        const body = truncate(cleanText(bodyRaw), 2500);

        if (getUserLang(userId) === 'en') {
          await safeSendMessage(
            userId,
            `📨 New Message\n\n📧 Email: ${e.email}\n👤 From: ${sender}\n📌 Subject: ${subject}\n\n📩 Message:\n${body}`
          );
        } else {
          await safeSendMessage(
            userId,
            `📨 رسالة جديدة\n\n📧 البريد: ${e.email}\n👤 المرسل: ${sender}\n📌 العنوان: ${subject}\n\n📩 الرسالة:\n${body}`
          );
        }

        known.add(msgId);
      }

      e.last = Array.from(known).slice(-MAX_LAST_MESSAGES);
      saveDB();
    } catch (error) {
      logError(`pollOneUserEmails:${userId}:${e.email}`, error);
    }
  }
}

async function pollAllEmails() {
  if (pollingNow) return;
  pollingNow = true;

  try {
    const users = getUsers();
    const entries = Object.entries(users);

    await Promise.all(
      entries.map(([uid, user]) => pollOneUserEmails(uid, user))
    );
  } catch (error) {
    logError('pollAllEmails', error);
  } finally {
    pollingNow = false;
  }
}

setInterval(() => {
  pollAllEmails().catch(error => logError('pollInterval', error));
}, POLL_INTERVAL_MS);

// ================== Error Events ==================
bot.on('polling_error', (error) => {
  logError('polling_error', error);
});

process.on('unhandledRejection', (error) => {
  logError('unhandledRejection', error);
});

process.on('uncaughtException', (error) => {
  logError('uncaughtException', error);
});
