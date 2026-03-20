const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const MAIN_ADMIN = 643309456;
let admins = [MAIN_ADMIN];

let users = {};
let waitingCustomEmail = {};
let waitingTransfer = {};
let waitingBroadcast = false;
let waitingAdminAdd = {};
let waitingChannel = {};
let channel = null;

// باسورد
function generatePassword() {
  return Math.random().toString(36).slice(-10);
}

// تحقق اشتراك
async function checkJoin(userId) {
  if (!channel) return true;
  try {
    const res = await bot.getChatMember(channel, userId);
    return ["member","administrator","creator"].includes(res.status);
  } catch {
    return false;
  }
}

// منع بدون اشتراك
async function forceJoin(msg) {
  if (!channel) return true;

  const joined = await checkJoin(msg.chat.id);

  if (!joined) {
    bot.sendMessage(msg.chat.id,
      `🚫 يجب الاشتراك أولاً\n\n${channel}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 اشترك", url: `https://t.me/${channel.replace("@","")}` }],
            [{ text: "✅ تحقق", callback_data: "check_join" }]
          ]
        }
      }
    );
    return false;
  }
  return true;
}

// القائمة
function menu(chatId) {
  bot.sendMessage(chatId, "اختر:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📧 إنشاء إيميل", callback_data: "create" }],
        [{ text: "📥 عرض", callback_data: "show" }],
        [{ text: "🗑️ حذف", callback_data: "delete" }],
        [{ text: "📤 نقل", callback_data: "transfer" }],
        [{ text: "🔕 كتم", callback_data: "mute" }]
      ]
    }
  });
}

// start
bot.onText(/\/start/, async (msg) => {
  if (!(await forceJoin(msg))) return;
  menu(msg.chat.id);
});

// 👑 لوحة الأدمن
bot.onText(/\/admin/, (msg) => {
  if (msg.chat.id != MAIN_ADMIN) return;

  bot.sendMessage(msg.chat.id, "👑 لوحة الأدمن", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📢 إرسال إعلان", callback_data: "admin_broadcast" }],
        [{ text: "➕ إضافة أدمن", callback_data: "admin_add" }],
        [{ text: "📌 تعيين قناة", callback_data: "admin_channel" }]
      ]
    }
  });
});

// الأزرار
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;

  if (!(await forceJoin(q.message))) return;

  // تحقق
  if (q.data === "check_join") {
    if (await checkJoin(q.from.id)) {
      bot.sendMessage(chatId, "✅ تم التحقق");
      menu(chatId);
    } else {
      bot.sendMessage(chatId, "❌ لم تشترك");
    }
  }

  // إنشاء
  if (q.data === "create") {
    waitingCustomEmail[chatId] = true;
    bot.sendMessage(chatId, "✍️ اكتب اسم الإيميل");
  }

  // عرض
  if (q.data === "show") {
    const user = users[chatId];
    if (!user) return bot.sendMessage(chatId, "❗ لا يوجد");

    bot.sendMessage(chatId,
      `📧 ${user.email}\n🔐 ${user.password}`
    );
  }

  // حذف
  if (q.data === "delete") {
    delete users[chatId];
    bot.sendMessage(chatId, "🗑️ تم الحذف");
  }

  // نقل
  if (q.data === "transfer") {
    waitingTransfer[chatId] = true;
    bot.sendMessage(chatId, "📨 ارسل ID");
  }

  // كتم
  if (q.data === "mute") {
    const user = users[chatId];
    if (!user) return;

    user.muted = !user.muted;

    bot.sendMessage(chatId,
      user.muted ? "🔕 تم الكتم" : "🔔 تم التفعيل"
    );
  }

  // 👑 إعلان
  if (q.data === "admin_broadcast" && chatId == MAIN_ADMIN) {
    waitingBroadcast = true;
    bot.sendMessage(chatId, "📢 ارسل الإعلان");
  }

  // 👑 إضافة أدمن
  if (q.data === "admin_add" && chatId == MAIN_ADMIN) {
    waitingAdminAdd[chatId] = true;
    bot.sendMessage(chatId, "➕ ارسل ID");
  }

  // 👑 قناة
  if (q.data === "admin_channel" && chatId == MAIN_ADMIN) {
    waitingChannel[chatId] = true;
    bot.sendMessage(chatId, "📌 ارسل @channel");
  }
});

// استقبال
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // إعلان
  if (waitingBroadcast && chatId == MAIN_ADMIN) {
    waitingBroadcast = false;

    for (let id in users) {
      bot.sendMessage(id, `📢 ${msg.text}`);
    }

    bot.sendMessage(chatId, "✅ تم الإرسال");
  }

  // إضافة أدمن
  if (waitingAdminAdd[chatId]) {
    admins.push(parseInt(msg.text));
    delete waitingAdminAdd[chatId];

    bot.sendMessage(chatId, "✅ تم إضافة أدمن");
  }

  // قناة
  if (waitingChannel[chatId]) {
    channel = msg.text;
    delete waitingChannel[chatId];

    bot.sendMessage(chatId, "✅ تم تعيين القناة");
  }

  // نقل
  if (waitingTransfer[chatId]) {
    const target = msg.text;

    if (!users[chatId]) return;

    users[target] = users[chatId];
    delete users[chatId];
    delete waitingTransfer[chatId];

    bot.sendMessage(chatId, "✅ تم النقل");
    bot.sendMessage(target, "📥 تم استلام الإيميل");
  }

  // إنشاء
  if (waitingCustomEmail[chatId]) {
    delete waitingCustomEmail[chatId];

    try {
      const domainRes = await axios.get("https://api.mail.tm/domains");
      const domain = domainRes.data["hydra:member"][0].domain;

      const name = msg.text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const email = `${name}@${domain}`;
      const password = generatePassword();

      await axios.post("https://api.mail.tm/accounts", {
        address: email,
        password: password
      });

      const tokenRes = await axios.post("https://api.mail.tm/token", {
        address: email,
        password: password
      });

      users[chatId] = {
        email,
        password,
        apiToken: tokenRes.data.token,
        lastMessages: [],
        muted: false
      };

      bot.sendMessage(chatId,
        `📧 الإيميل:\n\`${email}\`\n\n🔐 الباسورد:\n\`${password}\``,
        { parse_mode: "Markdown" }
      );

    } catch {
      bot.sendMessage(chatId, "❌ الاسم مستخدم");
    }
  }
});

// الرسائل
setInterval(async () => {
  for (let chatId in users) {
    const user = users[chatId];
    if (user.muted) continue;

    try {
      const res = await axios.get("https://api.mail.tm/messages", {
        headers: { Authorization: `Bearer ${user.apiToken}` }
      });

      for (let m of res.data["hydra:member"]) {
        if (!user.lastMessages.includes(m.id)) {

          const detail = await axios.get(`https://api.mail.tm/messages/${m.id}`, {
            headers: { Authorization: `Bearer ${user.apiToken}` }
          });

          const content = detail.data.text || "";

          bot.sendMessage(chatId,
            `📨 رسالة\n\n📧 من: ${m.from.address}\n📩 إلى: ${user.email}\n\n${content}`
          );

          user.lastMessages.push(m.id);
        }
      }

    } catch {}
  }
}, 10000);

console.log("Bot is running...");
