const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

let users = {};

// 🔤 كلمات عشوائية
const words = ["red", "blue", "sky", "fox", "wolf", "star", "moon", "sun", "fire", "ice"];

// توليد إيميل عشوائي (كلمات)
function generateEmail(domain) {
  const name =
    words[Math.floor(Math.random() * words.length)] +
    words[Math.floor(Math.random() * words.length)] +
    Math.floor(Math.random() * 100);

  return `${name}@${domain}`;
}

// توليد باسورد عشوائي
function generatePassword() {
  return Math.random().toString(36).slice(-10);
}

// رسالة البداية
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 أهلاً!\n\n/send لإنشاء إيميل مؤقت");
});

// إنشاء إيميل
bot.onText(/\/send/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const domainRes = await axios.get("https://api.mail.tm/domains");
    const domain = domainRes.data["hydra:member"][0].domain;

    const email = generateEmail(domain);
    const password = generatePassword();

    await axios.post("https://api.mail.tm/accounts", {
      address: email,
      password: password
    });

    const tokenRes = await axios.post("https://api.mail.tm/token", {
      address: email,
      password: password
    });

    const apiToken = tokenRes.data.token;

    users[chatId] = {
      email,
      password,
      apiToken,
      lastMessages: []
    };

    bot.sendMessage(chatId,
      `✅ تم إنشاء الإيميل:\n${email}\n\n🔐 الباسورد:\n${password}\n\n📥 سيتم إرسال الرسائل تلقائيًا هنا`
    );

  } catch (e) {
    bot.sendMessage(chatId, "❌ خطأ");
    console.log(e.response?.data || e.message);
  }
});


// 🔔 فحص الرسائل تلقائي
setInterval(async () => {
  for (let chatId in users) {
    try {
      const user = users[chatId];

      const res = await axios.get("https://api.mail.tm/messages", {
        headers: {
          Authorization: `Bearer ${user.apiToken}`
        }
      });

      const messages = res.data["hydra:member"];

      for (let m of messages) {
        // إذا الرسالة جديدة
        if (!user.lastMessages.includes(m.id)) {

          const detail = await axios.get(`https://api.mail.tm/messages/${m.id}`, {
            headers: {
              Authorization: `Bearer ${user.apiToken}`
            }
          });

          const content = detail.data.text || "لا يوجد محتوى";

          bot.sendMessage(chatId,
            `📨 رسالة جديدة!\n\n📧 من: ${m.from.address}\n📌 العنوان: ${m.subject}\n\n📝 ${content}`
          );

          user.lastMessages.push(m.id);
        }
      }

    } catch (e) {
      console.log("Error checking messages:", e.message);
    }
  }
}, 10000); // كل 10 ثواني

console.log("Bot is running...");
