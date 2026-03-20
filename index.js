const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const MAIN_ADMIN = 643309456;
let admins = [MAIN_ADMIN];

let users = {};
let waitingChannel = {};
let channel = null; // لازم يكون @channelname مو رابط

// 🔥 سيرفر
app.get('/', (req, res) => res.send('Bot is alive ✅'));
app.listen(process.env.PORT || 3000);

// 🔐 باسورد
function pass() {
  return Math.random().toString(36).slice(-10);
}

// 🧠 تحويل الرابط إلى يوزر
function extractChannel(link) {
  try {
    if (link.includes("t.me/")) {
      let part = link.split("t.me/")[1];
      if (part.startsWith("+")) return null; // رابط خاص → ما نقدر نتحقق
      return "@" + part;
    }
    if (link.startsWith("@")) return link;
    return null;
  } catch {
    return null;
  }
}

// ✅ تحقق اشتراك
async function checkJoin(userId) {
  if (!channel) return true;

  try {
    const res = await bot.getChatMember(channel, userId);
    return ["member", "administrator", "creator"].includes(res.status);
  } catch {
    return true; // إذا فشل (رابط خاص مثلاً) → لا نمنع المستخدم
  }
}

// 🚫 فرض الاشتراك
async function forceJoin(msg) {
  if (!channel) return true;

  const ok = await checkJoin(msg.chat.id);

  if (!ok) {
    bot.sendMessage(msg.chat.id, "🚫 يجب الاشتراك أولاً", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 الاشتراك", url: channelLink }],
          [{ text: "✅ تحقق", callback_data: "check" }]
        ]
      }
    });
    return false;
  }

  return true;
}

// قائمة
function menu(id) {
  bot.sendMessage(id, "✨ اختر:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📧 إنشاء", callback_data: "create" },
          { text: "📂 إيميلي", callback_data: "show" }
        ]
      ]
    }
  });
}

// start
bot.onText(/\/start/, async (msg) => {
  if (!(await forceJoin(msg))) return;
  menu(msg.chat.id);
});

// 👑 الأدمن
bot.onText(/\/admin/, (msg) => {
  if (!admins.includes(msg.chat.id)) return;

  bot.sendMessage(msg.chat.id, "👑 الإدارة:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📌 تعيين قناة", callback_data: "set_channel" }],
        [{ text: "❌ حذف القناة", callback_data: "del_channel" }]
      ]
    }
  });
});

// أزرار
bot.on("callback_query", async (q) => {
  const id = q.message.chat.id;

  if (q.data === "check") {
    if (await checkJoin(id)) {
      bot.sendMessage(id, "✅ تم التحقق");
      menu(id);
    } else {
      bot.sendMessage(id, "❌ لم تشترك");
    }
  }

  if (q.data === "create") {
    bot.sendMessage(id, "✍️ اكتب اسم الإيميل");
  }

  if (q.data === "show") {
    if (!users[id]) return bot.sendMessage(id, "❗ لا يوجد");

    bot.sendMessage(id, `📧 ${users[id].email}\n🔐 ${users[id].password}`);
  }

  if (q.data === "set_channel" && admins.includes(id)) {
    waitingChannel[id] = true;
    bot.sendMessage(id, "📌 أرسل رابط القناة أو @username");
  }

  if (q.data === "del_channel" && admins.includes(id)) {
    channel = null;
    channelLink = null;
    bot.sendMessage(id, "✅ تم حذف الاشتراك الإجباري");
  }
});

// استقبال
bot.on("message", async (msg) => {
  const id = msg.chat.id;

  // تعيين قناة
  if (waitingChannel[id]) {
    const link = msg.text;
    const extracted = extractChannel(link);

    channelLink = link;
    channel = extracted;

    delete waitingChannel[id];

    bot.sendMessage(id, extracted
      ? "✅ تم تفعيل الاشتراك الإجباري"
      : "⚠️ رابط خاص → لن يتم التحقق ولكن سيتم عرضه فقط");
  }

  if (!(await forceJoin(msg))) return;

  // إنشاء إيميل
  if (!msg.text.startsWith("/")) {
    try {
      const domainRes = await axios.get("https://api.mail.tm/domains");
      const domain = domainRes.data["hydra:member"][0].domain;

      const name = msg.text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const email = `${name}@${domain}`;
      const password = pass();

      await axios.post("https://api.mail.tm/accounts", {
        address: email,
        password
      });

      const tokenRes = await axios.post("https://api.mail.tm/token", {
        address: email,
        password
      });

      users[id] = {
        email,
        password,
        apiToken: tokenRes.data.token,
        lastMessages: []
      };

      bot.sendMessage(id,
        `📧 \`${email}\`\n🔐 \`${password}\``,
        { parse_mode: "Markdown" }
      );

    } catch {
      bot.sendMessage(id, "❌ الاسم مستخدم");
    }
  }
});

// استقبال الرسائل
setInterval(async () => {
  for (let id in users) {
    const u = users[id];

    try {
      const res = await axios.get("https://api.mail.tm/messages", {
        headers: { Authorization: `Bearer ${u.apiToken}` }
      });

      for (let m of res.data["hydra:member"]) {
        if (!u.lastMessages.includes(m.id)) {

          const d = await axios.get(`https://api.mail.tm/messages/${m.id}`, {
            headers: { Authorization: `Bearer ${u.apiToken}` }
          });

          bot.sendMessage(id,
            `📨 رسالة\n📧 من: ${m.from.address}\n📩 إلى: ${u.email}\n\n${d.data.text || ""}`
          );

          u.lastMessages.push(m.id);
        }
      }

    } catch {}
  }
}, 10000);

console.log("🔥 Bot running...");
