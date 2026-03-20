const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const MAIN_ADMIN = 643309456;
let admins = [MAIN_ADMIN];

let users = {};
let waitingTransfer = {};
let waitingBroadcast = false;
let waitingAdminAdd = {};
let waitingChannel = {};
let channel = null;

// باسورد
function pass() {
  return Math.random().toString(36).slice(-10);
}

// تحقق اشتراك
async function checkJoin(id) {
  if (!channel) return true;
  try {
    const r = await bot.getChatMember(channel, id);
    return ["member","administrator","creator"].includes(r.status);
  } catch { return false; }
}

// منع
async function forceJoin(msg) {
  if (!channel) return true;

  if (!(await checkJoin(msg.chat.id))) {
    bot.sendMessage(msg.chat.id,
      `🚫 اشترك أولاً\n${channel}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 اشترك", url: `https://t.me/${channel.replace("@","")}` }],
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
  bot.sendMessage(id, "اختر:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📧 إنشاء", callback_data: "create" },
          { text: "📥 عرض", callback_data: "show" }
        ],
        [
          { text: "🗑️ حذف", callback_data: "delete" },
          { text: "📤 نقل", callback_data: "transfer" }
        ],
        [
          { text: "🔕 كتم", callback_data: "mute" },
          { text: "📂 إيميلاتي", callback_data: "my" }
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

// 👑 لوحة الأدمن
bot.onText(/\/admin/, (msg) => {
  if (!admins.includes(msg.chat.id)) return;

  bot.sendMessage(msg.chat.id, "👑 إدارة البوت", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📢 إعلان", callback_data: "admin_bc" }],
        [{ text: "➕ إضافة أدمن", callback_data: "admin_add" }],
        [{ text: "📌 تعيين قناة", callback_data: "admin_setch" }],
        [{ text: "❌ حذف القناة", callback_data: "admin_delch" }]
      ]
    }
  });
});

// أزرار
bot.on("callback_query", async (q) => {
  const id = q.message.chat.id;

  if (!(await forceJoin(q.message))) return;

  // تحقق
  if (q.data === "check") {
    if (await checkJoin(id)) {
      bot.sendMessage(id, "✅ تم");
      menu(id);
    } else bot.sendMessage(id, "❌ لم تشترك");
  }

  // إنشاء
  if (q.data === "create") {
    bot.sendMessage(id, "✍️ اكتب اسم الإيميل");
  }

  // عرض
  if (q.data === "show") {
    const u = users[id];
    if (!u) return bot.sendMessage(id, "❗ لا يوجد");

    bot.sendMessage(id, `📧 ${u.email}\n🔐 ${u.password}`);
  }

  // حذف
  if (q.data === "delete") {
    delete users[id];
    bot.sendMessage(id, "🗑️ تم الحذف");
  }

  // نقل
  if (q.data === "transfer") {
    waitingTransfer[id] = true;
    bot.sendMessage(id, "📨 ارسل ID");
  }

  // كتم عام
  if (q.data === "mute") {
    const u = users[id];
    if (!u) return;
    u.muted = !u.muted;
    bot.sendMessage(id, u.muted ? "🔕 تم الكتم" : "🔔 تم التفعيل");
  }

  // إيميلاتي
  if (q.data === "my") {
    const u = users[id];
    if (!u) return bot.sendMessage(id, "❗ لا يوجد");

    bot.sendMessage(id, `📂 إيميلك:\n${u.email}`);
  }

  // كتم ايميل من الرسالة
  if (q.data === "mute_email") {
    const u = users[id];
    if (!u) return;
    u.muted = true;
    bot.sendMessage(id, "🔕 تم كتم هذا الإيميل");
  }

  // 👑 إعلان
  if (q.data === "admin_bc" && admins.includes(id)) {
    waitingBroadcast = true;
    bot.sendMessage(id, "📢 اكتب الإعلان");
  }

  // 👑 إضافة أدمن
  if (q.data === "admin_add" && id == MAIN_ADMIN) {
    waitingAdminAdd[id] = true;
    bot.sendMessage(id, "➕ ارسل ID");
  }

  // 👑 قناة
  if (q.data === "admin_setch" && admins.includes(id)) {
    waitingChannel[id] = true;
    bot.sendMessage(id, "📌 ارسل @channel");
  }

  if (q.data === "admin_delch" && admins.includes(id)) {
    channel = null;
    bot.sendMessage(id, "❌ تم حذف القناة");
  }
});

// استقبال
bot.on("message", async (msg) => {
  const id = msg.chat.id;

  // إعلان
  if (waitingBroadcast && admins.includes(id)) {
    waitingBroadcast = false;
    for (let u in users) {
      bot.sendMessage(u, `📢 ${msg.text}`);
    }
    bot.sendMessage(id, "✅ تم");
  }

  // إضافة أدمن
  if (waitingAdminAdd[id]) {
    const newAdmin = parseInt(msg.text);
    admins.push(newAdmin);
    delete waitingAdminAdd[id];

    bot.sendMessage(id, "✅ تم");
    bot.sendMessage(newAdmin, "👑 تم ترقيتك إلى أدمن\nاكتب /admin");
  }

  // قناة
  if (waitingChannel[id]) {
    channel = msg.text;
    delete waitingChannel[id];
    bot.sendMessage(id, "✅ تم");
  }

  // نقل
  if (waitingTransfer[id]) {
    const target = msg.text;

    if (!users[id]) return;

    users[target] = users[id];
    delete users[id];
    delete waitingTransfer[id];

    bot.sendMessage(id, "✅ تم النقل");

    bot.sendMessage(target,
      `📥 تم نقل إيميل لك\n\n👤 من: ${msg.from.first_name}\n🔗 @${msg.from.username || "لا يوجد"}\n🆔 ${msg.from.id}`
    );
  }

  // إنشاء تلقائي
  if (!msg.text.startsWith("/") && !users[id]) {
    try {
      const domainRes = await axios.get("https://api.mail.tm/domains");
      const domain = domainRes.data["hydra:member"][0].domain;

      const name = msg.text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const email = `${name}@${domain}`;
      const password = pass();

      await axios.post("https://api.mail.tm/accounts", {
        address: email,
        password: password
      });

      const tokenRes = await axios.post("https://api.mail.tm/token", {
        address: email,
        password: password
      });

      users[id] = {
        email,
        password,
        apiToken: tokenRes.data.token,
        lastMessages: [],
        muted: false
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

// الرسائل
setInterval(async () => {
  for (let id in users) {
    const u = users[id];
    if (u.muted) continue;

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
            `📨 رسالة\n\n📧 من: ${m.from.address}\n📩 إلى: ${u.email}\n\n${d.data.text || ""}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔕 كتم رسائل هذا الإيميل", callback_data: "mute_email" }]
                ]
              }
            }
          );

          u.lastMessages.push(m.id);
        }
      }

    } catch {}
  }
}, 10000);

console.log("Bot is running...");
