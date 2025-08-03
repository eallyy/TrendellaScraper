const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getUniqueUsernames() {
  const { data, error } = await supabase
    .from('winner_reels')
    .select('username');

  if (error) throw error;

  const usernames = [...new Set(data.map(row => row.username).filter(Boolean))];
  return usernames;
}

async function scrapeAdLibraryForUsername(page, username) {
  try {
    const url = 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL';
    await page.goto(url, { waitUntil: 'networkidle2' });
    await sleep(3000);

    const comboboxes = await page.$$('div[role="combobox"]');
    if (comboboxes.length >= 2) {
      await comboboxes[1].click();
      await sleep(2000);

      const allAdsButton = await page.evaluateHandle(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.find(el => el.textContent.trim() === 'All ads') || null;
      });

      if (allAdsButton) {
        await allAdsButton.click();
        await sleep(2000);
      } else {
        console.log(`⚠️ 'All ads' seçeneği DOM'da bulunamadı.`);
        return;
      }
    } else {
      console.log('⚠️ Gerekli comboboxlar bulunamadı.');
      return;
    }

    const searchInput = 'input[placeholder="Search by keyword or advertiser"]';
    await page.waitForSelector(searchInput, { timeout: 10000 });
    await page.focus(searchInput);
    await page.keyboard.type(username, { delay: 100 });
    await sleep(3000);

    const advertisersHeader = await page.evaluateHandle(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      return spans.find(el => el.textContent.trim() === 'Advertisers') || null;
    });

    if (!advertisersHeader) {
      console.log(`❌ Reklam hesabı bulunamadı: ${username}`);
      return;
    }

    const firstOption = await page.$('li[role="option"]');
    if (firstOption) {
      await firstOption.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      console.log(`✅ Ad library hesabına geçildi: ${username}`);
    } else {
      console.log(`⚠️ Advertiser seçeneği çıkmadı: ${username}`);
      return;
    }

    // ✅ Aktif reklam sayısını DOM'dan al
    await sleep(4000); // extra bekleme

    const activeAdsText = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const regex = /^~?\d+\s+result[s]?$/i;

      for (const el of elements) {
        const text = el.textContent?.trim();
        if (text && regex.test(text)) {
          return text;
        }
      }
      return null;
    });

    const activeAdsCount = activeAdsText
      ? parseInt(activeAdsText.replace(/[^0-9]/g, '')) || 0
      : 0;

    console.log(`📊 Aktif reklam sayısı (${username}): ${activeAdsCount}`);    // ✅ Sayfanın URL’si (kullanıcının ad library linki)
    const pageUrl = page.url();

    // ✅ Supabase'e kaydet
    const { error: upsertError } = await supabase
      .from('ad_library_accounts')
      .upsert({
        username: username,
        active_ads: activeAdsCount,
        link: pageUrl
      }, {
        onConflict: 'username'
      });

    if (upsertError) {
      console.error(`❌ Supabase upsert hatası: ${username} -`, upsertError.message);
    } else {
      console.log(`📥 Supabase'e güncellendi/eklendi: ${username} (${activeAdsCount} ads)`);
    }
  } catch (err) {
    console.error(`🚨 Hata oluştu (${username}):`, err.message);
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  const usernames = await getUniqueUsernames();
  console.log(`🎯 ${usernames.length} kullanıcı işlenecek.`);

  for (const username of usernames) {
    console.log(`🔍 İşleniyor: ${username}`);
    await scrapeAdLibraryForUsername(page, username);
    await sleep(3000);
  }

  await browser.close();
})();
