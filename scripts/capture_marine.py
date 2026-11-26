"""How-to walkthrough of marine.islandsoutside.com: phone-size screenshots + manifest (temporary)."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1]; os.makedirs(f'{OUT}/frames', exist_ok=True); shots = []
SITE = 'https://marine.islandsoutside.com/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 432, 'height': 768}, device_scale_factor=2.5, is_mobile=True, has_touch=True, timezone_id='America/Jamaica')
        pg = await ctx.new_page()
        async def box(js):
            bx = await pg.evaluate(f"(() => {{ const e = {js}; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }})()")
            return [round(bx[0], 1), round(bx[1], 1)] if bx else None
        async def shot(name, caption, tap=None, hold=4.3):
            await pg.screenshot(path=f'{OUT}/frames/{name}.jpg', type='jpeg', quality=92)
            shots.append({'name': name, 'caption': caption, 'tap': tap, 'hold': hold, 'new': False}); print('shot', name, tap)
        async def scroll_js(js, off=-12):
            await pg.evaluate(f"(() => {{ const e = {js}; if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY + {off}); }})()")
            await pg.wait_for_timeout(900)
        byText = lambda sel, txt: f"[...document.querySelectorAll({json.dumps(sel)})].find(e => e.textContent.includes({json.dumps(txt)}))"
        await pg.goto(SITE, wait_until='networkidle'); await pg.wait_for_timeout(4000)
        await pg.evaluate("document.getElementById('marine-alert-ack')?.click(); document.getElementById('pwa-offline-notice')?.setAttribute('hidden','')")
        await pg.wait_for_timeout(500)
        await shot('m1-open', 'Open the site: today’s sea conditions for Jamaica’s fishing banks.')
        await scroll_js("document.getElementById('today-outlook')", off=-8)
        await shot('m2-outlook', 'Each bank gets a comfort rating, with wind, seas, current and swell.',
                   tap=await box("document.querySelector('#today-outlook [class*=badge], #today-outlook [class*=rating], #today-outlook .caution')"))
        # tap a day chip (the 3rd) to plan ahead
        chip = "[...document.querySelectorAll('#today-outlook button, #today-outlook [role=tab]')].filter(e => /\\d/.test(e.textContent) && e.textContent.trim().length < 12)[2]"
        t = await box(chip); await pg.evaluate(f"{chip}?.click()"); await pg.wait_for_timeout(1800)
        await scroll_js("document.getElementById('today-outlook')", off=-8)
        await shot('m3-days', 'Tap a day to plan up to a week ahead.', tap=t)
        await pg.evaluate(f"{chip.replace('[2]','[0]')}?.click()"); await pg.wait_for_timeout(1500)
        tides = byText('summary', 'Tides, sun')
        await pg.evaluate(f"{tides}?.click()"); await pg.wait_for_timeout(800)
        await scroll_js(tides, off=-60)
        await shot('m4-tides', 'Tides, sun and moon for planning when to leave and when to fish.', tap=await box(tides))
        await scroll_js("document.getElementById('bank-select')", off=-90)
        await pg.wait_for_timeout(2500)
        await pg.select_option('#bank-select', 'california'); await pg.wait_for_timeout(3000)
        await scroll_js("document.getElementById('bank-map')", off=-150); await pg.wait_for_timeout(2500)
        await shot('m5-map', 'Pick your bank from the list, or tap its dot on the depth map.', tap=await box("document.getElementById('bank-select')"))
        await scroll_js("document.getElementById('bank-title')", off=-20)
        await shot('m6-bank', 'Your bank: trip rating, max wind and gusts, seas and current.', tap=await box("document.getElementById('bank-rating')"))
        hh = byText('summary', 'Hour-by-hour')
        await pg.evaluate(f"{hh}?.click()"); await pg.wait_for_timeout(800)
        await scroll_js("document.getElementById('bank-charts')", off=-20)
        await shot('m7-charts', 'Hour by hour: wind, gusts and seas to time your run out and back.')
        json.dump(shots, open(f'{OUT}/manifest.json', 'w'), indent=1)
        await b.close()
asyncio.run(main())
