// ================== الأساس ==================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

app.get('/', (req, res) => res.send("Bot alive"));
app.listen(process.env.PORT || 3000);

// ================== بيانات ==================
const MAIN_ADMIN = 643309456;
let admins = [MAIN_ADMIN];

let users = {};
let waiting = {};

let channel = null;
let channelLink = null;

// ================== أدوات ==================
function pass() {
  return Math.random().toString(36).slice(-10);
}

function isAdmin(id) {
  return admins.includes(id);
}

// ================== الاشتراك ==================
async function checkJoin(id) {
  if (!channel) return true;
  try {
    const res = await bot.getChatMember(channel, id);
    return ["member","administrator","creator"].includes(res.status);
  } catch {
    return true;
  }
}

async function forceJoin(msg) {
  if (!channel) return true;

  if (!(await checkJoin(msg.chat.id))) {
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

// ================== القائمة ==================
function menu(id) {
  bot.sendMessage(id, "✨ القائمة الرئيسية:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📧 إنشاء إيميل", callback_data: "create" },
          { text: "📂 إيميلاتي", callback_data: "my" }
        ],
        [
          { text: "📊 حسابي", callback_data: "info" },
          { text: "🔄 تحديث", callback_data: "refresh" }
        ],
        [
          { text: "📤 نقل", callback_data: "transfer" },
          { text: "🗑️ حذف", callback_data: "delete" }
        ]
      ]
    }
  });
}

// ================== START ==================
bot.onText(/\/start/, async (msg) => {
  if (!(await forceJoin(msg))) return;
  menu(msg.chat.id);
});

// ================== ADMIN ==================
bot.onText(/\/admin/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;

  bot.sendMessage(msg.chat.id, "👑 لوحة الإدارة:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📌 تعيين قناة", callback_data: "set_channel" }],
        [{ text: "❌ حذف القناة", callback_data: "del_channel" }],
        [{ text: "📢 إذاعة", callback_data: "broadcast" }],
        [{ text: "➕ إضافة أدمن", callback_data: "add_admin" }],
        [{ text: "➖ حذف أدمن", callback_data: "del_admin" }]
      ]
    }
  });
});

// ================== BUTTONS ==================
bot.on("callback_query", async (q) => {
  const id = q.message.chat.id;

  // تحقق اشتراك
  if (q.data === "check") {
    if (await checkJoin(id)) {
      bot.sendMessage(id, "✅ تم التحقق");
      menu(id);
    } else {
      bot.sendMessage(id, "❌ لم تشترك");
    }
  }

  // إنشاء
  if (q.data === "create") {
    waiting[id] = "create";
    bot.sendMessage(id, "✍️ اكتب اسم الإيميل:");
  }

  // عرض الإيميلات
  if (q.data === "my") {
    const u = users[id];
    if (!u || u.emails.length === 0)
      return bot.sendMessage(id, "❗ لا يوجد إيميلات");

    let text = "📂 إيميلاتك:\n\n";
    u.emails.forEach((e, i) => {
      text += `${i+1}- ${e.email}\n`;
    });

    bot.sendMessage(id, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 رجوع", callback_data: "back" }]
        ]
      }
    });
  }

  // معلومات
  if (q.data === "info") {
    const count = users[id]?.emails?.length || 0;
    bot.sendMessage(id, `👤 ID: ${id}\n📧 عدد الإيميلات: ${count}`);
  }

  if (q.data === "refresh") {
    bot.sendMessage(id, "🔄 تم التحديث");
    menu(id);
  }

  if (q.data === "delete") {
    waiting[id] = "delete";
    bot.sendMessage(id, "🗑️ ارسل رقم الإيميل:");
  }

  if (q.data === "transfer") {
    waiting[id] = "transfer";
    bot.sendMessage(id, "📤 ارسل رقم الإيميل:");
  }

  if (q.data === "back") {
    menu(id);
  }

  // ADMIN
  if (q.data === "broadcast") {
    waiting[id] = "broadcast";
    bot.sendMessage(id, "📢 ارسل الرسالة:");
  }

  if (q.data === "add_admin") {
    waiting[id] = "add_admin";
    bot.sendMessage(id, "➕ ارسل ID:");
  }

  if (q.data === "del_admin") {
    waiting[id] = "del_admin";
    bot.sendMessage(id, "➖ ارسل ID:");
  }

  if (q.data === "set_channel") {
    waiting[id] = "set_channel";
    bot.sendMessage(id, "📌 ارسل @channel:");
  }

  if (q.data === "del_channel") {
    channel = null;
    channelLink = null;
    bot.sendMessage(id, "✅ تم حذف القناة");
  }
});

// ================== الرسائل ==================
bot.on("message", async (msg) => {
  const id = msg.chat.id;
  const text = msg.text;

  if (!(await forceJoin(msg))) return;

  // تعيين قناة
  if (waiting[id] === "set_channel") {
    channel = text;
    channelLink = `https://t.me/${text.replace("@","")}`;
    waiting[id] = null;
    return bot.sendMessage(id, "✅ تم التفعيل");
  }

  // إنشاء
  if (waiting[id] === "create") {
    try {
      const domainRes = await axios.get("https://api.mail.tm/domains");
      const domain = domainRes.data["hydra:member"][0].domain;

      const name = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const email = `${name}@${domain}`;
      const password = pass();

      await axios.post("https://api.mail.tm/accounts", { address: email, password });
      const tokenRes = await axios.post("https://api.mail.tm/token", { address: email, password });

      if (!users[id]) users[id] = { emails: [] };

      users[id].emails.push({
        email,
        password,
        apiToken: tokenRes.data.token,
        last: []
      });

      bot.sendMessage(id, `📧 ${email}\n🔐 ${password}`);
      waiting[id] = null;

    } catch {
      bot.sendMessage(id, "❌ الاسم مستخدم");
    }
  }

  // حذف
  if (waiting[id] === "delete") {
    const num = parseInt(text) - 1;
    if (!users[id] || !users[id].emails[num])
      return bot.sendMessage(id, "❌ غير صحيح");

    users[id].emails.splice(num, 1);
    bot.sendMessage(id, "🗑️ تم الحذف");
    waiting[id] = null;
  }

  // نقل
  if (waiting[id] === "transfer") {
    waiting[id] = { step: 2, index: parseInt(text) - 1 };
    bot.sendMessage(id, "📨 ارسل ID المستخدم:");
    return;
  }

  if (waiting[id]?.step === 2) {
    const data = waiting[id];
    const email = users[id].emails[data.index];

    if (!users[text]) users[text] = { emails: [] };

    users[text].emails.push(email);
    users[id].emails.splice(data.index, 1);

    bot.sendMessage(id, "✅ تم النقل");
    bot.sendMessage(text, `📥 وصلك إيميل:\n${email.email}`);

    waiting[id] = null;
  }

  // Broadcast
  if (waiting[id] === "broadcast" && isAdmin(id)) {
    for (let u in users) {
      bot.sendMessage(u, text);
    }
    bot.sendMessage(id, "✅ تم الإرسال");
    waiting[id] = null;
  }

  // Admin add/remove
  if (waiting[id] === "add_admin") {
    admins.push(Number(text));
    bot.sendMessage(id, "✅ تم");
    waiting[id] = null;
  }

  if (waiting[id] === "del_admin") {
    admins = admins.filter(a => a != text);
    bot.sendMessage(id, "✅ تم");
    waiting[id] = null;
  }
});

// ================== جلب الرسائل ==================
setInterval(async () => {
  for (let id in users) {
    for (let e of users[id].emails) {
      try {
        const res = await axios.get("https://api.mail.tm/messages", {
          headers: { Authorization: `Bearer ${e.apiToken}` }
        });

        for (let m of res.data["hydra:member"]) {
          if (!e.last.includes(m.id)) {
            bot.sendMessage(id, `📨 من: ${m.from.address}\n📩 ${m.subject}`);
            e.last.push(m.id);
          }
        }

      } catch {}
    }
  }
}, 10000);
