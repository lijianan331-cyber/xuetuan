/* 清真名单（用户 2026-11-03）：v = halal 清真 / porkfree 无猪肉 / nonhalal 非清真；guess = 还没确认，只显示“可能清真”。
   campus 的键 = 学校餐厅表里的 楼 · 铺位；places = 校外的店，key 是店名里一定会出现的一段（小写），在那个位置 200 米内才算 */
window.XUETUAN_HALAL = {
  campus: {
    "B1 · G04": { v: "halal", guess: true },
    "B1 · G06": { v: "halal", guess: true },
    "D6 · 105": { v: "halal", guess: true },
    "D6 · 201": { v: "halal", guess: true },
    "LY3 · 108": { v: "halal", guess: true },
    "A3 · GF": { v: "halal", guess: true }
  },
  places: []
};
