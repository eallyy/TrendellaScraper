const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
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

const IG_COOKIES = [
  {
    name: 'sessionid',
    value: '55966343771%3AZNHN8mAEw6tYe0%3A5%3AAYeKCLUm4s57D4hbiBZWNaVUX3TXtodhLWbJbTpfTQ',
    domain: '.instagram.com',
    path: '/',
    httpOnly: true,
    secure: true
  },
  {
    name: 'ds_user_id',
    value: '55966343771',
    domain: '.instagram.com',
    path: '/',
    httpOnly: true,
    secure: true
  },
  {
    name: 'csrftoken',
    value: 'l4mScfwohVRdG0b7eocxG8XcgJkL83oa',
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
    console.error('❌ Supabase tablosundan kullanıcılar alınamadı:', fetchError.message);
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
    console.log(`\n🔍 İşleniyor: @${username}`);
    const profileUrl = `https://www.instagram.com/${username}/reels/`;
    await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);

    // Scroll loop
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

        results.push({
          username,
          link: href,
          views,
          likes,
          comments
        });
      });

      return results;
    }, username);

    if (reels.length === 0) {
      console.log(`⚠️ Reels bulunamadı: ${username}`);
      continue;
    }

    const avgViews = reels.reduce((sum, r) => sum + r.views, 0) / reels.length;
    const overPerformed = reels.filter(r => r.views > avgViews * 1.5);

    console.log(`🏆 Winner reels: ${overPerformed.length}/${reels.length}`);

    for (const winner of overPerformed) {
      try {
        const { error } = await supabase
          .from('winner_reels')
          .upsert(
            {
              username: winner.username,
              link: winner.link,
              views: winner.views,
              likes: winner.likes,
              comments: winner.comments
            },
            { onConflict: 'link' }
          );

        if (error) {
          console.warn(`❌ Supabase insert hatası (${winner.link}):`, error.message);
        } else {
          console.log(`✅ Supabase'e eklendi/güncellendi: ${winner.link}`);
        }
      } catch (err) {
        console.warn(`❌ Supabase hata: ${err.message}`);
      }
    }

    winners.push(...overPerformed);
  }

  console.log('\n📦 Tüm winner productlar:');
  console.table(winners);

  await browser.close();
})();
