require('dotenv').config();

const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const FormData = require('form-data');
const { Sequelize, DataTypes } = require('sequelize');

const TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!TOKEN || !DATABASE_URL) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false }
  },
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }
});

const User = sequelize.define('User', {
  id: { type: DataTypes.BIGINT, primaryKey: true },
  lastCodeAt: { type: DataTypes.DATE, allowNull: true }
});

const CHATGPT_PAGE_URL = 'https://www.bbvadescuentos.mx/develop/openai-3msc';
const CHATGPT_POST_URL = 'https://www.bbvadescuentos.mx/admin-site/php/_httprequest.php';

const CHATGPT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Origin': 'https://www.bbvadescuentos.mx',
  'Referer': CHATGPT_PAGE_URL,
  'Accept': 'application/json, text/plain, */*'
};

const COOLDOWN_MS = 5 * 60 * 1000;

let chatGptCookieCache = {
  cookies: null,
  fetchedAt: 0
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateRandomEmail() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let localPart = '';
  for (let i = 0; i < 10; i += 1) {
    localPart += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${localPart}@gmail.com`;
}

function buildCookieHeader(cookieMap = {}) {
  return Object.entries(cookieMap)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function parseSetCookie(setCookieHeaders = []) {
  const cookieMap = {};
  for (const item of setCookieHeaders) {
    const [pair] = String(item).split(';');
    const eqIndex = pair.indexOf('=');
    if (eqIndex > 0) {
      const key = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      cookieMap[key] = value;
    }
  }
  return cookieMap;
}

function getFallbackChatGptCookies() {
  const fallback = {};
  if (process.env.CHATGPT_AK_BMSC) fallback.ak_bmsc = process.env.CHATGPT_AK_BMSC;
  if (process.env.CHATGPT_BM_SV) fallback.bm_sv = process.env.CHATGPT_BM_SV;
  return fallback;
}

async function refreshChatGPTCookies(force = false) {
  const now = Date.now();

  if (
    !force &&
    chatGptCookieCache.cookies &&
    now - chatGptCookieCache.fetchedAt < 5 * 60 * 1000
  ) {
    return chatGptCookieCache.cookies;
  }

  try {
    const response = await axios.get(CHATGPT_PAGE_URL, {
      timeout: 15000,
      headers: CHATGPT_HEADERS,
      validateStatus: () => true
    });

    const cookies = parseSetCookie(response.headers['set-cookie'] || []);
    const merged = { ...getFallbackChatGptCookies(), ...cookies };

    chatGptCookieCache = {
      cookies: merged,
      fetchedAt: now
    };

    return merged;
  } catch (err) {
    console.error('Failed to refresh ChatGPT cookies:', err.message);
    const fallback = getFallbackChatGptCookies();

    chatGptCookieCache = {
      cookies: fallback,
      fetchedAt: now
    };

    return fallback;
  }
}

async function getChatGPTCode(email) {
  const attempt = async (forceRefresh = false) => {
    const cookies = await refreshChatGPTCookies(forceRefresh);
    const cookieHeader = buildCookieHeader(cookies);

    const form = new FormData();
    form.append('assignOpenAICode', 'true');
    form.append('email', email);

    return axios.post(CHATGPT_POST_URL, form, {
      timeout: 20000,
      maxBodyLength: Infinity,
      headers: {
        ...CHATGPT_HEADERS,
        ...form.getHeaders(),
        Cookie: cookieHeader
      },
      validateStatus: () => true
    });
  };

  try {
    let response = await attempt(false);

    if (response.status === 403 || response.status === 429) {
      response = await attempt(true);
    }

    if (response.status !== 200) {
      return { success: false, reason: `HTTP ${response.status}` };
    }

    const data = response.data || {};

    if (data.success === 1 && data.code) {
      return { success: true, code: data.code };
    }

    return { success: false, reason: data.message || 'Unknown error' };
  } catch (err) {
    console.error('ChatGPT API error:', err.response?.data || err.message);
    return { success: false, reason: err.message || 'Request failed' };
  }
}

async function findOrCreateUser(userId) {
  const [user] = await User.findOrCreate({
    where: { id: userId },
    defaults: { lastCodeAt: null }
  });
  return user;
}

function getRemainingTimeText(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} دقيقة و ${seconds} ثانية`;
}

async function sendMainMenu(chatId) {
  await bot.sendMessage(chatId, 'اختر الزر:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🤖 كود ChatGPT', callback_data: 'chatgpt_code' }]
      ]
    }
  });
}

bot.onText(/\/start/, async (msg) => {
  const userId = msg.chat.id;

  try {
    await findOrCreateUser(userId);
    await sendMainMenu(userId);
  } catch (err) {
    console.error('/start error:', err);
    await bot.sendMessage(userId, 'حدث خطأ.');
  }
});

bot.on('callback_query', async (query) => {
  const userId = query.message.chat.id;
  const data = query.data;

  try {
    await findOrCreateUser(userId);

    if (data !== 'chatgpt_code') {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    const user = await User.findByPk(userId);

    if (user.lastCodeAt) {
      const diff = Date.now() - new Date(user.lastCodeAt).getTime();

      if (diff < COOLDOWN_MS) {
        const remaining = COOLDOWN_MS - diff;
        await bot.answerCallbackQuery(query.id, {
          text: `لازم تنتظر ${getRemainingTimeText(remaining)}`,
          show_alert: true
        });
        return;
      }
    }

    await bot.answerCallbackQuery(query.id);

    const waitingMsg = await bot.sendMessage(userId, '⏳ جاري جلب الكود...');
    const email = generateRandomEmail();
    const result = await getChatGPTCode(email);

    await bot.deleteMessage(userId, waitingMsg.message_id).catch(() => {});

    if (!result.success) {
      await bot.sendMessage(userId, `❌ فشل جلب الكود:\n${result.reason}`);
      return;
    }

    user.lastCodeAt = new Date();
    await user.save();

    await bot.sendMessage(
      userId,
      `✅ هذا هو كود ChatGPT الخاص بك:\n\n<code>${escapeHtml(result.code)}</code>\n\n🕒 تقدر تطلب كود جديد بعد 5 دقائق.`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('callback_query error:', err);
    await bot.sendMessage(userId, 'حدث خطأ أثناء تنفيذ الطلب.');
  }
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/start')) return;

  const userId = msg.chat.id;

  try {
    await findOrCreateUser(userId);
    await sendMainMenu(userId);
  } catch (err) {
    console.error('message error:', err);
  }
});

setInterval(async () => {
  try {
    await refreshChatGPTCookies(true);
    console.log('✅ ChatGPT cookies refreshed');
  } catch (err) {
    console.error('Cookie refresh error:', err.message);
  }
}, 5 * 60 * 1000);

sequelize.sync().then(async () => {
  console.log('✅ Database synced');
  await refreshChatGPTCookies(false);
  console.log('✅ Bot is running');
}).catch(err => {
  console.error('Database error:', err);
  process.exit(1);
});
