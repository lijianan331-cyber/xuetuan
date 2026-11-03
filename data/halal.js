/* 清真名单（用户 2026-11-03 确认）：v = halal 清真 / porkfree 无猪肉（穆斯林友好） / nonhalal 非清真。
   campus：键 = 学校餐厅表里的 楼 · 铺位。学校公布的 "Pork-free/Muslim-friendly Cafeteria Lots" 表里的档口记 porkfree，
   用户另外确认是清真的记 halal。超市、便利店不标。
   places：校外的店，keys 是店名里会出现的片段（小写），离 lat/lng 200 米内才算（Bell 一带，用户 2026-11-03 逐家确认）。
   嘛嘛档（分类 mamak）和新疆餐厅按用户说的直接算清真，规则写在 js/01-core.js 的 placeHalal 里 */
window.XUETUAN_HALAL = {
  campus: {
    "B1 · G04": { v: "halal" },
    "B1 · G05": { v: "porkfree" },
    "B1 · G06": { v: "halal" },
    "B1 · G07": { v: "porkfree" },
    "B1 · G08": { v: "porkfree" },
    "D6 · G02": { v: "porkfree" },
    "D6 · G03": { v: "porkfree" },
    "D6 · G04": { v: "porkfree" },
    "D6 · G05": { v: "porkfree" },
    "D6 · 101": { v: "porkfree" },
    "D6 · 105": { v: "porkfree" },
    "D6 · 201": { v: "porkfree" },
    "D6 · 202": { v: "porkfree" },
    "D6 · 204": { v: "porkfree" },
    "D6 · 206": { v: "porkfree" },
    "LY3 · 104": { v: "porkfree" },
    "LY3 · 105": { v: "porkfree" },
    "LY3 · 107": { v: "porkfree" },
    "LY3 · 108": { v: "porkfree" },
    "LY3 · 2F": { v: "porkfree" },
    "Music Island · GF": { v: "porkfree" },
    "A3 · GF": { v: "porkfree" },
    "IAEC · GF": { v: "porkfree" }
  },
  places: [
    { keys: ["luosifen", "螺蛳粉", "zhuangzhuang"], lat: 2.8288, lng: 101.7053, v: "nonhalal" },
    { keys: ["nomu"], lat: 2.8288, lng: 101.7053, v: "halal" },
    { keys: ["南洋"], lat: 2.8288, lng: 101.7053, v: "nonhalal" },
    { keys: ["mixue", "蜜雪"], lat: 2.8288, lng: 101.7053, v: "halal" },
    { keys: ["katsu"], lat: 2.8288, lng: 101.7053, v: "nonhalal" },
    { keys: ["秀海福", "麻辣烫"], lat: 2.8288, lng: 101.7053, v: "nonhalal" },
    { keys: ["baskin"], lat: 2.8288, lng: 101.7053, v: "halal" },
    { keys: ["starbucks", "星巴克"], lat: 2.8288, lng: 101.7053, v: "halal" },
    { keys: ["the grind", "grind coffee"], lat: 2.8288, lng: 101.7053, v: "halal" },
    { keys: ["irulez"], lat: 2.8288, lng: 101.7053, v: "halal" },
    { keys: ["mimi peri"], lat: 2.8288, lng: 101.7053, v: "halal" }
  ]
};
