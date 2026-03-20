// ================== الأساس ==================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

app.get('/', (req, res) => res.send("Bot alive"));
app.listen(process.env.PORT || 3000);

// ================== قاعدة البيانات ==================
const DB_FILE = "data.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users:{}, admins:[], settings:{} };
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

// ================== بيانات ==================
const MAIN_ADMIN = 643309456;

if (!db.admins.includes(MAIN_ADMIN)) db.admins.push(MAIN_ADMIN);

let users = db.users;
let admins = db.admins;

let settings = db.settings || {
  forceSub: false,
  channel: null,
  channelLink: null,
  welcome: null,
  footer: null
};

let waiting = {};

// ================== أدوات ==================
function pass() {
  return Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-6);
}

function randName() {
  return Math.random().toString(36).slice(2,10);
}

function isAdmin(id) {
  return admins.includes(id);
}

function validName(name){
  return /^[a-z0-9]+$/.test(name);
}

// ================== الاشتراك ==================
async function checkJoin(id) {
  if (!settings.forceSub || !settings.channel) return true;
  try {
    const res = await bot.getChatMember(settings.channel, id);
    return ["member","administrator","creator"].includes(res.status);
  } catch {
    return false;
  }
}

async function forceJoin(msg) {
  if (!settings.forceSub || !settings.channel) return true;

  if (!(await checkJoin(msg.chat.id))) {
    bot.sendMessage(msg.chat.id, "🚫 يرجى الاشتراك حتى يتم تفعيل البوت", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 اشتراك", url: settings.channelLink }],
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
  bot.sendMessage(id, "✨ القائمة:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📧 إنشاء", callback_data: "create" }],
        [{ text: "📂 إيميلاتي", callback_data: "my" }],
        [{ text: "🆘 مراسلة الدعم", callback_data: "support" }]
      ]
    }
  });
}

// ================== START ==================
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id;

  if (!(await forceJoin(msg))) return;

  if (settings.welcome)
    bot.sendMessage(id, settings.welcome);

  menu(id);
});

// ================== ADMIN ==================
bot.onText(/\/admin/, (msg) => {
  const id = msg.chat.id;
  if (!isAdmin(id)) return;

  bot.sendMessage(id, "👑 الإدارة:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📌 تعيين قناة", callback_data: "set_channel" }],
        [
          { text: "✅ تفعيل الاشتراك", callback_data: "enable_sub" },
          { text: "❌ تعطيل الاشتراك", callback_data: "disable_sub" }
        ],
        [{ text: "👥 قائمة الأدمن", callback_data: "admins" }],
        [{ text: "📝 رسالة البداية", callback_data: "set_welcome" }],
        [{ text: "📎 نص الإيميل", callback_data: "set_footer" }],
        [{ text: "📢 إذاعة", callback_data: "broadcast" }]
      ]
    }
  });
});

// ================== BUTTONS ==================
bot.on("callback_query", async (q) => {
  const id = q.message.chat.id;
  const data = q.data;

  if (data === "check") {
    if (await checkJoin(id)) {
      bot.sendMessage(id, "✅ تم");
      menu(id);
    }
  }

  if (data === "create") {
    createEmail(id);
  }

  if (data === "support") {
    waiting[id] = "support";
    bot.sendMessage(id,"✍️ اكتب رسالتك:");
  }

  if (data === "my") {
    const u = users[id];
    if (!u || u.emails.length === 0)
      return bot.sendMessage(id, "❗ لا يوجد");

    u.emails.forEach((e, i) => {
      bot.sendMessage(id,
`📧 \`${e.email}\`
🔐 \`${e.password}\``,
{
  parse_mode:"Markdown",
  reply_markup:{
    inline_keyboard:[
      [
        { text:"🗑️ حذف", callback_data:`del_${i}` },
        { text:"📤 نقل", callback_data:`tran_${i}` },
        { text:"🔇 كتم", callback_data:`mute_${i}` }
      ]
    ]
  }
});
    });
  }

  if (data.startsWith("mute_")) {
    const i = data.split("_")[1];
    users[id].emails[i].mute = !users[id].emails[i].mute;
    saveDB();
    bot.sendMessage(id,"🔇 تم التغيير");
  }

  if (data.startsWith("del_")) {
    const i = data.split("_")[1];
    users[id].emails.splice(i,1);
    saveDB();
    bot.sendMessage(id,"🗑️ تم");
  }

  if (data.startsWith("tran_")) {
    waiting[id] = { type:"transfer", index:data.split("_")[1] };
    bot.sendMessage(id,"📨 ارسل ID");
  }

  // ADMIN
  if (data === "enable_sub") {
    waiting[id] = "set_channel_force";
    bot.sendMessage(id,"📌 ارسل رابط القناة");
  }

  if (data === "disable_sub") {
    settings.forceSub = false;
    saveDB();
    bot.sendMessage(id,"✅ تم تعطيل الاشتراك");
  }

  if (data === "admins") {
    if (id !== MAIN_ADMIN) return;

    admins.forEach(a=>{
      bot.sendMessage(id,`👤 ${a}`,{
        reply_markup:{
          inline_keyboard:[
            [
              { text:"✉️ مراسلة", callback_data:`msg_${a}` },
              { text:"❌ حذف", callback_data:`rem_${a}` }
            ]
          ]
        }
      });
    });
  }

  if (data.startsWith("msg_")) {
    const target = data.split("_")[1];
    waiting[id] = { type:"admin_msg", to:target };
    bot.sendMessage(id,"✍️ اكتب الرسالة");
  }

  if (data.startsWith("rem_")) {
    const target = Number(data.split("_")[1]);
    if (target === MAIN_ADMIN) return bot.sendMessage(id,"❌ ممنوع");
    admins = admins.filter(a=>a!==target);
    db.admins = admins;
    saveDB();
    bot.sendMessage(id,"✅ تم");
  }
});

// ================== إنشاء ==================
async function createEmail(id, custom=null){
  try {
    const domainRes = await axios.get("https://api.mail.tm/domains");
    const domain = domainRes.data["hydra:member"][0].domain;

    let name = custom || randName();

    if (!validName(name)) return;

    const email = `${name}@${domain}`;
    const password = pass();

    await axios.post("https://api.mail.tm/accounts",{ address:email,password });
    const tokenRes = await axios.post("https://api.mail.tm/token",{ address:email,password });

    if (!users[id]) users[id]={ emails:[] };

    users[id].emails.push({
      email,password,
      apiToken:tokenRes.data.token,
      last:[],
      mute:false
    });

    saveDB();

    bot.sendMessage(id,
`📧 \`${email}\`
🔐 \`${password}\`

${settings.footer || ""}`,{ parse_mode:"Markdown" });

  } catch (err){
    if (err.response?.status === 422)
      bot.sendMessage(id,"⚠️ هذا الاسم مستخدم جرب اسماً آخر");
    else
      bot.sendMessage(id,"❌ خطأ");
  }
}

// ================== الرسائل ==================
bot.on("message", async (msg)=>{
  const id = msg.chat.id;
  const text = msg.text;

  if (!(await forceJoin(msg))) return;
  if (!text) return;

  // منع أوامر
  if (text.startsWith("/")) return;

  // دعم
  if (waiting[id]==="support"){
    admins.forEach(a=>{
      bot.sendMessage(a,`📩 دعم من ${id}\n${text}`);
    });
    waiting[id]=null;
    return bot.sendMessage(id,"✅ تم الإرسال");
  }

  // مراسلة أدمن
  if (waiting[id]?.type==="admin_msg"){
    bot.sendMessage(waiting[id].to,`📩 رسالة من الأدمن:\n${text}`);
    waiting[id]=null;
    return;
  }

  // تحويل
  if (waiting[id]?.type === "transfer") {
    const data = waiting[id];
    const email = users[id].emails[data.index];

    if (!users[text]) users[text]={ emails:[] };

    users[text].emails.push(email);
    users[id].emails.splice(data.index,1);

    const u = msg.from;

    bot.sendMessage(text,
`📥 تم نقل إيميل لك

📧 \`${email.email}\`
🔐 \`${email.password}\`

👤 من:
${u.first_name}
@${u.username || "لا يوجد"}
ID: ${u.id}`,{ parse_mode:"Markdown" });

    saveDB();
    waiting[id]=null;
    return;
  }

  // إنشاء تلقائي
  createEmail(id, text.toLowerCase());
});

// ================== جلب الرسائل ==================
setInterval(async ()=>{
  for (let id in users){
    for (let e of users[id].emails){
      if (e.mute) continue;

      try{
        const res = await axios.get("https://api.mail.tm/messages",{
          headers:{ Authorization:`Bearer ${e.apiToken}` }
        });

        for (let m of res.data["hydra:member"]){
          if (!e.last.includes(m.id)){

            const full = await axios.get(`https://api.mail.tm/messages/${m.id}`,{
              headers:{ Authorization:`Bearer ${e.apiToken}` }
            });

            const content = full.data.text || full.data.html || "لا يوجد";

            bot.sendMessage(id,
`📨 رسالة جديدة

📧 ${e.email}
👤 ${m.from.address}
📌 ${m.subject}

📩 ${content}

${settings.footer || ""}`);

            e.last.push(m.id);
            saveDB();
          }
        }

      }catch{}
    }
  }
},10000);
