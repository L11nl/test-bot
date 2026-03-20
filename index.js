/*
================= IMPORTANT SYSTEM NOTICE ==================

⚠️ هذا المشروع يحتوي على بيانات مستخدمين مهمة جداً (إيميلات - كلمات مرور - أدمن).

🚫 ممنوع حذف أو إعادة تعيين أي من هذه البيانات:
- users (بيانات المستخدمين)
- admins (قائمة الأدمن)
- settings (الإعدادات)
- data.json (ملف التخزين)

🔒 عند التعديل أو التحديث:
✔️ قم بتحديث الكود فقط
✔️ حافظ على نفس هيكل قاعدة البيانات
✔️ لا تقم بإعادة تهيئة المتغيرات
✔️ لا تحذف الملف data.json
✔️ لا تغير أسماء المفاتيح داخل البيانات

❗ أي تعديل يؤدي إلى حذف البيانات يعتبر خطأ جسيم

🎯 الهدف:
تحديث البوت بدون فقدان أي بيانات مستخدمين أو إيميلات أو صلاحيات

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

// حماية إضافية
if (!db.users) db.users = {};
if (!db.admins) db.admins = [];
if (!db.settings) db.settings = {};

// ================== بيانات ==================
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
    bot.sendMessage(msg.chat.id,
`⚠️ يجب الاشتراك في القناة أولاً

اضغط على زر الاشتراك ثم تحقق`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "📢 الاشتراك في القناة", url: settings.channelLink }],
      [{ text: "🔍 تحقق", callback_data: "check" }]
    ]
  }
});
    return false;
  }
  return true;
}

// ================== القائمة ==================
function menu(id) {
  bot.sendMessage(id,
`📋 القائمة الرئيسية

اختر أحد الخيارات التالية:`,
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

  bot.sendMessage(id,
`👑 لوحة تحكم الإدارة`,
{
    reply_markup: {
      inline_keyboard: [
        [{ text: "📌 تعيين قناة", callback_data: "set_channel" }],
        [
          { text: "✅ تفعيل الاشتراك", callback_data: "enable_sub" },
          { text: "❌ تعطيل الاشتراك", callback_data: "disable_sub" }
        ],
        [{ text: "👥 إدارة الأدمن", callback_data: "admins" }],
        [{ text: "📢 إرسال إذاعة", callback_data: "broadcast" }]
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
      bot.sendMessage(id, "✅ تم التحقق من الاشتراك");
      menu(id);
    }
  }

  if (data === "create") {
    createEmail(id);
  }

  if (data === "support") {
    waiting[id] = "support";
    bot.sendMessage(id,"✍️ اكتب رسالتك وسيتم الرد عليك:");
  }

  if (data === "set_channel") {
    waiting[id] = "set_channel";
    bot.sendMessage(id,"📌 أرسل رابط القناة أو المعرف (@channel)");
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

  if (data === "admins") {
    if (id !== MAIN_ADMIN) return;

    admins.forEach(a=>{
      bot.sendMessage(id,`👤 ID: ${a}`,{
        reply_markup:{
          inline_keyboard:[
            [
              { text:"💬 مراسلة", callback_data:`msg_${a}` },
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
    bot.sendMessage(id,"✍️ اكتب الرسالة:");
  }

  if (data.startsWith("rem_")) {
    const target = Number(data.split("_")[1]);
    if (target === MAIN_ADMIN)
      return bot.sendMessage(id,"❌ لا يمكن حذف المنشئ الأساسي");

    admins = admins.filter(a=>a!==target);
    db.admins = admins;
    saveDB();
    bot.sendMessage(id,"✅ تم حذف الأدمن");
  }

  if (data.startsWith("reply_")) {
    const adminId = id;
    const userId = data.split("_")[1];
    waiting[adminId] = { type:"reply_user", to:userId };
    bot.sendMessage(adminId,"✍️ اكتب الرد:");
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
      bot.sendMessage(id,"⚠️ الاسم مستخدم، جرب اسم آخر");
    else
      bot.sendMessage(id,"❌ حدث خطأ أثناء الإنشاء");
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
    settings.channelLink = text.startsWith("http") ? text : `https://t.me/${text.replace("@","")}`;
    waiting[id]=null;
    saveDB();
    return bot.sendMessage(id,"✅ تم حفظ القناة");
  }

  if (waiting[id]==="support"){
    admins.forEach(a=>{
      bot.sendMessage(a,
`📩 رسالة دعم

👤 ${msg.from.first_name}
🆔 ${id}

${text}`,{
        reply_markup:{
          inline_keyboard:[
            [{ text:"💬 رد", callback_data:`reply_${id}` }]
          ]
        }
      });
    });

    waiting[id]=null;
    return bot.sendMessage(id,"✅ تم إرسال رسالتك");
  }

  if (waiting[id]?.type==="reply_user"){
    bot.sendMessage(waiting[id].to,
`📩 رد من الدعم:

${text}`);
    waiting[id]=null;
    return;
  }

  if (waiting[id]?.type==="admin_msg"){
    bot.sendMessage(waiting[id].to,
`📩 رسالة من الإدارة:

${text}`);
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
