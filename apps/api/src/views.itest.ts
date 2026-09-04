// Integration tests for saved views: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers CRUD, RBAC,
// tenant isolation, save-by-name overwrite, and query validation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";
import { setupOrg as baseSetupOrg, makeEmail, orgIds, cleanupOrgs } from "./testHelpers.js";

const RUN = randomUUID().slice(0, 8);
const email = makeEmail("view", RUN);

async function setupOrg(tag: string) {
  return baseSetupOrg(tag, { email });
}


before(async () => { await prisma.$connect(); });
after(async () => {
  await cleanupOrgs("view", RUN);
});

test("CRUD: create, list, rename, and delete a saved view", async () => {
  const { token } = await setupOrg("crud");
  const created = await request(app).post("/api/analytics/views").set("Authorization", token)
    .send({ name: "West â€” last 30 days", query: "region=West&dateFrom=2026-01-01" });
  assert.equal(created.status, 201);
  const id = created.body.view.id;

  const list = await request(app).get("/api/analytics/views").set("Authorization", token);
  const found = list.body.views.find((v: any) => v.id === id);
  assert.equal(found.query, "region=West&dateFrom=2026-01-01", "the query round-trips verbatim");

  const renamed = await request(app).patch `/api/analytics/views/${id}`).set("Authorization", token).send({ name: "West" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.view.name, "West");

  assert.equal((await request(app).delete `/api/analytics/views/${id}`).set("Authorization", token)).status, 204);
  assert.ok(!(await request(app).get("/api/analytics/views").set("Authorization", token)).body.views.some((v: any) => v.id === id)));
});

test("saving under an existing name overwrites that view rather than duplicating it", async () => {
  const { token } = await setupOrg("upsert");
  const first = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "Mine", query: "region=West" });
  const second = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "Mine", query: "region=East" });
  assert.equal(second.status, 201);
  assert.equal(second.body.view.id, first.body.view.id, "same row, updated");
  const list = await request(app).get("/api/analytics/views").set("Authorization", token);
  assert.equal(list.body.views.filter((v: any) => v.name === "Mine").length, 1);
  assert.equal(list.body.views.find((v: any) => v.name === "Mine").query, "region=East");
});

test("renaming onto another view's name is refused (409)", async () => {
  const { token } = await setupOrg("clash");
  await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "A", query: "region=West" });
  const b = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "B", query: "region=East" });
  assert.equal

]ØZ]™\]Y\Ý
\
Kœ]ÚØ\KØ[˜[]XÜËÝšY]ÜËÉØ‹˜›ÙKšY]ËšYX
KœÙ]
]]Üš^˜][Ûˆ‹ÚÙ[ŠKœÙ[™
È˜[YNˆHˆJJJKœÝ]\ËJNÂŸJNÂ‚\Ý
˜H]Y\žHH[˜[]XÜÈ›Ý]\ÈÛÝ[™Z™XÝØ[››Ý™HØ]™Y

H‹\Þ[˜È

HOˆÂˆÛÛœÝÈÚÙ[ˆHH]ØZ]Ù]\Ü™Ê˜˜YHŠNÂˆ\ÜÙ\™\]X[

]ØZ]™\]Y\Ý
\
KœÜÝ
‹Ø\KØ[˜[]XÜËÝšY]ÜÈŠKœÙ]
]]Üš^˜][Ûˆ‹ÚÙ[ŠBˆœÙ[™
È˜[YNˆ˜˜Y]H‹]Y\žNˆ™]Qœ›ÛO[\Ý]Y\Ù^HˆJJKœÝ]\Ë
NÂˆ\ÜÙ\™\]X[

]ØZ]™\]Y\Ý
\
KœÜÝ
‹Ø\KØ[˜[]XÜËÝšY]ÜÈŠKœÙ]
]]Üš^˜][Ûˆ‹ÚÙ[ŠBˆœÙ[™
È˜[YNˆ[šÛ›ÝÛˆš[\ˆ‹]Y\žNˆœ[™][X\œÈˆJJKœÝ]\Ë
NÂˆËÈ™\X]Y\˜[\È\™HÝÈHRHÙ[™ÈH][K\Ù[XÝ[™]\ÝÝ^HØ]˜X›K‚ˆ\ÜÙ\™\]X[‚†v—B&WVW7B†’ç÷7B‚"ö’öæÇ—F–72÷f–Ww2"’ç6WB‚$WF†÷&—¦F–öâ"ÂFö¶Vâ¢ç6VæB‡²æÖS¢'Gvò&Vv–öç2"ÂVW'“¢'&Vv–öãÕvW7Bg&Vv–öãÔV7B"Ò’’’ç7FGW2Â#“°§Ò“° §FW7B‚%$$3¢d”UtU"6â&VBf–Ww2'WB6ææ÷B7&VFR÷"FVÆWFRöæR"Â7–æ2‚’Óâ°¢6öç7B²÷&t–BÂFö¶VâÒÒv—B6WGW÷&r‚'&&2"“°¢6öç7B7&VFVBÒv—B&WVW7B†’ç÷7B‚"ö’öæÇ—F–72÷f–Ww2"’ç6WB‚$WF†÷&—¦F–öâ"ÂFö¶Vâ’ç6VæB‡²æÖS¢%6†&VB"ÂVW'“¢'&Vv–öãÕvW7B"Ò“°¢6öç7Bf–WvW"Òv—B&—6ÖçW6W"æ7&VFR‡²FF¢²VÖ–Ã¢VÖ–Â‚'&&2×b"’ÂæÖS¢%b"Â77v÷&D†6ƒ¢'‚"ÒÒ“°¢v—B&—6Öæ÷&væ—¦F–öäÖVÖ&W"æ7&VFR‡²FF¢²W6W$–C¢f–WvW"æ–BÂ÷&væ—¦F–öä–C¢÷&t–BÂ&öÆS¢%d”UtU""ÒÒ“°¢6öç7BgFö¶VâÒ&V&W"G·6–våFö¶Vâ‡²W6W$–C¢f–WvW"æ–BÂ÷&væ—¦F–öä–C¢÷&t–BÂ&öÆS¢%d”UtU""Ò—Ö° ¢6öç7BÆ—7BÒv—B&WVW7B†’ævWB‚"ö’öæÇ—F–72÷f–Ww2"’ç6WB‚$WF†÷&—¦F–öâ"ÂgFö¶Vâ“°¢76W'BæWVÂ†Æ—7Bç7FGW2Â#“°¢76W'Bæö²†Æ—7Bæ&öG’çf–Ww2ç6öÖR‚‡c¢ç’’Óâbæ–BÓÓÒ7&VFVBæ&öG’çf–Wræ–B’Â&f–WvW"6VW2F†R÷&rw2f–Ww2"“°¢76W'BæWVÂ‚†v—B&WVW7B†’ç÷7B‚"ö’öæÇ—F–72÷f–Ww2"’ç6WB‚$WF†÷&—¦F–öâ"ÂgFö¶Vâ’ç6VæB‡²æÖS¢'‚"ÂVW'“¢'&Vv–öãÕvW7B"Ò’’ç7FGW2ÂC2“°¢76W'BæWVÂ‚†v—B&WVW7B†’æFVÆWFRö’öæÇ—F–72÷f–Ww2òG¶7&VFVBæ&öG’çf–Wræ–GÖ’ç6WB‚$WF†÷&—¦F–öâ"ÂgFö¶Vâ’’ç7FGW2ÂC2“°§Ò“° §FW7B‚'FVæçB—6öÆF–öã¢÷&r"6ææ÷B6VRÂ&VæÖRÂ÷"FVÆWFR÷&rw2f–Wr"Â7–æ2‚’Óâ°¢6öç7BÒv—B6WGW÷&r‚&—6òÖ"“°¢6öç7B"Òv—B6WGW÷&r‚&—6òÖ""“°¢6öç7B7&VFVBÒv—B&WVW7B†’ç÷7B‚"ö’öæÇ—F–72÷f–Ww2"’ç6WB‚$WF†÷&—¦F–öâ"ÂçFö¶Vâ’ç6VæB‡²æÖS¢$f–Wr"ÂVW'“¢'&Vv–öãÕvW7B"Ò“°¢6öç7B–BÒ7&VFVBæ&öG’çf–Wræ–C°¢76W'Bæö²‚†v—B&WVW7B†’ævWB‚"ö’öæÇ—F–72÷f–Ww2"’ç6WB‚$WF†÷&—¦F–öâ"Â"çFö¶Vâ’’æÆöG’çf–Ww2ç6öÖR‚‡c¢ç’’Óâbæ–BÓÓÒ–B’“°¢76W'BæWVÀ ¡…Ý…¥ÐÉ•ÅÕ•ÍÐ¡…ÁÀ¤¹Á…Ñ €½…Á¤½…¹…±åÑ¥Ì½Ù¥•ÝÌ¼‘í¥‘õ€¤¹Í•Ð ‰ÕÑ¡½É¥é…Ñ¥½¸ˆ°ˆ¹Ñ½­•¸¤¹Í•¹¡ì¹…µ”è€‰¡¥©…¬ˆô¤¤¤¹ÍÑ…ÑÕÌ°€ÐÀÐ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…° ¡…Ý…¥ÐÉ•ÅÕ•ÍÐ¡…ÁÀ¤¹‘•±•Ñ”€½…Á¤½…¹…±åÑ¥Ì½Ù¥•ÝÌ¼‘í¥‘õ€¤¹Í•Ð ‰ÕÑ¡½É¥é…Ñ¥½¸ˆ°ˆ¹Ñ½­•¸¤¤¹ÍÑ…ÑÕÌ°€ÐÀÐ¤ì(€€¼¼Q¡”Í…µ”¹…µ”¥Ì™É•”¥¸…¹½Ñ¡•È½ÉœƒŠPÕ¹¥ÅÕ•¹•ÍÌ¥ÌÁ•È½É…¹¥é…Ñ¥½¸°¹½Ð±½‰…°¸(€…ÍÍ•ÉÐ¹•ÅÕ…° ¡…Ý…¥ÐÉ•ÅÕ•ÍÐ¡…ÁÀ¤¹Á½ÍÐ ˆ½…Á¤½…¹…±åÑ¥Ì½Ù¥•ÝÌˆ¤¹Í•Ð ‰ÕÑ¡½É¥é…Ñ¥½¸ˆ°ˆ¹Ñ½­•¸¤¹Í•¹¡ì¹…µ”è€‰Ù¥•Üˆ°ÅÕ•Éäè€‰É•¥½¸õ…ÍÐˆô¤¤¤¹ÍÑ…ÑÕÌ°€ÈÀÄ¤ì)ô¤ì(