/*
================= بوت ChatGPT + بريد مؤقت + عرض BBVA =================
✔️ ضع التوكن ومفتاح OpenAI في الأسفل
✔️ لا حاجة لتهيئة إضافية
✔️ يعمل فور التشغيل
=================================================================
*/

'use strict';

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ================== التوكنات الثابتة (ضعها هنا) ==================
const BOT_TOKEN = 'YOUR_BOT_TOKEN';            // <- ضع التوكن هنا
const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY';  // <- ضع مفتاح OpenAI هنا
const PORT = Number(process.env.PORT) || 3000;

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN') {
  console.error('❌ الرجاء وضع التوكن الصحيح في الكود');
  process.exit(1);
}
if (!OPENAI_API_KEY || OPENAI_API_KEY === 'YOUR_OPENAI_API_KEY') {
  console.error('❌ الرجاء وضع مفتاح OpenAI الصحيح');
  process.exit(1);
}

// ================== إعداد البوت والسيرفر ==================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.get('/', (_req, res) => res.send('Bot alive'));
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// ================== قاعدة البيانات ==================
const DB_FILE = path.join(__dirname, 'data.json');

function defaultDB() {
  return {
    users: {},     // userId -> { lang, chatHistory, tempEmails }
    settings: {}   // مجرد placeholder
  };
}

function normalizeDB(raw) {
  const db = raw && typeof raw === 'object' ? raw : defaultDB();
  if (!db.users) db.users = {};
  if (!db.settings) db.settings = {};
  for (const uid of Object.keys(db.users)) {
    const u = db.users[uid];
    if (!u) {
      db.users[uid] = { lang: 'ar', chatHistory: [], tempEmails: [] };
      continue;
    }
    if (!u.lang) u.lang = 'ar';
    if (!Array.isArray(u.chatHistory)) u.chatHistory = [];
    if (!Array.isArray(u.tempEmails)) u.tempEmails = [];
  }
  return db;
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return normalizeDB(defaultDB());
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw.trim()) return normalizeDB(defaultDB());
    return normalizeDB(JSON.parse(raw));
  } catch (e) {
    console.error('❌ خطأ في تحميل البيانات:', e.message);
    return normalizeDB(defaultDB());
  }
}

let db = loadDB();
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ خطأ في حفظ البيانات:', e.message);
  }
}

function ensureUser(userId) {
  const id = String(userId);
  if (!db.users[id]) {
    db.users[id] = { lang: 'ar', chatHistory: [], tempEmails: [] };
    saveDB();
  }
  return db.users[id];
}

function getUserLang(userId) {
  return ensureUser(userId).lang;
}

function setUserLang(userId, lang) {
  const u = ensureUser(userId);
  u.lang = lang;
  saveDB();
}

// ================== مساعدات عامة ==================
const TELEGRAM_LIMIT = 4096;
function truncate(text) {
  const s = String(text || '');
  if (s.length <= TELEGRAM_LIMIT) return s;
  return s.slice(0, TELEGRAM_LIMIT - 3) + '...';
}

async function safeSend(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, truncate(text), options);
  } catch (e) {
    console.error(`إرسال فاشل لـ ${chatId}:`, e.message);
    return null;
  }
}

// ================== الترجمة (عربي فقط لتبسيط) ==================
function t(userId, key) {
  const lang = getUserLang(userId);
  const texts = {
    ar: {
      main_menu: '📋 القائمة الرئيسية',
      ask_chatgpt: '💬 اسأل ChatGPT',
      temp_email: '📧 إنشاء بريد مؤقت',
      activate_offer: '🎁 تفعيل ChatGPT Go',
      language: '🌐 تغيير اللغة',
      choose_language: '🌐 اختر اللغة',
      lang_updated_ar: '✅ تم تغيير اللغة إلى العربية.',
      lang_updated_en: '✅ Language changed to English.',
      ask_start: '🤖 أرسل سؤالك الآن وسأجيب باستخدام ChatGPT.\nلإنهاء المحادثة استخدم /cancel',
      ask_error: '❌ حدث خطأ، حاول مجدداً.',
      no_answer: '⚠️ لم أحصل على إجابة.',
      chat_ended: '🔚 تم إنهاء المحادثة.',
      offer_text:
        '🎁 استفد من عرض BBVA الحصري:\n\n' +
        'احصل على **3 أشهر مجانية** من اشتراك ChatGPT Go!\n\n' +
        '📌 الخطوات:\n' +
        '1. افتح الرابط: https://www.bbva.mx/chatgpt.html\n' +
        '2. أدخل بريدك الإلكتروني للحصول على كود التفعيل.\n' +
        '3. اتبع التعليمات على الموقع وأضف بطاقة BBVA (لن يتم خصم أي مبلغ).\n\n' +
        '🔔 العرض ساري حتى 23 أغسطس 2026.\n\n' +
        'استمتع بذكاء اصطناعي أقوى! 🤖✨',
      email_created: '✅ تم إنشاء البريد المؤقت:\n\n📧 البريد: %s\n🔐 كلمة المرور: %s\n\n⚠️ لا تفقدها، يمكنك استخدامه الآن.',
      email_error: '❌ فشل إنشاء البريد المؤقت، حاول مجدداً.',
      invalid_input: '⚠️ أرسل نصًا صالحًا أو استخدم الأزرار.',
      help: '📘 استخدم الأزرار للتفاعل.'
    },
    en: {
      main_menu: '📋 Main Menu',
      ask_chatgpt: '💬 Ask ChatGPT',
      temp_email: '📧 Create Temp Email',
      activate_offer: '🎁 Activate ChatGPT Go',
      language: '🌐 Change Language',
      choose_language: '🌐 Choose language',
      lang_updated_ar: '✅ تم تغيير اللغة إلى العربية.',
      lang_updated_en: '✅ Language changed to English.',
      ask_start: '🤖 Send your question now, I will answer using ChatGPT.\nUse /cancel to end.',
      ask_error: '❌ Error, try again.',
      no_answer: '⚠️ No answer received.',
      chat_ended: '🔚 Conversation ended.',
      offer_text:
        '🎁 Take advantage of BBVA exclusive offer:\n\n' +
        'Get **3 months free** of ChatGPT Go subscription!\n\n' +
        '📌 Steps:\n' +
        '1. Open the link: https://www.bbva.mx/chatgpt.html\n' +
        '2. Enter your email to receive the activation code.\n' +
        '3. Follow the instructions and add your BBVA card (no charge).\n\n' +
        '🔔 Offer valid until August 23, 2026.\n\n' +
        'Enjoy a more powerful AI! 🤖✨',
      email_created: '✅ Temporary email created:\n\n📧 Email: %s\n🔐 Password: %s\n\n⚠️ Keep it safe.',
      email_error: '❌ Failed to create temporary email, try again.',
      invalid_input: '⚠️ Send valid text or use buttons.',
      help: '📘 Use the buttons.'
    }
  };
  const tObj = texts[lang] || texts.ar;
  return tObj[key] || texts.ar[key];
}

// ================== دوال البريد المؤقت (mail.tm) ==================
const MAIL_TM_BASE = 'https://api.mail.tm';
const mailApi = axios.create({ baseURL: MAIL_TM_BASE, timeout: 15000 });

async function getDomain() {
  const res = await mailApi.get('/domains?page=1');
  const list = res?.data?.['hydra:member'];
  if (!Array.isArray(list) || !list.length) throw new Error('No domains');
  return list[0].domain;
}

async function createTempEmail(userId) {
  try {
    const domain = await getDomain();
    const name = Math.random().toString(36).substring(2, 12);
    const email = `${name}@${domain}`;
    const password = Math.random().toString(36).slice(-8) + 'A1!';
    await mailApi.post('/accounts', { address: email, password });
    const tokenRes = await mailApi.post('/token', { address: email, password });
    const token = tokenRes.data.token;

    const user = ensureUser(userId);
    user.tempEmails.push({ email, password, token });
    saveDB();

    return { email, password };
  } catch (e) {
    console.error('createTempEmail error:', e.message);
    return null;
  }
}

// ================== ChatGPT API ==================
const MAX_HISTORY = 10;
async function askChatGPT(userId, prompt) {
  const user = ensureUser(userId);
  const history = user.chatHistory || [];
  const messages = [
    ...history,
    { role: 'user', content: prompt }
  ];
  try {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 1000,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const reply = res.data.choices[0].message.content.trim();
    user.chatHistory.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: reply }
    );
    if (user.chatHistory.length > MAX_HISTORY * 2)
      user.chatHistory = user.chatHistory.slice(-MAX_HISTORY * 2);
    saveDB();
    return reply;
  } catch (e) {
    console.error('askChatGPT error:', e.message);
    return null;
  }
}

// ================== واجهات لوحة المفاتيح ==================
function mainKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: t(userId, 'ask_chatgpt'), callback_data: 'ask' }],
      [{ text: t(userId, 'temp_email'), callback_data: 'temp' }],
      [{ text: t(userId, 'activate_offer'), callback_data: 'offer' }],
      [{ text: t(userId, 'language'), callback_data: 'lang' }]
    ]
  };
}

function langKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🇮🇶 العربية', callback_data: 'lang_ar' },
       { text: '🇺🇸 English', callback_data: 'lang_en' }]
    ]
  };
}

// ================== عرض القوائم ==================
async function showMainMenu(chatId) {
  await safeSend(chatId, t(chatId, 'main_menu'), { reply_markup: mainKeyboard(chatId) });
}

// ================== معالجة الأزرار والرسائل ==================
const states = {}; // userId -> { type: 'chatting' }

bot.onText(/\/start/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  ensureUser(userId);
  delete states[userId];
  await showMainMenu(userId);
});

bot.onText(/\/cancel/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  delete states[userId];
  await safeSend(userId, t(userId, 'chat_ended'));
  await showMainMenu(userId);
});

bot.on('callback_query', async (q) => {
  const userId = q.from.id;
  const data = q.data;
  await bot.answerCallbackQuery(q.id);

  if (data === 'lang') {
    await safeSend(userId, t(userId, 'choose_language'), { reply_markup: langKeyboard() });
    return;
  }
  if (data === 'lang_ar') {
    setUserLang(userId, 'ar');
    await safeSend(userId, t(userId, 'lang_updated_ar'));
    await showMainMenu(userId);
    return;
  }
  if (data === 'lang_en') {
    setUserLang(userId, 'en');
    await safeSend(userId, t(userId, 'lang_updated_en'));
    await showMainMenu(userId);
    return;
  }

  if (data === 'ask') {
    states[userId] = { type: 'chatting' };
    await safeSend(userId, t(userId, 'ask_start'));
    return;
  }

  if (data === 'temp') {
    const emailData = await createTempEmail(userId);
    if (emailData) {
      const msg = t(userId, 'email_created').replace('%s', emailData.email).replace('%s', emailData.password);
      await safeSend(userId, msg);
    } else {
      await safeSend(userId, t(userId, 'email_error'));
    }
    return;
  }

  if (data === 'offer') {
    await safeSend(userId, t(userId, 'offer_text'));
    // يمكن إضافة خيار إنشاء بريد مؤقت فوري:
    // await safeSend(userId, 'هل تريد إنشاء بريد مؤقت للتسجيل؟ اضغط /temp');
    return;
  }
});

bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const state = states[userId];
  if (state && state.type === 'chatting') {
    await bot.sendChatAction(userId, 'typing');
    const reply = await askChatGPT(userId, text);
    if (reply) {
      await safeSend(userId, reply);
    } else {
      await safeSend(userId, t(userId, 'ask_error'));
    }
    return;
  }

  // إذا لم يكن في وضع المحادثة، نعرض القائمة
  await safeSend(userId, t(userId, 'help'));
  await showMainMenu(userId);
});

bot.on('polling_error', (e) => console.error(e));
process.on('unhandledRejection', (e) => console.error(e));
