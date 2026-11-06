/* 雪团 js/01-core.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';

  /* ================= constants ================= */
  var XMUM = { lng: 101.7029, lat: 2.8329 };
  var MAX_PHOTOS = 6;
  /* 存储的键名沿用改名前的，改了会读不到已经存下的数据 */
  var LS_DATA = 'xmum-chiwan-map:data:v1';
  var LS_VIEW = 'xmum-chiwan-map:view:v1';
  var LS_AREAS = 'xuetuan:areas';
  var LS_SHARE = 'xuetuan:share';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 存不了就算了 */ } }
  /* Supabase 的地址和 publishable key 本来就是公开的，放在前端没问题；权限靠数据库的 RLS 规则 */
  var SUPABASE_URL = 'https://pshxrwfjcbvqlixdxlzs.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_BhsWKzuwXJG2de1mg7kMkg_wL2Koj6C';
  var BACKUP_APP = 'xuetuan';
  var BACKUP_APPS = ['xuetuan', 'xmum-chiwan-map'];
  var STYLE_URLS = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    color: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark'
  };
  var STYLE_ORDER = ['light', 'color', 'dark'];
  /* 人均价位滑条：拉到“RM x 左右”，显示 x 的 2/3 到 4/3（15 → 10–20，30 → 20–40）。
     60 以下常见价位挡位密、拉得慢，100 往上挡位稀、拉得快；最右 500 = 333 以上都算 */
  var PRICE_STOPS = [0, 5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 150, 200, 300, 400, 500];
  function priceBand(x) {
    if (!x) return null;
    return [Math.round(x * 2 / 3), x >= PRICE_STOPS[PRICE_STOPS.length - 1] ? Infinity : Math.round(x * 4 / 3)];
  }
  function priceFits(avg, x) {
    var b = priceBand(x);
    return !b || (!!avg && avg >= b[0] && avg <= b[1]);
  }
  function priceLabel(x) {
    var b = priceBand(x);
    if (!b) return t('anyOpt');
    return t('priceAbout', { n: x }) + ' · ' + (b[1] === Infinity ? 'RM' + b[0] + '+' : 'RM' + b[0] + '–' + b[1]);
  }
  var APP_LAYERS = ['lib-dot', 'lib-label', 'cl-halo', 'cl-circle', 'cl-count', 'pt-pin', 'pt-photo', 'pt-label', 'me-halo', 'me-dot'];
  /* 地图最多按 2 倍画（提速），图钉图片也画 2 倍就够 */
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  /* 每张照片多存一张小图：列表、地图图钉用它，省流量；地点页和看大图用原图 */
  var THUMB_SIDE = 640, THUMB_KEY = '#t';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mqMobile = window.matchMedia('(max-width: 959px)');
  function isMobile() { return mqMobile.matches; }

  var CATS = {
    food: [
      /* 顺序按同学常吃的排（用户 2026-11-01）：中餐、火锅、日料、韩餐、烤肉、饮品在前，马来放后面。
         hidden 的是旧分类：旧记录照常显示，选分类时不再出现 */
      { id: 'cn', zh: '中餐', en: 'Chinese', emoji: '🥢', color: '#D23F31' },
      { id: 'hotpot', zh: '火锅', en: 'Hotpot', emoji: '🍲', color: '#B02A37' },
      { id: 'jp', zh: '日料', en: 'Japanese', emoji: '🍣', color: '#7B52D1' },
      { id: 'kr', zh: '韩餐', en: 'Korean', emoji: '🌶️', color: '#2B8A3E' },
      { id: 'bbq', zh: '烤肉', en: 'BBQ', emoji: '🍖', color: '#D9480F' },
      { id: 'cafe', zh: '饮品', en: 'Drinks', emoji: '🧋', color: '#1E9C8F' },
      { id: 'west', zh: '西餐快餐', en: 'Western', emoji: '🍔', color: '#2F6FD6' },
      { id: 'sweet', zh: '甜品', en: 'Desserts', emoji: '🍧', color: '#D64F9A' },
      { id: 'pretty', zh: '漂亮饭', en: 'Pretty plates', emoji: '🥗', color: '#E8628C' },
      { id: 'street', zh: '夜市小摊', en: 'Night markets & stalls', emoji: '🏮', color: '#EE6A24' },
      { id: 'mamak', zh: '嘛嘛·印度', en: 'Mamak & Indian', emoji: '🥘', color: '#9A5B2F' },
      { id: 'malay', zh: '马来·娘惹', en: 'Malay & Nyonya', emoji: '🍛', color: '#E0A10E' },
      { id: 'jpkr', zh: '日韩', en: 'Japanese & Korean', emoji: '🍣', color: '#7B52D1', hidden: true },
      { id: 'other', zh: '其他', en: 'Other', emoji: '🍽️', color: '#69736E' }
    ],
    travel: [
      { id: 'island', zh: '海岛海滩', en: 'Islands & beaches', emoji: '🏝️', color: '#0E9BB5' },
      { id: 'city', zh: '城市街区', en: 'Cities', emoji: '🏙️', color: '#3B5BDB' },
      { id: 'nature', zh: '公园自然', en: 'Parks & nature', emoji: '⛰️', color: '#2F9E44' },
      { id: 'culture', zh: '人文展览', en: 'Culture & exhibitions', emoji: '🏛️', color: '#A35A2B' },
      { id: 'books', zh: '书店阅读', en: 'Bookshops & reading', emoji: '📚', color: '#527DA3' },
      { id: 'mall', zh: '商场购物', en: 'Malls & shopping', emoji: '🛍️', color: '#C2255C' },
      { id: 'fun', zh: '玩乐活动', en: 'Activities', emoji: '🎡', color: '#F08C00' },
      { id: 'stay', zh: '住宿', en: 'Stays', emoji: '🏨', color: '#7048E8' },
      { id: 'other', zh: '其他', en: 'Other', emoji: '📍', color: '#69736E' }
    ]
  };

  var PRESET_AREAS = [
    { id: 'xmum', zh: 'XMUM 校园', en: 'XMUM campus', lng: 101.7029, lat: 2.8329, zoom: 15.5 },
    { id: 'ioi', zh: 'IOI City Mall', en: 'IOI City Mall', lng: 101.7149, lat: 2.9701, zoom: 16 },
    { id: 'putrajaya', zh: '布城', en: 'Putrajaya', lng: 101.6930, lat: 2.9300, zoom: 12.8 },
    { id: 'kl', zh: '吉隆坡市中心', en: 'KL city centre', lng: 101.7020, lat: 3.1490, zoom: 13.4 },
    { id: 'klia', zh: 'KLIA 机场', en: 'KLIA', lng: 101.7072, lat: 2.7456, zoom: 13 }
  ];

  /* id, mode, category, precision, lat, lng, name (zh), name (en), note (zh), note (en), rating (0–5), price (RM) */
  var SAMPLES = [
    ['s-jalan-alor', 'food', 'street', 'area', 3.1456, 101.7088, '亚罗街', 'Jalan Alor', 'KL 最出名的夜市美食街，晚上才热闹。', 'KL’s best-known food street. It comes alive after dark.', 4, 25],
    ['s-petaling', 'food', 'cn', 'area', 3.1435, 101.6977, '茨厂街', 'Petaling Street', '吉隆坡唐人街，小吃和老字号集中在这一片。', 'KL Chinatown, with snacks and old-school shops packed together.', 3, 18],
    ['s-jonker', 'food', 'street', 'area', 2.1955, 102.2475, '鸡场街', 'Jonker Street', '马六甲的周末夜市，周五到周日晚上开。', 'Melaka’s weekend night market, open Friday to Sunday evenings.', 4, 20],
    ['s-gurney', 'food', 'street', 'area', 5.4378, 100.3100, '新关仔角小贩中心', 'Gurney Drive Hawker Centre', '槟城海边的小贩中心，傍晚过去吹海风。', 'A seaside hawker centre in Penang. Go around sunset.', 5, 22],
    ['s-kelingking', 'travel', 'island', 'exact', -8.7505, 115.4740, '克灵金海滩', 'Kelingking Beach', 'Nusa Penida 最有名的观景崖，下到沙滩的路很陡，穿运动鞋。', 'The famous cliff viewpoint on Nusa Penida. The path down is steep, so wear proper shoes.', 5, 150],
    ['s-crystal-bay', 'travel', 'island', 'exact', -8.7153, 115.4590, '水晶湾', 'Crystal Bay', 'Nusa Penida 西边的海湾，浮潜和看日落。', 'A bay on the west side of Nusa Penida for snorkelling and sunsets.', 4, 120],
    ['s-ubud', 'travel', 'culture', 'area', -8.5069, 115.2625, '乌布', 'Ubud', '梯田、猴林和艺术市场都在附近，适合住两晚。', 'Rice terraces, the Monkey Forest and art markets are all nearby. Worth two nights.', 5, 300],
    ['s-uluwatu', 'travel', 'culture', 'exact', -8.8291, 115.0849, '情人崖神庙', 'Uluwatu Temple', '悬崖上的海神庙，傍晚有 Kecak 火舞。', 'A cliff-top sea temple with a Kecak dance at sunset.', 4, 80],
    ['s-seminyak', 'travel', 'island', 'area', -8.6913, 115.1563, '水明漾', 'Seminyak', '海滩酒吧和餐厅多，适合看日落。', 'Beach clubs and restaurants, good for sunsets.', 3, 250],
    ['s-tanah-lot', 'travel', 'culture', 'exact', -8.6212, 115.0868, '海神庙', 'Tanah Lot', '建在海边礁石上的神庙，涨潮时走不过去。', 'A temple on a rock in the sea. You can’t walk over at high tide.', 3, 60],
    ['s-georgetown', 'travel', 'culture', 'city', 5.4141, 100.3288, '乔治市', 'George Town', '壁画街和老店屋，核心区走路就能逛完。', 'Street murals and old shophouses. The core area is walkable.', 5, 200],
    ['s-cenang', 'travel', 'island', 'area', 6.2930, 99.7275, '珍南海滩', 'Pantai Cenang', '兰卡威吃住最方便的一片，免税岛。', 'The easiest base on Langkawi, a duty-free island.', 4, 400],
    ['s-melaka', 'travel', 'culture', 'city', 2.1945, 102.2490, '马六甲', 'Melaka', '红屋、圣保罗山、鸡场街，一天能走完。', 'The Red Square, St. Paul’s Hill and Jonker Street fit into one day.', 4, 150],
    ['s-cameron', 'travel', 'nature', 'area', 4.4718, 101.3768, '金马伦高原', 'Cameron Highlands', '凉快，茶园和草莓园，山路弯多容易晕车。', 'Cool weather, tea estates and strawberry farms. The winding road can make you carsick.', 3, 250],
    ['s-batu-caves', 'travel', 'culture', 'exact', 3.2379, 101.6840, '黑风洞', 'Batu Caves', '272 级彩虹台阶，进去要遮住膝盖。', '272 rainbow steps. Cover your knees to go in.', 4, 20],
    ['s-bukit-bintang', 'travel', 'mall', 'area', 3.1466, 101.7108, '武吉免登', 'Bukit Bintang', 'KL 的商场和步行街一带。', 'KL’s shopping district.', 3, 100],
    ['s-ioi', 'travel', 'mall', 'exact', 2.9701, 101.7149, 'IOI 城市广场', 'IOI City Mall', '大型商场，有全马最大的溜冰场。', 'A huge mall with Malaysia’s largest ice rink.', 4, 50],
    ['s-putra-mosque', 'travel', 'culture', 'exact', 2.9360, 101.6897, '粉红清真寺', 'Putra Mosque', '布城湖边的粉色清真寺，非穆斯林可在开放时间参观，现场借长袍。', 'The pink mosque by Putrajaya Lake. Non-Muslims can visit during opening hours; robes are provided.', 4, null],
    ['s-singapore', 'travel', 'city', 'city', 1.2903, 103.8520, '新加坡', 'Singapore', '从 KL 坐巴士大概 5–6 小时。', 'About 5–6 hours from KL by bus.', 5, 600],
    ['s-bangkok', 'travel', 'city', 'city', 13.7563, 100.5018, '曼谷', 'Bangkok', '大皇宫、夜市、泰式按摩。', 'The Grand Palace, night markets and Thai massage.', 4, 1200],
    ['s-gulangyu', 'travel', 'culture', 'area', 24.4472, 118.0662, '鼓浪屿', 'Gulangyu', '厦门的鼓浪屿，船票要提前买。', 'Xiamen’s Gulangyu island. Buy ferry tickets ahead.', 5, 300],
    ['s-xmu', 'travel', 'culture', 'area', 24.4370, 118.0960, '厦门大学思明校区', 'Xiamen University (Siming)', '厦大本部，挨着南普陀寺。', 'XMU’s main campus, next to Nanputuo Temple.', 5, null],
    ['s-tokyo', 'travel', 'city', 'city', 35.6762, 139.6503, '东京', 'Tokyo', '城市级标记：只记下去过这座城市。', 'City-level pin: it only records that you’ve been to the city.', 5, 3500],
    ['s-sf', 'travel', 'city', 'city', 37.7749, -122.4194, '旧金山', 'San Francisco', '城市级标记，放大到湾区能看到它覆盖的范围。', 'City-level pin. Zoom into the Bay Area to see the area it covers.', 4, 5000],
    ['s-golden-gate', 'travel', 'culture', 'exact', 37.8199, -122.4783, '金门大桥', 'Golden Gate Bridge', '具体地点标记，可以一直放大到桥上。', 'An exact pin. You can zoom all the way onto the bridge.', 5, null],
    /* 下面这些是加出来看效果的示例，名字和评分都是编的 */
    ['s-nl-gate', 'food', 'malay', 'exact', 2.8350, 101.7045, '校门口椰浆饭', 'Nasi Lemak by the Gate', '参巴酱够辣，早上七点就开。', 'Proper spicy sambal. Opens at 7am.', 5, 6],
    ['s-dorm-tea', 'food', 'cafe', 'exact', 2.8318, 101.7012, '宿舍楼下奶茶', 'Dorm Bubble Tea', '珍珠还行，糖可以选三分。', 'Decent pearls; you can ask for 30% sugar.', 3, 9],
    ['s-ckt', 'food', 'cn', 'exact', 2.8371, 101.7060, '学生街炒粿条', 'Student Street Char Kuey Teow', '镬气足，加蛋加虾 RM2。', 'Great wok hei. Egg and prawn add RM2.', 4, 10],
    ['s-mamak24', 'food', 'mamak', 'exact', 2.8302, 101.7071, '24 小时嘛嘛档', '24h Mamak', '半夜赶作业的去处，Milo 冰很大杯。', 'Where everyone ends up at 2am. Huge Milo ais.', 4, 8],
    ['s-kfc-kr', 'food', 'kr', 'exact', 2.8389, 101.7021, '韩式炸鸡', 'Korean Fried Chicken', '甜辣酱的好吃，原味偏干。', 'Get the yangnyeom; the plain one is dry.', 3, 22],
    ['s-cendol', 'food', 'sweet', 'exact', 2.8339, 101.7090, '煎蕊摊', 'Cendol Stall', '下午三点去，椰糖给得很足。', 'Go around 3pm. Generous gula melaka.', 5, 5],
    ['s-roti', 'food', 'mamak', 'exact', 2.8285, 101.7039, '早餐印度煎饼', 'Breakfast Roti Canai', '咖喱汁可以免费续。', 'Free curry refills.', 4, 4],
    ['s-wantan', 'food', 'cn', 'exact', 2.8360, 101.6990, '干捞云吞面', 'Dry Wantan Mee', '叉烧偏甜，面很弹。', 'Sweet char siu, springy noodles.', 3, 9],
    ['s-burger', 'food', 'west', 'exact', 2.8312, 101.7102, '路边汉堡车', 'Roadside Burger Truck', '晚上八点后才出摊，Ramly 汉堡经典款。', 'Shows up after 8pm. Classic Ramly burger.', 4, 7],
    ['s-pasar', 'food', 'street', 'area', 2.8405, 101.7055, '周三夜市', 'Wednesday Pasar Malam', '每周三傍晚，烤鸡翅和炸香蕉必买。', 'Every Wednesday evening. Get the chicken wings and pisang goreng.', 5, 12],
    ['s-mixed-rice', 'food', 'cn', 'exact', 2.8327, 101.6975, '经济饭', 'Economy Rice', '菜多但有点咸，便宜。', 'Lots of dishes, a bit salty, cheap.', 2, 7],
    ['s-bkt', 'food', 'cn', 'exact', 2.8148, 101.7310, '沙叻丁宜肉骨茶', 'Salak Tinggi Bak Kut Teh', '药材味重，周末早上要排队。', 'Strong herbal soup. Queues on weekend mornings.', 4, 20],
    ['s-kopitiam', 'food', 'cafe', 'exact', 2.8195, 101.7262, '老式咖啡店', 'Old Kopitiam', '白咖啡加烤面包配半生熟蛋。', 'White coffee, kaya toast and half-boiled eggs.', 4, 8],
    ['s-kandar', 'food', 'mamak', 'exact', 2.8120, 101.7355, '印度扁担饭', 'Nasi Kandar', '咖喱混着淋，鸡腿很大。', 'Ask for mixed curry. Big chicken legs.', 3, 14],
    ['s-sushi', 'food', 'jp', 'exact', 2.8230, 101.7380, '回转寿司', 'Conveyor Sushi', '一般般，图个方便。', 'Average, but convenient.', 2, 30],
    ['s-satay', 'food', 'malay', 'exact', 2.8001, 101.7220, '沙爹档', 'Satay Stall', '牛肉沙爹最好，花生酱是现煮的。', 'Beef satay is best; the peanut sauce is fresh.', 5, 15],
    ['s-hotpot', 'food', 'cn', 'exact', 2.9230, 101.6530, '赛城火锅', 'Cyberjaya Hotpot', '人多一起去划算，番茄锅底好喝。', 'Good value in a group. Try the tomato broth.', 4, 45],
    ['s-dpulze-cafe', 'food', 'cafe', 'exact', 2.9238, 101.6612, '赛城咖啡馆', 'Cyberjaya Café', '适合坐一下午写作业，插座多。', 'Good for an afternoon of work, plenty of sockets.', 4, 18],
    ['s-ramen', 'food', 'jp', 'exact', 2.9190, 101.6580, '豚骨拉面', 'Tonkotsu Ramen', '汤很浓，叉烧薄了点。', 'Rich broth, thin chashu.', 3, 32],
    ['s-steak', 'food', 'west', 'exact', 2.9265, 101.6505, '牛排馆', 'Steakhouse', '生日聚餐可以来，有点贵。', 'Nice for birthdays, a bit pricey.', 4, 70],
    ['s-lake-seafood', 'food', 'malay', 'exact', 2.9420, 101.6880, '布城湖边海鲜', 'Putrajaya Lakeside Seafood', '风景好，菜一般，等很久。', 'Great view, average food, slow service.', 1, 40],
    ['s-fishhead', 'food', 'cn', 'exact', 2.8650, 101.6780, '鱼头米粉', 'Fish Head Bee Hoon', '汤底加了奶，偏腥。', 'Milky broth, a bit fishy.', 1, 13],
    ['s-nyonya', 'food', 'malay', 'exact', 2.9600, 101.7700, '万宜娘惹菜', 'Bangi Nyonya Kitchen', '亚参鱼和黑果鸡都好吃。', 'Great asam fish and ayam buah keluak.', 5, 28],
    ['s-ioi-dessert', 'food', 'sweet', 'exact', 2.9705, 101.7150, '雪花冰', 'Bingsu Café', '芒果雪花冰两个人吃刚好。', 'One mango bingsu is right for two.', 4, 20],
    ['s-ioi-bbq', 'food', 'bbq', 'exact', 2.9695, 101.7160, '韩国烤肉', 'Korean BBQ', '自助两小时，肉质普通。', 'Two-hour buffet, ordinary meat.', 2, 55],
    ['s-bagan', 'food', 'malay', 'area', 2.6060, 101.6970, '海边海鲜一条街', 'Seaside Seafood Strip', '周末开车去吃螃蟹，记得问价。', 'Weekend crab trip. Ask the price first.', 3, 60],
    ['s-chachaan', 'food', 'cn', 'exact', 3.1470, 101.7000, '港式茶餐厅', 'HK-style Cha Chaan Teng', '菠萝包和丝袜奶茶。', 'Pineapple buns and milk tea.', 4, 20],
    ['s-bangsar', 'food', 'cafe', 'exact', 3.1300, 101.6710, '孟沙早午餐', 'Bangsar Brunch', '拍照好看，分量小。', 'Pretty, small portions.', 3, 45],
    ['s-midvalley-jp', 'food', 'jp', 'exact', 3.1180, 101.6770, '谷中城日料', 'Mid Valley Japanese', '鳗鱼饭值得。', 'The unagi don is worth it.', 5, 50],
    ['s-klang-bkt', 'food', 'cn', 'exact', 3.0440, 101.4450, '巴生肉骨茶', 'Klang Bak Kut Teh', '肉骨茶的老家，干的湿的都试试。', 'The home of bak kut teh. Try both dry and soup.', 5, 25],
    ['s-ttdi-market', 'food', 'street', 'area', 3.1400, 101.6300, '敦依斯迈夜市', 'TTDI Night Market', '摊位多，停车难。', 'Lots of stalls, hard to park.', 3, 15],
    ['s-pelita', 'food', 'mamak', 'exact', 3.1580, 101.7140, '双峰塔旁嘛嘛', 'Mamak near KLCC', '看完双子塔来吃宵夜。', 'Supper after the Twin Towers.', 3, 18],
    ['s-seremban', 'food', 'cn', 'exact', 2.7250, 101.9400, '芙蓉烧包', 'Seremban Siew Pau', '买一盒带回宿舍。', 'Take a box back to the dorm.', 4, 15],
    ['s-ipoh-chicken', 'food', 'cn', 'exact', 4.5975, 101.0901, '怡保芽菜鸡', 'Ipoh Bean Sprout Chicken', '芽菜又短又脆，鸡很滑。', 'Short crunchy sprouts, silky chicken.', 5, 25],
    ['s-penang-ckt', 'food', 'cn', 'exact', 5.4140, 100.3300, '槟城炒粿条', 'Penang Char Kuey Teow', '戴帽子的阿姨那摊，排一小时。', 'The auntie in the hat. One-hour queue.', 5, 15],
    ['s-penang-cendol', 'food', 'sweet', 'exact', 5.4170, 100.3360, '槟城煎蕊', 'Penang Road Cendol', '名气大，味道普通。', 'Famous, but just okay.', 2, 6],
    ['s-chicken-rice-ball', 'food', 'cn', 'exact', 2.1960, 102.2460, '马六甲鸡饭粒', 'Melaka Chicken Rice Balls', '游客多，饭粒有点硬。', 'Touristy, and the rice balls are a bit hard.', 0, 18],
    ['s-twin-towers', 'travel', 'city', 'exact', 3.1579, 101.7116, '双子塔', 'Petronas Twin Towers', '晚上的喷泉秀免费。', 'The evening fountain show is free.', 4, 0],
    ['s-botanical', 'travel', 'nature', 'exact', 2.9440, 101.6740, '布城植物园', 'Putrajaya Botanical Garden', '租自行车绕一圈，早上去不晒。', 'Rent a bike and go in the morning.', 3, 10],
    ['s-genting', 'travel', 'fun', 'area', 3.4236, 101.7932, '云顶高原', 'Genting Highlands', '坐缆车上山，带外套。', 'Take the cable car up and bring a jacket.', 4, 200],
    ['s-pd', 'travel', 'island', 'area', 2.5220, 101.7960, '波德申', 'Port Dickson', '离学校最近的海边，水一般。', 'The nearest beach to campus. Water is so-so.', 2, 80],
    ['s-redang', 'travel', 'island', 'area', 5.7800, 103.0100, '热浪岛', 'Redang Island', '水超清，雨季（11–2 月）别去。', 'Crystal-clear water. Avoid the Nov–Feb monsoon.', 5, 800],
    ['s-semporna', 'travel', 'island', 'area', 4.4790, 118.6110, '仙本那', 'Semporna', '跳岛浮潜，要从亚庇转机。', 'Island hopping and snorkelling. Fly via Kota Kinabalu.', 5, 1500],
    ['s-kinabalu', 'travel', 'nature', 'exact', 6.0750, 116.5580, '神山', 'Mount Kinabalu', '登顶要提前订山屋。', 'Book the mountain hut early if you want to summit.', 5, 1200],
    ['s-chiangmai', 'travel', 'city', 'city', 18.7883, 98.9853, '清迈', 'Chiang Mai', '古城、寺庙和夜市，消费低。', 'Old city, temples and night markets. Cheap.', 4, 1000],
    ['s-hanoi', 'travel', 'city', 'city', 21.0278, 105.8342, '河内', 'Hanoi', '还剑湖附近住，摩托车超多。', 'Stay near Hoan Kiem Lake. So many scooters.', 3, 1100],
    ['s-seoul', 'travel', 'city', 'city', 37.5665, 126.9780, '首尔', 'Seoul', '地铁很方便，冬天很冷。', 'Easy subway, freezing winters.', 4, 3000],
    ['s-zengcuoan', 'travel', 'culture', 'area', 24.4340, 118.1260, '曾厝垵', 'Zengcuo’an', '厦门的文艺小渔村，晚上很挤。', 'A former fishing village in Xiamen, packed at night.', 3, 100]
  ];

  var I18N = {
    zh: {
      tagline: '中国有美团，雪邦有雪团',
      foodAria: '吃：美食地图', travelAria: '玩：玩乐地图',
      food: '美食', travel: '玩乐', scenery: '玩乐',
      catAll: '全部',
      scoreAria: '{n} 分', legend: '评分',
      dist_walk: '步行 · 校园周边', dist_short: '短途打车 · 6km 内', dist_mid: '中距离 · 龙溪 / IOI', dist_kl: '吉隆坡', dist_far: '出吉隆坡',
      tier_walk: '步行可达', tier_short: '短途打车', tier_mid: '中距离打车', tier_kl: '吉隆坡', tier_far: '吉隆坡以外',
      feedFoodAll: '大家最近在吃', feedTravelAll: '大家最近去了', feedFoodMine: '我吃过的', feedTravelMine: '我去过的', feedBothMine: '我的足迹',
      mine_food: '美食', mine_travel: '玩乐', mine_both: '全部', savedAll: '全部', savedWant: '还没去过', mineShow: '显示', subBeen: '去过', subSaved: '想去', savedShow: '想去里', filterCat: '分类',
      modeToTravel: '切换到玩乐地图', modeToFood: '切换到美食地图', litCountries: '点亮国家', litN: '已去 {n} 国', worldFail: '国家边界没加载出来，等下再试',
      feedSavedFood: '想去吃的', feedSavedTravel: '想去的地方', placesFoodAll: '探索美食', placesTravelAll: '探索玩乐', exploreHint: '点地图上的图钉看大家的评价；大家最近分享了什么在“首页”。',
      emptySaved: '还没有收藏的地方，点“收藏”就会出现在这里。', emptyWant: '收藏的地方都去过了。', goExplore: '去探索',
      wish: '收藏', wished: '已收藏', wishAdded: '收藏了，点击星星就能找到', wishRemoved: '取消收藏了',
      emptyFoodAll: '这片还没人写过。',
      emptyTravelAll: '还没人分享去处。',
      emptyMine: '还没记录过地方。', emptyFiltered: '没有符合筛选的地方。', clearFilters: '清除筛选',
      addFood: '加一家店', addTravel: '打卡一个地方', fabFood: '加一家', fabTravel: '打卡',
      pickHintFood: '拖动地图，让针尖对准店门口', pickHintTravel: '拖动地图对准位置。只标城市的话，缩小一点再确认',
      pickPrecision: '会标成：{p}', confirmSpot: '就是这里', cancel: '取消', back: '返回', close: '关闭',
      nearbyTitle: '附近已经有这些，是同一个地方吗？', nearbyThis: '是这家', nearbyNone: '都不是，新建一个',
      formNewFood: '加一家店', formNewTravel: '打卡新地方', formReview: '写点评', formEdit: '编辑记录',
      name: '名称（选填）', namePhFood: '用大家平时叫的名字', namePhTravel: '比如：Nusa Penida',
      altName: '原名 / 英文名', altNamePh: '招牌上的英文或马来文名字',
      category: '分类（选填）', precision: '标到哪一级',
      precExact: '具体地点', precArea: '一片区域', precCity: '整个城市',
      precHint: '吃饭的店标到门口；玩乐可以只标城市，放大时会显示成一个范围。',
      catGuessing: '正在看照片认是哪一类…', catGuessed: '看照片像「{c}」，不对就点别的', catByName: '按店名选了「{c}」，不对就点别的', catByGoogle: '按谷歌上的店铺类型选了「{c}」，不对就点别的', catNoGuess: '照片没认出来', optional: '选填', rating: '评分', ratingHint: '点或左右拖星星，可以打半颗；拖到最左是 0 分（踩雷）。', errRating: '打个分再发布', starsNone: '还没打分',
      priceFood: '人均（{c}，选填）',
      review: '评论（选填）', reviewPhFood: '写评论', reviewPhTravel: '写评论',
      photos: '照片（选填）', photoLimit: '最多 {n} 张 · 按住拖动排序，第一张是封面', addPhoto: '加照片', photoReadFail: '这张图读不了，换一张试试',
      visPrivateShort: '仅自己',
      shareBig: '分享到大地图', shareHint: '不分享也会存进“足迹”', formMore: '更多：精度、原名、链接',
      unnamedFood: '未知', unnamedTravel: '未知',
      bulkBtn: '从照片批量加', bulkTitle: '从照片批量加', bulkReading: '正在读照片 {n}/{m}…',
      bulkSum: '{n} 张照片，分成 {g} 组，打了分的才保存。', bulkNoGps: '{n} 张读不到位置，按拍摄时间分了组，自己搜店名。',
      bulkTip: '位置多半是手机交给网页时去掉的，从文件管理里选（DCIM → Camera）也许能读到。', bulkFiles: '从文件管理选',
      bulkFindPh: '搜谷歌：店名或地点', bulkFromPhoto: '离拍照处 {d}', bulkPrice: '人均 {c}', footTaken: '拍摄时间', footTakenAt: '拍于 {t}', bulkMerge: '和上一组是同一个地方', gifTooBig: '动图超过 5MB，请压缩动图后重试；不会转成静图', clipLong: '视频要在 {n} 秒以内', clipBig: '视频不能超过 30MB，请剪短或压缩后重试', clipRead: '这个视频读不了', clipBusy: '视频处理中…', bulkModeLabel: '记到美食还是玩乐', bulkNoLoc: '没有位置', bulkNeed: '搜到地点才能保存', bulkNoMatch: '没搜到，换个写法试试', bulkFinding: '正在搜…',
      bulkNone: '选的照片里都没有拍摄地点。相机设置里打开“地理位置”，以后拍的就有了。',
      bulkSave: '保存 {n}', bulkSaving: '保存中 {n}/{m}', bulkDone: '存进足迹 {n} 个', bulkFailSome: '{n} 个没存上，过会儿再试',
      bulkPhotos: '{n} 张', bulkLooking: '正在找附近的店…', bulkOwn: '自己写', bulkBeen: '记过',
      bulkLeaveQ: '打了分的还没保存，确定离开？', bulkLeave: '离开', bulkPhotoMax: '每个地方最多 {n} 张',
      bulkLoadFail: '读照片的工具没加载出来，检查网络后再试。',
      link: '相关链接', linkPh: '官网、订位、门票页面…',
      nickname: '昵称', nicknamePh: '大家看到的名字',
      testAccounts: '测试账号（仅供测试）', testAccountsHint: '同一台手机上换着当不同的人：每个号的记录、收藏、家都分开，私密的只有自己看得到。',
      acctAdd: '＋ 再加一个', acctSwitched: '现在是：{n}', acctUnnamed: '没起名的号', acctDefault: '测试号 {c}',
      myHome: '我的家', homeNone: '设了以后足迹地图上有个小房子，公开后大地图上是一根红针。只到城市一级。', homeSet: '设置我的家', homeChange: '改', homeRemove: '不设了',
      homePublic: '公开到大地图', homePublicOn: '同学在玩乐大地图上能看到，列表里显示“来自 {c}”', homePublicOff: '现在只有你自己看得到（足迹 · 玩乐）',
      homeTitle: '设置我的家', homeSearchPh: '搜城市，比如 吉隆坡、深圳', homePick: '在地图上点', homeNote: '只存城市名和大概位置（约 10 公里），不存地址。',
      homeNoResult: '没找到这个城市，换个写法，或者在地图上点', homeSaved: '设好了：{c}', homeRemoved: '不设家了', homeLookup: '正在认是哪个城市…',
      homePickHint: '拖动地图，把十字对准你家所在的城市', homePickFail: '认不出这是哪个城市，换个位置，或者直接搜城市名',
      homesBtn: '看看大家来自哪', homesOpened: '红点是同学们的家乡', homesClosed: '已回到探索', saveWorking: '正在保存…', saveUploading: '正在上传照片 {n}/{m}', saveWriting: '正在保存记录…', mediaPreparing: '正在处理照片…', photoPreview: '放大查看照片', homeOf: '{n}的家乡', homesN: '{n} 位同学的家乡', homeOnlyYou: '只有你自己看得到', homeEdit: '改我的家', homeSetCta: '你也标上家乡',
      publish: '发布',
      location: '位置', repick: '重新选',
      noRating: '暂无评分', myScore: '我的评分', avgOf: '{n} 次评分的平均', avgNoZero: '（不算 {n} 个 0 分）', perPerson: '人均', costLabel: '花费', reviewsLabel: '条点评', reviewsTitle: '点评',
      navGoogle: 'Google 地图', navApple: '苹果地图', viewApple: '在苹果地图看', navWaze: 'Waze', viewGoogle: '在 Google 地图看', copyCoords: '复制坐标',
      copied: '坐标已复制', copyFail: '复制不了，坐标是 {c}', openLink: '相关链接',
      distFrom: '距 XMUM {d}',
      writeReview: '写点评', beenHere: '我也去过',
      sample: '示例', sampleAuthor: '示例同学', samplesShown: '现在混着示例数据，自己加的不会被清掉。',
      clearSamples: '清空示例', clearSamplesQ: '删掉所有示例地点和点评？你自己加的不会动。', clearSamplesOk: '清空', samplesCleared: '示例已清空',
      you: '我', anon: '某同学', fromPrefix: '来自 ',
      del: '删除', delReviewQ: '删除这条点评？', delOk: '删除', deleted: '已删除',
      edit: '编辑', saveEdit: '保存修改', updated: '改好了',
      login: '登录', loginTitle: '登录雪团', loginWhy: '无需登录也能添加地点、写点评和收藏。匿名使用后，可在“我的”绑定账号，换设备仍能找回记录。',
      loginGoogle: '用 Google 登录', loginOr: '或者用邮箱（Outlook、QQ 邮箱都行）', loginEmailGuest: '或者用邮箱登录（游客记录不会合并）', loginEmailPh: '你的邮箱', loginSend: '发验证码',
      loginSent: '验证码发到 {e} 了（可能在垃圾邮件里），在下面输入；也可以直接点邮件里的链接。', loginCodePh: '邮件里的验证码', loginVerify: '登录', loginCodeBad: '验证码不对或过期了，再试一次或重新发', loginResend: '重新发', loginFail: '没成功：{m}', loginFirst: '先登录一下', anonName: '雪团用户{n}', anonReady: '已经给你分配了一个号，可以直接记了', anonTapAgain: '号分配好了，再点一下',
      anonWhy: '你正在使用匿名账号，可以添加、点评和收藏。身份保存在当前浏览器；清除浏览器数据或换设备前，请绑定谷歌账号，以便找回记录。', anonFail: '匿名账号暂时创建失败，请检查网络后重试，无需先登录。', linkGoogle: '绑定谷歌账号',
      loggedIn: '登录了', loggedOut: '已退出登录', logout: '退出登录', account: '账号', signedInAs: '已登录：{e}',
      privacyLink: '隐私政策',
      remoteNote: '记录保存在雪团服务器上；匿名账号绑定后，才能在换设备时找回。公开记录大家可见，私密记录只有自己可见。',
      uploadLocal: '上传这台设备上的旧记录', uploadLocalQ: '把这个浏览器里以前存的记录（不含示例）上传到你的账号？', uploadLocalOk: '上传',
      uploadedLocal: '上传了 {n} 个地点', loadFail: '数据没加载出来，检查网络后刷新页面。',
      profile: '我的资料', hometown: '来自哪', country: '国家 / 地区', region: '省 / 州', city: '城市', district: '区 / 县',
      countryPh: '中国、马来西亚、哈萨克斯坦…', regionPh: '广东、Selangor…', cityPh: '深圳、Klang…', districtPh: '南山、Sepang…',
      language: '语言', basemap: '底图', styleLight: '简洁', styleColor: '彩色', styleDark: '深色',
      basemapNow: '底图：{s}', basemapFail: '这个底图加载不了，先用别的',
      areas: '常去的地方', saveArea: '存当前位置', areaName: '给这片起个名', areaNamePh: '比如：商业街', save: '保存', areaSaved: '存好了',
      noCustomAreas: '还没存过。把地图挪到常去的地方，点“存当前位置”。',
      dataTitle: '数据', exportData: '导出备份', importData: '导入备份', imported: '导入了 {n} 个地点', importFail: '这个文件读不了',
      localNote: '现在是本地版：数据只存在这个浏览器里，换设备或清浏览器数据就没了，记得导出备份。上线后会改成大家共用的数据库。',
      about: '地图数据 © OpenStreetMap 贡献者，底图来自 OpenFreeMap。',
      searchBtn: '搜索', searchPh: '搜店名、地名', mapSearchPh: '搜索餐厅、地点…', footprintShow: '足迹类型', noResults: '没找到。可以自己加上去。',
      addSearchPhFood: '输入店名搜索', addSearchPhTravel: '输入地名搜索', addPin: '地图选点',
      addPinLong: '在地图上选点', addHint: '先搜名字。学校附近的小店搜不到的话，点“地图选点”自己标。',
      addNoResult: '地图上没搜到这个名字。',
      poiFood: '餐厅', poiPlace: '地点', quickRate: '去过？打个分就记进足迹', quickRateFood: '吃过？打个分就记进足迹', quickRateHint: '下一步还能写评论、加照片，都是选填。',
      searchLocal: '雪团里的', searchOsm: '地图上的地点', searchGoogle: '谷歌地图上的', googleLoading: '正在连接谷歌…', googleSearching: '正在搜索谷歌…', bulkOtherPlace: '搜索其他地点', googleEmpty: '谷歌没有找到这个地点，试试店名加城市。', googleUnavailable: '谷歌暂时连接不上，可尝试下方地点搜索或重试。', googleSlow: '谷歌响应较慢，仍在等待结果；也可以重试。', googleAuth: '此网站的谷歌搜索暂未获授权，其他搜索仍可用。', googleLimit: '本设备今天的谷歌搜索已达 60 次，明天恢复。', googleOff: '此链接已关闭谷歌搜索。', googleRetry: '重试谷歌', googleOpen: '去 Google 地图搜', osmMin: '再多打一个字，就会去地图上搜', osmLoading: '正在搜…', osmMore: '还在找更多…',
      osmFail: '地图搜索暂时用不了，可以自己插针添加', osmCredit: '地点数据：Overture Maps Foundation · © OpenStreetMap 贡献者（Photon）· 维基百科', osmAdd: '添加', osmOpen: '已在雪团',
      addedMine: '已存进足迹', addedShared: '已存进足迹，也分享到了大地图',
      locating: '正在定位…', locateFail: '定位失败，检查一下浏览器的定位权限',
      photoFail: '有照片没存上，刷新后会丢', saveFail: '浏览器不让存数据，关掉页面就没了',
      mapFail: '地图没加载出来。检查网络后刷新页面。',
      justNow: '刚刚', minAgo: '{n} 分钟前', hourAgo: '{n} 小时前', dayAgo: '{n} 天前',
      locate: '我的位置', toCampus: '回到 XMUM',
      tabsAria: '主菜单', tabAdd: '记一笔', tabHome: '首页', tabExplore: '探索', tabFoot: '足迹', tabMe: '我的',
      latest: '最新分享', latestEmpty: '还没有人分享。记下吃过、去过的地方，打开“分享到大地图”，就会出现在这里。', goRecord: '去记录',
      openMap: '探索地图', postPlace: '在地图上看', placeEmpty: '还没有人记录过这里。',
      meBeen: '去过', meWant: '收藏', meShared: '分享', meNoName: '还没起昵称', meNoHome: '还没设家乡', meGuest: '还没登录',
      filterBtn: '筛选', filtersTitle: '筛选', filterScore: '评分', filterDist: '离学校多远', filterPrice: '人均价位', anyOpt: '不限',
      scoreOpt: '{n} 分以上', priceAbout: 'RM{n} 左右', filterReset: '重置', filterShow: '看 {n} 个地方',
      areasTitle: '去哪儿看', locWorld: '全球', locHere: '这附近', saveHere: '记住现在这片'
    },
    en: {
      tagline: 'A food & travel map by XMUM students',
      foodAria: 'Food map', travelAria: 'Things to do map',
      food: 'Food', travel: 'Things to do', scenery: 'Things to do',
      catAll: 'All',
      scoreAria: 'Score {n}', legend: 'Score',
      dist_walk: 'Walk · around campus', dist_short: 'Short ride · within 6 km', dist_mid: 'Mid ride · Dengkil / IOI', dist_kl: 'Kuala Lumpur', dist_far: 'Beyond KL',
      tier_walk: 'Walkable', tier_short: 'Short ride', tier_mid: 'Mid ride', tier_kl: 'Kuala Lumpur', tier_far: 'Beyond KL',
      feedFoodAll: 'What people are eating', feedTravelAll: 'Where people went', feedFoodMine: 'Places I’ve eaten', feedTravelMine: 'Places I’ve been', feedBothMine: 'My footprints',
      mine_food: 'Food', mine_travel: 'Things to do', mine_both: 'All', savedAll: 'All', savedWant: 'Not been yet', mineShow: 'Show', subBeen: 'Been', subSaved: 'Wishlist', savedShow: 'Wishlist', filterCat: 'Category',
      modeToTravel: 'Switch to things to do', modeToFood: 'Switch to the food map', litCountries: 'Countries', litN: '{n} visited', worldFail: 'Couldn’t load country borders. Try again later.',
      feedSavedFood: 'Food spots I saved', feedSavedTravel: 'Places I saved', placesFoodAll: 'Explore food', placesTravelAll: 'Explore things to do', exploreHint: 'Tap a pin to see what people said. Recent posts are on Home.',
      emptySaved: 'No saved places yet. Tap “Save” to keep places here.', emptyWant: 'You’ve been to every place you saved.', goExplore: 'Explore',
      wish: 'Save', wished: 'Saved', wishAdded: 'Saved. Find it under Footprints · Wishlist', wishRemoved: 'Removed from saved',
      emptyFoodAll: 'Nobody has written about this area yet.',
      emptyTravelAll: 'No places shared yet.',
      emptyMine: 'You haven’t recorded any places yet.', emptyFiltered: 'Nothing matches these filters.', clearFilters: 'Clear filters',
      addFood: 'Add a food spot', addTravel: 'Pin a place', fabFood: 'Add spot', fabTravel: 'Pin a place',
      pickHintFood: 'Drag the map until the pin points at the entrance', pickHintTravel: 'Drag the map to the spot. For a whole city, zoom out before confirming',
      pickPrecision: 'Will be saved as: {p}', confirmSpot: 'Use this spot', cancel: 'Cancel', back: 'Back', close: 'Close',
      nearbyTitle: 'These are already nearby. Same place?', nearbyThis: 'That’s it', nearbyNone: 'None of these, create new',
      formNewFood: 'Add a food spot', formNewTravel: 'Pin a new place', formReview: 'Write a review', formEdit: 'Edit entry',
      name: 'Name (optional)', namePhFood: 'The name people actually use', namePhTravel: 'e.g. Nusa Penida',
      altName: 'Original / other name', altNamePh: 'The name on the signboard',
      category: 'Category (optional)', precision: 'How precise',
      precExact: 'Exact spot', precArea: 'An area', precCity: 'Whole city',
      precHint: 'Pin restaurants at the door. Trips can be city-level and show as an area when zoomed in.',
      catByGoogle: 'Picked {c} from the shop type on Google. Tap another to change.', catGuessing: 'Reading the photo…', catGuessed: 'Looks like {c} from the photo. Tap another if wrong.', catByName: 'Picked {c} from the name. Tap another if wrong.', catNoGuess: 'Could not tell from the photo', optional: 'optional', rating: 'Score', ratingHint: 'Tap or drag the stars; half stars work. All the way left is 0 (avoid).', errRating: 'Give it a score first', starsNone: 'Not scored yet',
      priceFood: 'Per person ({c}, optional)',
      review: 'Review (optional)', reviewPhFood: 'Write a review', reviewPhTravel: 'Write a review',
      photos: 'Photos (optional)', photoLimit: 'up to {n} · hold and drag to reorder, first is the cover', addPhoto: 'Add photo', photoReadFail: 'Couldn’t read that image. Try another one',
      visPrivateShort: 'Private',
      shareBig: 'Share on the big map', shareHint: 'Either way it’s saved to Footprints', formMore: 'More: precision, other name, link',
      unnamedFood: 'Unknown', unnamedTravel: 'Unknown',
      bulkBtn: 'Add many from photos', bulkTitle: 'Add from photos', bulkReading: 'Reading photos {n}/{m}…',
      bulkSum: '{n} photos in {g} groups. Only scored ones are saved.', bulkNoGps: '{n} have no location, so they’re grouped by time. Search for each place.',
      bulkTip: 'Phones often strip the location when handing photos to a web page. Picking them from your file manager (DCIM → Camera) may keep it.', bulkFiles: 'Pick from files',
      bulkFindPh: 'Search Google: name or place', bulkFromPhoto: '{d} from photo', bulkPrice: '{c} / pax', footTaken: 'Photo time', footTakenAt: 'taken {t}', bulkMerge: 'Same place as the one above', gifTooBig: 'GIF exceeds 5MB. Compress the animation and retry; it will not be flattened.', clipLong: 'Videos must be {n} s or shorter', clipBig: 'Video must be 30MB or smaller. Trim or compress it and retry', clipRead: "Couldn't read this video", clipBusy: 'Processing video…', bulkModeLabel: 'Food or travel', bulkNoLoc: 'no location', bulkNeed: 'Find the place to save this one', bulkNoMatch: 'Nothing found, try another spelling', bulkFinding: 'Searching…',
      bulkNone: 'None of these photos has a location. Turn on location tags in your camera settings for new photos.',
      bulkSave: 'Save {n}', bulkSaving: 'Saving {n}/{m}', bulkDone: '{n} saved to Footprints', bulkFailSome: '{n} couldn’t be saved, try again later',
      bulkPhotos: '{n} photos', bulkLooking: 'Looking for nearby places…', bulkOwn: 'Type a name', bulkBeen: 'recorded',
      bulkLeaveQ: 'Your scores aren’t saved yet. Leave anyway?', bulkLeave: 'Leave', bulkPhotoMax: 'Up to {n} photos per place',
      bulkLoadFail: 'Couldn’t load the photo reader. Check your connection and try again.',
      link: 'Link', linkPh: 'Website, booking or ticket page',
      nickname: 'Nickname', nicknamePh: 'The name others see',
      testAccounts: 'Test accounts (testing only)', testAccountsHint: 'Take turns being different people on one phone. Each account has its own records, saves and home; private ones stay private.',
      acctAdd: '+ Add one', acctSwitched: 'Now using: {n}', acctUnnamed: 'Unnamed account', acctDefault: 'Tester {c}',
      myHome: 'My home', homeNone: 'Puts a little house on your Footprints map, and a red pin on the big map if public. City level only.', homeSet: 'Set my home', homeChange: 'Change', homeRemove: 'Remove',
      homePublic: 'Show on the big map', homePublicOn: 'Classmates see it on the things to do map, and lists say “from {c}”', homePublicOff: 'Only you can see it now (Footprints · Things to do)',
      homeTitle: 'Set my home', homeSearchPh: 'Search a city, e.g. Kuala Lumpur', homePick: 'Pick on the map', homeNote: 'Only the city name and a rough spot (about 10 km) are saved, never an address.',
      homeNoResult: 'No city found. Try another spelling or pick on the map', homeSaved: 'Home set: {c}', homeRemoved: 'Home removed', homeLookup: 'Finding the city…',
      homePickHint: 'Drag the map until the crosshair is on your home city', homePickFail: 'Couldn’t tell which city this is. Move a bit, or search the city name',
      homesBtn: 'Where everyone is from', homesOpened: 'Red pins are classmates’ hometowns', homesClosed: 'Back to explore', saveWorking: 'Saving…', saveUploading: 'Uploading photos {n}/{m}', saveWriting: 'Saving your record…', mediaPreparing: 'Preparing photos…', photoPreview: 'Enlarge photo', homeOf: '{n}’s hometown', homesN: '{n} classmates’ hometowns', homeOnlyYou: 'Only you can see this', homeEdit: 'Change my home', homeSetCta: 'Add your hometown',
      publish: 'Publish',
      location: 'Location', repick: 'Change',
      noRating: 'No score yet', myScore: 'My score', avgOf: 'Average of {n}', avgNoZero: ' ({n} zero scores left out)', perPerson: 'per person', costLabel: 'cost', reviewsLabel: 'reviews', reviewsTitle: 'Reviews',
      navGoogle: 'Google Maps', navApple: 'Apple Maps', viewApple: 'Open in Apple Maps', navWaze: 'Waze', viewGoogle: 'Open in Google Maps', copyCoords: 'Copy coordinates',
      copied: 'Coordinates copied', copyFail: 'Couldn’t copy. Coordinates: {c}', openLink: 'Link',
      distFrom: '{d} from XMUM',
      writeReview: 'Write a review', beenHere: 'I’ve been here',
      sample: 'Sample', sampleAuthor: 'Sample', samplesShown: 'Sample data is mixed in. Your own entries won’t be removed.',
      clearSamples: 'Remove samples', clearSamplesQ: 'Remove all sample places and reviews? Your own entries stay.', clearSamplesOk: 'Remove', samplesCleared: 'Samples removed',
      you: 'Me', anon: 'A student', fromPrefix: 'from ',
      del: 'Delete', delReviewQ: 'Delete this review?', delOk: 'Delete', deleted: 'Deleted',
      edit: 'Edit', saveEdit: 'Save changes', updated: 'Updated',
      login: 'Log in', loginTitle: 'Log in to XueTuan', loginWhy: 'Add places, write reviews and save spots without logging in. Link your guest account in Profile to recover your records on another device.',
      loginGoogle: 'Continue with Google', loginOr: 'or use any email (Outlook, Yahoo…)', loginEmailGuest: 'or log in with email (guest records are not merged)', loginEmailPh: 'Your email', loginSend: 'Email me a code',
      loginSent: 'Code sent to {e} (check spam). Enter it below, or tap the link in the email.', loginCodePh: 'Code from the email', loginVerify: 'Log in', loginCodeBad: 'Wrong or expired code. Try again or resend.', loginResend: 'Resend', loginFail: 'That didn’t work: {m}', loginFirst: 'Log in first', anonName: 'XueTuan user {n}', anonReady: 'You got a guest account, go ahead', anonTapAgain: 'Guest account ready, tap again',
      anonWhy: 'You can add places, review and save with this guest account. Its identity stays in this browser. Link Google before clearing browser data or switching devices to recover your records.', anonFail: 'Could not create your guest account. Check your connection and try again; no login is required.', linkGoogle: 'Link Google account',
      loggedIn: 'Logged in', loggedOut: 'Logged out', logout: 'Log out', account: 'Account', signedInAs: 'Logged in as {e}',
      privacyLink: 'Privacy policy',
      remoteNote: 'Entries are stored on XueTuan servers. Link your guest account to recover them on another device. Public entries are visible to everyone; private entries only to you.',
      uploadLocal: 'Upload old entries from this device', uploadLocalQ: 'Upload the entries saved in this browser (not the samples) to your account?', uploadLocalOk: 'Upload',
      uploadedLocal: 'Uploaded {n} places', loadFail: 'Couldn’t load the data. Check your connection and refresh.',
      profile: 'My profile', hometown: 'Where you’re from', country: 'Country / region', region: 'Province / state', city: 'City', district: 'District',
      countryPh: 'China, Malaysia, Kazakhstan…', regionPh: 'Guangdong, Selangor…', cityPh: 'Shenzhen, Klang…', districtPh: 'Nanshan, Sepang…',
      language: 'Language', basemap: 'Base map', styleLight: 'Clean', styleColor: 'Colour', styleDark: 'Dark',
      basemapNow: 'Base map: {s}', basemapFail: 'That base map didn’t load. Try another one',
      areas: 'Saved areas', saveArea: 'Save this view', areaName: 'Name this area', areaNamePh: 'e.g. the shoplots', save: 'Save', areaSaved: 'Saved',
      noCustomAreas: 'Nothing saved yet. Move the map to a place you go often and tap “Save this view”.',
      dataTitle: 'Data', exportData: 'Export backup', importData: 'Import backup', imported: 'Imported {n} places', importFail: 'Couldn’t read that file',
      localNote: 'This is the local version: data lives only in this browser and disappears if you switch devices or clear browser data. Export a backup. The online version will use a shared database.',
      about: 'Map data © OpenStreetMap contributors. Base map by OpenFreeMap.',
      searchBtn: 'Search', searchPh: 'Search places', mapSearchPh: 'Search restaurants, places…', footprintShow: 'Footprints', noResults: 'Nothing found. You can add it yourself.',
      addSearchPhFood: 'Search by name', addSearchPhTravel: 'Search a place', addPin: 'Pick on map',
      addPinLong: 'Pick on the map', addHint: 'Search by name first. If a small stall doesn’t show up, use “Pick on map”.',
      addNoResult: 'Nothing on the map with that name.',
      poiFood: 'Restaurant', poiPlace: 'Place', quickRate: 'Been here? Score it to add it to Footprints', quickRateFood: 'Eaten here? Score it to add it to Footprints', quickRateHint: 'Photos and notes are optional on the next step.',
      searchLocal: 'On XueTuan', searchOsm: 'Places on the map', searchGoogle: 'On Google Maps', googleLoading: 'Connecting to Google…', googleSearching: 'Searching Google…', bulkOtherPlace: 'Search another place', googleEmpty: 'No Google results. Try the place name and city.', googleUnavailable: 'Google is unavailable. Try place search below or retry.', googleSlow: 'Google is slow. Still waiting for results; you can also retry.', googleAuth: 'Google search is not authorized for this site. Other search still works.', googleLimit: 'This device has used its 60 Google searches today. Resets tomorrow.', googleOff: 'Google search is disabled by this URL.', googleRetry: 'Retry Google', googleOpen: 'Search Google Maps', osmMin: 'Type one more character to search the map', osmLoading: 'Searching…', osmMore: 'Looking for more…',
      osmFail: 'Map search isn’t available right now. You can still drop a pin.', osmCredit: 'Place data: Overture Maps Foundation · © OpenStreetMap contributors (via Photon) · Wikipedia', osmAdd: 'Add', osmOpen: 'On XueTuan',
      addedMine: 'Saved to Footprints', addedShared: 'Saved to Footprints and shared on the big map',
      locating: 'Finding you…', locateFail: 'Couldn’t get your location. Check the browser’s location permission',
      photoFail: 'Some photos weren’t saved and will be lost on refresh', saveFail: 'This browser won’t store data, so it will be lost when you close the page',
      mapFail: 'The map didn’t load. Check your connection and refresh.',
      justNow: 'just now', minAgo: '{n} min ago', hourAgo: '{n} h ago', dayAgo: '{n} d ago',
      locate: 'My location', toCampus: 'Back to XMUM',
      tabsAria: 'Main menu', tabAdd: 'Add', tabHome: 'Home', tabExplore: 'Explore', tabFoot: 'Footprints', tabMe: 'Me',
      latest: 'Latest posts', latestEmpty: 'Nothing shared yet. Record a place you’ve been and switch on “Share on the big map” to see it here.', goRecord: 'Record one',
      openMap: 'Explore the map', postPlace: 'See on map', placeEmpty: 'Nobody has recorded this place yet.',
      meBeen: 'Been', meWant: 'Saved', meShared: 'Shared', meNoName: 'No nickname yet', meNoHome: 'No hometown yet', meGuest: 'Not logged in',
      filterBtn: 'Filters', filtersTitle: 'Filters', filterScore: 'Score', filterDist: 'Distance from campus', filterPrice: 'Price per person', anyOpt: 'Any',
      scoreOpt: '{n}+', priceAbout: 'About RM{n}', filterReset: 'Reset', filterShow: 'Show {n} places',
      areasTitle: 'Go to', locWorld: 'The world', locHere: 'Around here', saveHere: 'Save this area'
    }
  };

  var ICON = {
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M15 5l-7 7 7 7"/></svg>',
    nav: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3 3 10.5l7.2 2.3L12.5 20 21 3z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
    google: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#fff" opacity=".85" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#fff" opacity=".7" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#fff" opacity=".85" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21.5c-3-4-7-7.6-7-12a7 7 0 0 1 14 0c0 4.4-4 8-7 12z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3A1.5 1.5 0 0 1 19 19.5H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>'
  };

  /* ================= state ================= */
  /* tab：底部四栏 首页 / 探索 / 足迹 / 我的（V2.0）。scope：地图上画哪些记录（all 公开 / mine 我去过 / saved 想去） */
  /* 首页默认只推最近一个月去的（用户 2026-11-01：加几年前的足迹没必要推） */
  var HOME_DAYS = 30;
  var state = {
    footTime: 'added',
    lang: 'zh', mode: 'food', tab: 'home', scope: 'all', cat: 'all', priceAbout: 0, minScore: 0, dist: 'any', halal: '',
    view: 'feed', placeId: null, postId: null, placeBack: null, form: null, nearby: null, query: '',
    homeMode: 'all', homeDays: HOME_DAYS, homeMin: 0, homeSort: 'newest', homeFiltersOpen: false, bootLoading: true, posting: false, snap: 'peek', feedSnap: 'peek', picking: null, preview: null, bsheet: null, me: null, styleKey: 'light',
    person: null, personBack: null, mineBoth: false, countries: false, savedWant: false, savedStatus: 'all', favoritesBack: null, mineSub: 'mine', homesOn: false, mineHomeOn: false, mineDots: false, homes: null, homeBack: null, clusterPlaces: null, bulk: null
  };
  var map = null;
  var lastRenderedView = null;

  /* ================= store =================
   * 所有数据读写都走这里。界面只调用 store.xxx，不直接碰 localStorage / IndexedDB / Supabase。
   * 读：同步，从内存里的缓存读。写：返回 Promise。
   * 有两个实现：localStore（数据存在这个浏览器里）和 remoteStore（Supabase），接口一样。
   */
  function localStore() {
    var DATA_VERSION = 2;
    var data = emptyData();
    var canPersist = true;
    var photoURLs = new Map();

    function emptyData() { return { version: DATA_VERSION, places: [], reviews: [], wishlist: [], profile: null, others: [], homes: {}, areas: [], seeded: false }; }

    /* v1 把“没打分”存成 0；v2 里 0 是合法分数，没打分改成 null */
    function migrate(d) {
      if ((d.version || 1) < 2) {
        (d.reviews || []).forEach(function (r) { if (!r.rating) r.rating = null; });
        d.version = 2;
      }
      return d;
    }
    function load() {
      try {
        var raw = localStorage.getItem(LS_DATA);
        if (raw) {
          var d = JSON.parse(raw);
          d.version = d.version || 1;
          data = migrate(Object.assign(emptyData(), d));
          ['places', 'reviews', 'wishlist', 'areas'].forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
        }
      } catch (e) { canPersist = false; }
    }
    function persist() {
      if (!canPersist) return false;
      try { localStorage.setItem(LS_DATA, JSON.stringify(data)); return true; }
      catch (e) { canPersist = false; toast(t('saveFail')); return false; }
    }
    var persistTimer = null;
    function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); }
    function done(v) { persist(); return Promise.resolve(v); }

    /* 示例数据改过一版（加了几十个地点和评分）。以前打开过的浏览器只补上缺的、填上分数；
       已经清空示例的不再加回来 */
    var SAMPLE_SET = 2;
    function seedSamples() {
      var cleared = data.seeded && !data.reviews.some(function (r) { return r.sample; });
      data.seeded = SAMPLE_SET;
      if (cleared) return;
      var now = Date.now();
      SAMPLES.forEach(function (s, i) {
        var ts = now - (SAMPLES.length - i) * 1000 * 60 * 60 * 7;
        var rating = s[10] == null ? null : s[10], price = s[11] || null;
        var old = find(data.reviews, 'r-' + s[0]);
        if (old) {
          if (old.sample && old.rating == null) { old.rating = rating; old.price = price; }
          return;
        }
        if (!find(data.places, s[0])) data.places.push({ id: s[0], mode: s[1], cat: s[2], precision: s[3], lat: s[4], lng: s[5], name: s[6], altName: s[7], link: '', osm: '', createdBy: 'sample', createdAt: ts, sample: true });
        data.reviews.push({ id: 'r-' + s[0], placeId: s[0], authorId: 'sample', authorName: '', rating: rating, price: price, text: s[8], textEn: s[9], photos: [], visibility: 'public', createdAt: ts, sample: true });
      });
    }
    function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
    function mineW(w) { return w.userId === data.profile.id; }
    function homeOf(pf) {
      var h = pf && data.homes[pf.id];
      return h ? { userId: pf.id, name: pf.name || '', city: h.city, lat: h.lat, lng: h.lng, public: !!h.public } : null;
    }
    function forgetPhoto(id) {
      [id, id + THUMB_KEY].forEach(function (k) {
        photoStore.del(k);
        var u = photoURLs.get(k);
        if (u) { URL.revokeObjectURL(u); photoURLs.delete(k); }
      });
    }
    /* photos: [{ id, blob, thumb, url }]，返回原图是否全部存进了 IndexedDB（小图存不进去就用原图） */
    function putPhotos(photos) {
      return Promise.all(photos.map(function (ph) {
        if (ph.url) photoURLs.set(ph.id, ph.url);
        if (ph.thumb) photoStore.put(ph.id + THUMB_KEY, ph.thumb);
        return photoStore.put(ph.id, ph.blob);
      })).then(function (oks) { return oks.every(Boolean); });
    }
    /* small：要小图；老照片没有小图就给原图 */
    function localPhotoURL(id, small) {
      var key = small ? id + THUMB_KEY : id;
      if (photoURLs.has(key)) return Promise.resolve(photoURLs.get(key));
      return photoStore.get(key).then(function (blob) {
        if (!blob) return small ? localPhotoURL(id, false) : null;
        var u = URL.createObjectURL(blob);
        photoURLs.set(key, u);
        return u;
      });
    }
    /* 没有记录、也没人想去的地点才删（收藏了还没去过的地方没有记录，要留着） */
    function dropPlaceIfEmpty(placeId) {
      if (data.reviews.some(function (r) { return r.placeId === placeId; })) return false;
      if (data.wishlist.some(function (w) { return w.placeId === placeId; })) return false;
      data.places = data.places.filter(function (p) { return p.id !== placeId; });
      data.wishlist = data.wishlist.filter(function (w) { return w.placeId !== placeId; });
      return true;
    }

    return {
      mode: 'local',
      signedIn: function () { return true; },
      email: function () { return ''; },
      onAuthChange: function () {},
      init: function () {
        load();
        if (!data.profile || !data.profile.id) data.profile = { id: uid('u'), name: '', country: '', region: '', city: '', district: '' };
        /* 以前只有一个人：收藏和家都算这个人的 */
        if (!Array.isArray(data.others)) data.others = [];
        if (!data.homes || typeof data.homes !== 'object') data.homes = {};
        if (data.home) { if (!data.homes[data.profile.id]) data.homes[data.profile.id] = data.home; delete data.home; }
        data.wishlist.forEach(function (w) { if (!w.userId) w.userId = data.profile.id; });
        /* 测试用：一开始就备好另外两个号 */
        if (!data.others.length) ['B', 'C'].forEach(function (c) { data.others.push({ id: uid('u'), name: t('acctDefault', { c: c }), country: '', region: '', city: '', district: '' }); });
        /* 按建号的先后排，切换来切换去顺序不变 */
        if (data.profile.seq == null) data.profile.seq = 0;
        data.others.forEach(function (o, i) { if (o.seq == null) o.seq = i + 1; });
        if (data.seeded !== SAMPLE_SET) seedSamples();
        persist();
        return Promise.resolve();
      },

      /* ---- 读 ---- */
      me: function () { return data.profile; },
      places: function () { return data.places; },
      place: function (id) { return find(data.places, id); },
      reviews: function () { return data.reviews; },
      review: function (id) { return find(data.reviews, id); },
      reviewsOf: function (placeId) { return reviewsByPlace(data.reviews, placeId); },
      areas: function () { return data.areas; },
      wishlist: function () { return data.wishlist.filter(mineW); },
      isSaved: function (placeId) { return data.wishlist.some(function (w) { return mineW(w) && w.placeId === placeId; }); },
      /* 家：每个测试号一个；和线上一样，看得到公开的和自己的 */
      myHome: function () { return homeOf(data.profile); },
      homes: function () {
        return [data.profile].concat(data.others).map(homeOf).filter(function (h) { return h && (h.public || h.userId === data.profile.id); });
      },
      hasSamples: function () { return data.reviews.some(function (r) { return r.sample; }); },
      photoURL: localPhotoURL,
      hasPhotoURL: function (id) { return photoURLs.has(id); },

      /* ---- 写 ---- */
      addPlace: function (f) {
        var p = {
          id: uid('p'), mode: f.mode, cat: f.cat, precision: f.precision, lat: f.lat, lng: f.lng,
          name: f.name, altName: f.altName || '', link: f.link || '', osm: f.osm || '', cc: ccNow(f.lat, f.lng),
          createdBy: data.profile.id, createdAt: Date.now(), sample: false
        };
        data.places.push(p);
        if (p.cc) return done(p);
        return ccAt(f.lat, f.lng).then(function (cc) { p.cc = cc; return done(p); });
      },
      updatePlace: function (id, patch) {
        var p = find(data.places, id);
        if (!p || p.createdBy !== data.profile.id) return Promise.reject(new Error('not yours'));
        ['cat', 'precision', 'lat', 'lng', 'name', 'altName', 'link'].forEach(function (k) { if (patch[k] !== undefined) p[k] = patch[k]; });
        if (patch.lat != null) p.cc = ccNow(patch.lat, patch.lng);
        p.updatedAt = Date.now();
        return done(p);
      },
      /* f: { placeId, rating, price, text, visibility, createdAt? }，newPhotos: [{ id, blob, url }]；createdAt 是从照片批量加时的拍摄时间 */
      addReview: function (f, newPhotos) {
        var me = data.profile;
        var r = {
          id: uid('r'), placeId: f.placeId, authorId: me.id, authorName: me.name || '',
          rating: f.rating, price: f.price, priceCurrency: validPriceCurrency(f.priceCurrency), halal: validHalal(f.halal), title: f.title || null, text: f.text, photos: newPhotos.map(function (ph) { return ph.id; }),
          visibility: f.visibility, createdAt: f.createdAt || Date.now(), updatedAt: Date.now(), sample: false
        };
        return putPhotos(newPhotos).then(function (photosOk) {
          data.reviews.push(r);
          persist();
          return { review: r, photosOk: photosOk };
        });
      },
      /* patch 同 addReview；keepPhotos 是保留的旧照片 id，newPhotos 是新加的 */
      updateReview: function (id, patch, keepPhotos, newPhotos) {
        var r = find(data.reviews, id);
        if (!r || r.authorId !== data.profile.id) return Promise.reject(new Error('not yours'));
        return putPhotos(newPhotos).then(function (photosOk) {
          (r.photos || []).forEach(function (pid) { if (keepPhotos.indexOf(pid) === -1) forgetPhoto(pid); });
          ['rating', 'price', 'priceCurrency', 'halal', 'title', 'text', 'visibility', 'createdAt'].forEach(function (k) { if (patch[k] !== undefined) r[k] = patch[k]; });
          r.photos = orderPhotos(keepPhotos, newPhotos.map(function (ph) { return ph.id; }), patch.photoOrder);
          r.authorName = data.profile.name || '';
          r.updatedAt = Date.now();
          persist();
          return { review: r, photosOk: photosOk };
        });
      },
      /* 编辑时换地点：同一条记录挪到另一个地点，旧地点没人记了就删 */
      moveReview: function (id, placeId, patch, keepPhotos, newPhotos) {
        var r = find(data.reviews, id);
        if (!r || r.authorId !== data.profile.id) return Promise.reject(new Error('not yours'));
        var from = r.placeId;
        return this.updateReview(id, patch, keepPhotos, newPhotos).then(function (res) {
          /* 换一个新数组：按地点分组的缓存看数组换没换 */
          r.placeId = placeId; data.reviews = data.reviews.slice(); dropPlaceIfEmpty(from); persist();
          return res;
        });
      },
      /* 删掉最后一条记录时地点也一起删，返回 { placeRemoved } */
      deleteReview: function (id) {
        var r = find(data.reviews, id);
        if (!r || r.authorId !== data.profile.id) return Promise.reject(new Error('not yours'));
        data.reviews = data.reviews.filter(function (x) { return x.id !== id; });
        (r.photos || []).forEach(forgetPhoto);
        return done({ placeRemoved: dropPlaceIfEmpty(r.placeId) });
      },
      setVisibility: function (ids, visibility) {
        var rows = ids.map(function (id) { return find(data.reviews,id); });
        if (!rows.length || rows.some(function (r) { return !r || r.authorId !== data.profile.id || r.sample; }) || ['private','public'].indexOf(visibility) === -1) return Promise.reject(new Error('not yours'));
        rows.forEach(function (r) { r.visibility = visibility; r.updatedAt = Date.now(); });
        return done(rows);
      },
      setSaved: function (placeId, saved) {
        data.wishlist = data.wishlist.filter(function (w) { return !(mineW(w) && w.placeId === placeId); });
        if (saved) data.wishlist.push({ userId: data.profile.id, placeId: placeId, createdAt: Date.now() });
        else { var p = find(data.places, placeId); if (p && !p.sample) dropPlaceIfEmpty(placeId); }
        return done(saved);
      },
      /* h: { city, lat, lng, public }，null 是不设了 */
      setHome: function (h) {
        if (h) data.homes[data.profile.id] = { city: h.city, lat: h.lat, lng: h.lng, public: !!h.public };
        else delete data.homes[data.profile.id];
        return done(this.myHome());
      },
      /* 别人能不能点进这个人的主页（他自己在“我的”里开，默认关） */
      pagePublic: function (id) {
        var a = [data.profile].concat(data.others).filter(function (x) { return x && x.id === id; })[0];
        return !!(a && a.page_public);
      },
      /* 头像照片（2026-11-02）：没有就用名字第一个字 */
      avatarOf: function (id) {
        var a = [data.profile].concat(data.others).filter(function (x) { return x && x.id === id; })[0];
        return (a && a.avatar) || '';
      },
      setAvatar: function (out) {
        var id = uid('av'), old = data.profile.avatar;
        photoStore.put(id + THUMB_KEY, out.thumb);
        return photoStore.put(id, out.blob).then(function () {
          data.profile.avatar = id; persistSoon();
          if (old) { photoStore.del && photoStore.del(old); photoURLs.delete(old); photoURLs.delete(old + THUMB_KEY); }
          return id;
        });
      },
      updateProfile: function (patch) {
        Object.keys(patch).forEach(function (k) { data.profile[k] = patch[k]; });
        data.reviews.forEach(function (r) { if (r.authorId === data.profile.id) r.authorName = data.profile.name || ''; });
        persistSoon();
        return Promise.resolve(data.profile);
      },
      /* ---- 测试账号：同一个浏览器里换着当不同的人，看别人眼里是什么样 ---- */
      accounts: function () { return [data.profile].concat(data.others).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); },
      addAccount: function (name) {
        var pf = { id: uid('u'), name: name, country: '', region: '', city: '', district: '', seq: data.others.length + 1 };
        data.others.push(pf);
        return done(pf);
      },
      switchAccount: function (id) {
        var all = [data.profile].concat(data.others), next = find(all, id);
        if (!next) return Promise.reject(new Error('no account'));
        data.profile = next;
        data.others = all.filter(function (x) { return x !== next; });
        return done(next);
      },
      addArea: function (a) {
        var area = { id: uid('a'), name: a.name, lng: a.lng, lat: a.lat, zoom: a.zoom };
        data.areas.push(area);
        return done(area);
      },
      deleteArea: function (id) {
        data.areas = data.areas.filter(function (x) { return x.id !== id; });
        return done();
      },
      clearSamples: function () {
        data.reviews = data.reviews.filter(function (r) { return !r.sample; });
        data.places = data.places.filter(function (p) { return !p.sample; });
        data.wishlist = data.wishlist.filter(function (w) { return find(data.places, w.placeId); });
        data.seeded = true;
        return done();
      },

      /* ---- 备份 ---- */
      exportBackup: function () {
        var ids = [], photos = {};
        data.reviews.forEach(function (r) { (r.photos || []).forEach(function (id) { ids.push(id); }); });
        return ids.reduce(function (chain, id) {
          return chain.then(function () {
            return photoStore.get(id).then(function (b) { return b ? blobToDataURL(b) : null; }).then(function (u) { if (u) photos[id] = u; });
          });
        }, Promise.resolve()).then(function () {
          return {
            app: BACKUP_APP, version: DATA_VERSION, exportedAt: new Date().toISOString(),
            profile: data.profile, home: data.homes[data.profile.id] || null, places: data.places, reviews: data.reviews, wishlist: data.wishlist, areas: data.areas, photos: photos
          };
        });
      },
      /* 合并导入，已有的 id 不覆盖。返回新增地点数；格式不对返回 -1 */
      importBackup: function (obj) {
        if (!obj || BACKUP_APPS.indexOf(obj.app) === -1 || !Array.isArray(obj.places) || !Array.isArray(obj.reviews)) return Promise.resolve(-1);
        migrate(obj);
        var placeIds = {}, reviewIds = {}, areaIds = {}, added = 0;
        data.places.forEach(function (p) { placeIds[p.id] = 1; });
        data.reviews.forEach(function (r) { reviewIds[r.id] = 1; });
        data.areas.forEach(function (a) { areaIds[a.id] = 1; });
        obj.places.forEach(function (p) { if (p && p.id && !placeIds[p.id] && isFinite(p.lat) && isFinite(p.lng) && CATS[p.mode]) { data.places.push(p); added++; } });
        obj.reviews.forEach(function (r) { if (r && r.id && !reviewIds[r.id] && r.placeId) data.reviews.push(r); });
        (obj.areas || []).forEach(function (a) { if (a && a.id && !areaIds[a.id]) data.areas.push(a); });
        /* 这个号还什么都没写过：直接变成备份里的那个人（收藏、家跟过去） */
        var me = data.profile;
        if (obj.profile && obj.profile.id && !me.name && !data.reviews.some(function (r) { return r.authorId === me.id; })) {
          data.profile = obj.profile;
          data.wishlist.forEach(function (w) { if (w.userId === me.id) w.userId = obj.profile.id; });
          if (data.homes[me.id] && !data.homes[obj.profile.id]) data.homes[obj.profile.id] = data.homes[me.id];
          delete data.homes[me.id];
        }
        (obj.wishlist || []).forEach(function (w) {
          if (w && w.placeId && !data.wishlist.some(function (x) { return mineW(x) && x.placeId === w.placeId; })) data.wishlist.push({ userId: data.profile.id, placeId: w.placeId, createdAt: w.createdAt || Date.now() });
        });
        if (!data.homes[data.profile.id] && obj.home && obj.home.city && isFinite(obj.home.lat) && isFinite(obj.home.lng)) data.homes[data.profile.id] = obj.home;
        var jobs = Object.keys(obj.photos || {}).map(function (id) {
          return dataURLToBlob(obj.photos[id]).then(function (b) { return photoStore.put(id, b); }).catch(function () { return false; });
        });
        return Promise.all(jobs).then(function () { persist(); return added; });
      }
    };
  }

  /* ================= remote store (Supabase) =================
   * 和 localStore 一样的接口。init() 把看得见的数据（RLS 已经过滤好）拉进内存缓存，
   * 读还是同步的；写先调接口，成功后再改缓存。
   * 没登录时只能看：me().id 是 null，所有写操作都会被拒绝，界面会先让人登录。
   */
  function remoteStore(client) {
    var ANON = { id: null, name: '', country: '', region: '', city: '', district: '' };
    var cache = { places: [], reviews: [], wishlist: [], homes: [], profile: ANON, admin: false };
    var session = null, email = '', reader = null;
    var offline = window.XueOffline && window.XueOffline.enabled ? window.XueOffline : null;
    function saveOffline() { if (offline) offline.snapshot(cache); }
    function restoreOffline(guard) {
      var actor = uidNow();
      return (offline ? offline.snapshot() : Promise.resolve(null)).then(function (saved) {
        if (!saved || actor !== uidNow() || (guard && !guard())) throw new Error('No offline content');
        ['places','reviews','wishlist','homes','profile'].forEach(function (k) { cache[k] = saved[k]; }); cache.mapGroups = saved.mapGroups || []; cache.admin = false;
      });
    }
    function readAll(guard) {
      if (offline && navigator.onLine === false) return restoreOffline(guard);
      return loadAll(guard).catch(function (e) {
        // Permission/auth failures must never be hidden by a stale snapshot.
        if (e && (e.code || e.status || !/fetch|network|offline|connection/i.test(String(e.message || e)))) throw e;
        return restoreOffline(guard);
      });
    }
    var photoURLs = new Map();
    var photoExpiries = new Map(), photoRequests = new Map();
    if (offline) window.addEventListener('xuetuan-offline-clear', function () { photoURLs.clear(); photoExpiries.clear(); photoRequests.clear(); });
    if (offline) window.addEventListener('xuetuan-photo-evicted', function (e) { photoURLs.forEach(function (u, k) { if (u === e.detail) { photoURLs.delete(k); photoExpiries.delete(k); } }); });
    var listeners = [];
    var signQueue=[],signBusy=0,signTimer=0;
    function signPhotoPath(path) {
      return new Promise(function(resolve){signQueue.push({path:path,actor:uidNow(),resolve:resolve});if(!signTimer)signTimer=setTimeout(pumpSigns,0);});
    }
    function pumpSigns() {
      signTimer=0;
      while(signBusy<2&&signQueue.length){
        var jobs=signQueue.splice(0,40).filter(function(j){if(j.actor===uidNow())return true;j.resolve({error:{message:'Account changed'}});return false;});if(!jobs.length)continue;
        signBusy++;(function(batch){
          var bucket=client.storage.from('photos'),bulk=batch.length>1&&typeof bucket.createSignedUrls==='function';
          var work=Promise.resolve().then(function(){return bulk?bucket.createSignedUrls(batch.map(function(j){return j.path;}),300):Promise.all(batch.map(function(j){return bucket.createSignedUrl(j.path,300);}));});
          Promise.resolve(work).then(function(r){batch.forEach(function(j,i){
            if(!bulk){j.resolve(r[i]);return;}
            var row=!r.error&&Array.isArray(r.data)&&(r.data.find(function(x){return x.path===j.path;})||(r.data[i]&&!r.data[i].path&&r.data[i]));
            j.resolve(row&&row.signedUrl&&!row.error?{data:{signedUrl:row.signedUrl}}:{error:r.error||row&&row.error||{message:'No authorized photo'}});
          });},function(e){batch.forEach(function(j){j.resolve({error:e});});}).then(function(){signBusy--;pumpSigns();});
        })(jobs);
      }
    }

    function uidNow() { return session ? session.user.id : null; }
    function ok(res) { if (res.error) throw res.error; return res.data; }
    function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
    function needLogin() { return uidNow() ? null : Promise.reject(new Error('login required')); }

    function placeFromRow(r) {
      return {
        id: r.id, mode: r.mode, cat: r.cat, precision: r.precision, lat: r.lat, lng: r.lng,
        name: r.name, altName: r.alt_name, link: r.link, osm: r.osm, cc: r.cc || '', createdBy: r.created_by,
        createdAt: Date.parse(r.created_at), sample: false
      };
    }
    /* 网卡住时保存别一直转（用户 2026-11-05：朋友在微信里点保存等了 10 秒，记录却没到服务器）：
       超时就报错让人重试；新记录用前端生成的编号，重试时请求其实已经到了也不会存两条 */
    var WRITE_TIMEOUT = window.__writeTimeout || 15000;
    function withTimeout(p) {
      return Promise.race([p, new Promise(function (_, reject) { setTimeout(function () { reject(new Error('XUETUAN_SAVE_TIMEOUT')); }, WRITE_TIMEOUT); })]);
    }
    /* 先只写（POST 不带 ?select、不要求回传整行），再按编号读回来：
       iPhone 微信里“POST 带 ?select=* 要回传”的保存会被吞掉却显示成功（用户 2026-11-05 朋友实测；同一台手机上存照片、调 rpc 的 POST 都正常）。
       读不到就当没存上；同一个编号已经存进去了（上次超时其实成功了）也当成功 */
    function insertOnce(table, row) {
      return withTimeout(client.from(table).insert(row)).then(function (res) {
        if (res.error && !(res.error.code === '23505' || /duplicate key/i.test(res.error.message || ''))) throw res.error;
        return withTimeout(client.from(table).select('*').eq('id', row.id).maybeSingle());
      }).then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) throw new Error('XUETUAN_WRITE_LOST');
        return res.data;
      });
    }
    /* 改也一样：先 PATCH（不带 ?select），再读回 */
    function updateThenRead(table, row, id) {
      return withTimeout(client.from(table).update(row).eq('id', id)).then(function (res) {
        if (res.error) throw res.error;
        return withTimeout(client.from(table).select('*').eq('id', id).single());
      }).then(ok);
    }
    function placeToRow(p) {
      var row = {};
      [['mode', 'mode'], ['cat', 'cat'], ['precision', 'precision'], ['lat', 'lat'], ['lng', 'lng'], ['name', 'name'],
        ['altName', 'alt_name'], ['link', 'link'], ['osm', 'osm']].forEach(function (k) { if (p[k[0]] !== undefined) row[k[1]] = p[k[0]]; });
      /* 国家代码列（2026-11-02 加）：数据库有这一列才写 */
      if (cache.ccCol && p.cc) row.cc = p.cc;
      return row;
    }
    function reviewFromRow(r, author) {
      author = author || r.author || {};
      return {
        id: r.id, placeId: r.place_id, authorId: r.user_id, authorName: author.name || '', authorPage: !!author.page_public, authorAvatar: author.avatar || '',
        rating: r.rating == null ? null : +r.rating, price: r.price == null ? null : +r.price, priceCurrency: validPriceCurrency(r.price_currency), halal: validHalal(r.halal), title: r.title || null, text: r.text, photos: r.photos || [],
        visibility: r.visibility, createdAt: Date.parse(r.created_at), updatedAt: r.updated_at ? Date.parse(r.updated_at) : null, sample: false
      };
    }
    /* 看得见的家：公开的 + 我自己的（RLS 已经过滤好） */
    function homeFromRow(r) {
      return { userId: r.user_id, name: (r.owner && r.owner.name) || '', city: r.city, lat: r.lat, lng: r.lng, public: !!r.is_public };
    }
    /* 动图和短视频的 id 带后缀（ph_x.gif / ph_x.mp4），照片没有，存成 .jpg */
    function photoPath(id) { return uidNow() + '/' + id + (/\.\w+$/.test(id) ? '' : '.jpg'); }
    /* 小图和原图放在同一个文件夹：xxx.jpg（.gif / .mp4）的小图是 xxx_t.jpg */
    function thumbPath(path) { return path.replace(/\.(jpg|gif|mp4|mov|webm)$/i, '_t.jpg'); }
    /* 传照片（原图 + 小图），返回传成功的路径和是否全部成功；小图传不上去就算了，显示时会退回原图。
       几张照片同时传（以前一张一张传，保存要等很久，用户 2026-11-01）；
       选好照片就先在后台传（preupload），点保存时多半已经传完。每张照片的上传只做一次，失败了保存时再试 */
    function uploadOne(ph) {
      var path = photoPath(ph.id);
      if (ph.uploadedPath === path) return Promise.resolve(path);
      if (ph._up && ph._upPath === path) return ph._up;
      var bucket = client.storage.from('photos');
      ph.uploadError = null; ph._upPath = path;
      function upload(p, blob, type) { return bucket.upload(p, blob, { contentType: type, upsert: false }).then(function (res) { if (p === path && res.error) ph.uploadError = res.error; return !res.error; }, function (e) { if (p === path) ph.uploadError = e; return false; }); }
      ph._up = Promise.all([upload(path, ph.blob, mediaType(path)), ph.thumb ? upload(thumbPath(path), ph.thumb, 'image/jpeg') : Promise.resolve(false)]).then(function (res) {
        if (!res[0]) {
          ph._up = null;
          if (res[1]) return bucket.remove([thumbPath(path)]).then(function () { return null; }, function () { return null; });
          return null;
        }
        if (ph.url) photoURLs.set(path, ph.url);
        ph.uploadedPath = path;
        if (ph.thumb && res[1]) photoURLs.set(path + THUMB_KEY, URL.createObjectURL(ph.thumb));
        return path;
      });
      return ph._up;
    }
    function uploadPhotos(photos, progress) {
      var done = 0;
      if (progress && photos.length) progress('upload', 0, photos.length);
      return Promise.all(photos.map(function (ph) {
        return uploadOne(ph).then(function (path) { done++; if (progress) progress('upload', done, photos.length); return path; });
      })).then(function (paths) {
        var good = paths.filter(Boolean);
        return { paths: good, ok: good.length === photos.length, error: (photos.filter(function (ph) { return ph.uploadError; })[0] || {}).uploadError };
      });
    }
    function removePhotos(paths) {
      if (!paths.length) return Promise.resolve();
      paths.forEach(function (p) { photoURLs.delete(p); photoURLs.delete(p + THUMB_KEY); });
      return client.storage.from('photos').remove(paths.concat(paths.map(thumbPath))).then(function () {}, function () {});
    }

    /* Supabase 每次最多回 1000 行（max-rows），超过就一页一页接着读，不然人多了地点会悄悄少掉 */
    var PAGE_ROWS = window.__sbPageRows || 1000;
    function fetchAll(build) {
      var out = [];
      function page(from) {
        return build().range(from, from + PAGE_ROWS - 1).then(function (r) {
          if (r.error) return r;
          var rows = r.data || [];
          out = out.concat(rows);
          return rows.length < PAGE_ROWS || out.length >= 50000 ? { data: out, error: null } : page(from + PAGE_ROWS);
        });
      }
      return page(0);
    }
    function loadAll(guard) {
      if (reader) return reader.refresh(guard).then(function (supported) { return supported ? undefined : loadLegacy(guard); });
      return loadLegacy(guard);
    }
    function loadLegacy(guard) {
      var uid = uidNow();
      return Promise.all([
        fetchAll(function () { return client.from('places').select('*').order('id'); }),
        /* 头像列是 2026-11-02 加的，数据库还没加时退回不带头像的读法 */
        fetchAll(function () { return client.from('visits').select('*, author:profiles(name, page_public, avatar)').order('created_at', { ascending: false }).order('id'); }).then(function (r) {
          return r.error ? fetchAll(function () { return client.from('visits').select('*, author:profiles(name, page_public)').order('created_at', { ascending: false }).order('id'); }) : r;
        }),
        uid ? client.from('profiles').select('*').eq('id', uid).maybeSingle() : Promise.resolve({ data: null }),
        uid ? client.from('wishlist').select('*') : Promise.resolve({ data: [] }),
        /* 家这张表是后加的，读不到也别让整个应用打不开 */
        fetchAll(function () { return client.from('homes').select('user_id, city, lat, lng, is_public, owner:profiles(name)').order('user_id'); }).then(function (r) { return r.error ? { data: [] } : r; }, function () { return { data: [] }; }),
        uid ? client.rpc('xuetuan_is_admin').then(function (r) { return !r.error && r.data === true; }, function () { return false; }) : Promise.resolve(false)
      ]).then(function (res) {
        if (uid !== uidNow() || (guard && !guard())) return false;
        var places = ok(res[0]), visits = ok(res[1]), profile = ok(res[2]), wish = ok(res[3]);
        cache.homes = (res[4].data || []).map(homeFromRow);
        cache.admin = res[5] === true;
        cache.places = places.map(placeFromRow);
        cache.ccCol = !!(places[0] && 'cc' in places[0]);
        /* 清真这一列是 2026-11-03 加的：库里还没有就先不写，免得整条记录存不上 */
        cache.halalCol = !!(visits[0] && 'halal' in visits[0]);
        cache.reviews = visits.map(function (v) { return reviewFromRow(v); });
        cache.profile = uid ? Object.assign({}, ANON, profile || {}, { id: uid }) : ANON;
        cache.wishlist = (wish || []).map(function (w) { return { placeId: w.place_id, createdAt: Date.parse(w.created_at) }; });
        saveOffline();
      });
    }
    function setSession(s) {
      var before = uidNow(), wasAnon = !!(session && session.user && session.user.is_anonymous), oldEmail = email;
      session = s;
      email = s && s.user ? s.user.email || '' : '';
      if (offline) offline.setOwner(uidNow());
      if (before !== uidNow()) { if (reader) reader.reset(); cache.mapGroups = []; cache.places = []; cache.reviews = []; cache.wishlist = []; cache.homes = []; cache.profile = uidNow() ? Object.assign({}, ANON, {id:uidNow()}) : ANON; cache.admin = false; photoURLs.forEach(function (u) { if (/^blob:/.test(u)) URL.revokeObjectURL(u); }); photoURLs.clear(); photoExpiries.clear(); photoRequests.clear(); }
      return before !== uidNow() || wasAnon !== !!(s && s.user && s.user.is_anonymous) || oldEmail !== email;
    }

    var profileTimer = null, profilePatch = {}, profileOwner = null, profileFlight = Promise.resolve();
    function flushProfile() {
      var patch = profilePatch, uid = profileOwner;
      profilePatch = {};
      if (!uid || !Object.keys(patch).length) return profileFlight;
      if (uid !== uidNow()) return Promise.resolve();
      profileFlight = client.from('profiles').update(patch).eq('id', uid).then(function (res) {
        if (res.error) {
          if (uid === uidNow()) { profileOwner = uid; profilePatch = Object.assign({}, patch, profilePatch); }
          throw res.error;
        }
      });
      return profileFlight;
    }

    var areas = {
      list: function () { try { return JSON.parse(localStorage.getItem(LS_AREAS) || '[]'); } catch (e) { return []; } },
      save: function (list) { try { localStorage.setItem(LS_AREAS, JSON.stringify(list)); } catch (e) { /* 存不了就算了 */ } }
    };
    var areaCache = areas.list();

    var api = {
      mode: 'remote',
      isAdmin: function () { return cache.admin; },
      moderateVisit: function (id, decision) {
        return client.rpc('xuetuan_moderate_visit', { visit_id:id, decision:decision }).then(ok).then(function (result) {
          cache.reviews = cache.reviews.filter(function (r) { return r.id !== id; });
          return client.storage.from('photos').remove(result.files || []).then(function (r) { return { banned:result.banned, mediaOk:!r.error }; }, function () { return { banned:result.banned, mediaOk:false }; });
        });
      },
      cleanModerationMedia: function () {
        return client.rpc('xuetuan_moderation_pending').then(ok).then(function (paths) {
          if (!paths.length) return 0;
          return client.storage.from('photos').remove(paths).then(ok).then(function () { return paths.length; });
        });
      },
      refresh: function (guard) { return readAll(guard); },
      init: function () {
        client.auth.onAuthStateChange(function (event, s) {
          if (event === 'SIGNED_OUT' && offline) { offline.setOwner(null); cache = { places: [], reviews: [], wishlist: [], homes: [], profile: ANON, admin: false }; }
          // 回调里不能直接再调 supabase，放到下一轮
          setTimeout(function () {
            if (!setSession(s)) return;
            readAll().catch(function () {}).then(function () { listeners.forEach(function (fn) { fn(); }); });
          }, 0);
        });
        var sessionRead = client.auth.getSession();
        var pendingSession = sessionRead;
        if (offline && navigator.onLine === false) sessionRead = new Promise(function (resolve, reject) {
          var timer = setTimeout(function () { reject(new Error('Offline session unavailable; reconnect to sign in')); }, 2500);
          Promise.resolve(pendingSession).then(function (r) { clearTimeout(timer); resolve(r); }, function (e) { clearTimeout(timer); reject(e); });
        });
        return sessionRead.then(function (res) {
          setSession(res.data && res.data.session);
          return readAll();
        });
      },

      /* ---- 账号 ---- */
      signedIn: function () { return !!uidNow(); },
      email: function () { return email; },
      onAuthChange: function (fn) { listeners.push(fn); },
      signInWithEmail: function (addr) {
        return client.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: location.origin + location.pathname } }).then(ok);
      },
      /* 邮件里的验证码：在同一个页面输入就登录，不用跳去别的浏览器开链接（微信、华为浏览器里点链接会换浏览器，登录就丢了） */
      verifyEmailCode: function (addr, code) {
        return client.auth.verifyOtp({ email: addr, token: code, type: 'email' }).then(ok);
      },
      signInWithGoogle: function () {
        return client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authReturnURL() } }).then(ok);
      },
      /* 匿名号：不用填任何东西；绑谷歌后还是同一个号，记录都在（后台要开 anonymous sign-ins 和 manual linking） */
      signInAnonymously: function () { return client.auth.signInAnonymously().then(ok); },
      isAnon: function () { return !!(session && session.user && session.user.is_anonymous); },
      linkGoogle: function () {
        return client.auth.linkIdentity({ provider: 'google', options: { redirectTo: authReturnURL() } }).then(ok);
      },
      signOut: function () { return client.auth.signOut().then(ok); },

      /* ---- 读 ---- */
      me: function () { return cache.profile; },
      places: function () { return cache.places; },
      place: function (id) { return find(cache.places, id); },
      reviews: function () { return cache.reviews; },
      review: function (id) { return find(cache.reviews, id); },
      reviewsOf: function (placeId) { return reviewsByPlace(cache.reviews, placeId); },
      areas: function () { return areaCache; },
      wishlist: function () { return cache.wishlist; },
      isSaved: function (placeId) { return cache.wishlist.some(function (w) { return w.placeId === placeId; }); },
      myHome: function () { var id = uidNow(); return id ? cache.homes.filter(function (h) { return h.userId === id; })[0] || null : null; },
      homes: function () { return cache.homes; },
      hasSamples: function () { return false; },
      /* small：小图地址。以前传的照片没有小图，图片加载失败时由显示的地方退回原图 */
      cachedPhotoURL: function (id,small) { var key=small?id+THUMB_KEY:id;return photoURLs.has(key)&&(!photoExpiries.has(key)||photoExpiries.get(key)>Date.now())?photoURLs.get(key):null; },
      photoURL: function (id, small) {
        var key = small ? id + THUMB_KEY : id;
        if (offline && (navigator.onLine === false || offline.status().cached)) return offline.photo(id, small);
        if (photoURLs.has(key) && (!photoExpiries.has(key) || photoExpiries.get(key) > Date.now())) return Promise.resolve(photoURLs.get(key));
        if (id.indexOf('/') === -1) return photoStore.get(id).then(function (b) { return b ? URL.createObjectURL(b) : null; });
        if (photoRequests.has(key)) return photoRequests.get(key);
        var actor = uidNow();
        var request = signPhotoPath(small ? thumbPath(id) : id).then(function (res) {
          // Older uploads may have no thumbnail. Try the same authorized original, never a public URL.
          return small && res.error ? signPhotoPath(id) : res;
        }).then(function (res) {
          if (actor !== uidNow() || res.error || !res.data || !res.data.signedUrl) return null;
          return (offline ? offline.photo(id, small, res.data.signedUrl) : Promise.resolve(res.data.signedUrl)).then(function (u) {
            if (actor !== uidNow()) { if (u && /^blob:/.test(u)) URL.revokeObjectURL(u); return null; }
            photoURLs.set(key, u); photoExpiries.set(key, Date.now() + 240000); return u;
          });
        }, function () { return null; }).then(function (u) { if (photoRequests.get(key) === request) photoRequests.delete(key); return u; });
        photoRequests.set(key, request); return request;
      },
      invalidatePhotoURL: function (id) { [id,id+THUMB_KEY].forEach(function (k) { if (!/^blob:/.test(photoURLs.get(k) || '')) { photoURLs.delete(k); photoExpiries.delete(k); photoRequests.delete(k); } }); },
      preupload: function (photos) { if (uidNow()) photos.forEach(function (ph) { if (ph.blob) uploadOne(ph); }); },
      hasPhotoURL: function (id) { return photoURLs.has(id); },

      /* ---- 写 ---- */
      addPlace: function (f) {
        return needLogin() || ccAt(f.lat, f.lng).then(function (cc) { return insertOnce('places', Object.assign(placeToRow(Object.assign({}, f, { cc: cc })), { id: f.id || newClientId() })); }).then(function (row) {
          var p = placeFromRow(row);
          cache.places.push(p);
          return p;
        });
      },
      updatePlace: function (id, patch) {
        var row = placeToRow(patch);
        delete row.mode;
        /* 国家代码只在新建时写；数据库只允许改几列，带上 cc 会整条被拒（编辑记录保存失败，用户 2026-11-02） */
        delete row.cc;
        return needLogin() || Promise.resolve().then(function () { return updateThenRead('places', row, id).then(function (r) {
          var p = find(cache.places, id);
          Object.assign(p, placeFromRow(r));
          return p;
        }); });
      },
      addReview: function (f, newPhotos, progress) {
        return needLogin() || uploadPhotos(newPhotos, progress).then(function (up) {
          if (!up.ok) throw up.error || new Error('photo-upload');
          if (progress) progress('write');
          var row = { place_id: f.placeId, rating: f.rating, price: f.price, price_currency: validPriceCurrency(f.priceCurrency), text: f.text, title: f.title || null, visibility: f.visibility, photos: up.paths, updated_at: new Date().toISOString() };
          if (f.createdAt) row.created_at = new Date(f.createdAt).toISOString();
          if (cache.halalCol) row.halal = validHalal(f.halal);
          row.id = f.id || newClientId();
          return insertOnce('visits', row).then(function (v) {
            var r = reviewFromRow(v, cache.profile);
            cache.reviews.unshift(r);
            return { review: r, photosOk: up.ok };
          });
        });
      },
      updateReview: function (id, patch, keepPhotos, newPhotos, progress) {
        var r = find(cache.reviews, id);
        if (!r) return Promise.reject(new Error('missing'));
        return needLogin() || uploadPhotos(newPhotos, progress).then(function (up) {
          if (!up.ok) throw up.error || new Error('photo-upload');
          if (progress) progress('write');
          var dropped = (r.photos || []).filter(function (p) { return keepPhotos.indexOf(p) === -1; });
          var row = { rating: patch.rating, price: patch.price, price_currency: validPriceCurrency(patch.priceCurrency), text: patch.text, title: patch.title || null, visibility: patch.visibility, photos: orderPhotos(keepPhotos, up.paths, patch.photoOrder) };
          if (cache.halalCol && patch.halal !== undefined) row.halal = validHalal(patch.halal);
          if (patch.createdAt) row.created_at = new Date(patch.createdAt).toISOString();
          return updateThenRead('visits', row, id).then(function (v) {
            removePhotos(dropped);
            Object.assign(r, reviewFromRow(v, cache.profile));
            return { review: r, photosOk: up.ok };
          });
        });
      },
      /* 编辑时换地点：数据库不让改记录的地点，所以在新地点插一条一样的（日期、照片不变），再删旧的。
         删旧的失败时记住新的那条，重试不会再插一遍 */
      moveReview: function (id, placeId, patch, keepPhotos, newPhotos, progress) {
        var r = find(cache.reviews, id);
        if (!r) return Promise.reject(new Error('missing'));
        return needLogin() || uploadPhotos(newPhotos, progress).then(function (up) {
          if (!up.ok) throw up.error || new Error('photo-upload');
          if (progress) progress('write');
          var dropped = (r.photos || []).filter(function (p) { return keepPhotos.indexOf(p) === -1; });
          r._moveId = r._moveId || newClientId();
          var made = r._movedTo && r._movedTo.placeId === placeId ? Promise.resolve(r._movedTo) : insertOnce('visits', {
            id: r._moveId, place_id: placeId, rating: patch.rating, price: patch.price, price_currency: validPriceCurrency(patch.priceCurrency), text: patch.text, title: patch.title || null, visibility: patch.visibility,
            photos: orderPhotos(keepPhotos, up.paths, patch.photoOrder), created_at: new Date(patch.createdAt || r.createdAt).toISOString(), updated_at: new Date().toISOString(),
            halal: cache.halalCol ? validHalal(patch.halal) : undefined
          }).then(function (v) { r._movedTo = reviewFromRow(v, cache.profile); return r._movedTo; });
          return made.then(function (nr) {
            return client.from('visits').delete().eq('id', id).then(ok).then(function () {
              removePhotos(dropped);
              cache.reviews = cache.reviews.filter(function (x) { return x.id !== id; });
              cache.reviews.unshift(nr);
              return client.from('places').select('id').eq('id', r.placeId).then(ok);
            }).then(function (rows) {
              if (!rows.length) {
                cache.places = cache.places.filter(function (p) { return p.id !== r.placeId; });
                cache.wishlist = cache.wishlist.filter(function (w) { return w.placeId !== r.placeId; });
              }
              return { review: nr, photosOk: up.ok };
            });
          });
        });
      },
      /* 删最后一条记录、又没人想去时，数据库会顺带删地点；删完查一下地点还在不在（或者我还看不看得见） */
      deleteReview: function (id) {
        var r = find(cache.reviews, id);
        if (!r) return Promise.reject(new Error('missing'));
        return needLogin() || client.from('visits').delete().eq('id', id).then(ok).then(function () {
          removePhotos(r.photos || []);
          cache.reviews = cache.reviews.filter(function (x) { return x.id !== id; });
          return client.from('places').select('id').eq('id', r.placeId).then(ok);
        }).then(function (rows) {
          var gone = !rows.length;
          if (gone) {
            cache.places = cache.places.filter(function (p) { return p.id !== r.placeId; });
            cache.wishlist = cache.wishlist.filter(function (w) { return w.placeId !== r.placeId; });
          }
          return { placeRemoved: gone };
        });
      },
      setVisibility: function (ids, visibility) {
        var owner = uidNow(), rows = ids.map(function (id) { return find(cache.reviews,id); });
        if (!owner || !rows.length || rows.some(function (r) { return !r || r.authorId !== owner; }) || ['private','public'].indexOf(visibility) === -1) return Promise.reject(new Error('not yours'));
        return withTimeout(client.from('visits').update({visibility:visibility}).in('id',ids).eq('user_id',owner)).then(ok).then(function () { return withTimeout(client.from('visits').select('*').in('id',ids).eq('user_id',owner).eq('visibility',visibility)); }).then(ok).then(function (changed) {
          if (uidNow() !== owner) return [];
          changed.forEach(function (row) { var old = find(cache.reviews,row.id); if (old) Object.assign(old,reviewFromRow(row,cache.profile)); });
          if (changed.length !== ids.length) throw new Error('incomplete visibility update');
          return changed;
        });
      },
      setSaved: function (placeId, saved) {
        var owner = uidNow();
        var q = saved
          ? client.from('wishlist').insert({ place_id: placeId, user_id: owner })
          : client.from('wishlist').delete().eq('place_id', placeId).eq('user_id', owner);
        return needLogin() || q.then(function (res) {
          if (saved && res.error && res.error.code === '23505') return client.from('wishlist').select('place_id').eq('place_id',placeId).eq('user_id',owner).then(function (found) { return !found.error && found.data && found.data.length ? found : res; });
          return res;
        }).then(ok).then(function () {
          if (uidNow() !== owner) return saved;
          cache.wishlist = cache.wishlist.filter(function (w) { return w.placeId !== placeId; });
          if (saved) { cache.wishlist.push({ placeId: placeId, createdAt: Date.now() }); return saved; }
          /* 没人记录、也没人想去的地点，数据库会顺带删掉；查一下还在不在 */
          if (cache.reviews.some(function (r) { return r.placeId === placeId; })) return saved;
          return client.from('places').select('id').eq('id', placeId).then(ok).then(function (rows) {
            if (!rows.length) cache.places = cache.places.filter(function (p) { return p.id !== placeId; });
            return saved;
          });
        });
      },
      setHome: function (h) {
        var id = uidNow();
        if (!id) return Promise.reject(new Error('login required'));
        var q = h
          ? withTimeout(client.from('homes').upsert({ user_id: id, city: h.city, lat: h.lat, lng: h.lng, is_public: !!h.public })).then(ok).then(function () { return withTimeout(client.from('homes').select('user_id, city, lat, lng, is_public').eq('user_id', id).single()); })
          : client.from('homes').delete().eq('user_id', id);
        return q.then(ok).then(function (row) {
          cache.homes = cache.homes.filter(function (x) { return x.userId !== id; });
          if (!h) return null;
          var home = homeFromRow(row);
          home.name = cache.profile.name || '';
          cache.homes.push(home);
          return home;
        });
      },
      avatarOf: function (id) {
        if (id && id === uidNow()) return cache.profile.avatar || '';
        for (var i = 0; i < cache.reviews.length; i++) if (cache.reviews[i].authorId === id && cache.reviews[i].authorAvatar) return cache.reviews[i].authorAvatar;
        return '';
      },
      setAvatar: function (out) {
        var uid = uidNow(), old = cache.profile.avatar;
        if (!uid) return Promise.reject(new Error('login required'));
        var path = uid + '/avatar-' + Date.now().toString(36) + '.jpg', bucket = client.storage.from('photos');
        return bucket.upload(path, out.blob, { contentType: 'image/jpeg', upsert: false }).then(ok).then(function () {
          return bucket.upload(thumbPath(path), out.thumb, { contentType: 'image/jpeg', upsert: false }).then(function () {}, function () {});
        }).then(function () {
          return client.from('profiles').update({ avatar: path }).eq('id', uid).then(ok);
        }).then(function () {
          photoURLs.set(path, URL.createObjectURL(out.blob)); photoURLs.set(path + THUMB_KEY, URL.createObjectURL(out.thumb));
          cache.profile.avatar = path;
          cache.reviews.forEach(function (r) { if (r.authorId === uid) r.authorAvatar = path; });
          if (old && old !== path) removePhotos([old]);
          return path;
        }, function (e) { bucket.remove([path, thumbPath(path)]).then(function () {}, function () {}); throw e; });
      },
      pagePublic: function (id) {
        if (id && id === uidNow()) return !!cache.profile.page_public;
        return cache.reviews.some(function (r) { return r.authorId === id && r.authorPage; });
      },
      updateProfile: function (patch) {
        if (!uidNow()) return Promise.reject(new Error('login required'));
        if (profileOwner !== uidNow()) profilePatch = {};
        profileOwner = uidNow();
        Object.keys(patch).forEach(function (k) { cache.profile[k] = patch[k]; profilePatch[k] = patch[k]; });
        cache.reviews.forEach(function (r) {
          if (r.authorId === uidNow()) { r.authorName = cache.profile.name || ''; r.authorPage = !!cache.profile.page_public; }
        });
        clearTimeout(profileTimer);
        profileTimer = setTimeout(function () { flushProfile().catch(function () { toast(t('saveFail')); }); }, 400);
        return Promise.resolve(cache.profile);
      },
      flushProfileChanges: function () { clearTimeout(profileTimer); return profileFlight.catch(function () {}).then(function () { return flushProfile(); }); },
      addArea: function (a) {
        var area = { id: uid('a'), name: a.name, lng: a.lng, lat: a.lat, zoom: a.zoom };
        areaCache.push(area);
        areas.save(areaCache);
        return Promise.resolve(area);
      },
      deleteArea: function (id) {
        areaCache = areaCache.filter(function (x) { return x.id !== id; });
        areas.save(areaCache);
        return Promise.resolve();
      },
      clearSamples: function () { return Promise.resolve(); },

      /* ---- 备份 ----
       * 导出：我自己的记录和它们的地点（照片是网址，不打包）。
       * 导入：把备份里的记录当成我的，上传到账号。用来把本地版存的东西搬上来。
       */
      exportBackup: function () {
        var mine = cache.reviews.filter(function (r) { return r.authorId === uidNow(); });
        var ids = {};
        mine.forEach(function (r) { ids[r.placeId] = 1; });
        return Promise.resolve({
          app: BACKUP_APP, version: 2, exportedAt: new Date().toISOString(), profile: cache.profile,
          places: cache.places.filter(function (p) { return ids[p.id]; }), reviews: mine, wishlist: cache.wishlist, areas: areaCache, photos: {}
        });
      },
      importBackup: function (obj) {
        if (!obj || BACKUP_APPS.indexOf(obj.app) === -1 || !Array.isArray(obj.places) || !Array.isArray(obj.reviews)) return Promise.resolve(-1);
        if (!uidNow()) return Promise.reject(new Error('login required'));
        var self = this;
        var srcPlaces = {}, newIds = {}, added = 0;
        obj.places.forEach(function (p) { if (p && p.id && !p.sample && CATS[p.mode]) srcPlaces[p.id] = p; });
        var reviews = obj.reviews.filter(function (r) { return r && !r.sample && srcPlaces[r.placeId]; });
        var photos = obj.photos || {};
        return reviews.reduce(function (chain, r) {
          return chain.then(function () {
            var src = srcPlaces[r.placeId];
            var placeStep = newIds[src.id] ? Promise.resolve(self.place(newIds[src.id])) : self.addPlace({
              mode: src.mode, cat: src.cat, precision: src.precision || 'exact', lat: src.lat, lng: src.lng,
              name: String(src.name || src.altName || '?').slice(0, 60), altName: String(src.altName || '').slice(0, 60), link: src.link || '', osm: src.osm || ''
            }).then(function (p) { newIds[src.id] = p.id; added++; return p; });
            return placeStep.then(function (p) {
              var blobs = (r.photos || []).filter(function (id) { return photos[id]; }).slice(0, MAX_PHOTOS).map(function (id) {
                return dataURLToBlob(photos[id]).then(function (b) { return { id: uid('ph'), blob: b }; });
              });
              return Promise.all(blobs).then(function (list) {
                return self.addReview({
                  placeId: p.id, rating: r.rating == null ? null : clamp(Math.round(r.rating * 2) / 2, 0, 5), price: r.price || null, priceCurrency: validPriceCurrency(r.priceCurrency),
                  title: r.title ? String(r.title).slice(0, 80) : null, text: String(r.text || '').slice(0, 1000), visibility: r.visibility === 'private' ? 'private' : 'public'
                }, list);
              });
            });
          });
        }, Promise.resolve()).then(function () {
          var wish = (obj.wishlist || []).map(function (w) { return newIds[w.placeId]; }).filter(Boolean);
          return Promise.all(wish.map(function (id) { return self.isSaved(id) ? null : self.setSaved(id, true); }));
        }).then(function () { return added; });
      }
    };
    ['addPlace','updatePlace','addReview','updateReview','moveReview','deleteReview','setSaved','updateProfile','setHome','deleteHome','moderateVisit'].forEach(function (name) {
      if (!api[name]) return;
      var original = api[name];
      api[name] = function () {
        if (offline && navigator.onLine === false) return Promise.reject(new Error('当前离线，请联网后保存。Offline: reconnect to save.'));
        var actor = uidNow();
        return original.apply(api, arguments).then(function (value) { if (actor === uidNow()) { saveOffline(); if (reader) reader.afterWrite(); } return value; });
      };
    });
    if (window.XueReads) reader = window.XueReads.create(client, { uid: uidNow, cache: function () { return cache; }, place: placeFromRow, review: reviewFromRow, home: homeFromRow, anon: ANON, save: saveOffline });
    api.pagedReads = function () { return !!(reader && reader.enabled()); };
    api.reader = function () { return reader; };
    api.mapGroups = function () { return reader && reader.enabled() ? reader.groups() : (cache.mapGroups || []).filter(function(g){return g.mode===state.mode;}); };
    return api;
  }

  /* 有 Supabase 配置就用线上版；地址里加 ?local 或者 supabase 库没加载出来时用本地版 */
  /* 店名搜索查的是 Supabase 里的公共地点库，本地版也能用 */
  function browserDeviceId() {
    var saved = lsGet('xuetuan:browser-device:v1');
    if (/^[a-f0-9-]{36}$/i.test(saved || '')) return saved;
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    var h = Array.from(bytes).map(function (x) { return x.toString(16).padStart(2,'0'); }).join('');
    saved = h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    lsSet('xuetuan:browser-device:v1',saved); return saved;
  }
  /* 在安卓 app 里（壳的 UA 带 XueTuanApp）谷歌登录在手机浏览器里做，做完跳回 xuetuan://auth，app 再把结果交给网页。
     要在 Supabase 的 Redirect URLs 里加上 xuetuan://auth，否则会跳回网站。 */
  function authReturnURL() {
    if (/XueTuanApp\//.test(navigator.userAgent)) return 'xuetuan://auth';
    var u = new URL(location.href), token = u.searchParams.get('_vercel_share');u.search = '';u.hash = '';
    if (token && /^[A-Za-z0-9_-]{10,200}$/.test(token)) u.searchParams.set('_vercel_share', token);
    return u.href;
  }
  /* Capture only OAuth errors before the SDK consumes the fragment; never copy tokens into application state. */
  var authCallbackProblem = (function () {
    var hash = new URLSearchParams(location.hash.slice(1)), query = new URLSearchParams(location.search);
    var code = hash.get('error_code') || query.get('error_code') || hash.get('error') || query.get('error');
    return code ? { code: code, description: hash.get('error_description') || query.get('error_description') || '' } : null;
  })();
  var sbClient = window.supabase && window.supabase.createClient && SUPABASE_URL ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { 'x-xuetuan-device': browserDeviceId() }, fetch: function (url, options) { if (navigator.onLine === false && options && options.method && !/^(GET|HEAD)$/i.test(options.method)) return Promise.reject(new Error('Offline: reconnect to send')); return fetch(url, options); } } }) : null;
  var store = (function () {
    var forceLocal = /[?&]local(=|&|$)/.test(location.search) || window.XUETUAN_LOCAL;
    if (!forceLocal && sbClient) return remoteStore(sbClient);
    return localStore();
  })();

  function loadView() {
    try { var raw = localStorage.getItem(LS_VIEW); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveView() {
    try {
      var v = loadView() || {};
      if (map) {
        var c = map.getCenter();
        v.center = [round6(c.lng), round6(c.lat)];
        v.zoom = Math.round(map.getZoom() * 100) / 100;
      }
      v.mode = state.mode; v.lang = state.lang; v.styleKey = state.styleKey;
      v.mineBoth = state.mineBoth; v.countries = state.countries; v.homesOn = state.homesOn;
      v.mineHomeOn = state.mineHomeOn; v.mineDots = state.mineDots;
      localStorage.setItem(LS_VIEW, JSON.stringify(v));
    } catch (e) { /* storage blocked: keep going */ }
  }

  var photoStore = {
    db: null, mem: new Map(), ready: null,
    open: function () {
      var self = this;
      if (self.ready) return self.ready;
      self.ready = new Promise(function (resolve) {
        var req;
        try { req = indexedDB.open('xmum-chiwan-photos', 1); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = function () { req.result.createObjectStore('photos'); };
        req.onsuccess = function () { self.db = req.result; resolve(self.db); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      });
      return self.ready;
    },
    put: function (id, blob) {
      var self = this;
      return self.open().then(function (db) {
        if (!db) { self.mem.set(id, blob); return false; }
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction('photos', 'readwrite');
            tx.objectStore('photos').put(blob, id);
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = tx.onabort = function () { self.mem.set(id, blob); resolve(false); };
          } catch (e) { self.mem.set(id, blob); resolve(false); }
        });
      });
    },
    get: function (id) {
      var self = this;
      if (self.mem.has(id)) return Promise.resolve(self.mem.get(id));
      return self.open().then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
          try {
            var r = db.transaction('photos').objectStore('photos').get(id);
            r.onsuccess = function () { resolve(r.result || null); };
            r.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      });
    },
    del: function (id) {
      this.mem.delete(id);
      return this.open().then(function (db) {
        if (!db) return;
        try { db.transaction('photos', 'readwrite').objectStore('photos').delete(id); } catch (e) { /* ignore */ }
      });
    }
  };

  /* ================= helpers ================= */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  /* 哈萨克语 / 印尼语界面（用户 2026-11-03）：state.lang 仍是 'en'，英文文案经 L() 查 data/i18n-ui.js 换成译文 */
  function uiLang() {
    if (state.lang !== 'en') return state.lang;
    var v = lsGet('xuetuan:trlang');
    return v === 'kk' || v === 'id' ? v : 'en';
  }
  function L(s) {
    if (state.lang !== 'en') return s;
    var u = uiLang(), d = u !== 'en' && window.XUETUAN_UI && window.XUETUAN_UI[u];
    return d && d[s] != null ? d[s] : s;
  }
  function t(key, vars) {
    var table = I18N[state.lang] || I18N.zh;
    var s = table[key] != null ? table[key] : (I18N.zh[key] != null ? I18N.zh[key] : key);
    if (state.lang === 'en') s = L(s);
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function newClientId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16), i;
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for (i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
    b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round6(v) { return Math.round(v * 1e6) / 1e6; }
  function haversine(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fmtDist(m) {
    if (m < 100) return Math.round(m) + ' m';
    if (m < 1000) return Math.round(m / 10) * 10 + ' m';
    if (m < 10000) return (m / 1000).toFixed(1) + ' km';
    return Math.round(m / 1000).toLocaleString(state.lang === 'zh' ? 'zh-CN' : 'en-MY') + ' km';
  }
  function fmtPrice(n) { var v = Math.round(n * 10) / 10; return v % 1 === 0 ? String(v) : v.toFixed(1); }
  /* 人均按地点所在地的货币（用户 2026-11-02）：人民币（中国大陆）、港币、澳门元、新币、欧元、澳元、美元、加元、英镑，
     别的地方（日本、韩国、台湾、泰国、印尼…）都用 RM。界面使用货币简称，人民币显示 RMB（数据库仍用标准 CNY）。
     places.cc 存两位代码，新建地点时问 Photon；马来西亚大部分范围直接认，不用问 */
  var EURO_CC = 'AT BE BG HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES MC SM VA AD ME XK'.split(' ');
  var CUR_SYM = { CN: 'RMB', HK: 'HKD', MO: 'MOP', SG: 'SGD', AU: 'AUD', US: 'USD', CA: 'CAD', GB: 'GBP', EUR: 'EUR' };
  /* 筛选“RM x 左右”时换成 RM 大概比（2026-11 的约值，够筛选用） */
  var CUR_RM = { CN: 0.6, HK: 0.52, MO: 0.50, SG: 3.3, AU: 2.8, US: 4.2, CA: 3.0, GB: 5.6, EUR: 4.8 };
  function curKey(cc) { cc = String(cc || '').toUpperCase(); return EURO_CC.indexOf(cc) !== -1 ? 'EUR' : CUR_SYM[cc] ? cc : ''; }
  var ccCache = new Map(), ccRequests = new Map();
  /* Only a lookup candidate area, never a currency boundary: Shenzhen/Zhuhai must stay CNY. */
  function regionalCurArea(lat, lng) { return lat > 22.05 && lat < 22.65 && lng > 113.45 && lng < 114.5; }
  function ccKey(lat, lng) { var digits = regionalCurArea(lat, lng) ? 5 : 2; return (+lat).toFixed(digits) + ',' + (+lng).toFixed(digits); }
  function photonCurrencyCC(props) {
    props = props || {};
    var cc = String(props.countrycode || '').toUpperCase(), region = String(props.state || '');
    if (cc === 'CN') {
      if (/香港|hong\s*kong|^HK$/i.test(region)) return 'HK';
      if (/澳[門门]|macau|macao|^MO$/i.test(region)) return 'MO';
    }
    return /^[A-Z]{2}$/.test(cc) ? cc : '';
  }
  var regionalCurAsked = new Set(), regionalCurQueue = [], regionalCurActive = 0, regionalCurTimer = null;
  function refreshRegionalCurrency() {
    clearTimeout(regionalCurTimer);
    regionalCurTimer = setTimeout(function () {
      /* Refresh visible amounts, without rebuilding an unfinished form or photo import. */
      if (state.view === 'form') {
        var f = state.form, p = f && f.placeId ? placeById(f.placeId) : null, loc = f && formCurLoc(f, p), lab = $('label[for="f-price"]');
        if (lab && loc) updateFormCurrency();
      } else if (state.bulk) (state.bulk.groups || []).forEach(setBulkCur);
      else if (!state.picking && !document.querySelector('input:focus, textarea:focus, select:focus')) { render(); refreshMap(); }
    }, 100);
  }
  function drainRegionalCurrency() {
    if (regionalCurActive >= 2 || !regionalCurQueue.length) return;
    var p = regionalCurQueue.shift(); regionalCurActive++;
    ccAt(p.lat, p.lng).then(function (cc) { if (cc === 'HK' || cc === 'MO') refreshRegionalCurrency(); }).finally(function () { regionalCurActive--; drainRegionalCurrency(); });
    drainRegionalCurrency();
  }
  function warmRegionalCurrency(p) {
    var cc = String(p.cc || '').toUpperCase(), key = ccKey(p.lat, p.lng);
    if ((cc && cc !== 'CN') || !regionalCurArea(p.lat, p.lng) || ccCache.has(key) || regionalCurAsked.has(key)) return;
    regionalCurAsked.add(key); regionalCurQueue.push({ lat: p.lat, lng: p.lng }); drainRegionalCurrency();
  }
  /* 新加坡和新山挨着，那一块不猜，要问 */
  function ccBox(lat, lng) {
    if (lat > 1.1 && lat < 1.6 && lng > 103.5 && lng < 104.2) return '';
    return lat > 0.85 && lat < 7.4 && lng > 99.6 && lng < 119.3 ? 'MY' : '';
  }
  function ccNow(lat, lng) { if (lat == null || lng == null) return ''; return ccBox(lat, lng) || ccCache.get(ccKey(lat, lng)) || ''; }
  function ccAt(lat, lng) {
    if (lat == null || lng == null) return Promise.resolve('');
    var known = ccNow(lat, lng), key = ccKey(lat, lng);
    if (known) return Promise.resolve(known);
    if (ccRequests.has(key)) return ccRequests.get(key);
    if (window.__ccAt) return Promise.resolve(window.__ccAt(lat, lng)); /* 测试用 */
    var url = 'https://photon.komoot.io/reverse?lat=' + (+lat).toFixed(5) + '&lon=' + (+lng).toFixed(5) + '&limit=1';
    var ask = fetch(url).then(function (res) { return res.ok ? res.json() : null; }).then(function (json) {
      var f = json && json.features && json.features[0], cc = photonCurrencyCC(f && f.properties);
      if (/^[A-Z]{2}$/.test(cc)) { ccCache.set(key, cc); if (regionalCurAsked.has(key) && (cc === 'HK' || cc === 'MO')) refreshRegionalCurrency(); return cc; }
      return '';
    }).catch(function () { return ''; });
    var request = Promise.race([ask, new Promise(function (r) { setTimeout(function () { r(''); }, 3000); })]);
    ccRequests.set(key, request);
    request.finally(function () { ccRequests.delete(key); });
    return request;
  }
  function placeCC(p) {
    if (!p) return '';
    if (p.lat != null && p.lng != null) warmRegionalCurrency(p);
    var stored = String(p.cc || '').toUpperCase(), cached = ccNow(p.lat, p.lng);
    return (!stored || stored === 'CN' ? cached || stored : stored) || '';
  }
  function curSymAt(cc) { return CUR_SYM[curKey(cc)] || 'RM'; }
  function curSym(p) { return curSymAt(placeCC(p)); }
  function money(p, n) { return curSym(p) + ' ' + fmtPrice(n); }
  function priceRM(p, n) { return n ? n * (CUR_RM[curKey(placeCC(p))] || 1) : n; }
  window.__curSym = function (cc) { return curSymAt(cc); }; /* 测试用 */
  /* Original amounts are stored with their currency. Conversion is display-only and approximate.
     JP/KR/TH/ID/TW keep the previous MYR default; their local currency is opt-in. */
  var LOCAL_PRICE_CUR = { CN:'CNY', HK:'HKD', MO:'MOP', SG:'SGD', AU:'AUD', US:'USD', CA:'CAD', GB:'GBP', EUR:'EUR', JP:'JPY', KR:'KRW', TH:'THB', ID:'IDR', TW:'TWD' };
  var PRICE_SYM = { MYR:'RM', CNY:'RMB', HKD:'HKD', MOP:'MOP', SGD:'SGD', AUD:'AUD', USD:'USD', CAD:'CAD', GBP:'GBP', EUR:'EUR', JPY:'JPY', KRW:'KRW', THB:'THB', IDR:'IDR', TWD:'TWD' };
  /* Budget estimates, not a live or transaction exchange rate. */
  var PRICE_RATE = { MYR:1, CNY:CUR_RM.CN, HKD:CUR_RM.HK, MOP:CUR_RM.MO, SGD:CUR_RM.SG, AUD:CUR_RM.AU, USD:CUR_RM.US, CAD:CUR_RM.CA, GBP:CUR_RM.GB, EUR:CUR_RM.EUR, JPY:.026, KRW:.0031, THB:.12, IDR:.00025, TWD:.13 };
  var priceViews = new Map();
  function validPriceCurrency(c) { return Object.prototype.hasOwnProperty.call(PRICE_SYM, c) ? c : null; }
  function localPriceCurrency(p) { var cc = placeCC(p); return LOCAL_PRICE_CUR[EURO_CC.indexOf(cc) !== -1 ? 'EUR' : cc] || 'MYR'; }
  function defaultPriceCurrency(p) { return LOCAL_PRICE_CUR[curKey(placeCC(p))] || 'MYR'; }
  function priceRate(c) { return PRICE_RATE[validPriceCurrency(c) || 'MYR']; }
  /* Halal（用户 2026-11-03：不用分那么细，只标 Halal，地图上一个小按钮只看 Halal；自动判断，仅供参考）。
     先看 data/halal.js 里用户确认过的名单（学校按 楼·铺位，校外按店名 + 200 米；名单说不是的就不是），
     再按店名认清真连锁和穆斯林菜系，最后按分类（嘛嘛、马来餐；娘惹除外）。店名带猪肉的一律不算。
     记录里的 halal 字段等 visits.halal 列建好后再用（同学自己标） */
  var HALAL = ['halal', 'porkfree', 'nonhalal'];
  function validHalal(v) { return HALAL.indexOf(v) !== -1 ? v : null; }
  var HALAL_NO = /pork|猪|bak ?kut ?teh|肉骨茶|char ?siu|叉烧|siew ?yoke|烧肉|non[- ]?halal|beer|啤酒|wine bar/;
  var HALAL_NAME = new RegExp([
    'halal', 'mcdonald', "mcd\\b", '麦当劳', 'kfc', '肯德基', 'burger king', 'marrybrown', 'texas chicken', "a&w", 'domino', 'pizza hut', 'subway', 'nando',
    'sukiya', 'yoshinoya', 'sushi king', 'the tokyo', 'pak punjab', 'punjab', 'pakistan', 'arab', 'mandi', 'kebab', 'shawarma', 'biryani', 'briyani',
    'nasi kandar', 'mamak', 'ayam penyet', 'nasi lemak', 'zus coffee', 'tealive', 'chatime', 'starbucks', 'coffee bean', 'secret recipe', 'oldtown',
    'papparich', 'llao llao', 'baskin', 'mixue', '蜜雪', '新疆', 'xinjiang', 'uyghur', 'uighur', '维吾尔', '兰州', 'lanzhou', 'muslim', '穆斯林', '清真'
  ].join('|'));
  function halalName() { return 'Halal'; }
  /* 名单：返回 true / false（名单里说不是）/ null（名单里没有） */
  function halalListed(p) {
    var H = window.XUETUAN_HALAL;
    if (!H) return null;
    var s = typeof campusShop === 'function' && campusShop(p);
    if (s && H.campus[s.block + ' · ' + s.lot]) return H.campus[s.block + ' · ' + s.lot].v !== 'nonhalal';
    var name = String(p.name || '').toLowerCase();
    for (var i = 0; i < H.places.length; i++) {
      var x = H.places[i];
      if (name && haversine(x, p) <= 200 && x.keys.some(function (k) { return name.indexOf(k) !== -1; })) return x.v !== 'nonhalal';
    }
    return null;
  }
  function isHalal(p) {
    if (!p || p.mode !== 'food') return false;
    var listed = halalListed(p);
    if (listed !== null) return listed;
    var name = (String(p.name || '') + ' ' + String(p.altName || '')).toLowerCase();
    if (HALAL_NO.test(name)) return false;
    if (HALAL_NAME.test(name)) return true;
    return p.cat === 'mamak' || (p.cat === 'malay' && !/nyonya|娘惹|peranakan/.test(name));
  }
  function placeHalal(p) { return isHalal(p) ? { v: 'halal' } : null; }
  function halalFits(p) { return !state.halal || isHalal(p); }
  function halalTagHTML(p) {
    if (!isHalal(p)) return '';
    var tip = state.lang === 'en' ? L('Guessed from the name and category, please check yourself') : '按店名和分类自动判断，仅供参考，请自行确认';
    return '<span class="tag halal-tag" title="' + esc(tip) + '">Halal</span>';
  }
  function reviewPriceCurrency(p, r) { return validPriceCurrency(r && r.priceCurrency) || defaultPriceCurrency(p); }
  function reviewPriceRM(p, r) { return r.price * priceRate(reviewPriceCurrency(p, r)); }
  function priceChoices(p, keep) { var local = localPriceCurrency(p), a = ['MYR']; if (local !== 'MYR') a.push(local); if (validPriceCurrency(keep) && a.indexOf(keep) < 0) a.push(keep); return a; }
  function formPricePlace() { var f = state.form; return f && (f.placeId ? placeById(f.placeId) : f.loc) || null; }
  function formPriceCurrency() { return validPriceCurrency(state.form && state.form.priceCurrency) || defaultPriceCurrency(formPricePlace()); }
  function priceSelectOptions(p, current) { return priceChoices(p,current).map(function (c) { return '<option value="' + c + '"' + (c === current ? ' selected' : '') + '>' + esc(PRICE_SYM[c]) + '</option>'; }).join(''); }
  function formPriceFieldHTML() {
    var c = formPriceCurrency();
    return fieldHTML('f-price', esc(t('priceFood',{c:PRICE_SYM[c]})), '<div class="price-input-row"><select id="f-price-currency" class="input price-unit" aria-label="' + esc(state.lang === 'en' ? L('Price currency') : '金额币种') + '">' + priceSelectOptions(formPricePlace(), c) + '</select><input id="f-price" class="input" type="number" inputmode="decimal" min="0" max="99999999.99" step="0.01"></div>');
  }
  function updateFormCurrency() {
    var lab = $('label[for="f-price"]'), sel = $('#f-price-currency'), c = formPriceCurrency();
    if (lab) lab.textContent = t('priceFood',{c:PRICE_SYM[c]});
    if (sel) sel.innerHTML = priceSelectOptions(formPricePlace(), c);
  }
  function priceToggleHTML(p, amount, currency, key) {
    amount = Number(amount); if (!isFinite(amount) || amount <= 0) return '<span>—</span>';
    var local = localPriceCurrency(p), source = validPriceCurrency(currency) || defaultPriceCurrency(p), target = priceViews.get(key) || defaultPriceCurrency(p);
    if (target !== 'MYR' && target !== local) target = defaultPriceCurrency(p);
    var n = amount * priceRate(source) / priceRate(target), approx = source !== target;
    var text = (approx ? (state.lang === 'en' ? '≈ ' : '约 ') : '') + PRICE_SYM[target] + ' ' + fmtPrice(n);
    if (local === 'MYR') return '<span>' + esc(text) + '</span>';
    var next = target === 'MYR' ? local : 'MYR';
    var label = text + (state.lang === 'en' ? L('; switch to ') : '，点击切换为 ') + PRICE_SYM[next] + (approx ? (state.lang === 'en' ? L('; estimated rate') : '，估算汇率') : '');
    return '<button type="button" class="price-toggle" data-action="price-toggle" data-price-key="' + esc(key) + '" data-price-place="' + esc(p.id || '') + '" data-price-cc="' + esc(placeCC(p)) + '" data-price-amount="' + amount + '" data-price-source="' + source + '" data-price-target="' + target + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><span>' + esc(text) + '</span><i aria-hidden="true">↔</i></button>';
  }
  function togglePrice(el) {
    var d = el.dataset, p = placeById(d.pricePlace) || {cc:d.priceCc}, next = d.priceTarget === 'MYR' ? localPriceCurrency(p) : 'MYR';
    priceViews.set(d.priceKey, next);
    /* Keep photos, scroll position and the surrounding card untouched. */
    var wrap = document.createElement('div'); wrap.innerHTML = priceToggleHTML(p,+d.priceAmount,d.priceSource,d.priceKey);
    var fresh = wrap.firstElementChild; el.replaceWith(fresh); fresh.focus({preventScroll:true});
  }
  function timeAgo(ts) {
    var d = Date.now() - ts, min = 60000;
    if (d < min) return t('justNow');
    if (d < 60 * min) return t('minAgo', { n: Math.floor(d / min) });
    if (d < 24 * 60 * min) return t('hourAgo', { n: Math.floor(d / (60 * min)) });
    if (d < 30 * 24 * 60 * min) return t('dayAgo', { n: Math.floor(d / (24 * 60 * min)) });
    var dt = new Date(ts);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  /* 内容编辑不刷新展示时间；只看原记录日期与照片ID中已有的添加时间。updated_at保留作内部修改时间。 */
  function photoUploadedAt(id) {
    var m = /(?:^|\/)ph-([0-9a-z]{8})/.exec(String(id || '')), n = m ? parseInt(m[1], 36) : 0;
    return n > 1.6e12 && n <= Date.now() + 864e5 ? n : 0;
  }
  function reviewActivityAt(r) {
    return Math.max(Number(r.createdAt) || 0,
      (r.photos || []).reduce(function (latest, id) { return Math.max(latest, photoUploadedAt(id)); }, 0));
  }
  function visitDay(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function reviewTimeLabel(r) {
    var at = reviewActivityAt(r), changed = at > (r.createdAt || 0) + 60000;
    return (state.lang === 'en' ? L('Visited ') : '到访 ') + visitDay(r.createdAt) +
      (changed ? ' · ' + (state.lang === 'en' ? L('Updated ') : '更新于 ') + timeAgo(at) : ' · ' + timeAgo(at));
  }
  /* 照片自己的拍摄时间：新传的照片把手机里读到的拍摄时间写进文件名（ph-xxx-t<36进制毫秒>），不用改数据库。
     以前传的照片压缩时拍摄信息已经去掉，读不到 */
  var PHOTO_T_MIN = Date.UTC(2000, 0, 1);
  function takenSuffix(ts) { ts = Math.round(Number(ts) || 0); return ts >= PHOTO_T_MIN && ts <= Date.now() ? '-t' + ts.toString(36) : ''; }
  function photoTakenAt(id) {
    var m = /-t([0-9a-z]{7,9})(?:_t)?(?:\.\w+)?$/.exec(String(id || '')), n = m ? parseInt(m[1], 36) : 0;
    return n >= PHOTO_T_MIN && n <= Date.now() + 864e5 ? n : 0;
  }
  /* 照片下面的日期（用户 2026-11-04：上传那天不对，要真实时间）：
     照片自己的拍摄时间 > 这条记录的到访日期（可以在编辑里改）> 上传时间 */
  function photoDateInfo(id,r) {
    var taken=photoTakenAt(id), visit=Number(r&&r.createdAt)||0, at=taken||visit||photoUploadedAt(id), en=state.lang==='en';
    return {at:at,label:taken?(en?L('Taken '):'拍摄 '):visit?(en?L('Visited '):'到访 '):(en?L('Added '):'添加 ')};
  }
  function photoDateLabel(id,r) { var d=photoDateInfo(id,r);return d.at?d.label+visitDay(d.at):''; }
  function photoDateHTML(id,r) {
    var d=photoDateInfo(id,r);if(!d.at)return '';
    return '<time class="photo-date" datetime="'+esc(new Date(d.at).toISOString())+'" title="'+esc(photoDateLabel(id,r))+'" aria-label="'+esc(photoDateLabel(id,r))+'">'+esc(visitDay(d.at))+'</time>';
  }
  function safeURL(u) {
    u = (u || '').trim();
    if (!u) return '';
    try {
      var url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (e) { return ''; }
  }

  function me() { return store.me(); }
  var placeLookup={list:null,n:-1,by:new Map()};
  function placeById(id) { var list=store.places();if(list!==placeLookup.list||list.length!==placeLookup.n){placeLookup={list:list,n:list.length,by:new Map(list.map(function(p){return [p.id,p];}))};}return placeLookup.by.get(id)||null; }
  function reviewsOf(placeId) { return store.reviewsOf(placeId); }
  /* 按地点分好的记录：画图钉时每个地点都要找自己的记录，原来每次都扫一遍全部记录，
     地点和记录一多就是“地点数 × 记录数”，手机上会卡好几秒。记录数组换了或长度变了才重新分（2026-10-27 提速） */
  var rIdx = { list: null, n: -1, by: null };
  function reviewsByPlace(list, placeId) {
    if (list !== rIdx.list || list.length !== rIdx.n) {
      var by = new Map();
      list.forEach(function (r) { var a = by.get(r.placeId); if (!a) by.set(r.placeId, a = []); a.push(r); });
      rIdx = { list: list, n: list.length, by: by };
    }
    var got = rIdx.by.get(placeId);
    return got ? got.slice() : [];
  }
  function isMine(r) { return r.authorId === me().id; }
  function isModerator() { return !!(store.isAdmin && store.isAdmin()); }
  function moderationControl(r) {
    return isModerator() && r.visibility === 'public' ? '<button type="button" class="link-btn danger" data-action="moderation" data-id="' + esc(r.id) + '">' + esc(state.lang === 'en' ? L('Moderate') : '管理内容') + '</button>' : '';
  }
  function securitySaveError(e) {
    var msg = String(e && e.message || e || '');
    if (/XUETUAN_.*BLOCKED/.test(msg)) return state.lang === 'en' ? L('Publishing is restricted for this account or browser.') : '该账号或浏览器已被限制发布。';
    if (/XUETUAN_RATE_LIMIT/.test(msg)) return state.lang === 'en' ? L('Too many requests. Please try later.') : '操作太频繁，请稍后再试；草稿仍保留。';
    if (/XUETUAN_WRITE_LOST/.test(msg)) return /MicroMessenger/i.test(navigator.userAgent) ? (state.lang === 'en' ? L('WeChat did not deliver this save. Tap ··· at the top right, open in your browser, and save again.') : '微信没把这次保存发出去。点右上角“···”→在浏览器打开，再保存一次。') : (state.lang === 'en' ? L('The network is too slow, so this was not saved. Your draft is kept; tap save again.') : '网络太慢，这次没存上。草稿还在，再点一次保存。');
    if (/XUETUAN_SAVE_TIMEOUT|Failed to fetch|NetworkError|Load failed|Offline/i.test(msg)) return state.lang === 'en' ? L('The network is too slow, so this was not saved. Your draft is kept; tap save again.') : '网络太慢，这次没存上。草稿还在，再点一次保存。';
    if (/XUETUAN_RELOAD_REQUIRED/.test(msg)) return state.lang === 'en' ? L('Refresh to use the updated security settings.') : '防护已更新，请刷新页面后再操作。';
    return state.lang === 'en' ? L('Save failed. Your draft is kept; please try again.') : '保存失败，草稿仍保留，请稍后重试。';
  }
  function openModeration(id) {
    var r = store.review(id);
    if (!isModerator() || !r || r.visibility !== 'public') return;
    openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>' + esc(state.lang === 'en' ? L('Moderate public content') : '管理公开内容') + '</h3><p>' + esc(state.lang === 'en' ? L('Remove this post and its media. A browser ban can be bypassed by clearing data or changing browsers.') : '删除会移除这条内容及其图片。封禁限制账号及已记录的浏览器标识；清除数据或更换浏览器可能绕过浏览器限制。') + '</p><button type="button" class="btn danger" data-action="moderation-confirm" data-id="' + esc(id) + '" data-decision="delete">' + esc(state.lang === 'en' ? L('Delete content and media') : '删除内容和图片') + '</button><button type="button" class="btn danger" data-action="moderation-confirm" data-id="' + esc(id) + '" data-decision="delete_and_ban">' + esc(state.lang === 'en' ? L('Delete and ban author') : '删除并封禁作者') + '</button><button type="button" class="btn ghost" data-modal="no">' + esc(t('cancel')) + '</button></div>');
  }
  var moderationBusy = false;
  function moderateVisit(id, decision) {
    if (!isModerator() || moderationBusy) return;
    moderationBusy = true;
    $$('#modal button').forEach(function (b) { b.disabled = true; });
    store.moderateVisit(id,decision).then(function (r) {
      closeModal(); refreshMap(); goFeed();
      toast(r.mediaOk ? (state.lang === 'en' ? L('Content removed') : r.banned ? '内容已删除，作者及已记录浏览器已封禁' : '内容和图片已删除') : (state.lang === 'en' ? L('Post removed; retry media cleanup in My account.') : '内容已删除，图片清理失败，可在“我的”重试清理'));
    }, function (e) { toast(securitySaveError(e)); $$('#modal button').forEach(function (b) { b.disabled = false; }); }).then(function () { moderationBusy = false; });
  }
  /* 三种地图：all = 探索（公开记录），mine = 我的足迹，saved = 收藏（公开记录 + 我自己的） */
  function scopedReviews(placeId, scope) {
    scope = scope || state.scope;
    return reviewsOf(placeId).filter(function (r) {
      if (scope === 'mine') return isMine(r);
      if (scope === 'saved') return r.visibility === 'public' || isMine(r);
      if (scope === 'person') return r.visibility === 'public' && !!state.person && r.authorId === state.person.id;
      return r.visibility === 'public';
    });
  }
  /* 看得到的地点：有公开记录或我自己的记录，或者我想去（收藏了还没人记录的地方也算） */
  function visibleToMe(p) {
    return store.isSaved(p.id) || !!(p._overview && p._overview.all && (p._overview.all.count || p._overview.all.own)) || reviewsOf(p.id).some(function (r) { return r.visibility === 'public' || isMine(r); });
  }
  /* 再加上我自己建的空地点（线上版收藏又取消后，地点还留着），找同一个地方时复用它，不重复建 */
  function knownToMe(p) { var id = me().id; return visibleToMe(p) || (!!id && p.createdBy === id); }
  function beenThere(p) { return !!(p._overview && p._overview.all && p._overview.all.own) || reviewsOf(p.id).some(isMine); }
  /* 地点的封面：这张地图里看得到的记录中，最新一条带照片的第一张 */
  function coverPhoto(p, scope) {
    var summary = placeOverview(p, scope); if (summary) return summary.cover;
    var best = null;
    scopedReviews(p.id, scope).forEach(function (r) {
      if (r.photos && r.photos.length && (!best || reviewActivityAt(r) > reviewActivityAt(best))) best = r;
    });
    return best ? best.photos[0] : null;
  }
  function placePhotos(p) {
    var seen = {}, photos = [];
    scopedReviews(p.id).slice().sort(function (a, b) { return reviewActivityAt(b) - reviewActivityAt(a); }).forEach(function (r) {
      (r.photos || []).forEach(function (id) { if (!seen[id]) { seen[id] = true; photos.push(id); } });
    });
    if (!photos.length) { var summary=placeOverview(p); if (summary && summary.cover) photos.push(summary.cover); }
    return photos;
  }
  function placeOverview(p, scope) { scope = scope || state.scope; return (scope === 'all' || scope === 'saved') && p._overview && p._overview[scope] || null; }
  function placePhotoCount(p) { var summary=placeOverview(p); return summary ? summary.photoCount : placePhotos(p).length; }
  function savedStatusMatches(p) {
    var status = state.savedWant ? 'want' : state.savedStatus;
    return status === 'want' ? !beenThere(p) : status === 'been' ? beenThere(p) : true;
  }
  function inScope(p) {
    if (state.scope === 'saved') return store.isSaved(p.id) && visibleToMe(p) && savedStatusMatches(p);
    var summary=placeOverview(p);
    return summary ? summary.count > 0 : scopedReviews(p.id).length > 0;
  }
  function avgOf(list, key) {
    return list.length ? list.reduce(function (s, r) { return s + r[key]; }, 0) / list.length : null;
  }
  /* score：我的地图用我自己的分，探索和收藏用公开记录的平均分；没人打分是 null。
     平均分不算 0 分（防恶意差评，用户 2026-10-27）；只有 0 分时才显示 0 */
  function stats(p) {
    var overview = placeOverview(p);
    if (overview) {
      var total=0,n=0; (overview.prices || []).forEach(function(x){total+=x.total*priceRate(x.currency || defaultPriceCurrency(p));n+=x.count;});
      return {rs:scopedReviews(p.id),count:overview.count,score:overview.score,raters:overview.raters,zeros:overview.zeros,avgPrice:n?total/n/priceRate(defaultPriceCurrency(p)):0};
    }
    var rs = scopedReviews(p.id);
    if (state.scope === 'mine') rs = rs.filter(function (r) { return ownVisitMatches(p,r); });
    var scored = (state.scope === 'mine' ? rs : rs.filter(function (r) { return r.visibility === 'public'; }))
      .filter(function (r) { return r.rating != null; });
    var priced = rs.filter(function (r) { return r.price > 0; });
    var positive = scored.filter(function (r) { return r.rating > 0; });
    var score = positive.length ? avgOf(positive, 'rating') : scored.length ? 0 : null;
    return {
      rs: rs, count: rs.length, raters: positive.length || scored.length, zeros: positive.length ? scored.length - positive.length : 0,
      score: score == null ? null : Math.round(score * 10) / 10,
      avgPrice: priced.length ? priced.reduce(function (sum, r) { return sum + reviewPriceRM(p, r); }, 0) / priced.length / priceRate(defaultPriceCurrency(p)) : 0
    };
  }

  /* 评分颜色：0 灰 → 2.5 橙 → 5 红；没分是浅灰 */
  var SCORE_STOPS = [[0, [142, 152, 147]], [2.5, [240, 140, 0]], [5, [215, 38, 30]]];
  var NO_SCORE_COLOR = '#B9C1BD';
  function scoreColor(s) {
    if (s == null) return NO_SCORE_COLOR;
    s = clamp(s, 0, 5);
    var i = s <= 2.5 ? 0 : 1, a = SCORE_STOPS[i], b = SCORE_STOPS[i + 1];
    var k = (s - a[0]) / (b[0] - a[0]);
    return '#' + a[1].map(function (v, j) { return Math.round(v + (b[1][j] - v) * k).toString(16).padStart(2, '0'); }).join('');
  }
  function fmtScore(s) { return s % 1 === 0 ? String(s) : s.toFixed(1); }
  function scoreHTML(s) {
    if (s == null) return '';
    return '<span class="score" style="--c:' + scoreColor(s) + '" role="img" aria-label="' + esc(t('scoreAria', { n: fmtScore(s) })) + '">' + fmtScore(s) + '</span>';
  }

  /* ================= 星星 =================
   * 五颗星，可以半颗（0.5 一档）。打分时点或左右拖，拖到最左边是 0 分；颜色跟着分数变（和地图图钉一样） */
  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z"/></svg>';
  function starCells(v) {
    var h = '';
    for (var i = 0; i < 5; i++) {
      var f = v == null ? 0 : clamp(v - i, 0, 1);
      h += '<span class="st">' + STAR_SVG + '<span class="st-fill" style="width:' + (f * 100) + '%">' + STAR_SVG + '</span></span>';
    }
    return h;
  }
  /* 只看的小星星：每条点评自己的分 */
  function starsMiniHTML(v) {
    if (v == null) return '';
    return '<span class="stars-mini" style="--c:' + scoreColor(v) + '" role="img" aria-label="' + esc(t('scoreAria', { n: fmtScore(v) })) + '">' + starCells(v) + '</span>';
  }
  /* 打分用的：commit 是松手后要做的事（表单里直接记下分数；地点卡片上带着分数进表单） */
  function starsInputHTML(id, v, commit, labelId) {
    return '<div class="stars-input" id="' + id + '" role="slider" tabindex="0" data-commit="' + commit + '" aria-labelledby="' + labelId + '" aria-valuemin="0" aria-valuemax="5"' +
      (v == null ? '' : ' aria-valuenow="' + v + '" aria-valuetext="' + esc(t('scoreAria', { n: fmtScore(v) })) + '"') + ' style="--c:' + scoreColor(v) + '">' +
      '<span class="stars-track">' + starCells(v) + '</span><b class="stars-val">' + (v == null ? esc(t('starsNone')) : fmtScore(v)) + '</b></div>';
  }
  function setStars(el, v) {
    el.style.setProperty('--c', scoreColor(v));
    $$('.st-fill', el).forEach(function (f, i) { f.style.width = (clamp(v - i, 0, 1) * 100) + '%'; });
    el.setAttribute('aria-valuenow', v);
    el.setAttribute('aria-valuetext', t('scoreAria', { n: fmtScore(v) }));
    $('.stars-val', el).textContent = fmtScore(v);
  }
  /* 手指在第几颗星的哪一半：左半颗 = x.5，右半颗 = 整颗；比第一颗还左 = 0 */
  function starsValueAt(el, x) {
    var cells = $$('.stars-track .st', el);
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (i === 0 && x < r.left) return 0;
      /* 星星之间的空隙算前一颗的满星 */
      var next = cells[i + 1] ? cells[i + 1].getBoundingClientRect().left : Infinity;
      if (x < next) return i + (x < r.left + r.width / 2 ? 0.5 : 1);
    }
    return 5;
  }
  function commitStars(el, v) {
    var c = el.dataset.commit;
    if (c === 'form') { if (state.form) { state.form.rating = v; var e = $('#err-rating'); if (e) e.hidden = true; } }
    else if (c === 'place-score') { var spid = state.placeId; if (spid && requireLogin(function () { startReview(spid, v); })) startReview(spid, v); }
    else if (c === 'preview-score') { if (state.preview) addFromResult(state.preview, false, v); }
    else if (c === 'bulk') bulkRate(el, v);
  }
  (function setupStars() {
    var active = null;
    document.addEventListener('pointerdown', function (e) {
      var track = e.target.closest && e.target.closest('.stars-track'), el = track && track.closest('.stars-input');
      if (!el || (state.form && state.form.saving) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      active = { el: el, id: e.pointerId, x: e.clientX, y: e.clientY, moving: false, v: starsValueAt(el, e.clientX) };
      /* 按下时不抢滚动、不改分；轻点松手确认，横向拖动才预览。 */
    });
    document.addEventListener('pointermove', function (e) {
      if (!active || e.pointerId !== active.id) return;
      if (!active.moving) {
        var dx = Math.abs(e.clientX - active.x), dy = Math.abs(e.clientY - active.y);
        if (dy > 6 && dy >= dx) { active = null; return; }
        if (dx < 6) return;
        active.moving = true;
        try { active.el.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var v = starsValueAt(active.el, e.clientX);
      if (v !== active.v) { active.v = v; setStars(active.el, v); }
    });
    function finish(e) {
      if (!active || e.pointerId !== active.id) return;
      var a = active;
      active = null;
      if (e.type === 'pointerup') { setStars(a.el, a.v); commitStars(a.el, a.v); }
      else {
        var old = a.el.dataset.commit === 'form' && state.form ? state.form.rating : a.el.dataset.commit === 'bulk' && bulkGroupOf(a.el) ? bulkGroupOf(a.el).rating : null;
        if (old != null) setStars(a.el, old);
        else { a.el.removeAttribute('aria-valuenow'); a.el.removeAttribute('aria-valuetext'); $('.stars-val', a.el).textContent = t('starsNone'); $$('.st-fill', a.el).forEach(function (fill) { fill.style.width = '0%'; }); }
      }
    }
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    /* 键盘：左右键半颗半颗地调，Home 0 分，End 5 分；卡片上按回车确认 */
    document.addEventListener('keydown', function (e) {
      var el = e.target.closest && e.target.closest('.stars-input');
      if (!el) return;
      var cur = el.hasAttribute('aria-valuenow') ? +el.getAttribute('aria-valuenow') : 0;
      var step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
      var v = step != null ? clamp(cur + step, 0, 5) : e.key === 'Home' ? 0 : e.key === 'End' ? 5 : null;
      if (v != null) {
        e.preventDefault();
        setStars(el, v);
        if (el.dataset.commit === 'form' || el.dataset.commit === 'bulk') commitStars(el, v);
      } else if ((e.key === 'Enter' || e.key === ' ') && el.dataset.commit !== 'form' && el.dataset.commit !== 'bulk' && el.hasAttribute('aria-valuenow')) {
        e.preventDefault();
        commitStars(el, cur);
      }
    });
  })();

  /* 美食按出行范围分层，按到 XMUM 的直线距离算（用户 2026-11-02 重新定的，量了实际的店）：
     步行 = 学校、Bell、Monet、南边住宅区夜市（≤1.3km）；短途打车 = 西边 29 号路的麦当劳(1.7km)、Kota Warisan、Gao Gao 一带（≤6km）；
     中距离 = 龙溪(Dengkil)、IOI City Mall(约15km)、布城（≤20km）；吉隆坡 = 市区和西边几个区（≤50km）；再远 = 出了吉隆坡 */
  var DIST_TIERS = [
    { id: 'walk', max: 1300 },
    { id: 'short', max: 6000 },
    { id: 'mid', max: 20000 },
    { id: 'kl', max: 50000 },
    { id: 'far', max: Infinity }
  ];
  /* XMUM 校园大致的长方形范围（北边的路、东边 Persiaran Sunsuria、南边 Jalan Sunsuria，用户 2026-11-02 截图里量的）。
     框里的地点不说“距 XMUM 多少米”，就写“XMUM” */
  var XMUM_BOX = { s: 2.8290, n: 2.8372, w: 101.6978, e: 101.7086 };
  function inCampus(p) { return !!p && p.lat >= XMUM_BOX.s && p.lat <= XMUM_BOX.n && p.lng >= XMUM_BOX.w && p.lng <= XMUM_BOX.e; }
  function distLabel(p) { return inCampus(p) ? 'XMUM' : t('distFrom', { d: fmtDist(haversine(XMUM, p)) }); }
  window.__distLabel = distLabel; /* 测试用 */
  /* 龙溪(Dengkil)镇上离 XMUM 只有 3–5 公里，按直线会落进短途；用户说龙溪算中距离（2026-11-02）：镇中心 2.2 公里内都算中距离 */
  var DENGKIL = { lat: 2.8605, lng: 101.6790 };
  function distTier(p) {
    var d = haversine(XMUM, p);
    if (d > 1300 && d <= 20000 && haversine(DENGKIL, p) <= 2200) return 'mid';
    for (var i = 0; i < DIST_TIERS.length; i++) if (d <= DIST_TIERS[i].max) return DIST_TIERS[i].id;
    return 'far';
  }
  /* 我的地图选“合并”时吃和玩一起显示 */
  function modeOk(p) { return p.mode === state.mode || (state.scope === 'mine' && state.mineBoth) || state.scope === 'person'; }
  function passesFilters(p, s) {
    if (!modeOk(p)) return false;
    if (state.scope === 'person') return true;
    if (state.scope === 'mine' && !scopedReviews(p.id).some(function (r) { return ownVisitMatches(p,r); })) return false;
    if (state.cat !== 'all' && !catMatch(p, state.cat)) return false;
    s = s || stats(p);
    if (state.priceAbout && !priceFits(priceRM(p, s.avgPrice), state.priceAbout)) return false;
    if (state.minScore && !(s.score != null && s.score >= state.minScore)) return false;
    if (state.dist !== 'any' && distTier(p) !== state.dist) return false;
    if (state.halal && !halalFits(p)) return false;
    return true;
  }
  function ownVisitMatches(p,r) {
    return (!state.minScore || (r.rating != null && r.rating >= state.minScore)) && (!state.priceAbout || priceFits(reviewPriceRM(p,r),state.priceAbout));
  }
  function filtersActive() { return state.scope !== 'person' && (state.cat !== 'all' || !!state.priceAbout || !!state.minScore || state.dist !== 'any' || !!state.halal); }
  var scopeFilterMemory = {};
  function changeMapScope(next) {
    if (state.scope === next) return;
    var keys = ['cat','minScore','dist','priceAbout','halal'], old = {};
    keys.forEach(function(k){ old[k]=state[k]; }); scopeFilterMemory[state.scope] = old;
    state.scope = next;
    var saved = scopeFilterMemory[next] || {cat:'all',minScore:0,dist:'any',priceAbout:0,halal:''};
    keys.forEach(function(k){ state[k]=saved[k]; });
  }
  function catOf(p) {
    var list = CATS[p.mode] || CATS.food;
    for (var i = 0; i < list.length; i++) if (list[i].id === p.cat) return list[i];
    return list[list.length - 1];
  }
  /* 地点库里还是旧的“日韩”：按店名分到日料/韩餐/烤肉，分不出来算日料 */
  function normCat(cat, name) {
    if (cat !== 'jpkr') return cat;
    var n = nameCat(name);
    return n === 'kr' || n === 'bbq' ? n : 'jp';
  }
  window.__normCat = normCat; /* 测试用 */
  function catChoices(mode) { return CATS[mode].filter(function (c) { return !c.hidden; }); }
  function catMatch(p, cat) {
    /* 旧的“日韩”在筛日料或韩餐时都算上 */
    return p.cat === cat || (p.cat === 'jpkr' && (cat === 'jp' || cat === 'kr'));
  }
  function catName(c) { return state.lang === 'en' ? L(c.en) : c.zh; }
  function precLabel(k) { return t({ exact: 'precExact', area: 'precArea', city: 'precCity' }[k] || 'precExact'); }
  function placeTitle(p) { var name = state.lang === 'en' ? (p.altName || p.name) : (p.name || p.altName); return /^(没起名的地方|没起名的店|Unnamed spot|Unnamed place)$/i.test(name || '') ? t('unnamedTravel') : name; }
  function placeSub(p) {
    var main = placeTitle(p), other = state.lang === 'en' ? p.name : p.altName;
    return other && other !== main ? other : '';
  }
  function authorLabel(r) {
    if (r.authorId === me().id) return me().name || t('you');
    if (r.sample) return t('sampleAuthor');
    return r.authorName || t('anon');
  }
  /* “来自 X”：作者公开了的家（自己的也只在公开后显示，和别人看到的一样） */
  function homeOf(userId) {
    var list = store.homes();
    for (var i = 0; i < list.length; i++) if (list[i].userId === userId) return list[i];
    return null;
  }
  /* 游客号（没绑定谷歌）只能存私密：分享到大地图、公开家乡、个人主页都要先绑定（2026-11-01 有人用 30 个游客号刷屏） */
  function isGuest() { return !!(store.isAnon && store.isAnon()); }
  function guestBlocked() {
    if (!isGuest()) return false;
    var en = state.lang === 'en';
    openModal('<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="guest-title"><h3 id="guest-title">' + esc(en ? L('Link Google to share') : '绑定谷歌后才能分享') + '</h3><p class="f-hint">' + esc(en ? L('Guest accounts can only keep private records. Link Google to share to the big map; everything you saved stays.') : '游客号只能存给自己看的记录。绑定谷歌后就能分享到大地图，已经存的记录都还在。') + '</p><div class="btn-row"><button type="button" class="btn primary" data-action="link-google">' + esc(en ? L('Link Google') : '绑定谷歌') + '</button><button type="button" class="btn ghost" data-modal="no">' + esc(en ? L('Not now') : '先不用') + '</button></div></div>');
    return true;
  }
  /* 个人主页：作者自己打开了才能点进（自己的总能点，看看别人眼里的样子） */
  function canOpenPerson(id) { return !!id && id !== 'sample' && (id === me().id || store.pagePublic(id)); }
  /* 没公开主页的人（线上版）：点名字弹一张小卡片，能发私信（用户 2026-11-03：点头像没反应、找不到私信） */
  function personAttr(id) {
    if (canOpenPerson(id)) return ' data-action="person" data-uid="' + esc(id) + '"';
    return store.mode === 'remote' && id && id !== 'sample' ? ' data-action="person-card" data-uid="' + esc(id) + '"' : '';
  }
  function openPersonCard(id) {
    var r = store.reviews().filter(function (x) { return x.authorId === id; })[0], en = state.lang === 'en';
    var name = (r && r.authorName) || t('anon');
    openModal('<div class="modal-card person-card" role="dialog" aria-modal="true" aria-labelledby="pcard-name">' + avatarHTML(name, id) + '<h3 id="pcard-name">' + esc(name) + '</h3>' +
      '<p class="f-hint">' + esc(en ? L('This classmate keeps their page private.') : 'TA 还没公开主页') + '</p>' +
      '<div class="btn-row"><button type="button" class="btn primary" data-action="dm-open" data-peer="' + esc(id) + '" data-name="' + esc(name) + '">' + esc(en ? L('Message') : '发私信') + '</button><button type="button" class="btn ghost" data-modal="no">' + esc(en ? L('Close') : '关闭') + '</button></div></div>');
  }
  function authorFrom(r) { var h = r.authorId && homeOf(r.authorId); return h && h.public ? h.city : ''; }
  function homeName(h) { return h.userId === me().id ? (me().name || t('you')) : (h.name || t('anon')); }
  function reviewText(r) { return state.lang === 'en' && r.textEn ? r.textEn : (r.text || ''); }
  /* 编辑时照片的先后（第一张是封面）：原有的和新加的可以混着排，order 里 k = 原来的照片，n = 第几张新照片 */
  function orderPhotos(keep, added, order) {
    if (!order || !order.length) return keep.concat(added);
    var out = [];
    order.forEach(function (o) { var v = o.k != null ? (keep.indexOf(o.k) >= 0 ? o.k : null) : added[o.n]; if (v && out.indexOf(v) < 0) out.push(v); });
    keep.concat(added).forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); });
    return out;
  }
  /* 头像颜色从一组配好的颜色里挑（按名字固定），不会再出现橄榄绿、土黄这种和蓝白不搭的色；没名字是浅灰蓝（2026-11-01 精修） */
  var AVATAR_COLORS = ['#5B8DEF', '#45A7C4', '#7C6FE0', '#E0719E', '#EF9A5A', '#4FB08A', '#3F7DC0', '#A77AD6', '#E5868A', '#2FA3A0'];
  /* userId 有头像照片就显示照片（图片由 hydrateAvatars 填上），没有就是名字第一个字 */
  function avatarHTML(name, userId) {
    var av = userId && store && store.avatarOf ? store.avatarOf(userId) : '';
    if (av) return '<span class="avatar has-photo" aria-hidden="true"><img data-avatar="' + esc(av) + '" alt=""></span>';
    var str = String(name || '?').trim();
    var ch = Array.from(str)[0] || '?', h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    var color = ch === '?' ? '#AEBDCC' : AVATAR_COLORS[h % AVATAR_COLORS.length];
    return '<span class="avatar" style="--av:' + color + '" aria-hidden="true">' + esc(ch.toUpperCase()) + '</span>';
  }
  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>';
  /* 雪团子：logo 里那颗眨眼的小雪球，画成矢量；首页没有分享时用（开屏动画在 index.html 里有同样的一颗） */
  function mascotHTML() {
    return '<svg class="mascot" viewBox="0 0 100 100" aria-hidden="true">' +
      '<defs><radialGradient id="mascot-g" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#fff"/><stop offset=".62" stop-color="#F3F8FD"/><stop offset="1" stop-color="#D5E5F4"/></radialGradient></defs>' +
      '<ellipse cx="50" cy="91" rx="26" ry="4.5" fill="#2E7DCB" opacity=".14"/>' +
      '<circle cx="50" cy="52" r="37" fill="url(#mascot-g)"/>' +
      '<circle cx="38.5" cy="50" r="5" fill="#1E3350"/><circle cx="40.2" cy="48.3" r="1.6" fill="#fff"/>' +
      '<path d="M56.5 51.2q5.6-6.4 11.4 0" fill="none" stroke="#1E3350" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M42 59.5h16a8 7.4 0 0 1-16 0z" fill="#1E3350"/><ellipse cx="50" cy="64.4" rx="4" ry="2.2" fill="#F28BA0"/>' +
      '<ellipse cx="30.5" cy="60" rx="6" ry="3.6" fill="#F6A9B8" opacity=".8"/><ellipse cx="69.5" cy="60" rx="6" ry="3.6" fill="#F6A9B8" opacity=".8"/>' +
      '<path d="M84 9c1 6.6 2.8 8.4 9.4 9.4-6.6 1-8.4 2.8-9.4 9.4-1-6.6-2.8-8.4-9.4-9.4 6.6-1 8.4-2.8 9.4-9.4z" fill="#8CC4F2"/></svg>';
  }
  function catIconHTML(c) { return '<i class="cat-ic" aria-hidden="true">' + c.emoji + '</i>'; }
  function accentColor() { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2E7DCB'; }

