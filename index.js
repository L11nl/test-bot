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
  console.error('Missing BOT_TOKEN in environment variables');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.get('/', (_req, res) => res.send('Bot alive'));
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// ================== Constants ==================
const DB_FILE = path.join(__dirname, 'data.json');
const MAIN_ADMIN = 643309456;
const MAIL_TM_BASE = 'https://api.mail.tm';
const TELEGRAM_MESSAGE_LIMIT = 4096;
const POLL_INTERVAL_MS = 15000;
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

  if (!db.users || typeof db.users !== 'object' || Array.isArray(db.users)) {
    db.users = {};
  }

  if (!Array.isArray(db.admins)) {
    db.admins = [];
  }

  if (!db.settings || typeof db.settings !== 'object' || Array.isArray(db.settings)) {
    db.settings = {};
  }

  for (const userId of Object.keys(db.users)) {
    const user = db.users[userId];

    if (!user || typeof user !== 'object') {
      db.users[userId] = { emails: [] };
      continue;
    }

    if (!Array.isArray(user.emails)) {
      user.emails = [];
    }

    user.emails = user.emails
      .filter(emailObj => emailObj && typeof emailObj === 'object')
      .map(emailObj => ({
        email: String(emailObj.email || ''),
        password: String(emailObj.password || ''),
        apiToken: String(emailObj.apiToken || ''),
        last: Array.isArray(emailObj.last) ? emailObj.last.map(String) : [],
        mute: Boolean(emailObj.mute)
      }))
      .filter(emailObj => emailObj.email && emailObj.password && emailObj.apiToken);
  }

  if (!db.admins.includes(MAIN_ADMIN)) {
    db.admins.push(MAIN_ADMIN);
  }

  return db;
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return normalizeDB(defaultDB());
    }

    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw.trim()) {
      return normalizeDB(defaultDB());
    }

    return normalizeDB(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to load DB:', error.message);
    return normalizeDB(defaultDB());
  }
}

let db = loadDB();

function saveDB() {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    console.error('Failed to save DB:', error.message);
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

  if (!getUsers()[id]) {
    getUsers()[id] = { emails: [] };
  }

  if (!Array.isArray(getUsers()[id].emails)) {
    getUsers()[id].emails = [];
  }

  return getUsers()[id];
}

// ================== State Manager ==================
const userStates = Object.create(null);

function setState(userId, state) {
  userStates[String(userId)] = state;
}

function getState(userId) {
  return userStates[String(userId)] || null;
}

function clearState(userId) {
  delete userStates[String(userId)];
}

// ================== Helpers ==================
function logError(context, error) {
  console.error(`[${context}]`, error?.response?.data || error?.message || error);
}

function isPrivateChat(msg) {
  return msg?.chat?.type === 'private';
}

function isAdmin(userId) {
  return getAdmins().includes(Number(userId));
}

function generatePassword(length = 18) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateRandomName(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function isValidEmailName(name) {
  return /^[a-z0-9]+$/.test(name) && name.length >= 3 && name.length <= 30;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function cleanMessageText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(text, limit = 3000) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}

function buildChannelLink(channelValue) {
  const value = String(channelValue || '').trim();

  if (!value) return '';

  if (value.startsWith('https://t.me/')) {
    return value;
  }

  if (value.startsWith('@')) {
    return `https://t.me/${value.slice(1)}`;
  }

  if (/^[a-zA-Z0-9_]{4,}$/.test(value)) {
    return `https://t.me/${value}`;
  }

  return value;
}

function normalizeChannelValue(input) {
  const text = String(input || '').trim();

  if (!text) return '';

  if (text.startsWith('https://t.me/')) {
    const match = text.match(/^https:\/\/t\.me\/([a-zA-Z0-9_]{4,})$/);
    if (match) {
      return `@${match[1]}`;
    }
    return text;
  }

  if (text.startsWith('@')) {
    return text;
  }

  if (/^[a-zA-Z0-9_]{4,}$/.test(text)) {
    return `@${text}`;
  }

  if (/^-100\d+$/.test(text)) {
    return text;
  }

  return text;
}

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📧 إنشاء بريد', callback_data: 'create' }],
      [{ text: '📂 إيميلاتي', callback_data: 'my' }],
      [{ text: '📩 مراسلة الدعم', callback_data: 'support' }]
    ]
  };
}

function getAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📌 تعيين قناة', callback_data: 'set_channel' }],
      [
        { text: '✅ تفعيل الاشتراك', callback_data: 'enable_sub' },
        { text: '❌ تعطيل الاشتراك', callback_data: 'disable_sub' }
      ],
      [{ text: '✏️ تعديل رسالة الاشتراك', callback_data: 'set_join_text' }]
    ]
  };
}

function getEmailActionsKeyboard(index, muted) {
  return {
    inline_keyboard: [
      [
        { text: '🗑️ حذف', callback_data: `del_${index}` },
        { text: '📤 نقل', callback_data: `tran_${index}` },
        { text: muted ? '🔔 إلغاء الكتم' : '🔇 كتم', callback_data: `mute_${index}` }
      ]
    ]
  };
}

async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, truncateText(text, TELEGRAM_MESSAGE_LIMIT), options);
  } catch (error) {
    logError(`sendMessage:${chatId}`, error);
    return null;
  }
}

async function safeAnswerCallback(callbackId, text = '') {
  try {
    await bot.answerCallbackQuery(callbackId, text ? { text } : {});
  } catch (error) {
    logError('answerCallbackQuery', error);
  }
}

async function requirePrivateChat(msg) {
  if (isPrivateChat(msg)) return true;

  await safeSendMessage(msg.chat.id, '⚠️ هذا البوت يعمل فقط في المحادثة الخاصة حفاظًا على الخصوصية.');
  return false;
}

// ================== Subscription ==================
async function checkJoin(userId) {
  const settings = getSettings();

  try {
    if (!settings.forceSub || !settings.channel) return true;

    const member = await bot.getChatMember(settings.channel, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (error) {
    logError('checkJoin', error);
    return false;
  }
}

async function forceJoin(msg) {
  const chatId = msg.chat.id;
  const settings = getSettings();

  if (!settings.forceSub || !settings.channel) return true;

  const joined = await checkJoin(chatId);
  if (joined) {
    const state = getState(chatId);
    if (state?.type === 'force_join_notice') clearState(chatId);
    return true;
  }

  const state = getState(chatId);
  if (state?.type === 'force_join_notice') {
    return false;
  }

  setState(chatId, { type: 'force_join_notice' });

  await safeSendMessage(
    chatId,
    settings.joinText ||
      '⚠️ يجب الاشتراك في القناة أولاً\n\n1- اضغط على زر الاشتراك\n2- ثم اضغط تحقق',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 الاشتراك', url: settings.channelLink || buildChannelLink(settings.channel) || 'https://t.me/' }],
          [{ text: '✅ تحقق', callback_data: 'check' }]
        ]
      }
    }
  );

  return false;
}

// ================== UI ==================
async function showMenu(chatId) {
  await safeSendMessage(chatId, '📋 القائمة الرئيسية', {
    reply_markup: getMainMenuKeyboard()
  });
}

async function showAdminMenu(chatId) {
  await safeSendMessage(chatId, '👑 لوحة الإدارة', {
    reply_markup: getAdminMenuKeyboard()
  });
}

async function showMyEmails(chatId) {
  const user = ensureUser(chatId);
  const list = user.emails || [];

  if (list.length === 0) {
    await safeSendMessage(chatId, '📭 لا يوجد لديك إيميلات');
    return;
  }

  for (let i = 0; i < list.length; i += 1) {
    const emailObj = list[i];
    await safeSendMessage(
      chatId,
      `📧 البريد:\n${emailObj.email}\n\n🔐 كلمة المرور:\n${emailObj.password}\n\n🔕 الحالة: ${
        emailObj.mute ? 'مكتوم' : 'نشط'
      }`,
      {
        reply_markup: getEmailActionsKeyboard(i, emailObj.mute)
      }
    );
  }
}

// ================== Mail.tm API ==================
const mailApi = axios.create({
  baseURL: MAIL_TM_BASE,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json'
  }
});

let cachedDomain = {
  value: null,
  expiresAt: 0
};

async function getAvailableDomain() {
  const now = Date.now();
  if (cachedDomain.value && cachedDomain.expiresAt > now) {
    return cachedDomain.value;
  }

  const response = await mailApi.get('/domains?page=1');
  const domains = response?.data?.['hydra:member'];

  if (!Array.isArray(domains) || domains.length === 0 || !domains[0].domain) {
    throw new Error('No available domains from mail.tm');
  }

  cachedDomain = {
    value: domains[0].domain,
    expiresAt: now + 10 * 60 * 1000
  };

  return cachedDomain.value;
}

async function createMailAccount(address, password) {
  await mailApi.post('/accounts', {
    address,
    password
  });

  const tokenResponse = await mailApi.post('/token', {
    address,
    password
  });

  return tokenResponse?.data?.token;
}

async function fetchMessagesPage(apiToken, page = 1) {
  const response = await mailApi.get(`/messages?page=${page}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  });

  return response.data;
}

async function fetchMessageDetails(apiToken, messageId) {
  const response = await mailApi.get(`/messages/${messageId}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  });

  return response.data;
}

// ================== Email Operations ==================
async function createEmail(userId, customName = null) {
  try {
    const domain = await getAvailableDomain();

    let chosenName = customName ? String(customName).trim().toLowerCase() : null;

    if (chosenName) {
      if (!isValidEmailName(chosenName)) {
        await safeSendMessage(
          userId,
          '⚠️ اسم البريد غير صالح.\n\nاستخدم فقط أحرف إنجليزية صغيرة وأرقام، بين 3 و 30 حرفًا.'
        );
        return;
      }
    } else {
      let created = false;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateRandomName(10);
        const email = `${candidate}@${domain}`;
        const password = generatePassword();

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

          await safeSendMessage(userId, `📧 البريد:\n${email}\n\n🔐 كلمة المرور:\n${password}`);
          created = true;
          break;
        } catch (error) {
          if (error?.response?.status !== 422) {
            throw error;
          }
        }
      }

      if (!created) {
        await safeSendMessage(userId, '❌ تعذر إنشاء بريد عشوائي حاليًا، حاول مرة أخرى.');
      }

      return;
    }

    const email = `${chosenName}@${domain}`;
    const password = generatePassword();
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

    await safeSendMessage(userId, `📧 البريد:\n${email}\n\n🔐 كلمة المرور:\n${password}`);
  } catch (error) {
    if (error?.response?.status === 422) {
      await safeSendMessage(userId, '⚠️ هذا الاسم مستخدم، جرب اسمًا آخر.');
      return;
    }

    logError('createEmail', error);
    await safeSendMessage(userId, '❌ حدث خطأ أثناء إنشاء البريد.');
  }
}

async function transferEmail(fromUserId, toUserIdRaw, emailIndex) {
  const fromId = String(fromUserId);
  const toId = String(toUserIdRaw).trim();

  if (!/^\d+$/.test(toId)) {
    await safeSendMessage(fromId, '⚠️ أرسل ID مستخدم صحيحًا.');
    return;
  }

  const sender = ensureUser(fromId);
  const emailObj = sender.emails[emailIndex];

  if (!emailObj) {
    await safeSendMessage(fromId, '❌ البريد المطلوب غير موجود.');
    return;
  }

  const targetUser = ensureUser(toId);

  targetUser.emails.push(emailObj);
  sender.emails.splice(emailIndex, 1);
  saveDB();

  const delivered = await safeSendMessage(
    toId,
    `📥 تم نقل إيميل لك\n\n📧 ${emailObj.email}\n🔐 ${emailObj.password}`
  );

  if (!delivered) {
    sender.emails.splice(emailIndex, 0, emailObj);
    targetUser.emails.pop();
    saveDB();

    await safeSendMessage(
      fromId,
      '❌ فشل النقل، غالبًا المستخدم لم يبدأ البوت أو لا يمكن مراسلته.'
    );
    return;
  }

  await safeSendMessage(fromId, '✅ تم نقل الإيميل بنجاح.');
}

async function forwardSupportMessage(fromMsg, content) {
  const senderId = fromMsg.from?.id;
  const username = fromMsg.from?.username ? `@${fromMsg.from.username}` : 'بدون معرف';
  const fullName = [fromMsg.from?.first_name, fromMsg.from?.last_name].filter(Boolean).join(' ') || 'غير معروف';

  const text =
    `📩 رسالة دعم جديدة\n\n` +
    `👤 الاسم: ${fullName}\n` +
    `🆔 ID: ${senderId}\n` +
    `🔗 المعرف: ${username}\n\n` +
    `💬 الرسالة:\n${content}`;

  const admins = getAdmins();

  if (!admins.length) {
    await safeSendMessage(senderId, '❌ لا يوجد مشرفون لاستقبال الرسالة حاليًا.');
    return;
  }

  let sentCount = 0;

  for (const adminId of admins) {
    const sent = await safeSendMessage(adminId, text);
    if (sent) sentCount += 1;
  }

  if (sentCount > 0) {
    await safeSendMessage(senderId, '✅ تم إرسال رسالتك إلى الدعم.');
  } else {
    await safeSendMessage(senderId, '❌ تعذر إرسال رسالتك إلى الدعم حاليًا.');
  }
}

// ================== Commands ==================
bot.onText(/\/start/, async (msg) => {
  if (!(await requirePrivateChat(msg))) return;
  if (!(await forceJoin(msg))) return;
  clearState(msg.chat.id);
  await showMenu(msg.chat.id);
});

bot.onText(/\/menu/, async (msg) => {
  if (!(await requirePrivateChat(msg))) return;
  if (!(await forceJoin(msg))) return;
  await showMenu(msg.chat.id);
});

bot.onText(/\/help/, async (msg) => {
  if (!(await requirePrivateChat(msg))) return;
  if (!(await forceJoin(msg))) return;

  await safeSendMessage(
    msg.chat.id,
    '📘 الأوامر المتاحة:\n\n' +
      '/start - بدء البوت\n' +
      '/menu - عرض القائمة الرئيسية\n' +
      '/admin - لوحة الإدارة\n' +
      '/cancel - إلغاء العملية الحالية\n\n' +
      'يمكنك أيضًا إرسال اسم مخصص لإنشاء بريد بنفس الاسم.'
  );
});

bot.onText(/\/cancel/, async (msg) => {
  if (!(await requirePrivateChat(msg))) return;
  clearState(msg.chat.id);
  await safeSendMessage(msg.chat.id, '✅ تم إلغاء العملية الحالية.');
});

bot.onText(/\/admin/, async (msg) => {
  if (!(await requirePrivateChat(msg))) return;

  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  await showAdminMenu(chatId);
});

// ================== Callback Buttons ==================
bot.on('callback_query', async (query) => {
  const chatId = query?.message?.chat?.id;
  const data = query?.data || '';

  if (!chatId) {
    await safeAnswerCallback(query.id);
    return;
  }

  await safeAnswerCallback(query.id);

  if (!(await forceJoin(query.message))) return;

  const user = ensureUser(chatId);

  if (data === 'check') {
    const joined = await checkJoin(chatId);

    if (joined) {
      clearState(chatId);
      await safeSendMessage(chatId, '✅ تم التحقق بنجاح');
      await showMenu(chatId);
    } else {
      await safeSendMessage(chatId, '❌ لم يتم التحقق، تأكد من الاشتراك أولًا.');
    }
    return;
  }

  if (data === 'create') {
    await createEmail(chatId);
    return;
  }

  if (data === 'my') {
    await showMyEmails(chatId);
    return;
  }

  if (data === 'support') {
    setState(chatId, { type: 'support_message' });
    await safeSendMessage(chatId, '📩 ارسل الآن رسالتك ليتم تحويلها إلى الدعم.');
    return;
  }

  if (data.startsWith('del_')) {
    const index = Number(data.split('_')[1]);

    if (!Number.isInteger(index) || !user.emails[index]) {
      await safeSendMessage(chatId, '❌ البريد المطلوب غير موجود.');
      return;
    }

    user.emails.splice(index, 1);
    saveDB();
    await safeSendMessage(chatId, '🗑️ تم الحذف.');
    return;
  }

  if (data.startsWith('tran_')) {
    const index = Number(data.split('_')[1]);

    if (!Number.isInteger(index) || !user.emails[index]) {
      await safeSendMessage(chatId, '❌ البريد المطلوب غير موجود.');
      return;
    }

    setState(chatId, { type: 'transfer', index });
    await safeSendMessage(chatId, '📨 أرسل ID المستخدم الذي تريد نقل الإيميل إليه.');
    return;
  }

  if (data.startsWith('mute_')) {
    const index = Number(data.split('_')[1]);

    if (!Number.isInteger(index) || !user.emails[index]) {
      await safeSendMessage(chatId, '❌ البريد المطلوب غير موجود.');
      return;
    }

    user.emails[index].mute = !user.emails[index].mute;
    saveDB();

    await safeSendMessage(
      chatId,
      user.emails[index].mute ? '🔇 تم كتم إشعارات هذا الإيميل.' : '🔔 تم إلغاء كتم إشعارات هذا الإيميل.'
    );
    return;
  }

  if (['set_channel', 'enable_sub', 'disable_sub', 'set_join_text'].includes(data)) {
    if (!isAdmin(chatId)) {
      await safeSendMessage(chatId, '⛔ هذا الأمر للمشرفين فقط.');
      return;
    }
  }

  if (data === 'set_channel') {
    setState(chatId, { type: 'set_channel' });
    await safeSendMessage(chatId, '📌 أرسل الآن معرف القناة مثل @channel أو رابطها العام.');
    return;
  }

  if (data === 'enable_sub') {
    getSettings().forceSub = true;
    saveDB();
    await safeSendMessage(chatId, '✅ تم تفعيل الاشتراك الإجباري.');
    return;
  }

  if (data === 'disable_sub') {
    getSettings().forceSub = false;
    saveDB();
    await safeSendMessage(chatId, '❌ تم تعطيل الاشتراك الإجباري.');
    return;
  }

  if (data === 'set_join_text') {
    setState(chatId, { type: 'set_join_text' });
    await safeSendMessage(chatId, '✏️ أرسل النص الجديد لرسالة الاشتراك.');
  }
});

// ================== Incoming Messages ==================
bot.on('message', async (msg) => {
  try {
    if (!(await requirePrivateChat(msg))) return;

    const chatId = msg.chat.id;
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';

    if (!(await forceJoin(msg))) return;
    if (!text) return;
    if (text.startsWith('/')) return;

    const state = getState(chatId);

    if (state?.type === 'set_channel') {
      if (!isAdmin(chatId)) {
        clearState(chatId);
        await safeSendMessage(chatId, '⛔ هذا الإجراء للمشرفين فقط.');
        return;
      }

      const normalizedChannel = normalizeChannelValue(text);
      const channelLink = buildChannelLink(normalizedChannel);

      if (!normalizedChannel) {
        await safeSendMessage(chatId, '⚠️ أدخل قيمة صحيحة للقناة.');
        return;
      }

      getSettings().channel = normalizedChannel;
      getSettings().channelLink = channelLink;
      clearState(chatId);
      saveDB();

      await safeSendMessage(
        chatId,
        `✅ تم حفظ القناة بنجاح.\n\nالقناة: ${normalizedChannel}\nالرابط: ${channelLink || 'غير متوفر'}`
      );
      return;
    }

    if (state?.type === 'set_join_text') {
      if (!isAdmin(chatId)) {
        clearState(chatId);
        await safeSendMessage(chatId, '⛔ هذا الإجراء للمشرفين فقط.');
        return;
      }

      getSettings().joinText = text;
      clearState(chatId);
      saveDB();

      await safeSendMessage(chatId, '✅ تم حفظ رسالة الاشتراك.');
      return;
    }

    if (state?.type === 'transfer') {
      await transferEmail(chatId, text, state.index);
      clearState(chatId);
      return;
    }

    if (state?.type === 'support_message') {
      await forwardSupportMessage(msg, text);
      clearState(chatId);
      return;
    }

    await createEmail(chatId, text.toLowerCase());
  } catch (error) {
    logError('messageHandler', error);
  }
});

// ================== Mail Polling ==================
let pollingInProgress = false;

async function pollUserEmails(userId, user) {
  if (!user || !Array.isArray(user.emails) || user.emails.length === 0) {
    return;
  }

  for (const emailObj of user.emails) {
    if (!emailObj || emailObj.mute || !emailObj.apiToken) continue;

    try {
      const knownMessageIds = new Set(Array.isArray(emailObj.last) ? emailObj.last.map(String) : []);
      const newMessageIds = [];
      let page = 1;

      while (page <= 3) {
        const data = await fetchMessagesPage(emailObj.apiToken, page);
        const messages = data?.['hydra:member'];

        if (!Array.isArray(messages) || messages.length === 0) {
          break;
        }

        for (const message of messages) {
          if (!knownMessageIds.has(String(message.id))) {
            newMessageIds.push(String(message.id));
          }
        }

        const nextPageExists = Boolean(data?.['hydra:view']?.['hydra:next']);
        if (!nextPageExists) break;
        page += 1;
      }

      newMessageIds.reverse();

      for (const messageId of newMessageIds) {
        const full = await fetchMessageDetails(emailObj.apiToken, messageId);

        const fromAddress = full?.from?.address || 'غير معروف';
        const subject = full?.subject || 'بدون عنوان';
        const contentRaw = full?.text || stripHtml(full?.html || '') || 'لا يوجد محتوى';
        const content = truncateText(cleanMessageText(contentRaw), 2500);

        await safeSendMessage(
          userId,
          `📨 رسالة جديدة\n\n` +
            `📧 البريد: ${emailObj.email}\n` +
            `👤 المرسل: ${fromAddress}\n` +
            `📌 العنوان: ${subject}\n\n` +
            `📩 الرسالة:\n${content}`
        );

        knownMessageIds.add(String(messageId));
      }

      emailObj.last = Array.from(knownMessageIds).slice(-MAX_LAST_MESSAGES);
      saveDB();
    } catch (error) {
      logError(`pollUserEmails:${userId}:${emailObj.email}`, error);
    }
  }
}

async function pollAllEmails() {
  if (pollingInProgress) return;

  pollingInProgress = true;

  try {
    const users = getUsers();
    for (const userId of Object.keys(users)) {
      await pollUserEmails(userId, users[userId]);
    }
  } catch (error) {
    logError('pollAllEmails', error);
  } finally {
    pollingInProgress = false;
  }
}

setInterval(() => {
  pollAllEmails().catch(error => logError('pollInterval', error));
}, POLL_INTERVAL_MS);

// ================== Process Events ==================
bot.on('polling_error', (error) => {
  logError('polling_error', error);
});

process.on('unhandledRejection', (error) => {
  logError('unhandledRejection', error);
});

process.on('uncaughtException', (error) => {
  logError('uncaughtException', error);
});
