/*
================= IMPORTANT SYSTEM NOTICE ==================
⚠️ لا تحذف البيانات (users / admins / settings / data.json)
✔️ فقط قم بتحديث الكود
===========================================================
*/

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
if (!db.users) db.users = {};
if (!db.admins) db.admins = [];
if (!db.settings) db.settings = {};

const MAIN_ADMIN = 643309456;
if (!db.admins.includes(MAIN_ADMIN)) db.admins.push(MAIN_ADMIN);

let users = db.users;
let admins = db.admins;
let settings = db.settings;

let waiting = {};

// ================== أدوات ==================
function pass() {
  return Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-6);
}

function randName() {
  return Math.random().toString(36).slice(2,10);
}

function validName(name){
  return /^[a-z0-9]+$/.test(name);
}

function isAdmin(id){
  return admins.includes(id);
}

// ================== الاشتراك ==================
async function checkJoin(id) {
  try {
    if (!settings.forceSub || !settings.channel) return true;
    const res = await bot.getChatMember(settings.channel, id);
    return ["member","administrator","creator"].includes(res.status);
  } catch {
    return false;
  }
}

async function forceJoin(msg) {
  const id = msg.chat.id;

  if (!settings.forceSub || !settings.channel) return true;

  const joined = await checkJoin(id);

  if (!joined) {

    if (waiting[id] === "join_msg") return false;

    waiting[id] = "join_msg";

    bot.sendMessage(id,
settings.joinText || 
`⚠️ يجب الاشتراك في القناة أولاً

1- اضغط على زر الاشتراك
2- ثم اضغط تحقق`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "📢 الاشتراك", url: settings.channelLink }],
      [{ text: "✅ تحقق", callback_data: "check" }]
    ]
  }
});

    return false;
  }

  delete waiting[id];
  return true;
}

// ================== القائمة ==================
function menu(id) {
  bot.sendMessage(id,
`📋 القائمة الرئيسية`,
{
    reply_markup: {
      inline_keyboard: [
        [{ text: "📧 إنشاء بريد", callback_data: "create" }],
        [{ text: "📂 إيميلاتي", callback_data: "my" }],
        [{ text: "📩 مراسلة الدعم", callback_data: "support" }]
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
  const id = msg.chat.id;
  if (!isAdmin(id)) return;

  bot.sendMessage(id,
`👑 لوحة الإدارة`,
{
    reply_markup: {
      inline_keyboard: [
        [{ text: "📌 تعيين قناة", callback_data: "set_channel" }],
        [
          { text: "✅ تفعيل الاشتراك", callback_data: "enable_sub" },
          { text: "❌ تعطيل الاشتراك", callback_data: "disable_sub" }
        ],
        [{ text: "✏️ تعديل رسالة الاشتراك", callback_data: "set_join_text" }]
      ]
    }
  });
});

// ================== BUTTONS ==================
bot.on("callback_query", async (q) => {
  const id = q.message.chat.id;
  const data = q.data;

  if (data === "check") {
    const joined = await checkJoin(id);

    if (joined) {
      delete waiting[id];
      bot.sendMessage(id, "✅ تم التحقق بنجاح");
      menu(id);
    } else {
      bot.sendMessage(id, "❌ لم يتم التحقق، تأكد من الاشتراك");
    }
  }

  if (data === "create") createEmail(id);

  if (data === "my") {
    if (!users[id]) users[id] = { emails: [] };

    const list = users[id].emails || [];

    if (list.length === 0)
      return bot.sendMessage(id, "📭 لا يوجد لديك إيميلات");

    list.forEach((e,i)=>{
      bot.sendMessage(id,
`📧 البريد:
${e.email}

🔐 كلمة المرور:
${e.password}`,
{
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

  if (data.startsWith("del_")) {
    const i = data.split("_")[1];
    users[id].emails.splice(i,1);
    saveDB();
    bot.sendMessage(id,"🗑️ تم الحذف");
  }

  if (data.startsWith("tran_")) {
    waiting[id] = { type:"transfer", index:data.split("_")[1] };
    bot.sendMessage(id,"📨 ارسل ID المستخدم");
  }

  if (data.startsWith("mute_")) {
    const i = data.split("_")[1];
    users[id].emails[i].mute = !users[id].emails[i].mute;
    saveDB();
    bot.sendMessage(id,"🔇 تم تغيير الحالة");
  }

  if (data === "set_channel") {
    waiting[id] = "set_channel";
    bot.sendMessage(id,"📌 ارسل رابط القناة أو @channel");
  }

  if (data === "enable_sub") {
    settings.forceSub = true;
    saveDB();
    bot.sendMessage(id,"✅ تم تفعيل الاشتراك الإجباري");
  }

  if (data === "disable_sub") {
    settings.forceSub = false;
    saveDB();
    bot.sendMessage(id,"❌ تم تعطيل الاشتراك الإجباري");
  }

  if (data === "set_join_text") {
    waiting[id] = "join_text";
    bot.sendMessage(id,"✍️ ارسل النص الجديد");
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
`📧 البريد:
${email}

🔐 كلمة المرور:
${password}`);

  } catch (err){
    if (err.response?.status === 422)
      bot.sendMessage(id,"⚠️ هذا الاسم مستخدم، جرب اسم آخر");
    else
      bot.sendMessage(id,"❌ حدث خطأ");
  }
}

// ================== الرسائل ==================
bot.on("message", async (msg)=>{
  const id = msg.chat.id;
  const text = msg.text;

  if (!(await forceJoin(msg))) return;
  if (!text) return;

  if (text.startsWith("/")) return;

  if (waiting[id]==="set_channel"){
    settings.channel = text;

    if (text.includes("t.me")) {
      settings.channelLink = text;
    } else {
      settings.channelLink = `https://t.me/${text.replace("@","")}`;
    }

    waiting[id]=null;
    saveDB();
    return bot.sendMessage(id,"✅ تم حفظ القناة");
  }

  if (waiting[id]==="join_text"){
    settings.joinText = text;
    waiting[id]=null;
    saveDB();
    return bot.sendMessage(id,"✅ تم حفظ الرسالة");
  }

  if (waiting[id]?.type === "transfer") {
    const data = waiting[id];
    const email = users[id].emails[data.index];

    if (!users[text]) users[text]={ emails:[] };

    users[text].emails.push(email);
    users[id].emails.splice(data.index,1);

    bot.sendMessage(text,
`📥 تم نقل إيميل لك

📧 ${email.email}
🔐 ${email.password}`);

    saveDB();
    waiting[id]=null;
    return;
  }

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

            const content = full.data.text || full.data.html || "لا يوجد محتوى";

            bot.sendMessage(id,
`📨 رسالة جديدة

📧 البريد: ${e.email}
👤 المرسل: ${m.from.address}
📌 العنوان: ${m.subject}

📩 الرسالة:
${content}`);

            e.last.push(m.id);
            saveDB();
          }
        }

      }catch{}
    }
  }
},10000);
