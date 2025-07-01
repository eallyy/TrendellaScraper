import asyncio
import os
import random

from dotenv import load_dotenv
from supabase import create_client
from playwright.async_api import async_playwright

load_dotenv()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
)

IG_COOKIES = [
    {
        "name": "sessionid",
        "value": "55966343771%3AZNHN8mAEw6tYe0%3A5%3AAYeKCLUm4s57D4hbiBZWNaVUX3TXtodhLWbJbTpfTQ",
        "domain": ".instagram.com",
        "path": "/",
        "httpOnly": True,
        "secure": True,
    },
    {
        "name": "ds_user_id",
        "value": "55966343771",
        "domain": ".instagram.com",
        "path": "/",
        "httpOnly": True,
        "secure": True,
    },
    {
        "name": "csrftoken",
        "value": "l4mScfwohVRdG0b7eocxG8XcgJkL83oa",
        "domain": ".instagram.com",
        "path": "/",
        "httpOnly": False,
        "secure": True,
    },
]


def rand_sleep(ms: int, variance: float = 0.2) -> asyncio.Future:
    offset = ms * variance
    randomized = ms + (random.random() * offset * 2 - offset)
    return asyncio.sleep(randomized / 1000)


async def fetch_usernames() -> list[str]:
    try:
        resp = supabase.table("instagram_accounts").select("username").execute()
    except Exception as err:
        raise RuntimeError(f"Supabase fetch error: {err}") from err

    return [acc["username"] for acc in resp.data if acc.get("username")]


async def main() -> None:
    usernames = await fetch_usernames()
    if not usernames:
        print("⚠️ Hiç kullanıcı bulunamadı.")
        return

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            slow_mo=30,
            args=["--start-maximized", "--no-sandbox"],
        )
        context = await browser.new_context()
        await context.add_cookies(IG_COOKIES)
        page = await context.new_page()
        await page.set_user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "Chrome/120.0.0.0 Safari/537.36"
        )

        await page.goto("https://www.instagram.com/", wait_until="networkidle")
        await rand_sleep(3000)
        print("✅ Login kontrolü tamamlandı.")

        winners: list[dict] = []

        for username in usernames:
            print(f"\n🔍 İşleniyor: @{username}")
            profile_url = f"https://www.instagram.com/{username}/reels/"
            await page.goto(profile_url, wait_until="networkidle")
            await rand_sleep(4000)

            prev_count = 0
            same_count = 0
            while same_count < 3:
                await page.evaluate(
                    """
                () => new Promise(resolve => {
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
                })
                """
                )
                await rand_sleep(2000)

                count = await page.eval_on_selector_all(
                    "a", "els => els.filter(a => a.href.includes('/reel/')).length"
                )
                if count == prev_count:
                    same_count += 1
                else:
                    same_count = 0
                    prev_count = count

            reels = await page.evaluate(
                r"""
            (username) => {
                const formatNumber = (text) => {
                    if (!text) return 0;
                    text = text.toLowerCase().replace(',', '.');
                    if (text.endsWith('k')) return Math.round(parseFloat(text) * 1000);
                    if (text.endsWith('m')) return Math.round(parseFloat(text) * 1000000);
                    return parseInt(text.replace(/[^\d]/g, '')) || 0;
                };

                const results = [];
                document.querySelectorAll('a').forEach(anchor => {
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

                    results.push({username, link: href, views, likes, comments});
                });
                return results;
            }
            """,
                username,
            )

            if not reels:
                print(f"⚠️ Reels bulunamadı: {username}")
                continue

            avg_views = sum(r["views"] for r in reels) / len(reels)
            over_performed = [r for r in reels if r["views"] > avg_views * 1.5]

            print(f"🏆 Winner reels: {len(over_performed)}/{len(reels)}")

            for winner in over_performed:
                try:
                    supabase.table("winner_reels").upsert(
                        {
                            "username": winner["username"],
                            "link": winner["link"],
                            "views": winner["views"],
                            "likes": winner["likes"],
                            "comments": winner["comments"],
                        },
                        on_conflict="link",
                    ).execute()

                    print(f"✅ Supabase'e eklendi/güncellendi: {winner['link']}")
                except Exception as err:
                    print(f"❌ Supabase hata: {err}")

            winners.extend(over_performed)

        print("\n📦 Tüm winner productlar:")
        for w in winners:
            print(w)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
