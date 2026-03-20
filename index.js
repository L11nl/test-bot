// ================== الأساس ==================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

app.get('/', (req, res) => res.send("Bot alive"));
app.listen(process.env.PORT || 3000);

// ================== حفظ البيانات ==================
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

// ================== الاشتراك ==================
async function checkJoin(id) {
  if (!settings.forceSub || !settings.channel) return true;
  try {
    const res = await bot.getChatMember(settings.channel, id);
    return ["member","administrator","creator"].includes(res.status);
  } catch {
    return true;
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
        [{ text: "📂 إيميلاتي", callback_data: "my" }]
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
        [{ text: "🔁 تشغيل/إيقاف الاشتراك", callback_data: "toggle_sub" }],
        [{ text: "📝 رسالة البداية", callback_data: "set_welcome" }],
        [{ text: "📎 نص الإيميل", callback_data: "set_footer" }],
        [{ text: "📢 إذاعة", callback_data: "broadcast" }],
        [{ text: "➕ أدمن", callback_data: "add_admin" }],
        [{ text: "➖ حذف أدمن", callback_data: "del_admin" }]
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
        { text:"📤 نقل", callback_data:`tran_${i}` }
      ]
    ]
  }
});
    });
  }

  if (data.startsWith("del_")) {
    const i = data.split("_")[1];
    users[id].emails.splice(i,1);
    saveDB();
    bot.sendMessage(id,"🗑️ تم الحذف");
  }

  if (data.startsWith("tran_")) {
    waiting[id] = { type:"transfer", index:data.split("_")[1] };
    bot.sendMessage(id,"📨 ارسل ID");
  }

  // ADMIN
  if (data === "set_channel") {
    waiting[id] = "channel";
    bot.sendMessage(id,"📌 ارسل @channel");
  }

  if (data === "toggle_sub") {
    settings.forceSub = !settings.forceSub;
    saveDB();
    bot.sendMessage(id,"✅ تم التغيير");
  }

  if (data === "set_welcome") {
    waiting[id] = "welcome";
    bot.sendMessage(id,"✍️ ارسل النص");
  }

  if (data === "set_footer") {
    waiting[id] = "footer";
    bot.sendMessage(id,"✍️ ارسل النص");
  }

  if (data === "broadcast") {
    waiting[id] = "broadcast";
    bot.sendMessage(id,"📢 ارسل الرسالة");
  }

  if (data === "add_admin") {
    waiting[id] = "add_admin";
    bot.sendMessage(id,"➕ ارسل ID");
  }

  if (data === "del_admin") {
    waiting[id] = "del_admin";
    bot.sendMessage(id,"➖ ارسل ID");
  }
});

// ================== إنشاء ==================
async function createEmail(id, custom=null){
  try {
    const domainRes = await axios.get("https://api.mail.tm/domains");
    const domain = domainRes.data["hydra:member"][0].domain;

    let name = custom || randName();

    const email = `${name}@${domain}`;
    const password = pass();

    await axios.post("https://api.mail.tm/accounts",{ address:email,password });
    const tokenRes = await axios.post("https://api.mail.tm/token",{ address:email,password });

    if (!users[id]) users[id]={ emails:[] };

    users[id].emails.push({
      email,password,
      apiToken:tokenRes.data.token,
      last:[]
    });

    saveDB();

    bot.sendMessage(id,
`📧 \`${email}\`
🔐 \`${password}\`

${settings.footer || ""}`,{ parse_mode:"Markdown" });

  } catch {
    bot.sendMessage(id,"❌ فشل");
  }
}

// ================== الرسائل ==================
bot.on("message", async (msg)=>{
  const id = msg.chat.id;
  const text = msg.text;

  if (!(await forceJoin(msg))) return;
  if (!text) return;

  // CREATE مباشر
  if (text === "/Create") return createEmail(id);

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

  // إعدادات
  if (waiting[id]==="channel"){
    settings.channel=text;
    settings.channelLink=`https://t.me/${text.replace("@","")}`;
    waiting[id]=null;
    saveDB();
    return bot.sendMessage(id,"✅ تم");
  }

  if (waiting[id]==="welcome"){
    settings.welcome=text;
    waiting[id]=null;
    saveDB();
    return bot.sendMessage(id,"✅ تم");
  }

  if (waiting[id]==="footer"){
    settings.footer=text;
    waiting[id]=null;
    saveDB();
    return bot.sendMessage(id,"✅ تم");
  }

  if (waiting[id]==="broadcast" && isAdmin(id)){
    for (let u in users) bot.sendMessage(u,text);
    waiting[id]=null;
    return;
  }

  if (waiting[id]==="add_admin"){
    admins.push(Number(text));
    saveDB();
    waiting[id]=null;
    return;
  }

  if (waiting[id]==="del_admin"){
    if (Number(text)===MAIN_ADMIN) return bot.sendMessage(id,"❌ لا يمكن");
    admins=admins.filter(a=>a!=text);
    db.admins=admins;
    saveDB();
    waiting[id]=null;
    return;
  }

  // أي نص = إنشاء إيميل
  createEmail(id, text);
});

// ================== جلب الرسائل ==================
setInterval(async ()=>{
  for (let id in users){
    for (let e of users[id].emails){
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
