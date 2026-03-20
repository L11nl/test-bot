const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

let users = {};

// رسالة البداية
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 أهلاً!\n\n/send لإنشاء إيميل مؤقت\n/inbox لعرض الرسائل");
});

// إنشاء إيميل
bot.onText(/\/send/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const domainRes = await axios.get("https://api.mail.tm/domains");
    const domain = domainRes.data["hydra:member"][0].domain;

    const email = `user${Date.now()}@${domain}`;
    const password = "123456";

    await axios.post("https://api.mail.tm/accounts", {
      address: email,
      password: password
    });

    const tokenRes = await axios.post("https://api.mail.tm/token", {
      address: email,
      password: password
    });

    const apiToken = tokenRes.data.token;

    users[chatId] = { email, apiToken };

    bot.sendMessage(chatId, `✅ تم إنشاء الإيميل:\n${email}\n\nاستخدم /inbox`);

  } catch (e) {
    bot.sendMessage(chatId, "❌ خطأ");
    console.log(e.response?.data || e.message);
  }
});

// عرض الرسائل
bot.onText(/\/inbox/, async (msg) => {
  const chatId = msg.chat.id;

  if (!users[chatId]) {
    return bot.sendMessage(chatId, "❗ استخدم /send أولاً");
  }

  try {
    const res = await axios.get("https://api.mail.tm/messages", {
      headers: {
        Authorization: `Bearer ${users[chatId].apiToken}`
      }
    });

    const messages = res.data["hydra:member"];

    if (messages.length === 0) {
      return bot.sendMessage(chatId, "📭 لا توجد رسائل");
    }

    let text = "📨 الرسائل:\n\n";

    messages.forEach(m => {
      text += `📧 من: ${m.from.address}\n`;
      text += `📌 العنوان: ${m.subject}\n\n`;
    });

    bot.sendMessage(chatId, text);

  } catch (e) {
    bot.sendMessage(chatId, "❌ خطأ في جلب الرسائل");
  }
});
