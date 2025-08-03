const { OpenAI } = require("openai");

// OpenAI setup
const openai = new OpenAI({
  apiKey:'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',
});

const categories = [
  // ✅ Tesettür
  "tesettür", "ferace", "şal", "bone",

  // ✅ Üst Giyim
  "tunik", "gömlek", "bluz", "kazak", "hırka",
  "sweatshirt", "tişört", "crop", "ceket", "takım",

  // ✅ Alt Giyim
  "etek", "pantolon", "şort", "jean",

  // ✅ Elbise
  "elbise",

  // ✅ İç & Plaj Giyim
  "iç giyim", "bikini", "mayokini",

  // ✅ Dış Giyim
  "trençkot", "kaban", "mont", "yağmurluk", "dış giyim",

  // ✅ Ayakkabı
  "ayakkabı", "topuklu ayakkabı", "spor ayakkabı", "bot",

  // ✅ Aksesuar
  "çanta", "şapka", "gözlük", "takı", "aksesuar",

  // ✅ Diğer
  "diğer"
]

async function classifyCaption(caption) {
  const prompt = `
Aşağıdaki Instagram açıklamasını göz önünde bulundurarak bu içeriği aşağıdaki kategorilerden yalnızca biriyle sınıflandır:

Instagram caption:
"""${caption}"""

Kategoriler:
${categories.join(", ")}

Sadece en iyi eşleşen kategoriyi tek kelime olarak döndür. Eğer hiçbir kategori ile eşleşmiyor ya da sana verdiğim instagram caption'ı yoksa(yani boş ise) verdiğim kategorilerden birine eşleyemediğin her senaryo icin sadece "diğer" kategorisini cevap olarak döndür.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const category = response.choices[0].message.content?.trim() ?? "";
    return category;
  } catch (err) {
    console.error("🚨 OpenAI API hatası:", err.message);
    return "diğer";
  }
}
 
// Scraper
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const sleep = (ms, variance = 0.2) => {
  const offset = ms * variance;
  const randomized = ms + (Math.random() * offset * 2 - offset);
  return new Promise(resolve => setTimeout(resolve, randomized));
};

async function takeAndUploadScreenshot(page, supabase, reelLink) {
  try {
    const videoElement = await page.$('video');
    if (!videoElement) {
      console.warn(`🚫 Video elementi bulunamadı: ${reelLink}`);
      return null;
    }

    const screenshotBuffer = await videoElement.screenshot();
    const hash = Buffer.from(reelLink).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    const fileName = `thumbnails/${hash}.jpg`;

    const { error, data } = await supabase.storage
      .from('thumbnails')
      .upload(fileName, screenshotBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (error) {
      console.error(`🚫 Screenshot upload hatası: ${error.message}`);
      return null;
    }

    const publicUrl = supabase.storage
      .from('thumbnails')
      .getPublicUrl(fileName).data.publicUrl;

    return publicUrl;
  } catch (err) {
    console.error(`🚫 Screenshot alma hatası: ${err.message}`);
    return null;
  }
}

const IG_COOKIES = [
  {
    name: 'sessionid',
    value: process.env.IG_SESSIONID,
    domain: '.instagram.com',
    path: '/',
    httpOnly: true,
    secure: true
  },
  {
    name: 'ds_user_id',
    value: process.env.IG_USERID,
    domain: '.instagram.com',
    path: '/',
    httpOnly: true,
    secure: true
  },
  {
    name: 'csrftoken',
    value: process.env.IG_CSRF,
    domain: '.instagram.com',
    path: '/',
    httpOnly: false,
    secure: true
  }
];

(async () => {
  const { data: accountData, error: fetchError } = await supabase
    .from('instagram_accounts')
    .select('username');

  if (fetchError) {
    console.error('🚨 Supabase tablosundan kullanıcılar alınamadı:', fetchError.message);
    process.exit(1);
  }

  const usernames = accountData.map(acc => acc.username).filter(Boolean);
  if (usernames.length === 0) {
    console.warn('⚠️ Hiç kullanıcı bulunamadı.');
    process.exit(0);
  }

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 30,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setCookie(...IG_COOKIES);

  await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
  await sleep(3000);
  console.log('✅ Login kontrolü tamamlandı.');

  const winners = [];

  for (const username of usernames) {
    console.log(`\n📥 Yükleniyor: @${username}`);
    const profileUrl = `https://www.instagram.com/${username}/reels/`;
    await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);

    let prevCount = 0;
    let sameCount = 0;
    while (sameCount < 3) {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          const distance = 300;
          const delay = 80;
          let total = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            total += distance;
            if (total >= 3000) {
              clearInterval(timer);
              resolve();
            }
          }, delay);
        });
      });
      await sleep(2000);

      const count = await page.$$eval('a', as => as.filter(a => a.href.includes('/reel/')).length);
      if (count === prevCount) sameCount++;
      else {
        sameCount = 0;
        prevCount = count;
      }
    }

    const reels = await page.$$eval('a', (anchors, username) => {
      const formatNumber = (text) => {
        if (!text) return 0;
        text = text.toLowerCase().replace(',', '.');
        if (text.endsWith('k')) return Math.round(parseFloat(text) * 1000);
        if (text.endsWith('m')) return Math.round(parseFloat(text) * 1000000);
        return parseInt(text.replace(/[^\d]/g, '')) || 0;
      };

      const results = [];

      anchors.forEach(anchor => {
        const href = anchor.href;
        if (!href.includes('/reel/')) return;

        const parent = anchor.closest('div') || anchor.parentElement;
        const spans = parent?.querySelectorAll('span[class*="xdj266r"]');

        let views = 0, likes = 0, comments = 0;

        if (spans?.length >= 3) {
          views = formatNumber(spans[2]?.innerText);
          comments = formatNumber(spans[1]?.innerText);
          likes = formatNumber(spans[0]?.innerText);
        } else if (spans?.length === 2) {
          views = formatNumber(spans[1]?.innerText);
          likes = formatNumber(spans[0]?.innerText);
        } else if (spans?.length === 1) {
          views = formatNumber(spans[0]?.innerText);
        }

        results.push({ username, link: href, views, likes, comments });
      });

      return results;
    }, username);

    if (reels.length === 0) {
      console.log(`⚠️ Reels bulunamadı: ${username}`);
      continue;
    }

    const avgViews = reels.reduce((sum, r) => sum + r.views, 0) / reels.length;
    const overPerformed = reels.filter(r => r.views > avgViews * 1.5);

    for (const reel of overPerformed) {
      await page.goto(reel.link, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(3000);

      const { caption, uploadedAt, thumbnailURL } = await page.evaluate(() => {
        const captionEl = document.querySelector('h1._ap3a');
        const timeEl = document.querySelector('time.x1p4m5qa');
        const video = document.querySelector('video');
        const poster = video?.getAttribute('poster') || null;

        return {
          caption: captionEl?.innerText?.trim() || null,
          uploadedAt: timeEl?.getAttribute('datetime') || null,
          thumbnailURL: poster
        };
      });

      reel.caption = caption;
      reel.category = await classifyCaption(caption);
      reel.uploaded_at = uploadedAt;
      reel.thumbnail = await takeAndUploadScreenshot(page, supabase, reel.link);

      try {
        const { error } = await supabase
          .from('winner_reels')
          .upsert(
            {
              username: reel.username,
              link: reel.link,
              views: reel.views,
              likes: reel.likes,
              comments: reel.comments,
              caption: reel.caption,
              uploaded_at: reel.uploaded_at,
              category: reel.category,
              thumbnail: reel.thumbnail
            },
            { onConflict: 'link' }
          );

        if (error) {
          console.warn(`❌ Supabase insert hatası (${reel.link}):`, error.message);
        } else {
          console.log(`✅ Supabase'e eklendi/güncellendi: ${reel.link}`);
        }
      } catch (err) {
        console.warn(`❌ Supabase hata: ${err.message}`);
      }
    }
  }

  await browser.close();
})();
