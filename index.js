// bot.js - Gmail Factory Telegram Bot (Arabic) - Professional Edition
// يتطلب: npm install node-telegram-bot-api sqlite3 playwright axios dotenv
// ثم: npx playwright install chromium

require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { chromium } = require('playwright');

// =========================== إعدادات عامة ===========================
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
if (!TOKEN || isNaN(ADMIN_ID)) {
    console.error('❌ تأكد من تعيين BOT_TOKEN و ADMIN_ID في ملف .env');
    process.exit(1);
}

const bot = new Telegraf(TOKEN);
bot.use(session());

// =========================== قاعدة البيانات ===========================
const db = new sqlite3.Database('./accounts.db');
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        lang TEXT DEFAULT 'ar',
        balance INTEGER DEFAULT 0,
        state TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);
db.run(`
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
`);

const getSetting = (key, def = '') => {
    return new Promise((resolve, reject) => {
        db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
            if (err || !row) resolve(def);
            else resolve(row.value);
        });
    });
};
const setSetting = (key, value) => {
    return new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// =========================== دوال مساعدة ===========================
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// توليد بصمة عشوائية (Fingerprint)
function generateFingerprint() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    ];
    const screenRes = [[1920,1080], [1366,768], [1536,864], [2560,1440]];
    const res = screenRes[randomInt(0, screenRes.length-1)];
    return {
        userAgent: userAgents[randomInt(0, userAgents.length-1)],
        screenWidth: res[0],
        screenHeight: res[1],
        hardwareConcurrency: randomInt(4, 16),
        deviceMemory: randomInt(4, 32),
        platform: ['Win32', 'MacIntel', 'Linux x86_64'][randomInt(0,2)],
        timezone: ['America/New_York', 'Europe/London', 'Asia/Dubai'][randomInt(0,2)],
        language: 'ar-EG'
    };
}

// توليد هوية (اسم، تاريخ ميلاد، إلخ)
function generatePersona() {
    const firstNamesMale = ['أحمد', 'محمد', 'علي', 'حسن', 'حسين', 'محمود', 'كريم', 'ياسر', 'عمرو', 'خالد'];
    const firstNamesFemale = ['فاطمة', 'زينب', 'نور', 'سارة', 'ليلى', 'منى', 'هند', 'ريما', 'دينا', 'شيماء'];
    const lastNames = ['علي', 'حسن', 'حسين', 'محمود', 'إبراهيم', 'خليل', 'جميل', 'كريم', 'ناصر', 'عبد الله'];
    const gender = randomInt(0,1) === 0 ? 'male' : 'female';
    const firstName = gender === 'male' ? firstNamesMale[randomInt(0, firstNamesMale.length-1)] : firstNamesFemale[randomInt(0, firstNamesFemale.length-1)];
    const lastName = lastNames[randomInt(0, lastNames.length-1)];
    const birthYear = randomInt(1970, 2005);
    const birthMonth = randomInt(1,12);
    const birthDay = randomInt(1,28);
    return {
        firstName, lastName,
        fullName: `${firstName} ${lastName}`,
        gender,
        birthDate: { year: birthYear, month: birthMonth, day: birthDay, string: `${birthYear}-${birthMonth}-${birthDay}` },
        age: new Date().getFullYear() - birthYear,
        recoveryEmail: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(10,999)}@gmail.com`
    };
}

// توليد كلمة مرور قوية
function generatePassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let pwd = '';
    for(let i=0; i<16; i++) pwd += chars[randomInt(0, chars.length-1)];
    return pwd;
}

// إنشاء حساب Gmail عبر Playwright
async function createGmailAccount(fingerprint, persona, proxy, useSms = false, captchaApiKey = null) {
    const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({
        userAgent: fingerprint.userAgent,
        viewport: { width: fingerprint.screenWidth, height: fingerprint.screenHeight },
        locale: fingerprint.language,
        timezoneId: fingerprint.timezone,
        proxy: proxy ? { server: proxy } : undefined
    });
    const page = await context.newPage();

    try {
        await page.goto('https://accounts.google.com/signup/v2/webcreateaccount?flowName=GlifWebSignIn&flowEntry=SignUp', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForSelector('input[name="firstName"]', { timeout: 15000 });
        await page.fill('input[name="firstName"]', persona.firstName);
        await page.fill('input[name="lastName"]', persona.lastName);
        await page.click('button[jsname="LgbsSe"]');
        await page.waitForNavigation({ waitUntil: 'networkidle' });

        // تاريخ الميلاد
        await page.selectOption('#month', String(persona.birthDate.month));
        await page.fill('#day', String(persona.birthDate.day));
        await page.fill('#year', String(persona.birthDate.year));
        await page.click('button[jsname="LgbsSe"]');
        await page.waitForNavigation({ waitUntil: 'networkidle' });

        // اختيار اسم المستخدم
        let username = `${persona.firstName.toLowerCase()}.${persona.lastName.toLowerCase()}${randomInt(100,999)}`;
        await page.waitForSelector('input[name="Username"]', { timeout: 10000 });
        await page.fill('input[name="Username"]', username);
        await sleep(2000);
        const taken = await page.$('div[jsname="B34EJ"]');
        if (taken) {
            username = `${persona.firstName.toLowerCase()}${persona.lastName.toLowerCase()}${randomInt(1000,9999)}`;
            await page.fill('input[name="Username"]', username);
        }
        await page.click('button[jsname="LgbsSe"]');
        await page.waitForNavigation({ waitUntil: 'networkidle' });

        // كلمة المرور
        const password = generatePassword();
        await page.fill('input[name="Passwd"]', password);
        await page.fill('input[name="ConfirmPasswd"]', password);
        await page.click('button[jsname="LgbsSe"]');
        await page.waitForNavigation({ waitUntil: 'networkidle' });

        // تجاوز رقم الهاتف إذا أمكن
        const skipButton = await page.$('button:has-text("Skip"), button:has-text("تخطي")');
        if (skipButton) await skipButton.click();

        // معالجة رقم الهاتف إذا كان مطلوباً واستخدمنا SMS حقيقي
        let phoneNumber = null;
        if (useSms) {
            // هنا يمكن إضافة كود استدعاء 5sim API
            // للتبسيط سنفترض أننا نحصل على رقم وهمي
            phoneNumber = '+1234567890';
            await page.fill('input[type="tel"]', phoneNumber);
            await page.click('button[jsname="LgbsSe"]');
            await sleep(5000);
            // رمز التحقق - في الواقع سيتم انتظاره من API
            // سنعتبر أنه تم بنجاح
        }

        // حل captcha إذا ظهر
        if (captchaApiKey) {
            const recaptchaFrame = await page.frame({ url: /recaptcha/ });
            if (recaptchaFrame) {
                // إرسال طلب إلى 2captcha لحل reCAPTCHA
                // هذا مجرد نموذج - يجب إضافة API حقيقي
                console.log('تم اكتشاف reCAPTCHA، لكن حل تلقائي غير مفعل في هذا النموذج.');
            }
        }

        // الموافقة على الشروط
        await page.click('button:has-text("I agree"), button:has-text("أوافق")');
        await sleep(3000);

        const email = `${username}@gmail.com`;
        await browser.close();
        return { success: true, email, password, phone: phoneNumber };
    } catch (err) {
        console.error(err);
        await browser.close();
        return { success: false, error: err.message };
    }
}

// =========================== إدارة المستخدمين ===========================
async function getUserState(userId) {
    return new Promise((resolve) => {
        db.get('SELECT state FROM users WHERE id = ?', [userId], (err, row) => {
            if (err || !row) resolve(null);
            else resolve(row.state ? JSON.parse(row.state) : null);
        });
    });
}
async function setUserState(userId, state) {
    db.run('INSERT OR REPLACE INTO users (id, state) VALUES (?, ?)', [userId, JSON.stringify(state)], (err) => {});
}

// =========================== قائمة الأزرار الرئيسية ===========================
const mainMenu = (ctx) => {
    const buttons = [
        [{ text: '🔹 إنشاء حساب مجاني', callback_data: 'create_free' }],
        [{ text: '💰 إنشاء حساب مميز (SMS)', callback_data: 'create_premium' }],
        [{ text: '📦 إنشاء دفعة (Batch)', callback_data: 'batch_start' }],
        [{ text: '⚡ وضع مستمر (Continuous)', callback_data: 'continuous_start' }],
        [{ text: '🌐 إدارة البروكسيات', callback_data: 'proxy_menu' }],
        [{ text: '📊 الإحصائيات', callback_data: 'stats' }],
        [{ text: '💾 الحسابات المحفوظة', callback_data: 'saved_accounts' }],
        [{ text: '⚙️ الإعدادات', callback_data: 'settings' }]
    ];
    if (ctx.from.id === ADMIN_ID) {
        buttons.push([{ text: '👑 لوحة الأدمن', callback_data: 'admin_panel' }]);
    }
    return Markup.inlineKeyboard(buttons);
};

// =========================== معالجات الأوامر ===========================
bot.start(async (ctx) => {
    db.run('INSERT OR IGNORE INTO users (id, lang) VALUES (?, ?)', [ctx.from.id, 'ar']);
    await ctx.reply('✨ أهلاً بك في بوت Gmail Factory الاحترافي! اختر أحد الخيارات:', mainMenu(ctx));
});

bot.action('back_to_menu', async (ctx) => {
    await ctx.editMessageText('✨ القائمة الرئيسية:', mainMenu(ctx));
});

// إنشاء حساب مجاني
bot.action('create_free', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('🔍 جاري إنشاء حساب Gmail مجاني... قد يستغرق 30-90 ثانية.');
    const fingerprint = generateFingerprint();
    const persona = generatePersona();
    const result = await createGmailAccount(fingerprint, persona, null, false, null);
    if (result.success) {
        const msg = `✅ تم إنشاء الحساب بنجاح!\n📧 البريد: ${result.email}\n🔑 كلمة المرور: ${result.password}\n📱 الهاتف: ${result.phone || 'غير مفعل'}`;
        await ctx.editMessageText(msg);
        // حفظ الحساب في ملف
        const accountsFile = path.join(__dirname, 'output', 'successful_accounts.json');
        await fs.mkdir(path.dirname(accountsFile), { recursive: true });
        let accounts = [];
        try { accounts = JSON.parse(await fs.readFile(accountsFile, 'utf-8')); } catch(e) {}
        accounts.push({ email: result.email, password: result.password, phone: result.phone, created_at: new Date().toISOString() });
        await fs.writeFile(accountsFile, JSON.stringify(accounts, null, 2));
    } else {
        await ctx.editMessageText(`❌ فشل إنشاء الحساب: ${result.error}`);
    }
    setTimeout(() => ctx.reply('✨ ارجع إلى القائمة الرئيسية:', mainMenu(ctx)), 3000);
});

// إنشاء حساب مميز (مع SMS) - نموذج
bot.action('create_premium', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('🔍 جاري إنشاء حساب مميز مع رقم هاتف... قد يستغرق وقتًا أطول.');
    // في الواقع سيتم الاتصال بـ 5sim API
    await ctx.editMessageText('⚠️ خاصية SMS لم تُفعَّل بالكامل بعد. قم بتعيين مفتاح 5sim في الإعدادات.');
    setTimeout(() => ctx.reply('القائمة الرئيسية:', mainMenu(ctx)), 3000);
});

// دفعة (Batch)
bot.action('batch_start', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('📦 أرسل عدد الحسابات المطلوب إنشاؤها (1-20):');
    setUserState(ctx.from.id, { action: 'batch_count' });
});

bot.on('text', async (ctx) => {
    const state = await getUserState(ctx.from.id);
    if (state && state.action === 'batch_count') {
        const count = parseInt(ctx.message.text);
        if (isNaN(count) || count < 1 || count > 20) {
            await ctx.reply('❌ أرسل عددًا صحيحًا بين 1 و 20.');
            return;
        }
        await ctx.reply(`🔍 جاري إنشاء ${count} حسابًا واحدًا تلو الآخر...`);
        setUserState(ctx.from.id, null);
        let successes = 0;
        for (let i = 1; i <= count; i++) {
            await ctx.reply(`⏳ الحساب ${i}/${count} قيد الإنشاء...`);
            const result = await createGmailAccount(generateFingerprint(), generatePersona(), null, false, null);
            if (result.success) successes++;
            await sleep(30000); // تأخير بين الحسابات
        }
        await ctx.reply(`✅ تم إنشاء ${successes} من ${count} حسابًا بنجاح.`);
        await ctx.reply('✨ القائمة الرئيسية:', mainMenu(ctx));
    }
});

// إحصائيات
bot.action('stats', async (ctx) => {
    const accountsFile = path.join(__dirname, 'output', 'successful_accounts.json');
    let count = 0;
    try { const data = await fs.readFile(accountsFile, 'utf-8'); count = JSON.parse(data).length; } catch(e) {}
    await ctx.editMessageText(`📊 إحصائيات البوت:\n✅ عدد الحسابات المنشأة: ${count}\n⏱ وقت التشغيل: ${process.uptime().toFixed(0)} ثانية`);
    setTimeout(() => ctx.reply('القائمة:', mainMenu(ctx)), 3000);
});

// الحسابات المحفوظة
bot.action('saved_accounts', async (ctx) => {
    const accountsFile = path.join(__dirname, 'output', 'successful_accounts.json');
    let accounts = [];
    try { accounts = JSON.parse(await fs.readFile(accountsFile, 'utf-8')); } catch(e) {}
    if (accounts.length === 0) {
        await ctx.editMessageText('💾 لا توجد حسابات محفوظة بعد.');
    } else {
        const last = accounts.slice(-5).reverse();
        let msg = '💾 آخر 5 حسابات:\n';
        last.forEach(acc => { msg += `📧 ${acc.email}\n🔑 ${acc.password}\n📅 ${acc.created_at}\n---\n`; });
        await ctx.editMessageText(msg);
    }
    setTimeout(() => ctx.reply('القائمة:', mainMenu(ctx)), 5000);
});

// إعدادات
bot.action('settings', async (ctx) => {
    const smsApi = await getSetting('sms_api_key', 'غير مفعل');
    const captchaApi = await getSetting('captcha_api_key', 'غير مفعل');
    await ctx.editMessageText(`⚙️ الإعدادات الحالية:\n📱 مفتاح SMS: ${smsApi}\n🤖 مفتاح CAPTCHA: ${captchaApi}\n\nللتبديل، استخدم أوامر الأدمن.`);
    setTimeout(() => ctx.reply('القائمة:', mainMenu(ctx)), 3000);
});

// لوحة الأدمن
bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const adminButtons = Markup.inlineKeyboard([
        [{ text: '🔧 تعيين مفتاح SMS', callback_data: 'admin_set_sms' }],
        [{ text: '🔧 تعيين مفتاح CAPTCHA', callback_data: 'admin_set_captcha' }],
        [{ text: '📢 إرسال إعلان', callback_data: 'admin_broadcast' }],
        [{ text: '🔙 رجوع', callback_data: 'back_to_menu' }]
    ]);
    await ctx.editMessageText('👑 لوحة تحكم الأدمن:', adminButtons);
});

bot.action('admin_set_sms', async (ctx) => {
    await ctx.editMessageText('📱 أرسل مفتاح API الخاص بـ 5sim:');
    setUserState(ctx.from.id, { action: 'set_sms_key' });
});
bot.action('admin_set_captcha', async (ctx) => {
    await ctx.editMessageText('🤖 أرسل مفتاح API الخاص بـ 2captcha:');
    setUserState(ctx.from.id, { action: 'set_captcha_key' });
});
bot.action('admin_broadcast', async (ctx) => {
    await ctx.editMessageText('📢 أرسل نص الإعلان لإرساله لجميع المستخدمين:');
    setUserState(ctx.from.id, { action: 'broadcast' });
});

// معالجة نصوص الأدمن
bot.on('text', async (ctx) => {
    const state = await getUserState(ctx.from.id);
    if (!state) return;
    if (state.action === 'set_sms_key' && ctx.from.id === ADMIN_ID) {
        await setSetting('sms_api_key', ctx.message.text);
        await ctx.reply('✅ تم حفظ مفتاح SMS بنجاح.');
        setUserState(ctx.from.id, null);
        await ctx.reply('القائمة:', mainMenu(ctx));
    } else if (state.action === 'set_captcha_key' && ctx.from.id === ADMIN_ID) {
        await setSetting('captcha_api_key', ctx.message.text);
        await ctx.reply('✅ تم حفظ مفتاح CAPTCHA بنجاح.');
        setUserState(ctx.from.id, null);
        await ctx.reply('القائمة:', mainMenu(ctx));
    } else if (state.action === 'broadcast' && ctx.from.id === ADMIN_ID) {
        const msg = ctx.message.text;
        const users = await new Promise((resolve) => {
            db.all('SELECT id FROM users', [], (err, rows) => resolve(rows || []));
        });
        let sent = 0;
        for (const user of users) {
            try { await bot.telegram.sendMessage(user.id, `📢 إعلان من الأدمن:\n${msg}`); sent++; } catch(e) {}
        }
        await ctx.reply(`✅ تم إرسال الإعلان إلى ${sent} مستخدم.`);
        setUserState(ctx.from.id, null);
        await ctx.reply('القائمة:', mainMenu(ctx));
    }
});

// إدارة البروكسيات (قائمة)
bot.action('proxy_menu', async (ctx) => {
    const proxyFile = path.join(__dirname, 'config', 'proxies.txt');
    let proxyList = 'لم يتم إضافة بروكسيات بعد.';
    try { proxyList = await fs.readFile(proxyFile, 'utf-8'); } catch(e) {}
    await ctx.editMessageText(`🌐 قائمة البروكسيات الحالية:\n${proxyList}\n\nلإضافتها، ضع كل بروكسي في سطر منفصل داخل ملف config/proxies.txt`);
    setTimeout(() => ctx.reply('القائمة:', mainMenu(ctx)), 4000);
});

// وضع مستمر (Continuous) - تبسيط
bot.action('continuous_start', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('⚡ سيتم إنشاء الحسابات بشكل مستمر حتى تتوقف. أرسل /stop لإيقاف العملية.');
    setUserState(ctx.from.id, { action: 'continuous' });
    // سنبدأ حلقة بسيطة - لكن يجب التعامل معها بحذر
    (async () => {
        let running = true;
        while (running) {
            const state = await getUserState(ctx.from.id);
            if (!state || state.action !== 'continuous') break;
            const result = await createGmailAccount(generateFingerprint(), generatePersona(), null, false, null);
            if (result.success) {
                await ctx.reply(`✅ تم إنشاء: ${result.email}`);
            } else {
                await ctx.reply(`❌ فشل: ${result.error}`);
            }
            await sleep(60000);
        }
    })();
});
bot.command('stop', async (ctx) => {
    await setUserState(ctx.from.id, null);
    await ctx.reply('⏹ تم إيقاف الوضع المستمر.');
    await ctx.reply('القائمة:', mainMenu(ctx));
});

// =========================== تشغيل البوت ===========================
bot.launch().then(() => console.log('🚀 البوت يعمل بنجاح!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
