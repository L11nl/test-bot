const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const ADMIN_ID = 643309456;

let users = {};
let waitingTransfer = {};
let waitingBroadcast = false;
let waitingCustomEmail = {};
let channel = null; // القناة تتحدد من البوت

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

// قائمة
function menu(chatId) {
  bot.sendMessage(chatId, "اختر:", {
    reply_markup: {
      keyboard: [
        ["📧 إنشاء إيميل", "🗑️ حذف"],
        ["📤 نقل", "🔕 كتم"],
        ["📥 عرض"]
      ],
      resize_keyboard: true
    }
  });
}

// start
bot.onText(/\/start/, async (msg) => {
  if (!(await forceJoin(msg))) return;
  menu(msg.chat.id);
});

// تعيين قناة (ادمن)
bot.onText(/\/setchannel/, (msg) => {
  if (msg.chat.id != ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, "📌 ارسل يوزر القناة مثل:\n@channel");
});

// استقبال
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // تعيين القناة
  if (msg.chat.id == ADMIN_ID && msg.text.startsWith("@")) {
    channel = msg.text;
    bot.sendMessage(chatId, "✅ تم تعيين القناة");
    return;
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

  // إعلان
  if (waitingBroadcast && chatId == ADMIN_ID) {
    waitingBroadcast = false;

    for (let id in users) {
      bot.sendMessage(id, `📢 إعلان:\n\n${msg.text}`);
    }

    bot.sendMessage(chatId, "✅ تم الإرسال");
  }

  // إنشاء مخصص
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
        `📧 ${email}\n🔐 ${password}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 نسخ الإيميل", callback_data: "copy" }]
            ]
          }
        }
      );

    } catch {
      bot.sendMessage(chatId, "❌ الاسم مستخدم");
    }
  }
});

// تحقق زر
bot.on("callback_query", async (q) => {

  if (q.data === "check_join") {
    if (await checkJoin(q.from.id)) {
      bot.sendMessage(q.message.chat.id, "✅ تم التحقق");
      menu(q.message.chat.id);
    } else {
      bot.sendMessage(q.message.chat.id, "❌ لم تشترك");
    }
  }

  if (q.data === "copy") {
    const user = users[q.from.id];
    if (!user) return;

    bot.sendMessage(q.message.chat.id, `📋 ${user.email}`);
  }
});

// إنشاء
bot.onText(/📧 إنشاء إيميل/, async (msg) => {
  if (!(await forceJoin(msg))) return;

  waitingCustomEmail[msg.chat.id] = true;

  bot.sendMessage(msg.chat.id,
    "✍️ اكتب اسم الإيميل\nمثال:\nAli"
  );
});

// حذف
bot.onText(/🗑️ حذف/, async (msg) => {
  if (!(await forceJoin(msg))) return;

  delete users[msg.chat.id];
  bot.sendMessage(msg.chat.id, "🗑️ تم الحذف");
});

// عرض
bot.onText(/📥 عرض/, async (msg) => {
  if (!(await forceJoin(msg))) return;

  const user = users[msg.chat.id];
  if (!user) return bot.sendMessage(msg.chat.id, "❗ لا يوجد");

  bot.sendMessage(msg.chat.id,
    `📧 ${user.email}\n🔐 ${user.password}`
  );
});

// نقل
bot.onText(/📤 نقل/, async (msg) => {
  if (!(await forceJoin(msg))) return;

  waitingTransfer[msg.chat.id] = true;
  bot.sendMessage(msg.chat.id, "📨 ارسل ID");
});

// كتم
bot.onText(/🔕 كتم/, async (msg) => {
  if (!(await forceJoin(msg))) return;

  const user = users[msg.chat.id];
  if (!user) return;

  user.muted = !user.muted;

  bot.sendMessage(msg.chat.id,
    user.muted ? "🔕 تم الكتم" : "🔔 تم التفعيل"
  );
});

// إعلان
bot.onText(/\/broadcast/, (msg) => {
  if (msg.chat.id != ADMIN_ID) return;

  waitingBroadcast = true;
  bot.sendMessage(msg.chat.id, "📢 ارسل الإعلان");
});

// رسائل
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
