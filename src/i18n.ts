import { CameraMode, QualityPreset, WeatherMode, WorldMapId } from './game/types';

export type GameLang = 'uz' | 'ru' | 'en';

export const LANG_STORAGE_KEY = 'lost_world_lang';

export function getInitialLanguage(): GameLang {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved === 'uz' || saved === 'ru' || saved === 'en') {
        return saved;
      }
    } catch {
      // Ignore storage errors
    }
  }
  return 'uz';
}

export interface TranslationBundle {
  gameTitle: string;
  subtitleBadge: string;
  heroDescription: string;
  heroTags: [string, string, string];
  graphicsLabel: string;
  audioOnLabel: string;
  audioMutedLabel: string;
  enterWorld: string;
  loadingWorld: string;
  offlineBanner: string;
  installApp: string;
  installIOS: string;
  installModalTitle: string;
  installModalTitleIOS: string;
  installModalSubtitle: string;
  installStep1IOS: string;
  installStep1IOSBold: string;
  installStep1IOSRest: string;
  installStep2IOS: string;
  installStep2IOSBold1: string;
  installStep2IOSMid: string;
  installStep2IOSBold2: string;
  installStep1Desktop: string;
  installStep2Desktop: string;
  installStep2DesktopBold1: string;
  installStep2DesktopMid: string;
  installStep2DesktopBold2: string;
  gotIt: string;
  closeLabel: string;
  vitals: {
    stamina: string;
    warmth: string;
    hydration: string;
  };
  fpsSuffix: string;
  landscape: string;
  touchOn: string;
  touchOff: string;
  hideControls: string;
  showSettings: string;
  tabs: {
    graphics: string;
    weather: string;
    world: string;
    controls: string;
  };
  actions: {
    slash: string;
    cleave: string;
    dodge: string;
    light: string;
    audioOn: string;
    audioOff: string;
  };
  prompts: {
    extinguishCampfire: string;
    igniteCampfire: string;
    swimmingHint: string;
    drinkWater: string;
    caveFlashlight: string;
  };
  mobile: {
    crouch: string;
    crouched: string;
    fastSwim: string;
    sprint: string;
    extinguish: string;
    ignite: string;
    drink: string;
    guard: string;
    cleave: string;
    dodge: string;
    dash: string;
    slash: string;
    climb: string;
    jump: string;
    switchCamera: string;
    toggleFlashlight: string;
  };
  qualityPresetLabel: string;
  qualityNames: Record<QualityPreset, string>;
  qualityDesc: Record<QualityPreset, string>;
  graphicsFlags: {
    hdr: string;
    rayReflections: string;
    giAndAo: string;
    clarity: string;
    on: string;
    off: string;
    aa: string;
  };
  weatherOptions: Record<WeatherMode, string>;
  timeControls: {
    resume: string;
    pause: string;
    dawn: string;
    noon: string;
    sunset: string;
    night: string;
    cycle24h: string;
  };
  cameraModes: Record<CameraMode, string>;
  landmarks: Record<string, string>;
  controlsTab: {
    lookSensitivity: string;
    moveKey: string;
    moveDesc: string;
    lookKey: string;
    lookDesc: string;
    slashKey: string;
    slashDesc: string;
    cleaveKey: string;
    cleaveDesc: string;
    dodgeKey: string;
    dodgeDesc: string;
    guardKey: string;
    guardDesc: string;
    moveActionsKey: string;
    moveActionsDesc: string;
    gearActionsKey: string;
    gearActionsDesc: string;
  };
  cardinals: string[];
  biomes: Record<string, string>;
  weatherStatus: Record<string, string>;
  loadStages: Record<string, string>;
  map: {
    title: string;
    minimapLabel: string;
    openMap: string;
    closeMap: string;
    currentMapTab: string;
    allMapsTab: string;
    activeBadge: string;
    enterMapBtn: string;
    loadingMapLabel: string;
    chooseStartMap: string;
    playerMarker: string;
    campfire: string;
    bridge: string;
    coordinates: string;
    teleportHint: string;
    northShort: string;
    styles: {
      TOPO: string;
      SATELLITE: string;
      RADAR: string;
      ELEVATION: string;
    };
    legend: {
      forest: string;
      water: string;
      mountain: string;
      desert: string;
      marsh: string;
    };
  };
  worldMaps: Record<WorldMapId, { name: string; desc: string }>;
  webglErrorFallback: string;
}

export const TRANSLATIONS: Record<GameLang, TranslationBundle> = {
  uz: {
    gameTitle: 'TIRIK QOLISH: YO‘QOLGAN DUNYO',
    subtitleBadge: '3D Ochiq Dunyo Sayohati va Tirik Qolish',
    heroDescription:
      'Tog‘ vodiylarini kashf eting, qarag‘ay daryolari va Aks-sado g‘oridan o‘ting, chuqur oqimlarda suzing va jonli 24 soatlik ob-havo tizimiga moslashing.',
    heroTags: ['Jonli yorug‘lik va akslar', 'Suzish va daryo fizikasi', 'Mobil landshaft rejimi'],
    graphicsLabel: 'Grafika',
    audioOnLabel: 'Ovoz: Yoqilgan',
    audioMutedLabel: 'Ovoz: O‘chiq',
    enterWorld: 'Dunyoga kirish',
    loadingWorld: 'Dunyo yuklanmoqda...',
    offlineBanner: 'Oflayn rejim — Saqlangan dunyo fayllari faol',
    installApp: 'Ilovani o‘rnatish',
    installIOS: 'iOS ga o‘rnatish',
    installModalTitle: 'Yo‘qolgan Dunyo ilovasini o‘rnatish',
    installModalTitleIOS: 'iPhone / iPad ga o‘rnatish',
    installModalSubtitle: 'Internetsiz va to‘liq ekran rejimida o‘ynang',
    installStep1IOS: 'Safari panelidagi',
    installStep1IOSBold: 'Ulashish',
    installStep1IOSRest: 'tugmasini bosing.',
    installStep2IOS: 'Pastga tushing va',
    installStep2IOSBold1: 'Bosh ekranga qo‘shish',
    installStep2IOSMid: 'ni tanlab,',
    installStep2IOSBold2: 'Qo‘shish',
    installStep1Desktop: 'Agar ko‘rib chiqish oynasida bo‘lsangiz, ilovani brauzerning alohida sahifasida oching.',
    installStep2Desktop: 'Chrome yoki Edge menyusidan',
    installStep2DesktopBold1: 'Ilovani o‘rnatish',
    installStep2DesktopMid: 'yoki',
    installStep2DesktopBold2: 'Bosh ekranga qo‘shish',
    gotIt: 'Tushunarli',
    closeLabel: 'O‘rnatish yo‘riqnomasini yopish',
    vitals: {
      stamina: 'Quvvat',
      warmth: 'Issiqlik',
      hydration: 'Suv',
    },
    fpsSuffix: 'FPS',
    landscape: 'Landshaft',
    touchOn: 'Sensor Yoq',
    touchOff: 'Sensor O‘ch',
    hideControls: 'Boshqaruvni yashirish (H)',
    showSettings: 'Sozlamalar va Dunyo',
    tabs: {
      graphics: 'Grafika',
      weather: 'Ob-havo va Osmon',
      world: 'Dunyo va Kamera',
      controls: 'Boshqaruv',
    },
    actions: {
      slash: 'Zarba (J)',
      cleave: 'Kuchli (K)',
      dodge: 'Sakrash (Q)',
      light: 'Fonar (F)',
      audioOn: 'Ovoz Yoq',
      audioOff: 'Ovoz O‘ch',
    },
    prompts: {
      extinguishCampfire: '[E] Gulxanni o‘chirish',
      igniteCampfire: '[E] Gulxanni yoqish',
      swimmingHint: 'Suzish · [Shift] Tez suzish · [Space] Qirg‘oqqa chiqish',
      drinkWater: '[E] Toza suv ichish',
      caveFlashlight: '[F] G‘or ichida fonarni yoqish',
    },
    mobile: {
      crouch: 'Egilish',
      crouched: 'Egilgan',
      fastSwim: 'Tez suzish',
      sprint: 'Yugurish',
      extinguish: 'O‘chirish',
      ignite: 'Yoqish',
      drink: 'Ichish',
      guard: 'Himoya',
      cleave: 'Kuchli',
      dodge: 'Uchinish',
      dash: 'Tezlanish',
      slash: 'Zarba',
      climb: 'Chiqish',
      jump: 'Sakrash',
      switchCamera: 'Kamerani almashtirish',
      toggleFlashlight: 'Fonarni yoqish/o‘chirish',
    },
    qualityPresetLabel: 'Sifat darajasi',
    qualityNames: {
      LOW: 'PAST',
      MEDIUM: 'O‘RTA',
      HIGH: 'YUQORI',
      ULTRA: 'ULTRA',
      CINEMATIC: 'KINO',
    },
    qualityDesc: {
      LOW: '512px · Tezkor relyef · Oddiy yorug‘lik',
      MEDIUM: '1024px Soya · HDR · Tiniq tafsilot · 5.2k O‘t',
      HIGH: '2048px Soya · Nur akslari · SMAA · 12k O‘t',
      ULTRA: '2048px Hi-DPI · Yuqori aniqlik · SMAA · 18k O‘t',
      CINEMATIC: '4096px Soya · Maksimal HDR & GI · 24k O‘t',
    },
    graphicsFlags: {
      hdr: 'HDR Ranglar',
      rayReflections: 'Suv va Nur Akslari',
      giAndAo: 'Global Yoritish',
      clarity: 'Tiniq Tafsilot',
      on: 'YOQ',
      off: 'O‘CH',
      aa: 'Silliqlash',
    },
    weatherOptions: {
      DYNAMIC: 'Dinamik',
      CLEAR: 'Ochiq',
      FOGGY: 'Tuman',
      RAIN: 'Yomg‘ir',
      STORM: 'Bo‘ron',
      SNOW: 'Qor',
    },
    timeControls: {
      resume: 'Davom',
      pause: 'To‘xtatish',
      dawn: 'Tong',
      noon: 'Tush',
      sunset: 'Shom',
      night: 'Tun',
      cycle24h: '24 soatlik sikl',
    },
    cameraModes: {
      THIRD_PERSON: '3-shaxs',
      FIRST_PERSON: '1-shaxs',
      CINEMATIC_ORBIT: 'Kino kamera',
    },
    landmarks: {
      camp: 'O‘rmon lageri',
      waterfall: 'Kaskad sharsharasi',
      village: 'Tashlandiq qishloq',
      cavern: 'Aks-sado g‘ori',
      peak: 'Alp cho‘qqisi',
      desert: 'Za’faron qumlar',
      glacier_camp: 'Muz tizmasi lageri',
      frozen_basin: 'Muzlagan qo‘sh ko‘l',
      frost_spire: 'Qorli cho‘qqi',
      ice_pass: 'Shimoliy muz dovoni',
      crystal_overlook: 'Billur qoya',
      snow_pine: 'Qorli qarag‘ayzor',
      isle_camp: 'Markaziy orol',
      crescent_lagoon: 'Hilol ko‘rfazi',
      sunset_atoll: 'Shom oroli',
      twin_palms: 'Janubiy qo‘ltiq',
      north_spire_isle: 'Shimoliy qoya oroli',
      coral_sandbar: 'Marjon sayozligi',
      canyon_camp: 'Voha tepaligi',
      oasis_pool: 'Zumrad voha',
      red_mesa: 'Qizil yassi tog‘',
      sun_gorge: 'Quyosh darasi',
      dune_sea: 'Oltin barxanlar',
      south_arch: 'Janubiy kanyon',
      marsh_camp: 'Moxli tepalik',
      cypress_heart: 'Sarv o‘rmoni',
      whisper_fen: 'Sokin qamishzor',
      sunken_delta: 'Daryo deltasi',
      mist_ridge: 'Tumanli adir',
      reed_shore: 'Qamish kechuvi',
      caldera_camp: 'Krater dovoni',
      crater_heart: 'Markaziy bazalt orol',
      north_rim: 'Shimoliy vulkan halqasi',
      east_ash: 'Sharqiy kul tizmasi',
      west_vents: 'G‘arbiy yonbag‘ir',
      outer_valley: 'Tashqi lava vodiysi',
      fjord_camp: 'Yarimorol lageri',
      west_fjord: 'G‘arbiy fyord qirg‘og‘i',
      east_fjord: 'Sharqiy qoyalar',
      glacier_head: 'Shimoliy muz devori',
      south_strait: 'Janubiy bo‘g‘oz',
      granite_lookout: 'Granit kuzatuv nuqtasi',
      meadow_camp: 'Gulli yaylov lageri',
      river_bend: 'Oltin burilish',
      birch_terrace: 'Qayinzor supasi',
      sunny_crest: 'Quyoshli tepalik',
      orchard_vale: 'Janubiy vodiy',
      high_moor: 'Shimoliy yaylov',
    },
    controlsTab: {
      lookSensitivity: 'Kamera sezgirligi',
      moveKey: 'WASD / Joystik',
      moveDesc: 'Harakatlanish',
      lookKey: 'Surish / Sichqoncha',
      lookDesc: 'Atrofga qarash',
      slashKey: 'J / Chap tugma',
      slashDesc: 'Tez zarba',
      cleaveKey: 'K / O‘ng tugma',
      cleaveDesc: 'Kuchli zarba',
      dodgeKey: 'Q',
      dodgeDesc: 'Chap berish',
      guardKey: 'R',
      guardDesc: 'Himoya',
      moveActionsKey: 'Shift / Space / C',
      moveActionsDesc: 'Yugurish / Sakrash / Egilish',
      gearActionsKey: 'F / E / V / M',
      gearActionsDesc: 'Fonar / Gulxan / Kamera / Xarita',
    },
    cardinals: ['Sh', 'ShSh', 'Shq', 'JSh', 'J', 'JG‘', 'G‘', 'ShG‘'],
    biomes: {
      'Echo Cavern': 'Aks-sado g‘ori',
      'Crystal Basin': 'Billur ko‘l',
      'Abandoned Settlement': 'Tashlandiq qishloq',
      'Glacial Peaks': 'Muz cho‘qqilar',
      'Granite Foothills': 'Granit tog‘ etaklari',
      'Saffron Dunes': 'Za’faron barxanlar',
      'Misty Wetlands': 'Tumanli botqoqlik',
      'Wildflower Meadow': 'Gulli yaylov',
      'Emerald Old-Growth': 'Zumrad o‘rmon',
    },
    weatherStatus: {
      Thunderstorm: 'Momaqaldiroq',
      'Steady Rain': 'Yomg‘ir',
      'Alpine Snowfall': 'Tog‘ qori',
      'Dense Valley Mist': 'Qalin vodiy tumani',
      'Clear Breeze': 'Ochiq shabada',
    },
    loadStages: {
      'Preparing Expedition...': 'Sayohat tayyorlanmoqda...',
      'Initializing WebGL2 & HDR Pipeline': 'WebGL2 va HDR tizimi ishga tushmoqda',
      'Generating Procedural PBR Materials': 'PBR materiallar va teksturalar yaratilmoqda',
      'Sculpting Valley Terrain, River & Bridge': 'Vodiy relyefi, daryo va ko‘prik qurilmoqda',
      'Seeding Pine Forests, Flora & Wildlife': 'Qarag‘ay o‘rmonlari va jonivorlar joylanmoqda',
      'Compiling Shaders & Reflection Probes': 'Sheyderlar va akslar sozlanmoqda',
      'Expedition Ready': 'Sayohatga tayyor!',
    },
    map: {
      title: 'Dunyo xaritasi va hududlar',
      minimapLabel: 'Xarita (M)',
      openMap: 'Xaritani ochish',
      closeMap: 'Yopish',
      currentMapTab: 'Joriy xarita',
      allMapsTab: 'Barcha xaritalar (8)',
      activeBadge: 'Faol',
      enterMapBtn: 'Shu xaritaga o‘tish',
      loadingMapLabel: 'Hududga o‘tilmoqda...',
      chooseStartMap: 'Xaritani tanlang',
      playerMarker: 'Sizning joyingiz',
      campfire: 'Gulxan',
      bridge: 'Yog‘och ko‘prik',
      coordinates: 'Koordinata',
      teleportHint: 'Tez borish uchun belgini bosing',
      northShort: 'Sh',
      styles: {
        TOPO: 'Topografik',
        SATELLITE: 'Tabiiy',
        RADAR: 'Radar',
        ELEVATION: 'Balandlik',
      },
      legend: {
        forest: 'O‘rmon',
        water: 'Daryo va ko‘l',
        mountain: 'Tog‘ va qor',
        desert: 'Qum barxanlari',
        marsh: 'Botqoqlik',
      },
    },
    worldMaps: {
      lost_valley: { name: 'Yo‘qolgan vodiy', desc: 'O‘rmon, sharshara, g‘or va qishloq' },
      alpine_glacier: { name: 'Muzlik cho‘qqilari', desc: 'Qorli tog‘lar va muzlagan ko‘llar' },
      emerald_archipelago: { name: 'Zumrad orollar', desc: 'Orollar, qumli sohillar va dengiz' },
      saffron_canyon: { name: 'Qizil kanyon', desc: 'Sahro barxanlari va zumrad voha' },
      misty_wetlands: { name: 'Tumanli botqoq', desc: 'Daryo tarmoqlari va moxli orolchalar' },
      crimson_caldera: { name: 'Vulkan krateri', desc: 'Halqa tog‘lar va krater ko‘li' },
      twin_fjords: { name: 'Egizak fyordlar', desc: 'Chuqur bo‘g‘ozlar va tik qoyalar' },
      highland_meadows: { name: 'Tog‘ yaylovlari', desc: 'Gulli adirlar va sokin daryo' },
    },
    webglErrorFallback: 'Ushbu qurilmada 3D WebGL grafikasi ishga tushmadi.',
  },
  ru: {
    gameTitle: 'ВЫЖИВАНИЕ: ЗАТЕРЯННЫЙ МИР',
    subtitleBadge: '3D Открытый мир и приключения',
    heroDescription:
      'Исследуйте горные долины, пересекайте сосновые реки и Пещеру Эха, плавайте в глубоких течениях и адаптируйтесь к живому 24-часовому циклу погоды.',
    heroTags: ['Свет и отражения в реальном времени', 'Физика плавания и воды', 'Альбомный режим'],
    graphicsLabel: 'Графика',
    audioOnLabel: 'Звук: Вкл',
    audioMutedLabel: 'Звук: Выкл',
    enterWorld: 'Войти в мир',
    loadingWorld: 'Загрузка мира...',
    offlineBanner: 'Офлайн-режим — Используются сохранённые ресурсы',
    installApp: 'Установить приложение',
    installIOS: 'Установить на iOS',
    installModalTitle: 'Установить Затерянный мир',
    installModalTitleIOS: 'Установить на iPhone / iPad',
    installModalSubtitle: 'Играйте офлайн на полном экране',
    installStep1IOS: 'Нажмите кнопку',
    installStep1IOSBold: 'Поделиться',
    installStep1IOSRest: 'в панели Safari.',
    installStep2IOS: 'Прокрутите вниз и выберите',
    installStep2IOSBold1: 'На экран «Домой»',
    installStep2IOSMid: ', затем нажмите',
    installStep2IOSBold2: 'Добавить',
    installStep1Desktop: 'Откройте игру в отдельной вкладке браузера, если она запущена во встроенном окне.',
    installStep2Desktop: 'В меню Chrome или Edge выберите',
    installStep2DesktopBold1: 'Установить приложение',
    installStep2DesktopMid: 'или',
    installStep2DesktopBold2: 'Добавить на гл. экран',
    gotIt: 'Понятно',
    closeLabel: 'Закрыть инструкцию по установке',
    vitals: {
      stamina: 'Сила',
      warmth: 'Тепло',
      hydration: 'Вода',
    },
    fpsSuffix: 'FPS',
    landscape: 'Альбом',
    touchOn: 'Сенсор Вкл',
    touchOff: 'Сенсор Выкл',
    hideControls: 'Скрыть панель (H)',
    showSettings: 'Настройки и Мир',
    tabs: {
      graphics: 'Графика',
      weather: 'Погода и Небо',
      world: 'Мир и Камера',
      controls: 'Управление',
    },
    actions: {
      slash: 'Удар (J)',
      cleave: 'Мощный (K)',
      dodge: 'Рывок (Q)',
      light: 'Фонарь (F)',
      audioOn: 'Звук Вкл',
      audioOff: 'Звук Выкл',
    },
    prompts: {
      extinguishCampfire: '[E] Потушить костёр',
      igniteCampfire: '[E] Разжечь костёр',
      swimmingHint: 'Плавание · [Shift] Быстрый кроль · [Space] На берег',
      drinkWater: '[E] Выпить чистой воды',
      caveFlashlight: '[F] Включить фонарь в Пещере Эха',
    },
    mobile: {
      crouch: 'Присесть',
      crouched: 'Сидя',
      fastSwim: 'Быстро',
      sprint: 'Бег',
      extinguish: 'Потушить',
      ignite: 'Разжечь',
      drink: 'Пить',
      guard: 'Щит',
      cleave: 'Мощный',
      dodge: 'Уворот',
      dash: 'Рывок',
      slash: 'Удар',
      climb: 'На берег',
      jump: 'Прыжок',
      switchCamera: 'Сменить камеру',
      toggleFlashlight: 'Вкл/выкл фонарь',
    },
    qualityPresetLabel: 'Качество',
    qualityNames: {
      LOW: 'НИЗК',
      MEDIUM: 'СРЕДН',
      HIGH: 'ВЫСОК',
      ULTRA: 'УЛЬТРА',
      CINEMATIC: 'КИНО',
    },
    qualityDesc: {
      LOW: '512px · Быстрый ландшафт · Базовый свет',
      MEDIUM: '1024px Тени · HDR · Чёткость · 5.2k Трава',
      HIGH: '2048px Тени · Отражения · SMAA · 12k Трава',
      ULTRA: '2048px Hi-DPI · Высокая чёткость · SMAA · 18k Трава',
      CINEMATIC: '4096px Тени · Макс HDR & GI · 24k Трава',
    },
    graphicsFlags: {
      hdr: 'HDR Тон',
      rayReflections: 'Отражения лучей',
      giAndAo: 'Глобальный свет',
      clarity: 'Чёткость',
      on: 'ВКЛ',
      off: 'ВЫКЛ',
      aa: 'Сглаживание',
    },
    weatherOptions: {
      DYNAMIC: 'Динамич.',
      CLEAR: 'Ясно',
      FOGGY: 'Туман',
      RAIN: 'Дождь',
      STORM: 'Гроза',
      SNOW: 'Снег',
    },
    timeControls: {
      resume: 'Продолж.',
      pause: 'Пауза',
      dawn: 'Рассвет',
      noon: 'Полдень',
      sunset: 'Закат',
      night: 'Ночь',
      cycle24h: '24ч цикл',
    },
    cameraModes: {
      THIRD_PERSON: 'От 3-го лица',
      FIRST_PERSON: 'От 1-го лица',
      CINEMATIC_ORBIT: 'Кино-орбита',
    },
    landmarks: {
      camp: 'Лесной лагерь',
      waterfall: 'Водопад Каскад',
      village: 'Заброшенная деревня',
      cavern: 'Пещера Эха',
      peak: 'Альпийский хребет',
      desert: 'Шафрановые дюны',
      glacier_camp: 'Ледяной лагерь',
      frozen_basin: 'Ледяные озёра',
      frost_spire: 'Снежный шпиль',
      ice_pass: 'Северный перевал',
      crystal_overlook: 'Кристальный утёс',
      snow_pine: 'Снежный бор',
      isle_camp: 'Остров Святилище',
      crescent_lagoon: 'Атолл Полумесяц',
      sunset_atoll: 'Остров Заката',
      twin_palms: 'Южная бухта',
      north_spire_isle: 'Северный пик',
      coral_sandbar: 'Коралловая отмель',
      canyon_camp: 'Утёс над оазисом',
      oasis_pool: 'Изумрудный оазис',
      red_mesa: 'Красная меса',
      sun_gorge: 'Солнечное ущелье',
      dune_sea: 'Золотые дюны',
      south_arch: 'Южный каньон',
      marsh_camp: 'Мшистый холм',
      cypress_heart: 'Кипарисовый остров',
      whisper_fen: 'Шепчущие топи',
      sunken_delta: 'Речная дельта',
      mist_ridge: 'Туманный кряж',
      reed_shore: 'Тростниковый брод',
      caldera_camp: 'Перевал кальдеры',
      crater_heart: 'Остров в кратере',
      north_rim: 'Северный вал вулкана',
      east_ash: 'Восточный хребет',
      west_vents: 'Западный склон',
      outer_valley: 'Внешняя долина',
      fjord_camp: 'Лагерь на мысе',
      west_fjord: 'Западный фьорд',
      east_fjord: 'Восточные скалы',
      glacier_head: 'Северная стена',
      south_strait: 'Южный пролив',
      granite_lookout: 'Гранитный обзор',
      meadow_camp: 'Цветочный лагерь',
      river_bend: 'Золотая излучина',
      birch_terrace: 'Берёзовая терраса',
      sunny_crest: 'Солнечный гребень',
      orchard_vale: 'Южная долина',
      high_moor: 'Северный луг',
    },
    controlsTab: {
      lookSensitivity: 'Чувствительность обзора',
      moveKey: 'WASD / Стик',
      moveDesc: 'Движение',
      lookKey: 'Свайп / Мышь',
      lookDesc: 'Обзор',
      slashKey: 'J / ЛКМ',
      slashDesc: 'Быстрый удар',
      cleaveKey: 'K / ПКМ',
      cleaveDesc: 'Сильный удар',
      dodgeKey: 'Q',
      dodgeDesc: 'Уворот',
      guardKey: 'R',
      guardDesc: 'Блок',
      moveActionsKey: 'Shift / Space / C',
      moveActionsDesc: 'Бег / Прыжок / Присед',
      gearActionsKey: 'F / E / V / M',
      gearActionsDesc: 'Фонарь / Костёр / Камера / Карта',
    },
    cardinals: ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'],
    biomes: {
      'Echo Cavern': 'Пещера Эха',
      'Crystal Basin': 'Кристальное озеро',
      'Abandoned Settlement': 'Заброшенная деревня',
      'Glacial Peaks': 'Ледяные пики',
      'Granite Foothills': 'Гранитные предгорья',
      'Saffron Dunes': 'Шафрановые дюны',
      'Misty Wetlands': 'Туманные топи',
      'Wildflower Meadow': 'Цветочный луг',
      'Emerald Old-Growth': 'Изумрудный лес',
    },
    weatherStatus: {
      Thunderstorm: 'Гроза',
      'Steady Rain': 'Дождь',
      'Alpine Snowfall': 'Снегопад',
      'Dense Valley Mist': 'Густой туман',
      'Clear Breeze': 'Ясный бриз',
    },
    loadStages: {
      'Preparing Expedition...': 'Подготовка экспедиции...',
      'Initializing WebGL2 & HDR Pipeline': 'Запуск WebGL2 и HDR рендеринга',
      'Generating Procedural PBR Materials': 'Создание PBR материалов и текстур',
      'Sculpting Valley Terrain, River & Bridge': 'Создание рельефа, реки и моста',
      'Seeding Pine Forests, Flora & Wildlife': 'Размещение лесов, флоры и животных',
      'Compiling Shaders & Reflection Probes': 'Компиляция шейдеров и отражений',
      'Expedition Ready': 'Экспедиция готова',
    },
    map: {
      title: 'Карта мира и локации',
      minimapLabel: 'Карта (M)',
      openMap: 'Открыть карту',
      closeMap: 'Закрыть',
      currentMapTab: 'Текущая карта',
      allMapsTab: 'Все карты (8)',
      activeBadge: 'Активна',
      enterMapBtn: 'Перейти на карту',
      loadingMapLabel: 'Переход в регион...',
      chooseStartMap: 'Выберите карту',
      playerMarker: 'Вы здесь',
      campfire: 'Костёр',
      bridge: 'Деревянный мост',
      coordinates: 'Координаты',
      teleportHint: 'Нажмите на метку для перемещения',
      northShort: 'С',
      styles: {
        TOPO: 'Топография',
        SATELLITE: 'Спутник',
        RADAR: 'Радар',
        ELEVATION: 'Высоты',
      },
      legend: {
        forest: 'Лес',
        water: 'Река и озеро',
        mountain: 'Горы и снег',
        desert: 'Пустыня',
        marsh: 'Топи',
      },
    },
    worldMaps: {
      lost_valley: { name: 'Затерянная долина', desc: 'Лес, водопад, пещера и деревня' },
      alpine_glacier: { name: 'Ледниковые пики', desc: 'Снежные хребты и ледяные озёра' },
      emerald_archipelago: { name: 'Изумрудный архипелаг', desc: 'Острова, лагуны и проливы' },
      saffron_canyon: { name: 'Шафрановый каньон', desc: 'Пустынные дюны и река-оазис' },
      misty_wetlands: { name: 'Туманные топи', desc: 'Протоки, болота и мшистые острова' },
      crimson_caldera: { name: 'Кальдера вулкана', desc: 'Кольцо скал и кратерное озеро' },
      twin_fjords: { name: 'Двойные фьорды', desc: 'Глубокие заливы и гранитные утёсы' },
      highland_meadows: { name: 'Горные луга', desc: 'Цветущие холмы и извилистая река' },
    },
    webglErrorFallback: 'WebGL графика недоступна на этом устройстве.',
  },
  en: {
    gameTitle: 'SURVIVAL: THE LOST WORLD',
    subtitleBadge: '3D Open-World Wilderness Expedition',
    heroDescription:
      'Explore mountain valleys, cross pine rivers and Echo Cavern, swim through deep currents, and adapt to a living 24-hour weather cycle.',
    heroTags: ['Real-Time Lighting & Reflections', 'Swimming & River Physics', 'Landscape Touch Ready'],
    graphicsLabel: 'Graphics',
    audioOnLabel: 'Audio: On',
    audioMutedLabel: 'Audio: Muted',
    enterWorld: 'Enter World',
    loadingWorld: 'Loading World...',
    offlineBanner: 'Offline Mode — Cached world assets active',
    installApp: 'Install App',
    installIOS: 'Install on iOS',
    installModalTitle: 'Install Lost World App',
    installModalTitleIOS: 'Install on iPhone / iPad',
    installModalSubtitle: 'Play offline in full-screen standalone mode',
    installStep1IOS: 'Tap the',
    installStep1IOSBold: 'Share',
    installStep1IOSRest: 'button in Safari toolbar.',
    installStep2IOS: 'Scroll down and tap',
    installStep2IOSBold1: 'Add to Home Screen',
    installStep2IOSMid: ', then confirm',
    installStep2IOSBold2: 'Add',
    installStep1Desktop: 'Open this app directly in a full browser tab if previewing inside an embedded frame.',
    installStep2Desktop: 'In Chrome or Edge menu, select',
    installStep2DesktopBold1: 'Install App',
    installStep2DesktopMid: 'or',
    installStep2DesktopBold2: 'Add to Home screen',
    gotIt: 'Got It',
    closeLabel: 'Close install guide',
    vitals: {
      stamina: 'Stam',
      warmth: 'Warm',
      hydration: 'Hydr',
    },
    fpsSuffix: 'FPS',
    landscape: 'Landscape',
    touchOn: 'Touch On',
    touchOff: 'Touch Off',
    hideControls: 'Hide Controls (H)',
    showSettings: 'Settings & World',
    tabs: {
      graphics: 'Graphics',
      weather: 'Weather & Sky',
      world: 'World & Camera',
      controls: 'Controls',
    },
    actions: {
      slash: 'Slash (J)',
      cleave: 'Cleave (K)',
      dodge: 'Dodge (Q)',
      light: 'Light (F)',
      audioOn: 'Audio On',
      audioOff: 'Audio Off',
    },
    prompts: {
      extinguishCampfire: '[E] Extinguish Campfire',
      igniteCampfire: '[E] Ignite Campfire',
      swimmingHint: 'Swimming · [Shift] Fast Crawl · [Space] Surge / Climb Bank',
      drinkWater: '[E] Drink Fresh Water',
      caveFlashlight: '[F] Toggle Flashlight inside Echo Cavern',
    },
    mobile: {
      crouch: 'Crouch',
      crouched: 'Crouched',
      fastSwim: 'Fast Swim',
      sprint: 'Sprint',
      extinguish: 'Extinguish',
      ignite: 'Ignite',
      drink: 'Drink',
      guard: 'Guard',
      cleave: 'Cleave',
      dodge: 'Dodge',
      dash: 'Dash',
      slash: 'Slash',
      climb: 'Climb',
      jump: 'Jump',
      switchCamera: 'Switch Camera',
      toggleFlashlight: 'Toggle Flashlight',
    },
    qualityPresetLabel: 'Quality Preset',
    qualityNames: {
      LOW: 'LOW',
      MEDIUM: 'MEDIUM',
      HIGH: 'HIGH',
      ULTRA: 'ULTRA',
      CINEMATIC: 'CINEMATIC',
    },
    qualityDesc: {
      LOW: '512px · Fast Terrain · Base Lighting',
      MEDIUM: '1024px Shadows · HDR · Clarity · 5.2k Grass',
      HIGH: '2048px Shadows · Ray Refl · SMAA · 12k Grass',
      ULTRA: '2048px Hi-DPI · Crisp Clarity · SMAA · 18k Grass',
      CINEMATIC: '4096px Shadows · Max HDR & GI · 24k Grass',
    },
    graphicsFlags: {
      hdr: 'HDR Tone',
      rayReflections: 'Ray Reflections',
      giAndAo: 'Global Illumination',
      clarity: 'Crisp Clarity',
      on: 'ON',
      off: 'OFF',
      aa: 'AA',
    },
    weatherOptions: {
      DYNAMIC: 'Dynamic',
      CLEAR: 'Clear',
      FOGGY: 'Fog',
      RAIN: 'Rain',
      STORM: 'Storm',
      SNOW: 'Snow',
    },
    timeControls: {
      resume: 'Resume',
      pause: 'Pause',
      dawn: 'Dawn',
      noon: 'Noon',
      sunset: 'Sunset',
      night: 'Night',
      cycle24h: '24h Cycle',
    },
    cameraModes: {
      THIRD_PERSON: '3rd Person',
      FIRST_PERSON: '1st Person',
      CINEMATIC_ORBIT: 'Cinematic Orbit',
    },
    landmarks: {
      camp: 'Forest Camp',
      waterfall: 'Cascade Falls',
      village: 'Abandoned Village',
      cavern: 'Echo Cavern',
      peak: 'Alpine Ridge',
      desert: 'Saffron Dunes',
      glacier_camp: 'Ice Ridge Camp',
      frozen_basin: 'Frozen Twin Lake',
      frost_spire: 'Frostbite Spire',
      ice_pass: 'North Ice Pass',
      crystal_overlook: 'Crystal Overlook',
      snow_pine: 'Snowy Pine Basin',
      isle_camp: 'Sanctuary Isle',
      crescent_lagoon: 'Crescent Atoll',
      sunset_atoll: 'Sunset Atoll',
      twin_palms: 'South Cove Isle',
      north_spire_isle: 'North Spire Isle',
      coral_sandbar: 'Coral Sandbar',
      canyon_camp: 'Oasis Overlook',
      oasis_pool: 'Emerald Oasis',
      red_mesa: 'Crimson Mesa',
      sun_gorge: 'Sunstone Gorge',
      dune_sea: 'Golden Dune Sea',
      south_arch: 'South Canyon Rim',
      marsh_camp: 'Mossy Knoll',
      cypress_heart: 'Cypress Heart',
      whisper_fen: 'Whispering Fen',
      sunken_delta: 'Braided Delta',
      mist_ridge: 'North Mist Rise',
      reed_shore: 'Reed Crossing',
      caldera_camp: 'Caldera Saddle',
      crater_heart: 'Crater Spire Isle',
      north_rim: 'North Volcano Rim',
      east_ash: 'East Basalt Ridge',
      west_vents: 'West Ash Slope',
      outer_valley: 'Outer Lava Wash',
      fjord_camp: 'Peninsula Camp',
      west_fjord: 'West Fjord Shore',
      east_fjord: 'East Fjord Cliffs',
      glacier_head: 'Highland Headwall',
      south_strait: 'South Fjord Mouth',
      granite_lookout: 'Granite Lookout',
      meadow_camp: 'Wildflower Camp',
      river_bend: 'Golden Bend',
      birch_terrace: 'Birch Terrace',
      sunny_crest: 'Sunlit Crest',
      orchard_vale: 'South Vale',
      high_moor: 'Northern Moor',
    },
    controlsTab: {
      lookSensitivity: 'Look Sensitivity',
      moveKey: 'WASD / Stick',
      moveDesc: 'Move',
      lookKey: 'Swipe / Drag',
      lookDesc: 'Look',
      slashKey: 'J / L-Click',
      slashDesc: 'Slash Combo',
      cleaveKey: 'K / R-Click',
      cleaveDesc: 'Heavy Cleave',
      dodgeKey: 'Q',
      dodgeDesc: 'Dodge Dash',
      guardKey: 'R',
      guardDesc: 'Guard',
      moveActionsKey: 'Shift / Space / C',
      moveActionsDesc: 'Sprint / Jump / Crouch',
      gearActionsKey: 'F / E / V / M',
      gearActionsDesc: 'Light / Camp / Camera / Map',
    },
    cardinals: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    biomes: {
      'Echo Cavern': 'Echo Cavern',
      'Crystal Basin': 'Crystal Basin',
      'Abandoned Settlement': 'Abandoned Settlement',
      'Glacial Peaks': 'Glacial Peaks',
      'Granite Foothills': 'Granite Foothills',
      'Saffron Dunes': 'Saffron Dunes',
      'Misty Wetlands': 'Misty Wetlands',
      'Wildflower Meadow': 'Wildflower Meadow',
      'Emerald Old-Growth': 'Emerald Old-Growth',
    },
    weatherStatus: {
      Thunderstorm: 'Thunderstorm',
      'Steady Rain': 'Steady Rain',
      'Alpine Snowfall': 'Alpine Snowfall',
      'Dense Valley Mist': 'Dense Valley Mist',
      'Clear Breeze': 'Clear Breeze',
    },
    loadStages: {
      'Preparing Expedition...': 'Preparing Expedition...',
      'Initializing WebGL2 & HDR Pipeline': 'Initializing WebGL2 & HDR Pipeline',
      'Generating Procedural PBR Materials': 'Generating Procedural PBR Materials',
      'Sculpting Valley Terrain, River & Bridge': 'Sculpting Valley Terrain, River & Bridge',
      'Seeding Pine Forests, Flora & Wildlife': 'Seeding Pine Forests, Flora & Wildlife',
      'Compiling Shaders & Reflection Probes': 'Compiling Shaders & Reflection Probes',
      'Expedition Ready': 'Expedition Ready',
    },
    map: {
      title: 'World Atlas & Maps',
      minimapLabel: 'Map (M)',
      openMap: 'Open Map',
      closeMap: 'Close',
      currentMapTab: 'Current Map',
      allMapsTab: 'All Maps (8)',
      activeBadge: 'Active',
      enterMapBtn: 'Switch to Map',
      loadingMapLabel: 'Entering Region...',
      chooseStartMap: 'Select Map',
      playerMarker: 'Your Position',
      campfire: 'Campfire',
      bridge: 'Wooden Bridge',
      coordinates: 'Coords',
      teleportHint: 'Tap any landmark pin to fast-travel',
      northShort: 'N',
      styles: {
        TOPO: 'Topographic',
        SATELLITE: 'Satellite',
        RADAR: 'Night Radar',
        ELEVATION: 'Elevation',
      },
      legend: {
        forest: 'Forest',
        water: 'River & Lake',
        mountain: 'Peaks & Snow',
        desert: 'Dunes',
        marsh: 'Wetlands',
      },
    },
    worldMaps: {
      lost_valley: { name: 'Lost Valley', desc: 'Forest, waterfall, cavern & village' },
      alpine_glacier: { name: 'Alpine Glacier', desc: 'Snow-capped peaks & glacial lakes' },
      emerald_archipelago: { name: 'Emerald Archipelago', desc: 'Lush islands, coves & open sea' },
      saffron_canyon: { name: 'Saffron Canyon', desc: 'Desert mesas, dunes & oasis river' },
      misty_wetlands: { name: 'Misty Wetlands', desc: 'Braided bayous & mossy islets' },
      crimson_caldera: { name: 'Volcanic Caldera', desc: 'Crater ring & central basalt spire' },
      twin_fjords: { name: 'Twin Fjords', desc: 'Deep coastal inlets & granite cliffs' },
      highland_meadows: { name: 'Highland Meadows', desc: 'Rolling wildflower hills & river' },
    },
    webglErrorFallback: 'WebGL context unavailable on this device.',
  },
};
